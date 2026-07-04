// ---------------------------------------------------------------------------
// createAudioResolver: map a beat id to its winning audio path via the
// patteraudio.json manifest + a base path. Missing beats -> null.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { createAudioResolver } from "../src/index.js";

const MANIFEST = JSON.stringify({
  schema: "patter/audio@0",
  clips: {
    L1: { file: "final/L1.wav", status: "final" },
    L2: { file: "scratch/L2.mp3", status: "scratch" },
  },
});

describe("createAudioResolver", () => {
  it("joins the base path with a beat's winning relative path", () => {
    const audio = createAudioResolver(MANIFEST, "audio");
    expect(audio.resolve("L1")).toBe("audio/final/L1.wav");
    expect(audio.resolve("L2")).toBe("audio/scratch/L2.mp3");
  });

  it("returns null for a beat with no recording", () => {
    const audio = createAudioResolver(MANIFEST, "audio");
    expect(audio.resolve("nope")).toBeNull();
  });

  it("trims a trailing slash on the base and tolerates an empty base", () => {
    expect(createAudioResolver(MANIFEST, "https://cdn.example.com/audio/").resolve("L1")).toBe("https://cdn.example.com/audio/final/L1.wav");
    expect(createAudioResolver(MANIFEST, "").resolve("L1")).toBe("final/L1.wav");
  });

  it("handles an empty / clip-less manifest without throwing", () => {
    expect(createAudioResolver(JSON.stringify({ schema: "patter/audio@0" }), "audio").resolve("L1")).toBeNull();
  });
});
