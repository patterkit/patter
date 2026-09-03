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
import { Engine, effectiveGameData, gameDataFields } from "@patterkit/runtime";
import type { StepResult } from "@patterkit/runtime";
import { SAVE_SCHEMA } from "@patterkit/model";
import type { Bundle, GameData, SaveEnvelope } from "@patterkit/model";
import type { ExpressionCase, GameDataCase, RuntimeCase, SaveCase, ScriptedCase, ScriptOp, SpecificityCase, TranscriptStep } from "./types.js";

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
  });

  const flow = engine.openFlow("main", { scene: c.start?.scene, block: c.start?.block });
  const scripted = [...(c.choices ?? [])];

  for (let i = 0; i < maxSteps; i++) {
    const r = flow.advance();
    out.push(normaliseStep(r));
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
  engine: Engine, ops: ScriptOp[], ctx: { bundle: Bundle; bundleB?: Bundle; options: { seed?: number } }, current = "",
): { chunks: TranscriptStep[][]; engine: Engine } {
  const chunks: TranscriptStep[][] = [];
  for (const op of ops) {
    const chunk: TranscriptStep[] = [];
    switch (op.op) {
      case "openFlow":
        engine.openFlow(op.flow, { scene: op.scene, block: op.block, seed: op.seed });
        current = op.flow;
        break;
      case "useFlow":
        current = op.flow;
        break;
      case "advance": {
        const r = engine.getFlow(current)!.advance();
        chunk.push(normaliseStep(r));
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
      case "reset":
        engine.reset();
        current = "";
        break;
    }
    chunks.push(chunk);
  }
  return { chunks, engine };
}

export function runScriptedCase(c: ScriptedCase): TranscriptStep[][] {
  const options = c.seed !== undefined ? { seed: c.seed } : {};
  return runScript(new Engine(c.bundle, options), c.script, { bundle: c.bundle, bundleB: c.bundleB, options }).chunks;
}

/**
 * Load a save written by the JS reference into a FRESH engine and continue the script: the reference's
 * own copy of what every port does through its own save boundary. Before continuing, the loaded state
 * is written back and its key paths held to the fixture's - a runtime that loads the envelope and
 * writes a different shape has not adopted the contract, it has merely tolerated it.
 */
export function runSaveCase(c: SaveCase): TranscriptStep[][] {
  const options = c.seed !== undefined ? { seed: c.seed } : {};
  const engine = new Engine(c.bundle, options);
  if (c.envelope.schema !== SAVE_SCHEMA) throw new Error(`not a ${SAVE_SCHEMA} envelope`);
  engine.loadGame(JSON.parse(JSON.stringify(c.envelope.save)));
  const back = envelopeKeyPaths({ schema: SAVE_SCHEMA, save: JSON.parse(JSON.stringify(engine.saveGame())) });
  if (back.join("\n") !== c.keyPaths.join("\n")) {
    const missing = c.keyPaths.filter((k) => !back.includes(k));
    const extra = back.filter((k) => !c.keyPaths.includes(k));
    throw new Error(`re-serialised save has different key paths; missing: [${missing.join(", ")}] extra: [${extra.join(", ")}]`);
  }
  return runScript(engine, c.script, { bundle: c.bundle, options }).chunks;
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

/** Normalise a StepResult, keeping the fields the contract pins (drops undefined). */
export function normaliseStep(r: StepResult): TranscriptStep {
  switch (r.type) {
    case "line": {
      const s: TranscriptStep = { type: "line", id: r.id, text: r.text };
      if (r.character !== undefined) s.character = r.character;
      if (r.characterName !== undefined) s.characterName = r.characterName; // locale-resolved display name
      if (r.direction !== undefined) s.direction = r.direction;
      if (r.gameData !== undefined) s.gameData = r.gameData;
      if (r.tags !== undefined) s.tags = r.tags; // accumulated author tags (#215)
      return s;
    }
    case "text": {
      const s: TranscriptStep = { type: "text", id: r.id, text: r.text };
      if (r.gameData !== undefined) s.gameData = r.gameData;
      if (r.tags !== undefined) s.tags = r.tags;
      return s;
    }
    case "gameEvent": {
      const s: TranscriptStep = { type: "gameEvent", id: r.id };
      if (r.gameData !== undefined) s.gameData = r.gameData;
      if (r.tags !== undefined) s.tags = r.tags;
      return s;
    }
    case "choice":
      return { type: "choice", options: r.options.map((o) => {
        const opt: { id: string; text?: string; eligible: boolean; gameData?: typeof o.gameData } =
          { id: o.id, eligible: o.eligible };
        if (o.prompt !== undefined) opt.text = o.prompt.text; // conformance transcript keeps the flat label

        if (o.gameData !== undefined) opt.gameData = o.gameData;
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
