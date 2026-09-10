import { beforeEach, describe, expect, it } from "vitest";
import { serveArtifact } from "@/lib/artifact";
import { SANDBOX_CSP } from "@/lib/headers";
import { setStorageForTesting } from "@/lib/storage";
import { createMemoryStorage, type MemoryStorage } from "@/lib/storage-memory";
import { createSite, deleteSite, patchSettings, uploadAsset } from "@/lib/sites";

const ADMIN = "test-admin-token-0123456789";
process.env.PLNTH_ADMIN_TOKEN = ADMIN;
process.env.PLNTH_APEX_HOST = "plnth.app";

let memory: MemoryStorage;
beforeEach(() => {
  memory = createMemoryStorage();
  setStorageForTesting(memory.backend);
});

const PAGE = "<html><head><title>t</title></head><body>hello world</body></html>";

function get(siteId: string, path = "", headers: Record<string, string> = {}): Promise<Response> {
  const segments = path === "" ? [] : path.split("/");
  return serveArtifact(new Request(`https://${siteId}.plnth.app/${path}`, { headers }), siteId, segments);
}

function postPassword(siteId: string, password: string, ip = "1.2.3.4"): Promise<Response> {
  const form = new URLSearchParams({ password });
  return serveArtifact(
    new Request(`https://${siteId}.plnth.app/`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": ip },
      body: form,
    }),
    siteId,
    [],
  );
}

async function make(opts: { password?: string; crawl?: boolean } = {}) {
  const { pointer } = await createSite({ html: PAGE, password: opts.password });
  if (opts.crawl) await patchSettings(pointer.siteId, { crawl: true });
  return pointer;
}

describe("page serving", () => {
  it("serves the HTML with sandbox CSP, nosniff, no-referrer", async () => {
    const pointer = await make({ crawl: true });
    const res = await get(pointer.siteId);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("hello world");
    expect(res.headers.get("Content-Security-Policy")).toBe(SANDBOX_CSP);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("crawl on: body is byte-identical to the upload — no markers anywhere", async () => {
    const pointer = await make({ crawl: true });
    const res = await get(pointer.siteId);
    expect(await res.text()).toBe(PAGE);
    expect(res.headers.get("X-Robots-Tag")).toBeNull();
  });

  it("comments off: no annotation SDK injected", async () => {
    const pointer = await make();
    const res = await get(pointer.siteId);
    const html = await res.text();
    expect(html).not.toContain("plnth-annotation-sdk");
    expect(html).not.toContain("plnth-annotation-toggle");
  });

  it("comments on: annotation SDK is injected before </body>", async () => {
    const pointer = await make();
    await patchSettings(pointer.siteId, { comments: true });
    const res = await get(pointer.siteId);
    const html = await res.text();
    expect(html).toContain("plnth-annotation-sdk");
    expect(html).toContain("plnth-annotation-toggle");
    expect(html).toContain("EXISTING_COMMENTS");
    expect(html).toContain(`/v1/sites/${pointer.siteId}/comments`);
    // Verify switch structure
    expect(html).toContain('switch-track');
    expect(html).toContain('aria-pressed');
    // Verify it's before </body>
    const sdkIdx = html.indexOf("plnth-annotation-sdk");
    const bodyIdx = html.toLowerCase().indexOf("</body>");
    expect(sdkIdx).toBeGreaterThan(-1);
    expect(bodyIdx).toBeGreaterThan(-1);
    expect(sdkIdx).toBeLessThan(bodyIdx);
  });

  it("unknown and deleted sites 404 (never 500)", async () => {
    expect((await get("anope12345678901")).status).toBe(404);
    const pointer = await make();
    await deleteSite(pointer.siteId);
    expect((await get(pointer.siteId)).status).toBe(404);
    expect((await get("..")).status).toBe(404);
  });
});

describe("robots invariant (SPEC §4) — every response class", () => {
  it("crawl off: page, missing-path 404, robots.txt, assets all carry noindex", async () => {
    const pointer = await make();
    await uploadAsset(pointer.siteId, "style.css", new TextEncoder().encode("body{}"));
    for (const path of ["", "style.css", "missing.png", "robots.txt"]) {
      const res = await get(pointer.siteId, path);
      expect(res.headers.get("X-Robots-Tag"), path || "(page)").toBe("noindex");
      expect(res.headers.get("Content-Security-Policy"), path).toBe(SANDBOX_CSP);
    }
    const page = await get(pointer.siteId);
    expect(await page.text()).toContain('<meta name="robots" content="noindex">');
  });

  it("crawl off: robots.txt disallows all; crawl on: allows all with no markers", async () => {
    const off = await make();
    expect(await (await get(off.siteId, "robots.txt")).text()).toContain("Disallow: /");
    const on = await make({ crawl: true });
    const res = await get(on.siteId, "robots.txt");
    expect(await res.text()).toContain("Allow: /");
    expect(res.headers.get("X-Robots-Tag")).toBeNull();
  });

  it("password ⇒ noindex even with crawl on, including the gate responses", async () => {
    const pointer = await make({ password: "pw", crawl: true });
    const gate = await get(pointer.siteId);
    expect(gate.status).toBe(401);
    expect(gate.headers.get("X-Robots-Tag")).toBe("noindex");
    const failed = await postPassword(pointer.siteId, "wrong");
    expect(failed.status).toBe(401);
    expect(failed.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(await (await get(pointer.siteId, "robots.txt")).text()).toContain("Disallow: /");
  });
});

describe("password gate (SPEC §4)", () => {
  it("initial gate is 401 no-store and never contains the site HTML", async () => {
    const pointer = await make({ password: "pw" });
    const res = await get(pointer.siteId);
    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.text();
    expect(body).toContain("password");
    expect(body).not.toContain("hello world");
  });

  it("assets follow the same gating as their site", async () => {
    const pointer = await make({ password: "pw" });
    await uploadAsset(pointer.siteId, "secret.txt", new TextEncoder().encode("classified"));
    const res = await get(pointer.siteId, "secret.txt");
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain("classified");
  });

  it("correct password sets a bound __Host- cookie and the cookie unlocks", async () => {
    const pointer = await make({ password: "pw" });
    const ok = await postPassword(pointer.siteId, "pw");
    expect(ok.status).toBe(303);
    const setCookie = ok.headers.get("Set-Cookie")!;
    expect(setCookie).toMatch(/^__Host-plnth_viewer=/);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).not.toContain("Domain");
    const cookie = setCookie.split(";")[0];
    const page = await get(pointer.siteId, "", { cookie });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("hello world");
  });

  it("rotating the password invalidates outstanding cookies", async () => {
    const pointer = await make({ password: "pw" });
    const cookie = (await postPassword(pointer.siteId, "pw")).headers.get("Set-Cookie")!.split(";")[0];
    await patchSettings(pointer.siteId, { password: "new-pw" });
    const res = await get(pointer.siteId, "", { cookie });
    expect(res.status).toBe(401);
  });

  it("wrong password → 401; 6th attempt within a minute → 429 + Retry-After", async () => {
    const pointer = await make({ password: "pw" });
    const ip = `ip-${pointer.siteId}`;
    for (let i = 0; i < 5; i++) {
      expect((await postPassword(pointer.siteId, "wrong", ip)).status).toBe(401);
    }
    const limited = await postPassword(pointer.siteId, "wrong", ip);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
});

describe("assets & content types (SPEC §4)", () => {
  it("serves manifest assets with server-derived types", async () => {
    const pointer = await make({ crawl: true });
    await uploadAsset(pointer.siteId, "style.css", new TextEncoder().encode("body{}"));
    const res = await get(pointer.siteId, "style.css");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/css; charset=utf-8");
    expect(res.headers.get("Content-Security-Policy")).toBe(SANDBOX_CSP);
  });

  it("HTML and SVG assets serve with the sandbox CSP (multi-page hosting)", async () => {
    const pointer = await make({ crawl: true });
    await uploadAsset(pointer.siteId, "about.html", new TextEncoder().encode("<p>about</p>"));
    await uploadAsset(pointer.siteId, "logo.svg", new TextEncoder().encode("<svg/>"));
    const html = await get(pointer.siteId, "about.html");
    expect(html.headers.get("Content-Type")).toContain("text/html");
    expect(html.headers.get("Content-Security-Policy")).toBe(SANDBOX_CSP);
    const svg = await get(pointer.siteId, "logo.svg");
    expect(svg.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(svg.headers.get("Content-Security-Policy")).toBe(SANDBOX_CSP);
  });

  it("unknown extensions serve as octet-stream attachments", async () => {
    const pointer = await make({ crawl: true });
    await uploadAsset(pointer.siteId, "data.bin", new Uint8Array([1, 2, 3]));
    const res = await get(pointer.siteId, "data.bin");
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(res.headers.get("Content-Disposition")).toBe("attachment");
  });

  it("non-manifest paths 404 — traversal shapes included", async () => {
    const pointer = await make({ crawl: true });
    for (const path of ["missing.css", "../otherid/meta.json", "g/gen/index.html", "meta.json"]) {
      expect((await get(pointer.siteId, path)).status, path).toBe(404);
    }
  });

  it("malformed percent-encoding → 404, never 500 (SPEC §5)", async () => {
    const pointer = await make({ crawl: true });
    const res = await serveArtifact(
      new Request(`https://${pointer.siteId}.plnth.app/%zz`),
      pointer.siteId,
      ["%zz%"],
    );
    expect(res.status).toBe(404);
  });
});

describe("methods", () => {
  it("POST to a passwordless site is 405; other methods 405 with headers intact", async () => {
    const pointer = await make();
    const post = await serveArtifact(new Request("https://x.plnth.app/", { method: "POST" }), pointer.siteId, []);
    expect(post.status).toBe(405);
    const del = await serveArtifact(new Request("https://x.plnth.app/", { method: "DELETE" }), pointer.siteId, []);
    expect(del.status).toBe(405);
    expect(del.headers.get("Content-Security-Policy")).toBe(SANDBOX_CSP);
    expect(del.headers.get("X-Robots-Tag")).toBe("noindex");
  });
});
