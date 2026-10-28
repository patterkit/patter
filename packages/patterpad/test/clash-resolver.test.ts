// ---------------------------------------------------------------------------
// The clash resolver's adapter, main-process side (ruling Q21): the `unresolved` entries a merge left in a
// project's shards, listed in a writer's words; each decision one step of the project history, through
// `projectCommit`, with the sidecar going in the step that clears the shard's last entry; an undo putting the
// mark and the sidecar back; and the scene's own saves never bringing a cleared entry back.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalStringify, parseSource } from "@patterkit/core";
import { runMerge } from "@patterkit/ops";
import * as project from "../src/main/project.js";

type Obj = Record<string, unknown>;
const read = (path: string): Obj => parseSource(readFileSync(path, "utf8")) as Obj;
const clone = <T>(v: T): T => structuredClone(v);

/** A new project, with a real merge's clashes written into its loc, flow, and project shards, as a returned
 *  Patterpack or `patter merge` leaves them: the merged shard (ours, marked) and its sidecar. */
async function clashedProject(): Promise<{ dir: string; sceneId: string; lineId: string; files: { loc: string; flow: string; proj: string } }> {
  const dir = join(mkdtempSync(join(tmpdir(), "pp-clash-")), "story.patter");
  const opened = await project.createProject(dir, "Story");
  const sceneId = opened.scenes[0]!.id;
  const files = { loc: join(dir, "loc", "en", "start.patterloc"), flow: join(dir, "scenes", "start.patterflow"), proj: join(dir, "story.patterproj") };
  const write = (path: string, base: Obj, ours: Obj, theirs: Obj): void => {
    const r = runMerge(base, ours, theirs);
    writeFileSync(path, canonicalStringify(r.merged));
    writeFileSync(`${path}.patterconflict`, JSON.stringify({ type: r.type, conflicts: r.conflicts, warnings: r.warnings }, null, 2) + "\n");
  };

  const loc = read(files.loc);
  const lineId = Object.keys(loc["strings"] as Obj)[0]!;
  const withLine = (text: string): Obj => ({ ...clone(loc), strings: { [lineId]: text } });
  write(files.loc, loc, withLine("Our welcome."), withLine("Their welcome."));

  const flow = read(files.flow);
  const named = (name: string): Obj => { const f = clone(flow); ((f["scene"] as Obj)["blocks"] as Obj[])[0]!["name"] = name; return f; };
  write(files.flow, flow, named("Ours"), named("Theirs"));

  const proj = read(files.proj);
  write(files.proj, proj, { ...clone(proj), voiced: false }, { ...clone(proj), voiced: "maybe" });

  project.openProject(dir);
  return { dir, sceneId, lineId, files };
}

describe("the clash resolver's adapter", () => {
  it("lists every clash, in a writer's words, with the sides as text", async () => {
    const { lineId } = await clashedProject();
    const clashes = project.listClashes();
    expect(clashes.map((c) => c.where).sort()).toEqual([
      "Block Ours's name in Start",
      `Text ${lineId} in Start`,
      "Whether the project is voiced",
    ].sort());
    const line = clashes.find((c) => c.path === `strings.${lineId}`)!;
    expect(line).toMatchObject({ ours: "Our welcome.", theirs: "Their welcome.", kind: "both-changed", settable: true, id: `loc/en/start.patterloc#strings.${lineId}` });
    expect(line.base).toMatch(/^Welcome to Story/);
  });

  it("Take theirs writes their side as one step; the sidecar goes with the last entry, and an undo puts both back", async () => {
    const { files, lineId } = await clashedProject();
    const before = readFileSync(files.loc, "utf8");
    const r = await project.decideClash(`loc/en/start.patterloc#strings.${lineId}`, "theirs");
    expect(r.ok).toBe(true);
    expect(r.step?.label).toBe("Resolve clash");
    expect(r.clashes).toHaveLength(2);
    expect((read(files.loc)["strings"] as Obj)[lineId]).toBe("Their welcome.");
    expect(read(files.loc)["unresolved"]).toBeUndefined();
    expect(existsSync(`${files.loc}.patterconflict`)).toBe(false);
    expect(project.projectHistoryState().undo?.label).toBe("Resolve clash");

    expect((await project.stepProjectHistory("undo")).ok).toBe(true);
    expect(readFileSync(files.loc, "utf8")).toBe(before);
    expect(existsSync(`${files.loc}.patterconflict`)).toBe(true);
    expect(project.listClashes()).toHaveLength(3);
    expect((await project.stepProjectHistory("redo")).ok).toBe(true);
    expect(project.listClashes()).toHaveLength(2);
  });

  it("Keep mine clears the entry and leaves our value; Mark resolved keeps what's there now", async () => {
    const { files } = await clashedProject();
    expect((await project.decideClash("story.patterproj#voiced", "ours")).ok).toBe(true);
    expect(read(files.proj)["voiced"]).toBe(false);
    expect(read(files.proj)["unresolved"]).toBeUndefined();
    const flowId = "scenes/start.patterflow#" + project.listClashes().find((c) => c.id.startsWith("scenes/"))!.path;
    expect((await project.decideClash(flowId, "resolved")).clashes).toHaveLength(1);
    expect((((read(files.flow)["scene"] as Obj)["blocks"] as Obj[])[0]!)["name"]).toBe("Ours");
  });

  it("a scene's own save after a resolve doesn't bring the cleared entry back", async () => {
    const { files, sceneId, lineId } = await clashedProject();
    expect((await project.decideClash(`loc/en/start.patterloc#strings.${lineId}`, "ours")).ok).toBe(true);
    // The editor reloads the scene (as after Replace), and an edit autosaves it.
    const src = project.readScene(sceneId);
    expect(src.locSource).not.toContain("unresolved");
    const loc = parseSource(src.locSource) as Obj;
    (loc["strings"] as Obj)[lineId] = "Edited afterwards.";
    expect((await project.saveScene(sceneId, src.flowSource, canonicalStringify(loc))).ok).toBe(true);
    expect(read(files.loc)["unresolved"]).toBeUndefined();
    // The flow shard still holds its clash, and the save kept it.
    expect(read(files.flow)["unresolved"]).toBeDefined();
  });

  it("refuses a clash that has gone, and Edit knows where each one is", async () => {
    const { sceneId, lineId } = await clashedProject();
    expect((await project.decideClash("story.patterproj#nothing", "ours")).ok).toBe(false);
    expect((await project.decideClash("../elsewhere.patterproj#voiced", "ours")).ok).toBe(false);
    expect(project.clashTarget(`loc/en/start.patterloc#strings.${lineId}`)).toEqual({ kind: "scene", sceneId, nodeId: lineId });
    expect(project.clashTarget("story.patterproj#voiced")).toEqual({ kind: "settings", tab: "general" });
  });
});
