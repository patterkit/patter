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

import { evaluate, deserialiseAst } from "@wildwinter/expr";
import type { EvalContext, ScalarValue } from "@wildwinter/expr";
import { matchedSpecificity } from "@wildwinter/expr-specificity";
import { patterDialect } from "@patterkit/dialect";
import { Engine, effectiveGameData, gameDataFields } from "@patterkit/runtime";
import type { StepResult } from "@patterkit/runtime";
import type { GameData } from "@patterkit/model";
import type { ExpressionCase, GameDataCase, RuntimeCase, ScriptedCase, SpecificityCase, TranscriptStep } from "./types.js";

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
export function runScriptedCase(c: ScriptedCase): TranscriptStep[][] {
  const options = c.seed !== undefined ? { seed: c.seed } : {};
  let engine = new Engine(c.bundle, options);
  let current = "";

  const chunks: TranscriptStep[][] = [];
  for (const op of c.script) {
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
      case "saveLoad": {
        const blob = JSON.parse(JSON.stringify(engine.saveGame()));
        engine = new Engine(c.bundle, options);
        engine.loadGame(blob);
        break;
      }
      case "hotSwap":
        // Live bundle refresh: the whole game carried onto the EDITED bundle. The reference runner
        // uses Engine.hotSwap (save -> fresh engine on bundleB -> load); a port without the helper
        // does the same three calls with its own save API. Drift resolves per §9.8.
        engine = engine.hotSwap(c.bundleB!);
        break;
      case "setLocale":
        engine.setLocale(op.locale); // live language switch - subsequent beats render in the new locale
        break;
      case "setClosedCaptions":
        engine.setClosedCaptions(op.on); // live caption toggle - subsequent dialogue lines strip cues when off
        break;
      case "reset":
        engine.reset();
        current = "";
        break;
    }
    chunks.push(chunk);
  }
  return chunks;
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
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
