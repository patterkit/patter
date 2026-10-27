// @vitest-environment jsdom
// Coming back to a scene (the October 2026 UI review, behaviour change 3): the host keeps the editor state
// it left and hands it back, so the document, the caret and the undo history are as they were, A, B, A.
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

const editor = (): HTMLElement => {
  const el = document.createElement("div"); document.body.appendChild(el);
  (el as unknown as { scrollTo: () => void }).scrollTo = () => undefined;
  return el;
};

describe("a kept editor state", () => {
  it("comes back with its edits and its undo history, and the undo still works", () => {
    const flowSource = file("scenes/harbour.patterflow"), locSource = file("loc/en/harbour.patterloc");
    const host = editor();
    const a = mountSurface({ editor: host, flowSource, locSource });
    const original = a.getSource().flow;
    expect(a.setTags("L_bell", ["night"])).toBe(true);
    const edited = a.getSource();
    const kept = a.exportState();
    a.destroy();

    // The host wrote `edited` on the way out, so that's what the files hold when it comes back.
    const back = mountSurface({ editor: host, flowSource: edited.flow, locSource: edited.loc, restoreState: kept });
    expect(back.getSource().flow).toBe(edited.flow);
    expect(back.undoDepth()).toBe(1);
    expect(back.undo()).toBe(true);
    expect(back.getSource().flow).toBe(original);
  });

  it("opens fresh without one: no history", () => {
    const s = mountSurface({ editor: editor(), flowSource: file("scenes/harbour.patterflow"), locSource: file("loc/en/harbour.patterloc") });
    expect(s.undoDepth()).toBe(0);
  });
});
