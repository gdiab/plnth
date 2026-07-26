import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { FsStorage } from "@/lib/storage-fs";
import { createMemoryStorage } from "@/lib/storage-memory";
import { getStorage, setStorageForTesting, type StorageBackend } from "@/lib/storage";

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function contractTests(name: string, factory: () => StorageBackend) {
  describe(`${name} driver contract`, () => {
    let storage: StorageBackend;
    beforeEach(() => {
      storage = factory();
    });

    it("round-trips an object with its content type", async () => {
      await storage.put("sites/a/g/1/index.html", "<h1>hi</h1>", { contentType: "text/html" });
      const got = await storage.get("sites/a/g/1/index.html");
      expect(got).not.toBeNull();
      expect(got!.contentType).toBe("text/html");
      expect(got!.size).toBe(11);
      expect(await readAll(got!.stream)).toBe("<h1>hi</h1>");
    });

    it("returns null for a missing object", async () => {
      expect(await storage.get("sites/nope/meta.json")).toBeNull();
    });

    it("refuses overwrite by default (generation immutability)", async () => {
      await storage.put("sites/a/g/1/index.html", "v1", { contentType: "text/html" });
      await expect(storage.put("sites/a/g/1/index.html", "v2", { contentType: "text/html" })).rejects.toThrow();
      expect(await readAll((await storage.get("sites/a/g/1/index.html"))!.stream)).toBe("v1");
    });

    it("allows overwrite only when explicitly requested (pointer writes)", async () => {
      await storage.put("sites/a/meta.json", "{\"v\":1}", { contentType: "application/json", overwrite: true });
      await storage.put("sites/a/meta.json", "{\"v\":2}", { contentType: "application/json", overwrite: true });
      expect(await readAll((await storage.get("sites/a/meta.json"))!.stream)).toBe("{\"v\":2}");
    });

    it("deletes objects and tolerates deleting the already-absent", async () => {
      await storage.put("sites/a/g/1/index.html", "x", { contentType: "text/html" });
      await storage.del(["sites/a/g/1/index.html", "sites/a/g/1/missing.css"]);
      expect(await storage.get("sites/a/g/1/index.html")).toBeNull();
    });

    it("lists by prefix only", async () => {
      await storage.put("sites/a/meta.json", "{}", { contentType: "application/json", overwrite: true });
      await storage.put("sites/a/g/1/index.html", "x", { contentType: "text/html" });
      await storage.put("sites/b/meta.json", "{}", { contentType: "application/json", overwrite: true });
      const a = await storage.list("sites/a/");
      expect(a.map((o) => o.pathname).sort()).toEqual(["sites/a/g/1/index.html", "sites/a/meta.json"]);
      const all = await storage.list("sites/");
      expect(all).toHaveLength(3);
    });
  });
}

contractTests("memory", () => createMemoryStorage().backend);

const fsRoots: string[] = [];
contractTests("fs", () => {
  const root = mkdtempSync(path.join(tmpdir(), "plnth-fs-test-"));
  fsRoots.push(root);
  return new FsStorage(root);
});

describe("fs driver path safety", () => {
  it("refuses pathnames that escape the storage root", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "plnth-fs-test-"));
    fsRoots.push(root);
    const storage = new FsStorage(root);
    await expect(storage.put("../evil.html", "x", { contentType: "text/html" })).rejects.toThrow(/escapes/);
    await expect(storage.get("../../etc/passwd")).rejects.toThrow(/escapes/);
  });
});

afterAll(() => {
  for (const root of fsRoots) rmSync(root, { recursive: true, force: true });
});

describe("driver selection (SPEC §8: fail closed)", () => {
  const savedEnv = { ...process.env };
  beforeEach(() => {
    setStorageForTesting(null);
  });
  afterEach(() => {
    setStorageForTesting(null);
    process.env = { ...savedEnv };
  });

  it("hard-errors without BLOB_READ_WRITE_TOKEN (no silent fs fallback)", () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.PLNTH_STORAGE;
    expect(() => getStorage()).toThrow(/BLOB_READ_WRITE_TOKEN/);
  });

  it("selects fs only via explicit PLNTH_STORAGE=fs", () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    process.env.PLNTH_STORAGE = "fs";
    process.env.PLNTH_STORAGE_DIR = mkdtempSync(path.join(tmpdir(), "plnth-fs-test-"));
    fsRoots.push(process.env.PLNTH_STORAGE_DIR);
    expect(() => getStorage()).not.toThrow();
  });

  it("refuses the fs driver in production even when explicitly selected", () => {
    process.env.PLNTH_STORAGE = "fs";
    process.env.VERCEL_ENV = "production";
    expect(() => getStorage()).toThrow(/production/);
  });
});
