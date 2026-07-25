# Plinth — personal HTML artifact host

A plinth is the pedestal you set an object on to display it. This service is
that pedestal for agent-generated HTML: it doesn't make the artifacts, it
stands under them and shows them.

Status: PRD approved 2026-07-24. No implementation in this repo yet; see
[Relationship to the model eval](#relationship-to-the-model-eval).

## Problem

Agent-generated HTML artifacts (Lavish review surfaces, reports, diagrams,
one-off widgets) need a publish target. The existing option, ht-ml.app, has
the right primitive and the wrong trust model: anonymous third-party
operator, public-forever pages, no real delete. George wants the same
one-POST publish loop with ownership: publishing locked to him, real
deletion, per-site crawl and password control, running on infrastructure he
controls.

## Goals

- One-call publish: POST HTML, get back a live public URL.
- Full ownership: every site listable, replaceable, and permanently
  deletable from a management portal. Deleted means the URL returns 404.
- Lavish compatibility: `lavish-axi share` publishes here by setting
  `LAVISH_AXI_HTML_APP_API_URL` and `LAVISH_AXI_HTML_APP_TOKEN`. No fork,
  no client patch.
- Zero-ops: deploys on Vercel using Vercel-native/marketplace primitives
  only.

## Non-goals

- No multi-user, no signup, no sharing of the admin role. Single-operator
  by construction, permanently.
- No content-safety scanning. All content is self-authored or
  agent-authored under the operator's direction.
- No analytics, view counts, or custom domains per site in v1.
- No versioning/rollback of site content in v1 (replace is destructive).

## URL scheme

Path routing on a single domain: `https://<host>/s/<id>`. Works on the
default `*.vercel.app` domain immediately; a custom domain can be attached
later without changing the scheme.

Accepted trade-off: all sites share one origin (cookies/localStorage are
per-origin, not per-site). Acceptable for single-user, self-authored
artifacts. Revisit only if untrusted third-party HTML ever becomes a use
case, which is currently a non-goal.

Site IDs are short random slugs (10+ chars, unambiguous alphabet), not
sequential, so URLs are not enumerable.

## API

All endpoints are JSON over HTTPS. Two credentials exist:

- **Admin token** — single secret in an env var. Authorizes everything.
- **Per-site update_key** — random secret returned once at site creation.
  Authorizes update/replace/delete/settings for that one site only.

This split is what makes the Lavish contract work (the Lavish client holds
only update_keys, never the admin token) and gives per-site revocability
for free: delete the site and its key is dead.

### Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/v1/sites` | admin token | Create site from `{html, password?}`. Returns `{url, site_id, update_key, status}`. |
| PUT | `/v1/sites/:id` | admin or update_key | Replace the site's HTML. |
| PATCH | `/v1/sites/:id` | admin or update_key | Settings: `{crawl?: bool, password?: string \| null}`. |
| DELETE | `/v1/sites/:id` | admin or update_key | Permanently delete blobs and metadata. URL 404s afterward. |
| GET | `/v1/sites` | admin token | List all sites: id, url, created, updated, crawl flag, has_password. |
| GET | `/v1/sites/:id` | admin or update_key | Metadata for one site. |
| POST | `/v1/sites/:id/assets` | admin or update_key | Upload an asset (multipart). Served at `/s/:id/assets/<name>`. |

Deliberate deviation from ht-ml.app: their `POST /v1/sites` treats the
bearer token as optional (anonymous publish allowed). Plinth requires the
admin token on create — publishing locked to the operator is the core
requirement. The Lavish client already sends the token when
`LAVISH_AXI_HTML_APP_TOKEN` is set, so compatibility is unaffected.

Error responses use `{detail: "..."}` with conventional status codes
(401 bad/missing credential, 404 unknown site, 413 payload too large).
The Lavish client surfaces `detail` verbatim, so error text should be
human-readable.

### Payload limits

Single HTML document up to 5 MB; assets up to 10 MB each. Limits exist to
catch mistakes (an agent POSTing a video), not to meter usage.

## View path

`GET /s/:id`:

1. Redis metadata lookup. Unknown or deleted id → 404.
2. If a password is set: serve a minimal password form. Correct entry sets
   a per-site httpOnly cookie; the HTML never reaches the browser before
   that. Password checks compare against a stored hash.
3. Stream the HTML from Blob.
4. If crawl is off (the default for new sites): inject
   `<meta name="robots" content="noindex">` and send `X-Robots-Tag:
   noindex` on the response. Crawl-off sites are also excluded from any
   listing surface. When crawl is on, neither marker is present.

Artifacts are trusted (self-authored), so no HTML sanitization and no CSP
that would break inline scripts. Responses do set `X-Content-Type-Options:
nosniff` and a `Referrer-Policy`.

Assets under `/s/:id/assets/<name>` follow the same gating as their site
(password, 404-after-delete).

## Portal

`/portal`, server-rendered, gated by the admin token: entered once into a
login form, then held in an httpOnly session cookie. Capabilities:

- List all sites with created/updated dates, crawl flag, password flag.
- Per-site actions: open (new tab), replace HTML (paste or file upload),
  toggle crawl, set/clear password, delete with confirmation.

**Design invariant (stored-XSS rule):** artifact HTML renders only on
`/s/:id`. The portal never inlines, previews via iframe on the same
document, or otherwise renders artifact content inside portal markup. The
portal shows metadata and links only. This is carried over from the eval's
judge checklist as a permanent rule, not a v1 shortcut.

## Data model

- **Redis** (Upstash marketplace store) — `site:<id>` hash: created_at,
  updated_at, crawl flag, password hash (empty when unset), update_key
  hash, html blob key, asset blob keys. Plus a `sites` index set for
  listing.
- **Vercel Blob** — `sites/<id>/index.html` and `sites/<id>/assets/*`.

Secrets at rest: the admin token lives only in an env var; update_keys and
passwords are stored hashed. A lost update_key is unrecoverable by design
(admin token still controls the site).

Delete removes the Redis hash, the index entry, and all blobs. There is no
soft-delete tier; "permanently delete" in the portal means it.

## CLI

A small `plinth` script in this repo (publish / update / delete / list /
toggle / password) wrapping the API, reading `PLINTH_URL` and
`PLINTH_TOKEN` from the environment. The README documents equivalent raw
`curl` calls for every operation, so the CLI is a convenience, not a
dependency.

Lavish integration is configuration, not code:

```sh
export LAVISH_AXI_HTML_APP_API_URL="https://<host>"
export LAVISH_AXI_HTML_APP_TOKEN="<admin token>"
```

## Deployment

Vercel project named `plinth` under George's "G's Hobby" team. Default
`*.vercel.app` domain until a custom domain is chosen (attachable later
without changing the URL scheme). Secrets via environment variables,
never in code.
`vercel dev` must run the full loop locally (publish, view, portal,
delete) for development and for eval judging. The Upstash store and Blob
store are provisioned through the Vercel dashboard/marketplace; setup
steps belong in the README.

## Acceptance criteria

The eval task's 8-point functional checklist, verbatim:

1. Deploys/runs with documented steps; secrets via env vars, not code.
2. POST without token → 401; with token → live URL returned.
3. Update and delete work; deleted URL returns 404 (actually gone).
4. Portal lists sites, is auth-gated, all actions work from it.
5. Crawl toggle off → noindex meta AND X-Robots-Tag header present.
6. Password-protected site blocks rendering until correct password.
7. Asset upload works and pages reference assets correctly.
8. No stored-XSS foot-gun in the portal itself (artifact HTML is served
   on the public route, never rendered inside the portal page).

Plus two Plinth-specific checks:

9. `lavish-axi share` against the deployed host publishes successfully
   with only the two env vars set, and the returned URL renders.
10. A site can be updated using only its update_key (no admin token), and
    that key stops working after the site is deleted.

## Relationship to the model eval

This PRD describes the real product. The model-eval task
(`model-eval/tasks/mvp-artifact-host.md`) keeps its deliberately
ambiguous verbatim prompt — part of what it measures is how each model
handles ambiguity, so this PRD must not leak into the eval runs.

Implementations arrive as eval runs (2+ per model). The winning run is
adopted into this repo and reshaped to this PRD before shipping. Where a
winning implementation and this PRD disagree, the PRD wins; divergences
are expected and are resolved as part of adoption, not silently kept.

## Open questions

None. Both initial open questions were resolved 2026-07-24: deployment
target is the `plinth` project under the "G's Hobby" Vercel team (see
Deployment), and the CLI stays a repo script — npm packaging is out of
scope for v1 (revisit after v1 ships if ever).
