import { HttpError } from "@/lib/errors";
import { canReceiveComments, createComment, MAX_COMMENT_BODY_LENGTH, MAX_COMMENT_NAME_LENGTH, MAX_TARGETING_EXCERPT_LENGTH, MAX_TARGETING_SELECTED_TEXT_LENGTH, type CommentTargeting } from "@/lib/comments";
import { clientIp, RateLimiter } from "@/lib/ratelimit";
import { jsonResponse, apiError } from "@/lib/api";
import { apexUrl } from "@/lib/hosts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Comment submission rate limiter: 60 per hour per IP (stricter than password/creds). */
const commentLimiter = new RateLimiter(60, 60 * 60 * 1000);

/**
 * POST /v1/sites/:id/comments — public, no auth.
 * Accepts JSON { name?: string, body: string } or form data.
 * Rejects if site missing/tombstoned or comments disabled.
 * Rate-limited by IP.
 */
export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const origin = request.headers.get("origin");
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
    let targeting: CommentTargeting | undefined;

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

      // Parse targeting info for annotations
      if ("targeting" in data) {
        const t = data.targeting;
        if (typeof t !== "object" || t === null || Array.isArray(t)) {
          throw new HttpError(400, "field 'targeting' must be an object");
        }
        const tObj = t as Record<string, unknown>;
        if (typeof tObj.kind !== "string" || (tObj.kind !== "element" && tObj.kind !== "text")) {
          throw new HttpError(400, "targeting.kind must be 'element' or 'text'");
        }
        if (typeof tObj.selector !== "string" || tObj.selector.length === 0) {
          throw new HttpError(400, "targeting.selector is required and must be a non-empty string");
        }
        targeting = {
          kind: tObj.kind,
          selector: tObj.selector,
        };
        if (tObj.kind === "text") {
          if ("selectedText" in tObj && typeof tObj.selectedText === "string") {
            if (tObj.selectedText.length > MAX_TARGETING_SELECTED_TEXT_LENGTH) {
              throw new HttpError(413, `targeting.selectedText is too long (max ${MAX_TARGETING_SELECTED_TEXT_LENGTH} characters)`);
            }
            targeting.selectedText = tObj.selectedText;
          }
          if ("startOffset" in tObj && typeof tObj.startOffset === "number") {
            targeting.startOffset = tObj.startOffset;
          }
          if ("endOffset" in tObj && typeof tObj.endOffset === "number") {
            targeting.endOffset = tObj.endOffset;
          }
        }
        if ("excerpt" in tObj) {
          if (typeof tObj.excerpt !== "string") {
            throw new HttpError(400, "targeting.excerpt must be a string");
          }
          if (tObj.excerpt.length > MAX_TARGETING_EXCERPT_LENGTH) {
            throw new HttpError(413, `targeting.excerpt is too long (max ${MAX_TARGETING_EXCERPT_LENGTH} characters)`);
          }
          targeting.excerpt = tObj.excerpt;
        }
      }

      // Only allow known fields
      for (const key of Object.keys(data)) {
        if (key !== "name" && key !== "body" && key !== "targeting") {
          throw new HttpError(400, `unknown field ${JSON.stringify(key)} — allowed: name, body, targeting`);
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
      targeting,
      ip,
      userAgent,
    });

    // For form submissions, redirect to thank-you page
    if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
      const headers = new Headers();
      headers.set("Location", apexUrl("/comment-thanks"));
      headers.set("Cache-Control", "no-store");
      return new Response(null, { status: 303, headers });
    }

    // For JSON, return success response with CORS headers
    const response = jsonResponse({ success: true, comment_id: comment.commentId }, 201);
    if (origin) {
      response.headers.set("Access-Control-Allow-Origin", origin);
    }
    return response;
  } catch (err) {
    return apiError(err, origin);
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
