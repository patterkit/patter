// The preload bridge: the ONLY channel between the renderer and the main process. It exposes a tiny,
// explicit `window.patter` API (shared/api.ts) over contextBridge - no Node, no fs, no ipcRenderer
// leaked to the page. Each method is a typed wrapper over one ipcMain.handle channel.

import { contextBridge, ipcRenderer } from "electron";

/**
 * The shell's `JOB_PROGRESS` channel, as a literal.
 *
 * NOT imported from `@wildwinter/app-shell/job`, and this is a hard rule rather than a preference:
 * this preload is SANDBOXED (`sandbox: true`), electron-vite auto-externalises everything in
 * `dependencies`, and a sandboxed preload cannot `require` out of node_modules. Importing it built
 * clean, typechecked clean, and then failed at runtime with "module not found" - which takes the
 * WHOLE bridge down, so `window.patter` is undefined and the app opens to the welcome screen with
 * every button dead.
 *
 * Bundling the shell into the preload instead would fix this one import and invite the next: the
 * shell's `app-store` reaches for `node:fs` and its `session` for `node:path`, neither of which has
 * any business in a sandboxed bridge. So the constraint stays "this file imports `electron` and
 * types, and nothing else", and `test/preload-imports.test.ts` enforces it.
 *
 * The value is pinned against the shell's own constant by that same test.
 */
const JOB_PROGRESS = "job:progress";
/** The shell's view port channel and window message (`@wildwinter/app-shell/view-protocol`), as literals. */
const VIEW_PORT_CHANNEL = "wildwinter-view:port";
const VIEW_PORT_MESSAGE = "wildwinter-view:port";
import type { PatterApi, PatterPlayApi, PatterSearchApi, PatterCoverageApi, PatterFieldsApi, FieldsWinState, PatterExtensionsApi, ExtensionsWinState, JobProgressDto, ThemePrefs, PlayChoiceOption, SearchEntry, SearchMode, OpenResult, UpdaterPromptOptions, UpdaterDownloadProgress, AppPrompt, ProjectStep, ViewOfferDto } from "../shared/api.js";

const api: PatterApi = {
  boot: () => ipcRenderer.invoke("project:boot"),
  appReady: () => ipcRenderer.send("app:ready"),
  hydrate: () => ipcRenderer.invoke("project:hydrate"),
  openDialog: () => ipcRenderer.invoke("project:openDialog"),
  saveAs: () => ipcRenderer.invoke("project:saveAs"),
  openPath: (path) => ipcRenderer.invoke("project:openPath", path),
  openExample: (file) => ipcRenderer.invoke("project:openExample", file),
  closeProject: () => ipcRenderer.invoke("project:close"),
  createDialog: (name, vcs, buildBundle) => ipcRenderer.invoke("project:createDialog", name, vcs, buildBundle),
  readScene: (sceneId) => ipcRenderer.invoke("scene:read", sceneId),
  saveScene: (sceneId, flow, loc, extensions) => ipcRenderer.invoke("scene:save", sceneId, flow, loc, extensions),
  vcStatus: () => ipcRenderer.invoke("project:vcStatus"),
  readDocs: (sceneId) => ipcRenderer.invoke("scene:readDocs", sceneId),
  saveDocs: (sceneId, map) => ipcRenderer.invoke("scene:saveDocs", sceneId, map),
  readComments: (sceneId) => ipcRenderer.invoke("scene:readComments", sceneId),
  saveComments: (sceneId, comments) => ipcRenderer.invoke("scene:saveComments", sceneId, comments),
  readWriting: (sceneId) => ipcRenderer.invoke("scene:readWriting", sceneId),
  saveWriting: (sceneId, map) => ipcRenderer.invoke("scene:saveWriting", sceneId, map),
  readRecording: (sceneId) => ipcRenderer.invoke("scene:readRecording", sceneId),
  saveRecording: (sceneId, map) => ipcRenderer.invoke("scene:saveRecording", sceneId, map),
  readRerecord: (sceneId) => ipcRenderer.invoke("scene:readRerecord", sceneId),
  saveRerecord: (sceneId, map) => ipcRenderer.invoke("scene:saveRerecord", sceneId, map),
  audioCurrent: () => ipcRenderer.invoke("audio:current"),
  onAudioIndex: (handler) => { ipcRenderer.on("audio:index", (_e, snap: Record<string, { status: string; path: string }>) => handler(snap)); },
  readAudio: (beatId) => ipcRenderer.invoke("audio:read", beatId),
  saveScratch: (beatId, bytes) => ipcRenderer.invoke("audio:saveScratch", beatId, bytes),
  micAccess: () => ipcRenderer.invoke("audio:micAccess"),
  setRecordingMode: (on) => { void ipcRenderer.invoke("recording:setMode", on); },
  debugStart: () => ipcRenderer.invoke("debug:start"),
  showInStoryletter: (sceneId) => ipcRenderer.invoke("storyletter:show", sceneId),
  debugStop: () => ipcRenderer.invoke("debug:stop"),
  debugStatus: () => ipcRenderer.invoke("debug:status"),
  debugFollow: (flowId) => { void ipcRenderer.invoke("debug:follow", flowId); },
  onDebugStatus: (handler) => { ipcRenderer.on("debug:status", (_e, status: import("../shared/api.js").DebugStatus) => handler(status)); },
  readSuggestions: (sceneId) => ipcRenderer.invoke("scene:readSuggestions", sceneId),
  saveSuggestions: (sceneId, suggestions) => ipcRenderer.invoke("scene:saveSuggestions", sceneId, suggestions),
  reviewFeedback: (scope) => ipcRenderer.invoke("review:feedback", scope),
  speakerPairs: () => ipcRenderer.invoke("project:speakerPairs"),
  listDictionaries: () => ipcRenderer.invoke("dict:list"),
  readDictionary: (id) => ipcRenderer.invoke("dict:read", id),
  importDictionary: () => ipcRenderer.invoke("dict:import"),
  removeDictionary: (id) => ipcRenderer.invoke("dict:remove", id),
  addDictionaryWord: (word) => ipcRenderer.invoke("dict:addWord", word),
  addIgnoreWord: (word) => ipcRenderer.invoke("dict:addIgnore", word),
  setDictionary: (patch) => ipcRenderer.invoke("dict:set", patch),
  report: () => ipcRenderer.invoke("project:report"),
  proposeCoverageDrivers: () => ipcRenderer.invoke("project:proposeCoverageDrivers"),
  exportReport: () => ipcRenderer.invoke("project:exportReport"),
  cancelJob: (kind) => { void ipcRenderer.invoke("job:cancel", kind); },
  onJobProgress: (handler) => { ipcRenderer.on(JOB_PROGRESS, (_e, p: JobProgressDto) => handler(p)); },
  recents: () => ipcRenderer.invoke("project:recents"),
  clearRecents: () => ipcRenderer.invoke("project:clearRecents"),
  buildBundle: (opts) => ipcRenderer.invoke("project:build", opts),
  toggleAutoRebuild: () => ipcRenderer.invoke("project:toggleAutoRebuild"),
  buildAudioManifest: () => ipcRenderer.invoke("project:audioManifest"),
  exportVoiceScript: (everything) => ipcRenderer.invoke("project:exportVoiceScript", everything),
  exportPlayableHtml: () => ipcRenderer.invoke("project:exportPlayableHtml"),
  exportWeb: () => ipcRenderer.invoke("project:exportWeb"),
  exportScript: () => ipcRenderer.invoke("project:exportScript"),
  editableLineCounts: (sceneId) => ipcRenderer.invoke("editable:lineCounts", sceneId),
  exportEditable: (opts) => ipcRenderer.invoke("editable:export", opts),
  pickEditableReturn: () => ipcRenderer.invoke("editable:pick"),
  planEditableImport: (path, opts) => ipcRenderer.invoke("editable:plan", path, opts),
  applyEditableImport: (planId) => ipcRenderer.invoke("editable:apply", planId),
  listSuggestions: (filter) => ipcRenderer.invoke("suggestions:list", filter),
  decideSuggestions: (decisions) => ipcRenderer.invoke("suggestions:decide", decisions),
  openHandoffs: () => ipcRenderer.invoke("handoffs:open"),
  exportPatterpack: () => ipcRenderer.invoke("patterpack:export"),
  openPatterpack: () => ipcRenderer.invoke("patterpack:open"),
  mergePatterpackPlan: () => ipcRenderer.invoke("patterpack:mergePlan"),
  mergePatterpackCommit: () => ipcRenderer.invoke("patterpack:mergeCommit"),
  mergePatterpackDrop: () => ipcRenderer.invoke("patterpack:mergeDrop"),
  shareScopes: () => ipcRenderer.invoke("project:shareScopes"),
  exportLoc: (request) => ipcRenderer.invoke("project:exportLoc", request),
  importLoc: (fallbackLocale) => ipcRenderer.invoke("project:importLoc", fallbackLocale),
  readSettings: () => ipcRenderer.invoke("project:readSettings"),
  saveSettings: (settings, undo) => ipcRenderer.invoke("project:saveSettings", settings, undo),
  projectUndo: (id) => ipcRenderer.invoke("project:undo", id),
  projectRedo: (id) => ipcRenderer.invoke("project:redo", id),
  projectClearRedo: () => ipcRenderer.invoke("project:clearRedo"),
  setUndoLabels: (labels) => ipcRenderer.invoke("project:undoLabels", labels),
  onProjectStep: (handler) => { ipcRenderer.on("project:step", (_e, step: ProjectStep) => handler(step)); },
  renameStages: (renames) => ipcRenderer.invoke("project:renameStages", renames),
  stageGates: (target) => ipcRenderer.invoke("project:stageGates", target),
  setStart: (start) => ipcRenderer.invoke("project:setStart", start),
  reorderScenes: (ids) => ipcRenderer.invoke("project:reorderScenes", ids),
  createScene: (name, kit, speaker) => ipcRenderer.invoke("project:createScene", name, kit, speaker),
  sceneDeleteInfo: (sceneId) => ipcRenderer.invoke("project:sceneDeleteInfo", sceneId),
  deleteScene: (sceneId) => ipcRenderer.invoke("project:deleteScene", sceneId),
  rememberScene: (projectPath, sceneId, caretId) => ipcRenderer.invoke("scene:remember", projectPath, sceneId, caretId),
  openPlay: (sceneId, blockId) => ipcRenderer.invoke("play:open", sceneId, blockId),
  resetWindows: () => ipcRenderer.invoke("view:resetWindows"),
  playEdited: (sceneId, flow, loc, extensions) => { void ipcRenderer.invoke("play:edited", sceneId, flow, loc, extensions); },
  onPlayMark: (handler) => { ipcRenderer.on("play:mark", (_e, id: string | null, sceneId?: string, optionId?: string) => handler(id, sceneId, optionId)); },
  onPlayFollow: (handler) => { ipcRenderer.on("play:follow", (_e, sceneId: string, beatId: string) => handler(sceneId, beatId)); },
  onPlayReset: (handler) => { ipcRenderer.on("play:reset", () => handler()); },
  validate: (live) => ipcRenderer.invoke("project:validate", live),
  openSearchWindow: (mode, focus, query) => ipcRenderer.invoke("search:open", mode, focus, query),
  onSearchNavigate: (handler) => { ipcRenderer.on("search:navigate", (_e, entry: SearchEntry) => handler(entry)); },
  // Project-wide Replace coordination: main asks the editor to flush its open scene before applying, and
  // tells it to reload after. (The Replace UI itself lives in the search window: see searchApi below.)
  onEditorFlush: (handler) => { ipcRenderer.on("editor:flush", () => handler()); },
  // Closing the window or quitting: main holds the close until the editor has written what it holds.
  onPrompt: (handler) => { ipcRenderer.on("app:prompt", (_e, id: number, prompt: AppPrompt) => { void handler(prompt).then((i) => ipcRenderer.invoke("app:promptReply", id, i)); }); },
  onFlushBeforeClose: (handler) => { ipcRenderer.on("app:flush-before-close", () => { void handler().finally(() => ipcRenderer.invoke("app:close-flushed")); }); },
  editorFlushed: () => { void ipcRenderer.invoke("editor:flushed"); },
  onReplaceApplied: (handler) => { ipcRenderer.on("replace:applied", (_e, announce?: boolean) => handler(announce === true)); },
  openCoverageWindow: () => ipcRenderer.invoke("coverage:open"),
  openFieldsWindow: () => ipcRenderer.invoke("fields:open"),
  sendFieldsState: (state) => { ipcRenderer.send("fields:state", state); },
  onFieldsCommit: (handler) => { ipcRenderer.on("fields:commit", (_e, id: string, extension: string, field: string, value: unknown) => handler(id, extension, field, value)); },
  onFieldsFollow: (handler) => { ipcRenderer.on("fields:follow", (_e, on: boolean) => handler(on)); },
  addExtension: (expect?: string) => ipcRenderer.invoke("extensions:add", expect),
  openExtensions: (focus?: string) => ipcRenderer.invoke("extensions:open", focus),
  removeExtension: (id: string) => ipcRenderer.invoke("extensions:remove", id),
  updateExtension: (id: string) => ipcRenderer.invoke("extensions:update", id),
  openView: (extension, view) => ipcRenderer.invoke("views:open", extension, view),
  onViewOffers: (handler) => { ipcRenderer.on("views:offers", (_e, offers: ViewOfferDto[]) => handler(offers)); },
  writeProjectExtension: (extension, entry, label) => ipcRenderer.invoke("extensions:writeProject", extension, entry, label),
  onCoverageNavigate: (handler) => { ipcRenderer.on("coverage:navigate", (_e, sceneId: string, beatId: string) => handler(sceneId, beatId)); },
  onOpenWorldSettings: (handler) => { ipcRenderer.on("coverage:open-world", () => handler()); },
  applyFix: (fix) => ipcRenderer.invoke("project:applyFix", fix),
  getIdentity: () => ipcRenderer.invoke("identity:get"),
  suggestIdentity: () => ipcRenderer.invoke("identity:suggest"),
  setIdentity: (identity) => ipcRenderer.invoke("identity:set", identity),
  setPanes: (panes) => ipcRenderer.invoke("panes:set", panes),
  setTheme: (theme) => ipcRenderer.invoke("theme:set", theme),
  openExternal: (url) => { void ipcRenderer.invoke("app:openExternal", url); },
  revealProject: () => { void ipcRenderer.invoke("app:revealProject"); },
  onMenu: (handler) => { ipcRenderer.on("menu", (_e, cmd: string) => handler(cmd)); },
  onOpenProject: (handler) => { ipcRenderer.on("project:open", (_e, result: OpenResult) => handler(result)); },
  onUpdaterCheckDirty: (handler) => { ipcRenderer.on("updater:check-dirty", () => ipcRenderer.send("updater:dirty-reply", handler())); },
  onUpdaterSaveBeforeInstall: (handler) => { ipcRenderer.on("updater:save-before-install", () => { void handler().then((r) => ipcRenderer.send("updater:save-done", r)); }); },
  onUpdaterPrompt: (handler) => { ipcRenderer.on("updater:prompt", (_e, opts: UpdaterPromptOptions) => { void handler(opts).then((idx) => ipcRenderer.send("updater:prompt-reply", idx)); }); },
  onUpdaterDownloadProgress: (handler) => { ipcRenderer.on("updater:download-progress", (_e, p: UpdaterDownloadProgress) => handler(p)); },
};

// The play window's bridge (drives the interactive walk + the editor step-marker).
const playApi: PatterPlayApi = {
  start: () => ipcRenderer.invoke("play:start"),
  step: () => ipcRenderer.invoke("play:step"),
  toStop: () => ipcRenderer.invoke("play:toStop"),
  choose: (optionId) => ipcRenderer.invoke("play:choose", optionId),
  mark: (beatId, sceneId) => { void ipcRenderer.invoke("play:markAt", beatId, sceneId); },
  resetMarks: () => { void ipcRenderer.invoke("play:resetMarks"); },
  onRestart: (handler) => { ipcRenderer.on("play:restart", () => handler()); },
  info: () => ipcRenderer.invoke("play:info"),
  audioBytes: (beatId) => ipcRenderer.invoke("audio:read", beatId),
  setPin: (on) => { void ipcRenderer.invoke("play:setPin", on); },
  setLocale: (locale) => ipcRenderer.invoke("play:setLocale", locale),
  setClosedCaptions: (on) => ipcRenderer.invoke("play:setCaptions", on),
  onStale: (handler) => { ipcRenderer.on("play:stale", () => handler()); },
  onRefreshed: (handler) => { ipcRenderer.on("play:refreshed", (_e, kind: "text" | "structure", options: PlayChoiceOption[]) => handler(kind, options)); },
  // The shell's tool-window table re-pins every helper on Reset View and says so on ONE channel.
  onPin: (handler) => { ipcRenderer.on("state:pinned", (_e, on: boolean) => handler(on)); },
  close: () => { void ipcRenderer.invoke("play:close"); },
  onProject: (handler) => { ipcRenderer.on("play:project", () => handler()); },
  setFollow: (on) => { void ipcRenderer.invoke("play:setFollow", on); },
  onTheme: (handler) => { ipcRenderer.on("theme:changed", (_e, t: ThemePrefs) => handler(t)); },
};

// The detached search window's bridge (queries the project-wide index + drives the editor's jump).
const searchApi: PatterSearchApi = {
  info: () => ipcRenderer.invoke("searchWin:info"),
  search: (query) => ipcRenderer.invoke("searchWin:query", query),
  linesByStatus: (status, recording) => ipcRenderer.invoke("searchWin:byStatus", status, recording),
  propertyUsage: (query) => ipcRenderer.invoke("searchWin:byProperty", query),
  fieldUsage: (query) => ipcRenderer.invoke("searchWin:byField", query),
  fields: () => ipcRenderer.invoke("searchWin:fields"),
  tagUsage: (tag) => ipcRenderer.invoke("searchWin:byTag", tag),
  tags: () => ipcRenderer.invoke("searchWin:tags"),
  linesByQualifier: (gameId) => ipcRenderer.invoke("searchWin:byQualifier", gameId),
  qualifiers: () => ipcRenderer.invoke("searchWin:qualifiers"),
  statuses: (recording) => ipcRenderer.invoke("searchWin:statuses", recording),
  suggestions: (filter) => ipcRenderer.invoke("searchWin:suggestions", filter),
  handoffs: () => ipcRenderer.invoke("searchWin:handoffs"),
  decideSuggestions: (decisions) => ipcRenderer.invoke("searchWin:decide", decisions),
  replacePreview: (opts) => ipcRenderer.invoke("searchWin:replacePreview", opts),
  replaceApply: (opts) => ipcRenderer.invoke("searchWin:replaceApply", opts),
  jump: (entry) => { void ipcRenderer.invoke("searchWin:jump", entry); },
  setPin: (on) => { void ipcRenderer.invoke("searchWin:setPin", on); },
  close: () => { void ipcRenderer.invoke("searchWin:close"); },
  onMode: (handler) => { ipcRenderer.on("searchWin:mode", (_e, mode: SearchMode) => handler(mode)); },
  onSeed: (handler) => { ipcRenderer.on("searchWin:seed", (_e, query: string) => handler(query)); },
  onProject: (handler) => { ipcRenderer.on("searchWin:project", () => handler()); },
  onPin: (handler) => { ipcRenderer.on("state:pinned", (_e, on: boolean) => handler(on)); },
  onTheme: (handler) => { ipcRenderer.on("theme:changed", (_e, t: ThemePrefs) => handler(t)); },
};

// The detached coverage window's bridge (runs coverage in main; drives the editor's jump + External Properties tab).
const coverageApi: PatterCoverageApi = {
  info: () => ipcRenderer.invoke("covWin:info"),
  run: (options) => ipcRenderer.invoke("covWin:run", options),
  cancel: () => { void ipcRenderer.invoke("covWin:cancel"); },
  onProgress: (handler) => { ipcRenderer.on(JOB_PROGRESS, (_e, p: JobProgressDto) => handler(p)); },
  reveal: (sceneId, beatId) => { void ipcRenderer.invoke("covWin:reveal", sceneId, beatId); },
  openWorld: () => { void ipcRenderer.invoke("covWin:openWorld"); },
  findUsage: (ref) => { void ipcRenderer.invoke("covWin:findUsage", ref); },
  setPin: (on) => { void ipcRenderer.invoke("covWin:setPin", on); },
  close: () => { void ipcRenderer.invoke("covWin:close"); },
  onProject: (handler) => { ipcRenderer.on("covWin:project", () => handler()); },
  onPin: (handler) => { ipcRenderer.on("state:pinned", (_e, on: boolean) => handler(on)); },
  onTheme: (handler) => { ipcRenderer.on("theme:changed", (_e, t: ThemePrefs) => handler(t)); },
};

// The detached fields window's bridge: a map of records as a grid, every edit applied by the editor.
const fieldsApi: PatterFieldsApi = {
  info: () => ipcRenderer.invoke("fieldsWin:info"),
  commit: (id, extension, field, value) => { void ipcRenderer.invoke("fieldsWin:commit", id, extension, field, value); },
  setFollow: (on) => { void ipcRenderer.invoke("fieldsWin:setFollow", on); },
  setPin: (on) => { void ipcRenderer.invoke("fieldsWin:setPin", on); },
  close: () => { void ipcRenderer.invoke("fieldsWin:close"); },
  onState: (handler) => { ipcRenderer.on("fieldsWin:state", (_e, state: FieldsWinState) => handler(state)); },
  onProject: (handler) => { ipcRenderer.on("fieldsWin:project", () => handler()); },
  onPin: (handler) => { ipcRenderer.on("state:pinned", (_e, on: boolean) => handler(on)); },
  onTheme: (handler) => { ipcRenderer.on("theme:changed", (_e, t: ThemePrefs) => handler(t)); },
};

// The Extensions window's bridge: Add, Install and Remove go to the editor (where undo lives), Uninstall to main.
const extensionsApi: PatterExtensionsApi = {
  info: () => ipcRenderer.invoke("extWin:info"),
  add: () => { void ipcRenderer.invoke("extWin:add"); },
  install: (id) => { void ipcRenderer.invoke("extWin:install", id); },
  remove: (id) => { void ipcRenderer.invoke("extWin:remove", id); },
  uninstall: (id, version) => { void ipcRenderer.invoke("extWin:uninstall", id, version); },
  update: (id) => { void ipcRenderer.invoke("extWin:update", id); },
  setPin: (on) => { void ipcRenderer.invoke("extWin:setPin", on); },
  close: () => { void ipcRenderer.invoke("extWin:close"); },
  onState: (handler) => { ipcRenderer.on("extWin:state", (_e, state: ExtensionsWinState) => handler(state)); },
  onProject: (handler) => { ipcRenderer.on("extWin:project", () => handler()); },
  onPin: (handler) => { ipcRenderer.on("state:pinned", (_e, on: boolean) => handler(on)); },
  onTheme: (handler) => { ipcRenderer.on("theme:changed", (_e, t: ThemePrefs) => handler(t)); },
};

// Each window gets ITS bridge and no other. The four windows share this one preload, and every bridge was
// exposed to every window, so the play, search, and coverage windows could also call the editor's whole
// API (removing a dictionary, saving a scratch take). Which window this is comes from the page it loaded.
const page = (() => { try { return new URL(location.href).pathname; } catch { return ""; } })();
const tool = /\/(play|search|coverage|fields|extensions)\/index\.html$/.exec(page)?.[1];
if (tool === "play") contextBridge.exposeInMainWorld("patterPlay", playApi);
else if (tool === "search") contextBridge.exposeInMainWorld("patterSearch", searchApi);
else if (tool === "coverage") contextBridge.exposeInMainWorld("patterCoverage", coverageApi);
else if (tool === "fields") contextBridge.exposeInMainWorld("patterFields", fieldsApi);
else if (tool === "extensions") contextBridge.exposeInMainWorld("patterExtensions", extensionsApi);
else {
  contextBridge.exposeInMainWorld("patter", api);
  // Tier 2 view extensions (app-shell README v0.58): main hands the editor one end of each view window's
  // port, which page code can't take from ipcRenderer, so it's posted on to the page with its meta. The two
  // names are the shell's VIEW_PORT_CHANNEL and VIEW_PORT_MESSAGE, as literals: a sandboxed preload imports
  // electron alone (test/preload-imports.test.ts pins them against the shell's).
  ipcRenderer.on(VIEW_PORT_CHANNEL, (event, meta: unknown) => {
    window.postMessage({ type: VIEW_PORT_MESSAGE, meta }, "*", event.ports);
  });
}
