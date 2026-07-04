// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// The cast popup as a "field with dropdown": the cue is a TOKEN, not editable
// text. Typing filters a popup-owned buffer (never the document), picking replaces
// the speaker wholesale and advances to content, and a name not in the cast offers
// an explicit "Add" row that registers it. Driven through a real EditorView.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import type { Scene } from "@patterkit/model";
import { sceneToDoc } from "../src/bridge.js";
import { context } from "../src/context.js";
import { nodeViews } from "./views.js";
import { createCuePopup } from "./cuepopup.js";

const key = (k: string): KeyboardEvent => ({ key: k, preventDefault() {}, ctrlKey: false, metaKey: false, altKey: false } as unknown as KeyboardEvent);

function mount(cueText: string, cast: string[] = ["ANNA", "ANDREW", "BO"]) {
  const live = [...cast];
  const scene: Scene = {
    id: "s", type: "scene", name: "S", blocks: [
      { id: "b", type: "block", name: "M", children: [{ id: "sn", type: "snippet", beats: [{ id: "L1", kind: "line", character: cueText }] }] },
    ],
  };
  const doc = sceneToDoc(scene, { L1: "" });
  let cueStart = 0;
  doc.descendants((n, pos) => { if (n.type.name === "cue") { cueStart = pos + 1; return false; } return true; });
  const host = document.createElement("div"); document.body.appendChild(host);
  const popup = createCuePopup(() => live, (name) => { if (!live.includes(name)) live.unshift(name); });
  const view = new EditorView(host, {
    state: EditorState.create({ doc, selection: TextSelection.create(doc, cueStart, cueStart + cueText.length) }),
    nodeViews,
    handleKeyDown: (v, e) => popup.handleKeyDown(v, e),
  });
  view.focus(); // the popup only opens for a focused editor (dismisses on click-away)
  const myAc = () => [...document.querySelectorAll(".cue-ac")].at(-1)!; // each mount leaks one popup into the body
  const labels = () => [...myAc().querySelectorAll(".cue-ac-item")].map((b) => b.textContent);
  const addRow = () => myAc().querySelector(".cue-ac-add")?.textContent ?? null;
  const cueOf = () => { let t = ""; view.state.doc.descendants((n) => { if (n.type.name === "cue") { t = n.textContent; return false; } return true; }); return t; };
  return { view, popup, live, labels, addRow, cueOf, myAc };
}

describe("cast popup - field with dropdown", () => {
  it("opens on a cue with the full cast and an empty buffer", () => {
    const { view, popup, labels } = mount("ANNA");
    popup.update(view);
    expect(popup.isOpen()).toBe(true);
    expect(labels()).toEqual(["ANNA", "ANDREW", "BO"]);
    view.destroy();
  });

  it("typing filters the cast WITHOUT editing the cue text", () => {
    const { view, popup, labels, cueOf } = mount("ANNA");
    popup.update(view);
    popup.handleKeyDown(view, key("a"));
    popup.handleKeyDown(view, key("n"));
    expect(labels()).toEqual(["ANNA", "ANDREW"]); // prefix "an"
    expect(cueOf()).toBe("ANNA");                  // the document is untouched while filtering
    view.destroy();
  });

  it("offers an Add row for a name not in the cast", () => {
    const { view, popup, labels, addRow } = mount("ANNA");
    popup.update(view);
    "ZARA".split("").forEach((ch) => popup.handleKeyDown(view, key(ch)));
    expect(labels()).toEqual([]);          // nothing matches
    expect(addRow()).toBe('+ Add "ZARA"'); // explicit add
    view.destroy();
  });

  it("upper-cases a new character whatever the typed case, in the Add row and on commit", () => {
    const { view, popup, live, cueOf, addRow } = mount("ANNA");
    popup.update(view);
    "zara".split("").forEach((ch) => popup.handleKeyDown(view, key(ch)));
    expect(addRow()).toBe('+ Add "ZARA"'); // the row shows what will be stored
    popup.handleKeyDown(view, key("Enter"));
    expect(live).toContain("ZARA");        // registered in CAPITALS
    expect(live).not.toContain("zara");
    expect(cueOf()).toBe("ZARA");          // and the cue token is upper-cased too
    view.destroy();
  });

  it("picking with Tab replaces the speaker wholesale and advances to content", () => {
    const { view, popup, cueOf } = mount("ANNA");
    popup.update(view);
    popup.handleKeyDown(view, key("b")); // filter to BO
    popup.handleKeyDown(view, key("Tab"));
    expect(cueOf()).toBe("BO");
    expect(context(view.state).zone?.role).toBe("say");
    expect(popup.isOpen()).toBe(false);
    view.destroy();
  });

  it("Add registers the new character in the cast and assigns it", () => {
    const { view, popup, live, cueOf } = mount("ANNA");
    popup.update(view);
    "ZARA".split("").forEach((ch) => popup.handleKeyDown(view, key(ch)));
    popup.handleKeyDown(view, key("Enter")); // the add row is highlighted (only row)
    expect(live).toContain("ZARA"); // added to the project cast
    expect(cueOf()).toBe("ZARA");   // assigned to the line
    expect(context(view.state).zone?.role).toBe("say");
    view.destroy();
  });

  it("Escape keeps the current speaker and closes", () => {
    const { view, popup, cueOf } = mount("ANNA");
    popup.update(view);
    popup.handleKeyDown(view, key("b")); // would filter to BO
    popup.handleKeyDown(view, key("Escape"));
    expect(popup.isOpen()).toBe(false);
    expect(cueOf()).toBe("ANNA"); // unchanged
    view.destroy();
  });

  it("an empty-buffer Space falls through (free-text flip handled upstream)", () => {
    const { view, popup } = mount("ANNA");
    popup.update(view);
    expect(popup.handleKeyDown(view, key(" "))).toBe(false);
    expect(popup.isOpen()).toBe(false);
    view.destroy();
  });
});
