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
import type { Bundle, ProjectFile, Scene, LocaleFile, GameData, GameDataNodeKind, SaveEnvelope, SaveGame } from "@patterkit/model";

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
 */
export type TranscriptStep =
  | { type: "line"; id: string; text: string; character?: string; characterName?: string; direction?: string; gameData?: GameData; tags?: string[] }
  | { type: "text"; id: string; text: string; gameData?: GameData; tags?: string[] }
  | { type: "gameEvent"; id: string; gameData?: GameData; tags?: string[] }
  | { type: "choice"; groupId: string; options: TranscriptOption[] }
  | { type: "end" };

/** One option of a transcript `choice`: the runtime's ChoiceOption, keys absent when unset. */
export interface TranscriptOption {
  id: string;
  /** Absent only when the option has no prompt beat and no content line to stand in for one. */
  prompt?: TranscriptPrompt;
  eligible: boolean;
  gameData?: GameData;
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
  | { op: "openFlow"; flow: string; scene: string; block?: string; seed?: number; expect?: TranscriptStep[]; expectResult?: boolean }
  | { op: "useFlow"; flow: string }
  | { op: "advance"; expect: TranscriptStep[] }
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
  | { op: "setLocale"; locale: string } // live language switch: re-points the active string table, no state change
  | { op: "setClosedCaptions"; on: boolean } // live caption toggle (#214): strip dialogue cues when off; no state change
  // Live bundle refresh (§9.8 cross-bundle drift): serialise the whole game, construct a fresh engine
  // on the case's EDITED bundle (`bundleB`), restore into it. Same semantics as saveLoad, onto changed
  // content: stack frames re-find their next child by id, drifted choice options drop, a vanished
  // active snippet is skipped. Every port must resolve the drift identically.
  | { op: "hotSwap" }
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
  | { op: "reset" }
  // Checkpoints: `checkpoint` opens one (the engine's `checkpoint()`); `rollback` puts the whole game back
  // as it was then (every property, visit count, shuffle and sequence position, every flow's cursor and
  // PRNG; a flow opened since is closed and forgotten); `commit` keeps everything. None produces a
  // transcript: the advances after them show the state they left. One checkpoint at a time.
  | { op: "checkpoint" }
  | { op: "rollback" }
  | { op: "commit" };

/** A compiled scripted case in the portable corpus. */
export interface ScriptedCase {
  name: string;
  bundle: Bundle;
  /** The EDITED bundle a `hotSwap` op switches to (present iff the script uses `hotSwap`). */
  bundleB?: Bundle;
  /** Seeds each flow's built-in serialisable PRNG (survives saveLoad). */
  seed?: number;
  /** Engine construction options, for this engine and every engine `saveLoad` / `hotSwap` makes. */
  engineOptions?: CaseEngineOptions;
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
  /** The node type whose fields apply (`scene` / `block` / `snippet` / `line` / `prose` / `action`). */
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
  /** `{ schema: "patter/save@0", save }` exactly as `@patterkit/play-helpers` serializeState writes it. */
  envelope: SaveEnvelope;
  /** Every key path in `envelope`, sorted (`save/flows/main/cursor/stack[0]/sceneId`); containers included. */
  keyPaths: string[];
  /** Continues from the loaded state; starts with `useFlow`, since nothing opened a flow in this engine. */
  script: ScriptOp[];
}

export interface Corpus {
  version: number;
  expressions: ExpressionCase[];
  specificity: SpecificityCase[];
  runtime: RuntimeCase[];
  scripted: ScriptedCase[];
  gameData: GameDataCase[];
  saves: SaveCase[];
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
  engineOptions?: CaseEngineOptions;
  script: ScriptOp[];
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
   *  wrote (a field it did not have yet). The case's `keyPaths` are the edited envelope's, so a runtime
   *  must write back exactly what it loaded. */
  editSave?: (save: SaveGame) => void;
  /** What every runtime must reproduce having loaded that envelope. */
  script: ScriptOp[];
}

export interface Fixtures {
  expressions: ExpressionFixture[];
  specificity: SpecificityFixture[];
  runtime: RuntimeFixture[];
  scripted: ScriptedFixture[];
  gameData: GameDataFixture[];
  saves: SaveFixture[];
}
