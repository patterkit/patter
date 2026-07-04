// Scratch-recording WAV codec (#224): turn captured PCM into a 16-bit WAV with a text-hash stamped into a
// LIST/INFO/DINK chunk (the dink/dinky format) and trimmed silence. No Web Audio here - the recorder pulls
// Float32 channels off an AudioBuffer and hands them in - so this is fully unit-testable in node. The
// portable hash helpers (textHash / readDinkHash) live in shared/ so the main-process indexer shares them.

import { textHash, readDinkHash } from "../../shared/wav-hash.js";
export { textHash, readDinkHash };

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
 * trailing LIST/INFO/DINK chunk. Returns the file bytes.
 */
export function encodeScratchWav(channels: Float32Array[], sampleRate: number, hash: string): Uint8Array {
  const numChannels = channels.length || 1;
  const bitsPerSample = 16;
  const { start, end } = trimSilence(channels, sampleRate);
  const frames = Math.max(0, end - start + 1);
  const dataLength = frames * numChannels * (bitsPerSample / 8);

  const hashBytes = new TextEncoder().encode(hash || "");
  const pad = hashBytes.length % 2 !== 0 ? 1 : 0;
  const dinkSize = 8 + hashBytes.length + pad; // "DINK" + uint32 size + data (+pad)
  const listContent = 4 + dinkSize;            // "INFO" + DINK subchunk
  const listTotal = 8 + listContent;           // "LIST" + uint32 size + content

  const buffer = new ArrayBuffer(44 + dataLength + listTotal);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLength + listTotal, true);
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
  writeAscii(view, offset, "LIST"); offset += 4;
  view.setUint32(offset, listContent, true); offset += 4;
  writeAscii(view, offset, "INFO"); offset += 4;
  writeAscii(view, offset, "DINK"); offset += 4;
  view.setUint32(offset, hashBytes.length, true); offset += 4;
  for (let i = 0; i < hashBytes.length; i++) view.setUint8(offset + i, hashBytes[i]!);
  // trailing pad byte (already zero-filled by ArrayBuffer)

  return new Uint8Array(buffer);
}
