# plnth

Personal HTML artifact host. POST an HTML file to the API, get back a live
public URL on infrastructure you own — with real delete, per-site crawl
control, and per-site viewer passwords.

- Portal + API: `https://plnth.app`
- Artifacts: `https://<site_id>.plnth.app` — one origin per site

Governing docs: [`PRD.md`](PRD.md) (product intent) and [`SPEC.md`](SPEC.md)
(binding architecture — origins, storage model, delete/GC guarantees,
security posture).

## How it works

- **Storage:** Vercel Blob only (private store). Every publish writes an
  immutable *generation* (`sites/<id>/g/<gen>/…`); one mutable pointer per
  site (`sites/<id>/meta.json`) is written last, so a half-finished publish
  is unreachable garbage, never a visible site.
- **Delete:** tombstone-first. The URL 404s the moment the tombstone lands;
  a daily GC sweep guarantees the bytes leave Blob within 24 hours.
- **Isolation:** every artifact lives on its own origin (subdomain), so
  artifact JS can't touch the portal or other artifacts. All artifact
  responses additionally carry a sandbox CSP as defense-in-depth.
- **Concurrency:** pointer writes are last-writer-wins. Two concurrent
  settings changes to the same site can lose the earlier one — and nothing
  else (no mixed generations, no partial state). Accepted for a
  single-admin tool.

## Setup

1. Vercel project (`plnth`, team "G's projects") with domains `plnth.app` +
   `*.plnth.app`, a **private** Blob store connected
   (`BLOB_READ_WRITE_TOKEN`), and Deployment Protection (Standard) so
   `*.vercel.app` URLs are gated.
2. Env vars (Production + Preview + Development):
   - `BLOB_READ_WRITE_TOKEN` — added automatically by the store connection
   - `PLNTH_ADMIN_TOKEN` — the admin bearer token (≥16 chars; generate with
     `openssl rand -base64 32`)
   - `PLNTH_APEX_HOST` — `plnth.app` in production; `localhost:3000` for
     local dev
   - `CRON_SECRET` — authorizes the daily GC cron (≥16 chars)
3. `npm install`

## Local dev

```sh
vercel env pull            # writes .env.local (gitignored)
npm run dev                # or: vercel dev
```

Set `PLNTH_APEX_HOST=localhost:3000` in `.env.local`. Artifacts are served
at `http://<site_id>.localhost:3000` (browsers resolve `*.localhost` to
loopback). The real Blob store is used via the pulled token; to run without
network, set `PLNTH_STORAGE=fs` (explicit opt-in; refused in production).

## Deploy

CI (GitHub Actions) runs tests and typecheck on every push; pushes to
`main` deploy to production only after tests pass (prebuilt deploy).
Manual deploy: `vercel --prod`.

## API

Auth: `Authorization: Bearer <token>` where token is the **admin token**
(everything) or a site's **update_key** (that site only, returned once at
creation). Errors are `{"detail": "human-readable message"}`.

Set for the examples:

```sh
BASE=https://plnth.app
TOKEN=<admin token or update_key>
```

**Create** (admin only) — body `{html, password?}`:

```sh
curl -s -X POST "$BASE/v1/sites" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "$(jq -n --rawfile html page.html '{html: $html}')"
# → {"url":"https://<id>.plnth.app","site_id":"<id>","update_key":"puk_…","status":"created"}
```

**List** (admin only):

```sh
curl -s "$BASE/v1/sites" -H "Authorization: Bearer $TOKEN"
```

**Get one:**

```sh
curl -s "$BASE/v1/sites/$ID" -H "Authorization: Bearer $TOKEN"
```

**Replace HTML** (new generation; assets carry forward):

```sh
curl -s -X PUT "$BASE/v1/sites/$ID" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "$(jq -n --rawfile html page.html '{html: $html}')"
```

**Settings** — `{crawl?: bool, password?: string|null, comments?: bool}` (null clears password):

```sh
curl -s -X PATCH "$BASE/v1/sites/$ID" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"crawl": true}'
curl -s -X PATCH "$BASE/v1/sites/$ID" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"password": null}'
curl -s -X PATCH "$BASE/v1/sites/$ID" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"comments": true}'
```

**Upload asset** (multipart; `path` optional, defaults to the file name):

```sh
curl -s -X POST "$BASE/v1/sites/$ID/assets" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@images/logo.png" -F "path=images/logo.png"
```

**Delete** (permanent — URL dies immediately, bytes leave Blob within 24h):

```sh
curl -s -X DELETE "$BASE/v1/sites/$ID" -H "Authorization: Bearer $TOKEN"
```

## Comments/Feedback

Sites can optionally collect in-page feedback via a public comment endpoint.
Enable comments via the `comments` setting (off by default):

```sh
curl -s -X PATCH "$BASE/v1/sites/$ID" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"comments": true}'
```

When enabled:
- A feedback strip appears at the bottom of the artifact page (works under
  the sandbox CSP via classic form POST)
- Public users can submit comments via `POST /v1/sites/:id/comments`
  (JSON `{name?: string, body: string}` or form data, no auth required)
- Comments appear in the portal (admin-only, metadata/text display, never
  rendered as HTML)
- Rate limited: 10 submissions per hour per IP
- Stored as append-only Blob objects at `sites/<id>/comments/<ulid>.json`

**Run GC now** (admin token or `CRON_SECRET`):

```sh
curl -s "$BASE/api/gc" -H "Authorization: Bearer $TOKEN"
```

## CLI

`cli/plnth` wraps the API (`chmod +x cli/plnth`; needs Node 20+):

```sh
export PLNTH_URL=https://plnth.app
export PLNTH_TOKEN=<admin token>

cli/plnth publish page.html            # → prints the live URL
cli/plnth list
cli/plnth update <site_id> page.html
cli/plnth crawl <site_id> on
cli/plnth password <site_id> hunter2
cli/plnth password <site_id> --clear
cli/plnth asset <site_id> images/logo.png
cli/plnth delete <site_id> --yes
```

## Lavish

Configuration, not code:

```sh
export LAVISH_AXI_HTML_APP_API_URL="https://plnth.app"
export LAVISH_AXI_HTML_APP_TOKEN="<admin token>"
```

`lavish-axi share` then publishes here.

## Portal

`https://plnth.app/portal` — log in with the admin token. List, open,
replace, crawl toggle, set/clear password, delete with confirmation. The
portal renders metadata and links only; artifact HTML renders exclusively
on artifact origins (permanent stored-XSS rule).

## Tests

```sh
npm test          # invariant, behavioral, and security suites
npm run typecheck
```
