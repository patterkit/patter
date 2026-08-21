// ---------------------------------------------------------------------------
// Cast introspection: engine.getCast() (what the project declares) and
// engine.castForScene / castForBlock (who actually speaks in a scope).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import type { ProjectFile, Scene, LocaleFile } from "@patterkit/model";

// Declaration order is deliberately NOT the order anyone speaks in, so the two APIs cannot pass by
// accident: getCast reports this list, castForScene reports document order.
const project: ProjectFile = {
  schema: "patter/project@0",
  project: { id: "h", name: "H" },
  locales: { default: "en", all: ["en"] },
  cast: [
    { name: "ANNA", displayName: "Anna" },
    { name: "BARD" },
    { name: "COOK" },
    { name: "GUARD", displayName: "The Guard" },
    { name: "SFX" },
  ],
};

// b1: a snippet (GUARD, a narration beat, ANNA, GUARD again), then a choice whose first option is
// PROMPTED by SFX and whose content is spoken by COOK, behind a condition.
// b2: ANNA again (already seen) plus BARD.
const scene: Scene = {
  id: "s1", type: "scene", name: "Opening", gameId: "opening",
  blocks: [
    {
      id: "b1", type: "block", name: "Intro", gameId: "intro", children: [
        { id: "sn1", type: "snippet", beats: [
          { id: "L1", kind: "line", character: "GUARD" },
          { id: "T1", kind: "text" },
          { id: "L2", kind: "line", character: "ANNA" },
          { id: "L3", kind: "line", character: "GUARD" },
        ] },
        { id: "g1", type: "group", selector: "choice", children: [
          { id: "o1", type: "group", condition: "true", prompt: { id: "P1", kind: "line", character: "SFX" }, children: [
            { id: "sn2", type: "snippet", beats: [{ id: "L4", kind: "line", character: "COOK" }], jump: { to: "END" } },
          ] },
          { id: "o2", type: "group", prompt: { id: "P2", kind: "text" }, children: [
            { id: "sn3", type: "snippet", beats: [{ id: "T2", kind: "text" }], jump: { to: "END" } },
          ] },
        ] },
      ],
    },
    {
      id: "b2", type: "block", name: "Outro", children: [
        { id: "sn4", type: "snippet", beats: [
          { id: "L5", kind: "line", character: "ANNA" },
          { id: "L6", kind: "line", character: "BARD" },
        ], jump: { to: "END" } },
      ],
    },
  ],
};

// A scene with narration only: no cast at all.
const silent: Scene = {
  id: "s2", type: "scene", name: "Silent",
  blocks: [{ id: "b3", type: "block", name: "Only", children: [
    { id: "sn5", type: "snippet", beats: [{ id: "T3", kind: "text" }], jump: { to: "END" } },
  ] }],
};

const en: LocaleFile = {
  schema: "patter/strings@0", scene: "s1", locale: "en",
  strings: { L1: "Halt!", T1: "The gate creaks.", L2: "Let me pass.", L3: "No.", L4: "Stew?", L5: "Again?", L6: "A song!", P1: "[a knock]", P2: "Say nothing", T2: "Silence." },
};
const bundle = exportBundle({ project, scenes: [scene, silent], locales: [en] });
const engine = () => new Engine(bundle);

describe("engine.getCast", () => {
  it("returns every declared cast member, in authored order", () => {
    expect(engine().getCast()).toEqual(["ANNA", "BARD", "COOK", "GUARD", "SFX"]);
  });
});

describe("engine.castForScene", () => {
  it("returns the speakers in first-appearance order, deduped", () => {
    expect(engine().castForScene("s1")).toEqual(["GUARD", "ANNA", "SFX", "COOK", "BARD"]);
  });

  it("counts a speaker behind a condition, inside a group, and one voicing a choice prompt", () => {
    const cast = engine().castForScene("s1");
    expect(cast).toContain("COOK"); // inside a conditional option group
    expect(cast).toContain("SFX");  // only ever an option's prompt
  });

  it("resolves the scene by gameId address as well as internal id", () => {
    expect(engine().castForScene("opening")).toEqual(engine().castForScene("s1"));
  });

  it("is empty for a scene with no dialogue, and for an unknown ref", () => {
    expect(engine().castForScene("s2")).toEqual([]);
    expect(engine().castForScene("nope")).toEqual([]);
  });

  it("never reports a name the project does not declare", () => {
    const declared = new Set(engine().getCast());
    for (const name of engine().castForScene("s1")) expect(declared.has(name)).toBe(true);
  });
});

describe("engine.castForBlock", () => {
  it("scopes to the block", () => {
    expect(engine().castForBlock("s1", "b1")).toEqual(["GUARD", "ANNA", "SFX", "COOK"]);
    expect(engine().castForBlock("s1", "b2")).toEqual(["ANNA", "BARD"]);
  });

  it("resolves the block by gameId address", () => {
    expect(engine().castForBlock("opening", "intro")).toEqual(["GUARD", "ANNA", "SFX", "COOK"]);
  });

  it("is empty for an unknown block", () => {
    expect(engine().castForBlock("s1", "nope")).toEqual([]);
  });
});

// --- older / hand-edited bundles ---------------------------------------------
//
// A bundle built by an older toolchain simply omits sections it never had (the compiler omits `cast`
// when a project declares none), and a bundle edited by hand can be worse than that. None of it may
// throw: the cast queries answer with what they can find.

/** A bundle skeleton with the fields the Engine needs, and nothing else. */
const bare = (extra: Record<string, unknown>) => ({
  schema: "patter/bundle@0",
  content: { project: "p" },
  voiced: false,
  locales: { default: "en", included: ["en"] },
  strings: { en: {} },
  scenes: {},
  ...extra,
}) as unknown as ConstructorParameters<typeof Engine>[0];

describe("cast queries on an older or hand-edited bundle", () => {
  it("treats a missing cast section as no cast", () => {
    const e = new Engine(bare({}));
    expect(e.getCast()).toEqual([]);
    expect(e.castForScene("anything")).toEqual([]);
    expect(e.castForBlock("anything", "anything")).toEqual([]);
  });

  it("survives a null cast section and nameless members", () => {
    expect(new Engine(bare({ cast: null })).getCast()).toEqual([]);
    expect(new Engine(bare({ cast: [{ name: "A" }, {}, { name: "" }, { name: "B" }] })).getCast()).toEqual(["A", "B"]);
  });

  // A group with no `children` key at all is not tested here: the Engine CONSTRUCTOR rejects it while
  // building the tag index (#215), long before any cast query runs. That predates this API and is not
  // cast-specific - no compiler emits such a group.
  it("survives a scene whose nodes are missing their beats / prompts", () => {
    const e = new Engine(bare({
      scenes: { s: { id: "s", name: "S", blocks: [
        { id: "b", name: "B", children: [
          { id: "sn", type: "snippet" },                                  // no beats array
          { id: "g", type: "group", children: [] },                       // no prompt
          { id: "g2", type: "group", prompt: { id: "p" }, children: [] }, // prompt with no kind
        ] },
      ] } },
    }));
    expect(e.castForScene("s")).toEqual([]);
    expect(e.castForBlock("s", "b")).toEqual([]);
  });

  it("skips a line beat that names no speaker", () => {
    const e = new Engine(bare({
      scenes: { s: { id: "s", name: "S", blocks: [
        { id: "b", name: "B", children: [
          { id: "sn", type: "snippet", beats: [{ id: "L1", kind: "line" }, { id: "L2", kind: "line", character: "ANNA" }] },
        ] },
      ] } },
    }));
    expect(e.castForScene("s")).toEqual(["ANNA"]);
  });
});
