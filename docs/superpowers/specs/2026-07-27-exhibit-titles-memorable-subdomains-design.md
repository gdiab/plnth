# Exhibit titles + memorable subdomains

**Date:** 2026-07-27
**Status:** Approved

## Problem

Artifacts on plnth get a random 16-char base32 subdomain, and the curator's
portal shows only that id per exhibit card. Nothing identifies what an
artifact *is*, so the portal is unusable for telling sites apart. Subdomains
are equally opaque.

## Decisions (made with George)

1. Identifying info lives in **both** places: extracted titles on portal
   cards, and memorable — but content-neutral — subdomains for new sites.
   Descriptive (title-derived) subdomains were rejected: subdomains leak into
   DNS queries, CT logs, and browser history, so they must not reveal content.
2. Card titles are **derived but editable**: auto-extracted from the HTML,
   with a portal rename control whose override survives HTML replacement.
3. Subdomain entropy tradeoff accepted: ~46 bits (word-word + 6-char suffix)
   instead of today's 80 bits. Unlisted-URL secrecy still holds at practical
   attack rates.

## Design

### 1. Data model (`lib/pointer.ts`)

`LivePointer` gains:

- `derivedTitle: string | null` — extracted from the HTML on every
  create/replace.
- `customTitle?: string` — set via portal rename; survives replacement.

Display title everywhere = `customTitle ?? derivedTitle ?? siteId`.

### 2. Title extraction

On create and replace, extract from the uploaded HTML:

- First `<title>…</title>` content: entity-decoded, whitespace-collapsed,
  trimmed, capped at 120 chars.
- Fallback: first `<h1>…</h1>` (tags stripped), same normalization.
- Else `null`.

Plain regex — no HTML-parser dependency.

**Lazy backfill:** when the portal lists a site whose pointer predates
`derivedTitle` (field `undefined`, not `null`), read the stored HTML once,
extract, and rewrite the pointer. Self-healing, one write per legacy site,
no migration script.

### 3. Memorable subdomains (`lib/id.ts`, `lib/id-validate.ts`)

`newSiteId()` returns `word-word-suffix`, e.g. `amber-fox-3kj9w7`:

- Two words from curated wordlists (~256 each): short, concrete, lowercase
  a–z only, DNS-safe, no ambiguous or unpleasant words.
- 6-char suffix from the existing Crockford-base32 alphabet.
- Entropy ≈ 8 + 8 + 30 = 46 bits.

Create performs a pointer-existence check (live **or** tombstone) and
regenerates on collision, max 3 attempts — "never reused" (SPEC §2) now
holds by check, not just by entropy. Create is rare and admin-only, so the
read-before-write is acceptable; SPEC §2's "eliminates check-then-write"
note is updated.

`isValidSiteId` accepts **both** formats (legacy 16-char and new
word-word-suffix). Existing sites keep their ids. Label stays well under
DNS's 63-char limit.

### 4. Portal UI (`app/portal/page.tsx`, `app/portal/actions`)

- Card header stays `EXHIBIT <id>`.
- The `<h2>` link text becomes the display title (serif gallery voice); the
  site URL moves into the mono meta line beneath.
- New `Rename` `<details>` section per card: text input posts a `rename`
  action; empty input clears `customTitle` (falls back to derived).
- `rename` action added to `/portal/actions` (same session auth + origin
  checks as existing actions).

### 5. API (`lib/api.ts`)

`siteJson` adds `title` (the display title). No new request fields — the
wire format Lavish uses is untouched; its `<title>` tag flows through
extraction.

### 6. Testing

- Extraction: no title, entities, nested/whitespace, >120 chars, `<h1>`
  fallback, neither present.
- Ids: new format shape, both formats validate, invalid shapes rejected,
  collision retry (mock storage with a planted pointer).
- Rename: auth required, sets override, empty clears, survives replace.
- Portal: card shows title, falls back to id; lazy backfill writes pointer
  exactly once.
- `siteJson` includes `title`.

## Out of scope

- Client-supplied titles in the create API (YAGNI — extraction covers it).
- Renaming/migrating existing sites' subdomains.
- Descriptive subdomains (rejected, privacy).
