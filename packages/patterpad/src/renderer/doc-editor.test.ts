// @vitest-environment jsdom
// The Notes editor's class vocabulary (#148 notes revision): which documentation classes it OFFERS is
// driven by the `classes` it's handed (the renderer pre-filters by node kind - no VO on a text/action
// beat, no loc on action). An EXISTING note of a class no longer addable here must still render (no loss).

import { describe, it, expect } from "vitest";
import { mountDocEditor } from "./src/doc-editor.js";
import type { DocLine, DocumentationClass } from "@patterkit/model";

const host = (): HTMLElement => document.createElement("div");
const cls = (...names: string[]): DocumentationClass[] => names.map((name) => ({ name }));
const addable = (h: HTMLElement): string[] =>
  [...h.querySelectorAll(".doc-add option")].map((o) => o.textContent ?? "").filter((t) => t !== "+ add a note for…");
const blocks = (h: HTMLElement): string[] => [...h.querySelectorAll(".doc-class-label")].map((e) => e.textContent ?? "");

const mount = (classes: DocumentationClass[], lines: DocLine[] = []): HTMLElement => {
  const h = host();
  mountDocEditor(h, { classes, lines, onChange: () => {} });
  return h;
};

describe("mountDocEditor: class vocabulary by node kind", () => {
  it("a dialogue line offers Voice + Localisers (everyone / vo / loc)", () => {
    expect(addable(mount(cls("everyone", "vo", "loc")))).toEqual(["Voice (VO)", "Localisers", "Note (editor-only)"]);
  });

  it("a text/prose beat omits Voice (everyone / loc only)", () => {
    const a = addable(mount(cls("everyone", "loc")));
    expect(a).toContain("Localisers");
    expect(a).not.toContain("Voice (VO)");
  });

  it("an action beat offers only everyone (+ editor-only)", () => {
    expect(addable(mount(cls("everyone")))).toEqual(["Note (editor-only)"]);
  });

  it("still shows an existing note of a class no longer addable here (no data loss)", () => {
    // a prose beat (Voice not addable) that already carries a vo note
    const h = mount(cls("everyone", "loc"), [{ type: "vo", text: "weary" }]);
    expect(blocks(h)).toContain("Voice (VO)");   // the existing block renders
    expect(addable(h)).not.toContain("Voice (VO)"); // but you can't add another here
  });
});
