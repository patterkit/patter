// ---------------------------------------------------------------------------
// @patterkit/runtime - the reference runtime.
//
// An `Engine` is the world + flow manager: it owns the compiled Bundle, the
// shared state (shared `@patter` globals + shared `@scene` props + host foreign
// scopes), and a set of named **flows**. All *play* happens on a `Flow` handle
// (`engine.openFlow(id, ...)`): a flow has its own execution cursor, its own PRNG,
// and its own copy of the NOT-shared state (per-flow `@patter` globals + per-flow
// `@scene` props). Multiple flows run concurrently and independently - a flow is
// addressed explicitly (`alice.advance()`), so there is no ambient "current flow".
//
// Scopes are just two tokens - `@patter` (global; bare `@name`) and `@scene`
// (scene-local) - with an orthogonal per-property `shared` flag (default: shared
// for `@patter`, per-flow for `@scene`). So each token spans two storage areas:
// the shared half lives on the engine, the per-flow half on the flow; a read/write
// routes by the property's `shared` flag. (Mirrors Storylet Studio's @world/@site.)
//
// A flow plays the select-one-child model (spec §4): a block branches one
// eligible child; a group runs its selector (branch / sequence / choice -
// `sequence` covers order x exhaust); a `choice` group stops for the host; a snippet runs onEnter, delivers
// beats, runs onExit, follows its jump. Falling off the end ends the flow.
// Cross-flow jumps are not a thing - the host switches flows.
//
// `engine.saveGame()` / `loadGame()` snapshot + restore the WHOLE game: `@patter`
// plus every live flow's scopes + PRNG + cursor.
// ---------------------------------------------------------------------------

import { evaluate, deserialiseAst } from "@wildwinter/expr";
import type { ScalarValue, EvalContext, ExprNode } from "@wildwinter/expr";
import { matchedSpecificity as scoreSpecificity, type EvalTruthy } from "@wildwinter/expr-specificity";
import { ScopeRegistry } from "@wildwinter/scoperegistry";
import type { ScopeDeclaration, ScopeResolver } from "@wildwinter/scoperegistry";
import { patterDialect, interpolate, splitRef, stripCaptions } from "@patterkit/dialect";
import { walkNodes, effectiveGameId, castStringKey, DEFAULT_CAPTION_DELIMITERS, DEFAULT_CAPTION_CHARACTER } from "@patterkit/model";
import { buildTagIndex } from "./tags.js";
import type {
  Bundle, CompiledScene, CompiledBlock, CompiledGroup, CompiledSnippet,
  CompiledEffect, Beat, LineBeat, TextBeat, GameData, Expression, PropertyDecl, PropertyType, Jump, HostScopeDecl,
} from "@patterkit/model";

type SelectableNode = CompiledGroup | CompiledSnippet;

// Compiled expressions are immutable, so each one's AST is deserialised once -
// per evaluation was the engine's hottest path (every condition / effect / slot).
const astCache = new WeakMap<Expression, ExprNode>();

/** A property-state snapshot: owned scope -> property name -> value. */
export type EngineSave = Record<string, Record<string, ScalarValue>>;

/** Serialised `sequence` selector visit state for one group (spec §4 / §7). */
export interface SelectorSnapshot {
  seq?: number;            // sequential cursor (visits taken)
  bag?: string[];          // shuffle: child ids still undrawn this pass
  last?: string;           // last child id picked (no-immediate-repeat)
}

/** One entry on a flow's continuation stack: a position within a container's children. */
export interface StackFrame {
  sceneId: string;
  /** A block id or a run-group id (both are sequential containers). */
  containerId: string;
  index: number;
  /** SNAPSHOT-ONLY (never set on a live frame): the id of the child at `index` when the save was
   *  taken. On restore the child is re-found by this id, so a save survives siblings being inserted,
   *  removed, or reordered before the cursor (live bundle refresh / patched-game saves). Absent (an
   *  older save, or a frame saved at its container's end) falls back to the raw `index`. */
  nextId?: string;
}

/** The serialised cursor + scopes + PRNG of a single flow. */
export interface FlowSnapshot {
  /** This flow's owned-scope values = the NOT-shared `@patter` globals (under token "patter"). */
  scopes: EngineSave;
  /** Per-scene NOT-shared `@scene` bags (scene id -> name -> value); persist across re-entries (spec §7). */
  sceneBags: Record<string, Record<string, ScalarValue>>;
  /** This flow's built-in PRNG position (mulberry32 state). */
  rngState: number;
  /** This flow's per-node entry counts (node id -> times entered by this flow). */
  visits: Record<string, number>;
  cursor: {
    flowEnded: boolean;
    currentSceneId: string | null;
    /** The continuation stack (call frames + the active block run). */
    stack: StackFrame[];
    activeSnippetId: string | null;
    beatIndex: number;
    /** The pending choice's exact option set, REPLAYED on load (schema 9.3). */
    pendingChoice: SavedChoice | null;
    /** The chosen option owning a prompt still to be replayed (save taken between choose + advance).
     *  Optional / absent in older saves -> no pending prompt. */
    pendingPromptOwnerId?: string | null;
    /** This flow's `sequence` selector cursors. */
    selectors: Record<string, SelectorSnapshot>;
  };
}

/**
 * A pending choice as saved: the option set the player was shown, restored
 * verbatim - re-deriving on load would re-evaluate conditions (consuming PRNG
 * draws a second time) and could mutate the choice under the player.
 */
export interface SavedChoice {
  groupId: string;
  options: ChoiceOption[];
}

/** A full resumable save-game: shared `@patter` state + every live flow. */
export interface SaveGame {
  version: number;
  /** Shared `@patter` globals (owned scope "patter"). */
  shared: EngineSave;
  /** World-wide per-node entry counts (node id -> times entered by any flow). */
  sharedVisits: Record<string, number>;
  /** Shared selector cursors (node id -> snapshot) for `shared` memoried selectors. */
  sharedSelectors: Record<string, SelectorSnapshot>;
  /** Shared, scene-namespaced `@scene` bags (scene id -> name -> value) - the shared scene props. */
  stageBags: Record<string, Record<string, ScalarValue>>;
  /** Each live flow's snapshot, keyed by flow id. */
  flows: Record<string, FlowSnapshot>;
}

/** What `Flow.advance()` surfaces to the host at each stop. */
export type StepResult =
  | { type: "line"; id: string; text: string; character?: string; characterName?: string; direction?: string; gameData?: GameData; tags?: string[] }
  | { type: "text"; id: string; text: string; gameData?: GameData; tags?: string[] }
  | { type: "gameEvent"; id: string; gameData?: GameData; tags?: string[] }
  | { type: "choice"; groupId: string; options: ChoiceOption[] }
  | { type: "end" };

// --- Static structure introspection (editor / dev tooling) -------------------
// A read-only view of the AUTHORED tree (scenes -> blocks -> groups/snippets -> beats), for dev
// tools that build against the writer's structure (e.g. an Unreal Sequencer of subsequences per
// beat). Static: no flow, no play state. Per-beat data mirrors what a StepResult would carry
// (source text, author gameData, accumulated tags), read at the default locale.

/** One beat's static data - the same shape a delivered step carries, resolved at the source locale. */
export interface BeatInfo {
  id: string;
  kind: "line" | "text" | "gameEvent";
  /** Speaker token (line only). */
  character?: string;
  /** Resolved display name for `character` (source locale), if the cast declares one. */
  characterName?: string;
  /** Performance direction (line only). */
  direction?: string;
  /** Source text, un-interpolated (line / text). Omitted for gameEvent and IDs-only bundles. */
  text?: string;
  /** Author gameData overrides on this beat (raw, as the step carries them). Omitted when empty. */
  gameData?: GameData;
  /** Accumulated author tags (scene -> block -> group(s) -> snippet -> beat). Omitted when empty. */
  tags?: string[];
}

/** A node in the outline tree: a group (with its selector + children) or a snippet (with its beats). */
export interface OutlineNode {
  type: "group" | "snippet";
  id: string;
  tags?: string[];
  // group only
  selector?: string;
  /** A choice/option group's prompt beat, if any. */
  prompt?: BeatInfo;
  children?: OutlineNode[];
  // snippet only
  beats?: BeatInfo[];
  jumpTo?: string;
  jumpMode?: "jump" | "call";
}

/** A block in the outline tree. */
export interface OutlineBlock {
  id: string;
  gameId?: string;
  name: string;
  tags?: string[];
  children: OutlineNode[];
}

/** A scene in the outline tree. */
export interface OutlineScene {
  id: string;
  gameId?: string;
  name: string;
  tags?: string[];
  blocks: OutlineBlock[];
}

/** One beat in document order, with the scene/block/snippet it lives in (the flat view). */
export interface FlatBeat {
  sceneId: string;
  blockId: string;
  snippetId: string;
  beat: BeatInfo;
}

/** What {@link Flow.advanceToStop} returns: the beats walked, and the choice / end that stopped it. */
export interface AdvanceToStopResult {
  /** The line / text / game-event beats played on the way to the stop (never a choice / end). */
  played: Array<Extract<StepResult, { type: "line" | "text" | "gameEvent" }>>;
  stop: Extract<StepResult, { type: "choice" | "end" }>;
}

/** The choice text of an option (spec §5): its `prompt` beat, resolved + interpolated. */
export interface ChoicePrompt {
  kind: "line" | "text";
  /** Display text (interpolated; may be empty - the host can render from gameData / an icon). */
  text: string;
  /** Speaker / direction - present only for a `line` prompt (the PC's spoken choice). */
  character?: string;
  /** The speaker's resolved player-facing name (locale-aware; absent when the character has none). */
  characterName?: string;
  direction?: string;
}

/** A single option of a pending `choice` group. */
export interface ChoiceOption {
  /** The option's id (an Option group, or a degenerate option snippet) - pass to `choose()`. */
  id: string;
  /**
   * The option's `prompt` (spec §5) - the choice text as a structured line/text beat. For the
   * degenerate bare-snippet tolerance, derived from the snippet's first content line. Undefined
   * only when even that is absent; internal ids are never leaked as display text.
   */
  prompt?: ChoicePrompt;
  /** False when the option's condition fails; still returned (greyed) unless hidden. */
  eligible: boolean;
  gameData?: GameData;
}

/**
 * The host's **World Properties** resolver: a `{ get, set? }` the game provides so the story can read
 * (and, if you allow it, write) its `@world.*` values at runtime. Property metadata (types, read-only)
 * comes from the compiled bundle's declared world properties; the values themselves live in the host and
 * are never stored or saved by this engine.
 */
export type WorldResolver = ScopeResolver;

export interface EngineOptions {
  /**
   * Custom float-in-[0,1) source for `random()` / shuffle, shared by all flows.
   * Overrides the built-in seeded PRNG - but its position is NOT captured by
   * `saveGame()`. For resumable runs, use the built-in per-flow seed instead.
   */
  rng?: () => number;
  /** Default seed for each flow's built-in (serialisable) PRNG; override per flow in `openFlow`. */
  seed?: number;
  /** Active locale for string lookups (embedded localisation). Defaults to the bundle's default locale.
   *  Ignored by an "ids" bundle, which emits beat IDs for the game to localise itself. */
  locale?: string;
  /** The host's resolver for **World Properties** (`@world.*`): the values the game owns and the story
   *  reads. Omit it and the runtime self-backs `@world` from the declared defaults. Shared by all flows. */
  world?: WorldResolver;
  /**
   * Replay a chosen option's `prompt` as its first played beat (spec §5). Default `false`:
   * the prompt is a label only and `choose()` plays just the option's content. `true`: the
   * prompt beat is delivered first (the choice "spoken back"). A host decision, not authored.
   */
  replayPromptOnChoose?: boolean;
  /** Closed captions (#214): show non-spoken caption cues inside dialogue lines (the `[sigh]` in
   *  `Oh dear. [sigh] What now?`). Default `true` (full text). `false` strips every cue + its delimiters
   *  and collapses the whitespace - for a player who hears the audio and doesn't want the captions.
   *  Toggle live with `engine.setClosedCaptions(...)`. */
  closedCaptions?: boolean;
  /** Diagnostics hook (opt-in, dev tooling only): fired with the choice's group id whenever a choice runs
   *  DRY - no takeable option and no eligible fallback - so it falls through silently. The behaviour is
   *  unchanged; this only makes the fall-through observable. The coverage harness uses it to flag choices
   *  that ran dry. Leave it unset in shipped games (zero cost). */
  onDryChoice?: (groupId: string) => void;
}

/** One shared `@patter` property, for a live state inspector: its ref, declared type, current value,
 *  declared default (for reset), and enum options. Mirrors the Unity / Godot ports' ListProperties. */
export interface PropertyRow {
  ref: string;
  type: PropertyType;
  value: ScalarValue | undefined;
  default: ScalarValue;
  values?: string[];
}

/** Options for opening a flow. */
export interface OpenFlowOptions {
  /** Scene to start at - its host-facing gameId (address) OR its internal id; defaults to the
   *  bundle's first scene. */
  scene?: string;
  /** Block within the scene to start at - its gameId (scene-scoped address) OR its internal id. */
  block?: string;
  /** Seed for this flow's PRNG (defaults to the engine's `seed`). */
  seed?: number;
}

interface ChoiceState {
  /** The choice group's id (saved alongside the verbatim option set - SavedChoice). */
  groupId: string;
  options: ChoiceOption[];
  byId: Map<string, SelectableNode>;
}

interface SelectorState {
  seq?: number;            // sequential cursor (visits taken)
  bag?: string[];          // shuffle: child ids still undrawn this pass (undefined = not started)
  last?: string;           // last child id picked (no-immediate-repeat across reshuffles)
}

/** Shared, read-mostly context the engine hands to every flow it owns. */
interface FlowHost {
  bundle: Bundle;
  /** IDs-only build (`localisation.mode === "ids"`, no source-debug): the engine emits each beat's ID as
   *  its text and omits character display names, leaving localisation to the game (use `flow.interpolate`
   *  to apply `{@ref}` property replacement to a string the game looked up itself). */
  emitIds: boolean;
  strings: Record<string, string>;
  /** The DEFAULT locale's string table - fallback for a key the active locale is missing (notably the
   *  cast display-name keys, seeded there from `displayName`). */
  defaultStrings: Record<string, string>;
  /** Cast canonical name -> authoring `displayName` (the unlocalised fallback when no loc string exists). */
  castDisplay: Map<string, string>;
  nodeIndex: Map<string, SelectableNode>;
  blockIndex: Map<string, { sceneId: string }>;
  blockById: Map<string, CompiledBlock>;
  /** Author tags (#215): node id -> accumulated tags (own + every ancestor's, deduped). Built once. */
  tagIndex: Map<string, string[]>;
  /** The SHARED `@patter` globals (owned scope "patter") + world properties (`@world`). */
  shared: ScopeRegistry;
  /** Decls for the shared `@patter` globals - (re)seed on `engine.reset()`. */
  patterSharedDecls: ScopeDeclaration[];
  /** Decls for the per-flow `@patter` globals - seed each flow's local registry. */
  patterLocalDecls: ScopeDeclaration[];
  /** Lowercase names of the SHARED globals (route a `@patter` ref to engine vs flow). */
  patterSharedNames: Set<string>;
  /** Per-scene set of SHARED `@scene` prop names (route a `@scene` ref to stage vs flow). */
  sceneSharedNames: Map<string, Set<string>>;
  /** World-wide per-node entry counts (node id -> times entered by any flow). */
  sharedVisits: Map<string, number>;
  /** Shared selector cursors (node id -> SelectorState) for `shared` memoried selectors. */
  sharedSelectors: Map<string, SelectorState>;
  /** Shared, scene-namespaced `@scene` bags (scene id -> name -> value) for shared scene props. */
  stageBags: Map<string, Record<string, ScalarValue>>;
  customRng?: () => number;
  /** Play a chosen option's prompt as its first beat (spec §5); default false. */
  replayPromptOnChoose?: boolean;
  /** Closed captions (#214). `captionsOn`: show caption cues in dialogue lines (default true); when
   *  false the engine strips `captionOpen`…`captionClose` spans from line text. Mutable via
   *  `setClosedCaptions` (one toggle, all flows - like setLocale). */
  captionsOn: boolean;
  captionOpen: string;
  captionClose: string;
  /** A cast member whose lines are pure captions: when captions are off ALL of its dialogue + speaker is
   *  omitted (a silent line), delimiters or not. Default `SFX`. Empty = no caption character. */
  captionCharacter: string;
  /** Diagnostics hook (opt-in, dev only): fired when a choice runs DRY - nothing takeable and no eligible
   *  fallback - so it falls through and the flow continues past it. Zero cost when unset; the coverage
   *  harness passes it to surface silent fall-throughs. Not a gameplay signal (the behaviour is unchanged). */
  onDryChoice?: (groupId: string) => void;
  /** Memoised `splitRef` results (ref string -> {scope,name}). The split depends only on `shared`'s scope
   *  set, which is fixed for the engine's life, so every effect target / `{@ref}` slot parses once. */
  refSplitCache: Map<string, { scope: string; name: string }>;
}

// ---------------------------------------------------------------------------
// Engine - the world + flow manager
// ---------------------------------------------------------------------------

export class Engine {
  private readonly host: FlowHost;
  private readonly defaultSeed: number;
  private readonly flowsById = new Map<string, Flow>();
  /** Every locale's string table (the inline `bundle.strings`), kept so the active locale can be swapped
   *  live (setLocale) without rebuilding the engine. Reassigned wholesale by `replaceStrings`
   *  (live bundle refresh, tier 1), hence not readonly. */
  private allStrings: Record<string, Record<string, string>>;
  /** The currently active locale (string lookups + character names resolve in it). */
  private currentLocale: string;
  /** True for a source-only DEBUG build (`localisation: { mode: "ids", sourceDebug: true }`) - the strings
   *  are the source language, embedded only so the build can be played; not a shippable localised build. */
  private readonly sourceDebug: boolean;
  /** Host-facing addresses (spec §6): scene gameId -> internal id (project-wide), and per-scene
   *  block gameId -> internal id. The effective gameId falls back to the name slug when unpinned. */
  private readonly sceneGameIdToId = new Map<string, string>();
  private readonly blockGameIdToId = new Map<string, Map<string, string>>();

  /** The options this engine was built with - reused verbatim by `hotSwap` so the replacement
   *  engine keeps the same world resolver, custom RNG, and diagnostic hooks. */
  private readonly creationOptions: EngineOptions;

  constructor(bundle: Bundle, options: EngineOptions = {}) {
    this.creationOptions = options;
    const locale = options.locale ?? bundle.locales.default;
    const allStrings = bundle.strings;
    this.allStrings = allStrings;
    this.currentLocale = locale;
    const strings = allStrings[locale] ?? {};
    const defaultStrings = allStrings[bundle.locales.default] ?? {};
    // Localisation mode (spec §11). "ids" + no source-debug = the engine emits beat IDs (the game localises
    // itself). A source-debug build still resolves its embedded source strings, but is flagged for a warning.
    const loc = bundle.localisation;
    const emitIds = loc?.mode === "ids" && !loc.sourceDebug;
    this.sourceDebug = loc?.mode === "ids" && !!loc.sourceDebug;
    if (this.sourceDebug && typeof console !== "undefined") {
      console.warn("[Patterplay] source-only DEBUG build: strings are the source language for debugging, not a shippable localised build.");
    }
    // Cast name -> displayName: the unlocalised fallback for a character's shown name when neither the
    // active nor the default locale carries a `cast:<name>` string.
    const castDisplay = new Map<string, string>();
    for (const c of bundle.cast ?? []) if (c.displayName) castDisplay.set(c.name, c.displayName);
    this.defaultSeed = (options.seed ?? 0x9e3779b9) >>> 0;

    const nodeIndex = new Map<string, SelectableNode>();
    const blockIndex = new Map<string, { sceneId: string }>();
    const blockById = new Map<string, CompiledBlock>();
    for (const [sceneId, scene] of Object.entries(bundle.scenes)) {
      this.sceneGameIdToId.set(effectiveGameId(scene), sceneId);
      const blockAddrs = new Map<string, string>();
      for (const block of scene.blocks) {
        blockIndex.set(block.id, { sceneId });
        blockById.set(block.id, block);
        blockAddrs.set(effectiveGameId(block), block.id);
        walkNodes<SelectableNode>(block.children, (n) => nodeIndex.set(n.id, n));
      }
      this.blockGameIdToId.set(sceneId, blockAddrs);
    }

    // Globals (`@patter`) split by the `shared` flag (default shared): shared ones
    // live in the engine's owned scope, per-flow ones seed each flow's registry.
    const props = bundle.properties ?? [];
    const patterSharedDecls = props.filter((p) => p.shared ?? true).map(toDecl);
    const patterLocalDecls = props.filter((p) => !(p.shared ?? true)).map(toDecl);
    const patterSharedNames = new Set(patterSharedDecls.map((d) => d.name.toLowerCase()));

    const shared = new ScopeRegistry().defineOwned("patter", patterSharedDecls);
    const hostBound = new Set<string>();
    // The host's World Properties resolver binds `@world`; its declarations (types, read-only) come from
    // the compiled bundle's declared world properties. An explicit binding always wins over the self-backed
    // fallback below.
    if (options.world) {
      const worldSpec = bundle.scopeRegistry?.scopes.find((s) => s.token === "world");
      const decls = (worldSpec?.declarations ?? []).map(toForeignDecl);
      shared.defineForeign("world", options.world, decls, worldSpec?.writable ?? true);
      hostBound.add("world");
    }
    // A project that DECLARES `@world` but whose embedder binds no resolver (the standalone case) gets a
    // self-backed one: a live in-memory bag seeded from the declarations' defaults. The story reads/writes
    // it like any scope; it stays *foreign* (not in Patter's save: the host owns it conceptually).
    for (const spec of bundle.scopeRegistry?.scopes ?? []) {
      if (hostBound.has(spec.token)) continue;
      const decls = (spec.declarations ?? []).map(toForeignDecl);
      shared.defineForeign(spec.token, selfBackedResolver(spec.declarations ?? []), decls, spec.writable ?? true);
    }

    // Scene props (`@scene`) split by `shared` (default per-flow): record, per
    // scene, which names are shared so a `@scene` ref routes to stage vs flow.
    const sceneSharedNames = new Map<string, Set<string>>();
    for (const [sceneId, scene] of Object.entries(bundle.scenes)) {
      const names = new Set((scene.sceneProps ?? []).filter((p) => p.shared ?? false).map((p) => p.name.toLowerCase()));
      sceneSharedNames.set(sceneId, names);
    }

    this.host = {
      bundle, emitIds, strings, defaultStrings, castDisplay, nodeIndex, blockIndex, blockById,
      tagIndex: buildTagIndex(bundle), shared,
      patterSharedDecls, patterLocalDecls, patterSharedNames, sceneSharedNames,
      sharedVisits: new Map(),
      sharedSelectors: new Map(),
      stageBags: new Map(),
      customRng: options.rng,
      onDryChoice: options.onDryChoice,
      replayPromptOnChoose: options.replayPromptOnChoose ?? false,
      captionsOn: options.closedCaptions ?? true, // captions shown by default (full text)
      captionOpen: (bundle.closedCaptions ?? DEFAULT_CAPTION_DELIMITERS).open,
      captionClose: (bundle.closedCaptions ?? DEFAULT_CAPTION_DELIMITERS).close,
      captionCharacter: bundle.closedCaptions?.character || DEFAULT_CAPTION_CHARACTER, // absent/empty -> SFX
      refSplitCache: new Map(),
    };
  }

  /** The active locale (string + character-name lookups resolve in it). */
  get locale(): string { return this.currentLocale; }

  /** True for a source-only DEBUG build: the embedded strings are the source language (for debugging),
   *  not a shippable localised build. An IDs-only ship build is `false`. */
  get isSourceDebug(): boolean { return this.sourceDebug; }

  /**
   * Switch the active locale LIVE - a real game's "language" setting can change mid-session. Subsequent
   * string lookups (new beats, re-resolved character names, `{@ref}` interpolation) render in the new
   * locale; everything else - flow position, `@patter`/`@scene` state, visit counts, the PRNG - is
   * untouched (already-emitted text isn't retro-translated; that's the host's call). A locale with no
   * table resolves every string via the `<Untranslated: {id}>` source fallback. All open flows share the
   * engine's string table, so the swap reaches every flow at once.
   */
  setLocale(locale: string): void {
    this.currentLocale = locale;
    this.host.strings = this.allStrings[locale] ?? {};
  }

  /**
   * Live bundle refresh, tier 1 (strings only): swap every locale's string table in place from a
   * freshly compiled bundle whose STRUCTURE is unchanged (same `content.structureHash`). Like
   * setLocale, nothing restarts and no flow is touched: the next delivered beat reads the new text,
   * `{@ref}` slots re-interpolate, and beats the host already received keep the words it saw. The
   * swap reaches every open flow at once and is not part of save state. Structural edits need the
   * full save/load hot swap instead (a structure change here simply won't show).
   */
  replaceStrings(bundle: Bundle): void {
    this.allStrings = bundle.strings;
    this.host.strings = this.allStrings[this.currentLocale] ?? {};
    this.host.defaultStrings = this.allStrings[this.host.bundle.locales.default] ?? {};
  }

  /**
   * Live bundle refresh, tier 2 (full swap): rebuild on an edited bundle with the whole run carried
   * over. Snapshot (`saveGame`), construct a fresh engine on `bundle` with THIS engine's original
   * options (same world resolver, RNG, hooks), restore (`loadGame`), and carry over the presentation
   * state that deliberately isn't save state (active locale, closed-captions toggle). The
   * content-drift policy (§9.8) resolves edits under the cursor: stack frames re-find their next
   * child by id, drifted options drop, a vanished snippet is skipped.
   *
   * Returns the REPLACEMENT engine; this one is left untouched and should be discarded. Hosts
   * re-bind their flow handles via `next.getFlow(id)`. If the restore throws (defensive - §9.8
   * makes this unreachable for ordinary edits), the swap falls back to a cold engine with each
   * saved flow restarted from the top of the scene it was in.
   */
  hotSwap(bundle: Bundle): Engine {
    const snapshot = this.saveGame();
    const carryOver = (next: Engine): Engine => {
      next.setLocale(this.currentLocale);
      next.setClosedCaptions(this.host.captionsOn);
      return next;
    };
    const next = new Engine(bundle, this.creationOptions);
    try {
      next.loadGame(snapshot);
      return carryOver(next);
    } catch {
      // A partial load may have mutated `next`: fall back on a THIRD, cold engine and restart each
      // flow at the top of the scene it was in (dropped when that scene is gone too).
      const fresh = new Engine(bundle, this.creationOptions);
      for (const [id, f] of Object.entries(snapshot.flows)) {
        const sceneId = f.cursor.currentSceneId;
        try { fresh.openFlow(id, sceneId !== null ? { scene: sceneId } : {}); } catch { /* scene deleted: drop the flow */ }
      }
      return carryOver(fresh);
    }
  }

  /** Whether closed captions are currently shown (full dialogue text). */
  get closedCaptions(): boolean { return this.host.captionsOn; }

  /**
   * Turn closed captions on/off LIVE (#214). When OFF, subsequent dialogue lines have their caption
   * cues (`[sigh]` etc., between the project's delimiters) and the surrounding whitespace stripped;
   * narration, choice prompts, and everything else are untouched. Like setLocale this is a presentation
   * toggle - it reaches every open flow at once and isn't part of save state; already-emitted text is
   * not retro-edited. An IDs-only game applies the same rule itself via `flow.stripCaptions`.
   */
  setClosedCaptions(on: boolean): void {
    this.host.captionsOn = on;
  }

  /**
   * Open (and start) a named flow. Each flow has its own cursor, PRNG, and per-flow
   * half of the scopes (not-shared `@patter`/`@scene`); all flows share the shared
   * half. Re-opening an existing id replaces it with a fresh flow.
   */
  openFlow(id: string, opts: OpenFlowOptions = {}): Flow {
    const sceneId = this.resolveSceneRef(opts.scene);
    const blockId = this.resolveBlockRef(sceneId, opts.block);
    const flow = new Flow(id, this.host, opts.seed ?? this.defaultSeed);
    this.flowsById.set(id, flow);
    flow.start(sceneId, blockId);
    return flow;
  }

  /** Resolve a scene reference (a gameId address OR an internal id) to its internal id. */
  private resolveSceneRef(ref?: string): string | undefined {
    if (ref == null) return undefined;
    if (this.host.bundle.scenes[ref]) return ref;          // already an internal id
    return this.sceneGameIdToId.get(ref) ?? ref;           // a gameId, else pass through (start reports)
  }

  /** Resolve a block reference (a scene-scoped gameId OR an internal id) to its internal id. */
  private resolveBlockRef(sceneId: string | undefined, ref?: string): string | undefined {
    if (ref == null) return undefined;
    if (this.host.blockById.has(ref)) return ref;          // already an internal id
    if (sceneId != null) { const id = this.blockGameIdToId.get(sceneId)?.get(ref); if (id) return id; }
    return ref;                                            // pass through (start reports an unknown block)
  }

  /** The host-facing address (gameId) of a scene / block by internal id, or undefined if unknown.
   *  The inverse of the resolve helpers - for a host that wants to display / log the address. */
  sceneAddress(sceneId: string): string | undefined {
    const scene = this.host.bundle.scenes[sceneId];
    return scene ? effectiveGameId(scene) : undefined;
  }
  blockAddress(blockId: string): string | undefined {
    const block = this.host.blockById.get(blockId);
    return block ? effectiveGameId(block) : undefined;
  }

  /**
   * Author tags (#215) accumulated for a beat by id: its own tags unioned with every ancestor's
   * (scene → block → group(s) → snippet → beat), deduped, outermost-first. The same value the beat's
   * delivered step carries. Empty array for an unknown id or a beat with no tags anywhere up the chain.
   */
  tagsForBeat(beatId: string): string[] {
    return this.host.tagIndex.get(beatId) ?? [];
  }
  /** A scene's own tags (by internal id or gameId address). Empty when none / unknown. */
  tagsForScene(sceneRef: string): string[] {
    const id = this.resolveSceneRef(sceneRef);
    return (id != null ? this.host.tagIndex.get(id) : undefined) ?? [];
  }
  /** A block's accumulated tags (scene + block), by scene + block ref (id or gameId). Empty when none / unknown. */
  tagsForBlock(sceneRef: string, blockRef: string): string[] {
    const sceneId = this.resolveSceneRef(sceneRef);
    const id = this.resolveBlockRef(sceneId, blockRef);
    return (id != null ? this.host.tagIndex.get(id) : undefined) ?? [];
  }

  /**
   * The authored structure as a nested tree: scenes -> blocks -> children (groups + snippets, groups
   * preserved) -> a snippet's beats. Static (no flow / play state); per-beat data is read at the source
   * locale. For dev tooling that builds against the writer's structure (see also {@link getBeatSequence}).
   */
  getOutline(): OutlineScene[] {
    return Object.values(this.host.bundle.scenes).map((scene) => ({
      id: scene.id,
      ...(effectiveGameId(scene) ? { gameId: effectiveGameId(scene) } : {}),
      name: scene.name,
      ...this.tagsField(scene.id),
      blocks: scene.blocks.map((block) => ({
        id: block.id,
        ...(effectiveGameId(block) ? { gameId: effectiveGameId(block) } : {}),
        name: block.name,
        ...this.tagsField(block.id),
        children: block.children.map((n) => this.outlineNode(n)),
      })),
    }));
  }

  /**
   * Every beat in document order, flattened (through groups), each with the scene / block / snippet it
   * belongs to and its static data. The linear view of {@link getOutline} - hand it to a tool that lays
   * one item per beat (e.g. an Unreal Sequencer of subsequences).
   */
  getBeatSequence(): FlatBeat[] {
    const out: FlatBeat[] = [];
    for (const scene of Object.values(this.host.bundle.scenes)) {
      for (const block of scene.blocks) {
        walkNodes<SelectableNode>(block.children, (n) => {
          if (n.type !== "snippet") return;
          for (const beat of n.beats ?? []) {
            out.push({ sceneId: scene.id, blockId: block.id, snippetId: n.id, beat: this.beatInfo(beat) });
          }
        });
      }
    }
    return out;
  }

  /** A node's outline entry: a group (selector + prompt + children) or a snippet (beats + jump). */
  private outlineNode(n: SelectableNode): OutlineNode {
    if (n.type === "group") {
      return {
        type: "group",
        id: n.id,
        ...this.tagsField(n.id),
        ...(n.selector ? { selector: n.selector } : {}),
        ...(n.prompt ? { prompt: this.beatInfo(n.prompt) } : {}),
        children: n.children.map((c) => this.outlineNode(c)),
      };
    }
    return {
      type: "snippet",
      id: n.id,
      ...this.tagsField(n.id),
      beats: (n.beats ?? []).map((b) => this.beatInfo(b)),
      ...(n.jump ? { jumpTo: n.jump.to, ...(n.jump.mode ? { jumpMode: n.jump.mode } : {}) } : {}),
    };
  }

  /** One beat's static data (source locale), the same shape a delivered step carries. */
  private beatInfo(beat: Beat): BeatInfo {
    const tags = this.host.tagIndex.get(beat.id);
    const info: BeatInfo = { id: beat.id, kind: beat.kind };
    if (beat.kind === "line") {
      if (beat.character !== undefined) {
        info.character = beat.character;
        const name = this.host.defaultStrings[castStringKey(beat.character)] ?? this.host.castDisplay.get(beat.character);
        if (name !== undefined) info.characterName = name;
      }
      if (beat.direction !== undefined) info.direction = beat.direction;
    }
    if (beat.kind === "line" || beat.kind === "text") {
      const source = this.host.defaultStrings[beat.id]; // source-locale text, un-interpolated
      if (source !== undefined) info.text = source;
    }
    if (beat.gameData && Object.keys(beat.gameData).length) info.gameData = beat.gameData;
    if (tags && tags.length) info.tags = tags;
    return info;
  }

  /** A `{ tags }` fragment for an id, present only when the id has accumulated tags (keeps output tidy). */
  private tagsField(id: string): { tags?: string[] } {
    const tags = this.host.tagIndex.get(id);
    return tags && tags.length ? { tags } : {};
  }

  /** Retrieve an open flow by id (undefined if none / closed). */
  getFlow(id: string): Flow | undefined {
    return this.flowsById.get(id);
  }

  /** All currently-open flows. */
  flows(): Flow[] {
    return [...this.flowsById.values()];
  }

  /** Close (remove) a flow. */
  closeFlow(id: string): void {
    this.flowsById.delete(id);
  }

  /**
   * Reset the whole game to its initial state: drop every flow, re-seed the shared
   * `@patter` globals to their declared defaults, and clear all shared state (shared
   * `@scene` bags, world visit counts). World properties are host-owned and untouched.
   * After reset, open fresh flows with `openFlow`.
   */
  reset(): void {
    this.flowsById.clear();
    this.host.shared.reseedOwned("patter", this.host.patterSharedDecls);
    this.host.sharedVisits.clear();
    this.host.sharedSelectors.clear();
    this.host.stageBags.clear();
  }

  /** Read a shared (`@patter` / foreign) property by ref. `@scene` refs are rejected (flow-level). */
  getProperty(ref: string): ScalarValue | undefined {
    const { scope, name } = this.splitShared(ref);
    return this.host.shared.get(scope, name);
  }

  /** Write a shared (`@patter` / foreign) property by ref. `@scene` refs are rejected (flow-level). */
  setProperty(ref: string, value: ScalarValue): void {
    const { scope, name } = this.splitShared(ref);
    this.host.shared.set(scope, name, value);
  }

  /** The shared `@patter` properties, for a live state inspector: each with its ref, type, current
   *  value, declared default (for reset), and enum options. Mirrors the Unity / Godot ports. */
  listProperties(): PropertyRow[] {
    return this.host.patterSharedDecls.map((d) => ({
      ref: `@${d.name}`,
      type: d.type as PropertyType,
      values: d.values,
      value: this.getProperty(`@${d.name}`),
      default: declDefault(d),
    }));
  }

  // @scene is scene-namespaced and needs a flow's current scene - silently
  // routing it into the shared bag (as a junk "scene.x" key) was a trap.
  private splitShared(ref: string): { scope: string; name: string } {
    let split = this.host.refSplitCache.get(ref);
    if (!split) { split = splitRef(ref, (t) => t === "scene" || this.host.shared.has(t)); this.host.refSplitCache.set(ref, split); }
    if (split.scope === "scene") {
      throw new Error(`'${ref}': @scene properties are scene-scoped - read/write them on a Flow, not the Engine`);
    }
    return split;
  }

  /** Snapshot shared `@patter` state only (for a unified cross-engine save blob, Phase D). */
  save(): EngineSave {
    return this.host.shared.save();
  }

  /** Restore shared `@patter` values (world properties untouched). */
  load(blob: EngineSave): void {
    this.host.shared.load(blob);
  }

  /** Snapshot the whole game: shared `@patter` + visit counts + every live flow. */
  saveGame(): SaveGame {
    const flows: Record<string, FlowSnapshot> = {};
    for (const [id, flow] of this.flowsById) flows[id] = flow.snapshot();
    return {
      version: 2,
      shared: this.host.shared.save(),
      sharedVisits: Object.fromEntries(this.host.sharedVisits),
      sharedSelectors: serialiseSelectors(this.host.sharedSelectors),
      stageBags: Object.fromEntries([...this.host.stageBags].map(([s, bag]) => [s, { ...bag }])),
      flows,
    };
  }

  /** Restore a `saveGame()`: shared globals + visit counts + shared scene bags + reconstruct every flow. */
  loadGame(save: SaveGame): void {
    if (save.version !== 2) throw new Error(`unsupported save version: ${save.version}`);
    this.host.shared.load(save.shared);
    this.host.sharedVisits.clear();
    for (const [id, n] of Object.entries(save.sharedVisits ?? {})) this.host.sharedVisits.set(id, n);
    this.host.sharedSelectors.clear();
    for (const [id, st] of deserialiseSelectors(save.sharedSelectors)) this.host.sharedSelectors.set(id, st);
    this.host.stageBags.clear();
    for (const [s, bag] of Object.entries(save.stageBags ?? {})) this.host.stageBags.set(s, { ...bag });
    this.flowsById.clear();
    for (const [id, snap] of Object.entries(save.flows)) {
      const flow = new Flow(id, this.host, this.defaultSeed);
      flow.restore(snap);
      this.flowsById.set(id, flow);
    }
  }
}

// ---------------------------------------------------------------------------
// Flow - one playable flow (cursor + the per-flow half of @patter/@scene + PRNG)
// ---------------------------------------------------------------------------

export class Flow {
  readonly id: string;
  private readonly host: FlowHost;
  private local: ScopeRegistry;   // owns "patter" = the NOT-shared globals (this flow's copy)
  private rngState: number;

  // Execution cursor. The `stack` is the continuation stack: each frame is a
  // position within a block's children (the top frame is the active block run;
  // lower frames are pending call-returns). A snippet's beats deliver from
  // `activeSnippet`/`beatIndex`.
  private started = false;
  private flowEnded = false;
  private currentSceneId: string | null = null;
  private stack: StackFrame[] = [];
  private activeSnippet: CompiledSnippet | null = null;
  private beatIndex = 0;
  private pendingChoice: ChoiceState | null = null;
  /** When `replayPromptOnChoose`, the chosen option's prompt beat to deliver before its content. */
  private pendingPromptBeat: LineBeat | TextBeat | null = null;
  /** The chosen option that owns `pendingPromptBeat`, so a save taken between choose() and the next
   *  advance() can re-derive the prompt on load (the beat isn't otherwise reachable by id). */
  private pendingPromptOwnerId: string | null = null;
  private selectors = new Map<string, SelectorState>();
  /** Per-node entry counts for this flow (node id -> times entered). */
  private visitCounts = new Map<string, number>();

  // Per-flow halves of the two scopes. The NOT-shared `@patter` globals live in
  // `local` (owned scope "patter"); the NOT-shared `@scene` props live in
  // `sceneBags` (namespaced per scene; they PERSIST across re-entries, spec §7).
  // The SHARED halves live on the host (`host.shared` / `host.stageBags`). Each
  // resolver presents one merged scope, routing each property to its half by the
  // declared `shared` flag.
  private sceneBags = new Map<string, Record<string, ScalarValue>>();

  private readonly patterResolver: ScopeResolver = {
    get: (n) => (this.host.patterSharedNames.has(n) ? this.host.shared.get("patter", n) : this.local.get("patter", n)),
    set: (n, v) => {
      if (this.host.patterSharedNames.has(n)) this.host.shared.set("patter", n, v);
      else this.local.set("patter", n, v);
    },
  };

  private readonly sceneResolver: ScopeResolver = {
    get: (n) => {
      const s = this.currentSceneId;
      if (s === null) return undefined;
      const bag = this.host.sceneSharedNames.get(s)?.has(n) ? this.host.stageBags.get(s) : this.sceneBags.get(s);
      return bag?.[n];
    },
    set: (n, v) => {
      const s = this.currentSceneId;
      if (s === null) return;
      const bag = this.host.sceneSharedNames.get(s)?.has(n) ? this.host.stageBags.get(s) : this.sceneBags.get(s);
      if (bag) bag[n] = v;
    },
  };

  // The eval context is built ONCE: every constituent resolves live state at
  // call time (shared bags mutate in place per scoperegistry's contract;
  // patter/scene route through this flow's resolvers, which read the current
  // `local`/`sceneBags`/`currentSceneId`; the host callbacks read current flow
  // fields). Rebuilding it per evaluation was the engine's hottest allocation.
  private readonly evalCtx: EvalContext;

  constructor(id: string, host: FlowHost, seed: number) {
    this.id = id;
    this.host = host;
    this.rngState = seed >>> 0;
    this.local = this.freshLocal();

    const scopes = { ...host.shared.toEvalContext().scopes }; // shared @patter bag + foreign resolvers
    scopes["patter"] = this.patterResolver; // override with the merged shared+per-flow view
    scopes["scene"] = this.sceneResolver;
    this.evalCtx = {
      scopes,
      host: {
        nextRandom: this.rng,
        visits: (id: string) => this.visitCounts.get(id) ?? 0,
        patterVisits: (id: string) => this.host.sharedVisits.get(id) ?? 0,
      },
    };
  }

  // -- Host API -------------------------------------------------------------

  /** Begin this flow at a scene (and optionally a specific block within it). */
  start(sceneId?: string, blockId?: string): void {
    this.sceneBags.clear();
    this.local = this.freshLocal();
    this.selectors.clear();
    this.visitCounts.clear();
    this.stack = [];
    this.currentSceneId = null;
    this.flowEnded = false;
    this.activeSnippet = null;
    this.beatIndex = 0;
    this.pendingChoice = null;
    this.started = true;

    if (blockId) {
      const loc = this.host.blockIndex.get(blockId);
      if (!loc) throw new Error(`unknown block: ${blockId}`);
      this.enterSceneSetup(loc.sceneId);
      this.stack = [{ sceneId: loc.sceneId, containerId: blockId, index: 0 }];
      this.enter(blockId);
    } else {
      const id = sceneId ?? Object.keys(this.host.bundle.scenes)[0];
      const scene = id ? this.host.bundle.scenes[id] : undefined;
      if (!scene) throw new Error(id ? `unknown scene: ${id}` : "no scenes in bundle");
      this.enterSceneSetup(id!);
      const first = scene.blocks[0];
      if (first) { this.stack = [{ sceneId: id!, containerId: first.id, index: 0 }]; this.enter(first.id); }
    }
    this.settle();
  }

  /**
   * Forget everything in this flow and begin again - its per-flow state (not-shared
   * `@patter` globals + `@scene` props), cursor, callstack, selector cursors, and
   * visit counts. Shared state (shared `@patter` / `@scene`, world visit counts) is
   * untouched. A clearer-named alias of `start()`.
   */
  reset(sceneId?: string, blockId?: string): void {
    this.start(sceneId, blockId);
  }

  /** The scene the cursor is currently in - set on entry and whenever a jump crosses scenes. Read
   *  right after `advance()` to know which scene the just-played beat lives in (tooling that mirrors
   *  the playhead, e.g. an editor following a cross-scene jump). `null` before the flow has started. */
  get currentScene(): string | null { return this.currentSceneId; }

  /** Run until the next line, game event, choice, or the end of the flow. */
  advance(): StepResult {
    if (!this.started) throw new Error("flow has not been started");
    // A replayed prompt (replayPromptOnChoose) is delivered first, before the option's content.
    if (this.pendingPromptBeat) { const b = this.pendingPromptBeat; this.pendingPromptBeat = null; this.pendingPromptOwnerId = null; return this.beatResult(b); }
    this.settle();
    if (this.flowEnded) return { type: "end" };
    if (this.pendingChoice) return { type: "choice", groupId: this.pendingChoice.groupId, options: this.pendingChoice.options };
    if (!this.activeSnippet) { this.flowEnded = true; return { type: "end" }; }
    return this.beatResult(this.activeSnippet.beats![this.beatIndex++]!);
  }

  /**
   * Advance repeatedly, collecting every played beat, until a choice or the end - the "play to the
   * next stop" a host's play UI / tooling wants. The terminal `choice` / `end` is returned as `stop`;
   * `played` holds the line / text / game-event results walked on the way to it. Termination is guaranteed
   * (each `advance()` makes progress or `settle()` throws on a contentless jump cycle).
   */
  advanceToStop(): AdvanceToStopResult {
    const played: AdvanceToStopResult["played"] = [];
    for (;;) {
      const r = this.advance();
      if (r.type === "choice" || r.type === "end") return { played, stop: r };
      played.push(r); // narrowed to line / text / game-event by the guard above
    }
  }

  /**
   * Drive the cursor to the next *deliverable* stop: a beat ready on the active
   * snippet, a pending choice, or the end. Runs onExit/jump seams and walks the
   * block run (sequentially, skipping ineligible children); a finished block pops
   * to its caller (call-return) or ends the flow.
   */
  private settle(): void {
    let transitions = 0;
    for (;;) {
      // Static validation cannot rule out jump cycles (conditions gate them),
      // so a content bug like two pure jumps jumping at each other must be an
      // error, not a hang.
      if (++transitions > 10_000) {
        throw new Error("flow did not settle after 10000 transitions - likely a jump cycle with no deliverable content");
      }
      if (this.flowEnded || this.pendingChoice) return;

      if (this.activeSnippet) {
        if (this.beatIndex < (this.activeSnippet.beats?.length ?? 0)) return; // a beat is ready
        this.runEffects(this.activeSnippet.onExit);
        const jump = this.activeSnippet.jump;
        this.activeSnippet = null;
        this.beatIndex = 0;
        this.resolveJump(jump);
        continue;
      }

      const frame = this.stack[this.stack.length - 1];
      if (!frame) { this.flowEnded = true; return; }
      if (frame.sceneId !== this.currentSceneId) this.currentSceneId = frame.sceneId; // resumed scene (no reseed)
      const children = this.childrenOf(frame.containerId);
      if (!children) { this.stack.pop(); continue; } // drifted container -> skip the frame
      while (frame.index < children.length && !this.eligible(children[frame.index]!)) frame.index++;
      if (frame.index >= children.length) { this.stack.pop(); continue; } // run exhausted -> resume caller
      this.enterChild(children[frame.index++]!); // advance past it: that's the gather/return point
    }
  }

  /** The options of a pending choice (empty when not at a choice point). */
  getChoices(): ChoiceOption[] {
    return this.pendingChoice?.options ?? [];
  }

  /** Pick an eligible option by id; the next `advance()` runs it. */
  choose(id: string): void {
    const choice = this.pendingChoice;
    if (!choice) throw new Error("no choice is pending");
    const option = choice.options.find((o) => o.id === id);
    if (!option) throw new Error(`unknown choice option: ${id}`);
    if (!option.eligible) throw new Error(`choice option is not eligible: ${id}`);
    const node = choice.byId.get(id)!;
    this.pendingChoice = null;
    // Optionally speak the chosen option's prompt back as its first beat (spec §5).
    this.pendingPromptBeat = this.host.replayPromptOnChoose ? this.promptBeatOf(node) ?? null : null;
    this.pendingPromptOwnerId = this.pendingPromptBeat ? node.id : null;
    // The block frame is already advanced past the choice group (the gather point),
    // so when the chosen option finishes without a jump, the flow continues there.
    this.enterChild(node);
  }

  isEnded(): boolean {
    return this.flowEnded;
  }

  /** Read a property by ref - `@patter` / `@scene` (each routed by its `shared` flag) or foreign. */
  getProperty(ref: string): ScalarValue | undefined {
    const { scope, name } = this.splitRef(ref);
    if (scope === "patter") return this.patterResolver.get(name);
    if (scope === "scene") return this.sceneResolver.get(name);
    return this.host.shared.get(scope, name); // foreign
  }

  /** Write a property by ref (routed by scope, then by the property's `shared` flag). */
  setProperty(ref: string, value: ScalarValue): void {
    const { scope, name } = this.splitRef(ref);
    if (scope === "patter") {
      this.patterResolver.set!(name, value);
    } else if (scope === "scene") {
      // The resolver stays graceful for expression evaluation, but a host write
      // with nowhere to land must error, not silently vanish.
      if (this.currentSceneId === null) throw new Error(`'${ref}': the flow has not entered a scene yet`);
      this.sceneResolver.set!(name, value);
    } else {
      this.host.shared.set(scope, name, value); // foreign
    }
  }

  // -- Save / restore (engine-driven) --------------------------------------

  /** @internal Snapshot this flow's cursor + per-flow scopes (not-shared `@patter`/`@scene`) + PRNG. */
  snapshot(): FlowSnapshot {
    return {
      scopes: this.local.save(), // owned scope "patter" = the NOT-shared globals (@scene saved separately)
      sceneBags: Object.fromEntries([...this.sceneBags].map(([s, bag]) => [s, { ...bag }])),
      rngState: this.rngState,
      visits: Object.fromEntries(this.visitCounts),
      cursor: {
        flowEnded: this.flowEnded,
        currentSceneId: this.currentSceneId,
        // Stamp each frame with the id of the child it would run next (nextId), so a restore against
        // an EDITED bundle re-finds the position by id instead of trusting the raw index (§9.8 /
        // live bundle refresh). A frame saved at its container's end has no next child - no stamp.
        stack: this.stack.map((f) => {
          const next = this.childrenOf(f.containerId)?.[f.index];
          return next ? { ...f, nextId: next.id } : { ...f };
        }),
        activeSnippetId: this.activeSnippet?.id ?? null,
        beatIndex: this.beatIndex,
        pendingChoice: this.pendingChoice
          ? { groupId: this.pendingChoice.groupId, options: this.pendingChoice.options.map((o) => ({ ...o })) }
          : null,
        pendingPromptOwnerId: this.pendingPromptOwnerId,
        selectors: serialiseSelectors(this.selectors),
      },
    };
  }

  /** @internal Restore this flow from a snapshot. */
  restore(snap: FlowSnapshot): void {
    this.rngState = snap.rngState >>> 0;
    this.visitCounts = new Map(Object.entries(snap.visits ?? {}));
    const c = snap.cursor;
    this.started = true;
    this.flowEnded = c.flowEnded;
    this.beatIndex = c.beatIndex;
    this.currentSceneId = c.currentSceneId;
    // Re-bind each frame to the CURRENT bundle: prefer the saved next-child id (survives siblings
    // inserted / removed / reordered before the cursor); fall back to the raw index when the id is
    // absent (an older save) or its node drifted out of the bundle (§9.8 best-effort).
    this.stack = c.stack.map((f) => {
      const { nextId, ...frame } = f;
      if (nextId !== undefined) {
        const at = this.childrenOf(frame.containerId)?.findIndex((ch) => ch.id === nextId) ?? -1;
        if (at >= 0) return { ...frame, index: at };
      }
      return { ...frame };
    });

    // Restore the per-flow @scene bags, then the per-flow @patter globals. @scene
    // resolves through `sceneResolver` over these bags, so nothing else to reseed.
    this.sceneBags = new Map(Object.entries(snap.sceneBags ?? {}).map(([s, bag]) => [s, { ...bag }]));
    this.local = this.freshLocal();
    this.local.load(snap.scopes); // loads the owned not-shared globals; shared halves live on the host

    // Content-drift policy (§9.8): if a saved position points at content deleted
    // since the save, resume best-effort rather than throwing - the missing
    // snippet / choice is dropped and play continues from the surviving stack.
    this.activeSnippet = null;
    if (c.activeSnippetId !== null) {
      const node = this.host.nodeIndex.get(c.activeSnippetId);
      if (node && node.type === "snippet") this.activeSnippet = node;
    }

    this.selectors = deserialiseSelectors(c.selectors); // this flow's (non-shared) selector cursors

    // Replay the saved option set VERBATIM (schema 9.3) - re-deriving would
    // re-evaluate conditions (double-consuming PRNG draws) and could change the
    // choice under the player. Options whose nodes drifted out of the bundle
    // are dropped; a choice with no surviving options dissolves (9.8).
    this.pendingChoice = null;
    if (c.pendingChoice !== null) {
      const byId = new Map<string, SelectableNode>();
      const options: ChoiceOption[] = [];
      for (const o of c.pendingChoice.options) {
        const node = this.host.nodeIndex.get(o.id);
        if (!node) continue;
        byId.set(o.id, node);
        options.push({ ...o });
      }
      if (options.length > 0) this.pendingChoice = { groupId: c.pendingChoice.groupId, options, byId };
    }

    // A save taken between choose() and the next advance() left a prompt still to be replayed
    // (replayPromptOnChoose). Re-derive it from the chosen option - dropped if that option drifted out
    // of the bundle (§9.8), exactly as the live choose() would have produced nothing.
    this.pendingPromptBeat = null;
    this.pendingPromptOwnerId = c.pendingPromptOwnerId ?? null;
    if (this.pendingPromptOwnerId) {
      const owner = this.host.nodeIndex.get(this.pendingPromptOwnerId);
      this.pendingPromptBeat = owner ? this.promptBeatOf(owner) ?? null : null;
      if (!this.pendingPromptBeat) this.pendingPromptOwnerId = null;
    }
  }

  // -- Scene / block / node entry ------------------------------------------

  /** Set the current scene, reset its scene-local props, run onEntry. */
  private enterSceneSetup(sceneId: string): void {
    const scene = this.host.bundle.scenes[sceneId];
    if (!scene) throw new Error(`unknown scene: ${sceneId}`);
    this.currentSceneId = sceneId;
    this.enter(sceneId);
    this.seedScene(scene);           // seeds @scene defaults (per-flow on first entry; shared once globally)
    this.runEffects(scene.onEntry);  // on-entry effects still fire every entry (spec §4)
  }

  /**
   * Play one child of the active run. A snippet begins delivering. A group is
   * walked by its selector: the default `run` pushes a nested run (its children
   * play in order, gathering back); `choice` stops for the host; a select-one
   * selector (branch, or a `sequence` in any order x exhaust mode) picks ONE child (recursing
   * to a leaf) - selecting nothing contributes no content and the run continues.
   */
  private enterChild(node: SelectableNode): void {
    this.enter(node.id);
    if (node.type === "snippet") { this.beginSnippet(node); return; }
    const selector = node.selector ?? "run";
    if (selector === "run") {
      this.stack.push({ sceneId: this.currentSceneId!, containerId: node.id, index: 0 });
      return;
    }
    if (selector === "choice") { this.setupChoice(node); return; }
    const pick = this.selectChild(node);
    if (pick) this.enterChild(pick);
  }

  /** A container's children, whether it's a block or a run-group; undefined if the id is gone. */
  private childrenOf(containerId: string): SelectableNode[] | undefined {
    const block = this.host.blockById.get(containerId);
    if (block) return block.children;
    const node = this.host.nodeIndex.get(containerId);
    if (node && node.type === "group") return node.children;
    return undefined; // content drift: the container was deleted since the save
  }

  private beginSnippet(snippet: CompiledSnippet): void {
    this.runEffects(snippet.onEnter);
    this.activeSnippet = snippet;
    this.beatIndex = 0;
  }

  private setupChoice(group: CompiledGroup): void {
    const options: ChoiceOption[] = [];
    const byId = new Map<string, SelectableNode>();
    const fallbacks: SelectableNode[] = [];
    for (const child of group.children) {
      // An option is an Option group (its content runs + gathers back) or - the
      // degenerate shape - a single snippet. prompt / sticky / fallback / secretUntilEligible
      // live on whichever (spec §5).
      if (child.fallback === true) { fallbacks.push(child); continue; } // never a normal option; auto-followed when last
      // Once-only (default): once the player has followed it, it is GONE from the choice entirely -
      // not delivered, not flagged unavailable, simply absent. A `sticky` option is never consumed,
      // so it stays available as long as its condition passes. Consumption is the existing per-flow
      // visit count, so it persists through save/restore for free.
      if (child.sticky !== true && (this.visitCounts.get(child.id) ?? 0) >= 1) continue;
      const eligible = this.eligible(child);
      const hidden = child.secretUntilEligible === true;
      if (!eligible && hidden) continue; // secret while ineligible; otherwise an ineligible option shows greyed
      options.push({ id: child.id, prompt: this.promptFor(child), eligible, gameData: child.gameData });
      byId.set(child.id, child);
    }
    if (options.length > 0) { this.pendingChoice = { groupId: group.id, options, byId }; return; }
    // No normal option survives. Auto-follow the fallback if it is eligible (its own condition still
    // applies); otherwise the choice GATHERS - it contributes nothing and the run continues past it
    // (a dry choice falls through rather than deadlocking; the validator warns about choices that can
    // run dry with no fallback).
    const fallback = fallbacks.find((f) => this.eligible(f));
    if (fallback) { this.enterChild(fallback); return; }
    // Nothing takeable and no eligible fallback: the choice runs dry and the flow walks past it. The
    // behaviour is unchanged; the opt-in diagnostics hook makes this silent fall-through observable.
    this.host.onDryChoice?.(group.id);
  }

  // -- Jumps (jump / call-return) ----------------------------------------

  private resolveJump(jump: Jump | undefined): void {
    // No jump: gather - the snippet falls through and the block run continues
    // (settle's frame walk picks the next child, or pops to a caller).
    if (!jump) return;
    this.enterTarget(jump.to, jump.mode === "call" ? "call" : "jump");
  }

  /**
   * Route to a target (scene / block / `END`). `call` PUSHES a return frame (the
   * caller's block run, already advanced to its next child, stays below); `jump`
   * is absolute - it REPLACES the whole stack, discarding pending returns. `END`
   * hard-ends the flow regardless of the callstack.
   */
  private enterTarget(to: string, mode: "call" | "jump"): void {
    if (to === "END") { this.flowEnded = true; this.stack = []; return; }

    let sceneId: string;
    let containerId: string;
    const scene = this.host.bundle.scenes[to];
    if (scene) {
      this.enterSceneSetup(to);
      const first = scene.blocks[0];
      if (!first) { if (mode === "jump") this.stack = []; return; } // empty scene
      sceneId = to; containerId = first.id;
    } else {
      const loc = this.host.blockIndex.get(to);
      if (!loc) throw new Error(`jump target not found: ${to}`);
      if (loc.sceneId !== this.currentSceneId) this.enterSceneSetup(loc.sceneId);
      sceneId = loc.sceneId; containerId = to;
    }

    this.enter(containerId); // count the entered block
    const frame: StackFrame = { sceneId, containerId, index: 0 };
    if (mode === "call") this.stack.push(frame);
    else this.stack = [frame];
  }

  // -- Selectors ------------------------------------------------------------

  private selectChild(group: CompiledGroup): SelectableNode | null {
    const eligible = group.children.filter((c) => this.eligible(c));
    if (eligible.length === 0) return null;
    const st = this.selectorState(group);

    switch (group.selector) {
      case "branch":
        return eligible[0]!;

      case "sequence": {
        const order = group.options?.order ?? "sequential";
        const exhaust = group.options?.exhaust ?? "once";
        return order === "shuffle" ? this.pickShuffle(eligible, exhaust, st)
          : order === "specificity" ? this.pickSpecificity(eligible, exhaust, st)
          : this.pickSequential(eligible, exhaust, st);
      }

      case "run":
      case "choice":
      default:
        return null; // run / choice / default are handled in enterChild, not here
    }
  }

  /** `sequence` with `order: "sequential"` - walk children in authored order. */
  private pickSequential(eligible: SelectableNode[], exhaust: string, st: SelectorState): SelectableNode | null {
    const len = eligible.length;
    const n = st.seq ?? 0;
    st.seq = n + 1;
    if (exhaust === "repeat") return eligible[n % len]!;   // cycle
    if (n < len) return eligible[n]!;                       // still in the first pass
    if (exhaust === "stick") return eligible[len - 1]!;     // hold the last forever (stopping)
    return null;                                            // once: nothing after the pass
  }

  /**
   * `sequence` with `order: "shuffle"` - draw WITHOUT replacement (a bag), never
   * repeating the immediately-previous pick across a reshuffle (no line twice in a
   * row when >=2 are eligible). `stick` holds out the last authored child as the
   * permanent terminal; `once` stops after one pass; `repeat` reshuffles.
   */
  private pickShuffle(eligible: SelectableNode[], exhaust: string, st: SelectorState): SelectableNode | null {
    const len = eligible.length;
    const stick = exhaust === "stick";
    const fill = (): string[] => (stick ? eligible.slice(0, len - 1) : eligible).map((c) => c.id);

    if (st.bag === undefined) st.bag = fill();
    if (st.bag.length === 0) {                 // a full pass just completed
      if (exhaust === "once") return null;
      if (stick) { const last = eligible[len - 1]!; st.last = last.id; return last; }
      st.bag = fill();                          // repeat: reshuffle
    }

    // Draw without replacement, never repeating the immediately-previous pick. Done allocation-free:
    // rather than materialise a filtered pool, find last's slot `p` and draw into the reduced span,
    // skipping that slot - identical distribution to filtering it out, then erase the pick in place.
    const pool = st.bag;
    const p = st.last !== undefined && pool.length > 1 ? pool.indexOf(st.last) : -1;
    let i = Math.floor(this.rng() * (p >= 0 ? pool.length - 1 : pool.length));
    if (p >= 0 && i >= p) i++;
    const id = pool[i]!;
    pool.splice(i, 1);
    st.last = id;
    return eligible.find((c) => c.id === id)!;
  }

  /**
   * `sequence` with `order: "specificity"` - **Best match**: score every eligible child by how
   * specifically its condition fits the CURRENT state (`matchedSpec`), keep the top-scoring tier,
   * and break ties with the seeded shuffle (no immediate repeat). A child with no condition scores
   * 0, so it is the filler that wins only when nothing more specific is eligible.
   *
   * `exhaust` composes as it does for the other orders: `repeat` re-scores the full eligible set
   * every draw (re-pickable - the character keeps preferring the on-topic line); `once` uses each
   * pick up (a bag of remaining ids), so as specific lines are consumed the group slides down to
   * less-specific ones and finally the filler, then yields null; `stick` degrades like `once` but
   * holds the final pick forever instead of drying up.
   */
  private pickSpecificity(eligible: SelectableNode[], exhaust: string, st: SelectorState): SelectableNode | null {
    let pool = eligible;
    if (exhaust !== "repeat") {                       // once / stick: draw without replacement
      if (st.bag === undefined) st.bag = eligible.map((c) => c.id);
      const remaining = new Set(st.bag);
      pool = eligible.filter((c) => remaining.has(c.id));
      if (pool.length === 0) {                        // every child used up
        return exhaust === "stick" && st.last !== undefined
          ? eligible.find((c) => c.id === st.last) ?? null   // hold the last pick if still eligible
          : null;
      }
    }

    // Top specificity tier among the drawable pool.
    let best = -1;
    const scored = pool.map((c) => { const s = this.specScore(c); if (s > best) best = s; return { c, s }; });
    const tier = scored.filter((x) => x.s === best).map((x) => x.c);

    // Tie-break by the seeded PRNG, never repeating the immediately-previous pick (matches shuffle).
    // A lone top-tier child is returned WITHOUT drawing, so a clear winner consumes no randomness.
    let pick: SelectableNode;
    if (tier.length === 1) {
      pick = tier[0]!;
    } else {
      const p = st.last !== undefined ? tier.findIndex((c) => c.id === st.last) : -1;
      let i = Math.floor(this.rng() * (p >= 0 ? tier.length - 1 : tier.length));
      if (p >= 0 && i >= p) i++;
      pick = tier[i]!;
    }

    if (exhaust !== "repeat") st.bag = st.bag!.filter((id) => id !== pick.id);
    st.last = pick.id;
    return pick;
  }

  /** A child's Best-match score against the current state: 0 when it has no condition (the filler
   *  tier), else the specificity of its (already-passing) condition. */
  private specScore(node: SelectableNode): number {
    return node.condition ? this.matchedSpec(this.conditionAst(node.condition), true) : 0;
  }

  /**
   * The **matched-specificity** metric (parity contract): how many atomic constraints are actively
   * holding this condition TRUE against the live state. Evaluation-aware, not a static clause count -
   * it walks the tree with a De-Morgan polarity flag so `or` and `not` score the branch that is
   * actually carrying the truth. `want` = "does this subtree need to be true for the whole condition
   * to hold?" (true at the root). Only `and`/`or`/`not`/`check_flags` are structural; every other
   * node (comparisons, scoped vars, literals, other calls) is an atom, evaluated whole.
   */
  private matchedSpec(node: ExprNode, want: boolean): number {
    // Delegates to the shared @wildwinter/expr-specificity scorer (same walk,
    // shared with Storylet Studio). We supply Patter's truthiness rule and keep
    // check_flags counting via the package's default counting call.
    const evalTruthy: EvalTruthy = (n) => truthy(evaluate(n, this.evalCtx, patterDialect));
    return scoreSpecificity(node, evalTruthy, { want });
  }

  /** A selector's cursor state - shared across flows (`group.shared`) or this flow's own. */
  private selectorState(group: CompiledGroup): SelectorState {
    const map = group.shared ? this.host.sharedSelectors : this.selectors;
    let st = map.get(group.id);
    if (!st) { st = {}; map.set(group.id, st); }
    return st;
  }

  // -- Effects + expressions ------------------------------------------------

  private runEffects(effects: CompiledEffect[] | undefined): void {
    // SET-ONLY (spec §15): an effect mutates a property. Host events ride on gameData, not effects.
    for (const e of effects ?? []) {
      this.setProperty(e.target, this.evalExpr(e.value));
    }
  }

  private eligible(node: SelectableNode): boolean {
    if (!node.condition) return true;
    return truthy(this.evalExpr(node.condition));
  }

  private evalExpr(expr: Expression): ScalarValue {
    return evaluate(this.conditionAst(expr), this.evalCtx, patterDialect);
  }

  /** The deserialised (in-memory) AST for an expression, cached per Expression. Shared by the
   *  evaluator and the Best-match specificity walker so both work off one parse. */
  private conditionAst(expr: Expression): ExprNode {
    let ast = astCache.get(expr);
    if (!ast) { ast = deserialiseAst(expr.ast); astCache.set(expr, ast); }
    return ast;
  }

  /** Record an entry of a node (entered-only; spec §7): bumps the flow + world counts. */
  private enter(id: string): void {
    this.visitCounts.set(id, (this.visitCounts.get(id) ?? 0) + 1);
    this.host.sharedVisits.set(id, (this.host.sharedVisits.get(id) ?? 0) + 1);
  }

  /** Next float in [0, 1): the shared custom PRNG, or this flow's serialisable mulberry32. */
  private readonly rng = (): number => {
    if (this.host.customRng) return this.host.customRng();
    const a = (this.rngState + 0x6d2b79f5) | 0;
    this.rngState = a;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // -- Strings / beats ------------------------------------------------------

  private beatResult(beat: Beat): StepResult {
    // Accumulated author tags (#215): the beat's own tags unioned with every
    // ancestor's. Omitted from the step when empty (parity with `gameData`).
    const tags = this.host.tagIndex.get(beat.id);
    const withTags = tags && tags.length ? { tags } : {};
    // Inline `{@ref}` interpolation (spec §16): text beats always interpolate;
    // line beats interpolate only in a non-voiced project (voiced lines are
    // static). Game-event beats carry no localised content.
    switch (beat.kind) {
      case "gameEvent":
        return { type: "gameEvent", id: beat.id, gameData: beat.gameData, ...withTags };
      case "text":
        return { type: "text", id: beat.id, text: this.interpolate(this.resolveString(beat.id)), gameData: beat.gameData, ...withTags };
      case "line": {
        const raw = this.resolveString(beat.id);
        // Closed captions (#214) apply to DIALOGUE lines only: strip cues when captions are off. Two ways a
        // line goes SILENT (off only): the caption CHARACTER speaks it (whole line is a caption - omit all
        // dialogue, delimiters or not), or stripping cues leaves it empty. A silent line still FIRES (audio
        // plays + visits count) but carries no text + no speaker, so no caption shows.
        const off = !this.host.captionsOn;
        const captionChar = off && beat.character === this.host.captionCharacter; // captionCharacter is always set (defaults SFX)
        const text = captionChar ? "" : this.captionLine(this.host.bundle.voiced ? raw : this.interpolate(raw));
        const silent = off && text.length === 0;
        return {
          type: "line",
          id: beat.id,
          text,
          character: silent ? undefined : beat.character,
          characterName: silent ? undefined : this.resolveCharacterName(beat.character),
          direction: silent ? undefined : beat.direction,
          gameData: beat.gameData,
          ...withTags,
        };
      }
    }
  }

  /**
   * Expand inline `{@ref}` slots (spec §16) against this flow's CURRENT property state. Public so an
   * IDs-only game can apply the same property replacement to a string it looked up in its own loc system:
   * the engine handed it the beat ID, the game fetched its translation, then calls `flow.interpolate(...)`.
   */
  interpolate(raw: string): string {
    return interpolate(raw, (ref) => this.getProperty(ref));
  }

  /**
   * Apply the project's caption rule to a string UNCONDITIONALLY (#214): remove every cue span between
   * the project's delimiters and collapse the whitespace. Public so an IDs-only game - which looks up
   * its own strings - can match the embedded runtime: `flow.stripCaptions(flow.interpolate(text))` when
   * its own captions setting is off. (Embedded play does this automatically for dialogue lines.)
   */
  stripCaptions(raw: string): string {
    return stripCaptions(raw, this.host.captionOpen, this.host.captionClose);
  }

  /** Caption-strip a dialogue line ONLY when captions are off; otherwise pass the text through. The
   *  internal gate the engine applies to every `line` beat / line-kind prompt. */
  private captionLine(text: string): string {
    return this.host.captionsOn ? text : this.stripCaptions(text);
  }

  /**
   * An option's prompt (spec §5): the Option group's `prompt` beat, resolved + interpolated
   * (choice labels are on-screen text, so they interpolate, spec §16). For the degenerate
   * bare-snippet tolerance - or an Option group authored without a prompt - it falls back to the
   * option's first content line. NO look-ahead. Undefined only when even that is absent.
   */
  private promptFor(node: SelectableNode): ChoicePrompt | undefined {
    const beat = this.promptBeatOf(node);
    if (!beat) return undefined;
    const text = this.interpolate(this.resolveString(beat.id));
    // A line-kind prompt is dialogue, so captions apply to it; a text-kind prompt is left as-is.
    return beat.kind === "line"
      ? { kind: "line", text: this.captionLine(text), character: beat.character, characterName: this.resolveCharacterName(beat.character), direction: beat.direction }
      : { kind: "text", text };
  }

  /** The prompt BEAT of an option: the Option group's `prompt`, else (tolerance) its first content line. */
  private promptBeatOf(node: SelectableNode): LineBeat | TextBeat | undefined {
    if (node.type === "group" && node.prompt) return node.prompt;
    const snippet = node.type === "snippet" ? node : this.firstTextSnippetIn(node.children);
    return (snippet?.beats ?? []).find((b): b is LineBeat | TextBeat => b.kind === "line" || b.kind === "text");
  }

  /** The first snippet with a line/text beat within a child list, depth-first in authored order. */
  private firstTextSnippetIn(children: SelectableNode[]): CompiledSnippet | undefined {
    let found: CompiledSnippet | undefined;
    walkNodes<SelectableNode>(children, (n) => {
      if (!found && n.type === "snippet" && (n.beats ?? []).some((b) => b.kind === "line" || b.kind === "text")) {
        found = n;
      }
    });
    return found;
  }

  private resolveString(id: string): string {
    if (this.host.emitIds) return id; // IDs-only build: the game resolves text from this id itself
    const active = this.host.strings[id];
    if (active !== undefined) return active;
    // A key the active locale is missing falls back to the default-locale (source) text, but is flagged
    // LOUDLY: an untranslated string is a hard fail authors must notice, not silently paper over. Only a
    // key absent from the default locale too (never extracted) degrades to its bare id.
    const source = this.host.defaultStrings[id];
    return source !== undefined ? `<Untranslated: ${id}> ${source}` : id;
  }

  /** A character's player-facing name: the `cast:<name>` string in the active locale, else the default
   *  locale, else the authoring `displayName`. Undefined when the character has no display name at all
   *  (the host falls back to the `character` token itself). */
  private resolveCharacterName(character: string | undefined): string | undefined {
    if (character === undefined) return undefined;
    if (this.host.emitIds) return undefined; // IDs-only: omit the display name; the game maps the `character` token
    const key = castStringKey(character);
    return this.host.strings[key] ?? this.host.defaultStrings[key] ?? this.host.castDisplay.get(character);
  }

  /** Split a ref into scope + name. Tokens: `@scene`, foreign tokens, else `@patter` (incl. bare `@name`). */
  private splitRef(ref: string): { scope: string; name: string } {
    // host.shared.has("patter") is true, so it covers @patter + every foreign token; @scene is explicit.
    let hit = this.host.refSplitCache.get(ref);
    if (!hit) { hit = splitRef(ref, (t) => t === "scene" || this.host.shared.has(t)); this.host.refSplitCache.set(ref, hit); }
    return hit;
  }

  /** The per-flow registry: the NOT-shared `@patter` globals (the shared ones live on the host). */
  private freshLocal(): ScopeRegistry {
    return new ScopeRegistry().defineOwned("patter", this.host.patterLocalDecls);
  }

  /**
   * Seed a scene's `@scene` props (spec §7). The not-shared props seed THIS flow's
   * bag the first time it enters (persist across re-entries thereafter); the shared
   * props seed the host's stage bag the first time ANY flow enters the scene (shared
   * and persistent thereafter - a later flow finds it present and leaves it).
   * `temporary` props are the exception: reseeded to their default on every entry.
   */
  private seedScene(scene: CompiledScene): void {
    const shared = this.host.sceneSharedNames.get(scene.id) ?? new Set<string>();
    if (!this.sceneBags.has(scene.id)) {
      const bag: Record<string, ScalarValue> = {};
      for (const decl of scene.sceneProps ?? []) {
        const name = decl.name.toLowerCase();
        if (!shared.has(name)) bag[name] = sceneDefault(decl);
      }
      this.sceneBags.set(scene.id, bag);
    }
    if (!this.host.stageBags.has(scene.id)) {
      const bag: Record<string, ScalarValue> = {};
      for (const decl of scene.sceneProps ?? []) {
        const name = decl.name.toLowerCase();
        if (shared.has(name)) bag[name] = sceneDefault(decl);
      }
      this.host.stageBags.set(scene.id, bag);
    }

    // `temporary` props are reseeded to their default on EVERY entry ("fresh each
    // playthrough"), rather than persisting across re-entries like the rest.
    for (const decl of scene.sceneProps ?? []) {
      if (!decl.temporary) continue;
      const name = decl.name.toLowerCase();
      const bag = shared.has(name) ? this.host.stageBags.get(scene.id) : this.sceneBags.get(scene.id);
      if (bag) bag[name] = sceneDefault(decl);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/** Serialise a `sequence` selector-cursor map to plain snapshots. */
function serialiseSelectors(map: Map<string, SelectorState>): Record<string, SelectorSnapshot> {
  const out: Record<string, SelectorSnapshot> = {};
  for (const [id, st] of map) {
    const v: SelectorSnapshot = {};
    if (st.seq !== undefined) v.seq = st.seq;
    if (st.bag) v.bag = [...st.bag];
    if (st.last !== undefined) v.last = st.last;
    out[id] = v;
  }
  return out;
}

/** Rebuild a `sequence` selector-cursor map from snapshots. */
function deserialiseSelectors(rec: Record<string, SelectorSnapshot> | undefined): Map<string, SelectorState> {
  const map = new Map<string, SelectorState>();
  for (const [id, v] of Object.entries(rec ?? {})) {
    const st: SelectorState = {};
    if (v.seq !== undefined) st.seq = v.seq;
    if (v.bag) st.bag = [...v.bag];
    if (v.last !== undefined) st.last = v.last;
    map.set(id, st);
  }
  return map;
}

/** Adapt a Patter `PropertyDecl` to a registry `ScopeDeclaration` (same type vocabulary). */
function toDecl(decl: PropertyDecl): ScopeDeclaration {
  return { name: decl.name, type: decl.type, values: decl.values, default: decl.default };
}

/** A shared-decl's value for reset-to-default: its declared default, else the type default. */
function declDefault(d: ScopeDeclaration): ScalarValue {
  if (d.default !== undefined) return d.default;
  switch (d.type) {
    case "number": return 0;
    case "string": return "";
    case "flags": return [];
    case "enum": return d.values?.[0] ?? "";
    default: return false; // boolean (and any unknown) → false
  }
}

/** A host-scope declaration (`@world.x`) → registry declaration. */
function toForeignDecl(decl: HostScopeDecl): ScopeDeclaration {
  return { name: decl.name, type: decl.type, values: decl.values, default: decl.default, writable: decl.writable };
}

/** The seed value for a host-scope property: its declared default, else the type default. */
function hostScopeDefault(decl: HostScopeDecl): ScalarValue {
  if (decl.default !== undefined) return decl.default;
  switch (decl.type) {
    case "boolean": return false;
    case "number": return 0;
    case "string": return "";
    case "flags": return [];
    case "enum": return decl.values?.[0] ?? "";
  }
}

/** Build a live in-memory `{ get, set }` resolver for a self-backed host scope (the standalone `@world`):
 *  a plain bag seeded from declaration defaults. Declared-but-unseeded names still read `undefined`; an
 *  opaque scope (no declarations) starts empty and accepts any name. Per-property read-only is enforced at
 *  validation, not here (the registry is per-scope), so `set` accepts any name. */
function selfBackedResolver(decls: HostScopeDecl[]): ScopeResolver {
  const bag = new Map<string, ScalarValue>();
  for (const d of decls) bag.set(d.name, hostScopeDefault(d));
  return {
    get: (name) => bag.get(name),
    set: (name, value) => { bag.set(name, value); },
  };
}

/** The seed value for a scene-local property (its `default`, else the type default). */
function sceneDefault(decl: PropertyDecl): ScalarValue {
  if (decl.default !== undefined) return decl.default;
  switch (decl.type) {
    case "boolean": return false;
    case "number": return 0;
    case "string": return "";
    case "flags": return [];
    case "enum": return decl.values?.[0] ?? "";
  }
}

function truthy(v: ScalarValue): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v !== "";
  return v.length > 0; // string[]
}
