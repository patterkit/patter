// ---------------------------------------------------------------------------
// @patterkit/model - Patter data-model types (the shape source-of-truth).
//
// Faithful to the on-disk schema spec. Covers the SOURCE format - the flow tree
// (scene/block/group/snippet/beat/jump), the project file, locale files, the
// authoring file - and, at the bottom, the EXPORT BUNDLE types (schema §10).
// Save / runtime-state types (schema §9) live with the runtime.
//
// All conditions and effect expressions are stored as `src` strings here (no
// AST in source); see @wildwinter/expr for the expression language.
// ---------------------------------------------------------------------------

import type { AstNode } from "@wildwinter/expr";

export type ScalarValue = boolean | number | string | string[];

/** Developer-defined host metadata (spec §17). Opaque to Patter. */
export type GameData = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Effects (spec §15) - state mutation at snippet seams. SET-ONLY: an effect is a property
// mutation and nothing else. Host event emission is NOT an effect - it rides on gameData
// (snippet- or beat-level), see spec §15 "Host calls".
// ---------------------------------------------------------------------------

export type Effect =
  // property mutation: assign `target` (a ref "@name" / "@scope.name") the result of `value`.
  { kind: "set"; target: string; value: string };

// ---------------------------------------------------------------------------
// Jumps (spec §3) - a snippet's optional routing action.
// ---------------------------------------------------------------------------

/** A scene/block id, or the reserved "END". */
export type JumpTarget = string;

export interface Jump {
  to: JumpTarget;
  /** "jump" (one-way, default) or "call" (jump-and-return via the flow callstack). */
  mode?: "jump" | "call";
}

// ---------------------------------------------------------------------------
// Beats (spec §2) - the atomic content units inside a snippet.
// ---------------------------------------------------------------------------

// A scene holds any mix of the three kinds (spec §2): spoken dialogue, prose
// narration, and engine instructions.

export interface LineBeat {
  id: string;
  kind: "line";
  /** Speaker; must be a member of the project cast (validated). */
  character?: string;
  /** Performance direction, language-neutral (never localised). */
  direction?: string;
  gameData?: GameData;
  /** Author-defined freeform tags (#215): a cross-cutting label layer that travels to the runtime.
   *  At runtime a beat's tags are the UNION of its own and every ancestor's (scene → block → group(s) →
   *  snippet → beat). Each tag is letters/digits/symbols with NO comma and NO whitespace; deduped. */
  tags?: string[];
}

/**
 * Authorial voice / narration - speaker-less prose (spec §2). Never voiced; its
 * localised text always permits inline `{@name}` interpolation (spec §16). This
 * is the on-screen-text role (e.g. "A door slams!") - distinct from a game-event
 * beat, which is a pure engine instruction with no localised content.
 */
export interface TextBeat {
  id: string;
  kind: "text";
  gameData?: GameData;
  /** Author tags (#215). See LineBeat.tags. */
  tags?: string[];
}

/**
 * A GAME EVENT (spec §2): a pure engine instruction with no player-facing text - just `gameData` the host
 * reads when the beat plays (comments / docs attach via the authoring file by id). Named "game event"
 * rather than "action" because a screenplay's "action" is prose, which is our text beat. Player-facing
 * words are a line or text beat instead.
 */
export interface GameEventBeat {
  id: string;
  kind: "gameEvent";
  gameData?: GameData;
  /** Author tags (#215). See LineBeat.tags. */
  tags?: string[];
}

export type Beat = LineBeat | TextBeat | GameEventBeat;

// ---------------------------------------------------------------------------
// Selectable nodes - Group and Snippet (spec §2, §4).
// ---------------------------------------------------------------------------

export type Selector =
  | "run" | "branch" | "sequence" | "choice";

/** How a `sequence` walks its children. `specificity` = **Best match**: pick the eligible
 *  child whose condition most specifically fits the current state (the most atomic constraints
 *  actively holding it true); equally-specific ties break by the seeded shuffle. A child with no
 *  condition scores zero, so it acts as the filler that wins only when nothing more specific is
 *  eligible. Composes with `exhaust`: `repeat` re-scores every visit (re-pickable, the Best-match
 *  default), `once` uses each pick up so the group slides down to the filler (graceful degradation). */
export type SelectorOrder = "sequential" | "shuffle" | "specificity";
/** What a `sequence` does after one full pass through its children. */
export type SelectorExhaust = "once" | "repeat" | "stick";

/**
 * `sequence` selector config (spec §4). One stateful picker with two orthogonal
 * axes subsumes Ink's stopping / cycle / once / shuffle and their combinations.
 * Defaults: `order: "sequential"`, `exhaust: "once"`. `shuffle` draws without
 * replacement and never repeats a line back-to-back (built in).
 */
export interface SequenceOptions {
  order?: SelectorOrder;
  exhaust?: SelectorExhaust;
}

export interface Snippet {
  id: string;
  type: "snippet";
  /** Eligibility (and the conditional-jump test). Expression src. */
  condition?: string;
  /** Zero or more beats; zero beats + a jump = a pure jump (spec §3). */
  beats?: Beat[];
  onEnter?: Effect[];
  onExit?: Effect[];
  gameData?: GameData;
  /** Author tags (#215). See LineBeat.tags. */
  tags?: string[];
  /** Optional routing action; fires after `beats`. */
  jump?: Jump;
  // Choice-option field (only meaningful when this snippet is a bare `choice` child,
  // the runtime-tolerance shape, spec §5): the option's prompt is its first content line.
  /** Omit this option entirely when its condition fails (default: show greyed). */
  secretUntilEligible?: boolean;
  /** Repeatable choice option (spec §5). `true`: always offered while its condition passes (Ink `+`).
   *  Default `false`: once-only - after the player follows it once it is gone from `getChoices`
   *  entirely (not delivered, not flagged unavailable - just absent; Ink `*`). */
  sticky?: boolean;
  /** The choice's fallback option (spec §5). Never delivered as a normal option; auto-followed the
   *  moment it is the ONLY eligible option left (its own condition still applies). At most one per
   *  choice. Default `false`. */
  fallback?: boolean;
}

/** An option's prompt beat (spec §5): a single line | text beat - the choice text. */
export type PromptBeat = LineBeat | TextBeat;

export interface Group {
  id: string;
  type: "group";
  condition?: string;
  /** How the group's children are walked. Default (omitted) = `"run"`: play them in order. */
  selector?: Selector;
  /**
   * For the memoried `sequence` selector (spec §7): is the selector's cursor
   * SHARED across all flows (one cursor world-wide - e.g. two NPCs never draw the
   * same shuffled line) or kept per-flow? Default `false` (per-flow). Orthogonal to
   * a property's `shared` flag; same name, same idea.
   */
  shared?: boolean;
  /** `sequence` config (order × exhaust, spec §4). */
  options?: SequenceOptions;
  children: Array<Group | Snippet>;
  gameData?: GameData;
  /** Author tags (#215). See LineBeat.tags. */
  tags?: string[];
  // Option-position fields (spec §5): valid ONLY when this group is a direct child
  // of a `choice` group - where it is an OPTION whose `children` are the option's
  // content run. Validator-enforced; never carried by a normal group.
  /** The choice text (spec §5): a single line | text beat, always present on an
   *  authored option. IS the host's choice text - no derivation, no look-ahead. */
  prompt?: PromptBeat;
  /** Keep this option out of `getChoices()` while ineligible (secrecy). Default false. */
  secretUntilEligible?: boolean;
  /** Repeatable choice option (spec §5). `true`: always offered while its condition passes (Ink `+`).
   *  Default `false`: once-only - after the player follows it once it is gone from `getChoices`
   *  entirely (not delivered, not flagged unavailable - just absent; Ink `*`). */
  sticky?: boolean;
  /** The choice's fallback option (spec §5). Never delivered as a normal option; auto-followed the
   *  moment it is the ONLY eligible option left (its own condition still applies). At most one per
   *  choice. Default `false`. */
  fallback?: boolean;
}

// ---------------------------------------------------------------------------
// Addressable nodes - Block and Scene (spec §2).
// ---------------------------------------------------------------------------

export interface Block {
  id: string;
  type: "block";
  /** Mandatory, author-editable (jump targets must show a readable destination). */
  name: string;
  /**
   * The author-editable, host-facing ADDRESS (spec §6) - a readable slug the runtime targets
   * ("play this block"), distinct from the opaque immutable `id` (the internal join key). Absent =
   * derived from `name` (`effectiveGameId`); present = author-pinned (survives renames). Unique
   * within its scene (scene-scoped addressing). Hyphen-slug form (see core `gameIdify`).
   */
  gameId?: string;
  children: Array<Group | Snippet>;
  gameData?: GameData;
  /** Author tags (#215). See LineBeat.tags. */
  tags?: string[];
}

export interface Scene {
  id: string;
  type: "scene";
  name: string;
  /**
   * The author-editable, host-facing ADDRESS (spec §6) - a readable slug the runtime targets
   * ("play this scene"), distinct from the opaque immutable `id`. Absent = derived from `name`
   * (`effectiveGameId`); present = author-pinned. Unique project-wide. Hyphen-slug form (core `gameIdify`).
   */
  gameId?: string;
  /** Host metadata - e.g. `location` lives here, not as a core field. */
  gameData?: GameData;
  /** Author tags (#215). See LineBeat.tags. */
  tags?: string[];
  /** Entry behaviour / setup (spec §15). */
  onEntry?: Effect[];
  /**
   * Scene-scoped property declarations - `@scene` (spec §7). Each may be marked
   * `shared` (one value across all flows in the scene) or not (per-flow, the
   * default); the reference is `@scene.name` either way.
   */
  sceneProps?: PropertyDecl[];
  /** One or more blocks; the first is the default entry. */
  blocks: Block[];
}

/** A flow file (.patterflow) - one scene. */
export interface FlowFile {
  schema: string;          // "patter/flow@0"
  scene: Scene;
}

export type FlowNode = Scene | Block | Group | Snippet;

/**
 * Visit every selectable node (group / snippet) under a children list,
 * depth-first in authored order. Generic over the source AND compiled trees
 * (both share the group/snippet shape) - THE one tree walk; validators,
 * indexers, and exporters all route through it so no hand-rolled walker can
 * forget a level (or a string-bearing field on one).
 */
export function walkNodes<N extends { type: string }>(
  nodes: ReadonlyArray<N>,
  visit: (node: N) => void,
): void {
  for (const node of nodes) {
    visit(node);
    // Groups carry children; snippets do not. Accessed structurally so the one
    // walker serves both the source and compiled trees.
    const children = (node as { children?: ReadonlyArray<N> }).children;
    if (children) walkNodes(children, visit);
  }
}

/**
 * A beat with NO content worth keeping: an empty line / text bubble left behind - e.g. a snippet seeded
 * only so a jump could hang off it. Such a beat would render at runtime as a blank line that (lacking any
 * localised string) falls back to emitting its raw id, so the editor drops it on save. `hasText` = the
 * beat has a non-empty display string. A game-event beat is never contentless (it's a pure instruction),
 * and a beat carrying `gameData` or `tags` is meaningful even with no text. A jump-only snippet is then
 * just `{ jump }` with zero beats - which is valid.
 */
export function isContentlessBeat(beat: Beat, hasText: boolean): boolean {
  if (beat.kind === "gameEvent") return false;
  if (hasText) return false;
  if (beat.gameData && Object.keys(beat.gameData).length > 0) return false;
  if (beat.tags && beat.tags.length > 0) return false;
  return beat.kind === "text" || (!beat.character && !beat.direction);
}

// ---------------------------------------------------------------------------
// Game IDs (spec §6) - the author-editable, host-facing ADDRESS for an
// addressable node (scene / block): a hyphen-slug the runtime targets, distinct
// from the opaque immutable `id` and the computed readable `handle`. These pure
// helpers live in the shape layer so the runtime can compute effective addresses
// without depending on @patterkit/core (which re-exports them).
// ---------------------------------------------------------------------------

/** Slugify a name into a hyphen-form game id: lowercase, drop apostrophes, runs of
 *  other punctuation -> a single hyphen, collapse repeats, no leading / trailing hyphen. */
export function gameIdify(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** A valid authored game id: lowercase alphanumerics + hyphens, no leading / trailing hyphen. */
export function isValidGameId(gameId: string): boolean {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(gameId);
}

/** The effective address: the explicit `gameId` if pinned, else derived from `name`. */
export function effectiveGameId(entity: { gameId?: string; name: string }): string {
  const g = entity.gameId?.trim();
  return g ? g : gameIdify(entity.name);
}

// ---------------------------------------------------------------------------
// Project file (.patterproj) - spec §14, schema §6.
// ---------------------------------------------------------------------------

export type PropertyType = "boolean" | "number" | "string" | "flags" | "enum";

export interface PropertyDecl {
  name: string;
  type: PropertyType;
  default?: ScalarValue;
  /**
   * The orthogonal *sharing* axis (spec §7): is this property's value shared across
   * all flows (one world value) or kept per-flow? It does NOT change the reference
   * syntax - sharing is set here, on the declaration, not by a different scope token.
   * The default depends on the scope it is declared in: a **global** property
   * (project `properties` -> `@patter`) defaults to **shared**; a **scene-local**
   * property (scene `sceneProps` -> `@scene`) defaults to **not shared** (per-flow).
   */
  shared?: boolean;
  /**
   * Persistence axis, for **scene-local (`@scene`) properties** (spec §7). Default
   * `false`: the value PERSISTS across scene re-entries (like every other property).
   * `true`: the value is **reseeded to its default on every scene entry** - "fresh
   * each playthrough" (Ink's `temp`). Orthogonal to `shared`. Ignored on global
   * (`@patter`) properties, which always persist for the life of the piece.
   */
  temporary?: boolean;
  /** For enum / flags. */
  values?: string[];
  /** Free-text author note documenting what this property is for (authoring only; shown as a hint). */
  purpose?: string;
}

/**
 * A property of a host / world scope (`@world`, `@game`, ...). The same shape the
 * `@wildwinter/scoperegistry` `scopeRegistrySpec` uses, declared structurally here
 * so the model stays free of a runtime dependency. `default` seeds the standalone
 * runtime's self-backed bag (see `HostScopeSpec`); `writable: false` makes the
 * property read-only to the story (validated at compile time).
 */
export interface HostScopeDecl {
  name: string;
  type: PropertyType;
  values?: string[];
  default?: ScalarValue;
  writable?: boolean;
  /** Free-text author note documenting the property (authoring only; shown as a hint). */
  purpose?: string;
}

/** One scope (`token`) in a project's host-scope registry. */
export interface HostScopeSpec {
  /** The scope token after `@` (e.g. `"world"`). Must not collide with Patter's own
   *  `patter` / `scene` / `flow`. */
  token: string;
  /** Scope-level read/write default for its declarations (default true). */
  writable?: boolean;
  /** Property declarations; omit for an opaque scope (any name, unchecked). */
  declarations?: HostScopeDecl[];
}

/**
 * A project's host-scope registry: the `scopeRegistrySpec` it OWNS (spec
 * design/scope-registry.md §6). Makes `@world` (and any host scope) first-class
 * in a standalone project: the compiler validates references into it, the runtime
 * self-backs it from declaration defaults when no host resolver claims the token,
 * and coverage drives its values. Structurally identical to scoperegistry's
 * `ScopeRegistrySpec` so it threads straight through the compiler.
 */
export interface HostScopeRegistry {
  version: number;
  scopes: HostScopeSpec[];
}

/**
 * A coverage input driver (#159, design/scope-registry.md §7): during a coverage run the harness feeds a
 * host-scope property (`@world.x`) values from `values` so branches gated on external state get exercised.
 * @world is the game-engine seam: @patter / @scene are story-owned and covered for free, so are never driven.
 */
export interface CoverageDriver {
  /** The host-scope ref to drive, e.g. `"@world.phase"`. */
  ref: string;
  /** `"initial"`: set once when each playthrough starts. `"recurring"`: re-rolled at choice points so a
   *  single run can pass through several world states. */
  kind: "initial" | "recurring";
  /** For a recurring driver: how often to re-roll at a choice point (default `"sometimes"`). */
  cadence?: "rarely" | "sometimes" | "often";
  /** The pool the harness picks from (uniform). Empty = the driver is inert. */
  values: ScalarValue[];
}

/** A character's grammatical gender, for localisation. Translators need it to inflect the speaker's own
 *  lines in gendered languages (adjectives, participles, pronouns), which the source text alone often
 *  cannot tell them. Absent means "not specified". Authoring-only: it never reaches the runtime bundle,
 *  but it IS carried into the localisation handoff formats as translator context (spec §14). */
export type GrammaticalGender = "male" | "female" | "neuter";

export interface CastMember {
  /** Canonical speaker name (matched by a beat's `character`); language-neutral key. */
  name: string;
  /** Localised player-facing name - a localisation id (project-level strings). */
  displayName?: string;
  /** Grammatical gender for translators (see `GrammaticalGender`); absent = not specified. */
  gender?: GrammaticalGender;
  /** Free-text production notes about the character (casting, voice, intent) - authoring only. */
  notes?: string;
  /** The voice actor cast for this character, if known - surfaced in the VO script export (spec §16).
   *  Authoring-only (not shipped in the runtime bundle). */
  actor?: string;
  gameData?: GameData;
}

/** The cast as it reaches a compiled bundle: the player-facing fields only. `notes`, `actor` and
 *  `gender` are authoring / production / translation context, and the compiler drops them, so a shipped
 *  game never carries a real person's name or a writer's private notes. The compiler copies the shipping
 *  fields across explicitly (an allow-list), which is what actually keeps a new authoring field out of
 *  the bundle; this type states the resulting contract for anyone reading a bundle. */
export type BundleCastMember = Omit<CastMember, "notes" | "actor" | "gender">;

/** A node TYPE that can carry author-defined gameData fields (the gameData schema, project-level).
 *  Beat kinds map straight through: dialogue = `line`, narration = `text`, game event = `gameEvent`. */
export type GameDataNodeKind = "scene" | "block" | "snippet" | "line" | "text" | "gameEvent";

/** The value type of a gameData field - the property-type vocabulary plus a multiline-text variant.
 *  Drives the inspector's editor widget (text / textarea / number / toggle / enum dropdown). */
export type GameDataFieldType = "text" | "multiline" | "number" | "boolean" | "enum";

/** One author-defined custom field on a node type (host-integration metadata, NOT expression state). */
export interface GameDataField {
  /** Field key - also the key a node stores its value under in `gameData` (values are name-keyed). */
  name: string;
  type: GameDataFieldType;
  /** The value used when a node sets nothing. Storage is SPARSE - nodes hold only their overrides, and
   *  a reader falls back to this default (so changing it here propagates to every node that didn't set it). */
  default?: ScalarValue;
  /** Allowed values when `type` is "enum". */
  values?: string[];
  /** Free-text description of what the field is for - shown as a rollover hint in the inspector. */
  purpose?: string;
}

/** Author-defined gameData fields, grouped by the node type they attach to (project-level schema). */
export type GameDataFields = Partial<Record<GameDataNodeKind, GameDataField[]>>;

// ---------------------------------------------------------------------------
// Status vocabularies (spec §13) - ordered not-done -> done, project-tailorable.
// Tracked PER BEAT in the authoring file (`writing` / `recording`).
// ---------------------------------------------------------------------------

export interface WritingStatusDecl {
  name: string;
  /**
   * Threshold marker: this status AND every later one classify as "ready to
   * record". Declared on exactly one status in the list.
   */
  readyToRecord?: boolean;
  /** Threshold marker: this status and every later one classify as "ready to ship". */
  readyToShip?: boolean;
  /** Theme character-palette slot (0-11) for the per-line status badge / inspector swatch (Patterpad #196).
   *  A slot (not a hex) so it adapts to light/dark + the reading palettes. Absent = no colour (neutral). */
  colour?: number;
}

/**
 * The default writing-status ladder (used when a project declares none). The
 * FIRST status is the level-0 / absence status: a beat with no recorded status
 * counts as `stub`. Nothing is inferred from content - tracking is opt-in, and a
 * project that ignores statuses reads as all-stub (so its burndown / script
 * export carry no weight, by design - spec §13).
 */
export const DEFAULT_WRITING_STATUSES: WritingStatusDecl[] = [
  { name: "stub", colour: 0 },                        // red
  { name: "draft 1", colour: 1 },                     // rust
  { name: "draft 2", colour: 2 },                     // ochre
  { name: "edited", readyToRecord: true, colour: 4 }, // green
  { name: "final", readyToShip: true, colour: 9 },    // purple (violet)
];

/** A recording-status rung (#206): like a writing status but with no readiness markers - the recording
 *  ladder is ordered missing -> final and carries a picked palette colour for the inspector chip / report. */
export interface RecordingStatusDecl {
  name: string;
  /** Theme character-palette slot (0-11) for the inspector chip / report bar. Absent = neutral. */
  colour?: number;
}

/** The default recording-status ladder (used when a project declares none). The FIRST rung is the
 *  level-0 / absence status: a beat with no recorded status counts as `missing`. */
export const DEFAULT_RECORDING_STATUSES: RecordingStatusDecl[] = [
  { name: "missing", colour: 0 },    // red
  { name: "scratch", colour: 2 },    // ochre
  { name: "recorded", colour: 4 },   // green
  { name: "final", colour: 9 },      // purple
];

/** The reserved recording status a line takes when it is flagged **needs re-record** (#227): a recorded
 *  take exists but is unusable (bad quality, wrong take), so it must be redone. It is NOT a ladder rung -
 *  it is a regression flag that MASKS the derived / manual rung for the recording script, the production
 *  report, and status browse, so a line "recorded" on disk still shows up as work to do. Reserved so it
 *  can't collide with an author-declared rung; carries its own alert colour. */
export const RERECORD_STATUS = "rerecord";
export const RERECORD_STATUS_DECL: RecordingStatusDecl = { name: RERECORD_STATUS, colour: 1 }; // orange alert

/** One recording rung mapped to the folder its audio files live in (Audio Folders mode). */
export interface RecordingFolder {
  name: string;
  /** Project-relative folder `<audioRoot>/<slug(name)>`, or undefined for the baseline "not recorded" rung. */
  folder?: string;
}

/**
 * Audio Folders (#206): map the recording ladder to its derived folders under a single audio root.
 * Each rung's folder is `<audioRoot>/<slug(name)>`; the FIRST (lowest) rung is the "not recorded"
 * baseline and gets NO folder. The single source of truth shared by the indexer, scratch-save, and the
 * manifest so they never disagree. Returns bare rungs (no folders) when `audioRoot` is empty.
 */
export function deriveRecordingFolders(
  audioRoot: string | undefined,
  statuses: RecordingStatusDecl[],
): RecordingFolder[] {
  const root = audioRoot?.trim();
  return statuses.map((s, i) => {
    if (i === 0 || !root) return { name: s.name };            // baseline rung, or no root configured yet
    return { name: s.name, folder: `${root}/${gameIdify(s.name)}` };
  });
}

/**
 * A class of documentation note (spec §18) - the project-defined vocabulary plus
 * where each class is DELIVERED. The editor (Patterpad) always shows every class;
 * `deliver` governs EXPORTS only. A note inherits down the tree, so a class set
 * on a scene/block flows to its lines (outermost-first).
 */
export interface DocumentationClass {
  name: string;
  /**
   * Export channels this class flows to: a list of channel names, or `"*"` for
   * all. Omitted/empty = editor-only (e.g. "writing"). Built-in channels: `vo`
   * (voice-recording scripts), `loc` (localisation handoff); studios add their
   * own (e.g. `sfx`, `art`), carried now and picked up when that export exists.
   */
  deliver?: string[] | "*";
}

/**
 * The default documentation classes (used when a project declares none). An
 * untyped note (no class) is editor-only by construction; these are the named
 * routes. The vocabulary is project-extensible - a studio replaces this list.
 */
export const DEFAULT_DOCUMENTATION_CLASSES: DocumentationClass[] = [
  { name: "everyone", deliver: "*" }, // every export, and (like all) the editor
  { name: "vo", deliver: ["vo"] },    // voice-recording scripts
  { name: "loc", deliver: ["loc"] },  // localisation handoff
];
// (An editor-only note still exists: leave a note UNTYPED - it surfaces in the editor but no export.)

/** The version-control system a project is kept under (spec §12). Drives the lock-aware vs merge-based
 *  write path + the emitted VCS config; chosen at create and switchable in Project Settings. */
export type VcsKind = "git" | "perforce" | "plastic" | "svn" | "none";

/** Spell-check setup for a project (Patterpad #177). */
export interface ProjectDictionary {
  /** The active dictionary id - a built-in language ("en-US"/"en-GB") or an app-level imported Hunspell
   *  pair. Absent = derive from the source locale. The imported pair itself lives per-machine (userData),
   *  so only the id travels with the project. */
  language?: string;
  /** The project's custom word list - names, places, invented terms - always accepted. Travels with the
   *  project (shared via VCS), unlike the per-machine imported dictionaries. */
  words?: string[];
  /** Words the author chose to IGNORE (right-click ▸ Ignore on a flagged word). Distinct from `words`:
   *  these aren't vocabulary to add, just tokens to stop flagging in this project (a dialect spelling, a
   *  code). Both suppress the squiggle; they differ in intent + where they surface. Travels with the project. */
  ignore?: string[];
  /** Spell-check on/off for this project (default on). */
  enabled?: boolean;
}

/**
 * Estimating (writing-burndown, spec §13): when a scene is still all guesswork - every status-tracked
 * beat at or below `thresholdStatus` (an unset beat counts as the lowest rung) - the production report
 * REPLACES its actual (placeholder) line count with an estimate, and shares that estimate across the
 * characters appearing in its placeholder lines. Off by default; when off, no estimate appears anywhere.
 * See design/proposals/estimating.md.
 */
export interface EstimatingConfig {
  /** Master on/off. Off (or absent) = the report shows pure actuals, no estimate anywhere. */
  enabled: boolean;
  /** Writing-ladder rung NAME: a scene is estimated only when EVERY status-tracked beat is at or below
   *  this rung. Absent = the lowest rung. */
  thresholdStatus?: string;
  /** The per-scene estimate (written lines) used when no tag override matches. */
  defaultLines: number;
  /** Tag -> lines overrides. A scene carrying a mapped tag uses that number; if it carries several, the
   *  LARGEST wins. */
  tagEstimates?: { tag: string; lines: number }[];
}

export interface ProjectFile {
  schema: string;          // "patter/project@0"
  root?: boolean;
  project: { id: string; name: string; roomKey?: string };
  locales: { default: string; all: string[] };
  /** The authored entry point: the scene (and optional block) a flow starts at when none is given,
   *  used by `patter play`, Patterpad's Play, and coverage. Omitted = fall back to the first scene. */
  start?: { scene: string; block?: string };
  /** The authored scene order (scene ids) for navigation. Scenes not listed follow in file order;
   *  listed ids that no longer exist are ignored. Omitted = plain file order. Presentation only:
   *  it never affects play, which always starts from `start` / an explicit address. */
  sceneOrder?: string[];
  /** Version-control system (spec §12); omitted = unset / none. */
  vcs?: VcsKind;
  /** Project-wide VO mode (spec §16) - one boolean, no per-scene override. */
  voiced?: boolean;
  /** Track audio/recording status (#206): whether the recording-status ladder, Audio Folders, scratch, and
   *  the inspector's Audio row + the report's recording breakdown are active. Only meaningful for a `voiced`
   *  project (it gates on both). Authoring metadata, editor-only; never reaches the bundle. Omitted = OFF -
   *  opt-in even for a voiced project (a voiced story may want voice scripts without tracking recording status). */
  trackAudioStatus?: boolean;
  /**
   * Inline text formatting. When true, authors can mark dialogue / narration / direction /
   * choice-prompt text bold, italic, or bold+italic; it is stored INSIDE the localised strings
   * (and the flow's `direction`) as `<b>…</b>`, `<i>…</i>`, `<bi>…</bi>`, with literal `<`, `>`,
   * `&` escaped to `&lt;` / `&gt;` / `&amp;`. The runtime treats the string as opaque - it is the
   * GAME's job to parse the tags. Default ON (omitted === enabled); set `false` to disable it for a
   * game that renders plain strings and would otherwise show the tags literally. */
  formatting?: boolean;
  /** Autosave: periodically persist the edited scene without an explicit Save. Default ON (omitted ===
   *  enabled); set `false` to require manual saves. */
  autosave?: boolean;
  /** Auto Rebuild: recompile the `.patterc` bundle automatically after edits (debounced), so the on-disk
   *  build stays current without a manual Publish Bundle. Editor-only; never reaches the bundle. Default OFF
   *  (omitted === off) - opt-in, since it writes the bundle on every real change (poor fit if you commit the
   *  bundle to a lock-based VCS). The rebuild is deduped (skipped when the compiled bundle is unchanged) and
   *  a mid-edit invalid project silently keeps the last good build. */
  autoRebuild?: boolean;
  /** Closed captions (#214): the delimiter pair that wraps non-spoken caption cues inside DIALOGUE
   *  lines (e.g. `(sigh)` in `Oh dear. (sigh) What now?`). A game can turn captions off at runtime
   *  (`setClosedCaptions(false)`), and the runtime then strips every `open…close` span - delimiters and
   *  surrounding whitespace - from line text. Baked into the bundle so the runtime knows the pair;
   *  omitted = the default `(` / `)`. Captions are ON by default (full text shown). */
  closedCaptions?: CaptionDelimiters;
  audio?: { scratchStore: string };
  layout?: { flow?: string; strings?: string; authoring?: string };
  /** `bundle`: the compiled `.patterc` output path (relative to the project root,
   *  or absolute); default `dist/<project-file-stem>.patterc` (spec §11).
   *  `localisation`: how strings ship + are resolved (spec §11).
   *    - "embedded" (default): every locale's strings live INSIDE the `.patterc`; the runtime resolves
   *      them and can switch locale live (`setLocale`).
   *    - "ids": the `.patterc` carries NO strings; the runtime emits the beat ID for each line and the
   *      game looks it up in its own loc system (Export Localisation hands over the language files).
   *      `sourceDebug` embeds the SOURCE language too, purely so the build can be played for debugging;
   *      the bundle flags it so the runtime can warn it is not a shippable build. */
  export?: { targets?: string[]; bundle?: string; localisation?: { mode: "embedded" | "ids"; sourceDebug?: boolean } };
  properties?: PropertyDecl[];
  /** Host / world scopes the project declares (`@world`, `@game`, ...): makes them first-class so the
   *  compiler validates references into them, the runtime self-backs them from defaults when no host
   *  resolver is bound, and coverage drives their values. Omitted = no host scopes (`@world.x` is then a
   *  compile error). See design/scope-registry.md §6. */
  scopeRegistry?: HostScopeRegistry;
  /** Coverage input drivers (#159): values to feed host scopes (`@world`) during a coverage run so
   *  externally-gated branches get exercised. Authoring-only (never reaches the runtime bundle). */
  coverageDrivers?: CoverageDriver[];
  cast?: CastMember[];
  gameDataFields?: GameDataFields;
  /** Ordered writing-status ladder (not-done -> done); default `DEFAULT_WRITING_STATUSES`. */
  writingStatuses?: WritingStatusDecl[];
  /** Ordered recording-status ladder (not-done -> done); default `DEFAULT_RECORDING_STATUSES`. */
  recordingStatuses?: RecordingStatusDecl[];
  /** Audio Folders mode (#206): the single project-relative root under which each rung's audio lives, in
   *  an auto-derived subfolder `<audioRoot>/<slug(statusName)>/` (see `deriveRecordingFolders`). Only
   *  meaningful when `audioFolders` is on. Authoring metadata; never reaches the bundle. */
  audioRoot?: string;
  /** Audio Folders mode (#206): when true, a dialogue line's recording status is DERIVED from which
   *  rung's derived folder (under `audioRoot`) holds its `<beatId>.wav|mp3` (top-down the ladder, implicit
   *  "missing"), instead of being set manually. Authoring metadata; never reaches the bundle. Default off. */
  audioFolders?: boolean;
  /** Scratch recording (Patterpad #224): the recording-status rung whose folder is the source/dest for
   *  in-app "record scratch" takes. When set (and `audioFolders` on), Patterpad offers to record a quick
   *  scratch take into this rung's folder for any line at or below this rung. Authoring metadata, editor-
   *  only; never reaches the bundle. Unset = scratch recording off. */
  scratchStatus?: string;
  /** Spell-check setup (Patterpad #177): the active dictionary language + the project's custom word list +
   *  an on/off flag. Source-language-only, authoring metadata - it never reaches the runtime bundle. */
  dictionary?: ProjectDictionary;
  /**
   * Estimating (spec §13 writing burndown): replace a still-guesswork scene's actual (placeholder)
   * line count with an estimate in the production report. Off by default. See `EstimatingConfig` and
   * design/proposals/estimating.md.
   */
  estimating?: EstimatingConfig;
  /** Documentation-note classes + their export routing (spec §18); default `DEFAULT_DOCUMENTATION_CLASSES`. */
  documentationClasses?: DocumentationClass[];
}

// ---------------------------------------------------------------------------
// Locale file (.patterloc) - schema §4. String text only.
// ---------------------------------------------------------------------------

export interface LocaleFile {
  schema: string;          // "patter/strings@0"
  /** Scene id this file's strings belong to (or a project-level marker). */
  scene: string;
  locale: string;
  default?: boolean;
  /** beatId -> text. */
  strings: Record<string, string>;
}

/** The `scene` marker for a project-level loc shard (`loc/<locale>/_project.patterloc`): strings that
 *  aren't tied to a scene beat - currently cast display names, later project title / UI strings. */
export const PROJECT_LOCALE_SCENE = "@project";

/** The project-level loc-string key for a cast member's player-facing name, e.g. `cast:BARKEEP`.
 *  Namespaced so it can't collide with opaque beat ids. The default-locale value is seeded from the
 *  CastMember's `displayName`; the runtime resolves a character's shown name through this key. */
export function castStringKey(name: string): string {
  return `cast:${name}`;
}

// ---------------------------------------------------------------------------
// Authoring file (.patterx) - schema §5. All edit/production metadata.
// ---------------------------------------------------------------------------

/** Typed documentation annotation line (spec §18). */
export interface DocLine {
  /** The documentation CLASS (a `DocumentationClass.name`) - routes export
   *  visibility. Omitted = editor-only (not delivered to any export). */
  type?: string;
  text: string;
}

/** One message in a threaded editor comment: who wrote it, when (ISO timestamp), and the text. */
export interface CommentMessage {
  author: string;
  ts: string;
  body: string;
}

/** A sub-text range a comment is pinned to, within its anchor node's say text (#148). Offsets are
 *  character positions over the rendered (plain) source text - inline formatting is marks, not part of
 *  the count. `quote` is the text the range covered when made: the editor re-anchors by FINDING it (the
 *  offsets are just a hint), and a thread whose quote no longer exists is shown demoted, not lost. */
export interface CommentRange {
  from: number;
  to: number;
  quote: string;
}

/** Threaded editor comment (collaboration), anchored to a stable beat/node id. `messages[0]` is the
 *  opener; replies follow in order (each carries its own author + timestamp, Word/Docs style).
 *  `range` pins it to a span of the node's text (absent = the whole beat). `resolved` archives the
 *  thread - hidden in the editor unless "show resolved comments" is on. */
export interface Comment {
  id: string;
  /** Anchored to a stable beat/node id. */
  anchor: string;
  /** A sub-text span within the anchor's text; absent = a whole-beat comment. */
  range?: CommentRange;
  resolved?: boolean;
  messages: CommentMessage[];
}

/** A "suggest a rewrite" proposal for a single say/prose beat (review flow, design/proposals/
 *  suggest-rewrite.md). Whole-beat anchored: `baseline` is the say text WHEN suggested (the "before" +
 *  the drift detector - if it no longer matches the live text, the line changed since and the suggestion
 *  is shown stale), `proposed` is the replacement. Accept overwrites the beat's say text; both accept and
 *  reject set `resolved` (archived) + `outcome` (a light audit trail). Stored in the authoring shard,
 *  never in the flow text, so downstream tools ignore it. */
export interface Suggestion {
  id: string;
  /** The say/prose beat's stable id. */
  anchor: string;
  /** The say text at the moment this was suggested (the diff "before" + staleness check). */
  baseline: string;
  /** The proposed replacement say text. */
  proposed: string;
  author: string;
  ts: string;
  /** Accepted or rejected -> archived (hidden unless "show resolved suggestions" is on). */
  resolved?: boolean;
  outcome?: "accepted" | "rejected";
}

export interface EditRecord {
  modifiedAt?: string;
  by?: string;
  /** Per-locale localisation date -> staleness when source modifiedAt is later. */
  localisedAt?: Record<string, string>;
}

export interface AuthoringFile {
  schema: string;          // "patter/authoring@0"
  comments?: Comment[];
  /** "Suggest a rewrite" review proposals (design/proposals/suggest-rewrite.md). */
  suggestions?: Suggestion[];
  /** Typed documentation, keyed by node/beat id (spec §18). */
  documentation?: Record<string, DocLine[]>;
  /**
   * Writing status, keyed by BEAT id - a value from the project's writing-status
   * enumeration (spec §13; `writingStatuses`, default `DEFAULT_WRITING_STATUSES`).
   * Tracked on the source language only (translation staleness is `localisedAt`).
   */
  writing?: Record<string, string>;
  /**
   * Recording status, keyed by BEAT id - a value from the project's recording-status
   * enumeration (spec §13/§16; `recordingStatuses`). Single-locale by design: games
   * recording VO in more than one language are rare (and absent at indie level); if
   * ever needed, a per-locale extension comes later.
   */
  recording?: Record<string, string>;
  /**
   * Audio-relationship metadata, keyed by BEAT id. Native (recording) language
   * only - like recording status, VO is single-language by design.
   */
  audio?: Record<string, unknown>;
  /** Author trail + edit/localisation dates, keyed by beat/node id. */
  edits?: Record<string, EditRecord>;
  /**
   * **Cut** content (spec §13): scene or beat ids removed from the production
   * but kept in source. Orthogonal to status (cut is not a degree of doneness);
   * reports exclude cut content from counts / estimates / coverage and surface
   * it as a separate "cut: N" figure so a removal is visible, not vanished.
   */
  cut?: Record<string, boolean>;
  /**
   * **Needs re-record** (#227): dialogue-line ids whose recorded take is unusable and must be redone
   * (bad quality, wrong take, misread). Orthogonal to the recording ladder - a flagged line keeps its
   * audio on disk, but its recording status is MASKED to the reserved `rerecord` status for the recording
   * script / report / status browse (see `RERECORD_STATUS`), so a "recorded" line still reads as work.
   * Authoring-only; never compiled into a bundle.
   */
  rerecord?: Record<string, boolean>;
}

// ---------------------------------------------------------------------------
// Export bundle (schema §10) - the compiled artefact the runtimes load.
// Conditions/effects are pre-derived `{ src, ast }` envelopes (not src strings);
// authoring is stripped; the project-wide voiced flag is carried; locales assembled.
// ---------------------------------------------------------------------------

/** A compiled expression envelope: canonical source + pre-derived tagged-tuple AST. */
export interface Expression {
  src: string;
  ast: AstNode;
}

export type CompiledEffect =
  { kind: "set"; target: string; value: Expression };

export interface CompiledSnippet {
  id: string;
  type: "snippet";
  condition?: Expression;
  beats?: Beat[];                  // beats carry no expressions
  onEnter?: CompiledEffect[];
  onExit?: CompiledEffect[];
  gameData?: GameData;
  tags?: string[];                 // author tags (#215), accumulated down the tree at runtime
  jump?: Jump;
  secretUntilEligible?: boolean;
  /** Option-position: repeatable (spec §5). Default false = once-only. */
  sticky?: boolean;
  /** Option-position: the choice's fallback, auto-followed when last (spec §5). */
  fallback?: boolean;
}

export interface CompiledGroup {
  id: string;
  type: "group";
  condition?: Expression;
  /** Default (omitted) = `"run"`. */
  selector?: Selector;
  /** Selector cursor shared across flows (default false = per-flow). */
  shared?: boolean;
  options?: SequenceOptions;
  children: Array<CompiledGroup | CompiledSnippet>;
  gameData?: GameData;
  tags?: string[];                 // author tags (#215)
  /** Option-position fields (spec §5) - only when a direct child of a `choice`. */
  prompt?: PromptBeat;
  secretUntilEligible?: boolean;
  /** Repeatable (spec §5). Default false = once-only. */
  sticky?: boolean;
  /** The choice's fallback, auto-followed when last (spec §5). */
  fallback?: boolean;
}

export interface CompiledBlock {
  id: string;
  type: "block";
  name: string;
  /** Host-facing address (spec §6); the runtime resolves it to `id`. Absent = derived from `name`. */
  gameId?: string;
  children: Array<CompiledGroup | CompiledSnippet>;
  gameData?: GameData;
  tags?: string[];                 // author tags (#215)
}

export interface CompiledScene {
  id: string;
  type: "scene";
  name: string;
  /** Host-facing address (spec §6); the runtime resolves it to `id`. Absent = derived from `name`. */
  gameId?: string;
  gameData?: GameData;
  tags?: string[];                 // author tags (#215)
  onEntry?: CompiledEffect[];
  sceneProps?: PropertyDecl[];
  blocks: CompiledBlock[];
}

export interface Bundle {
  schema: string;                  // "patter/bundle@0"
  /** `hash` fingerprints the WHOLE bundle (binds saves, gates staleness); `structureHash` is the same
   *  fingerprint with the string tables left out, so same structureHash + a different hash = a
   *  text-only edit, safe to hot-swap in place (live bundle refresh). */
  content: { project: string; version?: string; hash?: string; structureHash?: string };
  voiced: boolean;                 // project-wide VO mode (spec §16)
  locales: { default: string; included: string[] };
  /** Player-facing cast only: the compiler strips notes / actor / gender (see `BundleCastMember`). */
  cast?: BundleCastMember[];
  properties?: PropertyDecl[];
  /** Host / world scope declarations, baked from the project so the runtime can self-back a declared
   *  scope (`@world`, ...) when no host resolver claims its token. Absent = no host scopes. */
  scopeRegistry?: HostScopeRegistry;
  gameDataFields?: GameDataFields;
  scenes: Record<string, CompiledScene>;
  /** locale -> (beatId -> text). In "embedded" localisation this carries every included locale; in "ids"
   *  it is EMPTY (the runtime emits beat IDs), unless `localisation.sourceDebug` embedded the source locale
   *  for debug playback. `content.hash` is computed over the FULL strings regardless, so the staleness gate
   *  is unaffected. */
  strings: Record<string, Record<string, string>>;
  /** How strings ship + resolve (spec §11). Absent = "embedded" (back-compat default): the runtime resolves
   *  `strings` per locale. "ids": the runtime emits beat IDs and the game localises them itself; `sourceDebug`
   *  means the source locale is embedded purely for debug playback and the runtime should flag the build as
   *  not shippable. */
  localisation?: { mode: "embedded" | "ids"; sourceDebug?: boolean };
  /** Closed-caption delimiters baked from the project (#214). Absent = the default `(` / `)`; the
   *  runtime strips spans between them from line text when a game disables captions. */
  closedCaptions?: CaptionDelimiters;
}

/** Closed-caption configuration (#214). `open`/`close` wrap a caption cue inside a dialogue line (both
 *  non-empty; they MAY be the same token, e.g. `*…*`). `character` names a cast member whose lines are a
 *  pure caption: when captions are off, ALL of that character's dialogue (and its speaker label) is
 *  omitted - delimiters or not - leaving a silent line that still fires (so audio plays). Absent / empty
 *  `character` resolves to the default `SFX` (you "disable" it simply by never using that speaker). */
export interface CaptionDelimiters {
  open: string;
  close: string;
  character?: string;
}

/** The default caption delimiters when a project pins none: square brackets, the closed-captioning
 *  convention for non-speech cues. Round brackets are deliberately NOT the default: `(` at the start of a
 *  line opens a performance direction in the editor, so it would shadow a caption cue there. */
export const DEFAULT_CAPTION_DELIMITERS: CaptionDelimiters = { open: "[", close: "]" };

/** The default caption character: a cast member named `SFX` whose lines are pure captions (omitted when
 *  captions are off). Applies even to a project that pins no `closedCaptions`. */
export const DEFAULT_CAPTION_CHARACTER = "SFX";
