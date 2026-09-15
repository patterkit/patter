// @vitest-environment jsdom
// Select All with the focus in the scene title selected the whole window: the fallback was
// document.execCommand("selectAll"), which is not confined to the element. Found reproducing #73.

import { describe, it, expect, afterEach } from "vitest";
import { selectAllOutsideEditor } from "./src/edit-commands.js";

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
