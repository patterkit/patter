// The narrow contract across the preload bridge: the only surface the renderer (untrusted UI) has
// onto the Node main process (files, VCS, the @patterkit/ops core). Kept tiny on purpose - every
// entry is an explicit, auditable operation, never raw fs / shell access.

import type { ThemeChoice } from "@wildwinter/app-shell/theme";
import type { MenuCommand } from "@wildwinter/app-shell/menu";
import type { WhatsNewState } from "@wildwinter/app-shell/whats-new-main";
import type { GameDataFields, GameDataNodeKind, PropertyDecl, CastMember, WritingStatusDecl, RecordingStatusDecl, EstimatingConfig, DocLine, VcsKind, Comment, CommentMessage, Suggestion, HostScopeRegistry, CoverageDriver, SpeakerQualifier, SceneNavRow } from "@patterkit/model";

export type { VcsKind } from "@patterkit/model";
import type { PairedCard } from "./paired-cards.js";
export type { PairedCard } from "./paired-cards.js";

export type { DocLine } from "@patterkit/model";

export type { Comment, CommentMessage, Suggestion } from "@patterkit/model";

/** One active piece of feedback for the Review Feedback walk: an unresolved comment thread or an open
 *  rewrite proposal, with where it lives (scene + anchored beat) and a one-line preview. */
/** The scene kits New Scene offers (main/scene-kits.ts builds them; the renderer words them). */
export type SceneKitId = "blank" | "conversation" | "hub" | "barks" | "cutscene";

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
import type { FollowView } from "./debug-follow.js";

export type { ReportData, SearchFocus, CoverageReport, CoverageBeat } from "@patterkit/ops";
export type { CoverageDriver, HostScopeRegistry } from "@patterkit/model";

/** Options for an in-app coverage run (Review ▸ Coverage Test…). Drivers come from the project's saved
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
  /** Project-wide VO mode (ProjectFile.voiced, default off): gates voiced line counts, voice-script export,
   *  and (with trackAudioStatus) audio status. */
  voiced: boolean;
  /** Track audio status (#206): gates the inspector's Audio row, the recording ladder / folders / scratch,
   *  and the report's recording breakdown. Effective only when `voiced` is also on. Resolved value (default
   *  off - opt-in even for a voiced project). */
  trackAudioStatus: boolean;
  /** Master cast names (ProjectFile.cast). */
  cast: string[];
  /** Each cast member's stored colour slot (`CastMember.colour`, 0 to 11, kept through a rename), by
   *  name; absent when nobody has one. Every cue colour reads it before falling back to the name's hash. */
  castColours?: Record<string, number>;
  /** The project's source language (ProjectFile.locales.default): the script editor's `lang`, and what its
   *  spell-check defaults to. */
  sourceLocale?: string;
  /** Each cast member's player-facing name in the source language, by cast name, where it has one that
   *  differs from the cast name (a view extension's project node reads it). */
  castNames?: Record<string, string>;
  /** The speaker qualifiers a line can pick from, in display order (ProjectFile.qualifiers, else the
   *  defaults): the inspector's Qualifier dropdown, the cue's `(O.S.)`, and the keyboard route's cycle. */
  qualifiers: SpeakerQualifier[];
  /** The project's default pause after a line, in seconds (ProjectFile.padAfterDefault, else the built-in
   *  `DEFAULT_PAD_AFTER`): what the inspector's Pad after field shows when nothing nearer sets one. */
  padAfterDefault: number;
  /** How many syllables a second a line with no recording is timed at (ProjectFile.estimateSyllablesPerSecond,
   *  else `DEFAULT_ESTIMATE_SYLLABLES_PER_SECOND`). */
  estimateSyllablesPerSecond: number;
  /** Localise text lines in dialogue scenes (ProjectFile.localiseDialogueText, default off). Off, a dialogue
   *  scene's text is action: the surface draws it as a direction and Play doesn't show it as text. */
  localiseDialogueText: boolean;
  /** Author-defined gameData field definitions per node type (the inspector renders editable rows). */
  gameDataFields: GameDataFields;
  /** Every scene in the project, in file order. */
  scenes: SceneSummary[];
  /** All scene ids - the cross-scene jump targets the surface offers. */
  sceneIds: string[];
  /** The scene list as laid out, folders and scenes, top to bottom with every folder open
   *  (`sceneFolderLayout`; design/proposals/scene-folders.md). */
  navRows: SceneNavRow[];
  /** The scene folders' names, by id. */
  sceneFolders: { id: string; name: string }[];
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
  /** The Patter extensions the project takes and has a sound manifest for, in id order, each with its
   *  declarations by node kind and the project's own values (shared/extensions.ts). Absent when it takes
   *  none. */
  extensions?: ExtensionDto[];
  /** What an extension's references and map keys may name outside the open scene, by node kind (`scene`,
   *  `block`, `snippet`, `option`, `line`, `text`, `gameEvent`): every such node the project has read, each
   *  with a name to show and its scene. The open scene's own come from the editor, as it stands. Present
   *  only with `extensions`. */
  extensionNodes?: Record<string, ExtensionNodeDto[]>;
}

/** A node an extension's reference may name, with the name the author knows it by. */
export interface ExtensionNodeDto {
  id: string;
  label: string;
  /** The scene it is in (absent for a scene itself). */
  scene?: string;
}

/**
 * One Patter extension as the editor draws it (patterkit design/proposals/patter-storylet-extensions.md,
 * "Tier 1: fields"): its declarations for each node kind it targets, what the project takes it at, and the
 * project's own values.
 */
export interface ExtensionDto {
  id: string;
  name: string;
  /** The manifest's version. */
  version: string;
  docs?: string;
  /** The version the project takes it at (`extensions.<id>.version`). */
  taken: string;
  /** By node kind: `scene`, `block`, `snippet`, `option`, `line`, `text`, `gameEvent`, `project`. */
  targets: Record<string, ExtensionTargetDto>;
  /** The project's own node id, which its project-level values are keyed by. */
  projectNode: string;
  /** The project's own values (`_project.patterextension`), raw. Absent when it sets none. */
  projectValues?: Record<string, unknown>;
  /** The views its manifest offers in Patterpad (tier 2), by id and name. Absent when it offers none. */
  views?: { id: string; name: string }[];
  /** The other extensions whose data its views read, by id. Absent when they read none. */
  reads?: string[];
  /** The extensions its manifest requires that the project doesn't take, by id. Absent when none. */
  missing?: string[];
}

export interface ExtensionTargetDto {
  /** The extension's own fields, in the manifest's order (shaped as the shell's value-rows ValueDecl). */
  fields: ExtensionFieldDto[];
}

/** An extension field's declaration, as the manifest writes it. */
export interface ExtensionFieldDto {
  name: string;
  type: string;
  label?: string;
  help?: string;
  group?: string;
  default?: unknown;
  values?: string[];
  /** A sentence per enum value, flag or stage: the chosen one's is shown under the control. */
  valueHelp?: Record<string, string>;
  stages?: string[];
  renamedStages?: Record<string, string>;
  to?: string;
  /** A pick's sources, in order: fixed words, a node kind, a list on the extension's project node. */
  from?: ({ words: string[] } | { to: string } | { list: string })[];
  fields?: ExtensionFieldDto[];
  key?: { type: string; to?: string };
  of?: Omit<ExtensionFieldDto, "name"> & { name?: string };
  id?: string;
  min?: number;
  max?: number;
  required?: boolean;
  editorOnly?: boolean;
  /** One of the extension's views, by id, that edits this field (a map of records) in place of the grid. */
  editor?: string;
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
  /** The default pause after a line, in seconds (ProjectFile.padAfterDefault, line padding). Always
   *  populated (the built-in default when the project sets none); saveSettings drops it again when it
   *  still matches. Optional on save, so a caller with an older settings shape leaves it alone. */
  padAfterDefault?: number;
  /** How many syllables a second a line with no recording is timed at (ProjectFile.estimateSyllablesPerSecond).
   *  Populated and dropped again on save as `padAfterDefault` is. Optional on save, so a caller with an older
   *  settings shape leaves it alone. */
  estimateSyllablesPerSecond?: number;
  /** Localise text lines in dialogue scenes (ProjectFile.localiseDialogueText): default off, stored only when
   *  on. Optional on save, so a caller with an older settings shape leaves it alone. */
  localiseDialogueText?: boolean;
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
  /** Host / game scope declarations (`@world`, `@player`, ...) - the Game scopes settings tab (#159). Absent = none.
   *  With a game scopes folder, the game's own scopes come from its `game.scopes.json`, and saving writes
   *  them there first and then to the project's synced copy. */
  scopeRegistry?: HostScopeRegistry;
  /** The shared `game.scopes.json` World properties are saved to, when the game has a scopes folder
   *  (read-only; the tab names it). Absent = the project alone holds them. */
  worldFile?: string;
  /** Coverage input drivers feeding host scopes during a coverage run - the World Properties settings tab (#159). */
  coverageDrivers?: CoverageDriver[];
  /** The master cast (the Cast settings tab). */
  cast: CastMember[];
  /** The speaker qualifiers (the Qualifiers settings tab), in display order. Always populated (the defaults
   *  when the project has none); saveSettings drops the list when it still matches the defaults. */
  qualifiers: SpeakerQualifier[];
  /** Qualifier gameIds the author changed in the Qualifiers tab, old -> new. Saving rewrites every line
   *  that uses an old one (through the VC layer), and every cast member's own label with it. Write-only:
   *  never read back. */
  qualifierRenames?: Record<string, string>;
  /** Cast members the author renamed in the Cast tab, old name -> new. Saving rewrites every line the old
   *  name speaks, the member's translated names and labels, and the extension data keyed by it or naming it
   *  (through the VC layer). Write-only: never read back. */
  castRenames?: Record<string, string>;
  /** Quality stages the author renamed (the Properties page and the World tab), in the order they were
   *  renamed. Saving carries each into every condition and set effect that names it (through the VC layer).
   *  Write-only: never read back. */
  stageRenames?: StageRenameDto[];
  /** Game scopes the author renamed in Project Settings ▸ Game scopes, the token each was saved under ->
   *  the new one. Saving carries every reference (`@player.hp` in conditions and effects, `{@player.hp}` in
   *  strings) to the new token in the same batch, one undo step, after the stage renames (which name the
   *  old token). Write-only: never read back. */
  scopeRenames?: Record<string, string>;
  /** How a character's label reads with a qualifier (the Qualifiers tab), `{name}` and `{qualifier}` filled
   *  in. "" means the default (`DEFAULT_SPEAKER_PATTERN`), which the project doesn't store. A caller that
   *  sends none leaves the project's as it is. */
  speakerPattern?: string;
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
  /** The project's own values for each Patter extension edited in its Settings section, by extension id: the
   *  whole entry, as it should now stand (`{}` clears it). Written to the extension's
   *  `_project.patterextension` in the same batch as the settings, so one undo puts both back. Absent: none
   *  edited. */
  extensionValues?: Record<string, Record<string, unknown>>;
}

/** An opened project plus the scene to land on (open-where-you-left-off). */
/** The remembered place when the author left off in the PROPERTIES DOCUMENT rather than a scene.
 *  It travels in the same slot as a scene id, which is safe because a scene id is always `scn_…`:
 *  one place field, one restore path, and nothing in the shell's store had to learn a new shape. */
export const PROPERTIES_PLACE = "@properties";

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
  /** Which kinds of inspector level ("snippet", "option", "block", ...) the author opened or folded. Absent
   *  for a kind = its default (the leaf and the snippet open, the outer levels folded). */
  inspectorOpen?: Record<string, boolean>;
}

/** The colour theme (the `data-theme` axis): the family's, from app-shell (Follow System, Light, Dark,
 *  Parchment), shared with Storyletter since the October 2026 UI review. app-shell's `migrateTheme`
 *  carries an older session's Paper, Mist, Slate or Night (and the older light/dark/sepia) across on read. */
export type ColourTheme = ThemeChoice;
export type FontTheme = "newsreader" | "literata" | "source" | "script";

/** The author's chosen look (View > Colour Theme / Font Theme), remembered across launches. Applied
 *  as `data-theme` / `data-font` on the renderer root; "system" colour follows the OS. */
export interface ThemePrefs {
  colour: ColourTheme;
  font: FontTheme;
}

/** What the renderer asks for on launch: the restored session (if any) + recents + identity, plus the
 *  remembered side-pane (slide/pin) state. */
export interface BootState {
  open: OpenResult | null;
  /** Why the last project did not reopen at launch, for the welcome to say. */
  openError?: string;
  recents: RecentProject[];
  identity: Identity | null;
  panes: PaneState;
  theme: ThemePrefs;
  /** The fields window follows the selection (remembered; default on). */
  fieldsFollow: boolean;
}

/** A property the condition editor offers (project global `@patter` + this scene's `@scene` props).
 *  The serializable feed for the expression editor's catalogue + schema. */
export interface ConditionProperty {
  scope: string;
  name: string;
  type: "boolean" | "number" | "string" | "enum" | "flags" | "quality";
  enumValues?: string[];
  /** A quality's ordered stage ladder (drives validation and the value picker's choices). */
  stages?: string[];
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
  /** A VCS is configured. (The confirm no longer turns on it: a deleted scene comes back with Edit ▸ Undo either way.) */
  vcs: boolean;
  /** Other scenes that jump into this one, or whose conditions name its nodes. */
  referrers: Array<{ sceneId: string; name: string; jumps: number; conditions: number }>;
  /** The paired Storylets project's cards that play this scene, by title (none when nothing pairs). */
  cards: string[];
}

export interface SceneSource {
  /** Raw `.patterflow` source text (the surface parses it itself). */
  flowSource: string;
  /** Raw `.patterloc` source text for the default locale. */
  locSource: string;
  sceneName: string;
  /** Properties referenceable in this scene's conditions (for the inspector's condition editor). */
  properties: ConditionProperty[];
  /** The project's host-scope tokens, declared or opaque, which the editors' parser must know. */
  hostScopes: string[];
  /** The scene's Patter extension shards: one for each extension the project takes, and one for each other
   *  extension folder holding data for this scene. The editor puts a live one's entries on their nodes and
   *  hands the shards back changed (`SceneExtensionShards`). */
  extensions: SceneExtensionSourceDto[];
}

/** One extension's shard for a scene, as the editor opens it (the surface's `SceneExtensionSource`). */
export interface SceneExtensionSourceDto {
  /** The extension's id (its folder under the project's extensions layout). */
  id: string;
  /** The extension's name from its manifest, or its id when there's no sound manifest: what the editor
   *  calls it ("Probe's data here is locked by bob."). */
  name: string;
  /** The shard's source text, "" when the scene has none yet. */
  source: string;
  /** The project takes the extension and its manifest is sound: its data is edited. Otherwise the shard is
   *  left as it is. */
  live: boolean;
}

/** A scene's extension shards as the editor hands them back, by extension id: the shard's new text, or null
 *  when it has no data left (the file is deleted). Only the shards it changed (see the surface's
 *  `SavedScene.extensions`): any other is as it is on disk. */
export type SceneExtensionShards = Record<string, string | null>;

/** The open scene's unsaved source, for live validation and the play window. */
export interface LiveSceneSource {
  sceneId: string;
  flow: string;
  loc: string;
  extensions?: SceneExtensionShards;
}

export interface SaveResult {
  ok: boolean;
  error?: string;
  /** A scene save was refused because a file of the scene changed outside Patterpad since it was read: main
   *  has read it again, so the window shows the scene as it now is. */
  reread?: true;
  /** The write was a step of the project history: the new step, or the one it merged into. */
  step?: ProjectStep;
  /** A scene save set or cleared re-record flags (editing a recorded line's spoken text, or undoing that
   *  edit): the scene's flags as they now are, for the editor to show. */
  rerecord?: Record<string, boolean>;
}

/** A step of the project history (patterkit design/patterpad-undo.md, half B), as main announces it to the
 *  editor's journal: its id, its label ("Replace"), whether it merged into the step before (the same key,
 *  as a run of edits on the Properties page), and the scenes whose script (flow or strings) or authoring
 *  shard it touched. */
/** What Add Extension… did: the extension's name and version, whether it updated one the project took at
 *  another version, the manifest's warnings as sentences, and the refreshed project. */
/** Remove from Project… in the Extensions window: the project step, as Add's is. */
export interface RemoveExtensionResult extends SaveResult {
  project?: OpenedProject;
  step?: ProjectStep;
  /** The open scene's extension data changed shape: reload it. */
  reload?: boolean;
  name?: string;
}

export interface AddExtensionResult extends SaveResult {
  project?: OpenedProject;
  name?: string;
  version?: string;
  /** The version the project took before, when this was an update. */
  was?: string;
  warnings?: string[];
  /** Installing its views on this machine failed, though the project took it: why. */
  installError?: string;
  /** The project already took this version or a newer one (or the writer chose not to update it): only the views
   *  were installed on this machine. */
  installedOnly?: true;
  /** A sentence to show: the project keeps a newer version than the package. */
  note?: string;
  /** The extensions it requires, added with it in the same step. */
  also?: { name: string; version: string }[];
  /** Update… with the same version: its files were reinstalled on this machine. */
  reinstalled?: true;
}

/** A view the open project offers, as the editor needs it: whether it opens on this machine. */
export interface ViewOfferDto { extension: string; view: string; installed: boolean }

export interface ProjectStep { id: number; label: string; merged: boolean; scenes: string[]; authoring: string[] }

/** One unresolved clash a merge left in a shard (its `unresolved` entry), as the shell's resolver lists it
 *  (app-shell `Clash`): where it is in words, the two sides as text, and whether Take theirs can be written. */
export type ClashDto = import("@wildwinter/app-shell").Clash;

/** Where the resolver's Edit takes the author: a scene (and a node in it, or its title), a tab of Project
 *  Settings (and a row on it), the Properties page, or nowhere the editor shows (a moved scene order). */
export type ClashTarget =
  | { kind: "scene"; sceneId: string; nodeId?: string; title?: boolean }
  | { kind: "settings"; tab: string; row?: string }
  | { kind: "properties"; name?: string }
  | { kind: "none" };

/** What a clash decision came to: the clashes left, and (when it wrote) the step and the refreshed project. */
export interface ClashDecisionResult extends SaveResult {
  clashes: ClashDto[];
  project?: OpenedProject;
}

/** What a project undo or redo came to, and what the editor must refresh. */
export interface ProjectHistoryOutcome {
  ok: boolean;
  /** The step's label ("Replace"); empty when there was nothing to do. */
  label: string;
  error?: string;
  /** Refused because a file changed since the step: it and every step below it are gone. */
  drift?: boolean;
  /** The step asked for is not the one on top: the editor's journal is out of step with the history. */
  stale?: boolean;
  /** With `stale`: the step that IS on top, so the journal can catch up with one it hasn't heard of yet. */
  top?: { id: number; label: string };
  /** The step's id. */
  id?: number;
  /** The refreshed project summary, once a step landed. */
  project?: OpenedProject;
  /** Scenes whose script (flow or strings) the step rewrote, created, or removed: the open one reloads. */
  scenes: string[];
  /** Scenes whose authoring shard (status, notes, re-record) the step rewrote: refreshed in place. */
  authoring: string[];
}

/** A quality's stage renamed in place, `from` to `to`: the quality is a property in a scope (`patter`,
 *  `scene` with the scene it's declared in, or a host scope such as `world`). */
export interface StageRenameDto {
  scope: string;
  name: string;
  scene?: string;
  /** A quality GAME-DATA field's rename rather than a property's: the node type that declares the field
   *  `name`, whose nodes' values follow (no expression reads game data). `scope` is then unused. */
  gameData?: GameDataNodeKind;
  from: string;
  to: string;
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
  /** The scene's extension shards, by extension id, each its own file: one somebody else holds locks that
   *  extension's data in the scene (the editor refuses edits to it), never the scene itself. Absent when
   *  the scene has none on disk. */
  extensions?: Record<string, Omit<SceneVcStatus, "sceneId" | "extensions">>;
}

/** The key the PROJECT shard is badged under, beside the scene ids. Safe as a shared key space
 *  because a scene id is always `scn_…`; the navigator's Properties row carries this one, since the
 *  `@patter` declarations it edits live in the project file. */
export const PROJECT_SHARD_KEY = "@project";

/** The whole project's version-control snapshot for the reactive UI (#145). */
export interface VcStatusDto {
  /** The configured VCS (so the renderer knows whether exclusive locks are even possible). */
  vcs: VcsKind;
  /** The backend simple-vc-lib actually detected ("git" / "perforce" / "filesystem" / ...). */
  system: string;
  scenes: SceneVcStatus[];
  /** The project file's own state, keyed by `PROJECT_SHARD_KEY`. Same shape as a scene's, minus the
   *  id: it is one file rather than a set, so nothing folds. */
  project?: Omit<SceneVcStatus, "sceneId" | "extensions">;
  /** Each extension's project-level shard (`_project.patterextension`), by extension id. Absent when
   *  there are none. */
  projectExtensions?: Record<string, Omit<SceneVcStatus, "sceneId" | "extensions">>;
}

/** The outcome of a file export through a native Save dialog. `canceled` (no error) when the author
 *  dismissed the picker; `path` is where the file landed on success. */
/** What the editable-script export dialog chose. */
export interface EditableExportRequest {
  /** "scene": just `sceneId`; "project": everything. */
  range: "scene" | "project";
  sceneId?: string;
  recipient?: string;
  notes: "editor" | "all";
  status: boolean;
  cast: boolean;
}

/** The reimport dialog's options. */
export interface EditableImportRequest {
  /** Who untracked edits are credited to ("Edits by"); the handoff's recipient when blank. */
  as?: string;
  strictQuotes: boolean;
  direct: boolean;
}

/** A planned reimport, for the summary dialog. */
export interface EditableImportSummary {
  /** Set when there is something to apply. */
  planId?: string;
  handoffId?: string;
  recipient?: string;
  sentAt?: string;
  sentBy?: string;
  refused?: string;
  counts: { changed: number; unchanged: number; stale: number; comments: number; problems: number };
  problems: Array<{ severity: "warning" | "info"; message: string; anchor?: string; sceneId?: string }>;
  /** How many files the import would write. */
  files: number;
}

/** An open suggestion, for the review list. */
export interface OpenSuggestionDto {
  id: string;
  anchor: string;
  sceneId?: string;
  sceneName?: string;
  author: string;
  ts: string;
  baseline: string;
  proposed: string;
  proposedCharacter?: string;
  baselineCharacter?: string;
  proposedDirection?: string;
  baselineDirection?: string;
  /** A proposed speaker qualifier, and the one when suggested: shown NAMES ("" for none). */
  proposedQualifier?: string;
  baselineQualifier?: string;
  proposedCut?: boolean;
  handoff?: string;
  /** Parts changed since it was made; empty means it still applies cleanly. */
  stale: string[];
}

export interface ExportResult {
  ok: boolean;
  path?: string;
  canceled?: boolean;
  error?: string;
  /** Build Bundle only: how many scene and block addresses it pinned first (pin on publish). */
  pinned?: number;
  /** Localisation export only: what it says beside the file (`describeLocExport`): the action text it left out,
   *  and why, then what has dropped out of the loc files or come into them, a heading per change with each beat
   *  indented. Absent when there's nothing to say. */
  changes?: string[];
}

/** What a Merge Returned Patterpack did, per shard and in total, ready to render without further work.
 *
 *  Conflicts are NOT failures: the shard is written with OUR version and a `.patterconflict` sidecar
 *  records what disagreed, exactly as a version-control conflict leaves the file plus its markers. The
 *  merge still commits, so this is reported in the error voice rather than as a failed operation - a
 *  quiet success toast would let an author walk away from unresolved conflicts thinking they were done. */
export interface PackMergeSummary {
  shards: { path: string; added: boolean; conflicts: number }[];
  /** Total across every shard. */
  conflicts: number;
  warnings: number;
  /** Whether the two packs and the open project agree on their project id, AND the ids themselves.
   *
   *  The ids are carried, not just the verdict, so the dialog can name them. "These do not look like
   *  the same project" tells an author something is wrong; quoting the three ids tells them WHICH of
   *  the two files they chose is the odd one out, which is the thing they have to act on. Storyletter
   *  reached the better wording here first and both apps now use it.
   *
   *  An id is absent where none could be read (a pack with no manifest, an unreadable project file).
   *  That is "cannot say", never a mismatch: refusing on ignorance would block a legitimate merge. */
  provenance: { returned?: string; base?: string; target?: string; ok: boolean };
  /** They changed the game's scopes (World properties) and the project has a game scopes folder: the
   *  merge writes their change to its `game.scopes.json` (`path`, project-relative), so the next save
   *  doesn't sync it away; or, with `error`, that file won't parse and was left alone. The pack's own
   *  copy of the game's scopes is never written back. Absent when they changed none. */
  gameScopes?: { path: string; error?: string };
}

/** A prompt main asks the editor window to show on the family's dialog frame, answered with the index
 *  of the button chosen. Buttons are in display order, the way out first. */
export interface AppPrompt {
  title: string;
  /** One plain sentence under the title. */
  sub?: string;
  /** Paragraphs of body copy. */
  body?: string[];
  buttons: string[];
  /** The button that wears the accent and takes the focus. */
  defaultId: number;
  /** What Esc and the backdrop answer. */
  cancelId: number;
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
  /** Translations dropped because their beat is now action text. */
  dropped?: number;
  /** What the import has to tell beside its counts, as the CLI prints it: a warning when the file named no
   *  language, the lines it skipped because the project doesn't have them, and the translations to check
   *  (placeholders or formatting that don't match the source). A heading, then its lines indented by two
   *  spaces. Absent when there's nothing to tell. */
  report?: string[];
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
  /** Matched dialogue / text / choice text (content hits). */
  text?: string;
  /** Named location trail (scene, block). */
  location: string[];
  /** The scene this node lives in (to jump to it). */
  sceneId: string;
  /** Field-tab hits only: the gameData field that answered, the value it holds as text (flags joined with
   *  commas), and whether that is the declared default because the node sets none. Mirrors ops `FieldHit`. */
  field?: { name: string; type: string; value: string; isDefault: boolean };
}

/** A project-wide find-and-replace request (source-language prose, and text and multiline gameData values).
 *  Mirrors ops `ReplaceOptions`. */
export interface ReplaceQuery {
  query: string;
  replacement: string;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  /** Restrict to one node id (the per-row "Replace this one"), and with `onlyField` to one of its texts. */
  onlyId?: string;
  onlyField?: ReplaceHitDto["field"];
}

/** One previewed replacement (for the confirm list). Mirrors ops `ReplaceHit`. */
export interface ReplaceHitDto {
  id: string;
  /** The node's prose (`text`) or one of its gameData values (`field:<name>`). */
  field: "text" | `field:${string}`;
  sceneId: string;
  location: string[];
  before: string;
  after: string;
}

export interface PlayResultDto {
  /** Human-readable transcript lines (renderPlay). */
  transcript: string[];
  /** "end" | "max-steps" | "error" (the engine stopped the run). */
  outcome: string;
  error?: string;
}

/** One played step in the interactive walk (a line / text / game-event beat). */
export interface PlayStep {
  kind: "line" | "text" | "gameEvent";
  /** A text step that is action (a dialogue scene's text the project doesn't localise): a direction for
   *  whoever stages the scene, never shown to the player. Play shows it as a direction, timed by its pause alone. */
  action?: true;
  /** The beat's model id - the play window reports it back for the editor step-marker. */
  id: string;
  /** The scene this beat lives in - lets the editor SWITCH scenes when play crosses into another. */
  scene?: string;
  text?: string;
  character?: string;
  /** The speaker's resolved player-facing name (locale-aware), when the character has one. */
  characterName?: string;
  direction?: string;
  /** The speaker qualifier's gameId (`os`) and its resolved shown name (`O.S.`). */
  qualifier?: string;
  qualifierName?: string;
  /** The name to show for the speaker, resolved by the runtime (locale-aware): the display name, or with a
   *  qualifier the speaker pattern filled in (`TAM (O.S.)`) or the pair's own label. Absent in an IDs-only
   *  build. */
  speakerLabel?: string;
  /** line only: the speaker's stored colour slot (`CastMember.colour`), when the cast keeps one. */
  colour?: number;
  /** line / text only: the pause after it before the next line, in seconds, resolved by the runtime
   *  (line padding). Negative = the next line cuts in. */
  padAfter?: number;
  /** line / text only: how long it lasts if it has no recording, in seconds, worked out by the runtime from the
   *  line as it's spoken in the project's main language (`estimateLineDuration`), whatever language Play shows. */
  estimate?: number;
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
  /** Conditions or effects that failed since the last batch. The engine plays through them (a failing
   *  condition counts as false, a failing effect is skipped), so the play window shows each as a warning. */
  warnings?: string[];
  /** On an `end` stop: the run ended because this choice ran dry (every option used, no fallback), not because
   *  the story finished. The play window says so, and moves the editor's playhead onto the choice. */
  ranDry?: { choiceId: string; scene?: string };
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
  /** `voiced`: the project's Voiced setting, which picks whether Continue starts on when the author hasn't chosen. */
  info(): Promise<{ address: string; pinned: boolean; theme: ThemePrefs; follow: boolean; audio: boolean; captions: boolean; voiced: boolean; locales: string[]; locale: string; defaultLocale: string }>;
  /** Main changed this window's pin behind its back (Reset View re-pins every helper). */
  onPin(handler: (on: boolean) => void): void;
  /** Close this window (the head's close button; Esc routes here too). */
  close(): void;
  /** A different project opened under this window (the session's satellite nudge). A run belongs to
   *  the project it was started in, so the window closes rather than showing a view of nothing. */
  onProject(handler: () => void): void;
  /** "Follow in the editor": ask main to reveal each played beat in the editor as the run goes.
   *  Remembered per user; OFF by default, because marking is the default and following is opt-in. */
  setFollow(on: boolean): void;
  /** The author changed the colour / font theme in the editor. Every window shares the palette. */
  onTheme(handler: (theme: ThemePrefs) => void): void;
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
export type SearchMode = "content" | "replace" | "status" | "recording" | "property" | "field" | "tag" | "qualifier" | "suggestions";

/** Audio Folders index entry (#206): a dialogue beat's folder-derived recording status + the absolute path
 *  to the audio file that resolved it, plus (for scratch takes, #224) the text-hash stamped in the WAV so
 *  the editor can flag a take that's stale against its edited line. */
export interface AudioEntry { status: string; path: string; textHash?: string }

/** Live debug link status (#181) shown in the debug panel. `build` compares the running game's bundle hash
 *  to the project's current one: "match" (in sync), "stale" (rebuild to re-sync), "unknown" (no project).
 *  The link is loopback-only (127.0.0.1), so there's no pairing token: only local processes can reach it.
 *  Connected, it carries the follow state (shared/debug-follow.ts): the live flows, the one followed,
 *  whether that's the most recent or a flow picked in the editor, and each flow's current scene. */
export type DebugStatus =
  | { state: "off" }
  | { state: "error"; message: string }
  | { state: "listening"; port: number }
  | ({ state: "connected"; port: number; project?: string; build: "match" | "stale" | "unknown" } & FollowView);

/** The detached SEARCH window's bridge (window.patterSearch). It queries the project-wide index in the
 *  main process and drives the editor window (jump) over IPC - the editor stays live underneath. */
export interface PatterSearchApi {
  /** The window's initial state on boot: which mode to open in, the pin state, and whether a project is
   *  even open (no project → a quiet empty state). */
  info(): Promise<{ mode: SearchMode; pinned: boolean; hasProject: boolean; voiced: boolean; query?: string; theme: ThemePrefs }>;
  /** Content search: Game ID / title / dialogue-text, OR opaque id / handle (the folded-in "Go to ID"). */
  search(query: string): Promise<SearchEntry[]>;
  /** Status browse: every line / text beat at the given status (unset = lowest rung). `recording` picks the
   *  recording-status dimension (dialogue only) instead of writing. */
  linesByStatus(status: string, recording: boolean): Promise<SearchEntry[]>;
  /** Property-usage search: every node referencing a property (`@gold`, `world.threat`, `faction rebels`)
   *  in a condition, effect, or interpolated text. */
  propertyUsage(query: string): Promise<SearchEntry[]>;
  /** Field browse (family parity item 16): every node whose gameData field answers `query` (`mood`,
   *  `mood = tense`, `mood != calm`), read by the family's shared matcher; the value tested is the one that
   *  holds, the declared default when the node sets none. */
  fieldUsage(query: string): Promise<SearchEntry[]>;
  /** The project's declared gameData field names, each with the node kinds that declare it, for the Field
   *  tab's empty state. */
  fields(): Promise<Array<{ name: string; kinds: string[] }>>;
  /** Tag browse (#215): every node whose own author tags include `tag` (any level: scene / block / group /
   *  snippet / prompt / beat). */
  tagUsage(tag: string): Promise<SearchEntry[]>;
  /** The distinct author tags in the project with node counts, for the Tag tab's chips (the tag counterpart
   *  to the status ladder). */
  tags(): Promise<Array<{ name: string; count: number }>>;
  /** Qualifier browse: every dialogue line (and line prompt) carrying the speaker qualifier `gameId`. */
  linesByQualifier(gameId: string): Promise<SearchEntry[]>;
  /** The project's speaker qualifiers with how many lines use each, for the Qualifier tab's chips. */
  qualifiers(): Promise<Array<{ gameId: string; name: string; count: number }>>;
  /** Replace PREVIEW (no writes): the source-prose hits a project-wide replacement would make + scene count. */
  replacePreview(opts: ReplaceQuery): Promise<{ hits: ReplaceHitDto[]; scenes: number }>;
  /** Replace APPLY: flush the open scene, commit the rewrite through VC, reload the editor. Returns the count. */
  replaceApply(opts: ReplaceQuery): Promise<{ ok: boolean; error?: string; count: number; scenes: number; step?: ProjectStep }>;
  /** A toast's Undo, from this window: the editor takes back project step `id`, but only while it is still
   *  the newest thing done ("stale" otherwise, and nothing changes). */
  undoStep(id: number): Promise<"done" | "stale">;
  /** The status ladder (name + palette colour) for the chips - recording-status when `recording`, else writing. */
  statuses(recording: boolean): Promise<Array<{ name: string; colour?: number }>>;
  /** Open suggestions across the project (optionally one handoff's), each marked clean or out of date. */
  suggestions(filter: { handoff?: string }): Promise<OpenSuggestionDto[]>;
  /** The open handoffs, newest first (the Suggestions tab's chips). */
  handoffs(): Promise<Array<{ id: string; recipient?: string; createdAt: string; createdBy: string }>>;
  /** Accept or reject suggestions on the files, all or nothing: flushes the open scene first and reloads
   *  the editor after. */
  decideSuggestions(decisions: Array<{ id: string; accept: boolean }>): Promise<SaveResult & { results?: Array<{ id: string; outcome: string; reason?: string }> }>;
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
  /** Main changed this window's pin behind the window's back (Reset View re-pins every helper). The
   *  button has to be TOLD, or it goes on showing the state it last chose itself. */
  onPin(handler: (on: boolean) => void): void;
  /** The author changed the colour / font theme in the editor. Every window shares the palette. */
  onTheme(handler: (theme: ThemePrefs) => void): void;
}

/** The coverage window's initial state on boot: the scene list (for the start picker), the project's
 *  start point, the saved drivers (so it can note them), and any cached result from earlier this session. */
export interface CoverageWinInfo {
  hasProject: boolean;
  /** Always-on-top pin state (remembered; default pinned). */
  pinned: boolean;
  /** The author's colour + font theme. Every window paints in it, not just the editor. */
  theme: ThemePrefs;
  scenes: Array<{ id: string; name: string }>;
  start?: { scene: string; block?: string };
  driverCount: number;
  last: CoverageResult | null;
}

/** One progress tick from a long job in main. Mirrors app-shell's `JobProgress`, restated here so the
 *  renderer contract does not depend on the shell's types crossing the preload boundary. */
export interface JobProgressDto {
  kind: string;
  done: number;
  total: number;
  elapsedMs: number;
}

/** The detached COVERAGE window's bridge (window.patterCoverage). Runs coverage in the main process,
 *  caches the last result for the session, and drives the editor's jump + the World Properties settings tab. */
export interface PatterCoverageApi {
  /** Initial state on boot (scenes, start, saved-driver count, last cached result). */
  info(): Promise<CoverageWinInfo>;
  /** Run a coverage sweep; the result is cached in the main process for the rest of the session.
   *  Resolves with a PARTIAL result if the sweep was cancelled (its report says so). */
  run(options: CoverageRunOptions): Promise<CoverageResult | null>;
  /** Ask a running sweep to stop. It stops at the next run and still returns what it sampled. */
  cancel(): void;
  /** Progress from the running sweep (runs done / asked for, and how long it has been going). */
  onProgress(handler: (p: JobProgressDto) => void): void;
  /** Jump the editor to a beat (focuses the editor; the coverage window stays open). */
  reveal(sceneId: string, beatId: string): void;
  /** Open Project Settings ▸ World Properties in the editor (declare host scopes + edit drivers). */
  openWorld(): void;
  /** Open the Search window in property-usage mode, seeded with a ref (the "gated on @x" link → "where else
   *  is @x used?"). */
  findUsage(ref: string): void;
  /** Toggle this window's always-on-top pin (remembered; default pinned). */
  setPin(on: boolean): void;
  /** Close this window (the head's close button; Esc routes here too). */
  close(): void;
  /** A different project was opened/closed under the window: re-fetch info + clear stale results. */
  onProject(handler: () => void): void;
  /** Main changed this window's pin behind the window's back (Reset View re-pins every helper). The
   *  button has to be TOLD, or it goes on showing the state it last chose itself. */
  onPin(handler: (on: boolean) => void): void;
  /** The author changed the colour / font theme in the editor. Every window shares the palette. */
  onTheme(handler: (theme: ThemePrefs) => void): void;
}

/** One map of records on the shown node, as the FIELDS window draws it (Pattershot's brief, H1 to H4): the
 *  field's declaration and value, and what the cells need from the project, sent as data because the
 *  adapter's functions can't cross to another window. */
export interface FieldsGrid {
  extension: string;
  extensionName: string;
  field: string;
  decl: ExtensionFieldDto;
  value: unknown;
  /** The sentence when somebody else holds the extension's data here, else null: the grid is read-only. */
  locked: string | null;
  /** The nodes the key and the cells offer, by kind. */
  nodes: Record<string, Array<{ id: string; label: string }>>;
  /** A held node the choices leave out, by kind then id: its name. */
  labels: Record<string, Record<string, string>>;
  /** The extension's project lists a pick offers, by name. */
  lists: Record<string, string[]>;
}

/** What the FIELDS window shows: the node and its maps of records, or why there are none. */
export interface FieldsWinState {
  hasProject: boolean;
  /** The node shown, or null with nothing selected (or the held node isn't open any more). */
  node: { id: string; kind: string; label: string } | null;
  /** The node can't be written (no id, or the scene is somebody else's). */
  readOnly: boolean;
  /** Why, when somebody else holds the scene ("Locked by bo. Read-only until they release it."), else "". */
  readOnlyWhy: string;
  grids: FieldsGrid[];
  /** Where such fields are, for the window to say when it has none to show ("Select a line or text to edit
   *  Performance here."); empty when the project's extensions have none. */
  hint: string;
}

/** The FIELDS window's boot state: the last state the editor sent, and the window's own settings. */
export interface FieldsWinInfo {
  state: FieldsWinState;
  pinned: boolean;
  /** Following the editor's selection (remembered; default on). Off: it stays on its node. */
  follow: boolean;
  theme: ThemePrefs;
}

/** What the Extensions window draws (the shell's `extensionsPanel`). */
export interface ExtensionsWinState {
  rows: import("@wildwinter/app-shell").ExtensionRow[];
  hasProject: boolean;
  /** An extension to bring into view (the Window menu's "(not installed)…"). */
  focus?: string;
}

export interface ExtensionsWinInfo {
  state: ExtensionsWinState;
  pinned: boolean;
  theme: ThemePrefs;
}

/** The Extensions window's bridge (window.patterExtensions; patterkit design/extensions-window.md). Add, Install
 *  and Remove go to the editor, where the project's undo lives; Uninstall is this machine's, done in main. */
export interface PatterExtensionsApi {
  info(): Promise<ExtensionsWinInfo>;
  add(): void;
  install(id: string): void;
  remove(id: string): void;
  uninstall(id: string, version: string): void;
  update(id: string): void;
  setPin(on: boolean): void;
  close(): void;
  onState(handler: (state: ExtensionsWinState) => void): void;
  /** A different project opened or closed under the window. */
  onProject(handler: () => void): void;
  onPin(handler: (on: boolean) => void): void;
  onTheme(handler: (theme: ThemePrefs) => void): void;
}

/** The detached FIELDS window's bridge (window.patterFields): a map of records edited as a grid, for the
 *  node the editor has selected. Every edit goes to the editor, which applies it as an undoable step and
 *  sends the new state back. */
export interface PatterFieldsApi {
  info(): Promise<FieldsWinInfo>;
  /** Set one field of a node's extension entry (the whole map; undefined clears it). */
  commit(id: string, extension: string, field: string, value: unknown): void;
  /** Follow the editor's selection, or stay on the node shown. */
  setFollow(on: boolean): void;
  setPin(on: boolean): void;
  close(): void;
  onState(handler: (state: FieldsWinState) => void): void;
  /** A different project opened or closed under the window. */
  onProject(handler: () => void): void;
  onPin(handler: (on: boolean) => void): void;
  onTheme(handler: (theme: ThemePrefs) => void): void;
}

export type ProblemCategory = "structure" | "condition" | "interpolation" | "hygiene" | "stale-bundle" | "merge" | "not-in-project" | "game-scopes" | "extensions";

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
  | { kind: "pick-enum-value"; bad: string; options: string[]; src: string }
  /** A line's speaker qualifier is not in the project's list (one removed): pick one that is, or none,
   *  for the line `lineId`. `bad` is the gameId it carries. */
  | { kind: "pick-qualifier"; lineId: string; bad: string }
  /** A choice can run dry with nothing after it, so the dialogue would end there: add a fallback option to the
   *  choice `choiceId` (offered only when it has none). */
  | { kind: "add-fallback"; choiceId: string }
  /** A quality game-data value names no stage of its field (a deleted one, most often): pick one of
   *  `options` (the stages, in ladder order) for node `nodeId`'s field `field`. `bad` is what it holds. */
  | { kind: "pick-gamedata-stage"; nodeId: string; field: string; bad: string; options: string[] };

export interface Problem {
  category: ProblemCategory;
  /** "error" blocks a clean build (structural, broken conditions/interpolation, unresolved merge);
   *  "warning" is advisory (encoding hygiene, a stale bundle); "info" is editorial (spelling, #177 - never
   *  blocks a build, renderer-only). Drives the amber problems-bar + squiggle. */
  severity: "error" | "warning" | "info";
  message: string;
  /** Offending node / beat id, where applicable (for jump-to-site). */
  nodeId?: string;
  /** The scene that node lives in, so "Go to issue" can switch scenes first: the surface can only
   *  reveal a node in the OPEN scene, and a problem elsewhere used to answer a click with nothing
   *  (2026-09-03). Absent when the problem has no node, or the node is not in any scene. */
  sceneId?: string;
  /** A code (structural) or field (condition) qualifier. */
  detail?: string;
  /** Offending file (hygiene / bundle / merge issues). */
  file?: string;
  /** A one-click fix offered for this problem, when one applies. */
  fix?: QuickFix;
  /** The Patter extension the problem is about (its data, its manifest, or its pin), by id: a
   *  project-level one opens the extension's section of Project Settings. */
  extension?: string;
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
  /** A shipped example (shared/examples.ts), copied to a folder the writer picks and opened; null when
   *  they cancel, or when the copy cannot be made (main says why, in a message box). */
  openExample(file: string): Promise<OpenResult | null>;
  /** Close the open project and return to the welcome screen (the window stays). */
  closeProject(): Promise<void>;
  /** Scaffold a new `<name>.patter` project: the renderer collects `name` (themed New-project dialog),
   *  this opens the system folder picker for the parent location, runs runInit, and opens it; null if
   *  the location picker is cancelled. */
  createDialog(name: string, vcs: VcsKind, buildBundle?: string): Promise<OpenResult | null>;
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
  /** How many editable lines an editable-script export would hold: for one scene, and for the whole project
   *  (the export dialog shows both beside its range choice). */
  editableLineCounts(sceneId: string | null): Promise<{ scene: number; project: number }>;
  /** Export the editable script (a native Save dialog picks the .docx) and commit its handoff record. */
  exportEditable(opts: EditableExportRequest): Promise<ExportResult & { handoffId?: string }>;
  /** Pick a returned editable script (.docx) to reimport. Null if the picker is dismissed. */
  pickEditableReturn(): Promise<string | null>;
  /** Plan bringing a returned editable script back (reads the file; writes nothing). Re-plan when the
   *  dialog's options change; apply by plan id. */
  planEditableImport(path: string, opts: EditableImportRequest): Promise<EditableImportSummary>;
  /** Commit a planned import, all or nothing: under lock-based version control, a file someone else holds
   *  means nothing is written. The open scene reloads afterwards. */
  applyEditableImport(planId: string): Promise<SaveResult>;
  /** Open suggestions across the project, optionally from one handoff, each marked clean or out of date. */
  listSuggestions(filter: { handoff?: string }): Promise<OpenSuggestionDto[]>;
  /** Accept or reject suggestions on the files (all or nothing); the open scene reloads afterwards. */
  decideSuggestions(decisions: Array<{ id: string; accept: boolean }>): Promise<SaveResult & { results?: Array<{ id: string; outcome: string; reason?: string }> }>;
  /** The project's handoffs that are still open, newest first (the review filter's choices). */
  openHandoffs(): Promise<Array<{ id: string; recipient?: string; createdAt: string; createdBy: string }>>;
  /** Export as Patterpack: bundle the whole project into one `.patterpack` file to send to someone (source
   *  only, no audio / build output). Opens a native Save dialog; `canceled` when the picker is dismissed. */
  exportPatterpack(): Promise<ExportResult>;
  /** Open Patterpack: pick a `.patterpack` file, then a destination folder to unpack it into, and open the
   *  result. Null if either picker is cancelled. A dedicated file picker (the normal Open is folder-oriented). */
  openPatterpack(): Promise<OpenResult | null>;
  /** Merge Returned Patterpack, step one: pick the pack that came BACK, then the pack you SENT (the
   *  common ancestor), and work out the merge into the OPEN project without writing anything. Main holds
   *  the plan; the renderer gets what it found, to confirm, and never sees a path. Null when either picker
   *  is dismissed. Unlike Open Patterpack this edits the project in place rather than opening another. */
  mergePatterpackPlan(): Promise<{ summary: PackMergeSummary } | { error: string } | null>;
  /** Step two, after the author confirms: write the held plan and re-read the project from disk. */
  mergePatterpackCommit(): Promise<{ project: OpenedProject; summary: PackMergeSummary } | { error: string }>;
  /** Or the author cancelled: let the held plan go. */
  mergePatterpackDrop(): Promise<void>;
  /** Every unresolved clash a merge left in the open project's shards (the one clash resolver, Q21). Also
   *  keeps Project ▸ Resolve Clashes… enabled by the count. */
  listClashes(): Promise<ClashDto[]>;
  /** Settle one clash: "ours" (Keep mine), "theirs" (Take theirs), or "resolved" (Mark resolved, after an
   *  edit by hand), as one undoable step. Answers with the clashes left. */
  decideClash(id: string, decision: "ours" | "theirs" | "resolved"): Promise<ClashDecisionResult>;
  /** Where the resolver's Edit goes for a clash. */
  clashTarget(id: string): Promise<ClashTarget>;
  /** File ▸ Share Scopes with Other Tools: create the game's `game-scopes/` folder (where, asked in main)
   *  with Patter's file and a `game.scopes.json` of the project's World properties, so the game's other
   *  editing tools check and preview this project's names and it checks theirs. `shared` when the
   *  project already shares one (nothing written); null when the author cancelled. */
  shareScopes(): Promise<{ dir: string } | { shared: string } | { error: string } | null>;
  /** Export localisation strings (spec §14) in the chosen format: opens a native Save dialog, writes the file. */
  exportLoc(request: LocExportRequest): Promise<ExportResult>;
  /** Import a translated file: opens a native Open dialog, applies it (format by extension). `chosenLocale`
   *  is the language picked: a file for another language is refused, and one naming none (an older
   *  spreadsheet) imports as it, with a warning. Omitted, the file's own language is used. */
  importLoc(chosenLocale?: string): Promise<LocImportResult>;
  /** Export the production report as a producer spreadsheet (xlsx): opens a native Save dialog, writes the
   *  chosen file. `canceled` when the author dismisses the picker. */
  exportReport(): Promise<ExportResult>;
  /** Stop the running long job of a kind at its next yield (the editor's progress strip's Cancel). Every
   *  export / publish / pack / merge runs as the "publish" job; coverage has its own window. */
  cancelJob(kind: string): void;
  /** Progress from a long job in main (the same channel the coverage window listens on), so the editor
   *  can draw a determinate bar the moment a publish path starts reporting through the ops layer. */
  onJobProgress(handler: (p: JobProgressDto) => void): void;
  /** File ▸ Open Recent ▸ Clear Recents: forget every recent (the open project stays, as the one entry)
   *  and return what is left, so the welcome screen's list can follow. */
  /** The recent projects as the store holds them now (reads only; opens nothing). */
  recents(): Promise<RecentProject[]>;
  clearRecents(): Promise<RecentProject[]>;
  /** Build Bundle (Build menu): compile the project to its runtime `.patterc` and write it to the output
   *  path configured in Project Settings ▸ Build (else the dist/ default). Returns where it landed. */
  /** Publish Bundle. `pin` (the menu's) first writes down every scene and block address still following
   *  its name, so a later rename cannot move a name the game may now rely on. */
  buildBundle(opts?: { pin?: boolean }): Promise<ExportResult>;
  /** Show Card in Storyletter: open the paired Storyletter project at the card this scene plays. */
  showInStoryletter(sceneId: string): Promise<{ ok: boolean; error?: string; canceled?: boolean }>;
  /** The paired Storylets project's cards (title and the scene reference each plays), read again where a
   *  deck file changed; none when nothing pairs. Asked on open and when the window regains focus. */
  pairedCards(): Promise<PairedCard[]>;
  /** Toggle Auto Rebuild (Publish menu checkbox): flip the author's own setting (app state, not the
   *  project), and return the new state. */
  toggleAutoRebuild(): Promise<boolean>;
  /** Update Audio Manifest (Production menu, #206): (re)write the sidecar `patteraudio.json` from the live
   *  Audio Folders index, without a full bundle rebuild. Returns where it landed. */
  buildAudioManifest(): Promise<ExportResult>;
  /** Auto-propose `@world` coverage drivers from the project's conditions (the "Propose from story"
   *  button in Project Settings ▸ World Properties). Empty when there are no host scopes to drive. */
  proposeCoverageDrivers(): Promise<CoverageDriver[]>;
  /** Read the project-level settings for the Project Settings modal (null if no project open). */
  readSettings(): Promise<ProjectSettingsDto | null>;
  /** Persist edited project-level settings back to the .patterproj (lock-aware). On success returns the
   *  refreshed project summary (name etc.) so the renderer can resync the title bar. */
  saveSettings(settings: ProjectSettingsDto, undo?: { label?: string; key?: string }): Promise<SaveResult & { project?: OpenedProject }>;
  /** Undo / redo the newest step of the project history, which must be step `id` (the journal's). The
   *  outcome says what the editor refreshes. */
  projectUndo(id?: number): Promise<ProjectHistoryOutcome>;
  projectRedo(id?: number): Promise<ProjectHistoryOutcome>;
  /** A new edit in the open scene: the project history's redo goes too, as the scene's has. */
  projectClearRedo(): Promise<void>;
  /** The Edit menu's Undo and Redo labels, from the journal's newest entries ("Replace"; none for a scene edit). */
  setUndoLabels(labels: { undo?: string; redo?: string }): Promise<void>;
  /** Whether Edit ▸ Move Up / Move Down can do anything now (the focused scene row, or the script's
   *  selection); the menu greys them otherwise. Sent as it changes. */
  setMoveEnabled(state: { up: boolean; down: boolean }): Promise<void>;
  /** Every step main records in the project history, whichever window asked for the write. */
  onProjectStep(handler: (step: ProjectStep) => void): void;
  /** Another window's toast asks the editor to undo project step `id` only if it's still the newest; the
   *  handler says what it came to. */
  onUndoStep(handler: (id: number) => Promise<"done" | "stale">): void;
  /** Carry stage renames into every condition and set effect that names them (the open scene is saved
   *  first and reloads after). `expressions` is how many were rewritten. */
  renameStages(renames: StageRenameDto[]): Promise<SaveResult & { expressions: number }>;
  /** How many conditions and set effects order a quality against its stages: the gates a reorder changes. */
  stageGates(target: { scope: string; name: string; scene?: string }): Promise<number>;
  /** Set just the project's start point (ProjectFile.start), lock-aware: used by the "set where your story
   *  starts" prompt that Play from Start / Coverage raise when it is unset. */
  setStart(start: { scene: string; block?: string }): Promise<SaveResult & { project?: OpenedProject }>;
  /** Persist the nav's authored scene order (ProjectFile.sceneOrder), lock-aware. `ids` must be a
   *  permutation of every scene id; a stale list (scene added/removed since the drag) is refused. */
  reorderScenes(ids: string[]): Promise<SaveResult & { project?: OpenedProject }>;
  /** Create a new scene (the minimal playable scaffold) as fresh flow + loc shards, lock-aware.
   *  Returns the refreshed summary and the new scene's id so the renderer can open it. */
  /** New Scene from a kit (main/scene-kits.ts); `speaker` for a kit with lines, added to the cast when new.
   *  With `after` (a scene id) the new scene goes straight after it, written into `sceneOrder` in the same
   *  step; without it, at the end. */
  createScene(name: string, kit?: SceneKitId, speaker?: string, after?: string): Promise<SaveResult & { project?: OpenedProject; sceneId?: string }>;
  /** Move a scene or folder one place up (-1) or down (1) among its siblings in the scene list, one step
   *  of the project history. `moved` is false at the first or last place, where nothing is written. */
  moveScene(sceneId: string, dir: -1 | 1): Promise<SaveResult & { project?: OpenedProject; moved?: boolean }>;
  /** The scene folders this person has closed in a project's list (remembered per person, never in the
   *  project), and a new set of them. */
  closedFolders(projectPath: string): Promise<string[]>;
  setClosedFolders(projectPath: string, ids: string[]): Promise<void>;
  /** Move a scene or folder in the scene list against a target row: before it, after it, or into it (a
   *  folder; a null target with "into" is the top level's end). One step of the project history. */
  placeSceneRow(rowId: string, target: string | null, where: "before" | "after" | "into"): Promise<SaveResult & { project?: OpenedProject }>;
  /** A new scene folder, "New folder" (numbered), straight after `after` (a row id) in the same folder, or
   *  with `inside` (a folder id) at the end of that folder. */
  createSceneFolder(after?: string, inside?: string): Promise<SaveResult & { project?: OpenedProject; folderId?: string }>;
  renameSceneFolder(id: string, name: string): Promise<SaveResult & { project?: OpenedProject }>;
  /** Delete a scene folder: what it holds moves up into its place. Never deletes a scene. */
  deleteSceneFolder(id: string): Promise<SaveResult & { project?: OpenedProject }>;
  /** What deleting a scene would cost - drives the delete confirm's severity: untouched scaffolds
   *  delete silently, content asks, and inbound references list the referring scenes by name. */
  sceneDeleteInfo(sceneId: string): Promise<SceneDeleteInfo | null>;
  /** Delete a scene (flow + every locale's loc shard + authoring shard, lock-aware), cleaning
   *  `sceneOrder` and a `start` that pointed at it. Refuses the last scene. One step of the project history. */
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
  /** A scene's "needs re-record" flags (#227): beat id -> true. */
  readRerecord(sceneId: string): Promise<Record<string, boolean>>;
  /** Persist a scene's "needs re-record" flags (only true kept; empty clears the field). */
  saveRerecord(sceneId: string, map: Record<string, boolean>): Promise<SaveResult>;
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
   *  query the current status, follow a chosen flow (or the most recent one, with null), and subscribe to
   *  status pushes. */
  debugStart(): Promise<DebugStatus>;
  debugStop(): Promise<DebugStatus>;
  debugStatus(): Promise<DebugStatus>;
  debugFollow(flowId: string | null): void;
  onDebugStatus(handler: (status: DebugStatus) => void): void;
  /** Read a scene's "suggest a rewrite" proposals (review flow): open + resolved alike. */
  readSuggestions(sceneId: string): Promise<Suggestion[]>;
  /** Persist a scene's suggestions back to its authoring shard (lock-aware; merges over the rest). */
  saveSuggestions(sceneId: string, suggestions: Suggestion[]): Promise<SaveResult>;
  /** Every piece of feedback across the whole script for the Review Feedback walk (the looping bottom bar):
   *  unresolved comment threads + open rewrite proposals, in scene order. `scope` mirrors the "Show Resolved"
   *  toggles - when a flag is on, that kind's resolved items join the walk too. */
  reviewFeedback(scope?: ReviewScope): Promise<ReviewItem[]>;
  /** Every character and qualifier pair the project's lines use (the whole project, loaded first), for the
   *  Cast tab's "Shown with" fields. */
  speakerPairs(): Promise<Array<{ character: string; qualifier: string }>>;
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
  /** Save the open scene: its flow and loc shards, and the extension shards the editor changed, in one
   *  all-or-nothing batch. */
  saveScene(sceneId: string, flowSource: string, locSource: string, extensions?: SceneExtensionShards): Promise<SaveResult>;
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
  playEdited(sceneId: string, flow: string, loc: string, extensions?: SceneExtensionShards): void;
  /** Subscribe to the editor step-marker (the play window's current beat id, or null to clear). The
   *  beat's `sceneId` lets the editor switch scenes when play crosses into a different one. `optionId`
   *  comes only from the live debug link: a choice frame sent again with the option the game took, which
   *  the editor marks by moving the playhead onto that option's prompt. */
  onPlayMark(handler: (beatId: string | null, sceneId?: string, optionId?: string) => void): void;
  /** "Follow in the editor" is on and the run just played this beat: reveal it. Never focuses. */
  onPlayFollow(handler: (sceneId: string, beatId: string) => void): void;
  /** Subscribe to a play-marks reset (clear the visited trail + playhead). */
  onPlayReset(handler: () => void): void;
  /** Validate the whole project (the CLI's checks): for the problems panel. Reflects disk, unless
   *  `live` is given: the named scene's UNSAVED in-memory source is swapped in first, so problems
   *  track edits as you make them (not just on save). */
  validate(live?: LiveSceneSource): Promise<ProblemsDto>;
  /** Open (or focus) the detached, always-on-top SEARCH tool window in the given mode (#205). `focus`
   *  (the open scene + caret beat) anchors content-search ranking on the current scene from the caret. */
  openSearchWindow(mode: SearchMode, focus?: SearchFocus, query?: string): Promise<void>;
  /** A result was chosen in the search window: jump the editor to it (loadScene + centred reveal). */
  onSearchNavigate(handler: (entry: SearchEntry) => void): void;
  /** Project-wide Replace coordination (the Replace UI lives in the search window): main asks the editor to
   *  flush its open scene before applying (reply with `editorFlushed`), and to reload it after. */
  onEditorFlush(handler: () => void): void;
  /** The window is closing or the app is quitting: write everything still pending. Main holds the close
   *  until the returned promise settles (or a timeout passes), then lets it go on. */
  onFlushBeforeClose(handler: () => Promise<void>): void;
  /** Main asks a question in the app's own chrome, mid-flow; reply with the chosen button's index. */
  onPrompt(handler: (prompt: AppPrompt) => Promise<number>): void;
  editorFlushed(): void;
  /** `announce` is true only for Replace itself; an import or a suggestion decision reloads quietly. */
  onReplaceApplied(handler: (announce: boolean) => void): void;
  /** Open (or focus) the detached COVERAGE results window (#159). */
  openCoverageWindow(): Promise<void>;
  /** Open (or bring forward) the FIELDS window, where a map of records is edited as a grid. */
  openFieldsWindow(): Promise<void>;
  /** What the FIELDS window should show now: sent on every selection or document change. */
  sendFieldsState(state: FieldsWinState): void;
  /** The FIELDS window edited a field: apply it (an undoable step, as the inspector's edits are). */
  onFieldsCommit(handler: (id: string, extension: string, field: string, value: unknown) => void): void;
  /** The FIELDS window started or stopped following the selection: send the state for its node. */
  onFieldsFollow(handler: (on: boolean) => void): void;
  /** File ▸ Add Extension…: main picks a package (a folder or an npm pack .tgz), checks it, writes its manifest
   *  and pin into the project as one undo step, and installs its views on this machine. Null when cancelled
   *  or refused (main has said why). */
  /** File ▸ Add Extension…; with `expect`, the package of that extension, which the project takes but this
   *  machine lacks the views of. */
  addExtension(expect?: string): Promise<AddExtensionResult | null>;
  /** File ▸ Extensions…: open (or bring forward) the Extensions window, on one extension when `focus` names it. */
  openExtensions(focus?: string): Promise<void>;
  /** Remove from Project… (asked for in the Extensions window): main asks first, then takes it out as one step
   *  that keeps its data. Null when refused or cancelled. */
  removeExtension(id: string): Promise<RemoveExtensionResult | null>;
  /** Update… (asked for in the Extensions window): main asks for the package, says what will happen, and does it.
   *  Null when refused, cancelled, or there was nothing to do. */
  updateExtension(id: string): Promise<AddExtensionResult | null>;
  /** Open (or bring forward) a view's window: a field's editor, from the inspector's Edit. */
  openView(extension: string, view: string): Promise<void>;
  /** The views the project offers, and which are installed here, each time main works them out again. */
  onViewOffers(handler: (offers: ViewOfferDto[]) => void): void;
  /** A view extension wrote the project's own values for its extension: replace the project's entry, as one
   *  step of the project history with the view's label. */
  writeProjectExtension(extension: string, entry: Record<string, unknown>, label: string): Promise<SaveResult & { project?: OpenedProject }>;
  /** A row was clicked in the coverage window: jump the editor to that beat (loadScene + reveal). */
  onCoverageNavigate(handler: (sceneId: string, beatId: string) => void): void;
  /** The coverage window's "World Properties…" button: open Project Settings ▸ World Properties. */
  onOpenWorldSettings(handler: () => void): void;
  /** Apply a problem's one-click quick-fix (spec §4); persists + the caller re-validates. */
  applyFix(fix: QuickFix): Promise<SaveResult>;
  /** The stored author identity, or null on first run. */
  getIdentity(): Promise<Identity | null>;
  /** A name to OFFER in the identity box, from the VCS ("bob@bob-ws"). Null when it cannot say.
   *  A suggestion the person types over, never an identity in itself. */
  suggestIdentity(): Promise<string | null>;
  setIdentity(identity: Identity): Promise<void>;
  /** Persist the side-pane (slide/pin) state. Fire-and-forget; also refreshes the View menu checks. */
  setPanes(panes: PaneState): Promise<void>;
  /** Persist the colour / font theme choice (View menu). Fire-and-forget; refreshes the menu checks. */
  setTheme(theme: ThemePrefs): Promise<void>;
  /** Open a URL in the user's browser. Main enforces an allow-list (About-dialog links only). */
  openExternal(url: string): void;
  /** Reveal the open project's folder in the platform file manager. Main uses its own record of the
   *  root (nothing renderer-supplied); a no-op when no project is open. */
  revealProject(): void;
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
  /** Live download progress from the auto-updater, fired while an update downloads. The open updater
   *  dialog (when shown with `progress: true`) renders it as a bar; otherwise it is ignored. */
  onUpdaterDownloadProgress(handler: (p: UpdaterDownloadProgress) => void): void;
  /** An update downloaded on its own and is ready: the renderer shows a "Restart to update" chip in the
   *  top bar (app-shell's showUpdateReady), never a dialog. */
  onUpdaterReady(handler: (info: { appName: string; version: string }) => void): void;
  /** The chip's click: restart and install, after the usual unsaved-edits question. */
  updaterRestart(): void;
  /** The command palette (Cmd+K): the live application menu, flattened (app-shell palette-main). */
  paletteCommands(): Promise<MenuCommand[]>;
  /** Run a menu item the palette picked, as clicking it would. */
  paletteRun(id: string): void;
  /** What's New at launch: this version, the one before it, and the tickbox (app-shell whats-new-main). */
  whatsNewState(): Promise<WhatsNewState>;
  /** The "Show what's new after updates" tickbox. */
  setWhatsNewShow(show: boolean): void;
  /** The launch dialog was closed: main stops giving the launch answer. */
  whatsNewSeen(): void;
}

/** A themed auto-update prompt (the in-app replacement for dialog.showMessageBox). */
export interface UpdaterPromptOptions {
  /** The headline line (shown as the dialog title). */
  message: string;
  /** Supporting copy; `\n` line breaks are preserved. */
  detail?: string;
  /** Button labels, left to right; the resolved index matches this array. */
  buttons: string[];
  /** Optional links shown between the copy and the buttons. Clicks route through
   *  openExternal, so only allow-listed URLs actually open. (The About dialog was
   *  the original user of this and of the wordmark; both are the shell's now.) */
  links?: { label: string; url: string }[];
  /** Show a live download-progress bar under the copy, fed by onUpdaterDownloadProgress. */
  progress?: boolean;
  /** The highlighted / Enter-default button (defaults to 0). */
  defaultId?: number;
  /** The button Esc maps to (defaults to the last). */
  cancelId?: number;
}

/** One download-progress tick (electron-updater's ProgressInfo, plus the version being fetched). */
export interface UpdaterDownloadProgress {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
  version: string;
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
    /** Present only in the detached fields window. */
    patterFields?: PatterFieldsApi;
    patterExtensions?: PatterExtensionsApi;
  }
}
