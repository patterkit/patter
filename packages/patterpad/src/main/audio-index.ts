// Audio Folders index (#206): resolves each dialogue beat's recording status from audio files on disk.
//
// Self-contained + Electron-free: it takes a project root + the recording ladder (rungs that carry a
// project-relative `folder`) and emits an `id -> { status, path }` snapshot. A dialogue line's status is
// the HIGHEST-ranked rung whose folder holds its `<beatId>.wav` (preferred) or `.mp3`; a beat in no folder
// is implicitly "missing". All I/O is async (readdir) + event-driven (one fs.watch per flat folder,
// debounced), so it never blocks the main event loop; the editor reads a cached copy in the renderer and
// can't hitch. Structured for a clean lift into a utilityProcess later (no Electron deps, message-style API).

import { readdir, readFile } from "node:fs/promises";
import { watch, type FSWatcher } from "node:fs";
import { resolve, relative, sep } from "node:path";
import { readDinkHash } from "../shared/wav-hash.js";

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

/** Serialise a snapshot into the sidecar manifest JSON, with each absolute path made root-relative
 *  (forward-slashed) against `<projectRoot>/<audioRoot>`. Pure: build-time + Production action share it. */
export function audioManifest(snapshot: AudioSnapshot, projectRoot: string, audioRoot: string): string {
  const base = resolve(projectRoot, audioRoot);
  const clips: Record<string, { file: string; status: string }> = {};
  for (const beatId of Object.keys(snapshot).sort()) {
    const entry = snapshot[beatId]!;
    clips[beatId] = { file: relative(base, entry.path).split(sep).join("/"), status: entry.status };
  }
  return JSON.stringify({ schema: AUDIO_MANIFEST_SCHEMA, clips }, null, 2) + "\n";
}

export interface AudioIndexHandle {
  /** The ladder (folders) or scratch rung changed: re-watch + re-scan. */
  update(rungs: AudioRung[], scratchStatus?: string): void;
  /** Force a re-scan now (e.g. a manual "Rescan audio"). */
  rescan(): void;
  /** Stop watching + release everything. */
  dispose(): void;
}

const AUDIO_EXT = [".wav", ".mp3"]; // .wav preferred when both exist for an id

/**
 * Start watching the project's audio folders. `rungs` is the recording ladder lowest -> highest (as stored);
 * lookup runs highest -> lowest so the most-finished take wins. `onSnapshot` fires (debounced) on every change.
 */
export function startAudioIndex(projectRoot: string, rungs: AudioRung[], onSnapshot: (snap: AudioSnapshot) => void, scratchStatus?: string): AudioIndexHandle {
  let current = rungs;
  let scratch = scratchStatus; // the rung whose takes carry a text-hash we read back for staleness (#224)
  let watchers: FSWatcher[] = [];
  let debounce: NodeJS.Timeout | undefined;
  let disposed = false;

  // Rungs with a folder, HIGHEST priority first (the most-finished take wins over a rougher one).
  const folderRungs = (): Array<{ name: string; dir: string }> =>
    current.filter((r) => r.folder?.trim()).reverse().map((r) => ({ name: r.name, dir: resolve(projectRoot, r.folder!.trim()) }));

  const scan = async (): Promise<void> => {
    const rs = folderRungs();
    const snap: AudioSnapshot = {};
    for (const { name, dir } of rs) {
      let files: string[];
      try { files = await readdir(dir); } catch { continue; } // missing / unreadable folder -> treated as empty
      // Within a folder, map id -> best file (wav beats mp3); a HIGHER rung already claimed wins overall.
      const byId = new Map<string, string>();
      for (const f of files) {
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
    // For lines that resolved to the scratch rung, read the take's stamped text-hash so the editor can flag
    // a scratch recording that's gone stale against its (edited) line. Scoped to scratch to bound the I/O.
    if (scratch) {
      await Promise.all(Object.values(snap).filter((e) => e.status === scratch && e.path.toLowerCase().endsWith(".wav")).map(async (e) => {
        try { e.textHash = readDinkHash(await readFile(e.path)) ?? undefined; } catch { /* unreadable -> no stamp */ }
      }));
    }
    if (!disposed) onSnapshot(snap);
  };

  const scheduleScan = (): void => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => { void scan(); }, 250); // coarse: changes needn't be instant
  };

  const rewatch = (): void => {
    for (const w of watchers) { try { w.close(); } catch { /* already gone */ } }
    watchers = [];
    for (const { dir } of folderRungs()) {
      try { watchers.push(watch(dir, { persistent: false }, () => scheduleScan())); } catch { /* not yet present */ }
    }
  };

  rewatch();
  void scan(); // initial

  return {
    update(next: AudioRung[], nextScratch?: string): void { current = next; scratch = nextScratch; rewatch(); scheduleScan(); },
    rescan(): void { scheduleScan(); },
    dispose(): void {
      disposed = true;
      if (debounce) clearTimeout(debounce);
      for (const w of watchers) { try { w.close(); } catch { /* already gone */ } }
      watchers = [];
    },
  };
}
