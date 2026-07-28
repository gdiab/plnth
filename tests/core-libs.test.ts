import { beforeEach, describe, expect, it } from "vitest";
import { isValidGenerationId, isValidSiteId, newGenerationId, newSiteId } from "@/lib/id";
import { ADJECTIVES, NOUNS } from "@/lib/words";
import { resolveContentType } from "@/lib/mime";
import { SANDBOX_CSP, apexHeaders, artifactHeaders, injectNoindexMeta } from "@/lib/headers";
import { getPointer, pointerPath, setPointer, type LivePointer } from "@/lib/pointer";
import { createMemoryStorage } from "@/lib/storage-memory";
import { setStorageForTesting } from "@/lib/storage";

describe("ids", () => {
  it("site ids are word-word-suffix DNS-safe labels and pass their own validator", () => {
    for (let i = 0; i < 200; i++) {
      const id = newSiteId();
      expect(id).toMatch(/^[a-z]{3,8}-[a-z]{3,8}-[0-9a-z]{6}$/);
      expect(id.length).toBeLessThanOrEqual(63);
      expect(isValidSiteId(id)).toBe(true);
    }
  });

  it("wordlists are exactly 256 clean lowercase words each (no modulo bias, DNS-safe)", () => {
    for (const list of [ADJECTIVES, NOUNS]) {
      expect(list.length).toBe(256);
      expect(new Set(list).size).toBe(256);
      for (const word of list) expect(word).toMatch(/^[a-z]{3,8}$/);
    }
  });

  it("site ids never collide in a small sample", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newSiteId()));
    expect(ids.size).toBe(1000);
  });

  it("legacy 16-char ids still validate", () => {
    expect(isValidSiteId("ftw90c85m0dpsjkq")).toBe(true);
  });

  it("generation ids sort chronologically across time", () => {
    const a = newGenerationId();
    const b = newGenerationId();
    expect(isValidGenerationId(a)).toBe(true);
    // Same-millisecond ids may tie on prefix; ordering only needs to hold across time.
    expect(a.slice(0, 10) <= b.slice(0, 10)).toBe(true);
  });

  it("validator rejects traversal, uppercase, and non-label shapes", () => {
    const bad = [
      "", "..", "a/../b", "UPPER", "1starts-with-digit", "has space", "a.b", "-dash",
      "a".repeat(40), "amber-fox", "amber-fox-", "amber-fox-3kj9w7-extra", "amber--3kj9w7",
      "Amber-Fox-3kj9w7", "amber-fox-3kj9", "amber_fox_3kj9w7",
    ];
    for (const b of bad) expect(isValidSiteId(b)).toBe(false);
  });
});

describe("mime map (SPEC §4)", () => {
  it("maps known-safe types", () => {
    expect(resolveContentType("x/index.html")).toEqual({ contentType: "text/html; charset=utf-8", attachment: false });
    expect(resolveContentType("a.svg").contentType).toBe("image/svg+xml");
    expect(resolveContentType("a.wasm").contentType).toBe("application/wasm");
    expect(resolveContentType("a.PNG").contentType).toBe("image/png");
  });

  it("unknown extensions become octet-stream attachments", () => {
    for (const p of ["evil.exe", "noext", "x.php", "a.html.bak", "trailingdot."]) {
      expect(resolveContentType(p)).toEqual({ contentType: "application/octet-stream", attachment: true });
    }
  });

  it("never trusts prototype properties as extensions", () => {
    expect(resolveContentType("x.constructor").attachment).toBe(true);
    expect(resolveContentType("x.__proto__").attachment).toBe(true);
  });
});

describe("headers (SPEC §1, §4)", () => {
  it("artifact headers always carry the sandbox CSP and base headers", () => {
    const h = artifactHeaders({ noindex: false });
    expect(h.get("Content-Security-Policy")).toBe(SANDBOX_CSP);
    expect(h.get("X-Content-Type-Options")).toBe("nosniff");
    expect(h.get("Referrer-Policy")).toBe("no-referrer");
    expect(h.get("X-Robots-Tag")).toBeNull();
  });

  it("noindex adds X-Robots-Tag; attachment adds Content-Disposition", () => {
    const h = artifactHeaders({ noindex: true, attachment: true });
    expect(h.get("X-Robots-Tag")).toBe("noindex");
    expect(h.get("Content-Disposition")).toBe("attachment");
  });

  it("apex responses are always noindex", () => {
    expect(apexHeaders().get("X-Robots-Tag")).toBe("noindex");
  });

  it("injects the robots meta after <head>, with or without attributes", () => {
    expect(injectNoindexMeta("<html><head><title>t</title></head></html>")).toContain(
      '<head><meta name="robots" content="noindex"><title>t</title>',
    );
    expect(injectNoindexMeta('<head lang="en">x</head>')).toContain('<head lang="en"><meta name="robots" content="noindex">x');
    expect(injectNoindexMeta("no head at all")).toMatch(/^<meta name="robots" content="noindex">no head at all$/);
  });
});

describe("pointer (SPEC §2)", () => {
  beforeEach(() => {
    const memory = createMemoryStorage();
    setStorageForTesting(memory.backend);
  });

  const live: LivePointer = {
    siteId: "atestsite1234567",
    generation: "gen1",
    createdAt: "2026-07-26T00:00:00.000Z",
    updatedAt: "2026-07-26T00:00:00.000Z",
    crawl: false,
    passwordHash: null,
    updateKeyHash: "abc",
    assets: [],
  };

  it("round-trips live pointers and tombstones", async () => {
    await setPointer(live);
    expect(await getPointer(live.siteId)).toEqual(live);
    await setPointer({ deleted: true, siteId: live.siteId, deletedAt: "2026-07-26T01:00:00.000Z" });
    const p = await getPointer(live.siteId);
    expect(p && "deleted" in p && p.deleted).toBe(true);
  });

  it("returns null for a site that never existed", async () => {
    expect(await getPointer("aneverexisted123")).toBeNull();
  });

  it("stores the pointer at the documented path", () => {
    expect(pointerPath("abc123")).toBe("sites/abc123/meta.json");
  });
});
