// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// The playable page's line timing (line padding): each line is timed by game-subtitles' estimateDuration, the
// estimate Patterstage uses, and the step's padAfter says when the next one starts, under the player rules
// (no pause before a choice or after the last line, a cut-in never before the line it cuts into, a game
// event done at once). The Speed setting scales the whole timing and keeps the stored key Patterpad's Play
// window shares, reading the old reading-pace values. Runs the generated page's own scripts in a DOM, on
// fake timers.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { estimateDuration } from "@wildwinter/game-subtitles";
import { exportBundle } from "@patterkit/compiler";
import type { Bundle, LocaleFile, ProjectFile, Scene } from "@patterkit/model";
import { loadProject, runExportHtml, runExportWeb } from "../src/index.js";

// A path, not a URL: under jsdom, URL is the DOM's, which fileURLToPath refuses.
const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "fixture");

const TEXT = {
  A: "Hello there, friend.",
  B: "This one runs on for a good while, long enough to be timed longer than the shortest.",
  C: "Short.",
  D: "Next.",
  P: "Ask about the road",
  R: "Reply.",
};
const project: ProjectFile = {
  schema: "patter/project@0", project: { id: "t", name: "Timing" },
  locales: { default: "en", all: ["en"] },
};
const scene: Scene = {
  id: "s", type: "scene", name: "S",
  blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "s1", type: "snippet", beats: [
      { id: "A", kind: "line", character: "ANNA", padAfter: -0.5 }, // B cuts in half a second before A ends
      { id: "B", kind: "line", character: "BEN", padAfter: 2 },     // a two-second pause...
      { id: "E", kind: "gameEvent", gameData: { cue: "door" } },    // ...counted from the event, done at once
      { id: "C", kind: "text", padAfter: -4 },                      // longer than C: D starts as C starts
      { id: "D", kind: "line", character: "ANNA", padAfter: 3 },    // before a choice: its pause unused
    ] },
    { id: "ch", type: "group", selector: "choice", children: [
      { id: "o1", type: "group", prompt: { id: "P", kind: "text" }, children: [
        { id: "s2", type: "snippet", beats: [{ id: "R", kind: "line", character: "BEN", padAfter: 5 }], jump: { to: "END" } },
      ] },
    ] },
  ] }],
};
const en: LocaleFile = { schema: "patter/strings@0", scene: "s", locale: "en", strings: TEXT };
const bundle: Bundle = exportBundle({ project, scenes: [scene], locales: [en] });

// The generated page's scripts, in order (runtime, timing, bundle, player), and its body markup.
const html = runExportHtml(loadProject(fixtureDir));
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
const bodyMarkup = html.slice(html.indexOf("<body>") + 6, html.indexOf("<script>"));

const ms = (secs: number): number => Math.round(secs * 1000);
const stage = (): string[] => Array.from(document.querySelectorAll("#stage > div")).map((d) => d.textContent ?? "");
const startPage = (): void => {
  document.body.innerHTML = bodyMarkup;
  const w = window as unknown as Record<string, unknown>;
  (0, eval)(scripts[0]!); // the runtime: window.Patterplay
  (0, eval)(scripts[1]!); // the timing: window.GameSubtitles
  w.PATTER_BUNDLE = JSON.parse(JSON.stringify(bundle));
  (0, eval)(scripts[3]!); // the player, which starts a new game
};

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  window.scrollTo = (() => {}) as typeof window.scrollTo;
});
afterEach(() => { vi.useRealTimers(); });

describe("playable HTML: line timing", () => {
  it("inlines the estimate with the runtime, and offers the speed-up values", () => {
    expect(scripts).toHaveLength(4);
    expect(scripts[1]).toContain("GameSubtitles");
    expect(html).toContain('<option value="half">');
    expect(html).toContain('<option value="double">');
    expect(html).not.toContain('value="slow"');
    expect(runExportWeb(loadProject(fixtureDir)).patterplayJs).toContain("GameSubtitles");
  });

  it("times lines by the estimate and padAfter, under the player rules", () => {
    startPage();
    expect(stage()).toEqual(["ANNA" + TEXT.A]); // the first line starts at once

    // A cut-in: B starts half a second before A's estimated end.
    const aToB = ms(estimateDuration(TEXT.A) - 0.5);
    vi.advanceTimersByTime(aToB - 1);
    expect(stage()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(stage()).toHaveLength(2);

    // A pause, with a game event between that isn't held: it runs from B's end as usual.
    const bToC = ms(estimateDuration(TEXT.B) + 2);
    vi.advanceTimersByTime(bToC - 1);
    expect(stage()).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(stage()[2]).toBe(TEXT.C);

    // A cut-in longer than the line itself starts the next line as that line starts.
    vi.advanceTimersByTime(1); // a zero wait (fake timers, like Node, run a timer of 0 after 1 ms)
    expect(stage()[3]).toBe("ANNA" + TEXT.D);

    // The line before a choice keeps no pause: the options appear while it plays.
    vi.advanceTimersByTime(1); // a zero wait (fake timers, like Node, run a timer of 0 after 1 ms)
    const option = document.querySelector<HTMLButtonElement>("#controls .choice")!;
    expect(option.textContent).toBe(TEXT.P);

    // The reply to a choice with no spoken prompt starts at once.
    option.click();
    expect(stage()[4]).toBe("BEN" + TEXT.R);

    // The last line's pause is unused: the end comes as the line ends.
    vi.advanceTimersByTime(ms(estimateDuration(TEXT.R)) - 1);
    expect(stage()).toHaveLength(5);
    vi.advanceTimersByTime(1);
    expect(stage()[5]).toBe("The End");
  });

  it.each([
    ["half", 2], ["slow", 2], ["double", 0.5], ["fast", 0.5], ["normal", 1], ["nonsense", 1],
  ])("the stored speed %s scales the whole timing by %s, reading the old values", (stored, scale) => {
    localStorage.setItem("patter.playSpeed", stored);
    startPage();
    const gap = Math.round((estimateDuration(TEXT.A) - 0.5) * scale * 1000);
    vi.advanceTimersByTime(gap - 1);
    expect(stage()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(stage()).toHaveLength(2);
    // The control shows the new name for an old value, and the stored choice isn't rewritten until it's changed.
    const select = document.querySelector<HTMLSelectElement>("#speed")!;
    expect(select.value).toBe({ slow: "half", fast: "double", nonsense: "normal" }[stored] ?? stored);
    expect(localStorage.getItem("patter.playSpeed")).toBe(stored);
  });

  it("instant drops every wait, and a change of speed is stored under the shared key", () => {
    startPage();
    const select = document.querySelector<HTMLSelectElement>("#speed")!;
    select.value = "instant";
    select.dispatchEvent(new Event("change"));
    expect(localStorage.getItem("patter.playSpeed")).toBe("instant");
    vi.advanceTimersByTime(ms(estimateDuration(TEXT.A) - 0.5)); // A's wait was set at normal speed
    vi.advanceTimersByTime(1);
    vi.advanceTimersByTime(1);
    vi.advanceTimersByTime(1);
    expect(stage()).toHaveLength(4);
    expect(document.querySelector("#controls .choice")).not.toBeNull();
  });

  it("saves the game as the reader sees it, not the step read ahead", () => {
    startPage();
    // A is on screen and B has been read ahead; a save now must bring B back on load.
    document.getElementById("save")!.click();
    document.getElementById("load")!.click();
    expect(stage()).toEqual(["(resumed from save)", "BEN" + TEXT.B]);
  });
});
