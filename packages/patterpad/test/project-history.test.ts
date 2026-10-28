// The project history (patterkit design/patterpad-undo.md, half B): every write Patterpad makes outside the
// open scene's own save is one step on the shell's file-byte history. Each write in the note's table undoes
// to the exact bytes it found and redoes to the exact bytes it left; a deleted scene comes back whole; a file
// changed since its step refuses the undo and drops the steps below; a lock refuses it and keeps the step;
// a `.patterx` edit trail is stamped afresh, never put back; a keyed run is one step; comments are no step.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { parseSource, canonicalStringify } from "@patterkit/core";
import { walkNodes } from "@patterkit/model";
import type { AuthoringFile, FlowFile, Group, Snippet } from "@patterkit/model";
import { setProvider, clearProvider } from "@wildwinter/simple-vc-lib";
import type { IVCProvider, VCResult, VCFileStatus } from "@wildwinter/simple-vc-lib";
import * as project from "../src/main/project.js";
import type { ProjectStep } from "../src/shared/api.js";

const TAVERN = fileURLToPath(new URL("../../../test-fixtures/tavern-example.patter", import.meta.url));
const PROBE = fileURLToPath(new URL("../../ops/test/fixtures/probe-extension.patter", import.meta.url));

/** Every file under a folder, by its path inside it. */
function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p); else out.set(relative(dir, p), readFileSync(p, "utf8"));
    }
  };
  walk(dir);
  return out;
}

/** A `.patterx` without its edit trail, which an undo stamps rather than restores. */
const withoutTrail = (text: string): string => {
  const af = parseSource(text) as AuthoringFile;
  delete af.edits;
  return canonicalStringify(af);
};
const comparable = (snap: Map<string, string>, trail: boolean): Record<string, string> =>
  Object.fromEntries([...snap].map(([k, v]) => [k, !trail && k.endsWith(".patterx") ? withoutTrail(v) : v]).sort());

/** A private copy of a fixture, open and hydrated. */
function openCopy(fixture = TAVERN, name = "tavern.patter"): string {
  const dir = join(mkdtempSync(join(tmpdir(), "pp-history-")), name);
  cpSync(fixture, dir, { recursive: true });
  project.openProject(dir);
  project.hydrate();
  return dir;
}

const undo = (id?: number) => project.stepProjectHistory("undo", id);
const redo = (id?: number) => project.stepProjectHistory("redo", id);

/** Make a change, then undo it back to the bytes it found and redo it to the bytes it left: the whole
 *  folder, every file, exactly (a `.patterx` trail aside when `trail` is false: it is stamped, not restored). */
async function roundTrip(dir: string, change: () => Promise<{ ok: boolean; error?: string } | unknown>, label: string, trail = true): Promise<void> {
  const before = snapshot(dir);
  const below = project.projectHistoryState().undo;
  const res = await change();
  if (res && typeof res === "object" && "ok" in res) expect(res as object).toMatchObject({ ok: true });
  const after = snapshot(dir);
  expect(comparable(after, true)).not.toEqual(comparable(before, true));
  expect(project.projectHistoryState().undo?.label).toBe(label);

  const undone = await undo();
  expect(undone).toMatchObject({ ok: true, label });
  expect(comparable(snapshot(dir), trail)).toEqual(comparable(before, trail));
  expect(project.projectHistoryState().undo).toEqual(below);

  const redone = await redo();
  expect(redone).toMatchObject({ ok: true, label });
  expect(comparable(snapshot(dir), trail)).toEqual(comparable(after, trail));
  expect(project.projectHistoryState().redo).toBeUndefined();
}

/** BARKEEP's greeting qualified O.S., as the qualifier tests have it, before the project opens. */
function qualifyGreeting(dir: string): void {
  const flowPath = join(dir, "scenes", "tavern.patterflow");
  const flow = parseSource(readFileSync(flowPath, "utf8")) as FlowFile;
  walkNodes<Group | Snippet>(flow.scene.blocks[0]!.children, (n) => {
    if (n.type === "snippet") for (const b of n.beats ?? []) if (b.id === "L_greet" && b.kind === "line") b.qualifier = "os";
  });
  writeFileSync(flowPath, canonicalStringify(flow));
}

const ok: VCResult = { success: true, status: "ok", message: "" };
/** A provider that reports one kind of file as held by someone else. */
class LockingVcs implements IVCProvider {
  readonly name = "perforce";
  lockedSuffix: string | null = null;
  prepareToWrite(): VCResult { return ok; }
  finishedWrite(): VCResult { return ok; }
  deleteFile(): VCResult { return ok; }
  deleteFolder(): VCResult { return ok; }
  renameFile(): VCResult { return ok; }
  renameFolder(): VCResult { return ok; }
  prepareToWriteAsync(): Promise<VCResult> { return Promise.resolve(ok); }
  finishedWriteAsync(): Promise<VCResult> { return Promise.resolve(ok); }
  deleteFileAsync(): Promise<VCResult> { return Promise.resolve(ok); }
  deleteFolderAsync(): Promise<VCResult> { return Promise.resolve(ok); }
  renameFileAsync(): Promise<VCResult> { return Promise.resolve(ok); }
  renameFolderAsync(): Promise<VCResult> { return Promise.resolve(ok); }
  status(paths: string[]): VCFileStatus[] {
    return paths.map((filePath) => {
      const held = this.lockedSuffix !== null && filePath.endsWith(this.lockedSuffix);
      return { filePath, system: "perforce", writable: !held, tracked: true, ...(held ? { lockedBy: ["bob@bob-ws"] } : {}) };
    });
  }
  statusAsync(paths: string[]): Promise<VCFileStatus[]> { return Promise.resolve(this.status(paths)); }
}

afterEach(() => clearProvider());

describe("every write in the project history undoes and redoes to the exact bytes", () => {
  it("Project Settings, with a qualifier, a stage, and a cast rename in the same save: one step", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "pp-history-")), "tavern.patter");
    cpSync(TAVERN, dir, { recursive: true });
    qualifyGreeting(dir);
    project.openProject(dir);
    project.hydrate();
    const s = project.readSettings()!;
    await roundTrip(dir, () => project.saveSettings({
      ...s,
      name: "The Rusty Tankard",
      qualifiers: s.qualifiers.map((q) => (q.gameId === "os" ? { ...q, gameId: "offscreen" } : q)), qualifierRenames: { os: "offscreen" },
      stageRenames: [{ scope: "", name: "cue", gameData: "gameEvent", from: "camera_focus", to: "camera_wide" }],
      cast: s.cast.map((c) => (c.name === "BARKEEP" ? { ...c, name: "INNKEEPER" } : c)), castRenames: { BARKEEP: "INNKEEPER" },
    }), "Project settings");
    expect(readFileSync(join(dir, "scenes", "tavern.patterflow"), "utf8")).toContain("INNKEEPER");
    expect(readFileSync(join(dir, "scenes", "tavern.patterflow"), "utf8")).toContain("camera_wide");
    // And the model read back what the redo wrote.
    expect(project.readSettings()!.name).toBe("The Rusty Tankard");
  });

  it("the quick fixes: add to cast, declare a property", async () => {
    const dir = openCopy();
    await roundTrip(dir, () => project.applyFix({ kind: "add-to-cast", character: "GUARD" }), "Add to cast");
    await roundTrip(dir, () => project.applyFix({ kind: "declare-property", name: "mood", propType: "string" }), "Declare property");
  });

  it("set start, reorder scenes, and the dictionary", async () => {
    const dir = openCopy();
    await roundTrip(dir, () => project.setStart({ scene: "scn_street" }), "Set start");
    const ids = project.hydrate()!.sceneIds;
    await roundTrip(dir, () => project.reorderScenes([...ids].reverse()), "Reorder scenes");
    expect(project.hydrate()!.sceneIds).toEqual([...ids].reverse());
    await roundTrip(dir, () => project.addDictionaryWord("Tankard"), "Add to dictionary");
    await roundTrip(dir, () => project.addIgnoreWord("grog"), "Ignore word");
    await roundTrip(dir, () => project.setDictionary({ enabled: false }), "Spelling");
  });

  it("a new scene: its undo deletes the files it made, and the speaker it added to the cast", async () => {
    const dir = openCopy();
    await roundTrip(dir, () => project.createScene("The Cellar", "conversation", "COOK"), "New scene");
    expect(project.hydrate()!.scenes.map((s) => s.name)).toContain("The Cellar");
    await undo();
    expect(project.hydrate()!.scenes.map((s) => s.name)).not.toContain("The Cellar");
    expect(project.readSettings()!.cast.map((c) => c.name)).not.toContain("COOK");
  });

  it("Replace, whose edit trail is stamped afresh rather than put back", async () => {
    const dir = openCopy();
    const authoring = join(dir, "authoring", "tavern.patterx");
    const res = await project.applyReplace({ query: "stranger", replacement: "friend", now: "2026-10-01T00:00:00.000Z" });
    expect(res).toMatchObject({ ok: true });
    expect(res.count).toBeGreaterThan(0);
    expect((parseSource(readFileSync(authoring, "utf8")) as AuthoringFile).edits!["L_greet"]!.modifiedAt).toBe("2026-10-01T00:00:00.000Z");
    const original = readFileSync(join(TAVERN, "loc", "en", "tavern.patterloc"), "utf8");
    expect((await undo()).ok).toBe(true);
    expect(readFileSync(join(dir, "loc", "en", "tavern.patterloc"), "utf8")).toBe(original);
    // The trail is not restored to before the Replace (which had no entry for the line): the undo is an
    // edit of the line too, so the line is stamped now.
    const stamped = (parseSource(readFileSync(authoring, "utf8")) as AuthoringFile).edits!["L_greet"]!.modifiedAt!;
    expect(stamped > "2026-10-01T00:00:00.000Z").toBe(true);
    // Every other block of the shard is as it was.
    expect(withoutTrail(readFileSync(authoring, "utf8"))).toBe(withoutTrail(readFileSync(join(TAVERN, "authoring", "tavern.patterx"), "utf8")));
    expect((await redo()).ok).toBe(true);
    expect(readFileSync(join(dir, "loc", "en", "tavern.patterloc"), "utf8")).toContain("friend");
  });

  it("Replace over a text gameData value: the flow shard is the step, and the working copy follows", async () => {
    // The fixture declares no fields: declare the street scene's `music` as text, then open.
    const dir = join(mkdtempSync(join(tmpdir(), "pp-history-")), "tavern.patter");
    cpSync(TAVERN, dir, { recursive: true });
    const projPath = join(dir, "tavern.patterproj");
    const proj = parseSource(readFileSync(projPath, "utf8")) as Record<string, unknown>;
    writeFileSync(projPath, canonicalStringify({ ...proj, gameDataFields: { scene: [{ name: "music", type: "text" }] } }));
    project.openProject(dir);
    project.hydrate();
    const flowPath = join(dir, "scenes", "street.patterflow");
    const original = readFileSync(flowPath, "utf8");
    expect(project.replacePreview({ query: "street_theme", replacement: "lane_theme" }).hits).toMatchObject([{ id: "scn_street", field: "field:music" }]);
    const res = await project.applyReplace({ query: "street_theme", replacement: "lane_theme" });
    expect(res).toMatchObject({ ok: true, count: 1, scenes: 1 });
    expect((parseSource(readFileSync(flowPath, "utf8")) as FlowFile).scene.gameData).toEqual({ music: "lane_theme" });
    // The working copy holds the new value, so the next preview starts from it.
    expect(project.replacePreview({ query: "street_theme", replacement: "x" }).hits).toHaveLength(0);
    expect(project.replacePreview({ query: "lane_theme", replacement: "x" }).hits).toHaveLength(1);
    expect(await undo()).toMatchObject({ ok: true, label: "Replace" });
    expect(readFileSync(flowPath, "utf8")).toBe(original);
  });

  it("writing status, recording status, re-record, and notes: each a step of its own (ruling 3)", async () => {
    const dir = openCopy();
    await roundTrip(dir, () => project.saveSceneWriting("scn_tavern", { L_greet: "draft" }), "Writing status");
    await roundTrip(dir, () => project.saveSceneRecording("scn_tavern", { L_greet: "recorded" }), "Recording status");
    await roundTrip(dir, () => project.saveSceneRerecord("scn_tavern", { L_greet: true }), "Re-record");
    await roundTrip(dir, () => project.saveSceneDocs("scn_tavern", { L_greet: [{ text: "Gruff." }] }), "Notes");
    // Four steps, one each, and they undo in turn.
    for (const label of ["Notes", "Re-record", "Recording status", "Writing status"]) expect((await undo()).label).toBe(label);
    expect(project.readSceneWriting("scn_tavern")).toEqual({});
  });

  it("a translation import", async () => {
    const dir = openCopy();
    const s = project.readSettings()!;
    expect((await project.saveSettings({ ...s, locales: ["en", "fr"] })).ok).toBe(true);
    const exported = await project.locExport("json", "fr");
    const catalog = JSON.parse(String(exported!.content)) as { entries: Array<{ id: string; translation?: string; target?: string }> } & Record<string, unknown>;
    const text = JSON.stringify(catalog).replace(/"(translation|target)":""/, '"$1":"Bonjour"');
    expect(text).toContain("Bonjour");
    const file = join(dir, "..", "fr.json");
    writeFileSync(file, text);
    await roundTrip(dir, () => project.locImport(file), "Import translations");
  });

  it("sharing the project's scopes: its undo takes the folder's files away", async () => {
    const gameDir = mkdtempSync(join(tmpdir(), "pp-history-share-"));
    mkdirSync(join(gameDir, ".git"));
    const dir = join(gameDir, "story.patter");
    await project.createProject(dir, "Story");
    const s = project.readSettings()!;
    expect((await project.saveSettings({ ...s, scopeRegistry: { version: 1, scopes: [{ token: "world", declarations: [{ name: "threat", type: "number" }] }] } })).ok).toBe(true);
    const scopes = join(gameDir, "game-scopes");
    expect((await project.shareScopes(scopes)).ok).toBe(true);
    expect(existsSync(join(scopes, "game.scopes.json"))).toBe(true);
    expect((await undo()).label).toBe("Share scopes");
    expect(existsSync(join(scopes, "game.scopes.json"))).toBe(false);
    expect(existsSync(join(scopes, "patter.scopes.json"))).toBe(false);
    expect((await redo()).ok).toBe(true);
    expect(existsSync(join(scopes, "game.scopes.json"))).toBe(true);
  });

  it("a pinned Build Bundle's flow writes, and never the bundle", async () => {
    const dir = openCopy();
    const flows = () => Object.fromEntries([...snapshot(dir)].filter(([k]) => k.endsWith(".patterflow")));
    const before = flows();
    const built = await project.buildBundle({ pin: true });
    expect(built.ok).toBe(true);
    expect(built.pinned).toBeGreaterThan(0); // the tavern has scenes and blocks still following their names
    const bundle = readFileSync(built.path!, "utf8");
    expect((await undo()).label).toBe("Pin scene addresses");
    expect(flows()).toEqual(before);
    expect(readFileSync(built.path!, "utf8")).toBe(bundle); // the bundle is output: no undo touches it
  });
});

describe("deleting a scene", () => {
  it("is undone with every file it took: flow, every language's strings, the .patterx, extension data, and the project file", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "pp-history-")), "tavern.patter");
    cpSync(TAVERN, dir, { recursive: true });
    // A second language, an extension's data for the scene, and the scene as the start point.
    const proj = parseSource(readFileSync(join(dir, "tavern.patterproj"), "utf8")) as Record<string, unknown>;
    writeFileSync(join(dir, "tavern.patterproj"), canonicalStringify({ ...proj, locales: { default: "en", all: ["en", "fr"] }, start: { scene: "scn_tavern" }, sceneOrder: ["scn_tavern", "scn_street"] }));
    mkdirSync(join(dir, "loc", "fr"), { recursive: true });
    writeFileSync(join(dir, "loc", "fr", "tavern.patterloc"), canonicalStringify({ schema: "patter/strings@0", scene: "scn_tavern", locale: "fr", strings: { L_greet: "Qu'est-ce que ce sera, étranger ?" } }));
    mkdirSync(join(dir, "extensions", "probe"), { recursive: true });
    writeFileSync(join(dir, "extensions", "probe", "tavern.patterextension"), canonicalStringify({ schema: "patter/extension@0", extension: "probe", scene: "scn_tavern", entries: {} }));
    project.openProject(dir);
    project.hydrate();
    const before = snapshot(dir);

    const res = await project.deleteScene("scn_tavern");
    expect(res.ok).toBe(true);
    for (const f of ["scenes/tavern.patterflow", "loc/en/tavern.patterloc", "loc/fr/tavern.patterloc", "authoring/tavern.patterx", "extensions/probe/tavern.patterextension"]) {
      expect(existsSync(join(dir, f))).toBe(false);
    }
    expect(project.hydrate()!.sceneIds).toEqual(["scn_street"]);

    const undone = await undo();
    expect(undone).toMatchObject({ ok: true, label: "Delete scene" });
    expect(undone.scenes).toContain("scn_tavern");
    expect(Object.fromEntries(snapshot(dir))).toEqual(Object.fromEntries(before));
    expect(project.hydrate()!.sceneIds).toEqual(["scn_tavern", "scn_street"]);
    expect(project.readScene("scn_tavern").locSource).toBe(before.get("loc/en/tavern.patterloc"));

    expect((await redo()).ok).toBe(true);
    expect(existsSync(join(dir, "scenes", "tavern.patterflow"))).toBe(false);
    expect(project.hydrate()!.sceneIds).toEqual(["scn_street"]);
  });
});

describe("a returned Patterpack's merge", () => {
  it("is one step: its undo puts the shard back and takes the conflict sidecar away", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-history-merge-"));
    const opened = await project.createProject(dir, "Clash");
    const sceneId = opened.scenes[0]!.id;
    const sent = join(dir, "sent.patterpack");
    writeFileSync(sent, await project.packBytes());
    const original = project.readScene(sceneId);
    const strings = (text: string) => parseSource(text) as { strings: Record<string, string> };
    const key = Object.keys(strings(original.locSource).strings)[0]!;
    const theirs = strings(original.locSource); theirs.strings[key] = "theirs";
    await project.saveScene(sceneId, original.flowSource, canonicalStringify(theirs));
    const returned = join(dir, "returned.patterpack");
    writeFileSync(returned, await project.packBytes());
    const ours = strings(original.locSource); ours.strings[key] = "ours";
    // A second line of theirs that merges cleanly, so the merge writes the shard as well as the sidecar.
    await project.saveScene(sceneId, original.flowSource, canonicalStringify(ours));
    const root = project.currentRoot()!;
    const before = snapshot(root);

    const plan = await project.planPackMerge(returned, sent);
    if ("error" in plan) throw new Error(plan.error);
    expect(plan.sidecars).toHaveLength(1);
    expect((await project.commitPackMerge(plan)).ok).toBe(true);
    expect(existsSync(plan.sidecars[0]!.path)).toBe(true);
    expect((await undo()).label).toBe("Merge Patterpack");
    expect(existsSync(plan.sidecars[0]!.path)).toBe(false);
    expect(Object.fromEntries(snapshot(root))).toEqual(Object.fromEntries(before));
    expect((await redo()).ok).toBe(true);
    expect(existsSync(plan.sidecars[0]!.path)).toBe(true);
  });
});

describe("an editable-script import, and deciding its suggestion", () => {
  /** Export, then hand back a copy with one line's words changed, as an editor would (editable-main.test.ts). */
  async function exportAndEdit(dir: string, beat: string, text: string): Promise<string> {
    const out = (await project.editableScript({ range: "project", recipient: "Sam", notes: "editor", status: false, cast: false }, "Ian"))!;
    expect((await project.commitHandoff(out.writes)).ok).toBe(true);
    const h = JSON.parse(readFileSync(out.writes[0]!.path, "utf8")) as { lines: Record<string, { id: string }> };
    const code = Object.entries(h.lines).find(([, l]) => l.id === beat)![0];
    const zip = await JSZip.loadAsync(out.docx);
    let xml = await zip.file("word/document.xml")!.async("string");
    const t0 = xml.lastIndexOf("<w:tbl>", xml.indexOf(`[#${code}]`));
    const c1 = xml.indexOf("<w:tc>", xml.indexOf("<w:tc>", t0) + 1);
    const end = xml.indexOf("</w:tc>", c1);
    const cell = xml.slice(c1, end);
    xml = xml.slice(0, c1) + cell.slice(0, cell.indexOf("</w:tcPr>") + 9) + `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>` + xml.slice(end);
    zip.file("word/document.xml", xml);
    const returned = join(dir, "..", "returned.docx");
    writeFileSync(returned, await zip.generateAsync({ type: "nodebuffer" }));
    return returned;
  }

  it("each undoes and redoes, the suggestion's conversation with it", async () => {
    const dir = openCopy();
    const returned = await exportAndEdit(dir, "L_greet", "What will it be, friend?");
    const summary = await project.planEditableImportFile(returned, { strictQuotes: false, direct: false }, "Ian");
    await roundTrip(dir, () => project.applyEditableImport(summary.planId!), "Import script");
    const id = project.listSuggestions({})[0]!.id;
    await roundTrip(dir, () => project.decideSuggestions([{ id, accept: true }], "Ian"), "Accept suggestion", false);
    expect(project.readScene("scn_tavern").locSource).toContain("What will it be, friend?");
    await undo();
    // The suggestion is open again: the decision changed the conversation, so its undo puts it back.
    expect(project.listSuggestions({}).map((s) => s.id)).toEqual([id]);
  });
});

describe("a scene property's stage rename, paired with the declaration edit it finishes", () => {
  it("one undo takes the scene back to before the declaration changed, conditions and all", async () => {
    const dir = openCopy();
    const flowPath = join(dir, "scenes", "tavern.patterflow");
    const beforeDeclaration = readFileSync(flowPath, "utf8");
    // The declaration edit, saved by the scene as the renderer's flush does.
    const src = project.readScene("scn_tavern");
    const declared = src.flowSource.replace('"name": "The Tavern"', '"name": "The Tavern (declared)"');
    expect(declared).not.toBe(src.flowSource);
    expect((await project.saveScene("scn_tavern", declared, src.locSource)).ok).toBe(true);
    const res = await project.renameStages(
      [{ scope: "", name: "cue", gameData: "gameEvent", from: "camera_focus", to: "camera_wide" }],
      { sceneId: "scn_tavern", flowBefore: beforeDeclaration },
    );
    expect(res).toMatchObject({ ok: true });
    expect(res.step?.label).toBe("Rename stage");
    expect(readFileSync(flowPath, "utf8")).toContain("camera_wide");
    expect(await undo()).toMatchObject({ ok: true, scenes: ["scn_tavern"] });
    expect(readFileSync(flowPath, "utf8")).toBe(beforeDeclaration);
    expect(await redo()).toMatchObject({ ok: true });
    const redone = readFileSync(flowPath, "utf8");
    expect(redone).toContain("camera_wide");
    expect(redone).toContain("The Tavern (declared)");
  });
});

describe("the history's rules", () => {
  it("a keyed run of Properties-page saves is one step; the next key starts another", async () => {
    const dir = openCopy();
    const projFile = join(dir, "tavern.patterproj");
    const original = readFileSync(projFile, "utf8");
    const steps: ProjectStep[] = [];
    project.onProjectStep((s) => steps.push(s));
    const props = (extra: string[]) => [...project.readSettings()!.properties, ...extra.map((name) => ({ name, type: "number" as const }))];
    const key = { label: "Properties", key: "properties:1" };
    const a = await project.saveSettings({ ...project.readSettings()!, properties: props(["a"]) }, key);
    const b = await project.saveSettings({ ...project.readSettings()!, properties: props(["b"]) }, key);
    expect(a.step).toMatchObject({ merged: false, label: "Properties" });
    expect(b.step).toMatchObject({ merged: true, id: a.step!.id });
    expect(steps.map((s) => s.merged)).toEqual([false, true]);
    expect((await undo(a.step!.id)).ok).toBe(true);
    expect(readFileSync(projFile, "utf8")).toBe(original); // both edits, one step
    expect((await redo()).ok).toBe(true);
    const c = await project.saveSettings({ ...project.readSettings()!, properties: props(["c"]) }, { label: "Properties", key: "properties:2" });
    expect(c.step?.merged).toBe(false);
    project.onProjectStep(() => {});
  });

  it("a write that changes nothing is no step", async () => {
    openCopy();
    expect((await project.setStart({ scene: "scn_street" })).step).toBeDefined();
    expect((await project.setStart({ scene: "scn_street" })).step).toBeUndefined();
    await undo();
    expect(project.projectHistoryState().undo).toBeUndefined();
  });

  it("comments, suggestions, and the scene's own save are no steps", async () => {
    openCopy();
    await project.saveSceneComments("scn_tavern", [{ id: "c1", anchor: "L_greet", messages: [{ author: "Sam", ts: "2026-10-01T00:00:00Z", body: "Gruffer?" }] }]);
    await project.saveSceneSuggestions("scn_tavern", [{ id: "s1", anchor: "L_greet", author: "Sam", ts: "2026-10-01T00:00:00Z", baseline: "x", proposed: "y" }]);
    const src = project.readScene("scn_tavern");
    await project.saveScene("scn_tavern", src.flowSource, src.locSource.replace("stranger", "traveller"));
    expect(project.projectHistoryState()).toEqual({});
  });

  it("a comment posted since a status step is no drift, and the undo keeps it", async () => {
    openCopy();
    await project.saveSceneWriting("scn_tavern", { L_greet: "draft" });
    const comments = [{ id: "c1", anchor: "L_greet", messages: [{ author: "Sam", ts: "2026-10-01T00:00:00Z", body: "Gruffer?" }] }];
    await project.saveSceneComments("scn_tavern", comments);
    // And a scene save, which moves the edit trail.
    const src = project.readScene("scn_tavern");
    await project.saveScene("scn_tavern", src.flowSource, src.locSource.replace("stranger", "traveller"), "Ian");
    expect((await undo()).ok).toBe(true);
    expect(project.readSceneWriting("scn_tavern")).toEqual({});
    expect(project.readSceneComments("scn_tavern")).toEqual(comments);
  });

  it("a file changed since its step refuses the undo, names it, keeps what is on disk, and drops the steps below", async () => {
    const dir = openCopy();
    await project.addDictionaryWord("Tankard");
    await project.setStart({ scene: "scn_street" });
    const projFile = join(dir, "tavern.patterproj");
    const pulled = readFileSync(projFile, "utf8").replace("The Tavern", "The Pulled Tavern");
    writeFileSync(projFile, pulled); // a pull lands between the step and its undo
    const refused = await undo();
    expect(refused).toMatchObject({ ok: false, drift: true, label: "Set start" });
    expect(refused.error).toContain("tavern.patterproj has changed since");
    expect(readFileSync(projFile, "utf8")).toBe(pulled);
    expect(project.projectHistoryState().undo).toBeUndefined(); // the dictionary word went with it
  });

  it("a redo whose file changed since it was undone is refused the same way", async () => {
    const dir = openCopy();
    await project.setStart({ scene: "scn_street" });
    await undo();
    const projFile = join(dir, "tavern.patterproj");
    writeFileSync(projFile, readFileSync(projFile, "utf8").replace("The Tavern", "Merged In"));
    expect(await redo()).toMatchObject({ ok: false, drift: true });
    expect(project.projectHistoryState().redo).toBeUndefined();
  });

  it("a file somebody else holds refuses the undo, saying who, and keeps the step to try again", async () => {
    const dir = openCopy();
    const vcs = new LockingVcs();
    setProvider(vcs); // after open, which pins the project's own system
    expect((await project.setStart({ scene: "scn_street" })).ok).toBe(true);
    const projFile = join(dir, "tavern.patterproj");
    const after = readFileSync(projFile, "utf8");
    vcs.lockedSuffix = ".patterproj";
    const refused = await undo();
    expect(refused.ok).toBe(false);
    expect(refused.drift).toBeUndefined();
    expect(refused.error).toContain("bob@bob-ws");
    expect(readFileSync(projFile, "utf8")).toBe(after);
    expect(project.projectHistoryState().undo?.label).toBe("Set start");
    vcs.lockedSuffix = null;
    expect((await undo()).ok).toBe(true);
    expect(readFileSync(projFile, "utf8")).toBe(readFileSync(join(TAVERN, "tavern.patterproj"), "utf8"));
  });

  it("answers for the step the journal names, and only that one", async () => {
    openCopy();
    const first = (await project.setStart({ scene: "scn_street" })).step!;
    const second = (await project.addDictionaryWord("Tankard")).step!;
    expect(second.id).toBeGreaterThan(first.id);
    expect(await undo(first.id)).toMatchObject({ ok: false, stale: true });
    expect((await undo(second.id)).ok).toBe(true);
    // A new edit in the scene clears the project's redo too.
    project.clearProjectRedo();
    expect(await redo(second.id)).toMatchObject({ ok: false, stale: true });
    expect(project.readSettings()!.dictionaryWords).toEqual([]);
  });

  it("announces each step with the scenes whose script or authoring it touched", async () => {
    openCopy();
    const steps: ProjectStep[] = [];
    project.onProjectStep((s) => steps.push(s));
    await project.applyReplace({ query: "stranger", replacement: "friend" });
    await project.saveSceneWriting("scn_street", { x: "draft" });
    project.onProjectStep(() => {});
    expect(steps[0]).toMatchObject({ label: "Replace", merged: false, scenes: ["scn_tavern"] });
    expect(steps[1]).toMatchObject({ label: "Writing status", scenes: [], authoring: ["scn_street"] });
  });

  it("keeps the newest hundred steps", async () => {
    openCopy();
    for (let i = 0; i < 101; i++) await project.addDictionaryWord(`word${i}`);
    let n = 0;
    while ((await undo()).ok) n++;
    expect(n).toBe(100);
    expect(project.readSettings()!.dictionaryWords).toEqual(["word0"]);
  });

  it("starts again with each project opened", async () => {
    openCopy();
    await project.setStart({ scene: "scn_street" });
    openCopy(PROBE, "probe.patter");
    expect(project.projectHistoryState()).toEqual({});
  });
});

/** LockingVcs that deletes for real, and refuses to delete what it reports held, as a real checkout would. */
class DeleteLockingVcs extends LockingVcs {
  override deleteFileAsync(path?: string): Promise<VCResult> {
    const held = this.lockedSuffix !== null && typeof path === "string" && path.endsWith(this.lockedSuffix);
    if (held) return Promise.resolve({ success: false, status: "locked", message: `${path} is locked by bob@bob-ws` });
    if (typeof path === "string") rmSync(path, { force: true });
    return Promise.resolve(ok);
  }
}

describe("review fixes", () => {
  it("a status step on a scene whose suggestion was accepted earlier is not refused by a comment posted since", async () => {
    openCopy();
    const text = parseSource(project.readScene("scn_tavern").locSource) as { strings: Record<string, string> };
    await project.saveSceneSuggestions("scn_tavern", [{ id: "s1", anchor: "L_greet", author: "Sam", ts: "2026-10-01T00:00:00Z", baseline: text.strings["L_greet"]!, proposed: "Evening." }]);
    expect((await project.decideSuggestions([{ id: "s1", accept: true }], "Ian")).ok).toBe(true);
    await project.saveSceneWriting("scn_tavern", { L_greet: "draft" });
    const comments = [{ id: "c1", anchor: "L_greet", messages: [{ author: "Sam", ts: "2026-10-02T00:00:00Z", body: "Better." }] }];
    await project.saveSceneComments("scn_tavern", comments);
    expect(await undo()).toMatchObject({ ok: true, label: "Writing status" });
    expect(project.readSceneComments("scn_tavern")).toEqual(comments);
    expect(project.projectHistoryState().undo?.label).toBe("Accept suggestion");
  });

  it("a redo a lock refuses part way writes nothing, so it can be tried again once the lock lifts", async () => {
    const dir = openCopy();
    const vcs = new DeleteLockingVcs();
    setProvider(vcs);
    expect((await project.deleteScene("scn_street")).ok).toBe(true);
    expect(await undo()).toMatchObject({ ok: true });
    const restored = snapshot(dir);
    vcs.lockedSuffix = "street.patterloc";
    const refused = await redo();
    expect(refused.ok).toBe(false);
    expect(refused.drift).toBeUndefined();
    expect(refused.error).toContain("bob@bob-ws");
    expect(Object.fromEntries(snapshot(dir))).toEqual(Object.fromEntries(restored)); // nothing landed
    vcs.lockedSuffix = null;
    expect(await redo()).toMatchObject({ ok: true, label: "Delete scene" });
    expect(existsSync(join(dir, "scenes", "street.patterflow"))).toBe(false);
  });

  it("a delete refused part way through the step itself writes nothing either", async () => {
    const dir = openCopy();
    const vcs = new DeleteLockingVcs();
    setProvider(vcs);
    const before = snapshot(dir);
    vcs.lockedSuffix = "street.patterflow";
    expect((await project.deleteScene("scn_street")).ok).toBe(false);
    expect(Object.fromEntries(snapshot(dir))).toEqual(Object.fromEntries(before));
    expect(project.projectHistoryState().undo).toBeUndefined();
  });

  it("a stale answer names the step main has on top, so the editor can catch up", async () => {
    openCopy();
    const first = (await project.setStart({ scene: "scn_street" })).step!;
    const second = (await project.addDictionaryWord("Tankard")).step!;
    expect(await undo(first.id)).toMatchObject({ ok: false, stale: true, top: { id: second.id, label: "Add to dictionary" } });
  });

  it("clearing the redo clears the history's own, so it can't claim a redo later", async () => {
    openCopy();
    await project.setStart({ scene: "scn_street" });
    await undo();
    expect(project.projectHistoryInternals().canRedo).toBe(true);
    project.clearProjectRedo();
    expect(project.projectHistoryInternals()).toMatchObject({ canRedo: false });
    expect(project.projectHistoryInternals().redoLabel).toBeUndefined();
  });

  it("a script shard saved since in another layout, saying the same, is no drift", async () => {
    const dir = openCopy();
    const locPath = join(dir, "loc", "en", "tavern.patterloc");
    const original = readFileSync(locPath, "utf8");
    await project.applyReplace({ query: "stranger", replacement: "friend" });
    // The scene's autosave writes the same strings, laid out its own way.
    writeFileSync(locPath, JSON.stringify(parseSource(readFileSync(locPath, "utf8")), null, 4));
    expect(await undo()).toMatchObject({ ok: true, label: "Replace" });
    expect(readFileSync(locPath, "utf8")).toBe(original);
  });
});

beforeEach(() => { project.clearProjectRedo(); });
