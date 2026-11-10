// A project opened over another that uses Audio Folders reads its own folders, not the first project's: both
// with an audio root of "../audio", the second used to be shown the first's takes (every line missing).

import { describe, it, expect, vi } from "vitest";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const userData = mkdtempSync(join(tmpdir(), "pp-audio-switch-user-"));
vi.mock("electron", () => ({ app: { getPath: () => userData, isPackaged: false }, dialog: {}, BrowserWindow: class {} }));

const { parseSource, canonicalStringify } = await import("@patterkit/core");
const project = await import("../src/main/project.js");
import type { ProjectFile } from "@patterkit/model";

const TAVERN = fileURLToPath(new URL("../../../test-fixtures/tavern-example.patter", import.meta.url));

/** A copy of the tavern in a folder of its own, with Audio Folders on and one scratch take, for `line`. */
function copy(line: string): string {
  const dir = join(mkdtempSync(join(tmpdir(), "pp-audio-switch-")), "tavern.patter");
  cpSync(TAVERN, dir, { recursive: true });
  const file = join(dir, "tavern.patterproj");
  const proj = parseSource(readFileSync(file, "utf8")) as ProjectFile;
  Object.assign(proj, { voiced: true, trackAudioStatus: true, audioFolders: true, audioRoot: "../audio", vcs: undefined });
  writeFileSync(file, canonicalStringify(proj));
  mkdirSync(join(dir, "..", "audio", "scratch"), { recursive: true });
  writeFileSync(join(dir, "..", "audio", "scratch", `${line}.wav`), new Uint8Array(44));
  return dir;
}

async function settled(check: () => boolean): Promise<void> {
  for (let i = 0; i < 80 && !check(); i++) await new Promise((r) => setTimeout(r, 50));
}

describe("the audio index across a change of project", () => {
  it("reads the new project's folders, and drops the old project's takes at once", async () => {
    project.openProject(copy("L_first"));
    await settled(() => "L_first" in project.audioCurrentSnapshot());
    expect(Object.keys(project.audioCurrentSnapshot())).toEqual(["L_first"]);

    project.openProject(copy("L_second"));
    expect(project.audioCurrentSnapshot()).toEqual({});   // nothing of the first project's, even before a scan
    await settled(() => "L_second" in project.audioCurrentSnapshot());
    expect(Object.keys(project.audioCurrentSnapshot())).toEqual(["L_second"]);
    project.closeProject();
  });
});
