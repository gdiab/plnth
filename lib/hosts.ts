import { isValidSiteId } from "./id-validate";

/**
 * Hard host-based routing (SPEC §1): portal/API answer only on the apex,
 * artifacts only on wildcard subdomains, any unrecognized Host → 404 —
 * including *.vercel.app deployment URLs.
 */

export type HostResolution = { kind: "apex" } | { kind: "artifact"; siteId: string } | { kind: "unknown" };

export function apexHost(): string {
  return (process.env.PLNTH_APEX_HOST ?? "plnth.app").toLowerCase();
}

export function resolveHost(hostHeader: string | null, apex: string): HostResolution {
  if (!hostHeader) return { kind: "unknown" };
  const host = hostHeader.trim().toLowerCase();
  if (host === apex) return { kind: "apex" };
  if (host.endsWith("." + apex)) {
    const label = host.slice(0, host.length - apex.length - 1);
    if (isValidSiteId(label)) return { kind: "artifact", siteId: label };
  }
  return { kind: "unknown" };
}

/** Host part of a site's public URL — siteUrl minus the scheme. */
export function siteHost(siteId: string): string {
  return `${siteId}.${apexHost()}`;
}

/** Public URL for a site (SPEC §6: url is the subdomain form). */
export function siteUrl(siteId: string): string {
  const apex = apexHost();
  const scheme = apex.startsWith("localhost") || apex.startsWith("127.0.0.1") ? "http" : "https";
  return `${scheme}://${siteHost(siteId)}`;
}
