// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// The surface findings of the Patterpad review, October 2026, that need a mounted
// surface (the DOM, the keymap, the floating menus). Each test names its finding
// and drives its trigger through the real mountSurface.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EditorState, NodeSelection, TextSelection } from "prosemirror-state";
import type { Scene } from "@patterkit/model";

// The themed confirm is a native <dialog>; here every confirm says yes, and records that it was asked.
const asked: string[] = [];
vi.mock("./confirm.js", () => ({
  confirmDialog: async () => true,
  confirmDeleteChunk: async (noun: string) => { asked.push(`chunk:${noun}`); return true; },
  confirmDeleteSet: async (n: number) => { asked.push(`set:${n}`); return true; },
  confirmDeleteBlock: async (name: string) => { asked.push(`block:${name}`); return true; },
}));

import { mountSurface, sweepEmptyBeats, type SurfaceHandle } from "./surface.js";
import { destroyActionMenu } from "./views.js";
import { sceneToDoc, docToScene } from "../src/bridge.js";

(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

type Blocks = Scene["blocks"];
function mount(blocks: Blocks, strings: Record<string, string>, extra: Partial<Parameters<typeof mountSurface>[0]> = {}) {
  const flow = JSON.stringify({ schema: "patter/flow@0", scene: { id: "scn", type: "scene", name: "The Tavern", blocks } });
  const loc = JSON.stringify({ schema: "patter/strings@0", scene: "scn", locale: "en", default: true, strings });
  const editor = document.createElement("div"); document.body.appendChild(editor);
  (editor as unknown as { scrollTo: () => void }).scrollTo = () => undefined;
  const refusals: string[] = [];
  const h = mountSurface({ editor, flowSource: flow, locSource: loc, onRefuse: (m) => refusals.push(m), ...extra });
  return { h, editor, refusals };
}
const key = (h: SurfaceHandle, k: string, mods: Partial<KeyboardEventInit> = {}): boolean => {
  const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...mods });
  return !!h.view.someProp("handleKeyDown", (f) => f(h.view, e));
};
const select = (h: SurfaceHandle, sel: (s: EditorState) => import("prosemirror-state").Selection): void => {
  h.view.dispatch(h.view.state.tr.setSelection(sel(h.view.state)));
};
const sayPos = (s: EditorState, beatId: string, offset = 0): number => {
  let p = -1;
  s.doc.descendants((n, pos) => {
    if (p < 0 && (n.type.name === "line" || n.type.name === "prose") && n.attrs.id === beatId) { n.forEach((z, o) => { if (z.type.name === "say") p = pos + 1 + o + 1 + offset; }); return false; }
    return true;
  });
  return p;
};
const blockNames = (h: SurfaceHandle): string[] => docToScene(h.view.state.doc).scene.blocks.map((b) => b.name);
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const block = (id: string, name: string, beats: Array<{ id: string; kind: "text" | "line" | "gameEvent"; character?: string }>, extra: Record<string, unknown> = {}): Blocks[0] =>
  ({ id, type: "block", name, children: [{ id: `sn_${id}`, type: "snippet", beats, ...extra }] } as Blocks[0]);

// The action menu is a module-level singleton; a test that empties the page must drop it too.
beforeEach(() => { destroyActionMenu(); document.body.replaceChildren(); asked.length = 0; });

describe("HIGH 7: Backspace / Delete on a selected block", () => {
  it("goes through the menu's confirm and deleteBlock", async () => {
    const { h } = mount([block("b1", "One", [{ id: "T1", kind: "text" }]), block("b2", "Two", [{ id: "T2", kind: "text" }])], { T1: "a", T2: "b" });
    select(h, (s) => NodeSelection.create(s.doc, s.doc.firstChild!.nodeSize)); // the second block
    expect(key(h, "Backspace")).toBe(true);
    expect(blockNames(h)).toEqual(["One", "Two"]); // nothing yet: the confirm is pending
    await flush();
    expect(asked).toEqual(["block:Two"]);
    expect(blockNames(h)).toEqual(["One"]);
  });
  it("refuses the scene's only block, says why, and leaves it whole", async () => {
    const { h, refusals } = mount([block("b1", "Only", [{ id: "T1", kind: "text" }])], { T1: "a" });
    select(h, (s) => NodeSelection.create(s.doc, 0));
    expect(key(h, "Delete")).toBe(true);
    await flush();
    expect(asked).toEqual([]);
    expect(blockNames(h)).toEqual(["Only"]);
    expect(refusals).toEqual(["A scene needs at least one block, so its last one can't be deleted."]);
    expect(docToScene(h.view.state.doc).scene.blocks[0]!.id).toBe("b1");
  });
});

describe("HIGH 8: the blur sweep never removes an option's prompt", () => {
  it("keeps a fresh option's empty prompt (and still sweeps a stray blank line)", () => {
    const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
      { id: "ch", type: "group", selector: "choice", children: [
        { id: "o1", type: "group", prompt: { id: "P1", kind: "text" }, children: [{ id: "sn", type: "snippet", beats: [{ id: "T1", kind: "text" }, { id: "T2", kind: "text" }] }] },
      ] },
    ] }] };
    const s0 = EditorState.create({ doc: sceneToDoc(scene, { T1: "body" }) });
    const s = s0.apply(sweepEmptyBeats(s0)!);
    const opt = (docToScene(s.doc).scene.blocks[0]!.children[0] as { children: Array<{ prompt?: { id: string }; children: Array<{ beats: Array<{ id: string }> }> }> }).children[0]!;
    expect(opt.prompt?.id).toBe("P1");
    expect(opt.children[0]!.beats.map((b) => b.id)).toEqual(["T1"]);
  });
});

describe("HIGH 9 / ruling D: the host hears the refusal", () => {
  it("Backspace at the start of a bubble with a condition calls onRefuse and changes nothing", () => {
    const { h, refusals } = mount([{ id: "b", type: "block", name: "B", children: [
      { id: "a", type: "snippet", beats: [{ id: "T1", kind: "text" }] },
      { id: "c", type: "snippet", condition: "@x", beats: [{ id: "T2", kind: "text" }] },
    ] }], { T1: "one", T2: "two" });
    select(h, (s) => TextSelection.create(s.doc, sayPos(s, "T2")));
    const before = h.view.state.doc;
    key(h, "Backspace");
    expect(h.view.state.doc.eq(before)).toBe(true);
    expect(refusals).toEqual(["This bubble has a condition. Move or clear it first."]);
  });
});

describe("HIGH 10 / ruling E: paste through the real paste event", () => {
  const paste = (h: SurfaceHandle, data: Record<string, string>): void => {
    const e = new Event("paste", { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
    e.clipboardData = { getData: (t: string) => data[t] ?? "" };
    h.view.dom.dispatchEvent(e);
  };
  const scene = (): Blocks => [{ id: "b", type: "block", name: "B", children: [{ id: "sn", type: "snippet", beats: [
    { id: "L1", kind: "line", character: "ANNA" }, { id: "T2", kind: "text" }, { id: "T3", kind: "text" },
  ] }] }];

  it("a copy across two beats (this editor's own HTML) pastes as lines, without throwing, and no speaker", () => {
    const { h } = mount(scene(), { L1: "Hello there", T2: "Narration line", T3: "Target" });
    const s = h.view.state;
    const slice = TextSelection.create(s.doc, sayPos(s, "L1"), sayPos(s, "T2", 9)).content();
    const { dom, text } = h.view.serializeForClipboard(slice);
    select(h, (st) => TextSelection.create(st.doc, sayPos(st, "T3", 6)));
    expect(() => paste(h, { "text/html": dom.innerHTML, "text/plain": text })).not.toThrow();
    const sc = docToScene(h.view.state.doc);
    const beats = (sc.scene.blocks[0]!.children[0] as { beats: Array<{ id: string }> }).beats;
    expect(beats.length).toBe(4);
    expect(sc.strings.T3).toBe("TargetHello there");
    expect(sc.strings[beats[3]!.id]).toBe("Narration");
    expect(Object.values(sc.strings).join("|")).not.toContain("ANNA");
  });

  it("multi-paragraph plain text becomes new text beats", () => {
    const { h } = mount(scene(), { L1: "Hello", T2: "x", T3: "Target" });
    select(h, (st) => TextSelection.create(st.doc, sayPos(st, "T3", 6)));
    paste(h, { "text/plain": "Para one\n\nPara two" });
    const sc = docToScene(h.view.state.doc);
    const beats = (sc.scene.blocks[0]!.children[0] as { beats: Array<{ id: string; kind: string }> }).beats;
    expect(beats.map((b) => b.kind)).toEqual(["line", "text", "text", "text"]);
    expect(sc.strings.T3).toBe("TargetPara one");
    expect(sc.strings[beats[3]!.id]).toBe("Para two");
  });

  it("copy writes the spoken words only, one beat to a line", () => {
    const { h } = mount(scene(), { L1: "Hello", T2: "Narration", T3: "z" });
    const s = h.view.state;
    const slice = TextSelection.create(s.doc, 3, sayPos(s, "T2", 9)).content();
    expect(h.view.serializeForClipboard(slice).text).toBe("Hello\nNarration");
  });

  it("a locked scene takes no paste", () => {
    const { h } = mount(scene(), { L1: "Hello", T2: "x", T3: "Target" });
    select(h, (st) => TextSelection.create(st.doc, sayPos(st, "T3", 6)));
    h.setEditable(false);
    const before = h.view.state.doc;
    paste(h, { "text/plain": "nope" });
    expect(h.view.state.doc.eq(before)).toBe(true);
  });
});

describe("MEDIUM 33: a locked scene's chrome does nothing", () => {
  const scene = (): Blocks => [{ id: "b", type: "block", name: "B", children: [
    { id: "sn", type: "snippet", beats: [{ id: "T1", kind: "text" }, { id: "A1", kind: "gameEvent" }] },
    { id: "emp", type: "snippet", beats: [] },
  ] }];
  const down = (el: Element | null): void => { el?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 })); };

  it("the + controls, the game event's ×, and the ghost leave the doc alone; programmatic edits too", () => {
    const { h, editor } = mount(scene(), { T1: "words" });
    h.setEditable(false);
    const before = h.view.state.doc;
    down(editor.querySelector(".block-ctl.add"));      // + Block
    down(editor.querySelector(".atom-del"));           // the game event's ×
    down(editor.querySelector(".bubble-ghost"));       // the add-a-line ghost
    h.setGameData("T1", "k", 1);                       // the inspector's route
    h.setSceneName("Renamed");
    expect(h.view.state.doc.eq(before)).toBe(true);
  });

  it("the scene title is not editable while locked", () => {
    const { h, editor } = mount(scene(), { T1: "words" }, { showTitle: true });
    const title = editor.querySelector(".scene-title")!;
    expect(title.getAttribute("contenteditable")).toBe("plaintext-only");
    h.setEditable(false);
    expect(title.getAttribute("contenteditable")).toBe("false");
    h.setEditable(true);
    expect(title.getAttribute("contenteditable")).toBe("plaintext-only");
  });

  it("the action menu offers no structural item while locked", () => {
    const { h, editor } = mount(scene(), { T1: "words" }, { onEditNote: () => undefined });
    h.setEditable(false);
    editor.querySelector(".bubble")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
    const menu = [...document.querySelectorAll(".action-menu:not(.action-submenu)")].at(-1);
    const items = [...(menu?.querySelectorAll(".action-mi") ?? [])].map((b) => b.textContent);
    expect(items).toContain("Note…"); // what does not edit the scene stays
    for (const structural of ["Follow with", "Wrap in", "Duplicate", "Delete", "Split here", "Join with next"]) expect(items).not.toContain(structural);
  });

  it("Backspace on a selected bubble asks nothing while locked", async () => {
    const { h } = mount(scene(), { T1: "words" });
    select(h, (s) => NodeSelection.create(s.doc, 1));
    h.setEditable(false);
    key(h, "Backspace");
    await flush();
    expect(asked).toEqual([]);
  });
});

describe("MEDIUM 36: right-clicking an option's prompt opens the option's menu", () => {
  it("heads the menu 'Option', not 'Snippet'", () => {
    const { editor } = mount([{ id: "b", type: "block", name: "B", children: [{ id: "ch", type: "group", selector: "choice", children: [
      { id: "o1", type: "group", prompt: { id: "P1", kind: "text" }, children: [{ id: "sn", type: "snippet", beats: [{ id: "T1", kind: "text" }] }] },
    ] }] }], { P1: "Go", T1: "x" });
    editor.querySelector(".option-prompt .beat")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
    const menu = [...document.querySelectorAll(".action-menu:not(.action-submenu)")].at(-1)!;
    expect(menu.querySelector(".action-head")?.textContent).toBe("Option");
    expect([...menu.querySelectorAll(".action-mi")].map((b) => b.textContent)).toContain("Add option");
  });
});

describe("MEDIUM 38 and 31: the scene title after undo, and Esc", () => {
  const titled = () => mount([block("b1", "One", [{ id: "T1", kind: "text" }])], { T1: "a" }, { showTitle: true });

  it("shows the reverted name after an undo, and the next blur commits nothing", () => {
    const { h, editor } = titled();
    const title = editor.querySelector<HTMLElement>(".scene-title")!;
    title.focus(); title.textContent = "Renamed"; title.dispatchEvent(new Event("input")); title.blur();
    expect(h.sceneName()).toBe("Renamed");
    h.undo();
    expect(h.sceneName()).toBe("The Tavern");
    expect(title.textContent).toBe("The Tavern");
    title.focus(); title.blur(); // no typing
    expect(h.sceneName()).toBe("The Tavern");
  });

  it("Esc in the title restores the name it had on focus and does not commit", () => {
    const { h, editor } = titled();
    const title = editor.querySelector<HTMLElement>(".scene-title")!;
    title.focus(); title.textContent = "Half typed"; title.dispatchEvent(new Event("input"));
    title.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(title.textContent).toBe("The Tavern");
    expect(h.sceneName()).toBe("The Tavern");
    title.focus(); title.blur();
    expect(h.sceneName()).toBe("The Tavern");
  });

  it("Esc in a block rename restores the name it had on focus and does not commit", () => {
    const { h, editor } = titled();
    const name = editor.querySelector<HTMLInputElement>(".block-name")!;
    name.focus(); name.value = "Half typed";
    name.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(name.value).toBe("One");
    name.dispatchEvent(new Event("change")); // even a stray change commits the restored name, i.e. nothing new
    expect(blockNames(h)).toEqual(["One"]);
  });

  it("Enter in a block rename still commits", () => {
    const { h, editor } = titled();
    const name = editor.querySelector<HTMLInputElement>(".block-name")!;
    name.focus(); name.value = "Renamed";
    name.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    name.dispatchEvent(new Event("change")); // jsdom does not fire change on blur; the browser does
    expect(blockNames(h)).toEqual(["Renamed"]);
  });
});

describe("LOW: keyboard and input", () => {
  it("Tab never leaves the editor (it is swallowed where it has nothing to do)", () => {
    const { h } = mount([block("b1", "One", [{ id: "T1", kind: "text" }])], { T1: "words" });
    select(h, (s) => TextSelection.create(s.doc, sayPos(s, "T1", 2)));
    expect(key(h, "Tab")).toBe(true);
    expect(key(h, "Tab", { shiftKey: true })).toBe(true);
  });

  it("an IME's composed text in a cue goes into the cast popup's filter, never the name", () => {
    const { h } = mount([block("b1", "One", [{ id: "L1", kind: "line", character: "" }])], { L1: "" }, { castSeed: ["ゆき", "BO"] });
    let cue = -1; h.view.state.doc.descendants((n, p) => { if (cue < 0 && n.type.name === "cue") cue = p + 1; return cue < 0; });
    select(h, (s) => TextSelection.create(s.doc, cue));
    h.view.focus();
    const handled = h.view.someProp("handleTextInput", (f) => f(h.view, cue, cue, "ゆ", () => h.view.state.tr));
    expect(handled).toBe(true);
    let name = "x"; h.view.state.doc.descendants((n) => { if (n.type.name === "cue") name = n.textContent; return name === "x"; });
    expect(name).toBe("");
    const field = [...document.querySelectorAll(".cue-ac .cue-ac-field")].at(-1);
    expect(field?.textContent).toBe("ゆ");
    expect([...document.querySelectorAll(".cue-ac .cue-ac-item")].map((b) => b.textContent)).toEqual(["ゆき"]);
  });

  it("the slash menu's Jump key is a letter of its label", () => {
    const { h } = mount([block("b1", "One", [{ id: "T1", kind: "text" }])], { T1: "" });
    select(h, (s) => TextSelection.create(s.doc, sayPos(s, "T1")));
    h.view.someProp("handleTextInput", (f) => f(h.view, 0, 0, "/", () => h.view.state.tr));
    const jump = [...document.querySelectorAll(".slash-menu .slash-item")].find((b) => b.textContent === "Jump")!;
    expect(jump.querySelector("u")?.textContent).toBe("J");
  });
});

describe("LOW: destroy", () => {
  it("removes the floating menus it made and runs no frame callback afterwards", async () => {
    const onChange = vi.fn();
    const { h, editor } = mount([block("b1", "One", [{ id: "T1", kind: "text" }])], { T1: "" }, { onChange });
    // Make the action menu exist, then edit so a change notification is queued for the next frame.
    editor.querySelector(".bubble")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(document.querySelectorAll(".cue-ac, .slash-menu, .action-menu").length).toBeGreaterThan(0);
    onChange.mockClear();
    h.view.dispatch(h.view.state.tr.insertText("x", sayPos(h.view.state, "T1")));
    h.destroy();
    await new Promise((r) => setTimeout(r, 40));
    expect(onChange).not.toHaveBeenCalled();
    expect(document.querySelectorAll(".cue-ac, .slash-menu, .action-menu, .spell-menu").length).toBe(0);
  });
});
