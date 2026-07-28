import { randomBytes } from "node:crypto";
import { ADJECTIVES, NOUNS } from "./words";

// Crockford base32, lowercased — DNS-safe (site ids become subdomain labels)
// and unambiguous (no i/l/o/u).
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

function encodeTime(ms: number, chars: number): string {
  let out = "";
  for (let i = 0; i < chars; i++) {
    out = ALPHABET[ms % 32] + out;
    ms = Math.floor(ms / 32);
  }
  return out;
}

function encodeRandom(chars: number): string {
  const bytes = randomBytes(chars);
  let out = "";
  for (let i = 0; i < chars; i++) out += ALPHABET[bytes[i] % 32];
  return out;
}

/**
 * ULID-style: 10 chars of timestamp + 16 of randomness (80 bits), lowercase.
 * Used for generation ids; time prefix makes generations sort chronologically.
 */
export function newGenerationId(): string {
  return encodeTime(Date.now(), 10) + encodeRandom(16);
}

/** Lists are exactly 256 long, so one random byte indexes without modulo bias. */
function pickWord(list: readonly string[]): string {
  return list[randomBytes(1)[0] % list.length];
}

/**
 * Site id: `word-word-suffix`, e.g. amber-fox-3kj9w7 — memorable but
 * content-neutral (≈46 bits). Server-generated, never client-chosen, never
 * reused (SPEC §2); create additionally checks for collisions since 46 bits
 * is guessable-adjacent but not collision-proof forever. Valid DNS label:
 * starts with a letter, ≤63 chars. Legacy pure-random 16-char ids remain
 * valid via id-validate.
 */
export function newSiteId(): string {
  return `${pickWord(ADJECTIVES)}-${pickWord(NOUNS)}-${encodeRandom(6)}`;
}

export { isValidGenerationId, isValidSiteId } from "./id-validate";
