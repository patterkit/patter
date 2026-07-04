// ---------------------------------------------------------------------------
// Live bundle refresh (design/proposals/live-bundle-refresh.md) - the game-side
// applier. The editor pushes a freshly compiled bundle over the debug link
// (createDebugLink's `onBundle`); this helper picks the right tier and applies
// it:
//   - same structureHash  -> tier 1: engine.replaceStrings() - nothing restarts.
//   - changed structure   -> tier 2: engine.hotSwap() - the run carried over,
//                            content drift resolved by the save system (§9.8).
// Returns the engine to keep using (the SAME one for "text", a REPLACEMENT for
// "structure" - re-bind your Flow handles via engine.getFlow(id)) plus the
// parsed bundle for the next comparison. Wire-up:
//
//   let { engine, bundle } = boot();
//   const link = createDebugLink({
//     build: bundle.content.hash!,
//     onBundle: ({ build, data }) => {
//       const r = applyLiveBundle(engine, bundle, data);
//       engine = r.engine; bundle = r.bundle;
//       if (r.kind === "structure") flow = engine.getFlow("main")!;
//       link.setBuild(build);
//     },
//   });
// ---------------------------------------------------------------------------

import { Engine } from "@patterkit/runtime";
import type { Bundle } from "@patterkit/runtime";

export interface LiveBundleResult {
  /** The engine to keep using: the same instance for a "text" swap, a replacement for "structure". */
  engine: Engine;
  /** The parsed pushed bundle - hold on to it for the next apply's comparison. */
  bundle: Bundle;
  /** Which tier applied: "text" (strings-only, nothing restarted) or "structure" (full hot swap). */
  kind: "text" | "structure";
}

/**
 * Apply a bundle the editor pushed over the debug link. `current` is the bundle `engine` is running
 * (needed for the structure-hash comparison); `data` is the pushed .patterc JSON. Throws only on
 * unparseable JSON - a structural swap's edge cases are absorbed by the §9.8 drift policy inside
 * `hotSwap`, which never throws for ordinary edits.
 */
export function applyLiveBundle(engine: Engine, current: Bundle, data: string): LiveBundleResult {
  const next = JSON.parse(data) as Bundle;
  // Same structure = a text-only edit: swap the string tables in place and keep everything running.
  // Missing structureHash on either side (an older compiler) falls through to the full swap - safe,
  // just less gentle than it could be.
  const sameStructure = current.content.structureHash !== undefined
    && current.content.structureHash === next.content.structureHash;
  if (sameStructure) {
    engine.replaceStrings(next);
    return { engine, bundle: next, kind: "text" };
  }
  return { engine: engine.hotSwap(next), bundle: next, kind: "structure" };
}
