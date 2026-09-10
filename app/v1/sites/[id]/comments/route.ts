import { HttpError } from "@/lib/errors";
import { canReceiveComments, createComment, MAX_COMMENT_BODY_LENGTH, MAX_COMMENT_NAME_LENGTH } from "@/lib/comments";
import { clientIp, RateLimiter } from "@/lib/ratelimit";
import { jsonResponse, apiError } from "@/lib/api";
import { apexHost } from "@/lib/hosts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Comment submission rate limiter: 10 per hour per IP (stricter than password/creds). */
const commentLimiter = new RateLimiter(10, 60 * 60 * 1000);

/**
 * POST /v1/sites/:id/comments — public, no auth.
 * Accepts JSON { name?: string, body: string } or form data.
 * Rejects if site missing/tombstoned or comments disabled.
 * Rate-limited by IP.
 */
export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  try {
    const { id } = await ctx.params;

    // Verify the site exists and has comments enabled
    const allowed = await canReceiveComments(id);
    if (!allowed) {
      throw new HttpError(403, "comments are not enabled for this site");
    }

    // Rate limit
    const ip = clientIp(request);
    const retryAfter = commentLimiter.hit(ip);
    if (retryAfter !== null) {
      const err = new HttpError(429, "too many comments — retry later");
      (err as HttpError & { retryAfter?: number }).retryAfter = retryAfter;
      throw err;
    }

    // Parse body (JSON or form data)
    const contentType = request.headers.get("content-type") || "";
    let name: string | undefined;
    let bodyText: string;

    if (contentType.includes("application/json")) {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        throw new HttpError(400, "request body must be JSON");
      }
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new HttpError(400, "request body must be a JSON object");
      }

      const data = body as Record<string, unknown>;

      // Validate fields
      if (!("body" in data) || typeof data.body !== "string") {
        throw new HttpError(400, "missing required field 'body' (must be a string)");
      }
      bodyText = data.body;

      if ("name" in data) {
        if (typeof data.name !== "string") {
          throw new HttpError(400, "field 'name' must be a string");
        }
        name = data.name || undefined;
      }

      // Only allow known fields
      for (const key of Object.keys(data)) {
        if (key !== "name" && key !== "body") {
          throw new HttpError(400, `unknown field ${JSON.stringify(key)} — allowed: name, body`);
        }
      }
    } else if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const bodyField = formData.get("body");
      if (!bodyField || typeof bodyField !== "string") {
        throw new HttpError(400, "missing required field 'body'");
      }
      bodyText = bodyField;

      const nameField = formData.get("name");
      if (nameField && typeof nameField === "string") {
        name = nameField || undefined;
      }
    } else {
      throw new HttpError(400, "content-type must be application/json or form data");
    }

    // Validate lengths
    if (bodyText.length === 0) {
      throw new HttpError(400, "comment body must not be empty");
    }
    if (bodyText.length > MAX_COMMENT_BODY_LENGTH) {
      throw new HttpError(413, `comment body is too long (max ${MAX_COMMENT_BODY_LENGTH} characters)`);
    }
    if (name && name.length > MAX_COMMENT_NAME_LENGTH) {
      throw new HttpError(413, `name is too long (max ${MAX_COMMENT_NAME_LENGTH} characters)`);
    }

    // Store the comment
    const userAgent = request.headers.get("user-agent") ?? undefined;
    const comment = await createComment({
      siteId: id,
      name,
      body: bodyText,
      ip,
      userAgent,
    });

    // For form submissions, redirect to thank-you page
    if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
      const headers = new Headers();
      headers.set("Location", `https://${apexHost()}/comment-thanks`);
      headers.set("Cache-Control", "no-store");
      return new Response(null, { status: 303, headers });
    }

    // For JSON, return success response with CORS headers
    const response = jsonResponse({ success: true, comment_id: comment.commentId }, 201);
    const origin = request.headers.get("origin");
    if (origin) {
      response.headers.set("Access-Control-Allow-Origin", origin);
    }
    return response;
  } catch (err) {
    return apiError(err);
  }
}

/**
 * OPTIONS handler for CORS preflight (needed for fetch from sandboxed artifacts).
 * Allow POST from any origin since this is a public endpoint.
 */
export async function OPTIONS(request: Request, ctx: Ctx): Promise<Response> {
  const origin = request.headers.get("origin");
  const headers = new Headers({
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  });
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return new Response(null, { status: 204, headers });
}
