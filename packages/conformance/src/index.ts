// @patterkit/conformance - the parity contract (Plan §8).
//
// `cases` are the human-authored fixtures; `buildCorpus` compiles them to the
// portable `corpus.json`; `runExpressionCase` / `runRuntimeCase` replay a
// portable case through the runtime-only surface. A port's reference harness can
// import the corpus JSON and re-implement the two runners in its own language.

export type {
  Corpus, ExpressionCase, SpecificityCase, RuntimeCase, ScriptedCase, GameDataCase, SaveCase, ScriptOp, TranscriptStep, ScopeBag,
  ExpressionFixture, SpecificityFixture, RuntimeFixture, ScriptedFixture, GameDataFixture, SaveFixture, Fixtures,
} from "./types.js";
export { buildCorpus } from "./build.js";
export { runExpressionCase, runSpecificityCase, runRuntimeCase, runScriptedCase, runScript, runSaveCase, runGameDataCase, envelopeKeyPaths, normaliseStep, mulberry32 } from "./runner.js";
export { cases } from "./cases.js";
