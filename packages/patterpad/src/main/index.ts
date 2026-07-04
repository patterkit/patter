// Patterpad main process (Node). It owns the filesystem and the shared @patterkit/ops core; the
// renderer reaches them only through the narrow IPC contract (shared/api.ts). This file is the app
// lifecycle + window + native dialogs + IPC wiring; the project session lives in project.ts and the
// open-where-you-left-off / recents / identity store in store.ts.

import { app, BrowserWindow, dialog, ipcMain, screen, shell, systemPreferences, Menu } from "electron";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { userInfo } from "node:os";
import { writeBinaryFile, writeTextFile } from "@wildwinter/simple-vc-lib";
import * as project from "./project.js";
import * as dictionaries from "./dictionaries.js";
import { createStore, type PlayWindowState } from "./store.js";
import { applyMenu } from "./menu.js";
import { createDebugServer, type DebugServer } from "./debug-link.js";
import { startBackgroundUpdateCheck } from "./updater.js";
import type { SearchEntry, SearchFocus, SearchMode } from "../shared/api.js";
import type { BootState, DocLine, ExportResult, Identity, LocExportRequest, LocImportResult, OpenResult, PaneState, ProjectSettingsDto, QuickFix, ThemePrefs, VcsKind } from "../shared/api.js";

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
const store = createStore(join(app.getPath("userData"), "patterpad-session.json"));

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
  if (win) applyMenu(win, s.recents, s.panes, s.theme, lineStatuses, spelling, project.isVoiced(), debugActive, project.isAudioTracked());
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

/** Paths the renderer is allowed to ask us to open: ones the app already knows about (the last project,
 *  recents). A fresh path only enters via the NATIVE open / create dialogs (driven here in main, where the
 *  user picked it) - never straight from the untrusted renderer. */
function isKnownProjectPath(path: string): boolean {
  const s = store.read();
  const known = new Set(
    [s.lastProject, ...s.recents.map((r) => r.path)]
      .filter((p): p is string => !!p)
      .map((p) => resolve(p)),
  );
  return known.has(resolve(path));
}

/** Open a project, record it in the session, and resolve the scene to land on (if still present). The
 *  start `path` may be the project root OR an internal shard (a Windows file-association launch) - either
 *  way `openProject` resolves the enclosing project, so we record/key off its ROOT, never the raw path. */
function openAndRecord(path: string): OpenResult {
  // Resolve the remembered scene FIRST (cheap root walk) so the landing-first open (#171) parses the scene
  // we'll actually paint - reopening straight onto the last-edited scene must not parse the first one then
  // immediately re-parse on hydration. A file-association launch onto a scene shard still wins over it.
  const root = project.peekRoot(path);
  const remembered = root ? store.read().lastScene[root] : undefined;
  const proj = project.openProject(path, remembered);
  store.recordOpen(proj.root, proj.name);
  refreshMenu();
  // A file-association launch onto a specific scene shard (Finder / argv) lands ON that scene; otherwise
  // (the project root / `.patter` package) fall back to where the author last left off.
  const launched = project.sceneForPath(path);
  const land = launched ?? (remembered && proj.sceneIds.includes(remembered) ? remembered : undefined);
  // Restore the caret only when we're landing on the very scene it was recorded in (a file-association
  // launch onto a different scene must not place the caret on a node that isn't there).
  const lastCaret = land && land === remembered ? store.read().lastCaret[proj.root] : undefined;
  // A different project is now open: re-anchor search ranking and let an open search window re-fetch.
  searchFocus = land ? { sceneId: land, fromBeatId: lastCaret } : undefined;
  if (searchWin && !searchWin.isDestroyed()) searchWin.webContents.send("searchWin:project");
  // A different project invalidates the cached coverage report; let an open coverage window re-fetch.
  lastCoverageResult = null;
  if (coverageWin && !coverageWin.isDestroyed()) coverageWin.webContents.send("covWin:project");
  return { project: proj, lastScene: land, lastCaret };
}

function bootState(open: OpenResult | null): BootState {
  const s = store.read();
  return { open, recents: s.recents, identity: s.identity ?? null, panes: s.panes, theme: s.theme };
}

/** A `.patter` package double-clicked in Finder, captured before the window exists (open-file can fire
 *  during cold launch). boot() consumes it in place of the last project. */
let pendingOpenPath: string | null = null;

/** Open an OS-provided `.patter` path (Finder double-click / `open` command) in the running window: it's
 *  a path the user just chose, so record it (it joins recents + becomes "known") and hand it to the
 *  renderer to load + render. Bad packages are ignored so a stray file can't wedge the open project. */
function openInWindow(path: string): void {
  if (!win) { pendingOpenPath = path; return; }
  try {
    const r = openAndRecord(path);
    win.webContents.send("project:open", r);
    if (win.isMinimized()) win.restore();
    win.focus();
  } catch { /* unreadable .patter -> leave the current project as-is */ }
}

/** Launch: open a Finder-passed project if any, else restore the last project, else a clean welcome. */
function boot(): BootState {
  const opened = pendingOpenPath; pendingOpenPath = null;
  if (opened && existsSync(opened)) {
    try { return bootState(openAndRecord(opened)); }
    catch { /* bad package -> fall through to last/welcome */ }
  }
  const last = store.read().lastProject;
  if (last && existsSync(last)) {
    try { return bootState(openAndRecord(last)); }
    catch { store.forget(last); } // moved / deleted / unreadable -> drop it, show welcome
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
function savedWindowRect(
  saved: { x?: number; y?: number; width: number; height: number } | undefined,
  def: { width: number; height: number },
  min: { width: number; height: number },
): { x?: number; y?: number; width: number; height: number } {
  if (!saved) return { ...def };
  const w = Math.max(min.width, saved.width), h = Math.max(min.height, saved.height);
  if (saved.x != null && saved.y != null) {
    const onScreen = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return saved.x! + w > a.x + 40 && saved.x! < a.x + a.width - 40 && saved.y! + h > a.y + 20 && saved.y! < a.y + a.height - 20;
    });
    if (onScreen) return { x: saved.x, y: saved.y, width: w, height: h };
  }
  return { width: w, height: h };
}

/** Persist a helper window's bounds as the user moves / resizes / closes it (debounced). Shared by the
 *  play + search windows; `read`/`write` thread its own store slice. */
function rememberBounds(w: BrowserWindow, read: () => PlayWindowState, write: (s: PlayWindowState) => void): void {
  const saveBounds = (): void => { if (!w.isDestroyed()) write({ ...read(), bounds: w.getBounds() }); };
  let boundsTimer: ReturnType<typeof setTimeout> | undefined;
  const queueSave = (): void => { clearTimeout(boundsTimer); boundsTimer = setTimeout(saveBounds, 400); };
  w.on("resize", queueSave); w.on("move", queueSave);
  w.on("close", () => { clearTimeout(boundsTimer); saveBounds(); });
}

function createPlayWindow(): void {
  const w = new BrowserWindow({
    ...savedWindowRect(store.read().play.bounds, PLAY_DEFAULT, PLAY_MIN),
    minWidth: PLAY_MIN.width,
    minHeight: PLAY_MIN.height,
    show: false,
    title: "Patterpad · Play",
    alwaysOnTop: store.read().play.pinned, // floats over the editor by default (remembered)
    webPreferences: { preload: join(here, "../preload/index.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  playWin = w;
  w.once("ready-to-show", () => w.show());
  rememberBounds(w, () => store.read().play, (s) => store.setPlay(s));
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
    playWin.setAlwaysOnTop(true);
    playWin.setBounds({ ...PLAY_DEFAULT, ...centeredOnPrimary(PLAY_DEFAULT) });
    playWin.show();
  }
  // The helper tool windows (search / coverage): clear remembered bounds; if open, restore + recentre.
  store.setSearch({ pinned: true });
  if (searchWin && !searchWin.isDestroyed()) {
    if (searchWin.isMinimized()) searchWin.restore();
    searchWin.setBounds({ ...SEARCH_DEFAULT, ...centeredOnPrimary(SEARCH_DEFAULT) });
    searchWin.show();
  }
  store.setCoverage({ pinned: true });
  if (coverageWin && !coverageWin.isDestroyed()) {
    if (coverageWin.isMinimized()) coverageWin.restore();
    coverageWin.setBounds({ ...COVERAGE_DEFAULT, ...centeredOnPrimary(COVERAGE_DEFAULT) });
    coverageWin.show();
  }
}

/** Centre a rect on the primary display's work area. */
function centeredOnPrimary(size: { width: number; height: number }): { x: number; y: number } {
  const a = screen.getPrimaryDisplay().workArea;
  return { x: Math.round(a.x + (a.width - size.width) / 2), y: Math.round(a.y + (a.height - size.height) / 2) };
}

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
    alwaysOnTop: store.read().search.pinned, // floats over the editor by default (remembered)
    webPreferences: { preload: join(here, "../preload/index.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  searchWin = w;
  w.once("ready-to-show", () => w.show());
  rememberBounds(w, () => store.read().search, (s) => store.setSearch(s));
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
    alwaysOnTop: store.read().coverage.pinned, // floats over the editor by default (remembered)
    webPreferences: { preload: join(here, "../preload/index.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  coverageWin = w;
  w.once("ready-to-show", () => w.show());
  rememberBounds(w, () => store.read().coverage, (s) => store.setCoverage(s));
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
  ipcMain.handle("project:forget", (_e, path: string): BootState => { store.forget(path); refreshMenu(); return bootState(null); });
  ipcMain.handle("project:report", () => project.report());
  ipcMain.handle("project:coverage", (_e, options: import("../shared/api.js").CoverageRunOptions) => project.coverage(options));
  ipcMain.handle("project:proposeCoverageDrivers", () => project.proposeCoverageDrivers());
  // Coverage window (#159): open it, feed its boot state, run + cache, drive the editor's jump + External Properties tab.
  ipcMain.handle("coverage:open", () => openCoverageWindow());
  ipcMain.handle("covWin:info", (): import("../shared/api.js").CoverageWinInfo => {
    const pinned = store.read().coverage.pinned;
    const info = project.coverageInfo();
    return info ? { hasProject: true, pinned, ...info, last: lastCoverageResult } : { hasProject: false, pinned, scenes: [], driverCount: 0, last: null };
  });
  ipcMain.handle("covWin:setPin", (_e, on: boolean) => {
    store.setCoverage({ ...store.read().coverage, pinned: on });
    coverageWin?.setAlwaysOnTop(on);
  });
  ipcMain.handle("covWin:run", (_e, options: import("../shared/api.js").CoverageRunOptions) => {
    lastCoverageResult = project.coverage(options); // cache for the session (reopen restores it)
    return lastCoverageResult;
  });
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
  ipcMain.handle("project:exportVoiceScript", (_e, everything: boolean) => exportVoiceScript(everything));
  ipcMain.handle("project:exportPlayableHtml", () => exportPlayableHtml());
  ipcMain.handle("project:exportWeb", () => exportWeb());
  ipcMain.handle("project:exportScript", () => exportScript());
  ipcMain.handle("project:exportLoc", (_e, request: LocExportRequest) => exportLoc(request));
  ipcMain.handle("project:importLoc", (_e, fallbackLocale?: string) => importLoc(fallbackLocale));
  ipcMain.handle("project:readSettings", () => project.readSettings());
  ipcMain.handle("project:saveSettings", async (_e, s: ProjectSettingsDto) => { const r = await project.saveSettings(s); refreshMenu(); if (r.ok) scheduleDebugPush(); return r; }); // dictionary tab may change spell-check on/off + language; settings shape the bundle, so refresh a connected game too
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
    audio: project.audioFoldersEnabled(), // #206: surfaces the "Play with audio" toggle in folder mode
    captions: project.playCaptionsState(), // #214: closed-captions toggle state (default on)
    ...project.playLocaleInfo(),
  }));
  ipcMain.handle("play:setLocale", (_e, locale: string) => project.setPlayLocale(locale));
  ipcMain.handle("play:setCaptions", (_e, on: boolean) => project.setPlayCaptions(on));
  ipcMain.handle("play:setPin", (_e, on: boolean) => {
    store.setPlay({ ...store.read().play, pinned: on });
    playWin?.setAlwaysOnTop(on);
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
  ipcMain.handle("play:markAt", (_e, beatId: string | null, sceneId?: string) => { win?.webContents.send("play:mark", beatId, sceneId); });
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
  ipcMain.handle("searchWin:info", () => ({ mode: searchMode, pinned: store.read().search.pinned, hasProject: project.hasProject(), voiced: project.isAudioTracked(), query: searchSeed }));
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
    searchWin?.setAlwaysOnTop(on);
  });
  ipcMain.handle("searchWin:close", () => { searchWin?.close(); });
  ipcMain.handle("project:applyFix", (_e, fix: QuickFix) => project.applyFix(fix));
  ipcMain.handle("identity:get", (): Identity | null => store.read().identity ?? null);
  // A blank name falls back to the OS user name (else "Author"), so skipping the first-run prompt still
  // yields a sensible signature for review comments + the per-line edit trail.
  ipcMain.handle("identity:set", (_e, identity: Identity) => {
    const email = identity.email?.trim();
    store.setIdentity({ name: identity.name?.trim() || defaultUserName(), ...(email ? { email } : {}) });
  });
  ipcMain.handle("panes:set", (_e, panes: PaneState) => { store.setPanes(panes); refreshMenu(); });
  ipcMain.handle("theme:set", (_e, theme: ThemePrefs) => { store.setTheme(theme); refreshMenu(); });
  // External links the renderer may ask us to open in the browser: an allow-list (same philosophy as
  // openPath - only destinations the app itself put on screen), so a compromised renderer can't launch
  // arbitrary URLs.
  ipcMain.handle("app:openExternal", (_e, url: string) => {
    if (ABOUT_LINKS.has(url)) void shell.openExternal(url);
  });
}

/** The About dialog's links (the only external URLs the renderer can open). */
const ABOUT_LINKS = new Set(["https://patterkit.com", "https://wildwinter.bio.link"]);

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
  win.on("closed", () => { win = null; playWin?.close(); searchWin?.close(); debugServer?.stop(); }); // closing the editor closes its helper windows + the debug link

  if (process.env["ELECTRON_RENDERER_URL"]) void win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  else void win.loadFile(join(here, "../renderer/index.html"));
  refreshMenu();
}

// A project launched from the OS. macOS delivers the `.patter` PACKAGE via the open-file event; Windows
// and Linux hand an INTERNAL shard path (.patterproj / .patterflow / .patterloc / .patterx) on the
// command line - there's no "package folder" off-Mac, so the real files are what the OS associates.
// Either way openProject -> loadProject walks UP from the path to the enclosing `.patterproj`, opening
// the whole project. (`.patterc` is a build artifact, not associated, but still resolves if launched.)
const PATTER_LAUNCH_EXTS = [".patter", ".patterproj", ".patterflow", ".patterloc", ".patterx", ".patterc"];
function launchPathFromArgv(argv: string[]): string | null {
  for (const a of argv.slice(1)) {              // argv[0] is the executable itself
    if (!a || a.startsWith("-")) continue;       // skip electron / chromium switches
    if (PATTER_LAUNCH_EXTS.some((e) => a.toLowerCase().endsWith(e)) && existsSync(a)) return a;
  }
  return null;
}

// Single instance: double-clicking a .patterflow while Patterpad is already open should hand the file to
// Windows ties a running window to its Start Menu shortcut (and so its taskbar icon, pinning, and
// notifications) via the AppUserModelID; electron-builder stamps the shortcut with the appId, and we
// must claim the same one or the taskbar shows a blank icon. No-op on the other platforms.
app.setAppUserModelId("com.patterkit.patterpad");

// the RUNNING window (second-instance), not spawn a rival. The non-primary launch quits immediately.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Windows / Linux cold launch via a file association: the path rides in OUR argv. (macOS uses open-file,
  // which can fire before whenReady - so both feed the same pendingOpenPath that boot() consumes.)
  pendingOpenPath = launchPathFromArgv(process.argv);

  app.on("second-instance", (_event, argv) => {
    const p = launchPathFromArgv(argv);
    if (p) openInWindow(p);                      // a file double-clicked while we're running
    else if (win) { if (win.isMinimized()) win.restore(); win.focus(); } // bare re-launch: just surface us
  });

  app.on("open-file", (event, path) => { event.preventDefault(); openInWindow(path); }); // macOS Finder

  app.whenReady().then(() => {
    registerIpc();
    createWindow();
    app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
    // Auto-update: check shortly after launch (let the window settle first), then every 6 hours.
    setTimeout(startBackgroundUpdateCheck, 10_000);
    setInterval(startBackgroundUpdateCheck, 6 * 60 * 60 * 1000);
  }).catch((e) => { console.error("failed to start Patterpad:", e); app.quit(); });

  // Quit when all windows are closed - on macOS too (we don't keep a window-less app "hanging around").
  app.on("window-all-closed", () => app.quit());
}
