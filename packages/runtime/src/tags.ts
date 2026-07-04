// ---------------------------------------------------------------------------
// Author tags (#215): a cross-cutting label layer baked into the bundle.
//
// A node's *accumulated* tags are the union of its own and every ancestor's,
// ordered outermost-first (scene → block → group(s) → snippet → beat) and
// deduped. That accumulation is purely structural, it depends only on where a
// node sits in the tree, not on play state, so it's precomputed ONCE at engine
// load into a flat `id -> string[]` index and read back as O(1) lookups for both
// the delivered step `tags` and the `tagsFor*` accessors.
// ---------------------------------------------------------------------------

import type { Bundle, CompiledGroup, CompiledSnippet } from "@patterkit/model";

function dedupe(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) if (!seen.has(t)) { seen.add(t); out.push(t); }
  return out;
}

/**
 * Map every node id (scene / block / group / snippet / beat) to its accumulated
 * tags. Node ids are globally unique within a project (the validator enforces
 * it), so one flat map suffices. Nodes with no tags anywhere up the chain map to
 * an empty array.
 */
export function buildTagIndex(bundle: Bundle): Map<string, string[]> {
  const index = new Map<string, string[]>();

  const visit = (node: CompiledGroup | CompiledSnippet, inherited: string[]): void => {
    const acc = dedupe([...inherited, ...(node.tags ?? [])]);
    index.set(node.id, acc);
    if (node.type === "group") {
      for (const child of node.children) visit(child, acc);
    } else {
      for (const beat of node.beats ?? []) index.set(beat.id, dedupe([...acc, ...(beat.tags ?? [])]));
    }
  };

  for (const scene of Object.values(bundle.scenes)) {
    const sceneAcc = dedupe(scene.tags ?? []);
    index.set(scene.id, sceneAcc);
    for (const block of scene.blocks) {
      const blockAcc = dedupe([...sceneAcc, ...(block.tags ?? [])]);
      index.set(block.id, blockAcc);
      for (const child of block.children) visit(child, blockAcc);
    }
  }

  return index;
}
