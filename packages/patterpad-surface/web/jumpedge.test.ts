// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// The awkward corners around the #63 fixes: filtering then picking, a filter that
// matches nothing, a double click, clearing a jump, and the "/" menu asked to open
// in places it has no snippet to act on. Written as exploration after the fixes
// landed, kept as the record of what those paths actually do.
// ---------------------------------------------------------------------------

import { describe, it, expect, afterEach } from "vitest";
import { EditorState, NodeSelection, TextSelection } from "prosemirror-state";
import { EditorView as PMEditorView } from "prosemirror-view";
import type { Scene } from "@patterkit/model";
import { sceneToDoc } from "../src/bridge.js";
import { setSnippetJump, canInsertSpecial, insertJump, commitSlashJump } from "../src/special.js";
import { openTargetPicker, closeTargetPicker } from "./targetpicker.js";
import { createSlashMenu } from "./slashmenu.js";
import { keepBeatlessBubbleSelected, sweepEmptyBeats } from "./surface.js";

const DATA = { scenes: [
  { scene: { id: "sc1", label: "The Tavern" }, blocks: [{ id: "b1", label: "Intro" }, { id: "b2", label: "Menu" }] },
  { scene: { id: "sc2", label: "Street" }, blocks: [{ id: "b3", label: "Corner" }] },
] };

const rows = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>(".tp-row"));
const rowNamed = (label: string): HTMLElement => {
  const r = rows().find((x) => x.textContent === label);
  if (!r) throw new Error(`no row "${label}" (have: ${rows().map((x) => x.textContent).join(", ")})`);
  return r;
};
const clickSeq = (el: HTMLElement): void => {
  el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
};
const type = (value: string): void => {
  const field = document.querySelector<HTMLInputElement>(".tp-field")!;
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
};
const key = (k: string): void => {
  document.querySelector<HTMLInputElement>(".tp-field")!.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
};

afterEach(() => { closeTargetPicker(); document.body.replaceChildren(); });

describe("the target picker, off the happy path", () => {
  const open = (opts: Partial<Parameters<typeof openTargetPicker>[0]> = {}): Array<string | null> => {
    const picked: Array<string | null> = [];
    const anchor = document.createElement("button");
    document.body.append(anchor);
    openTargetPicker({ anchor, data: DATA, current: "", allowClear: false, onPick: (t) => picked.push(t), ...opts });
    return picked;
  };

  it("filtering then clicking picks the row you can SEE, not the one that used to be there", () => {
    const picked = open();
    type("corner");                       // now: Street (the scene heading) + Corner
    clickSeq(rowNamed("Corner"));
    expect(picked).toEqual(["b3"]);
  });

  it("a filter that matches nothing leaves an empty list, and Enter picks nothing", () => {
    const picked = open();
    type("zzzz");
    expect(rows()).toHaveLength(0);
    key("Enter");
    expect(picked).toEqual([]);
    expect(document.querySelector(".target-picker")).not.toBeNull(); // still open, nothing to commit
  });

  it("arrows on an empty list do not throw or wrap into nowhere", () => {
    open();
    type("zzzz");
    expect(() => { key("ArrowDown"); key("ArrowUp"); }).not.toThrow();
  });

  it("a second click after the pick hits nothing: the panel is gone, not merely hidden", () => {
    const picked = open();
    const row = rowNamed("Menu");
    clickSeq(row);
    expect(picked).toEqual(["b2"]);
    clickSeq(row);                        // the detached row, as a double click would find it
    expect(picked).toEqual(["b2"]);       // no second pick
    expect(document.querySelector(".target-picker")).toBeNull();
  });

  it("Clear jump yields null, and only when the caller offers it", () => {
    const picked = open({ allowClear: true, current: "b1" });
    expect(rowNamed("Clear jump")).toBeTruthy();
    clickSeq(rowNamed("Clear jump"));
    expect(picked).toEqual([null]);
  });

  it("a scene row is a target in its own right (jumping to a scene enters its start)", () => {
    const picked = open();
    clickSeq(rowNamed("Street"));
    expect(picked).toEqual(["sc2"]);
  });

  it("re-opening on the same anchor toggles it shut rather than flickering", () => {
    const anchor = document.createElement("button");
    document.body.append(anchor);
    const args = { anchor, data: DATA, current: "", allowClear: false, onPick: () => {} };
    openTargetPicker(args);
    expect(document.querySelector(".target-picker")).not.toBeNull();
    openTargetPicker(args);
    expect(document.querySelector(".target-picker")).toBeNull();
  });

  it("follows its anchor when the page scrolls under it", () => {
    const anchor = document.createElement("button");
    Object.defineProperty(anchor, "isConnected", { value: true });
    let top = 100;
    anchor.getBoundingClientRect = () => ({ left: 50, top, bottom: top + 20, right: 150, width: 100, height: 20, x: 50, y: top, toJSON: () => ({}) }) as DOMRect;
    document.body.append(anchor);
    openTargetPicker({ anchor, data: DATA, current: "", allowClear: false, onPick: () => {} });
    const panel = document.querySelector<HTMLElement>(".target-picker")!;
    expect(panel.style.top).toBe("126px");            // anchor bottom + 6

    top = 300;                                         // the inspector scrolled; the row moved
    window.dispatchEvent(new Event("scroll"));
    expect(panel.style.top).toBe("326px");             // ...and the panel came with it
  });

  it("holds still when its anchor has been re-rendered away, rather than jumping to the corner", () => {
    const anchor = document.createElement("button");
    anchor.getBoundingClientRect = () => ({ left: 50, top: 100, bottom: 120, right: 150, width: 100, height: 20, x: 50, y: 100, toJSON: () => ({}) }) as DOMRect;
    document.body.append(anchor);
    openTargetPicker({ anchor, data: DATA, current: "", allowClear: false, onPick: () => {} });
    const panel = document.querySelector<HTMLElement>(".target-picker")!;
    const was = panel.style.top;
    anchor.remove();                                   // the inspector rebuilt its rows
    window.dispatchEvent(new Event("scroll"));
    expect(panel.style.top).toBe(was);
  });

  it("Escape closes without picking", () => {
    const picked = open();
    key("Escape");
    expect(picked).toEqual([]);
    expect(document.querySelector(".target-picker")).toBeNull();
  });
});

// ---------------------------------------------------------------------------

const sceneWith = (children: Scene["blocks"][number]["children"]): Scene =>
  ({ id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "M", children }] });

/** A view whose caret sits at the start of the FIRST zone of the named kind. */
const viewAtZone = (scene: Scene, strings: Record<string, string>, zone: "say" | "cue" | "paren"): PMEditorView => {
  const doc = sceneToDoc(scene, strings);
  let at = -1;
  doc.descendants((n, pos) => { if (at < 0 && n.type.name === zone) at = pos; return at < 0; });
  const state = EditorState.create({ doc, selection: TextSelection.create(doc, at + 1) });
  const mount = document.createElement("div");
  document.body.append(mount);
  return new PMEditorView(mount, { state });
};

describe('the "/" menu where it has no snippet to act on', () => {
  it("opens in a CUE that already has a character (an empty say is what it needs, not an empty cue)", () => {
    const view = viewAtZone(sceneWith([{ id: "sn", type: "snippet", beats: [{ id: "L", kind: "line", character: "ANNA" }] }]), { L: "" }, "cue");
    expect(canInsertSpecial(view.state)).toBe(true);
    view.destroy();
  });

  it("stays shut inside a performance direction (the hint bar there offers only ')')", () => {
    // `atStart` is true at the start of a paren zone as well as a say, so "/" used to raise the menu
    // over a direction the author was writing.
    const view = viewAtZone(sceneWith([{ id: "sn", type: "snippet", beats: [{ id: "L", kind: "line", character: "ANNA", direction: "wry" }] }]), { L: "" }, "paren");
    const menu = createSlashMenu(() => {});
    expect(canInsertSpecial(view.state)).toBe(false);
    expect(menu.handleTextInput(view, "/")).toBe(false);   // falls through: "/" is a character there
    view.destroy();
  });

  it("stays shut in an option PROMPT, where its one working item destroyed the prompt", () => {
    // A prompt is a beat with no snippet around it. Jump and Follow-with both declined for want of
    // one; "Insert game event" did not, and built a fresh snippet in the option - taking the choice's
    // own text with it. Checked here by driving the menu, and by the item that used to fire.
    const scene = sceneWith([{ id: "g", type: "group", selector: "choice", children: [
      { id: "o", type: "group", selector: "option", prompt: { id: "P", kind: "text" }, children: [
        { id: "sn", type: "snippet", beats: [{ id: "L", kind: "text" }] },
      ] },
    ] } as unknown as Scene["blocks"][number]["children"][number]]);
    const view = viewAtZone(scene, { P: "", L: "said" }, "say");
    const menu = createSlashMenu(() => {});
    expect(canInsertSpecial(view.state)).toBe(false);
    expect(menu.handleTextInput(view, "/")).toBe(false);
    expect(menu.isOpen()).toBe(false);
    expect(insertJump(view.state, "b1")).toBeNull();       // and the items behind it still decline
    view.destroy();
  });
});

// ---------------------------------------------------------------------------

describe("landing the selection when the bubble changes shape underneath it", () => {
  const posOfSnippet = (state: EditorState, id: string): number => {
    let at = -1;
    state.doc.descendants((n, pos) => { if (at < 0 && n.type.name === "snippet" && JSON.parse(n.attrs.raw as string).id === id) at = pos; return at < 0; });
    return at;
  };

  it("a jump on a bubble whose only line is blank drops the line AND keeps the bubble selected", () => {
    // setSnippetJump collapses a wholly-blank bubble to a slim divert row, so the transaction both
    // sets an attr and deletes content - the position has to be mapped, not reused.
    const scene = sceneWith([
      { id: "sn1", type: "snippet", beats: [{ id: "L1", kind: "line", character: "ANNA" }] },
      { id: "sn2", type: "snippet", beats: [{ id: "L2", kind: "line" }] },
    ]);
    const s0 = EditorState.create({ doc: sceneToDoc(scene, { L1: "hi", L2: "" }) });
    const at = posOfSnippet(s0, "sn2");
    const s = s0.apply(keepBeatlessBubbleSelected(setSnippetJump(s0, at, "b1")!, at));
    expect(s.selection).toBeInstanceOf(NodeSelection);
    expect((s.selection as NodeSelection).node.childCount).toBe(0);   // the blank line went
    expect(JSON.parse((s.selection as NodeSelection).node.attrs.raw as string).id).toBe("sn2");
  });

  it("CLEARING a jump on a beat-less bubble also leaves it selected", () => {
    const scene = sceneWith([{ id: "sn", type: "snippet", beats: [], jump: { to: "b1" } } as unknown as Scene["blocks"][number]["children"][number]]);
    const s0 = EditorState.create({ doc: sceneToDoc(scene, {}) });
    const at = posOfSnippet(s0, "sn");
    const s = s0.apply(keepBeatlessBubbleSelected(setSnippetJump(s0, at, null)!, at));
    expect(s.selection).toBeInstanceOf(NodeSelection);
    expect((s.selection as NodeSelection).node.attrs.jump).toBe("");
  });

  it("a sweep of SEVERAL blank lines lands on the bubble the caret was in, not the first one swept", () => {
    const scene = sceneWith([
      { id: "sn1", type: "snippet", beats: [{ id: "L1", kind: "line" }] },   // blank, swept, no caret
      { id: "sn2", type: "snippet", beats: [{ id: "L2", kind: "line", character: "ANNA" }] },
      { id: "sn3", type: "snippet", beats: [{ id: "L3", kind: "line" }] },   // blank, swept, CARET here
    ]);
    const doc = sceneToDoc(scene, { L1: "", L2: "said", L3: "" });
    let third = -1;
    doc.descendants((n, pos) => { if (n.type.name === "line" && n.textContent === "") third = pos; return true; });
    const s0 = EditorState.create({ doc, selection: TextSelection.near(doc.resolve(third + 2)) });
    const s = s0.apply(sweepEmptyBeats(s0)!);
    expect(s.selection).toBeInstanceOf(NodeSelection);
    expect(JSON.parse((s.selection as NodeSelection).node.attrs.raw as string).id).toBe("sn3");
  });

  it("a blank option PROMPT swept under the caret falls back to the editor's own mapping, no throw", () => {
    const scene = sceneWith([{ id: "g", type: "group", selector: "choice", children: [
      { id: "o", type: "group", selector: "option", prompt: { id: "P", kind: "text" }, children: [
        { id: "sn", type: "snippet", beats: [{ id: "L", kind: "text" }] },
      ] },
    ] } as unknown as Scene["blocks"][number]["children"][number]]);
    const doc = sceneToDoc(scene, { P: "", L: "said" });
    let promptBeat = -1;
    doc.descendants((n, pos) => { if (promptBeat < 0 && n.type.name === "prose" && n.textContent === "") promptBeat = pos; return promptBeat < 0; });
    const s0 = EditorState.create({ doc, selection: TextSelection.near(doc.resolve(promptBeat + 2)) });
    expect(() => { const tr = sweepEmptyBeats(s0); if (tr) s0.apply(tr); }).not.toThrow();
  });
});

describe("the / menu's Jump survives the line it was raised on being tidied away (#63, 0.16.6)", () => {
  const posOfSnippet = (state: EditorState, id: string): number => {
    let at = -1;
    state.doc.descendants((n, pos) => { if (at < 0 && n.type.name === "snippet" && JSON.parse(n.attrs.raw as string).id === id) at = pos; return at < 0; });
    return at;
  };

  const oneBlankLine: Scene = { id: "s", type: "scene", name: "S", blocks: [
    { id: "b1", type: "block", name: "section1", children: [{ id: "sn1", type: "snippet", beats: [{ id: "L1", kind: "line", character: "HECTOR" }] }] },
    { id: "b2", type: "block", name: "section2", children: [{ id: "sn2", type: "snippet", beats: [{ id: "L2", kind: "line" }] }] },
  ] };

  /** The caret in sn2's blank line, which is where "/" was typed. */
  const stateAtBlank = (): EditorState => {
    const doc = sceneToDoc(oneBlankLine, { L1: "hi", L2: "" });
    let blank = -1;
    doc.descendants((n, pos) => { if (n.type.name === "line" && n.textContent === "") blank = pos; return true; });
    return EditorState.create({ doc, selection: TextSelection.near(doc.resolve(blank + 2)) });
  };

  it("consumes the triggering line when it is still there (the ordinary path)", () => {
    const s0 = stateAtBlank();
    const s = s0.apply(commitSlashJump(s0, "b1", "sn2")!);
    const sn2 = s.doc.nodeAt(posOfSnippet(s, "sn2"))!;
    expect(sn2.childCount).toBe(0);                                   // the blank line went with it
    expect(JSON.parse(sn2.attrs.jump as string).to).toBe("b1");
  });

  it("still routes the bubble when the line has ALREADY been swept (what the capture shows)", () => {
    // Their 0.16.6 capture: the blank line is gone before the pick lands, so insertJump has nothing to
    // consume and used to decline - the author picked a target and nothing happened.
    const s0 = stateAtBlank();
    const swept = s0.apply(sweepEmptyBeats(s0)!);
    expect(insertJump(swept, "b1")).toBeNull();                       // the old path gives up here
    const s = swept.apply(commitSlashJump(swept, "b1", "sn2")!);      // ...this one does not
    const sn2 = s.doc.nodeAt(posOfSnippet(s, "sn2"))!;
    expect(JSON.parse(sn2.attrs.jump as string).to).toBe("b1");
    expect(sn2.childCount).toBe(0);
  });

  it("declines when there is neither a triggering line nor that bubble, rather than routing something else", () => {
    const s0 = stateAtBlank();
    const swept = s0.apply(sweepEmptyBeats(s0)!);
    expect(commitSlashJump(swept, "b1", "sn_not_here")).toBeNull();
  });
});
