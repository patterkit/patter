// Tier 2 view extensions in Patterpad's main process (patterkit design/view-extensions.md): which views the
// open project offers and whether each is installed on this machine, opening a view in a sandboxed floating
// window of its own (the shell's `openViewWindow`, which hands the view and the editor a port each and then
// stays out of the path), and the Extensions window (patterkit design/extensions-window.md): Add Extension, the
// one way in, which takes an extension into the project or, for one the project already takes, installs its views
// on this machine and offers a newer version; Remove from Project, which keeps its data; and Uninstall, per
// version, from this machine.
//
// A view's code is never run from the project folder: the project holds the extension's manifest and pin,
// and the package (the manifest and its view files) is installed under userData/view-extensions/<id>/<version>.
// The editor's renderer answers every view (renderer/src/view-extensions.ts).

import { app, dialog, type BrowserWindow } from "electron";
import { basename, dirname, join } from "node:path";
import {
  extensionRows, installExtensionPackage, installedExtensions, openViewWindow, planPackageAdd, planProjectRemoval,
  readExtensionPackage, resolveInstalled, uninstallViews,
} from "@wildwinter/app-shell/view-host";
import type { ExtensionPackage, ExtensionRow, ViewWindow } from "@wildwinter/app-shell/view-host";
import { rescueToolWindow, savedWindowRect } from "@wildwinter/app-shell/tool-window";
import type { WindowSlice } from "@wildwinter/app-shell/app-store";
import { MANIFEST_FILE_SUFFIX, missingRequirements, viewsFor } from "@wildwinter/toolkit/extensions";
import type { Manifest, Problem } from "@wildwinter/toolkit/extensions";
import type { AddExtensionResult, OpenedProject, ProjectStep, RemoveExtensionResult, SaveResult } from "../shared/api.js";

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
  /** Take manifests into the project as one undo step, the one asked for last (project.ts `takeExtensions`). */
  take(items: { text: string; manifest: Manifest }[]): Promise<SaveResult & { step?: ProjectStep; project?: OpenedProject; was?: string; reload?: boolean }>;
  /** Ask the writer a question with buttons; the button chosen, by index. */
  ask(message: string, detail: string, buttons: string[]): Promise<number>;
  /** Take an extension out of the project as one undo step, keeping its data (project.ts `untakeExtension`). */
  untake(id: string): Promise<SaveResult & { step?: ProjectStep; project?: OpenedProject; reload?: boolean }>;
  /** How many nodes carry an extension's data in the open project. */
  dataCount(id: string): number;
  /** The menu changed (the views on offer, or what's installed). */
  refreshMenu(): void;
  /** What the Extensions window lists may have changed: send it the rows again. */
  listChanged?(): void;
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

/** A package's extension's name, for a sentence. */
const nameOf = (pkg: ExtensionPackage): string =>
  typeof pkg.manifest.name === "string" && pkg.manifest.name ? pkg.manifest.name : pkg.manifest.id;

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
  /** Add Extension…, or, with an extension the project takes, its package for a view not installed here. */
  add(expect?: string): Promise<AddExtensionResult | null>;
  /** The Extensions window's rows: what the open project takes and what this machine has installed. */
  rows(): Promise<ExtensionRow[]>;
  /** Remove from Project…: refused while another extension needs it, asked first with how much data it has, then
   *  one undo step that keeps the data. Null when refused or cancelled. */
  remove(id: string): Promise<RemoveExtensionResult | null>;
  /** Uninstall one version of an extension's views from this machine, asked first; its open view windows close.
   *  Whether it went. */
  uninstall(id: string, version: string): Promise<boolean>;
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
    if (!choice.installed) { await deps.tell(`${x.manifest.name} isn't installed here`, choice.why ?? "", [`Choose File ▸ Extensions… and Install on this machine… to install it from ${x.manifest.name}'s package.`]); return; }
    const decl = viewsFor(choice.installed.manifest, "patter").find((v) => v.id === view);
    if (!decl) { await deps.tell(`${x.manifest.name} has no such view`, `The version installed here (${choice.installed.version}) doesn't offer it.`); return; }
    const slice = deps.slice(extension, view);
    const opened = openViewWindow({
      installed: choice.installed, view, host: "patter", scheme: VIEW_SCHEME, editor: win,
      ...(x.pin !== undefined ? { pinnedVersion: x.pin } : {}),
      // A version other than the pinned one opens with the mismatch said where the writer sees it.
      ...(choice.warning ? { title: `${decl.name} (${choice.warning})` } : {}),
      rect: savedWindowRect(slice.bounds(), VIEW_DEFAULT, VIEW_MIN), min: VIEW_MIN,
      pinTo: () => deps.editor() ?? undefined, pinned: slice.pinned(), onPin: slice.setPinned, remember: slice.remember,
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
      deps.listChanged?.();
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
        v.setPinned(true); // the window and its head's pin
      }
    },
    isView(w) {
      if (!w) return false;
      for (const v of open.values()) if (v.window === w) return true;
      return false;
    },
    async rows() {
      return extensionRows(deps.root() ? deps.taken() : [], await installedExtensions(deps.dir), "patter");
    },
    async remove(id) {
      if (!deps.root()) return null;
      const plan = planProjectRemoval(id, deps.taken());
      if (!plan.ok) { await deps.tell("This extension can't be removed yet", plan.why); return null; }
      const { name } = plan;
      const n = deps.dataCount(id);
      const data = n > 0
        ? `${name} has data in ${n} ${n === 1 ? "place" : "places"} in this project. It stays, unused, and comes back into use if you add ${name} again.`
        : `Nothing in this project has ${name} data yet.`;
      const go = await deps.ask(`Remove ${name} from this project?`,
        `${data} Its views stay installed on this machine. You can undo this.`, [`Remove ${name}`, "Cancel"]);
      if (go !== 0) return null;
      await deps.flushEditor();
      const r = await deps.untake(id);
      if (r.ok) await self.update(); // its views go from the Window menu, and an open one closes
      return { ...r, name };
    },
    async uninstall(id, version) {
      const installed = await installedExtensions(deps.dir);
      const mine = installed.filter((i) => i.id === id);
      const at = mine.find((i) => i.version === version);
      if (!at) return false;
      const name = at.manifest.name || id;
      const taken = deps.root() ? deps.taken().find((t) => t.id === id) : undefined;
      const last = mine.length === 1;
      const parts = [
        ...(taken ? [`This project takes ${name}${last ? `, so its views will show as not installed until you install them again` : ""}.`] : []),
        "Other projects on this machine that use this version lose its views too.",
        last ? `${name}'s views keep their own settings on this machine, and those go too.` : "The other installed versions keep their views' settings.",
      ];
      const go = await deps.ask(`Uninstall ${name} ${version} from this machine?`, parts.join(" "), [`Uninstall ${version}`, "Cancel"]);
      if (go !== 0) return false;
      // Its windows close before its files go: a view left open would run on what's being removed.
      for (const [key, v] of [...open]) if (key.startsWith(`${id}/`)) { v.close(); open.delete(key); }
      await uninstallViews(deps.dir, id, version);
      await self.update();
      return true;
    },
    async add(expect) {
      const win = deps.editor();
      if (!win || !deps.root()) return null;
      const wanted = expect !== undefined ? deps.taken().find((t) => t.id === expect) : undefined;
      if (expect !== undefined && !wanted) return null;
      const pkg = wanted
        ? await readPackage(`Install ${wanted.manifest.name}`, `Choose ${wanted.manifest.name}'s package: its folder, or an npm package tarball (.tgz).`)
        : await readPackage("Add Extension", "Choose an extension's package: its folder, or an npm package tarball (.tgz).");
      if (!pkg) return null;
      if (wanted && pkg.manifest.id !== wanted.id) {
        await deps.tell(`That isn't ${wanted.manifest.name}`, `The package you chose is ${nameOf(pkg)}, so nothing was installed.`);
        return null;
      }
      const refused = packageRefusal(pkg);
      if (refused) { await deps.tell(refused.title, refused.sub, refused.body); return null; }
      const name = nameOf(pkg);
      const plan = planPackageAdd(pkg.manifest, deps.taken());
      // A project that takes an older version is offered this one; either way the views install here.
      let take = plan.project === "take";
      if (plan.project === "update") {
        take = await deps.ask(`Update ${name} in this project?`,
          `This project takes ${name}${plan.pinned ? ` ${plan.pinned}` : ""}, and this package is ${plan.version}. Updating takes it into the project as one step you can undo. Its views are installed on this machine either way.`,
          [`Update to ${plan.version}`, "Not Now"]) === 0;
      }
      // What it requires and the project lacks goes in with it, in the same step, or nothing does.
      const required: ExtensionPackage[] = [];
      if (take && plan.missing.length > 0) {
        const got = await requirementsFor(pkg, plan.missing);
        if (!got) return null;
        required.push(...got);
      }
      let taken: Awaited<ReturnType<ViewDeps["take"]>> | null = null;
      if (take) {
        // Renaming a stage the new version renamed rewrites scene data, the open scene's among it.
        await deps.flushEditor();
        taken = await deps.take([...required, pkg].map((p) => ({ text: manifestText(p), manifest: p.manifest })));
        if (!taken.ok) return taken;
      }
      const installErrors: string[] = [];
      for (const p of [...required.filter((r) => viewsFor(r.manifest, "patter").length > 0), pkg]) {
        const installed = await installExtensionPackage(p, deps.dir);
        if (!installed.ok) installErrors.push(installed.why);
      }
      await self.update();
      const warnings = pkg.problems.filter((p) => p.severity === "warning").map(problemSentence);
      return {
        ...(taken ?? { ok: true }), name, version: pkg.manifest.version,
        ...(take ? {} : { installedOnly: true as const }),
        ...(plan.note ? { note: plan.note } : {}),
        ...(required.length ? { also: required.map((r) => ({ name: nameOf(r), version: r.manifest.version })) } : {}),
        ...(warnings.length ? { warnings } : {}),
        ...(installErrors.length ? { installError: installErrors.join(" ") } : {}),
      };
    },
  };

  /** The packages of the extensions `pkg` requires that the project lacks, chosen by the writer one by one, in
   *  order; null when they cancel or a package won't do (said why). */
  const requirementsFor = async (pkg: ExtensionPackage, missing: readonly string[]): Promise<ExtensionPackage[] | null> => {
    const name = nameOf(pkg);
    const out: ExtensionPackage[] = [];
    for (const id of missing) {
      const go = await deps.ask(`${name} needs “${id}”`,
        `${name} works only in a project that also takes the extension “${id}”, which this one doesn't. Choose its package to add both, as one step you can undo.`,
        [`Choose “${id}” Package…`, "Cancel"]);
      if (go !== 0) return null;
      const req = await readPackage(`Add “${id}”`, `Choose the package of “${id}”, which ${name} needs: its folder, or an npm package tarball (.tgz).`);
      if (!req) return null;
      if (req.manifest.id !== id) {
        await deps.tell(`That isn't “${id}”`, `The package you chose is ${nameOf(req)}, so ${name} wasn't added.`);
        return null;
      }
      const refused = packageRefusal(req);
      if (refused) { await deps.tell(refused.title, refused.sub, refused.body); return null; }
      // One level: what the requirement needs in turn must be in the project, or among what's being added.
      const have = [...deps.taken().map((t) => t.id), pkg.manifest.id, ...missing];
      const further = missingRequirements(req.manifest, have);
      if (further.length > 0) {
        await deps.tell(`${name} wasn't added`, `${nameOf(req)} needs ${further.map((f) => `“${f}”`).join(" and ")} too, which this project doesn't take. Add ${further.length > 1 ? "them" : "it"} first, then ${name}.`);
        return null;
      }
      out.push(req);
    }
    return out;
  };
  return self;
}

/** Where installed view packages live: one folder per extension, one per version inside it. */
export const viewsDir = (): string => join(app.getPath("userData"), "view-extensions");
