import { cookieSecret, newSessionValue, verifySessionValue } from "./auth";
import { HttpError } from "./errors";

export const PORTAL_COOKIE = "__Host-plnth_portal";

export function portalSessionCookie(): string {
  return `${PORTAL_COOKIE}=${newSessionValue(cookieSecret())}; HttpOnly; Secure; SameSite=Lax; Path=/`;
}

export function portalClearCookie(): string {
  return `${PORTAL_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export function hasPortalSession(cookieHeader: string | null): boolean {
  if (!cookieHeader) return false;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === PORTAL_COOKIE) {
      return verifySessionValue(part.slice(eq + 1).trim(), cookieSecret());
    }
  }
  return false;
}

export function requirePortalSession(request: Request): void {
  if (!hasPortalSession(request.headers.get("cookie"))) {
    throw new HttpError(401, "portal session required — log in at /portal");
  }
}
