// @vitest-environment jsdom
// Chrome has its own scale (design-language §4): the reading surface scales with the root font size
// (Patterpad's is 110%, the script's reading size); the CHROME is sized in px off a 14px base and must
// not move with it. These tests hold that line by reading the stylesheets as text: no `rem` may come
// back into a chrome rule, the reading rules keep theirs, and the pane widths are px.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const shell = read("./src/shell.css");
const play = read("./play/play.css");
const search = read("./search/search.css");
const coverage = read("./coverage/coverage.css");
const surface = read("../../../patterpad-surface/web/styles.css");
const renderer = read("./src/renderer.ts");

/** The CSS without its comments, so a prose mention cannot mask (or fake) a unit. */
const code = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");
const REM = /\d(?:\.\d+)?rem\b/g;
const remsIn = (css: string): string[] => code(css).match(REM) ?? [];
/** The declarations of EVERY rule whose selector list is exactly `selector` (a sheet may split one
 *  selector's rules across the file, e.g. `.bubble { contain: layout; }` beside the bubble's look). */
const rule = (css: string, selector: string): string => {
  const src = code(css);
  const needle = `\n${selector} {`;
  const blocks: string[] = [];
  for (let at = src.indexOf(needle); at >= 0; at = src.indexOf(needle, at + 1)) {
    const open = at + needle.length - 1;
    blocks.push(src.slice(open + 1, src.indexOf("}", open)));
  }
  if (blocks.length === 0) throw new Error(`no rule for ${selector}`);
  return blocks.join("\n");
};

describe("chrome scale: no rem in chrome rules", () => {
  it("shell.css is all chrome and carries no rem, bar the two rendered script lines", () => {
    // The scratch-recording overlay shows the line being recorded and the next line: reading content.
    expect(remsIn(shell)).toEqual(["1.1rem", "1rem"]);
    expect(rule(shell, ".scratch-line")).toContain("1.1rem/1.5 var(--font-read)");
    expect(rule(shell, ".scratch-next-text")).toContain("1rem/1.4 var(--font-read)");
  });

  it("the Find and Coverage windows carry no rem", () => {
    expect(remsIn(search)).toEqual([]);
    expect(remsIn(coverage)).toEqual([]);
  });

  it("the Play window's controls are px; its rendered walk keeps the reading scale", () => {
    for (const sel of [".play-bar", ".play-from", ".play-addr", ".play-locale", ".play-speed", ".play-rewind", ".padv", ".play-stop", ".pnote", ".plive", ".pchoice.restart"]) {
      expect(rule(play, sel), sel).not.toMatch(REM);
    }
    expect(rule(play, "body.play")).toContain("1rem/1.6 var(--font-read)");
    expect(rule(play, ".pchoice")).toContain("1rem var(--font-read)");
    expect(rule(play, ".pcue")).toMatch(REM);
    expect(rule(play, ".pdir")).toMatch(REM);
  });
});

describe("chrome scale: the surface's mixed sheet", () => {
  it("chrome rules are px", () => {
    for (const sel of ["#hintbar", ".action-menu", ".action-mi", ".slash-menu", ".slash-item", ".target-picker", ".tp-row", ".cue-ac", ".note-icon", ".comment-bubble", ".status-pill"]) {
      expect(rule(surface, sel), sel).not.toMatch(REM);
    }
    expect(rule(surface, "#hintbar")).toContain("font: 12px var(--font-ui)");
    expect(rule(surface, "#hintbar")).toContain("min-height: 30.5px");
  });

  it("reading rules keep rem", () => {
    expect(rule(surface, "body")).toContain("font: 1rem/1.6 var(--font-read)");
    expect(rule(surface, ".ProseMirror")).toContain("max-width: 42rem");
    expect(rule(surface, ".scene-title")).toMatch(REM);
    expect(rule(surface, ".bubble")).toMatch(REM);
    expect(rule(surface, ".zone.cue .cue-text")).toMatch(REM);
  });
});

describe("chrome scale: the sizes the family measures", () => {
  it("the chrome hosts pin the 14px base", () => {
    expect(rule(shell, ".topbar, .pane-nav, .pane-inspector, .stepbar, .welcome")).toContain("font-size: 14px");
    expect(rule(coverage, "body.coverage-win")).toContain("font-size: 14px");
    expect(rule(play, ".swin-head")).toContain("font-size: 14px");
    expect(rule(search, ".swin-head")).toContain("font-size: 14px");
  });

  it("the navigator rows and the Find button are px (rem x 16, half-px rounding)", () => {
    expect(rule(shell, ".nav-item")).toContain("font: 600 13.5px var(--font-ui)");
    expect(rule(shell, ".nav-item")).toContain("padding: 6.5px 9.5px");
    expect(rule(shell, ".nav-block")).toContain("font: 500 13px var(--font-ui)");
    expect(rule(shell, ".nav-search")).toContain("font: 600 12.5px var(--font-ui)");
    expect(rule(shell, ".insp-row")).toContain("grid-template-columns: 104px 1fr");
  });

  it("the pane widths handed to the shell are px", () => {
    expect(renderer).toContain('nav: { defaultWidth: "224px"');
    expect(renderer).toContain('inspector: { defaultWidth: "384px"');
    expect(renderer).not.toMatch(/defaultWidth: "\d+rem"/);
  });
});
