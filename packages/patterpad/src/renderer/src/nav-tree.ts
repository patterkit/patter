// The navigator's scene tree: the Scenes list with its folders, the open scene's blocks under it, and the
// folder actions (new, rename, move, delete). Moved out of renderer.ts; what it needs from the rest of the
// window comes in once, through `initNavTree`.

import { navSiblings, sceneMoveState } from "./scene-move.js";
import { moveKeyDir, type SurfaceHandle } from "@patterkit/patterpad-surface/surface";
import { adoptSceneName, relabelNavScene } from "./scene-name.js";
import { PROJECT_SHARD_KEY } from "../../shared/api.js";
import type { OpenedProject, SaveResult } from "../../shared/api.js";
import type { PropertyDecl } from "@patterkit/model";
import { openContextMenu, iconNode, rove, wireReorder, wireTreeKeys, keyHint } from "@wildwinter/app-shell";
import { landed } from "./results.js";

/** What the navigator reads and calls from the rest of the window. `project` is written back when a folder
 *  action returns the project as it now stands. */
export interface NavContext {
  project: OpenedProject | null;
  readonly currentSceneId: string | null;
  readonly patterProps: PropertyDecl[];
  readonly surface: SurfaceHandle | null;
  readonly navListEl: HTMLElement;
  flipNav(mutate: () => void): void;
  highlightNav(id: string): void;
  loadScene(sceneId: string, opts?: { restoreCaret?: string; behind?: boolean }): Promise<void>;
  moveSceneBy(sceneId: string, dir: -1 | 1): Promise<void>;
  newSceneNow(): Promise<void>;
  newScenePrompt(): void;
  openSearch(mode?: "content" | "replace"): void;
  paintNavBadges(): void;
  sceneContextMenu(sceneId: string, x: number, y: number): void;
  scheduleMoveState(): void;
  showPropertiesDoc(): Promise<void>;
  tracked<T extends SaveResult>(p: Promise<T>): Promise<T>;
}

let c: NavContext;

/** Hand the navigator what it needs, once, before anything draws it. */
export function initNavTree(context: NavContext): void { c = context; }


/** The current scene's nav sub-list, rebuilt from the LIVE doc (unsaved block adds / renames show
 *  immediately). Signature-guarded: onChange fires per keystroke, the DOM only rebuilds on a real
 *  block-list change. Clicking a row drops the caret on that block (centred), like the search jumps. */
let navBlocksSig = "";
/** Keep the open scene's name in step with its title (#73). A rename edits the document, but the Scenes
 *  list, the overview index, the Start scene pickers, the Delete dialog and every other scene's jump
 *  targets all read `project` - the copy taken when the project opened - so the name is written back
 *  into it here, and the row already on screen is relabelled. Runs on every edit; changes nothing (and
 *  repaints nothing) unless the name actually moved. */
export function syncSceneName(): void {
  const name = c.surface?.sceneName();
  if (!name || !c.currentSceneId) return;
  if (adoptSceneName(c.project, c.currentSceneId, name)) relabelNavScene(c.navListEl, c.currentSceneId, name);
}

/** Open scene `id`'s block list and close the rest. A closed list stays drawn so it can fold shut, but at no
 *  height: inert keeps its rows out of the Tab order and away from screen readers. */
export function openNavScene(id: string): void {
  c.navListEl.querySelectorAll<HTMLElement>(".nav-scene").forEach((el) => {
    const open = el.dataset["id"] === id;
    el.classList.toggle("open", open);
    const blocks = el.querySelector<HTMLElement>(":scope > .nav-blocks");
    if (blocks) blocks.inert = !open;
  });
}

export function refreshNavBlocks(force = false): void {
  const holder = c.navListEl.querySelector<HTMLElement>(`.nav-scene[data-id="${CSS.escape(c.currentSceneId ?? "")}"] .nav-blocks-inner`);
  if (!holder) return;
  const blocks = c.surface?.blockList() ?? c.project?.scenes.find((s) => s.id === c.currentSceneId)?.blocks.map((b) => ({ id: b.id, label: b.name })) ?? [];
  const sig = `${c.currentSceneId}|${blocks.map((b) => `${b.id} ${b.label}`).join("; ")}`;
  if (!force && sig === navBlocksSig) return;
  navBlocksSig = sig;
  const active = holder.querySelector<HTMLElement>(".nav-block.active")?.dataset["id"];
  holder.replaceChildren();
  for (const blk of blocks) {
    const b = document.createElement("button");
    b.className = "nav-block"; b.type = "button"; b.dataset["id"] = blk.id;
    if (blk.id === active) b.classList.add("active");
    b.append(Object.assign(document.createElement("span"), { className: "nav-item-name", textContent: blk.label }));
    b.addEventListener("click", () => { c.surface?.revealNode(blk.id); c.surface?.focus(); });
    holder.appendChild(b);
  }
}

export function renderNav(): void {
  c.navListEl.replaceChildren();
  navBlocksSig = ""; // fresh rows: force the next block refresh to fill them
  const search = document.createElement("button");
  search.className = "nav-search"; search.type = "button"; search.dataset.tip = "Find by name, handle, or id"; search.setAttribute("aria-label", "Find by name, handle, or id");
  // It reads as what it opens, a search field: the drawn magnifier, then "Find" in the field's quiet ink, and
  // the shortcut at its right (the October 2026 UI review, 3-composition.md proposal 7).
  const searchIcon = document.createElement("span"); searchIcon.className = "nav-search-icon";
  searchIcon.append(iconNode("search", 13));
  search.append(searchIcon);
  search.append(Object.assign(document.createElement("span"), { className: "nav-search-label", textContent: "Find…" }));
  const searchKey = document.createElement("span"); searchKey.className = "nav-search-kbd"; searchKey.append(keyHint("Mod+F"));
  search.append(searchKey);
  search.addEventListener("click", () => c.openSearch());
  c.navListEl.appendChild(search);
  // The Properties document's row: fixed, above the scenes, with a count of what it holds. Depth 0
  // and no chevron - it is a page, not a container. (No VC badge yet: the renderer's shard map covers
  // scenes only, so the project shard has no status to paint here.)
  const propsRow = document.createElement("button");
  propsRow.className = "nav-doc shell-nav-row"; propsRow.type = "button";
  propsRow.dataset.tip = "The project's @patter properties";
  propsRow.dataset["vc"] = PROJECT_SHARD_KEY; // the shard key `paintVcBadges` badges this row from
  propsRow.setAttribute("aria-label", "Properties");
  propsRow.append(Object.assign(document.createElement("span"), { className: "nav-doc-name", textContent: "Properties" }));
  propsRow.append(Object.assign(document.createElement("span"), { className: "nav-doc-count shell-nav-count", textContent: String(c.patterProps.length) }));
  propsRow.addEventListener("click", () => void c.showPropertiesDoc());
  c.navListEl.appendChild(propsRow);
  // The scenes and their folders (scene folders, design/proposals/scene-folders.md): a tree, one tab stop
  // with the arrow keys (app-shell's tree keys), rows indented by depth. A closed folder's rows aren't drawn.
  const tree = document.createElement("div");
  tree.className = "nav-tree"; tree.setAttribute("role", "tree"); tree.setAttribute("aria-label", "Scenes");
  // With folders, every scene row keeps a chevron's room before its name, so a folder's name lines up with the
  // scenes beside it and what's inside a folder reads as one step in (the tree's own grammar, as Storyletter's).
  const withFolders = (c.project?.sceneFolders ?? []).length > 0;
  tree.classList.toggle("has-folders", withFolders);
  const byId = new Map((c.project?.scenes ?? []).map((s) => [s.id, s]));
  const folderName = new Map((c.project?.sceneFolders ?? []).map((f) => [f.id, f.name]));
  let hiddenBelow = Infinity; // depth under a closed folder: rows deeper than it are skipped
  for (const r of c.project?.navRows ?? []) {
    if (r.depth > hiddenBelow) continue;
    hiddenBelow = Infinity;
    if (r.kind === "folder") {
      tree.appendChild(folderRow(r.id, folderName.get(r.id) ?? "", r.depth));
      if (closedFolders.has(r.id)) hiddenBelow = r.depth;
      continue;
    }
    const s = byId.get(r.id);
    if (!s) continue;
    const row = document.createElement("div");
    row.className = "nav-scene"; row.dataset["id"] = s.id;
    row.style.setProperty("--nav-depth", String(r.depth));
    const b = document.createElement("button");
    b.className = "nav-item shell-nav-row"; b.type = "button"; b.dataset["id"] = s.id;
    b.dataset["vc"] = s.id; // the shard key `paintVcBadges` folds and badges this row from
    treeItem(b, s.id, r.depth);
    if (withFolders) b.append(Object.assign(document.createElement("span"), { className: "nav-chev-space" }));
    b.append(Object.assign(document.createElement("span"), { className: "nav-item-name", textContent: s.name }));
    b.addEventListener("click", () => void c.loadScene(s.id));
    b.addEventListener("contextmenu", (e) => { e.preventDefault(); c.sceneContextMenu(s.id, e.clientX, e.clientY); });
    // The script's move keys move a focused scene row too (Ctrl+Cmd+Up / Down; Ctrl+Alt elsewhere).
    b.addEventListener("keydown", (e) => {
      const dir = moveKeyDir(e);
      if (dir === null) return;
      e.preventDefault();
      void c.moveSceneBy(s.id, dir);
    });
    row.appendChild(b);
    // The block sub-list: rendered for every scene (rows fill lazily), revealed only while `.open`.
    const blocks = document.createElement("div");
    blocks.className = "nav-blocks";
    blocks.inert = true; // closed until highlightNav opens the current scene: hidden rows take no focus
    blocks.appendChild(Object.assign(document.createElement("div"), { className: "nav-blocks-inner" }));
    row.appendChild(blocks);
    wireReorder(row, s.id, "y", dropRow);
    tree.appendChild(row);
  }
  c.navListEl.appendChild(tree);
  wireTreeKeys(tree, (r) => { const id = r.dataset["id"]; if (id) toggleFolder(id); });
  // The quiet foot of the list: add a scene right where scenes live.
  const add = document.createElement("button");
  add.className = "nav-add-scene shell-nav-row shell-nav-add"; add.type = "button";
  add.setAttribute("aria-haspopup", "menu");
  add.append(iconNode("add", 12), Object.assign(document.createElement("span"), { textContent: "New" })); // the drawn add, not a typed "+"
  // One quiet row, three things it can make (scene folders): a click offers them, Scene first.
  add.addEventListener("click", () => {
    const r = add.getBoundingClientRect();
    openContextMenu(r.left, r.bottom + 2, [
      { label: "Scene", onClick: () => void c.newSceneNow() },
      { label: "Scene from Kit…", onClick: () => c.newScenePrompt() },
      { label: "Folder", onClick: () => void newFolderNow() },
    ]);
  });
  c.navListEl.appendChild(add);
  c.paintNavBadges(); // re-apply VC badges after a list rebuild
  if (c.currentSceneId) c.highlightNav(c.currentSceneId);
  const treeEl = c.navListEl.querySelector<HTMLElement>(".nav-tree");
  if (treeEl) rove(treeEl, treeEl.querySelector<HTMLElement>("[role=treeitem][aria-current]") ?? treeEl.querySelector<HTMLElement>("[role=treeitem]") ?? undefined);
  void syncClosedFolders();
}

// --- scene folders (design/proposals/scene-folders.md) ----------------------------------------------
// Cosmetic: a folder is a row in the list and nothing else. Which folders are closed is this person's own
// view, remembered per project (never in the project, so it never clashes).

/** The folders closed in the open project's list, and the project they were read for. */
let closedFolders = new Set<string>();
let closedFoldersFor: string | null = null;

/** Read this person's closed folders when the open project changes, then draw the list with them. */
async function syncClosedFolders(): Promise<void> {
  const root = c.project?.root ?? null;
  if (root === closedFoldersFor) return;
  closedFoldersFor = root;
  closedFolders = new Set(root ? await window.patter.closedFolders(root) : []);
  if (closedFolders.size && c.project?.root === root) renderNav();
}

function saveClosedFolders(): void {
  if (c.project) void window.patter.setClosedFolders(c.project.root, [...closedFolders]);
}

/** Open or close a folder. */
function toggleFolder(id: string): void {
  if (!(c.project?.sceneFolders ?? []).some((f) => f.id === id)) return;
  if (closedFolders.has(id)) closedFolders.delete(id); else closedFolders.add(id);
  saveClosedFolders();
  renderNav();
  c.navListEl.querySelector<HTMLElement>(`.nav-folder-item[data-id="${CSS.escape(id)}"]`)?.focus();
}

/** The folders a scene or folder sits in, innermost first. */
function foldersAbove(id: string): string[] {
  const rows = c.project?.navRows ?? [];
  const parent = new Map(rows.map((r) => [r.id, r.folder]));
  const out: string[] = [];
  for (let at = parent.get(id); at !== undefined && out.length <= rows.length; at = parent.get(at)) out.push(at);
  return out;
}

/** The outermost closed folder above a scene: the row that shows for it. */
export function visibleFolderOf(id: string): string | undefined {
  return foldersAbove(id).filter((f) => closedFolders.has(f)).at(-1);
}

/** Opening a scene opens the folders it sits in (D8). Its row only: the author can close one again. */
export function revealInNav(sceneId: string): void {
  const closed = foldersAbove(sceneId).filter((f) => closedFolders.has(f));
  if (!closed.length) return;
  for (const f of closed) closedFolders.delete(f);
  saveClosedFolders();
  renderNav();
}

/** A row's place in the tree, for app-shell's tree keys and for finding it again after a redraw. */
function treeItem(b: HTMLElement, id: string, depth: number): void {
  b.dataset["navKey"] = id;
  b.setAttribute("role", "treeitem");
  b.setAttribute("aria-level", String(depth + 1));
  b.tabIndex = -1;
}

/** The scenes inside a folder, however deep. */
function scenesInFolder(id: string): string[] {
  return (c.project?.navRows ?? []).filter((r) => r.kind === "scene" && foldersAbove(r.id).includes(id)).map((r) => r.id);
}

function folderRow(id: string, name: string, depth: number): HTMLElement {
  const open = !closedFolders.has(id);
  const wrap = document.createElement("div");
  wrap.className = "nav-folder"; wrap.dataset["id"] = id;
  wrap.style.setProperty("--nav-depth", String(depth));
  const b = document.createElement("button");
  b.className = "nav-folder-item shell-nav-row"; b.type = "button"; b.dataset["id"] = id;
  treeItem(b, id, depth);
  b.setAttribute("aria-expanded", String(open));
  const scenes = scenesInFolder(id);
  // A closed folder shows the badges of the scenes inside it, folded, so a lock isn't hidden by folding.
  if (!open && scenes.length) b.dataset["vc"] = scenes.join(" ");
  const chev = document.createElement("span");
  chev.className = `nav-chev${open ? " open" : ""}`;
  chev.append(iconNode("collapsed", 12));
  b.append(chev, Object.assign(document.createElement("span"), { className: "nav-item-name", textContent: name }));
  b.append(Object.assign(document.createElement("span"), { className: "nav-n shell-nav-count", textContent: String(scenes.length) }));
  b.dataset["tip"] = open ? "Close the folder" : "Open the folder";
  b.addEventListener("click", () => toggleFolder(id));
  b.addEventListener("dblclick", (e) => { e.preventDefault(); renameFolderInPlace(id); });
  b.addEventListener("contextmenu", (e) => { e.preventDefault(); folderContextMenu(id, e.clientX, e.clientY); });
  b.addEventListener("keydown", (e) => {
    if (e.key === "F2") { e.preventDefault(); renameFolderInPlace(id); return; }
    const dir = moveKeyDir(e);
    if (dir === null) return;
    e.preventDefault();
    void c.moveSceneBy(id, dir);
  });
  wrap.append(b);
  wireReorder(wrap, id, "y", dropRow, { onInto: (dragged, target) => void placeRow(dragged, target, "into") });
  return wrap;
}

/** A drop before or after a row. */
function dropRow(dragged: string, before: boolean, target: string): void {
  void placeRow(dragged, target, before ? "before" : "after");
}

/** Move a scene or folder in the list, glide the rows, and keep a folder it went into open. */
async function placeRow(rowId: string, target: string | null, where: "before" | "after" | "into"): Promise<void> {
  if (!c.project) return;
  const res = await c.tracked(window.patter.placeSceneRow(rowId, target, where));
  if (!landed(res, "Couldn't move it")) return;
  if (res.project) c.project = res.project;
  if (where === "into" && target && closedFolders.delete(target)) saveClosedFolders();
  c.flipNav(() => renderNav());
  c.scheduleMoveState();
}

/** New Folder: made at once, after the open scene in its folder (or at the end of `inside`, a folder's own
 *  menu), its name up for typing. */
export async function newFolderNow(inside?: string): Promise<void> {
  if (!c.project) return;
  const res = await c.tracked(window.patter.createSceneFolder(inside ? undefined : c.currentSceneId ?? undefined, inside));
  if (!landed(res, "Couldn't add the folder") || !res.project || !res.folderId) return;
  c.project = res.project;
  if (inside && closedFolders.delete(inside)) saveClosedFolders(); // open it, so the new folder shows
  renderNav();
  renameFolderInPlace(res.folderId);
}

/** Rename a folder where it stands: its name becomes a field. Enter or leaving keeps it; Escape doesn't. */
function renameFolderInPlace(id: string): void {
  const b = c.navListEl.querySelector<HTMLElement>(`.nav-folder-item[data-id="${CSS.escape(id)}"]`);
  const label = b?.querySelector<HTMLElement>(".nav-item-name");
  if (!b || !label) return;
  const before = label.textContent ?? "";
  const input = Object.assign(document.createElement("input"), { className: "nav-rename", value: before, type: "text" });
  input.setAttribute("aria-label", "Folder name");
  let done = false;
  const finish = async (keep: boolean): Promise<void> => {
    if (done) return;
    done = true;
    const name = input.value.trim();
    if (keep && name && name !== before) {
      const res = await c.tracked(window.patter.renameSceneFolder(id, name));
      if (landed(res, "Couldn't rename the folder") && res.project) c.project = res.project;
    }
    renderNav();
    c.navListEl.querySelector<HTMLElement>(`.nav-folder-item[data-id="${CSS.escape(id)}"]`)?.focus();
  };
  // The field lives inside the row's button: its own keys and clicks stay its own.
  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("dblclick", (e) => e.stopPropagation());
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); void finish(true); }
    else if (e.key === "Escape") { e.preventDefault(); void finish(false); }
  });
  input.addEventListener("blur", () => void finish(true));
  label.replaceWith(input);
  input.focus();
  input.select();
}

function folderContextMenu(id: string, x: number, y: number): void {
  const can = sceneMoveState(navSiblings(c.project?.navRows ?? [], id), id);
  const n = scenesInFolder(id).length;
  openContextMenu(x, y, [
    { label: "Rename", onClick: () => renameFolderInPlace(id) },
    { label: "New folder inside", onClick: () => void newFolderNow(id) },
    { label: "Move to Folder…", onClick: () => moveToFolderMenu(id, x, y) },
    { label: "Move up", disabled: !can.up, onClick: () => void c.moveSceneBy(id, -1) },
    { label: "Move down", disabled: !can.down, onClick: () => void c.moveSceneBy(id, 1) },
    { label: n === 0 ? "Delete folder" : n === 1 ? "Delete folder (its scene moves up)" : `Delete folder (its ${n} scenes move up)`, danger: true, onClick: () => void deleteFolderNow(id) },
  ]);
}

/** Move to Folder: the folders to choose from, by path, and the top level. With hundreds of scenes it's
 *  quicker than a drag. A folder can't go inside itself, so its own subtree isn't offered. */
export function moveToFolderMenu(rowId: string, x: number, y: number): void {
  const rows = c.project?.navRows ?? [];
  const names = new Map((c.project?.sceneFolders ?? []).map((f) => [f.id, f.name]));
  const pathOf = (f: string): string => [f, ...foldersAbove(f)].reverse().map((id) => names.get(id) ?? "").join(" / ");
  const here = rows.find((r) => r.id === rowId)?.folder;
  const choices = rows.filter((r) => r.kind === "folder" && r.id !== rowId && !foldersAbove(r.id).includes(rowId));
  openContextMenu(x, y, [
    { label: "Top level", disabled: here === undefined, onClick: () => void placeRow(rowId, null, "into") },
    ...choices.map((r) => ({ label: pathOf(r.id), disabled: r.id === here, onClick: () => void placeRow(rowId, r.id, "into") })),
  ]);
}

async function deleteFolderNow(id: string): Promise<void> {
  const res = await c.tracked(window.patter.deleteSceneFolder(id));
  if (!landed(res, "Couldn't delete the folder")) return;
  if (res.project) c.project = res.project;
  if (closedFolders.delete(id)) saveClosedFolders();
  c.flipNav(() => renderNav());
}

