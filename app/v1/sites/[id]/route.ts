import { apiError, jsonResponse, readStrictJson, requireOriginAllowed, requireSiteAccess, siteJson } from "@/lib/api";
import { deleteSite, patchSettings, replaceHtml } from "@/lib/sites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET /v1/sites/:id — metadata (admin or update_key). */
export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const pointer = await requireSiteAccess(request, id);
    return jsonResponse({ site: siteJson(pointer) });
  } catch (err) {
    return apiError(err);
  }
}

/** PUT /v1/sites/:id — replace HTML, new generation (admin or update_key). */
export async function PUT(request: Request, ctx: Ctx): Promise<Response> {
  try {
    requireOriginAllowed(request);
    const { id } = await ctx.params;
    await requireSiteAccess(request, id);
    const body = await readStrictJson(request, { html: "string" }, ["html"]);
    const pointer = await replaceHtml(id, body.html as string);
    return jsonResponse({ site: siteJson(pointer) });
  } catch (err) {
    return apiError(err);
  }
}

/** PATCH /v1/sites/:id — settings {crawl?, password?}; pointer-only write. */
export async function PATCH(request: Request, ctx: Ctx): Promise<Response> {
  try {
    requireOriginAllowed(request);
    const { id } = await ctx.params;
    await requireSiteAccess(request, id);
    const body = await readStrictJson(request, { crawl: "boolean", password: "string-or-null" });
    const pointer = await patchSettings(id, {
      crawl: body.crawl as boolean | undefined,
      password: "password" in body ? (body.password as string | null) : undefined,
    });
    return jsonResponse({ site: siteJson(pointer) });
  } catch (err) {
    return apiError(err);
  }
}

/** DELETE /v1/sites/:id — tombstone + GC; the URL 404s immediately. */
export async function DELETE(request: Request, ctx: Ctx): Promise<Response> {
  try {
    requireOriginAllowed(request);
    const { id } = await ctx.params;
    await requireSiteAccess(request, id);
    await deleteSite(id);
    return jsonResponse({ site_id: id, deleted: true });
  } catch (err) {
    return apiError(err);
  }
}
