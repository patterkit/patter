// ---------------------------------------------------------------------------
// The 3-way merge corpus (patter-merge.md §6): the algebraic properties every
// merge must satisfy, plus representative locale (§3.3) and authoring (§3.4)
// cases - clean auto-merges, and the conflicts a human must resolve.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { runMerge, detectMergeType, UnsupportedMergeError } from "../src/index.js";

type Obj = Record<string, unknown>;
/* eslint-disable @typescript-eslint/no-explicit-any */
const loc = (strings: Obj, extra: Obj = {}): Obj => ({ schema: "patter/strings@0", scene: "s1", locale: "en", strings, ...extra });
const authoring = (fields: Obj = {}): Obj => ({ schema: "patter/authoring@0", ...fields });
const paths = (r: { conflicts: Array<{ path: string; kind: string }> }) => r.conflicts.map((c) => `${c.path}:${c.kind}`).sort();

// flow builders
const sn = (id: string, extra: Obj = {}): Obj => ({ id, type: "snippet", ...extra });
const block = (id: string, children: Obj[]): Obj => ({ id, type: "block", name: id, children });
const scene = (blocks: Obj[]): Obj => ({ schema: "patter/flow@0", scene: { id: "s1", type: "scene", name: "S", blocks } });
const one = (children: Obj[]): Obj => scene([block("b1", children)]); // single-block flow
const kids = (r: any, blk = 0): string[] => r.merged.scene.blocks[blk].children.map((c: any) => c.id);
const proj = (fields: Obj = {}): Obj => ({ schema: "patter/project@0", project: { id: "p", name: "P" }, locales: { default: "en", all: ["en"] }, ...fields });

describe("detectMergeType + dispatch", () => {
  it("maps the schema tag to a type", () => {
    expect(detectMergeType({ schema: "patter/strings@0" })).toBe("loc");
    expect(detectMergeType({ schema: "patter/authoring@0" })).toBe("authoring");
    expect(detectMergeType({ schema: "patter/flow@0" })).toBe("flow");
  });
  it("throws UnsupportedMergeError for an unrecognised schema", () => {
    expect(() => runMerge({}, { schema: "nonsense@0" }, {})).toThrow(UnsupportedMergeError);
  });
});

describe("3-way algebraic properties", () => {
  const base = loc({ A: "a", B: "b" });
  const ours = loc({ A: "a2", B: "b" });
  const theirs = loc({ A: "a", B: "b2" });
  it("merge(b, x, b) = x  (only ours changed)", () => {
    const r = runMerge(base, ours, base);
    expect(r.conflicts).toEqual([]);
    expect(r.merged.strings).toEqual({ A: "a2", B: "b" });
  });
  it("merge(b, b, y) = y  (only theirs changed)", () => {
    const r = runMerge(base, base, theirs);
    expect(r.conflicts).toEqual([]);
    expect(r.merged.strings).toEqual({ A: "a", B: "b2" });
  });
  it("merge(b, x, x) = x  (both made the same change - clean, not a conflict)", () => {
    const r = runMerge(base, ours, ours);
    expect(r.conflicts).toEqual([]);
    expect(r.merged.strings).toEqual({ A: "a2", B: "b" });
  });
});

describe("locale (.patterloc) merge", () => {
  it("auto-merges disjoint per-key edits", () => {
    const r = runMerge(loc({ A: "a", B: "b" }), loc({ A: "a2", B: "b" }), loc({ A: "a", B: "b2" }));
    expect(r.conflicts).toEqual([]);
    expect(r.merged.strings).toEqual({ A: "a2", B: "b2" });
  });
  it("both sides add the same key with identical text -> clean", () => {
    const r = runMerge(loc({}), loc({ C: "hi" }), loc({ C: "hi" }));
    expect(r.conflicts).toEqual([]);
    expect(r.merged.strings).toEqual({ C: "hi" });
  });
  it("both sides change the same key differently -> conflict, provisional OURS", () => {
    const r = runMerge(loc({ A: "a" }), loc({ A: "ours" }), loc({ A: "theirs" }));
    expect(paths(r)).toEqual(["strings.A:both-changed"]);
    expect(r.merged.strings).toEqual({ A: "ours" });
  });
  it("delete-vs-edit -> conflict; both-delete -> clean", () => {
    const del = runMerge(loc({ A: "a" }), loc({}), loc({ A: "edited" }));
    expect(paths(del)).toEqual(["strings.A:delete-vs-edit"]);
    expect(del.merged.strings).toEqual({}); // provisional OURS (deleted)
    const both = runMerge(loc({ A: "a" }), loc({}), loc({}));
    expect(both.conflicts).toEqual([]);
    expect(both.merged.strings).toEqual({});
  });
});

describe("authoring (.patterx) merge", () => {
  it("comments union by id (immutable, append-only) - never conflicts", () => {
    const r = runMerge(
      authoring({ comments: [{ id: "c0", ts: "2026-01-01", body: "base" }] }),
      authoring({ comments: [{ id: "c0", ts: "2026-01-01", body: "base" }, { id: "c1", ts: "2026-02-01", body: "ours" }] }),
      authoring({ comments: [{ id: "c0", ts: "2026-01-01", body: "base" }, { id: "c2", ts: "2026-03-01", body: "theirs" }] }),
    );
    expect(r.conflicts).toEqual([]);
    expect((r.merged.comments as Array<{ id: string }>).map((c) => c.id)).toEqual(["c0", "c1", "c2"]); // sorted by ts
  });

  it("writing status: last-writer-wins by each side's edit timestamp", () => {
    const base = authoring({ writing: { L1: "draft 1" }, edits: { L1: { modifiedAt: "2026-01-01T00:00:00Z" } } });
    const ours = authoring({ writing: { L1: "final" }, edits: { L1: { modifiedAt: "2026-03-01T00:00:00Z" } } });   // newer
    const theirs = authoring({ writing: { L1: "draft 2" }, edits: { L1: { modifiedAt: "2026-02-01T00:00:00Z" } } });
    const r = runMerge(base, ours, theirs);
    expect(r.conflicts).toEqual([]);
    expect(r.merged.writing).toEqual({ L1: "final" }); // ours is newer
  });

  it("writing status changed both sides with NO timestamp -> conflict", () => {
    const r = runMerge(
      authoring({ writing: { L1: "draft 1" } }),
      authoring({ writing: { L1: "final" } }),
      authoring({ writing: { L1: "edited" } }),
    );
    expect(paths(r)).toEqual(["writing.L1:no-timestamp"]);
    expect(r.merged.writing).toEqual({ L1: "final" }); // provisional OURS
  });

  it("edits: newer record wins, localisedAt merges per-locale by max", () => {
    const base = authoring({ edits: { L1: { modifiedAt: "2026-01-01T00:00:00Z", localisedAt: { fr: "2026-01-01" } } } });
    const ours = authoring({ edits: { L1: { modifiedAt: "2026-03-01T00:00:00Z", by: "ian", localisedAt: { fr: "2026-02-01" } } } });
    const theirs = authoring({ edits: { L1: { modifiedAt: "2026-02-01T00:00:00Z", localisedAt: { fr: "2026-01-15", de: "2026-02-20" } } } });
    const r = runMerge(base, ours, theirs);
    expect(r.conflicts).toEqual([]);
    expect(r.merged.edits).toEqual({
      L1: { modifiedAt: "2026-03-01T00:00:00Z", by: "ian", localisedAt: { fr: "2026-02-01", de: "2026-02-20" } },
    });
  });

  it("documentation is content: both-changed -> conflict", () => {
    const r = runMerge(
      authoring({ documentation: { L1: [{ type: "vo", text: "base" }] } }),
      authoring({ documentation: { L1: [{ type: "vo", text: "ours" }] } }),
      authoring({ documentation: { L1: [{ type: "vo", text: "theirs" }] } }),
    );
    expect(paths(r)).toEqual(["documentation.L1:both-changed"]);
  });

  it("cut merges per-key (both sides' flags land)", () => {
    const r = runMerge(
      authoring({}),
      authoring({ cut: { s3: true } }),
      authoring({ cut: { s4: true } }),
    );
    expect(r.conflicts).toEqual([]);
    expect(r.merged.cut).toEqual({ s3: true, s4: true });
  });
});

describe("flow (.patterflow) tree merge", () => {
  it("merges different fields of the same node independently", () => {
    const base = one([sn("x", { choiceText: "CT", jump: { to: "END" } })]);
    const ours = one([sn("x", { choiceText: "CT2", jump: { to: "END" } })]);
    const theirs = one([sn("x", { choiceText: "CT", jump: { to: "OTHER" } })]);
    const r = runMerge(base, ours, theirs);
    expect(r.conflicts).toEqual([]);
    const node = (r.merged as any).scene.blocks[0].children[0];
    expect(node).toMatchObject({ choiceText: "CT2", jump: { to: "OTHER" } });
  });

  it("same-field edits on the same node -> conflict (provisional OURS)", () => {
    const r = runMerge(one([sn("x", { choiceText: "base" })]), one([sn("x", { choiceText: "ours" })]), one([sn("x", { choiceText: "theirs" })]));
    expect(r.conflicts.map((c) => c.kind)).toEqual(["both-changed"]);
    expect((r.merged as any).scene.blocks[0].children[0].choiceText).toBe("ours");
  });

  it("inserts at different anchors -> both applied, in order", () => {
    const base = one([sn("a"), sn("b")]);
    const ours = one([sn("a"), sn("x"), sn("b")]);
    const theirs = one([sn("a"), sn("b"), sn("y")]);
    const r = runMerge(base, ours, theirs);
    expect(r.conflicts).toEqual([]);
    expect(kids(r)).toEqual(["a", "x", "b", "y"]);
  });

  it("inserts at the SAME anchor -> both kept ours-then-theirs, with a warning (not a conflict)", () => {
    const base = one([sn("a")]);
    const ours = one([sn("a"), sn("x")]);
    const theirs = one([sn("a"), sn("y")]);
    const r = runMerge(base, ours, theirs);
    expect(r.conflicts).toEqual([]);
    expect(kids(r)).toEqual(["a", "x", "y"]);
    expect(r.warnings).toHaveLength(1);
  });

  it("delete vs unchanged -> clean delete; delete vs edit -> conflict", () => {
    const clean = runMerge(one([sn("a"), sn("b")]), one([sn("a")]), one([sn("a"), sn("b")]));
    expect(clean.conflicts).toEqual([]);
    expect(kids(clean)).toEqual(["a"]);

    // ours edits, theirs deletes -> conflict, provisional OURS keeps the (edited) node
    const conflict = runMerge(one([sn("a", { choiceText: "v0" })]), one([sn("a", { choiceText: "v1" })]), one([]));
    expect(conflict.conflicts.map((c) => c.kind)).toEqual(["delete-vs-edit"]);
    expect(kids(conflict)).toEqual(["a"]);
  });

  it("one-sided reorder is clean; both reorder differently -> 'moved' conflict", () => {
    const clean = runMerge(one([sn("a"), sn("b"), sn("c")]), one([sn("c"), sn("b"), sn("a")]), one([sn("a"), sn("b"), sn("c")]));
    expect(clean.conflicts).toEqual([]);
    expect(kids(clean)).toEqual(["c", "b", "a"]);

    const moved = runMerge(one([sn("a"), sn("b"), sn("c")]), one([sn("b"), sn("a"), sn("c")]), one([sn("a"), sn("c"), sn("b")]));
    expect(moved.conflicts.map((c) => c.kind)).toEqual(["moved"]);
  });

  it("a cross-block duplicate id is caught post-merge as a structural conflict", () => {
    const base = scene([block("b1", [sn("a")]), block("b2", [sn("b")])]);
    const ours = scene([block("b1", [sn("a"), sn("dup")]), block("b2", [sn("b")])]);
    const theirs = scene([block("b1", [sn("a")]), block("b2", [sn("b"), sn("dup")])]);
    const r = runMerge(base, ours, theirs);
    expect(r.conflicts.some((c) => c.kind === "structural" && c.id === "dup")).toBe(true);
  });
});

describe("project (.patterproj) merge", () => {
  it("field-level 3-way (one side flips voiced)", () => {
    const r = runMerge(proj({ voiced: false }), proj({ voiced: true }), proj({ voiced: false }));
    expect(r.conflicts).toEqual([]);
    expect((r.merged as any).voiced).toBe(true);
  });

  it("properties keyed by name: union clean; same name changed both sides -> conflict", () => {
    const base = proj({ properties: [{ name: "hp", type: "number" }] });
    const add = runMerge(base, proj({ properties: [{ name: "hp", type: "number" }, { name: "gold", type: "number" }] }),
      proj({ properties: [{ name: "hp", type: "number" }, { name: "flag", type: "boolean" }] }));
    expect(add.conflicts).toEqual([]);
    expect((add.merged as any).properties.map((p: any) => p.name)).toEqual(["flag", "gold", "hp"]);

    const conflict = runMerge(base, proj({ properties: [{ name: "hp", type: "string" }] }), proj({ properties: [{ name: "hp", type: "boolean" }] }));
    expect(paths(conflict)).toEqual(["properties.hp:both-changed"]);
  });

  it("locales: all is a set union; default is a scalar 3-way", () => {
    const r = runMerge(proj({ locales: { default: "en", all: ["en"] } }),
      proj({ locales: { default: "en", all: ["en", "fr"] } }),
      proj({ locales: { default: "en", all: ["en", "de"] } }));
    expect(r.conflicts).toEqual([]);
    expect((r.merged as any).locales.all).toEqual(["en", "fr", "de"]);
  });
});
