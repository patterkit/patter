// Text contrast in every palette Patterpad paints in (patterkit design/patterpad-text-contrast-2026-10.md). Since
// the October 2026 UI review the palettes are the family's, in app-shell's palette.css, and app-shell's own test
// holds them to AA; this one checks them as Patterpad loads them (the shell's palette, then theme.css), so
// nothing Patterpad adds can take a text token under AA, and that theme.css keeps no palette of its own.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  EDGE_CONTRAST, TEXT_CONTRAST, contrastShortfalls, themePalettes, withHighContrast,
} from "@wildwinter/app-shell/contrast";

const require = createRequire(import.meta.url);
const shared = readFileSync(require.resolve("@wildwinter/app-shell/palette.css"), "utf8");
const own = readFileSync(new URL("../web/theme.css", import.meta.url), "utf8");
const palettes = themePalettes(`${shared}\n${own}`);
const GROUNDS = ["--bg", "--surface", "--card"];
const TEXT = ["--ink", "--ink-read", "--ink-soft", "--muted", "--danger", "--warn", "--ok", "--accent"];
const fmt = (s: { palette: string; token: string; ground: string; ratio: number }): string =>
  `${s.palette} ${s.token} on ${s.ground}: ${s.ratio}`;

describe("text contrast", () => {
  it("paints in the family's palettes, and theme.css sets no colour of its own", () => {
    expect(Object.keys(palettes).sort()).toEqual(["dark", "default", "light", "parchment", "system-dark"]);
    expect(own).not.toMatch(/--(bg|surface|card|ink|muted|line|accent|danger|warn|ok|char-\d+)\s*:/);
    expect(contrastShortfalls(palettes, TEXT, GROUNDS, TEXT_CONTRAST).unresolved).toEqual([]);
  });

  it("passes AA for every text token on every ground", () => {
    expect(contrastShortfalls(palettes, TEXT, GROUNDS, TEXT_CONTRAST).shortfalls.map(fmt)).toEqual([]);
  });

  it("under Increase Contrast, grey text reaches 5:1 and edges 3:1", () => {
    const high = Object.fromEntries(Object.entries(palettes).map(([n, p]) => [n, withHighContrast(p)]));
    expect(contrastShortfalls(high, ["--muted"], GROUNDS, 5).shortfalls.map(fmt)).toEqual([]);
    expect(contrastShortfalls(high, ["--line"], GROUNDS, EDGE_CONTRAST).shortfalls.map(fmt)).toEqual([]);
  });
});
