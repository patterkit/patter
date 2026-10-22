// Every window's page carries the family's content security policy (app-shell window-guard.ts `familyCsp`),
// with only the additions its page needs: a page added without one, or with a policy of its own, fails here
// (patterkit design/family-parity-2026-10.md item 12). Styles take 'unsafe-inline' because ProseMirror sets
// them; the faces may arrive inlined; the editor and the play window play recorded lines from blobs.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cspOfPage, familyCsp } from "@wildwinter/app-shell/window-guard";

const FONTS = { "font-src": ["data:"] };
const AUDIO = { ...FONTS, "media-src": ["blob:"] };
const EXPECTED: Record<string, string> = {
  "index.html": familyCsp(AUDIO),
  "play/index.html": familyCsp(AUDIO),
  "search/index.html": familyCsp(FONTS),
  "coverage/index.html": familyCsp(FONTS),
  "fields/index.html": familyCsp(FONTS),
  "extensions/index.html": familyCsp(FONTS),
};

describe("each window's content security policy", () => {
  it("covers every page the build makes", () => {
    const config = readFileSync(join(import.meta.dirname, "../../electron.vite.config.ts"), "utf8");
    const pages = [...config.matchAll(/packages\/patterpad\/src\/renderer\/([\w/]+\.html)/g)].map((m) => m[1]);
    expect(pages.sort()).toEqual(Object.keys(EXPECTED).sort());
  });
  for (const [page, csp] of Object.entries(EXPECTED)) {
    it(`${page} carries the family's policy`, () => {
      expect(cspOfPage(readFileSync(join(import.meta.dirname, page), "utf8"))).toBe(csp);
    });
  }
});
