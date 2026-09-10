import { cookieSecret } from "./auth";
import { artifactHeaders, injectNoindexMeta, injectFeedbackStrip } from "./headers";
import { isValidSiteId } from "./id";
import { resolveContentType } from "./mime";
import { assetStoragePath, getPointer, htmlPath, type LivePointer } from "./pointer";
import { verifyPassword, verifyViewerCookie, viewerCookieValue } from "./password";
import { clientIp, passwordLimiter } from "./ratelimit";
import { getStorage } from "./storage";
import { apexHost } from "./hosts";

/**
 * Artifact origin serving (SPEC §4). Every response class here — page,
 * assets, gates, errors, robots — goes through artifactHeaders, so the
 * sandbox CSP is structurally unconditional.
 */

const VIEWER_COOKIE = "__Host-plnth_viewer";

function noindexFor(pointer: LivePointer): boolean {
  // Password ⇒ noindex regardless of the crawl toggle (SPEC §4).
  return !pointer.crawl || pointer.passwordHash !== null;
}

function notFound(): Response {
  // Unknown/deleted sites have no crawl state; noindex unconditionally.
  return new Response("not found", {
    status: 404,
    headers: artifactHeaders({ noindex: true, contentType: "text/plain; charset=utf-8", cacheControl: "no-store" }),
  });
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

function hasViewerAccess(request: Request, pointer: LivePointer): boolean {
  if (pointer.passwordHash === null) return true;
  const cookie = readCookie(request, VIEWER_COOKIE);
  if (!cookie) return false;
  return verifyViewerCookie(cookie, pointer.siteId, pointer.passwordHash, cookieSecret());
}

function gatePage(siteId: string, errorMessage: string | null): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Password required</title></head><body style="font-family:system-ui;max-width:24rem;margin:6rem auto;padding:0 1rem">
<h1 style="font-size:1.2rem">This page is password-protected</h1>
${errorMessage ? `<p style="color:#b00">${errorMessage}</p>` : ""}
<form method="post" action="/">
<input type="password" name="password" autofocus required style="width:100%;padding:.5rem">
<button type="submit" style="margin-top:.75rem;padding:.5rem 1rem">View</button>
</form>
</body></html>`;
}

/** Initial gate and failed attempts are both 401, no-store, noindex (SPEC §4). */
function gateResponse(pointer: LivePointer, errorMessage: string | null): Response {
  return new Response(gatePage(pointer.siteId, errorMessage), {
    status: 401,
    headers: artifactHeaders({ noindex: true, contentType: "text/html; charset=utf-8", cacheControl: "no-store" }),
  });
}

function robotsTxt(pointer: LivePointer): Response {
  const allow = pointer.crawl && pointer.passwordHash === null;
  const body = allow ? "User-agent: *\nAllow: /\n" : "User-agent: *\nDisallow: /\n";
  return new Response(body, {
    status: 200,
    headers: artifactHeaders({
      noindex: noindexFor(pointer),
      contentType: "text/plain; charset=utf-8",
      cacheControl: "no-store",
    }),
  });
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function servePage(pointer: LivePointer): Promise<Response> {
  // Generation paths are immutable — no cache-busting needed on the read
  // (SPEC §2); the response is still no-store because the URL is stable
  // while the generation behind it changes on replace.
  const obj = await getStorage().get(htmlPath(pointer.siteId, pointer.generation));
  if (!obj) return notFound();
  const noindex = noindexFor(pointer);
  let html = Buffer.from(await readAll(obj.stream)).toString("utf8");
  if (noindex) html = injectNoindexMeta(html);
  if (pointer.comments === true) html = injectFeedbackStrip(html, pointer.siteId, apexHost());
  return new Response(html, {
    status: 200,
    headers: artifactHeaders({ noindex, contentType: "text/html; charset=utf-8", cacheControl: "no-store" }),
  });
}

async function serveAsset(pointer: LivePointer, relPath: string): Promise<Response> {
  // Readers never list(): only exact manifest entries are fetchable, at
  // exactly the paths the pointer names (SPEC §2). This is also the
  // traversal defense: non-manifest paths don't exist here.
  if (!pointer.assets.includes(relPath)) return notFound();
  const obj = await getStorage().get(assetStoragePath(pointer.siteId, pointer.generation, relPath));
  if (!obj) return notFound();
  const { contentType, attachment } = resolveContentType(relPath);
  return new Response(obj.stream, {
    status: 200,
    headers: artifactHeaders({
      noindex: noindexFor(pointer),
      contentType,
      attachment,
      cacheControl: "no-store",
    }),
  });
}

async function handlePasswordPost(request: Request, pointer: LivePointer): Promise<Response> {
  if (pointer.passwordHash === null) {
    return new Response("method not allowed", {
      status: 405,
      headers: artifactHeaders({ noindex: noindexFor(pointer), contentType: "text/plain; charset=utf-8", cacheControl: "no-store" }),
    });
  }
  const retryAfter = passwordLimiter.hit(`${clientIp(request)}|${pointer.siteId}`);
  if (retryAfter !== null) {
    const headers = artifactHeaders({ noindex: true, contentType: "text/plain; charset=utf-8", cacheControl: "no-store" });
    headers.set("Retry-After", String(retryAfter));
    return new Response("too many attempts — retry later", { status: 429, headers });
  }
  let password: string | null = null;
  try {
    const form = await request.formData();
    const field = form.get("password");
    if (typeof field === "string") password = field;
  } catch {
    // fall through to the failed-gate response
  }
  if (password && (await verifyPassword(password, pointer.passwordHash))) {
    const headers = artifactHeaders({ noindex: true, cacheControl: "no-store" });
    headers.set("Location", "/");
    headers.append(
      "Set-Cookie",
      `${VIEWER_COOKIE}=${viewerCookieValue(pointer.siteId, pointer.passwordHash, cookieSecret())}; HttpOnly; Secure; SameSite=Lax; Path=/`,
    );
    return new Response(null, { status: 303, headers });
  }
  return gateResponse(pointer, "Wrong password — try again.");
}

/** Entry point for all requests on an artifact origin. */
export async function serveArtifact(request: Request, siteId: string, pathSegments: string[]): Promise<Response> {
  if (!isValidSiteId(siteId)) return notFound();
  const pointer = await getPointer(siteId);
  if (!pointer || pointer.deleted) return notFound();

  let relPath: string;
  try {
    // Segments arrive percent-decoded from the router; anything malformed is
    // a 404, never a 500 (SPEC §5).
    relPath = pathSegments.map((s) => decodeURIComponent(s)).join("/");
  } catch {
    return notFound();
  }

  if (request.method === "POST" && (relPath === "" || relPath === "index.html")) {
    return handlePasswordPost(request, pointer);
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("method not allowed", {
      status: 405,
      headers: artifactHeaders({ noindex: noindexFor(pointer), contentType: "text/plain; charset=utf-8", cacheControl: "no-store" }),
    });
  }

  // robots.txt is service-generated per origin (SPEC §4), never an asset.
  if (relPath === "robots.txt") return robotsTxt(pointer);

  // The gate covers the page and every asset alike (SPEC §4).
  if (!hasViewerAccess(request, pointer)) return gateResponse(pointer, null);

  if (relPath === "" || relPath === "index.html") return servePage(pointer);
  return serveAsset(pointer, relPath);
}
