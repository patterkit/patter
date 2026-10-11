// ---------------------------------------------------------------------------
// The PDF export's fonts come from upstream packages (Fontsource, IBM's Plex), listed file by file in
// script-fonts.json. A package update that renames or drops a subset file would otherwise surface only
// as a failed PDF export, so pin that every listed file resolves and is a WOFF (never WOFF2: fontkit
// can't subset those), and that the chains still cover the marks the layout draws.
// ---------------------------------------------------------------------------

import { describe, it, expect, afterEach } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SCRIPT_FONT_FILES, SCRIPT_FONT_PACKAGES, scriptFontFiles, scriptFontLicences, useScriptFontFiles, type ScriptFace } from "../src/script-fonts.js";

const require = createRequire(import.meta.url);
const fontkit = require("fontkit") as { create(b: Buffer): { hasGlyphForCodePoint(cp: number): boolean } };
const faces = Object.keys(SCRIPT_FONT_FILES) as ScriptFace[];

afterEach(() => useScriptFontFiles({}));

describe("the script PDF fonts", () => {
  it("resolves every listed file to a WOFF", () => {
    for (const face of faces) {
      const files = scriptFontFiles(face);
      expect(files.length, face).toBe(SCRIPT_FONT_FILES[face].length);
      for (const bytes of files) expect(bytes.subarray(0, 4).toString("latin1"), face).toBe("wOFF");
    }
  });

  it("covers the layout's marks, Greek, Cyrillic and emoji somewhere in the chains", () => {
    const fonts = (face: ScriptFace) => scriptFontFiles(face).map((b) => fontkit.create(b));
    const serifChain = [...fonts("serif"), ...fonts("fallback")];
    const covered = (chain: ReturnType<typeof fonts>, ch: string) => chain.some((f) => f.hasGlyphForCodePoint(ch.codePointAt(0)!));
    for (const ch of ["◇", "↪", "‹", "›", "→", "∑", "α", "ж", "é", "ŵ"]) expect(covered(serifChain, ch), ch).toBe(true);
    for (const ch of ["⚙", "😀", "🎭"]) expect(covered(fonts("emoji"), ch), ch).toBe(true);
  });

  it("finds each font package's licence, from node_modules or where a bundle put it", () => {
    expect(SCRIPT_FONT_PACKAGES).toContain("@ibm/plex-mono");
    const all = scriptFontLicences();
    expect(all.map((l) => l.package)).toEqual([...SCRIPT_FONT_PACKAGES]);
    for (const { text } of all) expect(text).toMatch(/open font license/i);
    const elsewhere = join(mkdtempSync(join(tmpdir(), "script-fonts-")), "LICENSE");
    writeFileSync(elsewhere, "embedded licence");
    useScriptFontFiles({}, { "@ibm/plex-mono": elsewhere });
    expect(scriptFontLicences().find((l) => l.package === "@ibm/plex-mono")!.text).toBe("embedded licence");
  });

  it("reads a file from the path a bundle hands it", () => {
    const spec = SCRIPT_FONT_FILES.mono[0]!;
    const elsewhere = join(mkdtempSync(join(tmpdir(), "script-fonts-")), "mono.woff");
    writeFileSync(elsewhere, "not really a font");
    scriptFontFiles("mono"); // cached from node_modules first
    useScriptFontFiles({ [spec]: elsewhere });
    expect(scriptFontFiles("mono")[0]!.toString()).toBe("not really a font");
  });
});
