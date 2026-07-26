import { serveArtifact } from "@/lib/artifact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; path?: string[] }> };

async function handle(request: Request, ctx: Ctx): Promise<Response> {
  const { id, path } = await ctx.params;
  return serveArtifact(request, id, path ?? []);
}

export { handle as GET, handle as HEAD, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
