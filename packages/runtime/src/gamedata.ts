// gameData read helpers (spec: author-defined custom fields per node type). The published bundle
// carries the field SCHEMA per node type (`bundle.gameDataFields`, each field with its default) plus
// each node's SPARSE overrides (`node.gameData`). Storage is sparse + merge-at-read: a node holds only
// the values it overrides, and a reader falls back to the field's default. These pure helpers do that
// resolution so a host doesn't re-implement it.

import type { Bundle, GameData, GameDataField, GameDataNodeKind } from "@patterkit/model";

/** The author-defined gameData fields declared for a node TYPE in a bundle (empty when none). */
export function gameDataFields(bundle: Bundle, kind: GameDataNodeKind): GameDataField[] {
  return bundle.gameDataFields?.[kind] ?? [];
}

/** One node's effective value for a field: its sparse OVERRIDE if present, else the field's declared
 *  default (undefined if neither is set). `fields` is the schema for the node's type. */
export function gameDataValue(fields: GameDataField[], node: GameData | undefined, name: string): unknown {
  if (node && Object.prototype.hasOwnProperty.call(node, name)) return node[name];
  return fields.find((f) => f.name === name)?.default;
}

/** A node's FULL effective gameData: every declared field resolved (override or default), plus any
 *  override keys with no matching field (orphans, kept verbatim). Fields left with no value are omitted. */
export function effectiveGameData(fields: GameDataField[], node: GameData | undefined): GameData {
  const out: GameData = {};
  for (const f of fields) {
    const v = gameDataValue(fields, node, f.name);
    if (v !== undefined) out[f.name] = v;
  }
  for (const [k, v] of Object.entries(node ?? {})) if (!(k in out)) out[k] = v;
  return out;
}
