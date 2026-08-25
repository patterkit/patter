// Patterpad main process (Node). It owns the filesystem and the shared @patterkit/ops core; the
// renderer reaches them only through the narrow IPC contract (shared/api.ts). This file is the app
// lifecycle + window + native dialogs + IPC wiring; the project session lives in project.ts and the
// open-where-you-left-off / recents / identity store in store.ts.

import { app, BrowserWindow, dialog, ipcMain, screen, shell, systemPreferences, Menu } from "electron";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { userInfo } from "node:os";
import { currentUserAsync, writeBinaryFile, writeTextFile } from "@wildwinter/simple-vc-lib";
import * as project from "./project.js";
import * as dictionaries from "./dictionaries.js";
import { createStore } from "./store.js";
import { applyMenu } from "./menu.js";
import { createDebugServer, type DebugServer } from "./debug-link.js";
import { savedWindowRect, rememberBounds, centeredOnPrimary, pinToolWindow } from "@wildwinter/app-shell/tool-window";
// The updater is the shell's. It IS this app's, generalised: the stall watchdog,
// the retry budget, the surfaced background error and the live progress that
// 0.6.6 grew after #33 all went into it, so this is a swap and not a downgrade.
// Its IPC channel names are byte-identical to the ones this app already used, so
// the preload and the renderer dialog are untouched.
import { configureUpdater, startBackgroundUpdateCheck } from "@wildwinter/app-shell/updater";
import { createJobHost, JOB_PROGRESS } from "@wildwinter/app-shell/job";
import { createProjectSession } from "@wildwinter/app-shell/session";
import type { SearchEntry, SearchFocus, SearchMode } from "../shared/api.js";
import type { BootState, DocLine, ExportResult, Identity, LocExportRequest, LocImportResult, OpenedProject, OpenResult, PackMergeSummary, PaneState, ProjectSettingsDto, QuickFix, ThemePrefs, VcsKind } from "../shared/api.js";

const here = dirname(fileURLToPath(import.meta.url));
let win: BrowserWindow | null = null;
let playWin: BrowserWindow | null = null;
let playSceneId: string | null = null;
let playBlockId: string | null = null; // Play Block: the block the run enters (null = scene start)
let searchWin: BrowserWindow | null = null;
let searchMode: SearchMode = "content"; // the mode the search window (re)opens in
let searchSeed: string | undefined; // an initial query to seed the search window with (property-usage deep-link)
let searchFocus: SearchFocus | undefined; // the editor's last scene + caret, for content-search ranking
let coverageWin: BrowserWindow | null = null;
let lastCoverageResult: import("../shared/api.js").CoverageResult | null = null; // session cache (the window shows it on reopen)

// Live debug link (#181): created on first use. Frames for the followed flow ride the existing play:mark
// path; status is pushed to the renderer's debug panel.
let debugServer: DebugServer | null = null;
function ensureDebugServer(): DebugServer {
  if (!debugServer) {
    debugServer = createDebugServer({
      currentBuildHash: () => project.currentBuildHash(),
      onFrame: (f) => { win?.webContents.send("play:mark", f.beatId, f.sceneId); },
      onReset: () => { win?.webContents.send("play:reset"); },
      onStatus: (s) => { win?.webContents.send("debug:status", s); refreshMenu(); }, // keep the menu checkbox in sync
    });
  }
  return debugServer;
}
// The shell names the settings file; we hand it the directory. It folds in the old
// `patterpad-session.json` sitting beside it on the first run after the change.
const store = createStore(app.getPath("userData"));

// Long jobs (the coverage sweep, today). COOPERATIVE, not parallel: the work still runs here, it just
// hands the event loop back every few milliseconds, so IPC keeps flowing and Cancel is heard. Progress
// goes to every live window rather than a remembered one, because the window that started the job is
// not necessarily the only one that should see it, and a closed-and-reopened window still catches up.
const jobs = createJobHost({
  send: (channel, payload) => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload);
  },
});

// Live bundle refresh over the debug link (live-bundle-refresh, phases 2-3): after a save (or a
// build), recompile the game-facing bundle and push it to a connected game, debounced. Free when
// nothing is connected: the gate below skips the compile entirely, and pushBundle itself no-ops when
// the client already runs the exact build (it re-hellos with the new hash after applying).
let debugPushTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleDebugPush(): void {
  if (!debugServer?.isOn() || debugServer.status().state !== "connected") return;
  clearTimeout(debugPushTimer);
  debugPushTimer = setTimeout(() => {
    const out = project.compileForDebugPush();
    if (out) debugServer?.pushBundle(out.hash, out.json);
  }, 500);
}

// The sensible default author name when the user leaves the identity blank: their OS account name, else
// a plain "Author". Keeps review comments + the edit trail signed even if the first-run prompt is skipped.
function defaultUserName(): string {
  try { return userInfo().username?.trim() || "Author"; } catch { return "Author"; }
}

// The review-session toggles (Review Feedback walk + Show Resolved Comments / Suggestions) are NOT
// preferences - they always start OFF each launch, so the author never forgets a stray "show resolved"
// left on from a past session. Reset on disk here (before any menu build / renderer boot) so the menu
// checkmarks and the renderer agree; within a session they still toggle and behave normally.
store.setPanes({ ...store.read().panes, reviewFeedback: false, commentsResolved: false, suggestionsResolved: false });

/** Rebuild the application menu (keeps File > Open Recent + the View pane-toggle checks current). */
function refreshMenu(): void {
  const s = store.read();
  // The Review > Line Status submenu lists the open project's writing-status rungs (empty when none open).
  const lineStatuses = project.hasProject() ? project.writingStatusLadder().map((r) => r.name) : [];
  // The Review > Spelling submenu mirrors the Dictionary settings: on/off + the active dictionary (ticked),
  // listing every installed dictionary. Disabled when no project is open.
  const dict = project.dictionarySettings();
  const spelling = {
    hasProject: project.hasProject(),
    enabled: dict?.enabled ?? true,
    language: dict?.language ?? "en-US",
    dictionaries: dictionaries.listDictionaries().map((d) => ({ id: d.id, label: d.builtin ? d.label : `${d.label} (imported)` })),
  };
  // The "Live Link" checkbox is ticked while the localhost link is up (listening / connected).
  const dbg = debugServer?.status().state;
  const debugActive = dbg === "listening" || dbg === "connected";
  if (win) applyMenu(win, s.recents, s.panes, s.theme, lineStatuses, spelling, project.isVoiced(), debugActive, project.isAudioTracked(), project.autoRebuildEnabled());
}

// Ask the editor window to flush its open scene to disk, and resolve once it confirms (or after a short
// timeout if it can't). Used before a project-wide Replace so the open scene's unsaved edits are included
// and never clobbered. The editor handles "editor:flush" by saving, then invokes "editor:flushed".
let flushWaiters: Array<() => void> = [];
function flushEditorScene(): Promise<void> {
  return new Promise((resolve) => {
    if (!win || win.isDestroyed()) return resolve();
    flushWaiters.push(resolve);
    win.webContents.send("editor:flush");
    setTimeout(() => { const i = flushWaiters.indexOf(resolve); if (i >= 0) { flushWaiters.splice(i, 1); resolve(); } }, 1500);
  });
}

/**
 * Opening a project, on the shell's `createProjectSession`.
 *
 * The shell owns the ORDER - open, forget on failure, record the root, invalidate what main cached for
 * the old project, rebuild the menu - and this app supplies the only step that is actually about the
 * app: `open`. The resolution of which scene and caret to land on stays in there, because none of it is
 * family-level.
 *
 * **The satellites are the reason to adopt this even if nothing else.** Both apps hand-wired "a
 * different project is open now" once per tool window, and both had left a window out. Registered here,
 * a satellite cannot be forgotten, and `clear` runs whether its window is open or not: the cache lives
 * in MAIN, so a closed window that reopens would otherwise be handed the previous project's report.
 */
const session = createProjectSession<OpenedProject, OpenResult>({
  // The shell's slice of the store, over this app's own `Store`.
  store: {
    get: () => { const s = store.read(); return { recents: s.recents, ...(s.lastProject !== undefined ? { lastProject: s.lastProject } : {}) }; },
    touchProject: (path, name) => store.recordOpen(path, name ?? basename(path)),
    forgetProject: (path) => store.forget(path),
  },
  open: (path) => {
    // Resolve the remembered scene FIRST (cheap root walk) so the landing-first open (#171) parses the
    // scene we'll actually paint - reopening straight onto the last-edited scene must not parse the
    // first one then immediately re-parse on hydration. A file-association launch onto a scene shard
    // still wins over it.
    const root = project.peekRoot(path);
    const remembered = root ? store.read().lastScene[root] : undefined;
    let proj: OpenedProject;
    // `openProject` throws on a bad / missing / unreadable project; the shell wants that as a value,
    // and turns it into a `forgetProject` so a moved project stops being offered.
    try { proj = project.openProject(path, remembered); }
    catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
    currentRoot = proj.root; // this project is now the one shown (see the second-instance jump-in-place guard)
    // A file-association launch onto a specific scene shard (Finder / argv) lands ON that scene;
    // otherwise (the project root / `.patter` package) fall back to where the author last left off.
    const launched = project.sceneForPath(path);
    const land = launched ?? (remembered && proj.sceneIds.includes(remembered) ? remembered : undefined);
    // Restore the caret only when we're landing on the very scene it was recorded in (a file-association
    // launch onto a different scene must not place the caret on a node that isn't there).
    const lastCaret = land && land === remembered ? store.read().lastCaret[proj.root] : undefined;
    // NOT setting `searchFocus` here: the satellites run AFTER this callback, and the search one clears
    // it. `openAndRecord` re-anchors from the reply once the shell has finished, so the clear removes
    // the OLD project's anchor and the new one lands after it, which is the order that was intended.
    return { session: proj, root: proj.root, name: proj.name, reply: { project: proj, lastScene: land, lastCaret } };
  },
  refreshMenu: () => refreshMenu(),
  satellites: [
    // `searchFocus` is re-anchored by `open` above when there is somewhere to anchor to; this clears it
    // for the failure path and for an invalidation that is not an open.
    { window: () => searchWin, channel: "searchWin:project", clear: () => { searchFocus = undefined; } },
    { window: () => coverageWin, channel: "covWin:project", clear: () => { lastCoverageResult = null; } },
  ],
});

/** Paths the renderer is allowed to ask us to open: ones the app already knows about (the last project,
 *  recents). A fresh path only enters via the NATIVE open / create dialogs (driven here in main, where the
 *  user picked it) - never straight from the untrusted renderer. This app wrote the guard; the shell now
 *  holds it so a third app gets it for free. */
const isKnownProjectPath = (path: string): boolean => session.isKnownPath(path);

/** Open a project and record it. The shell reports a failed open as a VALUE; every caller here predates
 *  that and expects a throw, so the conversion happens once, here, rather than at five call sites. */
function openAndRecord(path: string): OpenResult {
  const r = session.openAt(path);
  if ("error" in r) throw new Error(r.error);
  // Re-anchor search ranking at wherever we landed, after the satellites have cleared the old anchor.
  searchFocus = r.lastScene ? { sceneId: r.lastScene, fromBeatId: r.lastCaret } : undefined;
  return r;
}

function bootState(open: OpenResult | null): BootState {
  const s = store.read();
  return { open, recents: s.recents, identity: s.identity ?? null, panes: s.panes, theme: s.theme };
}

/** A `.patter` package double-clicked in Finder, captured before the window exists (open-file can fire
 *  during cold launch). boot() consumes it in place of the last project. */
let pendingOpenPath: string | null = null;

/** A `--at <where>` launch location from the command line, captured alongside the path. boot() /
 *  openInWindow consume it to land on the node it names instead of where the author last left off. */
let pendingOpenAt: string | null = null;

/** Root of the project currently shown in the window (set on every open, cleared back to welcome). Lets a
 *  second-instance launch tell "same project, jump in place" from "different project, load it". */
let currentRoot: string | null = null;

/** Two filesystem paths that resolve to the same location (used for the already-open project check). */
const samePath = (a: string | null | undefined, b: string | null | undefined): boolean =>
  !!a && !!b && resolve(a) === resolve(b);

/** Aim a freshly-opened project at a launch location. `showProject` already lands on `lastScene` and
 *  reveals `lastCaret`, so a resolved location simply overrides those two: no new renderer channel, and
 *  no race against the scene mounting. A scene target opens that scene with the caret at its top; a
 *  block / group / beat target also takes the caret. An unresolvable location is reported on stderr and
 *  ignored - the project still opens, exactly where it otherwise would have. */
function withLaunchLocation(r: OpenResult, query: string): OpenResult {
  const hit = project.resolveLaunchLocation(query);
  if (!hit) { console.error(`--at: nothing in this project matches '${query}'`); return r; }
  const out: OpenResult = { project: r.project, lastScene: hit.sceneId };
  if (hit.kind !== "scene") out.lastCaret = hit.id;
  return out;
}

/** Open a project, honouring a `--at` location when one rode in on the command line. */
function openAt(path: string, at: string | null): OpenResult {
  const r = openAndRecord(path);
  return at ? withLaunchLocation(r, at) : r;
}

/** A bare `patterpad --at <where>` while we're already running: send the open project to that location
 *  down the same go-to-anything channel the search window uses (loads its scene, reveals the node). */
function navigateInWindow(query: string): void {
  if (!win) return;
  const hit = project.resolveLaunchLocation(query);
  if (!hit) { console.error(`--at: nothing in this project matches '${query}'`); return; }
  win.webContents.send("search:navigate", hit);
}

/** Open an OS-provided `.patter` path (Finder double-click / `open` command) in the running window: it's
 *  a path the user just chose, so record it (it joins recents + becomes "known") and hand it to the
 *  renderer to load + render. Bad packages are ignored so a stray file can't wedge the open project. */
function openInWindow(path: string, at: string | null = null): void {
  // Never clear a location already captured at cold launch: an OS open-file carries a path but no `--at`.
  if (!win) { pendingOpenPath = path; if (at) pendingOpenAt = at; return; }
  if (/\.patterpack$/i.test(path)) { void unpackFromLaunch(path); return; } // a pack unpacks (with a destination prompt), it isn't opened in place
  try {
    const r = openAt(path, at);
    win.webContents.send("project:open", r);
    if (win.isMinimized()) win.restore();
    win.focus();
  } catch { /* unreadable .patter -> leave the current project as-is */ }
}

/** Launch: open a Finder-passed project if any, else restore the last project, else a clean welcome. */
function boot(): BootState {
  const opened = pendingOpenPath; pendingOpenPath = null;
  const at = pendingOpenAt; pendingOpenAt = null;
  if (opened && existsSync(opened)) {
    // A double-clicked `.patterpack` can't stand in as the boot project: it must be unpacked to a NEW folder
    // via a destination prompt. Defer it to run once the window's up, and fall through to last / welcome.
    if (/\.patterpack$/i.test(opened)) setImmediate(() => openInWindow(opened, at));
    else {
      try { return bootState(openAt(opened, at)); }
      catch { /* bad package -> fall through to last/welcome */ }
    }
  }
  const last = store.read().lastProject;
  if (last && existsSync(last)) {
    // A bare `patterpad --at <where>` (no path) reopens the last project straight at that location.
    // The session already drops a project that fails to open, so this only has to not crash the boot.
    try { return bootState(openAt(last, at)); }
    catch { /* moved / deleted / unreadable -> the session forgot it; show welcome */ }
  }
  return bootState(null);
}

/** Land an exported file through simple-vc-lib, so a read-only / VC-locked target is checked out (or its
 *  refusal surfaced) rather than choking a raw write. The target is wherever the producer chose to save -
 *  often inside the project's own repo - so it must honour the same lock-aware path as every other write. */
function writeExport(filePath: string, data: Buffer | string): ExportResult {
  const res = typeof data === "string" ? writeTextFile(filePath, data) : writeBinaryFile(filePath, data);
  return res.success ? { ok: true, path: filePath } : { ok: false, error: res.message || res.status };
}

/** Export the production report as an xlsx: ask the producer WHERE to save, then write the bytes the ops
 *  renderer produced (through the VC layer, so a locked / read-only target is handled, not choked on). */
async function exportReport(): Promise<ExportResult> {
  if (!win) return { ok: false, error: "no window" };
  const out = await project.reportXlsx();
  if (!out) return { ok: false, error: "no project open" };
  const r = await dialog.showSaveDialog(win, {
    title: "Export production information",
    defaultPath: out.defaultName,
    filters: [{ name: "Excel spreadsheet", extensions: ["xlsx"] }],
  });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  return writeExport(r.filePath, out.buffer);
}

/** Export the voice (VO) recording script (spec §16) as an xlsx through a native Save dialog. */
async function exportVoiceScript(everything: boolean): Promise<ExportResult> {
  if (!win) return { ok: false, error: "no window" };
  if (!project.isVoiced()) return { ok: false, error: "this project is not voiced" }; // no VO script for an un-voiced story (#206)
  const out = await project.voiceScriptXlsx(everything);
  if (!out) return { ok: false, error: "no project open" };
  const r = await dialog.showSaveDialog(win, { title: "Export voice script", defaultPath: out.defaultName, filters: [{ name: "Excel spreadsheet", extensions: ["xlsx"] }] });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  return writeExport(r.filePath, out.buffer);
}

/** Export the readable screenplay (.pdf or .docx, chosen in the dialog) through a native Save dialog. */
async function exportScript(): Promise<ExportResult> {
  if (!win) return { ok: false, error: "no window" };
  const stem = project.scriptStem();
  if (!stem) return { ok: false, error: "no project open" };
  const r = await dialog.showSaveDialog(win, {
    title: "Publish readable script",
    defaultPath: `${stem}.pdf`,
    filters: [{ name: "PDF document", extensions: ["pdf"] }, { name: "Word document", extensions: ["docx"] }],
  });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  const buffer = await project.scriptDocument(/\.docx$/i.test(r.filePath) ? "docx" : "pdf");
  if (!buffer) return { ok: false, error: "no project open" };
  return writeExport(r.filePath, buffer);
}

/** Export a single self-contained, playable HTML file of the whole story through a native Save dialog -
 *  hand it to a stakeholder and it plays offline in any browser (runtime + every locale inlined). */
async function exportPlayableHtml(): Promise<ExportResult> {
  if (!win) return { ok: false, error: "no window" };
  const out = project.playableHtml();
  if (!out) return { ok: false, error: "no project open" };
  const r = await dialog.showSaveDialog(win, { title: "Publish playable HTML", defaultPath: out.defaultName, filters: [{ name: "HTML page", extensions: ["html"] }] });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  return writeExport(r.filePath, out.content);
}

/** Export as Patterpack: bundle the whole project into a single `.patterpack` file to hand to someone -
 *  they open it with "Open Patterpack…" or by double-clicking. Source only (like Save As): `runPack`
 *  follows the shard extensions, so recorded audio and build output never travel. The renderer flushes any
 *  pending edit first, so the packed bytes are current. */
async function exportPatterpack(): Promise<ExportResult> {
  if (!win) return { ok: false, error: "no window" };
  const src = project.currentRoot();
  if (!src) return { ok: false, error: "no project open" };
  const base = basename(src).replace(/\.patter$/i, "");
  const r = await dialog.showSaveDialog(win, {
    title: "Export as Patterpack",
    message: "Save a single-file copy of the project to send to someone.",
    buttonLabel: "Export",
    defaultPath: `${base}.patterpack`,
    filters: [{ name: "Patterpack document", extensions: ["patterpack"] }],
  });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  let dest = r.filePath;
  if (!/\.patterpack$/i.test(dest)) dest += ".patterpack"; // the save panel may drop the extension
  try {
    return writeExport(dest, await project.packBytes());
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Publish for Web: pick a FOLDER; the harness (index.html + style.css) is written once and kept
 *  across republishes (the writer may have customised it), the story + player always refresh. */
async function exportWeb(): Promise<ExportResult & { kept?: string[] }> {
  if (!win) return { ok: false, error: "no window" };
  const r = await dialog.showOpenDialog(win, {
    title: "Publish for Web",
    buttonLabel: "Publish Here",
    properties: ["openDirectory", "createDirectory"],
  });
  const dir = r.filePaths[0];
  if (r.canceled || !dir) return { ok: false, canceled: true };
  const res = project.publishWebTo(dir);
  return res.ok ? { ok: true, path: dir, kept: res.kept } : { ok: false, error: res.error };
}

/** Export localisation strings (spec §14) in the requested format through a native Save dialog. */
async function exportLoc(request: LocExportRequest): Promise<ExportResult> {
  if (!win) return { ok: false, error: "no window" };
  const out = await project.locExport(request.format, request.locale);
  if (!out) return { ok: false, error: "no project open" };
  const filters = request.format === "xlsx" ? [{ name: "Excel spreadsheet", extensions: ["xlsx"] }]
    : request.format === "po" ? [{ name: "gettext PO / POT", extensions: ["po", "pot"] }]
    : [{ name: "JSON", extensions: ["json"] }];
  const r = await dialog.showSaveDialog(win, { title: "Export localisation", defaultPath: out.defaultName, filters });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  return writeExport(r.filePath, out.content);
}

/** Import a translated file through a native Open dialog; applies it (format by extension). */
async function importLoc(fallbackLocale?: string): Promise<LocImportResult> {
  if (!win) return { ok: false, error: "no window" };
  const r = await dialog.showOpenDialog(win, {
    title: "Import localisation",
    properties: ["openFile"],
    filters: [{ name: "Localisation files", extensions: ["json", "po", "pot", "xlsx"] }],
  });
  const file = r.filePaths[0];
  if (r.canceled || !file) return { ok: false, canceled: true };
  return project.locImport(file, fallbackLocale);
}

/** Import a custom Hunspell spell-check dictionary (#177): pick the `.dic`; its matching `.aff` sibling
 *  (same base name, same folder) comes with it. Stored per-machine in userData under that base name. */
async function importDictionaryDialog(): Promise<{ ok: boolean; error?: string; info?: dictionaries.DictionaryInfo }> {
  if (!win) return { ok: false, error: "no window" };
  const r = await dialog.showOpenDialog(win, {
    title: "Import a Hunspell dictionary",
    message: "Choose the .dic file - its matching .aff (same name, same folder) is imported with it.",
    properties: ["openFile"],
    filters: [{ name: "Hunspell dictionary", extensions: ["dic"] }],
  });
  const dic = r.filePaths[0];
  if (r.canceled || !dic) return { ok: false, error: "canceled" };
  const aff = dic.replace(/\.dic$/i, ".aff");
  if (!existsSync(aff)) return { ok: false, error: "No matching .aff file beside the .dic (a Hunspell pair shares one name)." };
  const base = dic.replace(/^.*[\\/]/, "").replace(/\.dic$/i, "");
  const id = (base.replace(/[^A-Za-z0-9_-]/g, "-").replace(/^[^A-Za-z]+/, "")) || "custom";
  return dictionaries.importDictionary(aff, dic, id, base);
}

async function openDialog(): Promise<OpenResult | null> {
  if (!win) return null;
  // The picker stays native (familiar), but carries context: title (Win/Linux) + message (macOS).
  const r = await dialog.showOpenDialog(win, {
    title: "Open a Patter project",
    message: "Choose your project's .patter folder.",
    buttonLabel: "Open",
    // A `.patter` project is a folder, but on macOS it's a registered PACKAGE - the system shows it as a
    // single file, so a plain openDirectory dialog greys it out. Allow openFile too (with a .patter
    // filter) so the package is selectable as one item; Windows/Linux ignore openFile here and fall back
    // to the directory selector (where `.patter` is just a folder). Either way we get the .patter path.
    properties: ["openFile", "openDirectory"],
    filters: [{ name: "Patter project", extensions: ["patter"] }],
  });
  const dir = r.filePaths[0];
  return r.canceled || !dir ? null : openAndRecord(dir);
}

/** Turn a project name into a safe `.patter` folder name (drop path separators; keep it readable). */
function patterFolderName(name: string): string {
  const clean = name.trim().replace(/[/\\]+/g, "-").replace(/\s+/g, " ");
  return `${clean || "Untitled"}.patter`;
}

/** Save As: duplicate the open project's `.patter` folder to a new name / location the user picks, then
 *  open the COPY (standard Save-As semantics - you carry on working in the duplicate). The renderer flushes
 *  any pending edit before calling this, so the bytes on disk are current when we copy them. */
async function saveAsDialog(): Promise<OpenResult | null> {
  if (!win) return null;
  const src = project.currentRoot();
  if (!src) return null; // nothing open
  const base = basename(src).replace(/\.patter$/i, "");
  const r = await dialog.showSaveDialog(win, {
    title: "Save project as…",
    message: "Choose a name and location for the duplicate.",
    buttonLabel: "Duplicate",
    defaultPath: join(dirname(src), patterFolderName(`${base} copy`)),
  });
  if (r.canceled || !r.filePath) return null;
  // The save panel may drop the extension (a package name); pin `.patter` so the copy is a real project.
  let dest = r.filePath;
  if (!/\.patter$/i.test(dest)) dest += ".patter";
  // Never duplicate onto the source itself, or into a path inside it (which would recurse).
  if (resolve(dest) === resolve(src) || resolve(dest).startsWith(resolve(src) + sep)) return null;
  if (existsSync(dest)) return null; // the picker confirms overwrite of a FILE, but our target is a folder - don't clobber
  project.duplicateTo(dest); // copy the authoring shards, skipping audio + build output (derived artefacts)
  return openAndRecord(dest); // open + record the copy; the renderer switches the editor to it
}

/** Open Patterpack…: pick a `.patterpack` FILE with a dedicated file picker. We can't overload the normal
 *  Open here: on Windows / Linux that dialog falls back to a DIRECTORY selector (a `.patter` folder), which
 *  greys out a lone `.patterpack` file. Once chosen, unpack it into a project folder the user picks. */
async function openPatterpackDialog(): Promise<OpenResult | null> {
  if (!win) return null;
  const r = await dialog.showOpenDialog(win, {
    title: "Open a Patterpack",
    message: "Choose a .patterpack file to unpack into a project.",
    buttonLabel: "Choose",
    properties: ["openFile"],
    filters: [{ name: "Patterpack document", extensions: ["patterpack"] }],
  });
  const pack = r.filePaths[0];
  return r.canceled || !pack ? null : unpackAndOpen(pack);
}

/**
 * Merge Returned Patterpack: fold a pack that came BACK into the OPEN project, in place.
 *
 * The third move of the round trip and a different act from the other two, which is why it is its own
 * menu entry rather than a mode of Open. Export writes a file and touches nothing; Open replaces the
 * project by unpacking to a new folder; this one EDITS the project you are looking at. An "Open" that
 * sometimes merged would be a command that sometimes replaces your work and sometimes rewrites it.
 *
 * Two pickers, returned-first. The returned pack is the thing the author came here to do, so it is asked
 * for first; the sent pack is bookkeeping, and leading with it reads as an interrogation before they have
 * said what they want. There is deliberately NO third picker for a destination: a merge always targets the
 * open project, and letting it target another one would just be an unpack.
 *
 * Then a confirmation, which is where this departs from the brief. The family spec asks for the merge to
 * be ONE undo step, and Storyletter can do that because its undo is a file-byte replay. Patterpad's undo
 * is ProseMirror history, per scene: there is no mechanism here that could unpick a write across every
 * shard in the project. So this follows the local precedent for a project-level edit the app cannot undo
 * (`deleteScene`, whose comment says the same thing): the VCS is the safety net, and the confirm carries
 * the weight. It is shown AFTER the merge has run, so it reports what the merge actually found rather
 * than asking for approval sight unseen - which the op's purity makes free.
 */
async function mergePatterpack(): Promise<{ project: OpenedProject; summary: PackMergeSummary } | { error: string } | null> {
  if (!win) return null;
  if (!project.currentRoot()) return { error: "no project open" };

  const returned = await dialog.showOpenDialog(win, {
    title: "Merge a Returned Patterpack",
    message: "Choose the .patterpack that came back to you.",
    buttonLabel: "Choose",
    properties: ["openFile"],
    filters: [{ name: "Patterpack document", extensions: ["patterpack"] }],
  });
  const returnedPath = returned.filePaths[0];
  if (returned.canceled || !returnedPath) return null;

  const base = await dialog.showOpenDialog(win, {
    title: "And the Patterpack you sent?",
    message: "Choose the .patterpack you originally sent them. It is the common ancestor, and the merge needs it.",
    buttonLabel: "Choose",
    properties: ["openFile"],
    filters: [{ name: "Patterpack document", extensions: ["patterpack"] }],
  });
  const basePath = base.filePaths[0];
  if (base.canceled || !basePath) return null;

  const plan = await project.planPackMerge(returnedPath, basePath);
  if ("error" in plan) return plan;

  const { summary } = plan;
  const added = summary.shards.filter((sh) => sh.added).length;
  const merged = summary.shards.length - added;
  if (summary.shards.length === 0) {
    await dialog.showMessageBox(win, { type: "info", message: "Nothing to merge.", detail: "That pack has no project files in it." });
    return null;
  }
  const what = `Merge ${merged} file${merged === 1 ? "" : "s"}${added ? ` and add ${added}` : ""} into this project?`;
  const conflictLine = summary.conflicts > 0
    ? `${summary.conflicts} conflict${summary.conflicts === 1 ? "" : "s"} will keep YOUR version and leave a .patterconflict file beside the shard saying what disagreed.`
    : "";
  const cannotUndo = "This edits the open project and cannot be undone from the Edit menu.";

  // A project-id mismatch takes the headline and flips the default button to Cancel. It nearly always
  // means the wrong file was chosen at one of the two prompts, and the merge that follows would be a
  // heap of conflicts that reads as though the other author rewrote everything. Still only a WARNING:
  // ids can legitimately differ across a fork or a reissue, and the author knows which is the case.
  const confirm = await dialog.showMessageBox(win, summary.provenance.ok
    ? {
        type: summary.conflicts > 0 ? "warning" : "question",
        buttons: ["Merge", "Cancel"],
        defaultId: 0,
        cancelId: 1,
        message: what,
        detail: [conflictLine, cannotUndo].filter(Boolean).join("\n\n"),
      }
    : {
        type: "warning",
        buttons: ["Merge Anyway", "Cancel"],
        defaultId: 1,
        cancelId: 1,
        message: "These do not look like the same project.",
        // Name the three ids rather than only reporting that they disagree. Which FILE is wrong is the
        // thing the author has to act on, and only the ids tell them that. Wording follows Storyletter's,
        // which said it better than ours did; the two apps are deliberately identical here.
        detail: [
          [
            `The returned pack carries project id ${summary.provenance.returned ?? "(none)"}`,
            `the pack you sent carries ${summary.provenance.base ?? "(none)"}`,
            `and this project is ${summary.provenance.target ?? "(unreadable)"}.`,
          ].join(", "),
          "Usually that means the wrong file was chosen at one of the two prompts. Merging anyway will work, but if the ancestor is wrong you will get conflicts everywhere rather than only where you and they really disagreed.",
          what.replace(/\?$/, "."),
          cannotUndo,
        ].join("\n\n"),
      });
  if (confirm.response !== 0) return null;

  const res = await project.commitPackMerge(plan);
  if (!res.ok || !res.project) return { error: res.error ?? "merge failed" };
  return { project: res.project, summary };
}

/** Unpack a `.patterpack` (menu-chosen OR double-clicked) into a NEW `.patter` folder, ALWAYS asking where
 *  to put it (default `<packname>.patter` beside the pack), then open the result. Shared by the menu open
 *  and the file-association launch so both prompt for a destination rather than guessing one. */
async function unpackAndOpen(packPath: string): Promise<OpenResult | null> {
  if (!win) return null;
  const base = basename(packPath).replace(/\.patterpack$/i, "");
  const r = await dialog.showSaveDialog(win, {
    title: "Unpack Patterpack",
    message: "Choose where to create the project folder.",
    buttonLabel: "Unpack",
    defaultPath: join(dirname(packPath), patterFolderName(base)),
  });
  if (r.canceled || !r.filePath) return null;
  let dest = r.filePath;
  if (!/\.patter$/i.test(dest)) dest += ".patter"; // the save panel may drop the package extension
  if (existsSync(dest)) { // our target is a folder; the picker only confirms overwrite of a FILE - don't clobber
    await dialog.showMessageBox(win, { type: "error", message: "That project folder already exists.", detail: `${dest}\n\nChoose a different name or location.` });
    return null;
  }
  const res = await project.unpackTo(packPath, dest);
  if (!res.ok) {
    await dialog.showMessageBox(win, { type: "error", message: "Could not unpack the Patterpack.", detail: res.error ?? "" });
    return null;
  }
  return openAndRecord(dest); // open + record the unpacked project; the renderer switches the editor to it
}

/** A double-clicked `.patterpack` (cold-launch deferred, or a runtime open-file / second-instance): unpack
 *  it to a user-chosen folder and switch the editor to the result, with the same restore/focus/send the
 *  direct `.patter` open path uses. */
async function unpackFromLaunch(packPath: string): Promise<void> {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
  try {
    const r = await unpackAndOpen(packPath);
    if (r) win.webContents.send("project:open", r);
  } catch { /* dialog cancelled / bad pack -> leave the current project as-is */ }
}

/** Scaffold a new `<name>.patter`. The renderer collected `name` in the themed dialog; here we only
 *  ask the system picker WHERE to keep it, then create the project folder inside that location. */
async function createDialog(name: string, vcs: VcsKind, buildBundle?: string): Promise<OpenResult | null> {
  if (!win) return null;
  const r = await dialog.showOpenDialog(win, {
    title: "Choose a location for your project",
    message: `Patterpad will create “${patterFolderName(name)}” here.`,
    buttonLabel: "Create here",
    properties: ["openDirectory", "createDirectory"],
  });
  const parent = r.filePaths[0];
  if (r.canceled || !parent) return null;
  const root = join(parent, patterFolderName(name));
  const proj = await project.createProject(root, name.trim(), vcs, buildBundle);
  store.recordOpen(root, proj.name);
  refreshMenu();
  return { project: proj };
}

// --- the interactive play window ---------------------------------------------

const MAIN_DEFAULT = { width: 1200, height: 820 };
const PLAY_DEFAULT = { width: 460, height: 740 };
const PLAY_MIN = { width: 340, height: 420 };

/** A remembered helper-window rect, but only if it still lands on a connected display (so a window saved
 *  on a now-disconnected monitor doesn't open offscreen). Falls back to the default size. Shared by the
 *  play + search windows. */
// `savedWindowRect`, `rememberBounds` and `centeredOnPrimary` are the shell's
// (@wildwinter/app-shell/tool-window). They were this app's, lifted: the first two
// came across byte-identical, including the 40px / 20px margins that decide a
// remembered position is still on a screen somebody has. `rememberBounds` came
// back with a better signature, taking just the bounds instead of threading a
// whole store slice through a read and a write, so the store shape stays here
// where it belongs.

function createPlayWindow(): void {
  const w = new BrowserWindow({
    ...savedWindowRect(store.read().play.bounds, PLAY_DEFAULT, PLAY_MIN),
    minWidth: PLAY_MIN.width,
    minHeight: PLAY_MIN.height,
    show: false,
    title: "Patterpad · Play",
    webPreferences: { preload: join(here, "../preload/index.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  playWin = w;
  // The pin means "above the EDITOR", which is a child window - not alwaysOnTop, which floats over
  // every other application on macOS and Windows (app-shell 0.33.0; a Storyletter user found it).
  pinToolWindow(w, win, store.read().play.pinned);
  w.once("ready-to-show", () => w.show());
  rememberBounds(w, (bounds) => store.setPlay({ ...store.read().play, bounds }));
  w.on("closed", () => { if (playWin === w) { playWin = null; win?.webContents.send("play:reset"); } }); // clear the editor's playhead + visited trail

  if (process.env["ELECTRON_RENDERER_URL"]) void w.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}/play/index.html`);
  else void w.loadFile(join(here, "../renderer/play/index.html"));
}

/** Open (or focus + restart) the play window for a scene (optionally entering a block - Play Block). */
function openPlay(sceneId: string, blockId?: string): void {
  playSceneId = sceneId;
  playBlockId = blockId ?? null;
  if (playWin && !playWin.isDestroyed()) { playWin.focus(); playWin.webContents.send("play:restart"); }
  else createPlayWindow();
}

/** Reset View: rescue EVERY window to a sane, on-screen place - un-minimise, default size, centred on the
 *  primary display - so a window lost on a now-disconnected monitor or minimised out of reach comes back.
 *  Clears remembered helper-window bounds too, so they reopen sensibly next time. */
function rescueWindows(): void {
  // The main editor window: restore, centre at its default size, focus.
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.setBounds({ ...MAIN_DEFAULT, ...centeredOnPrimary(MAIN_DEFAULT) });
    win.show(); win.focus();
  }
  // The play window: back to floating (re-pinned), default size, centred; remembered bounds cleared.
  store.setPlay({ pinned: true });
  if (playWin && !playWin.isDestroyed()) {
    if (playWin.isMinimized()) playWin.restore();
    pinToolWindow(playWin, win, true);
    playWin.webContents.send("play:pin", true); // ...and its BUTTON, which chose the old state
    playWin.setBounds({ ...PLAY_DEFAULT, ...centeredOnPrimary(PLAY_DEFAULT) });
    playWin.show();
  }
  // The helper tool windows (search / coverage): clear remembered bounds; if open, restore + recentre.
  store.setSearch({ pinned: true });
  if (searchWin && !searchWin.isDestroyed()) {
    if (searchWin.isMinimized()) searchWin.restore();
    pinToolWindow(searchWin, win, true); // the store says pinned; the live window must agree
    searchWin.webContents.send("searchWin:pin", true); // ...and so must its BUTTON, which chose the old state
    searchWin.setBounds({ ...SEARCH_DEFAULT, ...centeredOnPrimary(SEARCH_DEFAULT) });
    searchWin.show();
  }
  store.setCoverage({ pinned: true });
  if (coverageWin && !coverageWin.isDestroyed()) {
    if (coverageWin.isMinimized()) coverageWin.restore();
    pinToolWindow(coverageWin, win, true); // as above
    coverageWin.webContents.send("covWin:pin", true);
    coverageWin.setBounds({ ...COVERAGE_DEFAULT, ...centeredOnPrimary(COVERAGE_DEFAULT) });
    coverageWin.show();
  }
}

/** Centre a rect on the primary display's work area. */

// ---- the detached search tool window (#205) --------------------------------
// A small, FRAMELESS, always-on-top helper (its own renderer): the editor stays live underneath while
// you step through hits. It queries the project index in this process and drives the editor over IPC.
const SEARCH_DEFAULT = { width: 460, height: 520 };
const SEARCH_MIN = { width: 360, height: 280 };

function createSearchWindow(): void {
  const w = new BrowserWindow({
    ...savedWindowRect(store.read().search.bounds, SEARCH_DEFAULT, SEARCH_MIN),
    minWidth: SEARCH_MIN.width,
    minHeight: SEARCH_MIN.height,
    show: false,
    title: "Patterpad · Search",
    frame: false, // a light, chrome-free tool window: no OS title bar; the renderer draws its own slim drag bar + ✕
    webPreferences: { preload: join(here, "../preload/index.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  searchWin = w;
  pinToolWindow(w, win, store.read().search.pinned); // above the editor, not above the machine
  w.once("ready-to-show", () => w.show());
  rememberBounds(w, (bounds) => store.setSearch({ ...store.read().search, bounds }));
  w.on("closed", () => { if (searchWin === w) searchWin = null; });

  if (process.env["ELECTRON_RENDERER_URL"]) void w.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}/search/index.html`);
  else void w.loadFile(join(here, "../renderer/search/index.html"));
}

/** Open (or focus + switch the mode of) the detached search window, anchored at the editor's caret.
 *  `query` (optional) seeds the input: used by the coverage "gated on @x" → property-usage deep-link. */
function openSearchWindow(mode: SearchMode, focus?: SearchFocus, query?: string): void {
  searchMode = mode;
  searchSeed = query; // a fresh window reads it via searchWin:info; a re-focus gets searchWin:seed below
  if (focus) searchFocus = focus;
  if (searchWin && !searchWin.isDestroyed()) {
    searchWin.focus();
    searchWin.webContents.send("searchWin:mode", mode);
    if (query) searchWin.webContents.send("searchWin:seed", query);
  }
  else createSearchWindow(); // a fresh window reads `searchMode` + `searchSeed` via searchWin:info on boot
}

// --- coverage results window (#159) ---------------------------------------------------------------
const COVERAGE_DEFAULT = { width: 720, height: 620 };
const COVERAGE_MIN = { width: 480, height: 360 };

function createCoverageWindow(): void {
  const w = new BrowserWindow({
    ...savedWindowRect(store.read().coverage.bounds, COVERAGE_DEFAULT, COVERAGE_MIN),
    minWidth: COVERAGE_MIN.width,
    minHeight: COVERAGE_MIN.height,
    show: false,
    title: "Patterpad · Coverage",
    webPreferences: { preload: join(here, "../preload/index.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  coverageWin = w;
  pinToolWindow(w, win, store.read().coverage.pinned); // as above
  w.once("ready-to-show", () => w.show());
  rememberBounds(w, (bounds) => store.setCoverage({ ...store.read().coverage, bounds }));
  w.on("closed", () => { if (coverageWin === w) coverageWin = null; });

  if (process.env["ELECTRON_RENDERER_URL"]) void w.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}/coverage/index.html`);
  else void w.loadFile(join(here, "../renderer/coverage/index.html"));
}

/** Open (or focus) the detached coverage results window. It reads its state via covWin:info on boot, so a
 *  reopen shows the last cached result. */
function openCoverageWindow(): void {
  if (coverageWin && !coverageWin.isDestroyed()) coverageWin.focus();
  else createCoverageWindow();
}

function registerIpc(): void {
  ipcMain.handle("project:boot", (): BootState => boot());
  ipcMain.handle("project:hydrate", () => project.hydrate()); // finish the lazy open; returns the full scene list
  ipcMain.handle("project:openDialog", (): Promise<OpenResult | null> => openDialog());
  ipcMain.handle("project:saveAs", (): Promise<OpenResult | null> => saveAsDialog());
  ipcMain.handle("project:openPath", (_e, path: string): OpenResult => {
    if (!isKnownProjectPath(path)) throw new Error("refused to open an unrecognised path"); // renderer can only reopen known projects
    return openAndRecord(path);
  });
  ipcMain.handle("project:createDialog", (_e, name: string, vcs: VcsKind, buildBundle?: string): Promise<OpenResult | null> => createDialog(name, vcs, buildBundle));
  ipcMain.handle("project:forget", (_e, path: string): BootState => { store.forget(path); if (samePath(path, currentRoot)) currentRoot = null; refreshMenu(); return bootState(null); });
  ipcMain.handle("project:report", () => project.report());
  ipcMain.handle("project:proposeCoverageDrivers", () => project.proposeCoverageDrivers());
  // Coverage window (#159): open it, feed its boot state, run + cache, drive the editor's jump + External Properties tab.
  ipcMain.handle("coverage:open", () => openCoverageWindow());
  ipcMain.handle("covWin:info", (): import("../shared/api.js").CoverageWinInfo => {
    const pinned = store.read().coverage.pinned;
    const info = project.coverageInfo();
    const theme = store.read().theme; // this window paints in the author's palette too
    return info ? { hasProject: true, pinned, theme, ...info, last: lastCoverageResult } : { hasProject: false, pinned, theme, scenes: [], driverCount: 0, last: null };
  });
  ipcMain.handle("covWin:setPin", (_e, on: boolean) => {
    store.setCoverage({ ...store.read().coverage, pinned: on });
    pinToolWindow(coverageWin, win, on);
  });
  ipcMain.handle("covWin:run", async (_e, options: import("../shared/api.js").CoverageRunOptions) => {
    const outcome = await jobs.start("coverage", async (ctx) => project.coverageAsync(options, {
      // The job's cancel flag, in the shape ops asks for. Read through a getter: ops checks it at the
      // top of every run, and the whole point is that it can change between two of them.
      signal: { get aborted() { return ctx.cancelled; } },
      onRun: (done, total) => ctx.step(done, total),
    }));
    // A cancelled sweep still produced a report, and it is an honest one (`runs` is what it executed,
    // `cancelled` is set), so it is worth caching and showing rather than throwing away.
    if ("error" in outcome) throw new Error(outcome.error);
    const result = outcome.value ?? null;
    if (result) lastCoverageResult = result; // cache for the session (reopen restores it)
    return result;
  });
  ipcMain.handle("covWin:cancel", () => { jobs.cancel("coverage"); });
  ipcMain.handle("covWin:reveal", (_e, sceneId: string, beatId: string) => {
    if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.focus(); win.webContents.send("coverage:navigate", sceneId, beatId); }
  });
  ipcMain.handle("covWin:openWorld", () => {
    if (win && !win.isDestroyed()) { win.focus(); win.webContents.send("coverage:open-world"); }
  });
  // Coverage "gated on @x" → open the Search window in property-usage mode, seeded with the ref.
  ipcMain.handle("covWin:findUsage", (_e, ref: string) => openSearchWindow("property", searchFocus, ref));
  ipcMain.handle("project:exportReport", () => exportReport());
  ipcMain.handle("project:build", async () => {
    const r = await project.buildBundle();
    if (r.ok) scheduleDebugPush(); // live bundle refresh: an explicit build also reaches a connected game
    return r;
  });
  ipcMain.handle("project:audioManifest", () => project.writeAudioManifest());
  ipcMain.handle("project:toggleAutoRebuild", async () => { const on = await project.toggleAutoRebuild(); refreshMenu(); return on; }); // keep the Build-menu checkbox in sync
  ipcMain.handle("project:exportVoiceScript", (_e, everything: boolean) => exportVoiceScript(everything));
  ipcMain.handle("project:exportPlayableHtml", () => exportPlayableHtml());
  ipcMain.handle("project:exportWeb", () => exportWeb());
  ipcMain.handle("project:exportScript", () => exportScript());
  ipcMain.handle("patterpack:export", (): Promise<ExportResult> => exportPatterpack());
  ipcMain.handle("patterpack:open", (): Promise<OpenResult | null> => openPatterpackDialog());
  ipcMain.handle("patterpack:merge", () => mergePatterpack());
  ipcMain.handle("project:exportLoc", (_e, request: LocExportRequest) => exportLoc(request));
  ipcMain.handle("project:importLoc", (_e, fallbackLocale?: string) => importLoc(fallbackLocale));
  ipcMain.handle("project:readSettings", () => project.readSettings());
  ipcMain.handle("project:saveSettings", async (_e, s: ProjectSettingsDto) => {
    const r = await project.saveSettings(s);
    refreshMenu(); // dictionary tab may change spell-check on/off + language
    if (r.ok) {
      scheduleDebugPush(); // settings shape the bundle, so refresh a connected external game too
      // ...and a running PLAY WINDOW: properties / defaults / locales / captions all shape the compiled
      // bundle, so live-refresh the run in place (same path as an editor scene edit) rather than leaving
      // it stale until restart.
      if (playWin && !playWin.isDestroyed()) {
        const pr = project.refreshPlay();
        if (pr.kind === "stale") { playWin.webContents.send("play:stale"); win?.webContents.send("play:reset"); }
        else if (pr.kind !== "none") playWin.webContents.send("play:refreshed", pr.kind, pr.options ?? []);
      }
    }
    return r;
  });
  ipcMain.handle("project:setStart", (_e, start: { scene: string; block?: string }) => project.setStart(start));
  ipcMain.handle("project:reorderScenes", (_e, ids: string[]) => project.reorderScenes(ids));
  ipcMain.handle("project:createScene", (_e, name: string) => project.createScene(name));
  ipcMain.handle("project:sceneDeleteInfo", (_e, sceneId: string) => project.sceneDeleteInfo(sceneId));
  ipcMain.handle("project:deleteScene", (_e, sceneId: string) => project.deleteScene(sceneId));
  ipcMain.handle("scene:read", (_e, id: string) => project.readScene(id));
  ipcMain.handle("scene:readDocs", (_e, id: string) => project.readSceneDocs(id));
  ipcMain.handle("scene:saveDocs", (_e, id: string, map: Record<string, import("@patterkit/model").DocLine[]>) => project.saveSceneDocs(id, map));
  ipcMain.handle("scene:readComments", (_e, id: string) => project.readSceneComments(id));
  ipcMain.handle("scene:saveComments", (_e, id: string, comments: import("@patterkit/model").Comment[]) => project.saveSceneComments(id, comments));
  ipcMain.handle("scene:readWriting", (_e, id: string) => project.readSceneWriting(id));
  ipcMain.handle("scene:saveWriting", (_e, id: string, map: Record<string, string>) => project.saveSceneWriting(id, map));
  ipcMain.handle("scene:readRecording", (_e, id: string) => project.readSceneRecording(id));
  ipcMain.handle("scene:saveRecording", (_e, id: string, map: Record<string, string>) => project.saveSceneRecording(id, map));
  ipcMain.handle("scene:readRerecord", (_e, id: string) => project.readSceneRerecord(id));
  ipcMain.handle("scene:saveRerecord", (_e, id: string, map: Record<string, boolean>) => project.saveSceneRerecord(id, map));
  // Audio Folders index (#206): the renderer pulls the current snapshot on load, then receives pushes as
  // the folders change on disk. The indexer lives in the main process (off the event loop).
  ipcMain.handle("audio:current", () => project.audioCurrentSnapshot());
  // Playback (#206 P3): the resolved audio bytes for a beat, for both the inspector play button and the
  // play window's "Play with audio" (the renderer wraps them in a Blob).
  ipcMain.handle("audio:read", (_e, beatId: string) => project.audioBytesForBeat(beatId));
  // Scratch recording (#224): write an in-app take's WAV bytes into the scratch folder (the watcher then
  // picks it up). recording:setMode strips the native menu while recording so accelerators can't fire
  // behind the blocking overlay (restored when it ends).
  ipcMain.handle("audio:saveScratch", (_e, beatId: string, bytes: Uint8Array) => project.saveScratchAudio(beatId, bytes));
  // macOS gates the mic behind TCC: check (and if undecided, ask) BEFORE the renderer opens the stream,
  // so a denied state surfaces as a clear message instead of a silently-silent recording. Not-darwin
  // platforms have no such gate. Needs the audio-input hardened-runtime entitlement in packaged builds.
  ipcMain.handle("audio:micAccess", async () => {
    if (process.platform !== "darwin") return true;
    const status = systemPreferences.getMediaAccessStatus("microphone");
    if (status === "granted") return true;
    if (status === "not-determined") return systemPreferences.askForMediaAccess("microphone");
    return false; // denied or restricted - only the user can flip it, in System Settings
  });
  ipcMain.handle("recording:setMode", (_e, on: boolean) => { if (on) Menu.setApplicationMenu(null); else refreshMenu(); });
  project.onAudioSnapshot((snap) => { if (win && !win.isDestroyed()) win.webContents.send("audio:index", snap); });
  ipcMain.handle("scene:readSuggestions", (_e, id: string) => project.readSceneSuggestions(id));
  ipcMain.handle("scene:saveSuggestions", (_e, id: string, s: import("@patterkit/model").Suggestion[]) => project.saveSceneSuggestions(id, s));
  ipcMain.handle("review:feedback", (_e, scope?: { resolvedComments?: boolean; resolvedSuggestions?: boolean }) => project.reviewFeedback(scope));
  ipcMain.handle("dict:list", () => dictionaries.listDictionaries());
  ipcMain.handle("dict:read", (_e, id: string) => dictionaries.readDictionary(id));
  ipcMain.handle("dict:import", () => importDictionaryDialog());
  ipcMain.handle("dict:remove", (_e, id: string) => dictionaries.removeDictionary(id));
  ipcMain.handle("dict:addWord", (_e, word: string) => project.addDictionaryWord(word));
  ipcMain.handle("dict:addIgnore", (_e, word: string) => project.addIgnoreWord(word));
  // Review ▸ Spelling toggle / dictionary pick: persist, then rebuild the menu so its check / tick updates.
  ipcMain.handle("dict:set", async (_e, patch: { enabled?: boolean; language?: string }) => { const r = await project.setDictionary(patch); refreshMenu(); return r; });
  ipcMain.handle("scene:save", async (_e, id: string, flow: string, loc: string) => {
    const r = await project.saveScene(id, flow, loc, store.read().identity?.name);
    if (r.ok) scheduleDebugPush(); // live bundle refresh: a saved scene reaches a connected game
    return r;
  });
  ipcMain.handle("project:vcStatus", () => project.vcStatus());
  ipcMain.handle("scene:remember", (_e, projectPath: string, id: string, caretId?: string) => {
    store.recordScene(projectPath, id, caretId);
    searchFocus = { sceneId: id, fromBeatId: caretId }; // keep the search window's content-ranking anchored at the live caret
  });
  ipcMain.handle("play:open", (_e, sceneId: string, blockId?: string) => openPlay(sceneId, blockId));
  ipcMain.handle("play:start", () => { if (playSceneId) project.startPlay(playSceneId, playBlockId ?? undefined); });
  ipcMain.handle("play:info", () => ({
    address: playSceneId ? project.playAddress(playSceneId, playBlockId ?? undefined) : "",
    pinned: store.read().play.pinned,
    theme: store.read().theme, // this window paints in the author's palette too
    follow: store.read().playFollow,

    audio: project.audioFoldersEnabled(), // #206: surfaces the "Play with audio" toggle in folder mode
    captions: project.playCaptionsState(), // #214: closed-captions toggle state (default on)
    ...project.playLocaleInfo(),
  }));
  ipcMain.handle("play:setLocale", (_e, locale: string) => project.setPlayLocale(locale));
  ipcMain.handle("play:setCaptions", (_e, on: boolean) => project.setPlayCaptions(on));
  ipcMain.handle("play:setPin", (_e, on: boolean) => {
    store.setPlay({ ...store.read().play, pinned: on });
    pinToolWindow(playWin, win, on);
  });
  ipcMain.handle("view:resetWindows", () => rescueWindows());
  // The editor's scene changed: stash the live source (so the next (re)start plays it), then LIVE
  // REFRESH any running session (live-bundle-refresh, phase 1): a text-only edit swaps the string
  // tables in place, a structural edit hot-swaps the run (state carried over, §9.8). Only when the
  // swap is impossible (the in-flight edit doesn't compile) does the old freeze-until-restart path
  // take over. Editor marks stay: beat ids are stable, so the visited trail still points at real
  // positions (a deleted beat's mark simply has nothing to decorate).
  ipcMain.handle("play:edited", (_e, sceneId: string, flow: string, loc: string) => {
    project.setPlaySource({ sceneId, flow, loc });
    if (!playWin || playWin.isDestroyed()) return;
    const r = project.refreshPlay();
    if (r.kind === "none") return;
    if (r.kind === "stale") {
      // The run no longer matches the script and can't be swapped: freeze the play window AND drop
      // the now-misaligned playhead / visited trail from the editor.
      if (playSceneId === sceneId) {
        playWin.webContents.send("play:stale");
        win?.webContents.send("play:reset");
      }
      return;
    }
    playWin.webContents.send("play:refreshed", r.kind, r.options ?? []);
  });
  ipcMain.handle("play:step", () => project.playStep());
  ipcMain.handle("play:toStop", () => project.playToStop());
  ipcMain.handle("play:choose", (_e, optionId: string) => project.playChoose(optionId));
  ipcMain.handle("play:markAt", (_e, beatId: string | null, sceneId?: string) => {
    win?.webContents.send("play:mark", beatId, sceneId);
    // "Follow in the editor" (play-follow): when the author has asked for it, the mark ALSO reveals what
    // was just played. The decision lives here rather than in the play window so there is one place that
    // knows, and it reuses the marker's own target plus the editor's existing reveal path.
    //
    // IT MUST NOT STEAL FOCUS, which is the whole feature: a send reaches the editor's renderer without
    // raising or focusing the window, so the hand that is playing stays on the play window. Restore a
    // minimised editor - there is nothing to follow in a window you cannot see - but never `focus()`.
    if (!beatId || !sceneId || !store.read().playFollow) return;
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.webContents.send("play:follow", sceneId, beatId);
    }
  });
  ipcMain.handle("play:setFollow", (_e, on: boolean) => { store.setPlayFollow(on); });
  ipcMain.handle("play:resetMarks", () => { win?.webContents.send("play:reset"); });
  // Live debug link (#181): a localhost WS server an external game streams its cursor into. Frames for the
  // followed flow reuse the SAME play:mark path the in-app Play window uses, so the editor follows the live
  // playhead. Observe-only; the editor never drives the game.
  ipcMain.handle("debug:start", () => { ensureDebugServer().start(); refreshMenu(); return ensureDebugServer().status(); });
  ipcMain.handle("debug:stop", () => { ensureDebugServer().stop(); refreshMenu(); return ensureDebugServer().status(); });
  ipcMain.handle("debug:status", () => ensureDebugServer().status());
  ipcMain.handle("debug:follow", (_e, flowId: string) => { ensureDebugServer().follow(flowId); });
  ipcMain.handle("project:validate", (_e, live?: { sceneId: string; flow: string; loc: string }) => project.validate(live));
  // The detached search window (#205): open/focus it, and serve its index queries + jump back to the editor.
  ipcMain.handle("search:open", (_e, mode: SearchMode, focus?: SearchFocus, query?: string) => openSearchWindow(mode, focus, query));
  // `voiced` here gates ONLY the search window's Recording tab, so it reflects audio-status TRACKING (voiced +
  // not-opted-out), matching the inspector / menu (#206).
  ipcMain.handle("searchWin:info", () => ({ mode: searchMode, pinned: store.read().search.pinned, hasProject: project.hasProject(), voiced: project.isAudioTracked(), query: searchSeed, theme: store.read().theme }));
  ipcMain.handle("searchWin:byProperty", (_e, query: string) => project.propertyUsage(query, searchFocus));
  ipcMain.handle("searchWin:byTag", (_e, tag: string) => project.tagUsage(tag, searchFocus));
  ipcMain.handle("searchWin:tags", () => project.tagList());
  ipcMain.handle("searchWin:query", (_e, query: string) => project.searchProject(query, searchFocus));
  // The dimension comes from the WINDOW's current tab (not main's reopen-mode, which goes stale when the
  // user switches tabs in the window): `recording` true = recording-status, else writing-status.
  ipcMain.handle("searchWin:byStatus", (_e, status: string, recording: boolean) => project.linesByStatus(status, recording ? "recording" : "writing", searchFocus));
  ipcMain.handle("searchWin:statuses", (_e, recording: boolean) => (recording ? project.recordingStatusLadder() : project.writingStatusLadder()));
  ipcMain.handle("searchWin:jump", (_e, entry: SearchEntry) => { win?.webContents.send("search:navigate", entry); });
  // Project-wide Replace (the Find counterpart). Preview is read-only; Apply flushes the editor's open scene
  // to disk first (so unsaved edits are included + not clobbered), commits the rewritten shards through VC,
  // then tells the editor to reload its open scene with the new text.
  ipcMain.handle("editor:flushed", () => { const w = flushWaiters; flushWaiters = []; for (const r of w) r(); }); // the editor saved its open scene
  ipcMain.handle("searchWin:replacePreview", (_e, opts: import("@patterkit/ops").ReplaceOptions) => project.replacePreview(opts));
  ipcMain.handle("searchWin:replaceApply", async (_e, opts: import("@patterkit/ops").ReplaceOptions) => {
    await flushEditorScene();
    const r = await project.applyReplace(opts);
    if (r.ok && r.count > 0) win?.webContents.send("replace:applied");
    return r;
  });
  ipcMain.handle("searchWin:setPin", (_e, on: boolean) => {
    store.setSearch({ ...store.read().search, pinned: on });
    pinToolWindow(searchWin, win, on);
  });
  ipcMain.handle("searchWin:close", () => { searchWin?.close(); });
  ipcMain.handle("project:applyFix", (_e, fix: QuickFix) => project.applyFix(fix));
  ipcMain.handle("identity:get", (): Identity | null => store.read().identity ?? null);
  /**
   * A name to OFFER in the identity box, from the version control system.
   *
   * Both this app and Storyletter ask a person to type their name at first run while showing a
   * "Locked by bob@bob-ws" badge elsewhere in the same window: one person under two names, with the
   * name already in reach. This offers the second one as a starting point.
   *
   * A SUGGESTION only. It is not stored, not used as an author, and the person can type over it: a
   * workspace account is not always a name somebody wants on their words. Null whenever the VCS cannot
   * say, which is the filesystem provider always, git with no `user.name`, and svn ever.
   *
   * Keyed off the open project so it asks THAT working copy; with nothing open it falls back to the
   * process directory, where a machine-level answer (p4, plastic) may still arrive and git's will not.
   */
  ipcMain.handle("identity:suggest", async (): Promise<string | null> => {
    try { return (await currentUserAsync(currentRoot ?? undefined)) ?? null; }
    catch { return null; } // a suggestion is never worth failing a dialog over
  });
  // A blank name falls back to the OS user name (else "Author"), so skipping the first-run prompt still
  // yields a sensible signature for review comments + the per-line edit trail.
  ipcMain.handle("identity:set", (_e, identity: Identity) => {
    const email = identity.email?.trim();
    store.setIdentity({ name: identity.name?.trim() || defaultUserName(), ...(email ? { email } : {}) });
  });
  ipcMain.handle("panes:set", (_e, panes: PaneState) => { store.setPanes(panes); refreshMenu(); });
  ipcMain.handle("theme:set", (_e, theme: ThemePrefs) => {
    store.setTheme(theme);
    refreshMenu();
    // Every other open window shares this app's palette and cannot see the editor's root, so it has to
    // be told. Broadcast rather than tracked: a window that is not listening ignores it, and a window
    // opened later reads the same value out of its own boot info.
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed() && w !== win) w.webContents.send("theme:changed", theme);
    }
  });
  // External links the renderer may ask us to open in the browser: an allow-list (same philosophy as
  // openPath - only destinations the app itself put on screen), so a compromised renderer can't launch
  // arbitrary URLs.
  ipcMain.handle("app:openExternal", (_e, url: string) => {
    if (ABOUT_LINKS.has(url)) void shell.openExternal(url);
  });
  // Reveal the OPEN project in the platform file manager. Main's own record of the root, nothing
  // renderer-supplied (same philosophy as openPath / openExternal above).
  ipcMain.handle("app:revealProject", () => {
    const root = project.currentRoot();
    if (root) shell.showItemInFolder(root);
  });
}

/** The About dialog's links (the only external URLs the renderer can open). */
const ABOUT_LINKS = new Set(["https://patterkit.dev", "https://ian.wildwinter.net"]);

function createWindow(): void {
  win = new BrowserWindow({
    width: MAIN_DEFAULT.width,
    height: MAIN_DEFAULT.height,
    // Below this the inspector pane crowds the script column (the right gutter - note / comment icons -
    // slides under the inspector and the text starts to clip). Hold a floor so the layout stays sound.
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "Patterpad",
    webPreferences: {
      preload: join(here, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true, // the preload uses only contextBridge/ipcRenderer (no Node), so it can be sandboxed
    },
  });
  // Reveal only once the renderer signals (`app:ready`) that its INITIAL view is mounted - the restored
  // editor or the welcome screen. NOT on `ready-to-show`: that fires on the first paint of the pre-boot
  // chrome, which would flash the welcome screen before boot() swaps the editor in. A fallback timer still
  // reveals the window if the renderer errors before signalling, so a broken boot can't leave it hidden.
  let revealed = false;
  const reveal = (): void => {
    if (revealed) return;
    revealed = true;
    ipcMain.removeListener("app:ready", reveal);
    win?.show();
  };
  ipcMain.on("app:ready", reveal);
  setTimeout(reveal, 4000);
  win.on("closed", () => { win = null; playWin?.close(); searchWin?.close(); coverageWin?.close(); debugServer?.stop(); }); // closing the editor closes its helper windows + the debug link

  if (process.env["ELECTRON_RENDERER_URL"]) void win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  else void win.loadFile(join(here, "../renderer/index.html"));
  refreshMenu();
}

// A project launched from the OS. macOS delivers the `.patter` PACKAGE via the open-file event; Windows
// and Linux hand an INTERNAL shard path (.patterproj / .patterflow / .patterloc / .patterx) on the
// command line - there's no "package folder" off-Mac, so the real files are what the OS associates.
// Either way openProject -> loadProject walks UP from the path to the enclosing `.patterproj`, opening
// the whole project. (`.patterc` is a build artifact, not associated, but still resolves if launched.)
// `.patterpack` is the odd one out: not an internal shard but a single-file document that gets UNPACKED to a
// new folder (openInWindow / boot branch on it), never opened in place.
const PATTER_LAUNCH_EXTS = [".patter", ".patterproj", ".patterflow", ".patterloc", ".patterx", ".patterc", ".patterpack"];
function launchPathFromArgv(argv: string[]): string | null {
  const args = argv.slice(1);                    // argv[0] is the executable itself
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a) continue;
    if (a === "--at") { i++; continue; }          // the token after `--at` is a location, never a path
    if (a.startsWith("-")) continue;              // skip electron / chromium switches (and `--at=…`)
    if (PATTER_LAUNCH_EXTS.some((e) => a.toLowerCase().endsWith(e)) && existsSync(a)) return a;
  }
  return null;
}

/** `patterpad <project> --at <where>` (or `--at=<where>`): open straight at a location instead of where
 *  the author last left off. `<where>` is a beat id, or a scene / block Game ID or title - the same query
 *  the `patter resolve` CLI takes, so an id from a locale table, an audio filename, or a runtime log
 *  pastes straight in. With no path it re-opens the last project at that location. */
function launchLocationFromArgv(argv: string[]): string | null {
  const args = argv.slice(1);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a) continue;
    if (a === "--at") return args[i + 1]?.trim() || null;
    const inline = /^--at=(.*)$/.exec(a);
    if (inline) return inline[1]?.trim() || null;
  }
  return null;
}

// Single instance: double-clicking a .patterflow while Patterpad is already open should hand the file to
// Windows ties a running window to its Start Menu shortcut (and so its taskbar icon, pinning, and
// notifications) via the AppUserModelID; electron-builder stamps the shortcut with the appId, and we
// must claim the same one or the taskbar shows a blank icon. No-op on the other platforms.
app.setAppUserModelId("com.patterkit.patterpad");

// the RUNNING window (second-instance), not spawn a rival. The non-primary launch quits immediately.
// Forward this process's argv to the primary instance via additionalData. On Windows the `argv` Chromium
// delivers to the 'second-instance' event can drop or reorder user switches (it owns that array), so the
// custom `--at` location could vanish; additionalData is the reliable channel for forwarding it.
if (!app.requestSingleInstanceLock({ argv: process.argv })) {
  app.quit();
} else {
  // Windows / Linux cold launch via a file association: the path rides in OUR argv. (macOS uses open-file,
  // which can fire before whenReady - so both feed the same pendingOpenPath that boot() consumes.)
  pendingOpenPath = launchPathFromArgv(process.argv);
  pendingOpenAt = launchLocationFromArgv(process.argv); // `--at <where>`: land on that node, not the last caret

  app.on("second-instance", (_event, argv, _wd, additionalData) => {
    // Prefer the argv we forwarded via additionalData (survives Windows switch-stripping); fall back to the
    // raw event argv if it's absent (an older second instance that didn't forward it).
    const forwarded = (additionalData as { argv?: string[] } | undefined)?.argv;
    const eff = forwarded?.length ? forwarded : argv;
    const p = launchPathFromArgv(eff);
    const at = launchLocationFromArgv(eff);
    if (p && win && samePath(project.peekRoot(p), currentRoot)) {
      // The requested project is ALREADY the open one: jump in place, never reload it. A reload resets the
      // editor to the landing scene (and drops unsaved in-memory state), which the `--at` jump then races -
      // so `patterpad proj --at x` on the running window used to flicker back to the top instead of landing.
      if (at) navigateInWindow(at);
      if (win.isMinimized()) win.restore();
      win.focus();
    } else if (p) {
      openInWindow(p, at);                       // a DIFFERENT project (or nothing open): load it, honouring --at
    } else if (win) {
      if (at) navigateInWindow(at);              // bare `patterpad --at x`: jump the project already open
      if (win.isMinimized()) win.restore();
      win.focus();                               // bare re-launch: just surface us
    }
  });

  app.on("open-file", (event, path) => { event.preventDefault(); openInWindow(path); }); // macOS Finder

  app.whenReady().then(() => {
    registerIpc();
    createWindow();
    app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
    // Auto-update: check shortly after launch (let the window settle first), then every 6 hours.
    // `configureUpdater` first, or its prompts would be addressed to "This app" and
    // hung off whatever window happened to be focused.
    configureUpdater({ appName: "Patterpad", activeWindow: () => win ?? BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null });
    setTimeout(startBackgroundUpdateCheck, 10_000);
    setInterval(startBackgroundUpdateCheck, 6 * 60 * 60 * 1000);
  }).catch((e) => { console.error("failed to start Patterpad:", e); app.quit(); });

  // Quit when all windows are closed - on macOS too (we don't keep a window-less app "hanging around").
  app.on("window-all-closed", () => app.quit());
}
