// The sidecar audio-manifest builder (#206): turn the folder-index snapshot into patteraudio.json,
// each beat's winning clip made root-relative (forward-slashed) against the audio root.

import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { audioManifest, AUDIO_MANIFEST_SCHEMA, type AudioSnapshot } from "../src/main/audio-index.js";

describe("audioManifest", () => {
  it("emits root-relative winning paths + status, keyed + sorted by beatId", () => {
    const projectRoot = join("/tmp", "proj");
    const audioRoot = "audio";
    const base = join(projectRoot, audioRoot);
    const snapshot: AudioSnapshot = {
      L2: { status: "scratch", path: join(base, "scratch", "L2.mp3") },
      L1: { status: "final", path: join(base, "final", "L1.wav") },
    };

    const parsed = JSON.parse(audioManifest(snapshot, projectRoot, audioRoot));
    expect(parsed.schema).toBe(AUDIO_MANIFEST_SCHEMA);
    expect(Object.keys(parsed.clips)).toEqual(["L1", "L2"]); // sorted
    expect(parsed.clips.L1).toEqual({ file: "final/L1.wav", status: "final" });   // forward-slashed, root-relative
    expect(parsed.clips.L2).toEqual({ file: "scratch/L2.mp3", status: "scratch" });
  });

  it("resolves a relative audio root the same way (paths stay relative to the root)", () => {
    const projectRoot = join("/tmp", "proj");
    const snapshot: AudioSnapshot = { A: { status: "recorded", path: join(projectRoot, "media", "recorded", "A.wav") } };
    const parsed = JSON.parse(audioManifest(snapshot, projectRoot, "media"));
    expect(parsed.clips.A.file).toBe("recorded/A.wav");
  });
});
