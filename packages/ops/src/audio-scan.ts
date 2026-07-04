// ---------------------------------------------------------------------------
// One-shot Audio Folders scan (#206): derive each beat's recording status from the takes on
// disk, with EXACTLY the rules Patterpad's live indexer applies (main/audio-index.ts): a beat
// lands on the HIGHEST rung whose derived folder holds its `<beatId>.wav` or `.mp3`; a beat in
// no folder is implicitly the lowest rung (absent from the map). This is the CLI's route to the
// same truth the editor shows - one pipeline, two callers.
//
// Returns undefined when the project doesn't derive status from folders at all (not voiced, not
// tracking audio status, Audio Folders off, or no audio root), so callers fall back to the
// manual recording map exactly as Patterpad does.
// ---------------------------------------------------------------------------

import { readdirSync } from "node:fs";
import { resolve, extname, basename } from "node:path";
import { deriveRecordingFolders, DEFAULT_RECORDING_STATUSES } from "@patterkit/model";
import type { LoadedProject } from "./load.js";

const AUDIO_EXT = new Set([".wav", ".mp3"]);

export function scanAudioStatus(loaded: LoadedProject): Map<string, string> | undefined {
  const p = loaded.project;
  const tracked = !!p.voiced && (p.trackAudioStatus ?? false);
  if (!tracked || !p.audioFolders || !p.audioRoot?.trim()) return undefined;

  const rungs = deriveRecordingFolders(p.audioRoot, p.recordingStatuses ?? DEFAULT_RECORDING_STATUSES);
  const out = new Map<string, string>();
  // Lowest -> highest with later rungs overwriting, so the highest rung holding a take wins.
  for (const rung of rungs) {
    if (!rung.folder) continue; // the baseline rung has no folder by design
    let files: string[];
    try { files = readdirSync(resolve(loaded.root, rung.folder)); }
    catch { continue; } // missing / unreadable folder -> treated as empty (same as the indexer)
    for (const f of files) {
      const ext = extname(f).toLowerCase();
      if (AUDIO_EXT.has(ext)) out.set(basename(f, extname(f)), rung.name);
    }
  }
  return out;
}
