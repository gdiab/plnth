import { mkdirSync, promises as fs } from "node:fs";
import path from "node:path";
import type { GetOptions, ListedObject, PutOptions, StorageBackend, StoredObject } from "./storage";

interface Sidecar {
  contentType: string;
  uploadedAt: string;
}

/**
 * Local-dev driver only; selected exclusively by PLNTH_STORAGE=fs (SPEC §8).
 * Each object is a file plus a `<file>.plnthmeta` sidecar for content type.
 */
export class FsStorage implements StorageBackend {
  constructor(private readonly root: string) {
    mkdirSync(root, { recursive: true });
  }

  private objectPath(pathname: string): string {
    const resolved = path.resolve(this.root, pathname);
    const rootResolved = path.resolve(this.root);
    if (!resolved.startsWith(rootResolved + path.sep)) {
      throw new Error(`pathname escapes storage root: ${pathname}`);
    }
    return resolved;
  }

  async put(pathname: string, body: string | Uint8Array, opts: PutOptions): Promise<void> {
    const file = this.objectPath(pathname);
    if (opts.overwrite !== true) {
      try {
        await fs.access(file);
        throw new Error(`refusing to overwrite existing object: ${pathname}`);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
    }
    await fs.mkdir(path.dirname(file), { recursive: true });
    const sidecar: Sidecar = { contentType: opts.contentType, uploadedAt: new Date().toISOString() };
    await fs.writeFile(file, body);
    await fs.writeFile(file + ".plnthmeta", JSON.stringify(sidecar));
  }

  async get(pathname: string, _opts?: GetOptions): Promise<StoredObject | null> {
    const file = this.objectPath(pathname);
    let data: Buffer;
    let sidecar: Sidecar;
    try {
      data = await fs.readFile(file);
      sidecar = JSON.parse(await fs.readFile(file + ".plnthmeta", "utf8")) as Sidecar;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
    const bytes = new Uint8Array(data);
    return {
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
      size: bytes.length,
      contentType: sidecar.contentType,
    };
  }

  async del(pathnames: string[]): Promise<void> {
    for (const pathname of pathnames) {
      const file = this.objectPath(pathname);
      await fs.rm(file, { force: true });
      await fs.rm(file + ".plnthmeta", { force: true });
    }
  }

  async list(prefix: string): Promise<ListedObject[]> {
    const out: ListedObject[] = [];
    const rootResolved = path.resolve(this.root);
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
        throw err;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (!entry.name.endsWith(".plnthmeta")) {
          const pathname = path.relative(rootResolved, full).split(path.sep).join("/");
          if (!pathname.startsWith(prefix)) continue;
          const [stat, sidecarRaw] = await Promise.all([
            fs.stat(full),
            fs.readFile(full + ".plnthmeta", "utf8").catch(() => null),
          ]);
          const uploadedAt = sidecarRaw ? new Date((JSON.parse(sidecarRaw) as Sidecar).uploadedAt) : stat.mtime;
          out.push({ pathname, size: stat.size, uploadedAt });
        }
      }
    };
    await walk(rootResolved);
    return out;
  }
}
