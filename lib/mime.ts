/**
 * Content types are server-derived from this fixed map; the client-supplied
 * type is never echoed (SPEC §4). Unknown extensions serve as
 * application/octet-stream with Content-Disposition: attachment.
 */
const MIME_MAP: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json",
  txt: "text/plain; charset=utf-8",
  md: "text/plain; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  wasm: "application/wasm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  mp4: "video/mp4",
  webm: "video/webm",
  pdf: "application/pdf",
};

export interface ResolvedType {
  contentType: string;
  /** True for unknown extensions: serve as an attachment, never render. */
  attachment: boolean;
}

export function resolveContentType(pathname: string): ResolvedType {
  const dot = pathname.lastIndexOf(".");
  const ext = dot === -1 ? "" : pathname.slice(dot + 1).toLowerCase();
  const known = ext && Object.prototype.hasOwnProperty.call(MIME_MAP, ext) ? MIME_MAP[ext] : null;
  if (known) return { contentType: known, attachment: false };
  return { contentType: "application/octet-stream", attachment: true };
}
