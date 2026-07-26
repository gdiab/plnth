import { SITES_PREFIX, deletePointer, getPointer } from "./pointer";
import { getStorage } from "./storage";

/**
 * Daily sweep — the invariant-keeper (SPEC §3). Liveness rule: a blob under
 * sites/<id>/g/<gen>/ is live iff site <id> has a non-tombstoned pointer
 * naming <gen>. Everything else is garbage once it clears the grace window.
 *
 * Safety rules:
 * - never collect anything younger than the 24h grace window;
 * - re-read the pointer after listing, before deleting (TOCTOU guard);
 * - list() staleness can only delay collection, never delete something live,
 *   because deletion decisions come from the fresh pointer read.
 */

export const GRACE_MS = 24 * 60 * 60 * 1000;

export interface SweepResult {
  scannedSites: number;
  deletedObjects: string[];
  collectedTombstones: string[];
}

const CONTENT_RE = /^sites\/([^/]+)\/g\/([^/]+)\//;
const POINTER_RE = /^sites\/([^/]+)\/meta\.json$/;

export async function sweep(now = Date.now()): Promise<SweepResult> {
  const storage = getStorage();
  const objects = await storage.list(SITES_PREFIX);

  const siteIds = new Set<string>();
  for (const obj of objects) {
    const content = CONTENT_RE.exec(obj.pathname);
    if (content) siteIds.add(content[1]);
    const pointer = POINTER_RE.exec(obj.pathname);
    if (pointer) siteIds.add(pointer[1]);
  }

  const deletedObjects: string[] = [];
  const collectedTombstones: string[] = [];

  for (const siteId of siteIds) {
    // TOCTOU guard: the pointer is re-read fresh after listing; the listing
    // only tells us where to look, never what is safe to delete.
    const pointer = await getPointer(siteId);
    const liveGeneration = pointer && !pointer.deleted ? pointer.generation : null;

    const toDelete: string[] = [];
    for (const obj of objects) {
      const match = CONTENT_RE.exec(obj.pathname);
      if (!match || match[1] !== siteId) continue;
      const generation = match[2];
      if (generation === liveGeneration) continue;
      if (now - obj.uploadedAt.getTime() < GRACE_MS) continue;
      toDelete.push(obj.pathname);
    }
    if (toDelete.length > 0) {
      await storage.del(toDelete);
      deletedObjects.push(...toDelete);
    }

    // Ids are never reused, so a tombstone only needs to outlive in-flight
    // writes; collect it after the grace window. End state: zero objects.
    if (pointer && pointer.deleted && now - new Date(pointer.deletedAt).getTime() >= GRACE_MS) {
      const remaining = objects.filter((obj) => {
        const match = CONTENT_RE.exec(obj.pathname);
        return match !== null && match[1] === siteId && !toDelete.includes(obj.pathname);
      });
      if (remaining.length === 0) {
        await deletePointer(siteId);
        collectedTombstones.push(siteId);
      }
    }
  }

  return { scannedSites: siteIds.size, deletedObjects, collectedTombstones };
}
