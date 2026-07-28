import { beforeEach, describe, expect, it } from "vitest";
import { setStorageForTesting } from "@/lib/storage";
import { createMemoryStorage, type MemoryStorage } from "@/lib/storage-memory";
import { GET as listSites, POST as createSite } from "@/app/v1/sites/route";
import { DELETE as deleteSite, GET as getSite, PATCH as patchSite, PUT as putSite } from "@/app/v1/sites/[id]/route";
import { POST as uploadAsset } from "@/app/v1/sites/[id]/assets/route";

const ADMIN = "test-admin-token-0123456789";
process.env.PLNTH_ADMIN_TOKEN = ADMIN;
process.env.PLNTH_APEX_HOST = "plnth.app";

let memory: MemoryStorage;
beforeEach(() => {
  memory = createMemoryStorage();
  setStorageForTesting(memory.backend);
});

const PAGE = "<html><body>hi</body></html>";

function req(
  method: string,
  path: string,
  opts: { token?: string; json?: unknown; origin?: string; form?: FormData } = {},
): Request {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.origin) headers.origin = opts.origin;
  let body: BodyInit | undefined;
  if (opts.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.json);
  } else if (opts.form) {
    body = opts.form;
  }
  return new Request(`https://plnth.app${path}`, { method, headers, body });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function makeSite(html = PAGE): Promise<{ site_id: string; update_key: string; url: string }> {
  const res = await createSite(req("POST", "/v1/sites", { token: ADMIN, json: { html } }));
  expect(res.status).toBe(201);
  return (await res.json()) as { site_id: string; update_key: string; url: string };
}

describe("create (PRD #2)", () => {
  it("no token → 401 with {detail}; wrong token → 401", async () => {
    const noToken = await createSite(req("POST", "/v1/sites", { json: { html: PAGE } }));
    expect(noToken.status).toBe(401);
    expect((await noToken.json()).detail).toMatch(/bearer/i);
    const badToken = await createSite(req("POST", "/v1/sites", { token: "wrong-token-123456", json: { html: PAGE } }));
    expect(badToken.status).toBe(401);
  });

  it("with token → 201 with subdomain url, site_id, update_key", async () => {
    const created = await makeSite();
    expect(created.url).toBe(`https://${created.site_id}.plnth.app`);
    expect(created.update_key).toMatch(/^puk_/);
  });

  it("update_key auth is rejected on create (admin only)", async () => {
    const created = await makeSite();
    const res = await createSite(req("POST", "/v1/sites", { token: created.update_key, json: { html: PAGE } }));
    expect(res.status).toBe(401);
  });

  it("accepts Lavish's html_content field (PRD #9 wire compatibility)", async () => {
    const res = await createSite(req("POST", "/v1/sites", { token: ADMIN, json: { html_content: PAGE } }));
    expect(res.status).toBe(201);
    const both = await createSite(req("POST", "/v1/sites", { token: ADMIN, json: { html: PAGE, html_content: PAGE } }));
    expect(both.status).toBe(400);
  });

  it("strict validation: unknown fields, wrong types, missing html → 400", async () => {
    for (const body of [
      { html: PAGE, extra: 1 },
      { html: 42 },
      { password: "x" },
      { html: PAGE, crawl: "false" },
    ]) {
      const res = await createSite(req("POST", "/v1/sites", { token: ADMIN, json: body }));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("oversize html → 413 with human-readable detail", async () => {
    const res = await createSite(req("POST", "/v1/sites", { token: ADMIN, json: { html: "x".repeat(2 * 1024 * 1024 + 1) } }));
    expect(res.status).toBe(413);
    expect((await res.json()).detail).toMatch(/2 MB/);
  });
});

describe("Origin validation on mutations (SPEC §1)", () => {
  it("cross-origin and opaque origins → 403; apex and absent pass", async () => {
    const created = await makeSite();
    for (const origin of ["https://evil.com", `https://${created.site_id}.plnth.app`, "null"]) {
      const res = await putSite(
        req("PUT", `/v1/sites/${created.site_id}`, { token: ADMIN, json: { html: PAGE }, origin }),
        ctx(created.site_id),
      );
      expect(res.status, origin).toBe(403);
    }
    const ok = await putSite(
      req("PUT", `/v1/sites/${created.site_id}`, { token: ADMIN, json: { html: PAGE }, origin: "https://plnth.app" }),
      ctx(created.site_id),
    );
    expect(ok.status).toBe(200);
  });
});

describe("update_key scope (PRD #10)", () => {
  it("update_key works for its own site", async () => {
    const created = await makeSite();
    const res = await putSite(
      req("PUT", `/v1/sites/${created.site_id}`, { token: created.update_key, json: { html: "<p>2</p>" } }),
      ctx(created.site_id),
    );
    expect(res.status).toBe(200);
  });

  it("update_key does not work for another site", async () => {
    const a = await makeSite();
    const b = await makeSite();
    const res = await getSite(req("GET", `/v1/sites/${b.site_id}`, { token: a.update_key }), ctx(b.site_id));
    expect(res.status).toBe(401);
  });

  it("update_key is dead after delete", async () => {
    const created = await makeSite();
    await deleteSite(req("DELETE", `/v1/sites/${created.site_id}`, { token: created.update_key }), ctx(created.site_id));
    const res = await putSite(
      req("PUT", `/v1/sites/${created.site_id}`, { token: created.update_key, json: { html: PAGE } }),
      ctx(created.site_id),
    );
    expect(res.status).toBe(404);
  });
});

describe("list and get", () => {
  it("list is admin-only and shows PRD fields", async () => {
    const created = await makeSite();
    const denied = await listSites(req("GET", "/v1/sites", { token: created.update_key }));
    expect(denied.status).toBe(401);
    const res = await listSites(req("GET", "/v1/sites", { token: ADMIN }));
    const { sites } = (await res.json()) as { sites: Record<string, unknown>[] };
    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject({ site_id: created.site_id, crawl: false, has_password: false });
    expect(sites[0]).not.toHaveProperty("updateKeyHash");
    expect(sites[0]).not.toHaveProperty("passwordHash");
  });

  it("get on a missing or invalid id → 404 (with valid auth)", async () => {
    for (const id of ["anope123456789ab", "..", "a/../b"]) {
      const res = await getSite(req("GET", `/v1/sites/${id}`, { token: ADMIN }), ctx(id));
      expect(res.status, id).toBe(404);
    }
  });
});

describe("settings", () => {
  it("PATCH toggles crawl and sets/clears password", async () => {
    const created = await makeSite();
    const on = await patchSite(
      req("PATCH", `/v1/sites/${created.site_id}`, { token: ADMIN, json: { crawl: true, password: "pw" } }),
      ctx(created.site_id),
    );
    expect((await on.json()).site).toMatchObject({ crawl: true, has_password: true });
    const off = await patchSite(
      req("PATCH", `/v1/sites/${created.site_id}`, { token: ADMIN, json: { password: null } }),
      ctx(created.site_id),
    );
    expect((await off.json()).site).toMatchObject({ crawl: true, has_password: false });
  });

  it("rejects {crawl: \"false\"} — the silent-no-op class", async () => {
    const created = await makeSite();
    const res = await patchSite(
      req("PATCH", `/v1/sites/${created.site_id}`, { token: ADMIN, json: { crawl: "false" } }),
      ctx(created.site_id),
    );
    expect(res.status).toBe(400);
  });
});

describe("delete (PRD #3)", () => {
  it("delete → 404 on subsequent API access", async () => {
    const created = await makeSite();
    const del = await deleteSite(req("DELETE", `/v1/sites/${created.site_id}`, { token: ADMIN }), ctx(created.site_id));
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ site_id: created.site_id, deleted: true });
    const after = await getSite(req("GET", `/v1/sites/${created.site_id}`, { token: ADMIN }), ctx(created.site_id));
    expect(after.status).toBe(404);
  });
});

describe("assets (PRD #7)", () => {
  it("uploads via multipart and reports the manifest", async () => {
    const created = await makeSite();
    const form = new FormData();
    form.append("file", new File(["body{color:red}"], "style.css", { type: "text/css" }), "style.css");
    const res = await uploadAsset(req("POST", `/v1/sites/${created.site_id}/assets`, { token: created.update_key, form }), ctx(created.site_id));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { site: { assets: string[] }; asset: string };
    expect(body.asset).toBe("style.css");
    expect(body.site.assets).toEqual(["style.css"]);
  });

  it("honors the path field for nested assets", async () => {
    const created = await makeSite();
    const form = new FormData();
    form.append("file", new File([new Uint8Array([1])], "logo.png", { type: "image/png" }));
    form.append("path", "images/logo.png");
    const res = await uploadAsset(req("POST", `/v1/sites/${created.site_id}/assets`, { token: ADMIN, form }), ctx(created.site_id));
    expect(((await res.json()) as { site: { assets: string[] } }).site.assets).toEqual(["images/logo.png"]);
  });

  it("rejects traversal paths and non-multipart bodies with 400", async () => {
    const created = await makeSite();
    const form = new FormData();
    form.append("file", new File([new Uint8Array([1])], "x.png"));
    form.append("path", "../evil.png");
    const res = await uploadAsset(req("POST", `/v1/sites/${created.site_id}/assets`, { token: ADMIN, form }), ctx(created.site_id));
    expect(res.status).toBe(400);
    const notForm = await uploadAsset(
      req("POST", `/v1/sites/${created.site_id}/assets`, { token: ADMIN, json: { file: "x" } }),
      ctx(created.site_id),
    );
    expect(notForm.status).toBe(400);
  });
});

describe("response hygiene", () => {
  it("API responses are noindex + nosniff + no-store", async () => {
    const res = await listSites(req("GET", "/v1/sites", { token: ADMIN }));
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("title in API bodies", () => {
  it("create and get return the display title", async () => {
    const created = await createSite(req("POST", "/v1/sites", { token: ADMIN, json: { html: "<title>Wire Title</title>" } }));
    const body = (await created.json()) as { site_id: string };

    const got = await getSite(req("GET", `/v1/sites/${body.site_id}`, { token: ADMIN }), ctx(body.site_id));
    expect(((await got.json()) as { site: { title: string } }).site.title).toBe("Wire Title");
  });

  it("falls back to the site id when nothing is derivable", async () => {
    const created = await createSite(req("POST", "/v1/sites", { token: ADMIN, json: { html: "<p>x</p>" } }));
    const body = (await created.json()) as { site_id: string };

    const got = await getSite(req("GET", `/v1/sites/${body.site_id}`, { token: ADMIN }), ctx(body.site_id));
    const siteBody = (await got.json()) as { site: { site_id: string; title: string } };
    expect(siteBody.site.title).toBe(siteBody.site.site_id);
  });
});
