// The Patterpad renderer (untrusted UI). It drives the M0 flow entirely through the window.patter
// bridge: first-run identity, a welcome screen (open / new / recents / the example), and the project
// workspace - embed the surface, switch scenes (remembering the last), save (lock-aware in main), play.
// No Node, no fs here.

import "@patterkit/patterpad-surface/theme.css"; // app-wide design tokens
import "@patterkit/patterpad-surface/styles.css"; // surface component styles
import "@wildwinter/expr-editor/styles.css"; // the visual condition editor
import "./shell.css"; // app shell layout, over the surface's page styles
import "@fontsource/newsreader/400.css";
import "@fontsource/newsreader/400-italic.css";
import "@fontsource/newsreader/600.css";
import "@fontsource/newsreader/700.css";
import "@fontsource-variable/inter";
import "@fontsource/ibm-plex-mono/400.css";

import { mountSurface, initTooltips, tipBold, type SurfaceHandle, type InspectorContext, type DocNote, type CommentOpenRequest, type SuggestionOpenRequest, type SpellChecker } from "@patterkit/patterpad-surface/surface";
import { buildSpellEngine } from "./spellcheck.js";
import { closeWithExit } from "@patterkit/patterpad-surface/exit";
import { showUpdaterDialog } from "./updater-dialog.js";
import type { BootState, ColourTheme, ConditionProperty, FontTheme, Identity, OpenResult, OpenedProject, PaneState, Problem, ProblemsDto, ProjectSettingsDto, RecentProject, ReportData, ReviewItem, SceneVcStatus, ThemePrefs, VcsKind } from "../../shared/api.js";
import { renderInspector } from "./inspector.js";
import { openConditionEditor, closeConditionEditor, renderConditionPills } from "./cond-editor.js";
import { openEffectsEditor, closeEffectsEditor, renderEffectsPills } from "./effects-editor.js";
import { openGameIdEditor, closeGameIdEditor } from "./id-editor.js";
import { mountGameDataFields } from "./gamedata-fields.js";
import { mountProperties } from "./settings-properties.js";
import { mountCast } from "./settings-cast.js";
import { mountWorld } from "./settings-world.js";
import { mountWritingStatus, mountAudio } from "./settings-status.js";
import { mountEstimating } from "./settings-estimating.js";
import { mountDictionary } from "./settings-dictionary.js";
import { mountLanguages } from "./settings-languages.js";
import { renderReport } from "./report-view.js";
import { mountDocEditor } from "./doc-editor.js";
import { openCommentThread } from "./comments-popover.js";
import { openSuggestionCompose, openSuggestionReview, type SuggestionRow } from "./suggestion-popover.js";
import type { PropertyDecl, DocLine, Comment, Suggestion } from "@patterkit/model";
import { DEFAULT_DOCUMENTATION_CLASSES } from "@patterkit/model";
import { openJumpPicker, closeJumpPicker } from "./jump-picker.js";
import type { SearchEntry, AudioEntry } from "../../shared/api.js";
import { recordScratch, isScratchRecording } from "./scratch-recorder.js";
import { textHash } from "./wav.js";
import { mountDebugLink } from "./debug-panel.js";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const panesEl = $("panes");
const welcomeEl = $("welcome");
const editorEl = $("editor");
const navEl = $("nav");
const inspectorEl = $("inspector");
const navListEl = $("nav-list");
const toggleNavEl = $<HTMLButtonElement>("toggle-nav");
const toggleInspectorEl = $<HTMLButtonElement>("toggle-inspector");
const hintbarEl = $("hintbar");
const inspectorStackEl = $("inspector-stack");
// Conditions / effects always render as pills in the inspector. (The old View > "Expressions as Text"
// toggle, which swapped them for name-form code, has been removed.)
const preferText = false;
let lastInspectorCtx: InspectorContext | null = null;
let lastInspectorSig: string | null = null; // signature of the last-rendered inspector (skip identical rebuilds)

/** View > Notes: toggle whether a documentation-note class surfaces in the editor; remember it + re-surface. */
function toggleDocClass(cls: string): void {
  if (cls === "everyone") return; // always shown
  if (docHidden.has(cls)) docHidden.delete(cls); else docHidden.add(cls);
  panes = { ...panes, docHidden: [...docHidden] };
  void window.patter.setPanes(panes); // remember it (also refreshes the View-menu checks)
  pushDocNotes();                      // re-surface with the new filter
}
const problembarEl = $("problembar");
const problemCountEl = $("problem-count");
const problemCatEl = $("problem-cat");
const problemMsgEl = $("problem-msg");
const problemCurEl = $<HTMLButtonElement>("problem-cur");
const problemPrevEl = $<HTMLButtonElement>("problem-prev");
const problemNextEl = $<HTMLButtonElement>("problem-next");
const problemFixEl = $<HTMLButtonElement>("problem-fix");
const reviewbarEl = $("reviewbar");
const reviewCountEl = $("review-count");
const reviewKindEl = $("review-kind");
const reviewMsgEl = $("review-msg");
const reviewCurEl = $<HTMLButtonElement>("review-cur");
const reviewPrevEl = $<HTMLButtonElement>("review-prev");
const reviewNextEl = $<HTMLButtonElement>("review-next");
const reviewCloseEl = $<HTMLButtonElement>("review-close");
const projectNameEl = $("project-name");
const sceneSuffixEl = $("scene-suffix");
const dirtyEl = $("dirty");
const vcsSceneEl = $("vcs-scene"); // topbar chip: the CURRENT scene's VC state (locked / out-of-date)
const toastEl = $("toast");        // transient feedback (a save refused by the VCS)
const writingExitEl = $<HTMLButtonElement>("writing-exit"); // Writing View's bottom-left exit pill
const recentsEl = $("recents");
const recentsLabel = $("recents-label");
const overviewEl = $("overview"); // the project-overview landing (#3a)
const overviewTitleEl = $("overview-title");
const overviewStatsEl = $("overview-stats");
const overviewProgressEl = $("overview-progress");
const overviewBarFillEl = $("overview-bar-fill");
const overviewProgressLabelEl = $("overview-progress-label");
const overviewScenesEl = $("overview-scenes");
const identityDialog = $<HTMLDialogElement>("identity");
const nameInput = $<HTMLInputElement>("identity-name");
const emailInput = $<HTMLInputElement>("identity-email");
const createDialogEl = $<HTMLDialogElement>("create-project");
const createNameInput = $<HTMLInputElement>("create-name");
const createVcsSel = $<HTMLSelectElement>("create-vcs");
const createBuildInput = $<HTMLInputElement>("create-build");
const createPreviewEl = $("create-preview-name");
$<HTMLButtonElement>("create-cancel").addEventListener("click", () => createDialogEl.close("cancel"));
const settingsDialogEl = $<HTMLDialogElement>("project-settings");
const setNameInput = $<HTMLInputElement>("set-name");
const setStartSel = $<HTMLSelectElement>("set-start");
const setVcsSel = $<HTMLSelectElement>("set-vcs");
const setVoicedInput = $<HTMLInputElement>("set-voiced");
const setFormattingInput = $<HTMLInputElement>("set-formatting");
const setAutosaveInput = $<HTMLInputElement>("set-autosave");
const setAutoRebuildInput = $<HTMLInputElement>("set-autorebuild");
const setCcOpenInput = $<HTMLInputElement>("set-cc-open");
const setCcCloseInput = $<HTMLInputElement>("set-cc-close");
const setCcCharacterInput = $<HTMLInputElement>("set-cc-character");
const ccDelimWarn = $<HTMLElement>("cc-delim-warn");
// Guardrail (#214): "(" at a line start opens a performance direction in the surface, so it can't also be
// a caption start. Warn when the author picks it (round brackets stay allowed, e.g. for mid-line cues).
const syncCcDelimWarn = (): void => { ccDelimWarn.hidden = setCcOpenInput.value.trim() !== "("; };
setCcOpenInput.addEventListener("input", syncCcDelimWarn);
const setBuildInput = $<HTMLInputElement>("set-build");
const setBuildLocalesSel = $<HTMLSelectElement>("set-build-locales");
const setBuildSourceDebug = $<HTMLInputElement>("set-build-sourcedebug");
const setBuildSourceDebugRow = $("set-build-sourcedebug-row");
// The source-debug toggle only applies to an IDs-only build; show it only then.
const syncBuildLocaleRows = (): void => { setBuildSourceDebugRow.hidden = setBuildLocalesSel.value !== "ids"; };
setBuildLocalesSel.addEventListener("change", syncBuildLocaleRows);
const setLanguagesHost = $("set-languages");
const setGameDataHost = $("set-gamedata");
const setPropsHost = $("set-properties");
const setWorldHost = $("set-world");
const setCastHost = $("set-cast");
const setWritingStatusHost = $("set-writing-status");
const setEstimatingHost = $("set-estimating");
const setRecordingStatusHost = $("set-recording-status");
const debugLink = mountDebugLink(); // live debug link control (#181): the bottom-right connect icon
const setDictionaryHost = $("set-dictionary");
$<HTMLButtonElement>("set-cancel").addEventListener("click", () => settingsDialogEl.close("cancel"));
const scenePropsDialogEl = $<HTMLDialogElement>("scene-props");
const spHost = $("sp-host");
$<HTMLButtonElement>("sp-cancel").addEventListener("click", () => scenePropsDialogEl.close("cancel"));
const reportDialogEl = $<HTMLDialogElement>("report");
const reportHost = $("report-host");
// The report body overflows its 70vh cap on most projects; keep the wrapper's edge scrims + "More
// below" pill in sync with where the scroll actually is (see .report-scroll in shell.css).
const reportScroll = $("report-scroll");
const reportMoreBtn = $<HTMLButtonElement>("report-more");
const updateReportScrollHints = (): void => {
  reportScroll.classList.toggle("has-below", reportHost.scrollHeight - reportHost.clientHeight - reportHost.scrollTop > 4);
  reportScroll.classList.toggle("has-above", reportHost.scrollTop > 4);
};
reportHost.addEventListener("scroll", updateReportScrollHints);
new ResizeObserver(updateReportScrollHints).observe(reportHost); // window resizes move the 70vh cap
reportMoreBtn.addEventListener("click", () => reportHost.scrollBy({ top: reportHost.clientHeight * 0.8, behavior: "smooth" }));
$<HTMLButtonElement>("report-close").addEventListener("click", () => reportDialogEl.close("done"));
const reportExportBtn = $<HTMLButtonElement>("report-export");
reportExportBtn.addEventListener("click", () => void exportProductionInfo(reportExportBtn));
// Set-start prompt (#159): raised by Play from Start / Coverage when the project has no start point.
const startPromptDialog = $<HTMLDialogElement>("set-start-prompt");
const startPromptSel = $<HTMLSelectElement>("start-prompt-scene");

/** Resolve the project's start point, prompting (and persisting) when it is unset. Returns the start, or
 *  null if the author cancelled / there are no scenes. */
async function ensureProjectStart(): Promise<{ scene: string; block?: string } | null> {
  if (!project) return null;
  const s = await window.patter.readSettings();
  if (s?.start?.scene) return s.start;
  if (!project.scenes.length) return null;
  startPromptSel.replaceChildren();
  for (const sc of project.scenes) startPromptSel.append(new Option(sc.name, sc.id));
  const chosen = await new Promise<string | null>((resolve) => {
    const onClose = (): void => {
      startPromptDialog.removeEventListener("close", onClose);
      resolve(startPromptDialog.returnValue === "set" ? (startPromptSel.value || null) : null);
    };
    startPromptDialog.addEventListener("close", onClose);
    startPromptDialog.showModal();
  });
  if (!chosen) return null;
  const res = await window.patter.setStart({ scene: chosen });
  if (res.project) project = res.project;
  return { scene: chosen };
}
const locDialogEl = $<HTMLDialogElement>("loc");
const locFormatSel = $<HTMLSelectElement>("loc-format");
const locLocaleSel = $<HTMLSelectElement>("loc-locale");
const locStatus = $("loc-status");
$<HTMLButtonElement>("loc-close").addEventListener("click", () => locDialogEl.close("done"));
$<HTMLButtonElement>("loc-export").addEventListener("click", () => void localisationExport());
$<HTMLButtonElement>("loc-import").addEventListener("click", () => void localisationImport());
// (Export / Import Localisation lives on the File menu, not duplicated in the Language settings tab.)
const voDialogEl = $<HTMLDialogElement>("vo-export");
const voEverythingInput = $<HTMLInputElement>("vo-everything");
const voStatus = $("vo-status");
$<HTMLButtonElement>("vo-cancel").addEventListener("click", () => voDialogEl.close("cancel"));
$<HTMLButtonElement>("vo-export-btn").addEventListener("click", () => void voiceScriptExport());
const docDialogEl = $<HTMLDialogElement>("doc-notes");
const docHost = $("doc-host");
$<HTMLButtonElement>("doc-close").addEventListener("click", () => docDialogEl.close("done"));
// Left category tab rail: clicking a tab shows its panel (General / Game Data / …).
$("settings-tabs").addEventListener("click", (e) => {
  const tab = (e.target as HTMLElement).closest<HTMLElement>(".settings-tab");
  if (!tab || tab.classList.contains("is-disabled")) return; // a disabled tab (e.g. Audio when un-voiced) is inert
  const name = tab.dataset["tab"];
  for (const t of settingsDialogEl.querySelectorAll<HTMLElement>(".settings-tab")) t.classList.toggle("active", t === tab);
  for (const p of settingsDialogEl.querySelectorAll<HTMLElement>(".settings-panel")) p.hidden = p.dataset["panel"] !== name;
});

// Audio is meaningful only for a VOICED project (#206): when Voiced is off the Audio settings tab is
// disabled (dimmed, inert) - there is no recording status to track, and Audio Folders / scratch make no
// sense. Reactive to the in-dialog Voiced toggle so flipping it updates the tab without reopening.
function syncAudioSettingsTab(): void {
  const tab = settingsDialogEl.querySelector<HTMLElement>('.settings-tab[data-tab="recording-status"]');
  if (!tab) return;
  const on = setVoicedInput.checked;
  tab.classList.toggle("is-disabled", !on);
  tab.dataset.tip = on ? "" : "Enable Voiced (General tab) to track recording status and audio.";
  if (!on && tab.classList.contains("active")) { // showing the Audio panel as we disable it -> fall back to General
    for (const t of settingsDialogEl.querySelectorAll<HTMLElement>(".settings-tab")) t.classList.toggle("active", t.dataset["tab"] === "general");
    for (const p of settingsDialogEl.querySelectorAll<HTMLElement>(".settings-panel")) p.hidden = p.dataset["panel"] !== "general";
  }
}
setVoicedInput.addEventListener("change", syncAudioSettingsTab);

let project: OpenedProject | null = null;
let currentSceneId: string | null = null;
let surface: SurfaceHandle | null = null;

// The live spell-check engine (#177), built per project from the active dictionary + project words + cast.
// Cached here so each scene mount can re-push it to the new surface instance without a rebuild.
let spellChecker: SpellChecker | null = null;

// Languages we've already warned aren't installed (a custom dictionary the project chose but this machine
// lacks) - so the notice shows once per session, not on every scene / settings save.
const dictMissingNotified = new Set<string>();

/** (Re)build the spell engine from the project's dictionary setup + cast, then push it to the surface.
 *  Null (no squiggles) when spell-check is off or the chosen dictionary isn't installed on this machine. */
async function buildSpellcheck(): Promise<void> {
  spellChecker = null;
  const d = project?.dictionary;
  if (d?.enabled) {
    const bytes = await window.patter.readDictionary(d.language);
    if (bytes) spellChecker = buildSpellEngine(bytes.aff, bytes.dic, [...d.words, ...(d.ignore ?? []), ...(project?.cast ?? [])]);
    else if (!dictMissingNotified.has(d.language)) { // a chosen custom dictionary isn't installed here
      dictMissingNotified.add(d.language);
      toast(`Spell-check is off: the “${d.language}” dictionary isn't installed on this computer.`, "info");
    }
  }
  surface?.setSpellChecker(spellChecker);
}

/** Add a word to the project dictionary (the surface's "Add to dictionary"), then rebuild + re-validate so
 *  the squiggle and the problems-panel entry clear. */
async function addWordToDictionary(word: string): Promise<void> {
  const res = await window.patter.addDictionaryWord(word);
  if (res.ok && res.words && project) { project.dictionary.words = res.words; await buildSpellcheck(); void refreshProblems(); }
}

/** Ignore a word (the surface's "Ignore") - persist it to the project ignore list, then rebuild + re-validate
 *  so the squiggle clears AND the problems-bar entry drops out (#177). */
async function ignoreWord(word: string): Promise<void> {
  const res = await window.patter.addIgnoreWord(word);
  if (res.ok && res.ignore && project) { project.dictionary.ignore = res.ignore; await buildSpellcheck(); void refreshProblems(); }
}

/** Review ▸ Spelling: flip spell-check on/off or switch the active dictionary, then rebuild + re-validate.
 *  The main process persists it and rebuilds the menu (so the check / tick updates). */
async function setDictionaryFromMenu(patch: { enabled?: boolean; language?: string }): Promise<void> {
  const res = await window.patter.setDictionary(patch);
  if (res.ok && res.dictionary && project) { project.dictionary = res.dictionary; await buildSpellcheck(); void refreshProblems(); }
}
// mountSurface fires onChange once on mount (the initial mirror of the source). That is NOT a user
// edit, so it must not dirty the scene or tell a running play session the scene "changed" (which would
// pop a false "Scene changed in the editor" - e.g. when play crosses scenes and the editor reloads one).
let mountingScene = false;
// Has the user edited the open scene since it loaded? Gates playEdited so a programmatic (re)load -
// like following a cross-scene jump - never reads as an edit.
let sceneEdited = false;
let dirty = false;
// Autosave: the open project's setting (default on, from ProjectFile.autosave). A single interval (boot)
// fires save() when this is on; save() self-guards on dirty / no-scene, so an idle tick is a no-op.
let autosaveOn = true;
const AUTOSAVE_MS = 30_000;

// Open-where-you-left-off, to the LINE: the node id the caret is on, persisted (debounced) alongside the
// scene so a reopen can reveal it. Captured on every selection move; flushed on a short timer and before
// the window closes (so closing mid-debounce still records it).
let caretNodeId: string | null = null;
let rememberTimer: number | null = null;
function flushRemember(): void {
  if (rememberTimer != null) { window.clearTimeout(rememberTimer); rememberTimer = null; }
  if (project && currentSceneId) void window.patter.rememberScene(project.root, currentSceneId, caretNodeId ?? undefined);
}
function scheduleRemember(): void {
  if (rememberTimer != null) window.clearTimeout(rememberTimer);
  rememberTimer = window.setTimeout(flushRemember, 1000);
}

function setDirty(on: boolean): void { dirty = on; dirtyEl.hidden = !on; }

// --- the project workspace ---------------------------------------------------

/** Mark the current scene: `.active` on its row, and `.open` on its container so its block list
 *  reveals while the previously open scene's list closes (both ease - no pops). */
function highlightNav(id: string): void {
  navListEl.querySelectorAll<HTMLElement>(".nav-item").forEach((el) => el.classList.toggle("active", el.dataset["id"] === id));
  navListEl.querySelectorAll<HTMLElement>(".nav-scene").forEach((el) => el.classList.toggle("open", el.dataset["id"] === id));
  refreshNavBlocks();
}

/** Mark the block the caret sits in (`.active` on its sub-row); null clears (caret at scene level). */
function highlightNavBlock(blockId: string | null): void {
  navListEl.querySelectorAll<HTMLElement>(".nav-block").forEach((el) => {
    const on = el.dataset["id"] === blockId;
    el.classList.toggle("active", on);
    if (on) el.scrollIntoView({ block: "nearest" });
  });
}

/** The current scene's nav sub-list, rebuilt from the LIVE doc (unsaved block adds / renames show
 *  immediately). Signature-guarded: onChange fires per keystroke, the DOM only rebuilds on a real
 *  block-list change. Clicking a row drops the caret on that block (centred), like the search jumps. */
let navBlocksSig = "";
function refreshNavBlocks(force = false): void {
  const holder = navListEl.querySelector<HTMLElement>(`.nav-scene[data-id="${CSS.escape(currentSceneId ?? "")}"] .nav-blocks-inner`);
  if (!holder) return;
  const blocks = surface?.blockList() ?? project?.scenes.find((s) => s.id === currentSceneId)?.blocks.map((b) => ({ id: b.id, label: b.name })) ?? [];
  const sig = `${currentSceneId}|${blocks.map((b) => `${b.id} ${b.label}`).join("; ")}`;
  if (!force && sig === navBlocksSig) return;
  navBlocksSig = sig;
  const active = holder.querySelector<HTMLElement>(".nav-block.active")?.dataset["id"];
  holder.replaceChildren();
  for (const blk of blocks) {
    const b = document.createElement("button");
    b.className = "nav-block"; b.type = "button"; b.dataset["id"] = blk.id;
    if (blk.id === active) b.classList.add("active");
    b.append(Object.assign(document.createElement("span"), { className: "nav-item-name", textContent: blk.label }));
    b.addEventListener("click", () => { surface?.revealNode(blk.id); surface?.focus(); });
    holder.appendChild(b);
  }
}

function renderNav(): void {
  navListEl.replaceChildren();
  navBlocksSig = ""; // fresh rows: force the next block refresh to fill them
  const search = document.createElement("button");
  search.className = "nav-search"; search.type = "button"; search.dataset.tip = "search by name, handle, or id"; search.setAttribute("aria-label", "search by name, handle, or id");
  // A magnifier icon + centred, bold label read as a BUTTON that opens the search window - not a text field.
  const searchIcon = document.createElement("span"); searchIcon.className = "nav-search-icon";
  searchIcon.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20.5 20.5 16 16"/></svg>';
  search.append(searchIcon);
  search.append(Object.assign(document.createElement("span"), { textContent: "Search…" }));
  search.append(Object.assign(document.createElement("kbd"), { className: "nav-search-kbd", textContent: "⌘F" }));
  search.addEventListener("click", () => openSearch());
  navListEl.appendChild(search);
  for (const s of project?.scenes ?? []) {
    const row = document.createElement("div");
    row.className = "nav-scene"; row.dataset["id"] = s.id;
    const b = document.createElement("button");
    b.className = "nav-item"; b.type = "button"; b.dataset["id"] = s.id;
    b.append(Object.assign(document.createElement("span"), { className: "nav-item-name", textContent: s.name }));
    b.addEventListener("click", () => void loadScene(s.id));
    b.addEventListener("contextmenu", (e) => { e.preventDefault(); sceneContextMenu(s.id, e.clientX, e.clientY); });
    row.appendChild(b);
    // The block sub-list: rendered for every scene (rows fill lazily), revealed only while `.open`.
    const blocks = document.createElement("div");
    blocks.className = "nav-blocks";
    blocks.appendChild(Object.assign(document.createElement("div"), { className: "nav-blocks-inner" }));
    row.appendChild(blocks);
    wireSceneDrag(row);
    navListEl.appendChild(row);
  }
  // The quiet foot of the list: add a scene right where scenes live.
  const add = document.createElement("button");
  add.className = "nav-add-scene"; add.type = "button";
  add.append(Object.assign(document.createElement("span"), { textContent: "+ New Scene" }));
  add.addEventListener("click", () => newScenePrompt());
  navListEl.appendChild(add);
  paintNavBadges(); // re-apply VC badges after a list rebuild
  if (currentSceneId) highlightNav(currentSceneId);
}

// --- new scene (File > New Scene… / the nav's + row) --------------------------

const newSceneDialogEl = $<HTMLDialogElement>("new-scene");
const newSceneNameEl = $<HTMLInputElement>("new-scene-name");
$<HTMLButtonElement>("new-scene-cancel").addEventListener("click", () => newSceneDialogEl.close("cancel"));

/** Name a new scene, scaffold it (main writes the shards, lock-aware), and open it to write. */
function newScenePrompt(): void {
  if (!project) return;
  newSceneNameEl.value = "";
  const onClose = (): void => {
    newSceneDialogEl.removeEventListener("close", onClose);
    if (newSceneDialogEl.returnValue !== "create") return;
    void (async () => {
      const res = await window.patter.createScene(newSceneNameEl.value);
      if (!res.ok || !res.project || !res.sceneId) return;
      project = res.project;
      renderNav();
      await loadScene(res.sceneId);
    })();
  };
  newSceneDialogEl.addEventListener("close", onClose);
  newSceneDialogEl.showModal();
  newSceneNameEl.focus();
}

// --- delete scene (File > Delete Scene… / right-click a nav row) --------------
// Severity scales with the evidence (design/proposals/delete-scene.md): an untouched scaffold
// deletes silently; content asks; inbound references list the referring scenes BY NAME.

const deleteSceneDialogEl = $<HTMLDialogElement>("delete-scene");
const delSceneTitleEl = $("del-scene-title");
const delSceneMsgEl = $("del-scene-msg");
const delSceneRefsEl = $("del-scene-refs");
const delSceneWarnEl = $("del-scene-warn");
const delSceneConfirmEl = $<HTMLButtonElement>("del-scene-confirm");
$<HTMLButtonElement>("del-scene-cancel").addEventListener("click", () => deleteSceneDialogEl.close("cancel"));

async function deleteScenePrompt(sceneId?: string): Promise<void> {
  const id = sceneId ?? currentSceneId;
  if (!project || !id) return;
  const scene = project.scenes.find((s) => s.id === id);
  const info = await window.patter.sceneDeleteInfo(id);
  if (!scene || !info) return;
  if (info.lastScene) {
    delSceneTitleEl.textContent = "Can't delete this scene";
    delSceneMsgEl.textContent = "A project needs at least one scene.";
    delSceneRefsEl.hidden = true; delSceneWarnEl.hidden = true; delSceneConfirmEl.hidden = true;
    deleteSceneDialogEl.addEventListener("close", () => { delSceneConfirmEl.hidden = false; }, { once: true });
    deleteSceneDialogEl.showModal();
    return;
  }

  // The info reads the SAVED truth; unsaved edits in the open scene count as content too.
  const unsaved = id === currentSceneId && dirty;

  // Frictionless undo of an accidental create: nothing at stake, nothing to confirm.
  if (info.untouched && !unsaved && !info.startsHere && info.referrers.length === 0) { await doDeleteScene(id); return; }

  delSceneTitleEl.textContent = `Delete “${scene.name}”?`;
  const contents = info.untouched
    ? "This removes its files from the project."
    : `It contains ${info.lines} line${info.lines === 1 ? "" : "s"} across ${info.blocks} block${info.blocks === 1 ? "" : "s"}. This removes its files from the project.`;
  delSceneMsgEl.textContent = unsaved ? `It has unsaved changes. ${contents}` : contents;
  delSceneRefsEl.replaceChildren();
  delSceneRefsEl.hidden = info.referrers.length === 0;
  if (info.referrers.length) {
    delSceneRefsEl.append(Object.assign(document.createElement("p"), { className: "del-refs-head", textContent: "These scenes refer to it:" }));
    for (const r of info.referrers) {
      const bits = [r.jumps ? `${r.jumps} jump${r.jumps === 1 ? "" : "s"}` : "", r.conditions ? `${r.conditions} condition${r.conditions === 1 ? "" : "s"}` : ""].filter(Boolean).join(", ");
      delSceneRefsEl.append(Object.assign(document.createElement("p"), { className: "del-refs-row", textContent: `${r.name} · ${bits}` }));
    }
  }
  const warnBits = [
    info.referrers.length ? "Those references will dangle and show as problems until you repoint them." : "",
    info.startsHere ? "This is the project's start point - it will be cleared." : "",
    info.vcs ? "" : "This cannot be undone.",
  ].filter(Boolean);
  delSceneWarnEl.textContent = warnBits.join(" ");
  delSceneWarnEl.hidden = warnBits.length === 0;
  delSceneConfirmEl.textContent = info.referrers.length ? "Delete anyway" : "Delete";

  const onClose = (): void => {
    deleteSceneDialogEl.removeEventListener("close", onClose);
    if (deleteSceneDialogEl.returnValue === "delete") void doDeleteScene(id);
  };
  deleteSceneDialogEl.addEventListener("close", onClose);
  deleteSceneDialogEl.showModal();
}

async function doDeleteScene(id: string): Promise<void> {
  // Pick the landing spot BEFORE the list shrinks: the row above in nav order, else the first remaining.
  const order = project?.scenes.map((s) => s.id) ?? [];
  const at = order.indexOf(id);
  const neighbour = order[at - 1] ?? order.find((sid) => sid !== id);
  const res = await window.patter.deleteScene(id);
  if (!res.ok || !res.project) return;
  project = res.project;
  renderNav();
  if (currentSceneId === id) {
    // The files are gone: there is nothing left to persist. Drop the editor's dirty state so the
    // switch below doesn't try to save (and toast a refusal on) the scene we just deleted.
    setDirty(false);
    docsDirty = false; commentsDirty = false;
    if (neighbour) await loadScene(neighbour);
  } else if (currentSceneId) highlightNav(currentSceneId);
}

/** The nav's minimal context menu (one action today; room for Rename later). */
function sceneContextMenu(sceneId: string, x: number, y: number): void {
  document.querySelector(".nav-ctx")?.remove();
  const menu = document.createElement("div");
  menu.className = "nav-ctx";
  menu.style.left = `${x}px`; menu.style.top = `${y}px`;
  const del = document.createElement("button");
  del.type = "button"; del.textContent = "Delete Scene…";
  del.addEventListener("click", () => { menu.remove(); void deleteScenePrompt(sceneId); });
  menu.appendChild(del);
  const dismiss = (): void => { menu.remove(); window.removeEventListener("pointerdown", onAway, true); };
  const onAway = (e: PointerEvent): void => { if (!menu.contains(e.target as Node)) dismiss(); };
  window.addEventListener("pointerdown", onAway, true);
  document.body.appendChild(menu);
}

// --- scene reorder (drag a nav row; the order persists to the project) -------

let dragSceneId: string | null = null;

function clearDropMarks(): void {
  navListEl.querySelectorAll(".drop-before, .drop-after").forEach((el) => el.classList.remove("drop-before", "drop-after"));
}

function wireSceneDrag(row: HTMLElement): void {
  row.draggable = true;
  row.addEventListener("dragstart", (e) => {
    dragSceneId = row.dataset["id"] ?? null;
    row.classList.add("dragging");
    if (e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", dragSceneId ?? ""); }
  });
  row.addEventListener("dragend", () => { dragSceneId = null; row.classList.remove("dragging"); clearDropMarks(); });
  row.addEventListener("dragover", (e) => {
    if (!dragSceneId || dragSceneId === row.dataset["id"]) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    const before = e.clientY < row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
    clearDropMarks();
    row.classList.add(before ? "drop-before" : "drop-after");
  });
  row.addEventListener("dragleave", () => row.classList.remove("drop-before", "drop-after"));
  row.addEventListener("drop", (e) => {
    e.preventDefault();
    const before = row.classList.contains("drop-before");
    clearDropMarks();
    const targetId = row.dataset["id"];
    if (dragSceneId && targetId && dragSceneId !== targetId) void commitSceneReorder(dragSceneId, targetId, before);
  });
}

/** Rows GLIDE to their new slots (FLIP over the rebuild), per the animation strategy. */
function flipNav(mutate: () => void): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { mutate(); return; }
  const first = new Map<string, DOMRect>();
  navListEl.querySelectorAll<HTMLElement>(".nav-scene").forEach((el) => { if (el.dataset["id"]) first.set(el.dataset["id"], el.getBoundingClientRect()); });
  mutate();
  navListEl.querySelectorAll<HTMLElement>(".nav-scene").forEach((el) => {
    const f = el.dataset["id"] ? first.get(el.dataset["id"]) : undefined;
    if (!f) return;
    const dy = f.top - el.getBoundingClientRect().top;
    if (!dy) return;
    el.style.transition = "none"; el.style.transform = `translateY(${dy}px)`;
    requestAnimationFrame(() => {
      el.style.transition = "transform var(--dur-settle) var(--ease-standard)";
      el.style.transform = "";
      el.addEventListener("transitionend", () => { el.style.transition = ""; }, { once: true });
    });
  });
}

/** Persist a drop: splice the moved scene against the target, save the order, glide the rows.
 *  A refused save (the scene list changed underneath the drag) re-renders the truth unchanged. */
async function commitSceneReorder(movedId: string, targetId: string, before: boolean): Promise<void> {
  if (!project) return;
  const ids = project.scenes.map((s) => s.id).filter((id) => id !== movedId);
  const at = ids.indexOf(targetId);
  if (at < 0) return;
  ids.splice(before ? at : at + 1, 0, movedId);
  const res = await window.patter.reorderScenes(ids);
  if (res.project) project = res.project;
  flipNav(() => renderNav());
}

// --- version-control state (#145) --------------------------------------------
// The reactive surface over simple-vc-lib: a per-scene snapshot drives a nav badge on every scene + a
// topbar chip for the current one, and a scene locked by ANOTHER author makes the editor read-only (the
// save would be refused anyway). Refreshed on open / save / window-focus and polled (state changes
// externally - someone else grabs a lock, a newer revision lands).
let vcMap = new Map<string, SceneVcStatus>();

/** A scene is read-only to us only when someone ELSE holds it. A not-yet-checked-out (read-only on
 *  disk) file with no other holder is still editable - simple-vc-lib checks it out on save. */
function isReadOnly(st?: SceneVcStatus): boolean { return !!st?.lockedBy?.length; }

/** The one badge to fly on a scene's nav row, by priority (most actionable first), or null if clean. */
// Monochrome typographic glyphs (NOT colour emoji), so they inherit the badge's themed colour and sit
// in the app's restrained icon family (⧉ ✓ ↪ ↓ …).
function navBadgeFor(st: SceneVcStatus | undefined): { glyph: string; cls: string; title: string } | null {
  if (st?.lockedBy?.length) return { glyph: "⊘", cls: "vcs-locked", title: `Locked by ${st.lockedBy.join(", ")}` };
  if (st?.outOfDate) return { glyph: "↓", cls: "vcs-stale", title: "Out of date - a newer version is on the server" };
  if (st?.checkedOutByMe) return { glyph: "✎", cls: "vcs-mine", title: "Checked out by you" };
  if (st?.dirty) return { glyph: "●", cls: "vcs-dirty", title: "Modified - uncommitted local changes" };
  if (st?.untracked) return { glyph: "+", cls: "vcs-new", title: "New - not yet committed" };
  return null;
}

function paintNavBadges(): void {
  navListEl.querySelectorAll<HTMLElement>(".nav-item").forEach((el) => {
    el.querySelector(".nav-badge")?.remove();
    const b = navBadgeFor(vcMap.get(el.dataset["id"] ?? ""));
    if (!b) return;
    const s = document.createElement("span");
    s.className = `nav-badge ${b.cls}`; s.textContent = b.glyph; s.dataset.tip = b.title; s.setAttribute("aria-label", b.title);
    el.appendChild(s);
  });
}

/** Reflect the CURRENT scene's VC state: read-only the surface + dim the inspector when locked by
 *  another, and show a topbar chip naming the holder (or an out-of-date notice). */
function applySceneVc(): void {
  const st = currentSceneId ? vcMap.get(currentSceneId) : undefined;
  const ro = isReadOnly(st);
  surface?.setEditable(!ro);
  panesEl.classList.toggle("vcs-readonly", ro);
  const chip = st?.lockedBy?.length ? `⊘ Locked by ${st.lockedBy.join(", ")}`
    : st?.outOfDate ? "↓ Out of date" : "";
  vcsSceneEl.textContent = chip;
  vcsSceneEl.hidden = !chip;
  vcsSceneEl.classList.toggle("locked", !!st?.lockedBy?.length);
}

/** Pull a fresh VC snapshot (one batched spawn in main), repaint the badges, and re-apply the current
 *  scene's read-only state. No-op when no project is open. */
async function refreshVcStatus(): Promise<void> {
  if (!project) return;
  const dto = await window.patter.vcStatus();
  if (!dto || !project) return; // project may have closed while we awaited
  vcMap = new Map(dto.scenes.map((s) => [s.sceneId, s]));
  paintNavBadges();
  applySceneVc();
}

let toastTimer = 0;
let toastSeq = 0; // bumped per show; the dismiss only hides if it's still the current toast (no stale hide)
/** A transient bottom-corner message - currently a save the VCS refused (who holds the lock). */
function toast(msg: string, kind: "error" | "info" = "info"): void {
  const id = ++toastSeq;
  toastEl.textContent = msg;
  toastEl.className = `toast ${kind}`; // resets any `.closing` left from a prior dismiss
  toastEl.hidden = false;
  window.clearTimeout(toastTimer);
  // Eased dismiss: play the exit animation, then hide - unless a newer toast has since taken over.
  toastTimer = window.setTimeout(() => closeWithExit(toastEl, () => { if (toastSeq === id) toastEl.hidden = true; }), kind === "error" ? 7000 : 4000);
}

// --- side panes (slide / collapse) -------------------------------------------
// The two side panes slide to full-bleed; the open/closed state is remembered per user. Closed means
// closed - the inspector only opens when the user explicitly expands it (no auto-peek on selection).
let panes: PaneState = { nav: false, inspector: false };

function applyPanes(): void {
  panesEl.classList.toggle("no-nav", !panes.nav);
  panesEl.classList.toggle("no-inspector", !panes.inspector);
  // Restore the author's dragged widths (px); absent -> the CSS default (rem).
  if (panes.navW) panesEl.style.setProperty("--nav-open-w", `${panes.navW}px`); else panesEl.style.removeProperty("--nav-open-w");
  if (panes.inspW) panesEl.style.setProperty("--insp-open-w", `${panes.inspW}px`); else panesEl.style.removeProperty("--insp-open-w");
  // Icon-only chevrons (quiet chrome, Patterpad.md §4 "the window holds the script, not a button bar"):
  // a bare chevron pointing toward where the pane sits - inward (‹ / ›) to collapse it, outward to expand.
  // The label / shortcut live on the tooltip + aria-label (no text word competing in the bar).
  toggleNavEl.textContent = panes.nav ? "‹" : "›";
  toggleNavEl.setAttribute("aria-pressed", String(panes.nav));
  toggleNavEl.setAttribute("aria-label", panes.nav ? "Hide scenes" : "Show scenes");
  toggleNavEl.dataset.tip = panes.nav ? "Hide scenes (⌘1)" : "Show scenes (⌘1)";
  toggleInspectorEl.textContent = panes.inspector ? "›" : "‹";
  toggleInspectorEl.setAttribute("aria-pressed", String(panes.inspector));
  toggleInspectorEl.setAttribute("aria-label", panes.inspector ? "Hide inspector" : "Show inspector");
  toggleInspectorEl.dataset.tip = panes.inspector ? "Hide inspector (⌘2)" : "Show inspector (⌘2)";
}

function togglePane(which: "nav" | "inspector"): void {
  panes = { ...panes, [which]: !panes[which] };
  applyPanes();
  void window.patter.setPanes(panes); // remember it (also refreshes the View-menu checks)
}

// --- draggable pane widths ---------------------------------------------------
// Each seam handle drags its pane wider / narrower; the width is clamped to a minimum and a viewport-
// relative maximum (so the centre script always keeps room), then remembered per user on release.
const navResizerEl = $("nav-resizer");
const inspResizerEl = $("insp-resizer");
const MIN_PANE = 160;
const maxPaneW = (): number => Math.max(MIN_PANE, Math.min(640, Math.round(window.innerWidth - 420)));

function beginResize(e: PointerEvent, side: "nav" | "inspector"): void {
  e.preventDefault();
  const pane = side === "nav" ? navEl : inspectorEl;
  const startX = e.clientX;
  const startW = pane.getBoundingClientRect().width;
  const cssVar = side === "nav" ? "--nav-open-w" : "--insp-open-w";
  document.body.classList.add("resizing");
  let latest = startW;
  // Listen on window (not the 7px handle) so the drag tracks even when the cursor outruns the bar.
  const onMove = (ev: PointerEvent): void => {
    const delta = ev.clientX - startX;
    latest = Math.max(MIN_PANE, Math.min(maxPaneW(), Math.round(side === "nav" ? startW + delta : startW - delta)));
    panesEl.style.setProperty(cssVar, `${latest}px`);
  };
  const onUp = (): void => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    document.body.classList.remove("resizing");
    panes = { ...panes, [side === "nav" ? "navW" : "inspW"]: latest };
    void window.patter.setPanes(panes); // remember the new width
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

navResizerEl.addEventListener("pointerdown", (e) => beginResize(e, "nav"));
inspResizerEl.addEventListener("pointerdown", (e) => beginResize(e, "inspector"));

/** Double-click a seam to drop that pane back to its default width. */
function resetPaneWidth(side: "nav" | "inspector"): void {
  panes = { ...panes };
  if (side === "nav") delete panes.navW; else delete panes.inspW;
  applyPanes(); // applyPanes removes the inline var when the width is unset -> CSS default
  void window.patter.setPanes(panes);
}
navResizerEl.addEventListener("dblclick", () => resetPaneWidth("nav"));
inspResizerEl.addEventListener("dblclick", () => resetPaneWidth("inspector"));

/** View > Reset View: side panes back to their default widths and open/closed state. */
/** View > Reset View: put EVERYTHING display-related back to defaults - the panes, every remembered
 *  show/hide display pref (doc-note classes, resolved comments / suggestions, line-status gutter pills,
 *  the review walk) - then rescue every window to a sensible on-screen place (a way out when a window is
 *  lost on a now-disconnected monitor or minimised out of reach). Aesthetic theme (palette / font) is a
 *  deliberate identity choice and is left untouched. */
function resetView(): void {
  // Each display pref back to its default, with the UI refreshed in place.
  docHidden = new Set(); pushDocNotes();                      // all documentation-note classes visible
  showResolved = false; pushCommentMarks();                  // resolved comments hidden
  showResolvedSuggestions = false; pushSuggestionMarks();    // resolved suggestions hidden
  lineStatusShown = []; pushWritingStatus();                 // no line-status gutter pills
  setReviewFeedback(false);                                  // leave the review-feedback walk
  // Layout + the whole remembered pane/display set back to defaults, persisted once (this also refreshes
  // every View / Review menu check off the clean state).
  panes = { nav: false, inspector: false }; // full-bleed, both sides closed; widths + display prefs cleared
  applyPanes();
  void window.patter.setPanes(panes);
  void window.patter.resetWindows(); // rescue every window to a sensible on-screen place
}

// --- Writing View (full-bleed; ephemeral, NOT persisted) ---------------------
// A pure presentation mode: a body class hides ALL chrome (both panes, both bottom bars, the topbar,
// and the surface's review gutters + tints) and eases the editor full-bleed - see the CSS in shell.css.
// It mutates NO state, so leaving restores the EXACT prior layout (open/pinned panes, Review mode,
// visible bars) for free. Esc or the bottom-left pill exits. Only available with a project open.
let writingView = false;
function setWritingView(on: boolean): void {
  if (on === writingView || (on && panesEl.hidden)) return; // no Writing View on the welcome screen
  writingView = on;
  document.body.classList.toggle("writing-view", on);
  if (on) surface?.focus(); // keep the cursor in the script (the toggle itself is a native accelerator)
}
function toggleWritingView(): void { setWritingView(!writingView); }
writingExitEl.addEventListener("click", () => setWritingView(false));
// Label the exit affordance with the platform's toggle shortcut (matches the View-menu accelerator).
writingExitEl.textContent = `Exit Writing View · ${navigator.platform.toUpperCase().includes("MAC") ? "⇧⌘M" : "Ctrl+Shift+M"}`;

// --- colour / font theme (View menu) -----------------------------------------
let theme: ThemePrefs = { colour: "system", font: "newsreader" };

/** Reflect the theme on the renderer root: `data-theme` drives the colour scheme ("system" follows
 *  the OS by setting nothing), `data-font` swaps the reading-face token set (see the surface theme.css). */
function applyTheme(): void {
  const root = document.documentElement;
  if (theme.colour === "system") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", theme.colour);
  root.setAttribute("data-font", theme.font);
}

function setTheme(patch: Partial<ThemePrefs>): void {
  theme = { ...theme, ...patch };
  applyTheme();
  void window.patter.setTheme(theme); // remember it (also refreshes the View-menu radio checks)
}

// --- the problems bar (bottom, prev/next nav) --------------------------------
// Validation feeds a slim bottom bar (Patterpad.md §4): a count, the current problem, and ‹ › to step
// through them - each step (and a click on the message) jumps the caret to the offending node.

let problems: Problem[] = [];
let problemAt = 0;

/** A human label for a quick-fix (spec §4) - writer-speak, no engine jargon. */
function fixLabel(fix: NonNullable<Problem["fix"]>): string {
  if (fix.kind === "add-to-cast") return `Add “${fix.character}” to the cast`;
  if (fix.kind === "declare-property") return `Set up “${fix.name}” (${fix.propType})`;
  if (fix.kind === "retarget-jump") return "Choose where it goes…";
  if (fix.kind === "add-prompt") return "Add a label";
  if (fix.kind === "pick-enum-value") return `Pick a valid value…`;
  return "Fix";
}

/** Friendly category names for the problems bar (the CLI keeps the precise technical codes). */
const PROBLEM_CATEGORY: Record<Problem["category"], string> = {
  structure: "Structure", condition: "Condition", interpolation: "Text",
  hygiene: "Tidy-up", "stale-bundle": "Build", merge: "Merge", spelling: "Spelling",
};

/** Rewrite a validator problem into plain language for the editor's problems bar - the audience is
 *  writers, not engineers. Known structural cases get a hand-written sentence; everything else has its
 *  technical tells softened (spec citations dropped, `@prop` shown as “prop”). The CLI is unchanged. */
function humanizeProblem(p: Problem): { tag: string; message: string } {
  const tag = PROBLEM_CATEGORY[p.category] ?? "Problem";
  if (p.category === "stale-bundle") return { tag, message: "Your playable build is out of date. It refreshes the next time you export." };
  if (p.category === "merge") return { tag, message: "This file still has an unresolved merge conflict in it." };
  if (p.category === "spelling") return { tag, message: p.message }; // already writer-facing (#177)
  const speaker = /'([^']+)' is not in the project cast/.exec(p.message);
  switch (p.detail) {
    case "missing-prompt": return { tag, message: "This option needs a label. What does the player choose here?" };
    case "invalid-prompt": return { tag, message: "An option's label should be a single line." };
    case "unknown-character": return { tag, message: speaker ? `“${speaker[1]}” isn't in your cast yet.` : "This line's speaker isn't in your cast yet." };
    case "empty-snippet": return { tag, message: "This snippet is empty. Add a line, or send it somewhere." };
    case "empty-container": return { tag, message: "This is empty. Add something inside it." };
    case "empty-scene": return { tag, message: "This scene has nothing in it yet." };
    case "missing-name": return { tag, message: "This needs a name." };
    case "choice-can-empty": return { tag, message: "This choice can run dry. Once each option is used up and there's no fallback, it has nothing left to show." };
    case "multiple-fallbacks": return { tag, message: "A choice can have at most one fallback option." };
    case "dangling-jump": case "jump-into-non-addressable": return { tag, message: "This doesn't point anywhere valid. Choose where it goes." };
    case "invalid-gameid": return { tag, message: "This Game ID isn't valid. Use lowercase letters, digits and hyphens." };
    case "duplicate-gameid": return { tag, message: "This Game ID is already used elsewhere. Each one must be unique." };
    default: break;
  }
  // Condition / interpolation (and any unmapped case): soften the technical tells, keep the gist.
  const message = p.message
    .replace(/\s*\(spec §[^)]*\)/g, "")            // drop spec citations
    .replace(/'?@([A-Za-z0-9_.]+)'?/g, "“$1”")      // '@gold' / @gold -> “gold” (eat any wrapping quotes)
    .replace(/^unresolved property reference /i, "uses a property that isn't set up yet: ")
    .replace(/^unknown property( in interpolation slot)?:? /i, "uses a property that isn't set up yet: ")
    .replace(/ is not a declared property$/i, " isn't set up yet")
    .replace(/voiced line beats cannot contain interpolation/i, "voiced lines can't contain inserts");
  return { tag, message };
}

/** Rewrite a condition, swapping the invalid enum literal for a chosen valid one (quoted form first,
 *  then a bare-word fallback). Used by the pick-enum-value quick-fix. */
function rewriteEnumValue(src: string, bad: string, chosen: string): string {
  const quoted = src.split(`"${bad}"`).join(`"${chosen}"`);
  if (quoted !== src) return quoted;
  return src.replace(new RegExp(`\\b${bad.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`), chosen);
}

function showProblem(): void {
  const p = problems[problemAt];
  if (!p) return;
  problembarEl.classList.toggle("warning", p.severity === "warning"); // amber for advisory issues
  const { tag, message } = humanizeProblem(p);
  problemCatEl.textContent = tag;
  problemMsgEl.textContent = message;
  problemCurEl.classList.toggle("jump", !!p.nodeId);
  problemCurEl.dataset.tip = p.nodeId ? "Go to issue" : "";
  problemFixEl.hidden = !p.fix;
  if (p.fix) problemFixEl.textContent = fixLabel(p.fix);
}

async function applyCurrentFix(): Promise<void> {
  const fix = problems[problemAt]?.fix;
  if (!fix) return;
  if (fix.kind === "retarget-jump") {
    // A surface edit, not a project write: open the shared jump picker, set it, save, then re-validate.
    surface?.editJump(fix.snippetId, problemFixEl, () => { void (async () => { await save(); await refreshProblems(); })(); });
    return;
  }
  if (fix.kind === "add-prompt") {
    // Surface edit: insert an empty prompt cell into the option, reveal it, save, re-validate.
    if (surface?.addPrompt(fix.optionId)) { surface.revealNode(fix.optionId); await save(); await refreshProblems(); }
    return;
  }
  if (fix.kind === "pick-enum-value") {
    // Surface edit: pick a valid value (the jump picker doubles as a generic chooser), rewrite the
    // condition, save, re-validate. Uses the problem's node id (the snippet / group / option).
    const nodeId = problems[problemAt]?.nodeId;
    if (!nodeId) return;
    openJumpPicker({
      anchor: problemFixEl, current: "", targets: fix.options.map((v) => ({ id: v, label: v })),
      onPick: async (v) => { if (surface?.setCondition(nodeId, rewriteEnumValue(fix.src, fix.bad, v))) { await save(); await refreshProblems(); } },
    });
    return;
  }
  const res = await window.patter.applyFix(fix); // add-to-cast / declare-property (project-file writes)
  if (res.ok) await refreshProblems(); // re-validate: the fixed problem (and its squiggle) drops out
  else console.error("Quick-fix failed:", res.error);
}

/** Register a brand-new character (from the cue popup's "+ Add") in the project master cast, so it persists
 *  beyond this session and shows in Project Settings > Cast. Reuses the add-to-cast project-file write; then
 *  reflects the name in the cached project, rebuilds spell-check (so the new cue isn't squiggled), and
 *  re-validates (a "character not in cast" warning, if any, drops). Idempotent on an existing name. */
async function registerCharacter(name: string): Promise<void> {
  const n = name.trim();
  if (!project || !n) return;
  if (project.cast.some((c) => c.toLowerCase() === n.toLowerCase())) return; // already in the master cast
  const res = await window.patter.applyFix({ kind: "add-to-cast", character: n });
  if (!res.ok) { console.error("Add character to cast failed:", res.error); return; }
  project.cast = [...project.cast, n]; // keep castSeed / spell-check in sync without a reload
  await buildSpellcheck();
  await refreshProblems();
}

function stepProblem(delta: number): void {
  if (!problems.length) return;
  problemAt = (problemAt + delta + problems.length) % problems.length;
  problemCountEl.textContent = `${problemAt + 1} / ${problems.length}`;
  showProblem();
  const id = problems[problemAt]?.nodeId;
  if (id) surface?.revealNode(id);
}

/** Push the current problems to the surface as inline squiggles (ids not in the open scene are ignored).
 *  Spelling is EXCLUDED - it already has its own wavy underline from the spell-check plugin (#177). */
function applyProblemMarks(): void {
  surface?.markProblems(problems
    .filter((p) => p.nodeId && p.category !== "spelling")
    .map((p) => ({ id: p.nodeId!, severity: p.severity as "error" | "warning" })));
}

/** The open scene's misspellings as problems-panel entries (info severity; renderer-only, #177). */
function spellingProblems(): Problem[] {
  return (surface?.spellingIssues() ?? []).map((i) => ({
    category: "spelling" as const, severity: "info" as const, nodeId: i.nodeId,
    message: `Possible spelling mistake: “${i.word}”.`,
  }));
}

function renderProblems(dto: ProblemsDto): void {
  // Flow-validation problems (from the validator) + the open scene's spelling issues (#177), combined for
  // the problems bar. Spelling is editorial (info) and never blocks a build.
  problems = [...dto.problems, ...spellingProblems()];
  problemAt = 0;
  applyProblemMarks(); // inline squiggles at the offending sites
  problembarEl.hidden = problems.length === 0;
  const multi = problems.length > 1;
  problemPrevEl.hidden = !multi;
  problemNextEl.hidden = !multi;
  if (!problems.length) { problemFixEl.hidden = true; return; }
  problemCountEl.textContent = multi ? `1 / ${problems.length}` : "1 problem";
  showProblem();
}

async function refreshProblems(): Promise<void> {
  // Validate the LIVE in-memory source of the open scene (not just disk) so problems track edits as
  // they happen - toggling sticky, fixing a condition, etc. clears/raises issues without a save first.
  const live = surface && currentSceneId ? { sceneId: currentSceneId, ...surface.getSource() } : undefined;
  renderProblems(await window.patter.validate(live));
}

// Re-validate shortly after edits settle (debounced): the problems panel reflects unsaved changes, and
// any open play session is told the scene changed (it freezes until restart, then plays the new source).
let validateTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleValidate(): void {
  clearTimeout(validateTimer);
  validateTimer = setTimeout(() => {
    void refreshProblems();
    // Only a genuine user edit tells the play session the scene changed - never a programmatic load.
    if (sceneEdited && surface && currentSceneId) { const s = surface.getSource(); window.patter.playEdited(currentSceneId, s.flow, s.loc); }
  }, 350);
}

problemPrevEl.addEventListener("click", () => stepProblem(-1));
problemNextEl.addEventListener("click", () => stepProblem(1));
problemFixEl.addEventListener("click", () => void applyCurrentFix());
problemCurEl.addEventListener("click", () => { const id = problems[problemAt]?.nodeId; if (id) surface?.revealNode(id); });

// --- the detail inspector (right pane) ---------------------------------------
let sceneProps: ConditionProperty[] = []; // referenceable properties for the condition editor (per scene)
// The open scene's typed documentation (spec §18): node id -> notes. Loaded from the .patterx on scene
// open, edited in memory via the inspector Notes popover, persisted on popover close / scene switch.
let docMap: Record<string, DocLine[]> = {};
let docsDirty = false;
// v1 uses the default class vocabulary; reading project.documentationClasses is a later refinement.
const docClasses = DEFAULT_DOCUMENTATION_CLASSES;

/** The note classes ADDABLE on a node by kind: no VO on a text/game-event beat, no loc on a game-event beat;
 *  dialogue lines and containers (no kind) get all. "everyone" + studio classes always apply. */
function docClassesForKind(kind?: string): typeof docClasses {
  return docClasses.filter((c) => {
    if (c.name === "vo") return kind !== "prose" && kind !== "gameEvent";
    if (c.name === "loc") return kind !== "gameEvent";
    return true;
  });
}

/** Persist the scene's documentation map to its authoring shard (if changed). */
async function persistDocs(): Promise<void> {
  if (!docsDirty || !currentSceneId) return;
  docsDirty = false;
  const res = await window.patter.saveDocs(currentSceneId, docMap);
  if (!res.ok) { docsDirty = true; console.error("Save notes failed:", res.error); }
}

// Which documentation CLASSES the editor surfaces (View > Documentation). "everyone" + untyped are always
// shown; the rest default to shown and the author can hide them. Seeded from persisted panes on boot.
let docHidden = new Set<string>();
const docVisible = (cls: string): boolean => cls === "" || cls === "everyone" || !docHidden.has(cls);

/** Open the documentation-note editor (modal) for a node - from the surface note icon or a right-click
 *  "Note…". `kind` (the node kind) narrows which classes are offered. Persists + re-surfaces on close. */
function openNoteEditor(id: string, _anchor: HTMLElement, kind?: string): void {
  mountDocEditor(docHost, {
    lines: docMap[id] ?? [], classes: docClassesForKind(kind),
    onChange: (lines) => { if (lines.length) docMap[id] = lines; else delete docMap[id]; docsDirty = true; },
  });
  const onClose = (): void => {
    docDialogEl.removeEventListener("close", onClose);
    pushDocNotes();   // reflect the edit in the script (the note icon appears / updates / clears)
    lastInspectorSig = null; if (lastInspectorCtx) showInspector(lastInspectorCtx); // flip the inspector note icon
    void persistDocs();
  };
  docDialogEl.addEventListener("close", onClose);
  docDialogEl.showModal();
}

/** Build the surface's visible-notes map from the scene's docMap, applying the class filter. */
function pushDocNotes(): void {
  const map: Record<string, DocNote[]> = {};
  for (const [id, lines] of Object.entries(docMap)) {
    const vis = lines.filter((l) => docVisible(l.type ?? "")).map((l): DocNote => ({ cls: l.type ?? "", text: l.text }));
    if (vis.length) map[id] = vis;
  }
  surface?.setDocNotes(map);
}

// --- threaded editor comments (collaboration, #148) --------------------------
// The open scene's comment threads, loaded from the .patterx on scene open and persisted as the author
// posts / resolves. Each message carries the author (first-run identity) + an ISO timestamp.
let comments: Comment[] = [];
let commentsDirty = false;
let showResolved = false;  // View > Show Resolved Comments (persisted in panes.commentsResolved)
let authorName = "";       // the current author's name, for stamping new messages

const newCommentId = (): string => `cmt_${Math.random().toString(36).slice(2, 10)}`;

/** Refresh stored range offsets from the surface's CURRENT (live-mapped) spans, so a comment whose
 *  text moved during the session persists at its new offsets (the quote re-anchors regardless). */
function syncCommentRanges(): void {
  for (const cur of surface?.commentRanges() ?? []) {
    const t = comments.find((c) => c.id === cur.id);
    if (t?.range) t.range = { from: cur.from, to: cur.to, quote: cur.quote };
  }
}

/** Persist the scene's comment threads to its authoring shard (if changed). */
async function persistComments(): Promise<void> {
  if (!commentsDirty || !currentSceneId) return;
  commentsDirty = false;
  syncCommentRanges();
  const res = await window.patter.saveComments(currentSceneId, comments);
  if (!res.ok) { commentsDirty = true; console.error("Save comments failed:", res.error); }
}

/** Push the comment threads to the surface (range threads highlight + fly a bubble; whole-beat threads
 *  fly a gutter bubble), filtered by the resolved toggle. */
function pushCommentMarks(): void {
  surface?.setComments(
    comments
      .filter((t) => showResolved || !t.resolved)
      .map((t) => ({
        id: t.id, nodeId: t.anchor, from: t.range?.from, to: t.range?.to, quote: t.range?.quote,
        count: t.messages.length, resolved: !!t.resolved,
        // The thread rendered for the in-script hover tooltip (capped so it stays readable). The
        // commenter's name is bolded (the tooltip turns the markers into <strong>).
        preview: t.messages.map((m) => `${tipBold(`${m.author || "Someone"}:`)} ${m.body}`).join("\n").slice(0, 400),
      })),
  );
}

/** Open / start a thread. A bubble click opens the existing thread (by id); the selection affordance
 *  starts a RANGE thread; the ⋯ menu / inspector row opens the node's active whole-beat thread (or a
 *  fresh one). A new thread is only committed to `comments` once its first message is posted. */
function openComments(req: CommentOpenRequest): void {
  let thread = req.threadId ? comments.find((c) => c.id === req.threadId) : undefined;
  if (!thread && req.range) thread = { id: newCommentId(), anchor: req.nodeId, range: req.range, messages: [] };
  if (!thread) {
    thread = comments.find((c) => c.anchor === req.nodeId && !c.range && !c.resolved)
      ?? (showResolved ? comments.find((c) => c.anchor === req.nodeId && !c.range && c.resolved) : undefined)
      ?? { id: newCommentId(), anchor: req.nodeId, messages: [] };
  }
  const t = thread;
  openCommentThread({
    anchor: req.anchor, thread: t, me: authorName,
    onPost: (b) => {
      t.messages.push({ author: authorName || "Me", ts: new Date().toISOString(), body: b });
      if (!comments.includes(t)) comments.push(t); // first message commits the new thread
      commentsDirty = true; pushCommentMarks(); void flushReview();
    },
    onResolve: () => { t.resolved = true; commentsDirty = true; pushCommentMarks(); void flushReview(); },
    onReopen: () => { t.resolved = false; commentsDirty = true; pushCommentMarks(); void flushReview(); },
  });
}

/** View > Show Resolved Comments: reveal archived threads (bubbles + popover) or hide them again. */
function setShowResolved(on: boolean): void {
  showResolved = on;
  panes = { ...panes, commentsResolved: on };
  void window.patter.setPanes(panes); // persist + refresh the View-menu check
  pushCommentMarks();
  if (showReviewFeedback) void gatherReview(); // the walk honours this toggle - re-gather so resolved threads join / leave
}

// --- writing status (#196) ---------------------------------------------------
// The open scene's per-beat writing status (beat id -> ladder rung), loaded from the .patterx on open.
// Source-only authoring metadata; saved immediately on each set (not scene source, so no dirty flag).
let writingMap: Record<string, string> = {};
let lineStatusShown: string[] = []; // Review > Line Status: which rungs show a gutter pill (persisted in panes.lineStatusShown; [] = none)

/** Push this scene's status map + the ladder + the shown-set to the surface (pills + submenu). */
function pushWritingStatus(): void {
  if (!surface) return;
  surface.setWritingStatusLadder(project?.writingStatuses ?? []);
  surface.setWritingStatus(writingMap);
  surface.setWritingStatusShown(lineStatusShown);
}

/** Set (status) or clear (null) the writing status of these beats - from the context-menu "Status" submenu
 *  or the inspector dropdown. Updates the map, persists to the .patterx, repaints the gutter badges, and
 *  re-renders the inspector when the shown beat's status changed (its selection signature is unchanged). */
function setLineStatus(ids: string[], status: string | null): void {
  if (!currentSceneId || !ids.length) return;
  for (const id of ids) { if (status) writingMap[id] = status; else delete writingMap[id]; }
  surface?.setWritingStatus(writingMap);
  void window.patter.saveWriting(currentSceneId, writingMap);
  const ctx = lastInspectorCtx;
  if (ctx && ids.some((id) => ctx.levels.some((l) => (l as { id?: string }).id === id))) {
    lastInspectorSig = null; showInspector(ctx);
  }
}

/**
 * Carry the sidecar authoring metadata from a duplicated subtree's originals to its copies. The copy has
 * fresh ids throughout, so anything keyed by id starts empty unless it is copied across here: writing
 * status and documentation notes follow the copy (it is the same drafting stage, and a VO note still
 * describes the line). Two things deliberately do NOT follow: threaded review COMMENTS (a conversation
 * about the original line, not its copy), and recording status (derived from the audio on disk - the copy
 * has no take yet, so it correctly reads as unrecorded).
 */
function carryDuplicatedMetadata(idMap: Record<string, string>): void {
  if (!currentSceneId) return;
  let writing = false;
  let docs = false;
  for (const [from, to] of Object.entries(idMap)) {
    const status = writingMap[from];
    if (status) { writingMap[to] = status; writing = true; }
    const notes = docMap[from];
    if (notes?.length) { docMap[to] = notes.map((n) => ({ ...n })); docs = true; }
  }
  if (writing) { surface?.setWritingStatus(writingMap); void window.patter.saveWriting(currentSceneId, writingMap); }
  if (docs) { pushDocNotes(); void window.patter.saveDocs(currentSceneId, docMap); }
}

/** Review > Line Status: set which writing-status rungs show a gutter pill (remembered in
 *  panes.lineStatusShown; the menu rebuilds off it, so its checks reflect the new set). */
function setLineStatusShown(names: string[]): void {
  // Keep only rungs that still exist in the ladder, in ladder order (stable, deduped).
  const ladder = (project?.writingStatuses ?? []).map((s) => s.name);
  lineStatusShown = ladder.filter((n) => names.includes(n));
  panes = { ...panes, lineStatusShown };
  void window.patter.setPanes(panes); // persist + refresh the Review-menu checks
  surface?.setWritingStatusShown(lineStatusShown);
}
/** Toggle one rung in/out of the shown set (Review > Line Status > <rung>). */
function toggleLineStatus(name: string): void {
  setLineStatusShown(lineStatusShown.includes(name) ? lineStatusShown.filter((n) => n !== name) : [...lineStatusShown, name]);
}

// --- recording status (#206, manual mode) ------------------------------------
// The open scene's per-beat recording status (beat id -> ladder rung), loaded from the .patterx on open.
// By design there is NO gutter pill / context submenu for recording - it's edited only via the inspector
// dropdown on dialogue (line) beats, and persisted immediately (source-only metadata, no dirty flag).
let recordingMap: Record<string, string> = {};

// "Needs re-record" flags (#227): beat id -> true. Ticking one masks the line's recording status (folder-
// derived or manual) to the reserved "rerecord" status in the recording script / report / status browse.
// Loaded from the .patterx per scene; persisted immediately like recordingMap. Authoring-only.
let rerecordMap: Record<string, boolean> = {};

// Audio Folders mode (#206): the folder-derived index pushed from the main process (beat id -> resolved
// status + file path), held as a cached copy so the inspector reads it O(1) without touching disk. The
// indexer lives off-thread in main; when it rescans, `audio:index` arrives and we repaint a shown line.
// Folder mode is meaningful only when the project TRACKS audio status (a voiced project that hasn't opted
// out - `trackAudioStatus` is the resolved gate). Audio is forced off otherwise (main also stops the indexer).
const audioOn = (): boolean => !!project?.trackAudioStatus && !!project?.audioFolders;
let audioIndex: Record<string, AudioEntry> = {};
window.patter.onAudioIndex((snap) => {
  audioIndex = snap;
  const ctx = lastInspectorCtx; // a visible recording chip may now resolve differently
  if (ctx && audioOn()) { lastInspectorSig = null; showInspector(ctx); }
});

// Fire-and-forget playback of a line's audio (the inspector ▶ button, folder mode). Fetches the bytes from
// main, wraps them in a Blob, and plays - one clip at a time (a new click stops the previous). The clicked
// button pulses (.playing) while its clip sounds, so it's clear which line you're hearing - and clicking
// it AGAIN while its clip is sounding stops it (the ▶ doubles as an abort).
let inspectorAudio: HTMLAudioElement | null = null;
let inspectorPlayBtn: HTMLButtonElement | null = null;
async function playLineAudio(id: string, btn?: HTMLButtonElement): Promise<void> {
  if (btn && btn === inspectorPlayBtn && inspectorAudio && !inspectorAudio.paused) {
    inspectorAudio.pause(); // second click on the sounding clip's own button = stop, not restart
    return;
  }
  const data = await window.patter.readAudio(id);
  if (!data) return; // no file (shouldn't happen - the button only shows when one resolved)
  inspectorAudio?.pause();                       // stop any current clip...
  inspectorPlayBtn?.classList.remove("playing"); // ...and drop its pulse
  const url = URL.createObjectURL(new Blob([data.bytes], { type: data.mime }));
  const audio = new Audio(url);
  inspectorAudio = audio; inspectorPlayBtn = btn ?? null;
  btn?.classList.add("playing");
  if (btn) btn.dataset.tip = "stop audio";
  const stop = (): void => { URL.revokeObjectURL(url); btn?.classList.remove("playing"); if (btn) btn.dataset.tip = "play audio"; };
  audio.addEventListener("ended", stop);
  audio.addEventListener("pause", stop); // a new click (or the abort above) pauses this one
  void audio.play().catch(stop);
}

// Scratch recording (#224): open the blocking overlay for a line, then (on save) re-pull the folder index
// so the inspector chip + play button update at once (the watcher would catch up anyway, just slower). The
// overlay carries on to the next scratch-eligible line via `nextScratchLine`, so a run records in one go.
function startScratchRecording(id: string): void {
  if (isScratchRecording()) return;
  const lines = surface?.lines() ?? [];
  const at = lines.find((l) => l.id === id);
  const start = at ? { beatId: at.id, text: at.text, character: at.character } : { beatId: id, text: surface?.sayText(id) ?? "" };
  void recordScratch(start, {
    saveScratch: (beatId, bytes) => window.patter.saveScratch(beatId, bytes),
    micAccess: () => window.patter.micAccess(),
    setRecordingMode: (on) => window.patter.setRecordingMode(on),
    onComplete: () => { void refreshAudioIndex(); },
    nextLine: (beatId) => nextScratchLine(beatId, lines),
    nextNeeded: (beatId) => nextScratchLine(beatId, lines, true),
    takeState: (beatId, text) => scratchTakeState(beatId, text),
  });
}

/** The badge state of a line's existing take, for the recording overlay (#224): no file on disk at all,
 *  a take whose stamped text-hash no longer matches the line (it was edited since), or a take that still
 *  matches. A file without a stamp (hand-dropped, or from a more-finished rung) counts as up to date -
 *  the same benefit of the doubt the inspector's ⚠ badge gives. */
function scratchTakeState(beatId: string, text: string): "missing" | "stale" | "current" {
  const e = audioIndex[beatId];
  if (!e) return "missing";
  if (e.textHash != null && e.textHash !== textHash(text)) return "stale";
  return "current";
}

/** The next spoken line after `beatId` (in the captured order) that is still scratch-eligible: at or below
 *  the scratch rung, the SAME rule the inspector uses to offer the ● Record button (so the run skips lines
 *  already given a more-finished take). With `neededOnly`, also require the take to be missing or out of
 *  date - the tidy-up sweep, hopping over lines already covered. Null when none remain, or scratch
 *  recording is off. */
function nextScratchLine(beatId: string, lines: Array<{ id: string; text: string; character: string }>, neededOnly = false): { beatId: string; text: string; character: string } | null {
  const scratch = project?.scratchStatus;
  if (!scratch) return null;
  const order = (project?.recordingStatuses ?? []).map((s) => s.name);
  const scrIdx = order.indexOf(scratch);
  const lowest = order[0];
  if (scrIdx < 0 || lowest === undefined) return null;
  const eligible = (l: { id: string; text: string }): boolean => {
    const curIdx = order.indexOf(audioIndex[l.id]?.status ?? lowest);
    if (curIdx < 0 || curIdx > scrIdx) return false;
    return !neededOnly || scratchTakeState(l.id, l.text) !== "current";
  };
  const from = lines.findIndex((l) => l.id === beatId);
  for (let i = from + 1; i < lines.length; i++) { const l = lines[i]!; if (eligible(l)) return { beatId: l.id, text: l.text, character: l.character }; }
  return null;
}

async function refreshAudioIndex(): Promise<void> {
  audioIndex = await window.patter.audioCurrent();
  const ctx = lastInspectorCtx;
  if (ctx && audioOn()) { lastInspectorSig = null; showInspector(ctx); }
}

/** When the author edits the line under the caret AND it has a scratch take at the scratch rung, re-render
 *  the inspector so its "out of date" badge flips the instant the text diverges from the take (#224). A
 *  narrow, cheap re-render - it fires only for a voiced line that actually carries a stamped scratch take. */
function refreshStaleBadge(): void {
  if (!caretNodeId || !lastInspectorCtx) return;
  const e = audioIndex[caretNodeId]; const scr = project?.scratchStatus;
  if (!e || !scr || e.status !== scr || e.textHash == null) return;
  lastInspectorSig = null; showInspector(lastInspectorCtx);
}

/** Set (status) or clear (null) the recording status of a beat - from the inspector dropdown. Persists to
 *  the .patterx and re-renders the inspector (the selection signature is unchanged by a status change). */
function setRecordingStatus(id: string, status: string | null): void {
  if (!currentSceneId) return;
  if (status) recordingMap[id] = status; else delete recordingMap[id];
  void window.patter.saveRecording(currentSceneId, recordingMap);
  const ctx = lastInspectorCtx;
  if (ctx && ctx.levels.some((l) => (l as { id?: string }).id === id)) { lastInspectorSig = null; showInspector(ctx); }
}

/** Whether a beat carries a VO-channel documentation note (the reason the retake feeds to the session). */
function hasVoNote(id: string): boolean {
  return (docMap[id] ?? []).some((l) => l.type === "vo");
}

/** Tick / untick "needs re-record" (#227) on a dialogue line, from the inspector checkbox. Persists to the
 *  .patterx and repaints the row. On TICKING a line that has no VO note yet, open the notes editor so the
 *  reason for the retake (bad take, wrong pronunciation, ...) rides the recording script to the session. */
function setNeedsRerecord(id: string, on: boolean): void {
  if (!currentSceneId) return;
  if (on) rerecordMap[id] = true; else delete rerecordMap[id];
  void window.patter.saveRerecord(currentSceneId, rerecordMap);
  const ctx = lastInspectorCtx;
  if (ctx && ctx.levels.some((l) => (l as { id?: string }).id === id)) { lastInspectorSig = null; showInspector(ctx); }
  if (on && !hasVoNote(id)) openNoteEditor(id, document.body, "line"); // prompt for the "why", pre-focused on VO
}

// --- "suggest a rewrite" proposals (review flow) -----------------------------
// The open scene's rewrite proposals, loaded from the .patterx on scene open. Each carries the proposer
// (first-run identity), a timestamp, the baseline say text it was made against, and the proposed text.
let suggestions: Suggestion[] = [];
let suggestionsDirty = false;
let showResolvedSuggestions = false; // View > Show Resolved Suggestions (persisted in panes.suggestionsResolved)

const newSuggestionId = (): string => `sg_${Math.random().toString(36).slice(2, 10)}`;

async function persistSuggestions(): Promise<void> {
  if (!suggestionsDirty || !currentSceneId) return;
  suggestionsDirty = false;
  const res = await window.patter.saveSuggestions(currentSceneId, suggestions);
  if (!res.ok) { suggestionsDirty = true; console.error("Save suggestions failed:", res.error); }
}

/** Push the visible proposals to the surface: a beat with an open (or, when toggled, resolved) proposal
 *  gets a pencil marker; STALE = its baseline no longer matches the live say text (the line moved on -
 *  competing accept, or a manual edit), per the resolution rule in the proposal. */
function pushSuggestionMarks(): void {
  surface?.setSuggestions(
    suggestions
      .filter((s) => showResolvedSuggestions || !s.resolved)
      .map((s) => ({
        id: s.id, nodeId: s.anchor, author: s.author,
        stale: surface?.sayText(s.anchor) !== s.baseline,
        preview: `${s.author || "Someone"} proposes:\n${s.proposed}`.slice(0, 400),
      })),
  );
}

/** Create (the context-menu "Suggest rewrite…") or review (a pencil click) proposals on a beat. */
function openSuggestions(req: SuggestionOpenRequest): void {
  if (!surface) return;
  if (req.create) {
    const current = surface.sayText(req.nodeId) ?? "";
    openSuggestionCompose({
      anchor: req.anchor, current,
      onSubmit: (proposed) => {
        suggestions.push({ id: newSuggestionId(), anchor: req.nodeId, baseline: current, proposed, author: authorName || "Me", ts: new Date().toISOString() });
        suggestionsDirty = true; pushSuggestionMarks(); void flushReview();
      },
    });
    return;
  }
  // Review: every proposal on this beat (open; + resolved when the toggle is on), re-diffed against the
  // CURRENT say text so a stale proposal shows what accepting it would actually do.
  const live = surface.sayText(req.nodeId) ?? "";
  const rows: SuggestionRow[] = suggestions
    .filter((s) => s.anchor === req.nodeId && (showResolvedSuggestions || !s.resolved))
    .map((s) => ({ id: s.id, author: s.author, ts: s.ts, before: live, proposed: s.proposed, stale: live !== s.baseline, resolved: s.resolved, outcome: s.outcome }));
  if (!rows.length) return;
  openSuggestionReview({
    anchor: req.anchor, rows,
    onAccept: (id) => {
      const s = suggestions.find((x) => x.id === id); if (!s) return;
      surface?.setSayText(s.anchor, s.proposed); // a real edit -> the flow saves on the normal dirty path
      s.resolved = true; s.outcome = "accepted";
      suggestionsDirty = true; pushSuggestionMarks(); void flushReview();
    },
    onReject: (id) => {
      const s = suggestions.find((x) => x.id === id); if (!s) return;
      s.resolved = true; s.outcome = "rejected";
      suggestionsDirty = true; pushSuggestionMarks(); void flushReview();
    },
  });
}

/** View > Show Resolved Suggestions: reveal archived proposals (markers + review) or hide them. */
function setShowResolvedSuggestions(on: boolean): void {
  showResolvedSuggestions = on;
  panes = { ...panes, suggestionsResolved: on };
  void window.patter.setPanes(panes);
  pushSuggestionMarks();
  if (showReviewFeedback) void gatherReview(); // the walk honours this toggle - re-gather so resolved proposals join / leave
}

// --- Review Feedback walk (Review menu) --------------------------------------
// A bottom bar (mirrors the problems bar) stepping through every ACTIVE comment + suggestion across the
// WHOLE script, looping. The list is gathered from disk, so the open scene's pending writes are flushed
// first; resolving an item while the walk is on re-gathers (drops it from the loop).
let reviewItems: ReviewItem[] = [];
let reviewAt = 0;
let showReviewFeedback = false;

/** Persist any pending comment / suggestion writes, then (if the walk is on) re-gather the feedback list.
 *  Used by every comment / suggestion mutation so the bar's loop stays current. */
async function flushReview(): Promise<void> {
  await persistComments();
  await persistSuggestions();
  if (showReviewFeedback) await gatherReview();
}

/** Read every comment + suggestion across the script for the walk (disk is current - flushReview flushed).
 *  The "Show Resolved" toggles ride along, so resolved items join the loop exactly when they are shown. */
async function gatherReview(): Promise<void> {
  reviewItems = currentSceneId
    ? await window.patter.reviewFeedback({ resolvedComments: showResolved, resolvedSuggestions: showResolvedSuggestions })
    : [];
  if (reviewAt >= reviewItems.length) reviewAt = 0;
  renderReviewBar();
}

function renderReviewBar(): void {
  if (!showReviewFeedback) { reviewbarEl.hidden = true; return; }
  reviewbarEl.hidden = false;
  const n = reviewItems.length;
  const multi = n > 1;
  reviewPrevEl.disabled = !multi;
  reviewNextEl.disabled = !multi;
  if (!n) {
    reviewCountEl.textContent = "0";
    reviewKindEl.textContent = "";
    reviewMsgEl.textContent = "No open comments or suggestions.";
    return;
  }
  const item = reviewItems[reviewAt]!;
  reviewCountEl.textContent = `${reviewAt + 1} / ${n}`;
  reviewKindEl.textContent = (item.kind === "comment" ? "Comment" : "Rewrite") + (item.resolved ? " (resolved)" : "");
  reviewMsgEl.textContent = `${item.sceneName} · ${item.author}: ${item.text}`;
}

/** Jump to a feedback item (loading its scene if elsewhere), reveal its beat, and open the relevant
 *  popover (the comment thread / the rewrite review) so the reviewer can act in place. */
async function gotoReviewItem(item: ReviewItem): Promise<void> {
  if (item.sceneId !== currentSceneId) await loadScene(item.sceneId);
  // Jump INSTANTLY (no smooth scroll), so the beat is at its final on-screen position right away - an
  // animated scroll left the anchor mid-flight when we positioned the popover, landing it off-screen.
  surface?.revealNode(item.anchor, { instant: true });
  // One frame for the (off-screen) block's content-visibility to render so the anchor's rect is final.
  requestAnimationFrame(() => {
    const anchor = surface?.anchorFor(item.anchor);
    if (!anchor) return;
    if (item.kind === "comment") openComments({ nodeId: item.anchor, threadId: item.refId, anchor });
    else openSuggestions({ nodeId: item.anchor, anchor });
  });
}

async function stepReview(delta: number): Promise<void> {
  if (!showReviewFeedback) { setReviewFeedback(true); return; } // first press: enter the walk
  if (!reviewItems.length) return;
  reviewAt = (reviewAt + delta + reviewItems.length) % reviewItems.length;
  renderReviewBar();
  await gotoReviewItem(reviewItems[reviewAt]!);
}

/** Review > Review Feedback: enter / leave the looping feedback walk (a remembered mode). */
function setReviewFeedback(on: boolean): void {
  showReviewFeedback = on;
  panes = { ...panes, reviewFeedback: on };
  void window.patter.setPanes(panes);
  // Enter via flushReview, NOT a bare gather: any just-created comment / suggestion whose write is still
  // in flight must land on disk before reviewFeedback() reads it (else the bar misses it).
  if (on) { reviewAt = 0; void flushReview(); } else reviewbarEl.hidden = true;
}

reviewPrevEl.addEventListener("click", () => void stepReview(-1));
reviewNextEl.addEventListener("click", () => void stepReview(1));
reviewCurEl.addEventListener("click", () => { if (reviewItems[reviewAt]) void gotoReviewItem(reviewItems[reviewAt]!); });
reviewCloseEl.addEventListener("click", () => setReviewFeedback(false));

function showInspector(ctx: InspectorContext): void {
  // Remember the caret to the LINE (deepest node id under the selection) on every move - even when the
  // inspector projection below is unchanged (the early-return) - so open-where-you-left-off restores it.
  caretNodeId = ctx.levels.map((l) => (l as { id?: string | null }).id).find((id): id is string => !!id) ?? null;
  scheduleRemember();
  // The nav's block sub-list follows the caret: mark the block the selection sits in (null = scene level).
  const blockLevel = ctx.levels.find((l) => l.kind === "block");
  highlightNavBlock(blockLevel && "id" in blockLevel ? blockLevel.id : null);
  lastInspectorCtx = ctx; // so the global pills/text toggle can re-render this same view in place
  // onSelect fires on every selection move AND every doc edit (typing). The inspector only shows a
  // projection of the caret's container stack, so skip the (pill-rebuilding) teardown when nothing it
  // displays has changed - e.g. typing dialogue text doesn't touch the shown fields. preferText is in
  // the signature so the pills/text toggle still forces a re-theme.
  const sig = `${preferText ? "t" : "p"}|${JSON.stringify(ctx.levels)}`;
  if (sig === lastInspectorSig) return;
  lastInspectorSig = sig;
  const nodeLabel = (nid: string): string => surface?.jumpTargets().find((t) => t.id === nid)?.label ?? nid;
  renderInspector(inspectorStackEl, ctx, {
    reveal: (id) => { surface?.revealNode(id); },
    editNote: (id, anchor, kind) => openNoteEditor(id, anchor, kind), // title-bar note icon -> notes modal
    hasNotes: (id) => (docMap[id]?.length ?? 0) > 0,                   // filled vs outline note icon
    textMode: () => preferText,
    editCondition: (id, src, anchor) => openConditionEditor({
      anchor, src, properties: sceneProps, text: preferText,
      pickNode: (a, current, onPick) => surface?.pickNode({ anchor: a, current, onPick }),
      nodeLabel,
      onChange: (next) => { surface?.setCondition(id, next); },
    }),
    condPreview: (src) => renderConditionPills(src, sceneProps, nodeLabel),
    effectsPreview: (effects) => renderEffectsPills(effects, sceneProps, nodeLabel),
    editGameId: (id, gameId, address, anchor) => openGameIdEditor({ anchor, value: gameId, derived: address, onCommit: (g) => { surface?.setGameId(id, g); } }),
    editGroupProps: (id, patch) => { surface?.setGroupProps(id, patch); },
    editJump: (id, _current, anchor) => surface?.editJump(id, anchor),
    setJumpMode: (id, mode) => { surface?.setJumpMode(id, mode); },
    editEffects: (id, onEnter, onExit, anchor, phase) => openEffectsEditor({ anchor, onEnter, onExit, ...(phase ? { phase } : {}), properties: sceneProps, text: preferText, onChange: (ph, effects) => { surface?.setEffects(id, ph, effects); } }),
    jumpLabel: (id) => surface?.jumpTargets().find((t) => t.id === id)?.label ?? id,
    addOption: (choiceId) => { surface?.addOption(choiceId); },
    removeChunk: (id) => { surface?.deleteChunk(id); },
    moveChunk: (id, dir) => { surface?.moveChunk(id, dir); },
    gameDataFields: (kind) => project?.gameDataFields[kind] ?? [],
    setGameData: (id, key, value) => { surface?.setGameData(id, key, value); },
    setTags: (id, tags) => { surface?.setTags(id, tags); }, // author tags (#215)
    writingStatuses: () => project?.writingStatuses ?? [], // the ladder (name + colour) for the status dropdown (#196)
    lineStatus: (id) => writingMap[id] ?? null,            // the beat's current status, or null (unset)
    setLineStatus: (id, status) => setLineStatus([id], status),
    // Audio only makes sense for a VOICED story (#206): when the project isn't voiced there is no recording
    // status to track, so the inspector shows no recording row (empty ladder), folder mode is off, and
    // scratch is off - regardless of any stored audio config (kept so toggling Voiced back on restores it).
    recordingStatuses: () => (project?.trackAudioStatus ? project.recordingStatuses ?? [] : []), // the recording ladder (name + colour, #206)
    recordingStatus: (id) => recordingMap[id] ?? null,
    setRecordingStatus: (id, status) => setRecordingStatus(id, status),
    audioFoldersOn: () => audioOn(),                          // folder mode (voiced only) -> recording status is read-only
    recordingFolderStatus: (id) => audioIndex[id]?.status ?? null, // folder-derived status (null = missing)
    needsRerecord: (id) => !!rerecordMap[id],                 // "needs re-record" flag (#227)
    setNeedsRerecord: (id, on) => setNeedsRerecord(id, on),
    playRecording: (id, btn) => void playLineAudio(id, btn),  // ▶ play the line's audio (folder mode)
    scratchStatus: () => (project?.trackAudioStatus ? project.scratchStatus ?? null : null), // the rung scratch records into (null = off, #224)
    recordScratch: (id) => void startScratchRecording(id),    // ● record a scratch take for this line
    scratchStale: (id) => {                                   // ⚠ the scratch take no longer matches the line
      const e = audioIndex[id]; const scr = project?.scratchStatus;
      if (!scr || !e || e.status !== scr || e.textHash == null) return false;
      return e.textHash !== textHash(surface?.sayText(id) ?? "");
    },
    sceneProps: () => surface?.sceneProps() ?? [],
    editSceneProps: () => openSceneProps(),
  });
}

async function save(): Promise<void> {
  if (!surface || !currentSceneId || !dirty) return; // nothing edited -> nothing to write (no .patterx bump)
  const { flow, loc } = surface.getSource({ prune: true }); // a real save tidies stray blank text lines
  const res = await window.patter.saveScene(currentSceneId, flow, loc);
  if (res.ok) { setDirty(false); void refreshProblems(); void refreshVcStatus(); } // re-validate + re-badge what's on disk
  else { toast(res.error ? `Save refused: ${res.error}` : "Save failed", "error"); void refreshVcStatus(); }
}

async function loadScene(sceneId: string, opts?: { restoreCaret?: string }): Promise<void> {
  if (!project || sceneId === currentSceneId) return;
  if (surface && dirty) await save();           // files are the truth - persist before switching
  await persistDocs();                          // flush any pending Notes edits before leaving the scene
  await persistComments();                      // flush any pending comment edits too
  closeConditionEditor(); closeEffectsEditor(); closeGameIdEditor(); closeJumpPicker();
  surface?.destroy();
  surface = null;
  editorEl.replaceChildren();
  lastInspectorSig = null; // force the first selection in the new scene to render (don't match the old scene's)

  const { flowSource, locSource, properties } = await window.patter.readScene(sceneId);
  sceneProps = properties; // referenceable properties for this scene's condition editor
  docMap = await window.patter.readDocs(sceneId); docsDirty = false; // typed documentation for this scene
  comments = await window.patter.readComments(sceneId); commentsDirty = false; // threaded comments for this scene
  suggestions = await window.patter.readSuggestions(sceneId); suggestionsDirty = false; // rewrite proposals for this scene
  writingMap = await window.patter.readWriting(sceneId); // per-beat writing status for this scene (#196)
  recordingMap = await window.patter.readRecording(sceneId); // per-beat manual recording status (#206)
  rerecordMap = await window.patter.readRerecord(sceneId);    // per-line "needs re-record" flags (#227)
  if (project?.audioFolders) audioIndex = await window.patter.audioCurrent(); // folder-derived status (#206)
  sceneEdited = false;  // fresh scene: not edited until the user touches it
  mountingScene = true; // the mount's initial-mirror onChange is not a user edit
  surface = mountSurface({
    editor: editorEl,
    hintbar: hintbarEl,
    flowSource,
    locSource,
    formatting: project.formatting,
    castSeed: project.cast,
    // Cross-scene jump targets: every scene + its blocks (the surface adds THIS scene with live blocks).
    jumpTargets: project.scenes.map((s) => ({ id: s.id, label: s.name, blocks: s.blocks.map((b) => ({ id: b.id, label: b.name })) })),
    showTitle: true,
    onChange: () => { if (!mountingScene) { setDirty(true); sceneEdited = true; refreshStaleBadge(); } scheduleValidate(); refreshNavBlocks(); },
    onSelect: showInspector, // drive the detail inspector off the caret's container stack
    onPlayBlock: (blockId) => { if (currentSceneId) void window.patter.openPlay(currentSceneId, blockId); },
    onOpenTarget: (targetId) => void openTarget(targetId), // double-click a jump chip -> follow the divert

    onComments: (req) => openComments(req),
    onEditNote: (nodeId, anchorEl, kind) => openNoteEditor(nodeId, anchorEl, kind),
    onSuggestions: (req) => openSuggestions(req),
    onAddToDictionary: (word) => void addWordToDictionary(word), // "Add to dictionary" on a misspelling (#177)
    onIgnoreWord: (word) => void ignoreWord(word), // "Ignore" on a misspelling: persist + refresh the problems bar (#177)
    onSetWritingStatus: (ids, status) => setLineStatus(ids, status), // "Status" submenu sets the writing status (#196)
    onDuplicate: (idMap) => carryDuplicatedMetadata(idMap), // Duplicate: carry status + notes to the copies
    onAddCharacter: (name) => void registerCharacter(name), // "+ Add" in the cue popup persists to the master cast
  });
  mountingScene = false; // any onChange from here on is a real edit
  currentSceneId = sceneId;
  setDirty(false); // mount fires onChange once (the initial mirror); not a user edit
  highlightNav(sceneId);
  applySceneVc(); // read-only + topbar chip if this scene is locked by another (from the cached snapshot)
  surface.focus();
  // Open-where-you-left-off: on the initial landing load, drop the caret back on the remembered node (it
  // also scrolls it into view). Missing node (edited away since) -> stay at the top, no-op.
  if (opts?.restoreCaret) surface.revealNode(opts.restoreCaret, { instant: true });
  applyProblemMarks(); // re-apply the current problem squiggles to this scene's nodes
  pushDocNotes();      // surface this scene's documentation notes (tooltips + under-heading)
  pushCommentMarks();  // surface this scene's comment bubbles
  pushSuggestionMarks(); // surface this scene's rewrite-proposal pencils
  surface.setSpellChecker(spellChecker); // re-push the cached spell engine to the new surface instance (#177)
  pushWritingStatus();   // surface this scene's writing-status badges + the ladder for the submenu (#196)
  if (showReviewFeedback) void gatherReview(); // re-show the feedback walk bar (mode persists)
  watchSceneTitle();   // fade "<project>: <scene>" into the topbar once the title scrolls out of view
  flushRemember();     // record the scene now (the caret follows via showInspector, debounced)
}

// The topbar shows just the project name while the scene's title is visible at the top of the edit pane;
// once the title scrolls out, fade in ": <scene>" beside it so you always know where you are. Driven by
// an IntersectionObserver rooted at the scroll container, re-wired on every scene mount (new title node).
let titleObserver: IntersectionObserver | null = null;
function watchSceneTitle(): void {
  titleObserver?.disconnect();
  sceneSuffixEl.classList.remove("shown");
  const title = editorEl.querySelector(".scene-title");
  if (!title) return;
  titleObserver = new IntersectionObserver(([e]) => {
    if (!e) return;
    if (e.isIntersecting) sceneSuffixEl.classList.remove("shown");          // title in view -> just <project>
    else { sceneSuffixEl.textContent = `: ${surface?.sceneName() ?? ""}`; sceneSuffixEl.classList.add("shown"); }
  }, { root: editorEl });
  titleObserver.observe(title);
}

async function play(): Promise<void> {
  if (!currentSceneId) return;
  if (dirty) await save();                       // play reflects what's on disk
  await window.patter.openPlay(currentSceneId);  // opens the separate interactive play window
}

/** Play from Start (⇧⌘P): run from the project's start point, prompting to set one if unset. */
async function playFromStart(): Promise<void> {
  if (!project) return;
  const start = await ensureProjectStart();
  if (!start) return; // cancelled / no scenes
  if (dirty) await save();
  await window.patter.openPlay(start.scene, start.block);
}

// --- dual id/handle search (go-to-anything) ----------------------------------
async function jumpTo(entry: SearchEntry): Promise<void> {
  if (entry.sceneId !== currentSceneId) await loadScene(entry.sceneId); // load its scene if elsewhere
  if (entry.kind !== "scene") surface?.revealNode(entry.id);             // then reveal the node
}

/** Follow a divert (double-click on a jump chip): resolve its target id - a scene or a block - to the
 *  owning scene, switch to it if it's elsewhere, then reveal the block (a scene target just opens). */
async function openTarget(targetId: string): Promise<void> {
  if (!project || !targetId || targetId === "END") return;
  const scene = project.scenes.find((s) => s.id === targetId || s.blocks.some((b) => b.id === targetId));
  if (!scene) return;
  if (scene.id !== currentSceneId) await loadScene(scene.id);
  if (scene.id !== targetId) surface?.revealNode(targetId);
}
function openSearch(mode: "content" | "replace" = "content"): void {
  if (!project) return;
  // Open (or focus) the detached, always-on-top search tool window. Anchor content ranking on the editor's
  // caret: the current scene's hits, from the caret onwards, rank first. The merged search also finds a
  // node by its opaque id (the "Go to ID" power-search). `mode` opens straight into Find or Replace.
  const focus = currentSceneId ? { sceneId: currentSceneId, fromBeatId: caretNodeId ?? undefined } : undefined;
  void window.patter.openSearchWindow(mode, focus);
}
/** Status browse (#205, Review menu): open the search window straight into its status mode. */
function openStatusBrowse(): void {
  if (!(project?.writingStatuses ?? []).length) return; // no statuses configured -> nothing to browse
  const focus = currentSceneId ? { sceneId: currentSceneId, fromBeatId: caretNodeId ?? undefined } : undefined;
  void window.patter.openSearchWindow("status", focus);
}
/** Find dialogue lines by recording status (#206): the search window's recording-status browse. */
function openRecordingBrowse(): void {
  if (!project?.voiced) return; // recording status is voiced-only (#206); the menu item is disabled too
  if (!(project?.recordingStatuses ?? []).length) return;
  const focus = currentSceneId ? { sceneId: currentSceneId, fromBeatId: caretNodeId ?? undefined } : undefined;
  void window.patter.openSearchWindow("recording", focus);
}
/** Property-usage search (Review menu): open the search window straight into its property mode, optionally
 *  seeded with a ref (the inspector / coverage "where is @x used?" path). */
function openPropertyUsage(query?: string): void {
  if (!project) return;
  const focus = currentSceneId ? { sceneId: currentSceneId, fromBeatId: caretNodeId ?? undefined } : undefined;
  void window.patter.openSearchWindow("property", focus, query);
}
/** Tag browse (#215, Review menu): open the search window straight into its tag mode. */
function openTagBrowse(): void {
  if (!project) return;
  const focus = currentSceneId ? { sceneId: currentSceneId, fromBeatId: caretNodeId ?? undefined } : undefined;
  void window.patter.openSearchWindow("tag", focus);
}

async function showProject(open: OpenResult): Promise<void> {
  project = open.project;
  debugLink.setVisible(true); // the bottom-right live-debug-link control is available once a project is open
  autosaveOn = project.autosave; // honour the project's autosave setting (default on)
  projectNameEl.textContent = project.name;
  currentSceneId = null;
  await buildSpellcheck(); // build the spell engine before the first scene mounts (#177); it pushes on mount
  // A project opened with a remembered scene drops straight into it; a never-opened one lands on the
  // project overview (#3a) - the shape of the work before a scene (reachable later via the project name).
  if (open.lastScene) {
    enterWorkspace();
    renderNav();
    await loadScene(open.lastScene, { restoreCaret: open.lastCaret });
    signalReady();           // the editor's first scene is mounted - safe to reveal the window (no flash)
    await hydrateProject();  // lazy open (#171): stream in the rest of the scenes before we validate / badge
    void refreshProblems(); // validate the project on open
    void refreshVcStatus(); // badge the scenes + apply read-only from the VC snapshot
  } else {
    await showOverview();
  }
}

/** Switch the chrome to the editing WORKSPACE (panes + toggles), leaving welcome / overview. */
function enterWorkspace(): void {
  welcomeEl.hidden = true; overviewEl.hidden = true; panesEl.hidden = false;
  toggleNavEl.hidden = false; toggleInspectorEl.hidden = false; // pane toggles only matter in the workspace
  applyPanes();
}

// --- project overview (#3a) --------------------------------------------------
// A calm landing for the open project: a clickable scene index + headline stats (counts + drafted
// progress, from the production report). Shown on a never-opened project and on demand (the project name
// / View menu). Picking a scene drops into the workspace.

/** Show the overview for the open project: render the scene index now, then fill the stats from the
 *  production report (which also hydrates the rest of the project for the full scene list). */
async function showOverview(): Promise<void> {
  if (!project) return;
  if (surface && dirty) await save(); // files are the truth - persist before leaving the editor
  welcomeEl.hidden = true; panesEl.hidden = true; overviewEl.hidden = false;
  toggleNavEl.hidden = true; toggleInspectorEl.hidden = true;
  problembarEl.hidden = true; reviewbarEl.hidden = true; // the overview is a calm screen, no bars
  projectNameEl.textContent = project.name;
  titleObserver?.disconnect(); titleObserver = null; sceneSuffixEl.classList.remove("shown"); sceneSuffixEl.textContent = "";
  await hydrateProject(); // the index needs every scene, not just the lazy-loaded landing one
  renderOverview();
  signalReady();          // the overview (scene index) is up - safe to reveal the window (no-op if already)
  const data = await window.patter.report();
  if (data && !overviewEl.hidden) fillOverviewStats(data); // ignore if we already navigated away
}

/** Build the scene index + a placeholder stats line (the real counts arrive async from the report). */
function renderOverview(): void {
  if (!project) return;
  overviewTitleEl.textContent = project.name;
  const n = project.scenes.length;
  overviewStatsEl.textContent = `${n} ${n === 1 ? "scene" : "scenes"}`;
  overviewProgressEl.hidden = true;
  overviewScenesEl.replaceChildren();
  for (const s of project.scenes) {
    const b = document.createElement("button");
    b.className = "overview-scene"; b.type = "button"; b.textContent = s.name;
    b.addEventListener("click", () => void openSceneFromOverview(s.id));
    overviewScenesEl.appendChild(b);
  }
}

/** Fill the headline stats from the production report: scene count, total words / lines, drafted %. */
function fillOverviewStats(data: ReportData): void {
  if (!project) return;
  const t = data.totals;
  const n = project.scenes.length;
  const fmt = (x: number): string => x.toLocaleString();
  overviewStatsEl.textContent = `${n} ${n === 1 ? "scene" : "scenes"} · ${fmt(t.written.words)} words · ${fmt(t.written.count)} ${t.written.count === 1 ? "line" : "lines"}`;
  const pct = t.projectedWritten > 0 ? Math.round((100 * t.writtenDone) / t.projectedWritten) : 0;
  overviewBarFillEl.style.width = `${pct}%`;
  overviewProgressLabelEl.textContent = `${pct}% drafted`;
  overviewProgressEl.hidden = false;
}

/** Open a scene picked from the overview index: into the workspace, mounting it (no-op if it's already
 *  the open scene - returning from the overview keeps the mounted surface). */
async function openSceneFromOverview(sceneId: string): Promise<void> {
  enterWorkspace();
  renderNav();
  await loadScene(sceneId);
  void refreshProblems();
  void refreshVcStatus();
}

// Lazy open (#171): a project arrives landing-scene-FIRST - only the painted scene is in the nav. Once it
// is up, ask the main process to finish parsing and swap in the FULL scene list, reconciling the nav rows
// and the surface's cross-scene jump targets. A no-op for a single-scene project (nothing streamed in).
async function hydrateProject(): Promise<void> {
  const full = await window.patter.hydrate();
  if (!full || !project || full.root !== project.root) return; // no project, or switched away meanwhile
  if (full.scenes.length === project.scenes.length) return;    // already complete - nothing more to show
  project = full;
  renderNav();
  if (currentSceneId) highlightNav(currentSceneId);
  // Refresh the surface's cross-scene jump targets so the divert picker now offers every scene + block.
  surface?.setJumpTargets(project.scenes.map((s) => ({ id: s.id, label: s.name, blocks: s.blocks.map((b) => ({ id: b.id, label: b.name })) })));
}

// --- welcome screen ----------------------------------------------------------

function renderRecents(recents: RecentProject[]): void {
  recentsEl.replaceChildren();
  recentsLabel.hidden = recents.length === 0;
  for (const r of recents) {
    const li = document.createElement("li");
    const b = document.createElement("button"); b.className = "recent-item"; b.type = "button";
    const name = document.createElement("span"); name.className = "recent-name"; name.textContent = r.name;
    const path = document.createElement("span"); path.className = "recent-path"; path.textContent = r.path;
    b.append(name, path);
    b.addEventListener("click", () => void openPath(r.path));
    li.appendChild(b); recentsEl.appendChild(li);
  }
}

function showWelcome(state: BootState): void {
  closeConditionEditor(); closeEffectsEditor(); closeGameIdEditor(); closeJumpPicker();
  surface?.destroy(); surface = null; project = null; currentSceneId = null;
  debugLink.setVisible(false); // no project -> hide the live-debug-link control
  titleObserver?.disconnect(); titleObserver = null; sceneSuffixEl.classList.remove("shown"); sceneSuffixEl.textContent = ""; // no scene -> no suffix
  vcMap.clear(); vcsSceneEl.hidden = true; panesEl.classList.remove("vcs-readonly"); // no project -> no VC state
  comments = []; commentsDirty = false; // no project -> no comments
  suggestions = []; suggestionsDirty = false; // no project -> no suggestions
  reviewItems = []; reviewbarEl.hidden = true; // no project -> no feedback walk
  panesEl.hidden = true; overviewEl.hidden = true; welcomeEl.hidden = false;
  problembarEl.hidden = true; inspectorStackEl.replaceChildren(); lastInspectorCtx = null; lastInspectorSig = null; // no script -> nothing to inspect
  toggleNavEl.hidden = true; toggleInspectorEl.hidden = true;
  projectNameEl.textContent = "Patterpad";
  renderRecents(state.recents);
  signalReady(); // the welcome screen is up - safe to reveal the window (no-op if already revealed)
}

async function openPath(path: string): Promise<void> {
  try { await showProject(await window.patter.openPath(path)); }
  catch { showWelcome(await window.patter.forget(path)); } // moved / deleted -> drop it, back to welcome
}

async function openDialog(): Promise<void> { const r = await window.patter.openDialog(); if (r) await showProject(r); }

/** File ▸ Save As: flush every pending edit (so the on-disk bytes are current), then ask main to duplicate
 *  the project folder to a name / location the user picks and open the copy. Carries on in the duplicate. */
async function saveAs(): Promise<void> {
  if (!project) return; // nothing open
  if (surface && dirty) await save(); // pending text edits
  await persistDocs();                // pending Notes
  await persistComments();            // pending comments
  const r = await window.patter.saveAs();
  if (r) await showProject(r);
}

/** File > Project Settings: read the project-level settings, populate the modal (General + Game Data
 *  tabs), save on confirm. */
/** File > Production Information: a read-only render of the production report (spec §13). Flushes any
 *  pending scene edits (tags, text) first so the figures are current, recomputes off the loaded project,
 *  then shows it in a themed modal. */
async function openReport(): Promise<void> {
  if (!project) return; // nothing open
  if (surface && dirty) await save(); // persist pending edits so the report reflects them, not the last save
  const data = await window.patter.report();
  if (!data) return;
  renderReport(reportHost, data);
  reportHost.scrollTop = 0;
  reportDialogEl.showModal();
  updateReportScrollHints(); // measure only after showModal - a hidden dialog reads clientHeight 0
}

/** Review > Run Coverage Test: open the detached coverage window (prompting for a project start first if
 *  it is unset). The window runs the sweep + keeps its results live while you edit. */
async function openCoverage(): Promise<void> {
  if (!project) return;
  if (!(await ensureProjectStart())) return; // need a start before coverage is meaningful
  await window.patter.openCoverageWindow();
}

/** File > Export Voice Script: a small modal with the "everything" toggle, then a native Save dialog. */
function openVoiceScript(): void {
  if (!project) return;
  if (!project.voiced) { toast("Voice scripts are only available for a voiced project (Project Settings ▸ Voiced)."); return; } // #206
  voEverythingInput.checked = false;
  voStatus.textContent = "";
  voDialogEl.showModal();
}
async function voiceScriptExport(): Promise<void> {
  voStatus.textContent = "Exporting…";
  const res = await window.patter.exportVoiceScript(voEverythingInput.checked);
  if (res.ok) { voDialogEl.close(); toast(`Voice script exported to ${res.path}`); } // done -> close, confirm via toast
  else if (res.canceled) voStatus.textContent = "";
  else voStatus.textContent = `Export failed: ${res.error ?? "unknown error"}`;
}

/** File > Export / Import Localisation (also the button in the Language settings tab): a modal over the
 *  shared loc engine: export strings in a chosen format/locale, import a translated file back. */
async function openLocalisation(): Promise<void> {
  if (!project) return; // nothing open
  const s = await window.patter.readSettings();
  if (!s) return;
  locLocaleSel.replaceChildren();
  locLocaleSel.append(new Option("Template (source, untranslated)", ""));
  for (const loc of s.locales) if (loc !== s.localeDefault) locLocaleSel.append(new Option(loc, loc));
  locStatus.textContent = "";
  locDialogEl.showModal();
}

async function localisationExport(): Promise<void> {
  const format = locFormatSel.value as "json" | "xlsx" | "po";
  const locale = locLocaleSel.value || undefined; // "" = template
  locStatus.textContent = "Exporting…";
  const res = await window.patter.exportLoc({ format, locale });
  if (res.ok) locStatus.textContent = `Exported to ${res.path}`;
  else if (res.canceled) locStatus.textContent = "";
  else locStatus.textContent = `Export failed: ${res.error ?? "unknown error"}`;
}

async function localisationImport(): Promise<void> {
  const fallback = locLocaleSel.value || undefined; // used when the file carries no locale (Excel)
  locStatus.textContent = "Importing…";
  const res = await window.patter.importLoc(fallback);
  if (res.ok) {
    locStatus.textContent = `Imported ${res.updated ?? 0} string(s) for ${res.locale} across ${res.files ?? 0} scene(s).`;
    await refreshProblems(); // the bundle is now stale relative to the new strings
  } else if (res.canceled) locStatus.textContent = "";
  else locStatus.textContent = `Import failed: ${res.error ?? "unknown error"}`;
}

/** File > Export Production Info (also the button in the report view): render the report to an xlsx and
 *  save it through a native dialog. On success, briefly confirms on the button it was triggered from. */
async function exportProductionInfo(btn?: HTMLButtonElement): Promise<void> {
  if (!project) return; // nothing open
  if (surface && dirty) await save(); // flush pending edits so the exported figures are current
  const res = await window.patter.exportReport();
  if (res.ok) {
    if (btn) { const prev = btn.textContent; btn.textContent = "Exported ✓"; btn.disabled = true;
      setTimeout(() => { btn.textContent = prev; btn.disabled = false; }, 1600); }
  } else if (res.error) console.error("Export production info failed:", res.error);
}

/** Publish Bundle (Publish menu): compile + write the runtime `.patterc` to the configured output path. */
async function buildBundle(): Promise<void> {
  if (!project) return;
  const res = await window.patter.buildBundle();
  if (res.ok) {
    // Show where it landed RELATIVE to the project root when it's inside (the common dist/ case), so the
    // toast reads cleanly; fall back to the absolute path for an output written elsewhere.
    const where = res.path && res.path.startsWith(project.root) ? res.path.slice(project.root.length).replace(/^[/\\]/, "") : res.path;
    toast(`Bundle published\n${where}`);
  } else toast(res.error ? `Publish failed: ${res.error}` : "Publish failed", "error");
}

/** Production ▸ Update Audio Manifest (#206): rewrite the sidecar patteraudio.json from the audio folders. */
async function buildAudioManifest(): Promise<void> {
  if (!project) return;
  const res = await window.patter.buildAudioManifest();
  if (res.ok) {
    const where = res.path && res.path.startsWith(project.root) ? res.path.slice(project.root.length).replace(/^[/\\]/, "") : res.path;
    toast(`Audio manifest updated\n${where}`);
  } else toast(res.error ? `Audio manifest failed: ${res.error}` : "Audio manifest failed", "error");
}

/** File ▸ Publish Readable Script: write a .pdf / .docx screenplay of the whole script + flow (format
 *  chosen in the native Save dialog in main); toast the result. */
async function exportScript(): Promise<void> {
  if (!project) return;
  const res = await window.patter.exportScript();
  if (res.ok) {
    const where = res.path && res.path.startsWith(project.root) ? res.path.slice(project.root.length).replace(/^[/\\]/, "") : res.path;
    toast(`Script published\n${where}`);
  } else if (!res.canceled) toast(res.error ? `Publish failed: ${res.error}` : "Publish failed", "error");
}

/** File ▸ Export as Patterpack: flush pending edits (so the packed bytes are current), then ask main to zip
 *  the whole project into one `.patterpack` file the writer can send to someone. Native Save dialog in main. */
async function exportPatterpack(): Promise<void> {
  if (!project) return;
  if (surface && dirty) await save(); // pending text edits
  await persistDocs();                // pending Notes
  await persistComments();            // pending comments
  const res = await window.patter.exportPatterpack();
  if (res.ok) {
    const where = res.path && res.path.startsWith(project.root) ? res.path.slice(project.root.length).replace(/^[/\\]/, "") : res.path;
    toast(`Patterpack exported\n${where}`);
  } else if (!res.canceled) toast(res.error ? `Export failed: ${res.error}` : "Export failed", "error");
}

/** File ▸ Open Patterpack: pick a `.patterpack` file, choose a destination folder, unpack, and switch to
 *  the new project (main runs both dialogs). Null when either picker is cancelled. */
async function openPatterpack(): Promise<void> {
  const r = await window.patter.openPatterpack();
  if (r) await showProject(r);
}

/** Publish ▸ Publish for Web: write the story to a FOLDER as a customisable page (index.html +
 *  style.css published once and then kept; story.js + patterplay.js refreshed every publish). */
async function exportWeb(): Promise<void> {
  if (!project) return;
  const res = await window.patter.exportWeb();
  if (res.ok) {
    toast(res.kept?.length ? `Story updated\nkept your ${res.kept.join(" + ")}` : `Web page published\n${res.path ?? ""}`);
  } else if (!res.canceled) toast(res.error ? `Publish failed: ${res.error}` : "Publish failed", "error");
}

/** Publish ▸ Publish Playable HTML: write a single self-contained `.html` (runtime + story inlined) that
 *  plays the whole project offline in any browser. Native Save dialog in main; toast the result. */
async function exportPlayableHtml(): Promise<void> {
  if (!project) return;
  const res = await window.patter.exportPlayableHtml();
  if (res.ok) {
    const where = res.path && res.path.startsWith(project.root) ? res.path.slice(project.root.length).replace(/^[/\\]/, "") : res.path;
    toast(`Playable HTML published\n${where}`);
  } else if (!res.canceled) toast(res.error ? `Publish failed: ${res.error}` : "Publish failed", "error");
}

async function openProjectSettings(initialTab = "general"): Promise<void> {
  if (!project) return; // nothing open
  const s = await window.patter.readSettings();
  if (!s) return;
  setNameInput.value = s.name;
  // Start scene picker: "(unset)" plus every scene; select the project's current start.
  setStartSel.replaceChildren(new Option("(unset)", ""));
  for (const sc of project.scenes) setStartSel.append(new Option(sc.name, sc.id));
  setStartSel.value = s.start?.scene ?? "";
  setVcsSel.value = s.vcs;
  setVoicedInput.checked = s.voiced;
  syncAudioSettingsTab(); // gate the Audio tab on the project's Voiced state (#206)
  setFormattingInput.checked = s.formatting;
  setAutosaveInput.checked = s.autosave;
  setAutoRebuildInput.checked = s.autoRebuild;
  setCcOpenInput.value = s.closedCaptions.open;
  setCcCloseInput.value = s.closedCaptions.close;
  setCcCharacterInput.value = s.closedCaptions.character;
  syncCcDelimWarn();
  setBuildInput.value = s.buildBundle;
  setBuildLocalesSel.value = s.buildLocalisation;
  setBuildSourceDebug.checked = s.buildSourceDebug;
  syncBuildLocaleRows();
  // Language / Game Data / Properties / Cast tabs: mount each editor with the project's current data.
  const langs = mountLanguages(setLanguagesHost, { localeDefault: s.localeDefault, locales: s.locales });
  const gd = mountGameDataFields(setGameDataHost, s.gameDataFields);
  const props = mountProperties(setPropsHost, s.properties);
  const world = mountWorld(setWorldHost, { scopeRegistry: s.scopeRegistry, coverageDrivers: s.coverageDrivers, onPropose: () => window.patter.proposeCoverageDrivers() });
  const cast = mountCast(setCastHost, s.cast);
  const writingStatus = mountWritingStatus(setWritingStatusHost, s.writingStatuses);
  const estimating = mountEstimating(setEstimatingHost, s.estimating, s.writingStatuses);
  const audio = mountAudio(setRecordingStatusHost, { trackAudioStatus: s.trackAudioStatus, statuses: s.recordingStatuses, audioFolders: s.audioFolders, audioRoot: s.audioRoot, scratchStatus: s.scratchStatus });
  // Dictionary tab (#177): the available dictionaries (built-ins + imports) drive the picker; Import / Remove
  // route through the main process.
  const dictionary = mountDictionary(setDictionaryHost, {
    language: s.dictionaryLanguage, words: s.dictionaryWords, ignore: s.dictionaryIgnore, enabled: s.dictionaryEnabled,
    dictionaries: await window.patter.listDictionaries(),
    onImport: () => window.patter.importDictionary(),
    onRemove: (id) => window.patter.removeDictionary(id),
  });
  const showTab = (tab: string): void => {
    for (const t of settingsDialogEl.querySelectorAll<HTMLElement>(".settings-tab")) t.classList.toggle("active", t.dataset["tab"] === tab);
    for (const p of settingsDialogEl.querySelectorAll<HTMLElement>(".settings-panel")) p.hidden = p.dataset["panel"] !== tab;
  };
  // Open on the requested tab (General by default; the coverage window's "World Properties…" opens "world").
  showTab(initialTab);
  // Duplicate-name gate: two entries sharing a name in Properties / Game Data / Cast / World Properties is a data
  // hazard, so block the Save submit, jump to the offending tab, and focus the clashing (red) field.
  const settingsForm = settingsDialogEl.querySelector("form")!;
  const setErrorEl = $("set-error"); setErrorEl.hidden = true;
  const dupTabs: Array<[string, { firstDuplicate(): HTMLInputElement | null }]> = [["properties", props], ["gamedata", gd], ["cast", cast], ["world", world]];
  const onSubmit = (e: Event): void => {
    for (const [tab, h] of dupTabs) {
      const bad = h.firstDuplicate();
      if (!bad) continue;
      e.preventDefault(); // keep the dialog open
      showTab(tab);
      setErrorEl.textContent = "Two entries share a name. Names must be unique."; setErrorEl.hidden = false;
      setTimeout(() => { bad.scrollIntoView({ block: "nearest" }); bad.focus(); }, 0);
      return;
    }
  };
  settingsForm.addEventListener("submit", onSubmit);
  // Enter in any field must NOT implicitly submit (and close) the settings dialog - it should just accept the
  // value and stay. Only the explicit Save button submits; a textarea keeps its newline.
  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key !== "Enter" || e.isComposing) return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "TEXTAREA" || tag === "BUTTON") return;
    e.preventDefault();
  };
  settingsForm.addEventListener("keydown", onKeydown);
  const onClose = (): void => {
    settingsDialogEl.removeEventListener("close", onClose);
    settingsForm.removeEventListener("submit", onSubmit);
    settingsForm.removeEventListener("keydown", onKeydown);
    if (settingsDialogEl.returnValue !== "save") return;
    const name = setNameInput.value.trim();
    if (!name) return; // name is required; a blank submit is treated as a cancel
    void saveProjectSettings({
      name, vcs: setVcsSel.value as VcsKind, ...(setStartSel.value ? { start: { scene: setStartSel.value } } : {}),
      voiced: setVoicedInput.checked, formatting: setFormattingInput.checked, autosave: setAutosaveInput.checked,
      autoRebuild: setAutoRebuildInput.checked,
      closedCaptions: { open: setCcOpenInput.value, close: setCcCloseInput.value, character: setCcCharacterInput.value.trim() },
      buildBundle: setBuildInput.value.trim(), buildLocalisation: setBuildLocalesSel.value as "embedded" | "ids", buildSourceDebug: setBuildSourceDebug.checked,
      ...langs.value(), gameDataFields: gd.value(),
      properties: props.value(), ...world.value(), cast: cast.value(),
      writingStatuses: writingStatus.value(), estimating: estimating.value(), ...audio.value(),
      ...dictionary.value(),
    });
  };
  settingsDialogEl.addEventListener("close", onClose);
  settingsDialogEl.showModal();
  setTimeout(() => setNameInput.focus(), 0);
}

async function saveProjectSettings(s: ProjectSettingsDto): Promise<void> {
  const res = await window.patter.saveSettings(s);
  if (!res.ok) { console.error("Save settings failed:", res.error); return; }
  if (res.project) {
    project = res.project; projectNameEl.textContent = project.name; autosaveOn = project.autosave;
    // The project's @patter properties may have changed (added / renamed / re-typed / enum values edited):
    // rebuild the condition-editor catalogue so they're selectable immediately, without a scene reload or a
    // restart. Mirrors openSceneProps for the scene scope; keeps the load-time order (@patter first). New
    // default values reach the run through the play window's live refresh (the main process triggers it).
    sceneProps = [
      ...s.properties.map((d): ConditionProperty => ({ scope: "patter", name: d.name, type: d.type, ...(d.values ? { enumValues: d.values } : {}), ...(d.purpose ? { purpose: d.purpose } : {}) })),
      ...sceneProps.filter((p) => p.scope !== "patter"),
    ];
    await buildSpellcheck(); // the Dictionary settings (language / words / on-off) may have changed (#177)
    void refreshProblems();  // refresh the spelling entries in the problems panel for the new setup
    pushWritingStatus(); // the writing-status ladder (names / colours) may have changed - re-push to the surface (#196)
    lastInspectorSig = null; if (lastInspectorCtx) showInspector(lastInspectorCtx); // refresh the status dropdown + condition pills
  }
}

/** Scene inspector > Properties: edit the open scene's local `@scene` property declarations. Persists
 *  through the surface (the scene doc's raw, round-tripped on save) and refreshes the condition
 *  catalogue so the new props are usable immediately. */
function openSceneProps(): void {
  if (!surface) return;
  const handle = mountProperties(spHost, surface.sceneProps(), { scope: "scene" });
  const onClose = (): void => {
    scenePropsDialogEl.removeEventListener("close", onClose);
    if (scenePropsDialogEl.returnValue !== "save" || !surface) return;
    const next = handle.value();
    surface.setSceneProps(next); // dispatches a doc edit -> the surface's onChange marks dirty + revalidates
    sceneProps = [
      ...sceneProps.filter((p) => p.scope !== "scene"),
      ...next.map((d): ConditionProperty => ({ scope: "scene", name: d.name, type: d.type, ...(d.values ? { enumValues: d.values } : {}), ...(d.purpose ? { purpose: d.purpose } : {}) })),
    ];
    lastInspectorSig = null; // the count isn't in the level signature - force the Scene row to re-render
    if (lastInspectorCtx) showInspector(lastInspectorCtx);
  };
  scenePropsDialogEl.addEventListener("close", onClose);
  scenePropsDialogEl.showModal();
}

/** The folder a project name will be saved as (mirrors the main process's patterFolderName, for preview). */
const patterFolderPreview = (name: string): string =>
  `${name.trim().replace(/[/\\]+/g, "-").replace(/\s+/g, " ") || "your-project"}.patter`;

/** The default Build output for a project name (mirrors the main process's sibling-`patter-dist/`
 *  default + ops `slug`), so the New-project field prefills the same path Project Settings would show.
 *  A SIBLING folder, never inside the `.patter` package. */
const buildDefaultFor = (name: string): string =>
  `../patter-dist/${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "_"}.patterc`;

/** The themed New-project dialog (placeholder: just the name for now). Resolves the chosen name, or
 *  null if cancelled / dismissed. The system folder picker (where to keep it) follows in createDialog. */
function promptNewProjectName(): Promise<string | null> {
  createNameInput.value = "";
  createBuildInput.value = "";
  // The Build output prefills (and tracks the name) until the author edits it themselves.
  let buildTouched = false;
  const onBuildInput = (): void => { buildTouched = true; };
  const sync = (): void => {
    createPreviewEl.textContent = patterFolderPreview(createNameInput.value);
    if (!buildTouched) createBuildInput.value = buildDefaultFor(createNameInput.value);
  };
  sync();
  return new Promise((resolve) => {
    const onInput = (): void => sync();
    const onClose = (): void => {
      createNameInput.removeEventListener("input", onInput);
      createBuildInput.removeEventListener("input", onBuildInput);
      createDialogEl.removeEventListener("close", onClose);
      const name = createNameInput.value.trim();
      resolve(createDialogEl.returnValue === "create" && name ? name : null);
    };
    createNameInput.addEventListener("input", onInput);
    createBuildInput.addEventListener("input", onBuildInput);
    createDialogEl.addEventListener("close", onClose);
    createDialogEl.showModal();
    setTimeout(() => createNameInput.focus(), 0);
  });
}

async function createDialog(): Promise<void> {
  const name = await promptNewProjectName();
  if (!name) return;                                  // cancelled the name step
  const vcs = createVcsSel.value as VcsKind;          // the chosen version-control system
  const buildBundle = createBuildInput.value.trim() || undefined; // where Build Bundle will write
  const r = await window.patter.createDialog(name, vcs, buildBundle); // pick a location, then scaffold <name>.patter
  if (r) await showProject(r);
}

// --- first run ---------------------------------------------------------------

// First run only: prompt when there's no identity yet (skippable; main fills a default name if blank).
function ensureIdentity(current: Identity | null): Promise<void> {
  return current ? Promise.resolve() : showIdentityDialog(null, "welcome");
}

// The identity dialog in one of two modes: "welcome" (first run) or "edit" (File / app menu ▸ User
// Information, prefilled). Name is optional; on close we refresh the local author name used to stamp new
// comments. A blank name is defaulted by main (the OS user name); cancelling in edit mode changes nothing.
function showIdentityDialog(current: Identity | null, mode: "welcome" | "edit"): Promise<void> {
  (identityDialog.querySelector(".identity-title") as HTMLElement).textContent = mode === "welcome" ? "Welcome to Patterpad" : "User information";
  (identityDialog.querySelector(".identity-sub") as HTMLElement).textContent =
    "Your name tags your edits and signs your review comments. Leave it blank to use your computer's user name. You can change it any time from the menu.";
  $<HTMLButtonElement>("identity-save").textContent = mode === "welcome" ? "Continue" : "Save";
  nameInput.value = current?.name ?? "";
  emailInput.value = current?.email ?? "";
  identityDialog.returnValue = "";
  return new Promise((resolve) => {
    const onClose = (): void => {
      identityDialog.removeEventListener("close", onClose);
      void (async () => {
        if (identityDialog.returnValue === "save") {
          const name = nameInput.value.trim();
          const email = emailInput.value.trim();
          await window.patter.setIdentity({ name, ...(email ? { email } : {}) });
        } else if (mode === "welcome") {
          await window.patter.setIdentity({ name: "" }); // skipped: store the default so we don't re-prompt
        }
        authorName = (await window.patter.getIdentity())?.name ?? authorName;
        resolve();
      })();
    };
    identityDialog.addEventListener("close", onClose);
    identityDialog.showModal();
  });
}

// --- boot --------------------------------------------------------------------

// Tell the main process to reveal the window, ONCE, the moment our initial view is mounted (the restored
// editor or the welcome screen). The window is created hidden so the user never sees the pre-boot chrome
// flash before the editor swaps in. Signalled via a task (the IPC), not requestAnimationFrame - rAF is
// throttled while the window is hidden, so it would never fire. Safe to call from any view: it no-ops after
// the first, so later project opens (when the window is already shown) don't re-trigger it.
let appRevealed = false;
function signalReady(): void {
  if (appRevealed) return;
  appRevealed = true;
  window.patter.appReady();
}

async function boot(): Promise<void> {
  initTooltips(); // our themed tooltip controller (one delegated listener over the whole document)
  // Autosave: one timer for the app's life; save() no-ops when idle (no dirty scene) or autosave is off.
  window.setInterval(() => { if (autosaveOn) void save(); }, AUTOSAVE_MS);
  window.addEventListener("beforeunload", flushRemember); // closing mid-debounce still records caret + scene
  const state = await window.patter.boot();
  panes = state.panes; // restore the remembered slide/pin state
  docHidden = new Set(panes.docHidden ?? []); // restore the remembered documentation-class visibility
  lineStatusShown = panes.lineStatusShown ?? []; // restore the remembered Line-Status shown set (default none)
  // Review-session toggles ALWAYS start off - they are not remembered (main also resets them on disk at
  // launch, so the Review-menu checkmarks agree). Avoids a forgotten "show resolved" carrying over.
  showResolved = false;
  showResolvedSuggestions = false;
  showReviewFeedback = false;
  theme = state.theme; applyTheme(); // restore the remembered colour / font theme
  await ensureIdentity(state.identity);
  authorName = (await window.patter.getIdentity())?.name ?? state.identity?.name ?? ""; // stamp comments
  if (state.open) await showProject(state.open);
  else showWelcome(state);
}

// Welcome-screen CTAs (the in-window primary actions). All other commands come from the app menus.
$<HTMLButtonElement>("welcome-open").addEventListener("click", () => void openDialog());
$<HTMLButtonElement>("welcome-new").addEventListener("click", () => void createDialog());
toggleNavEl.addEventListener("click", () => togglePane("nav"));
toggleInspectorEl.addEventListener("click", () => togglePane("inspector"));
// The project name is the way back to the project overview (#3a) - a no-op on the welcome screen.
projectNameEl.addEventListener("click", () => { if (project && overviewEl.hidden) void showOverview(); });
projectNameEl.style.cursor = "pointer";

// Find (⌘/Ctrl-F) and Replace (⌘⌥F on macOS, Ctrl-H elsewhere) open the detached search window via the
// Edit-menu accelerators (relayed through onMenu below as "find" / "replace"), so they fire regardless of
// focus - no renderer keydown needed.
// Writing View toggles via the View-menu accelerator (Cmd/Ctrl-M), relayed through onMenu below - a
// native accelerator fires regardless of focus, so it works inside the editor too.

// Native-menu commands (File / Run / Edit / View) relayed from the main process.
window.patter.onMenu((cmd) => {
  if (cmd === "new") void createDialog();
  else if (cmd === "new-scene") newScenePrompt();
  else if (cmd === "delete-scene") void deleteScenePrompt();
  else if (cmd === "open") void openDialog();
  else if (cmd === "open-patterpack") void openPatterpack();
  else if (cmd === "save") void save();
  else if (cmd === "save-as") void saveAs();
  else if (cmd === "export-patterpack") void exportPatterpack();
  else if (cmd === "find") openSearch();
  else if (cmd === "replace") openSearch("replace");
  else if (cmd === "play") void play();
  else if (cmd === "play-from-start") void playFromStart();
  else if (cmd === "duplicate") surface?.duplicate();
  else if (cmd === "undo") surface?.undo();
  else if (cmd === "redo") surface?.redo();
  else if (cmd === "toggle-nav") togglePane("nav");
  else if (cmd === "toggle-inspector") togglePane("inspector");
  else if (cmd === "reset-view") resetView();
  else if (cmd === "project-overview") { if (project) void showOverview(); }
  else if (cmd === "toggle-writing-view") toggleWritingView();
  else if (cmd === "line-status:all") setLineStatusShown((project?.writingStatuses ?? []).map((s) => s.name));
  else if (cmd === "line-status:none") setLineStatusShown([]);
  else if (cmd.startsWith("line-status:toggle:")) toggleLineStatus(cmd.slice("line-status:toggle:".length));
  else if (cmd.startsWith("toggle-doc:")) toggleDocClass(cmd.slice("toggle-doc:".length));
  else if (cmd === "toggle-comments-resolved") setShowResolved(!showResolved);
  else if (cmd === "toggle-suggestions-resolved") setShowResolvedSuggestions(!showResolvedSuggestions);
  else if (cmd === "toggle-review-feedback") setReviewFeedback(!showReviewFeedback);
  else if (cmd === "review-next") void stepReview(1);
  else if (cmd === "review-prev") void stepReview(-1);
  else if (cmd === "find-by-status") openStatusBrowse();
  else if (cmd === "find-by-recording") openRecordingBrowse();
  else if (cmd === "find-property") openPropertyUsage();
  else if (cmd === "find-by-tag") openTagBrowse();
  else if (cmd === "spelling:toggle") void setDictionaryFromMenu({ enabled: !(project?.dictionary.enabled ?? true) });
  else if (cmd.startsWith("spelling:dict:")) void setDictionaryFromMenu({ language: cmd.slice("spelling:dict:".length) });
  else if (cmd === "coverage-test") void openCoverage();
  else if (cmd === "debug-link") debugLink.toggle();
  else if (cmd === "project-settings") void openProjectSettings();
  else if (cmd === "user-info") void window.patter.getIdentity().then((id) => showIdentityDialog(id, "edit"));
  else if (cmd === "build-bundle") void buildBundle();
  else if (cmd === "toggle-auto-rebuild") void window.patter.toggleAutoRebuild();
  else if (cmd === "publish-web") void exportWeb();
  else if (cmd === "audio-manifest") void buildAudioManifest();
  else if (cmd === "production-report") void openReport();
  else if (cmd === "export-production-info") void exportProductionInfo();
  else if (cmd === "localisation") void openLocalisation();
  else if (cmd === "voice-script") openVoiceScript();
  else if (cmd === "playable-html") void exportPlayableHtml();
  else if (cmd === "export-script") void exportScript();
  else if (cmd.startsWith("theme:colour:")) setTheme({ colour: cmd.slice("theme:colour:".length) as ColourTheme });
  else if (cmd.startsWith("theme:font:")) setTheme({ font: cmd.slice("theme:font:".length) as FontTheme });
  else if (cmd.startsWith("open-recent:")) void openPath(cmd.slice("open-recent:".length));
  // Themed About surface (reuses the update-dialog chrome) - never the stock OS panel. Version rides in the cmd.
  else if (cmd.startsWith("about:")) void showUpdaterDialog({
    wordmark: true,
    message: "Patterpad",
    detail: `Version ${cmd.slice("about:".length)}\n\nA writer-first editor for branching game dialogue.\n\nPart of PatterKit. Open source under the MIT license.\nMade by Ian Thomas.`,
    links: [
      { label: "patterkit.dev", url: "https://patterkit.dev" },
      { label: "wildwinter.bio.link", url: "https://wildwinter.bio.link" },
    ],
    buttons: ["Close"],
  });
});

// The play window drives the editor step-marker: the playhead (markLine, leaving a visited trail)
// and a reset that clears the trail on a fresh run. When play crosses into another scene, SWITCH the
// editor to it first so the marker stays visible. Marks arrive in a rapid burst (a Continue plays many
// beats), so serialize them on a promise chain - otherwise two marks for a new scene would both fire
// loadScene before currentSceneId updates, double-loading it.
let markChain: Promise<void> = Promise.resolve();
window.patter.onPlayMark((id, sceneId) => {
  markChain = markChain.then(async () => {
    if (sceneId && sceneId !== currentSceneId) await loadScene(sceneId);
    surface?.markLine(id);
  }).catch(() => {}); // a failed scene load shouldn't wedge the chain
});
window.patter.onPlayReset(() => surface?.resetPlay());
// A hit was chosen in the detached search window: jump the editor to it (loadScene + centred reveal).
window.patter.onSearchNavigate((entry) => void jumpTo(entry));
// Project-wide Replace (driven from the search window): main asks us to flush the open scene before it
// rewrites the shards, then to reload once it's done.
window.patter.onEditorFlush(() => void (async () => { if (dirty) await save(); window.patter.editorFlushed(); })());
window.patter.onReplaceApplied(() => void (async () => {
  if (currentSceneId) await loadScene(currentSceneId); // re-read the open scene with the replaced text
  await refreshProblems();
  toast("Replaced across the project.", "info");
})());
// Coverage window (#159): a clicked result row jumps the editor; the "World Properties…" button opens settings.
window.patter.onCoverageNavigate((sceneId, beatId) => void (async () => {
  if (sceneId !== currentSceneId) await loadScene(sceneId);
  surface?.revealNode(beatId);
})());
window.patter.onOpenWorldSettings(() => void openProjectSettings("world"));

// Auto-update guard: report the live dirty flag, and persist on demand before an install restart.
window.patter.onUpdaterCheckDirty(() => dirty);
window.patter.onUpdaterSaveBeforeInstall(async () => { await save(); return { ok: !dirty }; });
// Auto-update prompts wear the app's themed dialog chrome, never a stock OS box.
window.patter.onUpdaterPrompt((opts) => showUpdaterDialog(opts));

// A `.patter` document package opened from Finder while the app is running: render the delivered project.
window.patter.onOpenProject((result) => void showProject(result));

// VC state changes OUTSIDE the app (a teammate grabs a lock, a newer revision lands). Re-pull when the
// window regains focus, and poll on a slow timer so badges stay live even while focused (#145).
window.addEventListener("focus", () => void refreshVcStatus());
window.setInterval(() => void refreshVcStatus(), 30_000);

void boot();
