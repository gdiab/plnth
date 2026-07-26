import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { HttpError } from "./errors";

/**
 * Two credentials exist (PRD): the admin token (env var, authorizes
 * everything) and per-site update keys (returned once at creation, stored
 * hashed, authorize one site).
 */

/** Hash-then-compare so equality is timing-safe and length never leaks (SPEC §5). */
function digestEqual(a: string, b: string): boolean {
  const da = createHash("sha256").update(a).digest();
  const db = createHash("sha256").update(b).digest();
  return timingSafeEqual(da, db);
}

export function adminToken(): string {
  const token = process.env.PLNTH_ADMIN_TOKEN;
  if (!token || token.length < 16) {
    throw new HttpError(500, "server is missing PLNTH_ADMIN_TOKEN (min 16 chars)");
  }
  return token;
}

export function verifyAdminToken(supplied: string): boolean {
  return digestEqual(supplied, adminToken());
}

export function newUpdateKey(): string {
  return "puk_" + randomBytes(24).toString("base64url");
}

export function hashUpdateKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function verifyUpdateKey(supplied: string, storedHash: string): boolean {
  return digestEqual(hashUpdateKey(supplied), storedHash);
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : null;
}

/** Secret for HMAC-signed cookies (viewer + portal session), derived from the admin token. */
export function cookieSecret(): string {
  return createHmac("sha256", "plnth-cookie-secret-v1").update(adminToken()).digest("hex");
}

/**
 * Origin validation for every mutating portal/API route (SPEC §1). Browsers
 * always send Origin on cross-origin mutations, so a mismatched Origin is
 * forgery; non-browser clients (curl, Lavish) send none and pass.
 */
export function assertOriginAllowed(request: Request, apexHost: string): void {
  const origin = request.headers.get("origin");
  if (origin === null) return;
  // Sandboxed artifact pages have opaque origins and send the literal string
  // "null" — precisely the caller this check exists to reject.
  if (origin === "null") {
    throw new HttpError(403, "cross-origin requests are not allowed (opaque origin)");
  }
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    throw new HttpError(403, "invalid Origin header");
  }
  if (host !== apexHost) {
    throw new HttpError(403, `cross-origin requests are not allowed (origin ${origin})`);
  }
}

/** Portal session cookie: HMAC-signed expiry, no server-side state. */
export function newSessionValue(secret: string, ttlMs = 1000 * 60 * 60 * 24 * 7): string {
  const expires = Date.now() + ttlMs;
  const sig = createHmac("sha256", secret).update(`session\0${expires}`).digest("base64url");
  return `${expires}.${sig}`;
}

export function verifySessionValue(value: string, secret: string): boolean {
  const dot = value.indexOf(".");
  if (dot === -1) return false;
  const expires = Number(value.slice(0, dot));
  if (!Number.isFinite(expires) || expires < Date.now()) return false;
  const expectedSig = createHmac("sha256", secret).update(`session\0${expires}`).digest("base64url");
  const a = Buffer.from(value.slice(dot + 1));
  const b = Buffer.from(expectedSig);
  return a.length === b.length && timingSafeEqual(a, b);
}
