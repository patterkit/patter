import { describe, it, expect } from "vitest";
import {
  newId, slug, hash4, parseSource, canonicalStringify, validateProject,
} from "@patterkit/core";
import type { ProjectFile, Scene, AuthoringFile, Group, Snippet } from "@patterkit/model";

// --- fixtures ---------------------------------------------------------------

function project(): ProjectFile {
  return {
    schema: "patter/project@0",
    project: { id: "proj_1", name: "Test" },
    locales: { default: "en", all: ["en"] },
    cast: [{ name: "BARKEEP" }, { name: "PLAYER" }],
    start: { scene: "scn_1" },
  };
}

function scene(): Scene {
  return {
    id: "scn_1", type: "scene", name: "Tavern Intro",
    blocks: [
      { id: "blk_intro", type: "block", name: "Intro", children: [
        { id: "sn_hello", type: "snippet", beats: [{ id: "L_1", kind: "line", character: "BARKEEP" }] },
        { id: "grp_choice", type: "group", selector: "choice", children: [
          // Sticky: the Job block jumps back here, so a once-only option would leave the choice to run dry.
          { id: "opt_a", type: "snippet", sticky: true, beats: [{ id: "L_2", kind: "line", character: "PLAYER" }], jump: { to: "blk_job" } },
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

  it("warns when no start scene is set, or the start names one that has gone (the hands-on review, 2026-10)", () => {
    const { start: _, ...noStart } = project();
    expect(validateProject({ project: noStart, scenes: [scene()] }).map((i) => [i.code, i.severity])).toEqual([["no-start", "warning"]]);
    expect(validateProject({ project: { ...project(), start: { scene: "scn_gone" } }, scenes: [scene()] }).map((i) => i.code)).toEqual(["dangling-start"]);
    expect(validateProject({ project: { ...project(), start: { scene: "scn_1", block: "blk_gone" } }, scenes: [scene()] }).map((i) => i.code)).toEqual(["dangling-start"]);
    expect(validateProject({ project: noStart, scenes: [] })).toEqual([]); // nothing to start
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
    // In place of the block's own jump back: a snippet after that one would never run (unreachable-after-jump).
    s.blocks[1]!.children.splice(1, 1, { id: "dv_end", type: "snippet", jump: { to: "END" } });
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

  /** The dry-choice issue for choice `g`, as [code, severity], or undefined when there is none. */
  const dry = (...scenes: Scene[]): [string, string | undefined] | undefined => {
    const i = validateProject({ project: project(), scenes }).find((x) => x.id === "g" && (x.code === "choice-ends-dry" || x.code === "choice-can-empty"));
    return i ? [i.code, i.severity] : undefined;
  };

  it("warns (choice-ends-dry) when a re-enterable choice is all once-only with no fallback, and nothing follows it", () => {
    expect(dry(hub([{}, {}]))).toEqual(["choice-ends-dry", "warning"]);
  });
  it("does NOT warn when a sticky option keeps the loop alive", () => {
    expect(dry(hub([{}, { sticky: true }]))).toBeUndefined();
  });
  it("does NOT warn when a fallback covers the loop", () => {
    expect(dry(hub([{}, { fallback: true }]))).toBeUndefined();
  });
  it("does NOT warn when the choice jumps AWAY (not re-enterable)", () => {
    // The base scene's choice option jumps to blk_job, which here ends rather than coming back.
    const s = scene();
    delete (s.blocks[0]!.children[1] as Group).children![0]!.sticky;
    s.blocks[1]!.children[1] = { id: "dv_back", type: "snippet", jump: { to: "END" } };
    expect(dry(s)).toBeUndefined();
  });
  it("errors (multiple-fallbacks) on more than one fallback in a choice", () => {
    expect(codes(hub([{ fallback: true }, { fallback: true }]))).toContain("multiple-fallbacks");
  });

  // --- re-entry round other blocks, and what follows a dry choice (Ian's rulings, 2026-10-30) ------------
  /** A hub whose options jump to a hall, and a hall that jumps back to the hub: re-entered, but not directly. */
  const roundTheHall = (after: Array<Group | Snippet> = []): Scene => ({
    id: "scn", type: "scene", name: "Hub", blocks: [
      { id: "hub", type: "block", name: "Hub", children: [
        { id: "g", type: "group", selector: "choice", children: [0, 1].map((i) => ({
          id: `o${i}`, type: "group", prompt: { id: `C${i}`, kind: "text" },
          children: [{ id: `o${i}c`, type: "snippet", jump: { to: "hall" } }],
        })) },
        ...after,
      ] },
      { id: "hall", type: "block", name: "Hall", children: [
        { id: "h1", type: "snippet", beats: [{ id: "H1", kind: "text" }], jump: { to: "hub" } },
      ] },
    ],
  });
  it("finds a hub re-entered round another block (options jump to a hall, the hall jumps back)", () => {
    expect(dry(roundTheHall())).toEqual(["choice-ends-dry", "warning"]);
  });
  it("finds a hub re-entered round another scene's first block", () => {
    const s = roundTheHall();
    s.blocks[1]!.children[0] = { id: "h1", type: "snippet", jump: { to: "scn2" } };
    const other: Scene = { id: "scn2", type: "scene", name: "Other", blocks: [
      { id: "far", type: "block", name: "Far", children: [{ id: "f1", type: "snippet", beats: [{ id: "F1", kind: "text" }], jump: { to: "hub" } }] },
    ] };
    expect(dry(s, other)).toEqual(["choice-ends-dry", "warning"]);
  });
  it("finds a hub whose options carry on and the block jumps back to itself after the choice", () => {
    const s: Scene = { id: "scn", type: "scene", name: "Hub", blocks: [
      { id: "hub", type: "block", name: "Hub", children: [
        { id: "g", type: "group", selector: "choice", children: [0, 1].map((i) => ({
          id: `o${i}`, type: "group", prompt: { id: `C${i}`, kind: "text" },
          children: [{ id: `o${i}c`, type: "snippet", beats: [{ id: `B${i}`, kind: "text" }] }],
        })) },
        { id: "back", type: "snippet", beats: [{ id: "BK", kind: "text" }], jump: { to: "hub" } },
      ] },
    ] };
    // Something follows the choice, so running dry carries on: a note, not a warning.
    expect(dry(s)).toEqual(["choice-can-empty", "info"]);
  });
  it("notes (choice-can-empty, info) a dry choice with something after it in the block", () => {
    expect(dry(roundTheHall([{ id: "next", type: "snippet", beats: [{ id: "N", kind: "text" }] }]))).toEqual(["choice-can-empty", "info"]);
  });
  it("still warns when all that follows is a bare jump to END: the dialogue ends because the choice ran dry", () => {
    expect(dry(roundTheHall([{ id: "end", type: "snippet", jump: { to: "END" } }]))).toEqual(["choice-ends-dry", "warning"]);
  });
  it("notes, rather than warns, where the block is only ever called: it returns to its caller", () => {
    const s = roundTheHall();
    const caller: Scene = { id: "scn0", type: "scene", name: "Start", blocks: [
      { id: "start", type: "block", name: "Start", children: [
        { id: "c", type: "snippet", jump: { to: "hub", mode: "call" } },
        { id: "after", type: "snippet", beats: [{ id: "A", kind: "text" }] },
      ] },
    ] };
    s.blocks[1]!.children[0] = { id: "h1", type: "snippet", beats: [{ id: "H1", kind: "text" }], jump: { to: "hub", mode: "call" } };
    expect(dry(caller, s)).toEqual(["choice-can-empty", "info"]);
  });
  it("leaves out a choice inside a once-only option of another choice: it plays at most once", () => {
    const s = roundTheHall();
    const inner = s.blocks[0]!.children[0] as Group;
    s.blocks[0]!.children[0] = { id: "outer", type: "group", selector: "choice", children: [
      { id: "oo", type: "group", prompt: { id: "OO", kind: "text" }, children: [inner, { id: "oj", type: "snippet", jump: { to: "hub" } }] },
      { id: "os", type: "group", sticky: true, prompt: { id: "OS", kind: "text" }, children: [{ id: "osj", type: "snippet", jump: { to: "hub" } }] },
    ] } as Group;
    expect(dry(s)).toBeUndefined();
    // Made sticky, the outer option can bring play back to the inner choice, which then empties.
    (s.blocks[0]!.children[0] as Group).children![0]!.sticky = true;
    expect(dry(s)).toEqual(["choice-can-empty", "info"]);
  });
  it("does not count a sibling beside an option, or beside a branch, as following the choice", () => {
    const s = roundTheHall();
    // Wrap the choice in a branch with a second branch child: that child never plays after the choice.
    const choice = s.blocks[0]!.children[0]!;
    s.blocks[0]!.children[0] = { id: "br", type: "group", selector: "branch", children: [
      { id: "br1", type: "group", condition: "@world.a", children: [choice] },
      { id: "br2", type: "snippet", beats: [{ id: "X", kind: "text" }] },
    ] } as Group;
    expect(dry(s)).toEqual(["choice-ends-dry", "warning"]);
  });

  // --- dry choice: no guaranteed path (every option conditional, no unconditional fallback) --------------
  /** A NON-re-enterable choice (options jump to END) with per-option {condition, fallback}. Isolates the
   *  "all conditions fail" dry path from the re-entrant-exhaustion one (the options never loop back). */
  const gated = (opts: Array<Partial<{ condition: string; fallback: boolean }>>, after: Array<Group | Snippet> = []): Scene => ({
    id: "scn", type: "scene", name: "Gate", blocks: [
      { id: "blk", type: "block", name: "B", children: [
        { id: "g", type: "group", selector: "choice", children: opts.map((o, i) => ({
          id: `o${i}`, type: "group", prompt: { id: `C${i}`, kind: "text" }, condition: o.condition, fallback: o.fallback,
          children: [{ id: `o${i}c`, type: "snippet", jump: { to: "END" } }],
        })) },
        ...after,
      ] },
    ],
  });

  it("warns (choice-ends-dry) when every option is conditional, there is no fallback, and nothing follows", () => {
    expect(dry(gated([{ condition: "@world.a" }, { condition: "@world.b" }]))).toEqual(["choice-ends-dry", "warning"]);
  });
  it("notes (choice-can-empty) the same choice with something after it", () => {
    expect(dry(gated([{ condition: "@world.a" }, { condition: "@world.b" }], [{ id: "n", type: "snippet", beats: [{ id: "N", kind: "text" }] }])))
      .toEqual(["choice-can-empty", "info"]);
  });
  it("does NOT warn when at least one option is unconditional", () => {
    expect(dry(gated([{ condition: "@world.a" }, {}]))).toBeUndefined();
  });
  it("still warns when the only fallback is ITSELF conditional (it can fail too)", () => {
    expect(dry(gated([{ condition: "@world.a" }, { condition: "@world.b", fallback: true }]))).toEqual(["choice-ends-dry", "warning"]);
  });
  it("does NOT warn when an unconditional fallback guarantees an escape", () => {
    expect(dry(gated([{ condition: "@world.a" }, { fallback: true }]))).toBeUndefined();
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

  it("IGNORES per-beat metadata on an orphaned id (deleting a beat leaves harmless residue)", () => {
    // writing + recording + cut + a documentation note, all keyed on a beat that no longer exists.
    const authoring: AuthoringFile[] = [{ schema: "patter/authoring@0",
      writing: { nope_xyz: "final" }, recording: { nope_xyz: "recorded" }, cut: { nope_xyz: true },
      documentation: { nope_xyz: [{ type: "loc", text: "no loc" }] } }];
    // None of it is flagged - the project still validates clean (so `patter validate` stays green and
    // Patterpad's problems bar doesn't show an unnavigable "set on unknown id" error).
    expect(validateProject({ project: project(), scenes: [scene()], authoring })).toEqual([]);
  });

  it("still flags a status value not in the ladder on a LIVE beat", () => {
    const authoring: AuthoringFile[] = [{ schema: "patter/authoring@0", writing: { L_1: "nonesuch" } }];
    expect(validateProject({ project: project(), scenes: [scene()], authoring }).map((i) => i.code)).toContain("invalid-status-value");
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
