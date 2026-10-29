// @vitest-environment jsdom
// Three page fixes from retaking the site's screenshots (October 2026):
//   - a jump to a scene a lazy open hasn't loaded yet read "Missing scene" / "Missing block" until the rest
//     of the project came in; while the host says its targets are still coming, it reads as pending;
//   - the gutter pills stayed where they were when the inspector's divider was dragged, since only a window
//     resize re-placed them; the gutter now follows its scroller's own size;
//   - the ⋯ covered the end of a snippet's first line; that line now keeps its width free.
// jsdom lays nothing out, so the last is held as the stylesheet's rule.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mountSurface } from "./surface.js";
import { PENDING_TARGET } from "./reftext.js";

let frames: FrameRequestCallback[] = [];
const flush = (): void => { const run = frames; frames = []; for (const f of run) f(0); };
// Every ResizeObserver made, with what it watches, so a test can fire one as a layout change would.
const observers: Array<{ fire: () => void; targets: Element[] }> = [];

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    targets: Element[] = [];
    constructor(cb: () => void) { observers.push({ fire: cb, targets: this.targets }); }
    observe(t: Element) { this.targets.push(t); }
    unobserve() {}
    disconnect() { this.targets.length = 0; }
  };
  (HTMLElement.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
  vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => { frames.push(f); return frames.length; });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});
afterAll(() => { vi.unstubAllGlobals(); });

const flow = `{ schema: "patter/flow@0", scene: { id: "scn_x", type: "scene", name: "Test", blocks: [
  { id: "start", type: "block", name: "Start", children: [
    { id: "sn_a", type: "snippet", beats: [ { id: "L1", kind: "line", character: "ANNA" } ], jump: { to: "blk_far" } } ] } ] } }`;
const loc = `{ schema: "patter/strings@0", scene: "scn_x", locale: "en", default: true, strings: { L1: "Hello." } }`;

function mount(opts: { jumpTargetsPending?: boolean } = {}) {
  const editor = document.createElement("div"); document.body.appendChild(editor);
  (editor as unknown as { scrollTo: () => void }).scrollTo = () => undefined;
  const s = mountSurface({ editor, flowSource: flow, locSource: loc, castSeed: ["ANNA"], onSetWritingStatus: () => {}, jumpTargets: [], ...opts });
  return { s, editor };
}

describe("a jump to a scene that hasn't loaded yet", () => {
  it("reads as pending, not missing, until the host's targets are whole", () => {
    const { s, editor } = mount({ jumpTargetsPending: true });
    expect(s.jumpLabel("blk_far")).toBe(PENDING_TARGET);
    expect(editor.querySelector(".bubble-jump .missing-target")).toBeNull();
    expect(editor.querySelector(".bubble-jump-to")?.textContent).toBe(PENDING_TARGET);
    // The rest of the project arrives, and the block is in it: its name.
    s.setJumpTargets([{ id: "scn_far", label: "The Far Bank", blocks: [{ id: "blk_far", label: "Jetty" }] }]);
    expect(s.jumpLabel("blk_far")).toBe("Jetty");
    expect(editor.querySelector(".bubble-jump-to")?.textContent).toBe("Jetty");
    s.destroy();
  });

  it("reads as missing once the targets are whole and it isn't among them", () => {
    const { s, editor } = mount({ jumpTargetsPending: true });
    s.setJumpTargets([{ id: "scn_far", label: "The Far Bank", blocks: [] }]);
    expect(s.jumpLabel("blk_far")).toBeNull();
    expect(editor.querySelector(".bubble-jump .missing-target")?.textContent).toBe("Missing block");
    s.destroy();
  });

  it("is missing straight away when the host gave every target from the start", () => {
    const { s } = mount();
    expect(s.jumpLabel("blk_far")).toBeNull();
    s.destroy();
  });
});

describe("the gutter pills follow the editor's width", () => {
  it("re-place themselves when the scroller changes size, with no window resize", () => {
    const { s, editor } = mount();
    s.setWritingStatusLadder([{ name: "draft", colour: 1 }]);
    s.setWritingStatusShown(["draft"]);
    flush();
    const watching = observers.find((o) => o.targets.includes(editor));
    expect(watching, "nothing watches the scroller's size").toBeTruthy();
    // A divider drag: the scroller resizes, the observer fires, and the lanes are laid out again next frame.
    const pill = editor.querySelector(".status-gutter .status-pill");
    expect(pill).not.toBeNull();
    watching!.fire();
    expect(frames.length).toBe(1);
    flush();
    const again = editor.querySelector(".status-gutter .status-pill");
    expect(again).not.toBeNull();
    expect(again).not.toBe(pill); // painted afresh at the new geometry
    s.destroy();
    expect(watching!.targets).toHaveLength(0); // let go with the last lane
  });
});

describe("the ⋯ on a snippet's first line", () => {
  it("keeps its width free on that line, unless a condition or On begin line sits on top", () => {
    const css = readFileSync(resolve(process.cwd(), "packages/patterpad-surface/web/styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const sel = ".bubble:not(.has-cond):not(.has-fx-begin) > .beats > .beat:first-child > .zone.say::before";
    const at = css.indexOf(`${sel} {`);
    expect(at, "no rule keeps the ⋯'s room").toBeGreaterThanOrEqual(0);
    const rule = css.slice(at, css.indexOf("}", at));
    expect(rule).toMatch(/float:\s*right/);
    expect(rule).toMatch(/height:\s*1lh/); // one line only: the rest of the snippet keeps the full width
  });
});
