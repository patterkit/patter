// ---------------------------------------------------------------------------
// The scene list's folders (design/proposals/scene-folders.md): every edit to the list's shape, as pure
// functions over the project's three navigation fields. Each one reads the list as laid out
// (`sceneFolderLayout`), changes the tree, and writes it back: `sceneOrder` as the list reads top to
// bottom with every folder open (folders and scenes in one order), `sceneFolder` for the scenes inside a
// folder, and `sceneFolders` with each folder's parent. Nothing moves on disk; nothing reaches the bundle.
// Pure, so project.ts commits the result and this is tested without a project open.
// ---------------------------------------------------------------------------

import { sceneFolderLayout } from "@patterkit/model";
import type { ProjectFile, SceneFolder } from "@patterkit/model";

/** The fields this module reads and writes. */
export type SceneNavFields = Pick<ProjectFile, "sceneOrder" | "sceneFolders" | "sceneFolder">;

/** Where a moved row lands, against a target row: before it, after it, or at the end inside it (a folder).
 *  A null target with "into" is the end of the top level. */
export type NavPlace = "before" | "after" | "into";

interface Node { kind: "folder" | "scene"; id: string; children: Node[] }

function buildTree(project: SceneNavFields, sceneIds: readonly string[]): Node[] {
  const roots: Node[] = [];
  const byId = new Map<string, Node>();
  for (const r of sceneFolderLayout(project, sceneIds).rows) {
    const n: Node = { kind: r.kind, id: r.id, children: [] };
    byId.set(r.id, n);
    (r.folder !== undefined ? byId.get(r.folder)!.children : roots).push(n);
  }
  return roots;
}

/** The tree back into the three fields, keeping the other folder fields and the folders' stored order. */
function writeTree(project: SceneNavFields, roots: Node[], folders: SceneFolder[]): SceneNavFields {
  const order: string[] = [];
  const filed: Record<string, string> = {};
  const parent = new Map<string, string | undefined>();
  const walk = (nodes: Node[], within: string | undefined): void => {
    for (const n of nodes) {
      order.push(n.id);
      if (n.kind === "scene") { if (within !== undefined) filed[n.id] = within; }
      else { parent.set(n.id, within); walk(n.children, n.id); }
    }
  };
  walk(roots, undefined);
  const nextFolders = folders.filter((f) => parent.has(f.id)).map((f) => {
    const { parent: _old, ...rest } = f;
    const p = parent.get(f.id);
    return p !== undefined ? { ...rest, parent: p } : rest;
  });
  const out: SceneNavFields = { ...project, sceneOrder: order };
  if (nextFolders.length) out.sceneFolders = nextFolders; else delete out.sceneFolders;
  if (Object.keys(filed).length) out.sceneFolder = filed; else delete out.sceneFolder;
  return out;
}

/** The list a node sits in, and its index there. */
function locate(roots: Node[], id: string): { list: Node[]; at: number; node: Node } | undefined {
  const search = (list: Node[]): { list: Node[]; at: number; node: Node } | undefined => {
    for (let i = 0; i < list.length; i++) {
      if (list[i]!.id === id) return { list, at: i, node: list[i]! };
      const deeper = search(list[i]!.children);
      if (deeper) return deeper;
    }
    return undefined;
  };
  return search(roots);
}

const contains = (node: Node, id: string): boolean => node.children.some((c) => c.id === id || contains(c, id));

/** Move a scene or folder against a target row. Returns the new fields, or an error the author can read. */
export function placeNavRow(project: SceneNavFields, sceneIds: readonly string[], id: string, target: string | null, where: NavPlace): SceneNavFields | { error: string } {
  const roots = buildTree(project, sceneIds);
  const moving = locate(roots, id);
  if (!moving) return { error: "That isn't in the scene list any more." };
  if (target === id) return writeTree(project, roots, project.sceneFolders ?? []);
  if (target === null && where !== "into") return { error: "There's nothing to drop it against." };
  const dest = target === null ? undefined : locate(roots, target);
  if (target !== null && !dest) return { error: "The place it was dropped isn't in the scene list any more." };
  if (dest && where === "into" && dest.node.kind !== "folder") return { error: "Only a folder can hold scenes." };
  if (dest && moving.node.kind === "folder" && (contains(moving.node, dest.node.id))) return { error: "A folder can't go inside itself." };
  moving.list.splice(moving.at, 1);
  if (where === "into") (dest ? dest.node.children : roots).push(moving.node);
  else {
    const again = locate(roots, target!)!; // the target's index may have shifted
    again.list.splice(where === "before" ? again.at : again.at + 1, 0, moving.node);
  }
  return writeTree(project, roots, project.sceneFolders ?? []);
}

/** Move a row one place up (-1) or down (1) among its siblings. Null at the first or last place. */
export function moveNavRowBy(project: SceneNavFields, sceneIds: readonly string[], id: string, dir: -1 | 1): SceneNavFields | null | { error: string } {
  const roots = buildTree(project, sceneIds);
  const at = locate(roots, id);
  if (!at) return { error: "That isn't in the scene list any more." };
  const j = at.at + dir;
  if (j < 0 || j >= at.list.length) return null;
  [at.list[at.at], at.list[j]] = [at.list[j]!, at.list[at.at]!];
  return writeTree(project, roots, project.sceneFolders ?? []);
}

/** Add a folder straight after `after` (a scene or folder row), in the same folder; at the end of the top
 *  level without one. With `inside` (a folder), at the end of that folder instead. */
export function addNavFolder(project: SceneNavFields, sceneIds: readonly string[], folder: { id: string; name: string }, after?: string, inside?: string): SceneNavFields {
  const roots = buildTree(project, sceneIds);
  const node: Node = { kind: "folder", id: folder.id, children: [] };
  const parent = inside !== undefined ? locate(roots, inside) : undefined;
  const at = after !== undefined ? locate(roots, after) : undefined;
  if (parent && parent.node.kind === "folder") parent.node.children.push(node);
  else if (at) at.list.splice(at.at + 1, 0, node); else roots.push(node);
  return writeTree(project, roots, [...(project.sceneFolders ?? []), { id: folder.id, name: folder.name }]);
}

/** Delete a folder: what it holds moves up into its place, in order. Never deletes a scene. */
export function removeNavFolder(project: SceneNavFields, sceneIds: readonly string[], id: string): SceneNavFields | { error: string } {
  const roots = buildTree(project, sceneIds);
  const at = locate(roots, id);
  if (!at || at.node.kind !== "folder") return { error: "That folder isn't in the scene list any more." };
  at.list.splice(at.at, 1, ...at.node.children);
  return writeTree(project, roots, (project.sceneFolders ?? []).filter((f) => f.id !== id));
}

/** Rename a folder. */
export function renameNavFolder(project: SceneNavFields, id: string, name: string): SceneNavFields | { error: string } {
  const folders = project.sceneFolders ?? [];
  if (!folders.some((f) => f.id === id)) return { error: "That folder isn't in the scene list any more." };
  return { ...project, sceneFolders: folders.map((f) => (f.id === id ? { ...f, name } : f)) };
}

/** A new scene (already in `sceneIds`), placed straight after `after` in the same folder; at the end of
 *  the top level without one. */
export function insertNavScene(project: SceneNavFields, sceneIds: readonly string[], sceneId: string, after?: string): SceneNavFields {
  const roots = buildTree(project, sceneIds.filter((id) => id !== sceneId));
  const node: Node = { kind: "scene", id: sceneId, children: [] };
  const at = after !== undefined ? locate(roots, after) : undefined;
  if (at) at.list.splice(at.at + 1, 0, node); else roots.push(node);
  return writeTree(project, roots, project.sceneFolders ?? []);
}

/** A deleted scene, out of the order and its folder. */
export function dropNavScene(project: SceneNavFields, sceneIds: readonly string[], sceneId: string): SceneNavFields {
  return writeTree(project, buildTree(project, sceneIds.filter((id) => id !== sceneId)), project.sceneFolders ?? []);
}

/** Put the scenes in `ids`' relative order without changing which folder each is in: in each level, the
 *  scenes fill the scene places in their new order, and folders keep theirs (the old flat reorder, kept
 *  for its callers). */
export function orderNavScenes(project: SceneNavFields, sceneIds: readonly string[], ids: readonly string[]): SceneNavFields {
  const roots = buildTree(project, sceneIds);
  const rank = new Map(ids.map((id, i) => [id, i]));
  const sortLevel = (list: Node[]): void => {
    const slots = list.map((n, i) => (n.kind === "scene" ? i : -1)).filter((i) => i >= 0);
    const scenes = slots.map((i) => list[i]!).sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
    slots.forEach((slot, k) => { list[slot] = scenes[k]!; });
    for (const n of list) if (n.kind === "folder") sortLevel(n.children);
  };
  sortLevel(roots);
  return writeTree(project, roots, project.sceneFolders ?? []);
}

/** "New folder", numbered past any already called that. */
export function untitledFolderName(names: readonly string[]): string {
  const taken = new Set(names);
  if (!taken.has("New folder")) return "New folder";
  for (let n = 2; ; n++) if (!taken.has(`New folder ${n}`)) return `New folder ${n}`;
}

/** `project` with its three navigation fields replaced by `nav`'s: a field `nav` leaves out is removed, not
 *  kept, so an emptied folder map doesn't survive a spread. */
export function withNav<P extends SceneNavFields>(project: P, nav: SceneNavFields): P {
  const out = { ...project };
  delete out.sceneOrder; delete out.sceneFolders; delete out.sceneFolder;
  if (nav.sceneOrder?.length) out.sceneOrder = nav.sceneOrder;
  if (nav.sceneFolders?.length) out.sceneFolders = nav.sceneFolders;
  if (nav.sceneFolder && Object.keys(nav.sceneFolder).length) out.sceneFolder = nav.sceneFolder;
  return out;
}
