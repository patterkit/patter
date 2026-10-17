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
import { Engine, describeBundle } from "@patterkit/runtime";
import { SAVE_SCHEMA } from "@patterkit/model";
import type { Bundle, SaveEnvelope } from "@patterkit/model";
import { envelopeKeyPaths, runScript } from "./runner.js";
import type { Corpus, DescribeCase, OutlineCase, ExpressionCase, Fixtures, GameDataCase, LogCase, RuntimeCase, SaveCase, ScriptedCase, SpecificityCase } from "./types.js";

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

  // An IDs-only build: no strings, so the runtime emits beat ids and omits character names.
  const idsOnlyIf = (idsOnly: boolean | undefined, bundle: Bundle): Bundle =>
    idsOnly ? { ...bundle, strings: {}, localisation: { mode: "ids" } } : bundle;

  const runtime: RuntimeCase[] = fixtures.runtime.map((f) => {
    const bundle = idsOnlyIf(f.idsOnly, exportBundle({ project: f.project, scenes: f.scenes, locales: f.locales }));
    return {
      name: f.name,
      bundle,
      ...(f.seed !== undefined ? { seed: f.seed } : {}),
      ...(f.locale !== undefined ? { locale: f.locale } : {}),
      ...(f.engineOptions !== undefined ? { engineOptions: f.engineOptions } : {}),
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
    bundle: idsOnlyIf(f.idsOnly, exportBundle({ project: f.project, scenes: f.scenes, locales: f.locales })),
    // The EDITED bundle a hotSwap op switches to (cross-bundle drift cases, §9.8): same project,
    // edited scenes/strings.
    ...(f.scenesB ? { bundleB: exportBundle({ project: f.projectB ?? f.project, scenes: f.scenesB, locales: f.localesB ?? f.locales }) } : {}),
    ...(f.seed !== undefined ? { seed: f.seed } : {}),
    ...(f.engineOptions !== undefined ? { engineOptions: f.engineOptions } : {}),
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

  // A save written by the REFERENCE at build time: play the setup, then serialise exactly as
  // play-helpers' serializeState does. The envelope lands in the corpus verbatim, so every port reads a
  // document another runtime wrote - the one thing a self round-trip can never check.
  const saves: SaveCase[] = fixtures.saves.map((f) => {
    const bundle = exportBundle({ project: f.project, scenes: f.scenes, locales: f.locales });
    const options = { ...(f.seed !== undefined ? { seed: f.seed } : {}), ...f.engineOptions };
    const { engine } = runScript(new Engine(bundle, options), f.setup, { bundle, options });
    const envelope: SaveEnvelope = { schema: SAVE_SCHEMA, save: JSON.parse(JSON.stringify(engine.saveGame())) };
    f.editSave?.(envelope.save); // a save as an older runtime wrote it
    return {
      name: f.name,
      bundle,
      ...(f.seed !== undefined ? { seed: f.seed } : {}),
      ...(f.engineOptions !== undefined ? { engineOptions: f.engineOptions } : {}),
      envelope,
      keyPaths: envelopeKeyPaths(envelope),
      script: f.script,
    };
  });

  const logs: LogCase[] = fixtures.logs.map((f) => ({
    name: f.name,
    bundle: exportBundle({ project: f.project, scenes: f.scenes, locales: f.locales }),
    ...(f.seed !== undefined ? { seed: f.seed } : {}),
    start: { scene: f.start?.scene ?? f.scenes[0]!.id, ...(f.start?.block ? { block: f.start.block } : {}) },
    ...(f.choices ? { choices: f.choices } : {}),
    expectedLog: f.expectedLog, // hand-authored contract, carried through unchanged
  }));

  const describes: DescribeCase[] = fixtures.describes.map((f) => {
    const bundle = exportBundle({ project: f.project, scenes: f.scenes, locales: f.locales });
    return { name: f.name, bundle, expected: JSON.parse(JSON.stringify(describeBundle(bundle))) };
  });

  const outlines: OutlineCase[] = fixtures.outlines.map((f) => {
    const bundle = exportBundle({ project: f.project, scenes: f.scenes, locales: f.locales });
    const engine = new Engine(bundle);
    return {
      name: f.name, bundle,
      expectedOutline: JSON.parse(JSON.stringify(engine.getOutline())),
      expectedBeatSequence: JSON.parse(JSON.stringify(engine.getBeatSequence())),
    };
  });

  return { version: 2, expressions, specificity, runtime, scripted, gameData, saves, logs, describes, outlines, audio: fixtures.audio };
}

// The corpus as the committed corpus.json text. Every case's inputs (`bundle`, `bundleB`, `envelope`) write a
// character outside the Basic Multilingual Plane as an escaped UTF-16 surrogate pair ("\ud83d\ude00"), as some
// JSON writers do, while the expectations keep it as raw UTF-8. A reader must join the pair into the one
// character: one that decodes each half on its own reads a string other than the one it is compared with.
const ESCAPED_INPUTS = new Set(["bundle", "bundleB", "envelope"]);
const escapeAstral = (json: string): string =>
  json.replace(/[\u{10000}-\u{10FFFF}]/gu, (c) => `\\u${c.charCodeAt(0).toString(16)}\\u${c.charCodeAt(1).toString(16)}`);

export function serializeCorpus(corpus: Corpus): string {
  // Each input is held out of the first pass behind a marker string, then written escaped at the marker's
  // indent, so the text is exactly JSON.stringify's apart from the escapes.
  const held: unknown[] = [];
  const text = JSON.stringify(corpus, (key, value: unknown) => {
    if (!ESCAPED_INPUTS.has(key) || value === null || typeof value !== "object") return value;
    held.push(value);
    return `\u0000input-${held.length - 1}`;
  }, 2);
  return text.replace(/^( *)(.*)"\\u0000input-(\d+)"/gm, (_, indent: string, before: string, i: string) =>
    indent + before + escapeAstral(JSON.stringify(held[Number(i)], null, 2)).replace(/\n/g, "\n" + indent)) + "\n";
}
