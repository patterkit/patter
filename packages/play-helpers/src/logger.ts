// ---------------------------------------------------------------------------
// The Patterplay state logger: an ADAPTER over the kernel logger in
// @wildwinter/scoperegistry, plus `logStep`, which is this product's own.
//
// It used to diff whole `engine.saveGame()` snapshots. That could only ever say
// what changed BETWEEN captures, which means it could not see a value that
// changed and changed back, could not name the reason a host attached to a
// write, and reported a write only once something asked. The kernel logs a
// property write as it LANDS, on the PropertyBag audit hook, and keeps the diff
// for state that has no hook - here, the visit counts.
//
// The Storylet Engine's logger was already this shape; its core is what moved
// into the kernel. Same core, two adapters.
//
// Paths, unchanged:
//   @patter.x              the shared globals
//   @scene:<sceneId>.x     the shared scene props
//   visit:<nodeId>         shared visit counts
//   <flowId>/...           the same three, per flow (its not-shared halves)
// ---------------------------------------------------------------------------

import type { Engine, StepResult } from "@patterkit/runtime";
import { createStateLogger as createKernelStateLogger, diffState } from "@wildwinter/scoperegistry";
import type { LogMount, ScalarValue, StateChange, StateSnapshot } from "@wildwinter/scoperegistry";

// Re-exported: these were declared here, and a host importing them from
// @patterkit/play-helpers should not have to care that they moved.
export { diffState };
export type { StateChange, StateSnapshot };

/** A flattened runtime-state value: a Patter scalar. The kernel calls this `ScalarValue`;
 *  the alias stays because it is exported API and reads in Patter's own vocabulary. */
export type StateValue = ScalarValue;

/** Flatten the engine's whole-game state into a path -> value map (shared scopes + every live
 *  flow), off `saveGame()`. The logger no longer diffs this - it mounts the bags directly - but
 *  it stays as the public "what is the state right now" call, and as the definition of the path
 *  space the mounts compose. */
export function snapshotState(engine: Engine): StateSnapshot {
  const save = engine.saveGame();
  const out: StateSnapshot = {};
  for (const [name, v] of Object.entries(save.shared.patter ?? {})) out[`@patter.${name}`] = v as ScalarValue;
  for (const [scene, vals] of Object.entries(save.stageBags))
    for (const [name, v] of Object.entries(vals)) out[`@scene:${scene}.${name}`] = v as ScalarValue;
  for (const [id, n] of Object.entries(save.sharedVisits)) out[`visit:${id}`] = n;
  for (const [fid, snap] of Object.entries(save.flows)) {
    for (const [name, v] of Object.entries(snap.scopes.patter ?? {})) out[`${fid}/@patter.${name}`] = v as ScalarValue;
    for (const [scene, vals] of Object.entries(snap.sceneBags))
      for (const [name, v] of Object.entries(vals)) out[`${fid}/@scene:${scene}.${name}`] = v as ScalarValue;
    for (const [id, n] of Object.entries(snap.visits)) out[`${fid}/visit:${id}`] = n;
  }
  return out;
}

export interface StateLoggerOptions {
  /** Where lines go; defaults to `console.log`. */
  sink?: (line: string) => void;
  /** Prefix tag for every line, e.g. the flow / save-slot name. */
  label?: string;
}

export interface StateLogger {
  /** The current flattened state (no logging). */
  snapshot(): StateSnapshot;
  /** Everything since the last capture: the property writes already logged as they landed,
   *  plus the visit counts, diffed and re-baselined. */
  capture(): StateChange[];
  /** Trace one played step (line / text / game-event / choice / end), including any `gameData`. */
  logStep(step: StepResult): void;
  /** Unhook the bag auditors. The logger is inert afterwards. */
  dispose(): void;
}

function describeStep(step: StepResult): string {
  switch (step.type) {
    case "line": return `line ${step.character ?? "?"}: ${JSON.stringify(step.text)}${gd(step.gameData)}`;
    case "text": return `text: ${JSON.stringify(step.text)}${gd(step.gameData)}`;
    case "gameEvent": return `game event ${step.id}${gd(step.gameData)}`;
    case "choice": return `choice (${step.options.length} option${step.options.length === 1 ? "" : "s"})`;
    case "end": return "end";
  }
}
const gd = (data: unknown): string => (data ? ` gameData=${JSON.stringify(data)}` : "");

/** The visit counts, which live in no bag and so have no audit hook: the kernel diffs
 *  these on capture, exactly as the whole logger used to work. */
function visitState(engine: Engine): StateSnapshot {
  const save = engine.saveGame();
  const out: StateSnapshot = {};
  for (const [id, n] of Object.entries(save.sharedVisits)) out[`visit:${id}`] = n;
  for (const [fid, snap] of Object.entries(save.flows)) {
    for (const [id, n] of Object.entries(snap.visits)) out[`${fid}/visit:${id}`] = n;
  }
  return out;
}

/** Create a state logger over an engine. Property writes log as they land; call `capture()`
 *  after each `advance`/`choose` to pick up the visit counts and re-baseline. */
export function createStateLogger(engine: Engine, opts: StateLoggerOptions = {}): StateLogger {
  const tag = opts.label ? `[${opts.label}] ` : "";
  const kernel = createKernelStateLogger({
    // Re-read on every capture: openFlow and loadGame both replace bags, and the kernel
    // re-mounts whatever it is handed.
    mounts: (): LogMount[] => [...engine.listBags(), ...engine.flows().flatMap((f) => f.listBags())],
    extra: () => visitState(engine),
  }, { sink: opts.sink, label: tag });

  return {
    snapshot: () => snapshotState(engine),
    capture: () => kernel.capture(),
    dispose: () => kernel.dispose(),
    logStep(step) { (opts.sink ?? ((l: string) => console.log(l)))(`${tag}${describeStep(step)}`); },
  };
}
