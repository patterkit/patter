// ---------------------------------------------------------------------------
// The extension lock guard (patterkit design/patterpad-undo.md, half A, "Locks").
//
// A scene's extension data lives in its own shard per extension, and a save
// writes only the shards that changed, so a writer who leaves an extension's data
// alone never needs its shard. One who would change it while somebody else holds
// that shard must be stopped before the change, not refused at save: this filter
// refuses any transaction that changes a locked extension's entries anywhere in
// the document, whatever route it came by. A value edited in the inspector, a node
// carrying the data deleted, a Duplicate copying it, a line / text toggle moving
// it to another kind, and an undo or redo of any of those are all refused. Typing
// can't touch an `ext` attr, so it is never even looked at.
// ---------------------------------------------------------------------------

import { Plugin, PluginKey, type Transaction } from "prosemirror-state";
import { ReplaceStep } from "prosemirror-transform";
import type { Node as PMNode } from "prosemirror-model";
import { extKindOf } from "./bridge.js";
import { modelIdOf } from "./zoneutil.js";

/** Somebody else holds an extension's shard for this scene: the extension's name (for the sentence) and
 *  who holds it. */
export interface ExtensionLock {
  name: string;
  by?: string[];
}

/** Locked extensions, by extension id. */
export type ExtensionLocks = Readonly<Record<string, ExtensionLock>>;

/** The sentence a refusal shows: "Probe's data here is locked by bob." */
export function extensionLockMessage(lock: ExtensionLock): string {
  const who = lock.by?.filter((b) => b).join(", ");
  return `${lock.name}'s data here is locked by ${who || "someone else"}.`;
}

/** Each locked extension's entries in `doc`, as `kind\0id` -> the entry's JSON, by extension id. Zones
 *  (text) are never descended into: they carry no `ext`. */
function lockedEntries(doc: PMNode, ids: readonly string[]): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>(ids.map((id) => [id, new Map()]));
  const take = (node: PMNode, id: string | null): void => {
    const ext = node.attrs.ext as string | undefined;
    const kind = extKindOf(node);
    if (!ext || !kind || !id) return;
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(ext) as Record<string, unknown>; } catch { return; }
    for (const extId of ids) {
      if (parsed[extId] !== undefined) out.get(extId)!.set(`${kind}\0${id}`, JSON.stringify(parsed[extId]));
    }
  };
  let sceneId: string | null = null;
  try { const r = JSON.parse(doc.attrs.raw as string) as { id?: unknown }; sceneId = typeof r.id === "string" ? r.id : null; } catch { /* none */ }
  take(doc, sceneId);
  doc.descendants((node) => {
    if (node.isTextblock) return false;
    take(node, modelIdOf(node));
    return !node.isAtom;
  });
  return out;
}

const sameMap = (a: Map<string, string>, b: Map<string, string>): boolean => {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
};

/** Steps that stay inside one textblock (all ordinary typing) can't change a node's attributes. */
function onlyInline(tr: Transaction): boolean {
  return tr.steps.every((step, i) => {
    if (!(step instanceof ReplaceStep)) return false;
    const { from, to } = step as unknown as { from: number; to: number };
    const doc = tr.docs[i]!;
    const $from = doc.resolve(from), $to = doc.resolve(to);
    return $from.sameParent($to) && $from.parent.inlineContent;
  });
}

/** Why a change from `before` to `after` must be refused under `locks`, or null when it may go ahead. */
export function extensionLockLoss(before: PMNode, after: PMNode, locks: ExtensionLocks): string | null {
  const ids = Object.keys(locks);
  if (ids.length === 0 || before === after) return null;
  const was = lockedEntries(before, ids), now = lockedEntries(after, ids);
  for (const id of ids) {
    if (!sameMap(was.get(id)!, now.get(id)!)) return extensionLockMessage(locks[id]!);
  }
  return null;
}

/** Why `tr` must be refused under `locks` (undo and redo included), or null. */
export function extensionLockRefusal(tr: Transaction, locks: ExtensionLocks): string | null {
  if (!tr.docChanged || Object.keys(locks).length === 0 || onlyInline(tr)) return null;
  return extensionLockLoss(tr.before, tr.doc, locks);
}

/** The guard plugin: `locks` is read on every transaction (the host changes it as version control
 *  reports), and `report` hears each refusal sentence. */
export function extensionLockGuard(locks: () => ExtensionLocks, report: (message: string) => void = () => {}): Plugin {
  return new Plugin({
    key: new PluginKey("patterExtensionLock"),
    filterTransaction(tr) {
      const why = extensionLockRefusal(tr, locks());
      if (why == null) return true;
      report(why);
      return false;
    },
  });
}
