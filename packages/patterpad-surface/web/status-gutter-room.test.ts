// @vitest-environment jsdom
// The writing-status pills sit in the editor's LEFT margin, growing leftward from the column. In a narrow
// editor (the app's smallest window, with the navigator and inspector open) that margin was narrower than
// a pill, and the scroller cut the pills off (Dev, the hands-on review of October 2026). While pills show,
// the gutter reserves the room the widest of them needs on the scroller, which styles.css takes as the
// floor of the editor's left padding; with none showing, the room goes.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mountSurface } from "./surface.js";
import { GUTTER_LEFT_ROOM } from "./gutterlayer.js";

let frames: FrameRequestCallback[] = [];
const flush = (): void => { const run = frames; frames = []; for (const f of run) f(0); };

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  (HTMLElement.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
  vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => { frames.push(f); return frames.length; });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});
afterAll(() => { vi.unstubAllGlobals(); });

function mount() {
  const flow = `{ schema: "patter/flow@0", scene: { id: "scn_x", type: "scene", name: "Test", blocks: [
    { id: "start", type: "block", name: "Start", children: [
      { id: "sn_a", type: "snippet", beats: [ { id: "L1", kind: "line", character: "ANNA" } ] } ] } ] } }`;
  const loc = `{ schema: "patter/strings@0", scene: "scn_x", locale: "en", default: true, strings: { L1: "Hello." } }`;
  const editor = document.createElement("div"); document.body.appendChild(editor);
  (editor as unknown as { scrollTo: () => void }).scrollTo = () => undefined;
  const s = mountSurface({ editor, flowSource: flow, locSource: loc, castSeed: ["ANNA"], onSetWritingStatus: () => {} });
  return { s, editor };
}

describe("the writing-status gutter keeps its room", () => {
  it("reserves the left margin while pills show, and lets it go when none do", () => {
    const { s, editor } = mount();
    s.setWritingStatusLadder([{ name: "Second draft, after the table read", colour: 1 }, { name: "final", colour: 9 }]);
    flush();
    expect(editor.style.getPropertyValue(GUTTER_LEFT_ROOM)).toBe(""); // nothing shown: the margin is the editor's own
    s.setWritingStatusShown(["Second draft, after the table read"]);
    flush();
    // jsdom lays nothing out, so the pill measures 0: the room is the gap and the edge.
    expect(editor.style.getPropertyValue(GUTTER_LEFT_ROOM)).toBe("16px");
    expect(editor.querySelectorAll(".status-gutter .status-pill")).toHaveLength(1); // the probe pill never stays
    s.setWritingStatusShown([]);
    flush();
    expect(editor.style.getPropertyValue(GUTTER_LEFT_ROOM)).toBe("");
    s.setWritingStatusShown(["final"]);
    flush();
    expect(editor.style.getPropertyValue(GUTTER_LEFT_ROOM)).toBe("16px");
    s.destroy();
    expect(editor.style.getPropertyValue(GUTTER_LEFT_ROOM)).toBe(""); // the surface gone, its room goes too
  });

  it("is the floor of the editor's left padding", () => {
    const css = readFileSync(resolve(process.cwd(), "packages/patterpad-surface/web/styles.css"), "utf8");
    const rule = /\n#editor \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toContain("padding-left: max(clamp(1rem, 4vw, 3rem), var(--gutter-left-room, 0px))");
  });
});
