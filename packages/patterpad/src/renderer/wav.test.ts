// @vitest-environment node
// The scratch-recording WAV codec (#224): the FNV text-hash, the silence trim, and the round-trip of the
// hash through a real WAV's LIST/INFO/DINK chunk. Pure functions, so no Web Audio / browser needed.

import { describe, it, expect } from "vitest";
import { textHash, trimSilence, encodeScratchWav, readDinkHash } from "./src/wav.js";

const ascii = (b: Uint8Array, o: number, n: number): string => String.fromCharCode(...b.slice(o, o + n));

describe("wav: text hash", () => {
  it("is stable, 6 chars, and distinguishes different text; empty -> 000000", () => {
    expect(textHash("")).toBe("000000");
    const a = textHash("What'll it be, stranger?");
    expect(a).toHaveLength(6);
    expect(textHash("What'll it be, stranger?")).toBe(a); // deterministic
    expect(textHash("Something else entirely")).not.toBe(a);
  });

  it("ignores punctuation, whitespace, and inline formatting - only wording changes the hash (#224)", () => {
    const base = textHash("What'll it be, stranger?");
    expect(textHash("Whatll it be stranger")).toBe(base);          // punctuation dropped
    expect(textHash("  What'll   it be,   stranger? ")).toBe(base); // whitespace collapsed / trimmed
    expect(textHash("What'll it be, <b>stranger</b>?")).toBe(base); // <b>/<i>/<bi> tags stripped
    expect(textHash("What'll it be, friend?")).not.toBe(base);      // a real wording change still restales
    expect(textHash("!!! ...")).toBe("000000");                     // punctuation-only normalises to empty
  });
});

describe("wav: silence trim", () => {
  it("trims leading/trailing silence but keeps speech (with 50ms padding)", () => {
    const sr = 1000; // 1kHz so 50ms = 50 samples
    const ch = new Float32Array(1000); // all silent...
    for (let i = 400; i < 600; i++) ch[i] = 0.5; // ...except a burst in the middle
    const { start, end } = trimSilence([ch], sr);
    expect(start).toBe(400 - 50); // padded back 50ms
    expect(end).toBe(599 + 50);   // padded forward 50ms
  });

  it("returns the full range for a clip that is silent throughout", () => {
    const ch = new Float32Array(100);
    expect(trimSilence([ch], 1000)).toEqual({ start: 0, end: 99 });
  });
});

describe("wav: encode + read back the DINK hash", () => {
  it("produces a valid RIFF/WAVE file with the hash stamped in a LIST/INFO/DINK chunk", () => {
    const sr = 8000;
    const ch = new Float32Array(sr); // 1s
    for (let i = 1000; i < 7000; i++) ch[i] = Math.sin(i / 10) * 0.6; // some non-silent signal
    const hash = textHash("a recorded line");
    const wav = encodeScratchWav([ch], sr, hash);

    expect(ascii(wav, 0, 4)).toBe("RIFF");
    expect(ascii(wav, 8, 4)).toBe("WAVE");
    expect(readDinkHash(wav)).toBe(hash);
  });

  it("round-trips a hash that needs an odd-length pad byte", () => {
    const wav = encodeScratchWav([new Float32Array(10)], 8000, "abc"); // 3 bytes -> needs padding
    expect(readDinkHash(wav)).toBe("abc");
  });

  it("returns null reading a buffer with no DINK chunk", () => {
    // a bare RIFF/WAVE with just a fmt-less data stub is enough to exercise the walk
    const buf = new Uint8Array(12);
    const dv = new DataView(buf.buffer);
    for (const [o, s] of [[0, "RIFF"], [8, "WAVE"]] as const) for (let i = 0; i < 4; i++) dv.setUint8(o + i, s.charCodeAt(i));
    expect(readDinkHash(buf)).toBeNull();
  });
});
