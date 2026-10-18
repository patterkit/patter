// ---------------------------------------------------------------------------
// Patter extensions in Patterpad's main process, the first part: a merge's `unresolved` mark on a scene's
// flow or loc shard survives the editor's own writes (a save, a stage rename), which rebuild those shards
// from a model with no place for it; and deleting a scene deletes its extension data too, through the
// same lock-aware path as its other shards.
// ---------------------------------------------------------------------------

import { describe, it, expect, afterEach } from "vitest";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalStringify, parseSource } from "@patterkit/core";
import { setProvider, clearProvider } from "@wildwinter/simple-vc-lib";
import type { IVCProvider, VCResult, VCFileStatus } from "@wildwinter/simple-vc-lib";
import * as project from "../src/main/project.js";
import { keepUnresolvedMark } from "../src/main/unresolved-mark.js";

const fixture = fileURLToPath(new URL("../../../test-fixtures/tavern-example.patter", import.meta.url));
const MARK = [{ path: "strings.L_greet", kind: "both-changed", ours: "a", theirs: "b" }];
type Obj = Record<string, unknown>;

function openTavern(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "pp-ext-")), "tavern.patter");
  cpSync(fixture, dir, { recursive: true });
  project.openProject(dir);
  project.hydrate();
  return dir;
}

const read = (file: string): Obj => parseSource(readFileSync(file, "utf8")) as Obj;
const markFile = (file: string): void => writeFileSync(file, canonicalStringify({ ...read(file), unresolved: MARK }));

describe("keepUnresolvedMark", () => {
  const shard = (extra: Obj = {}) => canonicalStringify({ schema: "patter/strings@0", scene: "s", strings: { A: "a" }, ...extra });

  it("carries the mark on disk onto new text that has none", () => {
    const next = shard({ strings: { A: "edited" } });
    expect(parseSource(keepUnresolvedMark(shard({ unresolved: MARK }), next))).toEqual({ ...(parseSource(next) as Obj), unresolved: MARK });
  });

  it("leaves the text alone when there's nothing to carry, or it can't tell", () => {
    const next = shard({ strings: { A: "unresolved" } });
    expect(keepUnresolvedMark(null, next)).toBe(next);
    expect(keepUnresolvedMark(shard({ strings: { A: "unresolved" } }), next)).toBe(next);
    expect(keepUnresolvedMark("{ broken unresolved", next)).toBe(next);
    const own = shard({ unresolved: [] });
    expect(keepUnresolvedMark(shard({ unresolved: MARK }), own)).toBe(own);
  });
});

describe("a marked scene in Patterpad", () => {
  it("keeps the mark on both shards through a save", async () => {
    const dir = openTavern();
    const sceneId = "scn_tavern";
    const src = project.readScene(sceneId); // the mirror holds the bytes before the merge
    const flowFile = join(dir, "scenes/tavern.patterflow");
    const locFile = join(dir, "loc/en/tavern.patterloc");
    markFile(flowFile);
    markFile(locFile); // a merge outside the app marks both

    const flow = parseSource(src.flowSource) as { scene: { name: string } };
    flow.scene.name = "The Tavern, renamed";
    const loc = parseSource(src.locSource) as { strings: Obj };
    loc.strings["L_greet"] = "Evening.";
    expect((await project.saveScene(sceneId, canonicalStringify(flow), canonicalStringify(loc))).ok).toBe(true);

    const flowAfter = read(flowFile) as { scene: { name: string }; unresolved: unknown };
    expect(flowAfter.scene.name).toBe("The Tavern, renamed");
    expect(flowAfter.unresolved).toEqual(MARK);
    const locAfter = read(locFile) as { strings: Obj; unresolved: unknown };
    expect(locAfter.strings["L_greet"]).toBe("Evening.");
    expect(locAfter.unresolved).toEqual(MARK);

    // Saving the same content again writes nothing new and still keeps it.
    expect((await project.saveScene(sceneId, canonicalStringify(flow), canonicalStringify(loc))).ok).toBe(true);
    expect(read(flowFile)["unresolved"]).toEqual(MARK);
  });

  it("keeps the mark through a stage rename that rewrites the scene", async () => {
    const dir = openTavern();
    const flowFile = join(dir, "scenes/tavern.patterflow");
    markFile(flowFile);
    const res = await project.renameStages([{ scope: "", name: "cue", gameData: "gameEvent", from: "camera_focus", to: "camera_wide" }]);
    expect(res.ok).toBe(true);
    const after = readFileSync(flowFile, "utf8");
    expect(after).toContain("camera_wide");
    expect(read(flowFile)["unresolved"]).toEqual(MARK);
  });
});

const ok: VCResult = { success: true, status: "ok", message: "" };

/** A provider that records what it's asked to delete, and deletes it. */
class RecordingVcs implements IVCProvider {
  readonly name = "perforce";
  deleted: string[] = [];
  prepared: string[] = [];
  prepareToWrite(p: string): VCResult { this.prepared.push(p); return ok; }
  finishedWrite(): VCResult { return ok; }
  deleteFile(p: string): VCResult { this.deleted.push(p); rmSync(p, { force: true }); return ok; }
  deleteFolder(): VCResult { return ok; }
  renameFile(): VCResult { return ok; }
  renameFolder(): VCResult { return ok; }
  prepareToWriteAsync(p: string): Promise<VCResult> { return Promise.resolve(this.prepareToWrite(p)); }
  finishedWriteAsync(): Promise<VCResult> { return Promise.resolve(ok); }
  deleteFileAsync(p: string): Promise<VCResult> { return Promise.resolve(this.deleteFile(p)); }
  deleteFolderAsync(): Promise<VCResult> { return Promise.resolve(ok); }
  renameFileAsync(): Promise<VCResult> { return Promise.resolve(ok); }
  renameFolderAsync(): Promise<VCResult> { return Promise.resolve(ok); }
  status(paths: string[]): VCFileStatus[] { return paths.map((filePath) => ({ filePath, system: "perforce", writable: true, tracked: true })); }
  statusAsync(paths: string[]): Promise<VCFileStatus[]> { return Promise.resolve(this.status(paths)); }
}

describe("deleting a scene", () => {
  afterEach(() => clearProvider());

  it("deletes its data for every extension, lock-aware, and leaves other scenes' and the project's", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "pp-ext-del-")), "tavern.patter");
    cpSync(fixture, dir, { recursive: true });
    const shard = (ext: string, stem: string, scene: string): string => {
      mkdirSync(join(dir, "extensions", ext), { recursive: true });
      const file = join(dir, "extensions", ext, `${stem}.patterextension`);
      writeFileSync(file, canonicalStringify({ schema: "patter/extension@0", extension: ext, scene, entries: {} }));
      return file;
    };
    const probeStreet = shard("probe", "street", "scn_street");
    const otherStreet = shard("other", "street", "scn_street");
    const probeTavern = shard("probe", "tavern", "scn_tavern");
    const probeProject = shard("probe", "_project", "@project");
    project.openProject(dir);
    project.hydrate();
    const vcs = new RecordingVcs();
    setProvider(vcs);

    const res = await project.deleteScene("scn_street");
    expect(res.ok).toBe(true);
    expect(existsSync(probeStreet)).toBe(false);
    expect(existsSync(otherStreet)).toBe(false);
    expect(existsSync(probeTavern)).toBe(true);
    expect(existsSync(probeProject)).toBe(true);
    expect(vcs.prepared).toEqual(expect.arrayContaining([otherStreet, probeStreet]));
    expect(vcs.deleted).toEqual(expect.arrayContaining([otherStreet, probeStreet]));
    // The flow shard is still the last to go.
    expect(vcs.deleted.at(-1)).toBe(join(dir, "scenes/street.patterflow"));
  });

  it("leaves a shard of the same name that says it belongs to another scene", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "pp-ext-del-")), "tavern.patter");
    cpSync(fixture, dir, { recursive: true });
    mkdirSync(join(dir, "extensions", "probe"), { recursive: true });
    const file = join(dir, "extensions", "probe", "street.patterextension");
    writeFileSync(file, canonicalStringify({ schema: "patter/extension@0", extension: "probe", scene: "scn_tavern", entries: {} }));
    project.openProject(dir);
    project.hydrate();
    expect((await project.deleteScene("scn_street")).ok).toBe(true);
    expect(existsSync(file)).toBe(true);
  });
});

const probeFixture = fileURLToPath(new URL("../../ops/test/fixtures/probe-extension.patter", import.meta.url));
const PROBE_SHARD = "extensions/probe/harbour.patterextension";

/** A copy of ops' probe project (it takes the internal "probe" extension), with French project strings, open. */
function openProbe(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "pp-ext-cast-")), "probe.patter");
  cpSync(probeFixture, dir, { recursive: true });
  mkdirSync(join(dir, "loc/fr"), { recursive: true });
  const project_ = read(join(dir, "probe.patterproj")) as { locales: { all: string[] } };
  project_.locales.all = ["en", "fr"];
  writeFileSync(join(dir, "probe.patterproj"), canonicalStringify(project_));
  writeFileSync(join(dir, "loc/fr/_project.patterloc"), canonicalStringify({
    schema: "patter/strings@0", scene: "@project", locale: "fr", strings: { "cast:ANNA": "Anne", "cast:BEN": "Benoît" },
  }));
  project.openProject(dir);
  project.hydrate();
  return dir;
}

describe("a cast rename in Project Settings", () => {
  const extensionProblems = () => project.validate().problems.filter((p) => p.category === "extensions");

  it("rewrites the lines the member speaks, their translated name, and the extension data keyed by them", async () => {
    const dir = openProbe();
    expect(extensionProblems().map((p) => p.severity)).toEqual(["warning"]); // the fixture's renamed stage
    const s = project.readSettings()!;
    const res = await project.saveSettings({
      ...s, cast: s.cast.map((c) => (c.name === "ANNA" ? { ...c, name: "ANNE" } : c)), castRenames: { ANNA: "ANNE" },
    });
    expect(res.ok).toBe(true);

    const flow = readFileSync(join(dir, "scenes/harbour.patterflow"), "utf8");
    expect(flow).not.toContain('"ANNA"');
    expect((flow.match(/"ANNE"/g) ?? []).length).toBe(2); // a line and an option's prompt
    const shard = read(join(dir, PROBE_SHARD)) as { entries: { line: { L_bell: { perf: Obj } } } };
    expect(Object.keys(shard.entries.line.L_bell.perf)).toEqual(["ANNE"]);
    expect((read(join(dir, "loc/fr/_project.patterloc")) as { strings: Obj }).strings).toEqual({ "cast:ANNE": "Anne", "cast:BEN": "Benoît" });

    // The model reads back whole: the problems are the fixture's own, and the Play window's compile carries it.
    const problems = project.validate().problems;
    expect(problems.filter((p) => p.severity === "error")).toEqual([]);
    expect(extensionProblems().map((p) => p.severity)).toEqual(["warning"]);
    project.startPlay("scn_harbour");
    const batch = project.playToStop();
    expect(JSON.stringify(batch)).toContain('"ANNE"');
  });

  it("without the rename, the lines and the data still name the old member, and the problems say so", async () => {
    openProbe();
    const s = project.readSettings()!;
    expect((await project.saveSettings({ ...s, cast: s.cast.map((c) => (c.name === "ANNA" ? { ...c, name: "ANNE" } : c)) })).ok).toBe(true);
    const errors = extensionProblems().filter((p) => p.severity === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain("ANNA");
    expect(errors[0]!.file?.endsWith(PROBE_SHARD)).toBe(true);
    expect(errors[0]!.nodeId).toBe("L_bell");
    expect(errors[0]!.sceneId).toBe("scn_harbour");
  });

  it("carries the caption character through the rename", async () => {
    const dir = openProbe();
    const s = project.readSettings()!;
    expect((await project.saveSettings({ ...s, closedCaptions: { ...s.closedCaptions, character: "ANNA" } })).ok).toBe(true);
    const t = project.readSettings()!;
    expect((await project.saveSettings({
      ...t, cast: t.cast.map((c) => (c.name === "ANNA" ? { ...c, name: "ANNE" } : c)), castRenames: { ANNA: "ANNE" },
    })).ok).toBe(true);
    expect((read(join(dir, "probe.patterproj")) as { closedCaptions?: { character?: string } }).closedCaptions?.character).toBe("ANNE");
  });

  it("ignores a rename of a member the project never had", async () => {
    const dir = openProbe();
    const before = readFileSync(join(dir, "scenes/harbour.patterflow"), "utf8");
    const s = project.readSettings()!;
    expect((await project.saveSettings({ ...s, castRenames: { ZED: "ANNA" } })).ok).toBe(true);
    expect(readFileSync(join(dir, "scenes/harbour.patterflow"), "utf8")).toBe(before);
  });
});
