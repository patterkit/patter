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
import type { Bundle, ProjectFile, Scene, LocaleFile, GameData, GameDataNodeKind } from "@patterkit/model";

export type ScopeBag = Record<string, ScalarValue>;

/**
 * A normalised transcript entry: the step results the engine yields (`line` /
 * `text` / `action` / `choice` / `end`). `gameData` is included when a beat /
 * option carries it (host-facing payload is part of the contract) - and is where
 * host event emission lives now (effects are set-only, spec §15).
 */
export type TranscriptStep =
  | { type: "line"; id: string; text: string; character?: string; characterName?: string; direction?: string; gameData?: GameData; tags?: string[] }
  | { type: "text"; id: string; text: string; gameData?: GameData; tags?: string[] }
  | { type: "gameEvent"; id: string; gameData?: GameData; tags?: string[] }
  | { type: "choice"; options: { id: string; text?: string; eligible: boolean; gameData?: GameData }[] }
  | { type: "end" };

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
  | { op: "openFlow"; flow: string; scene: string; block?: string; seed?: number; expect?: TranscriptStep[] }
  | { op: "useFlow"; flow: string }
  | { op: "advance"; expect: TranscriptStep[] }
  | { op: "choose"; id: string; expect?: TranscriptStep[] }
  | { op: "saveLoad" }
  | { op: "setLocale"; locale: string } // live language switch: re-points the active string table, no state change
  | { op: "setClosedCaptions"; on: boolean } // live caption toggle (#214): strip dialogue cues when off; no state change
  // Live bundle refresh (§9.8 cross-bundle drift): serialise the whole game, construct a fresh engine
  // on the case's EDITED bundle (`bundleB`), restore into it. Same semantics as saveLoad, onto changed
  // content: stack frames re-find their next child by id, drifted choice options drop, a vanished
  // active snippet is skipped. Every port must resolve the drift identically.
  | { op: "hotSwap" }
  | { op: "reset" };

/** A compiled scripted case in the portable corpus. */
export interface ScriptedCase {
  name: string;
  bundle: Bundle;
  /** The EDITED bundle a `hotSwap` op switches to (present iff the script uses `hotSwap`). */
  bundleB?: Bundle;
  /** Seeds each flow's built-in serialisable PRNG (survives saveLoad). */
  seed?: number;
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

export interface Corpus {
  version: number;
  expressions: ExpressionCase[];
  runtime: RuntimeCase[];
  scripted: ScriptedCase[];
  gameData: GameDataCase[];
}

// --- Authoring fixtures (source form, compiled into the corpus) -------------

export interface ExpressionFixture {
  name: string;
  src: string;
  scopes: Record<string, ScopeBag>;
  seed?: number;
  expected: ScalarValue;
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
  /** The EDITED scenes/locales compiled into `bundleB` for `hotSwap` scripts (project is shared). */
  scenesB?: Scene[];
  localesB?: LocaleFile[];
  seed?: number;
  script: ScriptOp[];
}

export interface Fixtures {
  expressions: ExpressionFixture[];
  runtime: RuntimeFixture[];
  scripted: ScriptedFixture[];
  gameData: GameDataFixture[];
}
