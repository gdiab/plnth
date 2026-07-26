import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/**
 * Viewer password hashing: salted async scrypt only. The sync variant is
 * banned by name (SPEC §5) — it blocked the event loop on an unauthenticated
 * endpoint in every eval run; a source-scan test enforces its absence here.
 */

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 32;

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt);
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[4], "base64");
  const expected = Buffer.from(parts[5], "base64");
  const derived = await scryptAsync(password, salt);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/**
 * Viewer cookie value for a password-protected site, bound to the current
 * password hash: clearing or rotating the password invalidates every
 * outstanding cookie (SPEC §4).
 */
export function viewerCookieValue(siteId: string, passwordHash: string, secret: string): string {
  return createHmac("sha256", secret).update(`viewer\0${siteId}\0${passwordHash}`).digest("base64url");
}

export function verifyViewerCookie(value: string, siteId: string, passwordHash: string, secret: string): boolean {
  const expected = viewerCookieValue(siteId, passwordHash, secret);
  const a = Buffer.from(value);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
