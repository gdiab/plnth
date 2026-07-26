# Plnth build plan

Governing docs: `SPEC.md` (binding architecture), `PRD.md` (product intent).
Provisioning done 2026-07-26: private repo `gdiab/plnth`, Vercel project
`plnth` (G's projects / hobby team), domains `plnth.app` + `*.plnth.app`
attached & verified, private Blob store `plnth` connected
(`BLOB_READ_WRITE_TOKEN` in all envs), Deployment Protection = Standard.
Outstanding: GitHub↔Vercel git connect needs a one-time Vercel GitHub App
grant for `gdiab/plnth` (George action); CLI deploys until then.

## Build order

- [ ] 1. Scaffold: Next.js (App Router, TS), vitest, next.config
      (`skipTrailingSlashRedirect`), minimal shell. Commit.
- [ ] 2. Storage seam: `StorageBackend` (put/get/del/list) — blob driver
      (private), fs driver behind explicit `PLNTH_STORAGE=fs` dev flag,
      memory driver for tests. Fail closed in prod without token.
- [ ] 3. Core libs: `id` (lowercase DNS-safe ULID-ish), `mime` (fixed map,
      unknown → octet-stream+attachment), `headers` (sandbox CSP, nosniff,
      referrer, robots), `pointer` (get/set/deletePointer seam).
- [ ] 4. Domain layer `lib/sites.ts`: immutable generations, pointer-last,
      tombstone refusal, inline GC. Invariant tests alongside.
- [ ] 5. Auth/password/ratelimit: timingSafeEqual admin compare, update_key
      mint/verify, Origin validation, async scrypt (scryptSync banned),
      limiter 5/min pw per IP×site + 20/min creds per IP.
- [ ] 6. Middleware: Host → apex | wildcard | 404 (incl. vercel.app hosts).
- [ ] 7. API `/v1/sites` CRUD + assets: {detail} errors, strict validation,
      413 caps (2MB html / 4MB asset / 100 assets), 401 matrix.
- [ ] 8. Artifact serving: viewer + assets from pointer paths, password
      gate (401, no-store, cookie bound to pw hash), robots invariant on
      every response class, unconditional sandbox CSP.
- [ ] 9. Portal: login → __Host- session, list + actions, stored-XSS
      invariant (metadata/links only).
- [ ] 10. GC cron (daily): grace window, TOCTOU re-read, tombstone
      collection. vercel.json cron.
- [ ] 11. CLI `plnth` script + README (curl for every op).
- [ ] 12. CI: tests gate prebuilt prod deploy. vercel dev full loop.
- [ ] 13. Prod deploy → 10 acceptance criteria → gitleaks → flip public.

## Review (2026-07-26)

Built and verified 1–12; 13 partially blocked on DNS.

- 117 tests green (invariant/behavioral/security per SPEC §9), typecheck clean.
- Full loop verified locally via dev server against the **real private Blob
  store**: create → subdomain view (sandbox CSP, nosniff, noindex header +
  meta, robots.txt) → crawl toggle → asset upload via update_key → password
  gate (401/303/cookie/rotation) → portal login + list → delete via
  update_key → URL 404s, key dead. Blob end-state: tombstone only.
- CI green on GitHub (test job runs; deploy job skips until VERCEL_TOKEN).
- Production deployed via CLI (framework preset fixed to nextjs);
  deployment URLs gated by Standard Protection (302).
- gitleaks: 16 commits scanned, no leaks. Repo stays private until the
  production acceptance run passes.

**Blocked on George:**
1. Namecheap: plnth.app NS → `ns1.vercel-dns.com` / `ns2.vercel-dns.com`
   (public delegation still `registrar-servers.com`; no cert can mint, so
   plnth.app is unreachable — acceptance 1–10 can't run until this lands).
2. Vercel dashboard → Account Settings → Tokens: create token (scope
   G's projects), then `gh secret set VERCEL_TOKEN -R gdiab/plnth`.
3. (Optional) grant the Vercel GitHub App access to gdiab/plnth for
   git-push deploys; CI prebuilt deploys cover this once (2) is done.

**Next session:** re-run acceptance 1–10 against https://plnth.app incl.
`lavish-axi share`, verify cron GC in prod, then flip the repo public.

Deviations from plan: none architectural. Notable fix: App Router treats
`_`-prefixed folders as private — internal artifact route lives at
`app/artifact/` (blocked by path on the apex), not `app/_artifact/`.
