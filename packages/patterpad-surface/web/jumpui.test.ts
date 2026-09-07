// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// The jump affordances, after #63 (reported from real use): the target picker and
// the "/" menu both act on the CLICK rather than the mousedown that closes them,
// a second "/" never lands in the prose as a character, and a caret-anchored panel
// stays inside the viewport instead of hanging off the bottom of the window.
// ---------------------------------------------------------------------------

import { describe, it, expect, afterEach } from "vitest";
import type { EditorView } from "prosemirror-view";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView as PMEditorView } from "prosemirror-view";
import type { Scene } from "@patterkit/model";
import { sceneToDoc } from "../src/bridge.js";
import { openTargetPicker, closeTargetPicker } from "./targetpicker.js";
import { createSlashMenu } from "./slashmenu.js";
import { anchorBelowCaret } from "./anchor.js";

const DATA = { scenes: [{ scene: { id: "sc", label: "A scene" }, blocks: [{ id: "b1", label: "One" }, { id: "b2", label: "Two" }] }] };

/** Fire the full mouse sequence a real click produces, in order. */
const clickSeq = (el: HTMLElement): void => {
  el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
};

const rowNamed = (label: string): HTMLElement => {
  const row = Array.from(document.querySelectorAll<HTMLElement>(".tp-row")).find((r) => r.textContent === label);
  if (!row) throw new Error(`no picker row "${label}"`);
  return row;
};

afterEach(() => { closeTargetPicker(); document.body.replaceChildren(); });

describe("the target picker picks on the click, not the mousedown", () => {
  it("a mousedown alone does not pick (the panel is still open when the button comes up)", () => {
    const anchor = document.createElement("button");
    document.body.append(anchor);
    const picked: Array<string | null> = [];
    openTargetPicker({ anchor, data: DATA, current: "", allowClear: false, onPick: (t) => picked.push(t) });

    rowNamed("One").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(picked).toEqual([]);                                   // nothing committed yet
    expect(document.querySelector(".tp-row")).not.toBeNull();      // and the panel is still up
  });

  it("a full click picks exactly once", () => {
    const anchor = document.createElement("button");
    document.body.append(anchor);
    const picked: Array<string | null> = [];
    openTargetPicker({ anchor, data: DATA, current: "", allowClear: false, onPick: (t) => picked.push(t) });

    clickSeq(rowNamed("Two"));
    expect(picked).toEqual(["b2"]);
  });

  it("the click that commits a pick does not reach what the panel was covering (#63)", () => {
    // The real shape of the bug: the picker sat over the inspector's own Jump row. Picking on
    // mousedown removed the panel mid-press, so the browser delivered the click to the row
    // underneath, which opened a SECOND picker on whatever snippet the inspector had moved to,
    // and the author's next pick landed on a snippet they never chose.
    const underneath = document.createElement("button");
    let underneathClicks = 0;
    underneath.addEventListener("click", () => { underneathClicks++; });
    document.body.append(underneath);

    const picked: Array<string | null> = [];
    openTargetPicker({ anchor: underneath, data: DATA, current: "", allowClear: false, onPick: (t) => picked.push(t) });

    const row = rowNamed("One");
    row.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    // jsdom does no hit-testing, so the guard that carries the fix is this: the row must SURVIVE its
    // own mousedown. While it is still under the pointer, the click goes to the row and commits the
    // pick; the element the panel was covering never sees a thing.
    expect(document.body.contains(row)).toBe(true);
    row.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    row.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(picked).toEqual(["b1"]);
    expect(underneathClicks).toBe(0);
  });
});

describe("anchorBelowCaret keeps a panel inside the viewport", () => {
  /** A stand-in view: only the three things the helper touches. */
  const viewAt = (caret: { top: number; bottom: number; left: number }): EditorView => ({
    coordsAtPos: () => ({ top: caret.top, bottom: caret.bottom, left: caret.left, right: caret.left }),
    domAtPos: () => ({ node: document.body, offset: 0 }),
    dom: document.body,
    state: { selection: { head: 1 } },
  }) as unknown as EditorView;

  const panel = (w: number, h: number): HTMLElement => {
    const el = document.createElement("div");
    Object.defineProperty(el, "offsetHeight", { value: h });
    Object.defineProperty(el, "offsetWidth", { value: w });
    document.body.append(el);
    return el;
  };

  it("hangs below the caret when there is room", () => {
    const el = panel(240, 300);
    anchorBelowCaret(viewAt({ top: 100, bottom: 118, left: 200 }), el);
    expect(el.style.top).toBe("122px");   // caret bottom + the 4px gap
    expect(el.style.left).toBe("200px");
  });

  it("flips ABOVE the caret when the panel would run off the bottom", () => {
    // window.innerHeight is 768 in jsdom: a 300px panel at y=700 would end at 1004.
    const el = panel(240, 300);
    anchorBelowCaret(viewAt({ top: 682, bottom: 700, left: 200 }), el);
    expect(el.style.top).toBe("378px");   // 682 - 4 - 300, entirely on screen
  });

  it("sits on the bottom edge when it fits neither above nor below", () => {
    const el = panel(240, 740);           // taller than the room on either side
    anchorBelowCaret(viewAt({ top: 400, bottom: 418, left: 200 }), el);
    expect(el.style.top).toBe("20px");    // 768 - 8 - 740, clamped rather than overflowing
  });

  it("clamps horizontally too, so a caret near the right edge does not push it off", () => {
    const el = panel(240, 100);           // window.innerWidth is 1024 in jsdom
    anchorBelowCaret(viewAt({ top: 100, bottom: 118, left: 1000 }), el);
    expect(el.style.left).toBe("776px");  // 1024 - 240 - 8
  });
});

describe('the "/" menu never types a slash into the line', () => {
  const emptyProseScene: Scene = { id: "s", type: "scene", name: "S", blocks: [
    { id: "b", type: "block", name: "M", children: [
      { id: "sn1", type: "snippet", beats: [{ id: "T1", kind: "text" }] },
    ] },
  ] };

  /** A real view whose caret sits in the empty text beat - where the menu is allowed. */
  const mountEmptyLine = (): { view: EditorView; menu: ReturnType<typeof createSlashMenu> } => {
    const doc = sceneToDoc(emptyProseScene, { T1: "" });
    let sayPos = -1;
    doc.descendants((n, pos) => { if (sayPos < 0 && n.type.name === "say") sayPos = pos; return sayPos < 0; });
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, sayPos + 1) });
    const mount = document.createElement("div");
    document.body.append(mount);
    const view = new PMEditorView(mount, { state });
    return { view, menu: createSlashMenu(() => {}) };
  };

  it('opens on the first "/" and SWALLOWS the second (it used to land in the prose)', () => {
    const { view, menu } = mountEmptyLine();
    expect(menu.handleTextInput(view, "/")).toBe(true);
    expect(menu.isOpen()).toBe(true);

    // The old code closed the menu here and returned false, so ProseMirror inserted the character.
    // One stray "/" made the line non-empty, and the menu only opens on an EMPTY line - so the key
    // silently stopped working on that line for good.
    expect(menu.handleTextInput(view, "/")).toBe(true);
    expect(menu.isOpen()).toBe(true);
    expect(view.state.doc.textContent).toBe("");

    menu.close();
    view.destroy();
  });

  it("any other key still dismisses the menu and types normally", () => {
    const { view, menu } = mountEmptyLine();
    menu.handleTextInput(view, "/");
    expect(menu.handleTextInput(view, "x")).toBe(false);   // falls through: "x" is text
    expect(menu.isOpen()).toBe(false);
    view.destroy();
  });

  it('does not open on a line that already has words (the "/" is just a character there)', () => {
    const doc = sceneToDoc(emptyProseScene, { T1: "already written" });
    let sayPos = -1;
    doc.descendants((n, pos) => { if (sayPos < 0 && n.type.name === "say") sayPos = pos; return sayPos < 0; });
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, sayPos + 1) });
    const mount = document.createElement("div");
    document.body.append(mount);
    const view = new PMEditorView(mount, { state });
    const menu = createSlashMenu(() => {});
    expect(menu.handleTextInput(view, "/")).toBe(false);
    expect(menu.isOpen()).toBe(false);
    view.destroy();
  });
});
