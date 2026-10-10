// ---------------------------------------------------------------------------
// The play op: compile a loaded project and play it headlessly through
// Patterplay's JS runtime. Returns STRUCTURED events + an outcome (Patterpad's
// playthrough runner consumes the events; CI can gate on the outcome) -
// string rendering is the separate `renderPlay`, used by the CLI.
// ---------------------------------------------------------------------------

import { compileLoaded } from "./compile.js";
import { Engine } from "@patterkit/runtime";
import type { StepResult, ChoiceOption, PlayError } from "@patterkit/runtime";
import type { GameData } from "@patterkit/model";
import type { LoadedProject } from "./load.js";
import { resolveStart } from "./loaded-helpers.js";
import { previewRegistry } from "./game-scopes.js";

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
  /** `padAfter` is the step's resolved pause after it, in seconds (line padding), as the runtime delivers it. */
  | { type: "line"; id: string; text: string; character?: string; characterName?: string; direction?: string; qualifier?: string; qualifierName?: string; padAfter?: number; gameData?: GameData }
  | { type: "text"; id: string; text: string; padAfter?: number; gameData?: GameData }
  | { type: "gameEvent"; id: string; gameData?: GameData }
  | { type: "choice"; options: ChoiceOption[]; picked?: string }
  /** A condition or effect that failed; the engine played through it (see the runtime's PlayError). */
  | { type: "error"; error: PlayError }
  /** The run could not go on, and this is why: the engine stopped (a jump cycle with nothing to deliver,
   *  a jump to a target the bundle lacks), or a scripted choice named an option the choice did not offer.
   *  Always the last event, and the outcome is then "error". */
  | { type: "error"; fatal: true; message: string };

/** "end" = the flow finished; "max-steps" = bound hit; "error" = the run stopped, and the last event says
 *  why. (There is no "stalled": a choice with nothing to pick runs dry and play moves on.) */
export type PlayOutcome = "end" | "max-steps" | "error";

export interface PlayResult {
  events: PlayEvent[];
  outcome: PlayOutcome;
}

/**
 * Compile a loaded project and play it headlessly through the reference
 * runtime. At each choice point it consumes the next scripted choice id, else
 * picks the first eligible option - so it always runs to an outcome. The whole
 * pipeline in one call: load -> export -> Engine playthrough.
 *
 * A run the engine stops part-way still returns its transcript: the throw is
 * caught and becomes the last event, with outcome "error". It used to escape,
 * so a playthrough that went wrong lost everything that led up to it, which is
 * exactly what the author needs to see.
 */
export function runPlay(loaded: LoadedProject, opts: PlayOptions = {}): PlayResult {
  const bundle = compileLoaded(loaded);
  const events: PlayEvent[] = [];
  // Playing alone: another engine's scope the story names is stood in from the game's scopes files.
  const registry = previewRegistry(loaded.gameScopes, bundle);
  const engine = new Engine(bundle, { seed: opts.seed, onError: (error) => events.push({ type: "error", error }), ...(registry ? { registry } : {}) });

  const start = resolveStart(loaded, opts); // explicit override, else the project's authored start point
  const flow = engine.openFlow("main", { scene: start.scene, block: start.block });
  const scripted = [...(opts.choices ?? [])];
  const maxSteps = opts.maxSteps ?? 1000;

  const failed = (message: string): PlayResult => {
    events.push({ type: "error", fatal: true, message });
    return { events, outcome: "error" };
  };
  try {
    for (let i = 0; i < maxSteps; i++) {
      const r: StepResult = flow.advance();
      if (r.type === "end") return { events, outcome: "end" };
      if (r.type === "choice") {
        const wanted = scripted.shift();
        // A scripted id is checked against what is on offer BEFORE choosing, so the message can name both
        // the id and the options. The engine's own refusal names only the id, and a `--choices` list one
        // step out of line is the commonest way to get here.
        if (wanted !== undefined) {
          const offered = r.options.find((o) => o.id === wanted);
          if (!offered || !offered.eligible) {
            events.push({ type: "choice", options: r.options });
            const onOffer = r.options.filter((o) => o.eligible).map((o) => o.id).join(", ");
            return failed(`scripted choice '${wanted}' is ${offered ? "offered but its condition does not hold" : "not offered"} here; on offer: ${onOffer}`);
          }
        }
        // The engine offers a choice only when something in it can be taken, so there is always a pick.
        const picked = wanted ?? r.options.find((o) => o.eligible)!.id;
        events.push({ type: "choice", options: r.options, picked });
        flow.choose(picked);
      } else {
        events.push(r);
      }
    }
  } catch (err) {
    return failed(err instanceof Error ? err.message : String(err));
  }
  return { events, outcome: "max-steps" };
}

/** Render a play result as the CLI's readable transcript lines. */
export function renderPlay(result: PlayResult): string[] {
  const out: string[] = [];
  for (const e of result.events) {
    switch (e.type) {
      case "line": {
        // The speaker qualifier follows the name, as the script's cue has it: `TAM (O.S.): ...`.
        const q = e.qualifierName ?? e.qualifier;
        out.push(`${e.character ?? "?"}${q ? ` (${q})` : ""}: ${e.text}`);
        break;
      }
      case "text": out.push(`  ${e.text}`); break;
      case "gameEvent": out.push(`    (game event ${JSON.stringify(e.gameData ?? {})})`); break;
      case "error": {
        if ("fatal" in e) { out.push(`    ! stopped: ${e.message}`); break; }
        const { kind, node, source, message } = e.error;
        out.push(`    ! ${kind} on '${node}'${source ? ` (${source})` : ""} failed, played through: ${message}`);
        break;
      }
      case "choice":
        for (const o of e.options) out.push(`    ${o.eligible ? "[ ]" : "[x]"} ${o.prompt?.text ?? "(no label)"}  (${o.id})`);
        if (e.picked !== undefined) out.push(`    > ${e.picked}`);
        break;
    }
  }
  switch (result.outcome) {
    case "end": out.push("--- END ---"); break;
    case "max-steps": out.push("--- stopped: max steps reached ---"); break;
    case "error": out.push("--- stopped: the run could not go on ---"); break;
  }
  return out;
}
