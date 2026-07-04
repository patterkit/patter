// The Audio Folders indexer (main/audio-index.ts): given a project root + the recording ladder, it
// resolves each dialogue beat's status from the audio files on disk. Real-fs test (the watcher can't be
// exercised in the preview): drop <beatId>.wav/.mp3 into per-rung folders, scan, assert the snapshot.

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startAudioIndex, type AudioIndexHandle, type AudioSnapshot } from "../src/main/audio-index.js";
import { encodeScratchWav, textHash } from "../src/renderer/src/wav.js";

// The ladder as stored: lowest -> highest. "missing" has no folder (it's the implicit absence).
const LADDER = [
  { name: "missing" },
  { name: "scratch", folder: "audio/scratch" },
  { name: "recorded", folder: "audio/recorded" },
];

let handle: AudioIndexHandle | null = null;
afterEach(() => { handle?.dispose(); handle = null; });

/** Start the index and resolve the FIRST snapshot it emits (the initial scan). */
function firstSnapshot(root: string, scratch?: string): Promise<AudioSnapshot> {
  return new Promise((res) => { handle = startAudioIndex(root, LADDER, (snap) => res(snap), scratch); });
}

describe("audio-index: folder-derived recording status", () => {
  it("resolves the highest rung that holds the file; .wav beats .mp3; absent = missing", async () => {
    const root = mkdtempSync(join(tmpdir(), "patter-audio-"));
    mkdirSync(join(root, "audio/scratch"), { recursive: true });
    mkdirSync(join(root, "audio/recorded"), { recursive: true });
    // L_a: in BOTH scratch + recorded -> the higher rung (recorded) wins.
    writeFileSync(join(root, "audio/scratch/L_a.mp3"), "x");
    writeFileSync(join(root, "audio/recorded/L_a.wav"), "x");
    // L_b: only scratch.
    writeFileSync(join(root, "audio/scratch/L_b.wav"), "x");
    // L_c: both .wav + .mp3 in the same folder -> .wav preferred.
    writeFileSync(join(root, "audio/recorded/L_c.mp3"), "x");
    writeFileSync(join(root, "audio/recorded/L_c.wav"), "x");
    // a non-audio file is ignored.
    writeFileSync(join(root, "audio/scratch/notes.txt"), "x");

    const snap = await firstSnapshot(root);
    expect(snap["L_a"]).toEqual({ status: "recorded", path: join(root, "audio/recorded/L_a.wav") });
    expect(snap["L_b"]).toEqual({ status: "scratch", path: join(root, "audio/scratch/L_b.wav") });
    expect(snap["L_c"]).toEqual({ status: "recorded", path: join(root, "audio/recorded/L_c.wav") });
    expect(snap["L_missing"]).toBeUndefined(); // never recorded -> implicitly "missing"
    expect(Object.keys(snap).sort()).toEqual(["L_a", "L_b", "L_c"]);
    rmSync(root, { recursive: true, force: true });
  });

  it("reads the stamped text-hash for scratch-rung takes (#224)", async () => {
    const root = mkdtempSync(join(tmpdir(), "patter-audio-"));
    mkdirSync(join(root, "audio/scratch"), { recursive: true });
    mkdirSync(join(root, "audio/recorded"), { recursive: true });
    // A real scratch take, hash-stamped, in the scratch folder.
    writeFileSync(join(root, "audio/scratch/L_a.wav"), encodeScratchWav([new Float32Array(800)], 8000, textHash("hello there")));
    // A recorded take (not the scratch rung) - its hash is NOT read (out-of-date only matters for scratch).
    writeFileSync(join(root, "audio/recorded/L_b.wav"), encodeScratchWav([new Float32Array(800)], 8000, textHash("other")));

    const snap = await firstSnapshot(root, "scratch");
    expect(snap["L_a"]?.status).toBe("scratch");
    expect(snap["L_a"]?.textHash).toBe(textHash("hello there"));
    expect(snap["L_b"]?.status).toBe("recorded");
    expect(snap["L_b"]?.textHash).toBeUndefined(); // not the scratch rung -> not read
    rmSync(root, { recursive: true, force: true });
  });

  it("a missing folder is treated as empty, not an error", async () => {
    const root = mkdtempSync(join(tmpdir(), "patter-audio-"));
    mkdirSync(join(root, "audio/scratch"), { recursive: true }); // recorded/ never created
    writeFileSync(join(root, "audio/scratch/L_only.wav"), "x");
    const snap = await firstSnapshot(root);
    expect(snap["L_only"]).toEqual({ status: "scratch", path: join(root, "audio/scratch/L_only.wav") });
    rmSync(root, { recursive: true, force: true });
  });
});
