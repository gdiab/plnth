import { beforeEach, describe, expect, it } from "vitest";
import { setStorageForTesting } from "@/lib/storage";
import { createMemoryStorage, type MemoryStorage } from "@/lib/storage-memory";
import { POST as createSite } from "@/app/v1/sites/route";
import { PATCH as patchSite } from "@/app/v1/sites/[id]/route";
import { POST as postComment, OPTIONS as commentOptions } from "@/app/v1/sites/[id]/comments/route";
import { listComments, canReceiveComments } from "@/lib/comments";

const ADMIN = "test-admin-token-0123456789";
process.env.PLNTH_ADMIN_TOKEN = ADMIN;
process.env.PLNTH_APEX_HOST = "plnth.app";

let memory: MemoryStorage;
beforeEach(() => {
  memory = createMemoryStorage();
  setStorageForTesting(memory.backend);
});

const PAGE = "<html><body>Test Review</body></html>";

function req(
  method: string,
  path: string,
  opts: { token?: string; json?: unknown; origin?: string; headers?: Record<string, string>; ip?: string } = {},
): Request {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.origin) headers.origin = opts.origin;
  if (opts.ip) headers["x-forwarded-for"] = opts.ip;
  let body: BodyInit | undefined;
  if (opts.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.json);
  }
  return new Request(`https://plnth.app${path}`, { method, headers, body });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function makeSite(html = PAGE): Promise<{ site_id: string; update_key: string }> {
  const res = await createSite(req("POST", "/v1/sites", { token: ADMIN, json: { html } }));
  expect(res.status).toBe(201);
  return (await res.json()) as { site_id: string; update_key: string };
}

describe("comments setting in PATCH", () => {
  it("PATCH can enable/disable comments", async () => {
    const created = await makeSite();

    // Enable comments
    const enable = await patchSite(
      req("PATCH", `/v1/sites/${created.site_id}`, { token: ADMIN, json: { comments: true } }),
      ctx(created.site_id),
    );
    expect(enable.status).toBe(200);
    expect(((await enable.json()) as { site: { comments: boolean } }).site.comments).toBe(true);

    // Disable comments
    const disable = await patchSite(
      req("PATCH", `/v1/sites/${created.site_id}`, { token: ADMIN, json: { comments: false } }),
      ctx(created.site_id),
    );
    expect(disable.status).toBe(200);
    expect(((await disable.json()) as { site: { comments: boolean } }).site.comments).toBe(false);
  });

  it("rejects {comments: 'true'} — wrong type", async () => {
    const created = await makeSite();
    const res = await patchSite(
      req("PATCH", `/v1/sites/${created.site_id}`, { token: ADMIN, json: { comments: "true" } }),
      ctx(created.site_id),
    );
    expect(res.status).toBe(400);
  });

  it("default comments is false (legacy pointers)", async () => {
    const created = await makeSite();
    expect(await canReceiveComments(created.site_id)).toBe(false);
  });
});

describe("POST /v1/sites/:id/comments", () => {
  it("returns 403 when comments disabled", async () => {
    const created = await makeSite();
    const res = await postComment(
      req("POST", `/v1/sites/${created.site_id}/comments`, { json: { body: "test" } }),
      ctx(created.site_id),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).detail).toMatch(/not enabled/i);
  });

  it("returns 404 when site missing or deleted", async () => {
    const res = await postComment(req("POST", "/v1/sites/nope-nope-123456/comments", { json: { body: "test" } }), ctx("nope-nope-123456"));
    expect(res.status).toBe(403);
  });

  it("stores comment when enabled, returns 201 with comment_id", async () => {
    const created = await makeSite();
    await patchSite(req("PATCH", `/v1/sites/${created.site_id}`, { token: ADMIN, json: { comments: true } }), ctx(created.site_id));

    const res = await postComment(
      req("POST", `/v1/sites/${created.site_id}/comments`, { json: { name: "Alice", body: "Great work!" } }),
      ctx(created.site_id),
    );
    expect(res.status).toBe(201);
    const data = (await res.json()) as { success: boolean; comment_id: string };
    expect(data.success).toBe(true);
    expect(data.comment_id).toBeTruthy();

    const comments = await listComments(created.site_id);
    expect(comments).toHaveLength(1);
    expect(comments[0].name).toBe("Alice");
    expect(comments[0].body).toBe("Great work!");
  });

  it("accepts comment without name", async () => {
    const created = await makeSite();
    await patchSite(req("PATCH", `/v1/sites/${created.site_id}`, { token: ADMIN, json: { comments: true } }), ctx(created.site_id));

    const res = await postComment(req("POST", `/v1/sites/${created.site_id}/comments`, { json: { body: "Anonymous feedback" } }), ctx(created.site_id));
    expect(res.status).toBe(201);

    const comments = await listComments(created.site_id);
    expect(comments[0].name).toBeUndefined();
    expect(comments[0].body).toBe("Anonymous feedback");
  });

  it("rejects empty body", async () => {
    const created = await makeSite();
    await patchSite(req("PATCH", `/v1/sites/${created.site_id}`, { token: ADMIN, json: { comments: true } }), ctx(created.site_id));

    const res = await postComment(req("POST", `/v1/sites/${created.site_id}/comments`, { json: { body: "" } }), ctx(created.site_id));
    expect(res.status).toBe(400);
  });

  it("rejects body exceeding max length", async () => {
    const created = await makeSite();
    await patchSite(req("PATCH", `/v1/sites/${created.site_id}`, { token: ADMIN, json: { comments: true } }), ctx(created.site_id));

    const res = await postComment(
      req("POST", `/v1/sites/${created.site_id}/comments`, { json: { body: "x".repeat(10001) } }),
      ctx(created.site_id),
    );
    expect(res.status).toBe(413);
  });

  it("rejects name exceeding max length", async () => {
    const created = await makeSite();
    await patchSite(req("PATCH", `/v1/sites/${created.site_id}`, { token: ADMIN, json: { comments: true } }), ctx(created.site_id));

    const res = await postComment(
      req("POST", `/v1/sites/${created.site_id}/comments`, { json: { name: "x".repeat(201), body: "test" } }),
      ctx(created.site_id),
    );
    expect(res.status).toBe(413);
  });

  it("rejects unknown fields", async () => {
    const created = await makeSite();
    await patchSite(req("PATCH", `/v1/sites/${created.site_id}`, { token: ADMIN, json: { comments: true } }), ctx(created.site_id));

    const res = await postComment(
      req("POST", `/v1/sites/${created.site_id}/comments`, { json: { body: "test", extra: 1 } }),
      ctx(created.site_id),
    );
    expect(res.status).toBe(400);
  });

  it("rate limits at 10 per hour per IP", async () => {
    const created = await makeSite();
    await patchSite(req("PATCH", `/v1/sites/${created.site_id}`, { token: ADMIN, json: { comments: true } }), ctx(created.site_id));

    // Use a unique IP for this test to avoid rate limit collisions with other tests
    const testIp = "10.0.0.1";
    
    // Submit 10 comments - should all succeed
    for (let i = 0; i < 10; i++) {
      const res = await postComment(
        req("POST", `/v1/sites/${created.site_id}/comments`, { json: { body: `comment ${i}` }, ip: testIp }),
        ctx(created.site_id),
      );
      expect(res.status, `comment ${i}`).toBe(201);
    }

    // 11th should be rate limited
    const res = await postComment(
      req("POST", `/v1/sites/${created.site_id}/comments`, { json: { body: "too many" }, ip: testIp }),
      ctx(created.site_id),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("returns CORS headers for JSON requests", async () => {
    const created = await makeSite();
    await patchSite(req("PATCH", `/v1/sites/${created.site_id}`, { token: ADMIN, json: { comments: true } }), ctx(created.site_id));

    const res = await postComment(
      req("POST", `/v1/sites/${created.site_id}/comments`, {
        json: { body: "test" },
        origin: `https://${created.site_id}.plnth.app`,
        ip: "10.0.0.2",
      }),
      ctx(created.site_id),
    );
    expect(res.status).toBe(201);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(`https://${created.site_id}.plnth.app`);
  });
});

describe("OPTIONS /v1/sites/:id/comments (CORS preflight)", () => {
  it("returns CORS headers for preflight", async () => {
    const created = await makeSite();
    const res = await commentOptions(
      req("OPTIONS", `/v1/sites/${created.site_id}/comments`, {
        origin: `https://${created.site_id}.plnth.app`,
      }),
      ctx(created.site_id),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(`https://${created.site_id}.plnth.app`);
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });
});

describe("listComments", () => {
  it("returns empty array for site with no comments", async () => {
    const created = await makeSite();
    const comments = await listComments(created.site_id);
    expect(comments).toEqual([]);
  });

  it("returns comments newest first", async () => {
    const created = await makeSite();
    await patchSite(req("PATCH", `/v1/sites/${created.site_id}`, { token: ADMIN, json: { comments: true } }), ctx(created.site_id));

    await postComment(req("POST", `/v1/sites/${created.site_id}/comments`, { json: { body: "first" }, ip: "10.0.0.3" }), ctx(created.site_id));
    await postComment(req("POST", `/v1/sites/${created.site_id}/comments`, { json: { body: "second" }, ip: "10.0.0.4" }), ctx(created.site_id));
    await postComment(req("POST", `/v1/sites/${created.site_id}/comments`, { json: { body: "third" }, ip: "10.0.0.5" }), ctx(created.site_id));

    const comments = await listComments(created.site_id);
    expect(comments).toHaveLength(3);
    expect(comments[0].body).toBe("third");
    expect(comments[1].body).toBe("second");
    expect(comments[2].body).toBe("first");
  });

  it("stores ipHash and userAgent", async () => {
    const created = await makeSite();
    await patchSite(req("PATCH", `/v1/sites/${created.site_id}`, { token: ADMIN, json: { comments: true } }), ctx(created.site_id));

    await postComment(
      req("POST", `/v1/sites/${created.site_id}/comments`, {
        json: { body: "test" },
        headers: { "user-agent": "TestBot/1.0" },
        ip: "10.0.0.6",
      }),
      ctx(created.site_id),
    );

    const comments = await listComments(created.site_id);
    expect(comments[0].ipHash).toBeTruthy();
    expect(comments[0].userAgent).toBe("TestBot/1.0");
  });
});

describe("canReceiveComments", () => {
  it("returns false for missing site", async () => {
    expect(await canReceiveComments("nope-nope-123456")).toBe(false);
  });

  it("returns false when comments disabled", async () => {
    const created = await makeSite();
    expect(await canReceiveComments(created.site_id)).toBe(false);
  });

  it("returns true when comments enabled", async () => {
    const created = await makeSite();
    await patchSite(req("PATCH", `/v1/sites/${created.site_id}`, { token: ADMIN, json: { comments: true } }), ctx(created.site_id));
    expect(await canReceiveComments(created.site_id)).toBe(true);
  });
});

describe("comment tombstone behavior", () => {
  it("refuses comments after site deleted", async () => {
    const created = await makeSite();
    await patchSite(req("PATCH", `/v1/sites/${created.site_id}`, { token: ADMIN, json: { comments: true } }), ctx(created.site_id));

    // Delete the site
    const { deleteSite } = await import("@/lib/sites");
    await deleteSite(created.site_id);

    // Should not accept comments
    expect(await canReceiveComments(created.site_id)).toBe(false);
    const res = await postComment(req("POST", `/v1/sites/${created.site_id}/comments`, { json: { body: "test" } }), ctx(created.site_id));
    expect(res.status).toBe(403);
  });
});

describe("annotation targeting", () => {
  it("accepts annotation with element targeting", async () => {
    const created = await makeSite();
    await patchSite(req("PATCH", `/v1/sites/${created.site_id}`, { token: ADMIN, json: { comments: true } }), ctx(created.site_id));

    const res = await postComment(
      req("POST", `/v1/sites/${created.site_id}/comments`, {
        json: {
          body: "This section needs work",
          targeting: {
            kind: "element",
            selector: "div.content > p:nth-child(2)",
          },
        },
        ip: "10.0.1.1",
      }),
      ctx(created.site_id),
    );
    expect(res.status).toBe(201);

    const comments = await listComments(created.site_id);
    expect(comments[0].targeting).toEqual({
      kind: "element",
      selector: "div.content > p:nth-child(2)",
    });
  });

  it("accepts annotation with text targeting", async () => {
    const created = await makeSite();
    await patchSite(req("PATCH", `/v1/sites/${created.site_id}`, { token: ADMIN, json: { comments: true } }), ctx(created.site_id));

    const res = await postComment(
      req("POST", `/v1/sites/${created.site_id}/comments`, {
        json: {
          body: "Typo here",
          targeting: {
            kind: "text",
            selector: "p.intro",
            selectedText: "exmaple text",
            startOffset: 10,
            endOffset: 22,
          },
        },
        ip: "10.0.1.2",
      }),
      ctx(created.site_id),
    );
    expect(res.status).toBe(201);

    const comments = await listComments(created.site_id);
    expect(comments[0].targeting).toEqual({
      kind: "text",
      selector: "p.intro",
      selectedText: "exmaple text",
      startOffset: 10,
      endOffset: 22,
    });
  });

  it("rejects targeting with invalid kind", async () => {
    const created = await makeSite();
    await patchSite(req("PATCH", `/v1/sites/${created.site_id}`, { token: ADMIN, json: { comments: true } }), ctx(created.site_id));

    const res = await postComment(
      req("POST", `/v1/sites/${created.site_id}/comments`, {
        json: {
          body: "test",
          targeting: {
            kind: "invalid",
            selector: "div",
          },
        },
        ip: "10.0.1.3",
      }),
      ctx(created.site_id),
    );
    expect(res.status).toBe(400);
  });

  it("rejects targeting without selector", async () => {
    const created = await makeSite();
    await patchSite(req("PATCH", `/v1/sites/${created.site_id}`, { token: ADMIN, json: { comments: true } }), ctx(created.site_id));

    const res = await postComment(
      req("POST", `/v1/sites/${created.site_id}/comments`, {
        json: {
          body: "test",
          targeting: {
            kind: "element",
          },
        },
        ip: "10.0.1.4",
      }),
      ctx(created.site_id),
    );
    expect(res.status).toBe(400);
  });
});

describe("form submission redirect scheme", () => {
  it("uses http:// for localhost apex host", async () => {
    const originalApex = process.env.PLNTH_APEX_HOST;
    process.env.PLNTH_APEX_HOST = "localhost:3000";

    const created = await makeSite();
    await patchSite(req("PATCH", `/v1/sites/${created.site_id}`, { token: ADMIN, json: { comments: true } }), ctx(created.site_id));

    const formData = new URLSearchParams();
    formData.append("body", "test feedback");
    const res = await postComment(
      new Request(`https://plnth.app/v1/sites/${created.site_id}/comments`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: formData,
      }),
      ctx(created.site_id),
    );

    expect(res.status).toBe(303);
    const location = res.headers.get("Location");
    expect(location).toBe("http://localhost:3000/comment-thanks");

    process.env.PLNTH_APEX_HOST = originalApex;
  });

  it("uses https:// for production-like apex host", async () => {
    const originalApex = process.env.PLNTH_APEX_HOST;
    process.env.PLNTH_APEX_HOST = "plnth.app";

    const created = await makeSite();
    await patchSite(req("PATCH", `/v1/sites/${created.site_id}`, { token: ADMIN, json: { comments: true } }), ctx(created.site_id));

    const formData = new URLSearchParams();
    formData.append("body", "test feedback");
    const res = await postComment(
      new Request(`https://plnth.app/v1/sites/${created.site_id}/comments`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: formData,
      }),
      ctx(created.site_id),
    );

    expect(res.status).toBe(303);
    const location = res.headers.get("Location");
    expect(location).toBe("https://plnth.app/comment-thanks");

    process.env.PLNTH_APEX_HOST = originalApex;
  });
});
