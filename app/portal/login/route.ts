import { requireOriginAllowed } from "@/lib/api";
import { verifyAdminToken } from "@/lib/auth";
import { errorResponse, HttpError } from "@/lib/errors";
import { portalSessionCookie } from "@/lib/portal";
import { clientIp, credentialLimiter } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /portal/login — admin token form → __Host- session cookie (SPEC §7). */
export async function POST(request: Request): Promise<Response> {
  try {
    requireOriginAllowed(request);
    let token = "";
    try {
      const form = await request.formData();
      const field = form.get("token");
      if (typeof field === "string") token = field;
    } catch {
      throw new HttpError(400, "expected a form body with a token field");
    }
    if (!token || !verifyAdminToken(token)) {
      const retryAfter = credentialLimiter.hit(clientIp(request));
      if (retryAfter !== null) {
        return new Response("too many failed logins — retry later", {
          status: 429,
          headers: { "Retry-After": String(retryAfter), "X-Robots-Tag": "noindex", "Cache-Control": "no-store" },
        });
      }
      // Redirect back with an error flag; the login page renders the message.
      return new Response(null, {
        status: 303,
        headers: { Location: "/portal?error=1", "Cache-Control": "no-store" },
      });
    }
    return new Response(null, {
      status: 303,
      headers: {
        Location: "/portal",
        "Set-Cookie": portalSessionCookie(),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
