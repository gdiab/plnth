# Exhibit Titles + Memorable Subdomains Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Portal exhibit cards show a human title (derived from the HTML, editable), and new sites get memorable content-neutral subdomains like `amber-fox-3kj9w7`.

**Architecture:** Title extraction is a pure function in a new `lib/title.ts`; `LivePointer` gains `derivedTitle`/`customTitle`; `newSiteId()` composes two curated wordlists plus a 6-char base32 suffix, with a create-time collision check; the portal lists a display title and gains a `rename` action; legacy pointers self-heal (lazy backfill) on listing.

**Tech Stack:** Next.js App Router (route handlers, RSC portal page), TypeScript, vitest (`npm test` = `vitest run`), in-memory storage backend for tests.

**Spec:** `docs/superpowers/specs/2026-07-27-exhibit-titles-memorable-subdomains-design.md`

## Global Constraints

- Titles: entity-decoded, whitespace-collapsed, trimmed, capped at **120 chars**; `<title>` first, `<h1>` fallback, else `null`. Plain regex, **no HTML-parser dependency**.
- Display title everywhere = `customTitle ?? derivedTitle ?? siteId`.
- New id format: `word-word-suffix`, words from two lists of **exactly 256** (a–z only, 3–8 chars), suffix = 6 chars of the existing Crockford base32 alphabet (≈46 bits).
- `isValidSiteId` accepts **both** legacy (`/^[a-z][0-9a-z]{5,31}$/`) and new format. `lib/id-validate.ts` stays edge-safe: regex only, no node built-ins, no wordlist import.
- Create checks pointer existence (live **or** tombstone) and regenerates on collision, max 3 attempts.
- Stored-XSS invariant (SPEC §7): portal renders titles through JSX only — never `dangerouslySetInnerHTML`.
- Lazy backfill must **not** change `updatedAt` and must write the pointer at most once per legacy site.
- Wire format for create/replace is untouched — no new request fields.
- Tests: run with `npx vitest run <file>` for a single file, `npm test` for the suite.

---

### Task 1: Title extraction (`lib/title.ts`)

**Files:**
- Create: `lib/title.ts`
- Create: `tests/title.test.ts`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces:
  - `extractTitle(html: string): string | null`
  - `displayTitle(p: { siteId: string; derivedTitle?: string | null; customTitle?: string }): string`
  - `MAX_TITLE_CHARS = 120`
  - `normalizeTitle(raw: string): string | null` (exported for reuse by rename in Task 4)

- [ ] **Step 1: Write the failing tests**

Create `tests/title.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MAX_TITLE_CHARS, displayTitle, extractTitle, normalizeTitle } from "@/lib/title";

describe("extractTitle", () => {
  it("takes the first <title> content", () => {
    expect(extractTitle("<html><head><title>Q2 Comp Review</title></head><body><h1>Nope</h1></body></html>")).toBe(
      "Q2 Comp Review",
    );
  });

  it("is case-insensitive and tolerates attributes on the tag", () => {
    expect(extractTitle('<TITLE data-x="1">Hello</TITLE>')).toBe("Hello");
  });

  it("decodes entities (named, decimal, hex)", () => {
    expect(extractTitle("<title>Fish &amp; Chips &#8212; menu &#x2603;</title>")).toBe("Fish & Chips — menu ☃");
  });

  it("collapses whitespace and trims", () => {
    expect(extractTitle("<title>\n  spaced   \t out  \n</title>")).toBe("spaced out");
  });

  it("caps at 120 chars", () => {
    const long = "word ".repeat(60);
    const result = extractTitle(`<title>${long}</title>`)!;
    expect(result.length).toBeLessThanOrEqual(MAX_TITLE_CHARS);
    expect(result.startsWith("word word")).toBe(true);
    expect(result.endsWith(" ")).toBe(false);
  });

  it("falls back to the first <h1>, stripping inner tags", () => {
    expect(extractTitle('<body><h1 class="x">The <em>Big</em> Plan</h1><h1>second</h1></body>')).toBe("The Big Plan");
  });

  it("empty/whitespace-only <title> falls through to <h1>", () => {
    expect(extractTitle("<title>   </title><h1>Fallback</h1>")).toBe("Fallback");
  });

  it("returns null when neither is present or both are empty", () => {
    expect(extractTitle("<p>plain</p>")).toBeNull();
    expect(extractTitle("<title></title><h1>  </h1>")).toBeNull();
  });
});

describe("normalizeTitle", () => {
  it("null for empty, trims and collapses otherwise", () => {
    expect(normalizeTitle("   ")).toBeNull();
    expect(normalizeTitle(" a  b ")).toBe("a b");
  });
});

describe("displayTitle", () => {
  const base = { siteId: "amber-fox-3kj9w7" };
  it("prefers customTitle, then derivedTitle, then siteId", () => {
    expect(displayTitle({ ...base, derivedTitle: "Derived", customTitle: "Custom" })).toBe("Custom");
    expect(displayTitle({ ...base, derivedTitle: "Derived" })).toBe("Derived");
    expect(displayTitle({ ...base, derivedTitle: null })).toBe("amber-fox-3kj9w7");
    expect(displayTitle(base)).toBe("amber-fox-3kj9w7");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/title.test.ts`
Expected: FAIL — cannot resolve `@/lib/title`.

- [ ] **Step 3: Implement `lib/title.ts`**

```ts
/**
 * Exhibit titles (spec: 2026-07-27-exhibit-titles-memorable-subdomains).
 * Extraction is intentionally regex-based — good enough for "identify this
 * artifact", with no HTML-parser dependency.
 */

export const MAX_TITLE_CHARS = 120;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const hex = body[1] === "x" || body[1] === "X";
      const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Strip tags, decode entities, collapse whitespace, trim, cap. Null when nothing remains. */
export function normalizeTitle(raw: string): string | null {
  const text = decodeEntities(raw.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.length > MAX_TITLE_CHARS ? text.slice(0, MAX_TITLE_CHARS).trimEnd() : text;
}

/** First <title>, else first <h1>, else null. */
export function extractTitle(html: string): string | null {
  const title = /<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i.exec(html);
  const fromTitle = title ? normalizeTitle(title[1]) : null;
  if (fromTitle) return fromTitle;
  const h1 = /<h1(?:\s[^>]*)?>([\s\S]*?)<\/h1>/i.exec(html);
  return h1 ? normalizeTitle(h1[1]) : null;
}

/** The one display rule (spec §1): custom beats derived beats id. */
export function displayTitle(p: { siteId: string; derivedTitle?: string | null; customTitle?: string }): string {
  return p.customTitle ?? p.derivedTitle ?? p.siteId;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/title.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add lib/title.ts tests/title.test.ts
git commit -m "Add title extraction and display-title rule"
```

---

### Task 2: Wordlists + memorable `newSiteId` + dual-format validation

**Files:**
- Create: `lib/words.ts`
- Modify: `lib/id.ts` (replace `newSiteId`)
- Modify: `lib/id-validate.ts` (accept both formats)
- Modify: `tests/core-libs.test.ts` (`describe("ids")` block)

**Interfaces:**
- Consumes: `encodeRandom` (already in `lib/id.ts`), `randomBytes` (node:crypto).
- Produces:
  - `ADJECTIVES: readonly string[]`, `NOUNS: readonly string[]` (exactly 256 each) from `lib/words.ts`
  - `newSiteId(): string` now returns `word-word-xxxxxx`
  - `isValidSiteId(id)` true for both legacy and new formats

- [ ] **Step 1: Update the id tests to the new format (they will fail first)**

In `tests/core-libs.test.ts`, replace the entire `describe("ids", ...)` block with:

```ts
import { ADJECTIVES, NOUNS } from "@/lib/words";

describe("ids", () => {
  it("site ids are word-word-suffix DNS-safe labels and pass their own validator", () => {
    for (let i = 0; i < 200; i++) {
      const id = newSiteId();
      expect(id).toMatch(/^[a-z]{3,8}-[a-z]{3,8}-[0-9a-z]{6}$/);
      expect(id.length).toBeLessThanOrEqual(63);
      expect(isValidSiteId(id)).toBe(true);
    }
  });

  it("wordlists are exactly 256 clean lowercase words each (no modulo bias, DNS-safe)", () => {
    for (const list of [ADJECTIVES, NOUNS]) {
      expect(list.length).toBe(256);
      expect(new Set(list).size).toBe(256);
      for (const word of list) expect(word).toMatch(/^[a-z]{3,8}$/);
    }
  });

  it("site ids never collide in a small sample", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newSiteId()));
    expect(ids.size).toBe(1000);
  });

  it("legacy 16-char ids still validate", () => {
    expect(isValidSiteId("ftw90c85m0dpsjkq")).toBe(true);
  });

  it("generation ids sort chronologically across time", () => {
    const a = newGenerationId();
    const b = newGenerationId();
    expect(isValidGenerationId(a)).toBe(true);
    // Same-millisecond ids may tie on prefix; ordering only needs to hold across time.
    expect(a.slice(0, 10) <= b.slice(0, 10)).toBe(true);
  });

  it("validator rejects traversal, uppercase, and non-label shapes", () => {
    const bad = [
      "", "..", "a/../b", "UPPER", "1starts-with-digit", "has space", "a.b", "-dash",
      "a".repeat(40), "amber-fox", "amber-fox-", "amber-fox-3kj9w7-extra", "amber--3kj9w7",
      "Amber-Fox-3kj9w7", "amber-fox-3kj9", "amber_fox_3kj9w7",
    ];
    for (const b of bad) expect(isValidSiteId(b)).toBe(false);
  });
});
```

(Keep the existing top-of-file imports; add the `ADJECTIVES, NOUNS` import alongside them.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/core-libs.test.ts`
Expected: FAIL — `@/lib/words` unresolved; new-format assertions fail against the old 16-char ids.

- [ ] **Step 3: Create `lib/words.ts`**

Copy exactly (256 words per list, 8 per line × 32 lines):

```ts
/**
 * Curated wordlists for memorable site ids (spec: exhibit titles +
 * memorable subdomains). Both lists are EXACTLY 256 entries — one random
 * byte indexes each with zero modulo bias — lowercase a–z, 3–8 chars,
 * concrete and content-neutral. Never remove or reorder casually: ids are
 * validated by shape only, so edits here are safe, but 256-ness is load-
 * bearing (see core-libs test).
 */

export const ADJECTIVES: readonly string[] = [
  "able", "agile", "airy", "amber", "ample", "aqua", "arbor", "ashen",
  "auric", "azure", "balmy", "beryl", "blithe", "bold", "bonny", "brave",
  "breezy", "brief", "bright", "brisk", "bronze", "burly", "calm", "candid",
  "canny", "cedar", "cheery", "chief", "chill", "civic", "classic", "clean",
  "clear", "clever", "cobalt", "cocoa", "copper", "coral", "cosmic", "cozy",
  "crisp", "damson", "dandy", "dapper", "deft", "dewy", "docile", "dual",
  "dusky", "dusty", "eager", "early", "earthen", "ebony", "elder", "elfin",
  "emerald", "equal", "extra", "fabled", "fair", "famed", "fancy", "fast",
  "festive", "fine", "firm", "fleet", "floral", "fluent", "fluffy", "fond",
  "frank", "free", "fresh", "frosty", "frugal", "funky", "fuzzy", "gentle",
  "gilded", "glad", "glossy", "golden", "grand", "green", "hale", "handy",
  "happy", "hardy", "hazel", "hearty", "hidden", "high", "honest", "humble",
  "icy", "ideal", "indigo", "inky", "ivory", "jade", "jaunty", "jolly",
  "jovial", "keen", "kind", "kindly", "lively", "local", "lofty", "loyal",
  "lucent", "lucid", "lucky", "lunar", "lush", "magic", "main", "major",
  "mellow", "merry", "mild", "minty", "modest", "mossy", "neat", "nifty",
  "nimble", "noble", "north", "novel", "oaken", "ochre", "olive", "opal",
  "open", "oval", "pale", "peachy", "pearly", "plaid", "plucky", "plum",
  "polar", "poised", "proud", "pure", "quick", "quiet", "rapid", "rare",
  "regal", "ripe", "roan", "robust", "rosy", "round", "royal", "ruby",
  "ruddy", "rural", "russet", "rustic", "sable", "safe", "sage", "sandy",
  "scenic", "sepia", "serene", "sharp", "shiny", "silent", "silken", "silver",
  "simple", "sleek", "slick", "smart", "smooth", "snowy", "snug", "sober",
  "solar", "solid", "sound", "spare", "spry", "stable", "starry", "steady",
  "sterling", "stout", "striped", "strong", "sturdy", "suave", "subtle", "sunny",
  "super", "swift", "tan", "tawny", "teal", "tidy", "timely", "tonal",
  "topaz", "tranquil", "trim", "true", "trusty", "tweed", "umber", "upbeat",
  "urban", "valiant", "velvet", "verdant", "vivid", "warm", "wavy", "whole",
  "wide", "wild", "wise", "witty", "wooden", "woolly", "worthy", "young",
  "zesty", "zippy", "amiable", "ancient", "artful", "astute", "blissful", "brainy",
  "bubbly", "casual", "chipper", "citrus", "comfy", "cordial", "crimson", "daring",
  "deep", "direct", "earnest", "easy", "elegant", "faded", "gallant", "graceful",
];

export const NOUNS: readonly string[] = [
  "acorn", "alder", "anchor", "apple", "aspen", "atoll", "aurora", "badge",
  "bamboo", "banjo", "barley", "basin", "bay", "beach", "beacon", "bear",
  "beech", "bell", "berry", "birch", "bison", "bloom", "bluff", "breeze",
  "bridge", "brook", "cabin", "cairn", "canoe", "canyon", "cape", "castle",
  "cave", "chalk", "cherry", "cliff", "cloud", "clover", "coast", "comet",
  "compass", "cove", "crane", "crater", "creek", "crest", "crocus", "curlew",
  "cypress", "dahlia", "dale", "deer", "delta", "dome", "dove", "drift",
  "dune", "eagle", "echo", "eddy", "elk", "elm", "ember", "falcon",
  "fawn", "fern", "field", "finch", "fjord", "flint", "flute", "fog",
  "forest", "forge", "fossil", "fox", "garden", "garnet", "gazebo", "geyser",
  "glacier", "glade", "glen", "grove", "gull", "harbor", "haven", "hawk",
  "heath", "hedge", "heron", "hill", "hollow", "horizon", "ibis", "inlet",
  "iris", "island", "isle", "ivy", "jasper", "jetty", "juniper", "kelp",
  "kite", "knoll", "lagoon", "lake", "lantern", "larch", "lark", "laurel",
  "lava", "leaf", "ledge", "lemon", "lichen", "lilac", "lily", "linden",
  "lotus", "lynx", "maple", "marsh", "meadow", "mesa", "mist", "moor",
  "moss", "moth", "mount", "myrtle", "nectar", "nest", "newt", "night",
  "nook", "oak", "oasis", "ocean", "orchard", "oriole", "osprey", "otter",
  "owl", "palm", "path", "peak", "pebble", "pecan", "peony", "pier",
  "pine", "plaza", "plume", "pond", "poplar", "poppy", "prairie", "quail",
  "quarry", "quartz", "quay", "rain", "raven", "reef", "ridge", "river",
  "robin", "rock", "rowan", "rune", "sail", "salmon", "sea", "sequoia",
  "shell", "shore", "shrub", "sierra", "sky", "slate", "sloop", "sorrel",
  "spark", "sparrow", "spring", "spruce", "sprout", "spur", "star", "stone",
  "storm", "stream", "summit", "sun", "swale", "swan", "sycamore", "tarn",
  "teak", "tern", "thicket", "thistle", "thorn", "tide", "trail", "tree",
  "trout", "tulip", "tundra", "vale", "valley", "vine", "violet", "walnut",
  "wave", "willow", "wind", "wolf", "wren", "yarrow", "zephyr", "zinnia",
  "acacia", "badger", "bramble", "briar", "brine", "bunting", "burrow", "butte",
  "cascade", "channel", "cobble", "condor", "coppice", "cosmos", "cotton", "crag",
  "cress", "dell", "desert", "dingle", "dory", "drake", "drumlin", "dusk",
  "estuary", "fen", "firth", "foam", "frost", "galaxy", "gorge", "grotto",
];
```

- [ ] **Step 4: Update `lib/id.ts`**

Replace the existing `newSiteId` (and its comment) with:

```ts
import { ADJECTIVES, NOUNS } from "./words";

/** Lists are exactly 256 long, so one random byte indexes without modulo bias. */
function pickWord(list: readonly string[]): string {
  return list[randomBytes(1)[0] % list.length];
}

/**
 * Site id: `word-word-suffix`, e.g. amber-fox-3kj9w7 — memorable but
 * content-neutral (≈46 bits). Server-generated, never client-chosen, never
 * reused (SPEC §2); create additionally checks for collisions since 46 bits
 * is guessable-adjacent but not collision-proof forever. Valid DNS label:
 * starts with a letter, ≤63 chars. Legacy pure-random 16-char ids remain
 * valid via id-validate.
 */
export function newSiteId(): string {
  return `${pickWord(ADJECTIVES)}-${pickWord(NOUNS)}-${encodeRandom(6)}`;
}
```

(The `letters` constant inside the old body is deleted with it; `randomBytes` is already imported at the top.)

- [ ] **Step 5: Update `lib/id-validate.ts`**

Replace the `SITE_ID_RE` line and `isValidSiteId` with:

```ts
const LEGACY_SITE_ID_RE = /^[a-z][0-9a-z]{5,31}$/;
const WORDY_SITE_ID_RE = /^[a-z]{3,12}-[a-z]{3,12}-[0-9a-z]{6}$/;

export function isValidSiteId(id: string): boolean {
  return LEGACY_SITE_ID_RE.test(id) || WORDY_SITE_ID_RE.test(id);
}
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/core-libs.test.ts`
Expected: PASS. Then run the full suite — `npm test` — to catch anything asserting the old id shape elsewhere (e.g. hosts/middleware tests). Fix only assertions about id *shape*; behavior must not change.

- [ ] **Step 7: Commit**

```bash
git add lib/words.ts lib/id.ts lib/id-validate.ts tests/core-libs.test.ts
git commit -m "Memorable word-word-suffix site ids, legacy ids stay valid"
```

---

### Task 3: Pointer title fields, derivation on create/replace, collision retry

**Files:**
- Modify: `lib/pointer.ts` (LivePointer fields)
- Modify: `lib/sites.ts` (`createSite`, `replaceHtml`)
- Modify: `tests/sites.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `extractTitle` from `lib/title.ts` (Task 1); `getPointer` (already imported in sites.ts).
- Produces:
  - `LivePointer.derivedTitle: string | null` and `LivePointer.customTitle?: string`
  - `createSite` retries ids on collision (max 3 generations) and sets `derivedTitle`
  - `replaceHtml` re-derives `derivedTitle`, preserves `customTitle`

- [ ] **Step 1: Write the failing tests**

Append to `tests/sites.test.ts` (reuse the file's existing imports/`beforeEach`; add imports for anything missing — `createSite`, `replaceHtml` from `@/lib/sites`, `getPointer, setPointer` from `@/lib/pointer`):

```ts
describe("exhibit titles on create/replace", () => {
  it("create derives the title from <title>", async () => {
    const { pointer } = await createSite({ html: "<title>My Report</title><p>x</p>" });
    expect(pointer.derivedTitle).toBe("My Report");
  });

  it("create stores null when no title is derivable", async () => {
    const { pointer } = await createSite({ html: "<p>plain</p>" });
    expect(pointer.derivedTitle).toBeNull();
  });

  it("replace re-derives the title and preserves customTitle", async () => {
    const { pointer } = await createSite({ html: "<title>v1</title>" });
    await setPointer({ ...pointer, customTitle: "Pinned Name" });
    const updated = await replaceHtml(pointer.siteId, "<title>v2</title>");
    expect(updated.derivedTitle).toBe("v2");
    expect(updated.customTitle).toBe("Pinned Name");
  });
});

describe("site id collision retry", () => {
  it("skips taken ids (live or tombstone) and errors after 3 attempts", async () => {
    const { pointer: taken } = await createSite({ html: "<p>a</p>" });
    // A queue of candidates: first collides with the live site, second wins.
    const queue = [taken.siteId, "amber-fox-aaaaaa"];
    const { pointer } = await createSite({ html: "<p>b</p>" }, () => queue.shift()!);
    expect(pointer.siteId).toBe("amber-fox-aaaaaa");

    // All three candidates taken → 500-class error.
    const always = () => taken.siteId;
    await expect(createSite({ html: "<p>c</p>" }, always)).rejects.toThrow(/site id/i);
  });
});
```

(The collision loop can't be forced through random ids, so `createSite` gains an optional injectable id generator — defined in Step 3 — used only by this test; API routes keep calling it with one argument.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/sites.test.ts`
Expected: FAIL — `derivedTitle` undefined; `createSite` takes one argument.

- [ ] **Step 3: Implement**

`lib/pointer.ts` — add to `LivePointer` after `assets`:

```ts
  /** Extracted from the HTML on create/replace (spec: exhibit titles). Absent = pre-titles pointer, healed lazily. */
  derivedTitle?: string | null;
  /** Curator's rename; survives HTML replacement. Absent = no override. */
  customTitle?: string;
```

`lib/sites.ts` — add `import { extractTitle } from "./title";` and change `createSite`:

```ts
export async function createSite(
  input: { html: string; password?: string; crawl?: boolean },
  generateId: () => string = newSiteId,
): Promise<CreateResult> {
  const htmlBytes = checkHtmlSize(input.html);
  const storage = getStorage();

  // 46-bit ids are memorable, not collision-proof: verify unused (live OR
  // tombstone — "never reused", SPEC §2), regenerate up to 3 candidates.
  let siteId: string | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const candidate = generateId();
    if ((await getPointer(candidate)) === null) {
      siteId = candidate;
      break;
    }
  }
  if (!siteId) throw new HttpError(500, "could not allocate an unused site id");

  const generation = newGenerationId();
  const updateKey = newUpdateKey();
  const now = new Date().toISOString();

  // Generation first; pointer last (SPEC §2). A failure between the two
  // leaves unreachable garbage for GC, never a visible site.
  await storage.put(htmlPath(siteId, generation), htmlBytes, { contentType: "text/html; charset=utf-8" });

  const pointer: LivePointer = {
    siteId,
    generation,
    createdAt: now,
    updatedAt: now,
    crawl: input.crawl ?? false,
    passwordHash: input.password ? await hashPassword(input.password) : null,
    updateKeyHash: hashUpdateKey(updateKey),
    assets: [],
    derivedTitle: extractTitle(input.html),
  };
  await setPointer(pointer);
  return { pointer, updateKey };
}
```

In `replaceHtml`, change the `updated` construction to:

```ts
  const updated: LivePointer = {
    ...current,
    generation,
    derivedTitle: extractTitle(html),
    updatedAt: new Date().toISOString(),
  };
```

Check `lib/sites.ts` imports: `getPointer` must be in the `./pointer` import list (it already is), and `HttpError` is already imported.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/sites.test.ts` then `npm test`
Expected: PASS everywhere (existing create/replace tests unaffected — the new pointer fields are additive).

- [ ] **Step 5: Commit**

```bash
git add lib/pointer.ts lib/sites.ts tests/sites.test.ts
git commit -m "Derive exhibit titles on create/replace; collision-checked ids"
```

---

### Task 4: `renameSite` + lazy backfill in `listSites`

**Files:**
- Modify: `lib/sites.ts`
- Modify: `tests/sites.test.ts` (append)

**Interfaces:**
- Consumes: `normalizeTitle`, `extractTitle` from `lib/title.ts`; `htmlPath`, `getPointer`, `setPointer` from `./pointer`.
- Produces:
  - `renameSite(id: string, title: string): Promise<LivePointer>` — empty/whitespace title clears the override
  - `listSites()` heals pointers missing `derivedTitle` (reads HTML once, rewrites pointer, `updatedAt` untouched)

- [ ] **Step 1: Write the failing tests**

Append to `tests/sites.test.ts` (import `renameSite, listSites` from `@/lib/sites` and `pointerPath` from `@/lib/pointer` if not present):

```ts
describe("renameSite", () => {
  it("sets, normalizes, and clears the custom title", async () => {
    const { pointer } = await createSite({ html: "<title>Derived</title>" });
    const renamed = await renameSite(pointer.siteId, "  My   Exhibit  ");
    expect(renamed.customTitle).toBe("My Exhibit");
    expect(renamed.derivedTitle).toBe("Derived");

    const cleared = await renameSite(pointer.siteId, "   ");
    expect(cleared.customTitle).toBeUndefined();
  });

  it("404s on tombstoned sites", async () => {
    const { pointer } = await createSite({ html: "<p>x</p>" });
    await deleteSite(pointer.siteId);
    await expect(renameSite(pointer.siteId, "ghost")).rejects.toThrow(/no site/);
  });
});

describe("lazy title backfill in listSites", () => {
  it("heals a legacy pointer (no derivedTitle field) exactly once, without touching updatedAt", async () => {
    const { pointer } = await createSite({ html: "<title>Old Site</title>" });
    // Simulate a pre-titles pointer: strip the field entirely.
    const { derivedTitle: _dropped, ...legacyRest } = pointer;
    await setPointer(legacyRest as LivePointer);

    const [listed] = await listSites();
    expect(listed.derivedTitle).toBe("Old Site");
    expect(listed.updatedAt).toBe(pointer.updatedAt);

    // Persisted: a direct pointer read now has the field.
    const healed = await getPointer(pointer.siteId);
    expect(healed && !healed.deleted && healed.derivedTitle).toBe("Old Site");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/sites.test.ts`
Expected: FAIL — `renameSite` not exported; backfill assertions fail.

- [ ] **Step 3: Implement in `lib/sites.ts`**

Add `normalizeTitle` to the title import: `import { extractTitle, normalizeTitle } from "./title";`

Add after `patchSettings`:

```ts
/** Portal rename — pointer-only write, like patchSettings. Empty title clears the override. */
export async function renameSite(id: string, title: string): Promise<LivePointer> {
  const current = await requireLiveSite(id);
  const normalized = normalizeTitle(title);
  const updated: LivePointer = { ...current, updatedAt: new Date().toISOString() };
  if (normalized) updated.customTitle = normalized;
  else delete updated.customTitle;
  await setPointer(updated);
  return updated;
}

/**
 * Lazy backfill (spec: exhibit titles): pointers written before derivedTitle
 * existed get healed on first listing — one HTML read + one pointer write,
 * updatedAt untouched (this is a heal, not an edit). On read failure, skip
 * persisting so the next listing retries.
 */
async function ensureDerivedTitle(pointer: LivePointer): Promise<LivePointer> {
  if (pointer.derivedTitle !== undefined) return pointer;
  try {
    const obj = await getStorage().get(htmlPath(pointer.siteId, pointer.generation));
    if (!obj) return { ...pointer, derivedTitle: null };
    const healed: LivePointer = { ...pointer, derivedTitle: extractTitle(await new Response(obj.stream).text()) };
    await setPointer(healed);
    return healed;
  } catch {
    return { ...pointer, derivedTitle: null };
  }
}
```

In `listSites`, change the pointer-collection loop to heal:

```ts
  const pointers: LivePointer[] = [];
  for (const id of ids) {
    const pointer = await getPointer(id);
    if (pointer && !pointer.deleted) pointers.push(await ensureDerivedTitle(pointer));
  }
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/sites.test.ts` then `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/sites.ts tests/sites.test.ts
git commit -m "Portal rename and lazy title backfill for legacy pointers"
```

---

### Task 5: `title` in API responses

**Files:**
- Modify: `lib/api.ts` (`siteJson`)
- Modify: `tests/api.test.ts` (append one test)

**Interfaces:**
- Consumes: `displayTitle` from `lib/title.ts`.
- Produces: every site JSON body includes `title: string` (display title).

- [ ] **Step 1: Write the failing test**

Append to `tests/api.test.ts` inside the existing `describe("create (PRD #2)")` block, or as its own block at the end:

```ts
describe("title in API bodies", () => {
  it("create and get return the display title", async () => {
    const created = await createSite(req("POST", "/v1/sites", { token: ADMIN, json: { html: "<title>Wire Title</title>" } }));
    const body = (await created.json()) as { site_id: string; title: string };
    expect(body.title).toBe("Wire Title");

    const got = await getSite(req("GET", `/v1/sites/${body.site_id}`, { token: ADMIN }), ctx(body.site_id));
    expect(((await got.json()) as { title: string }).title).toBe("Wire Title");
  });

  it("falls back to the site id when nothing is derivable", async () => {
    const created = await createSite(req("POST", "/v1/sites", { token: ADMIN, json: { html: "<p>x</p>" } }));
    const body = (await created.json()) as { site_id: string; title: string };
    expect(body.title).toBe(body.site_id);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/api.test.ts`
Expected: FAIL — `title` undefined.

- [ ] **Step 3: Implement in `lib/api.ts`**

Add `import { displayTitle } from "./title";` and add one line to `siteJson` after `site_id`:

```ts
    title: displayTitle(pointer),
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/api.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/api.ts tests/api.test.ts
git commit -m "Expose display title in site API bodies"
```

---

### Task 6: Portal — titled cards, URL in meta line, Rename action

**Files:**
- Modify: `app/portal/actions/route.ts` (add `rename` case)
- Modify: `app/portal/page.tsx` (card layout + Rename form)
- Modify: `tests/portal.test.ts` (append)

**Interfaces:**
- Consumes: `renameSite` (Task 4), `displayTitle` (Task 1), existing `siteUrl`.
- Produces: form action `rename` with fields `site_id`, `title`; portal card shows display title.

- [ ] **Step 1: Write the failing tests**

Append to `tests/portal.test.ts` (inside `describe("portal actions")` or a new block; imports of `createSite` and the memory/session helpers already exist — add `renameSite` **only if needed**, the test goes through the route):

```ts
describe("portal rename action", () => {
  it("renames with a session, clears on empty, rejects without a session", async () => {
    const cookie = sessionCookie();
    const { pointer } = await createSite({ html: "<title>Derived</title>" });

    const noSession = await actions(formRequest("/portal/actions", { action: "rename", site_id: pointer.siteId, title: "X" }));
    expect(noSession.status).toBe(401);

    const renamed = await actions(
      formRequest("/portal/actions", { action: "rename", site_id: pointer.siteId, title: "Gallery Name" }, { cookie }),
    );
    expect(renamed.status).toBe(303);
    let [site] = await listSites();
    expect(site.customTitle).toBe("Gallery Name");

    const cleared = await actions(
      formRequest("/portal/actions", { action: "rename", site_id: pointer.siteId, title: "" }, { cookie }),
    );
    expect(cleared.status).toBe(303);
    [site] = await listSites();
    expect(site.customTitle).toBeUndefined();
    expect(site.derivedTitle).toBe("Derived");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/portal.test.ts`
Expected: FAIL — rename returns 400 "unknown action".

- [ ] **Step 3: Add the `rename` case to `app/portal/actions/route.ts`**

Add `renameSite` to the `@/lib/sites` import, then add before `default:`:

```ts
      case "rename": {
        const title = form.get("title");
        await renameSite(siteId, typeof title === "string" ? title : "");
        return redirectBack();
      }
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/portal.test.ts`
Expected: PASS.

- [ ] **Step 5: Update the portal card (`app/portal/page.tsx`)**

Add `import { displayTitle } from "@/lib/title";` at the top.

In the CSS string, replace the two `.site h2` rules with (serif title, slightly larger; url link inherits `.meta` styling):

```css
  .site h2 { font-size: 1.05rem; font-weight: 500; margin-bottom: 0.2rem; font-family: Georgia, 'Times New Roman', serif; }
  .site h2 a { color: var(--term-cyan); text-decoration: none; overflow-wrap: anywhere; }
  .site h2 a:hover { text-decoration: underline; text-underline-offset: 3px; }
  .meta a { color: var(--term-dim); }
  .meta a:hover { text-decoration: underline; text-underline-offset: 2px; }
```

Replace the card's `<h2>`/meta block:

```tsx
              <h2>
                <a href={siteUrl(site.siteId)} target="_blank" rel="noopener noreferrer">
                  {displayTitle(site)}
                </a>
              </h2>
              <p className="meta">
                <a href={siteUrl(site.siteId)} target="_blank" rel="noopener noreferrer">
                  {new URL(siteUrl(site.siteId)).host}
                </a>{" "}
                · created {site.createdAt} · updated {site.updatedAt} · crawl {site.crawl ? "on" : "off"} ·{" "}
                {site.passwordHash ? "password set" : "no password"} · {site.assets.length} asset
                {site.assets.length === 1 ? "" : "s"}
              </p>
```

(Note the `mono` class is dropped from the `<h2>` — titles render in the serif gallery voice; the id stays visible in the mono console-title bar above.)

Add a Rename section between `Replace HTML` and `Settings`:

```tsx
              <details>
                <summary>Rename</summary>
                <form method="post" action="/portal/actions">
                  <input type="hidden" name="action" value="rename" />
                  <input type="hidden" name="site_id" value={site.siteId} />
                  <input
                    type="text"
                    name="title"
                    defaultValue={site.customTitle ?? ""}
                    placeholder="display title (empty resets to the page's own title)"
                    aria-label="display title"
                  />
                  <button type="submit">Rename</button>
                </form>
              </details>
```

XSS check (SPEC §7): title renders via JSX interpolation only — no `dangerouslySetInnerHTML` anywhere in the diff.

- [ ] **Step 6: Verify build + full suite**

Run: `npm test && npx next build`
Expected: tests PASS, build clean (the page is a server component; `new URL(...)` at render time is fine).

- [ ] **Step 7: Commit**

```bash
git add app/portal/actions/route.ts app/portal/page.tsx tests/portal.test.ts
git commit -m "Portal: titled exhibit cards with rename control"
```

---

### Task 7: SPEC update + final verification

**Files:**
- Modify: `SPEC.md` (§2 site-id bullet, §7 capabilities line)

**Interfaces:**
- Consumes: everything above. Produces: documentation consistent with behavior.

- [ ] **Step 1: Update SPEC §2**

Replace this bullet:

```
- **Site ids are server-generated** (ULID or equivalent random alphabet,
  lowercase, DNS-safe since they are subdomain labels), never
  client-chosen, never reused. Eliminates the create check-then-write
  race (fable-2, Codex High).
```

with:

```
- **Site ids are server-generated** (`word-word-suffix`: two curated
  wordlist entries plus 6 random base32 chars, ≈46 bits — lowercase,
  DNS-safe since they are subdomain labels; legacy 16-char random ids
  remain valid), never client-chosen, never reused. Create verifies the
  candidate id is unused — live or tombstone — and regenerates on
  collision (max 3), so never-reused holds by check as well as entropy.
  The original 80-bit ids made the create check-then-write race moot by
  entropy alone (fable-2, Codex High); the explicit check preserves that
  guarantee at 46 bits.
```

- [ ] **Step 2: Update SPEC §7**

Replace:

```
`__Host-` HttpOnly session cookie. Capabilities per the PRD: list,
open, replace, crawl toggle, set/clear password, delete with
confirmation.
```

with:

```
`__Host-` HttpOnly session cookie. Capabilities per the PRD: list,
open, replace, rename (display title override; empty clears back to
the HTML-derived title), crawl toggle, set/clear password, delete
with confirmation. Exhibit cards show a display title —
`customTitle ?? derivedTitle ?? siteId` — extracted from the HTML's
`<title>`/`<h1>` at create/replace time.
```

- [ ] **Step 3: Full verification**

Run: `npm test && npx next build`
Expected: everything green.

- [ ] **Step 4: Commit**

```bash
git add SPEC.md
git commit -m "SPEC: memorable site ids and portal titles"
```

---

## Self-Review Notes

- Spec coverage: data model (T3), extraction + backfill (T1, T4), subdomains + validation + collision retry (T2, T3), portal UI + rename (T6), API title (T5), SPEC doc (T7). Out-of-scope items untouched. ✓
- Type consistency: `derivedTitle?: string | null` / `customTitle?: string` used identically in T3–T6; `renameSite(id, title)` signature matches T4 def and T6 usage; `createSite(input, generateId?)` optional param used only in T3 tests. ✓
- The optional `generateId` parameter on `createSite` is test-injection; API routes call it with one argument and are unaffected.
