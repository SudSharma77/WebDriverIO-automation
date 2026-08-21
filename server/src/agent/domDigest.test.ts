import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { digestDom } from "./domDigest.js";

/**
 * The case that motivated this: a real page's first 4000 characters are all
 * <head>, so a naive slice showed the repair pass 28 meta tags and no screen.
 */
const PAGE = `<!doctype html><html><head>
<title>Stream Filipino Movies &amp; TV Shows | iWant</title>
${Array.from({ length: 40 }, (_, i) => `<meta property="og:tag${i}" content="${"x".repeat(120)}">`).join("\n")}
<script>window.__DATA__ = ${JSON.stringify({ padding: "y".repeat(3000) })};</script>
<style>.a{color:red}</style>
</head><body>
<h1>Stream the best Filipino movies and TV shows</h1>
<input type="text" placeholder="Search by title, actor, genre..." class="ignored-class">
<button data-testid="play" class="btn btn-primary">Play now</button>
<a href="https://help.iwanttfc.com/support/home">Help and Support</a>
<script>trackEverything()</script>
<!-- a comment that should not survive -->
</body></html>`;

describe("digestDom", () => {
  const digest = digestDom(PAGE);

  it("reaches the body, which a raw slice does not", () => {
    // The bug this exists to fix: prove the naive approach fails on this input.
    assert.ok(!PAGE.slice(0, 4000).includes("<body"), "fixture is not head-heavy enough to be a real test");
    assert.match(digest, /Stream the best Filipino movies/);
  });

  it("keeps the page title", () => {
    assert.match(digest, /Page title: Stream Filipino Movies & TV Shows \| iWant/);
  });

  it("lists headings, which say which screen this is", () => {
    assert.match(digest, /<h1> Stream the best Filipino movies/);
  });

  it("lists interactive elements with the attributes selectors are written against", () => {
    assert.match(digest, /data-testid="play"/);
    assert.match(digest, /placeholder="Search by title, actor, genre\.\.\."/);
    assert.match(digest, /href="https:\/\/help\.iwanttfc\.com\/support\/home"/);
  });

  it("drops styling classes, which no generated selector should depend on", () => {
    assert.ok(!digest.includes("btn-primary"));
    assert.ok(!digest.includes("ignored-class"));
  });

  it("drops scripts, styles and comments entirely", () => {
    assert.ok(!digest.includes("__DATA__"));
    assert.ok(!digest.includes("trackEverything"));
    assert.ok(!digest.includes("should not survive"));
  });

  it("collapses a 687KB page into something a prompt can afford", () => {
    assert.ok(digest.length < 4100, `digest was ${digest.length} chars`);
  });

  it("respects an explicit budget", () => {
    assert.ok(digestDom(PAGE, { maxChars: 200 }).length <= 220);
  });

  it("survives malformed input rather than throwing", () => {
    assert.doesNotThrow(() => digestDom("<html><body><h1>unclosed"));
    assert.doesNotThrow(() => digestDom(""));
  });

  it("deduplicates repeated markup so a catalogue does not fill the budget", () => {
    const many = `<body>${Array.from({ length: 200 }, () => `<button data-testid="same">Play</button>`).join("")}</body>`;
    const matches = digestDom(many).match(/data-testid="same"/g) ?? [];
    assert.equal(matches.length, 1);
  });
});
