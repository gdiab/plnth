import { apiError, jsonResponse, readStrictJson, requireAdmin, requireOriginAllowed, siteJson } from "@/lib/api";
import { siteUrl } from "@/lib/hosts";
import { createSite, listSites } from "@/lib/sites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /v1/sites — create from {html, password?} (admin only). */
export async function POST(request: Request): Promise<Response> {
  try {
    requireOriginAllowed(request);
    requireAdmin(request);
    const body = await readStrictJson(request, { html: "string", password: "string" }, ["html"]);
    const { pointer, updateKey } = await createSite({
      html: body.html as string,
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
