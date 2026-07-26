import { apiError, jsonResponse, requireOriginAllowed, requireSiteAccess, siteJson } from "@/lib/api";
import { HttpError } from "@/lib/errors";
import { MAX_ASSET_BYTES, uploadAsset } from "@/lib/sites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /v1/sites/:id/assets — multipart upload (admin or update_key).
 * Fields: `file` (required); `path` (optional, defaults to the file name).
 */
export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  try {
    requireOriginAllowed(request);
    const { id } = await ctx.params;
    await requireSiteAccess(request, id);

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new HttpError(400, "expected a multipart/form-data body with a `file` field");
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new HttpError(400, "missing `file` field in multipart body");
    }
    const pathField = form.get("path");
    if (pathField !== null && typeof pathField !== "string") {
      throw new HttpError(400, "`path` must be a plain field");
    }
    for (const key of form.keys()) {
      if (key !== "file" && key !== "path") {
        throw new HttpError(400, `unknown field ${JSON.stringify(key)} — allowed: file, path`);
      }
    }
    if (file.size > MAX_ASSET_BYTES) {
      throw new HttpError(413, `asset is ${file.size} bytes; the limit is ${MAX_ASSET_BYTES} (4 MB)`);
    }

    const relPath = pathField && pathField.length > 0 ? pathField : file.name;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pointer = await uploadAsset(id, relPath, bytes);
    return jsonResponse({ site: siteJson(pointer), asset: relPath }, 201);
  } catch (err) {
    return apiError(err);
  }
}
