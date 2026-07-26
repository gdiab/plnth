import { beforeEach, describe, expect, it } from "vitest";
import { GRACE_MS, sweep } from "@/lib/gc";
import { getPointer, htmlPath, pointerPath } from "@/lib/pointer";
import { setStorageForTesting } from "@/lib/storage";
import { createMemoryStorage, type MemoryStorage } from "@/lib/storage-memory";
import { createSite, deleteSite, replaceHtml } from "@/lib/sites";

const ADMIN = "test-admin-token-0123456789";
process.env.PLNTH_ADMIN_TOKEN = ADMIN;

let memory: MemoryStorage;
beforeEach(() => {
  memory = createMemoryStorage();
  setStorageForTesting(memory.backend);
});

const PAGE = "<p>hi</p>";

/** Backdate a stored object's uploadedAt so it clears the grace window. */
function age(pathname: string, ms: number): void {
  const entry = memory.files.get(pathname)!;
  entry.uploadedAt = new Date(Date.now() - ms);
}

function ageAll(ms: number): void {
  for (const [p] of memory.files) age(p, ms);
}

describe("GC sweep (SPEC §3)", () => {
  it("never collects the live generation, at any age", async () => {
    const { pointer } = await createSite({ html: PAGE });
    ageAll(GRACE_MS * 10);
    const result = await sweep();
    expect(result.deletedObjects).toEqual([]);
    expect(memory.files.has(htmlPath(pointer.siteId, pointer.generation))).toBe(true);
  });

  it("never collects anything younger than the grace window", async () => {
    const { pointer } = await createSite({ html: PAGE });
    // Orphan generation, fresh: simulate a failed publish moments ago.
    await memory.backend.put(`sites/${pointer.siteId}/g/orphangen/index.html`, "x", { contentType: "text/html" });
    const result = await sweep();
    expect(result.deletedObjects).toEqual([]);
  });

  it("collects orphaned generations older than the grace window", async () => {
    const { pointer } = await createSite({ html: PAGE });
    const orphan = `sites/${pointer.siteId}/g/orphangen/index.html`;
    await memory.backend.put(orphan, "x", { contentType: "text/html" });
    age(orphan, GRACE_MS + 1000);
    const result = await sweep();
    expect(result.deletedObjects).toEqual([orphan]);
    expect(memory.files.has(htmlPath(pointer.siteId, pointer.generation))).toBe(true);
  });

  it("collects stale tombstones only after their content is gone — end state zero objects", async () => {
    const { pointer } = await createSite({ html: PAGE });
    await deleteSite(pointer.siteId);
    // Inline GC already removed content; only the tombstone remains, but it's fresh.
    let result = await sweep();
    expect(result.collectedTombstones).toEqual([]);
    expect(memory.files.has(pointerPath(pointer.siteId))).toBe(true);

    // Backdate the tombstone beyond the grace window.
    const raw = JSON.parse(Buffer.from(memory.files.get(pointerPath(pointer.siteId))!.data).toString("utf8"));
    raw.deletedAt = new Date(Date.now() - GRACE_MS - 1000).toISOString();
    memory.files.get(pointerPath(pointer.siteId))!.data = new TextEncoder().encode(JSON.stringify(raw));

    result = await sweep();
    expect(result.collectedTombstones).toEqual([pointer.siteId]);
    expect(memory.files.size).toBe(0);
  });

  it("a tombstoned site with surviving content loses content first, then the tombstone", async () => {
    const { pointer } = await createSite({ html: PAGE });
    // Simulate inline GC having failed: tombstone without content deletion.
    const html = htmlPath(pointer.siteId, pointer.generation);
    const savedHtml = memory.files.get(html)!;
    await deleteSite(pointer.siteId);
    memory.files.set(html, savedHtml); // resurrect the content blob as if del failed

    const raw = JSON.parse(Buffer.from(memory.files.get(pointerPath(pointer.siteId))!.data).toString("utf8"));
    raw.deletedAt = new Date(Date.now() - GRACE_MS - 1000).toISOString();
    memory.files.get(pointerPath(pointer.siteId))!.data = new TextEncoder().encode(JSON.stringify(raw));
    age(html, GRACE_MS + 1000);

    const result = await sweep();
    expect(result.deletedObjects).toEqual([html]);
    expect(result.collectedTombstones).toEqual([pointer.siteId]);
    expect(memory.files.size).toBe(0);
  });

  it("TOCTOU guard: a site republished between list and delete keeps its new generation", async () => {
    const { pointer } = await createSite({ html: PAGE });
    ageAll(GRACE_MS * 2);
    // Wrap list() so the republish happens after listing, before deletes.
    const realList = memory.backend.list.bind(memory.backend);
    let republished = false;
    memory.backend.list = async (prefix: string) => {
      const listed = await realList(prefix);
      if (!republished) {
        republished = true;
        await replaceHtml(pointer.siteId, "<p>v2</p>");
      }
      return listed;
    };
    await sweep();
    const fresh = await getPointer(pointer.siteId);
    expect(fresh && !fresh.deleted).toBe(true);
    const livePath = htmlPath(pointer.siteId, (fresh as { generation: string }).generation);
    expect(memory.files.has(livePath)).toBe(true);
  });
});
