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

const box: React.CSSProperties = { border: "1px solid #ddd", borderRadius: 8, padding: "1rem", marginBottom: "1rem" };

function LoginForm({ failed }: { failed: boolean }) {
  return (
    <main style={{ fontFamily: "system-ui", maxWidth: "24rem", margin: "6rem auto", padding: "0 1rem" }}>
      <h1>plnth portal</h1>
      {failed && <p style={{ color: "#b00" }}>Wrong token.</p>}
      <form method="post" action="/portal/login">
        <input type="password" name="token" placeholder="admin token" required autoFocus style={{ width: "100%", padding: ".5rem" }} />
        <button type="submit" style={{ marginTop: ".75rem", padding: ".5rem 1rem" }}>
          Log in
        </button>
      </form>
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
    <main style={{ fontFamily: "system-ui", maxWidth: "44rem", margin: "2rem auto", padding: "0 1rem" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1>plnth portal</h1>
        <form method="post" action="/portal/actions">
          <input type="hidden" name="action" value="logout" />
          <button type="submit">Log out</button>
        </form>
      </header>
      <p>
        {sites.length} site{sites.length === 1 ? "" : "s"}
      </p>
      {sites.map((site) => (
        <section key={site.siteId} style={box}>
          <h2 style={{ fontSize: "1rem", margin: "0 0 .25rem" }}>
            <a href={siteUrl(site.siteId)} target="_blank" rel="noopener noreferrer">
              {site.siteId}
            </a>
          </h2>
          <p style={{ color: "#666", fontSize: ".85rem", margin: "0 0 .75rem" }}>
            created {site.createdAt} · updated {site.updatedAt} · crawl {site.crawl ? "on" : "off"} ·{" "}
            {site.passwordHash ? "password set" : "no password"} · {site.assets.length} asset
            {site.assets.length === 1 ? "" : "s"}
          </p>

          <details>
            <summary>Replace HTML</summary>
            <form method="post" action="/portal/actions" encType="multipart/form-data">
              <input type="hidden" name="action" value="replace" />
              <input type="hidden" name="site_id" value={site.siteId} />
              <textarea name="html" rows={4} placeholder="paste HTML" style={{ width: "100%", marginTop: ".5rem" }} />
              <p>
                or upload: <input type="file" name="file" accept=".html,.htm,text/html" />
              </p>
              <button type="submit">Replace</button>
            </form>
          </details>

          <details>
            <summary>Settings</summary>
            <form method="post" action="/portal/actions" style={{ marginTop: ".5rem" }}>
              <input type="hidden" name="action" value="crawl" />
              <input type="hidden" name="site_id" value={site.siteId} />
              <label>
                <input type="checkbox" name="crawl" defaultChecked={site.crawl} /> allow crawling
              </label>{" "}
              <button type="submit">Save crawl</button>
            </form>
            <form method="post" action="/portal/actions" style={{ marginTop: ".5rem" }}>
              <input type="hidden" name="action" value="password" />
              <input type="hidden" name="site_id" value={site.siteId} />
              <input type="password" name="password" placeholder="new password (empty clears)" />{" "}
              <button type="submit">Set password</button>
            </form>
          </details>

          <details>
            <summary>Delete</summary>
            <form method="post" action="/portal/actions" style={{ marginTop: ".5rem" }}>
              <input type="hidden" name="action" value="delete" />
              <input type="hidden" name="site_id" value={site.siteId} />
              <label>
                <input type="checkbox" name="confirm" value="yes" required /> permanently delete {site.siteId} — the URL
                dies immediately and the bytes leave storage within 24h
              </label>{" "}
              <button type="submit">Delete</button>
            </form>
          </details>
        </section>
      ))}
    </main>
  );
}
