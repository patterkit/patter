// ---------------------------------------------------------------------------
// Documentation routing + inheritance (spec §18). The shared resolver behind
// every documentation-consuming export (voice scripts, localisation handoff, a
// future SFX/art export): given an export CHANNEL, produce per-node the ordered
// notes that flow to it.
//
//   - A note's CLASS (`DocLine.type`) decides where it goes. A class delivers to
//     a set of channels (`DocumentationClass.deliver`), `"*"` = all. Untyped
//     notes are editor-only and never exported.
//   - Notes INHERIT down the tree: a class on a scene/block/group flows to the
//     lines inside it, OUTERMOST-FIRST (general context, then the line's own).
//
// The editor (Patterpad) shows everything; this routing governs exports only.
// ---------------------------------------------------------------------------

import { DEFAULT_DOCUMENTATION_CLASSES } from "@patterkit/model";
import type { DocLine, DocumentationClass, Group, Snippet } from "@patterkit/model";
import { mergeAuthoring } from "./loaded-helpers.js";
import type { LoadedProject } from "./load.js";

/** The class names whose notes deliver to `channel` (a class with `deliver: "*"` matches every channel). */
export function classesForChannel(classes: DocumentationClass[], channel: string): Set<string> {
  const out = new Set<string>();
  for (const c of classes) {
    if (c.deliver === "*" || (Array.isArray(c.deliver) && c.deliver.includes(channel))) out.add(c.name);
  }
  return out;
}

/**
 * Resolve documentation for an export `channel`: a map from node/beat id to the
 * ordered notes delivered there - ancestors outermost-first, then the node's own.
 * Only ids with at least one delivered note appear. Untyped notes are skipped
 * (editor-only).
 */
export function resolveDocumentation(loaded: LoadedProject, channel: string): Map<string, DocLine[]> {
  const classes = loaded.project.documentationClasses ?? DEFAULT_DOCUMENTATION_CLASSES;
  const allowed = classesForChannel(classes, channel);

  // Documentation merged across authoring shards (concat per id).
  const docsOf = mergeAuthoring(loaded).documentation;
  const own = (id: string): DocLine[] => (docsOf.get(id) ?? []).filter((l) => l.type !== undefined && allowed.has(l.type));

  const out = new Map<string, DocLine[]>();
  /** Store this node's resolved notes (own + inherited); return what its children inherit. */
  const visit = (id: string, inherited: DocLine[]): DocLine[] => {
    const mine = own(id);
    if (inherited.length === 0 && mine.length === 0) return inherited;
    const resolved = [...inherited, ...mine];
    out.set(id, resolved); // a line that only INHERITS a note still carries it
    return resolved;
  };

  const walkNode = (node: Group | Snippet, inherited: DocLine[]): void => {
    const passed = visit(node.id, inherited);
    if (node.type === "group") {
      if (node.prompt) visit(node.prompt.id, passed); // an option's prompt is localised content (spec §5)
      for (const child of node.children ?? []) walkNode(child, passed);
    } else {
      for (const beat of node.beats ?? []) visit(beat.id, passed);
    }
  };

  for (const scene of loaded.scenes) {
    const sceneInh = visit(scene.id, []);
    for (const block of scene.blocks) {
      const blockInh = visit(block.id, sceneInh);
      for (const child of block.children ?? []) walkNode(child, blockInh);
    }
  }
  return out;
}
