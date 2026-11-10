import { describe, it, expect } from "vitest";
import { textHash, readInfoChunks, readTextStamp, readGeneratedStamp, infoListChunk, withStamps, isWav } from "../src/index.js";

const bytesOf = (...parts: Array<string | number[] | Uint8Array>): Uint8Array => {
  const chunks = parts.map((p) => typeof p === "string" ? new TextEncoder().encode(p) : p instanceof Uint8Array ? p : new Uint8Array(p));
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
};
const le32 = (n: number): number[] => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];

/** A minimal WAV: fmt, four bytes of data, then whatever chunks follow. */
function wav(...after: Uint8Array[]): Uint8Array {
  const fmt = bytesOf("fmt ", le32(16), [1, 0, 1, 0], le32(16000), le32(32000), [2, 0, 16, 0]);
  const data = bytesOf("data", le32(4), [1, 2, 3, 4]);
  const body = bytesOf("WAVE", fmt, data, ...after);
  return bytesOf("RIFF", le32(body.length), body);
}
/** A list written the way Dink and earlier Patterpads wrote it: DINK, the hash with no terminator. */
const oldDinkList = (hash: string): Uint8Array => {
  const pad = hash.length % 2;
  const sub = bytesOf("DINK", le32(hash.length), hash, new Array(pad).fill(0));
  return bytesOf("LIST", le32(4 + sub.length), "INFO", sub);
};

describe("take stamps", () => {
  it("hashes wording, not punctuation, tags, or spacing", () => {
    expect(textHash("Hello,  <b>there</b>!")).toBe(textHash("hello there".replace("h", "H")));
    expect(textHash("")).toBe("000000");
    expect(textHash("one")).not.toBe(textHash("two"));
  });

  it("reads the text stamp as PTRK, and from an older DINK chunk", () => {
    const w = wav(infoListChunk([["PTRK", "abc123"]]));
    expect(readTextStamp(w)).toBe("abc123");
    expect(readTextStamp(wav(oldDinkList("xyz789")))).toBe("xyz789");
    expect(readTextStamp(wav(oldDinkList("odd")))).toBe("odd"); // padded to an even length
    expect(readTextStamp(wav())).toBeNull();
  });

  it("reads the generated stamp as PTPS, and from Patterstage's PSVT", () => {
    expect(readGeneratedStamp(wav(infoListChunk([["PTRK", "a"], ["PTPS", "req1"]])))).toBe("req1");
    expect(readGeneratedStamp(wav(infoListChunk([["PSVT", "req2"]])))).toBe("req2");
    expect(readGeneratedStamp(wav(infoListChunk([["PTRK", "a"]])))).toBeNull();
  });

  it("replaces any INFO list, keeps the audio, and fixes the RIFF size", () => {
    const before = wav(oldDinkList("old"), infoListChunk([["ISFT", "Lavf"]]));
    const after = withStamps(before, [["PTRK", "new"], ["PTPS", "r"]]);
    const info = readInfoChunks(after);
    expect([...info.keys()]).toEqual(["PTRK", "PTPS"]);
    expect(info.get("PTRK")).toBe("new");
    expect(new DataView(after.buffer).getUint32(4, true)).toBe(after.length - 8);
    expect(isWav(after)).toBe(true);
    // the data chunk survives byte for byte
    const at = (b: Uint8Array): number => { for (let i = 12; i < b.length - 4; i++) if (String.fromCharCode(...b.subarray(i, i + 4)) === "data") return i; return -1; };
    expect([...after.subarray(at(after), at(after) + 12)]).toEqual([...before.subarray(at(before), at(before) + 12)]);
  });

  it("refuses to stamp something that isn't a WAV", () => {
    expect(() => withStamps(new Uint8Array([1, 2, 3]), [["PTRK", "x"]])).toThrow();
    expect(readInfoChunks(new Uint8Array(4)).size).toBe(0);
  });
});
