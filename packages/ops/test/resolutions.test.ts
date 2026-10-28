// ---------------------------------------------------------------------------
// `applyResolutions` (ruling Q21): settle the clashes a merge left in a shard, by path, with "ours" (keep and
// clear), "theirs" (write their value and clear), or "resolved" (clear only). Every shard here is a real
// merge's output (`runMerge`), in each shard type, so the paths are the ones a merge really writes.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalStringify, parseSource } from "@patterkit/core";
import { DEFAULT_QUALIFIERS } from "@patterkit/model";
import { runMerge } from "../src/merge.js";
import {
  applyResolutions, isSettableClash, unresolvedClashes, clashPathSegments, valueAtClashPath, findMarkedShards, ResolutionError,
} from "../src/resolutions.js";

type Obj = Record<string, unknown>;

const merged = (base: Obj, ours: Obj, theirs: Obj): string => canonicalStringify(runMerge(base, ours, theirs).merged);
const parsed = (text: string): Obj => parseSource(text) as Obj;
const paths = (text: string): string[] => unresolvedClashes(parsed(text)).map((c) => c.path);

const loc = (strings: Obj): Obj => ({ schema: "patter/strings@0", scene: "s1", locale: "en", strings });
const authoring = (extra: Obj): Obj => ({ schema: "patter/authoring@0", ...extra });
const flow = (children: Obj[]): Obj => ({ schema: "patter/flow@0", scene: { id: "s1", type: "scene", name: "S", blocks: [{ id: "b1", type: "block", name: "B", children }] } });
const sn = (id: string, extra: Obj = {}): Obj => ({ id, type: "snippet", beats: [], ...extra });
const proj = (extra: Obj): Obj => ({ schema: "patter/project@0", project: { id: "p", name: "P" }, locales: { default: "en", all: ["en"] }, ...extra });
const ext = (entries: Obj): Obj => ({ schema: "patter/extension@0", extension: "probe", scene: "s1", entries });

describe("applyResolutions, on a loc shard", () => {
  const text = merged(loc({ A: "a", B: "b" }), loc({ A: "ours", B: "b2" }), loc({ A: "theirs", B: "b3" }));

  it("keeps ours and clears the entry", () => {
    const out = parsed(applyResolutions(text, [{ path: "strings.A", decision: "ours" }]));
    expect((out["strings"] as Obj)["A"]).toBe("ours");
    expect(paths(canonicalStringify(out))).toEqual(["strings.B"]);
  });

  it("takes theirs, and the mark goes with the last entry", () => {
    const out = applyResolutions(text, [{ path: "strings.A", decision: "theirs" }, { path: "strings.B", decision: "theirs" }]);
    expect(parsed(out)["strings"]).toEqual({ A: "theirs", B: "b3" });
    expect(parsed(out)["unresolved"]).toBeUndefined();
    expect(out).toBe(canonicalStringify(parsed(out))); // canonical text
  });

  it("removes a line theirs deleted", () => {
    const t = merged(loc({ A: "a" }), loc({ A: "ours" }), loc({}));
    expect(unresolvedClashes(parsed(t))[0]).toMatchObject({ path: "strings.A", kind: "delete-vs-edit" });
    expect(parsed(applyResolutions(t, [{ path: "strings.A", decision: "theirs" }]))["strings"]).toEqual({});
  });

  it("refuses a path the mark doesn't hold", () => {
    expect(() => applyResolutions(text, [{ path: "strings.Z", decision: "ours" }])).toThrow(ResolutionError);
  });
});

describe("applyResolutions, on an authoring shard", () => {
  it("a status with no edit clock to break the tie (no-timestamp) takes theirs", () => {
    const t = merged(authoring({ writing: { L1: "draft" } }), authoring({ writing: { L1: "final" } }), authoring({ writing: { L1: "cut" } }));
    const [c] = unresolvedClashes(parsed(t));
    expect(c).toMatchObject({ path: "writing.L1", kind: "no-timestamp" });
    expect(isSettableClash(c!)).toBe(true);
    expect(parsed(applyResolutions(t, [{ path: "writing.L1", decision: "theirs" }]))["writing"]).toEqual({ L1: "cut" });
  });

  it("documentation, marked resolved, keeps what's there now", () => {
    const t = merged(authoring({ documentation: { b1: "base" } }), authoring({ documentation: { b1: "ours" } }), authoring({ documentation: { b1: "theirs" } }));
    // The author edited the shard by hand before marking it resolved.
    const edited = parsed(t);
    (edited["documentation"] as Obj)["b1"] = "both, by hand";
    const out = parsed(applyResolutions(canonicalStringify(edited), [{ path: "documentation.b1", decision: "resolved" }]));
    expect(out["documentation"]).toEqual({ b1: "both, by hand" });
    expect(out["unresolved"]).toBeUndefined();
  });

  it("a suggestion both sides decided differently takes theirs, by id in the list", () => {
    const s = (outcome: string): Obj => ({ id: "s1", ts: "2026-10-01T00:00:00Z", target: "L1", text: "x", ...(outcome ? { resolved: true, outcome } : {}) });
    const t = merged(authoring({ suggestions: [s("")] }), authoring({ suggestions: [s("accepted")] }), authoring({ suggestions: [s("rejected")] }));
    expect(paths(t)).toEqual(["suggestions.s1"]);
    const out = parsed(applyResolutions(t, [{ path: "suggestions.s1", decision: "theirs" }]));
    expect((out["suggestions"] as Obj[])[0]!["outcome"]).toBe("rejected");
  });
});

describe("applyResolutions, on a flow shard", () => {
  it("a field both sides changed takes theirs", () => {
    const t = merged(flow([sn("x", { choiceText: "base" })]), flow([sn("x", { choiceText: "ours" })]), flow([sn("x", { choiceText: "theirs" })]));
    const path = "scene.blocks[b1].children[x].choiceText";
    expect(paths(t)).toEqual([path]);
    const out = applyResolutions(t, [{ path, decision: "theirs" }]);
    expect(valueAtClashPath(parsed(out), path)).toBe("theirs");
    expect(parsed(out)["unresolved"]).toBeUndefined();
  });

  it("a node theirs deleted and ours edited goes, with theirs", () => {
    const t = merged(flow([sn("x"), sn("y", { choiceText: "base" })]), flow([sn("x"), sn("y", { choiceText: "ours" })]), flow([sn("x")]));
    expect(unresolvedClashes(parsed(t))).toMatchObject([{ path: "scene.blocks[b1].children[y]", kind: "delete-vs-edit" }]);
    const out = parsed(applyResolutions(t, [{ path: "scene.blocks[b1].children[y]", decision: "theirs" }]));
    expect(((out["scene"] as Obj)["blocks"] as Obj[])[0]!["children"]).toEqual([sn("x")]);
  });

  it("a node ours deleted and theirs edited comes back, at the end of its list", () => {
    const t = merged(flow([sn("x"), sn("y", { choiceText: "base" })]), flow([sn("x")]), flow([sn("y", { choiceText: "theirs" }), sn("x")]));
    const out = parsed(applyResolutions(t, [{ path: "scene.blocks[b1].children[y]", decision: "theirs" }]));
    expect(((out["scene"] as Obj)["blocks"] as Obj[])[0]!["children"]).toEqual([sn("x"), sn("y", { choiceText: "theirs" })]);
  });

  it("a game-data field theirs removed goes, and the emptied gameData with it", () => {
    const t = merged(flow([sn("x", { gameData: { mood: "calm" } })]), flow([sn("x", { gameData: { mood: "angry" } })]), flow([sn("x")]));
    const path = "scene.blocks[b1].children[x].gameData.mood";
    expect(paths(t)).toEqual([path]);
    const out = parsed(applyResolutions(t, [{ path, decision: "theirs" }]));
    expect(((out["scene"] as Obj)["blocks"] as Obj[])[0]!["children"]).toEqual([sn("x")]);
  });

  it("a reorder both sides made (moved) can't take theirs, but keeps ours", () => {
    const t = merged(flow([sn("a"), sn("b"), sn("c")]), flow([sn("b"), sn("a"), sn("c")]), flow([sn("a"), sn("c"), sn("b")]));
    const [c] = unresolvedClashes(parsed(t));
    expect(c).toMatchObject({ path: "scene.blocks[b1].children", kind: "moved" });
    expect(isSettableClash(c!)).toBe(false);
    expect(() => applyResolutions(t, [{ path: c!.path, decision: "theirs" }])).toThrow(/isn't one value/);
    const out = parsed(applyResolutions(t, [{ path: c!.path, decision: "ours" }]));
    expect((((out["scene"] as Obj)["blocks"] as Obj[])[0]!["children"] as Obj[]).map((n) => n["id"])).toEqual(["b", "a", "c"]);
    expect(out["unresolved"]).toBeUndefined();
  });

  it("a duplicate id (structural) can't take theirs", () => {
    // The same new id added in two different blocks: each side's tree is sound, the merged one isn't.
    const two = (a: Obj[], b: Obj[]): Obj => ({ schema: "patter/flow@0", scene: { id: "s1", type: "scene", name: "S", blocks: [{ id: "b1", type: "block", name: "B", children: a }, { id: "b2", type: "block", name: "C", children: b }] } });
    const t = merged(two([], []), two([sn("dup")], []), two([], [sn("dup")]));
    const [c] = unresolvedClashes(parsed(t));
    expect(c).toMatchObject({ path: "scene[dup]", kind: "structural" });
    expect(isSettableClash(c!)).toBe(false);
    expect(() => applyResolutions(t, [{ path: "scene[dup]", decision: "theirs" }])).toThrow(ResolutionError);
    expect(parsed(applyResolutions(t, [{ path: "scene[dup]", decision: "resolved" }]))["unresolved"]).toBeUndefined();
  });
});

describe("applyResolutions, on the project shard", () => {
  it("a plain field", () => {
    const t = merged(proj({ voiced: false }), proj({ voiced: true }), proj({ voiced: "maybe" }));
    expect(parsed(applyResolutions(t, [{ path: "voiced", decision: "theirs" }]))["voiced"]).toBe("maybe");
  });

  it("a property both sides declared differently, by name in its list", () => {
    const p = (dflt: number): Obj => ({ name: "gold", type: "number", default: dflt });
    const t = merged(proj({ properties: [p(0)] }), proj({ properties: [p(5)] }), proj({ properties: [p(9)] }));
    expect(paths(t)).toEqual(["properties[gold]"]);
    expect(parsed(applyResolutions(t, [{ path: "properties[gold]", decision: "theirs" }]))["properties"]).toEqual([p(9)]);
  });

  it("a cast member's field, merged field by field", () => {
    const m = (displayName: string): Obj => ({ name: "Ann", displayName });
    const t = merged(proj({ cast: [m("Ann")] }), proj({ cast: [m("Annie")] }), proj({ cast: [m("Anna")] }));
    expect(paths(t)).toEqual(["cast[Ann].displayName"]);
    expect(parsed(applyResolutions(t, [{ path: "cast[Ann].displayName", decision: "theirs" }]))["cast"]).toEqual([m("Anna")]);
  });

  it("a list both sides reordered (`:order`) can't take theirs", () => {
    const p = (name: string): Obj => ({ name, type: "number", default: 0 });
    const t = merged(proj({ properties: [p("a"), p("b"), p("c")] }), proj({ properties: [p("b"), p("a"), p("c")] }), proj({ properties: [p("a"), p("c"), p("b")] }));
    const [c] = unresolvedClashes(parsed(t));
    expect(c!.path).toBe("properties:order");
    expect(isSettableClash(c!)).toBe(false);
    expect(() => applyResolutions(t, [{ path: c!.path, decision: "theirs" }])).toThrow(ResolutionError);
  });

  it("a qualifier, when the project leaves the defaults implicit on our side", () => {
    const vo = DEFAULT_QUALIFIERS[0]!;
    const theirsQ = [{ ...vo, name: "Voice-over" }, ...DEFAULT_QUALIFIERS.slice(1)];
    const oursQ = [{ ...vo, name: "VO" }, ...DEFAULT_QUALIFIERS.slice(1)];
    const t = merged(proj({}), proj({ qualifiers: oursQ }), proj({ qualifiers: theirsQ }));
    const path = `qualifiers.${vo.gameId}`;
    expect(paths(t)).toEqual([path]);
    expect(parsed(applyResolutions(t, [{ path, decision: "theirs" }]))["qualifiers"]).toEqual(theirsQ);
  });
});

describe("applyResolutions, on an extension data shard", () => {
  it("a node's entry, as one value", () => {
    const t = merged(ext({ line: { L1: { note: "a", weight: 1 } } }), ext({ line: { L1: { note: "b", weight: 1 } } }), ext({ line: { L1: { note: "a", weight: 2 } } }));
    expect(paths(t)).toEqual(["entries.line.L1"]);
    expect(parsed(applyResolutions(t, [{ path: "entries.line.L1", decision: "theirs" }]))["entries"]).toEqual({ line: { L1: { note: "a", weight: 2 } } });
  });

  it("an entry theirs removed goes, and the emptied kind with it", () => {
    const t = merged(ext({ line: { L1: { note: "a" }, L2: { note: "x" } } }), ext({ line: { L1: { note: "b" }, L2: { note: "x" } } }), ext({ line: { L2: { note: "x" } } }));
    expect(paths(t)).toEqual(["entries.line.L1"]);
    expect(parsed(applyResolutions(t, [{ path: "entries.line.L1", decision: "theirs" }]))["entries"]).toEqual({ line: { L2: { note: "x" } } });
    const all = merged(ext({ line: { L1: { note: "a" } } }), ext({ line: { L1: { note: "b" } } }), ext({}));
    expect(paths(all)).toEqual(["entries.line"]);
    expect(parsed(applyResolutions(all, [{ path: "entries.line", decision: "theirs" }]))["entries"]).toEqual({});
  });
});

describe("clash paths", () => {
  it("split into steps, bracketed or dotted, quoted or not", () => {
    expect(clashPathSegments("scene.blocks[b1].children[x].choiceText")).toEqual([
      { key: "scene", bracket: false }, { key: "blocks", bracket: false }, { key: "b1", bracket: true },
      { key: "children", bracket: false }, { key: "x", bracket: true }, { key: "choiceText", bracket: false },
    ]);
    expect(clashPathSegments("comments[c1].messages[ann|2026-10-01T10:00:00Z]").map((s) => s.key)).toEqual(["comments", "c1", "messages", "ann|2026-10-01T10:00:00Z"]);
    expect(clashPathSegments("entries.line[\"a b\"].note")).toEqual([
      { key: "entries", bracket: false }, { key: "line", bracket: false }, { key: "a b", bracket: false }, { key: "note", bracket: false },
    ]);
    expect(clashPathSegments("properties:order")).toEqual([{ key: "properties", bracket: false }]);
  });
});

describe("findMarkedShards", () => {
  it("finds every marked shard under the root, with its sidecar, and skips the rest", () => {
    const root = mkdtempSync(join(tmpdir(), "patter-marked-"));
    mkdirSync(join(root, "loc"));
    const r = runMerge(loc({ A: "a" }), loc({ A: "ours" }), loc({ A: "theirs" }));
    writeFileSync(join(root, "loc", "s1.patterloc"), canonicalStringify(r.merged));
    writeFileSync(join(root, "loc", "s1.patterloc.patterconflict"), JSON.stringify({ type: r.type, conflicts: r.conflicts, warnings: [{ path: "strings.A", message: "a note" }] }));
    writeFileSync(join(root, "clean.patterloc"), canonicalStringify(loc({ A: "a" })));
    const found = findMarkedShards(root);
    expect(found.map((m) => m.file)).toEqual([join(root, "loc", "s1.patterloc")]);
    expect(found[0]!.clashes.map((c) => c.path)).toEqual(["strings.A"]);
    expect(found[0]!.sidecar?.warnings).toEqual([{ path: "strings.A", message: "a note" }]);
  });
});
