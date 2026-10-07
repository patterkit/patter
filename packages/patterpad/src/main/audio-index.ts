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
import { audioFolderRungs, pickAudio } from "@patterkit/ops";
import type { AudioRung, AudioSnapshot } from "@patterkit/ops";
import { readDinkHash } from "../shared/wav-hash.js";

// The rules (which take wins, the manifest's shape) are ops', shared with `patter export`; this module is
// only the live half: watching the folders and re-scanning when they change.
export type { AudioRung, AudioEntry, AudioSnapshot } from "@patterkit/ops";
export { audioManifest, AUDIO_MANIFEST_FILE, AUDIO_MANIFEST_SCHEMA } from "@patterkit/ops";

export interface AudioIndexHandle {
  /** The ladder (folders) or scratch rung changed: re-watch + re-scan. */
  update(rungs: AudioRung[], scratchStatus?: string): void;
  /** Force a re-scan now (e.g. a manual "Rescan audio"). */
  rescan(): void;
  /** Stop watching + release everything. */
  dispose(): void;
}


/**
 * Start watching the project's audio folders. `rungs` is the recording ladder lowest -> highest (as stored);
 * lookup runs highest -> lowest so the most-finished take wins. `onSnapshot` fires (debounced) on every change.
 */
export function startAudioIndex(projectRoot: string, rungs: AudioRung[], onSnapshot: (snap: AudioSnapshot) => void, scratchStatus?: string): AudioIndexHandle {
  let current = rungs;
  let scratch = scratchStatus; // the rung whose takes carry a text-hash we read back for staleness (#224)
  const watchers = new Map<string, FSWatcher>(); // absolute dir -> live watcher
  let debounce: NodeJS.Timeout | undefined;
  let disposed = false;

  // Rungs with a folder, HIGHEST priority first (the most-finished take wins over a rougher one).
  const folderRungs = (): Array<{ name: string; dir: string }> => audioFolderRungs(projectRoot, current);

  const scan = async (): Promise<void> => {
    ensureWatchers(); // folders can appear AFTER start (the first scratch take creates its folder) - retry here
    const listings: Array<{ name: string; dir: string; files: string[] | undefined }> = [];
    for (const { name, dir } of folderRungs()) {
      let files: string[] | undefined;
      try { files = await readdir(dir); } catch {
        // Missing / unreadable folder -> treated as empty. Drop any watcher it had (a deleted-and-recreated
        // folder needs a FRESH watch; the dead one would block re-attachment above).
        const w = watchers.get(dir);
        if (w) { try { w.close(); } catch { /* already gone */ } watchers.delete(dir); }
      }
      listings.push({ name, dir, files });
    }
    const snap: AudioSnapshot = pickAudio(listings);
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

  // (Re)align watchers with the current rung folders: close watchers for dirs no longer in the ladder,
  // attach to any unwatched dir. A dir that doesn't exist yet fails quietly and is RETRIED on every scan -
  // the first scratch take creates its folder after start, and without the retry that folder was never
  // watched, so the derived status only refreshed on app reload (found on a fresh Windows project).
  const ensureWatchers = (): void => {
    const dirs = new Set(folderRungs().map((r) => r.dir));
    for (const [dir, w] of watchers) {
      if (!dirs.has(dir)) { try { w.close(); } catch { /* already gone */ } watchers.delete(dir); }
    }
    for (const dir of dirs) {
      if (watchers.has(dir)) continue;
      try { watchers.set(dir, watch(dir, { persistent: false }, () => scheduleScan())); } catch { /* not yet present - retried next scan */ }
    }
  };

  void scan(); // initial (attaches watchers on the way in)

  return {
    update(next: AudioRung[], nextScratch?: string): void { current = next; scratch = nextScratch; scheduleScan(); },
    rescan(): void { scheduleScan(); },
    dispose(): void {
      disposed = true;
      if (debounce) clearTimeout(debounce);
      for (const w of watchers.values()) { try { w.close(); } catch { /* already gone */ } }
      watchers.clear();
    },
  };
}
