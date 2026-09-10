/**
 * Response header policy (SPEC §4). None of these are client-controllable
 * (SPEC §5: no client-controlled security switches).
 */

export const SANDBOX_CSP = "sandbox allow-scripts allow-forms allow-modals allow-popups allow-downloads";

/** Every response the service emits, all hosts. */
export function applyBaseHeaders(headers: Headers): Headers {
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  return headers;
}

export interface ArtifactHeaderOptions {
  /**
   * The robots invariant: when true, every response from this artifact's
   * origin carries X-Robots-Tag: noindex — page, assets, gates, errors.
   */
  noindex: boolean;
  contentType?: string;
  cacheControl?: string;
  attachment?: boolean;
}

/**
 * Headers for any response served from an artifact origin. The sandbox CSP is
 * unconditional: no per-type, per-state, or per-request exceptions (SPEC §1).
 */
export function artifactHeaders(opts: ArtifactHeaderOptions): Headers {
  const headers = applyBaseHeaders(new Headers());
  headers.set("Content-Security-Policy", SANDBOX_CSP);
  if (opts.noindex) headers.set("X-Robots-Tag", "noindex");
  if (opts.contentType) headers.set("Content-Type", opts.contentType);
  if (opts.cacheControl) headers.set("Cache-Control", opts.cacheControl);
  if (opts.attachment) headers.set("Content-Disposition", "attachment");
  return headers;
}

/** Headers for portal/API responses (apex): always noindex (SPEC §4). */
export function apexHeaders(): Headers {
  const headers = applyBaseHeaders(new Headers());
  headers.set("X-Robots-Tag", "noindex");
  return headers;
}

const HEAD_OPEN_RE = /<head(\s[^>]*)?>/i;
const NOINDEX_META = '<meta name="robots" content="noindex">';

/**
 * HTML responses under noindex also carry the meta tag (SPEC §4). Injected at
 * serve time; stored bytes are untouched.
 */
export function injectNoindexMeta(html: string): string {
  const match = HEAD_OPEN_RE.exec(html);
  if (match) {
    const insertAt = match.index + match[0].length;
    return html.slice(0, insertAt) + NOINDEX_META + html.slice(insertAt);
  }
  return NOINDEX_META + html;
}

const BODY_CLOSE_RE = /<\/body>/i;

/**
 * Inject feedback strip when comments are enabled. Works under sandbox CSP
 * (allow-scripts allow-forms but NO allow-same-origin) by using a classic
 * form POST to the apex. Inserted before </body> or at the end if no closing
 * body tag exists.
 */
export function injectFeedbackStrip(html: string, siteId: string, apexHost: string): string {
  const scheme = apexHost.startsWith("localhost") || apexHost.startsWith("127.0.0.1") ? "http" : "https";
  const actionUrl = `${scheme}://${apexHost}/v1/sites/${siteId}/comments`;

  const feedbackHtml = `
<div id="plnth-feedback" style="position:fixed;bottom:0;left:0;right:0;background:#f7f7f7;border-top:1px solid #ddd;padding:1rem;box-shadow:0 -2px 8px rgba(0,0,0,0.1);font-family:system-ui,sans-serif;z-index:999999">
  <div style="max-width:40rem;margin:0 auto">
    <details id="plnth-feedback-details">
      <summary style="cursor:pointer;font-weight:500;color:#333;list-style:none;user-select:none">
        <span style="display:inline-block;margin-right:0.5rem">💬</span>
        Leave feedback
        <span style="font-size:0.85em;color:#666;font-weight:normal;margin-left:0.5rem">(click to open)</span>
      </summary>
      <form method="post" action="${actionUrl}" style="margin-top:1rem" id="plnth-feedback-form">
        <div style="margin-bottom:0.75rem">
          <label style="display:block;font-size:0.85rem;margin-bottom:0.25rem;color:#666">Name (optional)</label>
          <input type="text" name="name" placeholder="Your name" maxlength="200" style="width:100%;padding:0.5rem;border:1px solid #ccc;border-radius:4px;font-size:0.9rem">
        </div>
        <div style="margin-bottom:0.75rem">
          <label style="display:block;font-size:0.85rem;margin-bottom:0.25rem;color:#666">Feedback <span style="color:#d44">*</span></label>
          <textarea name="body" placeholder="Your comments or feedback" required maxlength="10000" rows="3" style="width:100%;padding:0.5rem;border:1px solid #ccc;border-radius:4px;font-size:0.9rem;resize:vertical"></textarea>
        </div>
        <div style="display:flex;gap:0.5rem;align-items:center">
          <button type="submit" style="background:#2d6a4f;color:white;border:none;padding:0.5rem 1rem;border-radius:4px;font-size:0.9rem;cursor:pointer">Submit</button>
          <button type="button" onclick="document.getElementById('plnth-feedback-details').removeAttribute('open')" style="background:transparent;color:#666;border:1px solid #ccc;padding:0.5rem 1rem;border-radius:4px;font-size:0.9rem;cursor:pointer">Cancel</button>
        </div>
      </form>
    </details>
  </div>
</div>`;

  const match = BODY_CLOSE_RE.exec(html);
  if (match) {
    return html.slice(0, match.index) + feedbackHtml + html.slice(match.index);
  }
  return html + feedbackHtml;
}
