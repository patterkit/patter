// ---------------------------------------------------------------------------
// Patter extensions end to end, on the internal test extension "probe"
// (fixtures/probe-extension.patter; never published, never in a kit or the
// public docs, ruled 2026-10-18): a project that takes it, a shard of its data
// for the scene and one for the project, validated, compiled, merged, carried
// in packs, upgraded by `format`, and following a cast rename. The shared
// spec's own cases are in @wildwinter/toolkit/extensions, and the pass's in
// @patterkit/compiler; these are the project's half (patterkit design/
// proposals/patter-storylet-extensions.md, phase 3).
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { canonicalStringify, parseSource } from "@patterkit/core";
import type { Bundle, ExtensionShard, FlowFile, LocaleFile, ProjectFile } from "@patterkit/model";
import { unresolvedOf } from "@wildwinter/toolkit/extensions";
import { loadProject } from "../src/load.js";
import { exportBlockers, runValidate } from "../src/validate.js";
import { compileLoaded } from "../src/compile.js";
import { runExport } from "../src/export.js";
import { runFormat } from "../src/format.js";
import { runMerge } from "../src/merge.js";
import { readProjectManifest, renameCastKeys, planExtensionUpgrades } from "../src/extensions.js";
import { renameCastInScene, renameCastStrings, moveCastKeys, cleanCastRenames } from "../src/cast-rename.js";
import { runPack } from "../src/pack.js";
import { runUnpack, runUnpackMerge } from "../src/unpack.js";
import { applyWrites } from "../src/write.js";

const fixture = fileURLToPath(new URL("./fixtures/probe-extension.patter", import.meta.url));
const SHARD = "extensions/probe/harbour.patterextension";
const PROJECT_SHARD = "extensions/probe/_project.patterextension";
const MANIFEST = "extensions/probe.extension.json";
const PROJECT = "probe.patterproj";
const FLOW = "scenes/harbour.patterflow";

/** A throwaway copy of the fixture, to change. */
function scratch(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "patter-probe-")), "probe.patter");
  cpSync(fixture, dir, { recursive: true });
  return dir;
}

const read = <T = Record<string, unknown>>(dir: string, rel: string): T => parseSource(readFileSync(join(dir, rel), "utf8")) as T;
const write = (dir: string, rel: string, value: unknown): void => writeFileSync(join(dir, rel), canonicalStringify(value));

type Entries = ExtensionShard["entries"];
/** Edit the scene shard's entries. */
const editShard = (dir: string, edit: (entries: Entries) => void): void => {
  const shard = read<ExtensionShard>(dir, SHARD);
  edit(shard.entries);
  write(dir, SHARD, shard);
};
const editProject = (dir: string, edit: (p: ProjectFile) => void): void => {
  const p = read<ProjectFile>(dir, PROJECT);
  edit(p);
  write(dir, PROJECT, p);
};
const editManifest = (dir: string, edit: (m: Record<string, any>) => void): void => {
  const m = JSON.parse(readFileSync(join(dir, MANIFEST), "utf8"));
  edit(m);
  writeFileSync(join(dir, MANIFEST), JSON.stringify(m, null, 2) + "\n");
};

/** Each issue as `<severity>: <file relative to the project>: <message>`. */
const said = (dir: string, issues: ReadonlyArray<{ severity: string; file: string; message: string }>, severity?: string): string[] =>
  issues.filter((i) => severity === undefined || i.severity === severity)
    .map((i) => `${i.file.startsWith(dir) ? i.file.slice(dir.length + 1) : i.file}: ${i.message}`);

/** Validate a scratch copy after `edit`, then throw it away. */
function validateAfter(edit: (dir: string) => void): { dir: string; result: ReturnType<typeof runValidate>; blockers: string[] } {
  const dir = scratch();
  try {
    edit(dir);
    const loaded = loadProject(dir);
    return { dir, result: runValidate(loaded), blockers: exportBlockers(loaded) };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const RENAMED = `${SHARD}: entries.line.L_bell.act: "act" is "opening", a stage this extension has since renamed "setup"`;

describe("the probe project", () => {
  it("validates clean: ok, with one warning, a stage the extension has since renamed", () => {
    const loaded = loadProject(fixture);
    const result = runValidate(loaded);
    expect(result.ok).toBe(true);
    expect(said(fixture, result.extensions, "error")).toEqual([]);
    expect(said(fixture, result.extensions, "warning")).toEqual([RENAMED]);
    expect(exportBlockers(loaded)).toEqual([]);
  });

  it("compiles each node's values inline, renamed, editor-only fields stripped, and the project's in the section", () => {
    const bundle = compileLoaded(loadProject(fixture));
    const scene = bundle.scenes["scn_harbour"]!;
    expect(scene.extensions).toEqual({ probe: { theme: "salt" } });
    expect(scene.blocks[0]!.extensions).toEqual({ probe: { pace: 2 } });
    const json = JSON.stringify(bundle);
    expect(json).not.toContain("Maybe three times");
    expect(json).toContain('"act":"setup"');
    expect(bundle.extensions!["probe"]!.version).toBe("1.1.0");
    expect(bundle.extensions!["probe"]!.project).toEqual({ studio: "Wildwinter" });
    expect(Object.keys(bundle.extensions!["probe"]!.fields).sort()).toEqual(["block", "gameEvent", "line", "option", "project", "scene", "snippet", "text"]);
  });

  it("puts compiled extension data in the content hash, and leaves editor-only data out of it", () => {
    const dir = scratch();
    try {
      const hash = (): string | undefined => compileLoaded(loadProject(dir)).content.hash;
      const before = hash();
      editShard(dir, (e) => { e["line"]!["L_bell"]!["draft"] = "Another working note."; });
      expect(hash()).toBe(before);
      editShard(dir, (e) => { e["line"]!["L_bell"]!["note"] = "Ring it once."; });
      expect(hash()).not.toBe(before);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("validation, driven by the manifest", () => {
  it("errors on a claimed field the project declares with another type, and export refuses it", () => {
    const { dir, result, blockers } = validateAfter((d) => editProject(d, (p) => {
      p.gameDataFields = { line: [{ name: "delivery", type: "text" }] };
    }));
    expect(result.ok).toBe(false);
    expect(said(dir, result.extensions, "error")).toEqual([
      `${PROJECT}: the Patter extension "probe" claims the line gameData field "delivery" as enum, but the project declares it as text`,
    ]);
    expect(blockers.some((b) => b.startsWith("[extension]") && b.includes("as enum, but the project declares it as text"))).toBe(true);
  });

  it("warns of a claimed field the project doesn't declare, and stays ok", () => {
    const { dir, result } = validateAfter((d) => {
      editProject(d, (p) => { delete p.gameDataFields; });
      const flow = read<FlowFile>(d, FLOW);
      const beats = (flow.scene.blocks[0]!.children[0] as { beats: Array<{ gameData?: unknown }> }).beats;
      delete beats[0]!.gameData;
      write(d, FLOW, flow);
    });
    expect(result.ok).toBe(true);
    expect(said(dir, result.extensions, "warning")).toContain(
      `${PROJECT}: the Patter extension "probe" claims the line gameData field "delivery", which the project doesn't declare`);
  });

  it("follows the project's setting for the claimed field's name, and checks its values against the claim", () => {
    const { result } = validateAfter((d) => {
      editProject(d, (p) => {
        p.gameDataFields = { line: [{ name: "temper", type: "enum", values: ["calm", "tense", "wild"], default: "calm" }] };
        p.extensions!["probe"]!.settings = { deliveryField: "temper" };
      });
      const flow = read<FlowFile>(d, FLOW);
      (flow.scene.blocks[0]!.children[0] as { beats: Array<{ gameData?: unknown }> }).beats[0]!.gameData = { temper: "wild" };
      write(d, FLOW, flow);
    });
    expect(result.ok).toBe(false);
    const errors = result.extensions.filter((i) => i.severity === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ node: "L_bell" });
    expect(errors[0]!.file.endsWith(FLOW)).toBe(true);
    expect(errors[0]!.message).toContain(`line 'L_bell' gameData "temper", as the Patter extension "probe" claims it`);
  });

  it("opens a project whose manifest is missing with a warning, and leaves its data uncompiled and untouched", () => {
    const dir = scratch();
    try {
      rmSync(join(dir, MANIFEST));
      const before = readFileSync(join(dir, SHARD), "utf8");
      const loaded = loadProject(dir);
      const result = runValidate(loaded);
      expect(result.ok).toBe(true);
      expect(said(dir, result.extensions, "warning")).toContain(
        `${PROJECT}: the project takes the Patter extension "probe", but has no manifest for it at extensions/probe.extension.json; its data is left as it is, and not compiled`);
      const bundle = compileLoaded(loaded);
      expect(bundle.extensions).toBeUndefined();
      expect(JSON.stringify(bundle)).not.toContain("Ring it twice");
      expect(readFileSync(join(dir, SHARD), "utf8")).toBe(before);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("warns when the project's pin and its manifest's version differ", () => {
    const { dir, result } = validateAfter((d) => editProject(d, (p) => { p.extensions!["probe"]!.version = "1.0.0"; }));
    expect(result.ok).toBe(true);
    expect(said(dir, result.extensions, "warning")).toContain(
      `${PROJECT}: the project takes "probe" at version 1.0.0, but its manifest is version 1.1.0; run \`patter format\` to take it (renamed stages are renamed in the data as it does)`);
  });

  it("checks each value against its type, per entry, and export refuses an error", () => {
    const { dir, result, blockers } = validateAfter((d) => editShard(d, (e) => {
      const bell = e["line"]!["L_bell"]!;
      bell["weight"] = 11;
      bell["cue"] = { gain: 0.2 };
      bell["perf"] = { GONE: { expression: "smile" } };
      bell["beats"] = [{ id: "b1", at: 1 }, { id: "b1", at: 2 }];
      bell["next"] = "L_nowhere";
    }));
    expect(result.ok).toBe(false);
    const errors = said(dir, result.extensions, "error");
    expect(errors).toHaveLength(5);
    for (const field of ["weight", "cue.sound", "perf.GONE", "beats[1].id", "next"]) {
      expect(errors.some((m) => m.startsWith(`${SHARD}: entries.line.L_bell.${field}`)), field).toBe(true);
    }
    expect(blockers.filter((b) => b.startsWith("[extension]"))).toHaveLength(5);
    // The entry with an error is left out of a compile; export refuses it outright.
    const dir2 = scratch();
    try {
      editShard(dir2, (e) => { e["line"]!["L_bell"]!["weight"] = 11; });
      expect(() => runExport(loadProject(dir2))).toThrow(/extension/);
    } finally { rmSync(dir2, { recursive: true, force: true }); }
  });

  it("reports an entry for a node that has gone, per entry, as a warning, and keeps it", () => {
    const { dir, result } = validateAfter((d) => editShard(d, (e) => {
      e["line"]!["L_gone"] = { note: "x" };
      e["text"]!["T_gone"] = { style: "y" };
    }));
    expect(result.ok).toBe(true);
    const warnings = said(dir, result.extensions, "warning");
    expect(warnings.filter((w) => w.includes("L_gone"))).toHaveLength(1);
    expect(warnings.filter((w) => w.includes("T_gone"))).toHaveLength(1);
    // Never a whole-shard orphan: the shard itself is where it belongs.
    expect(result.orphans).toEqual([]);
  });

  it("warns of an entry in another scene's shard, and compiles it from there", () => {
    const dir = scratch();
    try {
      const shard = read<ExtensionShard>(dir, PROJECT_SHARD);
      delete shard.entries["project"];
      shard.entries["text"] = { T_tide: { style: "near" } };
      write(dir, PROJECT_SHARD, shard);
      editShard(dir, (e) => { delete e["text"]; });
      const loaded = loadProject(dir);
      expect(said(dir, runValidate(loaded).extensions, "warning")).toContain(
        `${PROJECT_SHARD}: entries.text.T_tide belongs in scene "scn_harbour"'s shard; it's compiled from here all the same`);
      expect(JSON.stringify(compileLoaded(loaded))).toContain('"style":"near"');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("errors on an extension file that won't load", () => {
    const { dir, result } = validateAfter((d) => writeFileSync(join(d, SHARD), "{ nope"));
    expect(result.ok).toBe(false);
    expect(said(dir, result.extensions, "error").some((m) => m.startsWith(`${SHARD}: the extension data will not parse`))).toBe(true);
  });

  describe("a .gitattributes with no merge rule for the data", () => {
    const hint = (attributes: string | undefined): string[] => {
      const { dir, result } = validateAfter((d) => { if (attributes !== undefined) writeFileSync(join(d, ".gitattributes"), attributes); });
      return said(dir, result.extensions, "warning").filter((m) => m.includes(".gitattributes"));
    };

    it("is a warning in a project set up for Patter's merge", () => {
      expect(hint("*.patterflow text eol=lf\n*.patterflow merge=patter\n")).toEqual([
        `.gitattributes: the project has extension data, but .gitattributes has no merge rule for it, so git merges it as plain text: add the line "*.patterextension text eol=lf merge=patter"`,
      ]);
    });

    it("is quiet once the rule is there, and in a project not set up for git's merge at all", () => {
      expect(hint("*.patterflow merge=patter\n*.patterextension merge=patter\n")).toEqual([]);
      expect(hint(undefined)).toEqual([]);
      expect(hint("*.patterflow text eol=lf\n")).toEqual([]);
    });
  });
});

describe("merge, by the project's manifest", () => {
  const shardText = readFileSync(join(fixture, SHARD), "utf8");
  const edited = (edit: (entries: Entries) => void): Record<string, unknown> => {
    const shard = parseSource(shardText) as ExtensionShard;
    edit(shard.entries);
    return shard as unknown as Record<string, unknown>;
  };
  const base = parseSource(shardText) as Record<string, unknown>;
  const ours = edited((e) => { (e["line"]!["L_bell"]!["cue"] as Record<string, unknown>)["sound"] = "gong"; });
  const theirs = edited((e) => {
    (e["line"]!["L_bell"]!["cue"] as Record<string, unknown>)["gain"] = 0.9;
    (e["line"]!["L_bell"]!["perf"] as Record<string, unknown>)["BEN"] = { expression: "smile" };
  });

  it("merges two people's edits to one line's record field by field, and to different characters' entries", () => {
    const result = runMerge(base, ours, theirs, { manifest: readProjectManifest(fixture, "probe")! });
    expect(result.conflicts).toEqual([]);
    const bell = (result.merged as unknown as ExtensionShard).entries["line"]!["L_bell"]!;
    expect(bell["cue"]).toEqual({ gain: 0.9, sound: "gong" });
    expect(bell["perf"]).toEqual({ ANNA: { expression: "frown", look: "out to sea" }, BEN: { expression: "smile" } });
  });

  it("without the manifest merges each node's entry whole, so the same edits clash, marked in the shard", () => {
    const result = runMerge(base, ours, theirs);
    expect(result.conflicts.map((c) => c.path)).toEqual(["entries.line.L_bell"]);
    expect(unresolvedOf(result.merged)?.map((u) => u.path)).toEqual(["entries.line.L_bell"]);
  });
});

describe("packs", () => {
  it("carry the manifest and every extension shard, and unpack them where they were", async () => {
    const bytes = await runPack(fixture);
    const zip = await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files)).toEqual(expect.arrayContaining([MANIFEST, SHARD, PROJECT_SHARD]));
    const manifest = JSON.parse(await zip.file("patter.manifest.json")!.async("string")) as { files: string[] };
    expect(manifest.files).toContain(MANIFEST);

    const target = mkdtempSync(join(tmpdir(), "patter-probe-unpack-"));
    try {
      const { shards, other } = await runUnpack(bytes, target);
      expect(other).toEqual([]);
      applyWrites(shards);
      expect(readFileSync(join(target, MANIFEST), "utf8")).toBe(readFileSync(join(fixture, MANIFEST), "utf8"));
      const result = runValidate(loadProject(target));
      expect(said(target, result.extensions)).toEqual([RENAMED]);
    } finally { rmSync(target, { recursive: true, force: true }); }
  });

  it("merge back: extension data by the project's manifest, and the project's own manifest kept, saying so", async () => {
    const ours = scratch();
    const theirs = scratch();
    try {
      const sent = await runPack(ours);
      editShard(ours, (e) => { (e["line"]!["L_bell"]!["cue"] as Record<string, unknown>)["sound"] = "gong"; });
      editShard(theirs, (e) => { (e["line"]!["L_bell"]!["cue"] as Record<string, unknown>)["gain"] = 0.9; });
      editManifest(theirs, (m) => { m["name"] = "Probe, as they have it"; });
      const returned = await runPack(theirs);
      const manifestBefore = readFileSync(join(ours, MANIFEST), "utf8");

      const res = await runUnpackMerge(returned, sent, ours);
      expect(res.conflicts).toBe(0);
      expect(res.manifestsKept).toEqual([MANIFEST]);
      expect(res.writes.map((w) => w.path)).toEqual([join(ours, SHARD)]);
      applyWrites(res.writes);
      expect(read<ExtensionShard>(ours, SHARD).entries["line"]!["L_bell"]!["cue"]).toEqual({ gain: 0.9, sound: "gong" });
      expect(readFileSync(join(ours, MANIFEST), "utf8")).toBe(manifestBefore);
    } finally {
      rmSync(ours, { recursive: true, force: true });
      rmSync(theirs, { recursive: true, force: true });
    }
  });

  it("merge back takes their manifest when the project has none", async () => {
    const ours = scratch();
    const theirs = scratch();
    try {
      rmSync(join(ours, MANIFEST));
      const sent = await runPack(ours);
      editManifest(theirs, (m) => { m["name"] = "Probe"; });
      const res = await runUnpackMerge(await runPack(theirs), sent, ours);
      expect(res.manifestsKept).toBeUndefined();
      expect(res.writes.map((w) => w.path)).toContain(join(ours, MANIFEST));
    } finally {
      rmSync(ours, { recursive: true, force: true });
      rmSync(theirs, { recursive: true, force: true });
    }
  });
});

describe("taking a new extension version", () => {
  it("renames the stages the extension renamed and moves the pin, in one step, from format on the project folder", () => {
    const dir = scratch();
    try {
      editProject(dir, (p) => { p.extensions!["probe"]!.version = "1.0.0"; });
      const manifestBefore = readFileSync(join(dir, MANIFEST), "utf8");
      const plan = planExtensionUpgrades(loadProject(dir));
      expect(plan.report).toEqual([
        `took the Patter extension "probe" at version 1.1.0 (was 1.0.0)`,
        `  renamed 1 stage value for "probe" in ${SHARD}`,
      ]);

      const results = runFormat([dir]);
      const changed = results.filter((r) => r.changed);
      expect(changed.map((r) => r.file.slice(dir.length + 1)).sort()).toEqual([SHARD, PROJECT].sort());
      expect(results.find((r) => r.file.endsWith(PROJECT))!.notes).toEqual([`took the Patter extension "probe" at version 1.1.0 (was 1.0.0)`]);
      expect(results.find((r) => r.file.endsWith(SHARD))!.notes).toEqual([`renamed 1 stage value for "probe"`]);
      applyWrites(changed.map((r) => r.write!));

      expect(readFileSync(join(dir, MANIFEST), "utf8")).toBe(manifestBefore);
      expect(read<ProjectFile>(dir, PROJECT).extensions!["probe"]).toEqual({ version: "1.1.0", settings: { deliveryField: "delivery" } });
      expect(read<ExtensionShard>(dir, SHARD).entries["line"]!["L_bell"]!["act"]).toBe("setup");
      const after = runValidate(loadProject(dir));
      expect(after.ok).toBe(true);
      expect(after.extensions).toEqual([]);
      // ...and a second run has nothing left to take.
      expect(runFormat([dir]).filter((r) => r.changed)).toEqual([]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("leaves a project whose manifest is unsound, or matches the pin, alone", () => {
    expect(planExtensionUpgrades(loadProject(fixture)).writes.size).toBe(0);
    const dir = scratch();
    try {
      editProject(dir, (p) => { p.extensions!["probe"]!.version = "1.0.0"; });
      editManifest(dir, (m) => { m["targets"]["patter"]["line"]["fields"][2]["min"] = 20; });
      expect(planExtensionUpgrades(loadProject(dir)).writes.size).toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("a cast rename", () => {
  const renames = new Map([["ANNA", "ANNE"]]);

  it("rewrites the extension's map keys and reference values naming the member, at any depth", () => {
    const loaded = loadProject(fixture);
    const shards = loaded.extensionShards.map((shard, i) => ({ path: loaded.extensionShardFiles[i]!, shard }));
    const out = renameCastKeys(shards, loaded.manifests, renames);
    expect(out.map((o) => ({ path: o.path.slice(fixture.length + 1), renamed: o.renamed }))).toEqual([{ path: SHARD, renamed: 1 }]);
    expect(out[0]!.shard.entries["line"]!["L_bell"]!["perf"]).toEqual({ ANNE: { expression: "frown", look: "out to sea" } });
    // Nothing else moves, and the input is untouched.
    expect(out[0]!.shard.entries["line"]!["L_bell"]!["next"]).toBe("L_reply");
    expect(loaded.extensionShards.find((s) => s.scene === "scn_harbour")!.entries["line"]!["L_bell"]!["perf"]).toHaveProperty("ANNA");

    // Deeper: references to cast in a list of records, a map of lists, and a map keyed by cast inside a record.
    const manifest = {
      schema: "wildwinter/extension@0", id: "deep", name: "Deep", version: "1.0.0",
      targets: { patter: { line: { fields: [
        { name: "who", type: "reference", to: "cast" },
        { name: "notLines", type: "reference", to: "line" },
        { name: "crowd", type: "list", of: { type: "record", fields: [{ name: "who", type: "reference", to: "cast" }] } },
        { name: "by", type: "map", key: { type: "text" }, of: { type: "list", of: { type: "reference", to: "cast" } } },
        { name: "nest", type: "record", fields: [{ name: "looks", type: "map", key: { type: "reference", to: "cast" }, of: { type: "text" } }] },
        { name: "free", type: "map", key: { type: "text" }, of: { type: "text" } },
      ] } } },
    };
    const shard: ExtensionShard = { schema: "patter/extension@0", extension: "deep", scene: "s", entries: { line: { L1: {
      who: "ANNA", notLines: "ANNA", crowd: [{ who: "BEN" }, { who: "ANNA" }], by: { x: ["ANNA", "BEN"] },
      nest: { looks: { BEN: "b", ANNA: "a" } }, free: { ANNA: "kept" }, undeclared: "ANNA",
    } } } };
    const deep = renameCastKeys([{ path: "d", shard }], [{ id: "deep", manifest }], new Map([["ANNA", "ANNE"], ["BEN", "ANNA"]]));
    expect(deep[0]!.renamed).toBe(7);
    expect(deep[0]!.shard.entries["line"]!["L1"]).toEqual({
      who: "ANNE", notLines: "ANNA", crowd: [{ who: "ANNA" }, { who: "ANNE" }], by: { x: ["ANNE", "ANNA"] },
      nest: { looks: { ANNA: "b", ANNE: "a" } }, free: { ANNA: "kept" }, undeclared: "ANNA",
    });
    // A map that already holds the new name keeps both keys, for validation to report the old one.
    const clash: ExtensionShard = { ...shard, entries: { line: { L1: { nest: { looks: { ANNA: "a", ANNE: "e" } } } } } };
    expect(renameCastKeys([{ path: "d", shard: clash }], [{ id: "deep", manifest }], renames)).toEqual([]);
    // No manifest, no rewrite: the data is left as it is.
    expect(renameCastKeys([{ path: "d", shard }], [], renames)).toEqual([]);
  });

  it("rewrites the lines naming the member, option prompts among them, and the project-level strings keyed by them", () => {
    const loaded = loadProject(fixture);
    const scene = structuredClone(loaded.scenes[0]!);
    expect(renameCastInScene(scene, renames)).toBe(2);
    const json = JSON.stringify(scene);
    expect(json).not.toContain('"ANNA"');
    expect(json).toContain('"BEN"');
    // A swap lands as a swap.
    const swapped = structuredClone(loaded.scenes[0]!);
    renameCastInScene(swapped, new Map([["ANNA", "BEN"], ["BEN", "ANNA"]]));
    const beats = (swapped.blocks[0]!.children[0] as { beats: Array<{ character?: string }> }).beats;
    expect(beats.map((b) => b.character)).toEqual(["BEN", "ANNA", undefined, undefined]);

    const loc: LocaleFile = { schema: "patter/strings@0", scene: "@project", locale: "fr", strings: {
      "cast:ANNA": "Anne", "cast:BEN": "Benoît", "speaker:ANNA:vo": "Anne (voix)", "speaker:pattern": "{name} ({qualifier})", "qualifier:vo": "V.O.",
    } };
    expect(renameCastStrings(loc, renames)).toBe(true);
    expect(Object.keys(loc.strings)).toEqual(["cast:ANNE", "cast:BEN", "speaker:ANNE:vo", "speaker:pattern", "qualifier:vo"]);
    expect(moveCastKeys({ "cast:BEN": 1, "cast:ANNE": 2 }, new Map([["BEN", "ANNE"]]))).toBe(false);
    expect(cleanCastRenames({ A: "A", "": "B", C: "D" })).toEqual(new Map([["C", "D"]]));
  });

  it("leaves the project validating clean once the cast, the lines, and the data have all moved", () => {
    const dir = scratch();
    try {
      editProject(dir, (p) => { p.cast = [{ name: "ANNE" }, { name: "BEN" }]; });
      // Before the lines and data follow, the old name is a missing cast key, and an error.
      const stale = runValidate(loadProject(dir));
      expect(stale.ok).toBe(false);
      expect(said(dir, stale.extensions, "error").some((m) => m.includes("ANNA"))).toBe(true);

      const loaded = loadProject(dir);
      const flow = read<FlowFile>(dir, FLOW);
      renameCastInScene(flow.scene, renames);
      write(dir, FLOW, flow);
      const shards = loaded.extensionShards.map((shard, i) => ({ path: loaded.extensionShardFiles[i]!, shard }));
      for (const o of renameCastKeys(shards, loaded.manifests, renames)) writeFileSync(o.path, canonicalStringify(o.shard));
      const after = runValidate(loadProject(dir));
      expect(after.ok).toBe(true);
      expect(said(dir, after.extensions)).toEqual([RENAMED]);
      const bundle: Bundle = compileLoaded(loadProject(dir));
      expect(JSON.stringify(bundle)).toContain('"perf":{"ANNE"');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
