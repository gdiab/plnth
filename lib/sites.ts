import { HttpError } from "./errors";
import { resolveContentType } from "./mime";
import { hashUpdateKey, newUpdateKey } from "./auth";
import { hashPassword } from "./password";
import { isValidSiteId, newGenerationId, newSiteId } from "./id";
import { extractTitle, normalizeTitle } from "./title";
import {
  SITES_PREFIX,
  assetStoragePath,
  generationPrefix,
  getPointer,
  htmlPath,
  setPointer,
  type LivePointer,
  type Pointer,
} from "./pointer";
import { getStorage } from "./storage";

/**
 * Site lifecycle over the generation/pointer model (SPEC §2, §3):
 * - every mutation of content writes a brand-new generation, pointer last;
 * - the pointer is the only mutable object (last-writer-wins);
 * - delete is tombstone-first; every write path refuses tombstones;
 * - superseded generations are inline-GC'd best-effort (the cron sweep is
 *   the invariant-keeper).
 */

export const MAX_HTML_BYTES = 2 * 1024 * 1024;
export const MAX_ASSET_BYTES = 4 * 1024 * 1024;
export const MAX_ASSETS_PER_SITE = 100;

const ASSET_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Reject traversal, hidden files, reserved names, and junk — 400 with detail. */
export function validateAssetPath(relPath: string): string {
  const segments = relPath.split("/");
  if (relPath.length === 0 || relPath.length > 512 || segments.length > 8) {
    throw new HttpError(400, `invalid asset path ${JSON.stringify(relPath)}`);
  }
  for (const segment of segments) {
    if (!ASSET_SEGMENT_RE.test(segment) || segment === ".." || segment === ".") {
      throw new HttpError(
        400,
        `invalid asset path segment ${JSON.stringify(segment)} — segments must match A-Za-z0-9 then A-Za-z0-9._- and may not be dotfiles`,
      );
    }
  }
  if (relPath === "index.html") {
    throw new HttpError(400, "asset path index.html is reserved for the site HTML — use PUT to replace it");
  }
  return relPath;
}

function requireValidSiteId(id: string): void {
  // Defense in depth: re-validate before the id becomes a storage prefix (SPEC §5).
  if (!isValidSiteId(id)) throw new HttpError(404, `no site ${JSON.stringify(id)}`);
}

/** Live pointer or 404 — tombstoned and never-existed sites are indistinguishable to callers. */
export async function requireLiveSite(id: string): Promise<LivePointer> {
  requireValidSiteId(id);
  const pointer = await getPointer(id);
  if (!pointer || pointer.deleted) throw new HttpError(404, `no site ${JSON.stringify(id)}`);
  return pointer;
}

function checkHtmlSize(html: string): Uint8Array {
  const bytes = new TextEncoder().encode(html);
  if (bytes.length > MAX_HTML_BYTES) {
    throw new HttpError(413, `HTML is ${bytes.length} bytes; the limit is ${MAX_HTML_BYTES} (2 MB)`);
  }
  if (bytes.length === 0) throw new HttpError(400, "html must not be empty");
  return bytes;
}

export interface CreateResult {
  pointer: LivePointer;
  updateKey: string;
}

export async function createSite(input: { html: string; password?: string; crawl?: boolean }): Promise<CreateResult> {
  const htmlBytes = checkHtmlSize(input.html);
  const storage = getStorage();

  // 46-bit ids are memorable, not collision-proof: verify unused (live OR
  // tombstone — "never reused", SPEC §2), regenerate up to 3 candidates.
  let siteId: string | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const candidate = newSiteId();
    if ((await getPointer(candidate)) === null) {
      siteId = candidate;
      break;
    }
  }
  if (!siteId) throw new HttpError(500, "could not allocate an unused site id");

  const generation = newGenerationId();
  const updateKey = newUpdateKey();
  const now = new Date().toISOString();

  // Generation first; pointer last (SPEC §2). A failure between the two
  // leaves unreachable garbage for GC, never a visible site.
  await storage.put(htmlPath(siteId, generation), htmlBytes, { contentType: "text/html; charset=utf-8" });

  const pointer: LivePointer = {
    siteId,
    generation,
    createdAt: now,
    updatedAt: now,
    crawl: input.crawl ?? false,
    passwordHash: input.password ? await hashPassword(input.password) : null,
    updateKeyHash: hashUpdateKey(updateKey),
    assets: [],
    derivedTitle: extractTitle(input.html),
  };
  // The pre-check above is the fast path; this conditional write is the
  // enforcement. It makes "never reused" (SPEC §2) hold atomically on
  // Blob's allowOverwrite: false, closing the gap between the check and
  // this write. A rejection here means another create or a tombstone won
  // the same id in that gap — astronomically rare given the pre-check, so
  // we fail clean rather than loop.
  try {
    await setPointer(pointer, { overwrite: false });
  } catch {
    await collectGeneration(siteId, generation, []);
    throw new HttpError(500, "site id collision — retry create");
  }
  return { pointer, updateKey };
}

/** Best-effort inline GC — failures are harmless; the cron sweep keeps the invariant (SPEC §3). */
async function collectGeneration(siteId: string, generation: string, assets: string[]): Promise<void> {
  try {
    const storage = getStorage();
    const paths = [htmlPath(siteId, generation), ...assets.map((a) => assetStoragePath(siteId, generation, a))];
    await storage.del(paths);
  } catch {
    // swept later
  }
}

export async function replaceHtml(id: string, html: string): Promise<LivePointer> {
  const htmlBytes = checkHtmlSize(html);
  const storage = getStorage();
  const current = await requireLiveSite(id);
  const generation = newGenerationId();

  await storage.put(htmlPath(id, generation), htmlBytes, { contentType: "text/html; charset=utf-8" });
  // Assets carry forward: copy into the new generation so the live prefix
  // stays self-contained (the GC liveness rule covers exactly one prefix).
  for (const asset of current.assets) {
    await storage.copy(assetStoragePath(id, current.generation, asset), assetStoragePath(id, generation, asset));
  }

  const updated: LivePointer = { ...current, generation, derivedTitle: extractTitle(html), updatedAt: new Date().toISOString() };
  await setPointer(updated);
  await collectGeneration(id, current.generation, current.assets);
  return updated;
}

export async function uploadAsset(id: string, relPath: string, bytes: Uint8Array): Promise<LivePointer> {
  validateAssetPath(relPath);
  if (bytes.length > MAX_ASSET_BYTES) {
    throw new HttpError(413, `asset is ${bytes.length} bytes; the limit is ${MAX_ASSET_BYTES} (4 MB)`);
  }
  if (bytes.length === 0) throw new HttpError(400, "asset must not be empty");
  const storage = getStorage();
  const current = await requireLiveSite(id);

  const isReplacement = current.assets.includes(relPath);
  if (!isReplacement && current.assets.length >= MAX_ASSETS_PER_SITE) {
    throw new HttpError(413, `site already has ${MAX_ASSETS_PER_SITE} assets; delete the site or replace an existing asset`);
  }

  // An asset-only change still produces a new generation referencing the
  // unchanged HTML — no in-place writes, no exceptions (SPEC §6).
  const generation = newGenerationId();
  // Content type is server-derived from the extension; the client-supplied
  // type is never echoed (SPEC §4).
  await storage.put(assetStoragePath(id, generation, relPath), bytes, {
    contentType: resolveContentType(relPath).contentType,
  });
  await storage.copy(htmlPath(id, current.generation), htmlPath(id, generation));
  for (const asset of current.assets) {
    if (asset === relPath) continue;
    await storage.copy(assetStoragePath(id, current.generation, asset), assetStoragePath(id, generation, asset));
  }

  const assets = isReplacement ? current.assets : [...current.assets, relPath];
  const updated: LivePointer = { ...current, generation, assets, updatedAt: new Date().toISOString() };
  await setPointer(updated);
  await collectGeneration(id, current.generation, current.assets);
  return updated;
}

export interface PatchInput {
  crawl?: boolean;
  /** undefined = unchanged; null or "" = clear; string = set. */
  password?: string | null;
  /** undefined = unchanged; boolean = set. */
  comments?: boolean;
}

/** Settings changes rewrite only the pointer — one small PUT, never a multi-object saga (SPEC §2). */
export async function patchSettings(id: string, input: PatchInput): Promise<LivePointer> {
  const current = await requireLiveSite(id);
  const updated: LivePointer = { ...current, updatedAt: new Date().toISOString() };
  if (input.crawl !== undefined) updated.crawl = input.crawl;
  if (input.password !== undefined) {
    updated.passwordHash = input.password ? await hashPassword(input.password) : null;
  }
  if (input.comments !== undefined) updated.comments = input.comments;
  await setPointer(updated);
  return updated;
}

/** Portal rename — pointer-only write, like patchSettings. Empty title clears the override. */
export async function renameSite(id: string, title: string): Promise<LivePointer> {
  const current = await requireLiveSite(id);
  const normalized = normalizeTitle(title);
  const updated: LivePointer = { ...current, updatedAt: new Date().toISOString() };
  if (normalized) updated.customTitle = normalized;
  else delete updated.customTitle;
  await setPointer(updated);
  return updated;
}

/**
 * Lazy backfill (spec: exhibit titles): pointers written before derivedTitle
 * existed are healed on every listing, in memory only — never persisted.
 * A persisted heal would be a check-then-write (read pointer, fetch HTML,
 * write pointer) that could race a concurrent tombstone (SPEC §3) or rename
 * and overwrite it. Re-deriving per listing is cheap at this scale, so
 * legacy pointers stay unpersisted and get a durable derivedTitle only via
 * the replace/rename paths, which already write it as part of their own
 * single pointer write.
 */
async function ensureDerivedTitle(pointer: LivePointer): Promise<LivePointer> {
  if (pointer.derivedTitle !== undefined) return pointer;
  try {
    const obj = await getStorage().get(htmlPath(pointer.siteId, pointer.generation));
    if (!obj) return { ...pointer, derivedTitle: null };
    const derivedTitle = extractTitle(await new Response(obj.stream).text());
    return { ...pointer, derivedTitle };
  } catch {
    return { ...pointer, derivedTitle: null };
  }
}

export async function deleteSite(id: string): Promise<void> {
  const current = await requireLiveSite(id);
  // Tombstone first: the site 404s the moment this single write lands (SPEC §3).
  await setPointer({ deleted: true, siteId: id, deletedAt: new Date().toISOString() });
  await collectGeneration(id, current.generation, current.assets);
}

export interface SiteSummary {
  pointer: LivePointer;
}

/** Admin listing only — list() staleness is cosmetic here (SPEC §2). */
export async function listSites(): Promise<LivePointer[]> {
  const storage = getStorage();
  const objects = await storage.list(SITES_PREFIX);
  const ids = new Set<string>();
  for (const obj of objects) {
    const match = /^sites\/([^/]+)\/meta\.json$/.exec(obj.pathname);
    if (match) ids.add(match[1]);
  }
  const pointers: LivePointer[] = [];
  for (const id of ids) {
    const pointer = await getPointer(id);
    if (pointer && !pointer.deleted) pointers.push(await ensureDerivedTitle(pointer));
  }
  return pointers.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export { generationPrefix, type LivePointer, type Pointer };
