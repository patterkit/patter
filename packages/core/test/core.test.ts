import { describe, it, expect } from "vitest";
import {
  newId, slug, hash4, parseSource, canonicalStringify, validateProject,
} from "@patterkit/core";
import type { ProjectFile, Scene, AuthoringFile } from "@patterkit/model";

// --- fixtures ---------------------------------------------------------------

function project(): ProjectFile {
  return {
    schema: "patter/project@0",
    project: { id: "proj_1", name: "Test" },
    locales: { default: "en", all: ["en"] },
    cast: [{ name: "BARKEEP" }, { name: "PLAYER" }],
  };
}

function scene(): Scene {
  return {
    id: "scn_1", type: "scene", name: "Tavern Intro",
    blocks: [
      { id: "blk_intro", type: "block", name: "Intro", children: [
        { id: "sn_hello", type: "snippet", beats: [{ id: "L_1", kind: "line", character: "BARKEEP" }] },
        { id: "grp_choice", type: "group", selector: "choice", children: [
          { id: "opt_a", type: "snippet", beats: [{ id: "L_2", kind: "line", character: "PLAYER" }], jump: { to: "blk_job" } },
        ] },
      ] },
      { id: "blk_job", type: "block", name: "Job", children: [
        { id: "sn_brief", type: "snippet", beats: [{ id: "L_3", kind: "line", character: "BARKEEP" }] },
        { id: "dv_back", type: "snippet", jump: { to: "blk_intro" } },
      ] },
    ],
  };
}

const codes = (s: Scene, p: ProjectFile = project()) => validateProject({ project: p, scenes: [s] }).map((i) => i.code);

// --- ids --------------------------------------------------------------------

describe("newId", () => {
  it("produces a prefixed opaque token", () => {
    expect(newId("scn")).toMatch(/^scn_[0-9a-z]{8}$/);
    expect(newId()).toMatch(/^[0-9a-z]{8}$/);
  });
  it("is (practically) unique", () => {
    const set = new Set(Array.from({ length: 1000 }, () => newId("x")));
    expect(set.size).toBe(1000);
  });
});

// --- handles ----------------------------------------------------------------

describe("handles", () => {
  it("slugifies names", () => {
    expect(slug("Tavern Intro!")).toBe("tavern_intro");
    expect(slug("  Job  Briefing  ")).toBe("job_briefing");
  });
  it("hash4 is deterministic and 4 chars", () => {
    expect(hash4("sn_abc")).toBe(hash4("sn_abc"));
    expect(hash4("sn_abc")).toHaveLength(4);
    expect(hash4("sn_abc")).not.toBe(hash4("sn_abd"));
  });
});

// --- serialisation ----------------------------------------------------------

describe("canonical (de)serialisation", () => {
  it("sorts keys, indents, ends with a newline, trailing commas (source form), deterministic", () => {
    const out = canonicalStringify({ b: 1, a: { d: 2, c: 3 } });
    expect(out).toBe('{\n  "a": {\n    "c": 3,\n    "d": 2,\n  },\n  "b": 1,\n}\n'); // F1: trailing commas
    expect(canonicalStringify({ a: { c: 3, d: 2 }, b: 1 })).toBe(out); // key order irrelevant
  });
  it("arrays also get a trailing comma; empties stay []/{}", () => {
    expect(canonicalStringify({ xs: [1, 2], e: [], o: {} }))
      .toBe('{\n  "e": [],\n  "o": {},\n  "xs": [\n    1,\n    2,\n  ],\n}\n');
  });
  it("trailingComma:false emits STRICT JSON (the compiled-bundle mode)", () => {
    const out = canonicalStringify({ b: 1, a: { d: 2, c: 3 } }, { trailingComma: false });
    expect(out).toBe('{\n  "a": {\n    "c": 3,\n    "d": 2\n  },\n  "b": 1\n}\n');
    expect(() => JSON.parse(out)).not.toThrow(); // a stock JSON parser accepts it
  });
  it("round-trips through parseSource (both modes)", () => {
    const value = { scene: { id: "scn_1", blocks: [{ id: "b", name: "B" }] }, n: 3, ok: true };
    expect(parseSource(canonicalStringify(value))).toEqual(value); // trailing-comma form is valid JSON5
    expect(parseSource(canonicalStringify(value, { trailingComma: false }))).toEqual(value);
  });
  it("parses JSON5 (comments, trailing commas) and tolerates a BOM", () => {
    expect(parseSource("{ a: 1, /* note */ b: 2, }")).toEqual({ a: 1, b: 2 });
    expect(parseSource("﻿{\"a\":1}")).toEqual({ a: 1 });
  });
});

// --- structural validator ---------------------------------------------------

describe("validateProject", () => {
  it("accepts a valid project", () => {
    expect(validateProject({ project: project(), scenes: [scene()] })).toEqual([]);
  });

  it("flags a duplicate id", () => {
    const s = scene();
    s.blocks[0]!.children.push({ id: "L_1", type: "snippet", beats: [{ id: "x1", kind: "gameEvent" }] });
    expect(codes(s)).toContain("duplicate-id");
  });

  it("flags a missing scene/block name", () => {
    const s = scene();
    s.blocks[0]!.name = "  ";
    expect(codes(s)).toContain("missing-name");
  });

  it("flags an empty snippet (no beats, no jump)", () => {
    const s = scene();
    s.blocks[1]!.children.push({ id: "sn_empty", type: "snippet" });
    expect(codes(s)).toContain("empty-snippet");
  });

  it("flags an empty block (no children)", () => {
    const s = scene();
    s.blocks.push({ id: "blk_empty", type: "block", name: "Empty", children: [] });
    expect(codes(s)).toContain("empty-container");
  });

  it("flags an empty group / choice option (no children)", () => {
    const s = scene();
    s.blocks[0]!.children.push({ id: "grp_empty", type: "group", selector: "sequence", children: [] });
    expect(codes(s)).toContain("empty-container");
  });

  it("names the GROUP, not its placeholder bubble, when a group holds only an empty bubble", () => {
    // The surface seeds a freshly-made group with a beat-less 'click to add' bubble. The writer sees
    // an empty group, so the validation must name the group (empty-container), never the near-invisible
    // inner snippet (empty-snippet). blk_job is otherwise non-empty, so the group is the outermost empty.
    const s = scene();
    s.blocks[1]!.children.push({ id: "grp_seq", type: "group", selector: "sequence", children: [
      { id: "sn_ph", type: "snippet", beats: [] },
    ] });
    const issues = validateProject({ project: project(), scenes: [s] });
    const empties = issues.filter((i) => i.code === "empty-container" || i.code === "empty-snippet");
    expect(empties).toEqual([{ code: "empty-container", message: expect.stringContaining("grp_seq"), id: "grp_seq" }]);
  });

  it("names the SECTION, not its inner placeholders, when a whole block is empty", () => {
    // A trailing section the writer started but left empty (a stray bubble + an empty group). One clean
    // 'this is empty' on the section - no snippet wording, no per-placeholder noise.
    const s = scene();
    s.blocks.push({ id: "blk_new", type: "block", name: "New section", children: [
      { id: "sn_stray", type: "snippet" },
      { id: "grp_ph", type: "group", selector: "sequence", children: [{ id: "sn_ph", type: "snippet", beats: [] }] },
    ] });
    const empties = validateProject({ project: project(), scenes: [s] })
      .filter((i) => i.code === "empty-container" || i.code === "empty-snippet");
    expect(empties).toEqual([{ code: "empty-container", message: expect.stringContaining("blk_new"), id: "blk_new" }]);
  });

  it("still flags a genuinely lone empty bubble in an otherwise-filled block", () => {
    const s = scene();
    s.blocks[1]!.children.push({ id: "sn_lone", type: "snippet" });
    const empties = validateProject({ project: project(), scenes: [s] }).filter((i) => i.code === "empty-snippet");
    expect(empties).toEqual([{ code: "empty-snippet", message: expect.stringContaining("sn_lone"), id: "sn_lone" }]);
  });

  it("flags a dangling jump", () => {
    const s = scene();
    s.blocks[1]!.children.push({ id: "dv_bad", type: "snippet", jump: { to: "blk_nope" } });
    expect(codes(s)).toContain("dangling-jump");
  });

  it("flags a jump into a non-addressable node", () => {
    const s = scene();
    s.blocks[1]!.children.push({ id: "dv_into", type: "snippet", jump: { to: "sn_hello" } });
    expect(codes(s)).toContain("jump-into-non-addressable");
  });

  it("allows a jump to END", () => {
    const s = scene();
    s.blocks[1]!.children.push({ id: "dv_end", type: "snippet", jump: { to: "END" } });
    expect(validateProject({ project: project(), scenes: [s] })).toEqual([]);
  });

  // --- sticky / fallback choice options (spec §5) ---------------------------
  /** A hub block whose single choice option jumps back to the hub (re-enterable), with per-option overrides. */
  const hub = (opts: Array<Partial<{ sticky: boolean; fallback: boolean }>>): Scene => ({
    id: "scn", type: "scene", name: "Hub", blocks: [
      { id: "hub", type: "block", name: "Hub", children: [
        { id: "g", type: "group", selector: "choice", children: opts.map((o, i) => ({
          id: `o${i}`, type: "group", prompt: { id: `C${i}`, kind: "text" }, sticky: o.sticky, fallback: o.fallback,
          children: [{ id: `o${i}c`, type: "snippet", jump: { to: "hub" } }],
        })) },
      ] },
    ],
  });

  it("warns (choice-can-empty) when a re-enterable choice is all once-only with no fallback", () => {
    expect(codes(hub([{}, {}]))).toContain("choice-can-empty");
  });
  it("does NOT warn when a sticky option keeps the loop alive", () => {
    expect(codes(hub([{}, { sticky: true }]))).not.toContain("choice-can-empty");
  });
  it("does NOT warn when a fallback covers the loop", () => {
    expect(codes(hub([{}, { fallback: true }]))).not.toContain("choice-can-empty");
  });
  it("does NOT warn when the choice jumps AWAY (not re-enterable)", () => {
    // The base scene's choice option jumps to blk_job, never back to its own block.
    expect(codes(scene())).not.toContain("choice-can-empty");
  });
  it("errors (multiple-fallbacks) on more than one fallback in a choice", () => {
    expect(codes(hub([{ fallback: true }, { fallback: true }]))).toContain("multiple-fallbacks");
  });

  // --- dry choice: no guaranteed path (every option conditional, no unconditional fallback) --------------
  /** A NON-re-enterable choice (options jump to END) with per-option {condition, fallback}. Isolates the
   *  "all conditions fail" dry path from the re-entrant-exhaustion one (the options never loop back). */
  const gated = (opts: Array<Partial<{ condition: string; fallback: boolean }>>): Scene => ({
    id: "scn", type: "scene", name: "Gate", blocks: [
      { id: "blk", type: "block", name: "B", children: [
        { id: "g", type: "group", selector: "choice", children: opts.map((o, i) => ({
          id: `o${i}`, type: "group", prompt: { id: `C${i}`, kind: "text" }, condition: o.condition, fallback: o.fallback,
          children: [{ id: `o${i}c`, type: "snippet", jump: { to: "END" } }],
        })) },
      ] },
    ],
  });

  it("warns (choice-can-empty) when every option is conditional and there is no fallback", () => {
    expect(codes(gated([{ condition: "@world.a" }, { condition: "@world.b" }]))).toContain("choice-can-empty");
  });
  it("does NOT warn when at least one option is unconditional", () => {
    expect(codes(gated([{ condition: "@world.a" }, {}]))).not.toContain("choice-can-empty");
  });
  it("still warns when the only fallback is ITSELF conditional (it can fail too)", () => {
    expect(codes(gated([{ condition: "@world.a" }, { condition: "@world.b", fallback: true }]))).toContain("choice-can-empty");
  });
  it("does NOT warn when an unconditional fallback guarantees an escape", () => {
    expect(codes(gated([{ condition: "@world.a" }, { fallback: true }]))).not.toContain("choice-can-empty");
  });

  it("flags a speaker not in the cast", () => {
    const s = scene();
    s.blocks[0]!.children.push({ id: "sn_ghost", type: "snippet", beats: [{ id: "L_g", kind: "line", character: "GHOST" }] });
    expect(codes(s)).toContain("unknown-character");
  });

  // --- authoring status on a choice option's prompt beat (regression) -------
  // The prompt IS a real line/text beat (the choice text), so writing/recording status can target it -
  // setting a whole scene to "final" stamps the prompts too. They were once rejected as an "unknown id".
  it("accepts a writing status set on a choice option's prompt beat", () => {
    const s: Scene = {
      id: "scn_1", type: "scene", name: "S",
      blocks: [{ id: "blk_1", type: "block", name: "B", children: [
        { id: "g", type: "group", selector: "choice", children: [
          { id: "opt_a", type: "group", prompt: { id: "P_a", kind: "text" }, children: [
            { id: "sn_a", type: "snippet", beats: [{ id: "L_a", kind: "line", character: "BARKEEP" }], jump: { to: "END" } },
          ] },
        ] },
      ] }],
    };
    const authoring: AuthoringFile[] = [{ schema: "patter/authoring@0", writing: { P_a: "final", L_a: "final" } }];
    expect(validateProject({ project: project(), scenes: [s], authoring })).toEqual([]);
  });

  it("still flags a writing status set on a genuinely unknown id", () => {
    const authoring: AuthoringFile[] = [{ schema: "patter/authoring@0", writing: { nope_xyz: "final" } }];
    expect(validateProject({ project: project(), scenes: [scene()], authoring }).map((i) => i.code)).toContain("unknown-status-id");
  });

  // --- mixed beat kinds in a scene (spec §2) ---

  it("accepts a scene mixing line, text, and game-event beats", () => {
    const s = scene();
    s.blocks[0]!.children.push({
      id: "sn_mix", type: "snippet", beats: [
        { id: "T_n", kind: "text" },                               // narration
        { id: "L_n", kind: "line", character: "BARKEEP" },         // spoken
        { id: "A_n", kind: "gameEvent", gameData: { cue: "slam" } },  // engine instruction
      ],
    });
    expect(validateProject({ project: project(), scenes: [s] })).toEqual([]);
  });

  // --- `temporary` only on a per-flow @scene prop (spec §7) ---

  it("accepts temporary on a per-flow scene prop", () => {
    const s = scene();
    s.sceneProps = [{ name: "scratch", type: "number", default: 0, temporary: true }];
    expect(validateProject({ project: project(), scenes: [s] })).toEqual([]);
  });

  it("flags temporary combined with shared on a scene prop", () => {
    const s = scene();
    s.sceneProps = [{ name: "scratch", type: "number", default: 0, temporary: true, shared: true }];
    expect(codes(s)).toContain("invalid-temporary");
  });

  it("flags temporary on a global property", () => {
    const p = project();
    p.properties = [{ name: "scratch", type: "number", default: 0, temporary: true }];
    expect(validateProject({ project: p, scenes: [scene()] }).map((i) => i.code)).toContain("invalid-temporary");
  });
});
