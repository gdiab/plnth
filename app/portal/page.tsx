import { cookies } from "next/headers";
import { hasPortalSession, PORTAL_COOKIE } from "@/lib/portal";
import { listSites } from "@/lib/sites";
import { siteUrl } from "@/lib/hosts";

export const dynamic = "force-dynamic";

/**
 * Portal (SPEC §7). Stored-XSS invariant: artifact HTML renders only on
 * artifact origins — this page shows metadata and links only, never inlines
 * or iframes artifact content. All values render through JSX (auto-escaped).
 */

const CSS = `
  :root {
    --wall: #101013;
    --ink: #e8e5df;
    --ink-dim: #8f8c85;
    --accent: #d9b96c;
    --term-bg: #0d1411;
    --term-edge: #22302a;
    --term-text: #cfe3d8;
    --term-dim: #7fa393;
    --term-green: #4fd88f;
    --term-amber: #e8c468;
    --term-red: #ef7b6d;
    --term-cyan: #6cc9d6;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background:
      radial-gradient(ellipse 90% 60% at 50% -10%, #17171b 0%, transparent 60%),
      var(--wall);
    color: var(--ink);
    font-family: Georgia, 'Times New Roman', serif;
    min-height: 100vh;
  }
  .mono, input, textarea, button, summary, .meta {
    font-family: 'SF Mono', ui-monospace, Menlo, Consolas, monospace;
  }
  .wordmark {
    text-align: center;
    padding-top: clamp(2rem, 8vh, 4.5rem);
  }
  .wordmark h1 {
    font-size: clamp(1.4rem, 3vw, 2rem);
    letter-spacing: 0.34em;
    margin-left: 0.34em;
    font-weight: 400;
  }
  .wordmark p {
    margin-top: 0.4rem;
    color: var(--ink-dim);
    font-style: italic;
    font-size: 0.88rem;
  }
  .console {
    background: var(--term-bg);
    border: 1px solid var(--term-edge);
    border-radius: 8px;
    box-shadow: 0 14px 40px rgba(0, 0, 0, 0.6);
    overflow: hidden;
  }
  .console-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    padding: 0.5rem 0.8rem;
    border-bottom: 1px solid var(--term-edge);
    background: #0a100d;
    color: var(--term-dim);
    font-size: 0.68rem;
    letter-spacing: 0.08em;
  }
  .lamp {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--term-green);
    animation: lamp-pulse 2.4s ease-in-out infinite;
    flex-shrink: 0;
  }
  @keyframes lamp-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
  @media (prefers-reduced-motion: reduce) { .lamp { animation: none; } }
  .console-body { padding: 1rem 1.1rem 1.1rem; font-size: 0.82rem; line-height: 1.7; }
  .prompt { color: var(--term-green); }
  .error { color: var(--term-red); margin-bottom: 0.6rem; }
  input[type="password"], input[type="text"], textarea {
    width: 100%;
    background: #0a100d;
    border: 1px solid var(--term-edge);
    border-radius: 4px;
    color: var(--term-text);
    padding: 0.55rem 0.65rem;
    font-size: 0.82rem;
  }
  input::placeholder, textarea::placeholder { color: #5d7a6d; }
  input:focus-visible, textarea:focus-visible, button:focus-visible, summary:focus-visible, a:focus-visible {
    outline: 1px solid var(--term-green);
    outline-offset: 2px;
  }
  button {
    background: transparent;
    border: 1px solid var(--term-green);
    border-radius: 4px;
    color: var(--term-green);
    padding: 0.45rem 0.9rem;
    font-size: 0.78rem;
    letter-spacing: 0.04em;
    cursor: pointer;
    transition: background 0.15s ease-out, color 0.15s ease-out;
  }
  button:hover { background: var(--term-green); color: #0a100d; }
  button.danger { border-color: var(--term-red); color: var(--term-red); }
  button.danger:hover { background: var(--term-red); color: #0a100d; }
  button.quiet { border-color: var(--term-edge); color: var(--term-dim); }
  button.quiet:hover { background: var(--term-edge); color: var(--term-text); }

  /* login */
  .login-wrap { max-width: 24rem; margin: clamp(2rem, 10vh, 5rem) auto 0; padding: 0 1rem 3rem; }
  .login-wrap form { margin-top: 0.6rem; }
  .login-wrap button { margin-top: 0.8rem; }
  .login-hint {
    margin-top: 1.1rem;
    text-align: center;
    color: var(--ink-dim);
    font-style: italic;
    font-size: 0.8rem;
  }
  .login-hint a { color: var(--accent); text-decoration: none; border-bottom: 1px solid rgba(217, 185, 108, 0.35); }
  .login-hint a:hover { border-bottom-color: var(--accent); }

  /* logged-in portal */
  .portal-wrap { max-width: 44rem; margin: 0 auto; padding: 0 1rem 4rem; }
  .portal-bar {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 1rem;
    margin: 1.8rem 0 1.2rem;
  }
  .portal-bar .count { color: var(--term-dim); font-size: 0.78rem; }
  .site { margin-bottom: 1rem; }
  .site .console-body { padding-top: 0.85rem; }
  .site h2 { font-size: 0.95rem; font-weight: 600; margin-bottom: 0.2rem; }
  .site h2 a { color: var(--term-cyan); text-decoration: none; }
  .site h2 a:hover { text-decoration: underline; text-underline-offset: 3px; }
  .meta { color: var(--term-dim); font-size: 0.72rem; margin-bottom: 0.7rem; }
  details { margin-top: 0.45rem; }
  summary {
    cursor: pointer;
    color: var(--term-amber);
    font-size: 0.76rem;
    letter-spacing: 0.03em;
  }
  summary:hover { text-decoration: underline; text-underline-offset: 3px; }
  details form { margin-top: 0.6rem; }
  details p, details label { font-size: 0.78rem; color: var(--term-text); }
  details p { margin: 0.5rem 0; }
  details button { margin-top: 0.5rem; }
  input[type="checkbox"] { accent-color: var(--term-green); }
  input[type="file"] { color: var(--term-dim); font-size: 0.75rem; }
  .empty { color: var(--ink-dim); font-style: italic; }
`;

function LoginForm({ failed }: { failed: boolean }) {
  return (
    <main>
      <style>{CSS}</style>
      <div className="wordmark">
        <h1>plnth</h1>
        <p>staff entrance</p>
      </div>
      <div className="login-wrap">
        <div className="console">
          <div className="console-title">
            <span>curator&apos;s console — authentication</span>
            <span className="lamp" aria-hidden="true" />
          </div>
          <div className="console-body">
            {failed && <p className="error">wrong token. access denied.</p>}
            <p>
              <span className="prompt">$</span> <span className="mono">plnth login</span>
            </p>
            <form method="post" action="/portal/login">
              <input type="password" name="token" placeholder="admin token" required autoFocus aria-label="admin token" />
              <button type="submit">authenticate</button>
            </form>
          </div>
        </div>
        <p className="login-hint">
          visitors are looking for <a href="/">the gallery</a>
        </p>
      </div>
    </main>
  );
}

export default async function Portal({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const cookieStore = await cookies();
  const sessionValue = cookieStore.get(PORTAL_COOKIE)?.value;
  const loggedIn = hasPortalSession(sessionValue ? `${PORTAL_COOKIE}=${sessionValue}` : null);
  const { error } = await searchParams;

  if (!loggedIn) return <LoginForm failed={error === "1"} />;

  const sites = await listSites();

  return (
    <main>
      <style>{CSS}</style>
      <div className="portal-wrap">
        <div className="wordmark">
          <h1>plnth</h1>
          <p>curator&apos;s portal</p>
        </div>
        <div className="portal-bar">
          <span className="count mono">
            {sites.length} exhibit{sites.length === 1 ? "" : "s"} standing
          </span>
          <form method="post" action="/portal/actions">
            <input type="hidden" name="action" value="logout" />
            <button type="submit" className="quiet">
              log out
            </button>
          </form>
        </div>
        {sites.length === 0 && <p className="empty">The gallery is empty — nothing on the plinths tonight.</p>}
        {sites.map((site) => (
          <section key={site.siteId} className="site console">
            <div className="console-title">
              <span>EXHIBIT {site.siteId}</span>
              <span className="lamp" aria-hidden="true" />
            </div>
            <div className="console-body">
              <h2 className="mono">
                <a href={siteUrl(site.siteId)} target="_blank" rel="noopener noreferrer">
                  {site.siteId}
                </a>
              </h2>
              <p className="meta">
                created {site.createdAt} · updated {site.updatedAt} · crawl {site.crawl ? "on" : "off"} ·{" "}
                {site.passwordHash ? "password set" : "no password"} · {site.assets.length} asset
                {site.assets.length === 1 ? "" : "s"}
              </p>

              <details>
                <summary>Replace HTML</summary>
                <form method="post" action="/portal/actions" encType="multipart/form-data">
                  <input type="hidden" name="action" value="replace" />
                  <input type="hidden" name="site_id" value={site.siteId} />
                  <textarea name="html" rows={4} placeholder="paste HTML" />
                  <p>
                    or upload: <input type="file" name="file" accept=".html,.htm,text/html" />
                  </p>
                  <button type="submit">Replace</button>
                </form>
              </details>

              <details>
                <summary>Settings</summary>
                <form method="post" action="/portal/actions">
                  <input type="hidden" name="action" value="crawl" />
                  <input type="hidden" name="site_id" value={site.siteId} />
                  <label>
                    <input type="checkbox" name="crawl" defaultChecked={site.crawl} /> allow crawling
                  </label>{" "}
                  <button type="submit">Save crawl</button>
                </form>
                <form method="post" action="/portal/actions">
                  <input type="hidden" name="action" value="password" />
                  <input type="hidden" name="site_id" value={site.siteId} />
                  <input type="password" name="password" placeholder="new password (empty clears)" />
                  <button type="submit">Set password</button>
                </form>
              </details>

              <details>
                <summary>Delete</summary>
                <form method="post" action="/portal/actions">
                  <input type="hidden" name="action" value="delete" />
                  <input type="hidden" name="site_id" value={site.siteId} />
                  <label>
                    <input type="checkbox" name="confirm" value="yes" required /> permanently delete {site.siteId} — the
                    URL dies immediately and the bytes leave storage within 24h
                  </label>{" "}
                  <button type="submit" className="danger">
                    Delete
                  </button>
                </form>
              </details>
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
