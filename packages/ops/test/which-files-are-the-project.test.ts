// ---------------------------------------------------------------------------
// "Which files on disk are the project?" - asked from both ends
// (from-storylets/load-issues-and-the-strict-loader).
//
// The loader is deliberately strict about every file it READS: a bad parse, a wrong shape, two files
// claiming one scene id all throw, naming the file. But strictness can only speak about a file it
// looked at, and it collects by layout directory. So the two ends were both unguarded:
//
//   - a valid shard OUTSIDE the layout was silently not in the project, and nothing said so;
//   - a shard inside a DOT-directory (an editor backup, a `.trash`, a vendored checkout) was
//     collected and became real content.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit, applyWrites, loadProject, runValidate } from "../src/index.js";
import { parseSource } from "@patterkit/core";

function project(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "patter-files-")), "game");
  applyWrites(runInit({ dir, name: "Which Files" }).writes);
  return dir;
}

/** A valid flow shard for a scene nobody else claims. */
const flow = (id: string, name: string): string => JSON.stringify({
  schema: "patter/flow@0",
  scene: { id, name, blocks: [{ id: `${id}_b`, name: "Block", children: [] }] },
});

describe("a shard outside the layout is reported, not silently ignored", () => {
  it("names a scene dropped in the project root", () => {
    const dir = project();
    writeFileSync(join(dir, "stray.patterflow"), flow("scn_stray", "Stray"));
    const r = runValidate(loadProject(dir));
    expect(r.orphans).toHaveLength(1);
    expect(r.orphans[0]!.file).toMatch(/stray\.patterflow$/);
    // The message is the whole story on its own: which file, relative to the project, and where this
    // project would read it from. A bar that said "this file" named nothing a reader could act on.
    expect(r.orphans[0]!.message).toBe(
      "stray.patterflow is a scene file outside the project's folders: nothing loads it, so none of it is in the project. Move it under scenes/, or delete it.");
    expect(r.ok).toBe(false); // it must fail a check, or it is not reported at all
  });

  it("names the folder THIS project reads from, not the default", () => {
    const dir = project();
    const pf = join(dir, "which_files.patterproj");
    const proj = parseSource(readFileSync(pf, "utf8")) as Record<string, unknown>;
    writeFileSync(pf, JSON.stringify({ ...proj, layout: { flow: "story/" } }, null, 2));
    mkdirSync(join(dir, "story"), { recursive: true });
    writeFileSync(join(dir, "story", "home.patterflow"), flow("scn_home", "Home"));
    writeFileSync(join(dir, "scenes", "stray.patterflow"), flow("scn_stray", "Stray")); // the old folder
    const r = runValidate(loadProject(dir));
    // Both files under the old folder are named, the seeded start scene included.
    expect(r.orphans.map((o) => o.message)).toEqual([
      "scenes/start.patterflow is a scene file outside the project's folders: nothing loads it, so none of it is in the project. Move it under story/, or delete it.",
      "scenes/stray.patterflow is a scene file outside the project's folders: nothing loads it, so none of it is in the project. Move it under story/, or delete it.",
    ]);
  });

  it("names the real project file when a second one is lying about", () => {
    const dir = project();
    mkdirSync(join(dir, "old"));
    writeFileSync(join(dir, "old", "backup.patterproj"), readFileSync(join(dir, "which_files.patterproj"), "utf8"));
    const r = runValidate(loadProject(dir));
    expect(r.orphans.map((o) => o.message)).toEqual([
      "old/backup.patterproj is a second project file: only which_files.patterproj is read. Delete it, or move it out of the project.",
    ]);
  });

  it("says nothing about a clean project", () => {
    expect(runValidate(loadProject(project())).orphans).toEqual([]);
  });

  it("counts a shard in the WRONG layout folder as outside it", () => {
    // The nastiest version: it looks filed, just filed as the wrong kind.
    const dir = project();
    mkdirSync(join(dir, "loc", "en"), { recursive: true });
    writeFileSync(join(dir, "loc", "en", "misfiled.patterflow"), flow("scn_misfiled", "Misfiled"));
    const r = runValidate(loadProject(dir));
    expect(r.orphans.map((o) => o.file.split("/").pop())).toEqual(["misfiled.patterflow"]);
  });
});

describe("a dot-directory is not the project", () => {
  it("does not load a scene out of an editor backup", () => {
    const dir = project();
    const before = loadProject(dir).scenes.length;
    mkdirSync(join(dir, ".backup", "scenes"), { recursive: true });
    writeFileSync(join(dir, ".backup", "scenes", "old.patterflow"), flow("scn_old", "Old"));
    // Not loaded...
    expect(loadProject(dir).scenes.length).toBe(before);
    // ...and not reported as an orphan either: a dot-directory is not a mistake, it is not the project.
    expect(runValidate(loadProject(dir)).orphans).toEqual([]);
  });

  it("still loads a project that itself lives under a dot-directory", () => {
    // Only what is INSIDE the root is filtered; the root is whatever the author pointed us at.
    const parent = join(mkdtempSync(join(tmpdir(), "patter-hidden-")), ".config");
    mkdirSync(parent, { recursive: true });
    const dir = join(parent, "game");
    applyWrites(runInit({ dir, name: "Hidden Home" }).writes);
    expect(loadProject(dir).scenes.length).toBeGreaterThan(0);
  });
});
