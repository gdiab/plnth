import { randomBytes } from "node:crypto";

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

/**
 * Site id: pure randomness, 16 chars (80 bits) — server-generated, never
 * client-chosen, never reused (SPEC §2). Must be a valid DNS label: starts
 * with a letter to be safe across resolvers.
 */
export function newSiteId(): string {
  // First char from the letter subset so the label never starts with a digit.
  const letters = "abcdefghjkmnpqrstvwxyz";
  return letters[randomBytes(1)[0] % letters.length] + encodeRandom(15);
}

export { isValidGenerationId, isValidSiteId } from "./id-validate";
