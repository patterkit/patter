// Placeholder Speech in Patterpad's main process (patterkit design/proposals/placeholder-speech.md, section 6):
// a cut and paste carries a line's take to its new id; a deleted line's scratch take starts a week's clock and
// placeholder speech goes at once; Remove Takes for Deleted Lines finds what's left. No Google: nothing here
// makes speech.

import { describe, it, expect, vi, beforeAll } from "vitest";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const userData = mkdtempSync(join(tmpdir(), "pp-speech-user-"));
vi.mock("electron", () => ({ app: { getPath: () => userData, isPackaged: false }, dialog: {}, BrowserWindow: class {} }));

const { parseSource, canonicalStringify, withStamps, textHash } = await import("@patterkit/core");
const project = await import("../src/main/project.js");
const speech = await import("../src/main/placeholder-speech.js");
import type { ProjectFile, LocaleFile } from "@patterkit/model";

const TAVERN = fileURLToPath(new URL("../../../test-fixtures/tavern-example.patter", import.meta.url));
const SCENE = "scn_tavern";

/** A tiny WAV with the given stamps. */
function take(stamps: Array<[string, string]>): Uint8Array {
  const out = new Uint8Array(48), v = new DataView(out.buffer);
  const put = (at: number, s: string): void => { for (let i = 0; i < 4; i++) out[at + i] = s.charCodeAt(i); };
  put(0, "RIFF"); v.setUint32(4, 40, true); put(8, "WAVE"); put(12, "fmt "); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  put(36, "data"); v.setUint32(40, 4, true);
  return withStamps(out, stamps);
}

const notes: string[] = [];
let audio: string;

async function settled(check: () => boolean): Promise<void> {
  for (let i = 0; i < 80 && !check(); i++) await new Promise((r) => setTimeout(r, 50));
}

beforeAll(async () => {
  const dir = join(mkdtempSync(join(tmpdir(), "pp-speech-")), "tavern.patter");
  cpSync(TAVERN, dir, { recursive: true });
  const projFile = join(dir, "tavern.patterproj");
  const proj = parseSource(readFileSync(projFile, "utf8")) as ProjectFile;
  Object.assign(proj, { voiced: true, trackAudioStatus: true, audioFolders: true, audioRoot: "../audio", vcs: undefined,
    recordingStatuses: [{ name: "missing" }, { name: "placeholder" }, { name: "scratch" }, { name: "recorded" }],
    scratchStatus: "scratch", placeholderSpeech: { status: "placeholder", accent: "en-GB" } });
  writeFileSync(projFile, canonicalStringify(proj));
  audio = join(dir, "..", "audio");
  for (const f of ["placeholder", "scratch"]) mkdirSync(join(audio, f), { recursive: true });
  const loc = (parseSource(readFileSync(join(dir, "loc/en/tavern.patterloc"), "utf8")) as LocaleFile).strings;
  writeFileSync(join(audio, "scratch/L_greet.wav"), take([["PTRK", textHash(loc["L_greet"]!)]]));
  writeFileSync(join(audio, "scratch/L_work.wav"), take([["PTRK", textHash(loc["L_work"]!)]]));
  writeFileSync(join(audio, "placeholder/L_intim.wav"), take([["PTRK", textHash(loc["L_intim"]!)], ["PTPS", "0123456789abcdef"]]));
  speech.initPlaceholderSpeech({ jobs: { start: async () => ({ error: "no jobs in tests" }), cancel: () => {}, running: () => false }, note: (m) => notes.push(m), win: () => null });
  project.openProject(dir);
  project.hydrate();
  speech.projectOpened();
  await settled(() => Object.keys(project.audioCurrentSnapshot()).length === 3);
});

/** The scene with one line's id changed (a cut and paste) and another line taken out of the loc. */
function edited(): { flow: string; loc: string } {
  const src = project.readScene(SCENE);
  // L_greet becomes L_pasted (a cut and paste); L_work and L_intim are deleted outright.
  const parsed = parseSource(src.flowSource.replace(/"L_greet"/g, '"L_pasted"')) as unknown;
  const drop = new Set(["L_work", "L_intim"]);
  const prune = (n: unknown): void => {
    if (Array.isArray(n)) { for (let i = n.length - 1; i >= 0; i--) { const x = n[i] as { id?: string }; if (x && drop.has(x.id ?? "")) n.splice(i, 1); else prune(x); } return; }
    if (n && typeof n === "object") for (const v of Object.values(n as Record<string, unknown>)) prune(v);
  };
  prune(parsed);
  const flow = canonicalStringify(parsed);
  const loc = parseSource(src.locSource) as LocaleFile;
  loc.strings = { ...loc.strings, L_pasted: loc.strings["L_greet"]! };
  delete loc.strings["L_greet"];
  delete loc.strings["L_intim"];
  delete loc.strings["L_work"];
  return { flow, loc: canonicalStringify(loc) };
}

describe("takes for cut, pasted, and deleted lines", () => {
  it("moves a cut line's take to its pasted line, drops placeholder speech at once, and starts a scratch take's clock", async () => {
    const e = edited();
    expect((await project.saveScene(SCENE, e.flow, e.loc, "Tester")).ok).toBe(true);
    await settled(() => existsSync(join(audio, "scratch/L_pasted.wav")) && !existsSync(join(audio, "placeholder/L_intim.wav")));
    expect(existsSync(join(audio, "scratch/L_pasted.wav"))).toBe(true);
    expect(existsSync(join(audio, "scratch/L_greet.wav"))).toBe(false);
    expect(existsSync(join(audio, "placeholder/L_intim.wav"))).toBe(false);
    expect(existsSync(join(audio, "scratch/L_work.wav"))).toBe(true); // a week's grace
    const memory = JSON.parse(readFileSync(join(userData, "placeholder-speech.json"), "utf8")) as { deleted: Record<string, Record<string, string>> };
    expect(Object.keys(Object.values(memory.deleted)[0]!)).toEqual(["L_work"]);
  });

  it("removes the scratch take once the week is up, and Remove Takes for Deleted Lines finds what's left", async () => {
    const file = join(userData, "placeholder-speech.json");
    const memory = JSON.parse(readFileSync(file, "utf8")) as { deleted: Record<string, Record<string, string>> };
    const key = Object.keys(memory.deleted)[0]!;
    memory.deleted[key]!["L_work"] = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
    writeFileSync(file, JSON.stringify(memory));
    await settled(() => "L_work" in project.audioCurrentSnapshot());
    await speech.sweepDeleted();
    expect(existsSync(join(audio, "scratch/L_work.wav"))).toBe(false);
    expect(notes.some((n) => /Removed 1 scratch take/.test(n))).toBe(true);
    writeFileSync(join(audio, "scratch/L_orphan.wav"), take([["PTRK", "aaaaaa"]]));
    await settled(() => "L_orphan" in project.audioCurrentSnapshot());
    expect(speech.takesForDeletedLines().map((p) => p.split(/[\\/]/).pop())).toEqual(["L_orphan.wav"]);
    expect(await speech.removeTakesForDeletedLines()).toBe(1);
  });
});
