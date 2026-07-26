import { createHash, timingSafeEqual } from "node:crypto";
import { bearerToken, verifyAdminToken } from "@/lib/auth";
import { errorResponse } from "@/lib/errors";
import { sweep } from "@/lib/gc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function secureEqual(a: string, b: string): boolean {
  const da = createHash("sha256").update(a).digest();
  const db = createHash("sha256").update(b).digest();
  return timingSafeEqual(da, db);
}

/**
 * GET /api/gc — the daily sweep (SPEC §3). Invoked by Vercel Cron (which
 * sends Authorization: Bearer $CRON_SECRET); the admin token also works for
 * manual runs.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const token = bearerToken(request);
    const cronSecret = process.env.CRON_SECRET;
    const authorized =
      (token !== null && cronSecret !== undefined && cronSecret.length >= 16 && secureEqual(token, cronSecret)) ||
      (token !== null && verifyAdminToken(token));
    if (!authorized) {
      return Response.json({ detail: "unauthorized" }, { status: 401 });
    }
    const result = await sweep();
    return Response.json(result, { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
  } catch (err) {
    return errorResponse(err);
  }
}
