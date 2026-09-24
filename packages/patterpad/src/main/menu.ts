// The native application menu - where top-level commands live, so Patterpad "works the way people
// expect" (New/Open/Save in File, the standard Edit menu, Play in Run). Menu items don't act
// directly: they relay a command string to the renderer (webContents.send -> preload onMenu), which
// runs the same handlers as the welcome buttons. The menu is rebuilt whenever recents change so
// File > Open Recent stays current.

import { app, shell, Menu, BrowserWindow, type MenuItemConstructorOptions } from "electron";
import { DEFAULT_DOCUMENTATION_CLASSES } from "@patterkit/model";
// The suite's menu spine. Every LABEL and ACCELERATOR the family shares comes from the shell so both
// apps spell them the same; the click handlers stay Patterpad's, because the mechanism behind each is
// per app (ProseMirror history for Undo here, file-byte replay in Storyletter). What is hand-typed
// below is only what is this app's alone (Patterpack, scenes, spelling, notes, fonts).
import { EDIT_MENU, GO_MENU, HELP_MENU, APP_MENU, FILE_MENU, PLAY_MENU, PANE_MENU, REVIEW_MENU, PUBLISH_MENU, VIEW_MENU, namedMenuItems, recentsSubmenu } from "@wildwinter/app-shell/menu";
import type { NamedMenuItem } from "@wildwinter/app-shell/menu";

// The family-standard named items (About / Documentation), so this app spells them the way
// every app in the suite does. The URLs are Patterpad's; the labels are not.
const NAMED = namedMenuItems({
  appName: "Patterpad",
  docsUrl: "https://patterkit.dev/patterpad/overview/",
  suiteDocsUrl: "https://patterkit.dev/",
});
import { manualCheckForUpdates } from "@wildwinter/app-shell/updater";
import type { PaneState, RecentProject, ThemePrefs } from "../shared/api.js";

const isMac = process.platform === "darwin";

const COLOURS: Array<[ThemePrefs["colour"], string]> = [["system", "Follow System"], ["paper", "Paper"], ["mist", "Mist"], ["slate", "Slate"], ["night", "Night"]];
const FONTS: Array<[ThemePrefs["font"], string]> = [["newsreader", "Newsreader"], ["literata", "Literata"], ["source", "Source Serif"], ["script", "Courier (script)"]];
const DOC_CLASS_LABEL: Record<string, string> = { everyone: "Everyone", vo: "Voice (VO)", loc: "Localisers" };

/** A named documentation item, rendered disabled rather than dead when the app supplied no URL: the
 *  shell's `ready` flag carries that, so no non-null assertion on `url` is needed here. */
const linkItem = (item: NamedMenuItem): MenuItemConstructorOptions => ({
  label: item.label, enabled: item.ready,
  click: () => { if (item.url) void shell.openExternal(item.url); },
});

/** Spelling submenu data: on/off, the active dictionary, and every installed dictionary (Review ▸ Spelling
 *  mirrors the Dictionary settings tab). */
export interface SpellingMenu { hasProject: boolean; enabled: boolean; language: string; dictionaries: Array<{ id: string; label: string }> }

export function applyMenu(win: BrowserWindow, recents: RecentProject[], panes: PaneState, theme: ThemePrefs, lineStatuses: string[] = [], spelling?: SpellingMenu, voiced = false, debugActive = false, audioTracked = false, autoRebuild = false): void {
  const send = (cmd: string): void => win.webContents.send("menu", cmd);
  const shownStatuses = panes.lineStatusShown ?? [];

  // The Open Recent submenu is the shell's: it shows WHERE each recent lives (a dimmed second line on
  // macOS, folded into the label elsewhere), says "No Recent Projects" when empty, and offers Clear
  // Recents after a separator. The renderer forgets them through the store and refreshes its welcome.
  const recentItems: MenuItemConstructorOptions[] = recentsSubmenu(recents, {
    onOpen: (path) => send(`open-recent:${path}`),
    onClear: () => send("clear-recents"),
    home: app.getPath("home"),
  });

  // On macOS, replace the stock `role: "appMenu"` with an explicit one so "About Patterpad" opens our
  // THEMED about surface instead of the grey OS panel (design-language "coherent to the edges"); the rest
  // mirrors the standard app menu. The first menu always shows the bundle name regardless of label.
  const macAppMenu: MenuItemConstructorOptions = {
    label: "Patterpad",
    submenu: [
      { ...NAMED.about, click: () => send(`about:${app.getVersion()}`) },
      { type: "separator" },
      { ...APP_MENU.userInfo, click: () => send("user-info") }, // name + optional email (signs edits/comments)
      { type: "separator" },
      { role: "services" },
      { type: "separator" },
      { role: "hide" }, { role: "hideOthers" }, { role: "unhide" },
      { type: "separator" },
      { role: "quit" },
    ],
  };

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [macAppMenu] : []),
    {
      label: "File",
      submenu: [
        { ...FILE_MENU.newProject, click: () => send("new") },
        { ...FILE_MENU.openProject, click: () => send("open") },
        // A `.patterpack` is a single FILE (not a `.patter` folder), so it needs its own file picker: on
        // Windows / Linux the Open Project dialog is a directory selector that would grey the file out.
        { label: "Open Patterpack…", click: () => send("open-patterpack") },
        { ...FILE_MENU.openRecent, submenu: recentItems },
        // The way back to the welcome screen: without it, opening a project is a one-way door and the
        // recents list is unreachable. No accelerator - it is not a key you tap. Close PROJECT, not
        // Close Window: the window stays, showing the welcome.
        { ...FILE_MENU.closeProject, enabled: spelling?.hasProject ?? false, click: () => send("close-project") },
        { type: "separator" },
        { ...FILE_MENU.save, click: () => send("save") },
        { ...FILE_MENU.saveAs, click: () => send("save-as") }, // duplicate the project folder
        { label: "Export as Patterpack…", click: () => send("export-patterpack") }, // bundle the project into one sendable file
        // The return leg of the line above, and a THIRD act rather than a mode of Open: export writes a
        // file, Open Patterpack replaces the project with a new one, this edits the open project in place.
        { label: "Merge Returned Patterpack…", click: () => send("merge-patterpack") },
        { type: "separator" },
        // Scene-level actions: within the OPEN project (project-level New/Open live above).
        { label: "New Scene…", accelerator: "Shift+CmdOrCtrl+N", click: () => send("new-scene") },
        { label: "Delete Scene…", click: () => send("delete-scene") },
        { type: "separator" },
        { ...FILE_MENU.projectSettings, click: () => send("project-settings") },
        // Make the game's shared scopes folder, so the game's other editing tools and this project check
        // each other's names (patterkit/design/shared-scopes.md). Needs an open project.
        { label: "Share Scopes with Other Tools…", enabled: spelling?.hasProject ?? false, click: () => send("share-scopes") },
        // User identity (name + optional email) lives in the macOS app menu; on other platforms it sits here.
        ...(isMac ? [] : [{ ...APP_MENU.userInfo, click: () => send("user-info") }]),
        // macOS: no File ▸ Close Window - the App menu's Quit (and the window's close button) already cover
        // it. Other platforms have no app menu, so the quit item lives here at the foot of File: labelled
        // "Exit" on Windows (its convention) and "Quit" on Linux.
        ...(isMac ? [] : [
          { type: "separator" } as const,
          { role: "quit" as const, label: process.platform === "win32" ? "Exit" : "Quit" },
        ]),
      ],
    },
    {
      label: "Edit",
      submenu: [
        // Undo / redo route to the surface's ProseMirror history (not the native role, which would
        // run a DOM undo the editor doesn't track).
        { ...EDIT_MENU.undo, click: () => send("undo") },
        { ...EDIT_MENU.redo, click: () => send("redo") },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        // NOT the native role: it selects the whole DOM, which in the editor is the whole scene
        // (and scrolls to the end of it). The main window scopes it to the field the caret is in;
        // any other window (the detached search / coverage tools) gets exactly the native behaviour,
        // since `send` only reaches the main window.
        {
          label: "Select All",
          accelerator: "CmdOrCtrl+A",
          click: () => {
            const focused = BrowserWindow.getFocusedWindow();
            if (focused && focused !== win) { focused.webContents.selectAll(); return; }
            send("select-all");
          },
        },
        { type: "separator" },
        // Duplicate the selected block / group / snippet (or the one holding the caret) with everything
        // inside it - the copy takes fresh ids throughout, so it never aliases the original.
        { ...EDIT_MENU.duplicate, click: () => send("duplicate") },
        { type: "separator" },
        // Open the detached search window (#205) in the right mode. The accelerators ARE the shortcuts:
        // Find = Cmd/Ctrl+F; Replace = Cmd+Alt+F on macOS, Ctrl+H elsewhere (the platform conventions).
        { ...EDIT_MENU.find, click: () => send("find") },
        { label: EDIT_MENU.replace.label, accelerator: isMac ? EDIT_MENU.replace.acceleratorMac : EDIT_MENU.replace.acceleratorOther, click: () => send("replace") },
      ],
    },
    {
      label: "Play",
      submenu: [
        { label: "Play Scene", accelerator: "CmdOrCtrl+P", click: () => send("play") },
        { label: "Play from Start", accelerator: "CmdOrCtrl+Shift+P", click: () => send("play-from-start") },
        { type: "separator" },
        // Checked while the link is active (listening / connected); toggles it (the bottom-right connect icon
        // mirrors the same state). Follows a running game's cursor (#181).
        // "Live Link" = live bundle refresh INTO the game + the debugger-style cursor follow OUT of it.
        { ...PLAY_MENU.liveLink, type: "checkbox", checked: debugActive, click: () => send("debug-link") },
      ],
    },
    {
      // Collaboration review: the feedback-walk mode (a bottom bar stepping through every active comment +
      // suggestion across the script, looping) plus the resolved-visibility toggles.
      label: "Review",
      submenu: [
        { ...REVIEW_MENU.reviewFeedback, type: "checkbox", checked: panes.reviewFeedback ?? false, click: () => send("toggle-review-feedback") },
        { ...REVIEW_MENU.nextFeedback, click: () => send("review-next") },
        { ...REVIEW_MENU.previousFeedback, click: () => send("review-prev") },
        { type: "separator" },
        // Narrative coverage (#159): random playthroughs find never-reached / needs-input content.
        { ...REVIEW_MENU.coverageTest, click: () => send("coverage-test") },
        { type: "separator" },
        // Browse every line at a writing status (#205) - the search palette in status mode.
        { label: "Find Lines by Writing Status…", accelerator: "CmdOrCtrl+Shift+L", click: () => send("find-by-status") },
        // Browse every dialogue line at a recording status (#206) - the search palette in recording mode.
        // Audio status tracking is voiced-only + opt-outable, so this is disabled when it's off (matches the inspector).
        { label: "Find Lines by Recording Status…", enabled: audioTracked, click: () => send("find-by-recording") },
        // Find where a property is used in conditions / effects / text - the search palette in property mode.
        { ...REVIEW_MENU.findPropertyUsage, click: () => send("find-property") },
        // Browse every node carrying an author tag (#215) - the search palette in tag mode.
        { label: "Find by Tag…", click: () => send("find-by-tag") },
        {
          // Which writing-status rungs show their per-beat gutter pill. Per-rung check/uncheck, plus
          // Show All / Show None; remembered in panes.lineStatusShown (default none). Empty when no
          // project / no ladder is open - just the All / None actions.
          label: "Line Status",
          submenu: [
            { label: "Show All", enabled: lineStatuses.length > 0, click: () => send("line-status:all") },
            { label: "Show None", click: () => send("line-status:none") },
            ...(lineStatuses.length ? [{ type: "separator" as const }] : []),
            ...lineStatuses.map((name) => ({
              label: name, type: "checkbox" as const, checked: shownStatuses.includes(name),
              click: () => send(`line-status:toggle:${name}`),
            })),
          ],
        },
        { type: "separator" },
        {
          // Spell-check (#177): another home for the Dictionary setting that lives in Project Settings -
          // an on/off toggle plus the installed dictionaries (the active one ticked). Disabled with no project.
          label: "Spelling",
          submenu: [
            { label: "Check Spelling", type: "checkbox", checked: spelling?.enabled ?? true, enabled: spelling?.hasProject ?? false, click: () => send("spelling:toggle") },
            ...((spelling?.dictionaries.length)
              ? [{ type: "separator" as const }, ...spelling.dictionaries.map((d) => ({
                  label: d.label, type: "radio" as const, checked: spelling.language === d.id,
                  enabled: spelling.hasProject, click: () => send(`spelling:dict:${d.id}`),
                }))]
              : []),
          ],
        },
        { type: "separator" },
        // Reveal archived (resolved) comment threads in the editor (#148); remembered in panes.commentsResolved.
        { ...REVIEW_MENU.showResolvedComments, type: "checkbox", checked: panes.commentsResolved ?? false, click: () => send("toggle-comments-resolved") },
        // Reveal archived (accepted/rejected) rewrite proposals; remembered in panes.suggestionsResolved.
        { label: "Show Resolved Suggestions", type: "checkbox", checked: panes.suggestionsResolved ?? false, click: () => send("toggle-suggestions-resolved") },
      ],
    },
    {
      // Production: the producer-facing readouts + exports (moved out of File). Read-only views + file
      // exports of the project's content - distinct from Build, which compiles the runtime bundle.
      label: "Production",
      submenu: [
        { label: "Production Information…", click: () => send("production-report") },
        { type: "separator" },
        { label: "Export Production Info…", click: () => send("export-production-info") },
        { label: "Export Voice Script…", enabled: voiced, click: () => send("voice-script") }, // VO script only for a voiced project (#206)
        { label: "Update Audio Manifest…", enabled: voiced, click: () => send("audio-manifest") }, // #206: rewrite patteraudio.json from the audio folders
        { label: "Export / Import Localisation…", click: () => send("localisation") },
      ],
    },
    {
      // Build: compile the project to its runtime `.patterc` bundle, written to the output path set in
      // Project Settings ▸ Build (export.bundle). Shift+Cmd/Ctrl+B - plain Cmd-B is the editor's bold.
      // Everything that turns the project into something you hand to others - "Publish", not
      // "Export"/"Build", friendlier to the writers most of these exist for. Writer outputs first
      // (a page for players, a folder you can customise + host, a script for readers), then the
      // game-facing compiled bundle.
      label: "Publish",
      submenu: [
        { ...PUBLISH_MENU.playableHtml, click: () => send("playable-html") },
        { label: "Publish for Web…", click: () => send("publish-web") },
        { label: "Publish Readable Script…", click: () => send("export-script") },
        { type: "separator" },
        { ...PUBLISH_MENU.bundle, click: () => send("build-bundle") },
        // Auto Rebuild: recompile the bundle after edits (debounced + deduped). Mirrors the same project
        // setting as the Project Settings ▸ General toggle.
        { ...PUBLISH_MENU.autoRebuild, type: "checkbox", checked: autoRebuild, click: () => send("toggle-auto-rebuild") },
      ],
    },
    {
      // A custom View menu: the side-pane (slide/pin) toggles up top - checkbox items reflecting the
      // remembered state - then the standard view roles. Replaces role:viewMenu so both live in one place.
      label: "View",
      submenu: [
        { ...VIEW_MENU.projectOverview, click: () => send("project-overview") }, // the #3a landing (scene index + stats)
        // Up a Level: the family's hierarchy step (Cmd+[), which here is a scene (or the Properties page)
        // up to the project overview. History (Back / Forward) is the other axis, below.
        { ...VIEW_MENU.upALevel, click: () => send("up-a-level") },
        { type: "separator" },
        // Navigation HISTORY, the other axis from the navigator's hierarchy (from-storylets/nav-history).
        // Always enabled: the arrows in the topbar carry the greyed state, and a step with nowhere to go
        // is a quiet no-op. The accelerators split by platform - the browsers' Cmd+[ is Up a Level in
        // this family, so the Mac takes Xcode's pair instead.
        { label: GO_MENU.back.label, accelerator: process.platform === "darwin" ? GO_MENU.back.acceleratorMac : GO_MENU.back.acceleratorOther, click: () => send("nav-back") },
        { label: GO_MENU.forward.label, accelerator: process.platform === "darwin" ? GO_MENU.forward.acceleratorMac : GO_MENU.forward.acceleratorOther, click: () => send("nav-forward") },
        { type: "separator" },
        // The spine's pane items. The navigator's LABEL is this app's on purpose: its left pane lists scenes
        // and the bar's toggle says "Show scenes" too, so the menu keeps that word over the spine's "Navigator".
        { ...PANE_MENU.showNav, label: "Show Scenes", type: "checkbox", checked: panes.nav, click: () => send("toggle-nav") },
        { ...PANE_MENU.showInspector, type: "checkbox", checked: panes.inspector, click: () => send("toggle-inspector") },
        { ...PANE_MENU.resetView, click: () => send("reset-view") }, // reset side-pane widths + visibility to defaults
        // Full-bleed: hide ALL chrome (panes, bars, topbar, review gutters/tints). A REAL accelerator
        // (handled natively, before the web content) so it toggles reliably even with the ProseMirror
        // editor focused - unlike a renderer keydown, which the editor can swallow. Shift+Cmd/Ctrl+M
        // to steer clear of the macOS Cmd-M (Minimize) default. Ephemeral - no checkbox state to sync.
        { label: "Writing View", accelerator: "Shift+CmdOrCtrl+M", click: () => send("toggle-writing-view") },
        { type: "separator" },
        // (Line Status moved to the Review menu - a per-rung show/hide submenu.)
        {
          // Which documentation-note classes the editor surfaces (spec §18). "everyone" is always shown
          // (disabled); the rest default on and can be hidden. The set is remembered (panes.docHidden).
          label: "Notes",
          submenu: DEFAULT_DOCUMENTATION_CLASSES.map((c) => ({
            label: DOC_CLASS_LABEL[c.name] ?? c.name,
            type: "checkbox" as const,
            checked: c.name === "everyone" || !(panes.docHidden ?? []).includes(c.name),
            enabled: c.name !== "everyone",
            click: () => send(`toggle-doc:${c.name}`),
          })),
        },
        { type: "separator" },
        {
          ...VIEW_MENU.colourTheme,
          submenu: COLOURS.map(([v, label]) => ({
            label, type: "radio" as const, checked: theme.colour === v, click: () => send(`theme:colour:${v}`),
          })),
        },
        {
          label: "Font Theme",
          submenu: FONTS.map(([v, label]) => ({
            label, type: "radio" as const, checked: theme.font === v, click: () => send(`theme:font:${v}`),
          })),
        },
        { type: "separator" },
        { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" },
        { type: "separator" },
        // macOS appends its OWN "Enter Full Screen" item to the View menu of every full-screen-capable
        // window, so declaring the role here too listed it TWICE. Let the system own it there (it carries
        // the standard Ctrl-Cmd-F); Windows / Linux get no such item, so they still need ours.
        ...(isMac ? [] : [{ role: "togglefullscreen" } as const]),
        { role: "reload" }, { role: "toggleDevTools" },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        // The documentation site: the writers' guide first (the audience in this app), then the site home.
        linkItem(NAMED.docs),
        linkItem(NAMED.suiteDocs),
        { type: "separator" },
        { ...HELP_MENU.checkForUpdates, click: () => void manualCheckForUpdates(win) },
        // macOS keeps About in the app menu (above); Windows/Linux get it here, the conventional home.
        ...(isMac ? [] : [{ type: "separator" } as MenuItemConstructorOptions, { ...NAMED.about, click: () => send(`about:${app.getVersion()}`) } as MenuItemConstructorOptions]),
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
