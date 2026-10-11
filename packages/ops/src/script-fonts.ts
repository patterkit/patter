// ---------------------------------------------------------------------------
// The faces the readable-script PDF embeds, read from the font packages ops depends on: Fontsource for
// Newsreader, Inter and Noto, and IBM's own release of Plex Mono (Plex is a Reserved Font Name, so the
// copyright holder's files rather than a third party's subset). Patter keeps no copies of its own;
// the family's rule is in patterkit's design/fonts.md.
//
// script-fonts.json lists each face as module paths, one file per Unicode subset, in the order a
// character tries them. It is JSON so the standalone CLI build can read the same list and embed the
// files. WOFF, never WOFF2: fontkit (under PDFKit) fails subsetting WOFF2 glyphs.
// ---------------------------------------------------------------------------

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import FACES from "./script-fonts.json" with { type: "json" };

/** A face the PDF export registers: the design's three roles, plus the two fallbacks every role shares. */
export type ScriptFace = keyof typeof FACES;

/** Each face's files, as module paths (`<package>/<file>`), in the order a character tries them. */
export const SCRIPT_FONT_FILES: Readonly<Record<ScriptFace, readonly string[]>> = FACES;

/** The packages the faces come from, each of which carries the licence its fonts travel under. */
export const SCRIPT_FONT_PACKAGES: readonly string[] = [
  ...new Set(Object.values(FACES).flat().map((spec) => spec.split("/").slice(0, spec.startsWith("@") ? 2 : 1).join("/"))),
];

const require = createRequire(import.meta.url);
let located: Readonly<Record<string, string>> = {};
let licences: Readonly<Record<string, string>> = {};
const cache = new Map<string, Buffer>();

/** Read the files from these paths, keyed by module path, instead of resolving them from node_modules;
 *  and the licences from `licencePaths`, keyed by package. For a bundle that embeds the files itself
 *  (the standalone CLI, Patterpad). */
export function useScriptFontFiles(paths: Readonly<Record<string, string>>, licencePaths: Readonly<Record<string, string>> = {}): void {
  located = { ...paths };
  licences = { ...licencePaths };
  cache.clear();
}

/** Where a font package's licence file is in node_modules (LICENSE, LICENSE.txt or OFL.txt). */
export function scriptFontLicencePath(pkg: string): string {
  const dir = (require.resolve.paths(pkg) ?? []).map((p) => join(p, pkg)).find((d) => existsSync(d));
  const file = dir && readdirSync(dir).find((f) => /^(licen[cs]e|ofl)/i.test(f));
  if (!dir || !file) throw new Error(`no licence file found for ${pkg}`);
  return join(dir, file);
}

/** Each font package's licence text, for a listing of what the PDF export embeds and under what terms. */
export function scriptFontLicences(): { package: string; text: string }[] {
  return SCRIPT_FONT_PACKAGES.map((pkg) => ({ package: pkg, text: readFileSync(licences[pkg] ?? scriptFontLicencePath(pkg), "utf8") }));
}

/** A face's font files, read on first use (a PDF export) and kept. */
export function scriptFontFiles(face: ScriptFace): Buffer[] {
  return FACES[face].map((spec) => {
    let bytes = cache.get(spec);
    if (!bytes) cache.set(spec, (bytes = readFileSync(located[spec] ?? require.resolve(spec))));
    return bytes;
  });
}
