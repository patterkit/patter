// ---------------------------------------------------------------------------
// Audio Folders (#206): each beat's winning take, from the files on disk, and the
// sidecar manifest (`patteraudio.json`) that tells a game where it is. One set of
// rules for every front end: a beat lands on the HIGHEST rung whose derived
// folder holds its `<beatId>.wav` (preferred) or `.mp3`; a beat in no folder is
// implicitly the lowest rung (absent from the snapshot).
//
// Patterpad's live indexer (main/audio-index.ts) watches the folders and feeds
// its listings through `pickAudio`; the CLI scans once with `scanAudio`. Both
// used to carry a copy of the rules, and only Patterpad wrote the manifest, so
// `patter export` in CI never refreshed it.
// ---------------------------------------------------------------------------

import { readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { deriveRecordingFolders, DEFAULT_RECORDING_STATUSES } from "@patterkit/model";
import type { ProjectFile } from "@patterkit/model";
import type { LoadedProject } from "./load.js";
import type { PlannedWrite } from "./write.js";

/** A recording ladder rung as the indexer needs it: a name and its (optional) project-relative folder. */
export interface AudioRung { name: string; folder?: string }
/** One resolved beat: the rung it landed in, the absolute path to its audio file, and (for scratch takes)
 *  the text-hash stamped in the WAV so the editor can flag a take that's gone stale against its line. */
export interface AudioEntry { status: string; path: string; textHash?: string }
/** beatId -> resolved audio. Absent ids are implicitly "missing". */
export type AudioSnapshot = Record<string, AudioEntry>;

/** The sidecar audio manifest (`patteraudio.json`): each beat's winning clip, keyed by beatId, with its
 *  path relative to the audio root (forward-slashed) + the rung it resolved to. Consumed by the runtimes'
 *  audio resolvers. Kept OUT of the .patterc so audio stays decoupled from story rebuilds. */
export const AUDIO_MANIFEST_SCHEMA = "patter/audio@0";
export const AUDIO_MANIFEST_FILE = "patteraudio.json";

const AUDIO_EXT = [".wav", ".mp3"]; // .wav preferred when both exist for an id

/** Whether a project derives recording status from folders at all: voiced, tracking audio status, Audio
 *  Folders on, and an audio root set. */
export function audioFoldersActive(p: ProjectFile): boolean {
  return !!p.voiced && (p.trackAudioStatus ?? false) && !!p.audioFolders && !!p.audioRoot?.trim();
}

/** The ladder's rungs that have a folder, HIGHEST priority first (the most-finished take wins), with each
 *  folder made absolute against the project root. */
export function audioFolderRungs(root: string, rungs: AudioRung[]): Array<{ name: string; dir: string }> {
  return rungs.filter((r) => r.folder?.trim()).reverse().map((r) => ({ name: r.name, dir: resolve(root, r.folder!.trim()) }));
}

/** The snapshot from each rung folder's listing, highest rung first (`undefined` files = a folder that is
 *  missing or unreadable, treated as empty). Within a folder a `.wav` beats an `.mp3` of the same id; a
 *  higher rung that already claimed an id wins overall. */
export function pickAudio(listings: Array<{ name: string; dir: string; files: string[] | undefined }>): AudioSnapshot {
  const snap: AudioSnapshot = {};
  for (const { name, dir, files } of listings) {
    const byId = new Map<string, string>();
    for (const f of files ?? []) {
      const dot = f.lastIndexOf(".");
      if (dot <= 0) continue;
      const ext = f.slice(dot).toLowerCase();
      if (!AUDIO_EXT.includes(ext)) continue;
      const id = f.slice(0, dot);
      const existing = byId.get(id);
      if (!existing || (ext === ".wav" && !existing.toLowerCase().endsWith(".wav"))) byId.set(id, f);
    }
    for (const [id, file] of byId) if (!(id in snap)) snap[id] = { status: name, path: resolve(dir, file) };
  }
  return snap;
}

/** One synchronous scan of a project's audio folders, or undefined when it does not use them. */
export function scanAudio(loaded: LoadedProject): AudioSnapshot | undefined {
  const p = loaded.project;
  if (!audioFoldersActive(p)) return undefined;
  const rungs = audioFolderRungs(loaded.root, deriveRecordingFolders(p.audioRoot!, p.recordingStatuses ?? DEFAULT_RECORDING_STATUSES));
  return pickAudio(rungs.map((r) => {
    let files: string[] | undefined;
    try { files = readdirSync(r.dir); } catch { files = undefined; }
    return { ...r, files };
  }));
}

/** beatId -> derived recording status, for the report and the voice script; undefined when the project
 *  doesn't derive status from folders, so callers fall back to the manual recording map as Patterpad does. */
export function scanAudioStatus(loaded: LoadedProject): Map<string, string> | undefined {
  const snap = scanAudio(loaded);
  return snap && new Map(Object.entries(snap).map(([id, e]) => [id, e.status]));
}

/** Serialise a snapshot into the sidecar manifest JSON, with each absolute path made root-relative
 *  (forward-slashed) against `<projectRoot>/<audioRoot>`. */
export function audioManifest(snapshot: AudioSnapshot, projectRoot: string, audioRoot: string): string {
  const base = resolve(projectRoot, audioRoot);
  const clips: Record<string, { file: string; status: string }> = {};
  for (const beatId of Object.keys(snapshot).sort()) {
    const entry = snapshot[beatId]!;
    clips[beatId] = { file: relative(base, entry.path).split(sep).join("/"), status: entry.status };
  }
  return JSON.stringify({ schema: AUDIO_MANIFEST_SCHEMA, clips }, null, 2) + "\n";
}

/** The manifest write for a snapshot, beside the audio; undefined when the project does not use Audio
 *  Folders or no take has been found yet. */
export function audioManifestWrite(loaded: LoadedProject, snapshot: AudioSnapshot | undefined): PlannedWrite | undefined {
  const p = loaded.project;
  if (!snapshot || !audioFoldersActive(p) || !Object.keys(snapshot).length) return undefined;
  return { path: join(resolve(loaded.root, p.audioRoot!), AUDIO_MANIFEST_FILE), content: audioManifest(snapshot, loaded.root, p.audioRoot!) };
}
