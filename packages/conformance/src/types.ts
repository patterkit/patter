// ---------------------------------------------------------------------------
// Conformance corpus types (Plan §8 - the parity contract).
//
// The corpus is a language-agnostic JSON document. Two case kinds:
//   - expression: compiled `ast` + `scopes` (+ optional PRNG `seed`) -> `expected`
//     scalar. A runtime evaluates the ast against the scopes and must match.
//   - runtime: a compiled `bundle` + start + scripted `choices` (+ optional
//     `seed`) -> `expectedTranscript`, the exact sequence of step results the
//     engine yields. Any port playing the bundle must produce the same.
//
// Cases carry COMPILED artifacts (ast / bundle), so a runtime-only port consumes
// the corpus without a parser or compiler. The `src` / fixture source forms are
// kept only for human readability + corpus regeneration.
// ---------------------------------------------------------------------------

import type { ScalarValue, AstNode } from "@wildwinter/expr";
import type { Bundle, ExtensionShard, ProjectFile, Scene, LocaleFile, GameData, GameDataNodeKind, NodeExtensions, SaveEnvelope, SaveGame } from "@patterkit/model";

export type ScopeBag = Record<string, ScalarValue>;

/**
 * A normalised transcript entry: the step results the engine yields (`line` /
 * `text` / `gameEvent` / `choice` / `end`). `gameData` is included when a beat /
 * option carries it (host-facing payload is part of the contract) - and is where
 * host event emission lives now (effects are set-only, spec §15).
 *
 * A `choice` is pinned WHOLE, as the host receives it: the choice group's `groupId`, and each option's
 * structured `prompt` exactly as the runtime's ChoiceOption carries it (kind, text, and for a line the
 * speaker, their resolved name, and the direction). Until 2026-10 the transcript flattened an option to
 * its prompt's text and dropped the group id, so a runtime could omit both and still pass; one did.
 * There is no flat `text` on an option: it would only repeat `prompt.text`.
 *
 * A line or text step's `padAfter` (line padding) is recorded only when it differs from the built-in
 * `DEFAULT_PAD_AFTER`: every step carries one, and writing 0.6 into every hand-authored transcript would bury
 * the cases that are about something else. The outline cases pin every beat's resolved pause, defaults
 * included, so a runtime that leaves the field off still fails, and a step or prompt that should carry a pause
 * and doesn't records a "<missing>" marker instead.
 *
 * `extensions` (corpus 3) is a beat's or an option's Patter extension values, by extension id, exactly as the
 * bundle carries them: raw and sparse, any JSON (records, maps and lists as well as the seven field types), so a
 * runner compares them deeply, whatever order an object's keys arrive in. Absent when the node has none.
 */
export type TranscriptStep =
  | ({ type: "line"; id: string; text: string; character?: string; characterName?: string; direction?: string; qualifier?: string; qualifierName?: string; speakerLabel?: string; padAfter?: number; gameData?: GameData; extensions?: NodeExtensions; tags?: string[] } & TranscriptSpoken)
  | ({ type: "text"; id: string; text: string; padAfter?: number; action?: true; gameData?: GameData; extensions?: NodeExtensions; tags?: string[] } & TranscriptSpoken)
  | { type: "gameEvent"; id: string; gameData?: GameData; extensions?: NodeExtensions; tags?: string[] }
  | { type: "choice"; groupId: string; options: TranscriptOption[] }
  /** `reason` is recorded only when the flow ended because a choice ran dry (corpus 10); absent = "ended". */
  | { type: "end"; reason?: "ran-dry" };

/** How a line or text step is spoken (corpus 11), recorded only in a scripted case that sets `spoken`, so every
 *  earlier transcript is as it was. Recorded there whenever the step carries them; `spokenText` and
 *  `spokenLocale` are `"<missing>"` when a runtime drops them from a bundle with text, and absent from an IDs-only
 *  one, and `estimateRate` is `"<missing>"` when a runtime drops it. */
export interface TranscriptSpoken {
  spokenText?: string;
  spokenLocale?: string;
  estimateRate?: number | "<missing>";
}

/** One option of a transcript `choice`: the runtime's ChoiceOption, keys absent when unset. */
export interface TranscriptOption {
  id: string;
  /** Absent only when the option has no prompt beat and no content line to stand in for one. */
  prompt?: TranscriptPrompt;
  eligible: boolean;
  gameData?: GameData;
  /** The option's extension values, raw, as a step's (absent when it has none). */
  extensions?: NodeExtensions;
}

/** An option's prompt: the runtime's ChoicePrompt. `character`, `characterName`, and `direction` appear
 *  only on a `line` prompt, and only when set (`characterName` is absent when the cast gives none, and
 *  always in an IDs-only bundle). */
export interface TranscriptPrompt {
  kind: "line" | "text";
  text: string;
  character?: string;
  characterName?: string;
  direction?: string;
  /** The speaker qualifier's `gameId` and resolved shown name (a `line` prompt only, and only when set). */
  qualifier?: string;
  qualifierName?: string;
  /** The speaker's label, recorded only where it differs from the name an unqualified line shows (as on a step). */
  speakerLabel?: string;
  /** The prompt's resolved pause, recorded only when it isn't the built-in 0.6 (as on a step). */
  padAfter?: number;
}

/**
 * Engine construction options a case plays under. A runner passes them to its engine's constructor, and to
 * every engine a `saveLoad` or `hotSwap` makes in the case, exactly as a game constructs each of its engines
 * the same way. Absent (or a key absent) = the engine's default. Only options every runtime takes at
 * construction belong here; the PRNG seed and the locale keep their own fields.
 */
export interface CaseEngineOptions {
  /** `replayPromptOnChoose`: on `choose`, the chosen option's prompt beat is delivered as the first beat of
   *  its content (the choice "spoken back"). Default `false`. */
  replayPromptOnChoose?: boolean;
  /** `closedCaptions`: whether the engine starts with caption cues shown (`true`, the default) or stripped. */
  closedCaptions?: boolean;
}

/** A compiled expression case in the portable corpus. */
export interface ExpressionCase {
  name: string;
  /** Human-readable source (informational; ports evaluate `ast`). */
  src: string;
  ast: AstNode;
  scopes: Record<string, ScopeBag>;
  /** Seeds the PRNG behind `random()`; omit when the expression is deterministic. */
  seed?: number;
  expected: ScalarValue;
}

/**
 * A compiled matched-specificity case: score a bare condition AST against
 * injected scopes with the shared best-match specificity metric (the
 * `order: "specificity"` selector's ranking key). AST-in, integer-score-out.
 * See docs (Storylets docs/developer/specificity.md describes the identical
 * shared scorer). Scored at the root polarity `want = true`.
 */
export interface SpecificityCase {
  name: string;
  /** Human-readable source (informational; ports score `ast`). */
  src: string;
  ast: AstNode;
  scopes: Record<string, ScopeBag>;
  /** Expected matched-constraint specificity score. */
  expected: number;
}

/** A compiled runtime-playthrough case in the portable corpus. */
export interface RuntimeCase {
  name: string;
  bundle: Bundle;
  /** Seeds the engine PRNG (shuffle / random); omit to use the engine default. */
  seed?: number;
  /** Active locale for string + character-name lookups; omit to play the bundle's default locale. A key
   *  missing in the active locale falls back to the default locale (part of the contract). Ignored by an
   *  IDs-only bundle (`bundle.localisation.mode === "ids"`), which emits beat IDs the host localises. */
  locale?: string;
  /** Engine construction options (omit for the defaults). */
  engineOptions?: CaseEngineOptions;
  start?: { scene?: string; block?: string };
  /**
   * Eligible option ids consumed in order at each choice point. CONTRACT: when
   * the list is exhausted (or absent), the runner picks the FIRST ELIGIBLE
   * option - ports must implement the same fallback to reproduce transcripts.
   */
  choices?: string[];
  expectedTranscript: TranscriptStep[];
}

/**
 * One operation in a SCRIPTED case - the harness for behaviors a single
 * play-to-completion cannot express: save/load round-trips, multiple
 * concurrent flows, and engine reset. A port's test runner executes the ops
 * against its own engine; `saveLoad` means "serialise the whole game, discard
 * the engine, restore into a fresh one" (the port's own save API - semantic
 * parity, not byte parity). Ops that produce output carry their `expect`;
 * an op without `expect` must produce NO transcript output.
 */
export type ScriptOp =
  // Open (and start) a named flow, replacing any flow of that name. `expectResult` pins whether the open
  // SUCCEEDS, asserted directly like `goto`'s. `false` = the address does not resolve (an unknown scene, or
  // a block that is not in the named scene, a real block of ANOTHER scene included), and then the open
  // must change nothing: no flow is opened, a flow already open under the name is neither closed nor
  // replaced, and the current flow stays as it was. A runtime that throws refuses by throwing; one that
  // reports and returns null (Godot) refuses that way. The runner checks the name still means the same
  // flow; the script's following `advance` shows that flow carrying on.
  // No `scene` = the bundle's start (`bundle.start`, its block when it names one), else the FIRST AUTHORED
  // scene (the bundle's key order), never the first by id.
  | { op: "openFlow"; flow: string; scene?: string; block?: string; seed?: number; expect?: TranscriptStep[]; expectResult?: boolean }
  | { op: "useFlow"; flow: string }
  | { op: "advance"; expect: TranscriptStep[] }
  // The step a flow would deliver for a beat right now, without delivering it (the current flow unless `flow`
  // names one): one step, or none (`[]`) for an id that is neither a beat nor an option's prompt.
  | { op: "stepFor"; beat: string; flow?: string; expect: TranscriptStep[] }
  | { op: "choose"; id: string; expect?: TranscriptStep[] }
  // Host navigation by ADDRESS (spec §6 gameIds): move the current flow as an authored `go` jump would -
  // target scene onEntry runs, the entry counts as a visit, the callstack is REPLACED (pending call-returns
  // discarded). Out-of-band, so it lands immediately: the rest of the snippet being delivered is abandoned,
  // as is a pending choice. An unstarted flow starts there, an ENDED one revives; a CLOSED one refuses.
  // Produces no transcript of its own (the following `advance` shows where it landed). `expectResult`
  // pins the BOOLEAN it returns - false = address did not resolve, cursor untouched - which a runner
  // asserts directly rather than through the transcript. Every port must agree on all of it.
  | { op: "goto"; scene: string; block?: string; expectResult?: boolean }
  | { op: "saveLoad" }
  // A flow taken out as data and put back (engine.captureFlow / restoreFlow). `captureFlow` keeps the state
  // under `into`, sent through JSON to prove it is plain data; `restoreFlow` opens flow `flow` from the state
  // kept under `from` and makes it current. `expectRefused`: the runtime must refuse the call (an open id, an
  // open checkpoint) and leave everything as it was.
  | { op: "captureFlow"; flow: string; into: string }
  | { op: "closeFlow"; flow: string }
  | { op: "restoreFlow"; flow: string; from: string; expectRefused?: boolean }
  | { op: "setLocale"; locale: string } // live language switch: re-points the active string table, no state change
  | { op: "setClosedCaptions"; on: boolean } // live caption toggle (#214): strip dialogue cues when off; no state change
  // Live bundle refresh (§9.8 cross-bundle drift): serialise the whole game, construct a fresh engine
  // on the case's EDITED bundle (`bundleB`), restore into it. Same semantics as saveLoad, onto changed
  // content: stack frames re-find their next child by id, drifted choice options drop, a vanished
  // active snippet is skipped. Every port must resolve the drift identically.
  | { op: "hotSwap"; expectRefused?: boolean }
  // Cast introspection: a STATIC structure query, so it reads the same at any point in a script and
  // produces no transcript. No `scene` = the project's declared cast (`getCast`), `scene` alone = that
  // scene's speakers, `scene` + `block` = the block's. `expectResult` pins the exact array INCLUDING
  // order: declaration order for the project, first-appearance document order for a scene / block. Refs
  // may be internal ids or gameId addresses. Spelled `expectResult`, like `goto`'s, because a runner
  // reads a bare `expect` as a TRANSCRIPT - this is a return value asserted directly instead.
  | { op: "expectCast"; scene?: string; block?: string; expectResult: string[] }
  // Scene / block gameData: a STATIC read of the author's own overrides, so like `expectCast` it reads the
  // same at any point and produces no transcript. `scene` alone = `gameDataForScene`, `scene` + `block` =
  // `gameDataForBlock`. `expectResult` pins the RAW sparse overrides (the same rule as a beat's step):
  // never merged with the project's declared defaults, never inherited from the scene by its blocks, and
  // `{}` for a node with none or a ref that does not resolve. Key order is not part of the contract.
  | { op: "expectGameData"; scene: string; block?: string; expectResult: GameData }
  // Scene / block Patter extension values (corpus 3): a STATIC read, as `expectGameData` is. `scene` alone =
  // `extensionsForScene`, `scene` + `block` = `extensionsForBlock` (refs by internal id or gameId).
  // `expectResult` is the node's values by extension id, raw, exactly as the bundle carries them: `{}` for a
  // node with none or a ref that doesn't resolve. Values are any JSON, compared deeply; key order is not part
  // of the contract.
  // A snippet's own values (corpus 6): `snippet` alone, no `scene`, = `extensionsForSnippet` (by node id; `{}`
  // for an id that names no snippet).
  | { op: "expectExtensions"; scene: string; block?: string; expectResult: NodeExtensions }
  | { op: "expectExtensions"; snippet: string; expectResult: NodeExtensions }
  // Any node's extension values, read off the BUNDLE by the helper `extensionsOf(bundle, kind, address)`
  // (corpus 3): `project` (no address); `scene` by id or gameId; `block` as "scene/block", each by id or
  // gameId; `snippet`, `line`, `text`, `gameEvent` and `option` by node id (a node of another kind reads as
  // none). `expectResult` is by extension id, raw; `{}` for none or an address that names nothing. With
  // `effective`, one extension's values filled in instead:
  // `effectiveGameData(extensionDecls(bundle, extension, kind), extensionsOf(...)[extension])`, every declared
  // field with its default where the node sets none (a structured default arrives whole), `{}` for an
  // extension the bundle doesn't have. Compared deeply, as `expectExtensions`.
  | { op: "expectNodeExtensions"; kind: string; address?: string; expectResult: Record<string, unknown>; effective?: { extension: string } }
  | { op: "reset"; expectRefused?: boolean }
  // Reset the CURRENT flow (Flow.reset): forget its per-flow state and anything waiting to be delivered, and
  // begin again at the scene (empty: the bundle's start, else the first authored scene) and block given. No
  // transcript.
  | { op: "resetFlow"; scene?: string; block?: string }
  // Checkpoints: `checkpoint` opens one (the engine's `checkpoint()`); `rollback` puts the whole game back
  // as it was then (every property, visit count, shuffle and sequence position, every flow's cursor and
  // PRNG; a flow opened since is closed and forgotten); `commit` keeps everything. None produces a
  // transcript: the advances after them show the state they left. One checkpoint at a time.
  // `expectRefused`: the runtime refuses the call (inside an open checkpoint, say) and changes nothing.
  // JS, C# and C++ throw; Godot, which cannot, reports it and returns null (checkpoint), the engine itself
  // (hot_swap), or nothing (reset), leaving the engine as it was. The ops after it prove nothing moved.
  | { op: "checkpoint"; expectRefused?: boolean }
  | { op: "rollback" }
  | { op: "commit" }
  // The engine's listProperties(), as JSON: each shared @patter property's row in declaration order, with
  // values and stages present only where the declaration has them.
  | { op: "expectProperties"; expectResult: unknown[] }
  // A quality's ladder, as game code reads it: `call` is the engine's stageIndex / compareStages / nextStage
  // (`args`: one value, two, one), on the engine, or on the current flow with `onFlow` (which also reaches
  // @scene, in the scene the flow is in). `expectResult` is the position, the order (-1, 0, 1) or the next
  // stage's name. `expectRefused`: the call is refused (a value that isn't a stage, a ref that isn't a
  // quality, @scene on the engine). JS, C# and C++ throw; Godot returns an EvalError. No transcript.
  | { op: "stage"; call: "index" | "compare" | "next"; ref: string; args: ScalarValue[]; onFlow?: boolean; expectResult?: number | string; expectRefused?: boolean }
  // The GAME's write to a shared or host-scope property (engine.setProperty), with host authority: a game
  // moving its own `@world` value, or the value another engine's scope holds. No transcript. `expectRefused`:
  // the runtime refuses it and changes nothing, as it must a value that doesn't fit the property's declaration
  // (the kernel's `valueFits`; an enum whose own default is "" takes "" back) or a name the content doesn't
  // declare in a scope the bundle declares. JS and C# throw; Godot and Unreal return the message.
  | { op: "setProperty"; ref: string; value: ScalarValue; expectRefused?: boolean }
  // What the engines reported to `onError` since the case began (the first engine's construction included) or
  // the last expectErrors, in order: each as `{ kind, node }`, with `flow` compared when the expectation gives
  // it. Never the message, whose wording is each runtime's own. A runner records every engine's onError
  // (OnError, on_error) for it; taking them empties the record. Unreal, whose OnError is bound after the
  // engine is made, records what it reports at once to its decision log and delivers on the first OpenFlow.
  | { op: "expectErrors"; expectResult: { kind: string; node: string; flow?: string }[] }
  // The engine's locales: `locale` is `engine.locale`, the locale in use (what the one locale rule resolved
  // the asked-for one to), and `default` and `included` are `engine.locales`. No transcript.
  | { op: "expectLocale"; expectResult: { locale: string; default: string; included: string[] } }
  // A careless host (corpus 8): deface what the last `advance` or `stepFor` handed it, in place. In the step's
  // gameData, or each option's on a choice, every flags list gains the item "scribbled", then every value
  // becomes "scribbled" and the map gains the key "scribbled" too. Extension values are left alone: they are
  // the bundle's own and read-only by contract. Nothing is asserted: the steps that follow, from this engine
  // or another on the same bundle, must carry the bundle's values unchanged, since what a host is handed is
  // its own copy.
  | { op: "scribble" }
  // What the engines' loads put back to their defaults since the case began or the last expectRefits, in
  // order: each saved value that no longer fit its declaration (a stage, an enum value or a flag the edit
  // deleted), as `{ scope, name, value }` with `scope` the registry key and `value` what the save held. A
  // runner records every engine's onRefit (OnRefit, on_refit) for it; taking them empties the record.
  | { op: "expectRefits"; expectResult: { scope: string; name: string; value: ScalarValue }[] };

/** A compiled scripted case in the portable corpus. */
export interface ScriptedCase {
  name: string;
  bundle: Bundle;
  /** The EDITED bundle a `hotSwap` op switches to (present iff the script uses `hotSwap`). */
  bundleB?: Bundle;
  /** Seeds each flow's built-in serialisable PRNG (survives saveLoad). */
  seed?: number;
  /** The locale every engine in the case is made with (corpus 8), resolved by the one locale rule; omit for
   *  the bundle's default. Not save state: a `saveLoad` engine starts in it again, whatever `setLocale` did. */
  locale?: string;
  /** Host scopes the runner binds (corpus 8), by token, each to a resolver over a store the runner keeps for
   *  the case (empty to start, read and written by name, shared by every engine the case makes). Omit to bind
   *  none, as the cases before them did. */
  hostScopes?: string[];
  /** Engine construction options, for this engine and every engine `saveLoad` / `hotSwap` makes. */
  engineOptions?: CaseEngineOptions;
  /** Record each line and text step's spoken fields in its transcript (`TranscriptSpoken`, corpus 11). */
  spoken?: true;
  script: ScriptOp[];
}

/**
 * A gameData merge-at-read case: a node's SPARSE override resolved against its TYPE's declared field
 * defaults (runtime `effectiveGameData`). Not a transcript - step results carry the raw override, while
 * the host reads the FULL effective gameData via this pure resolution, which every port replicates.
 */
export interface GameDataCase {
  name: string;
  /** Carries `gameDataFields` - the per-type field schema + defaults. */
  bundle: Bundle;
  /** The node type whose fields apply (`scene` / `block` / `snippet` / `line` / `text` / `gameEvent` / `option`). */
  kind: GameDataNodeKind;
  /** The node's sparse override (omit = no overrides; pure defaults). */
  node?: GameData;
  /** The full effective gameData: declared fields filled (override or default), override-only orphans kept. */
  expected: GameData;
}

/**
 * A save written by the JS REFERENCE, carried verbatim, which every runtime must load through its own
 * save boundary (PatterSave / deserializeState) and then continue the script. This is the one place in
 * the corpus where the writer and the reader are different runtimes - which no self round-trip can
 * test, and is exactly how three ports came to hold three save shapes while every `saveLoad` op passed
 * (from-storylets/save-shape-across-engines, 2026-09-03). `keyPaths` is what the port's OWN
 * re-serialisation of the loaded state must reproduce: semantic parity is checked by the script, shape
 * parity by the paths, byte parity is not required.
 */
export interface SaveCase {
  name: string;
  bundle: Bundle;
  seed?: number;
  /** Engine construction options, for the engine that loads the envelope (the reference wrote it under the
   *  same) and every engine the script's `saveLoad` makes. */
  engineOptions?: CaseEngineOptions;
  /** `{ schema: "patter/save@0", save }` exactly as `@patterkit/play-helpers` serializeState writes it (or as an
   *  older runtime wrote it: a version 3 save among them). */
  envelope: SaveEnvelope;
  /** Every key path in the envelope a runtime writes back having loaded `envelope`, sorted
   *  (`save/flows/main/cursor/stack[0]/sceneId`); containers included. The envelope's own, unless it is an
   *  older save, which is written back in today's version. */
  keyPaths: string[];
  /** Continues from the loaded state; starts with `useFlow`, since nothing opened a flow in this engine. */
  script: ScriptOp[];
}

/**
 * A decision-log case: the engine's log, entry for entry, in the reference's shape. Played as a
 * RuntimeCase is (the same choices contract), with `log` on, and compared as the ENGINE log
 * (`Engine.log()`, every entry tagged with its flow). The flow is opened as "main".
 *
 * Each port also holds its live tap to the same run: `onTrace` must hand over exactly the decisions
 * the log keeps, in order, with the log on and with it off.
 */
export interface LogCase {
  name: string;
  bundle: Bundle;
  seed?: number;
  start: { scene: string; block?: string };
  choices?: string[];
  expectedLog: ExpectedLogEntry[];
}

/** One expected engine-log entry: the reference's `EngineLogEntry`, as JSON. */
export type ExpectedLogEntry = { type: string; flow: string; seq: number; scene?: string } & Record<string, unknown>;

export interface Corpus {
  version: number;
  expressions: ExpressionCase[];
  specificity: SpecificityCase[];
  runtime: RuntimeCase[];
  scripted: ScriptedCase[];
  gameData: GameDataCase[];
  saves: SaveCase[];
  logs: LogCase[];
  describes: DescribeCase[];
  outlines: OutlineCase[];
  audio: AudioCase[];
  durations: DurationCase[];
  speech: SpeechCase[];
}

/**
 * A structure case: getOutline() and getBeatSequence() for one bundle, in the reference's shape (field
 * names, order, and an absent optional field absent). Written by the reference at build time, as a
 * describe case is; the reference's own tests pin what it says.
 */
export interface OutlineCase {
  name: string;
  bundle: Bundle;
  expectedOutline: unknown;
  expectedBeatSequence: unknown;
}

/**
 * An audio case: a `patteraudio.json` manifest, and what the audio resolver gives for a beat under a base
 * path: the base and the take's file joined (a base that already ends in a separator is kept as it stands),
 * or null when the beat has no take.
 */
export interface AudioCase {
  name: string;
  manifest: string;
  lookups: { base: string; beatId: string; expected: string | null }[];
}

/**
 * A duration case (corpus 9, re-pinned in 11): how long a line with no recording lasts, in seconds, by the one rule
 * every runtime shares (`estimateLineDuration`): the total weight of its speech units at `syllablesPerSecond` (5 when
 * absent), clamped to 1.5 to 18. `locale` is the language the line is spoken in. A runner compares to within 1e-9.
 */
export interface DurationCase {
  name: string;
  text: string;
  locale?: string;
  syllablesPerSecond?: number;
  expected: number;
}

/**
 * A speech case (corpus 11): a line broken into the units it would be spoken in (`speechUnits`), each its kind,
 * weight, and code-point offsets, and its syllable count (`countSyllables`). `locale` is the language the line is
 * spoken in. A runner compares the units exactly, and the count to within 1e-9.
 */
export interface SpeechCase {
  name: string;
  text: string;
  locale?: string;
  units: { kind: "syllable" | "closed" | "pause"; weight: number; start: number; end: number }[];
  syllables: number;
}

/**
 * A bundle description case: what `describeBundle` says about a bundle, in the reference's shape (field
 * names, order, and an absent optional field absent). Each port describes the bundle through its own
 * call and compares. The expectation is the JS reference's own description, written at build time: the
 * reference's describe tests pin what it should say, and this pins every port to it.
 */
export interface DescribeCase {
  name: string;
  bundle: Bundle;
  expected: unknown;
}

// --- Authoring fixtures (source form, compiled into the corpus) -------------

export interface ExpressionFixture {
  name: string;
  src: string;
  scopes: Record<string, ScopeBag>;
  seed?: number;
  expected: ScalarValue;
}

/** An authored specificity fixture (source form; compiled by buildCorpus). */
export interface SpecificityFixture {
  name: string;
  src: string;
  scopes: Record<string, ScopeBag>;
  /** Expected matched-constraint specificity score (hand-derived from the spec). */
  expected: number;
}

export interface RuntimeFixture {
  name: string;
  project: ProjectFile;
  scenes: Scene[];
  locales?: LocaleFile[];
  seed?: number;
  /** Active locale to play in (compiled into the case); omit for the default. */
  locale?: string;
  /** Build an IDs-only bundle: buildCorpus strips the strings + sets `localisation.mode = "ids"`, so the
   *  engine emits beat IDs and omits character names (the game localises them). */
  idsOnly?: boolean;
  engineOptions?: CaseEngineOptions;
  start?: { scene?: string; block?: string };
  choices?: string[];
  expectedTranscript: TranscriptStep[];
  /** The extensions' manifests, as a project keeps them in `extensions/<id>.extension.json` (corpus 3): each
   *  compiled through the real `exportBundle` with `extensionShards` and the project's `extensions`. */
  extensionManifests?: unknown[];
  /** The extension data shards, compiled onto the nodes they name. */
  extensionShards?: ExtensionShard[];
}

/** An authored gameData fixture (source form; compiled by buildCorpus into a GameDataCase). */
export interface GameDataFixture {
  name: string;
  project: ProjectFile;
  kind: GameDataNodeKind;
  node?: GameData;
  expected: GameData;
}

/** An authored scripted fixture (source form; compiled by buildCorpus). */
export interface ScriptedFixture {
  name: string;
  project: ProjectFile;
  scenes: Scene[];
  locales?: LocaleFile[];
  /** The EDITED scenes/locales compiled into `bundleB` for `hotSwap` scripts (project is shared
   *  unless `projectB` overrides it - e.g. a quality's ladder growing a stage mid-production). */
  scenesB?: Scene[];
  localesB?: LocaleFile[];
  projectB?: ProjectFile;
  seed?: number;
  /** The locale the case's engines are made with (see `ScriptedCase.locale`). */
  locale?: string;
  /** Host scopes the runner binds (see `ScriptedCase.hostScopes`). */
  hostScopes?: string[];
  engineOptions?: CaseEngineOptions;
  /** Build the bundle IDs-only, as a runtime case can (no strings; steps carry beat ids and no names). */
  idsOnly?: boolean;
  /** Record the spoken fields (`ScriptedCase.spoken`). */
  spoken?: true;
  script: ScriptOp[];
  /** The extensions' manifests, as a project keeps them in `extensions/<id>.extension.json` (corpus 3): each
   *  compiled through the real `exportBundle` with `extensionShards` and the project's `extensions`. */
  extensionManifests?: unknown[];
  /** The extension data shards, compiled onto the nodes they name. */
  extensionShards?: ExtensionShard[];
}

export interface SaveFixture {
  name: string;
  project: ProjectFile;
  scenes: Scene[];
  locales?: LocaleFile[];
  seed?: number;
  engineOptions?: CaseEngineOptions;
  /** Played by the reference engine at corpus-build time; the envelope is what it saves afterwards. */
  setup: ScriptOp[];
  /** Edits the reference's save before it becomes the envelope: to stand for a save an older runtime
   *  wrote (a field it did not have yet, or a version 3 save). The case's `keyPaths` are what the reference
   *  writes back having loaded it, so a runtime must write back exactly that. */
  editSave?: (save: SaveGame, bundle: Bundle) => void;
  /** What every runtime must reproduce having loaded that envelope. */
  script: ScriptOp[];
}

/** An authored decision-log fixture (source form; compiled by buildCorpus into a LogCase). */
export interface LogFixture {
  name: string;
  project: ProjectFile;
  scenes: Scene[];
  locales?: LocaleFile[];
  seed?: number;
  start?: { scene?: string; block?: string };
  choices?: string[];
  expectedLog: ExpectedLogEntry[];
}

export interface Fixtures {
  expressions: ExpressionFixture[];
  specificity: SpecificityFixture[];
  runtime: RuntimeFixture[];
  scripted: ScriptedFixture[];
  gameData: GameDataFixture[];
  saves: SaveFixture[];
  logs: LogFixture[];
  describes: DescribeFixture[];
  outlines: DescribeFixture[];
  audio: AudioCase[];
  durations: DurationCase[];
  speech: SpeechCase[];
}

/** An authored describe fixture (source form; compiled by buildCorpus into a DescribeCase). */
export interface DescribeFixture {
  name: string;
  project: ProjectFile;
  scenes: Scene[];
  locales?: LocaleFile[];
  /** The extensions' manifests, as a project keeps them in `extensions/<id>.extension.json` (corpus 3): each
   *  compiled through the real `exportBundle` with `extensionShards` and the project's `extensions`. */
  extensionManifests?: unknown[];
  /** The extension data shards, compiled onto the nodes they name. */
  extensionShards?: ExtensionShard[];
}
