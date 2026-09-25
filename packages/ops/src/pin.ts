// ---------------------------------------------------------------------------
// Pin on publish: every scene and block whose Game ID still follows its name gets
// that address written down, unchanged, so a later rename no longer moves a name
// the game (or a storylet card, which addresses its scene by the same name) may
// now rely on. Decided with Storyletter, which does the same for its items; the
// record is design/pin-on-publish.md in storylet-studio.
//
// Patterpad's Build Bundle calls this; Auto Rebuild, the live bundle push and the
// CLI's export never do. Pinning at creation would freeze `new-scene` before the
// author has named it, which is why the moment is publish: the first time the
// name leaves the project.
//
// A name that slugs to nothing ("???") has no address to pin, and is left for the
// validator, which already refuses it.
//
// Pure apart from reading each touched flow shard, as `runFormat` does: returns
// what it pinned (for the toast), the planned flow-shard writes, and the rewritten
// scenes (index-aligned with `writes`) so the caller can swap them into its
// in-memory `LoadedProject.scenes`. The value written is the address each node
// already had, so the bundle's names do not change.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { canonicalStringify, parseSource } from "@patterkit/core";
import { effectiveGameId, gameIdify } from "@patterkit/model";
import type { Block, FlowFile, Scene } from "@patterkit/model";
import type { LoadedProject } from "./load.js";
import type { PlannedWrite } from "./write.js";

/** One address written down. */
export interface PinnedName {
  /** The node's immutable id. */
  id: string;
  kind: "scene" | "block";
  /** The scene it belongs to (itself, for a scene). */
  sceneId: string;
  /** The address, now pinned: the same one it had while it followed the name. */
  gameId: string;
}

export interface PinPlan {
  pinned: PinnedName[];
  /** Flow-shard writes the caller commits through the VC layer (one per touched scene). */
  writes: PlannedWrite[];
  /** The rewritten scenes, index-aligned with `writes`. */
  scenes: Scene[];
}

/** The address to pin, or undefined when it is already pinned or the name slugs to nothing. */
function toPin(node: { gameId?: string; name: string }): string | undefined {
  if (node.gameId?.trim()) return undefined;
  if (!gameIdify(node.name)) return undefined;
  return effectiveGameId(node);
}

/** Plan pinning every scene and block address still following its name. */
export function planPins(loaded: LoadedProject): PinPlan {
  const plan: PinPlan = { pinned: [], writes: [], scenes: [] };
  for (const scene of loaded.scenes) {
    const path = loaded.sceneFiles[scene.id];
    if (!path) continue;
    let changed = false;
    const sceneGameId = toPin(scene);
    if (sceneGameId !== undefined) {
      plan.pinned.push({ id: scene.id, kind: "scene", sceneId: scene.id, gameId: sceneGameId });
      changed = true;
    }
    const blocks = scene.blocks.map((block): Block => {
      const gameId = toPin(block);
      if (gameId === undefined) return block;
      plan.pinned.push({ id: block.id, kind: "block", sceneId: scene.id, gameId });
      changed = true;
      return { ...block, gameId };
    });
    if (!changed) continue;
    const next: Scene = { ...scene, ...(sceneGameId !== undefined ? { gameId: sceneGameId } : {}), blocks };
    // The shard's own envelope (its schema), with the scene swapped: the same bytes Patterpad's save writes.
    const file = parseSource(readFileSync(path, "utf8")) as FlowFile;
    plan.writes.push({ path, content: canonicalStringify({ ...file, scene: next }) });
    plan.scenes.push(next);
  }
  return plan;
}
