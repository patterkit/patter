// The native application menu - where top-level commands live, so Patterpad "works the way people
// expect" (New/Open/Save in File, the standard Edit menu, Play in Run). Menu items don't act
// directly: they relay a command string to the renderer (webContents.send -> preload onMenu), which
// runs the same handlers as the welcome buttons. The menu is rebuilt whenever recents change so
// File > Open Recent stays current.

import { app, Menu, type BrowserWindow, type MenuItemConstructorOptions } from "electron";
import { resolve, sep } from "node:path";
import { DEFAULT_DOCUMENTATION_CLASSES } from "@patterkit/model";
import { manualCheckForUpdates } from "./updater.js";
import type { PaneState, RecentProject, ThemePrefs } from "../shared/api.js";

const isMac = process.platform === "darwin";

const COLOURS: Array<[ThemePrefs["colour"], string]> = [["system", "Follow System"], ["paper", "Paper"], ["mist", "Mist"], ["slate", "Slate"], ["night", "Night"]];
const FONTS: Array<[ThemePrefs["font"], string]> = [["newsreader", "Newsreader"], ["literata", "Literata"], ["source", "Source Serif"], ["script", "Courier (script)"]];
const DOC_CLASS_LABEL: Record<string, string> = { everyone: "Everyone", vo: "Voice (VO)", loc: "Localisers" };

/** Spelling submenu data: on/off, the active dictionary, and every installed dictionary (Review ▸ Spelling
 *  mirrors the Dictionary settings tab). */
export interface SpellingMenu { hasProject: boolean; enabled: boolean; language: string; dictionaries: Array<{ id: string; label: string }> }

export function applyMenu(win: BrowserWindow, recents: RecentProject[], panes: PaneState, theme: ThemePrefs, lineStatuses: string[] = [], spelling?: SpellingMenu, voiced = false, debugActive = false, audioTracked = false): void {
  const send = (cmd: string): void => win.webContents.send("menu", cmd);
  const shownStatuses = panes.lineStatusShown ?? [];

  // Show WHERE each recent lives on disk. macOS renders `sublabel` as a dimmed second line and `toolTip`
  // on hover; native menus elsewhere render neither, so on those platforms we fold the path into the label
  // itself. Paths are abbreviated to `~` for the home dir to keep them short.
  const home = app.getPath("home");
  const tildePath = (p: string): string => {
    const abs = resolve(p);
    return abs === home || abs.startsWith(home + sep) ? `~${abs.slice(home.length)}` : abs;
  };
  const recentItems: MenuItemConstructorOptions[] = recents.length
    ? recents.map((r) => {
        const shown = tildePath(r.path);
        return {
          label: isMac ? r.name : `${r.name}  ·  ${shown}`,
          sublabel: shown,        // macOS: a dimmed second line under the name
          toolTip: r.path,        // macOS: the full (un-abbreviated) path on hover
          click: () => send(`open-recent:${r.path}`),
        };
      })
    : [{ label: "No Recent Projects", enabled: false }];

  // On macOS, replace the stock `role: "appMenu"` with an explicit one so "About Patterpad" opens our
  // THEMED about surface instead of the grey OS panel (design-language "coherent to the edges"); the rest
  // mirrors the standard app menu. The first menu always shows the bundle name regardless of label.
  const macAppMenu: MenuItemConstructorOptions = {
    label: "Patterpad",
    submenu: [
      { label: "About Patterpad", click: () => send(`about:${app.getVersion()}`) },
      { type: "separator" },
      { label: "User Information…", click: () => send("user-info") }, // name + optional email (signs edits/comments)
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
        { label: "New Project…", accelerator: "CmdOrCtrl+N", click: () => send("new") },
        { label: "Open Project…", accelerator: "CmdOrCtrl+O", click: () => send("open") },
        { label: "Open Recent", submenu: recentItems },
        { type: "separator" },
        { label: "Save", accelerator: "CmdOrCtrl+S", click: () => send("save") },
        { label: "Save As…", accelerator: "Shift+CmdOrCtrl+S", click: () => send("save-as") }, // duplicate the project folder
        { type: "separator" },
        // Scene-level actions: within the OPEN project (project-level New/Open live above).
        { label: "New Scene…", accelerator: "Shift+CmdOrCtrl+N", click: () => send("new-scene") },
        { label: "Delete Scene…", click: () => send("delete-scene") },
        { type: "separator" },
        { label: "Project Settings…", accelerator: "CmdOrCtrl+,", click: () => send("project-settings") },
        // User identity (name + optional email) lives in the macOS app menu; on other platforms it sits here.
        ...(isMac ? [] : [{ label: "User Information…", click: () => send("user-info") } as const]),
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
        { label: "Undo", accelerator: "CmdOrCtrl+Z", click: () => send("undo") },
        { label: "Redo", accelerator: "Shift+CmdOrCtrl+Z", click: () => send("redo") },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
        { type: "separator" },
        // Open the detached search window (#205) in the right mode. The accelerators ARE the shortcuts:
        // Find = Cmd/Ctrl+F; Replace = Cmd+Alt+F on macOS, Ctrl+H elsewhere (the platform conventions).
        { label: "Find…", accelerator: "CmdOrCtrl+F", click: () => send("find") },
        { label: "Replace…", accelerator: isMac ? "Cmd+Alt+F" : "Ctrl+H", click: () => send("replace") },
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
        { label: "Live Link", type: "checkbox", checked: debugActive, click: () => send("debug-link") },
      ],
    },
    {
      // Collaboration review: the feedback-walk mode (a bottom bar stepping through every active comment +
      // suggestion across the script, looping) plus the resolved-visibility toggles.
      label: "Review",
      submenu: [
        { label: "Review Feedback", type: "checkbox", checked: panes.reviewFeedback ?? false, accelerator: "CmdOrCtrl+Shift+R", click: () => send("toggle-review-feedback") },
        { label: "Next Feedback", accelerator: "F8", click: () => send("review-next") },
        { label: "Previous Feedback", accelerator: "Shift+F8", click: () => send("review-prev") },
        { type: "separator" },
        // Narrative coverage (#159): random playthroughs find never-reached / needs-input content.
        { label: "Coverage Test…", click: () => send("coverage-test") },
        { type: "separator" },
        // Browse every line at a writing status (#205) - the search palette in status mode.
        { label: "Find Lines by Writing Status…", accelerator: "CmdOrCtrl+Shift+L", click: () => send("find-by-status") },
        // Browse every dialogue line at a recording status (#206) - the search palette in recording mode.
        // Audio status tracking is voiced-only + opt-outable, so this is disabled when it's off (matches the inspector).
        { label: "Find Lines by Recording Status…", enabled: audioTracked, click: () => send("find-by-recording") },
        // Find where a property is used in conditions / effects / text - the search palette in property mode.
        { label: "Find Property Usage…", click: () => send("find-property") },
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
        { label: "Show Resolved Comments", type: "checkbox", checked: panes.commentsResolved ?? false, click: () => send("toggle-comments-resolved") },
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
        { label: "Publish Playable HTML…", click: () => send("playable-html") },
        { label: "Publish for Web…", click: () => send("publish-web") },
        { label: "Publish Readable Script…", click: () => send("export-script") },
        { type: "separator" },
        { label: "Publish Bundle", accelerator: "Shift+CmdOrCtrl+B", click: () => send("build-bundle") },
      ],
    },
    {
      // A custom View menu: the side-pane (slide/pin) toggles up top - checkbox items reflecting the
      // remembered state - then the standard view roles. Replaces role:viewMenu so both live in one place.
      label: "View",
      submenu: [
        { label: "Project Overview", click: () => send("project-overview") }, // the #3a landing (scene index + stats)
        { type: "separator" },
        { label: "Show Scenes", type: "checkbox", checked: panes.nav, accelerator: "CmdOrCtrl+1", click: () => send("toggle-nav") },
        { label: "Show Inspector", type: "checkbox", checked: panes.inspector, accelerator: "CmdOrCtrl+2", click: () => send("toggle-inspector") },
        { label: "Reset View", click: () => send("reset-view") }, // reset side-pane widths + visibility to defaults
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
          label: "Reading Palette",
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
        { role: "togglefullscreen" },
        { role: "reload" }, { role: "toggleDevTools" },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        { label: "Check for Updates…", click: () => void manualCheckForUpdates(win) },
        // macOS keeps About in the app menu (above); Windows/Linux get it here, the conventional home.
        ...(isMac ? [] : [{ type: "separator" } as MenuItemConstructorOptions, { label: "About Patterpad", click: () => send(`about:${app.getVersion()}`) } as MenuItemConstructorOptions]),
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
