import { getStorage } from "./storage";

/**
 * The one mutable object per site (SPEC §2). Written last, after the
 * generation is fully uploaded. Pointer writes are last-writer-wins; if that
 * ever stops being acceptable this module is the CAS upgrade seam.
 */

export interface LivePointer {
  deleted?: false;
  siteId: string;
  /** Current generation id; all content paths derive from it. */
  generation: string;
  createdAt: string;
  updatedAt: string;
  crawl: boolean;
  /** scrypt hash string, or null when no viewer password is set. */
  passwordHash: string | null;
  /** sha256 hex of the per-site update key. */
  updateKeyHash: string;
  /** Asset manifest: relative paths under the generation (e.g. "assets/a.png"). */
  assets: string[];
  /** Extracted from the HTML on create/replace (spec: exhibit titles). Absent = pre-titles pointer, healed lazily. */
  derivedTitle?: string | null;
  /** Curator's rename; survives HTML replacement. Absent = no override. */
  customTitle?: string;
}

export interface Tombstone {
  deleted: true;
  siteId: string;
  deletedAt: string;
}

export type Pointer = LivePointer | Tombstone;

export const SITES_PREFIX = "sites/";

export function pointerPath(siteId: string): string {
  return `${SITES_PREFIX}${siteId}/meta.json`;
}

export function generationPrefix(siteId: string, generation: string): string {
  return `${SITES_PREFIX}${siteId}/g/${generation}/`;
}

export function htmlPath(siteId: string, generation: string): string {
  return `${generationPrefix(siteId, generation)}index.html`;
}

export function assetStoragePath(siteId: string, generation: string, relPath: string): string {
  return `${generationPrefix(siteId, generation)}${relPath}`;
}

async function readJson(stream: ReadableStream<Uint8Array>): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** Pointer reads always bypass the CDN cache (SPEC §2). Null = site never existed or fully collected. */
export async function getPointer(siteId: string): Promise<Pointer | null> {
  const obj = await getStorage().get(pointerPath(siteId), { fresh: true });
  if (!obj) return null;
  return (await readJson(obj.stream)) as Pointer;
}

export async function setPointer(pointer: Pointer, opts?: { overwrite?: boolean }): Promise<void> {
  await getStorage().put(pointerPath(pointer.siteId), JSON.stringify(pointer), {
    contentType: "application/json",
    overwrite: opts?.overwrite ?? true,
  });
}

/** GC only — everything else deletes by writing a tombstone, never by removing the pointer. */
export async function deletePointer(siteId: string): Promise<void> {
  await getStorage().del([pointerPath(siteId)]);
}
