import { bearerToken, verifyAdminToken, verifyUpdateKey, assertOriginAllowed } from "./auth";
import { HttpError } from "./errors";
import { apexHost, siteUrl } from "./hosts";
import { requireLiveSite } from "./sites";
import { clientIp, credentialLimiter } from "./ratelimit";
import type { LivePointer } from "./pointer";
import { displayTitle } from "./title";

/** The one shape every endpoint returns for a site — derived fields only, never hashes. */
export function siteJson(pointer: LivePointer): Record<string, unknown> {
  return {
    site_id: pointer.siteId,
    title: displayTitle(pointer),
    url: siteUrl(pointer.siteId),
    created: pointer.createdAt,
    updated: pointer.updatedAt,
    crawl: pointer.crawl,
    has_password: pointer.passwordHash !== null,
    comments: pointer.comments ?? false,
    assets: pointer.assets,
  };
}

function credentialFailure(request: Request, detail: string): HttpError {
  const retryAfter = credentialLimiter.hit(clientIp(request));
  if (retryAfter !== null) {
    const err = new HttpError(429, "too many failed credentials — retry later");
    (err as HttpError & { retryAfter?: number }).retryAfter = retryAfter;
    return err;
  }
  return new HttpError(401, detail);
}

/** Admin-only endpoints (create, list). */
export function requireAdmin(request: Request): void {
  const token = bearerToken(request);
  if (!token) throw credentialFailure(request, "missing bearer token — send Authorization: Bearer <admin token>");
  if (!verifyAdminToken(token)) throw credentialFailure(request, "invalid token");
}

/** Admin-or-update_key endpoints. Reads the pointer (404 first — site ids are public as subdomains). */
export async function requireSiteAccess(request: Request, id: string): Promise<LivePointer> {
  const token = bearerToken(request);
  if (!token) throw credentialFailure(request, "missing bearer token — send the admin token or this site's update_key");
  const pointer = await requireLiveSite(id);
  if (verifyAdminToken(token) || verifyUpdateKey(token, pointer.updateKeyHash)) return pointer;
  throw credentialFailure(request, "invalid token — expected the admin token or this site's update_key");
}

/** Every mutating route validates Origin against the apex (SPEC §1). */
export function requireOriginAllowed(request: Request): void {
  assertOriginAllowed(request, apexHost());
}

/**
 * Strict body validation (SPEC §5): unknown fields and wrong types → 400,
 * never silently ignored.
 */
export async function readStrictJson<T extends Record<string, "string" | "boolean" | "string-or-null">>(
  request: Request,
  spec: T,
  required: (keyof T)[] = [],
): Promise<Record<string, unknown>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new HttpError(400, "request body must be JSON");
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new HttpError(400, "request body must be a JSON object");
  }
  const body = raw as Record<string, unknown>;
  for (const key of Object.keys(body)) {
    if (!(key in spec)) {
      throw new HttpError(400, `unknown field ${JSON.stringify(key)} — allowed: ${Object.keys(spec).join(", ")}`);
    }
    const kind = spec[key];
    const value = body[key];
    const ok =
      kind === "string"
        ? typeof value === "string"
        : kind === "boolean"
          ? typeof value === "boolean"
          : typeof value === "string" || value === null;
    if (!ok) {
      throw new HttpError(400, `field ${JSON.stringify(key)} must be ${kind === "string-or-null" ? "a string or null" : `a ${kind}`}`);
    }
  }
  for (const key of required) {
    if (!(String(key) in body)) throw new HttpError(400, `missing required field ${JSON.stringify(String(key))}`);
  }
  return body;
}

export function jsonResponse(data: unknown, status = 200): Response {
  const response = Response.json(data, { status });
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Robots-Tag", "noindex");
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export function apiError(err: unknown): Response {
  if (err instanceof HttpError) {
    const response = jsonResponse({ detail: err.detail }, err.status);
    const retryAfter = (err as HttpError & { retryAfter?: number }).retryAfter;
    if (retryAfter !== undefined) response.headers.set("Retry-After", String(retryAfter));
    return response;
  }
  console.error(err);
  return jsonResponse({ detail: "internal server error" }, 500);
}
