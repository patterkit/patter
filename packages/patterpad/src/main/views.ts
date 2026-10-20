// Tier 2 view extensions in Patterpad's main process (patterkit design/view-extensions.md): which views the
// open project offers and whether each is installed on this machine, opening a view in a sandboxed floating
// window of its own (the shell's `openViewWindow`, which hands the view and the editor a port each and then
// stays out of the path), File ▸ Add Extension…, and Install <Name> on This Machine….
//
// A view's code is never run from the project folder: the project holds the extension's manifest and pin,
// and the package (the manifest and its view files) is installed under userData/view-extensions/<id>/<version>.
// The editor's renderer answers every view (renderer/src/view-extensions.ts).

import { app, dialog, type BrowserWindow } from "electron";
import { basename, dirname, join } from "node:path";
import { installExtensionPackage, openViewWindow, readExtensionPackage, resolveInstalled } from "@wildwinter/app-shell/view-host";
import type { ExtensionPackage, ViewWindow } from "@wildwinter/app-shell/view-host";
import { pinToolWindow, rescueToolWindow, savedWindowRect } from "@wildwinter/app-shell/tool-window";
import type { WindowSlice } from "@wildwinter/app-shell/app-store";
import { MANIFEST_FILE_SUFFIX, viewsFor } from "@wildwinter/toolkit/extensions";
import type { Manifest, Problem } from "@wildwinter/toolkit/extensions";
import type { AddExtensionResult, OpenedProject, ProjectStep, SaveResult } from "../shared/api.js";

/** The scheme view pages are served on, registered privileged before the app is ready (index.ts). */
export const VIEW_SCHEME = "patter-view";

/** A view window's default and smallest size. */
const VIEW_DEFAULT = { width: 720, height: 560 };
const VIEW_MIN = { width: 360, height: 240 };

/** One view the open project offers, as the Window menu lists it. */
export interface ViewOffer {
  extension: string;
  view: string;
  /** The view's name (the menu item, and the window's title). */
  name: string;
  /** The extension's name. */
  extensionName: string;
  /** Opens on this machine. */
  installed: boolean;
  /** Why it doesn't open, as a sentence, when it doesn't. */
  why?: string;
}

/** What the views need from the rest of main. */
export interface ViewDeps {
  /** The views' folder: userData/view-extensions. */
  dir: string;
  editor(): BrowserWindow | null;
  /** The open project's root, and the extensions it takes with a sound manifest. */
  root(): string | null;
  taken(): { id: string; pin?: string; manifest: Manifest }[];
  slice(extension: string, view: string): WindowSlice;
  /** A notice in the editor's own chrome. */
  tell(title: string, sub: string, body?: string[]): Promise<unknown>;
  /** Save the open scene before a write that may rewrite it. */
  flushEditor(): Promise<void>;
  /** Take a manifest into the project as one undo step (project.ts `takeExtension`). */
  take(text: string, manifest: Manifest): Promise<SaveResult & { step?: ProjectStep; project?: OpenedProject; was?: string; reload?: boolean }>;
  /** The menu changed (the views on offer, or what's installed). */
  refreshMenu(): void;
}

/** A manifest problem as a sentence: its message, capitalised, with where it is. */
export function problemSentence(p: Problem): string {
  const m = p.message.charAt(0).toUpperCase() + p.message.slice(1);
  return `${m}${p.path ? ` (at ${p.path})` : ""}.`;
}

/** Why a package can't be taken into a Patter project, or null when it can: a fault in its manifest, or a
 *  manifest that extends nothing in Patter. */
export function packageRefusal(pkg: ExtensionPackage): { title: string; sub: string; body?: string[] } | null {
  const name = typeof pkg.manifest.name === "string" && pkg.manifest.name ? pkg.manifest.name : "This extension";
  const errors = pkg.problems.filter((p) => p.severity === "error").map(problemSentence);
  if (errors.length) return { title: `${name} can't be added`, sub: "Its manifest has faults, so Patterpad won't take it:", body: errors };
  const patter = pkg.manifest.targets?.patter;
  if (!patter || Object.keys(patter).length === 0) {
    const others = Object.keys(pkg.manifest.targets ?? {});
    return {
      title: `${name} can't be added`,
      sub: `${name} doesn't extend Patter${others.length ? `: its manifest targets ${others.join(" and ")} only` : ""}.`,
    };
  }
  return null;
}

/** The manifest's own text, as the package holds it (the project keeps it byte for byte). */
export function manifestText(pkg: ExtensionPackage): string {
  const bytes = pkg.files.get(`${pkg.manifest.id}${MANIFEST_FILE_SUFFIX}`);
  return bytes ? new TextDecoder().decode(bytes) : `${JSON.stringify(pkg.manifest, null, 2)}\n`;
}

/** The views a project offers, each with whether it opens on this machine and why not. */
export async function viewOffers(dir: string, taken: readonly { id: string; pin?: string; manifest: Manifest }[]): Promise<ViewOffer[]> {
  const out: ViewOffer[] = [];
  for (const x of taken) {
    const views = viewsFor(x.manifest, "patter");
    if (views.length === 0) continue;
    const choice = await resolveInstalled(dir, x.id, x.pin, x.manifest.name);
    for (const v of views) {
      const has = choice.installed ? viewsFor(choice.installed.manifest, "patter").some((iv) => iv.id === v.id) : false;
      const why = !choice.installed ? choice.why
        : has ? undefined : `The ${x.manifest.name} installed here (${choice.installed.version}) has no ${v.name}.`;
      out.push({ extension: x.id, view: v.id, name: v.name, extensionName: x.manifest.name, installed: has, ...(why ? { why } : {}) });
    }
  }
  return out;
}

export interface ViewExtensions {
  /** The views on offer, as last worked out (`update`). */
  offers(): readonly ViewOffer[];
  /** Work out the views on offer again (a project opened or closed, an extension taken or undone, an
   *  install), then rebuild the menu. */
  update(): Promise<void>;
  /** Open a view's window, or bring it forward. */
  open(extension: string, view: string): Promise<void>;
  /** Close every view window (the project closed or changed). */
  closeAll(): void;
  /** Reset View: every view window back on screen, default size, centred, pinned. */
  rescue(): void;
  /** A view window: Edit ▸ Undo there is the editor's. */
  isView(w: BrowserWindow | null | undefined): boolean;
  /** File ▸ Add Extension…. */
  add(): Promise<AddExtensionResult | null>;
  /** Install <Name> on This Machine…. */
  install(extension: string): Promise<void>;
}

/** Ask for an extension's package: a folder or an npm pack tarball. Off macOS a dialog picks files or folders,
 *  not both, so a folder package is picked by its manifest file. */
async function pickPackage(win: BrowserWindow, title: string, message: string): Promise<string | null> {
  const r = await dialog.showOpenDialog(win, {
    title, message, buttonLabel: "Choose",
    properties: process.platform === "darwin" ? ["openFile", "openDirectory"] : ["openFile"],
    filters: [{ name: "Extension package", extensions: ["tgz", "json"] }],
  });
  const picked = r.filePaths[0];
  if (r.canceled || !picked) return null;
  return picked.endsWith(MANIFEST_FILE_SUFFIX) ? dirname(picked) : picked;
}

export function createViewExtensions(deps: ViewDeps): ViewExtensions {
  const open = new Map<string, ViewWindow>();
  /** Views whose window is on its way (between the click and the window), by key. */
  const opening = new Map<string, Promise<void>>();
  let offers: ViewOffer[] = [];
  let updating = 0;
  /** Bumped when every view closes, so a window still on its way doesn't open for a project that's gone. */
  let generation = 0;

  const keyOf = (extension: string, view: string): string => `${extension}/${view}`;

  const readPackage = async (title: string, message: string): Promise<ExtensionPackage | null> => {
    const win = deps.editor();
    if (!win) return null;
    const path = await pickPackage(win, title, message);
    if (!path) return null;
    const pkg = await readExtensionPackage(path);
    if (!pkg.ok) { await deps.tell(`${basename(path)} can't be read`, pkg.why); return null; }
    return pkg;
  };

  /** Open a view's window, or bring it forward. */
  const openNow = async (extension: string, view: string): Promise<void> => {
    const win = deps.editor();
    const existing = open.get(keyOf(extension, view));
    if (existing && !existing.window.isDestroyed()) { existing.window.focus(); return; }
    if (!win) return;
    const x = deps.taken().find((t) => t.id === extension);
    if (!x) return;
    const asked = generation;
    const choice = await resolveInstalled(deps.dir, extension, x.pin, x.manifest.name);
    if (asked !== generation) return; // the project closed or changed meanwhile
    if (!choice.installed) { await deps.tell(`${x.manifest.name} isn't installed here`, choice.why ?? "", [`Choose Window ▸ Install ${x.manifest.name} on This Machine… to install it.`]); return; }
    const decl = viewsFor(choice.installed.manifest, "patter").find((v) => v.id === view);
    if (!decl) { await deps.tell(`${x.manifest.name} has no such view`, `The version installed here (${choice.installed.version}) doesn't offer it.`); return; }
    const slice = deps.slice(extension, view);
    const opened = openViewWindow({
      installed: choice.installed, view, host: "patter", scheme: VIEW_SCHEME, editor: win,
      ...(x.pin !== undefined ? { pinnedVersion: x.pin } : {}),
      // A version other than the pinned one opens with the mismatch said where the writer sees it.
      ...(choice.warning ? { title: `${decl.name} (${choice.warning})` } : {}),
      rect: savedWindowRect(slice.bounds(), VIEW_DEFAULT, VIEW_MIN), min: VIEW_MIN,
      pinTo: () => deps.editor() ?? undefined, pinned: slice.pinned(), remember: slice.remember,
      devTools: !app.isPackaged,
      onClosed: () => { if (open.get(keyOf(extension, view)) === opened) open.delete(keyOf(extension, view)); },
    });
    // When it closes the shell tells the editor (its meta again, `closed`), which drops its handle.
    open.set(keyOf(extension, view), opened);
  };

  const self: ViewExtensions = {
    offers: () => offers,
    async update() {
      const run = ++updating;
      const root = deps.root();
      const next = root ? await viewOffers(deps.dir, deps.taken()) : [];
      if (run !== updating) return; // a later update is on its way
      offers = next;
      // A view the project no longer offers here (an Add Extension undone, a package removed) goes.
      for (const [key, v] of [...open]) {
        if (offers.some((o) => o.installed && keyOf(o.extension, o.view) === key)) continue;
        v.close();
        open.delete(key);
      }
      deps.refreshMenu();
    },
    open(extension, view) {
      // One window per view: a second click while the first is still on its way joins it.
      const key = keyOf(extension, view);
      const pending = opening.get(key);
      if (pending) return pending;
      const run = openNow(extension, view).finally(() => { if (opening.get(key) === run) opening.delete(key); });
      opening.set(key, run);
      return run;
    },
    closeAll() {
      opening.clear();
      generation++; // a window still on its way belongs to the project that's going
      for (const v of open.values()) v.close();
      open.clear();
    },
    rescue() {
      for (const v of open.values()) {
        if (v.window.isDestroyed()) continue;
        rescueToolWindow(v.window, VIEW_DEFAULT);
        pinToolWindow(v.window, deps.editor(), true);
      }
    },
    isView(w) {
      if (!w) return false;
      for (const v of open.values()) if (v.window === w) return true;
      return false;
    },
    async add() {
      const win = deps.editor();
      if (!win || !deps.root()) return null;
      const pkg = await readPackage("Add Extension", "Choose an extension's package: its folder, or an npm package tarball (.tgz).");
      if (!pkg) return null;
      const refused = packageRefusal(pkg);
      if (refused) { await deps.tell(refused.title, refused.sub, refused.body); return null; }
      // Renaming a stage the new version renamed rewrites scene data, the open scene's among it.
      await deps.flushEditor();
      const taken = await deps.take(manifestText(pkg), pkg.manifest);
      if (!taken.ok) return taken;
      const installed = await installExtensionPackage(pkg, deps.dir);
      await self.update();
      const warnings = pkg.problems.filter((p) => p.severity === "warning").map(problemSentence);
      return {
        ...taken, name: pkg.manifest.name, version: pkg.manifest.version,
        ...(warnings.length ? { warnings } : {}),
        ...(installed.ok ? {} : { installError: installed.why }),
      };
    },
    async install(extension) {
      const x = deps.taken().find((t) => t.id === extension);
      if (!x) return;
      const pkg = await readPackage(`Install ${x.manifest.name} on This Machine`, `Choose ${x.manifest.name}'s package: its folder, or an npm package tarball (.tgz).`);
      if (!pkg) return;
      if (pkg.manifest.id !== extension) {
        const name = typeof pkg.manifest.name === "string" && pkg.manifest.name ? pkg.manifest.name : pkg.manifest.id;
        await deps.tell(`That isn't ${x.manifest.name}`, `The package you chose is ${name}, so it wasn't installed.`);
        return;
      }
      const refused = packageRefusal(pkg);
      if (refused) { await deps.tell(refused.title.replace("can't be added", "can't be installed"), refused.sub, refused.body); return; }
      const installed = await installExtensionPackage(pkg, deps.dir);
      if (!installed.ok) { await deps.tell(`${x.manifest.name} couldn't be installed`, installed.why); return; }
      await self.update();
    },
  };
  return self;
}

/** Where installed view packages live: one folder per extension, one per version inside it. */
export const viewsDir = (): string => join(app.getPath("userData"), "view-extensions");
