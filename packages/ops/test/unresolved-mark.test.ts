// ---------------------------------------------------------------------------
// The `unresolved` mark (ruled 2026-10-18, in both formats): a merge that leaves a clash writes it into
// the merged shard itself, in EVERY Patter shard type, so the record travels with the file. A mark either
// side already carries survives a clean merge until somebody removes it, and validate, export, and pack
// refuse a marked shard wherever they refuse a `.patterconflict` sidecar. Extension data shards
// (`.patterextension`) merge by their manifest through `@wildwinter/toolkit/extensions`.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalStringify, parseSource } from "@patterkit/core";
import { parseManifest } from "@wildwinter/toolkit/extensions";
import { runMerge, unresolvedMarkIssues } from "../src/merge.js";
import { loadProject } from "../src/load.js";
import { runValidate } from "../src/validate.js";
import { runExport } from "../src/export.js";
import { runPack } from "../src/pack.js";

type Obj = Record<string, unknown>;
const fixture = fileURLToPath(new URL("../../../test-fixtures/tavern-example.patter", import.meta.url));

function scratch(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "patter-mark-")), "tavern.patter");
  cpSync(fixture, dir, { recursive: true });
  return dir;
}

const mark = (r: { merged: Obj }): Array<{ path: string; kind: string }> =>
  ((r.merged["unresolved"] ?? []) as Array<{ path: string; kind: string }>).map(({ path, kind }) => ({ path, kind }));

const loc = (strings: Obj): Obj => ({ schema: "patter/strings@0", scene: "s1", locale: "en", strings });
const authoring = (extra: Obj): Obj => ({ schema: "patter/authoring@0", ...extra });
const flow = (children: Obj[]): Obj => ({ schema: "patter/flow@0", scene: { id: "s1", type: "scene", name: "S", blocks: [{ id: "b1", type: "block", name: "B", children }] } });
const sn = (id: string, extra: Obj = {}): Obj => ({ id, type: "snippet", beats: [], ...extra });
const proj = (extra: Obj): Obj => ({ schema: "patter/project@0", project: { id: "p", name: "P" }, locales: { default: "en", all: ["en"] }, ...extra });
const ext = (entries: Obj): Obj => ({ schema: "patter/extension@0", extension: "probe", scene: "s1", entries });

describe("a merge that clashes marks the shard, in every shard type", () => {
  it("loc", () => {
    const r = runMerge(loc({ A: "a" }), loc({ A: "ours" }), loc({ A: "theirs" }));
    expect(r.merged["strings"]).toEqual({ A: "ours" });
    expect(mark(r)).toEqual([{ path: "strings.A", kind: "both-changed" }]);
  });

  it("authoring (.patterx), including Patter's own conflict kinds", () => {
    const r = runMerge(authoring({ writing: { L1: "draft" } }), authoring({ writing: { L1: "final" } }), authoring({ writing: { L1: "cut" } }));
    expect(mark(r)).toEqual([{ path: "writing.L1", kind: "no-timestamp" }]);
  });

  it("flow, including a reorder both sides made differently", () => {
    const changed = runMerge(flow([sn("x", { choiceText: "base" })]), flow([sn("x", { choiceText: "ours" })]), flow([sn("x", { choiceText: "theirs" })]));
    expect(mark(changed)).toEqual([{ path: "scene.blocks[b1].children[x].choiceText", kind: "both-changed" }]);
    const moved = runMerge(flow([sn("a"), sn("b"), sn("c")]), flow([sn("b"), sn("a"), sn("c")]), flow([sn("a"), sn("c"), sn("b")]));
    expect(mark(moved)).toEqual([{ path: "scene.blocks[b1].children", kind: "moved" }]);
  });

  it("project", () => {
    const r = runMerge(proj({ voiced: false }), proj({ voiced: true }), proj({ voiced: "maybe" }));
    expect(mark(r)).toEqual([{ path: "voiced", kind: "both-changed" }]);
  });

  it("extension data, without the manifest: each node's entry is one value", () => {
    const r = runMerge(ext({ line: { L1: { note: "a", weight: 1 } } }), ext({ line: { L1: { note: "b", weight: 1 } } }), ext({ line: { L1: { note: "a", weight: 2 } } }));
    expect(r.type).toBe("extension");
    expect((r.merged["entries"] as Obj)["line"]).toEqual({ L1: { note: "b", weight: 1 } });
    expect(mark(r)).toEqual([{ path: "entries.line.L1", kind: "both-changed" }]);
  });

  it("extension data, with the manifest: field by field, so both edits land", () => {
    const manifest = parseManifest(JSON.stringify({
      schema: "wildwinter/extension@0", id: "probe", name: "Probe", version: "1.0.0",
      targets: { patter: { line: { fields: [{ name: "note", type: "text" }, { name: "weight", type: "number" }] } } },
    }));
    const r = runMerge(ext({ line: { L1: { note: "a", weight: 1 } } }), ext({ line: { L1: { note: "b", weight: 1 } } }), ext({ line: { L1: { note: "a", weight: 2 } } }), { manifest });
    expect(r.conflicts).toEqual([]);
    expect((r.merged["entries"] as Obj)["line"]).toEqual({ L1: { note: "b", weight: 2 } });
    expect(r.merged["unresolved"]).toBeUndefined();
  });

  it("a clean merge carries no mark at all", () => {
    expect("unresolved" in runMerge(loc({ A: "a", B: "b" }), loc({ A: "a2", B: "b" }), loc({ A: "a", B: "b2" })).merged).toBe(false);
  });
});

describe("a mark already on a side", () => {
  const marked = (shard: Obj, path = "strings.A"): Obj => ({ ...shard, unresolved: [{ path, kind: "both-changed", ours: "x", theirs: "y" }] });

  it("survives a clean merge, whichever side carries it", () => {
    const base = loc({ A: "a", B: "b" });
    const ours = marked(loc({ A: "a", B: "b2" }));
    expect(mark(runMerge(base, ours, loc({ A: "a", B: "b" })))).toEqual([{ path: "strings.A", kind: "both-changed" }]);
    expect(mark(runMerge(base, loc({ A: "a", B: "b" }), ours))).toEqual([{ path: "strings.A", kind: "both-changed" }]);
    for (const shard of [flow([sn("a")]), authoring({ cut: { L1: true } }), proj({ voiced: true }), ext({ line: {} })]) {
      expect(mark(runMerge(shard, marked(shard, "x"), shard)), String(shard["schema"])).toEqual([{ path: "x", kind: "both-changed" }]);
    }
  });

  it("is resolved by one side removing it", () => {
    const base = marked(loc({ A: "a" }));
    expect("unresolved" in runMerge(base, loc({ A: "a" }), marked(loc({ A: "a" }))).merged).toBe(false);
  });

  it("is never merged as content: the mark is not a conflict of its own", () => {
    const r = runMerge(loc({ A: "a" }), marked(loc({ A: "a" }), "one"), marked(loc({ A: "a" }), "two"));
    expect(r.conflicts).toEqual([]);
    expect(mark(r).map((e) => e.path)).toEqual(["one", "two"]);
  });
});

describe("the duplicate-id check after a flow merge", () => {
  it("names each duplicate by its own path, so the mark keeps them all", () => {
    // Each side adds an id the other side already moved under it: the merge can't see a move, so the
    // tree comes out with two nodes per id.
    const base = { schema: "patter/flow@0", scene: { id: "s1", type: "scene", name: "S", blocks: [
      { id: "b1", type: "block", name: "B", children: [] }, { id: "b2", type: "block", name: "C", children: [] },
    ] } };
    const ours = { schema: "patter/flow@0", scene: { id: "s1", type: "scene", name: "S", blocks: [
      { id: "b1", type: "block", name: "B", children: [sn("x"), sn("y")] }, { id: "b2", type: "block", name: "C", children: [] },
    ] } };
    const theirs = { schema: "patter/flow@0", scene: { id: "s1", type: "scene", name: "S", blocks: [
      { id: "b1", type: "block", name: "B", children: [] }, { id: "b2", type: "block", name: "C", children: [sn("x"), sn("y")] },
    ] } };
    const r = runMerge(base, ours, theirs);
    const structural = r.conflicts.filter((c) => c.kind === "structural").map((c) => c.path);
    expect(structural).toEqual(["scene[x]", "scene[y]"]);
    expect(mark(r).filter((e) => e.kind === "structural").map((e) => e.path)).toEqual(["scene[x]", "scene[y]"]);
  });
});

describe("a marked shard is refused", () => {
  const markLoc = (dir: string): string => {
    const file = join(dir, "loc/en/tavern.patterloc");
    const shard = parseSource(readFileSync(file, "utf8")) as Obj;
    writeFileSync(file, canonicalStringify({ ...shard, unresolved: [{ path: "strings.x", kind: "both-changed", ours: "a", theirs: "b" }] }));
    return file;
  };

  it("names each clash, and only in shards that carry one", () => {
    const issues = unresolvedMarkIssues([
      { file: "a.patterloc", text: canonicalStringify(loc({ A: "unresolved" })) },
      { file: "b.patterloc", text: canonicalStringify({ ...loc({}), unresolved: [{ path: "strings.A", kind: "both-changed" }] }) },
      { file: "c.patterloc", text: "{ not json" },
    ]);
    expect(issues.map((i) => i.file)).toEqual(["b.patterloc"]);
    expect(issues[0]!.message).toContain("strings.A");
  });

  it("by validate, beside the sidecar check", () => {
    const dir = scratch();
    const clean = runValidate(loadProject(dir));
    expect(clean.unresolvedMerges).toEqual([]);
    const file = markLoc(dir);
    const result = runValidate(loadProject(dir));
    expect(result.unresolvedMerges.map((i) => i.file)).toEqual([file]);
    expect(result.ok).toBe(false);
  });

  it("by validate in the project file and an extension shard too", () => {
    const dir = scratch();
    const projectFile = join(dir, "tavern.patterproj");
    const project = parseSource(readFileSync(projectFile, "utf8")) as Obj;
    writeFileSync(projectFile, canonicalStringify({ ...project, unresolved: [{ path: "voiced", kind: "both-changed" }] }));
    const shard = join(dir, "extensions/probe/tavern.patterextension");
    mkdirSync(join(dir, "extensions/probe"), { recursive: true });
    writeFileSync(shard, canonicalStringify({ ...ext({ line: {} }), unresolved: [{ path: "entries.line.L1", kind: "both-changed" }] }));
    const result = runValidate(loadProject(dir));
    expect(result.unresolvedMerges.map((i) => i.file).sort()).toEqual([shard, projectFile].sort());
  });

  it("by export", () => {
    const dir = scratch();
    markLoc(dir);
    expect(() => runExport(loadProject(dir))).toThrow(/unresolved/);
  });

  it("by pack", async () => {
    const dir = scratch();
    markLoc(dir);
    await expect(runPack(dir)).rejects.toThrow(/loc\/en\/tavern\.patterloc/);
  });
});
