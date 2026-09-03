// @vitest-environment jsdom
// A snippet whose FIRST beat is a game event (an option body of "game event + jump", say) had no way
// to get a line above the atom: typing with the atom or the whole bubble selected fell through to
// ProseMirror's default, which replaced the selection with the text - the atom, or the whole snippet,
// gone (2026-09-03). Typing over a selected atom now inserts a type-following line above it and
// types into that; typing over a selected snippet seeds its first line the same way; Enter on a
// selected atom adds a line after it.
import { describe, it, expect } from "vitest";
import { NodeSelection } from "prosemirror-state";
import { mountSurface } from "./surface.js";
import { docToScene } from "../src/bridge.js";

function mount(prevKind: "line" | "text" | null) {
  const before = prevKind ? `{ id: "sn_a", type: "snippet", beats: [ { id: "B0", kind: "${prevKind}"${prevKind === "line" ? ', character: "ANNA"' : ""} } ] },` : "";
  const flow = `{
    schema: "patter/flow@0",
    scene: { id: "scn_x", type: "scene", name: "Test", blocks: [
      { id: "start", type: "block", name: "Start", children: [
        ${before}
        { id: "sn_g", type: "snippet", beats: [ { id: "G1", kind: "gameEvent", gameData: { cue: "fx" } } ], jump: { to: "END" } }
      ] }
    ] }
  }`;
  const loc = `{ schema: "patter/strings@0", scene: "scn_x", locale: "en", default: true, strings: { B0: "before" } }`;
  const editor = document.createElement("div"); document.body.appendChild(editor);
  (editor as unknown as { scrollTo: () => void }).scrollTo = () => undefined;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  const surface = mountSurface({ editor, flowSource: flow, locSource: loc, castSeed: ["ANNA"] });
  surface.view.focus();
  return surface;
}

/** What the browser does for a printable key: keydown through the surface's handler, then (unless
 *  consumed) the text-input path with PM's default insertion over the current selection. */
function typeKey(view: import("prosemirror-view").EditorView, ch: string): void {
  const consumed = view.someProp("handleKeyDown", (f) => f(view, new KeyboardEvent("keydown", { key: ch })));
  if (consumed) return;
  const { from, to } = view.state.selection;
  const deflt = (): import("prosemirror-state").Transaction => view.state.tr.insertText(ch, from, to);
  const handled = view.someProp("handleTextInput", (f) => f(view, from, to, ch, deflt));
  if (!handled) view.dispatch(deflt());
}

function beatsOf(surface: ReturnType<typeof mount>, snippetId = "sn_g"): Array<{ id: string; kind: string; character?: string }> {
  const scene = docToScene(surface.view.state.doc).scene;
  const chunk = scene.blocks[0]!.children.find((c) => c.id === snippetId) as { beats?: Array<{ id: string; kind: string; character?: string }> } | undefined;
  return chunk?.beats ?? [];
}

function selectAtom(surface: ReturnType<typeof mount>): number {
  let pos = -1;
  surface.view.state.doc.descendants((n, p) => { if (n.type.name === "gameEvent") { pos = p; return false; } return pos < 0; });
  surface.view.dispatch(surface.view.state.tr.setSelection(NodeSelection.create(surface.view.state.doc, pos)));
  return pos;
}

describe("a snippet whose first beat is a game event", () => {
  it("typing over the selected atom inserts a line ABOVE it and keeps the atom", () => {
    const s = mount(null);
    selectAtom(s);
    typeKey(s.view, "a");
    const beats = beatsOf(s);
    expect(beats.map((b) => b.kind)).toEqual(["line", "gameEvent"]);
    expect(beats[1]!.id).toBe("G1");
    s.destroy();
  });

  it("the new line follows the flow: prose after prose, and the letter lands in it", () => {
    const s = mount("text");
    selectAtom(s);
    typeKey(s.view, "a");
    const beats = beatsOf(s);
    expect(beats.map((b) => b.kind)).toEqual(["text", "gameEvent"]);
    expect(s.getSource().loc).toContain('"a"');
    s.destroy();
  });

  it("typing over the SELECTED SNIPPET seeds its first line instead of replacing the bubble", () => {
    const s = mount(null);
    let snipPos = -1;
    s.view.state.doc.descendants((n, p) => { if (n.type.name === "snippet") { snipPos = p; return false; } return snipPos < 0; });
    s.view.dispatch(s.view.state.tr.setSelection(NodeSelection.create(s.view.state.doc, snipPos)));
    typeKey(s.view, "a");
    expect(beatsOf(s).map((b) => b.kind)).toEqual(["line", "gameEvent"]);
    s.destroy();
  });

  it("a bubble that opens with an atom offers a '+' strip above it, which inserts a line there", () => {
    const s = mount("line");
    const bubble = [...s.view.dom.querySelectorAll(".bubble")].find((b) => (b as HTMLElement).dataset.id === "sn_g") as HTMLElement;
    expect(bubble.classList.contains("atom-first")).toBe(true);
    const strip = bubble.querySelector(".bubble-above") as HTMLElement;
    strip.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    expect(beatsOf(s).map((b) => b.kind)).toEqual(["line", "gameEvent"]);
    expect(bubble.classList.contains("atom-first")).toBe(false); // a line now leads: the strip retires
    // The bubble that never opened with an atom never shows the strip.
    const other = [...s.view.dom.querySelectorAll(".bubble")].find((b) => (b as HTMLElement).dataset.id === "sn_a") as HTMLElement;
    expect(other.classList.contains("atom-first")).toBe(false);
    s.destroy();
  });

  it("Enter on the selected atom adds a line AFTER it", () => {
    const s = mount("text");
    selectAtom(s);
    s.view.someProp("handleKeyDown", (f) => f(s.view, new KeyboardEvent("keydown", { key: "Enter" })));
    expect(beatsOf(s).map((b) => b.kind)).toEqual(["gameEvent", "text"]);
    s.destroy();
  });
});
