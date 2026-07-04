// The one-shot Audio Folders scan (#206): the CLI's route to the same folder-derived recording
// status Patterpad's live indexer shows - highest rung wins, missing folders read as empty, and
// a project that doesn't derive from folders returns undefined (callers fall back to the manual map).
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProject, scanAudioStatus } from "../src/index.js";

function makeProject(projectExtra: object): string {
  const dir = mkdtempSync(join(tmpdir(), "patter-audioscan-"));
  for (const d of ["scenes", "loc/en"]) mkdirSync(join(dir, d), { recursive: true });
  const w = (p: string, o: unknown) => writeFileSync(join(dir, p), JSON.stringify(o));
  w("game.patterproj", { schema: "patter/project@0", project: { id: "a", name: "A" },
    locales: { default: "en", all: ["en"] }, ...projectExtra });
  w("scenes/one.patterflow", { schema: "patter/flow@0", scene: { id: "s1", type: "scene", name: "S", blocks: [
    { id: "b1", type: "block", name: "M", children: [{ id: "n1", type: "snippet", beats: [{ id: "L1", kind: "line", character: "A" }, { id: "L2", kind: "line", character: "A" }], jump: { to: "END" } }] },
  ] } });
  w("loc/en/one.patterloc", { schema: "patter/strings@0", scene: "s1", locale: "en", strings: { L1: "Hi.", L2: "Bye." } });
  return dir;
}

const AUDIO_ON = { voiced: true, trackAudioStatus: true, audioFolders: true, audioRoot: "audio" };

describe("scanAudioStatus", () => {
  it("derives each beat's status from the highest rung holding a take (default ladder)", () => {
    const dir = makeProject(AUDIO_ON);
    mkdirSync(join(dir, "audio", "scratch"), { recursive: true });
    mkdirSync(join(dir, "audio", "recorded"), { recursive: true });
    writeFileSync(join(dir, "audio", "scratch", "L1.wav"), "x");
    writeFileSync(join(dir, "audio", "scratch", "L2.mp3"), "x");
    writeFileSync(join(dir, "audio", "recorded", "L1.wav"), "x"); // L1 also recorded -> higher rung wins
    writeFileSync(join(dir, "audio", "scratch", "notes.txt"), "x"); // not audio -> ignored

    const m = scanAudioStatus(loadProject(dir))!;
    expect(m.get("L1")).toBe("recorded");
    expect(m.get("L2")).toBe("scratch");
    expect(m.has("notes")).toBe(false);
  });

  it("returns undefined when the project doesn't derive from folders", () => {
    expect(scanAudioStatus(loadProject(makeProject({})))).toBeUndefined();                       // not voiced
    expect(scanAudioStatus(loadProject(makeProject({ ...AUDIO_ON, audioFolders: false })))).toBeUndefined();
    expect(scanAudioStatus(loadProject(makeProject({ ...AUDIO_ON, audioRoot: undefined })))).toBeUndefined();
  });

  it("treats missing rung folders as empty (a fresh Audio Folders project scans clean)", () => {
    const m = scanAudioStatus(loadProject(makeProject(AUDIO_ON)))!;
    expect(m.size).toBe(0);
  });
});
