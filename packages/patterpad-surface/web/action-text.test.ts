// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// Action text (patterkit design/proposals/action-text.md): in a dialogue scene, with the project's
// "Localise text lines in dialogue scenes" off, every text beat is drawn as action; an option's prompt
// never is, and the setting on (or a scene with no named speaker) draws it as shown text.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { mountSurface, type SurfaceHandle } from "./surface.js";
import flowSource from "../test/fixtures/tavern.patterflow?raw";
import locSource from "../test/fixtures/tavern.patterloc?raw";

function mount(localiseDialogueText?: boolean, flow = flowSource): { h: SurfaceHandle; isAction: (id: string) => boolean } {
  const editor = document.createElement("div");
  document.body.appendChild(editor);
  (editor as unknown as { scrollTo: () => void }).scrollTo = () => undefined; // jsdom has no layout
  Element.prototype.scrollIntoView ??= () => undefined;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  const h = mountSurface({ editor, flowSource: flow, locSource, localiseDialogueText });
  const isAction = (id: string): boolean => {
    let pos = -1;
    h.view.state.doc.descendants((n, p) => { if (pos < 0 && n.type.name === "prose" && n.attrs.id === id) { pos = p; return false; } return pos < 0; });
    return (h.view.nodeDOM(pos) as HTMLElement).classList.contains("kind-action");
  };
  return { h, isAction };
}

describe("action text", () => {
  it("draws a dialogue scene's text as action, and never an option's prompt", () => {
    const { h, isAction } = mount();
    expect(isAction("T_scene")).toBe(true);
    expect(isAction("T_work_lead")).toBe(true);
    expect(isAction("C_work")).toBe(false);
    h.destroy();
  });

  it("draws it as shown text when the project localises it, and follows the setting as it changes", () => {
    const { h, isAction } = mount(true);
    expect(isAction("T_scene")).toBe(false);
    h.setLocaliseDialogueText(false);
    expect(isAction("T_scene")).toBe(true);
    h.setLocaliseDialogueText(true);
    expect(isAction("T_scene")).toBe(false);
    h.destroy();
  });

  it("draws a scene with no named speaker as a text scene", () => {
    const noSpeakers = flowSource.replace(/character: "[A-Z_]+"/g, 'character: ""');
    const { h, isAction } = mount(false, noSpeakers);
    expect(isAction("T_scene")).toBe(false);
    h.destroy();
  });
});
