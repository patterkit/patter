// ---------------------------------------------------------------------------
// export: source -> bundle (spec §11, schema §10).
//
// Compiles every condition/effect expression to { src, ast }, carries the
// project-wide voiced flag, assembles the selected locales' strings, and emits
// the runtime bundle. Authoring (.patterx) is not included.
//
// (Game Data is passed through as-is for this first cut; internal-id -> gameId
// resolution, schema §10.1, is a later refinement.)
// ---------------------------------------------------------------------------

import type {
  Bundle, CompiledScene, CompiledBlock, CompiledGroup, CompiledSnippet, CompiledEffect,
  ProjectFile, Scene, Block, Group, Snippet, Effect, LocaleFile,
} from "@patterkit/model";
import type { ScopeRegistrySpec } from "@wildwinter/scoperegistry";
import { canonicalStringify, hash32 } from "@patterkit/core";
import { hostScopesToSpec } from "@patterkit/dialect";
import { compileExpression } from "./expressions.js";

export interface ExportInput {
  project: ProjectFile;
  scenes: Scene[];
  /** Locale files to assemble (one or more per locale). */
  locales?: LocaleFile[];
  /** Assemble only these locales (schema §10.1 "selected locales"); default: all provided. */
  includeLocales?: string[];
  /**
   * Another owner's `scopeRegistrySpec` (e.g. a storylet's), to permit compiling
   * references into its imported scopes (`@world.x`). The parser rejects an
   * unregistered scope token, so cross-engine refs need this.
   */
  foreignScopes?: ScopeRegistrySpec;
}

function compileEffect(e: Effect, foreign?: ScopeRegistrySpec): CompiledEffect {
  // SET-ONLY (spec §15): an effect is a property mutation. Host events ride on gameData, not here.
  return { kind: "set", target: e.target, value: compileExpression(e.value, foreign) };
}

function compileNode(node: Group | Snippet, foreign?: ScopeRegistrySpec): CompiledGroup | CompiledSnippet {
  if (node.type === "group") {
    return {
      id: node.id,
      type: "group",
      condition: node.condition !== undefined ? compileExpression(node.condition, foreign) : undefined,
      selector: node.selector,
      shared: node.shared,
      options: node.options,
      children: node.children.map((c) => compileNode(c, foreign)),
      gameData: node.gameData,
      tags: node.tags,                         // author tags (#215), accumulated at runtime
      prompt: node.prompt,                     // option-position only (spec §5)
      secretUntilEligible: node.secretUntilEligible,
      sticky: node.sticky,
      fallback: node.fallback,
    };
  }
  return {
    id: node.id,
    type: "snippet",
    condition: node.condition !== undefined ? compileExpression(node.condition, foreign) : undefined,
    beats: node.beats,
    onEnter: node.onEnter?.map((e) => compileEffect(e, foreign)),
    onExit: node.onExit?.map((e) => compileEffect(e, foreign)),
    gameData: node.gameData,
    tags: node.tags,                         // author tags (#215)
    jump: node.jump,
    secretUntilEligible: node.secretUntilEligible,
    sticky: node.sticky,
    fallback: node.fallback,
  };
}

function compileBlock(block: Block, foreign?: ScopeRegistrySpec): CompiledBlock {
  return {
    id: block.id,
    type: "block",
    name: block.name,
    ...(block.gameId ? { gameId: block.gameId } : {}), // host-facing address; runtime falls back to the name slug
    children: block.children.map((c) => compileNode(c, foreign)),
    gameData: block.gameData,
    tags: block.tags,                        // author tags (#215)
  };
}

function compileScene(scene: Scene, foreign?: ScopeRegistrySpec): CompiledScene {
  return {
    id: scene.id,
    type: "scene",
    name: scene.name,
    ...(scene.gameId ? { gameId: scene.gameId } : {}), // host-facing address; runtime falls back to the name slug
    gameData: scene.gameData,
    tags: scene.tags,                        // author tags (#215)
    onEntry: scene.onEntry?.map((e) => compileEffect(e, foreign)),
    sceneProps: scene.sceneProps,
    blocks: scene.blocks.map((b) => compileBlock(b, foreign)),
  };
}

/** Compile a project's source into the runtime bundle. */
export function exportBundle(input: ExportInput): Bundle {
  const { project, scenes, locales = [], includeLocales } = input;

  // A project's OWN host scopes (`project.scopeRegistry`, e.g. `@world`) are intrinsic to it, so they
  // apply to every compile without each caller re-passing them; an explicit `input.foreignScopes` (another
  // owner's spec, e.g. a storylet's) takes precedence when given. The chosen spec lets `@world.x` parse and
  // is baked into the bundle so the runtime can self-back the scope when no host resolver claims it.
  const foreignScopes = input.foreignScopes ?? hostScopesToSpec(project.scopeRegistry);

  const scenesOut: Record<string, CompiledScene> = {};
  for (const scene of scenes) scenesOut[scene.id] = compileScene(scene, foreignScopes);

  const strings: Record<string, Record<string, string>> = {};
  for (const loc of locales) {
    if (includeLocales && !includeLocales.includes(loc.locale)) continue;
    const table = (strings[loc.locale] ??= {});
    for (const [key, text] of Object.entries(loc.strings)) {
      // Shards merge; the same key twice with DIFFERENT text means two files
      // both claim a beat - silent last-wins would ship one author's line.
      if (key in table && table[key] !== text) {
        throw new Error(`duplicate string key '${key}' in locale '${loc.locale}' with differing text`);
      }
      table[key] = text;
    }
  }

  return {
    schema: "patter/bundle@0",
    content: {
      project: project.project.id,
      // Binds saves to the content they were taken against, and gates bundle
      // staleness (schema §10.5). A stable strict-JSON fingerprint - independent
      // of the source-form trailing-comma policy.
      // `scopeRegistry` is folded in only when present, so projects without host scopes keep their exact
      // prior hash (no ripple to existing bundles / the conformance corpus).
      hash: hash32(canonicalStringify({
        scenes: scenesOut, strings, properties: project.properties ?? [],
        ...(foreignScopes ? { scopeRegistry: foreignScopes } : {}),
      }, { trailingComma: false })),
      // Structure-only fingerprint (live bundle refresh): the same hash with the string tables left
      // out. Same structureHash + a different hash = a text-only edit, safe to swap in place with
      // `engine.replaceStrings()`; a changed structureHash needs the full save/load hot swap.
      structureHash: hash32(canonicalStringify({
        scenes: scenesOut, properties: project.properties ?? [],
        ...(foreignScopes ? { scopeRegistry: foreignScopes } : {}),
      }, { trailingComma: false })),
    },
    voiced: project.voiced ?? false,
    locales: { default: project.locales.default, included: Object.keys(strings) },
    cast: project.cast?.map(({ notes, ...c }) => c), // strip authoring-only notes from the runtime

    properties: project.properties,
    scopeRegistry: project.scopeRegistry,
    gameDataFields: project.gameDataFields,
    // Closed-caption delimiters ride along only when the project pins a non-default pair (#214); the
    // runtime falls back to `[` / `]` when absent, so default projects keep their exact prior bundle.
    ...(project.closedCaptions ? { closedCaptions: project.closedCaptions } : {}),
    scenes: scenesOut,
    strings,
  };
}
