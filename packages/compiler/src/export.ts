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
  Beat, Bundle, BundleCastMember, BundleExtension, BundleQualifier, CompiledScene, CompiledBlock, CompiledGroup, CompiledSnippet, CompiledEffect,
  NodeExtensions, ProjectFile, Scene, Block, Group, Snippet, Effect, LocaleFile,
} from "@patterkit/model";
import { defaultFor } from "@wildwinter/scoperegistry";
import type { ScalarValue, ScopeRegistrySpec } from "@wildwinter/scoperegistry";
import type { MergedScopes } from "@wildwinter/scoperegistry/scopes";
import { canonicalStringify, hash32 } from "@patterkit/core";
import { hostScopesToSpec, withEngineScopes, EXTERNAL_SCOPES } from "@patterkit/dialect";
import { textIsAction, usedQualifiers, usedSpeakerPairs, walkNodes, DEFAULT_SPEAKER_PATTERN } from "@patterkit/model";
import { compileExpression } from "./expressions.js";
import { externalGameScopes, projectScopes } from "./game-scopes.js";
import { extensionPass } from "./extensions.js";
import type { ExtensionManifestFile, ExtensionShardFile } from "./extensions.js";

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
  /**
   * The game's merged `game-scopes/` folder, when the project has one (patterkit/design/shared-scopes.md).
   * Its `game.scopes.json` wins over the project's copy of a host scope, and its `@world` is baked in
   * even when the project doesn't declare it; every other scope in it compiles as another engine's
   * does: named in `externalScopes`, never baked in.
   */
  gameScopes?: MergedScopes;
  /**
   * The project's Patter extensions: its manifests and its extension data shards. Each node's values are
   * compiled inline under `extensions`, and the bundle's `extensions` section carries each extension the
   * project takes. Absent or empty, with no extension taken, the bundle and its hashes are exactly what they
   * were. What is wrong with the data is validate's to report (`extensionPass`); here an entry with an
   * error is simply left out.
   */
  extensions?: { manifests: readonly ExtensionManifestFile[]; shards: readonly ExtensionShardFile[] };
}

/** What the compile walk carries: another owner's scopes, and each node's compiled extension values. */
interface CompileCtx {
  foreign?: ScopeRegistrySpec;
  extensions: ReadonlyMap<string, NodeExtensions>;
  /** The scene being compiled has action text (`textIsAction`): its snippets' text beats get `action: true`. */
  action?: boolean;
}

/**
 * A beat as the bundle carries it: the source beat, with its compiled extension values set, and `action: true`
 * on a snippet's text beat in a scene whose text is action (`asAction`; an option's prompt never is). Source
 * keeps extension values in extension shards and never says `action`, so a hand-written `extensions` or
 * `action` key there never reaches the bundle. A beat with none of these is passed through as it is.
 */
function compileBeat<B extends Beat>(beat: B, ctx: CompileCtx, asAction = false): B {
  const values = ctx.extensions.get(beat.id);
  const action = asAction && beat.kind === "text";
  const has = (k: string): boolean => Object.prototype.hasOwnProperty.call(beat, k);
  if (values === undefined && !action && !has("extensions") && !has("action")) return beat;
  const { extensions: _source, action: _action, ...rest } = beat as B & { action?: true };
  return { ...rest, ...(values !== undefined ? { extensions: values } : {}), ...(action ? { action: true } : {}) } as B;
}

/** The ids of a compiled scene's action text beats, in authored order. */
function collectActionIds(scene: CompiledScene, out: string[]): void {
  for (const block of scene.blocks) {
    walkNodes<CompiledGroup | CompiledSnippet>(block.children, (node) => {
      if (node.type !== "snippet") return;
      for (const beat of node.beats ?? []) if (beat.kind === "text" && beat.action) out.push(beat.id);
    });
  }
}

function compileEffect(e: Effect, foreign?: ScopeRegistrySpec): CompiledEffect {
  // SET-ONLY (spec §15): an effect is a property mutation. Host events ride on gameData, not here.
  return { kind: "set", target: e.target, value: compileExpression(e.value, foreign) };
}

function compileNode(node: Group | Snippet, ctx: CompileCtx): CompiledGroup | CompiledSnippet {
  const { foreign } = ctx;
  if (node.type === "group") {
    return {
      id: node.id,
      type: "group",
      condition: node.condition !== undefined ? compileExpression(node.condition, foreign) : undefined,
      selector: node.selector,
      shared: node.shared,
      options: node.options,
      children: node.children.map((c) => compileNode(c, ctx)),
      padAfterDefault: node.padAfterDefault,   // line padding: the default for the beats inside
      gameData: node.gameData,
      extensions: ctx.extensions.get(node.id), // a choice's option's extension values
      tags: node.tags,                         // author tags (#215), accumulated at runtime
      prompt: node.prompt && compileBeat(node.prompt, ctx), // option-position only (spec §5)
      secretUntilEligible: node.secretUntilEligible,
      sticky: node.sticky,
      fallback: node.fallback,
    };
  }
  return {
    id: node.id,
    type: "snippet",
    condition: node.condition !== undefined ? compileExpression(node.condition, foreign) : undefined,
    beats: node.beats && node.beats.map((b) => compileBeat(b, ctx, ctx.action)),
    onEnter: node.onEnter?.map((e) => compileEffect(e, foreign)),
    onExit: node.onExit?.map((e) => compileEffect(e, foreign)),
    padAfterDefault: node.padAfterDefault,   // line padding: the default for the beats inside
    gameData: node.gameData,
    extensions: ctx.extensions.get(node.id),
    tags: node.tags,                         // author tags (#215)
    jump: node.jump,
    secretUntilEligible: node.secretUntilEligible,
    sticky: node.sticky,
    fallback: node.fallback,
  };
}

function compileBlock(block: Block, ctx: CompileCtx): CompiledBlock {
  return {
    id: block.id,
    type: "block",
    name: block.name,
    ...(block.gameId ? { gameId: block.gameId } : {}), // host-facing address; runtime falls back to the name slug
    children: block.children.map((c) => compileNode(c, ctx)),
    padAfterDefault: block.padAfterDefault,  // line padding: the default for the beats inside
    gameData: block.gameData,
    extensions: ctx.extensions.get(block.id),
    tags: block.tags,                        // author tags (#215)
  };
}

function compileScene(scene: Scene, ctx: CompileCtx): CompiledScene {
  const { foreign } = ctx;
  return {
    id: scene.id,
    type: "scene",
    name: scene.name,
    ...(scene.gameId ? { gameId: scene.gameId } : {}), // host-facing address; runtime falls back to the name slug
    padAfterDefault: scene.padAfterDefault,  // line padding: the default for the beats inside
    gameData: scene.gameData,
    extensions: ctx.extensions.get(scene.id),
    tags: scene.tags,                        // author tags (#215)
    onEntry: scene.onEntry?.map((e) => compileEffect(e, foreign)),
    sceneProps: scene.sceneProps,
    blocks: scene.blocks.map((b) => compileBlock(b, ctx)),
  };
}

/** The external scope tokens the compiled content names (conditions, effect values, and effect targets),
 *  sorted: the family's other engines', and any the game's scopes folder declares for someone else. */
function externalScopesIn(scenes: Record<string, CompiledScene>, external: ReadonlySet<string>): string[] {
  const found = new Set<string>();
  const walk = (node: unknown): void => {
    if (!Array.isArray(node) && (node === null || typeof node !== "object")) return;
    if (Array.isArray(node)) {
      if (node[0] === "sv" && typeof node[1] === "string" && external.has(node[1])) found.add(node[1]);
      for (const n of node) walk(n);
      return;
    }
    const o = node as Record<string, unknown>;
    if (o["kind"] === "set" && typeof o["target"] === "string") {
      const head = o["target"].replace(/^@/, "").split(".")[0]!;
      if (o["target"].includes(".") && external.has(head)) found.add(head);
    }
    for (const v of Object.values(o)) walk(v);
  };
  walk(scenes);
  return [...found].sort();
}

/**
 * Declarations as the bundle carries them: each with its default, the one it was given or else its type's by
 * the kernel's `defaultFor` (false, 0, "", the first enum value, no flags, the first stage). A default is
 * optional in source and resolved here, for properties, scene properties and gameData fields alike (the family's
 * rule, ruled 2026-10-18), so a host always reads one and keeps no defaults table of its own. Only the bundle's
 * own copy is resolved: the content hashes stay over the source as written. A host scope's declarations are not
 * the story's to resolve: the game supplies those values.
 */
function resolved<D extends { type: string; default?: ScalarValue; values?: string[]; stages?: string[] }>(decls: D[]): D[];
function resolved<D extends { type: string; default?: ScalarValue; values?: string[]; stages?: string[] }>(decls: D[] | undefined): D[] | undefined;
function resolved<D extends { type: string; default?: ScalarValue; values?: string[]; stages?: string[] }>(decls: D[] | undefined): D[] | undefined {
  return decls?.map((d) => (d.default === undefined ? { ...d, default: defaultFor(d) } : d));
}

/** Compile a project's source into the runtime bundle. */
export function exportBundle(input: ExportInput): Bundle {
  const { project, scenes, locales = [], includeLocales } = input;

  // A project's OWN host scopes (`project.scopeRegistry`, e.g. `@world`) are intrinsic to it, so they
  // apply to every compile without each caller re-passing them; an explicit `input.foreignScopes` (another
  // owner's spec, e.g. a storylet's) takes precedence when given. The chosen spec lets `@world.x` parse and
  // is baked into the bundle so the runtime can self-back the scope when no host resolver claims it.
  // With a game scopes folder, the host scopes are the project's as the folder leaves them (the shared
  // file wins, and its `@world` joins); without one they are the project's own, exactly as before.
  const hostScopes = projectScopes(project, input.gameScopes).host;
  const foreignScopes = input.foreignScopes ?? hostScopesToSpec(hostScopes);
  const gameExternal = externalGameScopes(foreignScopes, input.gameScopes);

  // Compiled against the family's other engines too (`@story` parses with no setting), and every token
  // the game's folder declares, but the bundle's own scopeRegistry keeps only the host scopes: the
  // runtime self-backs what it lists, and another engine's scope is that engine's to register.
  const compileScopes = withEngineScopes({
    version: foreignScopes?.version ?? 1,
    scopes: [...(foreignScopes?.scopes ?? []), ...gameExternal.map((s) => ({ token: s.token }))],
  });
  // Patter extensions: one manifest-driven pass (extensions.ts), its values compiled onto the nodes. Only
  // when the project takes one or has extension files, so a project with none compiles exactly as before.
  const ext = input.extensions;
  const compiledExt = project.extensions !== undefined || (ext !== undefined && (ext.manifests.length > 0 || ext.shards.length > 0))
    ? extensionPass({ project, scenes, manifests: ext?.manifests ?? [], shards: ext?.shards ?? [] }).compiled
    : undefined;
  const extensionSection: Record<string, BundleExtension> | undefined =
    compiledExt !== undefined && Object.keys(compiledExt.bundle).length > 0 ? compiledExt.bundle : undefined;
  const ctx: CompileCtx = { foreign: compileScopes, extensions: compiledExt?.nodes ?? new Map() };
  const scenesOut: Record<string, CompiledScene> = {};
  // A scene whose text is action (design/proposals/action-text.md) marks its text beats, and their ids are
  // held to the source text in every locale below.
  const actionIds: string[] = [];
  for (const scene of scenes) {
    const action = textIsAction(project, scene);
    scenesOut[scene.id] = compileScene(scene, action ? { ...ctx, action } : ctx);
    if (action) collectActionIds(scenesOut[scene.id]!, actionIds);
  }
  const externalScopes = externalScopesIn(scenesOut, new Set([...EXTERNAL_SCOPES, ...gameExternal.map((s) => s.token)]));

  // The qualifiers the content uses, as the bundle ships them: `gameId` and authored name (the description
  // is for writers). One no line uses stays out, so a project that uses none compiles exactly as before.
  const qualifiers: BundleQualifier[] = usedQualifiers(project, scenes).map((q) => ({ gameId: q.gameId, name: q.name }));
  // A character's own label with a qualifier ships only for a pair the lines use; the pattern only when the project
  // changed it and uses a qualifier at all.
  const usedPairs = new Set(usedSpeakerPairs(scenes).map((p) => `${p.character}\u0000${p.qualifier}`));
  const speakerPattern = qualifiers.length > 0 && project.speakerPattern !== undefined && project.speakerPattern !== DEFAULT_SPEAKER_PATTERN
    ? project.speakerPattern : undefined;

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
  // Action has no translations: every locale carries its source text, whatever a translated shard still holds
  // (loc import drops those; until then they're ignored here).
  if (actionIds.length > 0) {
    const source: Record<string, string> = {};
    for (const loc of locales) if (loc.locale === project.locales.default) Object.assign(source, loc.strings);
    for (const [locale, table] of Object.entries(strings)) {
      if (locale === project.locales.default) continue;
      for (const id of actionIds) {
        if (id in source) table[id] = source[id]!;
        else delete table[id];
      }
    }
  }

  return {
    schema: "patter/bundle@0",
    content: {
      project: project.project.id,
      // Binds saves to the content they were taken against, and gates bundle
      // staleness (schema §10.5). A stable strict-JSON fingerprint - independent
      // of the source-form trailing-comma policy.
      // `scopeRegistry` and `qualifiers` are folded in only when present, so projects without them keep
      // their exact prior hash (no ripple to existing bundles / the conformance corpus).
      hash: hash32(canonicalStringify({
        scenes: scenesOut, strings, properties: project.properties ?? [],
        ...(foreignScopes ? { scopeRegistry: foreignScopes } : {}),
        ...(qualifiers.length > 0 ? { qualifiers } : {}),
        ...(typeof project.padAfterDefault === "number" ? { padAfterDefault: project.padAfterDefault } : {}),
        // Each node's values are in `scenes`; the declarations and the project's own values are here.
        ...(extensionSection !== undefined ? { extensions: extensionSection } : {}),
      }, { trailingComma: false })),
      // Structure-only fingerprint (live bundle refresh): the same hash with the string tables left
      // out. Same structureHash + a different hash = a text-only edit, safe to swap in place with
      // `engine.replaceStrings()`; a changed structureHash needs the full save/load hot swap.
      // A qualifier's name rides in `qualifiers`, not the string tables, so renaming one is a structure change.
      structureHash: hash32(canonicalStringify({
        scenes: scenesOut, properties: project.properties ?? [],
        ...(foreignScopes ? { scopeRegistry: foreignScopes } : {}),
        ...(qualifiers.length > 0 ? { qualifiers } : {}),
        ...(typeof project.padAfterDefault === "number" ? { padAfterDefault: project.padAfterDefault } : {}),
        ...(extensionSection !== undefined ? { extensions: extensionSection } : {}),
      }, { trailingComma: false })),
    },
    voiced: project.voiced ?? false,
    locales: { default: project.locales.default, included: Object.keys(strings) },
    // The cast is copied field by field, on purpose. Most of a CastMember is authoring context that must
    // never reach players: `notes` are production chatter, `gender` is translator context (it rides the
    // localisation formats), and `actor` is a real person's name (it belongs in the VO script). Listing
    // what ships, rather than subtracting what doesn't, means a field added to CastMember tomorrow stays
    // out of the bundle until someone deliberately adds it here.
    cast: project.cast?.map((c): BundleCastMember => {
      const m: BundleCastMember = { name: c.name };
      if (c.displayName !== undefined) m.displayName = c.displayName;
      const labels = Object.entries(c.qualifierLabels ?? {}).filter(([q, label]) => label !== "" && usedPairs.has(`${c.name}\u0000${q}`));
      if (labels.length > 0) m.qualifierLabels = Object.fromEntries(labels);
      if (c.gameData !== undefined) m.gameData = c.gameData;
      return m;
    }),
    ...(qualifiers.length > 0 ? { qualifiers } : {}),
    ...(speakerPattern !== undefined ? { speakerPattern } : {}),
    // The project's own line-padding default, only when it sets one: absent, every runtime uses the built-in one.
    ...(typeof project.padAfterDefault === "number" ? { padAfterDefault: project.padAfterDefault } : {}),

    properties: resolved(project.properties),
    // A host scope's declarations ship as written: there, "no default" is the game's to supply, and saying
    // so is what an integrator reads the bundle for.
    scopeRegistry: hostScopes,
    gameDataFields: project.gameDataFields && Object.fromEntries(
      Object.entries(project.gameDataFields).map(([kind, fields]) => [kind, resolved(fields)]),
    ) as typeof project.gameDataFields,
    // The extensions the project takes: each one's version, its compiled declarations by node kind (every
    // default resolved, editor-only fields and the editor's words left out), the project node's values, and
    // its settings, each the project's value or else the default.
    ...(extensionSection !== undefined ? { extensions: extensionSection } : {}),
    // Closed-caption delimiters ride along only when the project pins a non-default pair (#214); the
    // runtime falls back to `[` / `]` when absent, so default projects keep their exact prior bundle.
    ...(project.closedCaptions ? { closedCaptions: project.closedCaptions } : {}),
    scenes: Object.fromEntries(Object.entries(scenesOut).map(([id, sc]) =>
      [id, sc.sceneProps ? { ...sc, sceneProps: resolved(sc.sceneProps) } : sc])),
    strings,
    // Other engines' scopes the content names, so the engine can say when the game has not registered one.
    ...(externalScopes.length > 0 ? { externalScopes } : {}),
  };
}
