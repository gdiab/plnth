/**
 * Error envelope is `{detail}` with conventional status codes (PRD). The
 * Lavish client surfaces `detail` verbatim, so messages must be
 * human-readable and actionable.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(detail);
  }
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return Response.json({ detail: err.detail }, { status: err.status });
  }
  console.error(err);
  return Response.json({ detail: "internal server error" }, { status: 500 });
}
