import type { GetOptions, ListedObject, PutOptions, StorageBackend, StoredObject } from "./storage";

interface MemoryEntry {
  data: Uint8Array;
  contentType: string;
  uploadedAt: Date;
}

export interface MemoryStorage {
  backend: StorageBackend;
  /** Raw object map, exposed so tests can assert on stored bytes and paths. */
  files: Map<string, MemoryEntry>;
}

/** In-memory StorageBackend for tests. Mirrors Blob semantics: no overwrite unless asked. */
export function createMemoryStorage(): MemoryStorage {
  const files = new Map<string, MemoryEntry>();
  const backend: StorageBackend = {
    async put(pathname: string, body: string | Uint8Array, opts: PutOptions): Promise<void> {
      if (opts.overwrite !== true && files.has(pathname)) {
        throw new Error(`refusing to overwrite existing object: ${pathname}`);
      }
      const data = typeof body === "string" ? new TextEncoder().encode(body) : new Uint8Array(body);
      files.set(pathname, { data, contentType: opts.contentType, uploadedAt: new Date() });
    },
    async get(pathname: string, _opts?: GetOptions): Promise<StoredObject | null> {
      const entry = files.get(pathname);
      if (!entry) return null;
      const bytes = entry.data;
      return {
        stream: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        }),
        size: bytes.length,
        contentType: entry.contentType,
      };
    },
    async copy(fromPathname: string, toPathname: string): Promise<void> {
      const entry = files.get(fromPathname);
      if (!entry) throw new Error(`copy source missing: ${fromPathname}`);
      if (files.has(toPathname)) throw new Error(`refusing to overwrite existing object: ${toPathname}`);
      files.set(toPathname, { ...entry, uploadedAt: new Date() });
    },
    async del(pathnames: string[]): Promise<void> {
      for (const p of pathnames) files.delete(p);
    },
    async list(prefix: string): Promise<ListedObject[]> {
      return [...files.entries()]
        .filter(([p]) => p.startsWith(prefix))
        .map(([pathname, e]) => ({ pathname, size: e.data.length, uploadedAt: e.uploadedAt }));
    },
  };
  return { backend, files };
}
