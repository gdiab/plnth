import { NextResponse, type NextRequest } from "next/server";
import { apexHost, resolveHost } from "./lib/hosts";

/**
 * Host-based routing (SPEC §1). Artifact hosts are rewritten to the internal
 * /_artifact/<id>/... route; the apex serves portal + API; everything else —
 * including *.vercel.app deployment URLs — is 404.
 */
export function middleware(request: NextRequest): NextResponse {
  const resolution = resolveHost(request.headers.get("host"), apexHost());
  const { pathname } = request.nextUrl;

  // Vercel Cron invokes the deployment URL (a *.vercel.app host), so the GC
  // endpoint alone passes the host wall; its route enforces CRON_SECRET.
  if (pathname === "/api/gc") {
    return NextResponse.next();
  }

  if (resolution.kind === "unknown") {
    return new NextResponse("not found", {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "X-Robots-Tag": "noindex",
        "Cache-Control": "no-store",
      },
    }) as NextResponse;
  }

  if (resolution.kind === "artifact") {
    const url = request.nextUrl.clone();
    url.pathname = `/artifact/${resolution.siteId}${pathname === "/" ? "" : pathname}`;
    return NextResponse.rewrite(url);
  }

  // Apex: the internal artifact route must not be reachable by path.
  if (pathname.startsWith("/artifact")) {
    return new NextResponse("not found", {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "X-Robots-Tag": "noindex",
        "Cache-Control": "no-store",
      },
    }) as NextResponse;
  }

  return NextResponse.next();
}

export const config = {
  // Everything except Next internals and static chunks; artifact hosts need
  // every path, and the apex needs API + portal + landing.
  matcher: ["/((?!_next/).*)"],
};
