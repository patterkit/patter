// ---------------------------------------------------------------------------
// The one compile of a loaded project, and where its bundle goes (spec §11).
// Export, validate and every analysis compile through `compileLoaded`, so what
// they reason about is what ships; every front end writes the bundle where
// `bundleOutputPath` says.
// ---------------------------------------------------------------------------

import { basename, extname, isAbsolute, resolve } from "node:path";
import { exportBundle } from "@patterkit/compiler";
import { isContentlessBeat } from "@patterkit/model";
import type { Bundle, Scene, Block, Group, Snippet } from "@patterkit/model";
import type { LoadedProject } from "./load.js";

/** Drop content-less beats - an empty bubble left behind only to carry a jump - from every snippet before
 *  we compile. Such a beat would render at runtime as a blank line that, lacking any localised string,
 *  falls back to emitting its raw id; a jump-only snippet should be `{ jump }` with no beats. This is a
 *  compile-time normalisation (the source files are untouched), keyed off the DEFAULT-locale strings to
 *  tell an empty beat from a written one. Returns the scenes to feed the compiler. */
function compileScenes(loaded: LoadedProject): Scene[] {
  const def = loaded.project.locales.default;
  const written = new Set<string>();
  for (const l of loaded.locales) if (l.locale === def) for (const [k, v] of Object.entries(l.strings)) if (v) written.add(k);
  const clean = (n: Group | Snippet): Group | Snippet => {
    if (n.type === "group") return { ...n, children: (n.children ?? []).map(clean) as (Group | Snippet)[] };
    if (!n.beats) return n;
    const kept = n.beats.filter((b) => !isContentlessBeat(b, written.has(b.id)));
    if (kept.length === n.beats.length) return n;
    const { beats, ...rest } = n;
    return kept.length ? { ...rest, beats: kept } : rest;
  };
  return loaded.scenes.map((s) => ({
    ...s, blocks: s.blocks.map((b: Block) => ({ ...b, children: b.children.map(clean) as (Group | Snippet)[] })),
  }));
}

/**
 * Compile a loaded project exactly as `export` does, with nothing refused: the one compile every analysis
 * uses (validate's staleness check, reachability, play, coverage). Five sites each compiled the project
 * themselves and had drifted from export: none stripped the contentless beats export strips, so one blank
 * line made a freshly exported bundle read as stale for ever, and coverage counted beats that never ship.
 */
export function compileLoaded(loaded: LoadedProject): Bundle {
  return exportBundle({ project: loaded.project, scenes: compileScenes(loaded), locales: loaded.locales, gameScopes: loaded.gameScopes?.merged });
}

/**
 * The default bundle location, relative to the project root, used when the project pins no
 * `export.bundle`: a SIBLING `patter-dist/` folder, not inside the project. On macOS the project folder is
 * a `.patter` package, and build output buried in the document is output nobody finds. One default for
 * every front end: the CLI wrote `dist/` inside the project while Patterpad wrote beside it, so a project
 * built in both had two bundles, and validate's staleness check never saw Patterpad's.
 */
export function defaultBundlePath(loaded: LoadedProject): string {
  return `../patter-dist/${basename(loaded.projectFile).replace(/\.patterproj$/, "")}.patterc`;
}

/**
 * The output path for the compiled bundle (spec §11): the project's `export.bundle` (relative to the
 * root, or absolute) if set, else `defaultBundlePath`. Where `patter export` and Patterpad's Build Bundle
 * write, and where validate's staleness check looks.
 */
export function bundleOutputPath(loaded: LoadedProject): string {
  const rel = loaded.project.export?.bundle ?? defaultBundlePath(loaded);
  return isAbsolute(rel) ? rel : resolve(loaded.root, rel);
}

/**
 * A file exported beside the bundle (the playable page, the screenplay): the bundle's path with `ext` in
 * place of its extension, whatever that is. Only a `.patterc` ending was ever swapped, so a bundle pinned
 * as `build/game.json` (what a Unity TextAsset wants) was overwritten by the HTML. Throws when the result
 * would be the bundle itself.
 */
export function besideBundlePath(loaded: LoadedProject, ext: string): string {
  const bundle = bundleOutputPath(loaded);
  const own = extname(bundle);
  const path = (own ? bundle.slice(0, -own.length) : bundle) + ext;
  if (path === bundle) throw new Error(`the ${ext} file would replace the bundle at ${bundle}; pass -o`);
  return path;
}
