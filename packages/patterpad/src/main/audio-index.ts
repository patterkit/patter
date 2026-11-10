// Audio Folders index (#206): resolves each dialogue beat's recording status from audio files on disk.
//
// Self-contained + Electron-free: it takes a project root + the recording ladder (rungs that carry a
// project-relative `folder`) and emits an `id -> { status, path }` snapshot. A dialogue line's status is
// the HIGHEST-ranked rung whose folder holds its `<beatId>.wav`, `.ogg` or `.mp3` (in that order of preference); a beat in no folder
// is implicitly "missing". All I/O is async (readdir) + event-driven (one fs.watch per flat folder,
// debounced), so it never blocks the main event loop; the editor reads a cached copy in the renderer and
// can't hitch. Structured for a clean lift into a utilityProcess later (no Electron deps, message-style API).

import { readdir, open, type FileHandle } from "node:fs/promises";
import { watch, type FSWatcher } from "node:fs";
import { audioFolderRungs, pickAudio } from "@patterkit/ops";
import type { AudioRung, AudioSnapshot } from "@patterkit/ops";
import { readInfoChunks, TEXT_STAMP, GENERATED_STAMP } from "../shared/wav-hash.js";

// The rules (which take wins, the manifest's shape) are ops', shared with `patter export`; this module is
// only the live half: watching the folders and re-scanning when they change.
export type { AudioRung, AudioEntry, AudioSnapshot } from "@patterkit/ops";
export { audioManifest, AUDIO_MANIFEST_FILE, AUDIO_MANIFEST_SCHEMA } from "@patterkit/ops";

export interface AudioIndexHandle {
  /** The ladder (folders) or scratch rung changed: re-watch + re-scan. */
  update(rungs: AudioRung[], stampRungs?: string[]): void;
  /** Force a re-scan now (e.g. a manual "Rescan audio"). */
  rescan(): void;
  /** Stop watching + release everything. */
  dispose(): void;
}


/** A take's stamps, cached by path against its size and modified time, so a rescan with thousands of takes only
 *  reads the ones that changed. */
const stampCache = new Map<string, { size: number; mtimeMs: number; text?: string; generated?: string }>();

/** Read a WAV's stamps without reading its audio: walk the RIFF chunk headers, skipping each chunk's body, and
 *  read only a LIST chunk (capped, as a stamp list is tiny). Exported for tests. */
export async function readStamps(path: string): Promise<{ text?: string; generated?: string }> {
  let fh: FileHandle | undefined;
  try {
    fh = await open(path, "r");
    const { size, mtimeMs } = await fh.stat();
    const hit = stampCache.get(path);
    if (hit && hit.size === size && hit.mtimeMs === mtimeMs) return { text: hit.text, generated: hit.generated };
    const head = Buffer.alloc(12);
    await fh.read(head, 0, 12, 0);
    const found: { text?: string; generated?: string } = {};
    if (head.toString("ascii", 0, 4) === "RIFF" && head.toString("ascii", 8, 12) === "WAVE") {
      const hdr = Buffer.alloc(8);
      for (let pos = 12; pos + 8 <= size;) {
        await fh.read(hdr, 0, 8, pos);
        const id = hdr.toString("ascii", 0, 4);
        const len = hdr.readUInt32LE(4);
        if (id === "LIST" && len <= 64 * 1024) {
          const list = Buffer.alloc(8 + len);
          await fh.read(list, 0, list.length, pos);
          const info = readInfoChunks(new Uint8Array(Buffer.concat([head, list])));
          found.text ??= info.get(TEXT_STAMP) ?? info.get("DINK");
          found.generated ??= info.get(GENERATED_STAMP) ?? info.get("PSVT");
        }
        pos += 8 + len + (len % 2);
      }
    }
    stampCache.set(path, { size, mtimeMs, ...found });
    return found;
  } catch { return {}; } // unreadable -> no stamps
  finally { await fh?.close(); }
}

/**
 * Start watching the project's audio folders. `rungs` is the recording ladder lowest -> highest (as stored);
 * lookup runs highest -> lowest so the most-finished take wins. `onSnapshot` fires (debounced) on every change.
 */
export function startAudioIndex(projectRoot: string, rungs: AudioRung[], onSnapshot: (snap: AudioSnapshot) => void, stampRungs: string[] = []): AudioIndexHandle {
  let current = rungs;
  let stamped = new Set(stampRungs); // the statuses whose takes we read stamps from (scratch and below, #224)
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
    // For lines that resolved to a status at or below scratch, read the take's stamps: the text hash, so the
    // editor can flag a take gone out of date against its (edited) line, and Placeholder Speech's mark. Only
    // the chunk headers are read, and a take unchanged since the last scan is answered from the cache.
    await Promise.all(Object.values(snap).filter((e) => stamped.has(e.status) && e.path.toLowerCase().endsWith(".wav")).map(async (e) => {
      const st = await readStamps(e.path);
      if (st.text) e.textHash = st.text;
      if (st.generated) e.generated = st.generated;
    }));
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
    update(next: AudioRung[], nextStampRungs: string[] = []): void { current = next; stamped = new Set(nextStampRungs); scheduleScan(); },
    rescan(): void { scheduleScan(); },
    dispose(): void {
      disposed = true;
      if (debounce) clearTimeout(debounce);
      for (const w of watchers.values()) { try { w.close(); } catch { /* already gone */ } }
      watchers.clear();
    },
  };
}
