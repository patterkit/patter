// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// The playable page's line timing (line padding): each line is timed by game-subtitles' estimateDuration, the
// estimate Patterstage uses, and the step's padAfter says when the next one starts, under the player rules
// (the choices as the last line starts, the end as every line still playing ends, a cut-in never before
// the line it cuts into, a game event done at once). The Speed setting scales the whole timing from the
// moment it's changed, and keeps the stored key Patterpad's Play window shares, reading the old reading-pace
// values. Runs the generated page's own scripts in a DOM, on
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

// A long line cut in on by a short one, then a choice or the end: the end waits for the long line to finish,
// the choices don't.
const LONG = { L: TEXT.B, S: TEXT.C, P: TEXT.P };
const cutInThen = (then: "choice" | "end"): Bundle => exportBundle({
  project,
  scenes: [{ id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "s1", type: "snippet", beats: [
      { id: "L", kind: "line", character: "ANNA", padAfter: -4 },
      { id: "S", kind: "line", character: "BEN", padAfter: 1 },
    ], ...(then === "end" ? { jump: { to: "END" } } : {}) },
    ...(then === "choice" ? [{ id: "ch", type: "group" as const, selector: "choice" as const, children: [
      { id: "o1", type: "group" as const, prompt: { id: "P", kind: "text" as const }, children: [{ id: "s2", type: "snippet" as const, jump: { to: "END" } }] },
    ] }] : []),
  ] }] }],
  locales: [{ schema: "patter/strings@0", scene: "s", locale: "en", strings: LONG }],
});

const ms = (secs: number): number => Math.round(secs * 1000);
const stage = (): string[] => Array.from(document.querySelectorAll("#stage > div")).map((d) => d.textContent ?? "");
const startPage = (story: Bundle = bundle): void => {
  document.body.innerHTML = bodyMarkup;
  const w = window as unknown as Record<string, unknown>;
  (0, eval)(scripts[0]!); // the runtime: window.Patterplay
  (0, eval)(scripts[1]!); // the timing: window.GameSubtitles
  w.PATTER_BUNDLE = JSON.parse(JSON.stringify(story));
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
    expect(stage()[3]).toBe("ANNA" + TEXT.D);

    // The line before a choice keeps no pause: the options appear while it plays.
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
    expect(stage()).toHaveLength(4); // the wait in flight is cut short, and the rest has no waits

    expect(document.querySelector("#controls .choice")).not.toBeNull();
  });

  it("ends when every line still playing has finished, an earlier cut-in-on line included", () => {
    startPage(cutInThen("end"));
    const long = estimateDuration(LONG.L), short = estimateDuration(LONG.S);
    vi.advanceTimersByTime(ms(long - 4));
    expect(stage()).toHaveLength(2); // the short line cuts in four seconds before the long one ends
    vi.advanceTimersByTime(ms(short) + 1);
    expect(stage()).toHaveLength(2); // the short line is over, but the long one is still playing
    vi.advanceTimersByTime(ms(long) - ms(long - 4) - ms(short) - 2);
    expect(stage()).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(stage()[2]).toBe("The End");
  });

  it("shows the choices as the last line before them starts, while an earlier one still plays", () => {
    startPage(cutInThen("choice"));
    vi.advanceTimersByTime(ms(estimateDuration(LONG.L) - 4) - 1);
    expect(document.querySelector("#controls .choice")).toBeNull();
    vi.advanceTimersByTime(1);
    expect(stage()).toHaveLength(2);
    expect(document.querySelector("#controls .choice")?.textContent).toBe(LONG.P);
  });

  it("applies a change of speed at once, keeping the time already played", () => {
    startPage(); // A lasts 1.5 seconds (the estimate's floor) and B cuts in half a second before it ends
    expect(estimateDuration(TEXT.A)).toBe(1.5);
    vi.advanceTimersByTime(500); // half a second played at normal speed
    const select = document.querySelector<HTMLSelectElement>("#speed")!;
    select.value = "half";
    select.dispatchEvent(new Event("change"));
    // The half second still to come before B takes a whole second at half speed.
    vi.advanceTimersByTime(999);
    expect(stage()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(stage()).toHaveLength(2);
  });

  it("saves the game as the reader sees it, not the step read ahead", () => {
    startPage();
    // A is on screen and B has been read ahead; a save now must bring B back on load.
    document.getElementById("save")!.click();
    document.getElementById("load")!.click();
    expect(stage()).toEqual(["(resumed from save)", "BEN" + TEXT.B]);
  });
});
