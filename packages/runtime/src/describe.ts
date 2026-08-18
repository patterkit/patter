// ---------------------------------------------------------------------------
// describeBundle - the bundle inspector's runtime half.
//
// A BUNDLE-level function, deliberately NOT an Engine method. It answers the
// integrator's question from the imported asset alone, with no engine, no state
// and nothing running:
//
//     I dropped a .patterc into my project. What may my game code call, and is
//     this the bundle I think it is?
//
// That is a different question from the one the property examiner answers. The
// examiner (Engine.listProperties + the per-engine state panels) watches and
// edits a LIVE game. This is static: it is the API boundary made visible, read
// off the asset in an editor inspector before anything runs.
//
// Three readers. The integrator reads the addresses and the host scopes: those
// are what game code may call and what it must supply. The writer reads them
// when nothing happens on `runFlow("x", "some_scene")` - the address they typed
// is not in the list. The designer reads the identity and counts to confirm
// what actually shipped.
//
// Everything is in BUNDLE ORDER, never sorted: two runtimes must render the
// same rows in the same sequence, and bundle order is the only order all four
// ports can agree on without importing a collation rule.
//
// Cheap by construction. Scenes, blocks and declarations are walked once;
// nothing here parses an expression, resolves a string table, or touches the
// per-locale text. `beats` is the one count that requires descending to the
// leaves, and it is a running total taken during the same single walk.
// ---------------------------------------------------------------------------

import { effectiveGameId } from "@patterkit/model";
import type {
  Bundle, CompiledBlock, CompiledGroup, CompiledSnippet, GameDataField,
  GameDataNodeKind, PropertyDecl, PropertyType, ScalarValue,
} from "@patterkit/model";

/** Which bundle this is: identity, staleness fingerprints, and how it ships. */
export interface BundleIdentity {
  /** The bundle schema tag ("patter/bundle@0"). */
  schema: string;
  /** The project name. A save must agree with this. */
  project: string;
  /** The authored bundle version, if the project stamps one. */
  version?: string;
  /** Fingerprint over the WHOLE bundle: what binds saves and gates staleness. */
  hash?: string;
  /** The same fingerprint with the string tables left out. Equal structureHash
   *  plus a different hash means a TEXT-ONLY edit, which is what makes a live
   *  hot-swap safe. Showing both lets an integrator tell those apart at sight. */
  structureHash?: string;
  /** Project-wide VO mode. */
  voiced: boolean;
  defaultLocale: string;
  locales: string[];
  /** How strings ship: "embedded" (the runtime resolves text) or "ids" (the
   *  runtime emits beat IDs and the game localises them itself). */
  localisation: "embedded" | "ids";
  /** True when the source locale was embedded purely for debug playback. Such a
   *  build is NOT shippable, which is worth saying loudly in an inspector. */
  sourceDebug: boolean;
}

/** One scene, and the addresses game code may aim at inside it. */
export interface AddressSummary {
  /** The host-facing scene address: what `runFlow` / `goto` take. Derived from
   *  the name when the author set no explicit gameId, exactly as the runtime
   *  resolves it, so this list is the truth rather than an approximation. */
  gameId: string;
  /** The authored scene name, for recognising the row. */
  name: string;
  /** Block addresses within this scene. A block address is SCENE-SCOPED: the
   *  pair is the address, which is why these are nested rather than flattened. */
  blocks: { gameId: string; name: string }[];
}

/** One author-defined gameData field: part of the host-facing data surface. */
export interface GameDataFieldSummary {
  name: string;
  type: string;
  /** Whether the schema carries a fallback. Sparse storage means a node that
   *  sets nothing reads this, so a field with no default can arrive absent. */
  hasDefault: boolean;
  /** Allowed values for an enum field: the set host code switches on. */
  values?: string[];
  purpose?: string;
}

/** The gameData fields declared for one kind of node. */
export interface GameDataSummary {
  kind: GameDataNodeKind;
  fields: GameDataFieldSummary[];
}

/** One declared property. `hasDefault` rather than the value itself: an
 *  inspector wants to know whether the host MUST supply something. */
export interface PropertySummary {
  name: string;
  type: PropertyType;
  hasDefault: boolean;
  default?: ScalarValue;
  /** Shared across all flows, or kept per-flow. Defaults differ by scope
   *  (`@patter` shared, `@scene` per-flow), so it is resolved here. */
  shared: boolean;
}

/** A host scope (`@world` and friends): what the GAME must supply.
 *
 *  The highest-value section of the whole description. Today an integrator
 *  discovers a missing world property when a condition silently reads a
 *  self-backed default and a branch never fires. */
export interface HostScopeSummary {
  /** The token after `@`, e.g. "world". */
  token: string;
  /** Scope-level read/write default for its declarations. */
  writable: boolean;
  /** An OPAQUE scope declares no names: any name is accepted, unchecked. The
   *  host contract is then "anything", which is worth showing as such rather
   *  than as an empty property list. */
  opaque: boolean;
  properties: PropertySummary[];
}

/** Story-owned declarations, for orientation rather than for calling. */
export interface OwnedProperties {
  /** Project-level (`@patter`). */
  patter: PropertySummary[];
  /** Per scene (`@scene`), keyed by the scene's host address. */
  scene: { gameId: string; properties: PropertySummary[] }[];
}

/** "Is this the right build?" at a glance. */
export interface BundleCounts {
  scenes: number;
  blocks: number;
  groups: number;
  snippets: number;
  /** Snippet beats. This is the SAME population `Engine.getBeatSequence` walks, deliberately, so a
   *  tool that lists beats and an inspector that counts them never disagree. Choice prompts are not
   *  in it - see `prompts`. */
  beats: number;
  /** Choice-option prompts: beats that live on a group rather than in a snippet.
   *
   *  Counted separately rather than folded into `beats` because folding them in would make this
   *  number disagree with `getBeatSequence`, and leaving them out entirely would understate a
   *  choice-heavy story - a branching script could report a handful of beats and look like the wrong
   *  build. Neither silence nor a redefinition; a second row. */
  prompts: number;
  /** Beats that fire a game event rather than producing player-facing words. */
  gameEvents: number;
  /** Cast members the bundle carries (player-facing only; the compiler strips
   *  the authoring fields). */
  cast: number;
}

export interface BundleDescription {
  identity: BundleIdentity;
  /** Everything game code may aim at, in bundle order. */
  addresses: AddressSummary[];
  /** What the host must supply. */
  hostScopes: HostScopeSummary[];
  /** What the story owns. */
  properties: OwnedProperties;
  /** The author-defined data surface, grouped by node kind. */
  gameData: GameDataSummary[];
  counts: BundleCounts;
}

/** Resolve a declaration's sharing default, which differs by the scope it sits
 *  in: a project-level property is shared, a scene-local one is per-flow. */
const isShared = (d: PropertyDecl, scopeDefault: boolean): boolean =>
  d.shared ?? scopeDefault;

function summariseProperty(d: PropertyDecl, scopeDefault: boolean): PropertySummary {
  return {
    name: d.name,
    type: d.type,
    hasDefault: d.default !== undefined,
    ...(d.default !== undefined ? { default: d.default } : {}),
    shared: isShared(d, scopeDefault),
  };
}

function summariseField(f: GameDataField): GameDataFieldSummary {
  return {
    name: f.name,
    type: f.type,
    hasDefault: f.default !== undefined,
    ...(f.values ? { values: [...f.values] } : {}),
    ...(f.purpose ? { purpose: f.purpose } : {}),
  };
}

/** One pass over a block's tree, accumulating counts. Iterative rather than
 *  recursive: a deeply nested choice tree should not put an inspector's stack
 *  at risk, and the traversal order does not matter for a count. */
function countBlock(block: CompiledBlock, counts: BundleCounts): void {
  counts.blocks++;
  const stack: Array<CompiledGroup | CompiledSnippet> = [...block.children];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.type === "group") {
      counts.groups++;
      if (node.prompt) counts.prompts++;
      stack.push(...node.children);
      continue;
    }
    counts.snippets++;
    for (const beat of node.beats ?? []) {
      counts.beats++;
      if (beat.kind === "gameEvent") counts.gameEvents++;
    }
  }
}

/**
 * Describe a compiled bundle: what it is, and what a game may call on it.
 *
 * Pure and allocation-light. Safe to call from an editor inspector on every
 * selection, though a details panel should still build its rows once rather
 * than per repaint.
 */
export function describeBundle(bundle: Bundle): BundleDescription {
  const counts: BundleCounts = {
    scenes: 0, blocks: 0, groups: 0, snippets: 0, beats: 0, prompts: 0, gameEvents: 0,
    cast: bundle.cast?.length ?? 0,
  };

  const addresses: AddressSummary[] = [];
  const sceneProps: OwnedProperties["scene"] = [];
  for (const scene of Object.values(bundle.scenes)) {
    counts.scenes++;
    const gameId = effectiveGameId(scene);
    addresses.push({
      gameId,
      name: scene.name,
      blocks: scene.blocks.map((b) => ({ gameId: effectiveGameId(b), name: b.name })),
    });
    for (const block of scene.blocks) countBlock(block, counts);
    // Scene-local declarations default to PER-FLOW, unlike project-level ones.
    if (scene.sceneProps?.length) {
      sceneProps.push({ gameId, properties: scene.sceneProps.map((d) => summariseProperty(d, false)) });
    }
  }

  const hostScopes: HostScopeSummary[] = (bundle.scopeRegistry?.scopes ?? []).map((s) => ({
    token: s.token,
    writable: s.writable ?? true,
    opaque: s.declarations === undefined,
    // A host scope's values live outside the story, so "shared" is not a choice
    // its declarations make; they are world-wide by nature.
    properties: (s.declarations ?? []).map((d) => summariseProperty(d as PropertyDecl, true)),
  }));

  const gameData: GameDataSummary[] = Object.entries(bundle.gameDataFields ?? {})
    .filter(([, fields]) => (fields?.length ?? 0) > 0)
    .map(([kind, fields]) => ({
      kind: kind as GameDataNodeKind,
      fields: (fields ?? []).map(summariseField),
    }));

  return {
    identity: {
      schema: bundle.schema,
      project: bundle.content.project,
      ...(bundle.content.version !== undefined ? { version: bundle.content.version } : {}),
      ...(bundle.content.hash !== undefined ? { hash: bundle.content.hash } : {}),
      ...(bundle.content.structureHash !== undefined ? { structureHash: bundle.content.structureHash } : {}),
      voiced: bundle.voiced,
      defaultLocale: bundle.locales.default,
      locales: [...bundle.locales.included],
      // Absent means "embedded": the back-compat default a bundle written before
      // the field existed relies on.
      localisation: bundle.localisation?.mode ?? "embedded",
      sourceDebug: bundle.localisation?.sourceDebug ?? false,
    },
    addresses,
    hostScopes,
    properties: {
      patter: (bundle.properties ?? []).map((d) => summariseProperty(d, true)),
      scene: sceneProps,
    },
    gameData,
    counts,
  };
}
