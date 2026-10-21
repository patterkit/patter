// ---------------------------------------------------------------------------
// Patter extensions as the editor is told them (patterkit design/proposals/
// patter-storylet-extensions.md, "Tier 1: fields"): each extension the project
// takes and has a sound manifest for, its declarations by node kind, and the
// project's own values. An extension whose manifest is missing or broken is left
// out: its data is untouched, and validation says why.
//
// Pure: main hands in the manifests and the project-level shards it read from
// disk, so the summary works before the rest of the project has been read.
// ---------------------------------------------------------------------------

import { missingRequirements, viewsFor } from "@wildwinter/toolkit/extensions";
import type { Manifest } from "@wildwinter/toolkit/extensions";
import type { Beat, Group, ProjectFile, Scene, Snippet } from "@patterkit/model";
import type { ExtensionDto, ExtensionFieldDto, ExtensionNodeDto, ExtensionTargetDto } from "./api.js";

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The extensions the editor draws: one for each the project takes whose manifest is sound (`manifests`, by
 * id), in id order, with the project's own values from its `_project.patterextension` (`projectShards`, the
 * parsed shard by extension id). Undefined when there are none.
 */
export function extensionDtos(
  project: ProjectFile,
  manifests: ReadonlyMap<string, Manifest>,
  projectShards: ReadonlyMap<string, unknown> = new Map(),
): ExtensionDto[] | undefined {
  const taken = project.extensions ?? {};
  const projectNode = project.project.id;
  const out: ExtensionDto[] = [];
  for (const id of Object.keys(taken).sort()) {
    const manifest = manifests.get(id);
    if (manifest === undefined) continue;
    const pin = taken[id];
    const targets: Record<string, ExtensionTargetDto> = {};
    for (const [kind, target] of Object.entries(manifest.targets.patter ?? {})) {
      targets[kind] = { fields: (target.fields ?? []) as unknown as ExtensionFieldDto[] };
    }
    const shard = projectShards.get(id);
    const entries = isObject(shard) && isObject(shard["entries"]) ? shard["entries"] : undefined;
    const byNode = entries && isObject(entries["project"]) ? entries["project"] : undefined;
    const projectValues = byNode && isObject(byNode[projectNode]) ? byNode[projectNode] : undefined;
    out.push({
      id, name: manifest.name, version: manifest.version, ...(manifest.docs ? { docs: manifest.docs } : {}),
      taken: pin?.version ?? "",
      targets, projectNode,
      ...(projectValues && Object.keys(projectValues).length ? { projectValues: { ...projectValues } } : {}),
      ...viewFacts(manifest),
      ...missingFacts(manifest, Object.keys(taken)),
    });
  }
  return out.length ? out : undefined;
}

/** What a manifest says about its views in Patterpad: each view's id and name, and the extensions they read. */
function viewFacts(manifest: Manifest): Pick<ExtensionDto, "views" | "reads"> {
  const views = viewsFor(manifest, "patter").map((v) => ({ id: v.id, name: v.name }));
  const reads = Array.isArray(manifest.reads) ? manifest.reads.filter((r): r is string => typeof r === "string") : [];
  return { ...(views.length ? { views } : {}), ...(reads.length ? { reads } : {}) };
}

/** The extensions a manifest requires that the project doesn't take, when there are any. */
function missingFacts(manifest: Manifest, taken: readonly string[]): Pick<ExtensionDto, "missing"> {
  const missing = missingRequirements(manifest, taken);
  return missing.length ? { missing } : {};
}

/** The read-only line an extension's Settings section opens with: what the project takes it at.
 *  "Taken at 1.1.0." */
export function takenLine(x: Pick<ExtensionDto, "taken" | "version">): string {
  return x.taken ? `Taken at ${x.taken}.` : `Taken with no version (the manifest is ${x.version}).`;
}

/** Words to show for a node: trimmed to a line. */
const clip = (text: string): string => { const t = text.replace(/\s+/g, " ").trim(); return t.length > 60 ? `${t.slice(0, 59)}…` : t; };

/**
 * Every node an extension's reference may name, by kind, each with a name to show and its scene: the scene,
 * its blocks and snippets, a choice's options, and every beat by its kind (an option's prompt included), as
 * the compiler's extension pass counts them. `text(sceneId, id)` is a beat's words in the source language.
 */
export function extensionNodeIndex(scenes: readonly Scene[], text: (sceneId: string, id: string) => string | undefined): Record<string, ExtensionNodeDto[]> {
  const out: Record<string, ExtensionNodeDto[]> = { scene: [], block: [], snippet: [], option: [], line: [], text: [], gameEvent: [] };
  for (const scene of scenes) {
    const s = scene.id;
    out["scene"]!.push({ id: s, label: scene.name || s });
    const words = (id: string): string => clip(text(s, id) ?? "");
    const beat = (b: Beat): void => {
      const said = words(b.id);
      const who = b.kind === "line" ? (b as { character?: string }).character ?? "" : "";
      const label = b.kind === "line" ? (who && said ? `${who}: ${said}` : who || said) : b.kind === "text" ? said : "";
      (out[b.kind] ??= []).push({ id: b.id, label: label || b.id, scene: s });
    };
    const walk = (children: Array<Group | Snippet>, inChoice: boolean): void => {
      for (const node of children ?? []) {
        if (node.type === "group") {
          if (inChoice) {
            out["option"]!.push({ id: node.id, label: (node.prompt ? words(node.prompt.id) : "") || node.id, scene: s });
            if (node.prompt) beat(node.prompt as Beat);
          }
          walk(node.children ?? [], node.selector === "choice");
          continue;
        }
        const first = node.beats?.[0];
        out["snippet"]!.push({ id: node.id, label: (first && first.kind !== "gameEvent" ? words(first.id) : "") || node.id, scene: s });
        for (const b of node.beats ?? []) beat(b);
      }
    };
    for (const block of scene.blocks ?? []) {
      out["block"]!.push({ id: block.id, label: block.name || block.id, scene: s });
      walk(block.children ?? [], false);
    }
  }
  return out;
}
