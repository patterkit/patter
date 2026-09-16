// The session store (last project, recents, open-where-you-left-off, identity, theme, helper-window
// bounds) - now an ADAPTER over the shell's `createAppStore`.
//
// The shape below is Patterpad's own and is deliberately unchanged: the call sites in index.ts read
// `lastScene` / `theme` and call `recordOpen` / `recordScene`, and none of them should
// have to care that the bytes underneath are now the family's `app-settings.json`. Everything that is
// genuinely shared (recents and their cap, panes, identity, per-window bounds + pin, the atomic write,
// the tolerant read) is the shell's; everything below is the translation plus the three things that are
// this app's alone - the light/dark theme remap, the pinned-by-default helper windows, and the
// `lastScene` / `lastCaret` pair the renderer still speaks in.
//
// Takes the userData DIRECTORY, not a file: the shell owns the filename, and the one-time fold-in of
// the old `patterpad-session.json` needs to look beside it.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { createAppStore, resetWindows, windowSlice } from "@wildwinter/app-shell/app-store";
import type { AppSettings, PaneState as ShellPaneState, WindowSlice, WindowState } from "@wildwinter/app-shell/app-store";
import type { Identity, PaneState, RecentProject, ThemePrefs } from "../shared/api.js";

export interface SessionState {
  lastProject?: string;
  /** project path -> last scene id edited there. */
  lastScene: Record<string, string>;
  /** project path -> the node id the caret was on in `lastScene` (open-where-you-left-off, to the line).
   *  Always written together with `lastScene` so the two stay paired; absent = land at the top. */
  lastCaret: Record<string, string>;
  recents: RecentProject[];
  identity?: Identity;
  /** Remembered side-pane (slide/pin) state. */
  panes: PaneState;
  /** Remembered colour / font theme choice. */
  theme: ThemePrefs;
  /** "Follow in the editor" on the play window (default off). */
  playFollow: boolean;
}

/** The three helper windows, by the key each remembers its bounds and pin under. */
export type ToolWindowName = "play" | "search" | "coverage";
export const TOOL_WINDOW_NAMES: readonly ToolWindowName[] = ["play", "search", "coverage"];

/** Where the author was in one project. The shell keeps `places` opaque and keyed by project path;
 *  this is what Patterpad puts in the slot, and `read()` fans it back out into the parallel
 *  `lastScene` / `lastCaret` records the rest of the app still reads. */
interface Place {
  scene: string;
  caret?: string;
}

/** Patterpad's own slice of the settings file. The shell merges this field by field, so a key added
 *  in a later version arrives with its default rather than being absent for existing authors. */
interface AppSlice {
  theme: ThemePrefs;
  /** "Follow in the editor" (play-follow): each played beat is revealed in the editor as the run goes.
   *  A user preference rather than window geometry, so it lives in the app slice beside the theme.
   *  OFF by default: marking is the default behaviour and following is the author asking for it. */
  playFollow: boolean;
}

/** The old hand-rolled file, kept only for the one-time fold-in below. */
const LEGACY_FILE = "patterpad-session.json";
/** Its shape: today's session state plus the three window slots it kept as named fields. */
type LegacySession = Partial<SessionState> & { play?: WindowState; search?: WindowState; coverage?: WindowState };
const SETTINGS_FILE = "app-settings.json";

// First-run default: BOTH sides closed so the editor opens full-bleed (Patterpad.md §4 - "both sides
// start closed... the centre is the constant, the sides are guests"). Either is remembered once toggled,
// so a writer who likes the navigator up gets it back on every later launch.
const DEFAULT_PANES: PaneState = { nav: false, inspector: false };
// First-run look: follow the OS colour scheme, the Newsreader reading face (the surface default).
const DEFAULT_THEME: ThemePrefs = { colour: "system", font: "newsreader" };
/** Migrate an older session's colour choice to the current curated palettes: the raw light/dark switch
 *  (#173) light -> Paper, dark -> Night, and the retired warm "sepia" -> the cool "mist". Anything
 *  already a current palette (or "system") passes through unchanged.
 *
 *  Stays HERE rather than moving into the shell: the shell's `app` slice merges field by field and
 *  knows nothing about what any one app's values mean, let alone which of them were retired. */
function migrateTheme(t: ThemePrefs): ThemePrefs {
  const remap: Record<string, ThemePrefs["colour"]> = { light: "paper", dark: "night", sepia: "mist" };
  const colour = remap[t.colour as string] ?? t.colour;
  return colour === t.colour ? t : { ...t, colour };
}

export interface Store {
  read(): SessionState;
  recordOpen(path: string, name: string): void;
  recordScene(projectPath: string, sceneId: string, caretId?: string): void;
  setIdentity(identity: Identity): void;
  setPanes(panes: PaneState): void;
  setTheme(theme: ThemePrefs): void;
  setPlayFollow(on: boolean): void;
  /** One helper window's remembered bounds + pin, read through the shell's `windowSlice`: the three
   *  helper windows float on top by default (the slice's own default), and nothing here flattens the
   *  shell's record back into named fields any more (ui-review-2026-09, finding 19). */
  window(name: ToolWindowName): WindowSlice;
  /** Reset View's store half: forget every remembered rectangle and re-pin all three, so a window
   *  stranded off-screen comes back centred at its default size on the next open. */
  resetWindows(): void;
  forget(path: string): void;
  /** Forget WHICH project was open, keeping it in recents (Close Project). A quit after closing then
   *  boots to the welcome screen instead of silently reopening what the author just closed. */
  clearLastProject(): void;
}

/**
 * One-time fold-in of the pre-shell `patterpad-session.json`.
 *
 * Runs only when the shell's own file does not exist yet, and writes the TRANSLATED settings before
 * the store opens them, so `createAppStore` just reads a normal file of its own shape. The old file is
 * never written to and never deleted: it stays on disk as a free rollback.
 *
 * Deliberately not done by pointing the shell at the old filename. Its read is tolerant enough to
 * ingest that file, but its migrations cover the shell's own history, not Patterpad's keys, so
 * `lastScene`, `lastCaret`, `play`, `search`, `coverage` and `theme` would all be silently dropped on
 * the first write.
 */
function foldInLegacySession(dir: string): void {
  const settingsFile = join(dir, SETTINGS_FILE);
  if (existsSync(settingsFile)) return; // the shell's file is authoritative once it exists
  let old: LegacySession;
  try {
    old = JSON.parse(readFileSync(join(dir, LEGACY_FILE), "utf8")) as LegacySession;
  } catch {
    return; // no old file, or an unreadable one: a genuine first run, defaults all the way down
  }
  const places: Record<string, Place> = {};
  for (const [path, scene] of Object.entries(old.lastScene ?? {})) {
    const caret = old.lastCaret?.[path];
    places[path] = { scene, ...(caret ? { caret } : {}) };
  }
  const settings: AppSettings<Place, AppSlice> = {
    recents: (old.recents ?? []).map((r) => ({ path: r.path, ...(r.name ? { name: r.name } : {}) })),
    ...(old.lastProject !== undefined ? { lastProject: old.lastProject } : {}),
    places,
    panes: { ...DEFAULT_PANES, ...old.panes } as ShellPaneState,
    ...(old.identity ? { identity: old.identity } : {}),
    windows: {
      play: { ...old.play },
      search: { ...old.search },
      coverage: { ...old.coverage },
    },
    app: { theme: migrateTheme({ ...DEFAULT_THEME, ...old.theme }), playFollow: false },
  };
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  } catch {
    // A read-only home, a full disk: carry on and let the shell start from defaults, exactly as it
    // would on a first run. Settings are not worth failing to start over.
  }
}

/** @param dir the app's userData directory (NOT a file path: the shell names the file). */
export function createStore(dir: string): Store {
  foldInLegacySession(dir);
  const app = createAppStore<Place, AppSlice>({
    dir,
    fileName: SETTINGS_FILE,
    defaults: { theme: { ...DEFAULT_THEME }, playFollow: false },
    panes: { ...DEFAULT_PANES },
  });

  const read = (): SessionState => {
    const s = app.get();
    // `places` is one record of {scene, caret}; the app has always spoken in two parallel records and
    // several readers still index them directly, so fan it back out here.
    const lastScene: Record<string, string> = {};
    const lastCaret: Record<string, string> = {};
    for (const [path, place] of Object.entries(s.places)) {
      if (!place) continue;
      lastScene[path] = place.scene;
      if (place.caret !== undefined) lastCaret[path] = place.caret;
    }
    return {
      ...(s.lastProject !== undefined ? { lastProject: s.lastProject } : {}),
      lastScene,
      lastCaret,
      // The shell's name is optional (the path is the identity); Patterpad's menu always renders one,
      // and every write below passes it, so the fallback is for entries written by an older shell.
      recents: s.recents.map((r) => ({ path: r.path, name: r.name ?? basename(r.path) })),
      ...(s.identity ? { identity: s.identity } : {}),
      // Patterpad's PaneState is a SUPERSET of the shell's (docHidden, the review-session toggles,
      // lineStatusShown). The shell merges and serialises whatever object it is handed and never reads
      // into it, so the extra fields round-trip untouched; only the static type is narrower.
      panes: { ...DEFAULT_PANES, ...(s.panes as PaneState) },
      theme: migrateTheme({ ...DEFAULT_THEME, ...s.app.theme }),
      playFollow: s.app.playFollow ?? false,
    };
  };

  return {
    read,
    recordOpen(path, name) {
      app.touchProject(path, name);
    },
    recordScene(projectPath, sceneId, caretId) {
      // The shell keys a place off whatever project is currently open; this signature names one. They
      // agree at every call site today (`scene:remember` fires for the project on screen), but the
      // path arrives from the RENDERER, so check rather than trust: recording against the wrong key
      // would land one project's caret in another's slot, and be near-impossible to spot afterwards.
      if (app.get().lastProject !== projectPath) {
        console.warn(`[store] ignoring a remembered place for ${projectPath}, which is not the open project`);
        return;
      }
      // scene + caret travel together so the remembered caret always belongs to the remembered scene;
      // no caret (top of scene) omits the field rather than keeping a stale one.
      app.setPlace({ scene: sceneId, ...(caretId ? { caret: caretId } : {}) });
    },
    setIdentity(identity) {
      app.setIdentity(identity);
    },
    setPanes(panes) {
      app.setPanes(panes as ShellPaneState);
    },
    setTheme(theme) {
      app.patchApp({ theme });
    },
    setPlayFollow(on) {
      app.patchApp({ playFollow: on });
    },
    window(name) {
      return windowSlice(app, name);
    },
    resetWindows() {
      resetWindows(app, [...TOOL_WINDOW_NAMES]);
    },
    clearLastProject() {
      app.clearLastProject();
    },
    forget(path) {
      app.forgetProject(path);
    },
  };
}
