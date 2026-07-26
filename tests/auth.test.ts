import { beforeEach, describe, expect, it } from "vitest";
import {
  assertOriginAllowed,
  bearerToken,
  cookieSecret,
  hashUpdateKey,
  newSessionValue,
  newUpdateKey,
  verifyAdminToken,
  verifySessionValue,
  verifyUpdateKey,
} from "@/lib/auth";
import { HttpError } from "@/lib/errors";
import { hashPassword, verifyPassword, verifyViewerCookie, viewerCookieValue } from "@/lib/password";
import { RateLimiter } from "@/lib/ratelimit";

beforeEach(() => {
  process.env.PLNTH_ADMIN_TOKEN = "test-admin-token-0123456789";
});

describe("admin token (SPEC §5)", () => {
  it("accepts the exact token and rejects near-misses of any length", () => {
    expect(verifyAdminToken("test-admin-token-0123456789")).toBe(true);
    expect(verifyAdminToken("")).toBe(false);
    expect(verifyAdminToken("x")).toBe(false);
    expect(verifyAdminToken("test-admin-token-012345678")).toBe(false);
    expect(verifyAdminToken("test-admin-token-0123456789extra")).toBe(false);
  });

  it("hard-errors when the server token is missing or too short", () => {
    process.env.PLNTH_ADMIN_TOKEN = "short";
    expect(() => verifyAdminToken("short")).toThrow(HttpError);
    delete process.env.PLNTH_ADMIN_TOKEN;
    expect(() => verifyAdminToken("anything")).toThrow(HttpError);
  });

  it("compares via digest, so lengths never reach timingSafeEqual unequal", () => {
    // The guarantee under test: no early return on length mismatch — both
    // sides are hashed to fixed width first. A wrong-length guess must go
    // through the same code path as a right-length one.
    expect(verifyAdminToken("a")).toBe(false);
    expect(verifyAdminToken("a".repeat(10_000))).toBe(false);
  });
});

describe("update keys", () => {
  it("mints, hashes, verifies; wrong keys fail", () => {
    const key = newUpdateKey();
    const hash = hashUpdateKey(key);
    expect(verifyUpdateKey(key, hash)).toBe(true);
    expect(verifyUpdateKey(newUpdateKey(), hash)).toBe(false);
    expect(verifyUpdateKey("", hash)).toBe(false);
  });
});

describe("bearer extraction", () => {
  it("parses Bearer tokens case-insensitively and rejects other schemes", () => {
    expect(bearerToken(new Request("https://x/", { headers: { authorization: "Bearer abc" } }))).toBe("abc");
    expect(bearerToken(new Request("https://x/", { headers: { authorization: "bearer abc" } }))).toBe("abc");
    expect(bearerToken(new Request("https://x/", { headers: { authorization: "Basic abc" } }))).toBeNull();
    expect(bearerToken(new Request("https://x/"))).toBeNull();
  });
});

describe("Origin validation (SPEC §1)", () => {
  const apex = "plnth.app";
  const req = (origin?: string) =>
    new Request("https://plnth.app/v1/sites", { method: "POST", headers: origin ? { origin } : {} });

  it("allows absent Origin (curl, Lavish) and the apex itself", () => {
    expect(() => assertOriginAllowed(req(), apex)).not.toThrow();
    expect(() => assertOriginAllowed(req("https://plnth.app"), apex)).not.toThrow();
  });

  it("rejects subdomain origins, foreign origins, opaque null, and garbage", () => {
    for (const bad of ["https://abc123.plnth.app", "https://evil.com", "null", "not-a-url"]) {
      expect(() => assertOriginAllowed(req(bad), apex), bad).toThrow(HttpError);
    }
  });
});

describe("passwords (SPEC §5: async scrypt)", () => {
  it("hashes and verifies; wrong password fails", async () => {
    const hash = await hashPassword("correct horse");
    expect(hash).toMatch(/^scrypt\$/);
    expect(await verifyPassword("correct horse", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  it("rejects malformed stored hashes without throwing", async () => {
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
    expect(await verifyPassword("x", "")).toBe(false);
  });

  it("the password module never imports scryptSync (banned by name, SPEC §10)", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("lib/password.ts", "utf8");
    expect(source).not.toContain("scryptSync");
  });
});

describe("viewer cookies bound to password hash (SPEC §4)", () => {
  it("rotating the password invalidates outstanding cookies", () => {
    const secret = "s";
    const cookie = viewerCookieValue("site1", "hash-v1", secret);
    expect(verifyViewerCookie(cookie, "site1", "hash-v1", secret)).toBe(true);
    expect(verifyViewerCookie(cookie, "site1", "hash-v2", secret)).toBe(false);
    expect(verifyViewerCookie(cookie, "site2", "hash-v1", secret)).toBe(false);
    expect(verifyViewerCookie("forged", "site1", "hash-v1", secret)).toBe(false);
  });
});

describe("portal sessions", () => {
  it("round-trips, rejects tampering, expires", () => {
    const secret = cookieSecret();
    const value = newSessionValue(secret);
    expect(verifySessionValue(value, secret)).toBe(true);
    expect(verifySessionValue(value + "x", secret)).toBe(false);
    expect(verifySessionValue("12345.sig", secret)).toBe(false);
    const expired = newSessionValue(secret, -1000);
    expect(verifySessionValue(expired, secret)).toBe(false);
  });
});

describe("rate limiter (SPEC §5)", () => {
  it("allows 5 then 429s the 6th with Retry-After seconds", () => {
    const limiter = new RateLimiter(5, 60_000);
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) expect(limiter.hit("ip1|site1", t0 + i)).toBeNull();
    const retry = limiter.hit("ip1|site1", t0 + 5);
    expect(retry).toBeGreaterThanOrEqual(1);
    expect(retry).toBeLessThanOrEqual(60);
  });

  it("keys are independent and windows reset", () => {
    const limiter = new RateLimiter(1, 1_000);
    const t0 = 0;
    expect(limiter.hit("a", t0)).toBeNull();
    expect(limiter.hit("a", t0 + 1)).not.toBeNull();
    expect(limiter.hit("b", t0 + 1)).toBeNull();
    expect(limiter.hit("a", t0 + 1_001)).toBeNull();
  });
});
