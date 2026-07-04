// ---------------------------------------------------------------------------
// The play op: compile a loaded project and play it headlessly through the
// reference runtime. Returns STRUCTURED events + an outcome (Patterpad's
// playthrough runner consumes the events; CI can gate on the outcome) -
// string rendering is the separate `renderPlay`, used by the CLI.
// ---------------------------------------------------------------------------

import { exportBundle } from "@patterkit/compiler";
import { Engine } from "@patterkit/runtime";
import type { StepResult, ChoiceOption } from "@patterkit/runtime";
import type { GameData } from "@patterkit/model";
import type { LoadedProject } from "./load.js";
import { resolveStart } from "./loaded-helpers.js";

export interface PlayOptions {
  /** Scene id to start at (defaults to the bundle's first scene). */
  scene?: string;
  /** Block id within the scene to start at. */
  block?: string;
  /** Scripted choice-option ids, consumed in order at each choice point. */
  choices?: string[];
  /** Seed for the runtime PRNG (shuffle / random), for reproducible runs. */
  seed?: number;
  /** Safety bound on steps (default 1000) to stop runaway loops. */
  maxSteps?: number;
}

/** One thing that happened during a playthrough, in order. */
export type PlayEvent =
  | { type: "line"; id: string; text: string; character?: string; direction?: string; gameData?: GameData }
  | { type: "text"; id: string; text: string; gameData?: GameData }
  | { type: "gameEvent"; id: string; gameData?: GameData }
  | { type: "choice"; options: ChoiceOption[]; picked?: string };

/** "end" = the flow finished; "stalled" = a choice with no pickable option; "max-steps" = bound hit. */
export type PlayOutcome = "end" | "stalled" | "max-steps";

export interface PlayResult {
  events: PlayEvent[];
  outcome: PlayOutcome;
}

/**
 * Compile a loaded project and play it headlessly through the reference
 * runtime. At each choice point it consumes the next scripted choice id, else
 * picks the first eligible option - so it always runs to an outcome. The whole
 * pipeline in one call: load -> export -> Engine playthrough.
 */
export function runPlay(loaded: LoadedProject, opts: PlayOptions = {}): PlayResult {
  const bundle = exportBundle({ project: loaded.project, scenes: loaded.scenes, locales: loaded.locales });
  const events: PlayEvent[] = [];
  const engine = new Engine(bundle, { seed: opts.seed });

  const start = resolveStart(loaded, opts); // explicit override, else the project's authored start point
  const flow = engine.openFlow("main", { scene: start.scene, block: start.block });
  const scripted = [...(opts.choices ?? [])];
  const maxSteps = opts.maxSteps ?? 1000;

  for (let i = 0; i < maxSteps; i++) {
    const r: StepResult = flow.advance();
    if (r.type === "end") return { events, outcome: "end" };
    if (r.type === "choice") {
      const picked = scripted.shift() ?? r.options.find((o) => o.eligible)?.id;
      events.push({ type: "choice", options: r.options, picked });
      if (picked === undefined) return { events, outcome: "stalled" };
      flow.choose(picked);
    } else {
      events.push(r);
    }
  }
  return { events, outcome: "max-steps" };
}

/** Render a play result as the CLI's readable transcript lines. */
export function renderPlay(result: PlayResult): string[] {
  const out: string[] = [];
  for (const e of result.events) {
    switch (e.type) {
      case "line": out.push(`${e.character ?? "?"}: ${e.text}`); break;
      case "text": out.push(`  ${e.text}`); break;
      case "gameEvent": out.push(`    (game event ${JSON.stringify(e.gameData ?? {})})`); break;
      case "choice":
        for (const o of e.options) out.push(`    ${o.eligible ? "[ ]" : "[x]"} ${o.prompt?.text ?? "(no label)"}  (${o.id})`);
        if (e.picked !== undefined) out.push(`    > ${e.picked}`);
        break;
    }
  }
  switch (result.outcome) {
    case "end": out.push("--- END ---"); break;
    case "stalled": out.push("    (no eligible choice - stopping)"); break;
    case "max-steps": out.push("--- stopped: max steps reached ---"); break;
  }
  return out;
}
