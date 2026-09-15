// @vitest-environment jsdom
// #73: a renamed scene kept its old name in the Scenes list (and everywhere else reading the renderer's
// copy of the project) until a restart. The rename is now written back into that copy, and the row
// already on screen is relabelled.

import { describe, it, expect } from "vitest";
import { adoptSceneName, relabelNavScene } from "./src/scene-name.js";

const project = () => ({ scenes: [{ id: "s1", name: "The Tavern" }, { id: "s2", name: "Street" }] });

describe("adoptSceneName writes a rename into the project copy", () => {
  it("renames the one scene, and says it changed something", () => {
    const p = project();
    expect(adoptSceneName(p, "s1", "The Renamed Tavern")).toBe(true);
    expect(p.scenes.map((s) => s.name)).toEqual(["The Renamed Tavern", "Street"]);
  });

  it("reports no change when the name is already current, so nothing repaints on every keystroke", () => {
    expect(adoptSceneName(project(), "s1", "The Tavern")).toBe(false);
  });

  it("trims, and ignores a blank name (the title restores the old one itself)", () => {
    const p = project();
    expect(adoptSceneName(p, "s1", "  Spaced  ")).toBe(true);
    expect(p.scenes[0]!.name).toBe("Spaced");
    expect(adoptSceneName(p, "s1", "   ")).toBe(false);
    expect(p.scenes[0]!.name).toBe("Spaced");
  });

  it("does nothing without a project, a scene id, or a scene by that id", () => {
    expect(adoptSceneName(null, "s1", "X")).toBe(false);
    expect(adoptSceneName(project(), null, "X")).toBe(false);
    expect(adoptSceneName(project(), "nope", "X")).toBe(false);
  });
});

describe("relabelNavScene changes that scene's row label and nothing else", () => {
  /** The Scenes list's real shape (renderer.ts renderNav + refreshNavBlocks): a scene row holding its
   *  own button, then its block rows, which use the same label class. */
  const nav = (): HTMLElement => {
    const list = document.createElement("div");
    for (const [id, name, blocks] of [["s1", "The Tavern", ["Intro", "Menu"]], ["s2", "Street", ["Corner"]]] as const) {
      const row = document.createElement("div"); row.className = "nav-scene"; row.dataset["id"] = id;
      const btn = document.createElement("button"); btn.className = "nav-item"; btn.dataset["id"] = id;
      const label = document.createElement("span"); label.className = "nav-item-name"; label.textContent = name;
      btn.append(label);
      const inner = document.createElement("div"); inner.className = "nav-blocks-inner";
      for (const b of blocks) {
        const bb = document.createElement("button"); bb.className = "nav-block";
        const bl = document.createElement("span"); bl.className = "nav-item-name"; bl.textContent = b;
        bb.append(bl); inner.append(bb);
      }
      row.append(btn, inner);
      list.append(row);
    }
    return list;
  };
  const labels = (list: HTMLElement): string[] => [...list.querySelectorAll(".nav-item-name")].map((e) => e.textContent ?? "");

  it("relabels the scene, leaving its blocks and the other scene as they were", () => {
    const list = nav();
    relabelNavScene(list, "s1", "The Renamed Tavern");
    expect(labels(list)).toEqual(["The Renamed Tavern", "Intro", "Menu", "Street", "Corner"]);
  });

  it("is a no-op for a scene the list does not show", () => {
    const list = nav();
    relabelNavScene(list, "nope", "X");
    expect(labels(list)).toEqual(["The Tavern", "Intro", "Menu", "Street", "Corner"]);
  });
});
