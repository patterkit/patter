// The Patterpad renderer (untrusted UI). It drives the M0 flow entirely through the window.patter
// bridge: first-run identity, a welcome screen (open / new / recents / the example), and the project
// workspace - embed the surface, switch scenes (remembering the last), save (lock-aware in main), play.
// No Node, no fs here.

import "@patterkit/patterpad-surface/theme.css"; // app-wide design tokens
import "@patterkit/patterpad-surface/styles.css"; // surface component styles
import "@wildwinter/expr-editor/styles.css"; // the visual condition editor
import "@wildwinter/app-shell/anchored.css"; // the shared anchored-panel chrome (a shared module carries its own CSS)
import "@wildwinter/app-shell/tooltip.css"; // ...and the themed tooltip's bubble
// The list-row kit (the well, its line, its details panel and the disclosure).
// Imported BEFORE shell.css so this app's own field rules, which sit on those
// classes, come after and win.
import "@wildwinter/app-shell/settings.css";
import "@wildwinter/app-shell/pane-shell.css"; // the frame: top bar, the three panes, their toggles and seams
import "@wildwinter/app-shell/controls.css"; // the family's button / field / segmented-control grammar
import "@wildwinter/app-shell/dialog.css"; // the one modal frame (the confirm and the identity ask sit on it)
import "@wildwinter/app-shell/confirm.css"; // what is the confirm's own: its width and its body copy
import "@wildwinter/app-shell/identity.css"; // the identity ask's fields
import "@wildwinter/app-shell/context-menu.css"; // the navigator's right-click menu
import "@wildwinter/app-shell/welcome.css"; // the welcome screen (mountWelcome)
import "@wildwinter/app-shell/kit-gallery.css"; // New Project (openKitGallery)
import "@wildwinter/app-shell/link-status.css"; // the live-link chip (mountLinkStatus, via debug-panel.ts)
import "@wildwinter/app-shell/updater.css"; // the updater prompt (showUpdaterDialog) and its "Restart to update" chip
import "@wildwinter/app-shell/command-palette.css"; // Cmd+K (openCommandPalette)
import "@wildwinter/app-shell/whats-new.css"; // What's New after an update, and Help > What's New
// The changelog, built in as text, so What's New needs no network.
import changelog from "../../../CHANGELOG.md?raw";
import "@wildwinter/app-shell/job.css"; // the long-job strip the publish paths run under
import "./shell.css"; // app shell layout, over the surface's page styles
import "@patterkit/patterpad-surface/fonts.css"; // every face the windows draw, declared once

import { moveMenuState, navSiblings, sceneMoveState, sceneMoveTarget } from "./scene-move.js";
import { returnToTwin } from "./focus-return.js";
import { planStatus } from "./status-raise.js";
import { missingLabel } from "@patterkit/patterpad-surface/reftext";
import { askPropertyType, withNewProperty } from "./new-property.js";
import { mountSurface, moveKeyDir, initTooltips, tipBold, type SurfaceHandle, type InspectorContext, type DocNote, type CommentOpenRequest, type SuggestionOpenRequest, type SpellChecker } from "@patterkit/patterpad-surface/surface";
import { buildSpellEngine } from "./spellcheck.js";
import { adoptSceneName, relabelNavScene } from "./scene-name.js";
import { deletePlayedScenePrompt, gameIdChangePrompt, renamePin } from "./paired-scene.js";
import type { PairedCard } from "../../shared/paired-cards.js";
import { selectAllOutsideEditor, undoRoute } from "./edit-commands.js";
import { UndoJournal, type EntryResult, type JournalEntry } from "./undo-journal.js";
import { PROPERTIES_PLACE, PROJECT_SHARD_KEY } from "../../shared/api.js";
import type { BootState, ClashDto, ConditionProperty, FontTheme, Identity, OpenResult, OpenedProject, PaneState, Problem, ProblemsDto, ProjectHistoryOutcome, ProjectSettingsDto, ProjectStep, RecentProject, ReportData, ReviewItem, SaveResult, StageRenameDto, ThemePrefs, VcsKind } from "../../shared/api.js";
import { renderInspector, formatSeconds } from "./inspector.js";
// No per-editor close imports: `closeAnchoredPanel` closes whichever of these is
// open, because they are all the one panel.
import { openConditionEditor, renderConditionPills } from "./cond-editor.js";
import { setPropertyActions, setHostScopeTokens, type PropertyAction } from "./expr-shared.js";
import { openEffectsEditor, renderEffectsPills } from "./effects-editor.js";
// The gameId editor is the shell's now: it IS this app's, generalised, and it
// gained a stopPropagation on keydown that ours lacked (a Delete typed into an
// address could reach the surface underneath). The RULES stay Patterpad's, passed
// in from the model, because the compiler, the CLI and the shipped runtime all
// address content by them and none may depend on a UI kit. `id-parity.test.ts`
// asserts our copy still matches the shell's default.
import { el } from "./dom.js";
import { openEditableExport, openEditableReimport, type EditableDialogContext } from "./editable-dialogs.js";
import { applyTheme } from "./apply-theme.js";
import { openGameIdEditor, closeAnchoredPanel, showAbout, createSaveController, saveIndicator, renderStepperBar,
  paintVcBadges, lockControls, createNavHistory, historyNav, mountPaneShell, mountSettingsDialog, revealRowWhenReady,
  askIdentity, confirmDialog, dialogFrame, openContextMenu, setDialogFocusFallback, type ShardVc, type SettingsSectionHandle, type SettingsSection, type SettingsDialog } from "@wildwinter/app-shell";
import { extensionAdapter, mountProjectSection, problemSettingsSection, settingsExtensions, settingsSectionId } from "./extension-rows.js";
import { fieldsState, followTarget, selectedNodes, withoutViewEdited, type FieldsNode } from "./fields-state.js";
import { createViewHost, takeLengths } from "./view-extensions.js";
import { parseSource } from "@patterkit/core";
import type { FlowFile, LocaleFile, ExtensionShard } from "@patterkit/model";
import "@wildwinter/app-shell/vc.css"; // the badge + locked-document chrome
import "@wildwinter/app-shell/save.css"; // the indicator's three states
import "@wildwinter/app-shell/stepper.css"; // the shape both bottom bars are made of
import "@wildwinter/app-shell/about.css"; // a shared module carries its own CSS
import "@wildwinter/app-shell/toast.css"; // the transient remark, drawn one way for both apps
import { isThemeChoice, stageGateNote, toast, type ToastKind } from "@wildwinter/app-shell";
// The family's clash resolver (ruling Q21): the dialog and the banner are the shell's; the adapter is ours.
import { openClashResolver, clashBanner, type ClashAdapter, type ClashResolver } from "@wildwinter/app-shell";
import "@wildwinter/app-shell/clashes.css";
import { landed } from "./results.js";
import { fileSafeName, untitledSceneName } from "../../shared/file-name.js";
// The welcome, the locked-document notice, the long-job strip, the updater's view and the small idioms
// (plural / formatCount / debounce) are the shell's (ui-review-2026-09, shell step 6).
import { EXAMPLES } from "../../shared/examples.js";
import { mountWelcome, openKitGallery, type KitGalleryItem, lockNotice, mountJobProgress, showUpdaterDialog, feedUpdaterDownloadProgress, showUpdateReady, openCommandPalette, type PaletteItem, whatsNewAfterUpdate, openWhatsNew, type WhatsNewOptions, plural, formatCount, debounce } from "@wildwinter/app-shell";
import { iconNode } from "@wildwinter/app-shell"; // the family's drawn icon set: no typed glyphs in this file
import { rove, wireReorder, wireTreeKeys } from "@wildwinter/app-shell";
import "@wildwinter/app-shell/keys.css"; // the keycaps every hint in this window draws
// Key hints come from ONE helper that writes "⌘" on a Mac and "Ctrl" elsewhere, and metadata is a drawn
// line, never joined with a typed dot (design-language §4): no "⌘" and no " · " in a string in this file.
import { keyHint, tipWithKey, metaLine, labelled, labelledToggle } from "@wildwinter/app-shell";
import { problemLineFor, type ExtensionProblemContext } from "./problem-copy.js";
import { PATTERKIT_WORDMARK } from "./wordmark.js";
import { gameIdify, isValidGameId } from "@patterkit/core";
import { PANEL_KEEP_CLEAR } from "./panel.js";
import { mountGameDataFields } from "./gamedata-fields.js";
import { mountProperties } from "./settings-properties.js";
import { mountCast } from "./settings-cast.js";
import { mountQualifiers } from "./settings-qualifiers.js";
import { mountWorld } from "./settings-world.js";
import { mountWritingStatus, mountAudio } from "./settings-status.js";
import { mountEstimating } from "./settings-estimating.js";
import { mountDictionary } from "./settings-dictionary.js";
import { mountLanguages } from "./settings-languages.js";
import { renderReport } from "./report-view.js";
// The comment popover is the shell's. Aliased because this module already has an
// `openComments` of its own, which is the thing that decides WHICH threads it gets.
import { openComments as shellComments, openNotesEditor } from "@wildwinter/app-shell";
import "@wildwinter/app-shell/notes-editor.css"; // the family's Notes editor (ruling I)
import "@wildwinter/app-shell/comments.css"; // a shared module carries its own CSS
import { openSuggestionCompose, openSuggestionReview, type SuggestionRow } from "./suggestion-popover.js";
import type { PropertyDecl, PropertyType, DocLine, Comment, Suggestion } from "@patterkit/model";
import { DEFAULT_DOCUMENTATION_CLASSES, DEFAULT_PAD_AFTER, PAD_AFTER_MIN, PAD_AFTER_MAX, DEFAULT_ESTIMATE_SYLLABLES_PER_SECOND, ESTIMATE_SYLLABLES_PER_SECOND_MIN, ESTIMATE_SYLLABLES_PER_SECOND_MAX } from "@patterkit/model";
import { openValuePicker, qualifierRows } from "./value-picker.js";
import type { SearchEntry, AudioEntry, SceneKitId, PackMergeSummary, AppPrompt, SceneVcStatus, VcStatusDto, AddExtensionResult } from "../../shared/api.js";
import { recordScratch, isScratchRecording } from "./scratch-recorder.js";
import { textHash } from "./wav.js";
import { mountDebugLink } from "./debug-panel.js";
import { markTarget } from "./debug-flows.js";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

// Boot state FIRST (a top-level await): the frame below restores the remembered pane widths through
// its `initial`, and the shell has no way to set a width once mounted, so the state has to be in hand
// before the frame exists. It is the one round trip boot() used to make, made earlier; boot() reads it.
const bootState = await window.patter.boot();
// The remembered slide/pin state plus every display pref that rides with it (docHidden, the review
// toggles, the line-status set). The frame owns nav / inspector / the widths and reports them through
// onChange; the rest is this module's and is merged in below before each setPanes.
let panes: PaneState = bootState.panes;

// The frame is the shell's (ui-review-2026-09, finding 2): the fused title bar, the navigator | editor |
// inspector grid, the collapse, the drag seams and the toggles. It used to be Patterpad's, lifted into
// app-shell and then kept here as a second copy; the copy is gone. The host in the markup (`#frame`)
// holds the furniture this app seats into it just below.
const frameHost = $("frame");
// Pane widths are px (design-language §4 "Chrome has its own scale"): the chrome does not move with the
// reading root, so the defaults are the family's 14rem / 22rem AT 16px, not at this app's 110% root.
// The remembered widths (navW / inspW) were always CSS px.
const shell = mountPaneShell(frameHost, {
  nav: { defaultWidth: "224px", label: "scenes" },
  inspector: { defaultWidth: "320px", label: "inspector" },
  initial: {
    open: { nav: panes.nav, inspector: panes.inspector },
    width: { ...(panes.navW ? { nav: panes.navW } : {}), ...(panes.inspW ? { inspector: panes.inspW } : {}) },
  },
  // The label / shortcut live on the themed tooltip + aria-label (no text word competing in the bar).
  tipFor: (side, open) => tipWithKey(`${open ? "Hide" : "Show"} ${side === "nav" ? "scenes" : "inspector"}`, side === "nav" ? "Mod+1" : "Mod+2"),
  // Cmd+1 / Cmd+2 move focus INTO an open pane, and close it only when focus is already there (the
  // hands-on fixes review, Q14). The scenes pane focuses the open scene's row; focus coming back out
  // lands in the script.
  focusTarget: { nav: () => navListEl.querySelector<HTMLElement>(".nav-item.active") ?? navListEl.querySelector<HTMLElement>(".nav-item") },
  focusHome: () => scriptFocusHome(),
  onChange: (state) => {
    const next: PaneState = { ...panes, nav: state.open.nav, inspector: state.open.inspector };
    delete next.navW; delete next.inspW;
    if (state.width.nav !== undefined) next.navW = state.width.nav;
    if (state.width.inspector !== undefined) next.inspW = state.width.inspector;
    panes = next;
    void window.patter.setPanes(panes); // remember it (also refreshes the View-menu checks)
  },
});
// The grid the frame collapses, and its two toggles. The shell hands out the pane bodies and the bar's
// slots but not these; they are reached by the class names its stylesheet documents. `hidden` on a
// toggle is how the welcome / overview / Properties screens take it out of the bar.
const panesEl = shell.root.querySelector<HTMLElement>(".panes")!;
panesEl.hidden = true; // the workspace shows once a project opens; the welcome screen has the room until then
const [toggleNavEl, toggleInspectorEl] = [...shell.topbar.querySelectorAll<HTMLButtonElement>(".pane-toggle")] as [HTMLButtonElement, HTMLButtonElement];

// The topbar is the window's drag surface (app-shell 0.34.0's `.topbar.titlebar`). The inset is
// macOS-only: it reserves the traffic lights' 84px, and adding it anywhere else would indent a bar
// that still sits under a native frame.
shell.topbar.classList.add("titlebar");
if (navigator.platform.toUpperCase().includes("MAC")) shell.topbar.classList.add("titlebar-inset");
// Seat the furniture: the bar's cargo into its two slots, one body per pane. (A drag surface swallows
// clicks on anything that is not a button / input / select / a, so the two spans in the bar that DO
// respond carry `no-drag`: the VC chip in the markup, the save indicator once it is built below.)
const histNavHostEl = $("histnav"); // the back/forward pair, left of the project name
const projectNameEl = $("project-name");
const sceneSuffixEl = $("scene-suffix");
shell.topbarLead.append(histNavHostEl, projectNameEl, sceneSuffixEl);
const playTopEl = $<HTMLButtonElement>("play-topbtn");
const vcsSceneEl = $("vcs-scene"); // topbar chip: the CURRENT scene's VC state (locked / out-of-date)
const saveIndicatorHost = $("save-indicator"); // the shell's indicator mounts here
playTopEl.prepend(iconNode("play")); // the label is in index.html; the icon is drawn, never typed
playTopEl.dataset.tip = tipWithKey("Play scene", "Mod+P"); // the markup cannot know the platform; the key is set here
// The topbar's quiet health chip (parity row 33): a tick when clean, the problem count when not. A count
// promises "show me them", so a click steps the problems bar to the first; the clean state answers
// instead of doing nothing. Painted by paintHealth() beside the bar; shown only in the workspace.
const healthEl = el("button", "healthchip ok"); healthEl.type = "button"; healthEl.hidden = true;
shell.topbarTrail.append(playTopEl, vcsSceneEl, healthEl, saveIndicatorHost);
const navListEl = $("nav-list");
shell.nav.append(navListEl);
const editorEl = $("editor");
const propsDocEl = $("props-doc");            // the Properties document (@patter's own page)
shell.centre.append(editorEl, propsDocEl);
const inspectorStackEl = $("inspector-stack");
shell.inspector.append(inspectorStackEl); // no "Inspector" header: the pane is named by its contents (and its label)
shell.inspector.setAttribute("aria-label", "Inspector");
frameHost.hidden = false;
// The banner for a project holding clashes a merge left (Q21): under the title bar, above everything the
// window shows. Hidden at 0, which is also how it sits with no project open.
const clashBar = clashBanner({ onResolve: () => openClashes() });
shell.topbar.after(clashBar.el);

/** The project kits New Project offers. One today: what `patter init` writes (ops/src/init.ts),
 *  said in the concrete. More arrive as the Patter side specifies them; inventing plausible ones
 *  here would be putting content in front of a decision (the kit gallery brief, section 7). */
const PROJECT_KITS = [
  { id: "starter" as const, name: "Starter project",
    blurb: "A scene called Start with one line of text in it, so the project plays the moment it opens. Replace that line with your own writing.",
    tile: "One scene, one line of text, ready to play.",
    features: ["A first scene", "Playable at once"],
    play: "Press Play: the Start scene plays its line.",
    lands: ["A scene called Start", "One line of text in English, your default language"] },
];

const welcomeEl = $("welcome");
const hintbarEl = $("hintbar");
// The welcome is the shell's `mountWelcome` (ui-review-2026-09, finding 10): title, one line, the two
// actions, the kits, the shipped examples and the recents. The examples are tiles, as Storyletter's welcome draws
// its own (2026-09-30): the Tour and the Night Ferry ship inside the app, so the teaching door that used
// to open the download page is a tile now, and each opens as the writer's own copy.
const welcome = mountWelcome(welcomeEl, {
  title: "Patterpad",
  sub: "Write the script. Play it in your game.",
  actions: [
    { label: "Open a project…", primary: true, onClick: () => void openDialog() },
    { label: "New project…", onClick: () => createDialog() },
  ],
  recents: [],
  // Start, then Learn (storylet-studio/design/kit-gallery.md, section 6), as Storyletter's welcome has
  // them: a kit tile opens New Project with that kit chosen, its details panel already showing.
  groups: [
    { caption: "Start from a kit", tiles: true,
      items: PROJECT_KITS.map((k) => ({ name: k.name, hint: k.tile, features: [...k.features], onOpen: () => createDialog(k.id) })) },
    // An example is never opened in place (it lives inside the installed app, which is read-only and
    // replaced by the next update), so opening one asks for a folder. Say so BEFORE the click.
    { caption: "Learn from a finished project", note: "Each opens as your own copy, in a folder you choose.", tiles: true,
      items: EXAMPLES.map((x) => ({ name: x.name, hint: x.tile ?? x.hint, ...(x.features ? { features: [...x.features] } : {}),
        ...(x.badge !== undefined ? { badge: x.badge } : {}), onOpen: () => createDialog(`example:${x.file}`) })) },
  ],
  maxRecents: 8, // the store keeps eight; the welcome shows what the menu shows
});
function setWelcomeRecents(recents: RecentProject[]): void {
  welcome.setRecents(recents.map((r) => ({ name: r.name, path: r.path, onOpen: () => void openPath(r.path) })));
}
let lastInspectorCtx: InspectorContext | null = null;
let lastInspectorSig: string | null = null; // signature of the last-rendered inspector (skip identical rebuilds)
// The fields window's state (pushFields, below).
/** Following the selection (remembered in main; default on). */
let fieldsFollow = bootState.fieldsFollow;
/** The node the window stays on with Follow selection off. */
let fieldsHeld: { kind: string; id: string } | null = null;
/** The node an Edit button named, shown until the selection moves on. */
let fieldsFocus: { kind: string; id: string; from: string | null } | null = null;
/** The node last shown, and the state last sent, so an unchanged state isn't sent again. */
let fieldsShown: { kind: string; id: string } | null = null;
let fieldsSent = "";

/** View > Notes: toggle whether a documentation-note class surfaces in the editor; remember it + re-surface. */
function toggleDocClass(cls: string): void {
  if (cls === "everyone") return; // always shown
  if (docHidden.has(cls)) docHidden.delete(cls); else docHidden.add(cls);
  panes = { ...panes, docHidden: [...docHidden] };
  void window.patter.setPanes(panes); // remember it (also refreshes the View-menu checks)
  pushDocNotes();                      // re-surface with the new filter
}
// Both bottom bars are the shell's `renderStepperBar` now: one grammar, drawn from a list and an index,
// where this app used to keep two parallel class sets for the one shape. Each is just a host element;
// everything inside is rebuilt per paint, so nothing below holds a reference into either bar.
const problembarEl = $("problembar");
const reviewbarEl = $("reviewbar");
const writingExitEl = $<HTMLButtonElement>("writing-exit"); // Writing View's bottom-left exit pill
// The long-job strip (parity row 20): every publish / export / pack / merge path shows itself here while
// main runs it as the kit's "publish" job. None of those paths reports progress through the ops layer
// yet, so the strip runs on the shell's indeterminate band (the label, the band and the elapsed time)
// until one does: the strip follows the data and flips to the bar on the first total. Cancel asks main
// to stop the job at its next yield.
const jobView = mountJobProgress($("job"), { onCancel: () => window.patter.cancelJob("publish"), units: "files" });
async function withJob<T>(label: string, work: () => Promise<T>): Promise<T> {
  jobView.begin(label);
  try { return await work(); }
  finally { jobView.end(); }
}
const overviewEl = $("overview"); // the project-overview landing (#3a)
const overviewPathEl = $("overview-path"); // where the project lives on disk (click reveals it)
overviewPathEl.dataset.tip = navigator.platform.toUpperCase().includes("MAC") ? "Show in Finder" : "Show in file manager";
overviewPathEl.addEventListener("click", () => window.patter.revealProject());
const overviewTitleEl = $("overview-title");
const overviewStatsEl = $("overview-stats");
const overviewProgressEl = $("overview-progress");
const overviewBarFillEl = $("overview-bar-fill");
const overviewProgressLabelEl = $("overview-progress-label");
const overviewScenesEl = $("overview-scenes");
const propsDocHostEl = $("props-doc-host");
const propsDocWorldEl = $<HTMLButtonElement>("props-doc-world");
propsDocWorldEl.addEventListener("click", () => void openProjectSettings("world"));
// Live debug link control (#181): the bottom-right connect icon, and the flow picker that names each
// flow's scene as the Scenes list does.
const debugLink = mountDebugLink({ sceneName: (id) => project?.scenes.find((s) => s.id === id)?.name });
// The six modal dialogs below (scene properties, Notes, the voice script, localisation, Production
// Information, the start prompt) are built on the shell's `dialogFrame` each time they open, like every
// other dialog in the family; none of them lives in index.html any more.

/** A button for a dialog's actions row. */
function dialogButton(label: string, primary = false): HTMLButtonElement {
  const b = el("button", primary ? "btn primary" : "btn", label);
  b.type = "button";
  return b;
}

/** Resolve the project's start point, prompting (and persisting) when it is unset. Returns the start, or
 *  null if the author cancelled / there are no scenes. */
async function ensureProjectStart(): Promise<{ scene: string; block?: string } | null> {
  if (!project) return null;
  const s = await window.patter.readSettings();
  if (s?.start?.scene) return s.start;
  if (!project.scenes.length) return null;
  const scenes = project.scenes;
  // Raised by Play from Start / Coverage when the project has no start point (#159). With only one scene
  // there's nothing to choose: it's the start, set without asking (hands-on fixes review, 1.4).
  const chosen = scenes.length === 1 ? scenes[0]!.id : await new Promise<string | null>((resolve) => {
    let answer: string | null = null;
    const frame = dialogFrame({ title: "Where does your story start?", sub: "You can change this later in Project Settings.", onClose: () => resolve(answer) });
    const sel = el("select", "field");
    for (const sc of scenes) sel.append(new Option(sc.name, sc.id));
    const field = el("label", "identity-field", "Start scene");
    field.append(sel);
    frame.body.append(field);
    const cancel = dialogButton("Cancel");
    const set = dialogButton("Set start", true);
    cancel.addEventListener("click", () => frame.close());
    set.addEventListener("click", () => { answer = sel.value || null; frame.close(); });
    frame.actions.append(cancel, set);
    frame.open();
    set.focus();
  });
  if (!chosen) return null;
  const res = await tracked(window.patter.setStart({ scene: chosen }));
  if (res.project) project = res.project;
  return { scene: chosen };
}
let project: OpenedProject | null = null;
/** A project opens landing scene first (#171): until `hydrateProject` has the rest, `project.scenes` lacks
 *  scenes that exist, so a jump to one of them isn't missing, only not loaded yet. */
let scenesPending = false;
/** Every scene and its blocks, as the surface's cross-scene jump targets. */
const jumpTargetsOf = (p: OpenedProject): Array<{ id: string; label: string; blocks: Array<{ id: string; label: string }> }> =>
  p.scenes.map((s) => ({ id: s.id, label: s.name, blocks: s.blocks.map((b) => ({ id: b.id, label: b.name })) }));
/** Hand the surface the project's jump targets again, saying whether more are still to come. */
const pushJumpTargets = (): void => { if (project) surface?.setJumpTargets(jumpTargetsOf(project), scenesPending); };
let currentSceneId: string | null = null;
let surface: SurfaceHandle | null = null;
/** The scene the mounted surface holds. Usually `currentSceneId`, but the Properties page clears that and
 *  leaves the surface behind it, and the journal's scene entries are the surface's. */
let surfaceSceneId: string | null = null;

// --- the journal: one order across the scene's history and the project's ----------------------------
// (patterkit design/patterpad-undo.md, "The arbiter"; the rules are undo-journal.ts's.) A scene entry is
// appended when the surface reports a new event in its history, a project entry when main records a new
// step (announced for every window, and answered by the writes made here, the same id once).
const journal = new UndoJournal();
let shownUndoLabels = "";
journal.onChange = () => {
  const labels = journal.labels();
  const sig = JSON.stringify(labels);
  if (sig === shownUndoLabels) return;
  shownUndoLabels = sig;
  void window.patter.setUndoLabels(labels); // Edit ▸ Undo Replace
};
/** A step main recorded: a new one goes on the journal; one merged into the step before adds nothing. */
function noteStep(step: ProjectStep | undefined): void {
  if (!step) return;
  // A merged step adds no entry, but it is a new edit: nothing undone before it can be redone.
  if (step.merged) { journal.noteMerged(); return; }
  const known = journal.undoEntries.some((e) => e.kind === "project" && e.id === step.id);
  // A kept scene whose script the step rewrote can't come back as it was: its history goes (the barrier).
  for (const id of step.scenes) if (keptScenes.has(id)) forgetScene(id);
  journal.pushProject(step.id, step.label);
  views.changed("all"); // a project step may have changed anything a view shows
  // Typing straight after the step starts a new event, so it can't join one from before the step and be
  // undone out of order.
  if (!known) surface?.closeHistory();
}
/** Project writes still in the air. Cmd+Z waits for them, so a status set a moment ago is on the journal
 *  before the journal is asked what is newest. */
const inflightWrites = new Set<Promise<unknown>>();
function tracked<T extends SaveResult>(p: Promise<T>): Promise<T> {
  const run = p.then((r) => { noteStep(r.step); return r; });
  inflightWrites.add(run);
  void run.finally(() => inflightWrites.delete(run)).catch(() => {});
  return run;
}

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
      toast(`Spell-check is off. The “${d.language}” dictionary isn't installed on this computer.`, "info");
    }
  }
  surface?.setSpellChecker(spellChecker);
}

/** Add a word to the project dictionary (the surface's "Add to dictionary"), then rebuild + re-validate so
 *  the squiggle and the problems-panel entry clear. */
async function addWordToDictionary(word: string): Promise<void> {
  const res = await tracked(window.patter.addDictionaryWord(word));
  if (res.ok && res.words && project) { project.dictionary.words = res.words; await buildSpellcheck(); void refreshProblems(); }
}

/** Ignore a word (the surface's "Ignore") - persist it to the project ignore list, then rebuild + re-validate
 *  so the squiggle clears AND the problems-bar entry drops out (#177). */
async function ignoreWord(word: string): Promise<void> {
  const res = await tracked(window.patter.addIgnoreWord(word));
  if (res.ok && res.ignore && project) { project.dictionary.ignore = res.ignore; await buildSpellcheck(); void refreshProblems(); }
}

/** Review ▸ Spelling: flip spell-check on/off or switch the active dictionary, then rebuild + re-validate.
 *  The main process persists it and rebuilds the menu (so the check / tick updates). */
async function setDictionaryFromMenu(patch: { enabled?: boolean; language?: string }): Promise<void> {
  const res = await tracked(window.patter.setDictionary(patch));
  if (res.ok && res.dictionary && project) { project.dictionary = res.dictionary; await buildSpellcheck(); void refreshProblems(); }
}
// mountSurface fires onChange once on mount (the initial mirror of the source). That is NOT a user
// edit, so it must not dirty the scene or tell a running play session the scene "changed" (which would
// pop a false "Scene changed in the editor" - e.g. when play crosses scenes and the editor reloads one).
let mountingScene = false;
// Has the user edited the open scene since it loaded? Gates playEdited so a programmatic (re)load -
// like following a cross-scene jump - never reads as an edit.
let sceneEdited = false;
// Autosave is the shell's `createSaveController`. It replaces a 30-second interval,
// and the difference is not cosmetic: an interval survives continuous typing but
// leaves a SINGLE edit unwritten for up to a whole period, so one word typed
// before the laptop closes was gone. The controller debounces AND caps the age of
// unwritten work, so a lone edit lands promptly and steady typing still gets
// written. It also guards re-entrancy, which the interval never did.
//
// The three states it computes are drawn by `saveIndicator` beside it. The old
// span said nothing at all while clean, which left "did that get written?"
// unanswered at the moment it is asked.
const saveInd = saveIndicator();
saveInd.el.classList.add("no-drag"); // it answers clicks, so it opts out of the title bar's drag surface
saveIndicatorHost.replaceWith(saveInd.el);
// `write` returns false on refusal, which keeps the controller "unsaved" so the
// next touch or flush tries again rather than reporting a success that did not
// happen. There is no off switch: the family always saves (ruling A of the October 2026 review), and
// the switch that was here only stopped the clock while every transition below still saved.
const saver = createSaveController({ write: writeScene, onStatus: saveInd.set });

// Open-where-you-left-off, to the LINE: the node id the caret is on, persisted (debounced) alongside the
// scene so a reopen can reveal it. Captured on every selection move; flushed on a short timer and before
// the window closes (so closing mid-debounce still records it).
let caretNodeId: string | null = null;
function recordPlace(): void {
  if (project && currentSceneId) void window.patter.rememberScene(project.root, currentSceneId, caretNodeId ?? undefined);
}
const scheduleRemember = debounce(recordPlace, 1000);
function flushRemember(): void { scheduleRemember.cancel(); recordPlace(); }



// --- navigation history (from-storylets/nav-history) -------------------------
// The other axis from hierarchy: Back retraces the documents you visited, where the navigator
// climbs. The shell owns the stack and the arrows over a Place it never inspects; what a place IS
// here is a scene (and where you were in it), the Properties document, or the project overview.

type NavPlace =
  | { kind: "scene"; sceneId: string; caret?: string }
  | { kind: "properties" }
  | { kind: "overview" };

/** Where the author is NOW, or null before a project is open. */
function currentPlace(): NavPlace | null {
  if (!project) return null;
  if (!propsDocEl.hidden) return { kind: "properties" };
  if (!overviewEl.hidden) return { kind: "overview" };
  return currentSceneId ? { kind: "scene", sceneId: currentSceneId, ...(caretNodeId ? { caret: caretNodeId } : {}) } : null;
}

const history = createNavHistory<NavPlace>({
  // The same DOCUMENT, caret ignored: moving the caret around a scene is not a journey, and letting
  // it stack would fill the history with one scene. The newest entry wins, so a Back into a scene
  // lands on the line you left it at.
  same: (a, b) => a.kind === b.kind && (a.kind !== "scene" || a.sceneId === (b as { sceneId: string }).sceneId),
  // A scene deleted since it was visited cannot be restored; the step walks past it.
  usable: (p) => p.kind !== "scene" || !!project?.scenes.some((s) => s.id === p.sceneId),
});
let travelling = false; // restoring re-enters the ordinary navigation, which must not record itself

/** Record the place being LEFT. Every route into a document calls this through its own entry point. */
function visitFrom(): void {
  if (travelling) return;
  const here = currentPlace();
  if (here) history.visit(here);
}

async function restorePlace(p: NavPlace): Promise<void> {
  travelling = true;
  try {
    if (p.kind === "properties") await showPropertiesDoc();
    else if (p.kind === "overview") await showOverview();
    else if (p.sceneId !== currentSceneId) {
      await loadScene(p.sceneId, ...(p.caret ? [{ restoreCaret: p.caret }] : []) as [{ restoreCaret: string }?]);
    } else {
      // The scene is the one already loaded - but it may be sitting BEHIND the overview or the
      // Properties document, which cover the workspace without unloading it. loadScene would return
      // early on the id it already holds, so bring the workspace back by hand.
      enterWorkspace();
      highlightNav(p.sceneId);
      if (p.caret) surface?.revealNode(p.caret);
    }
  } finally { travelling = false; }
  paintHistory();
}

/** One step, whether it came from an arrow or from View ▸ Back / Forward. Nowhere to go is a quiet
 *  no-op: the arrows are already greyed, and the menu items stay enabled so the keys always answer. */
function stepHistory(dir: "back" | "forward"): void {
  const here = currentPlace();
  if (!here) return;
  const p = dir === "back" ? history.back(here) : history.forward(here);
  if (p) void restorePlace(p);
  else paintHistory(); // the step found only stale entries and discarded them
}

const histNav = historyNav(() => stepHistory("back"), () => stepHistory("forward"));
histNavHostEl.append(histNav.el);
function paintHistory(): void { histNav.set(history.canBack(), history.canForward()); }
paintHistory();

// --- the project workspace ---------------------------------------------------

/** The navigator's open document: `.active` for this app's own rules, and `aria-current`, which the shell's
 *  row grammar (`.shell-nav-row`, app-shell 0.65) draws as the selection and a screen reader announces. */
function markCurrent(el: HTMLElement, on: boolean): void {
  el.classList.toggle("active", on);
  if (on) el.setAttribute("aria-current", "page"); else el.removeAttribute("aria-current");
}

/** Mark the current scene: `.active` on its row, and `.open` on its container so its block list
 *  reveals while the previously open scene's list closes (both ease - no pops). */
function highlightNav(id: string): void {
  navListEl.querySelectorAll<HTMLElement>(".nav-item").forEach((el) => markCurrent(el, el.dataset["id"] === id));
  // A scene inside a closed folder has no row: the nearest folder that shows takes the mark (scene folders,
  // D8), as Storyletter's tree marks the nearest ancestor of a document with no row of its own.
  const shown = navListEl.querySelector(`.nav-item[data-id="${CSS.escape(id)}"]`) !== null;
  const holder = shown || !id ? undefined : visibleFolderOf(id);
  navListEl.querySelectorAll<HTMLElement>(".nav-folder-item").forEach((el) => markCurrent(el, el.dataset["id"] === holder));
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
/** Keep the open scene's name in step with its title (#73). A rename edits the document, but the Scenes
 *  list, the overview index, the Start scene pickers, the Delete dialog and every other scene's jump
 *  targets all read `project` - the copy taken when the project opened - so the name is written back
 *  into it here, and the row already on screen is relabelled. Runs on every edit; changes nothing (and
 *  repaints nothing) unless the name actually moved. */
function syncSceneName(): void {
  const name = surface?.sceneName();
  if (!name || !currentSceneId) return;
  if (adoptSceneName(project, currentSceneId, name)) relabelNavScene(navListEl, currentSceneId, name);
}

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
  search.className = "nav-search"; search.type = "button"; search.dataset.tip = "Find by name, handle, or id"; search.setAttribute("aria-label", "Find by name, handle, or id");
  // It reads as what it opens, a search field: the drawn magnifier, then "Find" in the field's quiet ink, and
  // the shortcut at its right (the October 2026 UI review, 3-composition.md proposal 7).
  const searchIcon = document.createElement("span"); searchIcon.className = "nav-search-icon";
  searchIcon.append(iconNode("search", 13));
  search.append(searchIcon);
  search.append(Object.assign(document.createElement("span"), { className: "nav-search-label", textContent: "Find…" }));
  const searchKey = document.createElement("span"); searchKey.className = "nav-search-kbd"; searchKey.append(keyHint("Mod+F"));
  search.append(searchKey);
  search.addEventListener("click", () => openSearch());
  navListEl.appendChild(search);
  // The Properties document's row: fixed, above the scenes, with a count of what it holds. Depth 0
  // and no chevron - it is a page, not a container. (No VC badge yet: the renderer's shard map covers
  // scenes only, so the project shard has no status to paint here.)
  const propsRow = document.createElement("button");
  propsRow.className = "nav-doc shell-nav-row"; propsRow.type = "button";
  propsRow.dataset.tip = "The project's @patter properties";
  propsRow.dataset["vc"] = PROJECT_SHARD_KEY; // the shard key `paintVcBadges` badges this row from
  propsRow.setAttribute("aria-label", "Properties");
  propsRow.append(Object.assign(document.createElement("span"), { className: "nav-doc-name", textContent: "Properties" }));
  propsRow.append(Object.assign(document.createElement("span"), { className: "nav-doc-count shell-nav-count", textContent: String(patterProps.length) }));
  propsRow.addEventListener("click", () => void showPropertiesDoc());
  navListEl.appendChild(propsRow);
  // The scenes and their folders (scene folders, design/proposals/scene-folders.md): a tree, one tab stop
  // with the arrow keys (app-shell's tree keys), rows indented by depth. A closed folder's rows aren't drawn.
  const tree = document.createElement("div");
  tree.className = "nav-tree"; tree.setAttribute("role", "tree"); tree.setAttribute("aria-label", "Scenes");
  // With folders, every scene row keeps a chevron's room before its name, so a folder's name lines up with the
  // scenes beside it and what's inside a folder reads as one step in (the tree's own grammar, as Storyletter's).
  const withFolders = (project?.sceneFolders ?? []).length > 0;
  tree.classList.toggle("has-folders", withFolders);
  const byId = new Map((project?.scenes ?? []).map((s) => [s.id, s]));
  const folderName = new Map((project?.sceneFolders ?? []).map((f) => [f.id, f.name]));
  let hiddenBelow = Infinity; // depth under a closed folder: rows deeper than it are skipped
  for (const r of project?.navRows ?? []) {
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
    b.addEventListener("click", () => void loadScene(s.id));
    b.addEventListener("contextmenu", (e) => { e.preventDefault(); sceneContextMenu(s.id, e.clientX, e.clientY); });
    // The script's move keys move a focused scene row too (Ctrl+Cmd+Up / Down; Ctrl+Alt elsewhere).
    b.addEventListener("keydown", (e) => {
      const dir = moveKeyDir(e);
      if (dir === null) return;
      e.preventDefault();
      void moveSceneBy(s.id, dir);
    });
    row.appendChild(b);
    // The block sub-list: rendered for every scene (rows fill lazily), revealed only while `.open`.
    const blocks = document.createElement("div");
    blocks.className = "nav-blocks";
    blocks.appendChild(Object.assign(document.createElement("div"), { className: "nav-blocks-inner" }));
    row.appendChild(blocks);
    wireReorder(row, s.id, "y", dropRow);
    tree.appendChild(row);
  }
  navListEl.appendChild(tree);
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
      { label: "Scene", onClick: () => void newSceneNow() },
      { label: "Scene from Kit…", onClick: () => newScenePrompt() },
      { label: "Folder", onClick: () => void newFolderNow() },
    ]);
  });
  navListEl.appendChild(add);
  paintNavBadges(); // re-apply VC badges after a list rebuild
  if (currentSceneId) highlightNav(currentSceneId);
  const treeEl = navListEl.querySelector<HTMLElement>(".nav-tree");
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
  const root = project?.root ?? null;
  if (root === closedFoldersFor) return;
  closedFoldersFor = root;
  closedFolders = new Set(root ? await window.patter.closedFolders(root) : []);
  if (closedFolders.size && project?.root === root) renderNav();
}

function saveClosedFolders(): void {
  if (project) void window.patter.setClosedFolders(project.root, [...closedFolders]);
}

/** Open or close a folder. */
function toggleFolder(id: string): void {
  if (!(project?.sceneFolders ?? []).some((f) => f.id === id)) return;
  if (closedFolders.has(id)) closedFolders.delete(id); else closedFolders.add(id);
  saveClosedFolders();
  renderNav();
  navListEl.querySelector<HTMLElement>(`.nav-folder-item[data-id="${CSS.escape(id)}"]`)?.focus();
}

/** The folders a scene or folder sits in, innermost first. */
function foldersAbove(id: string): string[] {
  const rows = project?.navRows ?? [];
  const parent = new Map(rows.map((r) => [r.id, r.folder]));
  const out: string[] = [];
  for (let at = parent.get(id); at !== undefined && out.length <= rows.length; at = parent.get(at)) out.push(at);
  return out;
}

/** The outermost closed folder above a scene: the row that shows for it. */
function visibleFolderOf(id: string): string | undefined {
  return foldersAbove(id).filter((f) => closedFolders.has(f)).at(-1);
}

/** Opening a scene opens the folders it sits in (D8). Its row only: the author can close one again. */
function revealInNav(sceneId: string): void {
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
  return (project?.navRows ?? []).filter((r) => r.kind === "scene" && foldersAbove(r.id).includes(id)).map((r) => r.id);
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
    void moveSceneBy(id, dir);
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
  if (!project) return;
  const res = await tracked(window.patter.placeSceneRow(rowId, target, where));
  if (!landed(res, "Couldn't move it")) return;
  if (res.project) project = res.project;
  if (where === "into" && target && closedFolders.delete(target)) saveClosedFolders();
  flipNav(() => renderNav());
  scheduleMoveState();
}

/** New Folder: made at once, after the open scene in its folder (or at the end of `inside`, a folder's own
 *  menu), its name up for typing. */
async function newFolderNow(inside?: string): Promise<void> {
  if (!project) return;
  const res = await tracked(window.patter.createSceneFolder(inside ? undefined : currentSceneId ?? undefined, inside));
  if (!landed(res, "Couldn't add the folder") || !res.project || !res.folderId) return;
  project = res.project;
  if (inside && closedFolders.delete(inside)) saveClosedFolders(); // open it, so the new folder shows
  renderNav();
  renameFolderInPlace(res.folderId);
}

/** Rename a folder where it stands: its name becomes a field. Enter or leaving keeps it; Escape doesn't. */
function renameFolderInPlace(id: string): void {
  const b = navListEl.querySelector<HTMLElement>(`.nav-folder-item[data-id="${CSS.escape(id)}"]`);
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
      const res = await tracked(window.patter.renameSceneFolder(id, name));
      if (landed(res, "Couldn't rename the folder") && res.project) project = res.project;
    }
    renderNav();
    navListEl.querySelector<HTMLElement>(`.nav-folder-item[data-id="${CSS.escape(id)}"]`)?.focus();
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
  const can = sceneMoveState(navSiblings(project?.navRows ?? [], id), id);
  const n = scenesInFolder(id).length;
  openContextMenu(x, y, [
    { label: "Rename", onClick: () => renameFolderInPlace(id) },
    { label: "New folder inside", onClick: () => void newFolderNow(id) },
    { label: "Move to Folder…", onClick: () => moveToFolderMenu(id, x, y) },
    { label: "Move up", disabled: !can.up, onClick: () => void moveSceneBy(id, -1) },
    { label: "Move down", disabled: !can.down, onClick: () => void moveSceneBy(id, 1) },
    { label: n === 0 ? "Delete folder" : n === 1 ? "Delete folder (its scene moves up)" : `Delete folder (its ${n} scenes move up)`, danger: true, onClick: () => void deleteFolderNow(id) },
  ]);
}

/** Move to Folder: the folders to choose from, by path, and the top level. With hundreds of scenes it's
 *  quicker than a drag. A folder can't go inside itself, so its own subtree isn't offered. */
function moveToFolderMenu(rowId: string, x: number, y: number): void {
  const rows = project?.navRows ?? [];
  const names = new Map((project?.sceneFolders ?? []).map((f) => [f.id, f.name]));
  const pathOf = (f: string): string => [f, ...foldersAbove(f)].reverse().map((id) => names.get(id) ?? "").join(" / ");
  const here = rows.find((r) => r.id === rowId)?.folder;
  const choices = rows.filter((r) => r.kind === "folder" && r.id !== rowId && !foldersAbove(r.id).includes(rowId));
  openContextMenu(x, y, [
    { label: "Top level", disabled: here === undefined, onClick: () => void placeRow(rowId, null, "into") },
    ...choices.map((r) => ({ label: pathOf(r.id), disabled: r.id === here, onClick: () => void placeRow(rowId, r.id, "into") })),
  ]);
}

async function deleteFolderNow(id: string): Promise<void> {
  const res = await tracked(window.patter.deleteSceneFolder(id));
  if (!landed(res, "Couldn't delete the folder")) return;
  if (res.project) project = res.project;
  if (closedFolders.delete(id)) saveClosedFolders();
  flipNav(() => renderNav());
}

// --- new scene (File > New Scene / the nav's + row; File > New Scene from Kit…) ------------------

/** New Scene (the hands-on fixes review, Q20): no dialog. An "Untitled scene" (numbered when there's one
 *  already) is made at once straight after the open scene and opened, its title selected, so what the
 *  author types next names it. The kits are File > New Scene from Kit…. */
async function newSceneNow(): Promise<void> {
  if (!project) return;
  const name = untitledSceneName(project.scenes.map((s) => s.name));
  const res = await tracked(window.patter.createScene(name, "blank", undefined, newSceneAfter()));
  if (!landed(res, "Couldn't add the scene") || !res.project || !res.sceneId) return;
  project = res.project;
  renderNav();
  await loadScene(res.sceneId);
  if (surfaceSceneId === res.sceneId) surface?.focusTitle();
}

/** The scene kits, worded for the gallery (storylet-studio design/kit-gallery.md, section 7a, approved
 *  2026-09-27). What each one writes is main/scene-kits.ts; these lines are written from it. A feature
 *  pill names what the game has, as a player meets it, never a part of the model: the author's ruling. */
const SCENE_KIT_ITEMS: KitGalleryItem<SceneKitId>[] = [
  { id: "blank", name: "Blank", blurb: "A scene with one line of text in it, ready to write into.",
    play: "Press Play: the line, then the end." },
  { id: "conversation", name: "Conversation with choices",
    blurb: "Someone says something, the player answers, and both answers come back together.",
    play: "Press Play: a line, two answers, and the talk carries on either way.",
    features: ["Branching dialogue", "Player choices"] },
  { id: "hub", name: "Hub conversation",
    blurb: "Ask about several things in any order, then leave.",
    play: "Press Play: a menu of topics that comes back after each one, until you say goodbye.",
    features: ["Ask in any order", "Leave any time"] },
  { id: "barks", name: "Barks",
    blurb: "Short lines a character says in passing, never the same one twice in a row.",
    play: "Press Play: one line, drawn at random from four.",
    features: ["Ambient lines", "No back-to-back repeats"] },
  { id: "cutscene", name: "Cutscene",
    blurb: "A scripted exchange, with camera and animation cues for the game.",
    play: "Press Play: the lines in order, with each cue listed as it fires.",
    features: ["Scripted scene", "Camera cues", "Animation cues"] },
];

/** New Scene from Kit: the shell's kit gallery, the moment Storyletter's New Box draws. A kit with lines needs a
 *  speaker, chosen here from the cast; with nobody in the cast yet, the name typed is added to it. */
function newScenePrompt(): void {
  if (!project) return;
  const cast = project.cast;
  const speaker: HTMLInputElement | HTMLSelectElement = cast.length > 0 ? el("select", "insp-select") : el("input", "field");
  if (speaker instanceof HTMLSelectElement) {
    for (const name of cast) { const o = el("option", undefined, name); o.value = name; speaker.append(o); }
  } else {
    speaker.type = "text";
    speaker.placeholder = "Gareth";
  }
  const speakerRow = el("div", "create-details");
  speakerRow.append(
    el("label", "kit-gallery-label", "Speaker"), speaker,
    el("small", "identity-hint", cast.length > 0
      ? "Who says this scene's lines. Pick anyone from the cast."
      : "Who says this scene's lines. Nobody is in the cast yet, so this name is added to it."));
  const needsSpeaker = (kit: SceneKitId): boolean => kit !== "blank";
  openKitGallery<SceneKitId>({
    title: "New scene",
    what: "A scene is one piece of the story: a conversation, a moment, a set of lines a character can say. A scene kit is a starting point you own, fully editable the moment it lands.",
    namePlaceholder: "The Docks",
    nameLabel: "Scene name",
    details: speakerRow,
    sections: [{ items: SCENE_KIT_ITEMS }],
    onChoose: (kit) => { speakerRow.hidden = !needsSpeaker(kit); },
    validate: (kit) => (needsSpeaker(kit) && speaker.value.trim() === "" ? speaker : null),
    onPick: (kit, { name }) => {
      if (name === undefined) return;
      const who = needsSpeaker(kit) ? speaker.value.trim() : undefined;
      void (async () => {
        const res = await tracked(window.patter.createScene(name, kit, who, newSceneAfter()));
        if (!landed(res, "Couldn't add the scene") || !res.project || !res.sceneId) return;
        project = res.project;
        renderNav();
        await loadScene(res.sceneId);
      })();
    },
  });
}

/** A jump picker's create rows (the hands-on fixes review, Q13): a new block goes into the open scene's
 *  document (an edit like any other, saved with it); a new scene is made by main as New Scene makes one,
 *  straight after the open scene, without leaving it. Answers what was made, or null when it failed (said
 *  in a toast). */
async function createJumpTarget(req: { kind: "scene" | "block"; name: string; scene?: string }): Promise<{ scene: string; block?: string } | null> {
  if (req.kind === "block") {
    const scene = surfaceSceneId;
    const block = surface?.addBlock(req.name);
    return scene && block ? { scene, block } : null;
  }
  const res = await tracked(window.patter.createScene(req.name, "blank", undefined, surfaceSceneId ?? undefined));
  if (!landed(res, "Couldn't add the scene") || !res.project || !res.sceneId) return null;
  project = res.project;
  renderNav();
  pushJumpTargets();
  return { scene: res.sceneId };
}

/** New Scene's place: straight after the scene the author is in (its row in the Scenes list), so it doesn't
 *  land at the bottom of a long list; at the end when no scene is open. */
const newSceneAfter = (): string | undefined => currentSceneId ?? undefined;

// --- delete scene (File > Delete Scene / right-click a nav row) ---------------
// Severity scales with the evidence (design/proposals/delete-scene.md): an untouched scaffold
// deletes silently; content asks; inbound references list the referring scenes BY NAME.

/** A prompt on the family's dialog frame, for whatever `confirmDialog` does not fit: a notice with
 *  nothing to confirm, or a choice of more than one way forward. Buttons are given in display order
 *  (the way out first, as the shell's confirm draws it). The default wears the accent and takes the
 *  focus; Esc and the backdrop answer `cancelId`. A notice is one button, and it reads "OK".
 *
 *  Main's prompts arrive here too (`onPrompt`), so a flow running in main, between its file pickers,
 *  is drawn in the app's own chrome rather than a system message box. */
function promptDialog(opts: AppPrompt): Promise<number> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (i: number): void => { if (done) return; done = true; resolve(i); frame.close(); };
    const frame = dialogFrame({ title: opts.title, ...(opts.sub ? { sub: opts.sub } : {}), className: "confirm-dialog", onClose: () => finish(opts.cancelId) });
    for (const para of opts.body ?? []) frame.body.append(el("p", "confirm-body", para));
    let focus: HTMLButtonElement | null = null;
    opts.buttons.forEach((label, i) => {
      const b = el("button", i === opts.defaultId && opts.buttons.length > 1 ? "btn primary confirm-btn" : "btn confirm-btn", label);
      b.type = "button";
      b.addEventListener("click", () => finish(i));
      frame.actions.append(b);
      if (i === opts.defaultId) focus = b;
    });
    frame.dialog.addEventListener("mousedown", (e) => { if (e.target === frame.dialog) finish(opts.cancelId); });
    frame.open();
    (focus as HTMLButtonElement | null)?.focus();
  });
}

/** A notice: something the author needs to know, and nothing to decide. */
function notice(title: string, sub: string): Promise<number> {
  return promptDialog({ title, sub, buttons: ["OK"], defaultId: 0, cancelId: 0 });
}

async function deleteScenePrompt(sceneId?: string): Promise<void> {
  const id = sceneId ?? currentSceneId;
  if (!project || !id) return;
  const scene = project.scenes.find((s) => s.id === id);
  const info = await window.patter.sceneDeleteInfo(id);
  if (!scene || !info) return;
  if (info.lastScene) {
    await notice("Can't delete this scene", "A project needs at least one scene.");
    return;
  }

  // No question first (the October 2026 review: Undo replaces "Are you sure?"): the delete is one step of
  // the project history, so the toast's Undo, or Edit > Undo, brings every one of its files back. Unsaved
  // edits in it are saved first, so the undo brings those back too. A scene storylet cards play is the
  // exception (Q19): deleting it leaves them with nothing to play, so it asks first, naming them.
  const ask = deletePlayedScenePrompt(scene.name, info.cards);
  if (ask && await promptDialog(ask) !== 1) return;
  if (id === currentSceneId && saver.pending) await save();
  const step = await doDeleteScene(id);
  if (!step) return;
  const after = [
    info.referrers.length ? `${plural(info.referrers.length, "scene")} that ${info.referrers.length === 1 ? "refers" : "refer"} to it now ${info.referrers.length === 1 ? "shows" : "show"} a problem.` : "",
    info.startsHere ? "The project has no start point now." : "",
  ].filter(Boolean).join(" ");
  toastWithUndo(`Deleted \u201c${scene.name}\u201d.${after ? `\n${after}` : ""}`, "info", step);
}

/** Delete a scene; resolves the project step it made (for the toast's Undo), or undefined if it failed. */
async function doDeleteScene(id: string): Promise<ProjectStep | undefined> {
  // Pick the landing spot BEFORE the list shrinks: the row above in nav order, else the first remaining.
  const order = project?.scenes.map((s) => s.id) ?? [];
  const at = order.indexOf(id);
  const neighbour = order[at - 1] ?? order.find((sid) => sid !== id);
  const res = await tracked(window.patter.deleteScene(id));
  if (!landed(res, "Couldn't delete the scene") || !res.project) return undefined;
  project = res.project;
  forgetScene(id);
  renderNav();
  if (currentSceneId === id) {
    // The files are gone: there is nothing left to persist. Drop the editor's dirty state so the
    // switch below doesn't try to save (and toast a refusal on) the scene we just deleted.
    saver.cancel();
    docsDirty = false; commentsDirty = false;
    if (neighbour) await loadScene(neighbour, { behind: true });
  } else if (currentSceneId) highlightNav(currentSceneId);
  return res.step;
}

// --- storylet cards that play a scene (the hands-on fixes review, Q19) ---------------------------------

/** The paired Storylets project's cards, as main read them last (on open and whenever the window regains
 *  focus). Empty when nothing pairs. */
let pairedCards: PairedCard[] = [];
async function refreshPairedCards(): Promise<void> {
  if (!project) { pairedCards = []; return; }
  try { pairedCards = await window.patter.pairedCards(); } catch { /* keep what we had */ }
}
const sceneIdSet = (): Set<string> => new Set(project?.scenes.map((s) => s.id) ?? []);

/** The Game ID editor's commit: the scene's Game ID changing under cards that play it asks first. A block's
 *  Game ID isn't a card's concern. */
async function commitGameId(id: string, pinned: string, next: string): Promise<void> {
  if (id === surfaceSceneId && surface && pairedCards.length) {
    await refreshPairedCards();
    const ask = gameIdChangePrompt(pairedCards, { id, name: surface.sceneName(), ...(pinned.trim() ? { gameId: pinned } : {}) }, sceneIdSet(), next);
    if (ask && await promptDialog(ask) !== 1) return;
  }
  surface?.setGameId(id, next);
}

/** A rename of a scene cards play whose Game ID follows its name: pin the Game ID it has, in the same edit,
 *  and say so with Undo (which takes back the rename and the pin together). */
function pinGameIdOnRename(scene: { id: string; name: string; gameId?: string }, next: string): string | undefined {
  const pin = renamePin(pairedCards, scene, sceneIdSet(), next);
  if (!pin) return undefined;
  const sceneId = scene.id;
  // After the rename has landed (the surface applies it once this returns): Undo takes it back only while
  // it's still the newest edit in this scene.
  window.setTimeout(() => {
    const depth = surface && surfaceSceneId === sceneId ? surface.undoDepth() : -1;
    toast(pin.message, "info", { action: { label: "Undo", run: () => void undoRenameIfNewest(sceneId, depth) } });
  }, 0);
  return pin.gameId;
}

async function undoRenameIfNewest(sceneId: string, depth: number): Promise<void> {
  await settleForUndo();
  const top = journal.peekUndo();
  if (!surface || surfaceSceneId !== sceneId || surface.undoDepth() !== depth || top?.kind !== "scene" || top.sceneId !== sceneId) { toast(STALE_UNDO); return; }
  await journal.undo(applyJournalEntry);
}

/** The nav's context menu: the shell's. Move up / Move down keep their places when they can't apply (the
 *  first or last scene), greyed. */
function sceneContextMenu(sceneId: string, x: number, y: number): void {
  const can = sceneMoveState(navSiblings(project?.navRows ?? [], sceneId), sceneId);
  openContextMenu(x, y, [
    { label: "Move up", disabled: !can.up, onClick: () => void moveSceneBy(sceneId, -1) },
    { label: "Move down", disabled: !can.down, onClick: () => void moveSceneBy(sceneId, 1) },
    { label: "Move to Folder…", disabled: !(project?.sceneFolders ?? []).length, onClick: () => moveToFolderMenu(sceneId, x, y) },
    { label: "Delete scene", danger: true, onClick: () => void deleteScenePrompt(sceneId) },
  ]);
}

/** Move a scene a place up or down in the Scenes list (ruling 3 of the hands-on fixes review): its right-click
 *  menu, Edit ▸ Move Up / Move Down with focus in the list, and Ctrl+Cmd+Up / Down on a focused row. One
 *  step of the project history. The rows glide, and a row that had focus keeps it. */
async function moveSceneBy(sceneId: string, dir: -1 | 1): Promise<void> {
  if (!project) return;
  const hadFocus = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>(".nav-item, .nav-folder-item")?.dataset["id"] === sceneId;
  const folder = (project.sceneFolders ?? []).some((f) => f.id === sceneId);
  const res = await tracked(window.patter.moveScene(sceneId, dir));
  if (!landed(res, folder ? "Couldn't move the folder" : "Couldn't move the scene")) return;
  if (!res.moved) { toast(dir < 0 ? "That's the first in its folder already." : "That's the last in its folder already.", "info"); return; }
  if (res.project) project = res.project;
  flipNav(() => renderNav());
  if (hadFocus) navListEl.querySelector<HTMLElement>(`.nav-item[data-id="${CSS.escape(sceneId)}"], .nav-folder-item[data-id="${CSS.escape(sceneId)}"]`)?.focus();
  scheduleMoveState();
}

/** Edit ▸ Move Up / Move Down: the scene, with focus in the Scenes list; the script's selection otherwise. */
function moveCommand(dir: -1 | 1): void {
  const scene = sceneMoveTarget(navListEl, document.activeElement, currentSceneId);
  if (scene) { void moveSceneBy(scene, dir); return; }
  if (surface && !editorEl.hidden) surface.moveSelection(dir);
}

/** Tell main what Move Up / Move Down can do now, so the Edit menu greys what can't apply. Coalesced to a
 *  frame (it follows every selection move and focus change) and sent only when it changes. */
let moveStateSent = "";
let moveStateFrame = 0;
function scheduleMoveState(): void {
  if (moveStateFrame) return;
  moveStateFrame = requestAnimationFrame(() => {
    moveStateFrame = 0;
    const state = moveMenuState({
      navList: navListEl, active: document.activeElement, openScene: currentSceneId,
      order: navSiblings(project?.navRows ?? [], sceneMoveTarget(navListEl, document.activeElement, currentSceneId) ?? ""),
      ...(surface && !editorEl.hidden && project ? { canMoveSelection: (d: -1 | 1) => surface!.canMoveSelection(d) } : {}),
    });
    const sig = `${state.up}${state.down}`;
    if (sig === moveStateSent) return;
    moveStateSent = sig;
    void window.patter.setMoveEnabled(state);
  });
}
document.addEventListener("focusin", scheduleMoveState);
document.addEventListener("focusout", scheduleMoveState);

// --- scene reorder (drag a nav row; the order persists to the project) -------

/** Rows GLIDE to their new slots (FLIP over the rebuild), per the animation strategy. */
function flipNav(mutate: () => void): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { mutate(); return; }
  const first = new Map<string, DOMRect>();
  navListEl.querySelectorAll<HTMLElement>(".nav-scene, .nav-folder").forEach((el) => { if (el.dataset["id"]) first.set(el.dataset["id"], el.getBoundingClientRect()); });
  mutate();
  navListEl.querySelectorAll<HTMLElement>(".nav-scene, .nav-folder").forEach((el) => {
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

// --- version-control state (#145) --------------------------------------------
// The reactive surface over simple-vc-lib: a per-scene snapshot drives a nav badge on every scene + a
// topbar chip for the current one, and a scene locked by ANOTHER author makes the editor read-only (the
// save would be refused anyway). Refreshed on open / save / window-focus and polled (state changes
// externally - someone else grabs a lock, a newer revision lands).
// Keyed by scene id, in the shell's `ShardVc` shape. The DTO crossing the preload boundary keeps
// saying `sceneId`, which is this app's word for the key; the adaptation is one line below.
// A scene's entry also carries its extension shards' states (SceneVcStatus.extensions).
type SceneVc = ShardVc & { extensions?: SceneVcStatus["extensions"] };
let vcMap: Map<string, SceneVc> = new Map();

/** What keeps working in an inspector for a scene somebody else holds: the section disclosures, the
 *  copy buttons that put an id on the clipboard, and a map of records' Edit (the fields window then shows
 *  it read-only). All are reading, and reading is never locked. */
const STAYS_LIVE = ".insp-head, .insp-copy, .insp-rec-play, .insp-ext-edit";

/** A scene is read-only to us only when someone ELSE holds it. A not-yet-checked-out (read-only on
 *  disk) file with no other holder is still editable - simple-vc-lib checks it out on save. */
function isReadOnly(st?: ShardVc): boolean { return !!st?.lockedBy?.length; }

/** Repaint every scene row's badge from the current snapshot. In place, so a poll never disturbs the
 *  nav: the shell's painter removes and re-adds only the badge span. */
function paintNavBadges(): void {
  paintVcBadges(navListEl, vcMap);
}

/** Reflect the CURRENT scene's VC state: read-only the surface + dim the inspector when locked by
 *  another, and show a topbar chip naming the holder (or an out-of-date notice). */
/** The open project's version control by name, for the chip's tip. */
let vcSystemName = "version control";

/** Each extension's project-level shard state (`_project.patterextension`), by extension id: one somebody
 *  else holds locks that extension's section of Project Settings. */
let projectExtensionVc: NonNullable<VcStatusDto["projectExtensions"]> = {};

/** "Locked by bob.", for a shard somebody else holds; null when nobody does. */
const lockedLine = (by: string[] | undefined): string | null => (by?.length ? `Locked by ${by.join(", ")}.` : null);

/** The open scene's extensions' names, by id, from its read (for the lock sentence). */
let sceneExtensionNames = new Map<string, string>();
/** The extension locks last handed to the surface, so a poll that changes nothing redraws nothing. */
let lastExtensionLocks = "";

/** The open scene's extensions whose shard somebody else holds: their data refuses edits (the scene
 *  itself stays editable). */
function extensionLocksOf(st: SceneVc | undefined): Record<string, { name: string; by: string[] }> {
  const out: Record<string, { name: string; by: string[] }> = {};
  for (const [id, ext] of Object.entries(st?.extensions ?? {})) {
    if (ext.lockedBy?.length) out[id] = { name: sceneExtensionNames.get(id) ?? id, by: ext.lockedBy };
  }
  return out;
}

function applySceneVc(): void {
  const st = currentSceneId ? vcMap.get(currentSceneId) : undefined;
  const ro = isReadOnly(st);
  surface?.setEditable(!ro);
  pushFields(); // the fields window locks with the scene
  views.writable(); // and so does every open view
  const locks = extensionLocksOf(st);
  surface?.setLockedExtensions(locks);
  const sig = JSON.stringify(locks);
  if (sig !== lastExtensionLocks) {
    lastExtensionLocks = sig;
    lastInspectorSig = null; if (lastInspectorCtx) showInspector(lastInspectorCtx); // the extension fields lock with it
  }
  // The shell's per-control lock, in place of the blanket `pointer-events: none` this used to drop over
  // the whole inspector. Reading a scene somebody else holds has to stay fully possible, and the old
  // version killed that too: you could not expand a section or copy an address to go and ask them about
  // it. Storyletter's version won this one, and STAYS_LIVE is the part only this app can supply.
  lockControls(inspectorStackEl, ro, STAYS_LIVE);
  // The shell's notice at the head of a locked document (parity row 34): the chip says who, the notice
  // says why editing stopped, where the author is looking. Sits above the script in the centre column.
  shell.centre.querySelector(":scope > .vc-lock")?.remove();
  if (st?.lockedBy?.length) editorEl.before(lockNotice(st.lockedBy));
  const chip: [Parameters<typeof iconNode>[0], string] | null = st?.lockedBy?.length ? ["locked", `Locked by ${st.lockedBy.join(", ")}`]
    : st?.outOfDate ? ["down", "Out of date"] : null;
  vcsSceneEl.replaceChildren(...(chip ? [iconNode(chip[0], 12), chip[1]] : []));
  vcsSceneEl.hidden = !chip;
  // The tip names the version control the state comes from, as Storyletter's chip does.
  const tip = chip ? `${chip[1]} (${vcSystemName})` : "";
  if (tip) { vcsSceneEl.dataset["tip"] = tip; vcsSceneEl.setAttribute("aria-label", tip); }
  else { delete vcsSceneEl.dataset["tip"]; vcsSceneEl.removeAttribute("aria-label"); }
  vcsSceneEl.classList.toggle("locked", !!st?.lockedBy?.length);
}

/** Pull a fresh VC snapshot (one batched spawn in main), repaint the badges, and re-apply the current
 *  scene's read-only state. No-op when no project is open. */
async function refreshVcStatus(): Promise<void> {
  if (!project) return;
  const dto = await window.patter.vcStatus();
  if (!dto || !project) return; // project may have closed while we awaited
  vcSystemName = VCS_OPTIONS.find(([v]) => v === dto.vcs)?.[1] ?? dto.system;
  vcMap = new Map(dto.scenes.map((s) => [s.sceneId, { key: s.sceneId, ...s }]));
  // The project shard rides in the same map: the Properties row is badged from it, because the
  // declarations that page edits live in the project file.
  if (dto.project) vcMap.set(PROJECT_SHARD_KEY, { key: PROJECT_SHARD_KEY, ...dto.project });
  projectExtensionVc = dto.projectExtensions ?? {};
  paintNavBadges();
  applySceneVc();
}

// The toast is the shell's (@wildwinter/app-shell toast.ts): both apps had one and agreed on
// nothing but the sentences. It mounts its own node, so the `#toast` div is gone from the HTML.

// --- side panes (slide / collapse) -------------------------------------------
// The two side panes slide to full-bleed; the open/closed state is remembered per user. Closed means
// closed - the inspector only opens when the user explicitly expands it (no auto-peek on selection).
// The collapse, the drag-resize and the dblclick reset are the frame's (mountPaneShell, above); every
// change comes back through its onChange and is remembered there.
/** The script, as the place focus goes when where it was has gone: the editor while a scene shows, else
 *  nothing (the shell then picks the centre's first control). */
function scriptFocusHome(): HTMLElement | null {
  return surface && !editorEl.hidden ? (surface.view.dom as HTMLElement) : null;
}
// A dialog whose opener and its whole row were redrawn away gives focus to the script, never to <body>.
setDialogFocusFallback(() => scriptFocusHome());

/** Cmd+1 / Cmd+2 and View > Show Navigator / Show Inspector: focus into an open pane, open a closed one,
 *  close one that holds focus (app-shell's `focusOrToggle`). Electron flips a checkbox item's tick on
 *  every click, even when the pane only took focus, so the View menu is re-synced from the real state
 *  after each press. */
function togglePane(which: "nav" | "inspector"): void {
  shell.focusOrToggle(which);
  void window.patter.setPanes(panes); // refreshes the View menu's ticks from what is really open
}

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
  shell.setPaneOpen("nav", false); shell.setPaneOpen("inspector", false); shell.resetWidths(); // each reports back through onChange
  void window.patter.setPanes(panes); // and once regardless, for the display prefs when nothing above moved
  void window.patter.resetWindows(); // rescue every window to a sensible on-screen place
}

// --- Writing View (full-bleed; ephemeral, NOT persisted) ---------------------
// A pure presentation mode: a body class hides ALL chrome (both panes, both bottom bars, the topbar,
// and the surface's review gutters + tints) and eases the editor full-bleed - see the CSS in shell.css.
// It mutates NO state, so leaving restores the EXACT prior layout (open/pinned panes, Review mode,
// visible bars) for free. Esc or the exit pill (bottom right) leaves it. Only available with a project open.
let writingView = false;
function setWritingView(on: boolean): void {
  if (on === writingView || (on && panesEl.hidden)) return; // no Writing View on the welcome screen
  writingView = on;
  document.body.classList.toggle("writing-view", on);
  if (on) surface?.focus(); // keep the cursor in the script (the toggle itself is a native accelerator)
}
function toggleWritingView(): void { setWritingView(!writingView); }
writingExitEl.addEventListener("click", () => setWritingView(false));
// Label the exit affordance with the toggle shortcut (matches the View-menu accelerator), as a keycap the
// shell draws platform-true.
writingExitEl.replaceChildren("Exit writing view", keyHint("Mod+Shift+M"));

// --- colour / font theme (View menu) -----------------------------------------
let theme: ThemePrefs = { colour: "system", font: "newsreader" };

function setTheme(patch: Partial<ThemePrefs>): void {
  theme = { ...theme, ...patch };
  applyTheme(theme);
  views.theme(); // an open view draws in the editor's palette
  // Remember it (this also refreshes the View-menu radio checks) AND hand it to every other open
  // window: the helper windows share this app's palette and cannot see this one's root.
  void window.patter.setTheme(theme);
}

// --- the problems bar (bottom, prev/next nav) --------------------------------
// Validation feeds a slim bottom bar (Patterpad.md §4): a count, the current problem, and ‹ › to step
// through them - each step (and a click on the message) jumps the caret to the offending node.

let problems: Problem[] = [];
let problemAt = 0;
// The open scene's possible misspellings. Kept apart from `problems` (the validator's, project-wide): mixed in,
// the title bar's count changed whenever another scene opened, and a click that opened one looked like the
// validator losing problems (Ian, 2026-10-30, brief problems-count-without-spelling). Their own count sits in
// the problems bar and steps through this scene only.
let misspellings: Array<{ nodeId: string; word: string }> = [];
let misspellingAt = 0;

/** A human label for a quick-fix (spec §4) - writer-speak, no engine jargon. */
function fixLabel(fix: NonNullable<Problem["fix"]>): string {
  if (fix.kind === "add-to-cast") return `Add “${fix.character}” to the cast`;
  if (fix.kind === "declare-property") return `Set up “${fix.name}” (${fix.propType})`;
  if (fix.kind === "retarget-jump") return "Choose where it goes…";
  if (fix.kind === "add-prompt") return "Add a label";
  if (fix.kind === "add-fallback") return "Add a fallback";
  if (fix.kind === "pick-enum-value") return `Pick a valid value…`;
  if (fix.kind === "pick-qualifier") return "Pick a qualifier…";
  if (fix.kind === "pick-gamedata-stage") return "Choose a stage…";
  return "Fix";
}

/** A path as the project sees it: relative to the open project's folder, or as given when it lies
 *  elsewhere (or nothing is open). Undefined stays undefined, so callers can fall back to a phrase. */
function relToProject(path: string): string;
function relToProject(path: string | undefined): string | undefined;
function relToProject(path: string | undefined): string | undefined {
  if (!path) return path;
  return project && path.startsWith(project.root) ? path.slice(project.root.length).replace(/^[/\\]/, "") : path;
}

/** Friendly category names for the problems bar (the CLI keeps the precise technical codes). */
const PROBLEM_CATEGORY: Record<Problem["category"], string> = {
  structure: "Structure", condition: "Condition", interpolation: "Text",
  hygiene: "Tidy-up", "stale-bundle": "Build", merge: "Merge", "not-in-project": "Not in project",
  "game-scopes": "Shared scopes", extensions: "Extensions",
};

// The sentences themselves (one per validator code, plus the softened fallback) live in problem-copy.ts,
// on the shell's `describeProblem`; `problemLineFor` is the bar's one line per problem.

/** Rewrite a condition, swapping the invalid enum literal for a chosen valid one (quoted form first,
 *  then a bare-word fallback). Used by the pick-enum-value quick-fix. */
function rewriteEnumValue(src: string, bad: string, chosen: string): string {
  const quoted = src.split(`"${bad}"`).join(`"${chosen}"`);
  if (quoted !== src) return quoted;
  return src.replace(new RegExp(`\\b${bad.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`), chosen);
}

/** The quick-fix chip of the CURRENT paint, kept because two of the fixes hang a popover off it and an
 *  anchor has to be the element actually on screen. Null when the current problem offers no fix. */
let problemFixEl: HTMLButtonElement | null = null;

/** Draw the problems bar from `problems` + `problemAt`. Idempotent: called again on every change. */
/** The two bottom bars belong to the workspace. The overview and the Properties page hide them, and a
 *  repaint while either is up (a validation after a Properties edit, F8) must leave them hidden there,
 *  or the bar appears over a page that has no scene to step through. */
const barsBelongHere = (): boolean => !panesEl.hidden && propsDocEl.hidden && overviewEl.hidden;

/** The problems bar's spelling count: the open scene's possible misspellings, a click going to the next one.
 *  Null when there are none. It never leaves the open scene. */
function spellingChip(): HTMLButtonElement | null {
  const n = misspellings.length;
  if (n === 0) return null;
  const chip = el("button", "spelling-count", `Spelling: ${n}`);
  chip.type = "button";
  chip.dataset["tip"] = `${plural(n, "possible spelling mistake")} in this scene. Click to go to the next one.`;
  chip.addEventListener("click", () => {
    const at = misspellingAt % misspellings.length;
    misspellingAt = at + 1;
    const m = misspellings[at];
    if (m) surface?.revealNode(m.nodeId);
  });
  return chip;
}

function paintProblems(): void {
  if (!barsBelongHere()) { problembarEl.hidden = true; return; }
  const cur = problems[problemAt];
  const fix = cur?.fix;
  problemFixEl = null;
  if (fix) {
    const chip = el("button", "stepbar-action", fixLabel(fix));
    chip.type = "button";
    chip.addEventListener("click", () => void applyCurrentFix());
    problemFixEl = chip;
  }
  const ext = extensionProblemContext();
  renderStepperBar(problembarEl, {
    items: problems.map((p) => {
      const tag = PROBLEM_CATEGORY[p.category] ?? "Problem";
      // A problem in ANOTHER scene says which, up front: "This snippet is empty" about a bubble that is
      // not on screen gave nothing to look for (the Hamlet demo, 2026-09-03). One in the open scene
      // stays as it was; the name would only be noise there. The scene name rides the bar's own `where`
      // segment, drawn beside the sentence, not joined into it.
      const elsewhere = p.sceneId && p.sceneId !== currentSceneId ? project?.scenes.find((s) => s.id === p.sceneId)?.name : undefined;
      // `kindClass` is how severity colour stays app-side: the bar paints nothing itself.
      return { kind: tag, kindClass: `sev-${p.severity}`, ...(elsewhere ? { where: elsewhere } : {}), text: problemLineFor(p, relToProject(p.file), ext) };
    }),
    at: problemAt,
    // The tone follows the CURRENT problem, not the worst one, which is what the old `.warning` class on
    // the host did: an advisory issue reads softer than a hard error while you are standing on it.
    tone: cur?.severity === "error" ? "danger" : "warn", // an error in the danger colour, count and tag alike, as Storyletter shows it; a warning or a note softer
    tips: { prev: "Previous problem", next: "Next problem", go: "Go to issue" },
    onStep: (next) => {
      problemAt = next;
      paintProblems();
      void goToProblem(problems[problemAt]);
    },
    onGo: (i) => { void goToProblem(problems[i]); },
    actions: [problemFixEl, spellingChip()],
    // No problems and no misspellings, no problems bar: this one is ambient, not a mode. With only
    // misspellings, it stays up to show their count beside a clean line.
    ...(misspellings.length > 0 ? { empty: healthCleanLine() } : {}),
  });
  paintHealth();
}

/** The topbar's health chip: a tick when clean, the count when not (the tone follows the worst). The
 *  problems list is project-wide, so the clean answer names where the author is standing. */
function paintHealth(): void {
  const n = problems.length;
  const errs = problems.filter((p) => p.severity === "error").length;
  healthEl.className = `healthchip ${n === 0 ? "ok" : errs > 0 ? "err" : "warn"}`;
  healthEl.replaceChildren(n === 0 ? iconNode("tick", 12) : String(n));
  const tip = n === 0 ? healthCleanLine() : `${plural(n, "problem")}. Click to step through them.`;
  healthEl.dataset["tip"] = tip;
  healthEl.setAttribute("aria-label", tip);
}
function healthCleanLine(): string {
  // The check covers the whole project, so the clean answer names the project, as Storyletter's does.
  return `No problems in ${project?.name ?? "this project"}`;
}
healthEl.addEventListener("click", () => {
  if (problems.length > 0) { problemAt = 0; paintProblems(); void goToProblem(problems[0]); return; }
  toast(healthCleanLine(), "ok"); // the clean state answers rather than doing nothing
});

/** Edit > Select All. In the editor it means the field the caret is in, never the whole scene
 *  (patterpad-surface/src/selectall.ts); anywhere else - a settings field, the notes box, a text
 *  input - it means what it always did, which is why this does not just call the surface. */
function selectAllCommand(): void {
  if (surface?.view.hasFocus() && surface.selectAllInBeat()) return;
  // An input, a text area, or an editable element outside the script (the scene title) selects its own
  // text. The native fallback is left for the rest; in the scene title it selected the whole window.
  if (selectAllOutsideEditor(document.activeElement, surface?.view.dom ?? null)) return;
  document.execCommand("selectAll");
}

// --- the clash resolver (ruling Q21) ------------------------------------------------------------------
// The shell lists and asks; main decides, as one step of the project history each, through the same
// `projectCommit` every project write uses. A decision lands like an undo does: the project is read back
// and the open scene reloads when its files changed (`afterProjectHistory`), and the step goes on the
// journal, so Edit ▸ Undo takes it back.

let clashResolver: ClashResolver | null = null;

/** One decision, as the resolver asks for it: the editor's pending writes land first (the shard is read from
 *  disk), then main writes the step. A refusal throws, and the resolver says so and keeps the clash. */
async function decideClash(id: string, decision: "ours" | "theirs" | "resolved"): Promise<ClashDto[]> {
  if (!project) return [];
  await flushPending();
  const r = await tracked(window.patter.decideClash(id, decision));
  clashBar.update(r.clashes.length);
  if (!r.ok) throw new Error(r.error ?? "it couldn't be written");
  if (r.step && r.project) {
    await afterProjectHistory({ ok: true, label: r.step.label, id: r.step.id, project: r.project, scenes: r.step.scenes, authoring: r.step.authoring });
  }
  return r.clashes;
}

/** Edit: take the author to the place the clash names, so they can settle it by hand and come back to
 *  Mark resolved. A scene's node (or its title), a Project Settings tab, or the Properties page. */
async function goToClash(id: string): Promise<void> {
  if (!project) return;
  const t = await window.patter.clashTarget(id);
  if (t.kind === "scene") {
    if (!project.sceneIds.includes(t.sceneId)) { toast("That scene isn't in the project any more.", "error"); return; }
    if (!overviewEl.hidden) await openSceneFromOverview(t.sceneId);
    else if (t.sceneId !== currentSceneId || !propsDocEl.hidden) await loadScene(t.sceneId);
    if (t.nodeId && surface?.revealNode(t.nodeId)) { surface.focus(); return; }
    if (!surface?.focusTitle()) surface?.focus();
  } else if (t.kind === "settings") {
    await openProjectSettings(t.tab.startsWith("extension:") ? settingsSectionId(t.tab.slice("extension:".length)) : t.tab);
  } else if (t.kind === "properties") {
    await showPropertiesDoc();
    if (t.name) revealRowWhenReady(propsDocHostEl, t.name);
  } else {
    toast("That clash has no place in the editor\nKeep mine, or take theirs, in the resolver.", "info");
  }
}

const clashAdapter: ClashAdapter = {
  list: () => window.patter.listClashes(),
  resolve: (id, side) => decideClash(id, side),
  edit: (id) => void goToClash(id),
  markResolved: (id) => decideClash(id, "resolved"),
};

/** File ▸ Resolve Clashes…, the banner's Resolve…, and the command palette's entry. */
function openClashes(): void {
  if (!project) return;
  if (clashResolver?.isOpen()) return;
  clashResolver = openClashResolver({
    adapter: clashAdapter,
    onChange: (left) => clashBar.update(left.length),
    onClose: () => { clashResolver = null; },
  });
}

/** Ask main for the clashes again: on open, after a merge, after an undo or redo. The open resolver asks
 *  for itself (and feeds the banner); otherwise the banner and the menu item are brought up to date. */
async function refreshClashes(): Promise<void> {
  if (!project) { clashBar.update(0); return; }
  if (clashResolver?.isOpen()) { await clashResolver.refresh(); return; }
  try { clashBar.update((await window.patter.listClashes()).length); } catch { /* the banner keeps its count */ }
}

/** Edit > Undo and Redo in the main window: the focused field's own text, or the journal's newest entry
 *  (the open scene's history or the project's), by `undoRoute` (edit-commands.ts). On the Properties page
 *  only a project step: the page's own saves. */
async function undoCommand(dir: "undo" | "redo", fromView = false): Promise<void> {
  // A view extension passed its Cmd+Z on: whatever has the focus here, it means the editor's journal.
  const route = fromView ? (!project ? "none" : !propsDocEl.hidden ? "project" : "journal") : undoRoute({
    active: document.activeElement,
    sceneAreas: [editorEl, inspectorStackEl],
    dialogOpen: !!document.querySelector("dialog[open]"),
    view: !project ? "none" : !propsDocEl.hidden ? "properties" : !overviewEl.hidden ? "overview" : !panesEl.hidden ? "scene" : "none",
  });
  if (route === "field") { document.execCommand(dir); return; }
  if (route === "none") return;
  await settleForUndo();
  const next = dir === "undo" ? journal.peekUndo() : journal.peekRedo();
  if (!next || (route === "project" && next.kind !== "project")) return;
  // A project step may rewrite the open scene's files: whatever it holds goes to disk first, so the step
  // finds the bytes it left (and the scene reloads from what the step put back).
  if (next.kind === "project") await flushPending();
  journalBehind = false;
  await (dir === "undo" ? journal.undo(applyJournalEntry) : journal.redo(applyJournalEntry));
  // The journal caught up with a step it hadn't heard of: that step is the newest, so it is the one undone.
  if (journalBehind) { journalBehind = false; await (dir === "undo" ? journal.undo(applyJournalEntry) : journal.redo(applyJournalEntry)); }
}
/** Set when main's answer showed the journal was missing a newer step (see `catchUp`). */
let journalBehind = false;

/** A toast's Undo: take back project step `id`, but only while it is still the newest thing done, so the
 *  button never undoes something else (the October 2026 review: Undo replaces "Are you sure?"). Anything
 *  done since, and it says so instead: Edit > Undo steps back through it in order. */
async function undoStepIfNewest(id: number): Promise<"done" | "stale"> {
  if (!project) return "stale";
  await settleForUndo();
  const top = journal.peekUndo();
  if (!top || top.kind !== "project" || top.id !== id) return "stale";
  await flushPending();
  journalBehind = false;
  await journal.undo(applyJournalEntry);
  // Main had a newer step the journal hadn't heard of, so nothing was undone: the step isn't the newest.
  if (journalBehind) { journalBehind = false; return "stale"; }
  return "done";
}
/** The newest project entry in the journal, if the newest entry is one. */
function topProjectStep(): { id: number; label: string } | undefined {
  const top = journal.peekUndo();
  return top?.kind === "project" ? { id: top.id, label: top.label } : undefined;
}
const STALE_UNDO = "That's no longer the latest change. Undo in the Edit menu steps back to it.";
/** Report a step with an Undo button on the toast. A merged step (or none) gets the plain toast. */
function toastWithUndo(message: string, kind: ToastKind, step: ProjectStep | undefined): void {
  if (!step || step.merged) { toast(message, kind); return; }
  const id = step.id;
  toast(message, kind, { action: { label: "Undo", run: () => void undoStepIfNewest(id).then((r) => { if (r === "stale") toast(STALE_UNDO); }) } });
}

/** Before the journal is asked what is newest: every project write in the air has landed and been noted,
 *  Notes still inside their debounce are saved (a step of their own), and so is the Properties page. */
async function settleForUndo(): Promise<void> {
  if (!propsDocEl.hidden) { schedulePropsSave.cancel(); await savePropsDoc(); }
  await persistDocs();
  while (inflightWrites.size > 0) await Promise.allSettled([...inflightWrites]);
}

/** Send one journal entry to its history. A scene entry undoes in the open scene (shown first, from the
 *  overview: ruling 4), or is refused, with the lock named, in a scene somebody else holds. A project
 *  entry goes to main by its id, and the editor then refreshes whatever the step touched. */
async function applyJournalEntry(entry: JournalEntry, way: "undo" | "redo"): Promise<EntryResult> {
  if (entry.kind === "scene") {
    // A scene you've left is shown first, then undone, so an undo is always something you can see. If its
    // files have changed since, it opens fresh and the entry has nothing left to undo.
    if (entry.sceneId !== surfaceSceneId && keptScenes.has(entry.sceneId)) {
      if (!overviewEl.hidden || !propsDocEl.hidden) await openSceneFromOverview(entry.sceneId);
      else await loadScene(entry.sceneId);
    }
    if (!surface || entry.sceneId !== surfaceSceneId) return "skip";
    if (!overviewEl.hidden) await openSceneFromOverview(entry.sceneId);
    if (!surface) return "skip";
    if (!surface.isEditable()) {
      const who = vcMap.get(entry.sceneId)?.lockedBy ?? [];
      toast(`Couldn't ${way} that edit\nThis scene is locked${who.length ? ` by ${who.join(", ")}` : ""}, so it can't be changed here.`, "error");
      return "refused";
    }
    if ((way === "undo" ? surface.undoDepth() : surface.redoDepth()) === 0) return "skip"; // past the history's depth
    // An extension's data somebody else holds: the step stays, for when they let it go.
    const locked = surface.historyRefusal(way);
    if (locked) { toast(`Couldn't ${way} that edit\n${locked}`, "error"); return "refused"; }
    return (way === "undo" ? surface.undo() : surface.redo()) ? "done" : "skip";
  }
  const r = await (way === "undo" ? window.patter.projectUndo(entry.id) : window.patter.projectRedo(entry.id));
  if (r.ok) { await afterProjectHistory(r); void refreshClashes(); return "done"; }
  // Out of step with main: either a step is still on its way here (catch up, and ask again), or main has
  // really let this one go.
  if (r.stale) {
    if (journal.catchUp(entry, r.top) === "skip") return "skip";
    journalBehind = true;
    return "refused";
  }
  landed(r, `Couldn't ${way} ${entry.label}`);
  return r.drift ? "drift" : "refused";
}

/** After a project undo or redo: the open scene reloads when the step rewrote its script (or is gone, when
 *  it was the scene the step made), its status and notes refresh in place when only its authoring shard
 *  moved, and everything that reads the project file is redrawn, as a settings save does. */
async function afterProjectHistory(r: ProjectHistoryOutcome): Promise<void> {
  if (!r.project || !project) return;
  project = r.project;
  views.changed("all");
  projectNameEl.textContent = project.name;
  renderNav();
  // Kept scenes the step rewrote, or took away, can't come back as they were.
  for (const id of [...keptScenes.keys()]) if (r.scenes.includes(id) || !project.sceneIds.includes(id)) forgetScene(id);
  const open = surfaceSceneId;
  if (open && !project.sceneIds.includes(open)) {
    // An undo of New Scene (or a redo of Delete Scene) took away the scene on screen: there is nothing of
    // it left to save, so land on the first scene instead.
    saver.cancel(); docsDirty = false; commentsDirty = false;
    journal.dropScene(open);
    surface?.destroy(); surface = null; surfaceSceneId = null; editorEl.replaceChildren();
    const wasShowing = currentSceneId === open;
    currentSceneId = null;
    if (wasShowing && project.scenes[0]) await loadScene(project.scenes[0].id, { behind: true });
  } else if (open && currentSceneId === open && r.scenes.includes(open)) {
    await reloadOpenScene();
  } else if (open && r.scenes.includes(open)) {
    // Out of sight behind the Properties page: remounted on the way back, from what the step put back.
    journal.dropScene(open);
  } else if (currentSceneId && r.authoring.includes(currentSceneId)) {
    await refreshSceneAuthoring();
  }
  if (currentSceneId) {
    const fresh = await window.patter.readScene(currentSceneId);
    sceneProps = fresh.properties;
    setHostScopeTokens(fresh.hostScopes);
    highlightNav(currentSceneId);
  }
  await buildSpellcheck();
  pushWritingStatus();
  pushCast(); // an undone add, or a rename taken back, leaves the speaker picker and the cue colours
  surface?.setQualifiers(project.qualifiers ?? []);
  pushJumpTargets();
  await refreshPatterProps();
  if (!propsDocEl.hidden) mountPropsDoc();
  if (!overviewEl.hidden) renderOverview();
  void refreshVcStatus();
  void refreshProblems();
  lastInspectorSig = null; if (lastInspectorCtx) showInspector(lastInspectorCtx);
}

/** Re-read the open scene's status, notes, and re-record flags after a step put its authoring shard back,
 *  so the next status set starts from what is on disk rather than writing the undone map over it. */
async function refreshSceneAuthoring(): Promise<void> {
  const id = currentSceneId;
  if (!id) return;
  const [docs, writing, recording, rerecord] = await Promise.all([
    window.patter.readDocs(id), window.patter.readWriting(id), window.patter.readRecording(id), window.patter.readRerecord(id),
  ]);
  if (currentSceneId !== id) return;
  docMap = docs; docsDirty = false;
  writingMap = writing;
  recordingMap = recording;
  rerecordMap = rerecord;
  pushDocNotes();
  pushWritingStatus();
}

/** Take the author to a problem's node: switch to its scene first when it lives elsewhere (the surface
 *  reveals only within the open scene, so a problem in another scene used to answer "Go to issue" with
 *  nothing, 2026-09-03), then reveal it. A problem with no node (a file-level one) has nowhere to go. */
async function goToProblem(p: Problem | undefined): Promise<void> {
  // A Patter extension's project-level problem (its project values, its manifest, its entry in the project
  // file) is fixed in its section of Project Settings.
  const section = p ? problemSettingsSection(p, project?.extensions) : null;
  if (section) { await openProjectSettings(section); return; }
  if (!p?.nodeId) return;
  if (p.sceneId && p.sceneId !== currentSceneId) await loadScene(p.sceneId);
  surface?.revealNode(p.nodeId);
}

async function applyCurrentFix(): Promise<void> {
  const fix = problems[problemAt]?.fix;
  if (!fix) return;
  // Two of the fixes hang a popover off the chip that launched them. The chip is rebuilt each paint, so
  // take the live one; the bar itself is the fallback anchor if there somehow is not one.
  const anchor: HTMLElement = problemFixEl ?? problembarEl;
  if (fix.kind === "retarget-jump") {
    // A surface edit, not a project write: open the shared jump picker, set it, save, then re-validate.
    surface?.editJump(fix.snippetId, anchor, () => { void (async () => { await save(); await refreshProblems(); })(); });
    return;
  }
  if (fix.kind === "add-prompt") {
    // Surface edit: insert an empty prompt cell into the option, reveal it, save, re-validate.
    if (surface?.addPrompt(fix.optionId)) { surface.revealNode(fix.optionId); await save(); await refreshProblems(); }
    return;
  }
  if (fix.kind === "add-fallback") {
    // Surface edit: append a fallback option to the choice (the caret lands in it), save, re-validate. The
    // choice may be in another scene: open it first, as Go to issue would.
    const p = problems[problemAt];
    if (p?.sceneId && p.sceneId !== currentSceneId) await loadScene(p.sceneId);
    if (surface?.addFallback(fix.choiceId)) { await save(); await refreshProblems(); }
    return;
  }
  if (fix.kind === "pick-enum-value") {
    // Surface edit: pick a valid value, rewrite the condition, save, re-validate. Uses the problem's node
    // id (the snippet / group / option).
    const nodeId = problems[problemAt]?.nodeId;
    if (!nodeId) return;
    openValuePicker({
      anchor, title: `Instead of “${fix.bad}”`, values: fix.options,
      onPick: async (v) => { if (surface?.setCondition(nodeId, rewriteEnumValue(fix.src, fix.bad, v))) { await save(); await refreshProblems(); } },
    });
    return;
  }
  if (fix.kind === "pick-gamedata-stage") {
    // Surface edit: put the node's game-data value back on its field's ladder, save, re-validate. The node
    // may be in another scene: open it first, as Go to issue would.
    const p = problems[problemAt];
    openValuePicker({
      anchor, title: `Instead of “${fix.bad}”`, values: fix.options,
      onPick: async (stage) => {
        if (p?.sceneId && p.sceneId !== currentSceneId) await loadScene(p.sceneId);
        surface?.setGameData(fix.nodeId, fix.field, stage);
        await save(); await refreshProblems();
      },
    });
    return;
  }
  if (fix.kind === "pick-qualifier") {
    // Surface edit: pick one of the project's qualifiers (or none) for the line, save, re-validate. The
    // line may be in another scene: open it first, as Go to issue would.
    const p = problems[problemAt];
    const rows = qualifierRows(project?.qualifiers ?? []); // read by row: a qualifier may be named "None"
    openValuePicker({
      anchor, title: `Instead of “${fix.bad}”`, values: rows.values,
      onPick: async (_name, index) => {
        if (p?.sceneId && p.sceneId !== currentSceneId) await loadScene(p.sceneId);
        const gameId = rows.gameIdAt(index);
        if (surface?.setQualifier(fix.lineId, gameId)) { await save(); await refreshProblems(); }
      },
    });
    return;
  }
  const res = await tracked(window.patter.applyFix(fix)); // add-to-cast / declare-property (project-file writes)
  if (!landed(res, "Couldn't apply the fix")) return;
  if (fix.kind === "declare-property") {
    void refreshPatterProps(); // the navigator's count just moved
    // And the condition and effects editors learn the new property now, not at the next scene load.
    const st = await window.patter.readSettings();
    if (st) sceneProps = [...st.properties.map((d) => declToConditionProperty("patter", d)), ...sceneProps.filter((p) => p.scope === "scene")];
  }
  await refreshProblems(); // re-validate: the fixed problem (and its squiggle) drops out
}

/** A speaker qualifier's shown name for its gameId ("" stays "", one the project no longer lists shows
 *  its gameId). */
function qualifierShownName(gameId: string): string {
  if (!gameId) return "";
  return project?.qualifiers?.find((q) => q.gameId === gameId)?.name ?? gameId;
}

/** Edit ▸ Cycle Speaker Qualifier: the caret's dialogue line steps to the next qualifier, then none. Says
 *  why when it can't, since a menu command that quietly does nothing reads as broken. */
function cycleQualifierCommand(): void {
  if (!surface || !project) return;
  if (surface.cycleQualifier()) return;
  if (!(project.qualifiers ?? []).length) toast("This project has no speaker qualifiers. Add them in Project Settings.", "info");
  else if (surface.isEditable()) toast("Put the caret in a dialogue line to change its qualifier.", "info");
}

/** Register a brand-new character (from the cue popup's "+ Add") in the project master cast, so it persists
 *  beyond this session and shows in Project Settings > Cast. Reuses the add-to-cast project-file write; then
 *  reflects the name in the cached project, rebuilds spell-check (so the new cue isn't squiggled), and
 *  re-validates (a "character not in cast" warning, if any, drops). Idempotent on an existing name. */
/** Hand the surface the project's cast as it is now: the names its speaker picker offers (which otherwise
 *  only grow, so an undone add or a rename would linger there: the hands-on fixes review, Q15) and each
 *  member's kept colour. Called after every step that can change the cast: an add, a Settings save (a
 *  rename), and any undo or redo of those. */
function pushCast(): void {
  if (!project || !surface) return;
  surface.setCast(project.cast);
  surface.setCastColours(project.castColours);
}

async function registerCharacter(name: string): Promise<void> {
  const n = name.trim();
  if (!project || !n) return;
  if (project.cast.some((c) => c.toLowerCase() === n.toLowerCase())) return; // already in the master cast
  const res = await tracked(window.patter.applyFix({ kind: "add-to-cast", character: n }));
  if (!landed(res, `Couldn't add ${n} to the cast`)) return;
  project.cast = [...project.cast, n]; // keep castSeed / spell-check in sync without a reload
  pushCast();
  await buildSpellcheck();
  await refreshProblems();
}

/** Push the current problems to the surface as inline squiggles (ids not in the open scene are ignored).
 *  Spelling isn't among them: it has its own wavy underline from the spell-check plugin (#177). */
function applyProblemMarks(): void {
  // A note (info: a choice that can run dry and then carry on) stays in the bar: it isn't a fault to mark.
  surface?.markProblems(problems
    .filter((p) => p.nodeId && p.severity !== "info")
    .map((p) => ({ id: p.nodeId!, severity: p.severity as "error" | "warning" })));
}

function renderProblems(dto: ProblemsDto): void {
  // The validator's problems, project-wide, for the count and the stepper; the open scene's spelling (#177)
  // beside them, counted on its own. Spelling is editorial and never blocks a build.
  // Stay on the problem being looked at: this runs at every typing pause and every save, and starting
  // again from the first sent anyone stepping through the list back to the top each time they typed.
  // The same problem is the same node and message; when it has gone (fixed), the one now in its place.
  misspellings = surface?.spellingIssues() ?? [];
  const was = problems[problemAt];
  const next = [...dto.problems];
  const same = was ? next.findIndex((q) => q.nodeId === was.nodeId && q.message === was.message) : -1;
  problems = next;
  problemAt = same >= 0 ? same : Math.min(problemAt, Math.max(0, problems.length - 1));
  applyProblemMarks(); // inline squiggles at the offending sites
  paintProblems();     // hides itself when the list is empty
}

async function refreshProblems(): Promise<void> {
  // Validate the LIVE in-memory source of the open scene (not just disk) so problems track edits as
  // they happen - toggling sticky, fixing a condition, etc. clears/raises issues without a save first.
  const live = surface && currentSceneId ? { sceneId: currentSceneId, ...surface.getSource() } : undefined;
  renderProblems(await window.patter.validate(live));
}

// Re-validate shortly after edits settle (debounced): the problems panel reflects unsaved changes, and
// any open play session is told the scene changed (it freezes until restart, then plays the new source).
const scheduleValidate = debounce(() => {
  void refreshProblems();
  // Only a genuine user edit tells the play session the scene changed - never a programmatic load.
  if (sceneEdited && surface && currentSceneId) { const s = surface.getSource(); window.patter.playEdited(currentSceneId, s.flow, s.loc, s.extensions); }
}, 350);

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
  const res = await tracked(window.patter.saveDocs(currentSceneId, docMap));
  if (!landed(res, "Couldn't save the notes")) docsDirty = true;
}

// Which documentation CLASSES the editor surfaces (View > Documentation). "everyone" + untyped are always
// shown; the rest default to shown and the author can hide them. Seeded from persisted panes on boot.
let docHidden = new Set<string>();
const docVisible = (cls: string): boolean => cls === "" || cls === "everyone" || !docHidden.has(cls);

/** Open the Notes editor (modal) for a node: the family's, the shell's `openNotesEditor` (ruling I of the
 *  October 2026 review), which was taken from this app's own and had drifted from it. `kind` (the node kind)
 *  narrows which classes are offered; `focus` opens on one class (Needs re-record asks for a VO note). The
 *  edit commits once, on close, and re-surfaces in the script and the inspector. */
function openNoteEditor(id: string, _anchor: HTMLElement, kind?: string, focus?: string): void {
  openNotesEditor({
    sub: "A VO note travels with the voice script, a Localisers note with the localisation handoff, and an Editors note with an editable script. An untyped note stays in Patterpad.",
    notes: { own: docMap[id] ?? [], classes: docClassesForKind(kind).map((c) => c.name) },
    ...(focus !== undefined ? { focus } : {}),
    save: (lines) => {
      if (lines.length) docMap[id] = lines; else delete docMap[id];
      docsDirty = true;
      pushDocNotes();   // reflect the edit in the script (the note icon appears / updates / clears)
      lastInspectorSig = null; if (lastInspectorCtx) showInspector(lastInspectorCtx); // flip the inspector note icon
      void persistDocs();
    },
  });
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
  if (!landed(res, "Couldn't save the comments")) commentsDirty = true;
}

/** Push the comment threads to the surface (range threads highlight + fly a bubble; whole-beat threads
 *  fly a gutter bubble), filtered by the resolved toggle. */
function pushCommentMarks(): void {
  surface?.setComments(
    comments
      .filter((t) => showResolved || !t.resolved)
      .map((t) => {
        // Tombstones count for nothing OUT HERE: a withdrawn message keeps its place
        // inside the thread, but a bubble reading "2" for one real comment and one
        // deletion, or a tooltip with a blank line in it, would just be wrong.
        const said = t.messages.filter((m) => m.deleted !== true);
        return {
          id: t.id, nodeId: t.anchor, from: t.range?.from, to: t.range?.to, quote: t.range?.quote,
          count: said.length, resolved: !!t.resolved,
          // The thread rendered for the in-script hover tooltip (capped so it stays readable). The
          // commenter's name is bolded (the tooltip turns the markers into <strong>).
          preview: said.map((m) => `${tipBold(`${m.author || "Someone"}:`)} ${m.body}`).join("\n").slice(0, 400),
        };
      }),
  );
}

/** Open / start a thread. A bubble click opens the existing thread (by id); the selection affordance
 *  starts a RANGE thread; the ⋯ menu / inspector row opens the node's active whole-beat thread (or a
 *  fresh one). A new thread is only committed to `comments` once its first message is posted. */
function openComments(req: CommentOpenRequest): void {
  // WHICH threads the popover is given, which decides whether its picker appears.
  // Patterpad usually knows the answer already and should keep saying so:
  //   - a bubble click names its thread, so hand over exactly that one;
  //   - a selection starts a NEW range thread, so hand over none (the shell opens
  //     a composer and focuses it), and the range rides in `pending` below;
  //   - the inspector row and the ⋯ menu mean "this beat's whole-beat comments",
  //     which is where the picker earns its place: there is at most one UNRESOLVED
  //     by construction, but with Show Resolved on there can be several archived,
  //     and the old code silently opened whichever it found first.
  // Range threads are deliberately NOT gathered by node: they are pinned to
  // different spans and each has its own highlight, so the highlight IS the
  // picker, and a list would offer you a thread about a phrase you did not click.
  const named = req.threadId ? comments.find((c) => c.id === req.threadId) : undefined;
  const threads = named ? [named]
    : req.range ? []
    : comments.filter((c) => c.anchor === req.nodeId && !c.range);
  const pending = req.range;
  // The threads the popover is about, answered after each change so it shows them as they now stand: the ones
  // it opened with, and a new one once its first message is posted.
  const about = new Set(threads.map((t) => t.id));
  const current = (): Comment[] => comments.filter((c) => about.has(c.id));

  shellComments({
    anchor: req.anchor, subject: "this line", threads, showResolved,
    prefer: "left", keepClear: PANEL_KEEP_CLEAR,
    // The span a thread is pinned to, quoted above it. Whole-beat threads have
    // none, and get no quotation.
    quoteFor: (t) => (t as Comment).range?.quote,
    newThreadId: newCommentId,
    post: (threadId, body) => {
      let t = comments.find((c) => c.id === threadId);
      if (!t) {
        // First message commits the thread: a composer somebody thought better of
        // leaves nothing behind.
        t = { id: threadId, anchor: req.nodeId, ...(pending ? { range: pending } : {}), messages: [] };
        comments.push(t);
      }
      t.messages.push({ author: authorName || "Me", ts: new Date().toISOString(), body });
      about.add(threadId);
      commentsDirty = true; pushCommentMarks(); void flushReview();
      return current();
    },
    setResolved: (threadId, resolved) => {
      const t = comments.find((c) => c.id === threadId);
      if (!t) return;
      t.resolved = resolved;
      commentsDirty = true; pushCommentMarks(); void flushReview();
      return current();
    },
    // One rule, per comment-delete.md: the message becomes a tombstone, and the
    // thread goes when nothing readable would be left. The body is EMPTIED here
    // rather than on save, because "deleted" has to mean gone from the file.
    deleteMessage: (threadId, index) => {
      const t = comments.find((c) => c.id === threadId);
      const m = t?.messages[index];
      if (!t || !m) return;
      m.deleted = true;
      m.body = "";
      if (t.messages.every((x) => x.deleted === true)) comments.splice(comments.indexOf(t), 1);
      commentsDirty = true; pushCommentMarks(); void flushReview();
      return current();
    },
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
 *  or an inspector dropdown. One beat takes exactly what's chosen; several (a scene, a block, a container,
 *  a selection) are raised to it, those further along left as they are, and the lowest rung clears them all
 *  (status-raise.ts, Q17). Updates the map, persists to the .patterx as one step, repaints the gutter
 *  badges, and re-renders the inspector (its selection signature is unchanged). */
function setLineStatus(ids: string[], status: string | null): void {
  if (!currentSceneId || !ids.length) return;
  const changes = planStatus(ids, status, (id) => writingMap[id], project?.writingStatuses ?? []);
  if (!changes.size) { lastInspectorSig = null; if (lastInspectorCtx) showInspector(lastInspectorCtx); return; } // the dropdown snaps back
  for (const [id, next] of changes) { if (next) writingMap[id] = next; else delete writingMap[id]; }
  surface?.setWritingStatus(writingMap);
  void tracked(window.patter.saveWriting(currentSceneId, writingMap));
  lastInspectorSig = null; if (lastInspectorCtx) showInspector(lastInspectorCtx); // a scene's or block's floor may have moved too
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
  // The copies' status and notes are part of the Duplicate: each write's step joins the journal entry
  // below it, so one Cmd+Z takes the duplicate and what it carried (the paired gesture).
  const join = (r: SaveResult): void => { if (r.step && !r.step.merged) journal.join(r.step.id); };
  if (writing) { surface?.setWritingStatus(writingMap); void tracked(window.patter.saveWriting(currentSceneId, writingMap)).then(join); }
  if (docs) { pushDocNotes(); void tracked(window.patter.saveDocs(currentSceneId, docMap)).then(join); }
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
  views.changed("all", { saved: false }); // a new take changes a line's length
  const ctx = lastInspectorCtx; // a visible recording chip may now resolve differently
  if (ctx && audioOn()) { lastInspectorSig = null; showInspector(ctx); }
});

// Fire-and-forget playback of a line's audio (the inspector ▶ button, folder mode). Fetches the bytes from
// main, wraps them in a Blob, and plays - one clip at a time (a new click stops the previous). The clicked
// button pulses (.playing) while its clip sounds, so it's clear which line you're hearing - and clicking
// it AGAIN while its clip is sounding stops it (the ▶ doubles as an abort). A view asks for the same player
// (Y1), and every open view hears which take is sounding, whoever started it. Returns whether it plays.
let inspectorAudio: HTMLAudioElement | null = null;
let inspectorPlayBtn: HTMLButtonElement | null = null;
async function playLineAudio(id: string, btn?: HTMLButtonElement): Promise<boolean> {
  if (btn && btn === inspectorPlayBtn && inspectorAudio && !inspectorAudio.paused) {
    inspectorAudio.pause(); // second click on the sounding clip's own button = stop, not restart
    return false;
  }
  const data = await window.patter.readAudio(id);
  if (!data) return false; // no file (the button only shows when one resolved; a view may ask for any line)
  inspectorAudio?.pause();                       // stop any current clip...
  inspectorPlayBtn?.classList.remove("playing"); // ...and drop its pulse
  const url = URL.createObjectURL(new Blob([data.bytes as BlobPart], { type: data.mime }));
  const audio = new Audio(url);
  inspectorAudio = audio; inspectorPlayBtn = btn ?? null;
  btn?.classList.add("playing");
  if (btn) btn.dataset.tip = "Stop audio";
  views.playing(id);
  const stop = (): void => {
    URL.revokeObjectURL(url); btn?.classList.remove("playing"); if (btn) btn.dataset.tip = "Play audio";
    // The old clip's pause arrives after the next one started: only the clip still current says it stopped.
    if (inspectorAudio === audio) { inspectorAudio = null; views.playing(null); }
  };
  audio.addEventListener("ended", stop);
  audio.addEventListener("pause", stop); // a new click (or the abort above) pauses this one
  void audio.play().catch(stop);
  return true;
}

/** Stop the clip sounding, if any: whether one was. */
function stopLineAudio(): boolean {
  if (!inspectorAudio || inspectorAudio.paused) return false;
  inspectorAudio.pause();
  return true;
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
  void tracked(window.patter.saveRecording(currentSceneId, recordingMap));
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
  void tracked(window.patter.saveRerecord(currentSceneId, rerecordMap));
  const ctx = lastInspectorCtx;
  if (ctx && ctx.levels.some((l) => (l as { id?: string }).id === id)) { lastInspectorSig = null; showInspector(ctx); }
  if (on && !hasVoNote(id)) openNoteEditor(id, document.body, "line", "vo"); // prompt for the "why", opened on the VO note
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
  if (!landed(res, "Couldn't save the suggestions")) suggestionsDirty = true;
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
  const liveSpeaker = surface.lines().find((l) => l.id === req.nodeId)?.character ?? "";
  const rows: SuggestionRow[] = suggestions
    .filter((s) => s.anchor === req.nodeId && (showResolvedSuggestions || !s.resolved))
    .map((s) => ({
      id: s.id, author: s.author, ts: s.ts, before: live, proposed: s.proposed, resolved: s.resolved, outcome: s.outcome,
      // Out of date: the text, or a proposed speaker's starting point, has moved on. (A direction is checked
      // when it's accepted, on the files.)
      stale: live !== s.baseline || (s.proposedCharacter !== undefined && liveSpeaker !== (s.baselineCharacter ?? "")),
      textChanged: s.proposed !== s.baseline,
      ...(s.proposedCharacter !== undefined ? { speaker: { from: s.baselineCharacter ?? "", to: s.proposedCharacter } } : {}),
      ...(s.proposedDirection !== undefined ? { direction: { from: s.baselineDirection ?? "", to: s.proposedDirection } } : {}),
      ...(s.proposedQualifier !== undefined ? { qualifier: { from: qualifierShownName(s.baselineQualifier ?? ""), to: qualifierShownName(s.proposedQualifier) } } : {}),
      ...(s.proposedCut ? { cut: true } : {}),
      ...(s.handoff ? { handoff: s.handoff.id } : {}),
    }));
  if (!rows.length) return;
  openSuggestionReview({
    anchor: req.anchor, rows,
    onAccept: (id) => {
      const s = suggestions.find((x) => x.id === id); if (!s) return;
      if (s.proposedCharacter !== undefined || s.proposedDirection !== undefined || s.proposedQualifier !== undefined || s.proposedCut) {
        // A speaker, direction, qualifier, or cut lives outside the say text the surface edits: decide it on the files
        // (main saves this scene first, applies every part, and reloads it).
        void acceptOnFiles(s.id);
        return;
      }
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

/** Accept a suggestion that changes more than the say text, on the files. Unsaved suggestion edits are
 *  flushed first so main sees this one; an out-of-date part is refused there and said so here. */
async function acceptOnFiles(id: string): Promise<void> {
  await flushReview();
  const res = await tracked(window.patter.decideSuggestions([{ id, accept: true }]));
  const outcome = res.results?.find((r) => r.id === id);
  if (!res.ok) toast(res.error ? `Couldn't accept: ${res.error}` : "Couldn't accept the suggestion", "error");
  else if (outcome && outcome.outcome !== "accepted") toast(outcome.reason ? `Not accepted: ${outcome.reason}` : "Not accepted", "error");
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
  // Feedback is project-wide, so it is gathered whenever a project is open: asked only with a scene open,
  // the walk said "No open comments or suggestions" on the Properties page however many there were.
  reviewItems = project
    ? await window.patter.reviewFeedback({ resolvedComments: showResolved, resolvedSuggestions: showResolvedSuggestions })
    : [];
  if (reviewAt >= reviewItems.length) reviewAt = 0;
  renderReviewBar();
}

function renderReviewBar(): void {
  if (!showReviewFeedback || !barsBelongHere()) { reviewbarEl.hidden = true; return; }
  renderStepperBar(reviewbarEl, {
    items: reviewItems.map((item) => ({
      kind: item.kind === "comment" ? "Comment" : "Rewrite",
      kindClass: item.resolved ? "done" : undefined,
      // The scene now has its OWN segment instead of being jammed on the front of the message, which is
      // the segment this app's two bars lacked and the reason the shape was worth adopting.
      where: item.sceneName,
      text: `${item.author}: ${item.text}`,
    })),
    at: reviewAt,
    tone: "accent",
    tips: { prev: tipWithKey("Previous feedback", "Shift+F8"), next: tipWithKey("Next feedback", "F8"), go: "Go to this feedback" }, // the Review menu's keys, as Storyletter's bar shows them
    onStep: (next) => { reviewAt = next; void stepReviewTo(next); },
    onGo: (i) => { const item = reviewItems[i]; if (item) void gotoReviewItem(item); },
    // A MODE, not an ambient bar: entering the walk and seeing nothing at all reads as a broken command
    // rather than as "there is no feedback", so the bar stays up and says so.
    empty: "No open comments or suggestions.",
    onClose: () => setReviewFeedback(false),
    closeTip: "Exit review feedback",
  });
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

/** Land on an index the bar has already wrapped for us: repaint, then travel. */
async function stepReviewTo(index: number): Promise<void> {
  const item = reviewItems[index];
  if (!item) return;
  renderReviewBar();
  await gotoReviewItem(item);
}

/** The Review menu's Previous / Next, which also ENTER the walk on first press (the bar's own arrows
 *  cannot: it is not on screen yet). */
async function stepReview(delta: number): Promise<void> {
  if (!showReviewFeedback) { setReviewFeedback(true); return; } // first press: enter the walk
  if (!reviewItems.length) return;
  reviewAt = (reviewAt + delta + reviewItems.length) % reviewItems.length;
  await stepReviewTo(reviewAt);
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

function showInspector(ctx: InspectorContext): void {
  // Remember the caret to the LINE (deepest node id under the selection) on every move - even when the
  // inspector projection below is unchanged (the early-return) - so open-where-you-left-off restores it.
  caretNodeId = ctx.levels.map((l) => (l as { id?: string | null }).id).find((id): id is string => !!id) ?? null;
  scheduleRemember();
  // The nav's block sub-list follows the caret: mark the block the selection sits in (null = scene level).
  const blockLevel = ctx.levels.find((l) => l.kind === "block");
  highlightNavBlock(blockLevel && "id" in blockLevel ? blockLevel.id : null);
  lastInspectorCtx = ctx; // so the global pills/text toggle can re-render this same view in place
  scheduleMoveState(); // Edit ▸ Move Up / Move Down follow the selection
  pushFields(); // the fields window follows the selection, and every edit (before the early return below)
  views.selection(); // and so does every open view
  // onSelect fires on every selection move AND every doc edit (typing). The inspector only shows a
  // projection of the caret's container stack, so skip the (pill-rebuilding) teardown when nothing it
  // displays has changed - e.g. typing dialogue text doesn't touch the shown fields.
  const sig = JSON.stringify(ctx.levels);
  if (sig === lastInspectorSig) return;
  lastInspectorSig = sig;
  // A seen() / visits() naming a scene or block that's gone reads "Missing scene" / "Missing block", as on the page.
  const nodeLabel = (nid: string): string => surface?.jumpLabel(nid) ?? missingLabel(nid);
  renderInspector(inspectorStackEl, ctx, {
    reveal: (id) => { surface?.revealNode(id); },
    levelOpen: (key) => panes.inspectorOpen?.[key],
    setLevelOpen: (key, open) => {
      panes = { ...panes, inspectorOpen: { ...panes.inspectorOpen, [key]: open } };
      void window.patter.setPanes(panes); // a display pref, remembered across launches like the others
    },
    editNote: (id, anchor, kind) => openNoteEditor(id, anchor, kind), // title-bar note icon -> notes modal
    hasNotes: (id) => (docMap[id]?.length ?? 0) > 0,                   // filled vs outline note icon
    editCondition: (id, src, anchor) => openConditionEditor({
      anchor, src, properties: sceneProps,
      pickNode: (a, current, onPick) => surface?.pickNode({ anchor: a, current, onPick }),
      nodeLabel,
      onChange: (next) => { surface?.setCondition(id, next); },
    }),
    condPreview: (src) => renderConditionPills(src, sceneProps, nodeLabel),
    effectsPreview: (effects) => renderEffectsPills(effects, sceneProps, nodeLabel),
    editGameId: (id, gameId, address, anchor) => { openGameIdEditor({ anchor, value: gameId, derived: address, onCommit: (g) => void commitGameId(id, gameId, g), slugify: gameIdify, validate: isValidGameId, prefer: "left", keepClear: PANEL_KEEP_CLEAR }); },
    editGroupProps: (id, patch) => { surface?.setGroupProps(id, patch); },
    editJump: (id, _current, anchor) => surface?.editJump(id, anchor),
    // A multi-selection's edits: each writes every chunk in the run, as one undo step (the surface's batch).
    batch: (edits) => { if (surface) surface.batch(edits); else edits(); },
    editConditionMany: (ids, src, anchor) => openConditionEditor({
      anchor, src, properties: sceneProps,
      pickNode: (a, current, onPick) => surface?.pickNode({ anchor: a, current, onPick }),
      nodeLabel,
      onChange: (next) => { surface?.batch(() => { for (const id of ids) surface?.setCondition(id, next); }); },
    }),
    editJumpMany: (ids, anchor) => surface?.editJumps(ids, anchor),
    setJumpMode: (id, mode) => { surface?.setJumpMode(id, mode); },
    editEffects: (id, onEnter, onExit, anchor, phase) => openEffectsEditor({ anchor, onEnter, onExit, ...(phase ? { phase } : {}), properties: sceneProps, // The editor's effect union still carries `emit`; Patter's does not (effects are set-only, and host
// events ride gameData), so narrow rather than cast. Nothing in this dialect can produce an emit, so
// the filter is a no-op at runtime and the types stop lying about it.
onChange: (ph, effects) => { surface?.setEffects(id, ph, effects.filter((e) => e.kind === "set")); },
onCreateProperty: (name) => createPatterProperty(name) }),
    jumpLabel: (id) => surface?.jumpLabel(id) ?? null, // null: drawn as a missing target
    gameDataFields: (kind) => project?.gameDataFields[kind] ?? [],
    setGameData: (id, key, value) => { surface?.setGameData(id, key, value); },
    setTags: (id, tags) => { surface?.setTags(id, tags); }, // author tags (#215)
    qualifiers: () => project?.qualifiers ?? [],
    setQualifier: (id, gameId) => { surface?.setQualifier(id, gameId); }, // a surface edit: saves as any edit does
    // Line padding: the pause fields are surface edits too, so they save, validate, and reach Play as any edit does.
    projectPadAfter: () => project?.padAfterDefault ?? DEFAULT_PAD_AFTER,
    setPadAfter: (id, seconds) => { surface?.setPadAfter(id, seconds); },
    setPadAfterDefault: (id, seconds) => { surface?.setPadAfterDefault(id, seconds); },
    writingStatuses: () => project?.writingStatuses ?? [], // the ladder (name + colour) for the status dropdown (#196)
    lineStatus: (id) => writingMap[id] ?? null,            // the beat's current status, or null (unset)
    setLineStatus: (id, status) => setLineStatus([id], status),
    statusBeats: (id) => surface?.statusBeats(id) ?? [],          // a scene's or block's lines, for its status floor (Q17)
    setStatusOf: (ids, status) => setLineStatus(ids, status),
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
    // Patter extensions: their fields after Game Data, one transaction each on the node's `ext`.
    extensions: () => project?.extensions ?? [],
    setExtensionValue: (id, extension, field, value) => { surface?.setExtensionValue(id, extension, field, value); },
    extensionLock: (extension) => lockedLine(extensionLocksOf(currentSceneId ? vcMap.get(currentSceneId) : undefined)[extension]?.by),
    extensionAdapter: () => currentExtensionAdapter(),
    openFields: (kind, id) => openFieldsOn(kind, id),
    viewInstalled,
    openView: (extension, view, kind, id) => {
      // The view opens on the selection: the node whose field it edits (the project's is no node to select).
      if (kind !== "project") surface?.revealNode(id);
      void window.patter.openView(extension, view);
    },
  });
}


/** The views that open on this machine, by `extension/view`, as main last worked them out. */
let installedViews = new Set<string>();
function viewInstalled(extension: string, view: string): boolean { return installedViews.has(`${extension}/${view}`); }
window.patter.onViewOffers((offers) => {
  installedViews = new Set(offers.filter((o) => o.installed).map((o) => `${o.extension}/${o.view}`));
  // A field's Edit goes to its view, or to the fields window, by what's installed.
  lastInspectorSig = null; if (lastInspectorCtx) showInspector(lastInspectorCtx);
  pushFields();
});

// --- the fields window (Pattershot's brief, "a map of records edited in a helper window") ---------------
// The window shows a node's maps of records as grids and follows the selection; this side owns the document,
// so it says what to show (on every selection move and edit, sent only when it changed) and applies each edit.


/** A node as the author knows it: a line by its speaker and words, a scene by its name, the rest by the name
 *  the jump picker gives it, or their words. */
function fieldsNodeLabel(kind: string, id: string): string {
  if (kind === "scene") return project?.scenes.find((sc) => sc.id === id)?.name ?? id;
  if (kind === "line") { const l = surface?.lines().find((x) => x.id === id); if (l) return l.character ? `${l.character}: ${l.text}` : l.text; }
  return surface?.jumpTargets().find((t) => t.id === id)?.label ?? surface?.sayText(id) ?? id;
}

function pushFields(): void {
  // A map a view edits here is the view's, not the window's (Y5).
  const extensions = withoutViewEdited(project?.extensions ?? [], viewInstalled);
  let node: FieldsNode | null = null;
  const pinned = !fieldsFollow ? fieldsHeld : fieldsFocus && fieldsFocus.from === caretNodeId ? fieldsFocus : null;
  if (pinned) {
    const found = surface?.extensionsOf(pinned.id);
    node = found ? { kind: found.kind, id: pinned.id, ext: found.ext } : null;
  } else {
    fieldsFocus = null;
    node = followTarget(selectedNodes(lastInspectorCtx), extensions);
  }
  fieldsShown = node ? { kind: node.kind, id: node.id } : null;
  const st = currentSceneId ? vcMap.get(currentSceneId) : undefined;
  const state = fieldsState({
    hasProject: project !== null,
    node: node ? { ...node, label: fieldsNodeLabel(node.kind, node.id) } : null,
    extensions,
    adapter: currentExtensionAdapter(),
    lock: (extension) => lockedLine(extensionLocksOf(st)[extension]?.by),
    readOnly: isReadOnly(st),
    readOnlyWhy: st?.lockedBy?.length ? `Locked by ${st.lockedBy.join(", ")}. Read-only until they release it.` : "",
  });
  const sig = JSON.stringify(state);
  if (sig === fieldsSent) return;
  fieldsSent = sig;
  window.patter.sendFieldsState(state);
}

/** An inspector section's Edit button: show that node in the window, and bring the window forward. */
function openFieldsOn(kind: string, id: string): void {
  if (fieldsFollow) fieldsFocus = { kind, id, from: caretNodeId };
  else fieldsHeld = { kind, id };
  pushFields();
  void window.patter.openFieldsWindow();
}

window.patter.onFieldsCommit((id, extension, field, value) => {
  surface?.setExtensionValue(id, extension, field, value);
  fieldsSent = ""; // a refused edit (a lock) changes nothing: send the state anyway, so the window puts it back
  pushFields();
});
window.patter.onFieldsFollow((on) => {
  fieldsFollow = on;
  fieldsHeld = on ? null : fieldsShown;
  pushFields();
});

// --- tier 2 view extensions (patterkit design/view-extensions.md) -------------------------------------
// A view window's port comes straight here; view-extensions.ts answers it from the project as the writer
// sees it, and this file tells it what changed (the scene, the selection, the theme, the locks).

/** The label the next new event in the scene's history carries in the journal (a view's write). */
let sceneStepLabel: string | undefined;

/** A recording's length, read from its file's metadata as Play reads it. Null when it won't load. */
async function measureTake(id: string): Promise<number | null> {
  const data = await window.patter.readAudio(id);
  if (!data) return null;
  const url = URL.createObjectURL(new Blob([data.bytes as BlobPart], { type: data.mime }));
  try {
    const audio = new Audio(url);
    audio.preload = "metadata";
    return await new Promise<number | null>((res) => {
      audio.onloadedmetadata = () => res(audio.duration);
      audio.onerror = () => res(null);
    });
  } finally { URL.revokeObjectURL(url); }
}

/** Recordings' lengths, by the take's path and its line's text hash: measured once per take. */
const takeLength = takeLengths(measureTake);

/** A scene's saved source as a view reads it: its model, its strings, and its extension values by node. */
function sceneFromSource(src: { flowSource: string; locSource: string; extensions: { id: string; source: string; live: boolean }[] }): import("./view-nodes.js").ViewScene {
  const scene = (parseSource(src.flowSource) as FlowFile).scene;
  let strings: Record<string, string> = {};
  try { strings = (parseSource(src.locSource) as LocaleFile).strings ?? {}; } catch { /* no strings yet */ }
  const ext: Record<string, Record<string, Record<string, unknown>>> = {};
  for (const x of src.extensions) {
    if (!x.live || !x.source.trim()) continue;
    let shard: ExtensionShard;
    try { shard = parseSource(x.source) as ExtensionShard; } catch { continue; }
    for (const byNode of Object.values(shard.entries ?? {})) {
      for (const [node, entry] of Object.entries(byNode ?? {})) (ext[node] ??= {})[x.id] = entry as Record<string, unknown>;
    }
  }
  return { scene, strings, ext };
}

const isWindows = /Win/i.test(navigator.platform || navigator.userAgent);

// The shell's `hostViews` takes each view window's port as main hands it over (and drops it when the window
// closes); this is the adapter it answers from.
const views = createViewHost({
  project: () => project,
  openScene: () => (surface && currentSceneId && surfaceSceneId === currentSceneId ? { id: currentSceneId, model: surface.model() } : null),
  readScene: async (id) => sceneFromSource(await window.patter.readScene(id)),
  selection: () => (currentSceneId ? lastInspectorCtx : null),
  sceneLocked: () => {
    const st = currentSceneId ? vcMap.get(currentSceneId) : undefined;
    return st?.lockedBy?.length ? `Locked by ${st.lockedBy.join(", ")}. Read-only until they release it.` : null;
  },
  extensionLocked: (extension) => {
    const lock = extensionLocksOf(currentSceneId ? vcMap.get(currentSceneId) : undefined)[extension];
    return lock ? `${lock.name}'s data here is locked by ${lock.by.join(", ") || "someone else"}.` : null;
  },
  projectExtensionLocked: (extension) => lockedLine(projectExtensionVc[extension]?.lockedBy),
  valueAdapter: () => currentExtensionAdapter(),
  writeScene: (extension, label, edits) => {
    if (!surface) return { ok: false, why: "read-only", message: "No scene is open." };
    sceneStepLabel = label;
    try { return surface.setExtensionValues(extension, edits); } finally { sceneStepLabel = undefined; }
  },
  writeProject: async (extension, entry, label) => {
    const res = await tracked(window.patter.writeProjectExtension(extension, entry, label));
    if (res.project) { project = res.project; lastInspectorSig = null; if (lastInspectorCtx) showInspector(lastInspectorCtx); }
    return res;
  },
  reveal: async (id, sceneId) => {
    if (sceneId === null) return surface?.revealNode(id) ?? false;
    await jumpTo({ id, kind: id === sceneId ? "scene" : "beat", sceneId, location: [] });
    return id === sceneId || currentSceneId === sceneId;
  },
  recordedSeconds: (id) => {
    const entry = audioOn() ? audioIndex[id] : undefined;
    if (!entry?.path) return Promise.resolve(null);
    const key = `${entry.path}\0${entry.textHash ?? ""}`;
    return takeLength(key, id);
  },
  // The take plays in the editor, as the inspector's ▶ plays it; with Audio Folders off there's no audio here.
  play: async (id) => {
    if (!audioOn()) return null;
    if (!audioIndex[id]?.path) return false;
    return playLineAudio(id);
  },
  stop: () => stopLineAudio(),
  key: (combo) => {
    if (combo === "Mod+Z") void undoCommand("undo", true);
    else if (combo === "Mod+Shift+Z" || (isWindows && combo === "Mod+Y")) void undoCommand("redo", true);
  },
});
// "Follow System" follows the OS between light and dark, with nothing to say so but the media query.
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => views.theme());

/** What the problems bar needs to word an extension's problem: the extensions, and every node by id with the
 *  label the editor shows (the open scene's as they stand, the rest from the project's index), built only
 *  when a problem asks. */
function extensionProblemContext(): ExtensionProblemContext {
  let nodes: Map<string, { kind: string; label: string }> | null = null;
  const build = (): Map<string, { kind: string; label: string }> => {
    const m = new Map<string, { kind: string; label: string }>();
    for (const [kind, list] of Object.entries(project?.extensionNodes ?? {})) for (const n of list) m.set(n.id, { kind, label: n.label });
    for (const sc of project?.scenes ?? []) { m.set(sc.id, { kind: "scene", label: sc.name }); for (const b of sc.blocks) m.set(b.id, { kind: "block", label: b.name }); }
    for (const kind of ["snippet", "option", "line", "text", "gameEvent"]) for (const n of surface?.nodesOfKind(kind) ?? []) m.set(n.id, { kind, label: n.label });
    return m;
  };
  return {
    extension: (id) => project?.extensions?.find((x) => x.id === id),
    node: (id) => (nodes ??= build()).get(id),
  };
}

/** What an extension's references and map keys offer: the cast, every scene and block, the open scene's
 *  nodes as they stand, and the rest of the project's by name. */
function currentExtensionAdapter(): ReturnType<typeof extensionAdapter> {
  return extensionAdapter({
    cast: [...new Set([...(project?.cast ?? []), ...(surface?.getCast() ?? [])])],
    scenes: project?.scenes ?? [],
    openScene: currentSceneId,
    openNodes: (kind) => surface?.nodesOfKind(kind) ?? [],
    ...(project?.extensionNodes ? { index: project.extensionNodes } : {}),
  });
}

/** Set while the open scene is read again after a save refused over an outside change. */
let rereading: Promise<void> | null = null;

/** The write itself. The controller decides WHEN; this only decides what. */
async function writeScene(): Promise<boolean> {
  if (!surface || !currentSceneId) return true; // no scene open: nothing to write, and not a failure
  if (rereading) return true; // the scene is being read again from disk: what's in the editor is stale
  const sceneId = currentSceneId;
  const src = surface.getSource({ prune: true }); // a real save tidies stray blank text lines
  const res = await window.patter.saveScene(sceneId, src.flow, src.loc, src.extensions);
  if (res.ok) {
    if (sceneId === surfaceSceneId && openDisk) openDisk = afterWrite(openDisk, src);
    // Editing a recorded line's spoken text flags it for re-record (and undoing the edit unflags it): show it.
    if (res.rerecord && sceneId === currentSceneId) {
      rerecordMap = res.rerecord;
      lastInspectorSig = null; if (lastInspectorCtx) showInspector(lastInspectorCtx);
    }
    void refreshProblems(); void refreshVcStatus(); return true; // re-validate + re-badge what's on disk
  }
  if (res.reread && sceneId === currentSceneId) {
    // A file of the scene changed outside Patterpad since it was read, and main has read it again: show it,
    // writing nothing more from the editor until it has.
    toast(`Couldn't save: ${res.error ?? "the scene changed outside Patterpad"}`, "error");
    saver.cancel();
    rereading = reloadOpenScene().finally(() => { rereading = null; });
    void refreshProblems(); void refreshVcStatus();
    return true;
  }
  toast(res.error ? `Save refused: ${res.error}` : "Save failed", "error");
  void refreshVcStatus();
  return false; // stays unsaved, and the next touch or flush tries again
}

/** Write now and wait. Every transition that must see current bytes calls this: the open scene, and every
 *  scene the editor has just left whose writes are still on their way (or were refused, and are tried
 *  again here). */
async function save(): Promise<void> { await saver.flush(); await settleLeftScenes(); }

// --- the scene switch (the October 2026 UI review, behaviour change 3) -----------------------------------
// Switching scenes used to wait for the outgoing scene's text, Notes and comments to be written before the
// next scene was even read, and it threw the outgoing scene's undo history away (ruling 6 of
// design/patterpad-undo.md). Now the outgoing writes start and are tracked, not awaited, so the next scene
// paints as soon as its own reads are back; anything that needs every byte on disk goes through save(),
// which waits for them. And the last eight scenes keep their editor state, so undo survives A, B, A, and
// Cmd+Z can work back into a scene you've left (it's shown first, then undone). A kept state comes back
// only if the scene's files are still exactly what was written when it was left: a sync, somebody else's
// edit or a project step that rewrote it, and it opens fresh from disk, its history gone, as a reload has
// always done.

/** A scene the editor left, kept to come back to. `disk` is what its files held when it was left (with its
 *  last write); `unsaved` means that write was refused, so its edits live only here until it's tried again. */
interface KeptScene {
  state: ReturnType<SurfaceHandle["exportState"]>; disk: string; scroll: number; unsaved: boolean; name: string;
  /** The refused write, to try again. */
  src?: { flow: string; loc: string; extensions: Record<string, string | null> };
}
const keptScenes = new Map<string, KeptScene>(); // oldest first
const KEEP_SCENES = 8;
/** Writes for scenes already left, by scene: the next read of that scene waits for its own write. */
const sceneWrites = new Map<string, Promise<boolean>>();
/** Every write still on its way for a scene already left (its text, Notes, comments). */
const leftWrites = new Set<Promise<unknown>>();
/** What the open scene's files hold, as far as this window knows: from its reads, moved on by each write. */
type DiskText = { flow: string; loc: string; ext: Record<string, string> };
let openDisk: DiskText | null = null;

const diskSig = (d: DiskText): string => JSON.stringify([d.flow, d.loc, Object.keys(d.ext).sort().map((k) => [k, d.ext[k]])]);
/** The files after writing `src` over `d`: an extension shard written as null is deleted, which reads as "". */
const afterWrite = (d: DiskText, src: { flow: string; loc: string; extensions: Record<string, string | null> }): DiskText => ({
  flow: src.flow, loc: src.loc,
  ext: { ...d.ext, ...Object.fromEntries(Object.entries(src.extensions).map(([k, v]) => [k, v ?? ""])) },
});

function trackLeft<T>(p: Promise<T>): Promise<T> {
  leftWrites.add(p);
  void p.finally(() => leftWrites.delete(p)).catch(() => {});
  return p;
}

/** Wait for every write of a scene already left, and try again any that were refused. */
async function settleLeftScenes(): Promise<void> {
  while (leftWrites.size) await Promise.allSettled([...leftWrites]);
  for (const [id, k] of [...keptScenes]) {
    if (!k.unsaved || !k.src) continue;
    k.unsaved = false;
    await writeLeftScene(id, k.name, k.src, Promise.resolve()); // refused again: marked unsaved again
  }
}

/** Write a scene the editor has just left. Its writes run in order, after any already on their way. */
function writeLeftScene(sceneId: string, name: string, src: { flow: string; loc: string; extensions: Record<string, string | null> }, after: Promise<unknown>): Promise<boolean> {
  const before = sceneWrites.get(sceneId);
  const run = (async () => {
    await Promise.allSettled([before, after]);
    const res = await window.patter.saveScene(sceneId, src.flow, src.loc, src.extensions);
    if (res.ok) { void refreshProblems(); void refreshVcStatus(); return true; }
    if (res.reread) {
      // Changed outside Patterpad since it was read: the kept state is stale, so opening it reads the disk.
      forgetScene(sceneId);
      toast(`Couldn't save “${name}”: ${res.error ?? "it changed outside Patterpad"}`, "error");
      void refreshProblems(); void refreshVcStatus();
      return false;
    }
    // Its edits are still in the kept state: opening it again shows them, and tries the write again.
    const kept = keptScenes.get(sceneId); if (kept) { kept.unsaved = true; kept.src = src; }
    toast(`Couldn't save \u201c${name}\u201d${res.error ? `: ${res.error}` : ""}\nIts changes are kept. Open it again to try once more.`, "error");
    void refreshVcStatus();
    return false;
  })();
  sceneWrites.set(sceneId, run);
  void run.finally(() => { if (sceneWrites.get(sceneId) === run) sceneWrites.delete(sceneId); });
  return trackLeft(run);
}

function keepScene(sceneId: string, kept: KeptScene): void {
  keptScenes.delete(sceneId);
  keptScenes.set(sceneId, kept);
  // The oldest go first, never one whose edits aren't on disk yet.
  for (const [id, k] of keptScenes) {
    if (keptScenes.size <= KEEP_SCENES) break;
    if (!k.unsaved) forgetScene(id);
  }
}

/** Let a kept scene go, and the journal's entries for its history with it. */
function forgetScene(sceneId: string): void {
  keptScenes.delete(sceneId);
  journal.dropScene(sceneId);
}

/** Leave the open scene: keep its state, start its writes, and don't wait for them. */
function leaveOpenScene(): void {
  const sceneId = surfaceSceneId;
  if (!surface || !sceneId) return;
  const name = surface.sceneName();
  let disk = openDisk;
  if (saver.pending) {
    // Captured now, before the next scene replaces it; a write already running for it goes first.
    const src = surface.getSource({ prune: true });
    saver.cancel();
    void writeLeftScene(sceneId, name, src, saver.flush());
    if (disk) disk = afterWrite(disk, src);
  }
  // Notes and comments read the open scene's maps as they start, so they're safe to leave running.
  void trackLeft(persistDocs());
  void trackLeft(persistComments());
  keepScene(sceneId, { state: surface.exportState(), disk: disk ? diskSig(disk) : "", scroll: editorEl.scrollTop, unsaved: false, name });
}

/** Re-read the OPEN scene after main has rewritten its shards (a Replace, pin on publish). `loadScene`
 *  skips the scene already open, and would save the stale surface over the rewrite on its way out, so the
 *  surface is dropped WITHOUT saving: the caller had the editor flush before main wrote, so there is
 *  nothing in it the files do not already hold. The caret comes back where it was. */
function reloadOpenScene(): Promise<void> {
  return queueScene(async () => {
    const sceneId = currentSceneId;
    if (!sceneId) return;
    const caret = caretNodeId ?? undefined;
    saver.cancel();
    surface?.destroy();
    surface = null;
    currentSceneId = null;
    // The scene's history went with the surface (the barrier): its journal entries go too.
    if (surfaceSceneId) journal.dropScene(surfaceSceneId);
    surfaceSceneId = null;
    await loadSceneNow(sceneId, caret ? { restoreCaret: caret } : undefined);
  });
}

// Every scene load, and the reload, runs one at a time. A load takes several IPC round trips before it
// sets `currentSceneId`, and two started together (Play's mark and its "Follow in the editor" arrive from
// one handler; two quick navigator clicks) both reached `mountSurface`: the scene showed twice, the first
// surface leaked, and what was typed into it was never saved. Queued, the second finds its scene already
// open and returns. Nothing a load runs may call `loadScene` itself, or the queue would wait on itself.
let sceneQueue: Promise<void> = Promise.resolve();
function queueScene(run: () => Promise<void>): Promise<void> {
  const next = sceneQueue.then(run, run);
  sceneQueue = next.catch(() => {}); // a failed load must not wedge every load after it
  return next;
}

function loadScene(sceneId: string, opts?: { restoreCaret?: string; behind?: boolean }): Promise<void> {
  return queueScene(async () => {
    // Every route that takes the writer to a scene ends in the workspace, showing it. Only the navigator and the
    // overview's own list used to switch views first, so Play following along (or its playhead), a search or
    // Coverage jump, or a problem's Go to issue, taken while the overview was up, loaded the scene behind it and it
    // stayed hidden (Ian, 2026-10-30). This holds for the scene already open behind the overview too, which is why
    // those routes call here even for it (loadSceneNow returns at once for the open scene). `behind` is for
    // housekeeping (a deleted, rolled-back, or merged-away scene replaced), which mustn't take the writer off the
    // page they're on.
    if (!opts?.behind && project && !overviewEl.hidden) { enterWorkspace(); renderNav(); }
    await loadSceneNow(sceneId, opts);
  });
}

async function loadSceneNow(sceneId: string, opts?: { restoreCaret?: string }): Promise<void> {
  if (!project || sceneId === currentSceneId) return;
  // Opening a scene is the one funnel every route into the editor goes through (the navigator, a
  // search jump, play-follow, the restore), so it is where the Properties document gets left - and
  // left properly, flushing a save still inside its debounce before the scene loads over it. It is
  // also where the history records the place being left, for the same reason: one choke point means
  // a Find hit, a problem jump and a plain nav click all record themselves without knowing it.
  visitFrom();
  const fromPropertiesDoc = !propsDocEl.hidden;
  await leavePropertiesDoc();
  // The Properties document hides the chrome that speaks about a scene (Play, the problems badge, the
  // inspector toggle). Leaving it for a scene has to bring that back: a scene opened from the navigator
  // comes straight here, not through enterWorkspace, and left the title bar without its Play button.
  if (fromPropertiesDoc) showSceneChrome();
  // One call, because all four editors ARE the one anchored panel: closing it
  // fires whichever onClose is registered, which clears that module's singleton.
  closeAnchoredPanel();
  // The scene being left is kept and its writes start; nothing here waits for them (see leaveOpenScene).
  leaveOpenScene();
  surface?.destroy();
  surface = null;
  surfaceSceneId = null;
  openDisk = null;
  editorEl.replaceChildren();
  lastInspectorSig = null; // force the first selection in the new scene to render (don't match the old scene's)

  // Reading a scene waits for its own write, if one is still on its way, and for nothing else.
  await sceneWrites.get(sceneId);
  // The scene's reads are independent, so they go out together rather than one round trip after another.
  const [scene, docs, sceneComments, sceneSuggestions, writing, recording, rerecord, audio] = await Promise.all([
    window.patter.readScene(sceneId),
    window.patter.readDocs(sceneId),           // typed documentation for this scene
    window.patter.readComments(sceneId),       // threaded comments for this scene
    window.patter.readSuggestions(sceneId),    // rewrite proposals for this scene
    window.patter.readWriting(sceneId),        // per-beat writing status for this scene (#196)
    window.patter.readRecording(sceneId),      // per-beat manual recording status (#206)
    window.patter.readRerecord(sceneId),       // per-line "needs re-record" flags (#227)
    project.audioFolders ? window.patter.audioCurrent() : Promise.resolve(undefined), // folder-derived status (#206)
  ]);
  const { flowSource, locSource, properties, hostScopes } = scene;
  sceneExtensionNames = new Map(scene.extensions.map((e) => [e.id, e.name]));
  sceneProps = properties; // referenceable properties for this scene's condition editor
  setHostScopeTokens(hostScopes); // the editors' parser knows @world, an imported @story, and the rest
  docMap = docs; docsDirty = false;
  comments = sceneComments; commentsDirty = false;
  suggestions = sceneSuggestions; suggestionsDirty = false;
  writingMap = writing;
  recordingMap = recording;
  rerecordMap = rerecord;
  if (audio !== undefined) audioIndex = audio;
  sceneEdited = false;  // fresh scene: not edited until the user touches it
  openDisk = { flow: flowSource, loc: locSource, ext: Object.fromEntries(scene.extensions.map((e) => [e.id, e.source])) };
  // A kept state comes back only while the files are what it was written as; an unsaved one comes back
  // whatever they hold, since its edits exist nowhere else, and is written again.
  const kept = keptScenes.get(sceneId);
  const restore = kept && (kept.unsaved || kept.disk === diskSig(openDisk)) ? kept : undefined;
  if (kept && !restore) forgetScene(sceneId);
  keptScenes.delete(sceneId);
  mountingScene = true; // the mount's initial-mirror onChange is not a user edit
  // The script is in the project's source language: say so, for whatever reads the page's language.
  if (project.sourceLocale) editorEl.lang = project.sourceLocale; else editorEl.removeAttribute("lang");
  surface = mountSurface({
    editor: editorEl,
    hintbar: hintbarEl,
    projectPadAfterDefault: () => project?.padAfterDefault, // so a moved line is pinned to the pause it was playing
    flowSource,
    locSource,
    extensions: scene.extensions,
    lockedExtensions: extensionLocksOf(vcMap.get(sceneId)),
    formatting: project.formatting,
    castSeed: project.cast,
    castColours: project.castColours, // a renamed character keeps their colour
    qualifiers: project.qualifiers ?? [], // the cue's (O.S.), the keyboard cycle
    localiseDialogueText: project.localiseDialogueText, // off: a dialogue scene's text is drawn as action
    // Cross-scene jump targets: every scene + its blocks (the surface adds THIS scene with live blocks).
    jumpTargets: jumpTargetsOf(project),
    jumpTargetsPending: scenesPending, // a lazy open's other scenes aren't in yet: a jump to one isn't missing
    showTitle: true,
    onChange: () => { if (!mountingScene) { saver.touch(); sceneEdited = true; refreshStaleBadge(); views.changed("all", { saved: false }); } scheduleValidate(); refreshNavBlocks(); syncSceneName(); },
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
    onCreateTarget: (req) => createJumpTarget(req), // a jump picker's "+ New scene" / "+ New block" (Q13)
    pinOnRename: (scene, next) => pinGameIdOnRename(scene, next), // storylet cards keep playing a renamed scene (Q19)
    // An edit the surface refused because it would lose structure (a condition, effects, a jump, a whole
    // choice): one finished sentence saying what and what to do instead (ruling D, October 2026 review).
    onRefuse: (message) => toast(message, "info"),
    // Edit ▸ Undo is the journal's, never the editor's own keys; a new event in the history is a journal
    // entry, and clears the project's redo as ProseMirror has cleared the scene's.
    hostUndo: true,
    onHistoryStep: () => { if (!mountingScene && journal.pushScene(sceneId, sceneStepLabel)) void window.patter.projectClearRedo(); },
    ...(restore ? { restoreState: restore.state } : {}),
  });
  mountingScene = false; // any onChange from here on is a real edit
  currentSceneId = sceneId;
  revealInNav(sceneId);
  surfaceSceneId = sceneId;
  saver.cancel(); // mount fires onChange once (the initial mirror); not a user edit
  highlightNav(sceneId);
  paintHistory(); // the arrows follow every arrival, not just the ones they caused
  applySceneVc(); // read-only + topbar chip if this scene is locked by another (from the cached snapshot)
  surface.focus();
  // Open-where-you-left-off: on the initial landing load, drop the caret back on the remembered node (it
  // also scrolls it into view). Missing node (edited away since) -> stay at the top, no-op.
  if (opts?.restoreCaret) surface.revealNode(opts.restoreCaret, { instant: true });
  // A kept scene comes back where it was scrolled to; an unsaved one is written again.
  else if (restore) editorEl.scrollTop = restore.scroll;
  if (restore?.unsaved) { sceneEdited = true; saver.touch(); }
  applyProblemMarks(); // re-apply the current problem squiggles to this scene's nodes
  pushDocNotes();      // surface this scene's documentation notes (tooltips + under-heading)
  pushCommentMarks();  // surface this scene's comment bubbles
  pushSuggestionMarks(); // surface this scene's rewrite-proposal pencils
  surface.setSpellChecker(spellChecker); // re-push the cached spell engine to the new surface instance (#177)
  pushWritingStatus();   // surface this scene's writing-status badges + the ladder for the submenu (#196)
  if (showReviewFeedback) void gatherReview(); // re-show the feedback walk bar (mode persists)
  watchSceneTitle();   // fade "<project>: <scene>" into the topbar once the title scrolls out of view
  flushRemember();     // record the scene now (the caret follows via showInspector, debounced)
  views.changed("all"); views.writable(); // a view reads another scene now, which may be held by somebody else
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
  await save();                       // play reflects what's on disk
  await window.patter.openPlay(currentSceneId);  // opens the separate interactive play window
}

playTopEl.addEventListener("click", () => { void play(); });

/** Play from Start (Mod+Shift+P): run from the project's start point, prompting to set one if unset. */
async function playFromStart(): Promise<void> {
  if (!project) return;
  const start = await ensureProjectStart();
  if (!start) return; // cancelled / no scenes
  await save();
  await window.patter.openPlay(start.scene, start.block);
}

// --- dual id/handle search (go-to-anything) ----------------------------------
async function jumpTo(entry: SearchEntry): Promise<void> {
  await loadScene(entry.sceneId); // its scene: loaded if elsewhere, shown if the overview covers it
  if (entry.kind !== "scene") surface?.revealNode(entry.id);             // then reveal the node
}

/** Follow a divert (double-click on a jump chip): resolve its target id - a scene or a block - to the
 *  owning scene, switch to it if it's elsewhere, then reveal the block (a scene target just opens). */
async function openTarget(targetId: string): Promise<void> {
  if (!project || !targetId || targetId === "END") return;
  const scene = project.scenes.find((s) => s.id === targetId || s.blocks.some((b) => b.id === targetId));
  if (!scene) return;
  await loadScene(scene.id);
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

/** Review ▸ Find by Field: the search window's Field tab (find nodes by a gameData value), the caret's scene first. */
function openFieldBrowse(): void {
  if (!project) return;
  const focus = currentSceneId ? { sceneId: currentSceneId, fromBeatId: caretNodeId ?? undefined } : undefined;
  void window.patter.openSearchWindow("field", focus);
}

/** Review ▸ Find Lines by Qualifier: the search window's Qualifier tab, the caret's scene first. */
function openQualifierBrowse(): void {
  if (!project) return;
  const focus = currentSceneId ? { sceneId: currentSceneId, fromBeatId: caretNodeId ?? undefined } : undefined;
  void window.patter.openSearchWindow("qualifier", focus);
}

async function showProject(open: OpenResult): Promise<void> {
  views.closeAll(); // main closes their windows with the project they read
  project = open.project;
  scenesPending = true; // main opens it landing scene first; hydrateProject brings the rest
  debugLink.setVisible(true); // the bottom-right live-debug-link control is available once a project is open
  projectNameEl.textContent = project.name;
  // Two projects can share a name; the disk path is what tells them apart. The topbar name carries it
  // as a tooltip, and the overview shows it in full (with a click-to-reveal).
  projectNameEl.dataset.tip = project.root;
  currentSceneId = null;
  pairedCards = []; void refreshPairedCards(); // the paired Storylets project's cards, for the scene warnings (Q19)
  journal.clear(); // main's history starts again with the project, so the journal does too
  keptScenes.clear(); // and no scene of another project comes back
  // Back and Forward are journeys inside ONE project: carried over, Back landed on this project's overview
  // or Properties page, places never visited in it.
  history.clear(); paintHistory();
  await buildSpellcheck(); // build the spell engine before the first scene mounts (#177); it pushes on mount
  await refreshPatterProps(); // the navigator's Properties row carries a count, from the first paint
  // A project opened with a remembered scene drops straight into it; a never-opened one lands on the
  // project overview (#3a) - the shape of the work before a scene (reachable later via the project name).
  if (open.lastScene === PROPERTIES_PLACE) {
    // Left off in the Properties document: come back to it, not to whichever scene preceded it.
    renderNav();
    await showPropertiesDoc();
    await hydrateProject();
    void refreshProblems();
    void refreshVcStatus();
  } else if (open.lastScene) {
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
  void refreshClashes(); // a project a merge left clashes in says so as it opens
}

/** Switch the chrome to the editing WORKSPACE (panes + toggles), leaving welcome / overview. */
function enterWorkspace(): void {
  void leavePropertiesDoc(); // flushes a save still in its debounce, then hides the page
  welcomeEl.hidden = true; overviewEl.hidden = true; panesEl.hidden = false;
  toggleNavEl.hidden = false;
  showSceneChrome();
}

/** The chrome that speaks about an open scene: the inspector's toggle, Play (the primary loop's visible
 *  door: play what you wrote), and the problems it has, at a glance. */
function showSceneChrome(): void {
  toggleInspectorEl.hidden = false;
  playTopEl.hidden = false;
  healthEl.hidden = false;
  // The two bars too: the overview and the Properties page hide them, and nothing brought them back until
  // an edit happened to revalidate. Painting from what is already known shows them as they were.
  paintProblems();
  renderReviewBar();
}

// --- project overview (#3a) --------------------------------------------------
// A calm landing for the open project: a clickable scene index + headline stats (counts + drafted
// progress, from the production report). Shown on a never-opened project and on demand (the project name
// / View menu). Picking a scene drops into the workspace.

/** Show the overview for the open project: render the scene index now, then fill the stats from the
 *  production report (which also hydrates the rest of the project for the full scene list). */
async function showOverview(): Promise<void> {
  if (!project) return;
  visitFrom();
  if (surface) await save(); // files are the truth - persist before leaving the editor
  await leavePropertiesDoc();
  welcomeEl.hidden = true; panesEl.hidden = true; overviewEl.hidden = false;
  toggleNavEl.hidden = true; toggleInspectorEl.hidden = true; playTopEl.hidden = true; healthEl.hidden = true;
  problembarEl.hidden = true; reviewbarEl.hidden = true; // the overview is a calm screen, no bars
  projectNameEl.textContent = project.name;
  projectNameEl.dataset.tip = project.root;
  titleObserver?.disconnect(); titleObserver = null; sceneSuffixEl.classList.remove("shown"); sceneSuffixEl.textContent = "";
  await hydrateProject(); // the index needs every scene, not just the lazy-loaded landing one
  renderOverview();
  paintHistory();
  signalReady();          // the overview (scene index) is up - safe to reveal the window (no-op if already)
  const asked = project.root; // the project, by its folder: the summary object is replaced by ordinary saves
  const data = await window.patter.report();
  // Ignore it if we navigated away, or if a different project opened while the report was being made:
  // its numbers are the old project's.
  if (data && project?.root === asked && !overviewEl.hidden) fillOverviewStats(data);
}

// --- the Properties document -------------------------------------------------
// @patter is the story's working vocabulary: everyone touches it, it grows with the content, and it
// was living in a tab of a configuration dialog (from-storylets/property-visibility). It gets its own
// page in the navigator instead, saving as edits settle - a document's rhythm, where the dialog saved
// on close because it was a dialog. @world stays in Settings: that one is the contract with the game.

/** The project's `@patter` declarations, cached for the navigator count and the document's mount.
 *  Refreshed whenever they are saved (here or, for a rename through the fix, by the main process). */
let patterProps: PropertyDecl[] = [];
let propsHandle: { value(): PropertyDecl[]; firstDuplicate(): HTMLInputElement | null; firstIllegalName(): HTMLInputElement | null } | null = null;
let propsSavedSig = "";
/** Stages renamed on the Properties page and not yet saved, in order: the next save carries them. */
let propsStageRenames: StageRenameDto[] = [];
/** Counts visits to the Properties page: each visit's saves are one undo step. */
let propsVisit = 0;

async function refreshPatterProps(): Promise<void> {
  const s = await window.patter.readSettings();
  patterProps = s?.properties ?? [];
  paintPropsCount();
}

function paintPropsCount(): void {
  const count = navListEl.querySelector<HTMLElement>(".nav-doc-count");
  if (count) count.textContent = String(patterProps.length);
}

/** Save what the document holds, unless it holds a fault. A duplicate or an unreachable name is the
 *  same data hazard the dialog's Save gate refused; here there is no Save button to refuse, so the
 *  write is skipped and the offending field keeps its red ring until it is fixed. */
async function savePropsDoc(): Promise<void> {
  if (!propsHandle || !project) return;
  if (propsHandle.firstDuplicate() || propsHandle.firstIllegalName()) return;
  const next = propsHandle.value();
  const sig = JSON.stringify(next);
  if (sig === propsSavedSig) return; // nothing settled that was not already saved
  const s = await window.patter.readSettings();
  if (!s) return;
  // Only the properties changed, so only what reads them is refreshed: rebuilding the spell checker and
  // the writing-status ladder after every settled edit on this page cost a dictionary build each time.
  // A stage renamed in place is carried into every condition and set effect that names it, in the same save.
  const stageRenames = propsStageRenames;
  // Keyed by the visit, so a run of edits on the page is one undo step (patterkit design/patterpad-undo.md).
  if (!(await saveProjectSettings({ ...s, properties: next, ...(stageRenames.length ? { stageRenames } : {}) }, { propertiesOnly: true, undo: { label: "Properties", key: `properties:${propsVisit}` } }))) return; // refused: try again next edit
  propsStageRenames = propsStageRenames.slice(stageRenames.length); // any renamed while this one saved wait for the next
  propsSavedSig = sig;
  patterProps = next;
  paintPropsCount();
}

const schedulePropsSave = debounce(() => { void savePropsDoc(); }, 400);

/** "+ New property" in the effects editor's picker: ask the kind of value, then declare `@patter.<name>`
 *  through the Properties page's own save (one step of the project history), so the page, its count, and
 *  every editor know it at once. Answers the editor's catalogue entry, or null when the author backed out
 *  or the save was refused. */
async function createPatterProperty(name: string): Promise<{ scope: string; name: string; type: PropertyType } | null> {
  if (!project) return null;
  const type = await askPropertyType(name);
  if (!type) return null;
  const s = await window.patter.readSettings();
  if (!s) return null;
  const made = withNewProperty(s.properties, name, type);
  if (made.added && !(await saveProjectSettings({ ...s, properties: made.props }, { propertiesOnly: true, undo: { label: "New property", key: `new-property:${name}:${Date.now()}` } }))) return null;
  patterProps = made.props;
  paintPropsCount();
  return { scope: "patter", name: made.decl.name, type: made.decl.type };
}

/** Open the Properties document (the navigator's fixed row, and every "go to definition" on a
 *  `@patter` property). */
async function showPropertiesDoc(): Promise<void> {
  if (!project) return;
  visitFrom();
  if (surface) await save(); // files are the truth - persist the open scene before leaving it
  await refreshPatterProps();
  // The page lives IN the workspace, not instead of it: the navigator stays put (its row is how you
  // got here and how you leave), the editor's column carries the document, and the inspector folds
  // away, since it speaks about a selected node and there is none here.
  welcomeEl.hidden = true; overviewEl.hidden = true; panesEl.hidden = false;
  shell.holdClosed("inspector", true); // folded for the page, without touching what the author chose
  editorEl.hidden = true; propsDocEl.hidden = false;
  toggleNavEl.hidden = false; toggleInspectorEl.hidden = true; playTopEl.hidden = true; healthEl.hidden = true;
  problembarEl.hidden = true; reviewbarEl.hidden = true;
  titleObserver?.disconnect(); titleObserver = null;
  sceneSuffixEl.classList.remove("shown"); sceneSuffixEl.textContent = ""; // no scene is open
  propsVisit++;
  mountPropsDoc();
  // The control has no change callback: it writes into its own state on every input, and its chips /
  // movers / delete are buttons. So listen for both and read the state back after it settles, which
  // is also why the save compares signatures - a click that changed nothing must not write a file.
  propsDocHostEl.addEventListener("input", schedulePropsSave);
  propsDocHostEl.addEventListener("change", schedulePropsSave);
  propsDocHostEl.addEventListener("click", schedulePropsSave);
  // The scene behind the page is remounted on the way back, so its history goes: its journal entries
  // with it, so Cmd+Z here never reaches past the page's own saves to a scene edit nobody can see.
  if (surfaceSceneId) journal.dropScene(surfaceSceneId);
  highlightNav("");                       // no scene is current while the document is open
  paintHistory();
  const propsRowEl = navListEl.querySelector<HTMLElement>(".nav-doc"); if (propsRowEl) markCurrent(propsRowEl, true);
  // Open-where-you-left-off covers this page too: the document is where the author WAS, so a restart
  // should come back to it rather than to whichever scene happened to be open before it.
  currentSceneId = null;
  void window.patter.rememberScene(project.root, PROPERTIES_PLACE);
  signalReady();
}

/** Draw the page's list from `patterProps`: on arrival, and after an undo or redo changed the declarations. */
function mountPropsDoc(): void {
  propsDocHostEl.replaceChildren();
  propsStageRenames = [];
  propsHandle = mountProperties(propsDocHostEl, patterProps, {
    onStageRename: (decl, from, to) => { propsStageRenames.push({ scope: "patter", name: decl.name.trim(), from, to }); schedulePropsSave(); },
    onStageReorder: (decl, note) => void fillStageNote(note, { scope: "patter", name: decl.name.trim() }),
  });
  propsSavedSig = JSON.stringify(patterProps);
}

/** Leaving the document: flush anything mid-debounce, since the next thing may reload the project. */
async function leavePropertiesDoc(): Promise<void> {
  schedulePropsSave.cancel(); await savePropsDoc(); // a save still settling lands now (a no-op when nothing changed)
  propsHandle = null;
  propsDocEl.hidden = true;
  editorEl.hidden = false;
  shell.holdClosed("inspector", false); // back to whatever was remembered
  const propsRowEl = navListEl.querySelector<HTMLElement>(".nav-doc"); if (propsRowEl) markCurrent(propsRowEl, false);
  // The page hid the bars; with it gone they come back (each stays hidden if the workspace isn't up yet).
  paintProblems();
  renderReviewBar();
}

/** Build the scene index + a placeholder stats line (the real counts arrive async from the report). */
function renderOverview(): void {
  if (!project) return;
  overviewTitleEl.textContent = project.name;
  overviewPathEl.textContent = project.root;
  overviewPathEl.hidden = false;
  const n = project.scenes.length;
  overviewStatsEl.textContent = plural(n, "scene");
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
  overviewStatsEl.replaceChildren(metaLine([plural(n, "scene"), `${formatCount(t.written.words)} words`, `${formatCount(t.written.count)} ${t.written.count === 1 ? "line" : "lines"}`]));
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
  const wasPending = scenesPending;
  scenesPending = false; // every scene is known now: a target none of them has is genuinely missing
  if (full.scenes.length === project.scenes.length && !wasPending) return; // already complete - nothing more to show
  if (full.scenes.length !== project.scenes.length) {
    project = full;
    renderNav();
    if (currentSceneId) highlightNav(currentSceneId);
    syncSceneName(); // a rename still inside the save debounce is newer than main's copy
  }
  // Refresh the surface's cross-scene jump targets so the divert picker now offers every scene + block.
  pushJumpTargets();
  // The inspector painted before the other scenes arrived, so a cross-scene Jump row (and any condition
  // pill naming another scene) still reads as pending. Its level signature hasn't changed, so force it.
  lastInspectorSig = null; if (lastInspectorCtx) showInspector(lastInspectorCtx);
}

// --- welcome screen ----------------------------------------------------------
// (Built once at the top of the module with the shell's mountWelcome; showWelcome refreshes its recents.)

/** File ▸ Close Project: back to the welcome screen, which without this was reachable only at launch
 *  (from-storylets/close-project). The window stays: this is Close PROJECT, not the Close Window
 *  neither app offers.
 *
 *  The recents are re-read rather than reused, so the welcome's list carries the project just closed at
 *  the top - the point of closing is usually to open something else. Read with `recents()`, not
 *  `boot()`, which would also take a pending launch path and open a project nobody shows. */
async function closeProject(): Promise<void> {
  if (!project) return;
  if (surface) await save();      // files are the truth - flush before letting go of the project
  await persistDocs(); await persistComments();
  flushRemember();                // and record where the author was, for when they come back
  await window.patter.closeProject();
  showWelcome({ recents: await window.patter.recents() });
}

function showWelcome(state: Pick<BootState, "recents">): void {
  // One call, because all four editors ARE the one anchored panel: closing it
  // fires whichever onClose is registered, which clears that module's singleton.
  closeAnchoredPanel();
  surface?.destroy(); surface = null; project = null; currentSceneId = null; surfaceSceneId = null;
  journal.clear(); // the project's history went with it
  keptScenes.clear();
  views.closeAll(); // and so did every view of it
  clashResolver?.close(); clashBar.update(0); // no project -> no clashes
  debugLink.setVisible(false); // no project -> hide the live-debug-link control
  titleObserver?.disconnect(); titleObserver = null; sceneSuffixEl.classList.remove("shown"); sceneSuffixEl.textContent = ""; // no scene -> no suffix
  vcMap.clear(); vcsSceneEl.hidden = true; shell.centre.querySelector(":scope > .vc-lock")?.remove(); // no project -> no VC state
  comments = []; commentsDirty = false; // no project -> no comments
  suggestions = []; suggestionsDirty = false; // no project -> no suggestions
  reviewItems = []; reviewbarEl.hidden = true; // no project -> no feedback walk
  void leavePropertiesDoc();
  setWritingView(false); // the mode belongs to a project: left on, the welcome kept the dimmed title bar and the exit pill
  history.clear(); paintHistory(); // and the journey belongs to it too: with nothing open, there is nowhere to go back to
  panesEl.hidden = true; overviewEl.hidden = true; welcomeEl.hidden = false;
  problembarEl.hidden = true; inspectorStackEl.replaceChildren(); lastInspectorCtx = null; lastInspectorSig = null; // no script -> nothing to inspect
  toggleNavEl.hidden = true; toggleInspectorEl.hidden = true; playTopEl.hidden = true; healthEl.hidden = true;
  projectNameEl.textContent = "Patterpad";
  delete projectNameEl.dataset.tip; // no project, no path
  setWelcomeRecents(state.recents);
  welcome.setError(undefined); // a failure is said once, by the open that failed (openPath), not on every visit
  signalReady(); // the welcome screen is up - safe to reveal the window (no-op if already revealed)
}

/** Leave the open project properly BEFORE main is asked to switch: flush a text edit still inside the
 *  autosave debounce, pending Notes and comments, and the remembered place. After the switch it is
 *  too late: main answers for the NEW project, so the old scene's save is refused as unknown, and
 *  showProject clears currentSceneId first, which writeScene reads as "nothing to write". A no-op
 *  with nothing open. (Found beside the open-over fix, 2026-09-03.) */
async function leaveProject(): Promise<void> {
  if (!project) return;
  await flushPending();
  flushRemember();
}

/** Write every edit still waiting: the scene's text inside the autosave debounce, Notes, and comments.
 *  Each is a no-op when clean, so this is cheap enough to run whenever the window loses focus. */
async function flushPending(): Promise<void> {
  if (surface) await save();
  await persistDocs();
  await persistComments();
}

async function openPath(path: string): Promise<void> {
  await leaveProject();
  // The name it is listed under, read now: a project that has gone is forgotten by the failed open.
  const name = (await window.patter.recents()).find((r) => r.path === path)?.name ?? path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  try { await showProject(await window.patter.openPath(path)); }
  catch (e) {
    // Back to the welcome, saying why rather than leaving the author to wonder where the project went.
    // Main forgot it only if the folder is gone; one that is there but won't open stays in the list.
    const reason = (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
    showWelcome({ recents: await window.patter.recents() });
    welcome.setError(`Couldn't open “${name}”. ${reason}`);
  }
}

async function openDialog(): Promise<void> { await leaveProject(); const r = await window.patter.openDialog(); if (r) await showProject(r); }

/** File ▸ Save As: flush every pending edit (so the on-disk bytes are current), then ask main to duplicate
 *  the project folder to a name / location the user picks and open the copy. Carries on in the duplicate. */
async function saveAs(): Promise<void> {
  if (!project) return; // nothing open
  await leaveProject(); // pending text edits, Notes, comments, and the remembered place
  const r = await window.patter.saveAs();
  if (r) await showProject(r);
}

/** File > Production Information: a read-only render of the production report (spec §13). Flushes any
 *  pending scene edits (tags, text) first so the figures are current, recomputes off the loaded project,
 *  then shows it in a themed modal. */
async function openReport(): Promise<void> {
  if (!project) return; // nothing open
  if (surface) await save(); // persist pending edits so the report reflects them, not the last save
  const data = await window.patter.report();
  if (!data) return;
  const frame = dialogFrame({ title: "Production information", className: "report-dialog", onClose: () => observer.disconnect() });
  // The report usually overflows its 70vh body; the wrapper carries edge scrims and a "More below" pill so
  // the cut-off is unmistakable (the thin app scrollbar alone is too quiet here). See .report-scroll.
  const scroll = el("div", "report-scroll");
  const host = el("div", "report-host");
  const more = el("button", "report-more");
  more.type = "button";
  more.setAttribute("aria-label", "Scroll for more");
  more.dataset.tip = "More below";
  more.append(iconNode("down", 14)); // the family's drawn chevron, not one of our own
  scroll.append(host, more);
  frame.body.append(scroll);
  renderReport(host, data);
  const hints = (): void => {
    scroll.classList.toggle("has-below", host.scrollHeight - host.clientHeight - host.scrollTop > 4);
    scroll.classList.toggle("has-above", host.scrollTop > 4);
  };
  host.addEventListener("scroll", hints);
  const observer = new ResizeObserver(hints); // window resizes move the 70vh cap
  observer.observe(host);
  more.addEventListener("click", () => host.scrollBy({ top: host.clientHeight * 0.8, behavior: "smooth" }));
  const exportBtn = dialogButton("Export to spreadsheet…");
  exportBtn.addEventListener("click", () => void exportProductionInfo(exportBtn));
  const close = dialogButton("Close", true);
  close.addEventListener("click", () => frame.close());
  frame.actions.append(exportBtn, close);
  frame.open();
  hints(); // measure only once open - a hidden dialog reads clientHeight 0
}

/** Review > Coverage Test…: open the detached coverage window (prompting for a project start first if
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
  // A recording spreadsheet (spec §16).
  const frame = dialogFrame({ title: "Export voice script", sub: "One row per spoken line, with its scope and VO notes.", className: "vo-dialog" });
  const { row: toggle, input: everything } = labelledToggle("Export everything", { hint: "Includes lines not yet marked ready to record." });
  const status = el("p", "settings-note");
  frame.body.append(toggle, status);
  const cancel = dialogButton("Cancel");
  const go = dialogButton("Export…", true);
  cancel.addEventListener("click", () => frame.close());
  go.addEventListener("click", () => void (async () => {
    status.textContent = "Exporting…";
    const res = await withJob("Exporting the voice script…", () => window.patter.exportVoiceScript(everything.checked));
    if (res.ok) { frame.close(); toast(`Voice script exported to ${res.path}`, "ok"); } // done -> close, confirm via toast
    else if (res.canceled) status.textContent = "";
    else status.textContent = `Couldn't export. ${res.error ?? "Try again, and check the file isn't locked in version control."}`;
  })());
  frame.actions.append(cancel, go);
  frame.open();
  go.focus();
}

/** File > Export / Import Localisation (also the button in the Language settings tab): a modal over the
 *  shared loc engine: export strings in a chosen format/locale, import a translated file back. */
async function openLocalisation(): Promise<void> {
  if (!project) return; // nothing open
  const s = await window.patter.readSettings();
  if (!s) return;
  const frame = dialogFrame({ title: "Localisation", sub: "Export strings for translation, then import the translated file back. Character display names are included.", className: "loc-dialog" });
  const formatSel = el("select", "insp-select");
  formatSel.append(new Option("gettext PO / POT", "po"), new Option("Excel (.xlsx)", "xlsx"), new Option("JSON", "json"));
  const localeSel = el("select", "insp-select");
  localeSel.append(new Option("Template (source, untranslated)", ""));
  for (const loc of s.locales) if (loc !== s.localeDefault) localeSel.append(new Option(loc, loc));
  const formatField = el("label", "identity-field", "Format");
  formatField.append(formatSel);
  const localeField = el("label", "identity-field", "Language");
  localeField.append(localeSel);
  const row = el("div", "loc-row");
  row.append(formatField, localeField);
  const status = el("p", "settings-note");
  // What an export says beside the file (action text): what it left out and why, then what has dropped out of the
  // loc files or come into them, a heading per change with the beats under it.
  const changes = el("div", "loc-changes");
  const showChanges = (lines: string[] = []): void => {
    changes.replaceChildren();
    let list: HTMLElement | null = null;
    for (const line of lines) {
      if (line.startsWith("  ")) { (list ??= changes.appendChild(el("ul", "loc-changes-list"))).append(el("li", "", line.trim())); continue; }
      changes.append(el("p", "settings-note", line));
      list = null;
    }
  };
  frame.body.append(row, status, changes);

  const importBtn = dialogButton("Import…");
  const exportBtn = dialogButton("Export…");
  const close = dialogButton("Close", true);
  exportBtn.addEventListener("click", () => void (async () => {
    const format = formatSel.value as "json" | "xlsx" | "po";
    const locale = localeSel.value || undefined; // "" = template
    status.textContent = "Exporting…"; showChanges();
    const res = await withJob("Exporting localisation…", () => window.patter.exportLoc({ format, locale }));
    if (res.ok) { status.textContent = `Exported to ${res.path}`; showChanges(res.changes); }
    else if (res.canceled) status.textContent = "";
    else status.textContent = `Couldn't export. ${res.error ?? "Try again, and check the file isn't locked in version control."}`;
  })());
  importBtn.addEventListener("click", () => void (async () => {
    // The language picked: a file for another is refused, and one naming none (an older spreadsheet) imports
    // as it. With the template picked, the file's own language is used.
    const chosen = localeSel.value || undefined;
    status.textContent = "Importing…"; showChanges();
    const res = await window.patter.importLoc(chosen);
    if (res.ok) {
      status.textContent = `Imported ${res.updated ?? 0} string(s) for ${res.locale} across ${res.files ?? 0} scene(s).`
        + (res.dropped ? ` Dropped ${res.dropped} translation(s) of action text, which isn't translated while "Localise text lines in dialogue scenes" is off.` : "");
      showChanges(res.report); // a missing language, the lines skipped, and the translations to check
      await refreshProblems(); // the bundle is now stale relative to the new strings
    } else if (res.canceled) status.textContent = "";
    else status.textContent = `Import failed: ${res.error ?? "unknown error"}`;
  })());
  close.addEventListener("click", () => frame.close());
  frame.actions.append(importBtn, exportBtn, close);
  frame.open();
}

/** File > Export Production Info (also the button in the report view): render the report to an xlsx and
 *  save it through a native dialog. On success, briefly confirms on the button it was triggered from. */
async function exportProductionInfo(btn?: HTMLButtonElement): Promise<void> {
  if (!project) return; // nothing open
  if (surface) await save(); // flush pending edits so the exported figures are current
  const res = await withJob("Exporting production information…", () => window.patter.exportReport());
  if (res.ok) {
    if (btn) { const prev = btn.textContent; btn.replaceChildren("Exported", iconNode("tick", 12)); btn.disabled = true;
      setTimeout(() => { btn.textContent = prev; btn.disabled = false; }, 1600); }
  } else if (res.error) landed(res, "Couldn't export the production information");
}

/** Edit > Show Card in Storyletter: the storylet card the open scene plays, in the paired project. */
async function showInStoryletter(): Promise<void> {
  if (!currentSceneId) { toast("Open a scene first: its card is the one named after it.", "error"); return; }
  await save();
  const r = await window.patter.showInStoryletter(currentSceneId);
  if (r.ok) toast("Opening its card in Storyletter", "ok");
  else if (!r.canceled) toast(r.error ?? "Couldn't open Storyletter", "error");
}

/** Publish Bundle (Publish menu): compile + write the runtime `.patterc` to the configured output path.
 *  It pins first (pin on publish): every scene and block address still following its name is written down,
 *  and the toast says how many, once, so the diff that follows is not a surprise. */
async function buildBundle(): Promise<void> {
  if (!project) return;
  const res = await withJob("Publishing the bundle…", () => window.patter.buildBundle({ pin: true }));
  // Main rewrote the pinned flow shards: re-read the open scene so its next save carries the pins.
  if (res.pinned) await reloadOpenScene();
  if (res.ok) {
    // Show where it landed RELATIVE to the project root when it's inside (the common dist/ case), so the
    // toast reads cleanly; fall back to the absolute path for an output written elsewhere.
    const where = relToProject(res.path);
    const pinned = res.pinned ? `\nPinned ${plural(res.pinned, "Game ID")} that followed a name` : "";
    toast(`Bundle published\n${where}${pinned}`, "ok");
  } else landed({ ok: false, ...(res.error ? { error: res.error } : {}) }, "Couldn't publish");
}

/** Production ▸ Update Audio Manifest (#206): rewrite the sidecar patteraudio.json from the audio folders. */
async function buildAudioManifest(): Promise<void> {
  if (!project) return;
  const res = await window.patter.buildAudioManifest();
  if (res.ok) {
    const where = relToProject(res.path);
    toast(`Audio manifest updated\n${where}`, "ok");
  } else toast(res.error ? `Audio manifest failed: ${res.error}` : "Audio manifest failed", "error");
}

/** File ▸ Publish Readable Script: write a .pdf / .docx screenplay of the whole script + flow (format
 *  chosen in the native Save dialog in main); toast the result. */
async function exportScript(): Promise<void> {
  if (!project) return;
  const res = await withJob("Publishing the readable script…", () => window.patter.exportScript());
  if (res.ok) {
    const where = relToProject(res.path);
    toast(`Script published\n${where}`, "ok");
  } else if (!res.canceled) landed({ ok: false, ...(res.error ? { error: res.error } : {}) }, "Couldn't publish");
}

/** What the editable-script dialogs need from the editor. */
function editableContext(): EditableDialogContext {
  return {
    sceneId: currentSceneId,
    sceneName: project?.scenes.find((sc) => sc.id === currentSceneId)?.name,
    withJob,
    save: async () => { if (surface) await save(); },
    goTo: async (sceneId, anchor) => {
      if (sceneId !== currentSceneId) await loadScene(sceneId);
      surface?.revealNode(anchor, { instant: true });
    },
    rel: (path) => relToProject(path),
  };
}

/** File ▸ Export as Patterpack: flush pending edits (so the packed bytes are current), then ask main to zip
 *  the whole project into one `.patterpack` file the writer can send to someone. Native Save dialog in main. */
async function exportPatterpack(): Promise<void> {
  if (!project) return;
  if (surface) await save(); // pending text edits
  await persistDocs();                // pending Notes
  await persistComments();            // pending comments
  const res = await withJob("Exporting the Patterpack…", () => window.patter.exportPatterpack());
  if (res.ok) {
    const where = relToProject(res.path);
    toast(`Patterpack exported\n${where}`, "ok");
  } else if (!res.canceled) landed({ ok: false, ...(res.error ? { error: res.error } : {}) }, "Couldn't export");
}

/** File ▸ Open Patterpack: pick a `.patterpack` file, choose a destination folder, unpack, and switch to
 *  the new project (main runs both dialogs). Null when either picker is cancelled. */
async function openPatterpack(): Promise<void> {
  await leaveProject();
  const r = await window.patter.openPatterpack();
  if (r) await showProject(r);
}

/** The merge's confirmation, saying what the plan found. The merge is one step of the project history,
 *  so it says it can be undone: Edit ▸ Undo puts every shard back.
 *
 *  A project-id mismatch takes the title. It nearly always means the wrong file was chosen at one of the
 *  two pickers, and the merge that follows would be a heap of conflicts that reads as though the other
 *  author rewrote everything. Still only a warning: ids can legitimately differ across a fork or a
 *  reissue. The three ids are named, because which FILE is wrong is what the author has to act on. */
function confirmPackMerge(summary: PackMergeSummary): Promise<boolean> {
  const added = summary.shards.filter((sh) => sh.added).length;
  const merged = summary.shards.length - added;
  const what = `This merges ${plural(merged, "file")}${added ? ` and adds ${added}` : ""} into the open project.`;
  const { provenance: pv, gameScopes } = summary;
  const lines = [
    pv.ok ? "" : [
      `The returned pack carries project id ${pv.returned ?? "(none)"}`,
      `the pack you sent carries ${pv.base ?? "(none)"}`,
      `and this project is ${pv.target ?? "(unreadable)"}.`,
    ].join(", ") + " Usually that means the wrong file was chosen at one of the two prompts. Merging anyway will work, but if the ancestor is wrong you will get conflicts everywhere rather than only where you and they really disagreed.",
    summary.conflicts > 0
      ? `${plural(summary.conflicts, "conflict")} will keep your version and leave a .patterconflict file beside the shard saying what disagreed.`
      : "",
    // Their World edit goes to the game's shared file too, which the game's other tools read, so say so.
    gameScopes?.error
      ? `They changed the game scopes, but ${gameScopes.path} won't parse, so their change won't be written there: ${gameScopes.error}`
      : gameScopes ? `They changed the game scopes, so ${gameScopes.path}, which the game's other tools share, will take their change too.` : "",
    "You can undo this.",
  ].filter(Boolean);
  const evidence = el("div", "merge-evidence");
  evidence.append(...lines.map((t) => el("p", "confirm-body", t)));
  return confirmDialog({
    title: pv.ok ? "Merge the returned pack?" : "This pack may not belong to this project",
    body: what,
    bodyNode: evidence,
    confirmLabel: pv.ok ? "Merge" : "Merge anyway",
  });
}

/** File ▸ Merge Returned Patterpack: fold a pack that came back into the OPEN project.
 *
 *  Flush first, and flush everything. A merge reads the working copy off DISK, so any pending edit still
 *  sitting in a buffer would be invisible to the three-way merge and then overwritten by its result: the
 *  one way this operation could actually lose work. Same flush as Export as Patterpack, for the same
 *  reason from the other direction.
 *
 *  Main runs both pickers and works the merge out without writing; null means a picker was dismissed. The
 *  confirm is ours, on the shell's frame with Cancel focused, so Enter never merges by accident (it did
 *  on the native box). It reports what the merge actually found, and only then does main write. On
 *  success the project has been re-read from disk, so the whole editor is rebuilt from the returned
 *  payload rather than patched. */
async function mergePatterpack(): Promise<void> {
  if (!project) return;
  if (surface) await save(); // pending text edits
  await persistDocs();                // pending Notes
  await persistComments();            // pending comments
  const planned = await withJob("Merging the returned Patterpack…", () => window.patter.mergePatterpackPlan());
  if (!planned) return;                                  // cancelled at one of the two pickers
  if ("error" in planned) { toast(`Merge failed: ${planned.error}`, "error"); return; }
  const { summary } = planned;
  if (summary.shards.length === 0) { toast("Nothing to merge\nThat pack has no project files in it.", "info"); return; }
  // A merge is one step of the project history, so it asks first only when there's something to read
  // before it happens: a pack that seems to belong to another project, or a World change that also goes to
  // the game's shared file. Otherwise it merges, and the report carries Undo (the October 2026 review).
  if ((!summary.provenance.ok || summary.gameScopes) && !(await confirmPackMerge(summary))) { await window.patter.mergePatterpackDrop(); return; }

  const before = topProjectStep();
  const r = await withJob("Merging the returned Patterpack…", () => window.patter.mergePatterpackCommit());
  if ("error" in r) { toast(`Merge failed: ${r.error}`, "error"); return; }
  const mergeStep = topProjectStep();
  const undoable = mergeStep && mergeStep.id !== before?.id ? { id: mergeStep.id, label: mergeStep.label, merged: false, scenes: [], authoring: [] } : undefined;

  project = r.project;
  renderNav();
  // The open scene RE-READ, sidecars and all: `loadScene` returns at once for the scene already open, so
  // the editor kept the pre-merge text and comments, and the first edit autosaved them over the merge.
  if (currentSceneId && project.scenes.some((sc) => sc.id === currentSceneId)) await reloadOpenScene();
  else if (project.scenes[0]) await loadScene(project.scenes[0].id, { behind: true }); // their pack deleted the scene we were in
  void refreshProblems();
  void refreshVcStatus();
  void refreshClashes(); // the banner says what the merge left to settle

  const added = r.summary.shards.filter((sh) => sh.added).length;
  const merged = r.summary.shards.length - added;
  const counts = `${merged} merged${added ? `, ${added} added` : ""}`;
  // Their World edit went to the game's shared file (or couldn't, which is the error voice's too).
  const world = r.summary.gameScopes;
  const worldNote = !world ? "" : world.error
    ? `\nTheir game scopes weren't written to ${world.path}: ${world.error}`
    : `\nTheir game scopes are in ${world.path}`;
  // A conflict is not a failure - the merge committed - but it is not a quiet success either. The error
  // voice is what stops an author walking away from unresolved conflicts thinking they were done.
  if (r.summary.conflicts > 0) {
    toastWithUndo(`${counts}. ${plural(r.summary.conflicts, "clash", "clashes")} ${r.summary.conflicts === 1 ? "needs" : "need"} a look.\nResolve them from the banner, or File ▸ Resolve Clashes…${worldNote}`, "error", undoable);
  } else toastWithUndo(`Merged the returned pack\n${counts}${worldNote}`, world?.error ? "error" : "ok", undoable);
}

/** Publish ▸ Publish for Web: write the story to a FOLDER as a customisable page (index.html +
 *  style.css published once and then kept; story.js + patterplay.js refreshed every publish). */
async function exportWeb(): Promise<void> {
  if (!project) return;
  const res = await withJob("Publishing for the web…", () => window.patter.exportWeb());
  if (res.ok) {
    toast(res.kept?.length ? `Story updated\nKept your ${res.kept.join(" + ")}` : `Web page published\n${res.path ?? ""}`, "ok");
  } else if (!res.canceled) landed({ ok: false, ...(res.error ? { error: res.error } : {}) }, "Couldn't publish");
}

/** Publish ▸ Publish Playable HTML: write a single self-contained `.html` (runtime + story inlined) that
 *  plays the whole project offline in any browser. Native Save dialog in main; toast the result. */
async function exportPlayableHtml(): Promise<void> {
  if (!project) return;
  const res = await withJob("Publishing playable HTML…", () => window.patter.exportPlayableHtml());
  if (res.ok) {
    const where = relToProject(res.path);
    toast(`Playable HTML published\n${where}`, "ok");
  } else if (!res.canceled) landed({ ok: false, ...(res.error ? { error: res.error } : {}) }, "Couldn't publish");
}

// --- Project Settings (File > Project Settings…) -------------------------------
// The dialog is the shell's `mountSettingsDialog` (ui-review-2026-09, finding 4): the modal, the grouped
// tab rail, the Enter guard and the Save gate are its. The sections below own their content and their
// state, mount fresh on every open from `settingsRead` (read just before open(), because mount() is
// synchronous), and hand what they hold to `saveSettingsFromDialog` through `live`.

type SettingsRead = {
  s: ProjectSettingsDto; dictionaries: Awaited<ReturnType<typeof window.patter.listDictionaries>>;
  /** The character and qualifier pairs the lines use (the Cast tab's "Shown with" fields). */
  speakerPairs: Awaited<ReturnType<typeof window.patter.speakerPairs>>;
};
let settingsRead: SettingsRead | null = null;
/** The controls and editors of the OPEN dialog, filled by each section's mount() and read by Save. */
interface LiveSettings {
  name: HTMLInputElement; start: HTMLSelectElement;
  voiced: HTMLInputElement; formatting: HTMLInputElement; padAfter: HTMLInputElement; estimateRate: HTMLInputElement;
  build: HTMLInputElement; buildLocales: HTMLSelectElement; buildSourceDebug: HTMLInputElement;
  vcs: HTMLSelectElement;
  ccOpen: HTMLInputElement; ccClose: HTMLInputElement; ccCharacter: HTMLInputElement;
  langs: ReturnType<typeof mountLanguages>; localiseDialogueText: HTMLInputElement; gd: ReturnType<typeof mountGameDataFields>;
  world: ReturnType<typeof mountWorld>; worldHost: HTMLElement; cast: ReturnType<typeof mountCast>;
  qualifiers: ReturnType<typeof mountQualifiers>;
  writingStatus: ReturnType<typeof mountWritingStatus>; estimating: ReturnType<typeof mountEstimating>;
  audio: ReturnType<typeof mountAudio>; dictionary: ReturnType<typeof mountDictionary>;
}
let live: Partial<LiveSettings> = {};

// The small field kit the static markup used to spell out: a captioned field, a checkbox row with its
// sub-line, and the two kinds of note.
// The family's settings rows (ruling C of the October 2026 review): the shell's `labelled` and
// `labelledToggle`, as Storyletter's settings use, so the two apps' dialogs look the same. Caption on the
// left, control inline, any explanation underneath.
const sField = (caption: string, control: HTMLElement, ...notes: HTMLElement[]): HTMLElement =>
  labelled(caption, control, notes.length ? notes.flatMap((n) => [...n.childNodes]) : undefined);
const sToggle = (label: string, sub: string, checked: boolean, cls = "settings-toggle"): { row: HTMLElement; input: HTMLInputElement } =>
  labelledToggle(label, { checked, hint: sub, sub: cls.includes("settings-suboption") });
const sNote = (cls: string, ...parts: Array<string | Node>): HTMLElement => { const n = el(cls === "settings-note" ? "p" : "small", cls); n.append(...parts); return n; };
const code = (text: string): HTMLElement => el("code", undefined, text);
const bold = (text: string): HTMLElement => el("b", undefined, text);
const sSelect = (options: Array<[string, string]>, value: string, cls?: string): HTMLSelectElement => {
  const sel = el("select", cls);
  for (const [v, label] of options) sel.append(new Option(label, v));
  sel.value = value;
  return sel;
};
const VCS_OPTIONS: Array<[string, string]> = [["git", "Git"], ["perforce", "Perforce"], ["plastic", "Plastic SCM"], ["svn", "Subversion (SVN)"], ["none", "None"]];
/** The bundle path's explanation, said once for both places that ask for it (Project Settings and New
 *  Project), under the name Storyletter gives the same setting. */
const bundlePathHint = (): (string | HTMLElement)[] => [
  "Where Publish ▸ Publish Bundle writes the ", code(".patterc"), ", relative to the project folder. The default is a ",
  code("patter-dist/"), " folder beside it.",
];
const DUP_MESSAGE = "Two entries share a name. Names must be unique.";

/** The project's own values for its Patter extensions, edited in their Settings sections since the dialog
 *  opened, by extension id: each the whole entry, carried at Save. */
let settingsExtensionEdits: Record<string, Record<string, unknown>> = {};

/** A section of Project Settings for each Patter extension declaring project fields, in the Project group
 *  after Version control: what the project takes it at, then the project's own values. */
function projectExtensionSections(): SettingsSection[] {
  return settingsExtensions(project?.extensions).map((extension): SettingsSection => ({
    id: settingsSectionId(extension.id), label: extension.name, mount: (host): SettingsSectionHandle => {
      // Mounted fresh on every open, from the project as it now stands (its values may have been saved since
      // the dialog was built).
      mountProjectSection(host, {
        extension: project?.extensions?.find((x) => x.id === extension.id) ?? extension, adapter: currentExtensionAdapter(),
        locked: lockedLine(projectExtensionVc[extension.id]?.lockedBy),
        onChange: (entry) => { settingsExtensionEdits[extension.id] = entry; },
      });
      return {};
    },
  }));
}

/** The extensions the dialog was built with: a project taking others rebuilds it. */
let settingsDlgShape = "";
const extensionShape = (): string => settingsExtensions(project?.extensions).map((x) => `${x.id}:${x.name}`).join(",");

function buildSettingsDialog(): SettingsDialog {
  settingsDlgShape = extensionShape();
  return mountSettingsDialog({
  title: "Project settings",
  sections: [
    { id: "general", label: "General", group: "Project", mount: (host): SettingsSectionHandle => {
      const { s } = settingsRead!;
      const name = el("input"); name.type = "text"; name.required = true; name.value = s.name;
      // Start scene picker: "(unset)" plus every scene; select the project's current start.
      const start = sSelect([["", "(unset)"], ...(project?.scenes ?? []).map((sc): [string, string] => [sc.id, sc.name])], s.start?.scene ?? "", "field");
      const voiced = sToggle("Voiced", "Tracks recording status and exports voice scripts.", s.voiced);
      // Audio is meaningful only for a VOICED project (#206): the Audio tab reads this box (its `disabled`
      // below), and flipping it here updates the tab without reopening.
      voiced.input.addEventListener("change", () => settingsDlg.refreshTabs());
      const formatting = sToggle("Inline formatting", "Bold and italic in dialogue and text.", s.formatting);
      // Line padding: the project's default pause after a line. Blank goes back to the built-in one.
      const padAfter = el("input", "settings-seconds"); padAfter.type = "number"; padAfter.step = "0.1";
      padAfter.min = String(PAD_AFTER_MIN); padAfter.max = String(PAD_AFTER_MAX);
      padAfter.value = formatSeconds(s.padAfterDefault ?? DEFAULT_PAD_AFTER); padAfter.placeholder = formatSeconds(DEFAULT_PAD_AFTER);
      // How long a line with no recording lasts: syllables a second. Blank goes back to the built-in rate.
      const estimateRate = el("input", "settings-seconds"); estimateRate.type = "number"; estimateRate.step = "0.1";
      estimateRate.min = String(ESTIMATE_SYLLABLES_PER_SECOND_MIN); estimateRate.max = String(ESTIMATE_SYLLABLES_PER_SECOND_MAX);
      estimateRate.value = formatSeconds(s.estimateSyllablesPerSecond ?? DEFAULT_ESTIMATE_SYLLABLES_PER_SECOND);
      estimateRate.placeholder = formatSeconds(DEFAULT_ESTIMATE_SYLLABLES_PER_SECOND);
      host.append(sField("Project name", name), sField("Start", start, sNote("settings-fieldnote", "The scene Play from Start opens.")),
        sField("Pad after", padAfter, sNote("settings-fieldnote", "Seconds of pause after each line, unless the line or something around it sets its own.")),
        sField("Timing for lines without audio", estimateRate, sNote("settings-fieldnote", "Syllables a second. How long a line with no recording lasts, worked out from its text in the project's main language. Lines with a recording always last as long as the recording.")),
        voiced.row, formatting.row);
      Object.assign(live, { name, start, voiced: voiced.input, formatting: formatting.input, padAfter, estimateRate });
      // A blank name used to close the dialog and drop every other edit with it (parity row 7); now it
      // is the fault the gate names.
      return { firstInvalid: () => {
        if (!name.value.trim()) return { el: name, message: "Give the project a name." };
        const pad = padAfter.value.trim() === "" ? DEFAULT_PAD_AFTER : Number(padAfter.value);
        if (!Number.isFinite(pad) || pad < PAD_AFTER_MIN || pad > PAD_AFTER_MAX) return { el: padAfter, message: `Use a number of seconds from ${PAD_AFTER_MIN} to ${PAD_AFTER_MAX}.` };
        const rate = estimateRate.value.trim() === "" ? DEFAULT_ESTIMATE_SYLLABLES_PER_SECOND : Number(estimateRate.value);
        if (!Number.isFinite(rate) || rate < ESTIMATE_SYLLABLES_PER_SECOND_MIN || rate > ESTIMATE_SYLLABLES_PER_SECOND_MAX) {
          return { el: estimateRate, message: `Use a number of syllables a second from ${ESTIMATE_SYLLABLES_PER_SECOND_MIN} to ${ESTIMATE_SYLLABLES_PER_SECOND_MAX}.` };
        }
        return null;
      } };
    } },
    { id: "build", label: "Publish", mount: (host): SettingsSectionHandle => {
      const { s } = settingsRead!;
      const build = el("input"); build.type = "text"; build.spellcheck = false; build.placeholder = "../patter-dist/your-project.patterc"; build.value = s.buildBundle;
      const buildLocales = sSelect([["embedded", "Embedded"], ["ids", "IDs only"]], s.buildLocalisation, "insp-select");
      const sourceDebug = sToggle("Embed source language for debug", "Adds the source strings so an IDs-only build can be played. The runtime marks it as not shippable.", s.buildSourceDebug, "settings-toggle settings-suboption");
      // The source-debug toggle only applies to an IDs-only build; show it only then.
      const syncRows = (): void => { sourceDebug.row.hidden = buildLocales.value !== "ids"; };
      buildLocales.addEventListener("change", syncRows); syncRows();
      host.append(
        sField("Bundle path", build, sNote("identity-hint", ...bundlePathHint())),
        sField("Localisation", buildLocales, sNote("identity-hint", bold("Embedded"), " ships every language in the bundle and the runtime returns the right string. ", bold("IDs only"), " ships no text, so the runtime returns the line ID and your game looks it up.")),
        sourceDebug.row);
      Object.assign(live, { build, buildLocales, buildSourceDebug: sourceDebug.input });
      return {};
    } },
    { id: "vcs", label: "Version control", mount: (host): SettingsSectionHandle => {
      const vcs = sSelect(VCS_OPTIONS, settingsRead!.s.vcs, "insp-select");
      host.append(sField("Version control system", vcs),
        sNote("settings-note", "Patterpad checks a file out before writing where the system locks files, and writes straight away where it merges. Switching systems regenerates the project's ", code("vcs-setup.md"), " and ignore rules."));
      live.vcs = vcs;
      return {};
    } },
    ...projectExtensionSections(),
    { id: "world", label: "Game scopes", group: "Story data", mount: (host): SettingsSectionHandle => {
      const { s } = settingsRead!;
      const worldHost = el("div"); host.append(worldHost);
      const world = mountWorld(worldHost, { scopeRegistry: s.scopeRegistry, coverageDrivers: s.coverageDrivers, onPropose: () => window.patter.proposeCoverageDrivers(), ...(s.worldFile ? { worldFile: s.worldFile } : {}),
        onStageReorder: (target, note) => void fillStageNote(note, target) });
      Object.assign(live, { world, worldHost });
      // Three gates. A scope name that can't be used says why. A duplicate name is a data hazard. An
      // illegal one is a declared property no expression can reach (a hyphen reads as subtraction, a
      // leading digit or a keyword will not parse, a capital is folded away); the field's own rollover
      // says which fault, so the line repeats it.
      return { firstInvalid: () => {
        const scope = world.firstBadScope(); if (scope) return scope;
        const dup = world.firstDuplicate(); if (dup) return { el: dup, message: DUP_MESSAGE };
        const bad = world.firstIllegalName(); return bad ? { el: bad, message: bad.title || "That property name can't be used in an expression." } : null;
      } };
    } },
    { id: "gamedata", label: "Game Data", mount: (host): SettingsSectionHandle => {
      host.append(sNote("settings-note", "Fields your game reads from a scene, block, snippet, or line. Define them here and fill them in from the inspector."));
      const gdHost = el("div"); host.append(gdHost);
      const gd = mountGameDataFields(gdHost, settingsRead!.s.gameDataFields);
      live.gd = gd;
      return { firstInvalid: () => { const dup = gd.firstDuplicate(); return dup ? { el: dup, message: DUP_MESSAGE } : null; } };
    } },
    { id: "cast", label: "Cast", mount: (host): SettingsSectionHandle => {
      host.append(sNote("settings-note", "A line's speaker must be one of these names."));
      const castHost = el("div"); host.append(castHost);
      const { s, speakerPairs } = settingsRead!;
      // A pair's label follows the Qualifiers tab as it's edited: its names and the pattern, read live.
      const cast = mountCast(castHost, s.cast, {
        pairs: speakerPairs,
        qualifierName: (gameId) => live.qualifiers?.nameOf(gameId) ?? s.qualifiers.find((q) => q.gameId === gameId)?.name ?? gameId,
        pattern: () => live.qualifiers?.pattern() ?? s.speakerPattern ?? "",
      });
      live.cast = cast;
      return { firstInvalid: () => { const dup = cast.firstDuplicate(); return dup ? { el: dup, message: DUP_MESSAGE } : null; } };
    } },
    { id: "qualifiers", label: "Qualifiers", mount: (host): SettingsSectionHandle => {
      host.append(sNote("settings-note", "How a line is delivered, shown after the speaker's name: TAM (O.S.). The speaker stays one character."));
      const qHost = el("div"); host.append(qHost);
      const { s } = settingsRead!;
      const qualifiers = mountQualifiers(qHost, s.qualifiers ?? [], { pattern: s.speakerPattern, onChange: () => live.cast?.refreshLabels() });
      live.qualifiers = qualifiers;
      return { firstInvalid: () => qualifiers.firstInvalid() };
    } },
    { id: "writing-status", label: "Writing status", group: "Writing & audio", mount: (host): SettingsSectionHandle => {
      const wsHost = el("div"); host.append(wsHost);
      live.writingStatus = mountWritingStatus(wsHost, settingsRead!.s.writingStatuses);
      return {};
    } },
    { id: "estimating", label: "Estimating", mount: (host): SettingsSectionHandle => {
      const { s } = settingsRead!;
      const estHost = el("div"); host.append(estHost);
      live.estimating = mountEstimating(estHost, s.estimating, s.writingStatuses);
      return {};
    } },
    { id: "recording-status", label: "Recording status", mount: (host): SettingsSectionHandle => {
      const { s } = settingsRead!;
      const audioHost = el("div"); host.append(audioHost);
      live.audio = mountAudio(audioHost, { trackAudioStatus: s.trackAudioStatus, statuses: s.recordingStatuses, audioFolders: s.audioFolders, audioRoot: s.audioRoot, scratchStatus: s.scratchStatus });
      return {};
    }, disabled: () => live.voiced?.checked ? null : "Enable Voiced (General tab) to track recording status and audio." },
    { id: "captions", label: "Closed captions", mount: (host): SettingsSectionHandle => {
      const { s } = settingsRead!;
      host.append(sNote("settings-note", "Closed captions describe sounds inside dialogue. A game can turn them off at runtime, and every cue between these delimiters is then removed from the line. Lines spoken by the caption character are removed entirely."));
      const delim = (value: string): HTMLInputElement => { const i = el("input"); i.type = "text"; i.spellcheck = false; i.maxLength = 4; i.value = value; return i; };
      const ccOpen = delim(s.closedCaptions.open);
      const ccClose = delim(s.closedCaptions.close);
      const warn = sNote("settings-fieldnote caption-delims-warn", "A ", code("("), " at the start of a line opens a performance direction, so a caption there won't work. Use ", code("["), " or another token.");
      // Guardrail (#214): "(" at a line start opens a performance direction in the surface, so it can't also
      // be a caption start. Warn when the author picks it (round brackets stay allowed, e.g. for mid-line cues).
      const syncWarn = (): void => { warn.hidden = ccOpen.value.trim() !== "("; };
      ccOpen.addEventListener("input", syncWarn); syncWarn();
      const delims = el("div", "caption-delims");
      delims.append(sField("Caption start", ccOpen), sField("Caption end", ccClose),
        sNote("settings-fieldnote caption-delims-note", "The default pair is ", code("["), " and ", code("]"), "."), warn);
      const ccCharacter = el("input"); ccCharacter.type = "text"; ccCharacter.spellcheck = false; ccCharacter.value = s.closedCaptions.character;
      host.append(delims, sField("Caption character", ccCharacter, sNote("settings-fieldnote", "A cast member whose whole lines are captions. The default is ", code("SFX"), ".")));
      Object.assign(live, { ccOpen, ccClose, ccCharacter });
      return {};
    } },
    { id: "dictionary", label: "Dictionary", mount: (host): SettingsSectionHandle => {
      const { s, dictionaries } = settingsRead!;
      const dictHost = el("div"); host.append(dictHost);
      // Dictionary tab (#177): the available dictionaries (built-ins + imports) drive the picker; Import / Remove
      // route through the main process.
      live.dictionary = mountDictionary(dictHost, {
        language: s.dictionaryLanguage, words: s.dictionaryWords, ignore: s.dictionaryIgnore, enabled: s.dictionaryEnabled,
        dictionaries,
        onImport: () => window.patter.importDictionary(),
        onRemove: (id) => window.patter.removeDictionary(id),
      });
      return {};
    } },
    { id: "language", label: "Language", group: "Localisation", mount: (host): SettingsSectionHandle => {
      const { s } = settingsRead!;
      host.append(sNote("settings-note", "The default language is the one you write in. The others are translation targets."));
      const langHost = el("div"); host.append(langHost);
      live.langs = mountLanguages(langHost, { localeDefault: s.localeDefault, locales: s.locales });
      const dialogueText = sToggle("Localise text lines in dialogue scenes",
        "When this is off, a text line in a scene where characters speak is action: a direction for whoever stages the scene. It isn't translated or shown to the player.",
        s.localiseDialogueText ?? false);
      host.append(dialogueText.row);
      live.localiseDialogueText = dialogueText.input;
      return {};
    } },
  ],
  onSave: () => saveSettingsFromDialog(), // false (a refused write) keeps the dialog open with the edits in it
  });
}
let settingsDlg = buildSettingsDialog();

/** File > Project Settings: read the project-level settings, open the dialog on a tab (General by default;
 *  the coverage window's "Game scopes…" and a `@world` pill's "Go to definition" open "world"). */
async function openProjectSettings(initialTab = "general"): Promise<void> {
  if (!project) return; // nothing open
  const s = await window.patter.readSettings();
  if (!s) return;
  settingsRead = { s, dictionaries: await window.patter.listDictionaries(), speakerPairs: await window.patter.speakerPairs() };
  live = {};
  settingsExtensionEdits = {};
  // The extension set decides the dialog's sections: rebuilt when it has changed since it was built.
  if (extensionShape() !== settingsDlgShape) { settingsDlg.destroy(); settingsDlg = buildSettingsDialog(); }
  settingsDlg.open(initialTab);
  if (initialTab === "general") setTimeout(() => live.name?.focus(), 0);
}

/** A quality's stages were reordered: say how many gates order it by them, since the new order changes what
 *  they mean though no value moves. Empty when none do. */
async function fillStageNote(note: HTMLElement, target: { scope: string; name: string; scene?: string }): Promise<void> {
  if (!target.name) { note.textContent = ""; return; }
  note.textContent = stageGateNote(await window.patter.stageGates(target));   // the family's one wording
}

/** Save is clicked and every section's gate passed: read the sections back and persist. False when the
 *  write was refused, which keeps the dialog open with the edits in it. */
async function saveSettingsFromDialog(): Promise<boolean> {
  const read = settingsRead;
  const l = live as LiveSettings; // every section mounted on open(), so every handle is set
  if (!read || !l.name) return true;
  return saveProjectSettings({
    name: l.name.value.trim(), vcs: l.vcs.value as VcsKind, ...(l.start.value ? { start: { scene: l.start.value } } : {}),
    voiced: l.voiced.checked, formatting: l.formatting.checked,
    padAfterDefault: l.padAfter.value.trim() === "" ? DEFAULT_PAD_AFTER : Number(l.padAfter.value), // the gate checked its range
    estimateSyllablesPerSecond: l.estimateRate.value.trim() === "" ? DEFAULT_ESTIMATE_SYLLABLES_PER_SECOND : Number(l.estimateRate.value),
    closedCaptions: { open: l.ccOpen.value, close: l.ccClose.value, character: l.ccCharacter.value.trim() },
    buildBundle: l.build.value.trim(), buildLocalisation: l.buildLocales.value as "embedded" | "ids", buildSourceDebug: l.buildSourceDebug.checked,
    ...l.langs.value(), localiseDialogueText: l.localiseDialogueText.checked, gameDataFields: l.gd.value(),
    properties: read.s.properties, // @patter lives in the Properties document now; pass the current set through untouched
    ...l.world.value(), ...(() => {
      // Stages renamed in place on World properties and on game-data fields: the save carries each into
      // every value that names it, in the same batch as the declarations.
      const stageRenames = [...l.world.stageRenames(), ...l.gd.stageRenames()];
      return stageRenames.length ? { stageRenames } : {};
    })(), cast: l.cast.value(), castRenames: l.cast.renames(),
    qualifiers: l.qualifiers.value(), qualifierRenames: l.qualifiers.renames(), speakerPattern: l.qualifiers.pattern(),
    writingStatuses: l.writingStatus.value(), estimating: l.estimating.value(), ...l.audio.value(),
    ...l.dictionary.value(),
    ...(Object.keys(settingsExtensionEdits).length ? { extensionValues: { ...settingsExtensionEdits } } : {}),
  });
}

/** Save the project's settings; false (after saying why) when the write was refused, so the Settings dialog
 *  can stay open with the author's edits in it. */
async function saveProjectSettings(s: ProjectSettingsDto, opts: { propertiesOnly?: boolean; undo?: { label: string; key: string } } = {}): Promise<boolean> {
  const res = await tracked(window.patter.saveSettings(s, opts.undo));
  if (!landed(res, "Couldn't save the project settings")) return false;
  if (res.project) {
    project = res.project; projectNameEl.textContent = project.name;
    // The project's @patter properties may have changed (added / renamed / re-typed / enum values edited):
    // rebuild the condition-editor catalogue so they're selectable immediately, without a scene reload or a
    // restart. Mirrors openSceneProps for the scene scope; keeps the load-time order (@patter first). New
    // default values reach the run through the play window's live refresh (the main process triggers it).
    // The host scopes (#159) may have changed too, and with a game scopes folder so may the shared file:
    // rebuild their properties, and the editors' dialect.
    sceneProps = [
      ...s.properties.map((d) => declToConditionProperty("patter", d)),
      ...sceneProps.filter((p) => p.scope === "scene"),
    ];
    await refreshEditorScopes();
    void refreshVcStatus(); // the PROJECT shard just changed on disk: re-badge the Properties row
    if (!opts.propertiesOnly) {
      await buildSpellcheck(); // the Dictionary settings (language / words / on-off) may have changed (#177)
      pushWritingStatus(); // the writing-status ladder (names / colours) may have changed - re-push to the surface (#196)
      surface?.setQualifiers(project.qualifiers ?? []); // the qualifier names (and list) may have changed: the cues repaint
      pushCast(); // the Cast tab may have added, removed, or renamed someone (who keeps their colour)
      surface?.setLocaliseDialogueText(project.localiseDialogueText); // action text may have become shown text, or the reverse
    }
    void refreshProblems();  // revalidate against the new declarations (and, after a full save, the new spelling setup)
    lastInspectorSig = null; if (lastInspectorCtx) showInspector(lastInspectorCtx); // refresh the status dropdown + condition pills
  }
  return true;
}

/** Rebuild the editors' other scopes from the main process, the one place that knows them all: the
 *  host scopes, and the game scopes folder's (another engine's `@story`, whose tip says whose it is).
 *  Keeps this scene's `@patter` and `@scene` entries as they are, since those may be unsaved edits. */
async function refreshEditorScopes(): Promise<void> {
  if (!currentSceneId) return;
  const fresh = await window.patter.readScene(currentSceneId);
  sceneProps = [
    ...sceneProps.filter((p) => p.scope === "patter"),
    ...fresh.properties.filter((p) => p.scope !== "patter" && p.scope !== "scene"),
    ...sceneProps.filter((p) => p.scope === "scene"),
  ];
  setHostScopeTokens(fresh.hostScopes);
}

/** Add extension… (the Extensions window, or a view's "(not installed)…"): main picks and checks the package, takes it into the project as one undo step (with
 *  any extension it requires that the project lacks), and installs its views on this machine (then reloads the
 *  open scene, which now takes the extension's data). For an extension the project takes already, main installs
 *  its views and offers a newer version (`expect`, from a view "(not installed)…" in the Window menu, says which).
 *  Here the project is refreshed, and the writer told what happened. */
async function addExtension(expect?: string): Promise<void> {
  if (!project) return;
  landExtension(await window.patter.addExtension(expect));
}

/** Update… in the Extensions window: main asks for the package and says what will happen (a newer version taken
 *  as one undo step and installed, the same version reinstalled, an older one or another extension refused). The
 *  result lands as Add's does. */
async function updateExtension(id: string): Promise<void> {
  if (!project) return;
  landExtension(await window.patter.updateExtension(id));
}

/** What Add or Update did: the step noted, the project refreshed, and the writer told. */
function landExtension(r: AddExtensionResult | null): void {
  if (!r) return; // cancelled, or refused (main has said why)
  if (r.ok && r.reinstalled && r.installedOnly) {
    const what = `${r.name ?? "The extension"} ${r.version ?? ""}`.trim();
    if (r.installError) toast(`${what} couldn't be reinstalled on this machine: ${r.installError}`, "error");
    else toast(`Reinstalled ${what} on this machine`, "ok");
    return;
  }
  if (r.ok && r.installedOnly) {
    const what = `${r.name ?? "The extension"} ${r.version ?? ""}`.trim();
    if (r.installError) toast(`${what}'s views couldn't be installed on this machine: ${r.installError}`, "error");
    else toast(`${what}'s views are installed on this machine.${r.note ? `\n${r.note}` : ""}`, r.note ? "info" : "ok");
    return;
  }
  noteStep(r.step);
  if (!landed(r, "Couldn't add the extension")) return;
  if (r.project) { project = r.project; projectNameEl.textContent = project.name; }
  views.changed("all"); // over the project as it is now: a view's requirement may be met
  lastInspectorSig = null; if (lastInspectorCtx) showInspector(lastInspectorCtx);
  void refreshVcStatus();
  void refreshProblems();
  const also = (r.also ?? []).map((a) => `${a.name} ${a.version}`);
  const done = r.reinstalled ? "Reinstalled" : r.was !== undefined ? "Updated" : "Added";
  const what = `${done} ${[...also, `${r.name ?? "the extension"} ${r.version ?? ""}`.trim()].join(" and ")}`;
  if (r.installError) toast(`${what}\nIts views couldn't be installed on this machine: ${r.installError}`, "error");
  else toast(`${what}${r.warnings?.length ? `\n${r.warnings.join(" ")}` : ""}`, r.warnings?.length ? "info" : "ok");
}

/** Remove from Project…, asked for in the Extensions window (patterkit design/extensions-window.md): main refuses
 *  while another extension needs it, asks first, and takes it out of the project as one undo step that keeps its
 *  data. Here the step is noted and the project refreshed, as for Add. */
async function removeExtension(id: string): Promise<void> {
  if (!project) return;
  const r = await window.patter.removeExtension(id);
  if (!r) return; // refused or cancelled (main has said why)
  noteStep(r.step);
  if (!landed(r, "Couldn't remove the extension")) return;
  if (r.project) { project = r.project; projectNameEl.textContent = project.name; }
  views.changed("all");
  lastInspectorSig = null; if (lastInspectorCtx) showInspector(lastInspectorCtx);
  void refreshVcStatus();
  void refreshProblems();
  toast(`Removed ${r.name ?? "the extension"}`, "ok");
}

/** File ▸ Share Scopes with Other Tools: make the game's shared scopes folder (main asks where), then
 *  pick up the folder's scopes in the editors. */
async function shareScopes(): Promise<void> {
  if (!project) return;
  const r = await window.patter.shareScopes();
  if (!r) return; // cancelled
  if ("error" in r) { landed({ ok: false, error: r.error }, "Couldn't share the scopes"); return; }
  if ("shared" in r) { toast(`This project already shares its scopes.\nThey're in ${r.shared}.`, "ok"); return; }
  await refreshEditorScopes();
  void refreshProblems();
  lastInspectorSig = null; if (lastInspectorCtx) showInspector(lastInspectorCtx);
  toast(`Scopes shared\n${r.dir}`, "ok");
}

/** Scene inspector > Properties: edit the open scene's local `@scene` property declarations. Persists
 *  through the surface (the scene doc's raw, round-tripped on save) and refreshes the condition
 *  catalogue so the new props are usable immediately. Returns the list's host, so "Go to definition" can
 *  reveal a row in it, or null with no scene open. */
function openSceneProps(): HTMLElement | null {
  if (!surface) return null;
  // Opened from the inspector, which redraws while the dialog is up: focus comes back to the button the
  // redraw put where the opener was, never to <body>.
  const frame = dialogFrame({ title: "Scene properties", className: "scene-props-dialog", returnFocus: returnToTwin(inspectorStackEl, document.activeElement) });
  const note = el("p", "settings-note");
  note.append(el("code", undefined, "@scene"), " properties exist only within this scene. Tick Temporary to reset one on every entry.");
  const host = el("div");
  frame.body.append(note, host);
  const sceneId = currentSceneId;
  const stageRenames: StageRenameDto[] = [];
  const handle = mountProperties(host, surface.sceneProps(), {
    scope: "scene",
    onStageRename: (decl, from, to) => { if (sceneId) stageRenames.push({ scope: "scene", scene: sceneId, name: decl.name.trim(), from, to }); },
    onStageReorder: (decl, note) => { if (sceneId) void fillStageNote(note, { scope: "scene", scene: sceneId, name: decl.name.trim() }); },
  });
  const cancel = dialogButton("Cancel");
  const saveBtn = dialogButton("Save", true);
  cancel.addEventListener("click", () => frame.close());
  saveBtn.addEventListener("click", () => {
    // The same gate the Properties page and Project Settings apply: two properties of one name, or a name
    // no expression can reach, are refused rather than saved.
    const dup = handle.firstDuplicate();
    const bad = dup ? null : handle.firstIllegalName();
    if (dup || bad) {
      (dup ?? bad)!.focus();
      toast(dup ? DUP_MESSAGE : bad!.title || "That property name can't be used in an expression.", "error");
      return;
    }
    void apply();
    frame.close();
  });
  frame.actions.append(cancel, saveBtn);
  frame.open();
  return host;

  async function apply(): Promise<void> {
    if (!surface) return;
    const next = handle.value();
    // With a stage rename, the scene is saved BEFORE the declarations change: main takes the flow on disk
    // as what one undo of the rename goes back to, declarations and conditions together (the paired
    // gesture), since the reload after the rename drops the declaration edit from the scene's history.
    if (stageRenames.length) await save();
    if (!surface) return;
    surface.setSceneProps(next); // dispatches a doc edit -> the surface's onChange marks dirty + revalidates
    // A stage renamed in place: the scene saves (its declarations with it), then every condition and set
    // effect in it naming the old stage follows, and it reloads.
    if (stageRenames.length) void tracked(window.patter.renameStages(stageRenames)).then((r) => {
      if (landed(r, "Couldn't carry the stage rename") && r.expressions > 0) {
        toast(`Renamed in ${plural(r.expressions, "condition or effect", "conditions or effects")}.`);
      }
    });
    sceneProps = [
      ...sceneProps.filter((p) => p.scope !== "scene"),
      ...next.map((d) => declToConditionProperty("scene", d)),
    ];
    lastInspectorSig = null; // the count isn't in the level signature - force the Scene row to re-render
    if (lastInspectorCtx) showInspector(lastInspectorCtx);
  }
}

/** A property declaration as the condition and effects editors take it: one conversion, because three
 *  hand-written copies had drifted and two left out `stages`, which withheld a quality's ordering
 *  operators and its stage picker until the next scene load. Main's `sceneProperties` says the same. */
function declToConditionProperty(scope: "patter" | "scene", d: PropertyDecl): ConditionProperty {
  return { scope, name: d.name, type: d.type, ...(d.values ? { enumValues: d.values } : {}), ...(d.stages ? { stages: d.stages } : {}), ...(d.purpose ? { purpose: d.purpose } : {}) };
}

/** The folder a project name will be saved as (mirrors the main process's patterFolderName, for preview). */
const patterFolderPreview = (name: string): string => `${fileSafeName(name) || "your-project"}.patter`;

/** The default Build output for a project name (mirrors the main process's sibling-`patter-dist/`
 *  default + ops `slug`), so the New-project field prefills the same path Project Settings would show.
 *  A SIBLING folder, never inside the `.patter` package. */
const buildDefaultFor = (name: string): string =>
  `../patter-dist/${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "_"}.patterc`;


/**
 * New Project: the shell's kit gallery (app-shell kit-gallery.ts), the same moment Storyletter's New
 * Project and New Box draw (storylet-studio/design/kit-gallery.md, section 7). The form this replaced
 * was a name, version control and a publish path under a heading; those are now the gallery's
 * details panel, beside the kit, so "what am I about to be given?" is answered before anything
 * is asked (from-storylets/new-project-says-nothing). The system folder picker still follows.
 */
/** The shipped examples as gallery items, for New Project's second shelf and the welcome's tiles. */
const EXAMPLE_KITS: KitGalleryItem<`example:${string}`>[] = EXAMPLES.map((x) => ({
  id: `example:${x.file}` as const, name: x.name, blurb: x.hint,
  ...(x.badge !== undefined ? { badge: x.badge } : {}), ...(x.tile !== undefined ? { tile: x.tile } : {}),
  ...(x.features !== undefined ? { features: [...x.features] } : {}),
}));

/** Help ▸ Open an Example and the gallery's second shelf: main copies it to a folder the writer picks. */
async function openExample(file: string): Promise<void> {
  await leaveProject();
  const r = await window.patter.openExample(file);
  if (r) await showProject(r);
}

function createDialog(initial?: string): void {
  const vcs = el("select", "insp-select");
  for (const [value, label] of VCS_OPTIONS) { // the one list Project Settings offers too
    const o = el("option", undefined, label);
    o.value = value;
    o.selected = value === "none";
    vcs.append(o);
  }
  const build = el("input", "field");
  build.type = "text";
  build.spellcheck = false;
  build.placeholder = "../patter-dist/your-project.patterc";
  const preview = el("code", undefined, "your-project.patter");
  const saved = el("p", "create-preview", "Saved as ");
  saved.append(preview);
  const details = el("div", "create-details");
  details.append(
    el("label", "kit-gallery-label", "Version control"), vcs,
    el("label", "kit-gallery-label", "Bundle path"), build,
    el("small", "identity-hint", ...bundlePathHint()),
    saved);
  // The publish path prefills (and tracks the name) until the author edits it themselves.
  let buildTouched = false;
  build.addEventListener("input", () => { buildTouched = true; });
  openKitGallery({
    title: "New project",
    what: "A project is one story's worth of scenes: what is said, who says it, and the bundle your game plays.",
    namePlaceholder: "The Tavern",
    nameLabel: "Project name",
    details,
    onNameInput: (name) => {
      preview.textContent = patterFolderPreview(name);
      if (!buildTouched) build.value = buildDefaultFor(name);
    },
    ...(initial !== undefined ? { initial } : {}),
    // The worked examples as the second shelf, as Storyletter's New Project has them: opening one and
    // making a project from a kit are the same act, your own copy in a folder you choose.
    sections: [
      { caption: "Start from a kit", note: "A starting point you own, fully editable the moment it lands.", action: "Choose location\u2026", items: PROJECT_KITS },
      { caption: "Learn from a finished project", note: "Each opens as your own copy, in a folder you choose.",
        action: "Open a copy\u2026", usesDetails: false, items: EXAMPLE_KITS },
    ],
    onPick: (kit, { name }) => {
      if (kit.startsWith("example:")) { void openExample(kit.slice("example:".length)); return; }
      if (name === undefined) return;
      const chosenVcs = vcs.value as VcsKind;
      const buildBundle = build.value.trim() || undefined;
      void (async () => {
        await leaveProject();
        const r = await window.patter.createDialog(name, chosenVcs, buildBundle); // pick a location, then scaffold <name>.patter
        if (r) await showProject(r);
      })();
    },
  });
}

// --- first run ---------------------------------------------------------------

// First run only: prompt when there's no identity yet (skippable; main fills a default name if blank).
function ensureIdentity(current: Identity | null): Promise<void> {
  return current ? Promise.resolve() : showIdentityDialog(null, "welcome");
}

// The identity ask is the shell's `askIdentity` (ui-review-2026-09, finding 7), in one of two modes:
// "welcome" (first run) or "edit" (File / app menu ▸ User Information, prefilled). On close we refresh the
// local author name used to stamp new comments. A skip on first run stores a blank name so the app does
// not ask again (main defaults it to the OS user name); a skip in edit mode changes nothing.
async function showIdentityDialog(current: Identity | null, mode: "welcome" | "edit"): Promise<void> {
  // Offer the VCS's name when we have nothing of our own. The badge in the corner of this same window
  // already says "Locked by bob@bob-ws", so the app has had a name in reach the whole time it was asking
  // for one, and an empty box is a poor first impression. Filled in as a VALUE rather than a placeholder
  // so that pressing Enter accepts it; it is still the person's to type over, and skipping still works.
  const suggested = current?.name ? null : await window.patter.suggestIdentity();
  const answer = await askIdentity({
    mode,
    appName: "Patterpad",
    neverAskAgainOnSkip: mode === "welcome", // a skipped first run stores a blank name so the app does not re-prompt
    ...(current ? { current } : {}),
    ...(suggested ? { suggested: { name: suggested } } : {}),
  });
  if (answer) await window.patter.setIdentity(answer);
  authorName = (await window.patter.getIdentity())?.name ?? authorName;
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

// "Go to definition" lands on the declaration's ROW, not only on the page it lives on
// (from-storylets/go-to-definition-lands-on-the-row): the shell's `revealRowWhenReady` opens its details,
// centres it and lights it, asking again over the next frames for a page that fills in on its own time.
// The search is scoped to the page the jump opened, never the whole document: the same name can be
// declared at @patter AND @scene, and the Properties page keeps its rows while it is hidden.

async function boot(): Promise<void> {
  // The family's tooltip controller (one delegated listener over the whole
  // document). The Writing View rule is ours and arrives as a predicate, because
  // the shell knows nothing about either app's modes: chrome rollovers would
  // break the point of a view that hides the chrome.
  initTooltips({ suppressed: () => document.body.classList.contains("writing-view") });
  // What a property pill can answer about itself (from-storylets/property-visibility): where it is
  // declared, and who else touches it. The editors own the pills; the destinations are all ours, so
  // they are registered here once. The ref carries no owner and needs none - a @scene pill can only
  // mean the scene it is being read in.
  setPropertyActions(({ scope, name }) => {
    const ref = scope === "patter" ? `@${name}` : `@${scope}.${name}`;
    const go: PropertyAction | null =
      scope === "patter" ? { label: "Go to definition", run: () => void showPropertiesDoc().then(() => revealRowWhenReady(propsDocHostEl, name)) }
      : scope === "scene" ? { label: "Go to definition", run: () => { const host = openSceneProps(); if (host) void revealRowWhenReady(host, name); } }
      : scope === "world" ? { label: "Go to definition", run: () => void openProjectSettings("world").then(() => { if (live.worldHost) void revealRowWhenReady(live.worldHost, name); }) }
      : null;
    return [...(go ? [go] : []), { label: "Find usages", run: () => openPropertyUsage(ref) }];
  });
  // No autosave timer: the controller runs its own clock off the edits themselves.
  window.addEventListener("beforeunload", flushRemember); // closing mid-debounce still records caret + scene
  // Leaving the window writes what is pending, as Storyletter does: whatever the author goes to next (the
  // play window, a diff tool, a game reading the files) sees current bytes. Closing and quitting are
  // covered by main, which holds the close until onFlushBeforeClose below has answered.
  window.addEventListener("blur", () => { if (project) void flushPending(); });
  const state = bootState; // read at the top of the module, before the frame was built
  docHidden = new Set(panes.docHidden ?? []); // restore the remembered documentation-class visibility
  lineStatusShown = panes.lineStatusShown ?? []; // restore the remembered Line-Status shown set (default none)
  // Review-session toggles ALWAYS start off - they are not remembered (main also resets them on disk at
  // launch, so the Review-menu checkmarks agree). Avoids a forgotten "show resolved" carrying over.
  showResolved = false;
  showResolvedSuggestions = false;
  showReviewFeedback = false;
  theme = state.theme; applyTheme(theme); // restore the remembered colour / font theme
  await ensureIdentity(state.identity);
  authorName = (await window.patter.getIdentity())?.name ?? state.identity?.name ?? ""; // stamp comments
  if (state.open) await showProject(state.open);
  else { showWelcome(state); if (state.openError) welcome.setError(state.openError); }
}

// (The welcome screen's actions are wired where it is mounted, at the top of the module.)
// The project name is the way back to the project overview (#3a) - a no-op on the welcome screen.
projectNameEl.addEventListener("click", () => { if (project && overviewEl.hidden) void showOverview(); });
projectNameEl.style.cursor = "pointer";

// Find (⌘/Ctrl-F) and Replace (⌘⌥F on macOS, Ctrl-H elsewhere) open the detached search window via the
// Edit-menu accelerators (relayed through onMenu below as "find" / "replace"), so they fire regardless of
// focus - no renderer keydown needed.
// Writing View toggles via the View-menu accelerator (Shift+Cmd/Ctrl+M), relayed through onMenu below - a
// native accelerator fires regardless of focus, so it works inside the editor too. Esc leaves it, as the
// docs and the exit pill say: but only an Esc nothing else used (a dialog, an anchored panel, the editor's
// own popups all take theirs first), so closing a popup never throws the writer out of the mode as well.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !writingView || e.defaultPrevented) return;
  if (document.querySelector("dialog[open], .shell-anchored:not([hidden]), .cue-ac:not([hidden]), .slash-menu:not([hidden]), .spell-menu:not([hidden])")) return;
  setWritingView(false);
});

// Native-menu commands (File / Run / Edit / View) relayed from the main process.
/** Cmd+K: every menu command by name (the live menu, so it can't drift from it), and quick open for the
 *  project's scenes and their blocks (the October 2026 review, behaviour change 2). */
function openPalette(): void {
  const items: PaletteItem[] = [];
  if (project) {
    const go = async (sceneId: string, nodeId?: string): Promise<void> => {
      await openSceneFromOverview(sceneId);
      if (nodeId) surface?.revealNode(nodeId);
    };
    items.push({ label: "Properties", detail: "Page", run: () => void showPropertiesDoc() });
    for (const sc of project.scenes) {
      items.push({ label: sc.name, detail: "Scene", run: () => void go(sc.id) });
      for (const b of sc.blocks) if (b.name) items.push({ label: b.name, detail: `Block in ${sc.name}`, run: () => void go(sc.id, b.id) });
    }
  }
  openCommandPalette({
    commands: () => window.patter.paletteCommands(),
    run: (id) => window.patter.paletteRun(id),
    items: () => items,
    placeholder: project ? "Type a command, or a scene or block to open" : "Type a command",
  });
}

/** What's New's links and tickbox, the same for the launch dialog and the Help item. */
const whatsNewOpts: Pick<WhatsNewOptions, "appName" | "changelog" | "onShow" | "releaseNotes" | "openExternal"> = {
  appName: "Patterpad",
  changelog,
  onShow: (show) => window.patter.setWhatsNewShow(show),
  releaseNotes: (version) => `https://github.com/patterkit/patter/releases/tag/v${version}`,
  openExternal: (url) => window.patter.openExternal(url),
};

window.patter.onMenu((cmd) => {
  if (cmd === "command-palette") openPalette();
  else if (cmd === "whats-new") void window.patter.whatsNewState().then((st) => openWhatsNew({ ...whatsNewOpts, version: st.version, show: st.show }));
  else if (cmd === "new") createDialog();
  else if (cmd === "new-scene") void newSceneNow();
  else if (cmd === "new-scene-kit") newScenePrompt();
  else if (cmd === "new-folder") void newFolderNow();
  else if (cmd === "delete-scene") void deleteScenePrompt();
  else if (cmd === "open") void openDialog();
  else if (cmd.startsWith("open-example:")) void openExample(cmd.slice("open-example:".length));
  else if (cmd === "open-patterpack") void openPatterpack();
  else if (cmd === "save") void save();
  else if (cmd === "save-as") void saveAs();
  else if (cmd === "export-patterpack") void exportPatterpack();
  else if (cmd === "merge-patterpack") void mergePatterpack();
  else if (cmd === "resolve-clashes") openClashes();
  else if (cmd === "share-scopes") void shareScopes();
  else if (cmd === "extensions") void window.patter.openExtensions();
  else if (cmd.startsWith("remove-extension:")) void removeExtension(cmd.slice("remove-extension:".length));
  else if (cmd.startsWith("update-extension:")) void updateExtension(cmd.slice("update-extension:".length));
  else if (cmd === "add-extension") void addExtension();
  else if (cmd.startsWith("add-extension:")) void addExtension(cmd.slice("add-extension:".length));
  else if (cmd === "find") openSearch();
  else if (cmd === "replace") openSearch("replace");
  else if (cmd === "review-suggestions") { if (project) void window.patter.openSearchWindow("suggestions"); }
  else if (cmd === "play") void play();
  else if (cmd === "play-from-start") void playFromStart();
  else if (cmd === "select-all") selectAllCommand();
  else if (cmd === "duplicate") surface?.duplicate();
  else if (cmd === "move-up") moveCommand(-1);
  else if (cmd === "move-down") moveCommand(1);
  else if (cmd === "cycle-qualifier") cycleQualifierCommand();
  else if (cmd === "show-in-storyletter") void showInStoryletter();
  else if (cmd === "undo") void undoCommand("undo");
  else if (cmd === "redo") void undoCommand("redo");
  else if (cmd === "toggle-nav") togglePane("nav");
  else if (cmd === "toggle-inspector") togglePane("inspector");
  else if (cmd === "reset-view") resetView();
  else if (cmd === "close-project") void closeProject();
  else if (cmd === "project-overview") { if (project) void showOverview(); }
  // Up a Level (Cmd+[): the family's hierarchy step. Here the levels are a scene (or the Properties
  // page) and the project overview above it; from the overview there is nowhere higher.
  else if (cmd === "up-a-level") { if (project && overviewEl.hidden) void showOverview(); }
  // File ▸ Open Recent ▸ Clear Recents: main forgets them; the welcome's list follows if it is showing.
  else if (cmd === "clear-recents") void window.patter.clearRecents().then((recents) => { if (!welcomeEl.hidden) setWelcomeRecents(recents); });
  else if (cmd === "nav-back") stepHistory("back");
  else if (cmd === "nav-forward") stepHistory("forward");
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
  else if (cmd === "find-by-field") openFieldBrowse();
  else if (cmd === "find-by-qualifier") openQualifierBrowse();
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
  else if (cmd === "export-editable") { if (project) void openEditableExport(editableContext()); }
  else if (cmd === "import-editable") { if (project) void openEditableReimport(editableContext()); }
  else if (cmd.startsWith("theme:colour:")) {
    const colour = cmd.slice("theme:colour:".length);
    if (isThemeChoice(colour)) setTheme({ colour });
  }
  else if (cmd.startsWith("theme:font:")) setTheme({ font: cmd.slice("theme:font:".length) as FontTheme });
  else if (cmd.startsWith("open-recent:")) void openPath(cmd.slice("open-recent:".length));
  // The family's About surface, never the stock OS panel. The shell draws it; the
  // wordmark, the words and the URLs are ours. Version rides in the cmd.
  // Links go out through `openExternal`, which main allow-lists (ABOUT_LINKS), so
  // a bad label/url pair here is inert rather than dangerous.
  else if (cmd.startsWith("about:")) void showAbout({
    appName: "Patterpad",
    version: cmd.slice("about:".length),
    blurb: "A writer-first editor for branching game dialogue.",
    credits: "Part of PatterKit. Open source under the MIT licence.\nMade by Ian Thomas.",
    wordmark: PATTERKIT_WORDMARK,
    links: [
      { label: "patterkit.dev", url: "https://patterkit.dev" },
      { label: "ian.wildwinter.net", url: "https://ian.wildwinter.net" },
    ],
    onOpenLink: (url) => { window.patter.openExternal(url); },
  });
});

// The play window drives the editor step-marker: the playhead (markLine, leaving a visited trail)
// and a reset that clears the trail on a fresh run. When play crosses into another scene, SWITCH the
// editor to it first so the marker stays visible. Marks arrive in a rapid burst (a Continue plays many
// beats), so serialize them on a promise chain - otherwise two marks for a new scene would both fire
// loadScene before currentSceneId updates, double-loading it. The live debug link rides the same path,
// and marks an option a game took by moving the playhead onto its prompt (debug-flows.ts markTarget).
let markChain: Promise<void> = Promise.resolve();
window.patter.onPlayMark((id, sceneId, optionId) => {
  markChain = markChain.then(async () => {
    if (sceneId) await loadScene(sceneId);
    const s = surface;
    s?.markLine(markTarget(id, optionId, (option) => s.promptOf(option)));
  }).catch(() => {}); // a failed scene load shouldn't wedge the chain
});
window.patter.onPlayReset(() => surface?.resetPlay());
// A hit was chosen in the detached search window: jump the editor to it (loadScene + centred reveal).
window.patter.onSearchNavigate((entry) => void jumpTo(entry));
// "Follow in the editor": the play window is running and the author asked the editor to keep up. Same
// reveal path as a search jump, deliberately - a followed beat is the same act as jumping to one. Main
// decides whether following is on and never focuses this window, so the run keeps the keyboard.
window.patter.onPlayFollow((sceneId, beatId) => void jumpTo({ id: beatId, kind: "beat", sceneId, location: [] }));
// Project-wide Replace (driven from the search window): main asks us to flush the open scene before it
// rewrites the shards, then to reload once it's done.
window.patter.onEditorFlush(() => void (async () => { await save(); window.patter.editorFlushed(); })());
// Closing the window or quitting: everything leaving a project writes, written before main lets go.
window.patter.onFlushBeforeClose(leaveProject);
// A flow running in main (between its file pickers) asks its questions in our chrome, not a system box.
window.patter.onPrompt(promptDialog);
// Every step main records in the project history, from this window or another (Replace, a suggestion
// decision in the search window), goes on the journal.
window.patter.onProjectStep((step) => noteStep(step));
window.patter.onUndoStep((id) => undoStepIfNewest(id)); // the search window's toast Undo
window.patter.onReplaceApplied(() => void (async () => {
  await reloadOpenScene(); // re-read the open scene with the replaced text (loadScene skips the open one)
  await refreshProblems();
  // The search window says what it replaced, with Undo, in its own window; this one only catches up.
})());
// Coverage window (#159): a clicked result row jumps the editor; the "Game scopes…" button opens settings.
window.patter.onCoverageNavigate((sceneId, beatId) => void (async () => {
  await loadScene(sceneId);
  surface?.revealNode(beatId);
})());
window.patter.onOpenWorldSettings(() => void openProjectSettings("world"));

// Auto-update guard: report the live dirty flag, and persist on demand before an install restart.
// `pending` is true while a write is in FLIGHT as well as while work is queued,
// which is what an updater asking "may I restart?" needs to know.
const unsavedAnywhere = (): boolean => saver.pending || leftWrites.size > 0 || [...keptScenes.values()].some((k) => k.unsaved);
window.patter.onUpdaterCheckDirty(unsavedAnywhere);
window.patter.onUpdaterSaveBeforeInstall(async () => { await save(); return { ok: !unsavedAnywhere() }; });
// Auto-update prompts wear the app's themed dialog chrome, never a stock OS box.
window.patter.onUpdaterPrompt((opts) => showUpdaterDialog({ ...opts, openExternal: (url) => window.patter.openExternal(url) }));
window.patter.onUpdaterDownloadProgress(feedUpdaterDownloadProgress);
// An update that downloaded on its own: a "Restart to update" chip in the bar and one remark, never a
// dialog over the work (the October 2026 review). It installs on quit if the chip is never clicked.
window.patter.onUpdaterReady((info) => { showUpdateReady(info, { host: shell.topbarTrail, restart: () => window.patter.updaterRestart() }); });
// The first launch after an update says what's new in it (main gives this answer once per launch).
void window.patter.whatsNewState().then((st) => whatsNewAfterUpdate(st, { ...whatsNewOpts, onClose: () => window.patter.whatsNewSeen() }));
// A publish path that reports through the ops layer turns the strip determinate (the shell flips the
// band to the bar on the first positive total); none does yet.
window.patter.onJobProgress((p) => { if (p.kind === "publish") jobView.update(p.done, p.total, p.elapsedMs); });

// A `.patter` document package opened from Finder while the app is running: render the delivered project.
window.patter.onOpenProject((result) => void showProject(result));

// VC state changes OUTSIDE the app (a teammate grabs a lock, a newer revision lands). Re-pull when the
// window regains focus, and poll on a slow timer so badges stay live even while focused (#145).
window.addEventListener("focus", () => void refreshVcStatus());
// Storyletter may have changed the paired project's cards while the window was away.
window.addEventListener("focus", () => void refreshPairedCards());
window.setInterval(() => void refreshVcStatus(), 30_000);

void boot();
