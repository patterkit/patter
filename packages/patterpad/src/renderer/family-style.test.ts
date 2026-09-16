// The family style, held as a source scan over Patterpad and the writing surface (design-language.md
// section 4: "Icons are drawn, and so are separators", "Captions are words, not overlines", "Chrome
// has its own scale", "One casing rule, and platform-true key hints"; copy-house-style.md rules 3, 16,
// 27 and 33). notation.test.ts holds the four sites that can be built without a window; this file
// holds the rest the same way Storyletter's notation.test.ts and chrome-scale.test.ts do, by reading
// the source, because a new `"✕"` or a new `letter-spacing: 0.06em` is one token in one file and
// exactly the kind of thing that drifts back without a gate.
//
// Every rule carries two lists. ALLOWED is the true exceptions, each with the reason it is one.
// PENDING is what the tree still does today that the rule says it should not: the entries are pinned
// exactly, so a new hit fails the run, and a retired one fails it too until its entry is removed
// (the list can only shrink). A rule with an empty PENDING is simply held.
//
// Comments are blanked before scanning, so a comment may still say "·" to explain why the code
// beneath it no longer does. Tests and the preview harness are not scanned: the harness mirrors the
// real DOM by design and the tests type the glyphs they rule out.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const PACKAGES = new URL("../../../", import.meta.url).pathname;
const ROOTS = ["patterpad/src", "patterpad-surface/src", "patterpad-surface/web"];

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "preview" ? [] : walk(path);
    return /\.(ts|html|css)$/.test(name) && !/\.(test|d)\.ts$/.test(name) ? [path] : [];
  });

/** Blank a span but keep its newlines, so line numbers survive. */
const blank = (m: string): string => m.replace(/[^\n]/g, " ");
/** Source with its comments blanked. */
const withoutComments = (src: string, kind: "ts" | "html" | "css"): string => {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, blank);
  if (kind === "html") out = out.replace(/<!--[\s\S]*?-->/g, blank);
  if (kind !== "css") out = out.replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (_m, lead: string) => lead);
  return out;
};

interface Source { file: string; kind: "ts" | "html" | "css"; lines: string[]; text: string }
const sources: Source[] = ROOTS.flatMap((root) => walk(join(PACKAGES, root))).map((path) => {
  const kind = path.endsWith(".css") ? "css" : path.endsWith(".html") ? "html" : "ts";
  const text = withoutComments(readFileSync(path, "utf8"), kind);
  return { file: relative(PACKAGES, path), kind, lines: text.split("\n"), text };
});

interface Hit { file: string; line: number; key: string }
/** An allow-list or pending entry: the file, what the hit's key must contain (a substring or a
 *  RegExp), how many hits it accounts for (default 1), and why. */
interface Entry { file: string; match: string | RegExp; count?: number; why: string }

const fmt = (h: Hit): string => `${h.file}:${h.line}: ${h.key.trim().slice(0, 100)}`;
const matches = (m: string | RegExp, key: string): boolean => (typeof m === "string" ? key.includes(m) : m.test(key));

/** Hold a rule: every hit is either explained by ALLOWED, pinned by PENDING, or a failure; and every
 *  entry in either list must still explain something, or it is stale and the run fails until it goes. */
function hold(rule: string, hits: Hit[], allowed: Entry[], pending: Entry[]): void {
  let remaining = hits;
  const stale: string[] = [];
  for (const entry of [...allowed, ...pending]) {
    const taken = remaining.filter((h) => h.file === entry.file && matches(entry.match, h.key));
    const want = entry.count ?? 1;
    if (taken.length !== want) stale.push(`${entry.file} ${String(entry.match)}: expected ${want} hit(s), found ${taken.length}`);
    remaining = remaining.filter((h) => !taken.includes(h));
  }
  expect(remaining.map(fmt), `${rule}: not on either list`).toEqual([]);
  expect(stale, `${rule}: entries that no longer match what they were written for (remove or recount them)`).toEqual([]);
}

/** Line hits: every line of the sources of the given kinds that matches `re`. */
const lineHits = (re: RegExp, kinds: Source["kind"][] = ["ts", "html"]): Hit[] =>
  sources.filter((s) => kinds.includes(s.kind)).flatMap((s) =>
    s.lines.flatMap((line, i) => (re.test(line) ? [{ file: s.file, line: i + 1, key: line }] : [])));

/** Rule-block hits: every `selector { body }` in the stylesheets named by `files` (all if omitted)
 *  whose body satisfies `test`; the key is the selector. */
const blockHits = (test: (body: string) => boolean, files?: string[]): Hit[] =>
  sources.filter((s) => s.kind === "css" && (!files || files.includes(s.file))).flatMap((s) => {
    const out: Hit[] = [];
    for (const m of s.text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!test(m[2]!)) continue;
      // A selector never contains `;`, so whatever sits before one (a custom property at the top of
      // the sheet, an @import) is not part of it.
      const selector = m[1]!.split(";").pop()!.trim().replace(/\s+/g, " ");
      out.push({ file: s.file, line: s.text.slice(0, m.index! + m[1]!.length).split("\n").length, key: selector });
    }
    return out;
  });

const SHELL = "patterpad/src/renderer/src/shell.css";
const PLAY = "patterpad/src/renderer/play/play.css";
const SEARCH = "patterpad/src/renderer/search/search.css";
const COVERAGE = "patterpad/src/renderer/coverage/coverage.css";
const SURFACE = "patterpad-surface/web/styles.css";
const SURFACE_THEME = "patterpad-surface/web/theme.css";

describe("family style: the scan", () => {
  it("finds the sources at all (the scan is the test's own load-bearing part)", () => {
    expect(sources.length).toBeGreaterThan(60);
    expect(sources.some((s) => s.file === SHELL)).toBe(true);
    expect(sources.some((s) => s.file === SURFACE)).toBe(true);
    expect(sources.some((s) => s.file === "patterpad-surface/src/inspect.ts")).toBe(true);
    expect(sources.some((s) => /\.test\.ts$/.test(s.file) || s.file.includes("/preview/"))).toBe(false);
  });
});

describe("family style: icons are drawn", () => {
  // The glyphs the shell's icon vocabulary replaced (its deprecated table, plus the multiplication
  // sign, the warning sign and the anticlockwise arrow that apps typed beside them), the option
  // diamond, and the gear. The command ellipsis ("Open…") is not in the class: the platform expects
  // it, and it stays (design-language.md section 4). The house style's menu-path "▸" is stripped
  // before the test: a "▸" between a word and a capitalised word is a path in copy ("Project
  // Settings ▸ World properties", copy-house-style.md rule 16), not an icon.
  const GLYPH = /[✕⋯▸▾‹›↑↓✓⊘○✎●‼▶⟲▦☰◈⠿❝×⚠↺◇◆⚙]/;
  const withoutMenuPaths = (line: string): string => line.replace(/(?<=[\w…&] )▸(?= [A-Z])/g, "");

  it("types no icon glyph into a string the renderer shows", () => {
    const hits = lineHits(GLYPH).filter((h) => GLYPH.test(withoutMenuPaths(h.key)));
    hold("typed icon glyph", hits, [
      { file: "patterpad-surface/src/grouplabel.ts", match: '"◇ option"', why: "the diamond option marker: the option's structural label on the rail, the one non-icon mark the surface keeps (the same diamond is drawn on the prompt cell by CSS)" },
      { file: "patterpad-surface/src/inspect.ts", match: '"◇ option"', why: "the same label handed to the inspector through the surface's inspect contract (GroupLevel.label)" },
    ], [
      { file: "patterpad-surface/src/schema.ts", match: '"⚙"', why: "the game-event atom's typed gear on the reading surface; the family word for it is a drawn icon" },
      { file: "patterpad-surface/web/views.ts", match: /glyph\.textContent = "⚙"/, why: "the same gear, set again by the game-event node view" },
      { file: "patterpad/src/renderer/play/play.ts", match: /"⚙ game event"/, why: "the same gear on the Play window's rendered game-event line" },
    ]);
  });

  it("draws nothing from a symbol font in CSS content either", () => {
    const CONTENT = /(^|[;{\s])content:\s*["'][^"']*([^\x20-\x7e]|\\[0-9a-f]{2,6})/i;
    hold("glyph in CSS content", lineHits(CONTENT, ["css"]), [
      { file: SURFACE, match: 'content: "◇"', why: "the diamond option marker on .option-prompt::before, the same mark grouplabel.ts types" },
    ], []);
  });
});

describe("family style: separators and key hints are drawn", () => {
  // Storyletter's notation.test.ts list, less the arrow-in-a-tooltip cases notation.test.ts here
  // already holds by behaviour. Metadata goes through the shell's metaLine, a trail through
  // breadcrumb, a key through keyLabel / tipWithKey / keyHint.
  const TYPED: [RegExp, string][] = [
    [/ · /, "a middle-dot separator (use metaLine)"],
    [/ › /, "a typed chevron trail (use breadcrumb)"],
    [/↑↓|↵|\(↑\)|\(↓\)/, "a typed key glyph (use keyHint / tipWithKey)"],
    [/→/, "a typed arrow (use iconNode(\"arrowRight\"))"],
    [/\((Esc|Enter|Home|F\d{1,2}|Shift\+F\d{1,2})\)/, "a key typed into a tooltip (use tipWithKey)"],
  ];

  it("types no separator or key notation into a string", () => {
    const hits = TYPED.flatMap(([re, why]) => lineHits(re).map((h) => ({ ...h, key: `${h.key}  [${why}]` })));
    // The reading-surface strings that flow through the surface's inspect contract: the group rail's
    // structural label is prose the writer reads inside the script column ("sequence · shuffle ·
    // once"), the same string the inspector receives as GroupLevel.label. They are the surface's
    // notation, not chrome, and they are listed here by file so that the day they move to a drawn
    // form the entries go with them.
    hold("typed separator", hits, [
      { file: "patterpad-surface/src/grouplabel.ts", match: /"branch · first match"/, why: "the branch rail label on the reading surface, through the inspect contract" },
      { file: "patterpad-surface/src/grouplabel.ts", match: /`sequence · /, why: "the sequence rail label (order · exhaust) on the reading surface, through the inspect contract" },
      { file: "patterpad-surface/web/views.ts", match: /parts\.join\(" · "\)/, why: "a game event's field summary on the reading surface (key: value · key: value), the same text the inspect contract carries" },
      { file: "patterpad-surface/web/views.ts", match: /"  · secret"/, why: "the option rail's secret flag beside its marker, on the reading surface" },
      { file: "patterpad/src/renderer/src/inspector.ts", match: /replace\(\/\^sequence · \/, ""\)/, why: "the inspector STRIPPING the surface's label prefix it received through the inspect contract; the literal is never shown" },
    ], []);
  });

  it("hard-codes no modifier: the shell helper writes ⌘ on macOS and Ctrl elsewhere", () => {
    hold("typed modifier", lineHits(/Cmd\+|⌘/), [], []);
  });
});

describe("family style: tooltips go through the shell", () => {
  // A native `title` is the OS's own tooltip: a different face, a different delay, no keycap, and on
  // Windows a yellow box. The shell's tooltip (data-tip, `tip` on el()) is the family's one tooltip.
  const TITLE = /\.title\s*=[^=]|setAttribute\(\s*["']title["']|\btitle="/;

  it("sets no native title tooltip", () => {
    hold("native title", lineHits(TITLE), [
      { file: "patterpad-surface/web/index.html", match: /class="hdr-toggle"/, count: 3, why: "the surface's standalone vite harness page (npm run dev in patterpad-surface), not shipped in Patterpad; its three header toggles explain themselves to a developer" },
    ], [
      { file: "patterpad/src/renderer/index.html", match: /id="report-more"/, why: "the report pane's scroll-for-more button carries title=\"More below\" beside its aria-label; the label alone is the family form" },
      { file: "patterpad/src/renderer/src/coverage-view.ts", match: /\.title = /, count: 4, why: "the Coverage window's dry-choice rows, gate references and dead-beat links explain themselves through native titles; the shell tooltip is the family form" },
    ]);
  });
});

describe("family style: no dashes in strings", () => {
  it("types no em-dash or en-dash", () => {
    hold("dash", lineHits(/[—–]/, ["ts", "html", "css"]), [], [
      { file: "patterpad/src/renderer/src/inspector.ts", match: /"—"/, count: 2, why: "the em-dash standing for an empty value in the inspector's Character and Address rows; the family word is a muted \"None\" or the field left blank" },
    ]);
  });
});

describe("family style: focus is always visible", () => {
  // `outline: none` is fine when the same rule draws the replacement (a border, a ring, a wash);
  // on its own it deletes the focus ring and nothing else.
  it("removes no outline without drawing a replacement in the same rule", () => {
    const hits = blockHits((body) => /outline:\s*(none|0)\b/.test(body) && !/border|box-shadow|background/.test(body));
    hold("outline: none", hits, [
      { file: SURFACE, match: /^\.ProseMirror$/, why: "the editable script column itself: its caret is its focus indicator, and a ring around a 42rem reading measure would mark the page, not a control" },
      { file: SURFACE, match: /^\.ProseMirror:focus$/, why: "the same column, focused: the caret is the indicator" },
      { file: SURFACE, match: /^\.ProseMirror-selectednode$/, why: "ProseMirror's default outline on a node selection, replaced by the inset accent ring and wash the next two rules draw on .bubble.ProseMirror-selectednode and the game-event beat" },
    ], []);
  });
});

describe("family style: captions are words, not overlines", () => {
  // A tracked ALL-CAPS caption survives in exactly two places: table column heads and screenplay
  // character cues, where uppercase is the domain's own convention. Everything else in the pending
  // list is the eyebrow the review counted (design/ui-review-2026-09/00-conclusions.md, "Overline
  // retired as default") and is to become sentence-case text at label size, weight 600.
  it("tracks no uppercase caption outside the cues and the table heads", () => {
    const hits = blockHits((body) => /text-transform:\s*uppercase/.test(body) && /letter-spacing/.test(body));
    hold("tracked uppercase caption", hits, [
      { file: PLAY, match: /^\.pcue$/, why: "the character cue in the Play window's rendered script: a screenplay convention" },
      { file: SHELL, match: /^\.scratch-cue$/, why: "the character cue over the line being scratch-recorded: the script's own cue" },
      { file: SURFACE, match: /^\.zone\.cue \.cue-text$/, why: "the character cue on the writing surface: the screenplay form" },
      { file: SURFACE, match: /^\.cue-ac-item$/, why: "the cast popup's rows are the cues they will become, in the script's cue casing" },
      { file: SURFACE, match: /^\.cue-ac-field$/, why: "the cast popup's field, where the cue is typed, in the same casing as the rows" },
      { file: SHELL, match: /^\.rpt-table th$/, why: "a table column head, the other place the overline survives" },
    ], [
      { file: SHELL, match: /^\.suggestion-popover \.sg-outcome$/, why: "eyebrow over a suggestion's outcome" },
      { file: SHELL, match: /^\.suggestion-popover \.sg-diff-label$/, why: "eyebrow over a suggestion's diff" },
      { file: SHELL, match: /^\.inspector-label$/, why: "the inspector's section caption" },
      { file: SHELL, match: /^\.effects-section-cap$/, why: "the effects editor's section caption" },
      { file: SHELL, match: /^\.scratch-badge$/, why: "the scratch recorder's state badge" },
      { file: SHELL, match: /^\.scratch-next-label$/, why: "the scratch recorder's next-line caption" },
      { file: SHELL, match: /^\.insp-gd-cap$/, why: "the inspector's game data caption" },
      { file: SHELL, match: /^\.overview-scenes-label$/, why: "the project overview's scenes caption" },
      { file: SHELL, match: /^\.doc-class-label$/, why: "the documentation class label" },
      { file: SHELL, match: /^\.rpt-badge$/, why: "the report's badge" },
      { file: SHELL, match: /^\.rpt-card-label$/, why: "the report card's caption" },
      { file: SHELL, match: /^\.rpt-section-cap$/, why: "the report's section caption" },
      { file: SHELL, match: /^\.est-tags-label$/, why: "the estimating tab's tags caption" },
      { file: SHELL, match: /^\.gd-statuscap$/, why: "the game data status caption" },
      { file: SEARCH, match: /^\.swin-kind$/, why: "the Find window's result-kind tag" },
      { file: COVERAGE, match: /^\.cov-opt$/, why: "the Coverage window's option captions" },
      { file: COVERAGE, match: /^\.cov-stat-label$/, why: "the Coverage window's stat captions" },
      { file: COVERAGE, match: /^\.cov-stopped$/, why: "the Coverage window's stopped badge" },
      { file: COVERAGE, match: /^\.cov-scene-dead$/, why: "the Coverage window's dead-scene tag" },
      { file: COVERAGE, match: /^\.cov-kind$/, why: "the Coverage window's beat-kind tag" },
      { file: SURFACE, match: /^\.overline$/, why: "the surface's own copy of the retired .overline utility" },
      { file: SURFACE, match: /^\.doc-underhead-cls$/, why: "the documentation class label under a block head" },
      { file: SURFACE, match: /^\.block-ctl$/, why: "the block head's control captions" },
      { file: SURFACE, match: /^\.status-pill$/, why: "the writing-status pill in the gutter" },
      { file: SURFACE, match: /^\.group-rail-head$/, why: "the group rail's structural label" },
      { file: SURFACE, match: /^\.group-ctl$/, why: "the group rail's control captions" },
      { file: SURFACE, match: /^\.action-head$/, why: "the action menu's section heads" },
      { file: SURFACE, match: /^\.slash-head$/, why: "the slash menu's section heads" },
    ]);
  });
});

describe("family style: chrome has its own scale", () => {
  // chrome-scale.test.ts pins shell.css (two rem, both rendered script), search.css and coverage.css
  // (none), and samples the Play window and the surface's mixed sheet. This extends the two mixed
  // sheets to the whole file: EVERY rule that carries a rem is a reading rule on this list (the set
  // Track D kept, design/ui-review-2026-09/09c-track-d-patterpad-chrome.md "READING, kept"), so a
  // chrome rule cannot reach for the reading scale anywhere in either sheet.
  const READING = new Set<string>([
    // play.css: the rendered walk.
    "body.play", ".play-transcript", ".pline", ".pline.gameEvent", ".pcue", ".pdir", ".play-choices", ".pchoice",
    // styles.css: the script column and everything set in it.
    "body", "#editor", ".ProseMirror", ".scene-title", ".block-head", ".doc-underhead", ".doc-underhead-indent",
    ".doc-underhead-line", ".doc-underhead-cls", ".block-name", ".block-after", ".block-ctl", ".bubble", ".bubble-drag",
    ".bubble-menu", ".bubble-cond", ".bubble-jump", ".bubble-after", ".bubble-after::before", ".bubble-after::after",
    ".block.is-empty > .ghost-snippet, .group-rail.is-empty > .ghost-snippet", ".group-rail.is-empty > .ghost-snippet",
    ".ghost-plus", ".bubble.atom-first > .bubble-above", ".bubble.atom-first > .bubble-above .ghost-plus", ".bubble.is-empty",
    ".bubble.is-empty > .bubble-ghost", ".bubble.is-empty.has-jump", ".rawnode", ".menu-dots", ".beats .beat.kind-line",
    ".beat.kind-line + .beat.kind-prose, .beat.kind-prose + .beat.kind-line", ".zone.cue .cue-text",
    ".beat.kind-line .zone.paren, .beat.kind-line .zone.say", ".zone.paren", ".suggestion-count", ".beat.kind-gameEvent",
    ".beat.kind-gameEvent .atom-fields", ".group-rail", ".group-rail-head", ".option-prompt", ".option-prompt::before",
    ".group-rail.is-option > .option-after", ".group-rail-cond", ".group-menu", ".group-ctl", ".atom-del",
  ]);
  const REM = /(?<![\w.-])\d*\.?\d+rem\b/;

  it("keeps rem to the reading rules in the two mixed sheets", () => {
    const hits = blockHits((body) => REM.test(body), [PLAY, SURFACE, SURFACE_THEME]).filter((h) => !READING.has(h.key));
    expect(hits.map(fmt), "a rem in a rule that is not on the reading list").toEqual([]);
  });

  it("names no reading rule that has stopped carrying rem (the list can only shrink)", () => {
    const carrying = new Set(blockHits((body) => REM.test(body), [PLAY, SURFACE]).map((h) => h.key));
    expect([...READING].filter((sel) => !carrying.has(sel))).toEqual([]);
  });

  it("hands no rem length to the DOM from TypeScript", () => {
    hold("rem in a TS string", lineHits(/["'`][^"'`\n]*(?<![\w.-])\d*\.?\d+rem\b/, ["ts"]), [], []);
  });
});
