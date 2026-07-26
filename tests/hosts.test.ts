import { describe, expect, it } from "vitest";
import { resolveHost } from "@/lib/hosts";

describe("host routing matrix (SPEC §1)", () => {
  const apex = "plnth.app";

  it("apex serves portal/API", () => {
    expect(resolveHost("plnth.app", apex)).toEqual({ kind: "apex" });
    expect(resolveHost("PLNTH.APP", apex)).toEqual({ kind: "apex" });
  });

  it("valid site-id subdomains serve artifacts", () => {
    expect(resolveHost("abc123defg456hjk.plnth.app", apex)).toEqual({
      kind: "artifact",
      siteId: "abc123defg456hjk",
    });
  });

  it("unknown hosts 404 — including vercel.app deployment URLs", () => {
    for (const host of [
      "plnth-beryl.vercel.app",
      "plnth.vercel.app",
      "evil.com",
      "plnth.app.evil.com",
      "deep.abc123.plnth.app",
      "www.plnth.app",
      "UPPER-case!.plnth.app",
      "xplnth.app",
      "",
      null,
    ]) {
      expect(resolveHost(host as string | null, apex).kind, String(host)).toBe("unknown");
    }
  });

  it("subdomain labels that are not valid site ids 404 (www, hyphens, digits-first)", () => {
    for (const label of ["www", "1abc", "-x", "a_b", "a.b"]) {
      expect(resolveHost(`${label}.plnth.app`, apex).kind, label).toBe("unknown");
    }
  });

  it("dev apex with port works the same way", () => {
    const dev = "localhost:3000";
    expect(resolveHost("localhost:3000", dev)).toEqual({ kind: "apex" });
    expect(resolveHost("abcdef1234567890.localhost:3000", dev)).toEqual({
      kind: "artifact",
      siteId: "abcdef1234567890",
    });
    expect(resolveHost("localhost:3001", dev).kind).toBe("unknown");
  });
});
