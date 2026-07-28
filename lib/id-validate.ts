/**
 * Id validators — edge-safe (imported by middleware): no node built-ins.
 * Route params are re-validated before becoming storage prefixes even though
 * ids are server-generated — defense in depth (SPEC §5).
 */

const LEGACY_SITE_ID_RE = /^[a-z][0-9a-z]{5,31}$/;
const WORDY_SITE_ID_RE = /^[a-z]{3,12}-[a-z]{3,12}-[0-9a-z]{6}$/;
const GENERATION_ID_RE = /^[0-9a-z]{10,32}$/;

export function isValidSiteId(id: string): boolean {
  return LEGACY_SITE_ID_RE.test(id) || WORDY_SITE_ID_RE.test(id);
}

export function isValidGenerationId(gen: string): boolean {
  return GENERATION_ID_RE.test(gen);
}
