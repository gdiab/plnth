# Plnth — engineering spec (v1)

Status: drafted 2026-07-26 from the model-eval findings and the spec
discussion of the same date. Companion to `PRD.md` (product intent,
approved 2026-07-24). **Where this spec and the PRD conflict, this spec
wins** — every conflict is listed in [Supersedes](#supersedes) below; the
PRD should be revised to match in a follow-up pass.

Posture: this spec is **normative about architecture**, not just
behavior. The eval proved that a behavioral checklist produces four
different architectures with shared invariant-level flaws (origin
boundaries, atomicity, fail-closed defaults). This document pins the
architecture; implementer discretion is confined to code-level choices
inside these walls.

Provenance: evidence lines cite the eval record in
`model-eval/runs/plinth/` (verdict, two Codex reviews, four scorecards).

## 1. Origin architecture

**One Vercel project, two host classes, hard host-based routing.**

- **Portal + API:** `https://plnth.app` (apex only).
- **Artifacts:** `https://<id>.plnth.app` — one subdomain per site via
  the wildcard domain `*.plnth.app`. Nothing is registered per-site;
  Vercel mints per-subdomain certs on the fly. (Nameservers already
  point at Vercel DNS — done 2026-07-26.)
- Middleware resolves routing from the `Host` header. Portal/API routes
  answer **only** on the apex; artifact serving answers **only** on
  wildcard subdomains; **any unrecognized `Host` → 404**. This includes
  `*.vercel.app` deployment URLs, which additionally get Deployment
  Protection (Standard Protection / Vercel Authentication) turned on.

Why: different subdomains are different **origins** — artifact JS cannot
read portal DOM/storage/responses, and artifacts are isolated from each
other (this was the eval's biggest shared failure: fable-2 and kimi-2
each held only half of the origin story; Codex rated both Critical).

**Same-site residuals** (apex and subdomains share eTLD+1), closed
explicitly:

- All portal/session cookies use the `__Host-` prefix (host-locked by
  browser rule — kills cookie tossing from subdomains), plus `HttpOnly`,
  `Secure`, `SameSite=Lax`, `Path=/`.
- Every mutating portal/API route validates the `Origin` header against
  the apex (kills same-site request forgery; the API's bearer auth is
  immune by construction, but the check applies uniformly).
- Optional future hardening, not v1: move the wildcard to a separate
  registrable domain (`googleusercontent` pattern). DNS-only change.

**CSP sandbox as defense-in-depth, not the boundary.** Every artifact
response — main page, assets, password-protected pages, error pages —
carries `Content-Security-Policy: sandbox allow-scripts allow-forms
allow-modals allow-popups allow-downloads`. Unconditional: no per-type,
per-state, or per-request exceptions (fable-2's sandbox lapsed on
password-protected pages and assets; that lapse class is why the origin
boundary, not headers, carries the isolation).

## 2. Storage & consistency model

**Vercel Blob only** (private access mode). No second datastore in v1.

- **Immutable generations.** Every publish/replace writes a brand-new
  generation: `sites/<id>/g/<gen>/index.html` plus assets, where `<gen>`
  is a fresh ULID. Nothing under `g/` is ever overwritten. This kills
  the CDN-staleness class by construction (kimi-1's production failure:
  stale settings, lost asset writes on in-place overwrites).
- **One mutable object per site:** the pointer `sites/<id>/meta.json` —
  current generation id, settings (crawl, password hash, update_key
  hash), asset manifest, timestamps. Written **last**, after the
  generation is fully uploaded. A half-written generation is unreachable
  garbage, never a visible site.
- **Readers never `list()`.** Viewer path: `Host` → id → read pointer →
  fetch exactly the paths the pointer names. `list()` is exiled to admin
  listing and GC, where staleness is cosmetic. Pointer reads use
  `useCache: false` and responses `Cache-Control: no-store`; generation
  reads need no cache-busting (immutable paths cannot be stale).
- **Site ids are server-generated** (`word-word-suffix`: two curated
  wordlist entries plus 6 random base32 chars, ≈46 bits — lowercase,
  DNS-safe since they are subdomain labels; legacy 16-char random ids
  remain valid), never client-chosen, never reused. Create verifies the
  candidate id is unused — live or tombstone — and regenerates on
  collision (max 3), so never-reused holds by check as well as entropy.
  The original 80-bit ids made the create check-then-write race moot by
  entropy alone (fable-2, Codex High); the explicit check preserves that
  guarantee at 46 bits.
- **Concurrency model, stated:** pointer writes are last-writer-wins;
  all other state is immutable. The one surviving race — two concurrent
  writes to the same pointer — loses the earlier settings change and
  nothing else: no mixed generations, no partial state, no resurrection.
  Accepted for a single-admin tool and documented in the README.
  Settings changes (PATCH) rewrite only the pointer — one small PUT,
  never a multi-object saga.
- **Upgrade seam:** the pointer lives behind its own interface
  (`getPointer` / `setPointer` / `deletePointer`). If last-writer-wins
  ever stops being acceptable, a CAS-capable store (e.g. Upstash Redis)
  replaces that one implementation; content storage is untouched.

## 3. Delete & garbage collection

**Guarantee (spec-level, user-facing):** on DELETE, the URL dies
immediately; the bytes leave Blob within 24 hours. "Permanently delete"
means storage, not just reachability — revocability is the founding
feature (PRD problem statement).

- **Delete = tombstone, not sweep.** DELETE writes
  `meta.json = { deleted: true, deletedAt }` first; the site 404s the
  moment that single write lands. Every write path must refuse to write
  over a tombstone. (Kills the eval's resurrection race — Codex High on
  both run-2 artifacts.)
- **Liveness rule (the GC invariant):** a blob under
  `sites/<id>/g/<gen>/` is live iff site `<id>` has a non-tombstoned
  pointer naming `<gen>`. Everything else — failed publishes,
  superseded generations, deleted sites — is garbage.
- **Two mechanisms:**
  1. *Inline, best-effort:* after an update's pointer lands, delete the
     superseded generation; after a tombstone lands, delete the site's
     generations. Failures here are harmless.
  2. *Daily cron sweep (the invariant-keeper):* list `sites/`, delete
     anything unreferenced and older than the **24h grace window**.
     Safety rules: never collect anything younger than the grace window;
     re-read the pointer after listing, before deleting (TOCTOU guard).
     Hobby cron (daily) matches the guarantee window.
- **Tombstone lifecycle:** ids are never reused, so a tombstone only
  needs to outlive in-flight writes — the sweep collects tombstones
  older than the grace window. End state of a deleted site: zero
  objects.
- `list()` eventual consistency can only *delay* collection to the next
  sweep, never delete something live. That asymmetry is why GC may use
  `list()` while readers may not.

## 4. Serving: header & response matrix

Every response the service emits, all hosts: `X-Content-Type-Options:
nosniff` and a `Referrer-Policy: no-referrer`.

**Content types are server-derived** from a fixed extension→MIME map;
the client-supplied type is never echoed. Known-safe types (images, css,
js, fonts, json, txt, wasm, media, html, svg) serve normally; unknown
extensions serve as `application/octet-stream` +
`Content-Disposition: attachment`.

**HTML and SVG assets are allowed** (decided 2026-07-26): served with
nosniff + the mandatory sandbox CSP; per-artifact origins contain the
blast radius to the artifact itself, and this makes Plnth a multi-page
site host.

**Robots invariant (testable property, not a per-route checklist):**
when a site has crawl off, *every* HTTP response served from that
artifact's origin carries `X-Robots-Tag: noindex` — page, assets,
password gates (initial and failed), errors, redirects. HTML responses
also carry the meta tag. (kimi-2 missed the gate responses; kimi-1's
robots.txt missed a path form — the pattern was per-happy-path
implementation.)

- Crawl on: no noindex markers anywhere; per-origin `robots.txt` allows
  all.
- Crawl off: markers everywhere as above; `robots.txt` disallows `/`;
  excluded from any listing surface.
- **Password ⇒ noindex** (decided 2026-07-26): while a password is set,
  the crawl toggle is moot and the noindex invariant applies regardless
  of its value.
- Portal + API (`plnth.app`): always noindex, `robots.txt` disallow all.

**Password gate:** the initial gate response and failed attempts are
both `401` (kimi-1 served the first gate as 200), `Cache-Control:
no-store`, noindex per the invariant. Correct entry sets a per-artifact
`__Host-` HttpOnly cookie **bound to the current password hash**
(clearing/rotating the password invalidates outstanding cookies —
kimi-2's binding, adopted). The HTML never reaches the browser before
auth. Assets follow the same gating as their site.

## 5. Auth, abuse limits, and validation

- **Admin token:** single secret in an env var; compared
  hash-then-`timingSafeEqual` (no length leak via early return —
  fable-1/kimi-1 Low).
- **Per-site `update_key`** (PRD contract, kept): random secret returned
  once at creation, stored hashed, authorizes
  update/replace/settings/delete for that site only. Dead after delete.
- **Password hashing:** salted **async** scrypt. `scryptSync` is banned
  by name — every eval run blocked the event loop with it on an
  unauthenticated endpoint (Codex Medium ×2).
- **Rate limits (in-app, plan-independent):** password attempts 5/min
  per (IP × site) then `429` + `Retry-After`; credential failures on the
  API/portal 20/min per IP. In-memory per instance is acceptable — this
  is DoS mitigation, not bank-grade lockout.
- **Payload caps:** HTML ≤ 2 MB; per-asset ≤ 4 MB (platform body limit
  is 4.5 MB); ≤ 100 assets per site. Oversize → `413` with
  human-readable `detail`.
- **No client-controlled security switches.** No API field, header, or
  setting may weaken: CSP/sandbox, nosniff, cookie flags, Origin
  validation, robots-on-gate behavior, or rate limits (fable-2 shipped
  `sandbox: false` — Codex High). The only client-controlled
  security-adjacent settings are the two product features: crawl toggle
  and viewer password.
- **Strict body validation:** unknown fields and wrong types → `400`,
  never silently ignored (kimi-2 accepted `{"crawl": "false"}` as a
  no-op). Route params are re-validated before becoming storage
  prefixes even though ids are server-generated (defense-in-depth).
- Malformed percent-encoding in asset paths → `404`, never `500`
  (fable-2 Low).

## 6. API surface

The PRD's endpoint table stands (JSON over HTTPS, `{detail}` errors,
Lavish-compatible contract):

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/v1/sites` | admin | Create from `{html, password?}` → `{url, site_id, update_key, status}` |
| PUT | `/v1/sites/:id` | admin or update_key | Replace HTML (new generation) |
| PATCH | `/v1/sites/:id` | admin or update_key | Settings: `{crawl?, password?}` (pointer-only write) |
| DELETE | `/v1/sites/:id` | admin or update_key | Tombstone + GC; URL 404s immediately |
| GET | `/v1/sites` | admin | List: id, url, created, updated, crawl, has_password |
| GET | `/v1/sites/:id` | admin or update_key | Metadata for one site |
| POST | `/v1/sites/:id/assets` | admin or update_key | Upload asset (multipart) |

Notes: `url` in responses is the subdomain form
(`https://<id>.plnth.app`). Asset upload participates in the generation
model: an asset-only change still produces a new generation referencing
the unchanged HTML (no in-place writes, no exceptions).

## 7. Portal

`https://plnth.app/portal`, server-rendered, admin-token login → 
`__Host-` HttpOnly session cookie. Capabilities per the PRD: list,
open, replace, rename (display title override; empty clears back to
the HTML-derived title), crawl toggle, set/clear password, delete
with confirmation. Exhibit cards show a display title —
`customTitle ?? derivedTitle ?? siteId` — extracted from the HTML's
`<title>`/`<h1>` at create/replace time.

**Stored-XSS invariant (permanent):** artifact HTML renders only on
artifact origins. The portal never inlines or iframes artifact content
into portal markup — metadata and links only. Hostile titles/ids must
render inert (eval checklist item 8).

## 8. Failure policy

- **Fail closed on storage config.** In production, boot without
  `BLOB_READ_WRITE_TOKEN` is a hard error. No filesystem fallback
  outside local dev (kimi-1's production failure class; fable-2 carried
  the same latent risk — Codex Medium).
- Mid-publish failures leave only unreachable garbage (pointer-last),
  swept by GC. No partial site is ever servable.
- Local dev: `vercel dev` runs the full loop; fs storage driver is
  permitted **only** when explicitly selected by a dev-mode env var,
  never by absence of config.

## 9. Testing & CI (deliverable, not bonus)

Only 1 of 4 eval runs shipped tests unprompted; the winning stack won't
write them unless mandated. The suite is a deliverable:

1. **Invariant/property tests** (the layer models get wrong): pointer
   reachability (half-written generation never servable), tombstone
   refusal, GC safety (never collects the live generation or inside the
   grace window), the robots invariant of §4, content-type mapping incl.
   unknown extensions, path traversal rejection, strict validation.
2. **Behavioral tests** mirroring the PRD's 10 acceptance criteria (the
   eval checklist graduates into the regression suite).
3. **Security tests:** 401 matrix, timing-safe compare, limiter (429 on
   the 6th attempt), `__Host-` cookie attributes, Origin-validation
   rejection, sandbox header present on every artifact response class.
4. **CI gate:** tests green before any production deploy (GitHub
   Actions, prebuilt-deploy pattern). "Done" means deployed *and* green.

## 10. Banned patterns (quick reference)

`scryptSync` · client-controlled security switches · fs fallback by
config absence · in-place blob overwrites · reader-path `list()` ·
client-supplied MIME echo · length-leaking token compare · silent
unknown-field acceptance · portal cookies without `__Host-` ·
delete without tombstone.

## Supersedes

Where this spec overrides `PRD.md` (PRD revision pending):

| PRD says | This spec says | Why |
|---|---|---|
| Path routing `/s/<id>`, single origin, "revisit only if untrusted HTML becomes a use case" | Per-artifact origins `<id>.plnth.app` + apex portal | Eval run 2: both stacks' Critical findings were origin-boundary failures; structural isolation beats header discipline |
| Redis (Upstash) metadata + Blob content | Blob-only; pointer `meta.json`, CAS seam for later | One storage system; races confined to one object; Redis reserved as the pointer-CAS upgrade |
| "No CSP that would break inline scripts" | Unconditional sandbox CSP on artifact origins (allow-scripts keeps inline JS working) | Defense-in-depth behind the origin boundary; sandbox does not break self-authored pages |
| HTML ≤ 5 MB, assets ≤ 10 MB | HTML ≤ 2 MB, assets ≤ 4 MB, ≤ 100/site | Platform body limit is 4.5 MB; explicit numbers, `413` behavior |
| Delete removes hash/index/blobs directly | Tombstone-first + 24h GC guarantee | Kills resurrection/orphan races; makes "permanently delete" a storage guarantee |
| No versioning (replace destructive) | Immutable generations internally; still no user-facing versioning | Consistency mechanism, not a product feature; replace remains destructive at the API |
| Default `*.vercel.app` domain until later | `plnth.app` + wildcard from day one (nameservers already set) | The origin architecture is the security model; deployment URLs get 404 + Deployment Protection |

Unchanged from the PRD and in force: problem statement, goals/non-goals,
single-operator model, admin token + update_key split, Lavish
compatibility contract, endpoint table, portal capabilities and
stored-XSS invariant, CLI-as-repo-script, acceptance criteria 1–10,
adoption flow from the eval (fable-2 base; port kimi-2's fail-closed
storage and HttpOnly session per the verdict's adoption note).
