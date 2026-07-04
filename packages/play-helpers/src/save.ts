// ---------------------------------------------------------------------------
// Save / load: wrap the Engine's whole-game snapshot in a tagged, versioned
// envelope so a host can drop it into localStorage / a file and restore it
// safely (a foreign blob throws instead of corrupting a run).
// ---------------------------------------------------------------------------

import type { Engine, SaveGame } from "@patterkit/runtime";

export const SAVE_SCHEMA = "patter/save@0";

export interface SaveEnvelope {
  schema: typeof SAVE_SCHEMA;
  /** The engine save-game: shared `@patter`/`@scene` state, visit counts, and every live flow. */
  save: SaveGame;
}

/** Capture the whole game as a tagged envelope (wraps `engine.saveGame()`). */
export function saveState(engine: Engine): SaveEnvelope {
  return { schema: SAVE_SCHEMA, save: engine.saveGame() };
}

/** Restore a {@link saveState} envelope into an engine (fresh or live). Throws on a foreign/blank blob. */
export function loadState(engine: Engine, env: SaveEnvelope): void {
  if (!env || env.schema !== SAVE_SCHEMA || !env.save) {
    throw new Error(`loadState: not a ${SAVE_SCHEMA} envelope`);
  }
  engine.loadGame(env.save);
}

/** Serialise the whole game to a JSON string (envelope + save-game) - drop into localStorage or a file. */
export function serializeState(engine: Engine): string {
  return JSON.stringify(saveState(engine));
}

/** Parse + restore a {@link serializeState} string. Throws on malformed JSON or a foreign envelope. */
export function deserializeState(engine: Engine, json: string): void {
  loadState(engine, JSON.parse(json) as SaveEnvelope);
}
