// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// The playable page's Continue toggle, as in Patterpad's Play window and under its stored key: on, the story
// plays through on its timing; off, each beat waits for the reader (a click on the page, Space or Enter, or the
// Next button), and the choices and the end come with the last line. A reader's own choice holds; with none, an
// unvoiced story starts with Continue off and a voiced one with it on. Runs the generated page's own scripts in
// a DOM, on fake timers.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { exportBundle } from "@patterkit/compiler";
import type { Bundle, ProjectFile, Scene } from "@patterkit/model";
import { loadProject, runExportHtml } from "../src/index.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "fixture");
const html = runExportHtml(loadProject(fixtureDir));
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
const bodyMarkup = html.slice(html.indexOf("<body>") + 6, html.indexOf("<script>"));

const TEXT = { A: "The first paragraph, which runs on for quite a while.", B: "The second.", C: "The third.", P: "Go on", R: "The reply." };
const story = (voiced: boolean): Bundle => {
  const project: ProjectFile = { schema: "patter/project@0", project: { id: "t", name: "Story" }, locales: { default: "en", all: ["en"] }, voiced };
  const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "s1", type: "snippet", beats: [{ id: "A", kind: "text" }, { id: "B", kind: "text" }, { id: "C", kind: "text" }] },
    { id: "ch", type: "group", selector: "choice", children: [
      { id: "o1", type: "group", prompt: { id: "P", kind: "text" }, children: [
        { id: "s2", type: "snippet", beats: [{ id: "R", kind: "text" }], jump: { to: "END" } },
      ] },
    ] },
  ] }] };
  return exportBundle({ project, scenes: [scene], locales: [{ schema: "patter/strings@0", scene: "s", locale: "en", strings: TEXT }] });
};

const stage = (): string[] => Array.from(document.querySelectorAll("#stage > div")).map((d) => d.textContent ?? "");
const next = (): HTMLButtonElement | null => document.querySelector("#controls .next");
const choices = (): string[] => Array.from(document.querySelectorAll("#controls .choice")).map((b) => b.textContent ?? "");
const toggle = (): HTMLButtonElement => document.querySelector<HTMLButtonElement>("#continue")!;
const startPage = (b: Bundle, markup = bodyMarkup): void => {
  document.body.innerHTML = markup;
  (0, eval)(scripts[0]!);
  (window as unknown as Record<string, unknown>).PATTER_BUNDLE = JSON.parse(JSON.stringify(b));
  (0, eval)(scripts[2]!);
};

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  window.scrollTo = (() => {}) as typeof window.scrollTo;
});
afterEach(() => { vi.useRealTimers(); });

describe("playable HTML: Continue", () => {
  it("starts an unvoiced story with Continue off: each line waits for the reader", () => {
    startPage(story(false));
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
    expect(stage()).toEqual([TEXT.A]); // the first line at once
    vi.advanceTimersByTime(60_000);
    expect(stage()).toEqual([TEXT.A]); // and nothing more on its own
    expect(next()).not.toBeNull();

    next()!.click();
    expect(stage()).toEqual([TEXT.A, TEXT.B]);
    document.getElementById("stage")!.click(); // a click anywhere on the page goes on too
    expect(stage()).toEqual([TEXT.A, TEXT.B, TEXT.C]);
    expect(next()).toBeNull();
    expect(choices()).toEqual([TEXT.P]); // the choices come with the last line, with no extra click
  });

  it("goes on with Space or Enter, and the reply to a choice starts at once", () => {
    startPage(story(false));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(stage()).toEqual([TEXT.A, TEXT.B, TEXT.C]);
    document.querySelector<HTMLButtonElement>("#controls .choice")!.click();
    expect(stage()).toEqual([TEXT.A, TEXT.B, TEXT.C, TEXT.R, "The End"]); // the end comes with the last line
  });

  it("starts a voiced story with Continue on, playing through on its timing", () => {
    startPage(story(true));
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
    expect(next()).toBeNull();
    vi.advanceTimersByTime(60_000);
    expect(stage()).toEqual([TEXT.A, TEXT.B, TEXT.C]);
    expect(choices()).toEqual([TEXT.P]);
  });

  it("keeps the reader's own choice, under the key Play uses", () => {
    localStorage.setItem("patter.playContinue", "1");
    startPage(story(false));
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
    toggle().click();
    expect(localStorage.getItem("patter.playContinue")).toBe("0");
    localStorage.setItem("patter.playContinue", "0");
    startPage(story(true));
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
  });

  it("switching Continue on plays on from the beat being waited on; off, the wait in flight waits for the reader", () => {
    startPage(story(false));
    toggle().click(); // on
    expect(next()).toBeNull();
    vi.advanceTimersByTime(60_000);
    expect(stage()).toEqual([TEXT.A, TEXT.B, TEXT.C]);

    startPage(story(true));
    toggle().click(); // off, while the second line's wait is in flight
    expect(next()).not.toBeNull();
    vi.advanceTimersByTime(60_000);
    expect(stage()).toEqual([TEXT.A]);
  });

  it("adds the toggle to a page published before it existed", () => {
    startPage(story(false), bodyMarkup.replace(/<button id="continue"[^>]*>Continue<\/button>/, ""));
    expect(toggle()).not.toBeNull();
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
  });
});
