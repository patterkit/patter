// A tiny JSON session store under the app's userData dir: the last project, recent projects, the
// last scene per project (open-where-you-left-off), and the author identity (first run). Pure over a
// given file path so it's unit-testable without Electron. Reads are tolerant - a missing / corrupt
// file is treated as empty, never a crash.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
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
  /** Remembered play-window bounds + always-on-top pin (default pinned). */
  play: PlayWindowState;
  /** Remembered search-tool-window bounds + always-on-top pin (default pinned). */
  search: PlayWindowState;
  /** Remembered coverage-window bounds (a normal framed window; pin unused). */
  coverage: PlayWindowState;
}

export interface PlayWindowState {
  bounds?: { x?: number; y?: number; width: number; height: number };
  pinned: boolean;
}

const RECENTS_MAX = 8;
// First-run default: BOTH sides closed so the editor opens full-bleed (Patterpad.md §4 - "both sides
// start closed... the centre is the constant, the sides are guests"). Either is remembered once toggled,
// so a writer who likes the navigator up gets it back on every later launch.
const DEFAULT_PANES: PaneState = { nav: false, inspector: false };
// First-run look: follow the OS colour scheme, the Newsreader reading face (the surface default).
const DEFAULT_THEME: ThemePrefs = { colour: "system", font: "newsreader" };
/** Migrate an older session's colour choice to the current curated palettes: the raw light/dark switch
 *  (#173) light -> Paper, dark -> Night, and the retired warm "sepia" -> the cool "mist". Anything
 *  already a current palette (or "system") passes through unchanged. */
function migrateTheme(t: ThemePrefs): ThemePrefs {
  const remap: Record<string, ThemePrefs["colour"]> = { light: "paper", dark: "night", sepia: "mist" };
  const colour = remap[t.colour as string] ?? t.colour;
  return colour === t.colour ? t : { ...t, colour };
}
// The play window floats on top by default (the author reads it beside the script as they edit).
const DEFAULT_PLAY: PlayWindowState = { pinned: true };
// The search tool window also floats on top by default (it's a helper you read against the script).
const DEFAULT_SEARCH: PlayWindowState = { pinned: true };
const DEFAULT_COVERAGE: PlayWindowState = { pinned: true };
const empty = (): SessionState => ({ lastScene: {}, lastCaret: {}, recents: [], panes: { ...DEFAULT_PANES }, theme: { ...DEFAULT_THEME }, play: { ...DEFAULT_PLAY }, search: { ...DEFAULT_SEARCH }, coverage: { ...DEFAULT_COVERAGE } });

export interface Store {
  read(): SessionState;
  recordOpen(path: string, name: string): void;
  recordScene(projectPath: string, sceneId: string, caretId?: string): void;
  setIdentity(identity: Identity): void;
  setPanes(panes: PaneState): void;
  setTheme(theme: ThemePrefs): void;
  setPlay(play: PlayWindowState): void;
  setSearch(search: PlayWindowState): void;
  setCoverage(coverage: PlayWindowState): void;
  forget(path: string): void;
}

export function createStore(filePath: string, now: () => number = Date.now): Store {
  // We are the SOLE writer of this prefs file, so the parsed state can be cached in the closure (a single
  // operation calls read() several times) and kept in sync on write - no re-parse of the JSON each access,
  // and the read-modify-write of the mutators sees a consistent value.
  let cached: SessionState | null = null;
  let lastWritten: string | null = null; // the bytes currently on disk, so write() can skip a no-op
  const read = (): SessionState => {
    if (cached) return cached;
    try {
      const raw = readFileSync(filePath, "utf8");
      lastWritten = raw;
      const parsed = JSON.parse(raw) as Partial<SessionState>;
      cached = {
        ...empty(), ...parsed,
        lastScene: parsed.lastScene ?? {}, lastCaret: parsed.lastCaret ?? {}, recents: parsed.recents ?? [],
        panes: { ...DEFAULT_PANES, ...parsed.panes },
        theme: migrateTheme({ ...DEFAULT_THEME, ...parsed.theme }),
        play: { ...DEFAULT_PLAY, ...parsed.play },
        search: { ...DEFAULT_SEARCH, ...parsed.search },
        coverage: { ...DEFAULT_COVERAGE, ...parsed.coverage },
      };
    } catch {
      cached = empty();
    }
    return cached;
  };
  const write = (next: SessionState): void => {
    const body = `${JSON.stringify(next, null, 2)}\n`;
    cached = next; // keep the cache in step with disk (we are the only writer)
    if (body === lastWritten) return; // no-op write (e.g. boot forcing already-false pane flags) - skip the disk hit
    lastWritten = body;
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, body, "utf8");
  };
  return {
    read,
    recordOpen(path, name) {
      const cur = read();
      const recents = [{ path, name, openedAt: now() }, ...cur.recents.filter((r) => r.path !== path)].slice(0, RECENTS_MAX);
      write({ ...cur, lastProject: path, recents });
    },
    recordScene(projectPath, sceneId, caretId) {
      const cur = read();
      // lastScene + lastCaret are written together so the remembered caret always belongs to the
      // remembered scene; no caret (top of scene) deletes any stale entry rather than keeping it.
      const lastCaret = { ...cur.lastCaret };
      if (caretId) lastCaret[projectPath] = caretId; else delete lastCaret[projectPath];
      write({ ...cur, lastScene: { ...cur.lastScene, [projectPath]: sceneId }, lastCaret });
    },
    setIdentity(identity) {
      write({ ...read(), identity });
    },
    setPanes(panes) {
      write({ ...read(), panes });
    },
    setTheme(theme) {
      write({ ...read(), theme });
    },
    setPlay(play) {
      write({ ...read(), play });
    },
    setSearch(search) {
      write({ ...read(), search });
    },
    setCoverage(coverage) {
      write({ ...read(), coverage });
    },
    forget(path) {
      const cur = read();
      write({
        ...cur,
        lastProject: cur.lastProject === path ? undefined : cur.lastProject,
        recents: cur.recents.filter((r) => r.path !== path),
      });
    },
  };
}
