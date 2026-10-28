// The 2026-10-28 rulings (Q9): editing the spoken (source) text of a line whose take is recorded or final flags
// it for re-record, in the same write as the edit, so undoing the edit (which saves the old text back) takes
// the flag off with it. A whitespace-only or formatting-only change doesn't flag, nor does a direction edit
// (it lives in the flow), nor a line with no take or only a scratch one, nor a project that doesn't track audio.

import { describe, it, expect } from "vitest";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSource, canonicalStringify } from "@patterkit/core";
import { walkNodes } from "@patterkit/model";
import type { FlowFile, Group, LocaleFile, ProjectFile, Snippet } from "@patterkit/model";
import * as project from "../src/main/project.js";

const TAVERN = fileURLToPath(new URL("../../../test-fixtures/tavern-example.patter", import.meta.url));
const SCENE = "scn_tavern";

/** A private copy of the tavern, voiced and tracking audio status (`tracked`), open and hydrated, with
 *  L_greet recorded, L_work final, L_intim scratch, and L_secret without a take. */
async function openTracked(tracked = true): Promise<string> {
  const dir = join(mkdtempSync(join(tmpdir(), "pp-rerecord-")), "tavern.patter");
  cpSync(TAVERN, dir, { recursive: true });
  const projFile = join(dir, "tavern.patterproj");
  const proj = parseSource(readFileSync(projFile, "utf8")) as ProjectFile;
  proj.voiced = true;
  proj.trackAudioStatus = tracked;
  writeFileSync(projFile, canonicalStringify(proj));
  project.openProject(dir);
  project.hydrate();
  expect((await project.saveSceneRecording(SCENE, { L_greet: "recorded", L_work: "final", L_intim: "scratch" })).ok).toBe(true);
  return dir;
}

/** The open scene's sources with some of its English strings replaced. */
function withStrings(change: Record<string, string>): { flow: string; loc: string } {
  const src = project.readScene(SCENE);
  const loc = parseSource(src.locSource) as LocaleFile;
  loc.strings = { ...loc.strings, ...change };
  return { flow: src.flowSource, loc: canonicalStringify(loc) };
}
const save = (s: { flow: string; loc: string }) => project.saveScene(SCENE, s.flow, s.loc, "Tester");
const original = (id: string): string => (parseSource(project.readScene(SCENE).locSource) as LocaleFile).strings[id]!;

describe("editing a recorded line's spoken text flags it for re-record", () => {
  it("flags a recorded or final line in the same write as the edit, and tells the editor", async () => {
    await openTracked();
    const steps = project.projectHistoryState().undo;
    const res = await save(withStrings({ L_greet: "What'll it be, friend?", L_work: "Rats. Two gold." }));
    expect(res).toMatchObject({ ok: true, rerecord: { L_greet: true, L_work: true } });
    expect(project.readSceneRerecord(SCENE)).toEqual({ L_greet: true, L_work: true });
    // Part of the scene save, not a step of its own: the scene's undo is what takes it back.
    expect(project.projectHistoryState().undo).toEqual(steps);
  });

  it("undoing the edit (saving the old text back) takes the flag off again", async () => {
    await openTracked();
    const was = original("L_greet");
    await save(withStrings({ L_greet: "What'll it be?" }));
    await save(withStrings({ L_greet: "What'll it be, then?" })); // typing on: still flagged, still the one take
    expect(project.readSceneRerecord(SCENE)).toEqual({ L_greet: true });
    const res = await save(withStrings({ L_greet: was }));
    expect(res).toMatchObject({ ok: true, rerecord: {} });
    expect(project.readSceneRerecord(SCENE)).toEqual({});
    // Redo: the edit again, the flag again.
    await save(withStrings({ L_greet: "What'll it be?" }));
    expect(project.readSceneRerecord(SCENE)).toEqual({ L_greet: true });
  });

  it("doesn't flag a whitespace-only or formatting-only change", async () => {
    await openTracked();
    const res = await save(withStrings({ L_greet: `  ${original("L_greet").replace(" ", "   ")} `, L_work: `<i>${original("L_work")}</i>` }));
    expect(res.ok).toBe(true);
    expect(res).not.toHaveProperty("rerecord");
    expect(project.readSceneRerecord(SCENE)).toEqual({});
  });

  it("doesn't flag a direction edit", async () => {
    const dir = await openTracked();
    const src = project.readScene(SCENE);
    const flow = parseSource(src.flowSource) as FlowFile;
    walkNodes<Group | Snippet>(flow.scene.blocks[0]!.children, (n) => {
      if (n.type === "snippet") for (const b of n.beats ?? []) if (b.id === "L_greet" && b.kind === "line") b.direction = "wearily";
    });
    expect((await project.saveScene(SCENE, canonicalStringify(flow), src.locSource, "Tester")).ok).toBe(true);
    expect(readFileSync(join(dir, "scenes", "tavern.patterflow"), "utf8")).toContain("wearily");
    expect(project.readSceneRerecord(SCENE)).toEqual({});
  });

  it("doesn't flag a line with no take, or only a scratch one", async () => {
    await openTracked();
    await save(withStrings({ L_intim: "Fine. Five gold.", L_secret: "So you know." }));
    expect(project.readSceneRerecord(SCENE)).toEqual({});
  });

  it("doesn't flag anything in a project that doesn't track audio status", async () => {
    await openTracked(false);
    await save(withStrings({ L_greet: "Something else entirely." }));
    expect(project.readSceneRerecord(SCENE)).toEqual({});
  });

  it("leaves a flag ticked by hand alone, through an edit and its undo", async () => {
    await openTracked();
    const was = original("L_greet");
    expect((await project.saveSceneRerecord(SCENE, { L_greet: true })).ok).toBe(true);
    await save(withStrings({ L_greet: "Changed." }));
    await save(withStrings({ L_greet: was }));
    expect(project.readSceneRerecord(SCENE)).toEqual({ L_greet: true }); // ticked by hand: the author's to take off
  });
});
