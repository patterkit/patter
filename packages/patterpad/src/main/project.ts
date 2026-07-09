// The project session: all @patterkit/ops integration for one open project, held in the main process
// (the renderer reaches it only through IPC). Open / read a scene's source / save it back / play /
// create a new project. Writes go through @wildwinter/simple-vc-lib (lock-aware checkout-on-write for
// Perforce/Plastic; a plain write for git/none), falling back to a direct write if the VC layer throws.

import { existsSync, readFileSync, statSync, mkdirSync, writeFileSync, cpSync } from "node:fs";
import { basename, dirname, join, isAbsolute, resolve, sep } from "node:path";
import { loadProject, loadProjectLanding, sceneIdForShard, findProjectFile, runExport, runExportFull, runExportHtml, runExportWeb, runInit, runPack, runUnpack, vcsConfigWrites, runValidate, applyWrites, runSearch, runStatusBrowse, runPropertyUsage, runTagBrowse, listProjectTags, runReplace, runReport, runReportXlsx, runCoverage, proposeCoverageDrivers as proposeDrivers,
  extractLoc, applyLoc, catalogToJson, jsonToCatalog, catalogToPo, poToCatalog, catalogToXlsx, xlsxToCatalog,
  runVoiceScript, voiceScriptToXlsx, runScriptDoc, scriptToDocx, scriptToPdf,
  type LoadedProject, type ReportData, type SearchFocus, type ReplaceOptions, type ReplaceHit } from "@patterkit/ops";
import { Engine, type Flow, type StepResult, type ChoiceOption } from "@patterkit/runtime";
import { parseSource, canonicalStringify, newId, slug } from "@patterkit/core";
import { walkNodes, effectiveGameId, deriveRecordingFolders, DEFAULT_WRITING_STATUSES, DEFAULT_RECORDING_STATUSES, DEFAULT_CAPTION_DELIMITERS, DEFAULT_CAPTION_CHARACTER } from "@patterkit/model";
import type { AuthoringFile, Comment, Suggestion, DocLine, Group, Snippet, Scene, FlowFile, LocaleFile, ProjectFile, ProjectDictionary, VcsKind, CaptionDelimiters, EstimatingConfig } from "@patterkit/model";
import type { ReviewItem } from "../shared/api.js";
import { writeTextFilesAsync, writeBinaryFileAsync, fileStatusAsync, deleteFileAsync } from "@wildwinter/simple-vc-lib";
import type { OpenedProject, ProjectSettingsDto, SceneSource, SceneDeleteInfo, SaveResult, PlayBatch, PlayStep, PlayChoiceOption, Problem, ProblemsDto, ConditionProperty, SearchEntry, QuickFix, VcStatusDto, SceneVcStatus, CoverageRunOptions, CoverageResult } from "../shared/api.js";
import type { CoverageDriver } from "@patterkit/model";
import { startAudioIndex, audioManifest, AUDIO_MANIFEST_FILE, type AudioIndexHandle, type AudioSnapshot } from "./audio-index.js";

interface SceneShards {
  flowPath: string;
  locPath: string | null;
  /** This scene's authoring shard (created on first save with an edit record). */
  authoringPath: string;
  name: string;
}

// `loaded` is the authoritative IN-MEMORY project: parsed once on open, then kept in sync on every
// save / quick-fix. validate / play work off it (no per-call disk re-read + re-parse of the whole
// project, which used to run on every keystroke-driven `validate(live)`). External edits made outside
// the app are picked up on the next open, not live.
let loaded: LoadedProject | null = null;
let shards = new Map<string, SceneShards>();

// Lazy open (#171): `openProject` parses ONLY the landing scene (phase 1), so the editor paints fast; the
// rest of the project is parsed on demand (phase 2). `hydrated` is false in that window. Any operation
// that needs the WHOLE project (search / validate-all / report / play / review / VC sweep, or reading a
// scene other than the landing one) calls `ensureHydrated()` first - a no-op once the full parse is in.
let hydrated = true;

/** Finish the lazy open: swap the landing-only `loaded` for the full eager parse (all scenes / locales /
 *  authoring) and rebuild the shard map. A no-op once already hydrated. Throws only if the project on disk
 *  is broken (e.g. duplicate scene ids) - the same failure the eager open used to raise. */
function ensureHydrated(): void {
  if (hydrated || !loaded) return;
  loaded = loadProject(loaded.root);
  shards = buildShards(loaded);
  authoringCache.clear();
  hydrated = true;
}

/** A shallow working copy whose `scenes` / `locales` arrays can be element-swapped (by applyLiveSource)
 *  without corrupting the cached `loaded` truth. The scene / locale OBJECTS are shared - callers only
 *  read them or replace whole array slots, never mutate in place. */
function workingCopy(p: LoadedProject): LoadedProject {
  return { ...p, scenes: [...p.scenes], locales: [...p.locales] };
}

function buildShards(p: LoadedProject): Map<string, SceneShards> {
  const map = new Map<string, SceneShards>();
  const defaultLocale = p.project.locales.default;
  const authoringDir = join(p.root, p.project.layout?.authoring ?? "authoring");
  for (const scene of p.scenes) {
    let locPath: string | null = null;
    let fallback: string | null = null;
    p.locales.forEach((loc, i) => {
      if (loc.scene !== scene.id) return;
      fallback ??= p.localeFiles[i] ?? null;
      if (loc.locale === defaultLocale || loc.default) locPath = p.localeFiles[i] ?? null;
    });
    const flowPath = p.sceneFiles[scene.id] ?? "";
    // The authoring shard mirrors the flow shard's stem (scenes/foo.patterflow -> authoring/foo.patterx).
    const authoringPath = join(authoringDir, basename(flowPath).replace(/\.patterflow$/, ".patterx"));
    map.set(scene.id, { flowPath, locPath: locPath ?? fallback, authoringPath, name: scene.name });
  }
  sourceMirror.clear(); // the shard set changed - drop the source mirror + the vcStatus path memo
  vcPathsMemo = null;
  return map;
}

// Parsed .patterx shards, cached by path + mtime so reviewFeedback's cross-scene sweep (and repeated
// Show-Resolved toggles) don't re-PARSE every unchanged shard each call - only a cheap stat + a clone.
// The cache is busted whenever we write a shard (commitWrites) and cleared on openProject.
const authoringCache = new Map<string, { mtimeMs: number; af: AuthoringFile }>();

// readScene / saveScene serve + diff against an in-memory MIRROR of each scene's on-disk source (flow +
// loc) - the EXACT last-read / last-written bytes (no re-serialisation) - so a scene switch doesn't sync-read
// both shards and a save doesn't sync-read them just to diff. Refreshed on every read + successful save;
// dropped whenever the shard map is rebuilt (open / hydrate / loc-import). External edits to a scene's
// source are picked up on reopen, matching how the parsed `loaded` model already behaves.
const sourceMirror = new Map<string, { flow: string; loc: string }>();
// vcStatus's per-shard path list (+ which scene each path belongs to). Rebuilt only when the shard set
// changes (buildShards) or a write may have created a new shard (commitWrites) - not on every poll.
let vcPathsMemo: { paths: string[]; sceneOf: Map<string, string> } | null = null;

/** Read a scene's authoring shard, or a fresh empty one if it's missing / corrupt (a hand-broken .patterx
 *  degrades to "no authoring" rather than throwing). The single place the shard is parsed. Returns a CLONE
 *  every time, so callers (the merge-writers) can mutate it freely without corrupting the cache. */
function loadAuthoring(authoringPath: string): AuthoringFile {
  let mtimeMs: number;
  try { mtimeMs = statSync(authoringPath).mtimeMs; }
  catch { return { schema: "patter/authoring@0" }; } // missing -> fresh
  const hit = authoringCache.get(authoringPath);
  if (hit && hit.mtimeMs === mtimeMs) return structuredClone(hit.af);
  try {
    const af = parseSource(readFileSync(authoringPath, "utf8")) as AuthoringFile;
    authoringCache.set(authoringPath, { mtimeMs, af });
    return structuredClone(af);
  } catch { return { schema: "patter/authoring@0" }; } // corrupt -> start fresh
}

/** A planned write that MERGES a mutation into a scene's authoring shard, preserving every other block
 *  (docs / comments / suggestions / status / edit-trail) so nothing is lost. The single read-modify-write
 *  path for the shard. */
function authoringWrite(s: SceneShards, mutate: (af: AuthoringFile) => void): { path: string; content: string; af: AuthoringFile } {
  const authoring = loadAuthoring(s.authoringPath);
  mutate(authoring);
  return { path: s.authoringPath, content: canonicalStringify(authoring), af: authoring };
}

/** Refresh the in-memory model's authoring entry for a shard we just wrote, so whole-project reads (the
 *  production report walks `loaded.authoring`) reflect the edit without a reopen. The flow / loc savers do
 *  the equivalent via applyLiveSource; the authoring shards (writing / recording / docs / comments /
 *  suggestions) need this. We feed in the just-mutated `af` (which we serialised to disk) so this costs
 *  nothing - no disk re-read + re-parse of content we already hold in hand. */
function syncAuthoringModel(s: SceneShards, af: AuthoringFile): void {
  if (!loaded) return;
  const i = loaded.authoringFiles.indexOf(s.authoringPath);
  if (i >= 0) loaded.authoring[i] = af;
  else { loaded.authoringFiles.push(s.authoringPath); loaded.authoring.push(af); }
}

/** Land an authoring-shard write and, on success, keep the in-memory model current (see syncAuthoringModel). */
async function commitAuthoring(s: SceneShards, write: { path: string; content: string; af: AuthoringFile }): Promise<SaveResult> {
  const res = await commitWrites([write]);
  if (res.ok) syncAuthoringModel(s, write.af);
  return res;
}

/** Build the planned write that stamps `edits[sceneId] = { modifiedAt, by }` into the scene's authoring
 *  shard (merged over any existing authoring, so comments / docs / status are untouched). */
function editTrailWrite(s: SceneShards, sceneId: string, author: string): { path: string; content: string } {
  return authoringWrite(s, (af) => {
    af.edits = { ...af.edits, [sceneId]: { ...af.edits?.[sceneId], modifiedAt: new Date().toISOString(), by: author } };
  });
}

// The built-in spell-check dictionary ids (mirrors dictionaries.ts BUILTINS). Kept a plain const here -
// NOT imported from dictionaries.ts - so this module (and its Node tests) never pull in `electron`.
const BUILTIN_DICT_IDS = ["en-US", "en-GB"] as const;
/** The dictionary to default to for a source locale: an exact id match, else the first built-in sharing the
 *  primary subtag (e.g. "en" -> "en-US"), else en-US. */
function deriveDictLanguage(locale: string): string {
  if ((BUILTIN_DICT_IDS as readonly string[]).includes(locale)) return locale;
  const primary = (locale.split(/[-_]/)[0] ?? "").toLowerCase();
  return BUILTIN_DICT_IDS.find((id) => id.split("-")[0]!.toLowerCase() === primary) ?? "en-US";
}
/** The resolved spell-check setup for a project (language defaulted from the source locale when unset). */
function resolveDictionary(p: ProjectFile): { language: string; words: string[]; ignore: string[]; enabled: boolean } {
  const d = p.dictionary;
  return { language: d?.language ?? deriveDictLanguage(p.locales.default), words: d?.words ?? [], ignore: d?.ignore ?? [], enabled: d?.enabled ?? true };
}
/** The `dictionary` field to persist from the settings DTO, dropping anything that matches a default so a
 *  project that takes the standard spell-check setup keeps a clean file. */
function dictionaryFile(s: ProjectSettingsDto): ProjectDictionary | undefined {
  const words = s.dictionaryWords.map((w) => w.trim()).filter(Boolean);
  const ignore = s.dictionaryIgnore.map((w) => w.trim()).filter(Boolean);
  const d: ProjectDictionary = {};
  if (s.dictionaryLanguage && s.dictionaryLanguage !== deriveDictLanguage(s.localeDefault)) d.language = s.dictionaryLanguage;
  if (words.length) d.words = words;
  if (ignore.length) d.ignore = ignore;
  if (!s.dictionaryEnabled) d.enabled = false; // default is on; store only when the author turned it off
  return Object.keys(d).length ? d : undefined;
}

function summarise(p: LoadedProject): OpenedProject {
  return {
    name: p.project.project.name,
    root: p.root,
    formatting: p.project.formatting ?? true,
    autosave: p.project.autosave ?? true,
    voiced: p.project.voiced ?? false,
    trackAudioStatus: (p.project.voiced ?? false) && (p.project.trackAudioStatus ?? false),
    cast: (p.project.cast ?? []).map((c) => c.name),
    gameDataFields: p.project.gameDataFields ?? {},
    scenes: p.scenes.map((s) => ({ id: s.id, name: s.name, blocks: s.blocks.map((b) => ({ id: b.id, name: b.name })) })),
    sceneIds: p.scenes.map((s) => s.id),
    dictionary: resolveDictionary(p.project),
    writingStatuses: p.project.writingStatuses ?? DEFAULT_WRITING_STATUSES,
    recordingStatuses: p.project.recordingStatuses ?? DEFAULT_RECORDING_STATUSES,
    audioFolders: p.project.audioFolders ?? false,
    audioRoot: p.project.audioRoot ?? null,
    scratchStatus: p.project.scratchStatus ?? null,
  };
}

/** Write through the VC layer (lock-aware); fall back to a plain write if it throws. */
// Every write op is SERIALIZED through this chain so concurrent saves never interleave their read-modify-
// write (the no-clobber guarantee the old synchronous writes gave for free - kept now the VC layer runs OFF
// the main-process thread, #151). A failing op doesn't break the chain for the next.
let writeChain: Promise<unknown> = Promise.resolve();
function enqueueWrite<T>(op: () => Promise<T>): Promise<T> {
  const run = writeChain.then(op, op);
  writeChain = run.then(() => undefined, () => undefined);
  return run;
}

// Land a batch of writes through the VC layer OFF the main thread (lock-aware checkout-on-write); fall back
// to a direct write when no VC tooling is present. Always called from inside an enqueueWrite section.
async function commitWrites(writes: { path: string; content: string }[]): Promise<SaveResult> {
  for (const w of writes) authoringCache.delete(w.path); // a shard we just wrote must be re-read, not served stale
  vcPathsMemo = null; // a write may have CREATED a shard (first loc / authoring write) - re-collect paths next poll
  const ok = (): SaveResult => { maybeScheduleAutoRebuild(writes); return { ok: true }; };
  try {
    const batch = await writeTextFilesAsync(writes.map((w) => ({ filePath: w.path, content: w.content })));
    if (batch.success) return ok();
    const failed = batch.results.filter((r) => !r.success).map((r) => r.message ?? r.status).join("; ");
    return { ok: false, error: failed || "write failed" };
  } catch {
    try { applyWrites(writes); return ok(); } // VC layer unavailable -> direct write
    catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  }
}

// --- Audio Folders index (#206) ----------------------------------------------------------------------
// When the project opts into Audio Folders, a self-contained indexer watches each rung's folder and
// derives every dialogue line's recording status from the files on disk. The latest snapshot is cached
// here and pushed to the renderer; `runStatusBrowse` / `runReport` also consult it (folder mode overrides
// the manual per-line recording map). The indexer lives off the event loop (async readdir + fs.watch), so
// scanning never hitches the editor.
let audioIndex: AudioIndexHandle | null = null;
let audioSnapshot: AudioSnapshot = {};
let audioListener: (snap: AudioSnapshot) => void = () => {};

/** Register the renderer-push callback (called by the IPC layer once the window exists). */
export function onAudioSnapshot(cb: (snap: AudioSnapshot) => void): void { audioListener = cb; }
/** The current folder-derived snapshot (for the renderer's initial load + ops overrides). */
export function audioCurrentSnapshot(): AudioSnapshot { return audioSnapshot; }
/** beatId -> derived recording status when Audio Folders is on (else undefined, so ops fall back to the
 *  manual per-line recording map). Used to override `runStatusBrowse` / `runReport` in folder mode. */
/** Whether the project tracks audio/recording status at all (#206): a voiced project that hasn't opted out
 *  via `trackAudioStatus`. Gates the inspector's Audio row, the recording status menu/search, folders +
 *  scratch. Absent `trackAudioStatus` follows `voiced` (voiced projects track by default). */
export function isAudioTracked(): boolean {
  const p = loaded?.project;
  return !!p?.voiced && (p.trackAudioStatus ?? false);
}
/** Audio (the folder index, derived status, scratch takes, playback) is only meaningful when the project
 *  tracks audio status AND `audioFolders` is set; the stored flags are kept so flipping Voiced / tracking
 *  back on restores the setup. Every audio behaviour here gates on this, not on `audioFolders` alone. */
function audioActive(): boolean { return isAudioTracked() && !!loaded?.project.audioFolders; }

function recordingOverride(): Map<string, string> | undefined {
  if (!audioActive()) return undefined;
  const m = new Map<string, string>();
  for (const [id, e] of Object.entries(audioSnapshot)) m.set(id, e.status);
  return m;
}

/** Whether the loaded project is in Audio Folders mode (drives the play window's "Play with audio" + the
 *  inspector's folder-derived chip / play button). */
export function audioFoldersEnabled(): boolean { return audioActive(); }

/** The audio bytes for a dialogue beat in Audio Folders mode (the file the indexer resolved), or null if
 *  there's no file / not in folder mode. Read on demand for playback (editor inspector + play window). The
 *  renderer wraps the bytes in a Blob to play - avoids a custom protocol + keeps file access in main. */
export function audioBytesForBeat(beatId: string): { bytes: Buffer; mime: string } | null {
  const entry = audioActive() ? audioSnapshot[beatId] : undefined;
  if (!entry) return null;
  try {
    const bytes = readFileSync(entry.path);
    return { bytes, mime: entry.path.toLowerCase().endsWith(".mp3") ? "audio/mpeg" : "audio/wav" };
  } catch { return null; } // file vanished between scan + read
}

/** Save an in-app scratch take (#224): write the encoded WAV bytes to `<scratchRung.folder>/<beatId>.wav`,
 *  lock-aware (binary VC write), then poke the indexer to rescan. The folder watcher usually catches the
 *  new file anyway, but the explicit rescan makes the status refresh DETERMINISTIC: the very first take
 *  CREATES its folder (which had no watcher yet), and fs.watch is unreliable on some Windows filesystems.
 *  No-op unless the project is in folder mode with scratch recording enabled. */
export function saveScratchAudio(beatId: string, bytes: Uint8Array): Promise<SaveResult> {
  return enqueueWrite(async () => {
    const p = loaded?.project;
    if (!audioActive() || !p?.scratchStatus) return { ok: false, error: "scratch recording not enabled" };
    const folders = deriveRecordingFolders(p.audioRoot, p.recordingStatuses ?? DEFAULT_RECORDING_STATUSES);
    const folder = folders.find((r) => r.name === p.scratchStatus)?.folder;
    if (!folder) return { ok: false, error: "the scratch status has no derived folder (set an audio root)" };
    const dir = resolve(loaded!.root, folder);
    const path = join(dir, `${beatId}.wav`);
    try { mkdirSync(dir, { recursive: true }); } catch { /* already there */ }
    try { await writeBinaryFileAsync(path, Buffer.from(bytes)); audioIndex?.rescan(); return { ok: true }; }
    catch {
      try { writeFileSync(path, Buffer.from(bytes)); audioIndex?.rescan(); return { ok: true }; } // VC layer unavailable -> direct write
      catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
    }
  });
}

/** (Re)build or tear down the audio indexer to match the loaded project's audio config. Idempotent;
 *  call on open + whenever the audio settings change. */
function syncAudioIndex(): void {
  if (!audioActive()) { // mode off (or un-voiced) -> drop the index + tell the renderer it's empty
    audioIndex?.dispose(); audioIndex = null;
    if (Object.keys(audioSnapshot).length) { audioSnapshot = {}; audioListener(audioSnapshot); }
    return;
  }
  const p = loaded!.project; // audioActive() guarantees a loaded, voiced, folder-mode project
  const rungs = deriveRecordingFolders(p.audioRoot, p.recordingStatuses ?? DEFAULT_RECORDING_STATUSES);
  const scratch = p.scratchStatus ?? undefined; // read scratch takes' stamped text-hash (staleness, #224)
  const onSnap = (snap: AudioSnapshot): void => { audioSnapshot = snap; audioListener(snap); };
  if (audioIndex) audioIndex.update(rungs, scratch);
  else audioIndex = startAudioIndex(loaded!.root, rungs, onSnap, scratch);
}

/** Open a project LANDING-FIRST (#171): parse only the scene the editor is about to paint (the launch
 *  shard, else `preferLanding`, else the first scene) so the window comes up fast; the rest streams in on
 *  the renderer's `hydrate()` call (or the first whole-project operation). `path` may be the project root,
 *  the `.patter` package, or an internal shard - either way the enclosing `.patterproj` is resolved. */
export function openProject(path: string, preferLanding?: string): OpenedProject {
  loaded = loadProjectLanding(path, { launchPath: path, preferId: preferLanding });
  shards = buildShards(loaded);
  playLocale = null;           // a fresh project starts in its own source language (#195)
  playCaptionsOn = true;       // closed captions default ON in the play window (#214)
  hydrated = false;            // landing-only; the rest is parsed on hydrate() / first whole-project op
  resetRemoteStatusThrottle(); // a new project's lock/out-of-date state must be re-queried, not inherited
  resetPlaySession();          // and no stale play state from the project we just left
  authoringCache.clear();      // and no parsed shards cached from the previous project
  if (autoRebuildTimer) { clearTimeout(autoRebuildTimer); autoRebuildTimer = null; } // drop a pending rebuild for the old project
  lastBuiltHash = undefined;   // the Auto-Rebuild dedup must not carry across projects
  syncAudioIndex();            // start / stop the Audio Folders watcher for the new project (#206)
  return summarise(loaded);
}

/** Finish the lazy open and return the FULL project summary (every scene), so the renderer can reconcile
 *  its nav + cross-scene jump targets once the landing scene is painted. Called by the renderer right
 *  after the first scene mounts; idempotent (later whole-project ops would force it anyway). */
export function hydrate(): OpenedProject | null {
  ensureHydrated();
  return loaded ? summarise(loaded) : null;
}

/** The open project's root folder on disk (the `.patter` package), or null if nothing is open. Used by
 *  Save As to know what to duplicate. */
export function currentRoot(): string | null {
  return loaded?.root ?? null;
}

/** Save As: duplicate the open project's `.patter` folder to `dest`, EXCLUDING derived artefacts - the
 *  source authoring should travel, the generated output should not. Skips: the audio root (#206 - recorded
 *  takes, in-app scratch recordings, and the generated `patteraudio.json`), and a compiled bundle
 *  pinned INSIDE the project (the default build output is a SIBLING `patter-dist/`, never reached by a copy
 *  of the root). A skipped directory takes its whole subtree with it (cpSync doesn't recurse past it). */
export function duplicateTo(dest: string): void {
  if (!loaded) throw new Error("no project open");
  const root = loaded.root;
  const excluded = new Set<string>();
  const audioRoot = loaded.project.audioRoot?.trim();
  if (audioRoot) excluded.add(resolve(root, audioRoot)); // audio outputs + manifest (all derived) don't travel
  const bundle = loaded.project.export?.bundle;
  if (bundle) {
    const abs = isAbsolute(bundle) ? bundle : resolve(root, bundle);
    // Only when it lands inside the project: exclude its build directory, or just the file if it sits in root.
    if (abs.startsWith(root + sep)) excluded.add(dirname(abs) === root ? abs : dirname(abs));
  }
  cpSync(root, dest, { recursive: true, filter: (src) => !excluded.has(resolve(src)) });
}

/** Export as Patterpack: zip the open project's source shards into a single `.patterpack` document,
 *  the "send this to someone" file. Source only - `runPack` follows `SHARD_EXTENSIONS`, so recorded audio
 *  and build artefacts never travel (same posture as `duplicateTo`). Returns the zip bytes for the caller
 *  to write wherever the user chose. */
export async function packBytes(): Promise<Buffer> {
  if (!loaded) throw new Error("no project open");
  return runPack(loaded.root);
}

/** Unpack a `.patterpack` document (chosen by the caller) into a fresh `.patter` folder at `destDir`, ready
 *  to open. The shards are project-root-relative, so `destDir` IS the new project folder. Writes go through
 *  the VC-aware path (like `createProject`), so unpacking inside a git working copy stages the new files.
 *  `runUnpack` validates every entry path (no traversal / no escape). */
export async function unpackTo(packPath: string, destDir: string): Promise<{ ok: boolean; error?: string }> {
  return enqueueWrite(async () => {
    try {
      const bytes = readFileSync(packPath);
      const writes = await runUnpack(bytes, destDir);
      if (!writes.length) return { ok: false, error: "the patterpack has no project files" };
      return await commitWrites(writes);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}

/** The enclosing project root for a path, resolved cheaply (no scene parse) so the caller can look up the
 *  remembered scene before the landing-first open. Undefined when `path` is not inside a project. */
export function peekRoot(path: string): string | undefined {
  try { return dirname(findProjectFile(path)); } catch { return undefined; }
}

/** The scene a launch path points at, if `path` is one of that scene's shards (.patterflow / .patterloc /
 *  .patterx) - so a file-association launch (Finder / argv) can jump straight to it. Returns undefined for
 *  the project root / `.patter` package / any non-scene path, so the caller lands on the remembered scene
 *  instead. Resolved directly from the shard (no dependency on the lazy-load hydration state). */
export function sceneForPath(path: string): string | undefined {
  return sceneIdForShard(path);
}

/** Cheap structural equality (the status ladders are small, plain, order-stable JSON). */
const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The properties referenceable in a scene's conditions: project globals (`@patter`) + scene-locals (`@scene`).
 *  Patter's property types are the same vocabulary as the condition editor's, so no mapping is needed. */
function sceneProperties(sceneId: string): ConditionProperty[] {
  const out: ConditionProperty[] = [];
  for (const d of loaded?.project.properties ?? []) out.push({ scope: "patter", name: d.name, type: d.type, enumValues: d.values, purpose: d.purpose });
  const scene = loaded?.scenes.find((s) => s.id === sceneId);
  for (const d of scene?.sceneProps ?? []) out.push({ scope: "scene", name: d.name, type: d.type, enumValues: d.values, purpose: d.purpose });
  return out;
}

/** The MAIN search (spec §6): Game ID, scene/block title, and dialogue/text content - the ⌘F palette. */
export function searchProject(query: string, focus?: SearchFocus): SearchEntry[] {
  if (!query.trim()) return [];
  ensureHydrated(); // search spans every scene
  if (!loaded) return [];
  return runSearch(loaded, query, focus).slice(0, 50);
}

/** Status browse (#205 / #206): every line (+ text, for writing) beat at `status` across the project
 *  (unset = lowest rung), the caret's scene first. `dimension` picks the writing or recording ladder. */
export function linesByStatus(status: string, dimension: "writing" | "recording", focus?: SearchFocus): SearchEntry[] {
  if (!status) return [];
  ensureHydrated(); // spans every scene
  if (!loaded) return [];
  return runStatusBrowse(loaded, status, dimension, focus, dimension === "recording" ? recordingOverride() : undefined).slice(0, 500);
}

/** Property-usage search: every node referencing a property in a condition / effect / interpolated text. */
export function propertyUsage(query: string, focus?: SearchFocus): SearchEntry[] {
  if (!query.trim()) return [];
  ensureHydrated(); // spans every scene's expressions
  if (!loaded) return [];
  return runPropertyUsage(loaded, query, focus).slice(0, 200);
}

/** Tag browse (#215): every node whose own author tags include `tag`, the caret's scene first. */
export function tagUsage(tag: string, focus?: SearchFocus): SearchEntry[] {
  if (!tag.trim()) return [];
  ensureHydrated(); // spans every scene
  if (!loaded) return [];
  return runTagBrowse(loaded, tag, focus).slice(0, 500);
}

/** The distinct author tags in the project + node counts, for the search window's Tag tab chips. */
export function tagList(): Array<{ name: string; count: number }> {
  ensureHydrated(); // tags live on nodes across every scene
  if (!loaded) return [];
  return listProjectTags(loaded);
}

/** Replace PREVIEW (no writes): the source-prose hits a project-wide replacement would make (#231 follow-up). */
export function replacePreview(opts: ReplaceOptions): { hits: ReplaceHit[]; scenes: number } {
  if (!opts.query.trim()) return { hits: [], scenes: 0 };
  ensureHydrated(); // spans every scene
  if (!loaded) return { hits: [], scenes: 0 };
  const plan = runReplace(loaded, opts);
  return { hits: plan.hits.slice(0, 500), scenes: plan.scenes };
}

/** Replace APPLY: commit the rewritten shards through the VC layer, then swap them into the in-memory model
 *  (so the open scene reloads with the new text). The open scene is flushed to disk by the caller first. */
export function applyReplace(opts: ReplaceOptions): Promise<SaveResult & { count: number; scenes: number }> {
  return enqueueWrite(async () => {
    if (!loaded) return { ok: false, error: "no project open", count: 0, scenes: 0 };
    if (!opts.query.trim()) return { ok: true, count: 0, scenes: 0 };
    ensureHydrated();
    const plan = runReplace(loaded, opts);
    if (plan.writes.length === 0) return { ok: true, count: 0, scenes: 0 };
    const res = await commitWrites(plan.writes);
    if (!res.ok) return { ...res, count: 0, scenes: 0 };
    // Swap the rewritten shards into the working copy (element-swap busts the search index cache + makes the
    // open scene's reload read the new strings).
    for (const ns of plan.shards) {
      const i = loaded.locales.findIndex((l) => l.scene === ns.scene && l.locale === ns.locale);
      if (i >= 0) loaded.locales[i] = ns;
    }
    return { ok: true, count: plan.hits.length, scenes: plan.scenes };
  });
}

/** Is a project open? The detached search window asks before it offers to search. */
export function hasProject(): boolean {
  return !!loaded;
}

/** Whether the open project is VOICED (#206) - gates voice-script export + recording stats in the menu /
 *  report. False when nothing is open. */
export function isVoiced(): boolean {
  return !!loaded?.project.voiced;
}

/** The project's writing-status ladder (name + palette colour) for the search window's status chips.
 *  Reads the landing-phase project meta (no full hydrate needed). */
export function writingStatusLadder(): Array<{ name: string; colour?: number }> {
  const ladder = loaded?.project.writingStatuses ?? DEFAULT_WRITING_STATUSES;
  return ladder.map((s) => ({ name: s.name, colour: s.colour }));
}

/** The project's recording-status ladder (name + palette colour), for the search window's status chips (#206). */
export function recordingStatusLadder(): Array<{ name: string; colour?: number }> {
  const ladder = loaded?.project.recordingStatuses ?? DEFAULT_RECORDING_STATUSES;
  return ladder.map((s) => ({ name: s.name, colour: s.colour }));
}

export function readScene(sceneId: string): SceneSource {
  if (!shards.has(sceneId)) ensureHydrated(); // a scene other than the landing one: parse the rest first
  const s = shards.get(sceneId);
  if (!s) throw new Error(`unknown scene: ${sceneId}`);
  let src = sourceMirror.get(sceneId);
  if (!src) { // first read of this scene this session - hit disk once, then serve from the mirror
    src = { flow: readFileSync(s.flowPath, "utf8"), loc: s.locPath ? readFileSync(s.locPath, "utf8") : "" };
    sourceMirror.set(sceneId, src);
  }
  return {
    flowSource: src.flow,
    locSource: src.loc,
    sceneName: s.name,
    properties: sceneProperties(sceneId),
  };
}

export function saveScene(sceneId: string, flowSource: string, locSource: string, author?: string): Promise<SaveResult> {
  return enqueueWrite(async () => {
    const s = shards.get(sceneId);
    if (!s) return { ok: false, error: `unknown scene: ${sceneId}` };
    // Only write the shards whose content actually changed. An unchanged save must NOT rewrite the files
    // (no spurious VCS churn) nor bump the .patterx edit-trail (modifiedAt). Diff against the in-memory
    // mirror (the last bytes we read / wrote) instead of re-reading disk; fall back to a read only when the
    // scene was never read this session. A missing file always "changed".
    const onDisk = (p: string): string | null => { try { return readFileSync(p, "utf8"); } catch { return null; } };
    const prev = sourceMirror.get(sceneId);
    const prevFlow = prev ? prev.flow : onDisk(s.flowPath);
    const prevLoc = prev ? prev.loc : (s.locPath ? onDisk(s.locPath) : "");
    const writes: { path: string; content: string }[] = [];
    if (prevFlow !== flowSource) writes.push({ path: s.flowPath, content: flowSource });
    if (s.locPath && prevLoc !== locSource) writes.push({ path: s.locPath, content: locSource });
    if (!writes.length) return { ok: true }; // nothing changed -> leave the shards (and the edit-trail) untouched
    if (author) writes.push(editTrailWrite(s, sceneId, author)); // stamp the author only when a real change lands
    const res = await commitWrites(writes);
    if (res.ok) {
      sourceMirror.set(sceneId, { flow: flowSource, loc: locSource }); // the mirror now matches what we wrote
      // Keep the in-memory project current with the save, so validate / play don't re-read disk.
      try { if (loaded) applyLiveSource(loaded, { sceneId, flow: flowSource, loc: locSource }); }
      catch (e) { console.warn(`patterpad: saved scene ${sceneId} but couldn't refresh the in-memory copy (reloads on reopen):`, e); }
    }
    return res;
  });
}

/** A version-control snapshot per scene (#145), folded from one batched `fileStatusAsync` call over
 *  every scene's shards. The current user holding a file = checkedOutByMe (still editable); anyone else
 *  = lockedBy (read-only for us). `writable` is the on-disk read-only bit (the lock-VCS gate).
 *
 *  ASYNC + off the main thread: `fileStatusAsync` spawns the VCS query without blocking the Electron
 *  main-process event loop, so a slow `svn status -u` / `cm fileinfo` no longer freezes saves / opens /
 *  play while the renderer polls. `remote: true` permits the server round-trip SVN / Plastic need to
 *  learn `lockedBy` / `outOfDate` (Perforce + git-LFS carry that locally) - the whole point of the
 *  badge - which is exactly the slow path the async call keeps off the main thread.
 *
 *  Best-effort: if the VC query throws, every scene reports clean + writable so the editor never wedges. */
// The remote VC round-trip (lockedBy / outOfDate - the server hit SVN / Plastic need) is THROTTLED: the
// local bits (writable / dirty / checkedOutByMe / untracked) refresh on every call so a save re-badges at
// once, but the remote bits are re-queried at most once per window and otherwise reused from this cache.
// That keeps bursty triggers (save + focus + the poll timer) from hammering the server. Reset on open.
const REMOTE_STATUS_THROTTLE_MS = 15_000;
let lastRemoteStatusAt = 0;
let cachedRemoteBits = new Map<string, { lockedBy?: string[]; outOfDate?: boolean }>();
function resetRemoteStatusThrottle(): void { lastRemoteStatusAt = 0; cachedRemoteBits = new Map(); }

export async function vcStatus(): Promise<VcStatusDto | null> {
  if (!loaded) return null;
  ensureHydrated(); // badge every scene, not just the landing one
  const vcs = loaded.project.vcs ?? "none";
  // Each scene's existing shard paths (flow always; loc / authoring when present), and a flat list to
  // query in ONE spawn. Memoised across polls (rebuilt only when the shard set or a write invalidates it),
  // so the per-poll existsSync sweep doesn't run every 30s / focus / save.
  if (!vcPathsMemo) {
    const sceneOf = new Map<string, string>();
    const paths: string[] = [];
    for (const [sceneId, s] of shards) {
      for (const p of [s.flowPath, s.locPath, s.authoringPath]) {
        if (p && existsSync(p)) { paths.push(p); sceneOf.set(p, sceneId); }
      }
    }
    vcPathsMemo = { paths, sceneOf };
  }
  const { paths, sceneOf } = vcPathsMemo;
  let system = vcs === "none" ? "filesystem" : vcs;
  const status = new Map<string, SceneVcStatus>();
  for (const s of shards.keys()) status.set(s, { sceneId: s, writable: true });
  // Hit the server only when the throttle window has elapsed; otherwise a cheap local-only query.
  const doRemote = Date.now() - lastRemoteStatusAt >= REMOTE_STATUS_THROTTLE_MS;
  try {
    for (const st of await fileStatusAsync(paths, { remote: doRemote })) {
      const sceneId = sceneOf.get(st.filePath);
      if (!sceneId) continue;
      system = st.system;
      const acc = status.get(sceneId)!;
      if (!st.writable) acc.writable = false;
      if (st.openedByMe) acc.checkedOutByMe = true;
      if (st.dirty) acc.dirty = true;
      if (st.filePath === shards.get(sceneId)?.flowPath && st.tracked === false) acc.untracked = true;
      if (doRemote) { // remote bits are authoritative only on a fresh server query
        if (st.lockedBy?.length) acc.lockedBy = [...new Set([...(acc.lockedBy ?? []), ...st.lockedBy])];
        if (st.outOfDate) acc.outOfDate = true;
      }
    }
    if (doRemote) { // snapshot the fresh remote bits for the throttled calls that follow
      lastRemoteStatusAt = Date.now();
      cachedRemoteBits = new Map([...status].map(([id, v]) => [id, { lockedBy: v.lockedBy, outOfDate: v.outOfDate }]));
    } else { // overlay the last known remote bits onto the fresh local snapshot
      for (const [id, acc] of status) {
        const cached = cachedRemoteBits.get(id);
        if (cached?.lockedBy?.length) acc.lockedBy = cached.lockedBy;
        if (cached?.outOfDate) acc.outOfDate = true;
      }
    }
  } catch (e) { console.warn("patterpad: VC status query failed - treating every scene as clean + writable:", e); } // tooling missing / repo error
  return { vcs, system, scenes: [...status.values()] };
}

/** Read a scene's typed documentation map (spec §18) from its authoring shard: node id -> notes. */
/** Read one block of a scene's authoring shard (its docs / comments / writing / suggestions), with an empty
 *  default when the scene or field is absent. */
function readAuthoringField<T>(sceneId: string, pick: (af: AuthoringFile) => T | undefined, empty: T): T {
  const s = shards.get(sceneId);
  return s ? pick(loadAuthoring(s.authoringPath)) ?? empty : empty;
}

/** Write one block back to a scene's authoring shard, MERGING over the rest of the file (the other blocks
 *  are untouched). `mutate` sets the already-pruned value onto the AuthoringFile. Serialised + keeps the
 *  in-memory model current via commitAuthoring. */
function saveAuthoringField(sceneId: string, mutate: (af: AuthoringFile) => void): Promise<SaveResult> {
  return enqueueWrite(async () => {
    const s = shards.get(sceneId);
    if (!s) return { ok: false, error: `unknown scene: ${sceneId}` };
    return commitAuthoring(s, authoringWrite(s, mutate));
  });
}

export function readSceneDocs(sceneId: string): Record<string, DocLine[]> {
  return readAuthoringField(sceneId, (af) => af.documentation, {});
}

/** Persist a scene's documentation map, MERGING over the rest of the shard. Blank lines / empty nodes are
 *  pruned so the file stays clean. */
export function saveSceneDocs(sceneId: string, map: Record<string, DocLine[]>): Promise<SaveResult> {
  const cleaned: Record<string, DocLine[]> = {};
  for (const [id, lines] of Object.entries(map)) {
    const keep = lines.map((l) => ({ ...l, text: l.text.trim() })).filter((l) => l.text);
    if (keep.length) cleaned[id] = keep;
  }
  return saveAuthoringField(sceneId, (af) => { af.documentation = Object.keys(cleaned).length ? cleaned : undefined; });
}

/** Read a scene's threaded editor comments (#148): every thread anchored to a node in this scene. */
export function readSceneComments(sceneId: string): Comment[] {
  return readAuthoringField(sceneId, (af) => af.comments, []);
}

/** Persist a scene's comment threads, MERGING over the rest of the shard. Threads with no real message text
 *  are pruned, so a cancelled "add comment" leaves the file clean. */
export function saveSceneComments(sceneId: string, comments: Comment[]): Promise<SaveResult> {
  const kept = comments
    .map((c) => ({ ...c, messages: c.messages.filter((m) => m.body.trim()) }))
    .filter((c) => c.messages.length);
  return saveAuthoringField(sceneId, (af) => { af.comments = kept.length ? kept : undefined; });
}

/** Read a scene's per-beat WRITING status (#196): beat id -> ladder rung. Source-only metadata. */
export function readSceneWriting(sceneId: string): Record<string, string> {
  return readAuthoringField(sceneId, (af) => af.writing, {});
}

/** Persist a scene's per-beat writing status, MERGING over the rest of the shard. Empty -> the field drops. */
export function saveSceneWriting(sceneId: string, map: Record<string, string>): Promise<SaveResult> {
  const kept: Record<string, string> = {};
  for (const [id, name] of Object.entries(map)) if (name) kept[id] = name;
  return saveAuthoringField(sceneId, (af) => { af.writing = Object.keys(kept).length ? kept : undefined; });
}

/** Read a scene's per-beat MANUAL recording status (#206): beat id -> ladder rung. Source-only metadata. */
export function readSceneRecording(sceneId: string): Record<string, string> {
  return readAuthoringField(sceneId, (af) => af.recording, {});
}

/** Persist a scene's per-beat recording status, MERGING over the rest of the shard. Empty -> the field drops. */
export function saveSceneRecording(sceneId: string, map: Record<string, string>): Promise<SaveResult> {
  const kept: Record<string, string> = {};
  for (const [id, name] of Object.entries(map)) if (name) kept[id] = name;
  return saveAuthoringField(sceneId, (af) => { af.recording = Object.keys(kept).length ? kept : undefined; });
}

/** Read a scene's "suggest a rewrite" proposals (open + resolved alike). */
export function readSceneSuggestions(sceneId: string): Suggestion[] {
  return readAuthoringField(sceneId, (af) => af.suggestions, []);
}

/** Persist a scene's suggestions, MERGING over the rest of the shard. Proposals with no proposed text are
 *  pruned, so a cancelled "Suggest rewrite" leaves the file clean. */
export function saveSceneSuggestions(sceneId: string, suggestions: Suggestion[]): Promise<SaveResult> {
  const kept = suggestions.filter((sg) => sg.proposed.trim());
  return saveAuthoringField(sceneId, (af) => { af.suggestions = kept.length ? kept : undefined; });
}

/** Every piece of feedback across the whole script (the Review Feedback walk), in scene order (comments
 *  before suggestions within a scene). Active items always; resolved comments / suggestions join only when
 *  `scope` asks (mirroring the "Show Resolved" toggles). Reads each scene's authoring shard from disk - the
 *  renderer flushes any pending writes before calling. */
export function reviewFeedback(scope?: { resolvedComments?: boolean; resolvedSuggestions?: boolean }): ReviewItem[] {
  ensureHydrated(); // the walk gathers feedback from every scene's authoring shard
  const out: ReviewItem[] = [];
  for (const [sceneId, s] of shards) {
    const af = loadAuthoring(s.authoringPath); // missing / corrupt -> empty, contributes nothing
    for (const c of af.comments ?? []) {
      if (!c.messages.length) continue;
      if (c.resolved && !scope?.resolvedComments) continue;
      out.push({ sceneId, sceneName: s.name, kind: "comment", anchor: c.anchor, refId: c.id, author: c.messages[0]!.author, text: c.messages[0]!.body, resolved: !!c.resolved });
    }
    for (const g of af.suggestions ?? []) {
      if (g.resolved && !scope?.resolvedSuggestions) continue;
      out.push({ sceneId, sceneName: s.name, kind: "suggestion", anchor: g.anchor, refId: g.id, author: g.author, text: g.proposed, resolved: !!g.resolved });
    }
  }
  return out;
}

// --- interactive play session (the play window walks the script) --------------

let flow: Flow | null = null;
let engine: Engine | null = null; // kept so a live toggle (closed captions) reaches the running run without a restart
let playBundle: import("@patterkit/model").Bundle | null = null; // the bundle the run plays - compared on live refresh
let playError: string | null = null;
// The locale the play window runs in (#195). null = the project's source language. A run compiles the
// full bundle (every locale's strings inline), so switching is just a fresh openFlow with this locale;
// untranslated strings fall back to source flagged `<Untranslated: {id}>`, which usefully shows the gaps.
let playLocale: string | null = null;
// Closed captions in the play window (#214): default ON (full text). Toggling applies LIVE to the running
// engine (no restart - resetting the run made changes hard to compare); already-shown lines stay, lines
// from here on reflect the new setting. A fresh run (Rewind / re-open) starts from this persisted flag.
let playCaptionsOn = true;
// The editor's latest UNSAVED source for the scene being played, so Rewind / restart reflect in-progress
// edits (not just the last save). Pushed from the renderer on edit; applied by startPlay when it matches.
let playLiveSource: { sceneId: string; flow: string; loc: string } | null = null;

/** Stash the editor's current in-memory source (so the next play (re)start plays the latest edits). */
export function setPlaySource(src: { sceneId: string; flow: string; loc: string } | null): void { playLiveSource = src; }

/** Clear the interactive play session, so opening a DIFFERENT project can't replay the previous one's flow
 *  / stashed source / error (the play state is keyed by the old project's scene ids). Called by openProject. */
function resetPlaySession(): void { flow = null; engine = null; playBundle = null; playError = null; playLiveSource = null; }

// `scene` is the flow's CURRENT scene (Flow.currentScene), captured right after the advance that
// produced this beat - the runtime sets it when a jump crosses scenes, so it is the authority on
// where the playhead is. The editor uses it to follow a cross-scene jump.
const toStep = (r: StepResult, scene: string | null): PlayStep | null => {
  const s = scene ?? undefined;
  if (r.type === "line") return { kind: "line", id: r.id, scene: s, text: r.text, character: r.character, characterName: r.characterName, direction: r.direction };
  if (r.type === "text") return { kind: "text", id: r.id, scene: s, text: r.text };
  if (r.type === "gameEvent") return { kind: "gameEvent", id: r.id, scene: s };
  return null; // choice / end carry no played beat
};
const mapOptions = (options: ChoiceOption[]): PlayChoiceOption[] =>
  options.map((o) => ({ id: o.id, text: o.prompt?.text ?? "", character: o.prompt?.character, eligible: o.eligible }));
const errBatch = (e: unknown): PlayBatch => ({ steps: [], stop: "error", error: e instanceof Error ? e.message : String(e) });

/** Start (or restart) an interactive run; re-loads from disk so it reflects the last save. When
 *  `blockId` is given the run ENTERS that block (Play Block), else the scene's start. */
export function startPlay(sceneId: string, blockId?: string): void {
  if (!loaded) { flow = null; playError = "no project open"; return; }
  ensureHydrated(); // the run compiles the whole project (cross-scene jumps need every scene present)
  try {
    const fresh = workingCopy(loaded);
    // Play the editor's live (possibly unsaved) source for this scene, so Rewind reflects edits in flight.
    if (playLiveSource && playLiveSource.sceneId === sceneId) {
      try { applyLiveSource(fresh, playLiveSource); } catch { /* malformed in-flight edit -> fall back to the saved copy */ }
    }
    // Run in the chosen play locale (#195) when it's a real declared locale; else the bundle default.
    // Always compile the FULL bundle (every locale inline) so the play window can preview translations
    // regardless of the project's SHIP localisation mode (an "ids" build would otherwise emit bare IDs).
    const locale = playLocale && loaded.project.locales.all.includes(playLocale) ? playLocale : undefined;
    playBundle = runExportFull(fresh);
    engine = new Engine(playBundle, { ...(locale ? { locale } : {}), closedCaptions: playCaptionsOn });
    flow = engine.openFlow("main", { scene: sceneId, ...(blockId ? { block: blockId } : {}) });
    playError = null;
  } catch (e) { flow = null; engine = null; playBundle = null; playError = e instanceof Error ? e.message : String(e); }
}

/** What a live refresh did, so the play window knows how (whether) to react. `options` rides along on a
 *  structural swap: the run's CURRENT pending choice as it now stands (possibly empty - the choice
 *  dissolved), so a tray the window is showing can re-sync instead of offering dead buttons. */
export interface PlayRefreshResult {
  kind: "text" | "structure" | "stale" | "none";
  options?: PlayChoiceOption[];
}

/**
 * Live bundle refresh for the play window (design/proposals/live-bundle-refresh.md, phase 1): the
 * editor's source changed under a running session. Recompile and swap the run IN PLACE instead of
 * freezing: a text-only edit (same structureHash) swaps the string tables (tier 1, positions
 * untouched); a structural edit hot-swaps via save -> new engine -> load (tier 2, §9.8 drift rules).
 * Returns "stale" when the swap isn't possible (e.g. a malformed in-flight edit failed to compile),
 * telling the caller to fall back to the freeze-until-restart path; "none" when there is no run, or
 * nothing actually changed.
 */
export function refreshPlay(): PlayRefreshResult {
  if (!engine || !flow || !loaded || !playBundle) return { kind: "none" };
  ensureHydrated();
  try {
    const fresh = workingCopy(loaded);
    // Play the editor's live (possibly unsaved) source for the edited scene, same as startPlay.
    if (playLiveSource) applyLiveSource(fresh, playLiveSource);
    const next = runExportFull(fresh);
    if (next.content.hash === playBundle.content.hash) return { kind: "none" }; // no effective change
    if (next.content.structureHash === playBundle.content.structureHash) {
      engine.replaceStrings(next);       // tier 1: nothing restarts, no flow state touched
      playBundle = next;
      return { kind: "text" };
    }
    engine = engine.hotSwap(next);       // tier 2: the whole run carried over (§9.8)
    flow = engine.getFlow("main") ?? null;
    playBundle = next;
    if (!flow) return { kind: "stale" }; // the run's flow didn't survive (should not happen)
    return { kind: "structure", options: mapOptions(flow.getChoices()) };
  } catch {
    return { kind: "stale" }; // compile failed mid-edit: the old freeze path takes over
  }
}

/** The play window's language switcher (#195): the declared locales, the active one, and the source.
 *  Falls back to source for a closed project or a stale `playLocale` (e.g. after switching project). */
export function playLocaleInfo(): { locales: string[]; locale: string; defaultLocale: string } {
  const def = loaded?.project.locales.default ?? "en";
  const all = loaded?.project.locales.all ?? [def];
  const active = playLocale && all.includes(playLocale) ? playLocale : def;
  return { locales: all, locale: active, defaultLocale: def };
}

/** Set the play locale; the window then restarts the run to replay the script in this language. */
export function setPlayLocale(locale: string): void { playLocale = locale; }

/** Whether the play window currently runs with closed captions on (#214). */
export function playCaptionsState(): boolean { return playCaptionsOn; }

/** Toggle closed captions for the play window. Applies LIVE to the running engine (no restart), so the
 *  playthrough keeps its place; the persisted flag also seeds the next fresh run. */
export function setPlayCaptions(on: boolean): void { playCaptionsOn = on; engine?.setClosedCaptions(on); }

/** The host-facing address a run starts from: `<scene>` or `<scene>.<block>` (effective Game IDs). */
export function playAddress(sceneId: string, blockId?: string): string {
  const scene = loaded?.scenes.find((s) => s.id === sceneId);
  if (!scene) return sceneId;
  const sa = effectiveGameId(scene);
  const block = blockId ? scene.blocks.find((b) => b.id === blockId) : undefined;
  return block ? `${sa}.${effectiveGameId(block)}` : sa;
}

/** Advance ONE beat (Step). */
export function playStep(): PlayBatch {
  if (!flow) return { steps: [], stop: "error", error: playError ?? "no play session" };
  try {
    const r = flow.advance();
    if (r.type === "choice") return { steps: [], stop: "choice", options: mapOptions(r.options), choiceId: r.groupId, choiceScene: flow.currentScene ?? undefined };
    if (r.type === "end") return { steps: [], stop: "end" };
    return { steps: [toStep(r, flow.currentScene)!], stop: "continue" };
  } catch (e) { return errBatch(e); }
}

/** Advance until the next choice / end (Continue), collecting every beat on the way. We loop `advance()`
 *  ourselves (rather than `advanceToStop`) so we can read `flow.currentScene` after each beat - a batch
 *  may cross scenes, and each beat must report the scene it actually played in. */
export function playToStop(): PlayBatch {
  if (!flow) return { steps: [], stop: "error", error: playError ?? "no play session" };
  try {
    const steps: PlayStep[] = [];
    for (;;) {
      const r = flow.advance();
      if (r.type === "choice") return { steps, stop: "choice", options: mapOptions(r.options), choiceId: r.groupId, choiceScene: flow.currentScene ?? undefined };
      if (r.type === "end") return { steps, stop: "end" };
      const s = toStep(r, flow.currentScene);
      if (s) steps.push(s);
    }
  } catch (e) { return errBatch(e); }
}

/** Pick an eligible option; the next step / toStop plays the chosen branch. */
export function playChoose(optionId: string): void {
  try { flow?.choose(optionId); } catch { /* the window only offers eligible options */ }
}

/** The speaker of a dialogue beat by id (for the unknown-character quick-fix), or undefined. */
function beatCharacter(p: LoadedProject, beatId: string): string | undefined {
  for (const scene of p.scenes) {
    for (const block of scene.blocks) {
      let found: string | undefined;
      walkNodes<Group | Snippet>(block.children, (n) => {
        if (n.type !== "snippet") return;
        for (const b of n.beats ?? []) if (b.id === beatId && b.kind === "line") found = b.character;
      });
      if (found) return found;
    }
  }
  return undefined;
}

/** Infer a property's type from how it's used in a condition src (best-effort; defaults to boolean, so
 *  declaring it doesn't just swap an unresolved-property error for an operand-type-mismatch one). */
function inferPropType(src: string, name: string): "boolean" | "number" | "string" {
  const at = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`@${at}\\b\\s*(?:>=|<=|>|<|==|!=)\\s*-?\\d`).test(src)) return "number";
  if (new RegExp(`@${at}\\b\\s*(?:==|!=)\\s*("|[A-Za-z_])`).test(src)) return "string";
  return "boolean";
}

/** Swap a scene's UNSAVED in-memory source into a freshly-loaded project, so validation tracks edits
 *  before they are saved (the `live` path). Malformed source throws - the caller surfaces it. */
function applyLiveSource(p: LoadedProject, live: { sceneId: string; flow: string; loc: string }): void {
  const flowFile = parseSource(live.flow) as FlowFile;
  if (flowFile?.scene) {
    const i = p.scenes.findIndex((s) => s.id === live.sceneId);
    if (i >= 0) p.scenes[i] = flowFile.scene; else p.scenes.push(flowFile.scene);
  }
  try {
    const locFile = parseSource(live.loc) as LocaleFile;
    if (locFile?.strings) {
      const li = p.locales.findIndex((l) => l.scene === live.sceneId && (l.default || l.locale === p.project.locales.default));
      if (li >= 0) p.locales[li] = locFile;
    }
  } catch { /* loc is optional / may be empty - keep the disk copy */ }
}

/** Validate the whole project (the CLI's checks), flattened for the problems panel. Reflects disk,
 *  unless `live` is given: that scene's unsaved in-memory source is validated instead (so problems
 *  track edits live, not just on save). */
export function validate(live?: { sceneId: string; flow: string; loc: string }): ProblemsDto {
  if (!loaded) return { ok: true, problems: [] };
  ensureHydrated(); // the checks span every scene (dangling jumps, duplicate ids, ...)
  try {
    const fresh = workingCopy(loaded);
    if (live) applyLiveSource(fresh, live);
    const r = runValidate(fresh);
    const structural = r.structural.map((i): Problem => {
      // Most structural breaks block a clean build; a choice that can run dry is only a warning (it
      // still compiles + plays - a dry choice gathers/falls through at runtime; spec §5).
      const severity = i.code === "choice-can-empty" ? "warning" : "error";
      const base: Problem = { category: "structure", severity, message: i.message, nodeId: i.id, detail: i.code };
      // Quick-fixes (spec §4): add an unknown speaker to the cast; retarget a broken jump.
      if (i.code === "unknown-character" && i.id) {
        const character = beatCharacter(fresh, i.id);
        if (character) base.fix = { kind: "add-to-cast", character };
      } else if ((i.code === "dangling-jump" || i.code === "jump-into-non-addressable") && i.id) {
        base.fix = { kind: "retarget-jump", snippetId: i.id };
      } else if (i.code === "missing-prompt" && i.id) {
        base.fix = { kind: "add-prompt", optionId: i.id };
      }
      return base;
    });
    const conditions = r.conditions.map((i): Problem => {
      // Expression issues carry the expr validator's own severity (a future hint may warn rather than error).
      const base: Problem = { category: "condition", severity: i.severity, message: i.message, nodeId: i.nodeId, detail: i.field };
      // Quick-fix: an undeclared default-scope (@patter) property in a condition can be declared in
      // one click, its type inferred from how it's used. Scoped refs (@scene.x) are skipped (ambiguous scene).
      const m = /unresolved property reference '@([a-z0-9_]+)'/i.exec(i.message);
      if (m?.[1]) base.fix = { kind: "declare-property", name: m[1], propType: inferPropType(i.src, m[1]) };
      // Quick-fix: a condition comparing an enum property to an invalid value -> pick a valid one. The
      // expr message lists them ("expected one of: a, b, c"); only offered on a condition (a rewrite the
      // surface can drive via setCondition).
      else if (i.field === "condition") {
        const e = /^'(.+?)' is not a valid value .*expected one of: (.+)$/.exec(i.message);
        if (e) base.fix = { kind: "pick-enum-value", bad: e[1]!, options: e[2]!.split(", ").map((s) => s.trim()), src: i.src };
      }
      return base;
    });
    const problems: Problem[] = [
      ...structural,
      ...conditions,
      ...r.interpolation.map((i): Problem => ({ category: "interpolation", severity: i.severity, message: i.message, nodeId: i.nodeId, detail: i.field })),
      // Hygiene + stale bundles are advisory: the project still loads + plays; `format` / `export` repairs them.
      ...r.hygiene.map((i): Problem => ({ category: "hygiene", severity: "warning", message: i.message, file: i.file })),
      ...r.staleBundles.map((i): Problem => ({ category: "stale-bundle", severity: "warning", message: i.message, file: i.file })),
      // A lingering conflict sidecar is a hard stop - the merge is unresolved.
      ...r.unresolvedMerges.map((i): Problem => ({ category: "merge", severity: "error", message: i.message, file: i.file })),
    ];
    return { ok: r.ok, problems };
  } catch (e) {
    return { ok: false, problems: [{ category: "structure", severity: "error", message: e instanceof Error ? e.message : String(e) }] };
  }
}

/** Apply a problem's one-click quick-fix (spec §4), persist it, and refresh the loaded project. */
export function applyFix(fix: QuickFix): Promise<SaveResult> {
  return enqueueWrite(async () => {
    if (!loaded) return { ok: false, error: "no project open" };
    if (fix.kind === "add-to-cast") {
      const cast = [...(loaded.project.cast ?? [])];
      if (!cast.some((c) => c.name === fix.character)) cast.push({ name: fix.character });
      const res = await commitWrites([{ path: loaded.projectFile, content: canonicalStringify({ ...loaded.project, cast }) }]);
      if (res.ok) loaded.project = { ...loaded.project, cast }; // reflect the new cast in the cached project
      return res;
    }
    if (fix.kind === "declare-property") {
      const properties = [...(loaded.project.properties ?? [])];
      if (!properties.some((p) => p.name === fix.name)) properties.push({ name: fix.name, type: fix.propType });
      const res = await commitWrites([{ path: loaded.projectFile, content: canonicalStringify({ ...loaded.project, properties }) }]);
      if (res.ok) loaded.project = { ...loaded.project, properties }; // reflect the new property in the cached project
      return res;
    }
    return { ok: false, error: "unknown fix (handled in the renderer?)" }; // e.g. retarget-jump is a surface edit
  });
}

/** The production report (spec §13) - the same data the CLI's `report` command renders.
 *  Read-only: a derived view of the loaded project's content + authoring status, computed on demand. */
export function report(): ReportData | null {
  if (!loaded) return null;
  ensureHydrated(); // the report tallies every scene
  return runReport(loaded, recordingOverride());
}

/** The current project's compiled bundle hash (`content.hash`): the build identity the live debug link
 *  (#181) compares against a running game to tell whether it's running this exact content. Null when no
 *  project is open; recomputed on demand (a full compile, only at a debug handshake, not per frame). */
export function currentBuildHash(): string | null {
  if (!loaded) return null;
  try { ensureHydrated(); return runExport(loaded).content.hash ?? null; } catch { return null; }
}

/** Live bundle refresh over the debug link: compile the game-facing bundle (same shape `Build Bundle`
 *  ships, honouring the project's localisation mode) for a push to a connected game. Null when nothing
 *  is open or the project doesn't compile (mid-edit); the push is simply skipped then. */
export function compileForDebugPush(): { hash: string; json: string } | null {
  if (!loaded) return null;
  try {
    ensureHydrated();
    const bundle = runExport(loaded);
    if (!bundle.content.hash) return null;
    return { hash: bundle.content.hash, json: JSON.stringify(bundle) };
  } catch { return null; }
}

/** Run narrative coverage (#159) over the whole project. Drivers come from the saved `coverageDrivers`;
 *  the options just tune the sweep. Returns the report + scene display-names (the report holds scene ids). */
export function coverage(options: CoverageRunOptions): CoverageResult | null {
  if (!loaded) return null;
  ensureHydrated(); // coverage walks every scene, so the whole project must be parsed in
  const report = runCoverage(loaded, options);
  const sceneNames: Record<string, string> = {};
  for (const s of loaded.scenes) sceneNames[s.id] = s.name;
  return { report, sceneNames };
}

/** Boot state for the coverage window: the scene list (start picker), the project start, and the saved
 *  driver count (so the window can call them out). Null when no project is open. */
export function coverageInfo(): { scenes: Array<{ id: string; name: string }>; start?: { scene: string; block?: string }; driverCount: number } | null {
  if (!loaded) return null;
  ensureHydrated();
  return {
    scenes: loaded.scenes.map((s) => ({ id: s.id, name: s.name })),
    start: loaded.project.start,
    driverCount: loaded.project.coverageDrivers?.length ?? 0,
  };
}

/** Auto-propose `@world` coverage drivers from the project's conditions (Project Settings ▸ External Properties). */
export function proposeCoverageDrivers(): CoverageDriver[] {
  if (!loaded) return [];
  ensureHydrated(); // scans every scene's conditions
  return proposeDrivers(loaded);
}

/** A filesystem-safe default-filename stem from the open project's title. Strips the characters Windows /
 *  macOS forbid in a filename (`/ \ : * ? " < > |`) - notably a ':' (which macOS Finder renders as '/', and
 *  which breaks a `file:` URL origin), collapsing the gaps to single spaces. Falls back to `fallback`. */
function safeStem(fallback: string): string {
  if (!loaded) return fallback;
  return loaded.project.project.name.replace(/[/\\:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || fallback;
}

/** The production report rendered as a producer spreadsheet (xlsx), plus a suggested filename. The main
 *  process owns the Save dialog + the actual write (it holds the window + fs), so we just hand back bytes. */
export async function reportXlsx(): Promise<{ buffer: Buffer; defaultName: string } | null> {
  if (!loaded) return null;
  ensureHydrated(); // the report tallies every scene
  const buffer = await runReportXlsx(runReport(loaded, recordingOverride()));
  const stem = safeStem("production");
  return { buffer, defaultName: `${stem} - production.xlsx` };
}

/** Render localisation strings (spec §14) for export: a serialised file + a suggested filename. The main
 *  process owns the Save dialog + write (it holds the window + fs); this just produces the bytes. */
export async function locExport(format: "json" | "xlsx" | "po", locale?: string): Promise<{ content: string | Buffer; defaultName: string } | null> {
  if (!loaded) return null;
  ensureHydrated(); // strings come from every scene
  const catalog = extractLoc(loaded, { locale });
  const stem = safeStem("strings");
  const tag = locale ?? "template";
  if (format === "xlsx") return { content: await catalogToXlsx(catalog), defaultName: `${stem} - ${tag}.xlsx` };
  if (format === "po") return { content: catalogToPo(catalog), defaultName: locale ? `${tag}.po` : `${stem}.pot` };
  return { content: catalogToJson(catalog), defaultName: `${stem} - ${tag}.json` };
}

/** Import a translated file back into the project: parse by extension, apply, commit, and refresh the
 *  cached project so validate / report / play reflect the new strings. `fallbackLocale` covers formats
 *  that don't carry one (Excel). Returns the locale + counts, or an error to surface. */
export async function locImport(filePath: string, fallbackLocale?: string): Promise<{ ok: boolean; error?: string; locale?: string; updated?: number; files?: number }> {
  if (!loaded) return { ok: false, error: "no project open" };
  ensureHydrated(); // applyLoc writes across every scene's loc shard
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  let catalog;
  try {
    if (ext === ".json") catalog = jsonToCatalog(readFileSync(filePath, "utf8"));
    else if (ext === ".po" || ext === ".pot") catalog = poToCatalog(readFileSync(filePath, "utf8"));
    else if (ext === ".xlsx") catalog = await xlsxToCatalog(readFileSync(filePath));
    else return { ok: false, error: `unsupported file type '${ext}' (use .json, .po, or .xlsx)` };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }

  const locale = catalog.locale ?? fallbackLocale;
  if (!locale) return { ok: false, error: "could not tell which language this file is for - pick a target language first" };
  if (locale === loaded.project.locales.default) return { ok: false, error: `'${locale}' is the source language - nothing to import` };

  const { writes, stats } = applyLoc(loaded, { ...catalog, locale });
  if (writes.length === 0) return { ok: true, locale, updated: 0, files: 0 };
  const res = await enqueueWrite(() => commitWrites(writes));
  if (!res.ok) return { ok: false, error: res.error };
  try { loaded = loadProject(loaded.root); shards = buildShards(loaded); }
  catch (e) { console.warn("patterpad: localisation import committed, but reloading the project failed - the in-memory strings are stale until reopen:", e); }
  return { ok: true, locale, updated: stats.updated, files: stats.files };
}

/** Render the voice (VO) recording script (spec §16) as a producer spreadsheet (xlsx) + a filename. */
export async function voiceScriptXlsx(everything: boolean): Promise<{ buffer: Buffer; defaultName: string } | null> {
  if (!loaded) return null;
  ensureHydrated(); // the script gathers voiced lines from every scene
  const buffer = await voiceScriptToXlsx(runVoiceScript(loaded, { everything, recordingOverride: recordingOverride() }));
  const stem = safeStem("project");
  return { buffer, defaultName: `${stem} - voice script.xlsx` };
}

/** The default filename stem for the readable-script export (the project name, path-sanitised). Null
 *  when no project is open. The main process uses it for the Save dialog's default path. */
export function scriptStem(): string | null {
  if (!loaded) return null;
  return safeStem("script");
}

/** Render the readable screenplay (#exports) as a `.pdf` or `.docx` buffer (format chosen in the Save
 *  dialog). Null when no project is open. */
export async function scriptDocument(format: "pdf" | "docx"): Promise<Buffer | null> {
  if (!loaded) return null;
  ensureHydrated(); // the script spans every scene
  const doc = runScriptDoc(loaded);
  return format === "docx" ? scriptToDocx(doc) : scriptToPdf(doc);
}

/** Render a single self-contained, playable HTML file of the whole story (#exports) + a filename. The
 *  runtime + every locale's strings are inlined, so the file plays offline in any browser. */
export function playableHtml(): { content: string; defaultName: string } | null {
  if (!loaded) return null;
  ensureHydrated(); // the player needs the whole project
  const html = runExportHtml(loaded);
  const stem = safeStem("story");
  return { content: html, defaultName: `${stem}.html` };
}

/** Publish the story to a FOLDER, Inky-style (design decision in patterpad/publishing docs): the
 *  writer's harness (`index.html` + `style.css`) is written once and then LEFT ALONE so their
 *  customisations survive, while `story.js` + `patterplay.js` are refreshed on every publish.
 *  Delete a kept file to get a fresh copy. Plain fs writes - the target is outside the project. */
export function publishWebTo(dir: string): SaveResult & { kept?: string[] } {
  if (!loaded) return { ok: false, error: "no project open" };
  ensureHydrated(); // the player needs the whole project
  const out = runExportWeb(loaded);
  const files: Array<{ name: string; content: string; keep: boolean }> = [
    { name: "index.html", content: out.indexHtml, keep: true },
    { name: "style.css", content: out.styleCss, keep: true },
    { name: "patterplay.js", content: out.patterplayJs, keep: false },
    { name: "story.js", content: out.storyJs, keep: false },
  ];
  const kept: string[] = [];
  try {
    mkdirSync(dir, { recursive: true });
    for (const f of files) {
      const path = join(dir, f.name);
      if (f.keep && existsSync(path)) { kept.push(f.name); continue; }
      writeFileSync(path, f.content);
    }
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  return { ok: true, kept };
}

/** The DEFAULT compiled-bundle output path (relative to the project root), shown in Project Settings ▸
 *  Build when the project pins no explicit `export.bundle`: a SIBLING `patter-dist/` folder, NOT inside
 *  the project - on macOS the root is a `.patter` PACKAGE, so writing inside would bury the build in the
 *  document. (The CLI keeps its own `dist/` convention; this is Patterpad's default.) */
function defaultBundleRel(p: LoadedProject): string {
  return `../patter-dist/${basename(p.projectFile).replace(/\.patterproj$/, "")}.patterc`;
}

/** The ABSOLUTE path Build Bundle writes to: the pinned `export.bundle` (relative-to-root or absolute),
 *  else the sibling-`patter-dist/` default. Patterpad-local (not ops `bundleOutputPath`, which defaults
 *  inside the root) so the default lands beside the package, never within it. */
function resolveBundleOut(p: LoadedProject): string {
  const rel = p.project.export?.bundle ?? defaultBundleRel(p);
  return isAbsolute(rel) ? rel : resolve(p.root, rel);
}

/** Fold an edited build-output path back into the project's `export` block: pin `bundle` only when it's
 *  set AND differs from the dist/ default (so a clean file stays clean), preserving other export fields;
 *  return undefined when nothing is left, so the whole `export` key drops out. */
function buildExport(p: LoadedProject, buildBundle: string, localisation: "embedded" | "ids", sourceDebug: boolean, prev: ProjectFile["export"]): ProjectFile["export"] {
  const next: NonNullable<ProjectFile["export"]> = { ...prev };
  const wanted = buildBundle.trim();
  if (wanted && wanted !== defaultBundleRel(p)) next.bundle = wanted; else delete next.bundle;
  // Localisation mode (spec §11): "embedded" is the default - omit it. "ids" ships no strings; source-debug
  // embeds the source language for debug playback only.
  if (localisation === "ids") next.localisation = { mode: "ids", ...(sourceDebug ? { sourceDebug: true } : {}) };
  else delete next.localisation;
  return Object.keys(next).length ? next : undefined;
}

/** Build Bundle (Build menu): compile the whole project to its runtime `.patterc` and write it to the
 *  configured output path (Project Settings ▸ Build, else the dist/ default). Lock-aware - the bundle
 *  often lives inside the project's own repo. Returns where it landed, or an error to surface. */
export function buildBundle(): Promise<{ ok: boolean; path?: string; error?: string }> {
  return enqueueWrite(async () => {
    if (!loaded) return { ok: false, error: "no project open" };
    ensureHydrated(); // the bundle compiles every scene
    const path = resolveBundleOut(loaded);
    const writes: { path: string; content: string }[] = [];
    let builtHash: string | undefined;
    try {
      // runExport applies the project's localisation mode (embedded: strings inline; ids: none, the game
      // localises from beat IDs; +sourceDebug: source language embedded for debug). One self-contained file.
      const bundle = runExport(loaded);
      builtHash = bundle.content.hash;
      writes.push({ path, content: canonicalStringify(bundle, { trailingComma: false }) });
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
    // Audio Folders (#206): also emit the sidecar `patteraudio.json` next to the audio, so a game can resolve
    // each beat's winning clip without a folder search. Only when folder mode + a root are set and some audio
    // has been found (the indexer keeps a live snapshot). It's a sidecar - never inside the .patterc.
    const p = loaded!.project;
    if (audioActive() && p.audioRoot && Object.keys(audioSnapshot).length) {
      const dir = resolve(loaded!.root, p.audioRoot);
      writes.push({ path: join(dir, AUDIO_MANIFEST_FILE), content: audioManifest(audioSnapshot, loaded!.root, p.audioRoot) });
    }
    const res = await commitWrites(writes);
    if (res.ok) lastBuiltHash = builtHash; // prime the Auto-Rebuild dedup: no redundant auto-build after a manual one
    return res.ok ? { ok: true, path } : { ok: false, error: res.error };
  });
}

// -- Auto Rebuild (opt-in): keep the on-disk .patterc current after edits, without a manual Publish. -----
const AUTO_REBUILD_DEBOUNCE_MS = 1200;
let autoRebuildTimer: ReturnType<typeof setTimeout> | null = null;
// The content hash of the last bundle we wrote (manual OR auto). An auto-rebuild that would produce the same
// bytes is skipped - no redundant write, no VCS churn. Reset (undefined) when a different project opens.
let lastBuiltHash: string | undefined;

/** Whether Auto Rebuild is on for the open project (drives the Build-menu checkbox). */
export function autoRebuildEnabled(): boolean { return loaded?.project.autoRebuild === true; }

/** Flip ProjectFile.autoRebuild, persist it, and return the new state. The Build-menu checkbox and the
 *  Project Settings ▸ General toggle share this; turning it on kicks an immediate rebuild. */
export function toggleAutoRebuild(): Promise<boolean> {
  return enqueueWrite(async () => {
    if (!loaded) return false;
    const on = loaded.project.autoRebuild !== true;
    loaded.project = { ...loaded.project, autoRebuild: on ? true : undefined };
    await commitWrites([{ path: loaded.projectFile, content: canonicalStringify(loaded.project) }]);
    if (on) scheduleAutoRebuild();
    return on;
  });
}

/** Called after every write (from commitWrites): when Auto Rebuild is on and the write was NOT the build's
 *  own output, schedule a debounced rebuild. The bundle-path guard is what stops a rebuild from looping. */
function maybeScheduleAutoRebuild(writes: { path: string; content: string }[]): void {
  if (!loaded?.project.autoRebuild) return;
  const out = resolve(resolveBundleOut(loaded));
  if (writes.some((w) => resolve(w.path) === out)) return; // the build's own write - don't loop
  scheduleAutoRebuild();
}

function scheduleAutoRebuild(): void {
  if (autoRebuildTimer) clearTimeout(autoRebuildTimer);
  autoRebuildTimer = setTimeout(() => { autoRebuildTimer = null; void runAutoRebuild(); }, AUTO_REBUILD_DEBOUNCE_MS);
}

/** The debounced rebuild: compile the in-memory project and write the .patterc (+ audio sidecar) ONLY when
 *  the compiled bundle actually changed (deduped by content hash). A mid-edit invalid project silently keeps
 *  the last good build. Serialised with saves via enqueueWrite so it always compiles the latest bytes. */
async function runAutoRebuild(): Promise<void> {
  await enqueueWrite(async () => {
    if (!loaded?.project.autoRebuild) return;
    ensureHydrated();
    let bundle: ReturnType<typeof runExport>;
    try { bundle = runExport(loaded); }
    catch { return; } // temporarily invalid (half-written condition, dangling jump) - keep the last good build
    if (bundle.content.hash === lastBuiltHash) return; // deduped: nothing changed
    const writes: { path: string; content: string }[] = [{ path: resolveBundleOut(loaded), content: canonicalStringify(bundle, { trailingComma: false }) }];
    const p = loaded.project;
    if (audioActive() && p.audioRoot && Object.keys(audioSnapshot).length) {
      const dir = resolve(loaded.root, p.audioRoot);
      writes.push({ path: join(dir, AUDIO_MANIFEST_FILE), content: audioManifest(audioSnapshot, loaded.root, p.audioRoot) });
    }
    const res = await commitWrites(writes);
    if (res.ok) lastBuiltHash = bundle.content.hash;
  });
}

/** Write just the audio sidecar manifest (`patteraudio.json`), without a full bundle rebuild - so a
 *  VO-only pass (new takes dropped in) can refresh it from the live folder index. No-op unless folder mode +
 *  an audio root are set and some audio exists. Powers Production ▸ Update Audio Manifest. */
export function writeAudioManifest(): Promise<{ ok: boolean; path?: string; error?: string }> {
  return enqueueWrite(async () => {
    if (!loaded) return { ok: false, error: "no project open" };
    const p = loaded.project;
    if (!audioActive() || !p.audioRoot) return { ok: false, error: "Audio Folders is not set up (need an audio root)" };
    if (!Object.keys(audioSnapshot).length) return { ok: false, error: "no audio files found under the audio root yet" };
    const dir = resolve(loaded.root, p.audioRoot);
    const path = join(dir, AUDIO_MANIFEST_FILE);
    const res = await commitWrites([{ path, content: audioManifest(audioSnapshot, loaded.root, p.audioRoot) }]);
    return res.ok ? { ok: true, path } : { ok: false, error: res.error };
  });
}

/** The project-level settings for the Project Settings modal (General section). */
export function readSettings(): ProjectSettingsDto | null {
  if (!loaded) return null;
  const p = loaded.project;
  return {
    name: p.project.name,
    vcs: p.vcs ?? "none",
    start: p.start,
    voiced: p.voiced ?? false,
    // Track audio status (#206): default OFF (opt-in even for a voiced project); stored only when ticked on.
    trackAudioStatus: p.trackAudioStatus ?? false,
    formatting: p.formatting ?? true,
    autosave: p.autosave ?? true,
    autoRebuild: p.autoRebuild ?? false,
    localeDefault: p.locales.default,
    locales: p.locales.all,
    gameDataFields: p.gameDataFields ?? {},
    properties: p.properties ?? [],
    scopeRegistry: p.scopeRegistry,
    coverageDrivers: p.coverageDrivers,
    cast: p.cast ?? [],
    // Build output (Build tab): the pinned `export.bundle`, else the sibling default - so the field always
    // shows where Build Bundle will write, and saveSettings drops it back to undefined when left default.
    buildBundle: p.export?.bundle ?? defaultBundleRel(loaded),
    // Localisation mode (Build tab): "embedded" (strings inside the bundle, default) or "ids" (no strings,
    // the game localises from beat IDs); `buildSourceDebug` embeds the source language for debug playback.
    buildLocalisation: p.export?.localisation?.mode ?? "embedded",
    buildSourceDebug: p.export?.localisation?.sourceDebug ?? false,
    // Seed the editor with the defaults when the project declares none (spec §13), so the ladders are
    // never empty in the UI; saveSettings drops them back to undefined when they still match the defaults.
    writingStatuses: p.writingStatuses ?? DEFAULT_WRITING_STATUSES,
    // Estimating (spec §13): show the stored config, else a disabled default so the tab is never blank.
    estimating: p.estimating ?? { enabled: false, defaultLines: DEFAULT_ESTIMATE_LINES },
    recordingStatuses: p.recordingStatuses ?? DEFAULT_RECORDING_STATUSES,
    audioFolders: p.audioFolders ?? false,
    audioRoot: p.audioRoot ?? null,
    scratchStatus: p.scratchStatus ?? null,
    // Spell-check (#177): show the EFFECTIVE language (derived from the source locale when unset) so the
    // Dictionary tab's picker reflects what's actually in use.
    dictionaryLanguage: p.dictionary?.language ?? deriveDictLanguage(p.locales.default),
    dictionaryWords: p.dictionary?.words ?? [],
    dictionaryIgnore: p.dictionary?.ignore ?? [],
    dictionaryEnabled: p.dictionary?.enabled ?? true,
    // Closed captions (#214): show the EFFECTIVE delimiters + caption character (defaults when unpinned) so
    // the tab's fields are never blank; saveSettings drops the block when it still matches the defaults.
    closedCaptions: {
      open: p.closedCaptions?.open ?? DEFAULT_CAPTION_DELIMITERS.open,
      close: p.closedCaptions?.close ?? DEFAULT_CAPTION_DELIMITERS.close,
      character: p.closedCaptions?.character ?? DEFAULT_CAPTION_CHARACTER,
    },
  };
}

/** The default per-scene estimate seeded into the Estimating tab when a project declares none. */
const DEFAULT_ESTIMATE_LINES = 20;

/** The estimating config to STORE (spec §13): undefined when it's the untouched default (off, default
 *  lines, no threshold, no tags) so a clean file stays clean; otherwise the edited config, blank tags pruned. */
function estimatingFile(e: ProjectSettingsDto["estimating"]): EstimatingConfig | undefined {
  const tags = (e.tagEstimates ?? []).filter((t) => t.tag.trim());
  if (!e.enabled && !e.thresholdStatus && tags.length === 0 && e.defaultLines === DEFAULT_ESTIMATE_LINES) return undefined;
  return {
    enabled: e.enabled, defaultLines: e.defaultLines,
    ...(e.thresholdStatus ? { thresholdStatus: e.thresholdStatus } : {}),
    ...(tags.length ? { tagEstimates: tags } : {}),
  };
}

/** The closed-captions config to STORE (#214): undefined when it still matches the defaults (keeping a
 *  clean file), and the `character` key only when it differs from `SFX`. */
function captionConfig(cc: ProjectSettingsDto["closedCaptions"]): CaptionDelimiters | undefined {
  const open = cc.open || DEFAULT_CAPTION_DELIMITERS.open;
  const close = cc.close || DEFAULT_CAPTION_DELIMITERS.close;
  const character = cc.character || DEFAULT_CAPTION_CHARACTER;
  if (open === DEFAULT_CAPTION_DELIMITERS.open && close === DEFAULT_CAPTION_DELIMITERS.close && character === DEFAULT_CAPTION_CHARACTER) return undefined;
  return character === DEFAULT_CAPTION_CHARACTER ? { open, close } : { open, close, character };
}

/** Persist edited project-level settings back to the .patterproj (lock-aware), preserving every other
 *  field. Returns the refreshed project summary on success so the renderer can update the title etc. */
export function saveSettings(s: ProjectSettingsDto): Promise<SaveResult & { project?: OpenedProject }> {
  return enqueueWrite(async () => {
    if (!loaded) return { ok: false, error: "no project open" };
    const prevVcs = loaded.project.vcs ?? "none";
    const next: ProjectFile = {
      ...loaded.project,
      project: { ...loaded.project.project, name: s.name },
      vcs: s.vcs === "none" ? undefined : s.vcs, // omit "none" to keep a clean file
      start: s.start?.scene ? s.start : undefined,
      voiced: s.voiced,
      // Track audio status (#206): default OFF, so store only when ticked ON (keeps a clean file).
      trackAudioStatus: s.trackAudioStatus ? true : undefined,
      formatting: s.formatting,
      autosave: s.autosave,
      // Auto Rebuild: default OFF, so store only when ticked ON (keeps a clean file).
      autoRebuild: s.autoRebuild ? true : undefined,
      // The locale list is editable (Language tab); keep `default` a member of `all`.
      locales: { default: s.locales.includes(s.localeDefault) ? s.localeDefault : (s.locales[0] ?? "en"), all: s.locales.length ? s.locales : [s.localeDefault] },
      // Drop empty collections entirely, so a clean project file stays clean.
      gameDataFields: Object.keys(s.gameDataFields).length ? s.gameDataFields : undefined,
      properties: s.properties.length ? s.properties : undefined,
      // Host scopes (#159): keep a clean file - store only when at least one scope is declared, and only
      // drivers when present.
      scopeRegistry: s.scopeRegistry && s.scopeRegistry.scopes.length ? s.scopeRegistry : undefined,
      coverageDrivers: s.coverageDrivers && s.coverageDrivers.length ? s.coverageDrivers : undefined,
      cast: s.cast.length ? s.cast : undefined,
      // Status ladders: store only when they DIFFER from the built-in defaults, so a project that takes
      // the standard ladders keeps a clean file (and silently follows any future change to the defaults).
      writingStatuses: sameJson(s.writingStatuses, DEFAULT_WRITING_STATUSES) ? undefined : s.writingStatuses,
      // Estimating (spec §13): store only when touched (on, non-default lines, tags, or a threshold), else drop.
      estimating: estimatingFile(s.estimating),
      recordingStatuses: sameJson(s.recordingStatuses, DEFAULT_RECORDING_STATUSES) ? undefined : s.recordingStatuses,
      audioFolders: s.audioFolders ? true : undefined, // drop when off (default)
      // Audio Folders root (#206): only meaningful in folder mode; store the chosen root, else drop it.
      audioRoot: s.audioFolders && s.audioRoot ? s.audioRoot : undefined,
      // Scratch recording (#224): only meaningful in folder mode; store the chosen rung, else drop it (off).
      scratchStatus: s.audioFolders && s.scratchStatus ? s.scratchStatus : undefined,
      // Spell-check (#177): store the language only when it differs from the source-locale default, the words
      // only when non-empty, and `enabled` only when OFF (default on) - keeping a clean project file.
      dictionary: dictionaryFile(s),
      // Closed captions (#214): store only when delimiters / caption character differ from the defaults.
      closedCaptions: captionConfig(s.closedCaptions),
      // Build settings (Build tab): pin `export.bundle` only when it's NOT the sibling default (keeping a
      // clean file) + `export.locales` only when "external", preserving any other export fields (e.g. targets).
      export: buildExport(loaded, s.buildBundle, s.buildLocalisation, s.buildSourceDebug, loaded.project.export),
    };
    const writes = [{ path: loaded.projectFile, content: canonicalStringify(next) }];
    // Switching VCS re-emits its config files (vcs-setup.md, .gitattributes, ignore) for the new system.
    if (s.vcs !== prevVcs && s.vcs !== "none") writes.push(...vcsConfigWrites(loaded.root, s.vcs, "commit"));
    const res = await commitWrites(writes);
    if (!res.ok) return res;
    // Remove the PREVIOUS system's now-orphaned config files (e.g. git's .gitattributes / .gitignore when
    // moving to Perforce), so a switched project never carries stale VCS hygiene. The shared vcs-setup.md is
    // kept (rewritten above for a real VCS, left as-is for "none"). Best-effort: a failed delete never fails
    // the settings save. Done after the writes commit, so a write failure can't strand us mid-switch.
    if (s.vcs !== prevVcs && prevVcs !== "none") {
      const keep = new Set([join(loaded.root, "vcs-setup.md"), ...(s.vcs !== "none" ? vcsConfigWrites(loaded.root, s.vcs).map((w) => w.path) : [])]);
      for (const w of vcsConfigWrites(loaded.root, prevVcs)) {
        if (!keep.has(w.path) && existsSync(w.path)) { try { await deleteFileAsync(w.path); } catch { /* leave the orphan rather than fail the switch */ } }
      }
    }
    loaded.project = next; // reflect in the cached project
    syncAudioIndex();      // audio config may have changed (mode toggle / rung folders) (#206)
    return { ok: true, project: summarise(loaded) };
  });
}

/** Set just the project start point (ProjectFile.start), lock-aware: for the "set where your story starts"
 *  prompt (Play from Start / Coverage). Returns the refreshed project summary. */
export function setStart(start: { scene: string; block?: string }): Promise<SaveResult & { project?: OpenedProject }> {
  return enqueueWrite(async () => {
    if (!loaded) return { ok: false, error: "no project open" };
    const next: ProjectFile = { ...loaded.project, start: start.scene ? start : undefined };
    const res = await commitWrites([{ path: loaded.projectFile, content: canonicalStringify(next) }]);
    if (!res.ok) return res;
    loaded.project = next;
    return { ok: true, project: summarise(loaded) };
  });
}

/** Create a new scene: the same minimal playable scaffold `patter init` starts a project with
 *  (one block, one snippet, one text beat jumping to END), written as a fresh flow shard + its
 *  default-locale loc shard through the lock-aware path. The filename stem is the slugged name,
 *  de-collided (`-2`, `-3`, …) against existing shards. Returns the refreshed summary + the new id. */
export function createScene(name: string): Promise<SaveResult & { project?: OpenedProject; sceneId?: string }> {
  return enqueueWrite(async () => {
    if (!loaded) return { ok: false, error: "no project open" };
    ensureHydrated(); // the stem de-collides against ALL shards, not the landing-only view
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, error: "a scene needs a name" };

    const layout = { flow: "scenes/", strings: "loc/", ...loaded.project.layout };
    const defaultLocale = loaded.project.locales.default;
    let stem = slug(trimmed) || "scene";
    for (let n = 2; existsSync(join(loaded.root, layout.flow, `${stem}.patterflow`)); n++) stem = `${slug(trimmed) || "scene"}-${n}`;
    const flowPath = join(loaded.root, layout.flow, `${stem}.patterflow`);
    const locPath = join(loaded.root, layout.strings, defaultLocale, `${stem}.patterloc`);

    const sceneId = newId("scn");
    const beatId = newId("T");
    const scene: Scene = {
      id: sceneId, type: "scene", name: trimmed,
      blocks: [{
        id: newId("blk"), type: "block", name: "Main",
        children: [{ id: newId("sn"), type: "snippet", beats: [{ id: beatId, kind: "text" }], jump: { to: "END" } }],
      }],
    };
    const flow: FlowFile = { schema: "patter/flow@0", scene };
    const locale: LocaleFile = { schema: "patter/strings@0", scene: sceneId, locale: defaultLocale, default: true, strings: { [beatId]: "A new scene." } };

    const res = await commitWrites([
      { path: flowPath, content: canonicalStringify(flow) },
      { path: locPath, content: canonicalStringify(locale) },
    ]);
    if (!res.ok) return res;
    loaded.scenes.push(scene);
    loaded.sceneFiles[sceneId] = flowPath;
    loaded.locales.push(locale);
    loaded.localeFiles.push(locPath);
    shards = buildShards(loaded);
    return { ok: true, sceneId, project: summarise(loaded) };
  });
}

/** What deleting a scene would cost - drives the confirm's severity (design/proposals/delete-scene.md):
 *  an untouched scaffold deletes silently, content asks "are you sure", and inbound references from
 *  other scenes (jumps / seen()/visits() conditions) are listed BY NAME so the writer knows what dangles. */
export function sceneDeleteInfo(sceneId: string): SceneDeleteInfo | null {
  if (!loaded) return null;
  ensureHydrated(); // references + shard discovery are whole-project facts
  const scene = loaded.scenes.find((s) => s.id === sceneId);
  if (!scene) return null;

  // Every id inside the scene (its own included): jump targets and condition node refs test against it.
  const ids = new Set<string>([scene.id]);
  let lines = 0;
  const collect = (children: Array<Group | Snippet>): void => {
    for (const c of children) {
      ids.add(c.id);
      if (c.type === "group") collect(c.children);
      else for (const b of c.beats ?? []) { ids.add(b.id); if (b.kind === "line" || b.kind === "text") lines++; }
    }
  };
  for (const b of scene.blocks) { ids.add(b.id); collect(b.children); }

  // Ids are opaque random tokens, so a substring test over a condition's source is a reliable
  // "names a node in this scene" check (seen('x') / visits(x), quoted or bareword).
  const idHit = (src: string): boolean => { for (const id of ids) if (src.includes(id)) return true; return false; };
  const referrers: SceneDeleteInfo["referrers"] = [];
  for (const other of loaded.scenes) {
    if (other.id === sceneId) continue;
    let jumps = 0, conditions = 0;
    const scan = (children: Array<Group | Snippet>): void => {
      for (const c of children) {
        const cond = (c as { condition?: string }).condition;
        if (typeof cond === "string" && idHit(cond)) conditions++;
        if (c.type === "group") scan(c.children);
        else if (c.jump?.to && ids.has(c.jump.to)) jumps++;
      }
    };
    for (const b of other.blocks) scan(b.children);
    if (jumps || conditions) referrers.push({ sceneId: other.id, name: other.name, jumps, conditions });
  }

  // "Untouched" = exactly the New-Scene scaffold with a clean authoring shard (structural only;
  // the renderer still confirms if it's referenced or is the start point).
  const shard = shards.get(sceneId);
  const af = shard ? loadAuthoring(shard.authoringPath) : ({} as AuthoringFile);
  const cleanAuthoring = !(af.comments?.length || af.suggestions?.length
    || Object.keys(af.documentation ?? {}).length || Object.keys(af.writing ?? {}).length
    || Object.keys(af.recording ?? {}).length);
  const soleChild = scene.blocks.length === 1 && scene.blocks[0]!.children.length === 1 ? scene.blocks[0]!.children[0] : undefined;
  const soleBeats = soleChild?.type === "snippet" ? soleChild.beats ?? [] : [];
  const untouched = soleChild?.type === "snippet" && soleBeats.length === 1
    && soleBeats[0]!.kind === "text" && cleanAuthoring;

  return {
    untouched, lines, blocks: scene.blocks.length,
    startsHere: loaded.project.start?.scene === sceneId,
    lastScene: loaded.scenes.length <= 1,
    vcs: !!loaded.project.vcs,
    referrers,
  };
}

/** Delete a scene: its flow shard, its loc shard in EVERY locale, and its authoring shard, each
 *  through the lock-aware VC delete; then drop it from `sceneOrder` and clear a `start` that
 *  pointed at it. Refuses the last scene (the loader assumes one exists). Not undoable in-app -
 *  the VCS is the safety net, which is why the renderer's confirm carries the weight it does. */
export function deleteScene(sceneId: string): Promise<SaveResult & { project?: OpenedProject }> {
  return enqueueWrite(async () => {
    if (!loaded) return { ok: false, error: "no project open" };
    ensureHydrated();
    const p = loaded; // ensureHydrated may swap the object; re-pin for narrowing across the awaits
    const idx = p.scenes.findIndex((s) => s.id === sceneId);
    if (idx < 0) return { ok: false, error: "no such scene" };
    if (p.scenes.length <= 1) return { ok: false, error: "a project needs at least one scene" };

    const locIdx: number[] = [];
    p.locales.forEach((loc, i) => { if (loc.scene === sceneId) locIdx.push(i); });
    const authoringPath = shards.get(sceneId)?.authoringPath;
    const files = [
      p.sceneFiles[sceneId],
      ...locIdx.map((i) => p.localeFiles[i]),
      authoringPath && existsSync(authoringPath) ? authoringPath : undefined,
    ].filter((f): f is string => !!f);
    for (const f of files) {
      try { await deleteFileAsync(f); }
      catch (e) { return { ok: false, error: `could not delete ${basename(f)}: ${e instanceof Error ? e.message : String(e)}` }; }
    }

    // Project-file cleanup rides the same operation: the order entry + a start point that now dangles.
    const hadOrder = !!p.project.sceneOrder?.includes(sceneId);
    const startsHere = p.project.start?.scene === sceneId;
    if (hadOrder || startsHere) {
      const next: ProjectFile = { ...p.project };
      if (hadOrder) next.sceneOrder = next.sceneOrder!.filter((id) => id !== sceneId);
      if (startsHere) delete next.start;
      const res = await commitWrites([{ path: p.projectFile, content: canonicalStringify(next) }]);
      if (!res.ok) return res;
      p.project = next;
    }

    p.scenes.splice(idx, 1);
    delete p.sceneFiles[sceneId];
    for (let i = locIdx.length - 1; i >= 0; i--) { p.locales.splice(locIdx[i]!, 1); p.localeFiles.splice(locIdx[i]!, 1); }
    shards = buildShards(p);
    authoringCache.clear();
    return { ok: true, project: summarise(p) };
  });
}

/** Persist the nav's authored scene order (ProjectFile.sceneOrder), lock-aware, and re-sort the
 *  in-memory list to match. Ids must all be scenes of the open project (a stale drag after an
 *  external change is refused rather than silently dropping scenes). Returns the refreshed summary. */
export function reorderScenes(ids: string[]): Promise<SaveResult & { project?: OpenedProject }> {
  return enqueueWrite(async () => {
    if (!loaded) return { ok: false, error: "no project open" };
    ensureHydrated(); // ordering is a whole-project fact - never validate against the landing-only list
    const known = new Set(loaded.scenes.map((s) => s.id));
    if (ids.length !== known.size || ids.some((id) => !known.has(id))) {
      return { ok: false, error: "scene list changed - reorder ignored" };
    }
    const next: ProjectFile = { ...loaded.project, sceneOrder: ids };
    const res = await commitWrites([{ path: loaded.projectFile, content: canonicalStringify(next) }]);
    if (!res.ok) return res;
    loaded.project = next;
    const rank = new Map(ids.map((id, i) => [id, i]));
    loaded.scenes.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
    return { ok: true, project: summarise(loaded) };
  });
}

/** Append a word to the project's custom dictionary (#177 "Add to dictionary") and save. Returns the
 *  refreshed word list so the renderer can rebuild the spell engine. */
export function addDictionaryWord(word: string): Promise<SaveResult & { words?: string[] }> {
  return enqueueWrite(async () => {
    if (!loaded) return { ok: false, error: "no project open" };
    const w = word.trim();
    const cur = loaded.project.dictionary?.words ?? [];
    if (!w || cur.includes(w)) return { ok: true, words: cur };
    const words = [...cur, w];
    const next: ProjectFile = { ...loaded.project, dictionary: { ...loaded.project.dictionary, words } };
    const res = await commitWrites([{ path: loaded.projectFile, content: canonicalStringify(next) }]);
    if (!res.ok) return res;
    loaded.project = next;
    return { ok: true, words };
  });
}

/** Append a word to the project's IGNORE list (#177 right-click ▸ "Ignore") and save. Distinct from the
 *  custom word list - silences the squiggle without claiming the token is real vocabulary. Returns the
 *  refreshed ignore list so the renderer rebuilds the engine + problems panel. */
export function addIgnoreWord(word: string): Promise<SaveResult & { ignore?: string[] }> {
  return enqueueWrite(async () => {
    if (!loaded) return { ok: false, error: "no project open" };
    const w = word.trim();
    const cur = loaded.project.dictionary?.ignore ?? [];
    if (!w || cur.includes(w)) return { ok: true, ignore: cur };
    const ignore = [...cur, w];
    const next: ProjectFile = { ...loaded.project, dictionary: { ...loaded.project.dictionary, ignore } };
    const res = await commitWrites([{ path: loaded.projectFile, content: canonicalStringify(next) }]);
    if (!res.ok) return res;
    loaded.project = next;
    return { ok: true, ignore };
  });
}

/** The resolved spell-check on/off + active dictionary, for the Review ▸ Spelling menu (null = no project). */
export function dictionarySettings(): { enabled: boolean; language: string } | null {
  if (!loaded) return null;
  const d = resolveDictionary(loaded.project);
  return { enabled: d.enabled, language: d.language };
}

/** Set spell-check on/off and/or the active dictionary (Review ▸ Spelling, mirroring the Dictionary tab) and
 *  save. Returns the refreshed dictionary so the renderer rebuilds the engine. */
export function setDictionary(patch: { enabled?: boolean; language?: string }): Promise<SaveResult & { dictionary?: { language: string; words: string[]; ignore: string[]; enabled: boolean } }> {
  return enqueueWrite(async () => {
    if (!loaded) return { ok: false, error: "no project open" };
    const cur = loaded.project.dictionary ?? {};
    const d: ProjectDictionary = { ...cur };
    if (patch.enabled !== undefined) { if (patch.enabled) delete d.enabled; else d.enabled = false; } // default on: store only OFF
    if (patch.language !== undefined) { if (patch.language === deriveDictLanguage(loaded.project.locales.default)) delete d.language; else d.language = patch.language; }
    const dictionary = Object.keys(d).length ? d : undefined;
    const next: ProjectFile = { ...loaded.project, dictionary };
    const res = await commitWrites([{ path: loaded.projectFile, content: canonicalStringify(next) }]);
    if (!res.ok) return res;
    loaded.project = next;
    return { ok: true, dictionary: resolveDictionary(next) };
  });
}

/** Scaffold a new project into `dir` (runInit), commit the shards, then open it. */
export function createProject(dir: string, name?: string, vcs?: VcsKind, buildBundle?: string): Promise<OpenedProject> {
  return enqueueWrite(async () => {
    const init = runInit({ dir, name, vcs: vcs && vcs !== "none" ? vcs : undefined });
    const res = await commitWrites(init.writes);
    if (!res.ok) throw new Error(res.error ?? "could not write the new project");
    const opened = openProject(dir);
    // Pin the chosen build output (asked in the New-project dialog) when it isn't the dist/ default.
    if (loaded && buildBundle) {
      const nextExport = buildExport(loaded, buildBundle, "embedded", false, loaded.project.export);
      if (nextExport?.bundle) {
        loaded.project = { ...loaded.project, export: nextExport };
        await commitWrites([{ path: loaded.projectFile, content: canonicalStringify(loaded.project) }]);
      }
    }
    return opened;
  });
}
