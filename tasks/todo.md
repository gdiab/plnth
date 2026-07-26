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

## Review

(appended as work completes)
