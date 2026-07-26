import { del as blobDel, get as blobGet, list as blobList, put as blobPut } from "@vercel/blob";
import { FsStorage } from "./storage-fs";

export interface StoredObject {
  stream: ReadableStream<Uint8Array>;
  size: number;
  contentType: string;
}

export interface ListedObject {
  pathname: string;
  size: number;
  uploadedAt: Date;
}

export interface PutOptions {
  contentType: string;
  /** Only the site pointer (meta.json) may be overwritten; generation paths are immutable. */
  overwrite?: boolean;
}

export interface GetOptions {
  /** Bypass CDN cache — required for pointer reads (SPEC §2: pointer reads use useCache: false). */
  fresh?: boolean;
}

export interface StorageBackend {
  put(pathname: string, body: string | Uint8Array, opts: PutOptions): Promise<void>;
  get(pathname: string, opts?: GetOptions): Promise<StoredObject | null>;
  del(pathnames: string[]): Promise<void>;
  /** GC and admin listing only. Reader paths must never call this (SPEC §2). */
  list(prefix: string): Promise<ListedObject[]>;
}

class BlobStorage implements StorageBackend {
  async put(pathname: string, body: string | Uint8Array, opts: PutOptions): Promise<void> {
    await blobPut(pathname, body as string | ArrayBuffer | Uint8Array<ArrayBuffer>, {
      access: "private",
      contentType: opts.contentType,
      allowOverwrite: opts.overwrite === true,
      addRandomSuffix: false,
    });
  }

  async get(pathname: string, opts?: GetOptions): Promise<StoredObject | null> {
    const result = await blobGet(pathname, {
      access: "private",
      useCache: opts?.fresh ? false : true,
    });
    if (!result || result.statusCode !== 200) return null;
    return {
      stream: result.stream,
      size: result.blob.size,
      contentType: result.blob.contentType,
    };
  }

  async del(pathnames: string[]): Promise<void> {
    if (pathnames.length === 0) return;
    await blobDel(pathnames);
  }

  async list(prefix: string): Promise<ListedObject[]> {
    const out: ListedObject[] = [];
    let cursor: string | undefined;
    do {
      const page = await blobList({ prefix, cursor, limit: 1000 });
      for (const b of page.blobs) {
        out.push({ pathname: b.pathname, size: b.size, uploadedAt: new Date(b.uploadedAt) });
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return out;
  }
}

let storage: StorageBackend | null = null;

/** Test seam: inject a backend (memory storage) and bypass env-driven selection. */
export function setStorageForTesting(backend: StorageBackend | null): void {
  storage = backend;
}

/**
 * Driver selection (SPEC §8, fail closed):
 * - `PLNTH_STORAGE=fs` explicitly selects the filesystem driver, and only
 *   outside production. Absence of Blob config never selects it.
 * - Otherwise Blob is required: missing BLOB_READ_WRITE_TOKEN is a hard error.
 */
export function getStorage(): StorageBackend {
  if (storage) return storage;

  const isProduction = process.env.VERCEL_ENV === "production" || (!process.env.VERCEL_ENV && process.env.NODE_ENV === "production");

  if (process.env.PLNTH_STORAGE === "fs") {
    if (isProduction) {
      throw new Error("PLNTH_STORAGE=fs is a local-dev driver and is refused in production");
    }
    storage = new FsStorage(process.env.PLNTH_STORAGE_DIR || ".plnth-data");
    return storage;
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error(
      "BLOB_READ_WRITE_TOKEN is not set. Refusing to start without blob storage (no filesystem fallback; set PLNTH_STORAGE=fs explicitly for local dev).",
    );
  }

  storage = new BlobStorage();
  return storage;
}
