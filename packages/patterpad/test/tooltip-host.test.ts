// Every window mounts the themed tooltip, checked at BUILD time rather than when somebody opens it.
//
// app-shell 0.28.0's own dev warning fires when something wrote `data-tip` and no host mounted - but
// only in a window that has been OPENED. A tool window nobody happens to open during a session says
// nothing at all and carries its dead tips to a release with a clean console the whole way. That is
// exactly the population the original bug lived in: the Search window went two releases with no pin
// tooltip and was found by looking, not by being told.
//
// Storyletter's idea, and its shape is the point (from-storylets/tooltip-warning-blind-spot.md): the
// windows are DISCOVERED from the markup rather than listed, because an allowlist of windows is a thing
// to forget, and a window added tomorrow is checked the day it appears. Same lesson as the tsconfig.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const renderer = fileURLToPath(new URL("../src/renderer", import.meta.url));

/**
 * A file's CODE, with comments removed.
 *
 * Matching the raw source would accept a commented-out call, which is not a theoretical worry: probing
 * this guard by commenting out one window's `initTooltips()` left it green, because `// initTooltips();`
 * still contains `initTooltips(`. A guard that passes on the exact edit it exists to catch is worse than
 * none, so the comments come out first. Crude on purpose - it only has to be right about calls.
 */
const code = (path: string): string =>
  readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[^\n]*?\/\/.*$/gm, (line) => {
    const i = line.indexOf("//");
    return line.slice(0, i); // keep anything before the comment marker on that line
  });

// Every shipped window: `src/renderer/index.html`, plus the `index.html` in each renderer subdirectory.
// The preview harness is excluded - it loads a `-dev.ts` stub that then imports the real renderer, so it
// inherits whatever that does and would only ever re-test it.
// (Line comments on purpose: a JSDoc block cannot hold a path containing `*` followed by a slash, which
// closes the comment early and turns the rest of the file into syntax errors a long way from the cause.)
function windows(): Array<{ name: string; entry: string }> {
  const out: Array<{ name: string; entry: string }> = [];
  const add = (dir: string, name: string): void => {
    let html: string;
    try { html = readFileSync(join(dir, "index.html"), "utf8"); } catch { return; }
    const src = /src="\.\/([^"]+\.ts)"/.exec(html)?.[1];
    if (src) out.push({ name, entry: join(dir, src) });
  };
  add(renderer, "editor");
  for (const d of readdirSync(renderer, { withFileTypes: true })) {
    if (d.isDirectory() && d.name !== "preview" && d.name !== "src") add(join(renderer, d.name), d.name);
  }
  return out;
}

describe("every window mounts the tooltip host", () => {
  it("finds the windows from the markup, not from a list here", () => {
    // If this drops below four, the discovery broke and every assertion below is passing on nothing.
    const found = windows().map((w) => w.name).sort();
    expect(found).toEqual(["coverage", "editor", "play", "search"]);
  });

  for (const { name, entry } of windows()) {
    it(`${name} calls initTooltips`, () => {
      // Without it `data-tip` is inert: not the themed bubble, not the platform one, nothing. Shell
      // components self-mount since 0.28.0, but a `data-tip` written into this app's own markup does
      // not, and all three helper windows have those.
      expect(code(entry)).toMatch(/initTooltips\(/);
    });
  }

  it("only the editor passes options, so `suppressed` cannot become a coin toss", () => {
    // Since 0.28.0 the rule is "the last EXPLICIT call wins", so a `suppressed` predicate arriving from
    // two places would be decided by load order. Patterpad has exactly one, the editor's Writing View
    // rule; every other window must mount bare.
    const withOptions = windows().filter((w) => /initTooltips\(\s*\{/.test(code(w.entry)));
    expect(withOptions.map((w) => w.name)).toEqual(["editor"]);
  });
});
