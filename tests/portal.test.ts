import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { setStorageForTesting } from "@/lib/storage";
import { createMemoryStorage, type MemoryStorage } from "@/lib/storage-memory";
import { hasPortalSession, portalSessionCookie } from "@/lib/portal";
import { createSite, listSites } from "@/lib/sites";
import { POST as login } from "@/app/portal/login/route";
import { POST as actions } from "@/app/portal/actions/route";

const ADMIN = "test-admin-token-0123456789";
process.env.PLNTH_ADMIN_TOKEN = ADMIN;
process.env.PLNTH_APEX_HOST = "plnth.app";

let memory: MemoryStorage;
beforeEach(() => {
  memory = createMemoryStorage();
  setStorageForTesting(memory.backend);
});

function formRequest(path: string, fields: Record<string, string>, opts: { cookie?: string; origin?: string; ip?: string } = {}): Request {
  const body = new URLSearchParams(fields);
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.origin) headers.origin = opts.origin;
  headers["x-forwarded-for"] = opts.ip ?? "9.9.9.9";
  return new Request(`https://plnth.app${path}`, { method: "POST", headers, body });
}

function sessionCookie(): string {
  return portalSessionCookie().split(";")[0];
}

describe("portal login (SPEC §7)", () => {
  it("correct token sets a __Host- HttpOnly Secure session cookie", async () => {
    const res = await login(formRequest("/portal/login", { token: ADMIN }));
    expect(res.status).toBe(303);
    const cookie = res.headers.get("Set-Cookie")!;
    expect(cookie).toMatch(/^__Host-plnth_portal=/);
    for (const attr of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/"]) {
      expect(cookie).toContain(attr);
    }
    expect(cookie).not.toContain("Domain");
    expect(hasPortalSession(cookie.split(";")[0])).toBe(true);
  });

  it("wrong token redirects back with no cookie", async () => {
    const res = await login(formRequest("/portal/login", { token: "wrong-token-123456" }, { ip: "7.7.7.7" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toContain("error");
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  it("cross-origin login attempts are rejected", async () => {
    const res = await login(formRequest("/portal/login", { token: ADMIN }, { origin: "https://evil.com" }));
    expect(res.status).toBe(403);
  });
});

describe("portal actions", () => {
  it("all actions require a session cookie", async () => {
    const { pointer } = await createSite({ html: "<p>x</p>" });
    const res = await actions(formRequest("/portal/actions", { action: "delete", site_id: pointer.siteId, confirm: "yes" }));
    expect(res.status).toBe(401);
    expect(await listSites()).toHaveLength(1);
  });

  it("replace, crawl, password, delete-with-confirm work with a session", async () => {
    const { pointer } = await createSite({ html: "<p>v1</p>" });
    const cookie = sessionCookie();

    const replaced = await actions(
      formRequest("/portal/actions", { action: "replace", site_id: pointer.siteId, html: "<p>v2</p>" }, { cookie }),
    );
    expect(replaced.status).toBe(303);

    const crawled = await actions(
      formRequest("/portal/actions", { action: "crawl", site_id: pointer.siteId, crawl: "on" }, { cookie }),
    );
    expect(crawled.status).toBe(303);

    const passworded = await actions(
      formRequest("/portal/actions", { action: "password", site_id: pointer.siteId, password: "pw" }, { cookie }),
    );
    expect(passworded.status).toBe(303);

    const [site] = await listSites();
    expect(site.crawl).toBe(true);
    expect(site.passwordHash).not.toBeNull();

    const unconfirmed = await actions(formRequest("/portal/actions", { action: "delete", site_id: pointer.siteId }, { cookie }));
    expect(unconfirmed.status).toBe(400);
    expect(await listSites()).toHaveLength(1);

    const deleted = await actions(
      formRequest("/portal/actions", { action: "delete", site_id: pointer.siteId, confirm: "yes" }, { cookie }),
    );
    expect(deleted.status).toBe(303);
    expect(await listSites()).toHaveLength(0);
  });

  it("rejects cross-origin and subdomain-origin action posts (forgery)", async () => {
    const { pointer } = await createSite({ html: "<p>x</p>" });
    const cookie = sessionCookie();
    for (const origin of ["https://evil.com", `https://${pointer.siteId}.plnth.app`, "null"]) {
      const res = await actions(
        formRequest("/portal/actions", { action: "delete", site_id: pointer.siteId, confirm: "yes" }, { cookie, origin }),
      );
      expect(res.status, origin).toBe(403);
    }
    expect(await listSites()).toHaveLength(1);
  });

  it("unknown actions 400", async () => {
    const res = await actions(formRequest("/portal/actions", { action: "nuke", site_id: "x" }, { cookie: sessionCookie() }));
    expect(res.status).toBe(400);
  });
});

describe("stored-XSS invariant (SPEC §7, permanent)", () => {
  it("the portal never renders artifact HTML: no dangerouslySetInnerHTML, no iframe, no artifact content fetch", () => {
    const source = readFileSync("app/portal/page.tsx", "utf8");
    expect(source).not.toContain("dangerouslySetInnerHTML");
    expect(source).not.toContain("<iframe");
    expect(source).not.toContain("srcdoc");
    // The page may import site metadata only — never the artifact-serving or raw-storage read paths.
    expect(source).not.toContain("serveArtifact");
    expect(source).not.toMatch(/storage.*\.get\(/);
  });
});
