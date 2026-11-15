// @vitest-environment jsdom
// The navigator keeps every scene's block list in the page, so the old one can fold shut while the new one
// opens. A closed list has no height, so its rows must not take focus or reach a screen reader: only the
// open scene's list is live.

import { describe, it, expect, beforeEach } from "vitest";
import { initNavTree, openNavScene, refreshNavBlocks, renderNav, type NavContext } from "./src/nav-tree.js";
import type { OpenedProject } from "../shared/api.js";

const scene = (id: string, blocks: string[]) => ({ id, name: id, blocks: blocks.map((b) => ({ id: b, name: b })) });

// jsdom has no CSS.escape; the ids here need no escaping.
(globalThis as { CSS?: { escape(s: string): string } }).CSS ??= { escape: (s) => s };

let current = "a";
let navListEl: HTMLElement;

beforeEach(() => {
  navListEl = document.createElement("div");
  document.body.replaceChildren(navListEl);
  const project = {
    scenes: [scene("a", ["intro", "menu"]), scene("b", ["intro", "menu", "work"])],
    sceneFolders: [],
    navRows: [{ kind: "scene", id: "a", depth: 0 }, { kind: "scene", id: "b", depth: 0 }],
  } as unknown as OpenedProject;
  const noop = (): void => {};
  initNavTree({
    project, get currentSceneId() { return current; }, patterProps: [], surface: null, navListEl,
    flipNav: (m) => m(), highlightNav: noop, loadScene: async () => {}, moveSceneBy: async () => {},
    newSceneNow: async () => {}, newScenePrompt: noop, openSearch: noop, paintNavBadges: noop,
    sceneContextMenu: noop, scheduleMoveState: noop, showPropertiesDoc: async () => {}, tracked: (p) => p,
  } as NavContext);
  renderNav();
});

const lists = (): Record<string, boolean> =>
  Object.fromEntries([...navListEl.querySelectorAll<HTMLElement>(".nav-scene")].map((s) =>
    [s.dataset["id"], s.querySelector<HTMLElement>(":scope > .nav-blocks")!.inert]));

describe("navigator block lists", () => {
  it("start inert, before any scene is opened", () => {
    expect(lists()).toEqual({ a: true, b: true });
  });

  it("only the open scene's list is live after switching scenes", () => {
    current = "a"; openNavScene("a"); refreshNavBlocks();
    current = "b"; openNavScene("b"); refreshNavBlocks();
    expect(lists()).toEqual({ a: true, b: false });
    // The old scene's rows are still drawn (so the list can fold shut), but sit inside an inert list.
    const oldRows = navListEl.querySelectorAll('.nav-scene[data-id="a"] .nav-block');
    expect(oldRows.length).toBe(2);
    expect([...oldRows].every((r) => r.closest<HTMLElement>(".nav-blocks")!.inert)).toBe(true);
    expect(navListEl.querySelector(".nav-scene.open")?.getAttribute("data-id")).toBe("b");
  });
});
