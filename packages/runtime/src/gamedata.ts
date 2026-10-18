// gameData read helpers (spec: author-defined custom fields per node type). The published bundle
// carries the field SCHEMA per node type (`bundle.gameDataFields`, each field with its default) plus
// each node's SPARSE overrides (`node.gameData`). Storage is sparse + merge-at-read: a node holds only
// the values it overrides, and a reader falls back to the field's default. These pure helpers do that
// resolution so a host doesn't re-implement it.
//
// Patter extension values follow the same rule (patterkit design/proposals/patter-storylet-extensions.md,
// "At runtime"): raw on the node, declarations with every default resolved in the bundle's `extensions`
// section, and the SAME two helpers fill them in, given `extensionDecls`. `extensionsOf` reads any node's
// values off the bundle, by the address a game already uses, and `extensionSettings` an extension's settings.

import { effectiveGameId } from "@patterkit/model";
import type {
  Bundle, CompiledGroup, CompiledSnippet, ExtensionFieldDecl, GameData, GameDataField, GameDataNodeKind, NodeExtensions,
} from "@patterkit/model";

const own = (record: object, name: string): boolean => Object.prototype.hasOwnProperty.call(record, name);

/** A declaration as the two helpers below read it: a gameData field's, or an extension field's. */
interface Declared { readonly name: string; readonly default?: unknown }

/** The author-defined gameData fields declared for a node TYPE in a bundle (empty when none). */
export function gameDataFields(bundle: Bundle, kind: GameDataNodeKind): GameDataField[] {
  return bundle.gameDataFields?.[kind] ?? [];
}

/** One node's effective value for a field: its sparse OVERRIDE if present, else the field's declared
 *  default (undefined if neither is set). `fields` is the schema for the node's type: its gameData fields, or
 *  an extension's declarations for the kind (`extensionDecls`), whose values may be any JSON. */
export function gameDataValue(fields: readonly Declared[], node: Readonly<Record<string, unknown>> | undefined, name: string): unknown {
  if (node && own(node, name)) return node[name];
  return fields.find((f) => f.name === name)?.default;
}

/** A node's FULL effective gameData: every declared field resolved (override or default), plus any
 *  override keys with no matching field (orphans, kept verbatim). Fields left with no value are omitted.
 *  The same for one extension's values, given its declarations (`extensionDecls`): a structured default
 *  arrives whole. */
export function effectiveGameData(fields: readonly GameDataField[], node: GameData | undefined): GameData;
export function effectiveGameData(fields: readonly Declared[], node: Readonly<Record<string, unknown>> | undefined): Record<string, unknown>;
export function effectiveGameData(fields: readonly Declared[], node: Readonly<Record<string, unknown>> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = gameDataValue(fields, node, f.name);
    if (v !== undefined) out[f.name] = v;
  }
  for (const [k, v] of Object.entries(node ?? {})) if (!own(out, k)) out[k] = v;
  return out;
}

/** One extension's declarations for a node kind (`project`, `scene`, `block`, `snippet`, `line`, `text`,
 *  `gameEvent`, `option`), every default resolved. Empty when the bundle has no such extension or it declares
 *  nothing for the kind. */
export function extensionDecls(bundle: Pick<Bundle, "extensions">, extension: string, kind: string): ExtensionFieldDecl[] {
  const ext = bundle.extensions !== undefined && own(bundle.extensions, extension) ? bundle.extensions[extension] : undefined;
  return ext !== undefined && own(ext.fields, kind) ? ext.fields[kind] ?? [] : [];
}

/**
 * One extension's settings, by setting name: every setting its manifest declares, the project's value or else
 * the setting's default. Each names a host field, so a game reads here which gameData field holds what the
 * extension claims. `{}` when the bundle has no such extension or it declares no settings. A fresh object each
 * call.
 */
export function extensionSettings(bundle: Pick<Bundle, "extensions">, extension: string): Record<string, string> {
  const ext = bundle.extensions !== undefined && own(bundle.extensions, extension) ? bundle.extensions[extension] : undefined;
  return { ...(ext?.settings ?? {}) };
}

/**
 * A node's Patter extension values, by extension id, raw; `{}` when it has none or the address names nothing.
 * By the names a game already holds: `project` (no address); `scene` by id or gameId; `block` as
 * "scene/block", each by id or gameId; `snippet`, `line`, `text`, `gameEvent` and `option` (a group directly
 * inside a choice) by node id. A node of another kind than the one asked for reads as none. A fresh object
 * each call, but the values in it are the bundle's own: treat them as read-only.
 */
export function extensionsOf(bundle: Pick<Bundle, "scenes" | "extensions">, kind: string, address = ""): NodeExtensions {
  const values = (node: { extensions?: NodeExtensions } | undefined): NodeExtensions => ({ ...(node?.extensions ?? {}) });
  const scenes = Object.values(bundle.scenes ?? {});
  const sceneOf = (ref: string) => (own(bundle.scenes ?? {}, ref) ? bundle.scenes[ref] : undefined)
    ?? scenes.find((s) => effectiveGameId(s) === ref);
  switch (kind) {
    case "project": {
      const out: NodeExtensions = {};
      for (const [id, ext] of Object.entries(bundle.extensions ?? {})) if (ext.project !== undefined) out[id] = ext.project;
      return out;
    }
    case "scene": return values(sceneOf(address));
    case "block": {
      const slash = address.indexOf("/");
      if (slash < 0) return {};
      const blocks = sceneOf(address.slice(0, slash))?.blocks ?? [];
      const ref = address.slice(slash + 1);
      return values(blocks.find((b) => b.id === ref) ?? blocks.find((b) => effectiveGameId(b) === ref));
    }
    case "snippet": case "option": case "line": case "text": case "gameEvent": {
      let found: { extensions?: NodeExtensions } | undefined;
      const walk = (children: ReadonlyArray<CompiledGroup | CompiledSnippet>, inChoice: boolean): void => {
        for (const node of children ?? []) {
          if (found !== undefined) return;
          if (node.type === "group") {
            if (inChoice && node.id === address && kind === "option") { found = node; return; }
            if (inChoice && node.prompt?.id === address && node.prompt.kind === kind) { found = node.prompt; return; }
            walk(node.children ?? [], node.selector === "choice");
            continue;
          }
          if (node.id === address && kind === "snippet") { found = node; return; }
          const beat = (node.beats ?? []).find((b) => b.id === address);
          if (beat !== undefined) { if (beat.kind === kind) found = beat; return; }
        }
      };
      for (const scene of scenes) for (const block of scene.blocks ?? []) if (found === undefined) walk(block.children ?? [], false);
      return values(found);
    }
    default: return {};
  }
}
