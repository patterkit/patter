// @vitest-environment jsdom
// Select All with the focus in the scene title selected the whole window: the fallback was
// document.execCommand("selectAll"), which is not confined to the element. Found reproducing #73.

import { describe, it, expect, afterEach } from "vitest";
import { selectAllOutsideEditor, undoRoute } from "./src/edit-commands.js";

afterEach(() => { document.body.replaceChildren(); window.getSelection()?.removeAllRanges(); });

/** The window around a scene title: chrome text, the title, and the script editor beside it. */
const page = () => {
  const chrome = document.createElement("div"); chrome.textContent = "Scenes list, topbar, inspector";
  const title = document.createElement("div"); title.className = "scene-title";
  title.setAttribute("contenteditable", "plaintext-only"); title.textContent = "The Tavern";
  const editor = document.createElement("div"); editor.className = "ProseMirror";
  editor.setAttribute("contenteditable", "true"); editor.textContent = "The whole script";
  document.body.append(chrome, title, editor);
  return { title, editor };
};

describe("Select All outside the script editor", () => {
  it("in the scene title, selects the title's text and nothing around it", () => {
    const { title, editor } = page();
    expect(selectAllOutsideEditor(title, editor)).toBe(true);
    expect(String(window.getSelection())).toBe("The Tavern");
  });

  it("in an input, selects that input's value, as before", () => {
    const { editor } = page();
    const input = document.createElement("input"); input.value = "gold"; document.body.append(input);
    expect(selectAllOutsideEditor(input, editor)).toBe(true);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 4]);
  });

  it("leaves the script editor to its own rule (the caller's beat-level Select All)", () => {
    const { editor } = page();
    expect(selectAllOutsideEditor(editor, editor)).toBe(false);
  });

  it("is not ours when nothing editable has the focus", () => {
    const { editor } = page();
    const plain = document.createElement("div"); plain.textContent = "not editable"; document.body.append(plain);
    expect(selectAllOutsideEditor(plain, editor)).toBe(false);
    expect(selectAllOutsideEditor(null, editor)).toBe(false);
  });

  it("an element marked contenteditable=\"false\" is not an editable field", () => {
    const { editor } = page();
    const off = document.createElement("div"); off.setAttribute("contenteditable", "false"); off.textContent = "x";
    document.body.append(off);
    expect(selectAllOutsideEditor(off, editor)).toBe(false);
  });
});

// Edit ▸ Undo went straight to the scene's history whatever had the focus, so Cmd+Z in Project Settings, a
// dialog or on the Properties page undid the scene hidden behind them, and on the Properties page that undone
// edit was never saved (patterkit design/patterpad-undo.md, "Where Cmd+Z goes"). With the project history,
// everywhere else goes to the journal, and the Properties page, whose saves are project steps, to its steps.
describe("where Undo goes in the main window", () => {
  const workspace = () => {
    const editor = document.createElement("div");
    const script = document.createElement("div"); script.setAttribute("contenteditable", "true");
    const title = document.createElement("div"); title.setAttribute("contenteditable", "plaintext-only");
    editor.append(title, script);
    const inspector = document.createElement("div");
    const gameData = document.createElement("input"); inspector.append(gameData);
    const props = document.createElement("div");
    const propName = document.createElement("input"); props.append(propName);
    const settings = document.createElement("input");
    document.body.append(editor, inspector, props, settings);
    return { editor, script, title, inspector, gameData, propName, settings, sceneAreas: [editor, inspector] };
  };

  it("goes to the journal from the script, its title and the inspector's fields", () => {
    const w = workspace();
    for (const active of [w.script, w.title, w.gameData, document.body]) {
      expect(undoRoute({ active, sceneAreas: w.sceneAreas, dialogOpen: false, view: "scene" })).toBe("journal");
    }
  });

  it("is the field's own text undo in a field outside the scene, and anywhere while a dialog is open", () => {
    const w = workspace();
    expect(undoRoute({ active: w.settings, sceneAreas: w.sceneAreas, dialogOpen: false, view: "scene" })).toBe("field");
    expect(undoRoute({ active: w.script, sceneAreas: w.sceneAreas, dialogOpen: true, view: "scene" })).toBe("field");
    expect(undoRoute({ active: document.body, sceneAreas: w.sceneAreas, dialogOpen: true, view: "properties" })).toBe("field");
  });

  it("on the Properties page, undoes the field in focus, else the page's newest project step, never the scene behind", () => {
    const w = workspace();
    expect(undoRoute({ active: w.propName, sceneAreas: w.sceneAreas, dialogOpen: false, view: "properties" })).toBe("field");
    expect(undoRoute({ active: document.body, sceneAreas: w.sceneAreas, dialogOpen: false, view: "properties" })).toBe("project");
  });

  it("from the overview, goes to the journal (whose scene entry shows its scene first)", () => {
    const w = workspace();
    expect(undoRoute({ active: document.body, sceneAreas: w.sceneAreas, dialogOpen: false, view: "overview" })).toBe("journal");
  });

  it("does nothing with no project open", () => {
    const w = workspace();
    expect(undoRoute({ active: document.body, sceneAreas: w.sceneAreas, dialogOpen: false, view: "none" })).toBe("none");
  });
});
