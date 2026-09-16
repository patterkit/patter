// @vitest-environment jsdom
// Track D, the notation half: every typed separator and key-hint notation in Patterpad's chrome is
// drawn DOM through the shell's helpers ("Icons are drawn, and so are separators"; "One casing rule,
// and platform-true key hints"), and the problems bar's copy goes through the shell's translator
// ("Diagnostics name what the author can see"). These tests hold the four sites that can be reached
// without a window: the search hint line and crumbs, the coverage meta line, and the problem copy.

import { afterEach, describe, it, expect } from "vitest";
import { setKeyPlatform } from "@wildwinter/app-shell";
import type { Problem, CoverageReport } from "../shared/api.js";
import { modeHint, locationCrumbs } from "./search/pieces.js";
import { renderCoverage } from "./src/coverage-view.js";
import { PATTERPAD_PROBLEM_COPY, problemCode, problemLineFor, toProblemLike } from "./src/problem-copy.js";

const TYPED = /[·›↑↓↵⌘⇧⌫]/;
const host = (...kids: Node[]): HTMLElement => { const d = document.createElement("div"); d.append(...kids); return d; };
/** The text of `n` outside its keycaps: a legend INSIDE a drawn `kbd` is the platform's own spelling; the
 *  same glyph typed into running text is the notation these tests rule out. */
const typed = (n: Element): string => { const c = n.cloneNode(true) as Element; c.querySelectorAll("kbd").forEach((k) => k.remove()); return c.textContent ?? ""; };

afterEach(() => setKeyPlatform(undefined));

describe("the search window's hint line", () => {
  it("is a lead phrase and a shell hint bar of keycaps, nothing typed between", () => {
    setKeyPlatform("mac");
    const h = host(...modeHint("status"));
    expect(h.querySelector(".swin-hint-lead")?.textContent).toBe("Pick a writing status, then type to filter");
    const chips = [...h.querySelectorAll(".shell-hintbar .shell-hint")];
    expect(chips.map((c) => c.querySelector(".shell-hint-label")?.textContent)).toEqual(["Move", "Jump"]);
    expect(chips[0]?.querySelectorAll("kbd.shell-kbd").length).toBe(2); // the two arrows, one cap each
    expect([...chips[0]!.querySelectorAll("kbd")].map((k) => k.textContent)).toEqual(["↑", "↓"]);
    expect(chips[1]?.querySelector("kbd")?.textContent).toBe("↩");
    expect(typed(h)).not.toMatch(TYPED);
    expect(h.querySelector("[title]")).toBeNull();
  });
  it("spells the keys out on Windows", () => {
    setKeyPlatform("win");
    const h = host(...modeHint("content"));
    expect([...h.querySelectorAll(".shell-hint kbd")].map((k) => k.textContent)).toEqual(["Up", "Down", "Enter", "Esc"]);
    expect(h.textContent).toContain("Drag the bar to move this window");
    expect(typed(h)).not.toMatch(TYPED);
  });
  it("every mode is free of typed notation, and replace mode is a sentence with no keys", () => {
    for (const mode of ["content", "replace", "status", "recording", "property", "tag"] as const) {
      const h = host(...modeHint(mode));
      expect(typed(h), mode).not.toMatch(TYPED);
      expect(h.textContent, mode).not.toContain(" / ");
    }
    expect(host(...modeHint("replace")).querySelector(".shell-hintbar")).toBeNull();
  });
});

describe("a result's location", () => {
  it("is a breadcrumb with a drawn chevron between crumbs, never a typed one", () => {
    const trail = locationCrumbs(["Act one", "The tavern"]);
    expect(trail.classList.contains("shell-crumbs")).toBe(true);
    expect([...trail.querySelectorAll(".shell-crumb")].map((c) => c.textContent)).toEqual(["Act one", "The tavern"]);
    const seps = trail.querySelectorAll("svg.shell-crumb-sep");
    expect(seps.length).toBe(1);
    expect(seps[0]?.getAttribute("data-icon")).toBe("forward");
    expect(trail.textContent).not.toMatch(TYPED);
  });
});

describe("the coverage meta line", () => {
  const report = (evalError: number): CoverageReport => ({
    runs: 6, maxSteps: 200, seed: 4, start: {}, beats: [],
    totals: { beats: 10, covered: 8, neverHit: 2, coveragePct: 80 },
    termination: { ended: 4, capped: 1, stalled: 1, evalError },
    drivers: [], unwrittenInputs: [], dryChoices: [], cancelled: false,
  });
  it("draws the run parameters and the endings as two metaLines, no typed dot", () => {
    const h = document.createElement("div");
    renderCoverage(h, report(0), (id) => id, () => {});
    const lines = [...h.querySelectorAll(".cov-meta .shell-meta")];
    expect(lines.length).toBe(2);
    expect([...lines[0]!.querySelectorAll(".shell-meta-part")].map((p) => p.textContent)).toEqual(["6 runs", "200 max steps", "seed 4"]);
    expect([...lines[1]!.querySelectorAll(".shell-meta-part")].map((p) => p.textContent)).toEqual(["4 ended", "1 stalled", "1 capped"]);
    expect(lines[1]?.classList.contains("cov-meta-ended")).toBe(true);
    expect(h.querySelector(".cov-meta")?.textContent).not.toMatch(TYPED);
  });
  it("adds the errored part only when there were errors", () => {
    const h = document.createElement("div");
    renderCoverage(h, report(2), (id) => id, () => {});
    const parts = [...h.querySelectorAll(".cov-meta .shell-meta")[1]!.querySelectorAll(".shell-meta-part")].map((p) => p.textContent);
    expect(parts).toEqual(["4 ended", "1 stalled", "1 capped", "2 errored"]);
  });
});

describe("the problems bar's copy", () => {
  const problem = (over: Partial<Problem>): Problem => ({ category: "structure", severity: "error", message: "x", ...over });
  const CODES = ["missing-prompt", "invalid-prompt", "unknown-character", "empty-snippet", "empty-container", "empty-scene",
    "missing-name", "choice-can-empty", "multiple-fallbacks", "dangling-jump", "jump-into-non-addressable", "invalid-gameid",
    "duplicate-gameid", "stale-build", "merge-conflict"];

  it("has an entry for every code Patterpad raises, each a sentence", () => {
    for (const code of CODES) {
      const entry = PATTERPAD_PROBLEM_COPY[code];
      expect(entry, code).toBeTypeOf("function");
      const copy = entry!({ code, message: "" });
      expect(copy.text, code).toMatch(/^[A-Z“].*\.$/);
      expect(copy.text, code).not.toContain("[");
    }
  });

  it("keys a Patterpad problem on its category + detail pair", () => {
    expect(problemCode({ category: "stale-bundle" })).toBe("stale-build");
    expect(problemCode({ category: "merge" })).toBe("merge-conflict");
    expect(problemCode({ category: "structure", detail: "missing-prompt" })).toBe("missing-prompt");
    expect(problemCode({ category: "condition", detail: "cond" })).toBe("cond");
    for (const category of ["not-in-project", "spelling", "hygiene"] as const) expect(problemCode({ category, detail: "x" })).toBeUndefined();
  });

  it("keeps the hand-written sentences and their next steps", () => {
    expect(problemLineFor(problem({ detail: "missing-prompt" }))).toBe("This option needs a label. What does the player choose here?");
    expect(problemLineFor(problem({ detail: "empty-snippet" }))).toBe("This snippet is empty. Add a line, or send it somewhere.");
    expect(problemLineFor(problem({ detail: "choice-can-empty" }))).toBe("This choice can run dry. Once each option is used up and there's no fallback, it has nothing left to show.");
    expect(problemLineFor(problem({ detail: "dangling-jump" }))).toBe("This doesn't point anywhere valid. Choose where it goes.");
    expect(problemLineFor(problem({ detail: "invalid-gameid" }))).toBe("This Game ID isn't valid. Use lowercase letters, digits and hyphens.");
    expect(problemLineFor(problem({ detail: "duplicate-gameid" }))).toBe("This Game ID is already used elsewhere. Each one must be unique.");
    expect(problemLineFor(problem({ detail: "missing-name" }))).toBe("This needs a name.");
    expect(problemLineFor(problem({ category: "stale-bundle", severity: "warning", file: "/p/patter-dist/x.patterc" }), "patter-dist/x.patterc"))
      .toBe("Your playable build (patter-dist/x.patterc) is out of date. It refreshes the next time you export.");
    expect(problemLineFor(problem({ category: "stale-bundle", severity: "warning" }))).toBe("Your playable build is out of date. It refreshes the next time you export.");
    expect(problemLineFor(problem({ category: "merge", file: "/p/a.patterflow" }), "a.patterflow")).toBe("a.patterflow still has an unresolved merge conflict in it.");
    expect(problemLineFor(problem({ category: "merge" }))).toBe("This file still has an unresolved merge conflict in it.");
  });

  it("names the speaker of an unknown-character problem by title", () => {
    const p = problem({ detail: "unknown-character", message: "line L1: 'ANNA' is not in the project cast" });
    expect(toProblemLike(p).title).toBe("ANNA");
    expect(problemLineFor(p)).toBe("“ANNA” isn't in your cast yet.");
    expect(problemLineFor(problem({ detail: "unknown-character", message: "speaker missing" }))).toBe("This line's speaker isn't in your cast yet.");
  });

  it("falls back to the softened message, titled by the file for a hygiene note, and never writes [", () => {
    expect(problemLineFor(problem({ category: "condition", detail: "cond", message: "unknown property: '@gold' (spec §3.2)" })))
      .toBe("uses a property that isn't set up yet: “gold”");
    expect(problemLineFor(problem({ category: "interpolation", message: "voiced line beats cannot contain interpolation" })))
      .toBe("voiced lines can't contain inserts");
    expect(problemLineFor(problem({ category: "hygiene", severity: "warning", message: "has a BOM", file: "/p/a.patterflow" }), "a.patterflow")).toBe("a.patterflow: has a BOM");
    expect(problemLineFor(problem({ category: "hygiene", severity: "warning", message: "has a BOM" }))).toBe("has a BOM");
    expect(problemLineFor(problem({ category: "not-in-project", message: "b.patterflow isn't part of this project [b]" }))).toBe("b.patterflow isn't part of this project");
    expect(problemLineFor(problem({ category: "spelling", severity: "info", message: "“teh” may be misspelt" }))).toBe("“teh” may be misspelt");
    // The translator strips a trailing `[where]` and never writes one of its own.
    expect(problemLineFor(problem({ detail: "nope", message: "odd [x]" }))).toBe("odd");
    expect(problemLineFor(problem({ category: "condition", message: "bad thing [node-1]" }))).toBe("bad thing");
  });
});
