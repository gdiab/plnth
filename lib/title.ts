/**
 * Exhibit titles (spec: 2026-07-27-exhibit-titles-memorable-subdomains).
 * Extraction is intentionally regex-based — good enough for "identify this
 * artifact", with no HTML-parser dependency.
 */

export const MAX_TITLE_CHARS = 120;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const hex = body[1] === "x" || body[1] === "X";
      const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Strip tags, decode entities, collapse whitespace, trim, cap. Null when nothing remains. */
export function normalizeTitle(raw: string): string | null {
  const text = decodeEntities(raw.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.length > MAX_TITLE_CHARS ? text.slice(0, MAX_TITLE_CHARS).trimEnd() : text;
}

/** First <title>, else first <h1>, else null. */
export function extractTitle(html: string): string | null {
  const title = /<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i.exec(html);
  const fromTitle = title ? normalizeTitle(title[1]) : null;
  if (fromTitle) return fromTitle;
  const h1 = /<h1(?:\s[^>]*)?>([\s\S]*?)<\/h1>/i.exec(html);
  return h1 ? normalizeTitle(h1[1]) : null;
}

/** The one display rule (spec §1): custom beats derived beats id. */
export function displayTitle(p: { siteId: string; derivedTitle?: string | null; customTitle?: string }): string {
  return p.customTitle ?? p.derivedTitle ?? p.siteId;
}
