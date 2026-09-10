import { randomBytes, createHash } from "node:crypto";
import { newGenerationId } from "./id";
import { getStorage } from "./storage";
import { commentPath, commentsPrefix, getPointer, type LivePointer } from "./pointer";

/**
 * Comments for review shares — stored as append-only blobs at
 * sites/<id>/comments/<ulid>.json. One object per comment, no in-pointer
 * storage (pointer is last-writer-wins; concurrent submits would drop
 * comments). Includes minimal PII for abuse handling.
 */

export interface Comment {
  commentId: string;
  siteId: string;
  createdAt: string;
  name?: string;
  body: string;
  /** Hashed IP for abuse tracking, not the raw IP. */
  ipHash?: string;
  userAgent?: string;
}

export const MAX_COMMENT_BODY_LENGTH = 10_000;
export const MAX_COMMENT_NAME_LENGTH = 200;

/** Generate a comment id using the same ULID format as generations. */
export function newCommentId(): string {
  return newGenerationId();
}

function hashIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

export interface CreateCommentInput {
  siteId: string;
  name?: string;
  body: string;
  ip: string;
  userAgent?: string;
}

/** Store a new comment. Returns the comment object. */
export async function createComment(input: CreateCommentInput): Promise<Comment> {
  const commentId = newCommentId();
  const comment: Comment = {
    commentId,
    siteId: input.siteId,
    createdAt: new Date().toISOString(),
    body: input.body,
    ipHash: hashIp(input.ip),
  };
  if (input.name) comment.name = input.name;
  if (input.userAgent) comment.userAgent = input.userAgent;

  const storage = getStorage();
  await storage.put(commentPath(input.siteId, commentId), JSON.stringify(comment), {
    contentType: "application/json",
    overwrite: false,
  });

  return comment;
}

/** List all comments for a site (admin only, for portal display). */
export async function listComments(siteId: string): Promise<Comment[]> {
  const storage = getStorage();
  const objects = await storage.list(commentsPrefix(siteId));
  const comments: Comment[] = [];

  for (const obj of objects) {
    try {
      const result = await storage.get(obj.pathname);
      if (!result) continue;
      const chunks: Uint8Array[] = [];
      const reader = result.stream.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      comments.push(json as Comment);
    } catch {
      // Skip malformed comments
      continue;
    }
  }

  // Sort newest first
  return comments.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** Check if a site has comments enabled and is not deleted/missing. */
export async function canReceiveComments(siteId: string): Promise<boolean> {
  const pointer = await getPointer(siteId);
  if (!pointer || pointer.deleted) return false;
  return pointer.comments === true;
}
