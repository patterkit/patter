// @vitest-environment jsdom
// The snippet the caret is in is marked `.has-caret` (the October 2026 UI review, step 6): on the page its
// rule takes the accent, and CSS alone can't find it, since the focused element is the whole editor.
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mountSurface } from "./surface.js";

// jsdom's import.meta.url isn't a file URL: the root runs the tests, as view.test.ts reads its fixture.
const root = resolve(process.cwd(), "packages/patterpad-surface/test/fixtures") + "/";
const file = (p: string): string => readFileSync(root + p, "utf8");

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  (HTMLElement.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
});

describe("the caret's snippet", () => {
  it("is the one snippet marked, and moves with the caret", () => {
    const editor = document.createElement("div"); document.body.appendChild(editor);
    (editor as unknown as { scrollTo: () => void }).scrollTo = () => undefined;
    const s = mountSurface({ editor, flowSource: file("tavern.patterflow"), locSource: file("tavern.patterloc") });
    const marked = (): string[] => [...editor.querySelectorAll(".bubble.has-caret")].map((b) => (b as HTMLElement).dataset.id ?? "");
    s.revealNode("L_greet", { instant: true });
    expect(marked()).toEqual(["sn_intro_greet"]);
    s.revealNode("T_work_lead", { instant: true }); // inside an option
    expect(marked()).toEqual(["sn_opt_work"]);
  });
});
