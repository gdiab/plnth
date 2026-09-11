import { requireOriginAllowed } from "@/lib/api";
import { errorResponse, HttpError } from "@/lib/errors";
import { requirePortalSession, portalClearCookie } from "@/lib/portal";
import { deleteSite, patchSettings, renameSite, replaceHtml } from "@/lib/sites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function redirectBack(extra?: Record<string, string>): Response {
  return new Response(null, {
    status: 303,
    headers: { Location: "/portal", "Cache-Control": "no-store", ...extra },
  });
}

/**
 * POST /portal/actions — form-posted portal operations (SPEC §7).
 * Auth: __Host- session cookie + Origin validation (SPEC §1).
 */
export async function POST(request: Request): Promise<Response> {
  try {
    requireOriginAllowed(request);

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new HttpError(400, "expected a form body");
    }
    const action = form.get("action");

    if (action === "logout") {
      return redirectBack({ "Set-Cookie": portalClearCookie() });
    }

    requirePortalSession(request);

    const siteId = form.get("site_id");
    if (typeof siteId !== "string") throw new HttpError(400, "missing site_id");

    switch (action) {
      case "replace": {
        const file = form.get("file");
        const pasted = form.get("html");
        let html: string | null = null;
        if (file instanceof File && file.size > 0) html = await file.text();
        else if (typeof pasted === "string" && pasted.length > 0) html = pasted;
        if (!html) throw new HttpError(400, "provide replacement HTML (paste or file)");
        await replaceHtml(siteId, html);
        return redirectBack();
      }
      case "crawl": {
        await patchSettings(siteId, { crawl: form.get("crawl") === "on" });
        return redirectBack();
      }
      case "comments": {
        await patchSettings(siteId, { comments: form.get("comments") === "on" });
        return redirectBack();
      }
      case "password": {
        const password = form.get("password");
        await patchSettings(siteId, { password: typeof password === "string" && password.length > 0 ? password : null });
        return redirectBack();
      }
      case "delete": {
        if (form.get("confirm") !== "yes") {
          throw new HttpError(400, "delete requires confirmation");
        }
        await deleteSite(siteId);
        return redirectBack();
      }
      case "rename": {
        const title = form.get("title");
        await renameSite(siteId, typeof title === "string" ? title : "");
        return redirectBack();
      }
      default:
        throw new HttpError(400, `unknown action ${JSON.stringify(String(action))}`);
    }
  } catch (err) {
    return errorResponse(err);
  }
}
