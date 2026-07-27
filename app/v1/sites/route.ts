import { apiError, jsonResponse, readStrictJson, requireAdmin, requireOriginAllowed, siteJson } from "@/lib/api";
import { HttpError } from "@/lib/errors";
import { siteUrl } from "@/lib/hosts";
import { createSite, listSites } from "@/lib/sites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /v1/sites — create from {html, password?} (admin only). */
export async function POST(request: Request): Promise<Response> {
  try {
    requireOriginAllowed(request);
    requireAdmin(request);
    // `html_content` is the field the real Lavish client sends (ht-ml.app
    // wire compatibility, PRD acceptance #9); `html` is ours. Exactly one.
    const body = await readStrictJson(request, { html: "string", html_content: "string", password: "string" });
    const html = (body.html ?? body.html_content) as string | undefined;
    if (html === undefined) throw new HttpError(400, 'missing required field "html" (or Lavish-style "html_content")');
    if (body.html !== undefined && body.html_content !== undefined) {
      throw new HttpError(400, "send either html or html_content, not both");
    }
    const { pointer, updateKey } = await createSite({
      html,
      password: body.password as string | undefined,
    });
    return jsonResponse(
      {
        url: siteUrl(pointer.siteId),
        site_id: pointer.siteId,
        update_key: updateKey,
        status: "created",
      },
      201,
    );
  } catch (err) {
    return apiError(err);
  }
}

/** GET /v1/sites — list (admin only). */
export async function GET(request: Request): Promise<Response> {
  try {
    requireAdmin(request);
    const sites = await listSites();
    return jsonResponse({ sites: sites.map(siteJson) });
  } catch (err) {
    return apiError(err);
  }
}
