// ---------------------------------------------------------------------------
// What the FIELDS window shows (Pattershot's brief, "a map of records edited in a helper window", H1 to H4),
// built in the editor, which owns the document: the node it is on, and each map of records the node's kind
// has, with what the grid's cells need from the project (nodes, names and project lists) sent as data,
// because the adapter's functions can't cross to another window.
//
// Which node: with Follow selection on, the one an inspector section's Edit button named, else the deepest
// selected node whose kind has a map of records, else the deepest selected node; off, the node it was on.
// ---------------------------------------------------------------------------

import { isRecordMap } from "@wildwinter/app-shell/value-rows";
import type { ValueAdapter, ValueDecl } from "@wildwinter/app-shell/value-rows";
import type { InspectorContext } from "@patterkit/patterpad-surface/surface";
import { extensionScoped } from "./extension-rows.js";
import type { ExtensionDto, ExtensionFieldDto, FieldsGrid, FieldsWinState } from "../../shared/api.js";

/** A node an extension can hold values on: its extension kind, id and values. */
export interface FieldsNode {
  kind: string;
  id: string;
  ext: Record<string, Record<string, unknown>> | undefined;
}

/** The selection's nodes that carry extension values, deepest first. */
export function selectedNodes(ctx: InspectorContext | null): FieldsNode[] {
  const out: FieldsNode[] = [];
  for (const lv of ctx?.levels ?? []) {
    const l = lv as { kind: string; id?: string | null; beat?: string; role?: string; ext?: Record<string, Record<string, unknown>> };
    if (!l.id) continue;
    const kind = l.kind === "leaf" ? (l.beat === "prose" ? "text" : l.beat ?? "")
      : l.kind === "group" ? (l.role === "option" ? "option" : "")
        : l.kind === "snippet" || l.kind === "block" || l.kind === "scene" ? l.kind : "";
    if (kind) out.push({ kind, id: l.id, ext: l.ext });
  }
  return out.reverse();
}

/** The maps of records an extension declares for a kind. */
export function recordMapFields(extensions: readonly ExtensionDto[], kind: string): Array<{ extension: ExtensionDto; decl: ExtensionFieldDto }> {
  const out: Array<{ extension: ExtensionDto; decl: ExtensionFieldDto }> = [];
  for (const extension of extensions) {
    for (const decl of extension.targets[kind]?.fields ?? []) {
      if (isRecordMap(decl as unknown as ValueDecl)) out.push({ extension, decl });
    }
  }
  return out;
}

/** The node the window follows to: the deepest selected one whose kind has a map of records, else the deepest. */
export function followTarget(nodes: readonly FieldsNode[], extensions: readonly ExtensionDto[]): FieldsNode | null {
  return nodes.find((n) => recordMapFields(extensions, n.kind).length > 0) ?? nodes[0] ?? null;
}

const KIND_WORD: Record<string, string> = { line: "line", text: "text", gameEvent: "game event", snippet: "snippet", option: "option", block: "block", scene: "scene" };

/** "a, b, or c", with the Oxford comma. */
const joined = (xs: readonly string[], word: string): string =>
  xs.length <= 2 ? xs.join(` ${word} `) : `${xs.slice(0, -1).join(", ")}, ${word} ${xs[xs.length - 1]}`;

/** Where the project's maps of records are, for the window to say when it has none to show: "Select a line or
 *  text to edit Performance here." Empty when there are none. */
export function fieldsHint(extensions: readonly ExtensionDto[]): string {
  const kinds: string[] = [];
  const labels: string[] = [];
  for (const kind of Object.keys(KIND_WORD)) {
    const found = recordMapFields(extensions, kind);
    if (found.length === 0) continue;
    kinds.push(KIND_WORD[kind]!);
    for (const f of found) { const l = f.decl.label ?? f.decl.name; if (!labels.includes(l)) labels.push(l); }
  }
  return kinds.length ? `Select a ${joined(kinds, "or")} to edit ${joined(labels, "and")} here.` : "";
}

/** The kinds a declaration names, all the way down: its key, its references and its picks' node sources. */
function kindsOf(decl: ExtensionFieldDto | undefined, into: Set<string>): void {
  if (!decl) return;
  const d = decl as unknown as ValueDecl;
  if (d.key?.type === "reference" && d.key.to) into.add(d.key.to);
  if (d.type === "reference" && d.to) into.add(d.to);
  for (const s of d.from ?? []) if ("to" in s) into.add(s.to);
  for (const f of d.fields ?? []) kindsOf(f as unknown as ExtensionFieldDto, into);
  kindsOf(d.of as unknown as ExtensionFieldDto | undefined, into);
}

/** The project lists a declaration's picks offer, all the way down. */
function listsOf(decl: ExtensionFieldDto | undefined, into: Set<string>): void {
  if (!decl) return;
  const d = decl as unknown as ValueDecl;
  for (const s of d.from ?? []) if ("list" in s) into.add(s.list);
  for (const f of d.fields ?? []) listsOf(f as unknown as ExtensionFieldDto, into);
  listsOf(d.of as unknown as ExtensionFieldDto | undefined, into);
}

/** Every string a value holds, for the names of held nodes the choices may leave out. */
function stringsIn(value: unknown, into: Set<string>): void {
  if (typeof value === "string") into.add(value);
  else if (Array.isArray(value)) for (const v of value) stringsIn(v, into);
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) { into.add(k); stringsIn(v, into); }
}

export interface FieldsStateInput {
  hasProject: boolean;
  /** The node to show, with its name; null with nothing selected (or the held node isn't open). */
  node: (FieldsNode & { label: string }) | null;
  extensions: readonly ExtensionDto[];
  adapter: ValueAdapter;
  lock: (extension: string) => string | null;
  readOnly: boolean;
  /** Why it's read-only, when somebody else holds the scene; "" otherwise. */
  readOnlyWhy?: string;
}

export function fieldsState(o: FieldsStateInput): FieldsWinState {
  const hint = fieldsHint(o.extensions);
  if (!o.hasProject) return { hasProject: false, node: null, readOnly: true, readOnlyWhy: "", grids: [], hint };
  if (!o.node) return { hasProject: true, node: null, readOnly: true, readOnlyWhy: "", grids: [], hint };
  const node = o.node;
  const grids: FieldsGrid[] = recordMapFields(o.extensions, node.kind).map(({ extension, decl }) => {
    const adapter = extensionScoped(o.adapter, extension);
    const kinds = new Set<string>();
    kindsOf(decl, kinds);
    const listNames = new Set<string>();
    listsOf(decl, listNames);
    const value = node.ext?.[extension.id]?.[decl.name];
    const held = new Set<string>();
    stringsIn(value, held);
    const nodes: FieldsGrid["nodes"] = {};
    const labels: FieldsGrid["labels"] = {};
    for (const kind of kinds) {
      nodes[kind] = adapter.nodes(kind).map((n) => ({ id: n.id, label: n.label }));
      const offered = new Set(nodes[kind]!.map((n) => n.id));
      for (const id of held) {
        if (offered.has(id)) continue;
        const name = adapter.label?.(kind, id);
        if (name !== undefined) (labels[kind] ??= {})[id] = name;
      }
    }
    const lists: FieldsGrid["lists"] = {};
    for (const name of listNames) { const l = adapter.list?.(name); if (l) lists[name] = [...l]; }
    return {
      extension: extension.id, extensionName: extension.name, field: decl.name, decl, value,
      locked: o.lock(extension.id), nodes, labels, lists,
    };
  });
  return { hasProject: true, node: { id: node.id, kind: node.kind, label: node.label }, readOnly: o.readOnly, readOnlyWhy: o.readOnlyWhy ?? "", grids, hint };
}
