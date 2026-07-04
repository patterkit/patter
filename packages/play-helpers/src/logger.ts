// ---------------------------------------------------------------------------
// State logger: a debug companion that watches the mutable runtime state -
// `@patter` globals, per-scene `@scene` props, and visit counts (shared +
// per-flow) - and reports what changed between captures. `logStep` traces each
// played step, including the `gameData` payload (the host-event channel, spec
// §15). Built on `engine.saveGame()`, so it sees exactly what a save persists.
// ---------------------------------------------------------------------------

import type { Engine, StepResult } from "@patterkit/runtime";

/** A flattened runtime-state value (a Patter scalar: number / boolean / string / string[] flags). */
export type StateValue = NonNullable<ReturnType<Engine["getProperty"]>>;

/** A flattened snapshot: dotted path -> value. Paths: `@patter.x`, `@scene:scene.x`, `visit:nodeId`,
 *  and `flow/...` for a flow's not-shared locals. */
export type StateSnapshot = Record<string, StateValue>;

export interface StateChange {
  path: string;
  from?: StateValue;
  to?: StateValue;
}

const eq = (a: StateValue | undefined, b: StateValue | undefined): boolean =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Flatten the engine's whole-game state into a path -> value map (shared scopes + every live flow). */
export function snapshotState(engine: Engine): StateSnapshot {
  const save = engine.saveGame();
  const out: StateSnapshot = {};
  for (const [name, v] of Object.entries(save.shared.patter ?? {})) out[`@patter.${name}`] = v as StateValue;
  for (const [scene, vals] of Object.entries(save.stageBags))
    for (const [name, v] of Object.entries(vals)) out[`@scene:${scene}.${name}`] = v as StateValue;
  for (const [id, n] of Object.entries(save.sharedVisits)) out[`visit:${id}`] = n;
  for (const [fid, snap] of Object.entries(save.flows)) {
    for (const [name, v] of Object.entries(snap.scopes.patter ?? {})) out[`${fid}/@patter.${name}`] = v as StateValue;
    for (const [scene, vals] of Object.entries(snap.sceneBags))
      for (const [name, v] of Object.entries(vals)) out[`${fid}/@scene:${scene}.${name}`] = v as StateValue;
    for (const [id, n] of Object.entries(snap.visits)) out[`${fid}/visit:${id}`] = n;
  }
  return out;
}

/** The sorted set of paths that differ between two snapshots (added / removed / changed). */
export function diffState(prev: StateSnapshot, next: StateSnapshot): StateChange[] {
  const changes: StateChange[] = [];
  const keys = [...new Set([...Object.keys(prev), ...Object.keys(next)])].sort();
  for (const path of keys) {
    const from = prev[path], to = next[path];
    if (!eq(from, to)) changes.push({ path, ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}) });
  }
  return changes;
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
  /** Diff since the last capture, log each change, and re-baseline. Returns the changes. */
  capture(): StateChange[];
  /** Trace one played step (line / text / game-event / choice / end), including any `gameData`. */
  logStep(step: StepResult): void;
}

const fmt = (v: StateValue | undefined): string => (v === undefined ? "<unset>" : JSON.stringify(v));

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

/** Create a state logger over an engine. Call `capture()` after each `advance`/`choose` to log mutations. */
export function createStateLogger(engine: Engine, opts: StateLoggerOptions = {}): StateLogger {
  const sink = opts.sink ?? ((line: string) => console.log(line));
  const tag = opts.label ? `[${opts.label}] ` : "";
  let baseline = snapshotState(engine);
  return {
    snapshot: () => snapshotState(engine),
    capture() {
      const next = snapshotState(engine);
      const changes = diffState(baseline, next);
      baseline = next;
      for (const c of changes) sink(`${tag}${c.path}: ${fmt(c.from)} -> ${fmt(c.to)}`);
      return changes;
    },
    logStep(step) { sink(`${tag}${describeStep(step)}`); },
  };
}
