// @vitest-environment jsdom
// Opening a scene, or jumping to a block or bubble from the navigator, puts the caret at the first spot
// inside it. When that was a dialogue line, the spot was its cue: the speaker name was selected and the cast
// picker opened as soon as the editor had focus, so browsing a project popped the picker on every scene
// that began with dialogue (2026-10-04). The caret now rests at the start of the line's spoken text, and the
// picker stays shut until the author goes to the name.
import { describe, it, expect, beforeAll } from "vitest";
import { Selection, TextSelection } from "prosemirror-state";
import { mountSurface } from "./surface.js";
import { context } from "../src/context.js";

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  (HTMLElement.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
});

function mount(firstCharacter: string) {
  const flow = `{ schema: "patter/flow@0", scene: { id: "scn_x", type: "scene", name: "Test", blocks: [
    { id: "start", type: "block", name: "Start", children: [
      { id: "sn_a", type: "snippet", beats: [ { id: "L1", kind: "line", character: "${firstCharacter}" } ] },
      { id: "sn_b", type: "snippet", beats: [ { id: "L2", kind: "line", character: "BO" } ] } ] } ] } }`;
  const loc = `{ schema: "patter/strings@0", scene: "scn_x", locale: "en", default: true, strings: { L1: "Hello there.", L2: "Hi." } }`;
  const editor = document.createElement("div"); document.body.appendChild(editor);
  (editor as unknown as { scrollTo: () => void }).scrollTo = () => undefined;
  return mountSurface({ editor, flowSource: flow, locSource: loc, castSeed: ["ANNA", "BO"] });
}

const pickerOpen = (): boolean => [...document.querySelectorAll<HTMLElement>(".cue-ac")].some((e) => e.style.display !== "none");
const caretZone = (s: ReturnType<typeof mount>): string | undefined => context(s.view.state).zone?.role;

describe("a scene that starts with a dialogue line", () => {
  it("opens with the caret at the start of the spoken text, and no cast picker", () => {
    const s = mount("ANNA");
    s.focus();
    s.view.dispatch(s.view.state.tr); // the browser's focus selection-sync, which used to raise the picker
    expect(s.view.state.selection.empty).toBe(true);
    expect(caretZone(s)).toBe("say");
    expect(s.view.state.selection.$head.parentOffset).toBe(0);
    expect(pickerOpen()).toBe(false);
    s.destroy();
  });

  it("does the same when the first line has no speaker yet", () => {
    const s = mount("");
    s.focus();
    s.view.dispatch(s.view.state.tr);
    expect(caretZone(s)).toBe("say");
    expect(pickerOpen()).toBe(false);
    s.destroy();
  });

  it("jumping to the block or the bubble from the navigator lands in the spoken text too", () => {
    const s = mount("ANNA");
    s.focus();
    for (const id of ["start", "sn_a", "sn_b"]) {
      s.view.dispatch(s.view.state.tr.setSelection(Selection.atEnd(s.view.state.doc)));
      expect(s.revealNode(id)).toBe(true);
      expect(caretZone(s)).toBe("say");
      expect(pickerOpen()).toBe(false);
    }
    s.destroy();
  });

  it("going to the name on purpose still opens the picker", () => {
    const s = mount("ANNA");
    s.focus();
    let cue = -1;
    s.view.state.doc.descendants((n, p) => { if (cue < 0 && n.type.name === "cue") cue = p + 1; return cue < 0; });
    s.view.dispatch(s.view.state.tr.setSelection(TextSelection.create(s.view.state.doc, cue)));
    expect(caretZone(s)).toBe("cue");
    expect(pickerOpen()).toBe(true);
    s.destroy();
  });
});
