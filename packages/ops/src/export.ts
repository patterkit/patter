// ---------------------------------------------------------------------------
// The export op: compile a loaded project to the runtime bundle (spec §11).
// ---------------------------------------------------------------------------

import { basename, isAbsolute, join } from "node:path";
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

/** Compile a loaded project to the runtime bundle, applying its build localisation mode (spec §11):
 *  "embedded" (default) keeps every locale's strings inline; "ids" strips them so the runtime emits beat
 *  IDs (the game localises). `sourceDebug` keeps only the SOURCE locale, embedded for debug playback and
 *  flagged so the runtime warns it is not a shippable build. */
export function runExport(loaded: LoadedProject): Bundle {
  const { project, locales } = loaded;
  const full = exportBundle({ project, scenes: compileScenes(loaded), locales });
  const loc = project.export?.localisation;
  if (!loc || loc.mode === "embedded") return full;
  // "ids": drop all strings (sourceDebug keeps the source locale for debugging only).
  const strings = loc.sourceDebug ? { [full.locales.default]: full.strings[full.locales.default] ?? {} } : {};
  return { ...full, strings, localisation: { mode: "ids", ...(loc.sourceDebug ? { sourceDebug: true } : {}) } };
}

/** Compile WITHOUT the localisation-mode transform - the full bundle with every locale inline. Used where
 *  the host needs all strings regardless of build mode (e.g. Patterpad's Play window + Export Localisation). */
export function runExportFull(loaded: LoadedProject): Bundle {
  const { project, locales } = loaded;
  return exportBundle({ project, scenes: compileScenes(loaded), locales });
}

/**
 * The conventional output path for the compiled `.patterc` bundle (spec §11):
 * the project's `export.bundle` (relative to the root, or absolute) if set,
 * else `dist/<project-file-stem>.patterc`. This is where `patter export` writes
 * with no `-o`, and a stable place the staleness gate (validate) can find.
 */
export function bundleOutputPath(loaded: LoadedProject): string {
  const override = loaded.project.export?.bundle;
  if (override) return isAbsolute(override) ? override : join(loaded.root, override);
  const stem = basename(loaded.projectFile).replace(/\.patterproj$/, "");
  return join(loaded.root, "dist", `${stem}.patterc`);
}
