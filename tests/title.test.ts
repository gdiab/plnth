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
