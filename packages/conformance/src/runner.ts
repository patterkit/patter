// ---------------------------------------------------------------------------
// runner: replay a portable corpus case through the RUNTIME-ONLY surface.
//
// This is the reference implementation of "what a conforming runtime does":
//   - expression case: deserialise the ast, evaluate it against the scopes
//     (+ a seeded PRNG for `random()`), via the Patter dialect.
//   - runtime case: construct the Engine on the bundle, play it (consuming the
//     scripted choices), and collect the normalised step sequence.
//
// It imports neither the parser nor the compiler - proving the corpus is
// self-contained, exactly as a port (an AST-walker) consumes it. The PRNG below
// is mulberry32, byte-identical to the engine's, and is part of the contract:
// ports must reproduce it for seeded `random()` / shuffle.
// ---------------------------------------------------------------------------

import { evaluate, deserialiseAst, makePrng } from "@wildwinter/expr";
import type { EvalContext, ScalarValue } from "@wildwinter/expr";
import { matchedSpecificity } from "@wildwinter/expr-specificity";
import { patterDialect } from "@patterkit/dialect";
import { Engine, effectiveGameData, extensionDecls, extensionsOf, gameDataFields } from "@patterkit/runtime";
import type { Checkpoint, EngineOptions, LoadMisfit, StepResult } from "@patterkit/runtime";
import { SAVE_SCHEMA, DEFAULT_PAD_AFTER } from "@patterkit/model";
import { createAudioResolver } from "@patterkit/play-helpers";
import type { Bundle, FlowState, GameData, SaveEnvelope } from "@patterkit/model";
import type {
  AudioCase, LogCase,
  ExpressionCase, GameDataCase, RuntimeCase, SaveCase, ScriptedCase, ScriptOp, SpecificityCase, TranscriptOption, TranscriptPrompt, TranscriptStep,
} from "./types.js";

/** JSON with every object's keys sorted: extension values are any JSON, and a runner compares them deeply,
 *  whatever order an object's keys arrive in. */
const sorted = (v: unknown): unknown =>
  (Array.isArray(v) ? v.map(sorted)
    : v !== null && typeof v === "object"
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted((v as Record<string, unknown>)[k])])) : v);
const showJson = (v: unknown): string => JSON.stringify(sorted(v));

/** Evaluate one expression case; returns the actual value to compare with `expected`. */
export function runExpressionCase(c: ExpressionCase): ScalarValue {
  const ctx: EvalContext = {
    scopes: c.scopes,
    host: c.seed !== undefined ? { nextRandom: mulberry32(c.seed) } : undefined,
  };
  return evaluate(deserialiseAst(c.ast), ctx, patterDialect);
}

/**
 * Truthiness coercion; mirrors the runtime's `truthy`
 * (packages/runtime/src/engine.ts) so specificity atoms score identically to
 * the `order: "specificity"` selector at play time.
 */
function truthy(v: ScalarValue): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v !== "";
  return v.length > 0; // string[]
}

/** Score one specificity case; returns the actual matched-specificity score. */
export function runSpecificityCase(c: SpecificityCase): number {
  const ctx: EvalContext = { scopes: c.scopes };
  const node = deserialiseAst(c.ast);
  return matchedSpecificity(node, (n) => truthy(evaluate(n, ctx, patterDialect)), { want: true });
}

/** Play one runtime case; returns the actual transcript to compare with `expectedTranscript`. */
export function runRuntimeCase(c: RuntimeCase, maxSteps = 1000): TranscriptStep[] {
  const out: TranscriptStep[] = [];
  const engine = new Engine(c.bundle, {
    ...(c.seed !== undefined ? { rng: mulberry32(c.seed) } : {}),
    ...(c.locale !== undefined ? { locale: c.locale } : {}),
    ...c.engineOptions, // replayPromptOnChoose / closedCaptions, as the case sets them
  });

  const flow = engine.openFlow("main", { scene: c.start?.scene, block: c.start?.block });
  const scripted = [...(c.choices ?? [])];

  for (let i = 0; i < maxSteps; i++) {
    const r = flow.advance();
    out.push(normaliseStep(r, isIdsOnly(c.bundle)));
    if (r.type === "end") break;
    if (r.type === "choice") {
      const pick = scripted.shift() ?? r.options.find((o) => o.eligible)?.id;
      if (pick === undefined) break; // no input + nothing eligible: stop
      flow.choose(pick);
    }
  }
  return out;
}

/**
 * Execute one scripted case, returning the transcript chunk each op produced
 * (index-aligned with the script). The reference semantics a port's runner
 * must match: `saveLoad` = serialise -> brand-new engine -> restore; the
 * current flow survives by id; ops without output must yield empty chunks.
 */
/**
 * Run a script's ops against a LIVE engine, returning the transcript chunk each op produced
 * (index-aligned with the script) and the engine that ends up live - `saveLoad` and `hotSwap` replace
 * it. Shared by the scripted cases (fresh engine) and the save cases (an engine that has just loaded a
 * save written elsewhere); a port's runner has the same split.
 */
export function runScript(
  engine: Engine, ops: ScriptOp[],
  /** `refits` collects what every engine's `onRefit` reported, when the options feed it (caseOptions does). */
  ctx: { bundle: Bundle; bundleB?: Bundle; options: EngineOptions; refits?: LoadMisfit[] }, current = "",
): { chunks: TranscriptStep[][]; engine: Engine } {
  const chunks: TranscriptStep[][] = [];
  let checkpoint: Checkpoint | undefined;
  const captured = new Map<string, FlowState>(); // captureFlow states, by name, for restoreFlow
  // A call the runtime must refuse: it throws, and the engine is as it was (still inside its checkpoint).
  const refused = (what: string, call: () => unknown): void => {
    const wasIn = engine.inCheckpoint;
    try { call(); } catch { if (engine.inCheckpoint !== wasIn) throw new Error(`${what}: a refusal changed the checkpoint`); return; }
    throw new Error(`${what}: expected the runtime to refuse it`);
  };
  for (const op of ops) {
    const chunk: TranscriptStep[] = [];
    switch (op.op) {
      case "openFlow": {
        // A refused open (expectResult false) must leave everything as it was: the name still means the
        // same flow (or none), that flow is not closed, and the current flow does not move.
        const before = engine.getFlow(op.flow);
        let opened = true;
        try {
          engine.openFlow(op.flow, { scene: op.scene, block: op.block, seed: op.seed });
        } catch (e) {
          if (op.expectResult !== false) throw e;
          opened = false;
        }
        const where = `${op.scene}${op.block === undefined ? "" : `/${op.block}`}`;
        if (op.expectResult !== undefined && opened !== op.expectResult) {
          throw new Error(`openFlow ${op.flow} at ${where}: expected ${op.expectResult}, got ${opened}`);
        }
        if (opened) { current = op.flow; break; }
        if (engine.getFlow(op.flow) !== before) throw new Error(`openFlow ${op.flow} at ${where}: a refused open changed what the name means`);
        if (before?.isClosed) throw new Error(`openFlow ${op.flow} at ${where}: a refused open closed the flow already open`);
        break;
      }
      case "useFlow":
        current = op.flow;
        break;
      case "advance": {
        const r = engine.getFlow(current)!.advance();
        chunk.push(normaliseStep(r, isIdsOnly(ctx.bundle)));
        break;
      }
      case "stepFor": {
        // The step the flow would deliver for a beat now, recorded as a delivered one is; none for an unknown id.
        const r = engine.getFlow(op.flow ?? current)!.stepFor(op.beat);
        if (r) chunk.push(normaliseStep(r, isIdsOnly(ctx.bundle)));
        break;
      }
      case "choose":
        engine.getFlow(current)!.choose(op.id);
        break;
      case "goto": {
        // Host navigation by address. No transcript of its own; the next `advance` shows where it landed.
        const moved = engine.getFlow(current)!.goto(op.scene, op.block);
        if (op.expectResult !== undefined && moved !== op.expectResult) {
          throw new Error(`goto ${op.scene}${op.block === undefined ? "" : `/${op.block}`}: expected ${op.expectResult}, got ${moved}`);
        }
        break;
      }
      case "captureFlow":
        captured.set(op.into, JSON.parse(JSON.stringify(engine.captureFlow(op.flow))) as FlowState);
        break;
      case "closeFlow":
        engine.closeFlow(op.flow);
        break;
      case "restoreFlow": {
        const state = captured.get(op.from);
        if (!state) throw new Error(`restoreFlow: nothing captured under '${op.from}'`);
        if (op.expectRefused) { refused("restoreFlow", () => engine.restoreFlow(op.flow, state)); break; }
        engine.restoreFlow(op.flow, state);
        current = op.flow;
        break;
      }
      case "saveLoad": {
        const blob = JSON.parse(JSON.stringify(engine.saveGame()));
        engine = new Engine(ctx.bundle, ctx.options);
        engine.loadGame(blob);
        break;
      }
      case "hotSwap":
        // Live bundle refresh: the whole game carried onto the EDITED bundle. The reference runner
        // uses Engine.hotSwap (save -> fresh engine on bundleB -> load); a port without the helper
        // does the same three calls with its own save API. Drift resolves per §9.8.
        if (op.expectRefused) { refused("hotSwap", () => engine.hotSwap(ctx.bundleB ?? ctx.bundle)); break; }
        engine = engine.hotSwap(ctx.bundleB!);
        break;
      case "setLocale":
        engine.setLocale(op.locale); // live language switch - subsequent beats render in the new locale
        break;
      case "setClosedCaptions":
        engine.setClosedCaptions(op.on); // live caption toggle - subsequent dialogue lines strip cues when off
        break;
      case "expectCast": {
        const got = op.scene === undefined ? engine.getCast()
          : op.block === undefined ? engine.castForScene(op.scene)
          : engine.castForBlock(op.scene, op.block);
        const scope = op.scene === undefined ? "project" : op.block === undefined ? op.scene : `${op.scene}/${op.block}`;
        if (got.length !== op.expectResult.length || got.some((n, i) => n !== op.expectResult[i])) {
          throw new Error(`expectCast ${scope}: expected [${op.expectResult.join(", ")}], got [${got.join(", ")}]`);
        }
        break;
      }
      case "expectGameData": {
        const got = op.block === undefined ? engine.gameDataForScene(op.scene) : engine.gameDataForBlock(op.scene, op.block);
        const scope = op.block === undefined ? op.scene : `${op.scene}/${op.block}`;
        const want = op.expectResult;
        const same = Object.keys(got).length === Object.keys(want).length
          && Object.entries(want).every(([k, v]) => Object.prototype.hasOwnProperty.call(got, k) && got[k] === v);
        if (!same) throw new Error(`expectGameData ${scope}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
        break;
      }
      case "expectExtensions": {
        const got = op.block === undefined ? engine.extensionsForScene(op.scene) : engine.extensionsForBlock(op.scene, op.block);
        const scope = op.block === undefined ? op.scene : `${op.scene}/${op.block}`;
        if (showJson(got) !== showJson(op.expectResult)) {
          throw new Error(`expectExtensions ${scope}: expected ${showJson(op.expectResult)}, got ${showJson(got)}`);
        }
        break;
      }
      case "expectNodeExtensions": {
        // Read off the case's bundle: the helpers take a bundle, not an engine.
        const bundle = ctx.bundle;
        const raw = extensionsOf(bundle, op.kind, op.address);
        const got = op.effective !== undefined
          ? effectiveGameData(extensionDecls(bundle, op.effective.extension, op.kind), raw[op.effective.extension])
          : raw;
        const scope = `${op.kind}${op.address === undefined ? "" : ` ${op.address}`}${op.effective === undefined ? "" : ` (effective ${op.effective.extension})`}`;
        if (showJson(got) !== showJson(op.expectResult)) {
          throw new Error(`expectNodeExtensions ${scope}: expected ${showJson(op.expectResult)}, got ${showJson(got)}`);
        }
        break;
      }
      case "reset":
        if (op.expectRefused) { refused("reset", () => engine.reset()); break; }
        engine.reset();
        current = "";
        break;
      case "resetFlow":
        engine.getFlow(current)!.reset(op.scene, op.block);
        break;
      case "checkpoint":
        if (op.expectRefused) { refused("checkpoint", () => engine.checkpoint()); break; }
        checkpoint = engine.checkpoint();
        break;
      case "expectProperties": {
        const got = JSON.parse(JSON.stringify(engine.listProperties())) as unknown[];
        if (JSON.stringify(got) !== JSON.stringify(op.expectResult)) {
          throw new Error(`expectProperties: expected ${JSON.stringify(op.expectResult)}, got ${JSON.stringify(got)}`);
        }
        break;
      }
      case "stage": {
        const on = op.onFlow ? engine.getFlow(current)! : engine;
        const a = op.args;
        const call = (): number | string =>
          op.call === "index" ? on.stageIndex(op.ref, a[0]!)
            : op.call === "compare" ? on.compareStages(op.ref, a[0]!, a[1]!)
              : on.nextStage(op.ref, a[0]!);
        if (op.expectRefused) { refused(`stage ${op.call} ${op.ref}`, call); break; }
        const got = call();
        if (got !== op.expectResult) throw new Error(`stage ${op.call} ${op.ref}: expected ${JSON.stringify(op.expectResult)}, got ${JSON.stringify(got)}`);
        break;
      }
      case "setProperty":
        // The game's write (engine.setProperty): host authority, as a game moving @world does.
        if (op.expectRefused) { refused(`setProperty ${op.ref}`, () => engine.setProperty(op.ref, op.value)); break; }
        engine.setProperty(op.ref, op.value);
        break;
      case "expectRefits": {
        const got = JSON.parse(JSON.stringify(ctx.refits ?? [])) as unknown[];
        if (JSON.stringify(got) !== JSON.stringify(op.expectResult)) {
          throw new Error(`expectRefits: expected ${JSON.stringify(op.expectResult)}, got ${JSON.stringify(got)}`);
        }
        ctx.refits?.splice(0);
        break;
      }
      case "rollback":
        engine.rollback(checkpoint!);
        checkpoint = undefined;
        break;
      case "commit":
        engine.commit(checkpoint!);
        checkpoint = undefined;
        break;
    }
    chunks.push(chunk);
  }
  return { chunks, engine };
}

/** The options a scripted or save case constructs every engine with: its seed and its engine options, and an
 *  `onRefit` that records into `refits`, for the script's `expectRefits`. */
function caseOptions(c: { seed?: number; engineOptions?: ScriptedCase["engineOptions"] }, refits: LoadMisfit[] = []): EngineOptions {
  return { ...(c.seed !== undefined ? { seed: c.seed } : {}), ...c.engineOptions, onRefit: (m) => { refits.push(...m); } };
}

export function runScriptedCase(c: ScriptedCase): TranscriptStep[][] {
  const refits: LoadMisfit[] = [];
  const options = caseOptions(c, refits);
  return runScript(new Engine(c.bundle, options), c.script, { bundle: c.bundle, bundleB: c.bundleB, options, refits }).chunks;
}

/**
 * Load a save written by the JS reference into a FRESH engine and continue the script: the reference's
 * own copy of what every port does through its own save boundary. Before continuing, the loaded state
 * is written back and its key paths held to the fixture's - a runtime that loads the envelope and
 * writes a different shape has not adopted the contract, it has merely tolerated it.
 */
export function runSaveCase(c: SaveCase): TranscriptStep[][] {
  const refits: LoadMisfit[] = [];
  const options = caseOptions(c, refits);
  const engine = new Engine(c.bundle, options);
  if (c.envelope.schema !== SAVE_SCHEMA) throw new Error(`not a ${SAVE_SCHEMA} envelope`);
  engine.loadGame(JSON.parse(JSON.stringify(c.envelope.save)));
  const back = envelopeKeyPaths({ schema: SAVE_SCHEMA, save: JSON.parse(JSON.stringify(engine.saveGame())) });
  if (back.join("\n") !== c.keyPaths.join("\n")) {
    const missing = c.keyPaths.filter((k) => !back.includes(k));
    const extra = back.filter((k) => !c.keyPaths.includes(k));
    throw new Error(`re-serialised save has different key paths; missing: [${missing.join(", ")}] extra: [${extra.join(", ")}]`);
  }
  return runScript(engine, c.script, { bundle: c.bundle, options, refits }).chunks;
}

/**
 * Every key path in an envelope, sorted: `save/flows/main/cursor/stack[0]/sceneId`. Containers are
 * included (so an empty `sharedSelectors` still shows), array elements are indexed, and leaf TYPES are
 * not recorded - shape, not values. Ports compute the same over their own serialisation and compare
 * with the case's `keyPaths`. Sort is by code unit (ordinal), which every language can match.
 */
export function envelopeKeyPaths(env: SaveEnvelope): string[] {
  const out: string[] = [];
  const walk = (v: unknown, path: string): void => {
    if (Array.isArray(v)) {
      if (path) out.push(path);
      v.forEach((x, i) => walk(x, `${path}[${i}]`));
    } else if (v !== null && typeof v === "object") {
      if (path) out.push(path);
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, path ? `${path}/${k}` : k);
    } else out.push(path);
  };
  walk(env, "");
  return out.sort();
}

/** Whether a bundle's strings are IDs-only, as the runtime reads it (a source-debug build still resolves names). */
function isIdsOnly(bundle: Bundle): boolean {
  return bundle.localisation?.mode === "ids" && !bundle.localisation.sourceDebug;
}

/** A pause as a transcript records it. A step that should carry one and doesn't records a marker rather than
 *  nothing, so a runtime that drops the field fails even where the expected pause is the built-in default. */
function padField(v: unknown): number {
  return (typeof v === "number" ? v : "<missing>") as number;
}

/** A speaker's label as a transcript records it: only where it differs from what a line with no qualifier shows
 *  (nothing in IDs-only mode or with no speaker, else the display name, else the token), so a transcript names
 *  it where a qualifier or a pair's own label changes it. A runtime that drops a label it should carry records a
 *  marker rather than nothing. */
function labelField(character: string | undefined, characterName: string | undefined, speakerLabel: string | undefined, idsOnly: boolean): string | undefined {
  const plain = idsOnly || !character ? undefined : (characterName ?? character);
  return speakerLabel === plain ? undefined : (speakerLabel ?? "<missing>");
}

/** Normalise a StepResult, keeping the fields the contract pins (drops undefined). `idsOnly`: the bundle's
 *  strings are IDs-only, so names (the speaker's label among them) are the game's to resolve. */
export function normaliseStep(r: StepResult, idsOnly = false): TranscriptStep {
  switch (r.type) {
    case "line": {
      const s: TranscriptStep = { type: "line", id: r.id, text: r.text };
      if (r.character !== undefined) s.character = r.character;
      if (r.characterName !== undefined) s.characterName = r.characterName; // locale-resolved display name
      if (r.direction !== undefined) s.direction = r.direction;
      if (r.qualifier !== undefined) s.qualifier = r.qualifier;             // speaker qualifier gameId
      if (r.qualifierName !== undefined) s.qualifierName = r.qualifierName; // and its locale-resolved name
      const label = labelField(r.character, r.characterName, r.speakerLabel, idsOnly);
      if (label !== undefined) s.speakerLabel = label;                      // the speaker's label, where it differs
      if (r.padAfter !== DEFAULT_PAD_AFTER) s.padAfter = padField(r.padAfter);          // line padding, when not the default
      if (r.gameData !== undefined) s.gameData = r.gameData;
      if (r.extensions !== undefined) s.extensions = r.extensions; // Patter extension values, raw
      if (r.tags !== undefined) s.tags = r.tags; // accumulated author tags (#215)
      return s;
    }
    case "text": {
      const s: TranscriptStep = { type: "text", id: r.id, text: r.text };
      if (r.padAfter !== DEFAULT_PAD_AFTER) s.padAfter = padField(r.padAfter);
      if (r.gameData !== undefined) s.gameData = r.gameData;
      if (r.extensions !== undefined) s.extensions = r.extensions;
      if (r.tags !== undefined) s.tags = r.tags;
      return s;
    }
    case "gameEvent": {
      const s: TranscriptStep = { type: "gameEvent", id: r.id };
      if (r.gameData !== undefined) s.gameData = r.gameData;
      if (r.extensions !== undefined) s.extensions = r.extensions;
      if (r.tags !== undefined) s.tags = r.tags;
      return s;
    }
    case "choice":
      // The whole choice as the host receives it: the group id, and each option's structured prompt.
      return { type: "choice", groupId: r.groupId, options: r.options.map((o) => {
        const opt: TranscriptOption = { id: o.id, eligible: o.eligible };
        if (o.prompt !== undefined) {
          const p: TranscriptPrompt = { kind: o.prompt.kind, text: o.prompt.text };
          if (o.prompt.character !== undefined) p.character = o.prompt.character;
          if (o.prompt.characterName !== undefined) p.characterName = o.prompt.characterName;
          if (o.prompt.direction !== undefined) p.direction = o.prompt.direction;
          if (o.prompt.qualifier !== undefined) p.qualifier = o.prompt.qualifier;
          if (o.prompt.qualifierName !== undefined) p.qualifierName = o.prompt.qualifierName;
          if (o.prompt.kind === "line") {
            const label = labelField(o.prompt.character, o.prompt.characterName, o.prompt.speakerLabel, idsOnly);
            if (label !== undefined) p.speakerLabel = label;
          }
          if (o.prompt.padAfter !== DEFAULT_PAD_AFTER) p.padAfter = padField(o.prompt.padAfter);
          opt.prompt = p;
        }
        if (o.gameData !== undefined) opt.gameData = o.gameData;
        if (o.extensions !== undefined) opt.extensions = o.extensions;
        return opt;
      }) };
    case "end":
      return { type: "end" };
  }
}

/** Resolve one gameData case: the node's full effective gameData, merging its sparse override over the
 *  declared field defaults for its type (the reference resolution every port replicates). */
export function runGameDataCase(c: GameDataCase): GameData {
  return effectiveGameData(gameDataFields(c.bundle, c.kind), c.node);
}

/** Small deterministic PRNG (mulberry32) - byte-identical to the engine's. */
export function mulberry32(seed: number): () => number {
  // @wildwinter/expr's makePrng, not a fourth copy of the mixing inside this
  // repo. Same algorithm, same draws; it just lives in one place now.
  const prng = makePrng(seed);
  return () => prng.next();
}

/**
 * Play a decision-log case and return what the engine logged, and what `onTrace` handed over with the
 * log on and with it off (each traced decision as the log entry it matches, less `seq`). As JSON, so an
 * absent field is absent rather than undefined.
 */
export function runLogCase(c: LogCase, maxSteps = 200): { log: unknown[]; tracedOn: unknown[]; tracedOff: unknown[] } {
  const play = (log: boolean) => {
    const engine = new Engine(c.bundle, { ...(c.seed !== undefined ? { seed: c.seed } : {}), log });
    const traced: unknown[] = [];
    engine.onTrace((flow, event) => traced.push({ ...event, flow }));
    const flow = engine.openFlow("main", { scene: c.start.scene, ...(c.start.block ? { block: c.start.block } : {}) });
    const choices = [...(c.choices ?? [])];
    for (let i = 0; i < maxSteps; i++) {
      const r = flow.advance();
      if (r.type === "end") break;
      if (r.type === "choice") {
        const pick = choices.shift() ?? r.options.find((o) => o.eligible)?.id;
        if (pick === undefined) break;
        flow.choose(pick);
      }
    }
    return { log: JSON.parse(JSON.stringify(engine.log())) as unknown[], traced: JSON.parse(JSON.stringify(traced)) as unknown[] };
  };
  const on = play(true);
  return { log: on.log, tracedOn: on.traced, tracedOff: play(false).traced };
}

/** What the audio resolver gives for each lookup of an audio case (the reference's createAudioResolver). */
export function runAudioCase(c: AudioCase): (string | null)[] {
  return c.lookups.map((l) => createAudioResolver(c.manifest, l.base).resolve(l.beatId));
}
