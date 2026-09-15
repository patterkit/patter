// @vitest-environment jsdom
// sceneName() answers the scene's CURRENT name. It returned the name the scene was opened with, so after
// a rename the renderer's Scenes-list sync (#73) copied the old name back, the topbar suffix kept showing
// it, and blanking the title restored it. Found by driving the fix live: the helpers under it were
// right, and this getter was frozen underneath them.
import { describe, it, expect, beforeEach } from "vitest";
import { mountSurface } from "./surface.js";

function mount() {
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
  return mountSurface({ editor, flowSource: flow, locSource: loc, showTitle: true });
}

describe("sceneName follows a rename", () => {
  // Each test mounts its own surface; clear the page between them so a title lookup finds THIS mount's.
  beforeEach(() => { document.body.replaceChildren(); });

  it("answers the opened name until the scene is renamed", () => {
    expect(mount().sceneName()).toBe("The Tavern");
  });

  it("answers the NEW name after setSceneName, not the one it was opened with", () => {
    const surface = mount();
    surface.setSceneName("The Renamed Tavern");
    expect(surface.sceneName()).toBe("The Renamed Tavern");
  });

  it("a second rename is followed too", () => {
    const surface = mount();
    surface.setSceneName("First");
    surface.setSceneName("Second");
    expect(surface.sceneName()).toBe("Second");
  });

  it("blanking the title after a rename restores the CURRENT name, not the original", () => {
    const surface = mount();
    surface.setSceneName("The Renamed Tavern");
    const title = document.querySelector<HTMLElement>(".scene-title")!;
    title.textContent = "   ";
    title.dispatchEvent(new FocusEvent("blur"));
    expect(title.textContent).toBe("The Renamed Tavern");
  });
});
