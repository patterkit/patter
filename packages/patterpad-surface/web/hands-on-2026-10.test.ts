// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// The surface's part of the hands-on fixes review (design/hands-on-fixes-code-review-2026-10.md,
// section 4 and the step 5 rulings Q13 to Q16), each driven through a real mountSurface:
//   1. effect chips on the page, and the scene's entry effects under its title
//   2. the jump picker creates a scene or a block
//   3. moving a snippet or group from the keyboard (and the ⋯ menu, and the handle)
//   4. the ⋯ from the keyboard
//   5. the ⋯ menu's Add comment and Suggest rewrite
//   6. the cast picker's "+ Add" only for name-like text, and setCast
//   7. a deleted target reads "Missing scene" / "Missing block"
//   8. `@gold` for Patter's own scope on the page
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NodeSelection, TextSelection } from "prosemirror-state";
import type { Scene } from "@patterkit/model";
import { setKeyPlatform, hashColour } from "@wildwinter/app-shell";
import { castColour } from "../src/colour.js";
import { mountSurface, type SurfaceHandle } from "./surface.js";
import { destroyActionMenu } from "./views.js";
import { openTargetPicker, closeTargetPicker } from "./targetpicker.js";
import { isNameLike } from "./cuepopup.js";
import { shortRefs, refText, missingLabel } from "./reftext.js";
import { docToScene } from "../src/bridge.js";
import { SET_MULTI } from "../src/multiselect.js";
import { findByModelId } from "../src/zoneutil.js";

(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

type Blocks = Scene["blocks"];
function mount(blocks: Blocks, strings: Record<string, string>, extra: Partial<Parameters<typeof mountSurface>[0]> = {}, scene: Record<string, unknown> = {}) {
  const flow = JSON.stringify({ schema: "patter/flow@0", scene: { id: "scn", type: "scene", name: "The Tavern", ...scene, blocks } });
  const loc = JSON.stringify({ schema: "patter/strings@0", scene: "scn", locale: "en", default: true, strings });
  const editor = document.createElement("div"); document.body.appendChild(editor);
  (editor as unknown as { scrollTo: () => void }).scrollTo = () => undefined;
  const refusals: string[] = [];
  const h = mountSurface({ editor, flowSource: flow, locSource: loc, onRefuse: (m) => refusals.push(m), ...extra });
  return { h, editor, refusals };
}
const keydown = (h: SurfaceHandle, k: string, mods: Partial<KeyboardEventInit> = {}): boolean => {
  const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...mods });
  return !!h.view.someProp("handleKeyDown", (f) => f(h.view, e));
};
const press = (el: Element, k: string, mods: Partial<KeyboardEventInit> = {}): void => {
  el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...mods }));
};
const click = (el: Element): void => {
  el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
};
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const snip = (id: string, beat: string, extra: Record<string, unknown> = {}) => ({ id, type: "snippet", beats: [{ id: beat, kind: "text" }], ...extra });
const order = (h: SurfaceHandle, block = 0): string[] => docToScene(h.view.state.doc).scene.blocks[block]!.children.map((c) => c.id);
const caretIn = (h: SurfaceHandle, beatId: string): void => {
  const b = findByModelId(h.view.state.doc, beatId)!;
  h.view.dispatch(h.view.state.tr.setSelection(TextSelection.near(h.view.state.doc.resolve(b.pos + 2))));
};
const selectNode = (h: SurfaceHandle, id: string): void => {
  const b = findByModelId(h.view.state.doc, id)!;
  h.view.dispatch(h.view.state.tr.setSelection(NodeSelection.create(h.view.state.doc, b.pos)));
};
const pickerRows = (): string[] => [...document.querySelectorAll(".tp-row")].map((r) => r.textContent ?? "");
const typeInPicker = (text: string): void => {
  const f = document.querySelector<HTMLInputElement>(".tp-field")!;
  f.value = text; f.dispatchEvent(new Event("input"));
};
const menuItems = (): string[] => [...document.querySelectorAll(".action-menu:not(.action-submenu) .action-mi")].map((b) => b.textContent ?? "");

const THREE = (): Blocks => [{ id: "blk_a", type: "block", name: "Main", children: [snip("s1", "T1"), snip("s2", "T2"), snip("s3", "T3")] }] as unknown as Blocks;
const TEXTS = { T1: "one", T2: "two", T3: "three" };

beforeEach(() => { destroyActionMenu(); closeTargetPicker(); document.body.replaceChildren(); setKeyPlatform("mac"); });
afterEach(() => setKeyPlatform(undefined));

describe("1. effect chips on the page", () => {
  it("paints On begin and On end, worded like the condition, and repaints when they change", () => {
    const blocks = [{ id: "blk_a", type: "block", name: "Main", children: [snip("s1", "T1", {
      condition: "@patter.gold > 2",
      onEnter: [{ kind: "set", target: "@patter.gold", value: "@patter.gold + 1" }, { kind: "set", target: "@scene.met", value: "true" }],
      onExit: [{ kind: "set", target: "@world.day", value: "@world.day + 1" }],
    }), snip("s2", "T2")] }] as unknown as Blocks;
    const { h, editor } = mount(blocks, TEXTS);
    const bubble = editor.querySelector('.bubble[data-id="s1"]')!;
    expect(bubble.querySelector(".bubble-cond")?.textContent).toBe("if @gold > 2");
    expect(bubble.querySelector(".fx-begin")?.textContent).toBe("On begin: set @gold to @gold + 1; set @scene.met to true");
    expect(bubble.querySelector(".fx-end")?.textContent).toBe("On end: set @world.day to @world.day + 1");
    expect(bubble.classList.contains("has-fx-begin") && bubble.classList.contains("has-fx-end")).toBe(true);
    // The other snippet has none: no chip classes, no text.
    const plain = editor.querySelector('.bubble[data-id="s2"]')!;
    expect(plain.classList.contains("has-fx-begin") || plain.classList.contains("has-fx-end")).toBe(false);
    // The inspector's edit repaints it.
    h.setEffects("s1", "onExit", []);
    expect(bubble.classList.contains("has-fx-end")).toBe(false);
    h.setEffects("s2", "onEnter", [{ kind: "set", target: "@patter.met", value: "true" }]);
    expect(plain.querySelector(".fx-begin")?.textContent).toBe("On begin: set @met to true");
    h.destroy();
  });

  it("shows the scene's entry effects under its title", () => {
    const { h, editor } = mount(THREE(), TEXTS, { showTitle: true }, { onEntry: [{ kind: "set", target: "@patter.gold", value: "10" }] });
    const fx = editor.querySelector<HTMLElement>(".scene-effects")!;
    expect(fx.previousElementSibling?.classList.contains("scene-title")).toBe(true);
    expect(fx.textContent).toBe("On begin: set @gold to 10");
    expect(fx.hidden).toBe(false);
    h.destroy();
  });

  it("has no entry line for a scene without entry effects", () => {
    const { h, editor } = mount(THREE(), TEXTS, { showTitle: true });
    expect(editor.querySelector<HTMLElement>(".scene-effects")!.hidden).toBe(true);
    h.destroy();
  });
});

describe("2. the jump picker creates a scene or a block", () => {
  const DATA = { scenes: [{ scene: { id: "scn", label: "The Tavern" }, blocks: [{ id: "blk_a", label: "Main" }] }] };

  it("offers both create rows for a name nothing has, none for one that exists, and none without the hook", () => {
    const anchor = document.createElement("button"); document.body.append(anchor);
    const made: Array<[string, string]> = [];
    openTargetPicker({ anchor, data: DATA, current: "", allowClear: false, onPick: () => {}, onCreate: (w, n) => made.push([w, n]) });
    typeInPicker("  Cellar ");
    expect(pickerRows()).toEqual(["+ New scene 'Cellar'", "+ New block 'Cellar' in this scene"]);
    typeInPicker("main");
    expect(pickerRows().some((r) => r.startsWith("+ New"))).toBe(false); // "Main" exists
    typeInPicker("Cellar");
    click([...document.querySelectorAll(".tp-row")].find((r) => r.textContent?.startsWith("+ New block"))!);
    expect(made).toEqual([["block", "Cellar"]]);
    closeTargetPicker();

    openTargetPicker({ anchor, data: DATA, current: "", allowClear: false, onPick: () => {} });
    typeInPicker("Cellar");
    expect(pickerRows()).toEqual([]);
  });

  it("a new block in this scene: the host makes it with addBlock, and the jump goes there", async () => {
    const reqs: unknown[] = [];
    let handle: SurfaceHandle | null = null;
    const { h, editor } = mount(THREE(), TEXTS, {
      onCreateTarget: async (req) => { reqs.push(req); const id = handle!.addBlock(req.name); return id ? { scene: "scn", block: id } : null; },
    });
    handle = h;
    caretIn(h, "T2");
    const anchor = document.createElement("button"); document.body.append(anchor);
    h.editJump("s2", anchor);
    typeInPicker("Cellar");
    click([...document.querySelectorAll(".tp-row")].find((r) => r.textContent === "+ New block 'Cellar' in this scene")!);
    await flush();
    expect(reqs).toEqual([{ kind: "block", name: "Cellar", scene: "scn" }]);
    const scene = docToScene(h.view.state.doc).scene;
    expect(scene.blocks.map((b) => b.name)).toEqual(["Main", "Cellar"]);
    const s2 = scene.blocks[0]!.children[1] as { jump?: { to: string } };
    expect(s2.jump?.to).toBe(scene.blocks[1]!.id);
    expect(editor.querySelector('.bubble[data-id="s2"] .bubble-jump')?.textContent).toBe("Cellar");
    h.destroy();
  });

  it("a new scene: the jump goes to it and the chip names it before the host's setJumpTargets", async () => {
    const { h, editor } = mount(THREE(), TEXTS, { onCreateTarget: async (req) => (req.kind === "scene" ? { scene: "scn_new" } : null) });
    const anchor = document.createElement("button"); document.body.append(anchor);
    h.editJump("s1", anchor);
    typeInPicker("Back Room");
    click([...document.querySelectorAll(".tp-row")].find((r) => r.textContent === "+ New scene 'Back Room'")!);
    await flush();
    expect((docToScene(h.view.state.doc).scene.blocks[0]!.children[0] as { jump?: { to: string } }).jump?.to).toBe("scn_new");
    expect(editor.querySelector('.bubble[data-id="s1"] .bubble-jump')?.textContent).toBe("Back Room");
    h.destroy();
  });

  it("the host giving up leaves the jump as it was", async () => {
    const { h } = mount(THREE(), TEXTS, { onCreateTarget: async () => null });
    const anchor = document.createElement("button"); document.body.append(anchor);
    h.editJump("s1", anchor);
    typeInPicker("Nowhere");
    click(document.querySelector(".tp-create")!);
    await flush();
    expect((docToScene(h.view.state.doc).scene.blocks[0]!.children[0] as { jump?: unknown }).jump).toBeUndefined();
    h.destroy();
  });

  it("pickNode offers the create rows too, and hands the new id over", async () => {
    const { h } = mount(THREE(), TEXTS, { onCreateTarget: async () => ({ scene: "scn_x" }) });
    const anchor = document.createElement("button"); document.body.append(anchor);
    const got: string[] = [];
    h.pickNode({ anchor, current: "", onPick: (id) => got.push(id) });
    typeInPicker("Attic");
    click(document.querySelector(".tp-create")!);
    await flush();
    expect(got).toEqual(["scn_x"]);
    h.destroy();
  });
});

describe("3. moving from the keyboard", () => {
  it("Ctrl+Cmd+Down on a Mac moves the snippet holding the caret, one undo step per move", () => {
    const { h } = mount(THREE(), TEXTS);
    caretIn(h, "T1");
    expect(keydown(h, "ArrowDown", { ctrlKey: true, metaKey: true })).toBe(true);
    expect(order(h)).toEqual(["s2", "s1", "s3"]);
    expect(keydown(h, "ArrowDown", { ctrlKey: true, metaKey: true })).toBe(true);
    expect(order(h)).toEqual(["s2", "s3", "s1"]);
    // the caret went with it
    expect(h.view.state.selection.$head.parent.textContent).toBe("one");
    h.undo();
    expect(order(h)).toEqual(["s2", "s1", "s3"]);
    h.undo();
    expect(order(h)).toEqual(["s1", "s2", "s3"]);
    h.destroy();
  });

  it("stops at the first or last place with a quiet hint", () => {
    const { h, refusals } = mount(THREE(), TEXTS);
    caretIn(h, "T1");
    expect(h.canMoveSelection(-1)).toBe(false);
    expect(h.canMoveSelection(1)).toBe(true);
    expect(keydown(h, "ArrowUp", { ctrlKey: true, metaKey: true })).toBe(true);
    expect(order(h)).toEqual(["s1", "s2", "s3"]);
    expect(refusals.at(-1)).toBe("It's already at the top of this block.");
    caretIn(h, "T3");
    expect(h.moveSelection(1)).toBe(false);
    expect(refusals.at(-1)).toBe("It's already at the bottom of this block.");
    h.destroy();
  });

  it("is Ctrl+Alt elsewhere, and Ctrl+Cmd there isn't a move", () => {
    setKeyPlatform("win");
    const { h } = mount(THREE(), TEXTS);
    caretIn(h, "T1");
    keydown(h, "ArrowDown", { ctrlKey: true, metaKey: true });
    expect(order(h)).toEqual(["s1", "s2", "s3"]);
    expect(keydown(h, "ArrowDown", { ctrlKey: true, altKey: true })).toBe(true);
    expect(order(h)).toEqual(["s2", "s1", "s3"]);
    h.destroy();
  });

  it("a selected snippet stays selected as it moves; a group moves whole within its parent", () => {
    const blocks = [{ id: "blk_a", type: "block", name: "Main", children: [
      snip("s1", "T1"),
      { id: "g1", type: "group", selector: "sequence", children: [snip("s2", "T2"), snip("s3", "T3")] },
    ] }] as unknown as Blocks;
    const { h, refusals } = mount(blocks, TEXTS);
    selectNode(h, "g1");
    expect(h.moveSelection(-1)).toBe(true);
    expect(order(h)).toEqual(["g1", "s1"]);
    const sel = h.view.state.selection as NodeSelection;
    expect(sel instanceof NodeSelection && sel.node.type.name === "group").toBe(true);
    // Inside the group, a snippet never climbs out of it.
    caretIn(h, "T2");
    expect(h.moveSelection(-1)).toBe(false);
    expect(refusals.at(-1)).toBe("It's already at the top of this group.");
    h.destroy();
  });

  it("a multi-selection moves together when its chunks are neighbours, and says why when they aren't", () => {
    const { h, refusals } = mount([{ id: "blk_a", type: "block", name: "Main", children: [snip("s1", "T1"), snip("s2", "T2"), snip("s3", "T3"), snip("s4", "T4")] }] as unknown as Blocks, { ...TEXTS, T4: "four" });
    const multi = (ids: string[]): void => {
      const last = findByModelId(h.view.state.doc, ids.at(-1)!)!;
      h.view.dispatch(h.view.state.tr.setSelection(NodeSelection.create(h.view.state.doc, last.pos)).setMeta(SET_MULTI, { ids, anchor: ids[0] }));
    };
    multi(["s1", "s2"]);
    expect(h.moveSelection(1)).toBe(true);
    expect(order(h)).toEqual(["s3", "s1", "s2", "s4"]);
    expect(h.moveSelection(1)).toBe(true); // still selected after the first move
    expect(order(h)).toEqual(["s3", "s4", "s1", "s2"]);
    multi(["s3", "s1"]);
    expect(h.canMoveSelection(-1)).toBe(false);
    expect(h.moveSelection(-1)).toBe(false);
    expect(refusals.at(-1)).toBe("Only neighbouring snippets can move together. Select a run with no gaps.");
    expect(order(h)).toEqual(["s3", "s4", "s1", "s2"]);
    h.destroy();
  });

  it("the ⋯ menu has Move up and Move down with the shortcut, greyed where it can't go", () => {
    const { h, editor } = mount(THREE(), TEXTS);
    const dots = editor.querySelector('.bubble[data-id="s1"] > .bubble-menu')!;
    dots.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    const up = [...document.querySelectorAll<HTMLButtonElement>(".action-move")].find((b) => b.textContent?.startsWith("Move up"))!;
    const down = [...document.querySelectorAll<HTMLButtonElement>(".action-move")].find((b) => b.textContent?.startsWith("Move down"))!;
    expect(up.querySelector(".action-key")?.textContent).toBe("⌃⌘↑");
    expect(down.querySelector(".action-key")?.textContent).toBe("⌃⌘↓");
    expect(up.disabled).toBe(true);
    expect(down.disabled).toBe(false);
    click(down);
    expect(order(h)).toEqual(["s2", "s1", "s3"]);
    h.destroy();
  });
});

describe("4. the ⋯ from the keyboard", () => {
  it("Enter opens it with the first item focused; the arrows move; Escape closes it and gives the focus back", () => {
    const { h, editor } = mount(THREE(), TEXTS);
    const dots = editor.querySelector<HTMLButtonElement>('.bubble[data-id="s2"] > .bubble-menu')!;
    dots.focus();
    press(dots, "Enter");
    const items = [...document.querySelectorAll<HTMLButtonElement>(".action-menu:not(.action-submenu) .action-mi")].filter((b) => !b.disabled);
    expect(items.length).toBeGreaterThan(2);
    expect(document.activeElement).toBe(items[0]);
    press(document.activeElement!, "ArrowDown");
    expect(document.activeElement).toBe(items[1]);
    press(document.activeElement!, "ArrowUp");
    press(document.activeElement!, "ArrowUp"); // wraps to the last
    expect(document.activeElement).toBe(items.at(-1));
    press(document.activeElement!, "Escape");
    expect(document.activeElement).toBe(dots);
    expect(h.view.state.doc.childCount).toBe(1); // nothing was done to the document
    h.destroy();
  });

  it("Space opens it too; Right opens a submenu and Left comes back to its parent", () => {
    const { h, editor } = mount(THREE(), TEXTS);
    const dots = editor.querySelector<HTMLButtonElement>('.bubble[data-id="s2"] > .bubble-menu')!;
    press(dots, " ");
    const follow = [...document.querySelectorAll<HTMLButtonElement>(".action-mi.has-sub")].find((b) => b.textContent?.startsWith("Follow with"))!;
    follow.focus();
    press(follow, "ArrowRight");
    const sub = document.querySelector<HTMLElement>(".action-submenu")!;
    expect(sub.style.display).toBe("block");
    expect(sub.contains(document.activeElement)).toBe(true);
    press(document.activeElement!, "ArrowLeft");
    expect(document.activeElement).toBe(follow);
    expect(sub.style.display).toBe("none");
    h.destroy();
  });

  it("the context-menu key opens the menu of the snippet holding the caret", () => {
    const { h, editor } = mount(THREE(), TEXTS);
    caretIn(h, "T3");
    expect(keydown(h, "ContextMenu")).toBe(true);
    expect(document.querySelector(".action-menu .action-head")?.textContent).toBe("Snippet");
    press(document.activeElement!, "Escape");
    expect(document.activeElement).toBe(editor.querySelector('.bubble[data-id="s3"] > .bubble-menu'));
    h.destroy();
  });
});

describe("5. the ⋯ menu's Add comment and Suggest rewrite", () => {
  it("are on a snippet's ⋯ and go to the host with the caret's line (else the first)", () => {
    const comments: string[] = [], suggestions: string[] = [];
    const blocks = [{ id: "blk_a", type: "block", name: "Main", children: [{ id: "s1", type: "snippet", beats: [{ id: "T1", kind: "text" }, { id: "T2", kind: "text" }] }] }] as unknown as Blocks;
    const { h, editor } = mount(blocks, TEXTS, { onComments: (r) => comments.push(r.nodeId), onSuggestions: (r) => suggestions.push(`${r.nodeId}:${r.create}`) });
    const open = (): void => { editor.querySelector('.bubble[data-id="s1"] > .bubble-menu')!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })); };
    h.view.dispatch(h.view.state.tr.setSelection(NodeSelection.create(h.view.state.doc, findByModelId(h.view.state.doc, "s1")!.pos)));
    open();
    expect(menuItems()).toContain("Add comment…");
    expect(menuItems()).toContain("Suggest rewrite…");
    click([...document.querySelectorAll(".action-mi")].find((b) => b.textContent === "Add comment…")!);
    expect(comments).toEqual(["T1"]);
    caretIn(h, "T2");
    open();
    click([...document.querySelectorAll(".action-mi")].find((b) => b.textContent === "Suggest rewrite…")!);
    expect(suggestions).toEqual(["T2:true"]);
    h.destroy();
  });

  it("aren't offered when the host has no comments or suggestions", () => {
    const { h, editor } = mount(THREE(), TEXTS);
    editor.querySelector('.bubble[data-id="s1"] > .bubble-menu')!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(menuItems()).not.toContain("Add comment…");
    expect(menuItems()).not.toContain("Suggest rewrite…");
    h.destroy();
  });
});

describe("6. the cast picker", () => {
  it("offers + Add only for name-like text", () => {
    expect(isNameLike("Old Tom")).toBe(true);
    expect(isNameLike("  the old man  ")).toBe(true);
    expect(isNameLike("the old grey man")).toBe(false);   // four words
    expect(isNameLike("Hello there.")).toBe(false);       // a full stop
    expect(isNameLike("Who")).toBe(true);
    expect(isNameLike("Who goes there?")).toBe(false);    // a question mark
    expect(isNameLike("   ")).toBe(false);
  });

  it("drops + Add from the popup for a sentence", () => {
    const blocks = [{ id: "blk_a", type: "block", name: "Main", children: [{ id: "s1", type: "snippet", beats: [{ id: "L1", kind: "line", character: "ANNA" }] }] }] as unknown as Blocks;
    const { h } = mount(blocks, { L1: "hi" }, { castSeed: ["ANNA"] });
    h.view.focus();
    let cue = -1; h.view.state.doc.descendants((n, p) => { if (cue < 0 && n.type.name === "cue") cue = p + 1; return cue < 0; });
    h.view.dispatch(h.view.state.tr.setSelection(TextSelection.create(h.view.state.doc, cue, cue + 4)));
    const addRow = (): string | null => [...document.querySelectorAll(".cue-ac")].at(-1)?.querySelector(".cue-ac-add")?.textContent ?? null;
    for (const c of "Bo") keydown(h, c);
    expect(addRow()).toBe('+ Add "BO"');
    for (const c of " is here.") keydown(h, c);
    expect(addRow()).toBeNull();
    h.destroy();
  });

  it("setCast replaces the list, so an undone add disappears", () => {
    const { h } = mount(THREE(), TEXTS, { castSeed: ["ANNA", "BO"] });
    expect(h.getCast()).toEqual(["BO", "ANNA"]);
    h.setCast(["ANNA", "anna", " TAM "]);
    expect(h.getCast()).toEqual(["ANNA", "TAM"]);
    h.destroy();
  });
});

describe("7. a deleted target", () => {
  it("a jump to one reads Missing block in the problem colour, the old id in the tooltip, and goes nowhere", () => {
    const blocks = [{ id: "blk_a", type: "block", name: "Main", children: [snip("s1", "T1", { jump: { to: "blk_gone" } }), snip("s2", "T2", { jump: { to: "scn_gone" } })] }] as unknown as Blocks;
    const followed: string[] = [];
    const { h, editor } = mount(blocks, TEXTS, { onOpenTarget: (id) => followed.push(id) });
    const chip = editor.querySelector<HTMLElement>('.bubble[data-id="s1"] .bubble-jump')!;
    expect(chip.textContent).toBe("Missing block");
    expect(chip.querySelector(".missing-target")).not.toBeNull();
    expect(chip.dataset.tip).toBe("Missing block. Its id was blk_gone.");
    expect(chip.classList.contains("is-missing")).toBe(true);
    chip.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    expect(followed).toEqual([]);
    expect(editor.querySelector('.bubble[data-id="s2"] .bubble-jump')?.textContent).toBe("Missing scene");
    h.destroy();
  });

  it("a condition naming one reads the same, and a jump to END or a live block doesn't", () => {
    const blocks = [{ id: "blk_a", type: "block", name: "Main", children: [
      snip("s1", "T1", { condition: "visits(blk_gone) > 0 && seen(blk_a)", jump: { to: "END" } }),
      snip("s2", "T2", { jump: { to: "blk_a" } }),
    ] }] as unknown as Blocks;
    const { h, editor } = mount(blocks, TEXTS);
    const cond = editor.querySelector('.bubble[data-id="s1"] .bubble-cond')!;
    expect(cond.textContent).toBe("if visits(Missing block) > 0 && seen(Main)");
    expect(cond.querySelector(".missing-target")?.getAttribute("data-tip")).toBe("Missing block. Its id was blk_gone.");
    expect(editor.querySelector('.bubble[data-id="s1"] .bubble-jump')?.textContent).toBe("END");
    expect(editor.querySelector('.bubble[data-id="s2"] .bubble-jump .missing-target')).toBeNull();
    h.destroy();
  });

  it("one label, chosen by the id", () => {
    expect(missingLabel("blk_x7q2")).toBe("Missing block");
    expect(missingLabel("scn_int")).toBe("Missing scene");
    expect(refText("seen(scn_int)", () => null)).toBe("seen(Missing scene)");
  });
});

describe("8. @gold on the page", () => {
  it("drops Patter's own scope and keeps every other", () => {
    expect(shortRefs("@patter.gold > 1 && @scene.mood == 'up' && @world.day > @patter.day")).toBe("@gold > 1 && @scene.mood == 'up' && @world.day > @day");
    expect(shortRefs("@gold + 1")).toBe("@gold + 1");
  });

  it("in a group's condition tag too", () => {
    const blocks = [{ id: "blk_a", type: "block", name: "Main", children: [
      { id: "g1", type: "group", condition: "@patter.met", children: [snip("s1", "T1")] },
    ] }] as unknown as Blocks;
    const { h, editor } = mount(blocks, TEXTS);
    expect(editor.querySelector(".group-rail-cond")?.textContent).toBe("if @met");
    h.destroy();
  });
});

describe("9. a renamed character keeps their colour on the page", () => {
  const spoken = (): Blocks => [{ id: "blk_a", type: "block", name: "Main", children: [
    { id: "s1", type: "snippet", beats: [{ id: "L1", kind: "line", character: "INNKEEPER" }] },
    snip("s2", "T2"),
  ] }] as unknown as Blocks;

  it("paints the cue in the stored slot, not the new name's hash", () => {
    expect(hashColour("BARKEEP")).not.toBe(hashColour("INNKEEPER"));
    const { h, editor } = mount(spoken(), { L1: "Evening.", T2: "two" }, { castColours: { INNKEEPER: hashColour("BARKEEP") } });
    expect(editor.querySelector<HTMLElement>(".cue-text")!.style.color).toBe(`var(--char-${hashColour("BARKEEP")})`);
    h.destroy();
  });

  it("setCastColours repaints the cues at once; without a slot the hash is back", () => {
    const { h, editor } = mount(spoken(), { L1: "Evening.", T2: "two" });
    const cue = (): string => editor.querySelector<HTMLElement>(".cue-text")!.style.color;
    expect(cue()).toBe(`var(--char-${hashColour("INNKEEPER")})`);
    h.setCastColours({ innkeeper: 3 }); // matched as cues are, ignoring case
    expect(cue()).toBe("var(--char-3)");
    expect(castColour("INNKEEPER")).toBe("var(--char-3)");
    h.setCastColours(undefined);
    expect(cue()).toBe(`var(--char-${hashColour("INNKEEPER")})`);
    h.destroy();
  });
});

describe("10. the lines a scene's or block's status reaches", () => {
  it("every line and text beat under the node, the whole scene for the scene's id", () => {
    const blocks = [
      { id: "blk_a", type: "block", name: "Main", children: [snip("s1", "T1"), snip("s2", "T2")] },
      { id: "blk_b", type: "block", name: "Later", children: [snip("s3", "T3")] },
    ] as unknown as Blocks;
    const { h } = mount(blocks, TEXTS);
    expect(h.statusBeats("blk_a")).toEqual(["T1", "T2"]);
    expect(h.statusBeats("scn")).toEqual(["T1", "T2", "T3"]);
    expect(h.statusBeats("blk_gone")).toEqual([]);
    h.destroy();
  });
});
