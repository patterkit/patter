// The narrow contract across the preload bridge: the only surface the renderer (untrusted UI) has
// onto the Node main process (files, VCS, the @patterkit/ops core). Kept tiny on purpose - every
// entry is an explicit, auditable operation, never raw fs / shell access.

import type { GameDataFields, PropertyDecl, CastMember, WritingStatusDecl, RecordingStatusDecl, EstimatingConfig, DocLine, VcsKind, Comment, CommentMessage, Suggestion, HostScopeRegistry, CoverageDriver } from "@patterkit/model";

export type { VcsKind } from "@patterkit/model";

export type { DocLine } from "@patterkit/model";

export type { Comment, CommentMessage, Suggestion } from "@patterkit/model";

/** One active piece of feedback for the Review Feedback walk: an unresolved comment thread or an open
 *  rewrite proposal, with where it lives (scene + anchored beat) and a one-line preview. */
export interface ReviewItem {
  sceneId: string;
  sceneName: string;
  kind: "comment" | "suggestion";
  /** The beat / node the feedback is anchored to. */
  anchor: string;
  /** The comment thread id or suggestion id (to open the right popover on navigate). */
  refId: string;
  author: string;
  /** The first comment message, or the proposed rewrite text. */
  text: string;
  /** True when this item is resolved / archived (only present when the matching "Show Resolved" toggle
   *  pulled it into the walk), so the bar can mark it. */
  resolved?: boolean;
}

/** Which archived feedback the Review Feedback walk should include, mirroring the "Show Resolved" View
 *  toggles. Both false = active only (the default). */
export interface ReviewScope {
  resolvedComments?: boolean;
  resolvedSuggestions?: boolean;
}

/** A spell-check dictionary (#177): a built-in language or an author-imported Hunspell pair. */
export interface DictionaryInfo { id: string; label: string; builtin: boolean }
/** The raw Hunspell bytes (UTF-8 text) the renderer builds its nspell engine from. */
export interface DictionaryData { aff: string; dic: string }
import type { ReportData, SearchFocus, CoverageReport } from "@patterkit/ops";

export type { ReportData, SearchFocus, CoverageReport, CoverageBeat } from "@patterkit/ops";
export type { CoverageDriver, HostScopeRegistry } from "@patterkit/model";

/** Options for an in-app coverage run (Review ▸ Run Coverage Test). Drivers come from the project's saved
 *  `coverageDrivers`; this just tunes the sweep. */
export interface CoverageRunOptions {
  runs?: number;
  maxSteps?: number;
  seed?: number;
  /** Start-scene override (else the project's authored start). */
  scene?: string;
}

/** The coverage report plus the scene display-names the renderer needs to label the results table (the
 *  report carries scene ids only). */
export interface CoverageResult {
  report: CoverageReport;
  sceneNames: Record<string, string>;
}

export interface SceneSummary {
  id: string;
  name: string;
  /** The scene's blocks (id + name), so the editor can offer any-scene/any-block jump targets. */
  blocks: Array<{ id: string; name: string }>;
}

export interface OpenedProject {
  /** Project display name (ProjectFile.project.name). */
  name: string;
  /** Project root directory on disk. */
  root: string;
  /** Inline-formatting setting (ProjectFile.formatting, default on). */
  formatting: boolean;
  /** Autosave setting (ProjectFile.autosave, default on) - drives the renderer's periodic save. */
  autosave: boolean;
  /** Project-wide VO mode (ProjectFile.voiced, default off): gates voiced line counts, voice-script export,
   *  and (with trackAudioStatus) audio status. */
  voiced: boolean;
  /** Track audio status (#206): gates the inspector's Audio row, the recording ladder / folders / scratch,
   *  and the report's recording breakdown. Effective only when `voiced` is also on. Resolved value (default
   *  off - opt-in even for a voiced project). */
  trackAudioStatus: boolean;
  /** Master cast names (ProjectFile.cast). */
  cast: string[];
  /** Author-defined gameData field definitions per node type (the inspector renders editable rows). */
  gameDataFields: GameDataFields;
  /** Every scene in the project, in file order. */
  scenes: SceneSummary[];
  /** All scene ids - the cross-scene jump targets the surface offers. */
  sceneIds: string[];
  /** Spell-check setup (#177): the resolved dictionary language (defaulted from the source locale when
   *  unset), the project's custom word list, and the on/off flag - so the renderer can build the engine. */
  dictionary: { language: string; words: string[]; ignore: string[]; enabled: boolean };
  /** The writing-status ladder (#196): each rung's name + threshold flags + theme-palette colour slot.
   *  Drives the surface's "Status" submenu, the gutter badges, and the inspector's status dropdown. */
  writingStatuses: WritingStatusDecl[];
  /** The recording-status ladder (#206): each rung's name + colour.
   *  Drives the inspector's recording row + the folder-derived status chip. */
  recordingStatuses: RecordingStatusDecl[];
  /** Audio Folders mode (#206): when on, recording status is derived from files on disk (read-only in the
   *  inspector) rather than set per line. */
  audioFolders: boolean;
  /** Audio Folders root (#206): the single folder under which each rung's audio subfolder is derived, or
   *  null when unset. */
  audioRoot: string | null;
  /** Scratch recording (#224): the rung whose derived folder receives in-app scratch takes, or null when
   *  off. The inspector offers "Record scratch" for any line at or below this rung. */
  scratchStatus: string | null;
}

/** The project-level settings the Project Settings modal edits (General section, v1). Project-wide
 *  values from the `.patterproj`; scene-local / per-node settings live elsewhere. */
export interface ProjectSettingsDto {
  /** Project display name (ProjectFile.project.name). */
  name: string;
  /** Version-control system (the Version Control settings tab); "none" when unset. */
  vcs: VcsKind;
  /** The authored entry point (ProjectFile.start): the scene a flow starts at when none is given, used by
   *  Play from Start and Coverage. Absent = unset (those surfaces then prompt for it). */
  start?: { scene: string; block?: string };
  /** Project-wide VO mode (ProjectFile.voiced, default off). */
  voiced: boolean;
  /** Track audio status (ProjectFile.trackAudioStatus, #206): master switch for the recording ladder /
   *  folders / scratch, the inspector's Audio row, and the report's recording breakdown. Effective only when
   *  `voiced` is on. Resolved value (default off - opt-in even for a voiced project). */
  trackAudioStatus: boolean;
  /** Inline text formatting (ProjectFile.formatting, default on). */
  formatting: boolean;
  /** Autosave: periodically save the edited scene (ProjectFile.autosave, default on). */
  autosave: boolean;
  /** Build output: where Build Bundle writes the compiled `.patterc` (ProjectFile.export.bundle, relative
   *  to the project root or absolute). Always populated for display - the sibling default when unpinned. */
  buildBundle: string;
  /** Localisation build mode (ProjectFile.export.localisation): "embedded" (every locale's strings inside
   *  the .patterc; the runtime resolves them, default) or "ids" (no strings; the runtime emits beat IDs and
   *  the game localises them from its own system). */
  buildLocalisation: "embedded" | "ids";
  /** IDs-only sub-option: embed the SOURCE language for debug playback (the runtime flags it not shippable).
   *  Ignored when buildLocalisation is "embedded". */
  buildSourceDebug: boolean;
  /** The default locale (ProjectFile.locales.default). */
  localeDefault: string;
  /** Every declared locale (ProjectFile.locales.all) - read-only in v1 (editing touches loc shards). */
  locales: string[];
  /** Author-defined gameData field definitions, per node type (the Game Data settings tab). */
  gameDataFields: GameDataFields;
  /** Project-global `@patter` property declarations (the Properties settings tab). */
  properties: PropertyDecl[];
  /** Host / world scope declarations (`@world`, ...) - the World Properties settings tab (#159). Absent = none. */
  scopeRegistry?: HostScopeRegistry;
  /** Coverage input drivers feeding host scopes during a coverage run - the World Properties settings tab (#159). */
  coverageDrivers?: CoverageDriver[];
  /** The master cast (the Cast settings tab). */
  cast: CastMember[];
  /** The ordered writing-status ladder, not-done -> done (the Status settings tab). */
  writingStatuses: WritingStatusDecl[];
  /** Estimating config (the Estimating settings tab): replace a still-guesswork scene's line count with an
   *  estimate in the production report. Always populated (a disabled default when the project has none). */
  estimating: EstimatingConfig;
  /** The ordered recording-status ladder, not-done -> done (the Audio settings tab). */
  recordingStatuses: RecordingStatusDecl[];
  /** Audio Folders mode (#206): derive recording status from folders on disk instead of manual. */
  audioFolders: boolean;
  /** Audio Folders root (#206): the single folder under which each rung's audio subfolder is derived, or
   *  null when unset. */
  audioRoot: string | null;
  /** Scratch recording (#224, the Audio settings tab): the rung whose derived folder receives in-app scratch
   *  takes, or null when scratch recording is off. */
  scratchStatus: string | null;
  /** Spell-check (#177, the Dictionary settings tab): the active dictionary id (built-in or imported),
   *  the project's custom word list, and the on/off flag. */
  dictionaryLanguage: string;
  dictionaryWords: string[];
  /** Words the author chose to Ignore (right-click ▸ Ignore) - persisted, project-scoped, distinct from the
   *  custom word list. Editable / removable in the Dictionary tab. */
  dictionaryIgnore: string[];
  dictionaryEnabled: boolean;
  /** Closed captions (#214, the Closed Captions settings tab): the cue delimiter pair (default `(` / `)`)
   *  and the caption character whose whole lines are captions (default `SFX`). Always populated for the UI;
   *  saveSettings drops the whole block back to undefined when it still matches the defaults. */
  closedCaptions: { open: string; close: string; character: string };
}

/** An opened project plus the scene to land on (open-where-you-left-off). */
export interface OpenResult {
  project: OpenedProject;
  /** The scene last edited in this project, if remembered and still present. */
  lastScene?: string;
  /** The node the caret was on in `lastScene` (open-where-you-left-off, to the line). The renderer
   *  reveals it after the landing scene mounts; absent / missing = land at the top. */
  lastCaret?: string;
}

export interface Identity {
  name: string;
  email?: string;
}

export interface RecentProject {
  path: string;
  name: string;
  openedAt: number;
}

/** Which side panes are pinned open (user-level, remembered across launches). The editor goes
 *  full-bleed when both are closed. */
export interface PaneState {
  nav: boolean;
  inspector: boolean;
  /** Author-dragged pane widths in CSS px (the OPEN width; collapsing to a toggle still goes to 0).
   *  Absent = the default width. Clamped to a minimum on apply. */
  navW?: number;
  inspW?: number;
  /** View > Notes: documentation classes HIDDEN from the editor's note surfacing (spec §18). A
   *  display pref; "everyone" / untyped are always shown and never listed here. Absent = show all. */
  docHidden?: string[];
  /** View > Show Resolved Comments (#148): reveal archived comment threads. Absent / false = hide them. */
  commentsResolved?: boolean;
  /** View > Show Resolved Suggestions: reveal archived rewrite proposals. Absent / false = hide them. */
  suggestionsResolved?: boolean;
  /** Review > Review Feedback: the looping comment + suggestion walk bar is active. */
  reviewFeedback?: boolean;
  /** Review > Line Status: which writing-status rungs show their per-beat gutter pill. Absent / empty =
   *  none shown (the default; keeps the writing surface calm). Hidden in Writing View regardless. */
  lineStatusShown?: string[];
}

/** A curated reading palette (the `data-theme` axis): two light (Paper warm, Mist cool), two dark
 *  (Slate cool, Night warm), plus "system" (follow the OS - light = Paper, dark = Night). Replaces the
 *  old raw light/dark switch; older sessions migrate "light"/"dark" -> "paper"/"night" and the retired
 *  "sepia" -> "mist" on read. */
export type ColourTheme = "system" | "paper" | "mist" | "slate" | "night";
export type FontTheme = "newsreader" | "literata" | "source" | "script";

/** The author's chosen look (View > Reading Palette / Font Theme), remembered across launches. Applied
 *  as `data-theme` / `data-font` on the renderer root; "system" colour follows the OS. */
export interface ThemePrefs {
  colour: ColourTheme;
  font: FontTheme;
}

/** What the renderer asks for on launch: the restored session (if any) + recents + identity, plus the
 *  remembered side-pane (slide/pin) state. */
export interface BootState {
  open: OpenResult | null;
  recents: RecentProject[];
  identity: Identity | null;
  panes: PaneState;
  theme: ThemePrefs;
}

/** A property the condition editor offers (project global `@patter` + this scene's `@scene` props).
 *  The serializable feed for the expression editor's catalogue + schema. */
export interface ConditionProperty {
  scope: string;
  name: string;
  type: "boolean" | "number" | "string" | "enum" | "flags";
  enumValues?: string[];
  /** Author's note on what the property is for - shown as a hint in the picker. */
  purpose?: string;
}

/** The delete confirm's evidence (design/proposals/delete-scene.md): how much content a scene
 *  holds, and exactly which other scenes point into it. */
export interface SceneDeleteInfo {
  /** Exactly the New-Scene scaffold with a clean authoring shard - deletable without a dialog. */
  untouched: boolean;
  /** line/text beats in the scene (the "It contains <n> lines" figure). */
  lines: number;
  blocks: number;
  /** The project's start point is this scene (deleting clears it - the dialog says so). */
  startsHere: boolean;
  /** The only scene left: deletion is refused. */
  lastScene: boolean;
  /** A VCS is configured (softens the "cannot be undone" wording - the VCS is the safety net). */
  vcs: boolean;
  /** Other scenes that jump into this one, or whose conditions name its nodes. */
  referrers: Array<{ sceneId: string; name: string; jumps: number; conditions: number }>;
}

export interface SceneSource {
  /** Raw `.patterflow` source text (the surface parses it itself). */
  flowSource: string;
  /** Raw `.patterloc` source text for the default locale. */
  locSource: string;
  sceneName: string;
  /** Properties referenceable in this scene's conditions (for the inspector's condition editor). */
  properties: ConditionProperty[];
}

export interface SaveResult {
  ok: boolean;
  error?: string;
}

/** One scene's version-control state (#145), folded from simple-vc-lib `fileStatus` over the scene's
 *  shards (flow / loc / authoring). Drives the nav badge + the read-only affordance. All flags absent =
 *  a clean, writable, tracked scene (the common case - no badge). */
export interface SceneVcStatus {
  sceneId: string;
  /** Writable on disk right now. `false` => the editor goes read-only (someone else holds the lock,
   *  or the file is read-only under a lock-based VCS until checked out). */
  writable: boolean;
  /** Checked out / opened by the current user (lock-based VCS) - editable, shown as "yours". */
  checkedOutByMe?: boolean;
  /** Who else holds it open / locked (e.g. "bob@bob-ws") - we can read but not write it. */
  lockedBy?: string[];
  /** A newer revision exists on the server (get latest before editing). */
  outOfDate?: boolean;
  /** Tracked but has uncommitted local changes (modified / staged / opened) - the "modified" badge. */
  dirty?: boolean;
  /** Not yet known to the VCS (a new, uncommitted scene). */
  untracked?: boolean;
}

/** The whole project's version-control snapshot for the reactive UI (#145). */
export interface VcStatusDto {
  /** The configured VCS (so the renderer knows whether exclusive locks are even possible). */
  vcs: VcsKind;
  /** The backend simple-vc-lib actually detected ("git" / "perforce" / "filesystem" / ...). */
  system: string;
  scenes: SceneVcStatus[];
}

/** The outcome of a file export through a native Save dialog. `canceled` (no error) when the author
 *  dismissed the picker; `path` is where the file landed on success. */
export interface ExportResult {
  ok: boolean;
  path?: string;
  canceled?: boolean;
  error?: string;
}

/** A localisation export: a format + an optional target locale (omitted = a blank source template). */
export interface LocExportRequest {
  format: "json" | "xlsx" | "po";
  /** The target locale; omitted exports a template (all source, empty translations). */
  locale?: string;
}

/** The outcome of importing a translated file back into the project. */
export interface LocImportResult {
  ok: boolean;
  canceled?: boolean;
  error?: string;
  /** The locale the strings were imported into. */
  locale?: string;
  /** Distinct strings written, and scenes touched. */
  updated?: number;
  files?: number;
}

/** A search hit (spec §6). The palette finds nodes by Game ID / title / text content, and folds in
 *  "Go to ID": paste an opaque id to jump to the line it names (localisation / audio / logs use that id). */
export interface SearchEntry {
  id: string;
  kind: "scene" | "block" | "group" | "snippet" | "beat";
  /** Author name (scenes / blocks only). */
  name?: string;
  /** Host-facing Game ID address (scenes / blocks only). */
  gameId?: string;
  /** Matched dialogue / narration / choice text (content hits). */
  text?: string;
  /** Named location trail (scene, block). */
  location: string[];
  /** The scene this node lives in (to jump to it). */
  sceneId: string;
}

/** A project-wide find-and-replace request (source-language prose only). Mirrors ops `ReplaceOptions`. */
export interface ReplaceQuery {
  query: string;
  replacement: string;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  /** Restrict to one beat id (the per-row "Replace this one"). */
  onlyId?: string;
}

/** One previewed replacement (for the confirm list). Mirrors ops `ReplaceHit`. */
export interface ReplaceHitDto {
  id: string;
  sceneId: string;
  location: string[];
  before: string;
  after: string;
}

export interface PlayResultDto {
  /** Human-readable transcript lines (renderPlay). */
  transcript: string[];
  /** "end" | "stalled" | "max-steps". */
  outcome: string;
  error?: string;
}

/** One played step in the interactive walk (a line / narration / game-event beat). */
export interface PlayStep {
  kind: "line" | "text" | "gameEvent";
  /** The beat's model id - the play window reports it back for the editor step-marker. */
  id: string;
  /** The scene this beat lives in - lets the editor SWITCH scenes when play crosses into another. */
  scene?: string;
  text?: string;
  character?: string;
  /** The speaker's resolved player-facing name (locale-aware), when the character has one. */
  characterName?: string;
  direction?: string;
}

export interface PlayChoiceOption {
  id: string;
  text: string;
  character?: string;
  /** False when the option's condition fails (shown greyed, not clickable). */
  eligible: boolean;
}

/** Beats from one advance. `stop` says what halted it: more to come (continue), a choice, or the end. */
export interface PlayBatch {
  steps: PlayStep[];
  stop: "continue" | "choice" | "end" | "error";
  options?: PlayChoiceOption[];
  /** On a `choice` stop: the choice group's node id + the scene it's in, so the editor can move the
   *  playhead onto the choice itself while it waits for a pick (not leave it on the beat before). */
  choiceId?: string;
  choiceScene?: string;
  error?: string;
}

/** The play WINDOW's bridge (window.patterPlay) - the interactive walk + the editor step-marker. */
export interface PatterPlayApi {
  /** Create (or recreate) the run for the play window's scene; resets the cursor to the top. */
  start(): Promise<void>;
  /** Advance ONE beat (Step). `stop: "continue"` means there is more to play. */
  step(): Promise<PlayBatch>;
  /** Advance until the next choice / end (Continue), collecting every beat on the way. */
  toStop(): Promise<PlayBatch>;
  /** Pick an eligible option; the next step / toStop plays the chosen branch. */
  choose(optionId: string): Promise<void>;
  /** Mark a played beat as the current playhead in the editor (it leaves a VISITED trail behind).
   *  `sceneId` (the beat's scene) lets the editor switch scenes when play crosses into another. */
  mark(beatId: string | null, sceneId?: string): void;
  /** Clear the editor's visited trail + playhead (on a fresh run / restart). */
  resetMarks(): void;
  /** Re-run from the top (e.g. the user hit Play again for a new scene while this window was open). */
  onRestart(handler: () => void): void;
  /** The run's starting address (`<scene>.<block>`), the pin state, the play-language switcher (#195):
   *  every declared `locales`, the `locale` currently playing, the source `defaultLocale`; and whether the
   *  project is in Audio Folders mode (#206) so the window can show the "Play with audio" toggle. */
  info(): Promise<{ address: string; pinned: boolean; audio: boolean; captions: boolean; locales: string[]; locale: string; defaultLocale: string }>;
  /** Audio Folders mode (#206): the resolved audio bytes for a played line, for "Play with audio". Null when
   *  there's no file. The renderer wraps them in a Blob to play (no file access in the renderer). */
  audioBytes(beatId: string): Promise<{ bytes: Uint8Array; mime: string } | null>;
  /** Toggle the play window's always-on-top pin (remembered). */
  setPin(on: boolean): void;
  /** Switch the language the run plays in; the window then restarts to replay the script in that locale. */
  setLocale(locale: string): Promise<void>;
  /** Toggle closed captions (#214); the window restarts so the script replays with cues shown or stripped. */
  setClosedCaptions(on: boolean): Promise<void>;
  /** The scene changed under a running session: freeze the controls until the player restarts.
   *  Only fires when a LIVE REFRESH was impossible (the in-flight edit didn't compile). */
  onStale(handler: () => void): void;
  /** Live bundle refresh (phase 1): the editor's edit was swapped into the running session in place.
   *  `kind` "text" = strings-only (nothing else changed); "structure" = full hot swap, and `options`
   *  is the pending choice AS IT NOW STANDS (empty = no pending choice) so a shown tray can re-sync. */
  onRefreshed(handler: (kind: "text" | "structure", options: PlayChoiceOption[]) => void): void;
}

/** The faces of the search tool window (#205): find by text / id, replace, browse by writing / recording
 *  status, find property usage, or browse by author tag (#215). */
export type SearchMode = "content" | "replace" | "status" | "recording" | "property" | "tag";

/** Audio Folders index entry (#206): a dialogue beat's folder-derived recording status + the absolute path
 *  to the audio file that resolved it, plus (for scratch takes, #224) the text-hash stamped in the WAV so
 *  the editor can flag a take that's stale against its edited line. */
export interface AudioEntry { status: string; path: string; textHash?: string }

/** Live debug link status (#181) shown in the debug panel. `build` compares the running game's bundle hash
 *  to the project's current one: "match" (in sync), "stale" (rebuild to re-sync), "unknown" (no project).
 *  The link is loopback-only (127.0.0.1), so there's no pairing token: only local processes can reach it. */
export type DebugStatus =
  | { state: "off" }
  | { state: "error"; message: string }
  | { state: "listening"; port: number }
  | { state: "connected"; port: number; project?: string; build: "match" | "stale" | "unknown"; flows: string[]; following: string | null };

/** The detached SEARCH window's bridge (window.patterSearch). It queries the project-wide index in the
 *  main process and drives the editor window (jump) over IPC - the editor stays live underneath. */
export interface PatterSearchApi {
  /** The window's initial state on boot: which mode to open in, the pin state, and whether a project is
   *  even open (no project → a quiet empty state). */
  info(): Promise<{ mode: SearchMode; pinned: boolean; hasProject: boolean; voiced: boolean; query?: string }>;
  /** Content search: Game ID / title / dialogue-text, OR opaque id / handle (the folded-in "Go to ID"). */
  search(query: string): Promise<SearchEntry[]>;
  /** Status browse: every line / text beat at the given status (unset = lowest rung). `recording` picks the
   *  recording-status dimension (dialogue only) instead of writing. */
  linesByStatus(status: string, recording: boolean): Promise<SearchEntry[]>;
  /** Property-usage search: every node referencing a property (`@gold`, `world.threat`, `faction rebels`)
   *  in a condition, effect, or interpolated text. */
  propertyUsage(query: string): Promise<SearchEntry[]>;
  /** Tag browse (#215): every node whose own author tags include `tag` (any level: scene / block / group /
   *  snippet / prompt / beat). */
  tagUsage(tag: string): Promise<SearchEntry[]>;
  /** The distinct author tags in the project with node counts, for the Tag tab's chips (the tag counterpart
   *  to the status ladder). */
  tags(): Promise<Array<{ name: string; count: number }>>;
  /** Replace PREVIEW (no writes): the source-prose hits a project-wide replacement would make + scene count. */
  replacePreview(opts: ReplaceQuery): Promise<{ hits: ReplaceHitDto[]; scenes: number }>;
  /** Replace APPLY: flush the open scene, commit the rewrite through VC, reload the editor. Returns the count. */
  replaceApply(opts: ReplaceQuery): Promise<{ ok: boolean; error?: string; count: number; scenes: number }>;
  /** The status ladder (name + palette colour) for the chips - recording-status when `recording`, else writing. */
  statuses(recording: boolean): Promise<Array<{ name: string; colour?: number }>>;
  /** Jump the editor window to a hit (the search window stays open + on top so you can keep exploring). */
  jump(entry: SearchEntry): void;
  /** Toggle this window's always-on-top pin (remembered). */
  setPin(on: boolean): void;
  /** Close the window (the frameless ✕ / Escape). */
  close(): void;
  /** The editor asked to (re)open this window in a mode - switch to it (the window persists). */
  onMode(handler: (mode: SearchMode) => void): void;
  /** The editor seeded a query (e.g. coverage's "gated on @x" → property usage of @x): fill + run it. */
  onSeed(handler: (query: string) => void): void;
  /** A different project was opened/closed under the window: re-fetch statuses + clear stale results. */
  onProject(handler: () => void): void;
}

/** The coverage window's initial state on boot: the scene list (for the start picker), the project's
 *  start point, the saved drivers (so it can note them), and any cached result from earlier this session. */
export interface CoverageWinInfo {
  hasProject: boolean;
  /** Always-on-top pin state (remembered; default pinned). */
  pinned: boolean;
  scenes: Array<{ id: string; name: string }>;
  start?: { scene: string; block?: string };
  driverCount: number;
  last: CoverageResult | null;
}

/** The detached COVERAGE window's bridge (window.patterCoverage). Runs coverage in the main process,
 *  caches the last result for the session, and drives the editor's jump + the World Properties settings tab. */
export interface PatterCoverageApi {
  /** Initial state on boot (scenes, start, saved-driver count, last cached result). */
  info(): Promise<CoverageWinInfo>;
  /** Run a coverage sweep; the result is cached in the main process for the rest of the session. */
  run(options: CoverageRunOptions): Promise<CoverageResult | null>;
  /** Jump the editor to a beat (focuses the editor; the coverage window stays open). */
  reveal(sceneId: string, beatId: string): void;
  /** Open Project Settings ▸ World Properties in the editor (declare host scopes + edit drivers). */
  openWorld(): void;
  /** Open the Search window in property-usage mode, seeded with a ref (the "gated on @x" link → "where else
   *  is @x used?"). */
  findUsage(ref: string): void;
  /** Toggle this window's always-on-top pin (remembered; default pinned). */
  setPin(on: boolean): void;
  /** A different project was opened/closed under the window: re-fetch info + clear stale results. */
  onProject(handler: () => void): void;
}

export type ProblemCategory = "structure" | "condition" | "interpolation" | "hygiene" | "stale-bundle" | "merge" | "spelling";

/** A one-click remedy for a problem (spec §4). Extensible discriminated union.
 *  `add-to-cast` / `declare-property` are project-file writes (applyFix); `retarget-jump`,
 *  `add-prompt` and `pick-enum-value` are surface edits the renderer drives. */
export type QuickFix =
  | { kind: "add-to-cast"; character: string }
  | { kind: "declare-property"; name: string; propType: "boolean" | "number" | "string" }
  | { kind: "retarget-jump"; snippetId: string }
  /** A choice option with no prompt: insert an empty prompt cell + reveal it. */
  | { kind: "add-prompt"; optionId: string }
  /** A condition compares an enum property to an invalid value: pick a valid one + rewrite the
   *  condition. `bad` is the offending literal, `options` the valid values, `src` the condition. */
  | { kind: "pick-enum-value"; bad: string; options: string[]; src: string };

export interface Problem {
  category: ProblemCategory;
  /** "error" blocks a clean build (structural, broken conditions/interpolation, unresolved merge);
   *  "warning" is advisory (encoding hygiene, a stale bundle); "info" is editorial (spelling, #177 - never
   *  blocks a build, renderer-only). Drives the amber problems-bar + squiggle. */
  severity: "error" | "warning" | "info";
  message: string;
  /** Offending node / beat id, where applicable (for jump-to-site). */
  nodeId?: string;
  /** A code (structural) or field (condition) qualifier. */
  detail?: string;
  /** Offending file (hygiene / bundle / merge issues). */
  file?: string;
  /** A one-click fix offered for this problem, when one applies. */
  fix?: QuickFix;
}

export interface ProblemsDto {
  ok: boolean;
  problems: Problem[];
}

export interface PatterApi {
  /** Launch: restore the last project (open-where-you-left-off), plus recents + identity. */
  boot(): Promise<BootState>;
  /** Boot handshake: the renderer calls this ONCE its initial view (the restored editor, or the welcome
   *  screen) is mounted, so the main process reveals the window then - never flashing the pre-boot chrome
   *  before boot() swaps the editor in. Fire-and-forget. */
  appReady(): void;
  /** Finish the lazy open (#171): a project opens landing-scene-first; the renderer calls this once the
   *  landing scene is painted to parse the rest and get the FULL scene list back (to reconcile the nav +
   *  cross-scene jump targets). Null if no project is open. */
  hydrate(): Promise<OpenedProject | null>;
  /** Pick a project from a folder dialog; null if cancelled. Records it in the session. */
  openDialog(): Promise<OpenResult | null>;
  /** Save As: duplicate the open project's `.patter` folder to a name / location the user picks, then open
   *  the copy. Null if cancelled or nothing is open. The renderer flushes pending edits before calling. */
  saveAs(): Promise<OpenResult | null>;
  /** Open a known path (a recent). Records it in the session. */
  openPath(path: string): Promise<OpenResult>;
  /** Scaffold a new `<name>.patter` project: the renderer collects `name` (themed New-project dialog),
   *  this opens the system folder picker for the parent location, runs runInit, and opens it; null if
   *  the location picker is cancelled. */
  createDialog(name: string, vcs: VcsKind, buildBundle?: string): Promise<OpenResult | null>;
  /** Drop a project from recents / last-session (e.g. it moved or was deleted). */
  forget(path: string): Promise<BootState>;
  /** Compute the production report (spec §13) for the Production Information view (null if no project open). */
  report(): Promise<ReportData | null>;
  /** Export the voice (VO) recording script (spec §16) as an xlsx: opens a native Save dialog. `everything`
   *  includes every voiced line; otherwise only those at/past the "ready to record" writing threshold. */
  exportVoiceScript(everything: boolean): Promise<ExportResult>;
  /** Export a single self-contained, playable HTML file of the whole story: opens a native Save dialog.
   *  The runtime + every locale are inlined, so the file plays offline in any browser. */
  exportPlayableHtml(): Promise<ExportResult>;
  /** Publish for Web: pick a folder; writes index.html + style.css (the writer's harness, published
   *  once then kept so their customisations survive) + story.js + patterplay.js (always refreshed).
   *  `kept` names the harness files that were left alone on a republish. */
  exportWeb(): Promise<ExportResult & { kept?: string[] }>;
  /** Export the readable screenplay (.pdf or .docx, chosen in the Save dialog) of the whole script + flow. */
  exportScript(): Promise<ExportResult>;
  /** Export as Patterpack: bundle the whole project into one `.patterpack` file to send to someone (source
   *  only, no audio / build output). Opens a native Save dialog; `canceled` when the picker is dismissed. */
  exportPatterpack(): Promise<ExportResult>;
  /** Open Patterpack: pick a `.patterpack` file, then a destination folder to unpack it into, and open the
   *  result. Null if either picker is cancelled. A dedicated file picker (the normal Open is folder-oriented). */
  openPatterpack(): Promise<OpenResult | null>;
  /** Export localisation strings (spec §14) in the chosen format: opens a native Save dialog, writes the file. */
  exportLoc(request: LocExportRequest): Promise<ExportResult>;
  /** Import a translated file: opens a native Open dialog, applies it (format by extension). `fallbackLocale`
   *  is used when the file itself carries no locale (e.g. Excel). */
  importLoc(fallbackLocale?: string): Promise<LocImportResult>;
  /** Export the production report as a producer spreadsheet (xlsx): opens a native Save dialog, writes the
   *  chosen file. `canceled` when the author dismisses the picker. */
  exportReport(): Promise<ExportResult>;
  /** Build Bundle (Build menu): compile the project to its runtime `.patterc` and write it to the output
   *  path configured in Project Settings ▸ Build (else the dist/ default). Returns where it landed. */
  buildBundle(): Promise<ExportResult>;
  /** Update Audio Manifest (Production menu, #206): (re)write the sidecar `patteraudio.json` from the live
   *  Audio Folders index, without a full bundle rebuild. Returns where it landed. */
  buildAudioManifest(): Promise<ExportResult>;
  /** Run narrative coverage (#159) over the open project: random playthroughs tally which beats get
   *  reached, flagging never-reached (dead) and needs-input content. Null if no project open. */
  runCoverage(options: CoverageRunOptions): Promise<CoverageResult | null>;
  /** Auto-propose `@world` coverage drivers from the project's conditions (the "Propose from story"
   *  button in Project Settings ▸ World Properties). Empty when there are no host scopes to drive. */
  proposeCoverageDrivers(): Promise<CoverageDriver[]>;
  /** Read the project-level settings for the Project Settings modal (null if no project open). */
  readSettings(): Promise<ProjectSettingsDto | null>;
  /** Persist edited project-level settings back to the .patterproj (lock-aware). On success returns the
   *  refreshed project summary (name etc.) so the renderer can resync the title bar. */
  saveSettings(settings: ProjectSettingsDto): Promise<SaveResult & { project?: OpenedProject }>;
  /** Set just the project's start point (ProjectFile.start), lock-aware: used by the "set where your story
   *  starts" prompt that Play from Start / Coverage raise when it is unset. */
  setStart(start: { scene: string; block?: string }): Promise<SaveResult & { project?: OpenedProject }>;
  /** Persist the nav's authored scene order (ProjectFile.sceneOrder), lock-aware. `ids` must be a
   *  permutation of every scene id; a stale list (scene added/removed since the drag) is refused. */
  reorderScenes(ids: string[]): Promise<SaveResult & { project?: OpenedProject }>;
  /** Create a new scene (the minimal playable scaffold) as fresh flow + loc shards, lock-aware.
   *  Returns the refreshed summary and the new scene's id so the renderer can open it. */
  createScene(name: string): Promise<SaveResult & { project?: OpenedProject; sceneId?: string }>;
  /** What deleting a scene would cost - drives the delete confirm's severity: untouched scaffolds
   *  delete silently, content asks, and inbound references list the referring scenes by name. */
  sceneDeleteInfo(sceneId: string): Promise<SceneDeleteInfo | null>;
  /** Delete a scene (flow + every locale's loc shard + authoring shard, lock-aware), cleaning
   *  `sceneOrder` and a `start` that pointed at it. Refuses the last scene. Not undoable in-app. */
  deleteScene(sceneId: string): Promise<SaveResult & { project?: OpenedProject }>;
  /** Read one scene's flow + loc source for editing. */
  readScene(sceneId: string): Promise<SceneSource>;
  /** Read a scene's typed documentation map (spec §18): node id -> notes (for the inspector Notes editor). */
  readDocs(sceneId: string): Promise<Record<string, DocLine[]>>;
  /** Persist a scene's documentation map back to its authoring shard (lock-aware; merges over the rest). */
  saveDocs(sceneId: string, map: Record<string, DocLine[]>): Promise<SaveResult>;
  /** Read a scene's threaded editor comments (collaboration, #148): every thread anchored to a node in
   *  this scene, active and resolved alike. */
  readComments(sceneId: string): Promise<Comment[]>;
  /** Persist a scene's comment threads back to its authoring shard (lock-aware; merges over the rest). */
  saveComments(sceneId: string, comments: Comment[]): Promise<SaveResult>;
  /** Read a scene's per-beat writing status (#196): beat id -> status name (the ladder rung). */
  readWriting(sceneId: string): Promise<Record<string, string>>;
  /** Persist a scene's per-beat writing status back to its authoring shard (lock-aware; merges over the rest). */
  saveWriting(sceneId: string, map: Record<string, string>): Promise<SaveResult>;
  /** Read a scene's per-beat MANUAL recording status (#206): beat id -> status name (the ladder rung). */
  readRecording(sceneId: string): Promise<Record<string, string>>;
  /** Persist a scene's per-beat recording status back to its authoring shard (lock-aware; merges over the rest). */
  saveRecording(sceneId: string, map: Record<string, string>): Promise<SaveResult>;
  /** Audio Folders mode (#206): the current folder-derived snapshot (beat id -> resolved status + file path).
   *  Empty when the project isn't in folders mode. Pulled on load; pushed live via `onAudioIndex`. */
  audioCurrent(): Promise<Record<string, AudioEntry>>;
  /** Subscribe to folder-index changes (the watcher rescanned an audio folder). */
  onAudioIndex(handler: (snap: Record<string, AudioEntry>) => void): void;
  /** Audio Folders mode (#206): the resolved audio bytes for a line, for the inspector's play button. Null
   *  when there's no file. The renderer wraps the bytes in a Blob to play. */
  readAudio(beatId: string): Promise<{ bytes: Uint8Array; mime: string } | null>;
  /** Scratch recording (#224): save an encoded WAV take into the scratch folder (lock-aware binary write);
   *  the indexer picks it up and the line's derived status updates on its own. */
  saveScratch(beatId: string, bytes: Uint8Array): Promise<SaveResult>;
  /** Scratch recording (#224): is the OS letting us capture the microphone? On macOS this checks TCC and,
   *  if the user hasn't been asked yet, triggers the system permission prompt; false = denied (the fix
   *  lives in System Settings, not in the app). Always true elsewhere. */
  micAccess(): Promise<boolean>;
  /** Strip / restore the native menu while a scratch recording is in progress (so accelerators can't fire
   *  behind the blocking overlay). */
  setRecordingMode(on: boolean): void;
  /** Live debug link (#181): start / stop the localhost server an external game streams its cursor into,
   *  query the current status, follow a specific flow, and subscribe to status pushes. */
  debugStart(): Promise<DebugStatus>;
  debugStop(): Promise<DebugStatus>;
  debugStatus(): Promise<DebugStatus>;
  debugFollow(flowId: string): void;
  onDebugStatus(handler: (status: DebugStatus) => void): void;
  /** Read a scene's "suggest a rewrite" proposals (review flow): open + resolved alike. */
  readSuggestions(sceneId: string): Promise<Suggestion[]>;
  /** Persist a scene's suggestions back to its authoring shard (lock-aware; merges over the rest). */
  saveSuggestions(sceneId: string, suggestions: Suggestion[]): Promise<SaveResult>;
  /** Every piece of feedback across the whole script for the Review Feedback walk (the looping bottom bar):
   *  unresolved comment threads + open rewrite proposals, in scene order. `scope` mirrors the "Show Resolved"
   *  toggles - when a flag is on, that kind's resolved items join the walk too. */
  reviewFeedback(scope?: ReviewScope): Promise<ReviewItem[]>;
  /** Spell-check dictionaries (#177): the built-in languages + every imported Hunspell pair. */
  listDictionaries(): Promise<DictionaryInfo[]>;
  /** The aff/dic text for a dictionary id (built-in or imported); null when not installed on this machine. */
  readDictionary(id: string): Promise<DictionaryData | null>;
  /** Import a custom Hunspell dictionary (opens a native .dic picker; its .aff sibling comes too). */
  importDictionary(): Promise<{ ok: boolean; error?: string; info?: DictionaryInfo }>;
  /** Remove an imported dictionary (built-ins can't be removed). */
  removeDictionary(id: string): Promise<{ ok: boolean; error?: string }>;
  /** Add a word to the project's custom dictionary ("Add to dictionary" on a misspelling); returns the
   *  refreshed word list so the renderer can rebuild the spell engine. */
  addDictionaryWord(word: string): Promise<SaveResult & { words?: string[] }>;
  /** Add a word to the project's IGNORE list ("Ignore" on a misspelling); returns the refreshed ignore list
   *  so the renderer can rebuild the spell engine + the problems panel. Persisted across loads (#177). */
  addIgnoreWord(word: string): Promise<SaveResult & { ignore?: string[] }>;
  /** Set spell-check on/off and/or the active dictionary (the Review ▸ Spelling menu mirrors the Dictionary
   *  tab); returns the refreshed dictionary so the renderer rebuilds the engine. */
  setDictionary(patch: { enabled?: boolean; language?: string }): Promise<SaveResult & { dictionary?: { language: string; words: string[]; ignore: string[]; enabled: boolean } }>;
  /** Persist edited flow + loc source back to the scene's shards (lock-aware). */
  saveScene(sceneId: string, flowSource: string, locSource: string): Promise<SaveResult>;
  /** A version-control snapshot for every scene (#145): lock / checkout / out-of-date, so the nav can
   *  badge each scene and the editor can go read-only on a scene held by another. Null if no project
   *  open. Cheap (one batched spawn per backend); the renderer polls it + refreshes on focus / save. */
  vcStatus(): Promise<VcStatusDto | null>;
  /** Remember the scene currently being edited + the node the caret is on (open-where-you-left-off, to
   *  the line). Fire-and-forget; the caret is paired with the scene, so omitting it means "top of scene". */
  rememberScene(projectPath: string, sceneId: string, caretId?: string): Promise<void>;
  /** Open the interactive play WINDOW for a scene (a separate window walks the script). */
  /** Open the play window for a scene, optionally ENTERING a block (Play Block) rather than the start. */
  openPlay(sceneId: string, blockId?: string): Promise<void>;
  /** Reset View: rescue EVERY window (editor + play + search + coverage) to a sensible, on-screen size /
   *  position - un-minimised, default size, centred on the primary display; re-pins the play window. */
  resetWindows(): Promise<void>;
  /** Tell the play session the scene's source changed (unsaved edits): a live run rebuilds from this
   *  on its next restart, and an open run is marked stale until then. */
  playEdited(sceneId: string, flow: string, loc: string): void;
  /** Subscribe to the editor step-marker (the play window's current beat id, or null to clear). The
   *  beat's `sceneId` lets the editor switch scenes when play crosses into a different one. */
  onPlayMark(handler: (beatId: string | null, sceneId?: string) => void): void;
  /** Subscribe to a play-marks reset (clear the visited trail + playhead). */
  onPlayReset(handler: () => void): void;
  /** Validate the whole project (the CLI's checks): for the problems panel. Reflects disk, unless
   *  `live` is given: the named scene's UNSAVED in-memory source is swapped in first, so problems
   *  track edits as you make them (not just on save). */
  validate(live?: { sceneId: string; flow: string; loc: string }): Promise<ProblemsDto>;
  /** Open (or focus) the detached, always-on-top SEARCH tool window in the given mode (#205). `focus`
   *  (the open scene + caret beat) anchors content-search ranking on the current scene from the caret. */
  openSearchWindow(mode: SearchMode, focus?: SearchFocus, query?: string): Promise<void>;
  /** A result was chosen in the search window: jump the editor to it (loadScene + centred reveal). */
  onSearchNavigate(handler: (entry: SearchEntry) => void): void;
  /** Project-wide Replace coordination (the Replace UI lives in the search window): main asks the editor to
   *  flush its open scene before applying (reply with `editorFlushed`), and to reload it after. */
  onEditorFlush(handler: () => void): void;
  editorFlushed(): void;
  onReplaceApplied(handler: () => void): void;
  /** Open (or focus) the detached COVERAGE results window (#159). */
  openCoverageWindow(): Promise<void>;
  /** A row was clicked in the coverage window: jump the editor to that beat (loadScene + reveal). */
  onCoverageNavigate(handler: (sceneId: string, beatId: string) => void): void;
  /** The coverage window's "World Properties…" button: open Project Settings ▸ World Properties. */
  onOpenWorldSettings(handler: () => void): void;
  /** Apply a problem's one-click quick-fix (spec §4); persists + the caller re-validates. */
  applyFix(fix: QuickFix): Promise<SaveResult>;
  /** The stored author identity, or null on first run. */
  getIdentity(): Promise<Identity | null>;
  setIdentity(identity: Identity): Promise<void>;
  /** Persist the side-pane (slide/pin) state. Fire-and-forget; also refreshes the View menu checks. */
  setPanes(panes: PaneState): Promise<void>;
  /** Persist the colour / font theme choice (View menu). Fire-and-forget; refreshes the menu checks. */
  setTheme(theme: ThemePrefs): Promise<void>;
  /** Open a URL in the user's browser. Main enforces an allow-list (About-dialog links only). */
  openExternal(url: string): void;
  /** Subscribe to native-menu commands (File/Run/Edit/View) - "new" | "open" | "save" | "play" |
   *  "undo" | "redo" | "toggle-nav" | "toggle-inspector" | "open-recent:<path>". */
  onMenu(handler: (cmd: string) => void): void;
  /** Subscribe to a project opened from the OS (a `.patter` document package double-clicked in Finder
   *  while the app is already running). The renderer renders the delivered project. */
  onOpenProject(handler: (result: OpenResult) => void): void;
  /** The auto-updater asks, just before installing, whether the open scene has unsaved edits; the
   *  handler returns the live dirty flag so the user is offered Save / Discard / Cancel. */
  onUpdaterCheckDirty(handler: () => boolean): void;
  /** The auto-updater asks the renderer to save before installing; the handler persists and resolves
   *  `{ ok }` (false aborts the install rather than restart over a half-saved project). */
  onUpdaterSaveBeforeInstall(handler: () => Promise<{ ok: boolean }>): void;
  /** The auto-updater asks the renderer to show a THEMED prompt (never a stock OS dialog); the handler
   *  resolves the chosen button index, the same contract as Electron's showMessageBox `response`. */
  onUpdaterPrompt(handler: (opts: UpdaterPromptOptions) => Promise<number>): void;
}

/** A themed auto-update prompt (the in-app replacement for dialog.showMessageBox). */
export interface UpdaterPromptOptions {
  /** The headline line (shown as the dialog title). */
  message: string;
  /** Supporting copy; `\n` line breaks are preserved. */
  detail?: string;
  /** Button labels, left to right; the resolved index matches this array. */
  buttons: string[];
  /** Optional links shown between the copy and the buttons (the About dialog's website / credit
   *  links). Clicks route through openExternal, so only allow-listed URLs actually open. */
  links?: { label: string; url: string }[];
  /** Centre the PatterKit wordmark above the title (the About dialog's branding). */
  wordmark?: boolean;
  /** The highlighted / Enter-default button (defaults to 0). */
  defaultId?: number;
  /** The button Esc maps to (defaults to the last). */
  cancelId?: number;
}

declare global {
  interface Window {
    patter: PatterApi;
    /** Present only in the play window. */
    patterPlay?: PatterPlayApi;
    /** Present only in the detached search window. */
    patterSearch?: PatterSearchApi;
    /** Present only in the detached coverage window. */
    patterCoverage?: PatterCoverageApi;
  }
}
