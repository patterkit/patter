// Scratch-recording WAV codec (#224): turn captured PCM into a 16-bit WAV with the line's text hash stamped
// into a LIST/INFO/PTRK chunk and trimmed silence. No Web Audio here - the recorder pulls Float32 channels off
// an AudioBuffer and hands them in - so this is fully unit-testable in node. The stamp helpers come from
// @patterkit/core (via shared/), so the main-process indexer, ops, and the CLI read and write the same thing.

import { textHash, readTextStamp, infoListChunk, TEXT_STAMP } from "../../shared/wav-hash.js";
export { textHash, readTextStamp };

const THRESHOLD = 0.01;   // amplitude below this counts as silence
const PAD_SECONDS = 0.05; // keep 50ms either side of the speech so it doesn't sound clipped

/** The [start, end] sample range with leading/trailing silence trimmed (inclusive), padded by 50ms. Returns
 *  the full range if the clip is silent throughout. */
export function trimSilence(channels: Float32Array[], sampleRate: number): { start: number; end: number } {
  const total = channels[0]?.length ?? 0;
  if (total === 0) return { start: 0, end: -1 };
  const pad = Math.floor(sampleRate * PAD_SECONDS);
  const amp = (i: number): number => { let m = 0; for (const ch of channels) m = Math.max(m, Math.abs(ch[i] ?? 0)); return m; };
  let start = 0, end = total - 1;
  for (let i = 0; i < total; i++) { if (amp(i) > THRESHOLD) { start = Math.max(0, i - pad); break; } }
  for (let i = total - 1; i >= start; i--) { if (amp(i) > THRESHOLD) { end = Math.min(total - 1, i + pad); break; } }
  return { start, end };
}

function writeAscii(view: DataView, offset: number, s: string): void {
  for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
}

/**
 * Encode PCM channels to a 16-bit WAV, with leading/trailing silence trimmed and `hash` stamped into a
 * trailing LIST/INFO/PTRK chunk. Returns the file bytes.
 */
export function encodeScratchWav(channels: Float32Array[], sampleRate: number, hash: string): Uint8Array {
  const numChannels = channels.length || 1;
  const bitsPerSample = 16;
  const { start, end } = trimSilence(channels, sampleRate);
  const frames = Math.max(0, end - start + 1);
  const dataLength = frames * numChannels * (bitsPerSample / 8);
  const list = infoListChunk([[TEXT_STAMP, hash || ""]]);

  const buffer = new ArrayBuffer(44 + dataLength + list.length);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLength + list.length, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true);
  view.setUint16(32, numChannels * (bitsPerSample / 8), true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = start; i <= end; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const s = Math.max(-1, Math.min(1, channels[ch]?.[i] ?? 0));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  new Uint8Array(buffer).set(list, offset);
  return new Uint8Array(buffer);
}
