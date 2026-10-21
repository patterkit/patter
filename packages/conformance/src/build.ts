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
import { EXTENSION_SHARD, EXTENSIONS_DIR, MANIFEST_EXTENSION, PROJECT_EXTENSION_STEM, PROJECT_LOCALE_SCENE, SAVE_SCHEMA } from "@patterkit/model";
import type { Bundle, ExtensionShard, SaveEnvelope } from "@patterkit/model";
import type { ExportInput } from "@patterkit/compiler";
import { envelopeKeyPaths, runScript } from "./runner.js";
import type { Corpus, DescribeCase, OutlineCase, ExpressionCase, Fixtures, GameDataCase, LogCase, RuntimeCase, SaveCase, ScriptedCase, SpecificityCase } from "./types.js";

/**
 * The corpus version, which says what a runner must understand.
 *  2: the corpus as it stood before Patter extensions.
 *  3: Patter extensions (patterkit design/proposals/patter-storylet-extensions.md, phase 3): a bundle's
 *  `extensions` section and a node's `extensions` values, `extensions` on a transcript's line, text and
 *  gameEvent steps and its options, and the ops `expectExtensions` and `expectNodeExtensions`. Values are any
 *  JSON, so a runner compares them deeply. No earlier expectation changed.
 *  4: an extension's settings in the bundle (`extensions[id].settings`) and the op `expectExtensionSettings`.
 *  No earlier expectation changed.
 *  5: action text (patterkit design/proposals/action-text.md): `action: true` on a transcript's text step, for
 *  a dialogue scene's text in a project that doesn't localise it, whose text is the source in every locale.
 *  No earlier expectation changed.
 *  6: `expectExtensions` with `snippet` (and no `scene`): a snippet's own values, `extensionsForSnippet`.
 *  No earlier expectation changed.
 *  7: claims and settings are gone from the extensions spec (2026-10-20), so version 4's go: the bundle carries
 *  no `extensions[id].settings`, and the op `expectExtensionSettings` and its cases are removed. A runner
 *  ignores an older bundle's settings. No other expectation changed.
 */
export const CORPUS_VERSION = 7;

/**
 * A fixture's extension files as a project keeps them, for the real compile: each manifest at
 * `extensions/<id>.extension.json`, and each shard in its extension's folder, named for its scene (the project's
 * own as `_project`). Undefined for a fixture with none, so every earlier case compiles exactly as it did.
 */
function fixtureExtensions(f: { extensionManifests?: unknown[]; extensionShards?: ExtensionShard[] }): ExportInput["extensions"] {
  if (f.extensionManifests === undefined && f.extensionShards === undefined) return undefined;
  return {
    manifests: (f.extensionManifests ?? []).map((manifest) => {
      const id = String((manifest as { id?: unknown }).id);
      return { path: `${EXTENSIONS_DIR}/${id}${MANIFEST_EXTENSION}`, id, manifest };
    }),
    shards: (f.extensionShards ?? []).map((shard) => ({
      path: `${EXTENSIONS_DIR}/${shard.extension}/${shard.scene === PROJECT_LOCALE_SCENE ? PROJECT_EXTENSION_STEM : shard.scene}${EXTENSION_SHARD}`,
      shard,
    })),
  };
}

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
    const bundle = idsOnlyIf(f.idsOnly, exportBundle({ project: f.project, scenes: f.scenes, locales: f.locales, extensions: fixtureExtensions(f) }));
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
    bundle: idsOnlyIf(f.idsOnly, exportBundle({ project: f.project, scenes: f.scenes, locales: f.locales, extensions: fixtureExtensions(f) })),
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
    const bundle = exportBundle({ project: f.project, scenes: f.scenes, locales: f.locales, extensions: fixtureExtensions(f) });
    return { name: f.name, bundle, expected: JSON.parse(JSON.stringify(describeBundle(bundle))) };
  });

  const outlines: OutlineCase[] = fixtures.outlines.map((f) => {
    const bundle = exportBundle({ project: f.project, scenes: f.scenes, locales: f.locales, extensions: fixtureExtensions(f) });
    const engine = new Engine(bundle);
    return {
      name: f.name, bundle,
      expectedOutline: JSON.parse(JSON.stringify(engine.getOutline())),
      expectedBeatSequence: JSON.parse(JSON.stringify(engine.getBeatSequence())),
    };
  });

  return { version: CORPUS_VERSION, expressions, specificity, runtime, scripted, gameData, saves, logs, describes, outlines, audio: fixtures.audio };
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
