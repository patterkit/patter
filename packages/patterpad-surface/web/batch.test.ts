// @vitest-environment jsdom
// The surface's batch (the October 2026 UI review, 3-composition.md proposal 10): the inspector's edits to a
// multi-selection write each chunk, and the author made ONE edit, so they undo as one step.
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mountSurface } from "./surface.js";

// jsdom's import.meta.url isn't a file URL: the root runs the tests, as view.test.ts reads its fixture.
const root = resolve(process.cwd(), "packages/ops/test/fixtures/probe-extension.patter") + "/";
const file = (p: string): string => readFileSync(root + p, "utf8");

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  (HTMLElement.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
});

function mount() {
  const editor = document.createElement("div"); document.body.appendChild(editor);
  (editor as unknown as { scrollTo: () => void }).scrollTo = () => undefined;
  return mountSurface({ editor, flowSource: file("scenes/harbour.patterflow"), locSource: file("loc/en/harbour.patterloc") });
}

describe("the surface's batch", () => {
  it("records every edit inside it as one undo step, and undoes them together", () => {
    const s = mount();
    const before = s.getSource().flow;
    const depth = s.undoDepth();
    s.batch(() => {
      expect(s.setTags("L_bell", ["night"])).toBe(true);
      expect(s.setTags("L_reply", ["night"])).toBe(true);
    });
    expect(s.undoDepth()).toBe(depth + 1);
    expect(s.getSource().flow).not.toBe(before);
    s.undo();
    expect(s.getSource().flow).toBe(before); // both tags gone in the one undo
  });
});
