// ---------------------------------------------------------------------------
// build: authoring fixtures -> the portable corpus.
//
// Compiles each fixture's source (expression `src` -> tagged-tuple `ast`;
// project/scenes/locales -> runtime `bundle`) and carries the HAND-AUTHORED
// `expected` / `expectedTranscript` through unchanged. The expected values are
// the contract; compilation is mechanical. Uses the compiler, so this runs at
// corpus-generation time only - never on the runtime/port path.
// ---------------------------------------------------------------------------

import { compileExpression, exportBundle } from "@patterkit/compiler";
import type { Corpus, ExpressionCase, Fixtures, GameDataCase, RuntimeCase, ScriptedCase, SpecificityCase } from "./types.js";

export function buildCorpus(fixtures: Fixtures): Corpus {
  const expressions: ExpressionCase[] = fixtures.expressions.map((f) => ({
    name: f.name,
    src: f.src,
    ast: compileExpression(f.src).ast,
    scopes: f.scopes,
    ...(f.seed !== undefined ? { seed: f.seed } : {}),
    expected: f.expected,
  }));

  const specificity: SpecificityCase[] = fixtures.specificity.map((f) => ({
    name: f.name,
    src: f.src,
    ast: compileExpression(f.src).ast,
    scopes: f.scopes,
    expected: f.expected,
  }));

  const runtime: RuntimeCase[] = fixtures.runtime.map((f) => {
    let bundle = exportBundle({ project: f.project, scenes: f.scenes, locales: f.locales });
    if (f.idsOnly) { // IDs-only build: no strings, runtime emits beat IDs + omits character names
      bundle = { ...bundle, strings: {}, localisation: { mode: "ids" } };
    }
    return {
      name: f.name,
      bundle,
      ...(f.seed !== undefined ? { seed: f.seed } : {}),
      ...(f.locale !== undefined ? { locale: f.locale } : {}),
      // The start scene is always RESOLVED into the case: a port parsing
      // `bundle.scenes` into an unordered map cannot rely on key order to find
      // the default entry scene.
      start: { scene: f.start?.scene ?? f.scenes[0]!.id, ...(f.start?.block ? { block: f.start.block } : {}) },
      ...(f.choices ? { choices: f.choices } : {}),
      expectedTranscript: f.expectedTranscript,
    };
  });

  const scripted: ScriptedCase[] = fixtures.scripted.map((f) => ({
    name: f.name,
    bundle: exportBundle({ project: f.project, scenes: f.scenes, locales: f.locales }),
    // The EDITED bundle a hotSwap op switches to (cross-bundle drift cases, §9.8): same project,
    // edited scenes/strings.
    ...(f.scenesB ? { bundleB: exportBundle({ project: f.project, scenes: f.scenesB, locales: f.localesB ?? f.locales }) } : {}),
    ...(f.seed !== undefined ? { seed: f.seed } : {}),
    script: f.script,
  }));

  const gameData: GameDataCase[] = fixtures.gameData.map((f) => ({
    name: f.name,
    // The bundle carries the per-type field schema + defaults (project.gameDataFields); no scenes needed.
    bundle: exportBundle({ project: f.project, scenes: [], locales: [] }),
    kind: f.kind,
    ...(f.node !== undefined ? { node: f.node } : {}),
    expected: f.expected, // hand-authored contract, carried through unchanged
  }));

  return { version: 2, expressions, specificity, runtime, scripted, gameData };
}
