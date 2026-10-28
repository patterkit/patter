// @vitest-environment jsdom
// The hands-on fixes review, step 6 (Q19, Q20), the surface's side: a rename can pin the scene's Game ID in
// the same edit, so one undo takes back both (storylet cards keep playing a renamed scene), and New Scene
// puts the caret in the new scene's title with all of it selected, so typing names it.
import { describe, it, expect, beforeEach } from "vitest";
import { parseSource } from "@patterkit/core";
import { mountSurface, type MountOptions } from "./surface.js";

function mount(extra: Partial<MountOptions> = {}) {
  const flow = `{
    schema: "patter/flow@0",
    scene: { id: "scn_x", type: "scene", name: "The Tavern", blocks: [
      { id: "start", type: "block", name: "Start", children: [ { id: "sn_a", type: "snippet", beats: [ { id: "T1", kind: "text" } ] } ] }
    ] }
  }`;
  const loc = `{ schema: "patter/strings@0", scene: "scn_x", locale: "en", default: true, strings: { T1: "hello" } }`;
  const editor = document.createElement("div"); document.body.appendChild(editor);
  (editor as unknown as { scrollTo: () => void }).scrollTo = () => undefined;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  return mountSurface({ editor, flowSource: flow, locSource: loc, showTitle: true, ...extra });
}

const sceneOf = (h: ReturnType<typeof mount>) => (parseSource(h.getSource().flow) as { scene: { name: string; gameId?: string } }).scene;

function rename(to: string): void {
  const title = document.querySelector<HTMLElement>(".scene-title")!;
  title.focus(); title.textContent = to; title.dispatchEvent(new Event("input")); title.blur();
}

describe("a rename that pins the Game ID", () => {
  beforeEach(() => { document.body.replaceChildren(); });

  it("asks the host with the scene as it is, and pins what it answers in the same edit", () => {
    const asked: unknown[] = [];
    const h = mount({ pinOnRename: (scene, next) => { asked.push([scene, next]); return "the-tavern"; } });
    rename("The Old Inn");
    expect(asked).toEqual([[{ id: "scn_x", name: "The Tavern" }, "The Old Inn"]]);
    expect(sceneOf(h)).toMatchObject({ name: "The Old Inn", gameId: "the-tavern" });
    h.undo();
    expect(sceneOf(h).name).toBe("The Tavern");
    expect(sceneOf(h).gameId).toBeUndefined();
  });

  it("renames only, when the host answers nothing", () => {
    const h = mount({ pinOnRename: () => undefined });
    rename("The Old Inn");
    expect(sceneOf(h).name).toBe("The Old Inn");
    expect(sceneOf(h).gameId).toBeUndefined();
  });
});

describe("focusTitle", () => {
  beforeEach(() => { document.body.replaceChildren(); });

  it("puts the caret in the title with all of it selected", () => {
    const h = mount();
    expect(h.focusTitle()).toBe(true);
    const title = document.querySelector<HTMLElement>(".scene-title")!;
    expect(document.activeElement).toBe(title);
    expect(window.getSelection()?.toString()).toBe("The Tavern");
  });

  it("says no when there's no title", () => {
    document.body.replaceChildren();
    const editor = document.createElement("div"); document.body.appendChild(editor);
    expect(mount({ showTitle: false }).focusTitle()).toBe(false);
  });
});
