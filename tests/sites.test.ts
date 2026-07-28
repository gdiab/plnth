import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/errors";
import { getPointer, htmlPath, pointerPath, setPointer } from "@/lib/pointer";
import { setStorageForTesting } from "@/lib/storage";
import { createMemoryStorage, type MemoryStorage } from "@/lib/storage-memory";
import {
  MAX_ASSETS_PER_SITE,
  createSite,
  deleteSite,
  listSites,
  patchSettings,
  replaceHtml,
  requireLiveSite,
  uploadAsset,
  validateAssetPath,
} from "@/lib/sites";

process.env.PLNTH_ADMIN_TOKEN = "test-admin-token-0123456789";

let memory: MemoryStorage;
beforeEach(() => {
  memory = createMemoryStorage();
  setStorageForTesting(memory.backend);
});

const PAGE = "<html><head><title>t</title></head><body>hello</body></html>";

describe("create (SPEC §2)", () => {
  it("creates a site whose pointer names a fully uploaded generation", async () => {
    const { pointer, updateKey } = await createSite({ html: PAGE });
    expect(pointer.generation).toMatch(/^[0-9a-z]+$/);
    expect(updateKey).toMatch(/^puk_/);
    expect(memory.files.has(htmlPath(pointer.siteId, pointer.generation))).toBe(true);
    expect(memory.files.has(pointerPath(pointer.siteId))).toBe(true);
    expect(pointer.crawl).toBe(false);
  });

  it("never stores the update key or password in cleartext", async () => {
    const { pointer } = await createSite({ html: PAGE, password: "sekret-password" });
    const raw = Buffer.from(memory.files.get(pointerPath(pointer.siteId))!.data).toString("utf8");
    expect(raw).not.toContain("sekret-password");
    expect(raw).not.toContain("puk_");
  });

  it("two password hashes of the same password differ (salting)", async () => {
    const a = await createSite({ html: PAGE, password: "same" });
    const b = await createSite({ html: PAGE, password: "same" });
    expect(a.pointer.passwordHash).not.toBe(b.pointer.passwordHash);
  });

  it("rejects HTML over the 2 MB cap with 413", async () => {
    const big = "x".repeat(2 * 1024 * 1024 + 1);
    await expect(createSite({ html: big })).rejects.toMatchObject({ status: 413 });
  });

  it("half-written generation is never servable: pointer write failing leaves no site", async () => {
    const put = memory.backend.put.bind(memory.backend);
    vi.spyOn(memory.backend, "put").mockImplementation(async (pathname, body, opts) => {
      if (pathname.endsWith("meta.json")) throw new Error("network blip");
      return put(pathname, body, opts);
    });
    await expect(createSite({ html: PAGE })).rejects.toThrow("network blip");
    // The orphaned generation exists but no pointer names it: unreachable garbage, not a site.
    const pointers = [...memory.files.keys()].filter((p) => p.endsWith("meta.json"));
    expect(pointers).toHaveLength(0);
  });
});

describe("replace (SPEC §2: immutable generations)", () => {
  it("writes a new generation and never overwrites the old paths", async () => {
    const { pointer } = await createSite({ html: PAGE });
    const before = pointer.generation;
    const updated = await replaceHtml(pointer.siteId, "<p>v2</p>");
    expect(updated.generation).not.toBe(before);
    const stored = Buffer.from(memory.files.get(htmlPath(pointer.siteId, updated.generation))!.data).toString("utf8");
    expect(stored).toBe("<p>v2</p>");
  });

  it("carries assets forward into the new generation", async () => {
    const { pointer } = await createSite({ html: PAGE });
    await uploadAsset(pointer.siteId, "assets/logo.png", new Uint8Array([1, 2, 3]));
    const updated = await replaceHtml(pointer.siteId, "<p>v2</p>");
    expect(updated.assets).toEqual(["assets/logo.png"]);
    expect(memory.files.has(`sites/${pointer.siteId}/g/${updated.generation}/assets/logo.png`)).toBe(true);
  });

  it("inline-GCs the superseded generation", async () => {
    const { pointer } = await createSite({ html: PAGE });
    await replaceHtml(pointer.siteId, "<p>v2</p>");
    expect(memory.files.has(htmlPath(pointer.siteId, pointer.generation))).toBe(false);
  });

  it("a failed replace leaves the old site fully intact and servable", async () => {
    const { pointer } = await createSite({ html: PAGE });
    const put = memory.backend.put.bind(memory.backend);
    vi.spyOn(memory.backend, "put").mockImplementation(async (pathname, body, opts) => {
      if (pathname.endsWith("meta.json")) throw new Error("blip");
      return put(pathname, body, opts);
    });
    await expect(replaceHtml(pointer.siteId, "<p>v2</p>")).rejects.toThrow("blip");
    const live = await requireLiveSite(pointer.siteId);
    expect(live.generation).toBe(pointer.generation);
    expect(memory.files.has(htmlPath(pointer.siteId, pointer.generation))).toBe(true);
  });
});

describe("assets", () => {
  it("asset upload produces a new generation referencing the unchanged HTML", async () => {
    const { pointer } = await createSite({ html: PAGE });
    const updated = await uploadAsset(pointer.siteId, "style.css", new TextEncoder().encode("body{}"));
    expect(updated.generation).not.toBe(pointer.generation);
    const html = Buffer.from(memory.files.get(htmlPath(pointer.siteId, updated.generation))!.data).toString("utf8");
    expect(html).toBe(PAGE);
    expect(updated.assets).toEqual(["style.css"]);
  });

  it("replacing an asset keeps the manifest de-duplicated", async () => {
    const { pointer } = await createSite({ html: PAGE });
    await uploadAsset(pointer.siteId, "a.css", new TextEncoder().encode("v1"));
    const updated = await uploadAsset(pointer.siteId, "a.css", new TextEncoder().encode("v2"));
    expect(updated.assets).toEqual(["a.css"]);
    const stored = Buffer.from(memory.files.get(`sites/${pointer.siteId}/g/${updated.generation}/a.css`)!.data).toString("utf8");
    expect(stored).toBe("v2");
  });

  it("enforces the 100-asset cap with 413", async () => {
    const { pointer } = await createSite({ html: PAGE });
    const live = await requireLiveSite(pointer.siteId);
    // Simulate a full manifest without 100 real uploads.
    const { setPointer } = await import("@/lib/pointer");
    await setPointer({ ...live, assets: Array.from({ length: MAX_ASSETS_PER_SITE }, (_, i) => `a${i}.css`) });
    await expect(uploadAsset(pointer.siteId, "one-more.css", new Uint8Array([1]))).rejects.toMatchObject({ status: 413 });
  });

  it("rejects traversal and reserved asset paths with 400", () => {
    for (const bad of ["../evil", "a/../../b", "a//b", "/abs", ".hidden", "..", "index.html", "with space.css", "a\\b"]) {
      expect(() => validateAssetPath(bad), bad).toThrow(HttpError);
    }
    for (const good of ["style.css", "assets/logo.png", "fonts/Inter-400.woff2", "data.json"]) {
      expect(validateAssetPath(good)).toBe(good);
    }
  });
});

describe("tombstones (SPEC §3)", () => {
  it("delete tombstones first and the site 404s immediately", async () => {
    const { pointer } = await createSite({ html: PAGE });
    await deleteSite(pointer.siteId);
    await expect(requireLiveSite(pointer.siteId)).rejects.toMatchObject({ status: 404 });
    const raw = JSON.parse(Buffer.from(memory.files.get(pointerPath(pointer.siteId))!.data).toString("utf8"));
    expect(raw.deleted).toBe(true);
  });

  it("delete inline-GCs the site's generation blobs", async () => {
    const { pointer } = await createSite({ html: PAGE });
    await uploadAsset(pointer.siteId, "a.css", new Uint8Array([1]));
    await deleteSite(pointer.siteId);
    const contentPaths = [...memory.files.keys()].filter((p) => p.includes("/g/"));
    expect(contentPaths).toHaveLength(0);
  });

  it("every write path refuses a tombstone (resurrection race killed)", async () => {
    const { pointer } = await createSite({ html: PAGE });
    await deleteSite(pointer.siteId);
    await expect(replaceHtml(pointer.siteId, "<p>zombie</p>")).rejects.toMatchObject({ status: 404 });
    await expect(patchSettings(pointer.siteId, { crawl: true })).rejects.toMatchObject({ status: 404 });
    await expect(uploadAsset(pointer.siteId, "a.css", new Uint8Array([1]))).rejects.toMatchObject({ status: 404 });
    await expect(deleteSite(pointer.siteId)).rejects.toMatchObject({ status: 404 });
    // Still tombstoned, not resurrected.
    const raw = JSON.parse(Buffer.from(memory.files.get(pointerPath(pointer.siteId))!.data).toString("utf8"));
    expect(raw.deleted).toBe(true);
  });
});

describe("settings (SPEC §2: pointer-only writes)", () => {
  it("patch rewrites only the pointer — content paths untouched", async () => {
    const { pointer } = await createSite({ html: PAGE });
    const pathsBefore = [...memory.files.keys()].sort();
    const updated = await patchSettings(pointer.siteId, { crawl: true, password: "pw" });
    expect(updated.crawl).toBe(true);
    expect(updated.passwordHash).not.toBeNull();
    expect(updated.generation).toBe(pointer.generation);
    expect([...memory.files.keys()].sort()).toEqual(pathsBefore);
  });

  it("password null clears; undefined leaves unchanged", async () => {
    const { pointer } = await createSite({ html: PAGE, password: "pw" });
    const unchanged = await patchSettings(pointer.siteId, { crawl: true });
    expect(unchanged.passwordHash).not.toBeNull();
    const cleared = await patchSettings(pointer.siteId, { password: null });
    expect(cleared.passwordHash).toBeNull();
  });
});

describe("listing (admin only)", () => {
  it("lists live sites and excludes tombstones", async () => {
    const a = await createSite({ html: PAGE });
    const b = await createSite({ html: PAGE });
    await deleteSite(a.pointer.siteId);
    const sites = await listSites();
    expect(sites.map((s) => s.siteId)).toEqual([b.pointer.siteId]);
  });
});

describe("exhibit titles on create/replace", () => {
  it("create derives the title from <title>", async () => {
    const { pointer } = await createSite({ html: "<title>My Report</title><p>x</p>" });
    expect(pointer.derivedTitle).toBe("My Report");
  });

  it("create stores null when no title is derivable", async () => {
    const { pointer } = await createSite({ html: "<p>plain</p>" });
    expect(pointer.derivedTitle).toBeNull();
  });

  it("replace re-derives the title and preserves customTitle", async () => {
    const { pointer } = await createSite({ html: "<title>v1</title>" });
    await setPointer({ ...pointer, customTitle: "Pinned Name" });
    const updated = await replaceHtml(pointer.siteId, "<title>v2</title>");
    expect(updated.derivedTitle).toBe("v2");
    expect(updated.customTitle).toBe("Pinned Name");
  });
});

describe("site id collision retry", () => {
  it("skips taken ids (live or tombstone) and errors after 3 attempts", async () => {
    const { pointer: taken } = await createSite({ html: "<p>a</p>" });
    // A queue of candidates: first collides with the live site, second wins.
    const queue = [taken.siteId, "amber-fox-aaaaaa"];
    const { pointer } = await createSite({ html: "<p>b</p>" }, () => queue.shift()!);
    expect(pointer.siteId).toBe("amber-fox-aaaaaa");

    // All three candidates taken → 500-class error.
    const always = () => taken.siteId;
    await expect(createSite({ html: "<p>c</p>" }, always)).rejects.toThrow(/site id/i);
  });
});
