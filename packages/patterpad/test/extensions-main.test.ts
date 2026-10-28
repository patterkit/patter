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
import { openScene, saveScene as surfaceSave } from "../../patterpad-surface/src/load.js";

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
    const before = project.readScene(sceneId); // the mirror holds the bytes before the merge
    const flowFile = join(dir, "scenes/tavern.patterflow");
    const locFile = join(dir, "loc/en/tavern.patterloc");
    markFile(flowFile);
    markFile(locFile); // a merge outside the app marks both

    // A save built from the bytes before the merge would overwrite it: refused, and the scene read again
    // (the hands-on review, 2026-10).
    expect((await project.saveScene(sceneId, before.flowSource, `${before.locSource}\n`)).reread).toBe(true);
    // The editor holds the merged scene, without the mark its model has no place for.
    const src = project.readScene(sceneId);
    const flow = parseSource(src.flowSource) as { scene: { name: string }; unresolved?: unknown };
    delete flow.unresolved;
    flow.scene.name = "The Tavern, renamed";
    const loc = parseSource(src.locSource) as { strings: Obj; unresolved?: unknown };
    delete loc.unresolved;
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

// ---------------------------------------------------------------------------
// The scene's extension data through the editor (patterkit design/patterpad-undo.md, half A): readScene
// hands over the shards (before the project has been read whole, too), saveScene writes the ones the
// editor changed in the same all-or-nothing batch as the flow, deletes one left empty, keeps the
// unresolved mark, and keeps the loaded project current, so validation, the Play window, and a cast
// rename see it; vcStatus badges each shard on its own key, and a project step that rewrites a scene's
// shard counts as touching that scene.
// ---------------------------------------------------------------------------

/** A provider that records what's prepared, can refuse a path, and reports a path locked by bob. */
class ScriptedVcs implements IVCProvider {
  readonly name = "perforce";
  prepared: string[] = [];
  refuse: string | null = null;
  locked: string | null = null;
  prepareToWrite(p: string): VCResult {
    this.prepared.push(p);
    return this.refuse && p.endsWith(this.refuse) ? { success: false, status: "locked", message: `${p} is locked by bob@bob-ws` } : ok;
  }
  finishedWrite(): VCResult { return ok; }
  deleteFile(p: string): VCResult { rmSync(p, { force: true }); return ok; }
  deleteFolder(): VCResult { return ok; }
  renameFile(): VCResult { return ok; }
  renameFolder(): VCResult { return ok; }
  prepareToWriteAsync(p: string): Promise<VCResult> { return Promise.resolve(this.prepareToWrite(p)); }
  finishedWriteAsync(): Promise<VCResult> { return Promise.resolve(ok); }
  deleteFileAsync(p: string): Promise<VCResult> { return Promise.resolve(this.deleteFile(p)); }
  deleteFolderAsync(): Promise<VCResult> { return Promise.resolve(ok); }
  renameFileAsync(): Promise<VCResult> { return Promise.resolve(ok); }
  renameFolderAsync(): Promise<VCResult> { return Promise.resolve(ok); }
  status(paths: string[]): VCFileStatus[] {
    return paths.map((filePath) => {
      const held = this.locked !== null && filePath.endsWith(this.locked);
      return { filePath, system: "perforce", writable: !held, tracked: true, ...(held ? { lockedBy: ["bob@bob-ws"] } : {}) };
    });
  }
  statusAsync(paths: string[]): Promise<VCFileStatus[]> { return Promise.resolve(this.status(paths)); }
}

/** A copy of the probe project, opened (landing only unless `hydrate`), under a scripted provider. */
function openProbeCopy(opts: { hydrate?: boolean; edit?: (dir: string) => void } = {}): { dir: string; vcs: ScriptedVcs; shard: string } {
  const dir = join(mkdtempSync(join(tmpdir(), "pp-ext-scene-")), "probe.patter");
  cpSync(probeFixture, dir, { recursive: true });
  opts.edit?.(dir);
  project.openProject(dir);
  if (opts.hydrate !== false) project.hydrate();
  const vcs = new ScriptedVcs();
  setProvider(vcs); // after the open, which pins the project's own system
  return { dir, vcs, shard: join(dir, PROBE_SHARD) };
}

/** The probe shard's text with one line entry's field changed. */
function withNote(text: string, note: string): string {
  const s = parseSource(text) as { entries: { line: Record<string, Obj> } };
  s.entries.line["L_bell"] = { ...s.entries.line["L_bell"], note };
  return canonicalStringify(s);
}

describe("a scene's extension data in Patterpad", () => {
  afterEach(() => clearProvider());

  it("hands the editor the scene's shards, before the project is read whole and after", () => {
    const { dir } = openProbeCopy({ hydrate: false });
    const disk = readFileSync(join(dir, PROBE_SHARD), "utf8");
    expect(project.readScene("scn_harbour").extensions).toEqual([{ id: "probe", name: "Probe", source: disk, live: true }]);
    project.hydrate();
    expect(project.readScene("scn_harbour").extensions).toEqual([{ id: "probe", name: "Probe", source: disk, live: true }]);
  });

  it("holds data for an extension the project doesn't take, and offers a shard to one it takes with none", () => {
    openProbeCopy({
      edit: (dir) => {
        mkdirSync(join(dir, "extensions/other"), { recursive: true });
        writeFileSync(join(dir, "extensions/other/harbour.patterextension"), canonicalStringify({ schema: "patter/extension@0", extension: "other", scene: "scn_harbour", entries: {} }));
        rmSync(join(dir, PROBE_SHARD));
      },
    });
    const exts = project.readScene("scn_harbour").extensions;
    expect(exts.map((e) => [e.id, e.live, e.source === ""])).toEqual([["other", false, false], ["probe", true, true]]);
  });

  it("writes only the changed shard, with the flow, in one batch; the same bytes again write nothing", async () => {
    const { dir, vcs, shard } = openProbeCopy();
    const src = project.readScene("scn_harbour");
    const next = withNote(src.extensions[0]!.source, "Ring it once.");
    expect((await project.saveScene("scn_harbour", src.flowSource, src.locSource, undefined, { probe: next })).ok).toBe(true);
    expect(readFileSync(shard, "utf8")).toBe(next);
    expect([...new Set(vcs.prepared)]).toEqual([shard]); // the flow and loc didn't change: only the shard was asked about
    vcs.prepared = [];
    expect((await project.saveScene("scn_harbour", src.flowSource, src.locSource, undefined, { probe: next })).ok).toBe(true);
    expect(vcs.prepared).toEqual([]); // the mirror answers: nothing to write
    // A save with no extension shards leaves them alone.
    expect((await project.saveScene("scn_harbour", src.flowSource, src.locSource)).ok).toBe(true);
    expect(readFileSync(join(dir, PROBE_SHARD), "utf8")).toBe(next);
  });

  it("an untouched scene, opened in the editor and saved, changes no file", async () => {
    const { dir, vcs } = openProbeCopy();
    const files = ["scenes/harbour.patterflow", "loc/en/harbour.patterloc", PROBE_SHARD].map((f) => join(dir, f));
    const before = files.map((f) => readFileSync(f, "utf8"));
    const src = project.readScene("scn_harbour");
    const saved = surfaceSave(openScene(src.flowSource, src.locSource, true, src.extensions), { prune: true });
    expect(saved.extensions).toEqual({});
    expect((await project.saveScene("scn_harbour", saved.flow, saved.loc, undefined, saved.extensions)).ok).toBe(true);
    expect(vcs.prepared).toEqual([]);
    expect(files.map((f) => readFileSync(f, "utf8"))).toEqual(before);
    expect(existsSync(join(dir, "authoring/harbour.patterx"))).toBe(false);
  });

  it("writes nothing at all when somebody holds the shard", async () => {
    const { dir, vcs, shard } = openProbeCopy();
    const src = project.readScene("scn_harbour");
    const flowFile = join(dir, "scenes/harbour.patterflow");
    const flowBefore = readFileSync(flowFile, "utf8");
    const shardBefore = readFileSync(shard, "utf8");
    vcs.refuse = ".patterextension";
    const flow = parseSource(src.flowSource) as { scene: { name: string } };
    flow.scene.name = "The Harbour, at night";
    const res = await project.saveScene("scn_harbour", canonicalStringify(flow), src.locSource, undefined, { probe: withNote(shardBefore, "x") });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/locked by bob/);
    expect(readFileSync(flowFile, "utf8")).toBe(flowBefore);
    expect(readFileSync(shard, "utf8")).toBe(shardBefore);
  });

  it("deletes a shard left with no data, and creates one for a scene that had none", async () => {
    const { shard } = openProbeCopy();
    const src = project.readScene("scn_harbour");
    expect((await project.saveScene("scn_harbour", src.flowSource, src.locSource, undefined, { probe: null })).ok).toBe(true);
    expect(existsSync(shard)).toBe(false);
    expect(project.validate().problems.filter((p) => p.category === "extensions")).toEqual([]); // the loaded copy lost it too

    const fresh = canonicalStringify({ schema: "patter/extension@0", extension: "probe", scene: "scn_harbour", entries: { line: { L_reply: { weight: 99 } } } });
    expect((await project.saveScene("scn_harbour", src.flowSource, src.locSource, undefined, { probe: fresh })).ok).toBe(true);
    expect(readFileSync(shard, "utf8")).toBe(fresh);
    // Validation reads the new shard from the loaded project: 99 is over the field's maximum.
    const errors = project.validate().problems.filter((p) => p.category === "extensions" && p.severity === "error");
    expect(errors.map((p) => p.nodeId)).toEqual(["L_reply"]);
    expect(errors[0]!.sceneId).toBe("scn_harbour");
  });

  it("keeps an unresolved mark a merge wrote since the scene was read", async () => {
    const { shard } = openProbeCopy();
    const before = project.readScene("scn_harbour");
    markFile(shard);
    // Built from the shard before the merge: refused, and the scene read again (the hands-on review, 2026-10).
    expect((await project.saveScene("scn_harbour", before.flowSource, before.locSource, undefined, { probe: withNote(before.extensions[0]!.source, "y") })).reread).toBe(true);
    // Built from the merged shard, without the mark (the editor's model has no place for it): kept.
    const src = project.readScene("scn_harbour");
    const merged = parseSource(src.extensions[0]!.source) as Obj;
    delete merged["unresolved"];
    expect((await project.saveScene("scn_harbour", src.flowSource, src.locSource, undefined, { probe: withNote(canonicalStringify(merged), "y") })).ok).toBe(true);
    const after = read(shard) as { unresolved?: unknown; entries: { line: Record<string, Obj> } };
    expect(after.unresolved).toEqual(MARK);
    expect(after.entries.line["L_bell"]!["note"]).toBe("y");
  });

  it("validates and plays the editor's unsaved extension data", () => {
    const { shard } = openProbeCopy();
    const src = project.readScene("scn_harbour");
    const bad = withNote(readFileSync(shard, "utf8"), 42 as unknown as string); // a number where text belongs
    const live = { sceneId: "scn_harbour", flow: src.flowSource, loc: src.locSource, extensions: { probe: bad } };
    expect(project.validate(live).problems.some((p) => p.category === "extensions" && p.severity === "error" && p.nodeId === "L_bell")).toBe(true);
    expect(project.validate().problems.some((p) => p.category === "extensions" && p.severity === "error")).toBe(false); // disk is fine

    // The Play window compiles with the edited data swapped in (Patterpad's play steps don't show it).
    project.setPlaySource({ ...live, extensions: { probe: withNote(readFileSync(shard, "utf8"), "Played as edited.") } });
    project.startPlay("scn_harbour");
    const played = project.playToStop();
    project.setPlaySource(null);
    expect(played.stop).toBe("choice");
  });

  it("badges each extension shard on its own key: a held shard locks its data, not the scene", async () => {
    const { vcs } = openProbeCopy();
    vcs.locked = "harbour.patterextension";
    const dto = (await project.vcStatus())!;
    const st = dto.scenes.find((s) => s.sceneId === "scn_harbour")!;
    expect(st.writable).toBe(true);
    expect(st.lockedBy).toBeUndefined();
    expect(st.extensions?.["probe"]?.lockedBy).toEqual(["bob@bob-ws"]);
    expect(dto.projectExtensions?.["probe"]?.writable).toBe(true);
  });

  it("counts a project step that rewrites only a scene's extension data as touching that scene", async () => {
    const { dir } = openProbeCopy({
      edit: (d) => {
        const proj = read(join(d, "probe.patterproj")) as { cast: Array<{ name: string }> };
        proj.cast.push({ name: "CARA" });
        writeFileSync(join(d, "probe.patterproj"), canonicalStringify(proj));
        const s = read(join(d, PROBE_SHARD)) as { entries: { line: Record<string, Obj> } };
        s.entries.line["L_bell"] = { ...s.entries.line["L_bell"], perf: { CARA: { look: "away" } } };
        writeFileSync(join(d, PROBE_SHARD), canonicalStringify(s));
      },
    });
    const flowBefore = readFileSync(join(dir, "scenes/harbour.patterflow"), "utf8");
    const s = project.readSettings()!;
    const res = await project.saveSettings({ ...s, cast: s.cast.map((c) => (c.name === "CARA" ? { ...c, name: "CORA" } : c)), castRenames: { CARA: "CORA" } });
    expect(res.ok).toBe(true);
    expect(readFileSync(join(dir, "scenes/harbour.patterflow"), "utf8")).toBe(flowBefore); // CARA speaks no line
    expect(Object.keys((read(join(dir, PROBE_SHARD)) as { entries: { line: { L_bell: { perf: Obj } } } }).entries.line.L_bell.perf)).toEqual(["CORA"]);
    expect(res.step?.scenes).toContain("scn_harbour");
    // ...and the scene reads back with the renamed data.
    expect(project.readScene("scn_harbour").extensions[0]!.source).toContain("CORA");
  });
});

// ---------------------------------------------------------------------------
// The editor's view of the project's extensions (stage B): the summary carries each one the project takes,
// its claims resolved through the project's settings and the project's own values, read from disk so the
// landing summary has them; Project Settings writes the project's values in the same step as the settings,
// so one undo puts both back; and a problem names the extension it is about.
// ---------------------------------------------------------------------------

const PROJECT_SHARD = "extensions/probe/_project.patterextension";

describe("the project's extensions in Patterpad", () => {
  afterEach(() => clearProvider());

  it("are in the summary before the project is read whole", () => {
    const { dir } = openProbeCopy({ hydrate: false });
    const opened = project.openProject(dir); // landing only
    const probe = opened.extensions?.[0];
    expect(probe?.id).toBe("probe");
    expect(probe?.name).toBe("Probe");
    expect(probe?.taken).toBe("1.1.0");
    expect(probe?.targets["line"]?.fields.map((f) => f.name)).toContain("perf");
    expect(probe?.targets["project"]?.fields.map((f) => f.name)).toEqual(["studio"]);
    expect(probe?.projectNode).toBe("proj_probe");
    expect(probe?.projectValues).toEqual({ studio: "Wildwinter" });
    // The references' choices outside the open scene: every node the project has read, named.
    expect(opened.extensionNodes?.["line"]?.find((n) => n.id === "L_bell")).toMatchObject({ scene: "scn_harbour" });
    expect(opened.extensionNodes?.["option"]?.some((n) => n.id === "o_stay")).toBe(true);
  });

  it("ignore an older pin's settings, which a save of the project file keeps as they are", async () => {
    // Settings are gone from the extensions spec: the summary has none, validation warns, and Project Settings'
    // save writes the project file over the pin as it was read, so they stay until somebody deletes them.
    const { dir } = openProbeCopy({
      edit: (d) => {
        const proj = read(join(d, "probe.patterproj")) as { extensions: { probe: Obj } };
        proj.extensions.probe["settings"] = { deliveryField: "mood" };
        writeFileSync(join(d, "probe.patterproj"), canonicalStringify(proj));
      },
    });
    const opened = project.hydrate()!;
    expect(opened.extensions?.[0]).not.toHaveProperty("settings");
    expect(opened.extensions?.[0]?.targets["line"]).not.toHaveProperty("claims");
    expect(project.validate().problems.filter((p) => p.message.includes("still has settings")).map((p) => p.extension)).toEqual(["probe"]);
    const res = await project.saveSettings({ ...project.readSettings()!, name: "Probe Two" });
    expect(res.ok).toBe(true);
    expect((read(join(dir, "probe.patterproj"))["extensions"] as Obj)["probe"]).toEqual({ settings: { deliveryField: "mood" }, version: "1.1.0" });
  });

  it("are absent for a project that takes none", () => {
    openTavern();
    expect(project.hydrate()?.extensions).toBeUndefined();
    expect(project.hydrate()?.extensionNodes).toBeUndefined();
  });

  it("Project Settings writes the project's values with the settings, as one undo step", async () => {
    const { dir } = openProbeCopy();
    const projFile = join(dir, "probe.patterproj"), shardFile = join(dir, PROJECT_SHARD);
    const projBefore = readFileSync(projFile, "utf8"), shardBefore = readFileSync(shardFile, "utf8");
    const s = project.readSettings()!;
    const res = await project.saveSettings({ ...s, name: "Probe Two", extensionValues: { probe: { studio: "Northwind" } } });
    expect(res.ok).toBe(true);
    expect(res.project?.name).toBe("Probe Two");
    expect(res.project?.extensions?.[0]?.projectValues).toEqual({ studio: "Northwind" });
    expect((read(shardFile) as { entries: { project: Obj } }).entries.project).toEqual({ proj_probe: { studio: "Northwind" } });
    expect((read(shardFile) as { scene: string }).scene).toBe("@project");
    // Validation sees the new value without a reload: an unknown field would say so.
    const again = await project.saveSettings({ ...project.readSettings()!, extensionValues: { probe: { studio: "Northwind", nope: 1 } } });
    expect(again.ok).toBe(true);
    expect(project.validate().problems.some((p) => p.category === "extensions" && p.message.includes("nope") && p.extension === "probe")).toBe(true);

    // Two saves, two steps; undoing both puts back the project file and the shard byte for byte.
    expect((await project.stepProjectHistory("undo")).ok).toBe(true);
    const one = await project.stepProjectHistory("undo");
    expect(one.ok).toBe(true);
    expect(readFileSync(projFile, "utf8")).toBe(projBefore);
    expect(readFileSync(shardFile, "utf8")).toBe(shardBefore);
    expect(one.project?.extensions?.[0]?.projectValues).toEqual({ studio: "Wildwinter" });
  });

  it("writes nothing for values that are as they were, deletes a shard left empty, and an undo brings it back", async () => {
    const { dir } = openProbeCopy();
    const shardFile = join(dir, PROJECT_SHARD);
    const shardBefore = readFileSync(shardFile, "utf8");
    const s = project.readSettings()!;
    const same = await project.saveSettings({ ...s, extensionValues: { probe: { studio: "Wildwinter" } } });
    expect(same.ok).toBe(true);
    expect(readFileSync(shardFile, "utf8")).toBe(shardBefore); // the same value: the shard isn't written
    const cleared = await project.saveSettings({ ...s, extensionValues: { probe: {} } });
    expect(cleared.ok).toBe(true);
    expect(existsSync(shardFile)).toBe(false);
    expect(cleared.project?.extensions?.[0]?.projectValues).toBeUndefined();
    expect((await project.stepProjectHistory("undo")).ok).toBe(true);
    expect(readFileSync(shardFile, "utf8")).toBe(shardBefore);
  });

  it("creates the project's shard when it has none, and ignores an extension the project doesn't take", async () => {
    const { dir } = openProbeCopy({ edit: (d) => rmSync(join(d, PROJECT_SHARD)) });
    const s = project.readSettings()!;
    expect((await project.saveSettings({ ...s, extensionValues: { probe: { studio: "Fresh" }, other: { x: 1 } } })).ok).toBe(true);
    expect(read(join(dir, PROJECT_SHARD))).toMatchObject({ schema: "patter/extension@0", extension: "probe", scene: "@project", entries: { project: { proj_probe: { studio: "Fresh" } } } });
    expect(existsSync(join(dir, "extensions/other"))).toBe(false);
  });

  it("names the extension a problem is about, by its folder, its manifest, or the project file's words", () => {
    openProbeCopy({
      edit: (d) => {
        const proj = read(join(d, "probe.patterproj")) as { extensions: { probe: { version: string } } };
        proj.extensions.probe.version = "1.0.0";
        writeFileSync(join(d, "probe.patterproj"), canonicalStringify(proj));
      },
    });
    const ext = project.validate().problems.filter((p) => p.category === "extensions");
    expect(ext.length).toBeGreaterThanOrEqual(2);
    expect(ext.every((p) => p.extension === "probe")).toBe(true);
    expect(ext.some((p) => p.file?.endsWith(".patterproj"))).toBe(true); // the pin, named by its words
  });
});
