// ---------------------------------------------------------------------------
// Save / load: wrap the Engine's whole-game snapshot in a tagged, versioned
// envelope so a host can drop it into localStorage / a file and restore it
// safely (a foreign blob throws instead of corrupting a run).
// ---------------------------------------------------------------------------

import type { Engine } from "@patterkit/runtime";
import { SAVE_SCHEMA } from "@patterkit/model";
import type { SaveEnvelope } from "@patterkit/model";

// The envelope (`schema` + `save`) and the save shape inside it are the FAMILY's contract, defined in
// @patterkit/model and written identically by every Patterplay runtime. Re-exported so existing
// imports keep working.
export { SAVE_SCHEMA };
export type { SaveEnvelope };

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
