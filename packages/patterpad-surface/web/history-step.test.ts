// @vitest-environment jsdom
// The host's journal learns the scene's history from the surface (patterkit design/patterpad-undo.md, "The
// journal"): `onHistoryStep` fires once for each NEW event in ProseMirror's history, never for typing that
// joins the event before it, and never for an undo or redo; `hostUndo` leaves Cmd+Z to the host's menu.
import { describe, it, expect, beforeAll } from "vitest";
import { TextSelection } from "prosemirror-state";
import { mountSurface } from "./surface.js";

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  (HTMLElement.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
});

function mount(opts: { hostUndo?: boolean } = {}) {
  const flow = `{ schema: "patter/flow@0", scene: { id: "scn_x", type: "scene", name: "Test", blocks: [
    { id: "start", type: "block", name: "Start", children: [
      { id: "sn_a", type: "snippet", beats: [ { id: "L1", kind: "line", character: "ANNA" } ] } ] } ] } }`;
  const loc = `{ schema: "patter/strings@0", scene: "scn_x", locale: "en", default: true, strings: { L1: "Hello." } }`;
  const editor = document.createElement("div"); document.body.appendChild(editor);
  (editor as unknown as { scrollTo: () => void }).scrollTo = () => undefined;
  let steps = 0;
  const s = mountSurface({ editor, flowSource: flow, locSource: loc, castSeed: ["ANNA"], onHistoryStep: () => { steps++; }, ...opts });
  return { s, steps: () => steps };
}

/** Type at the end of the line's spoken text, `at` milliseconds into the session. */
function type(s: ReturnType<typeof mountSurface>, text: string, at: number): void {
  let end = 0;
  s.view.state.doc.descendants((n, pos) => { if (n.isTextblock && n.textContent.startsWith("Hello")) end = pos + 1 + n.content.size; });
  const tr = s.view.state.tr.setSelection(TextSelection.create(s.view.state.doc, end)).insertText(text);
  tr.setTime(at);
  s.view.dispatch(tr);
}

describe("the surface's history steps", () => {
  it("reports a new event, not typing that joins it, and not an undo or redo", () => {
    const { s, steps } = mount({ hostUndo: true });
    expect(steps()).toBe(0); // mounting is no edit
    type(s, "a", 1000);
    expect(steps()).toBe(1);
    type(s, "b", 1100); // inside the group delay: the same event
    expect(steps()).toBe(1);
    expect(s.undoDepth()).toBe(1);
    type(s, "c", 5000); // after it: a new one
    expect(steps()).toBe(2);
    expect(s.undoDepth()).toBe(2);
    expect(s.undo()).toBe(true);
    expect(s.redoDepth()).toBe(1);
    expect(s.redo()).toBe(true);
    expect(steps()).toBe(2);
    s.destroy();
  });

  it("starts a new event after closeHistory, even inside the group delay", () => {
    const { s, steps } = mount();
    type(s, "a", 1000);
    s.closeHistory();
    type(s, "b", 1100);
    expect(steps()).toBe(2);
    s.destroy();
  });

  it("still reports each new event once the history is full and drops its oldest", () => {
    const { s, steps } = mount();
    for (let i = 0; i < 130; i++) type(s, "x", 1000 + i * 1000);
    expect(steps()).toBe(130);
    expect(s.undoDepth()).toBeLessThanOrEqual(120);
    s.destroy();
  });

  it("with hostUndo, the editor binds no undo key of its own", () => {
    const { s } = mount({ hostUndo: true });
    type(s, "a", 1000);
    const handled = s.view.someProp("handleKeyDown", (f) => f(s.view, new KeyboardEvent("keydown", { key: "z", metaKey: true, ctrlKey: true })));
    expect(!!handled).toBe(false);
    expect(s.undoDepth()).toBe(1);
    s.destroy();
  });
});
