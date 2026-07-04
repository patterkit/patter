// ---------------------------------------------------------------------------
// Declaration / ladder / locales / shape validation (spec §7/§13) - the rules
// beyond the tree invariants covered in core.test.ts.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { validateProject } from "@patterkit/core";
import type { ProjectFile, Scene } from "@patterkit/model";

const base = (): ProjectFile => ({
  schema: "patter/project@0", project: { id: "p", name: "P" },
  locales: { default: "en", all: ["en"] },
});
const scene = (): Scene => ({
  id: "s", type: "scene", name: "S",
  blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "sn", type: "snippet", beats: [{ id: "T", kind: "text" }], jump: { to: "END" } },
  ] }],
});
const codes = (project: ProjectFile, scenes: Scene[] = [scene()]) =>
  validateProject({ project, scenes }).map((i) => i.code);

describe("property declarations", () => {
  it("flags duplicate names (case-insensitive)", () => {
    const p = base();
    p.properties = [
      { name: "Gold", type: "number" },
      { name: "gold", type: "string" },
    ];
    expect(codes(p)).toContain("invalid-declaration");
  });

  it("flags enum/flags with no values", () => {
    const p = base();
    p.properties = [{ name: "mood", type: "enum" }];
    expect(codes(p)).toContain("invalid-declaration");
  });

  it("flags a default that does not match the type", () => {
    const p = base();
    p.properties = [{ name: "hp", type: "number", default: "lots" }];
    expect(codes(p)).toContain("invalid-declaration");
  });

  it("flags an enum default outside its values", () => {
    const p = base();
    p.properties = [{ name: "mood", type: "enum", values: ["calm", "tense"], default: "angry" }];
    expect(codes(p)).toContain("invalid-declaration");
  });

  it("accepts well-formed declarations", () => {
    const p = base();
    p.properties = [
      { name: "hp", type: "number", default: 10 },
      { name: "mood", type: "enum", values: ["calm", "tense"], default: "calm" },
      { name: "quests", type: "flags", values: ["met", "done"], default: ["met"] },
    ];
    expect(codes(p)).toEqual([]);
  });
});

describe("status ladders", () => {
  it("requires each readiness marker on exactly one status", () => {
    const p = base();
    p.writingStatuses = [{ name: "draft" }, { name: "done" }]; // no markers at all
    const issues = codes(p).filter((c) => c === "invalid-status-ladder");
    expect(issues).toHaveLength(2); // readyToRecord and readyToShip both missing
  });

  it("flags duplicate status names", () => {
    const p = base();
    p.recordingStatuses = [{ name: "missing" }, { name: "missing" }, { name: "final" }];
    expect(codes(p)).toContain("invalid-status-ladder");
  });

  it("accepts the documented default-shaped ladder", () => {
    const p = base();
    p.writingStatuses = [
      { name: "draft" }, { name: "final", readyToRecord: true }, { name: "locked", readyToShip: true },
    ];
    p.recordingStatuses = [{ name: "missing" }, { name: "recorded" }];
    expect(codes(p)).toEqual([]);
  });
});

describe("locales + shape guards", () => {
  it("flags a default locale missing from locales.all", () => {
    const p = base();
    p.locales = { default: "fr", all: ["en"] };
    expect(codes(p)).toContain("invalid-locales");
  });

  it("reports a missing node id as an issue, not a crash", () => {
    const s = scene();
    // simulate a hand-edit that lost an id
    delete (s.blocks[0]!.children[0] as { id?: string }).id;
    expect(codes(base(), [s])).toContain("missing-id");
  });

  it("reports a scene without a blocks array as malformed, not a crash", () => {
    const s = scene();
    (s as { blocks?: unknown }).blocks = undefined;
    expect(codes(base(), [s])).toContain("malformed-node");
  });
});

describe("choice option prompt (spec §5)", () => {
  const choiceScene = (option: Record<string, unknown>): Scene => ({
    id: "s", type: "scene", name: "S",
    blocks: [
      { id: "b", type: "block", name: "B", children: [
        { id: "g", type: "group", selector: "choice", children: [
          option as never,
        ] },
      ] },
    ],
  });

  it("flags an option group with no prompt", () => {
    const s = choiceScene({ id: "opt", type: "group", children: [{ id: "c", type: "snippet", jump: { to: "END" } }] });
    expect(codes(base(), [s])).toContain("missing-prompt");
  });

  it("flags an option whose prompt is not a line/text beat", () => {
    const s = choiceScene({ id: "opt", type: "group", prompt: { id: "P", kind: "gameEvent" }, children: [{ id: "c", type: "snippet", jump: { to: "END" } }] });
    expect(codes(base(), [s])).toContain("invalid-prompt");
  });

  it("accepts an option with a text prompt", () => {
    const s = choiceScene({ id: "opt", type: "group", prompt: { id: "P", kind: "text" }, children: [{ id: "c", type: "snippet", jump: { to: "END" } }] });
    expect(codes(base(), [s])).toEqual([]);
  });
});

describe("documentation classes (spec §18)", () => {
  const docCodes = (project: ProjectFile, docs: Record<string, { type?: string; text: string }[]>) =>
    validateProject({ project, scenes: [scene()], authoring: [{ schema: "patter/authoring@0", documentation: docs } as never] })
      .filter((i) => i.code === "unknown-doc-class");

  it("an undeclared class is flagged; untyped and declared classes are fine", () => {
    const issues = docCodes(base(), { T: [{ type: "vo", text: "ok" }, { text: "untyped ok" }, { type: "bogus", text: "no" }] });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("bogus");
  });

  it("a project's custom documentationClasses replace the defaults", () => {
    const p: ProjectFile = { ...base(), documentationClasses: [{ name: "sfx", deliver: ["sfx"] }] };
    expect(docCodes(p, { T: [{ type: "sfx", text: "boom" }] })).toEqual([]); // declared
    expect(docCodes(p, { T: [{ type: "vo", text: "x" }] })).toHaveLength(1);  // 'vo' no longer declared
  });
});

describe("author tags (#215)", () => {
  it("accepts well-formed tags at every level", () => {
    const s = scene();
    s.tags = ["chapter1", "hub-room", "★boss"];
    s.blocks[0]!.tags = ["intro"];
    s.blocks[0]!.children[0]!.tags = ["combat"];
    (s.blocks[0]!.children[0] as Scene["blocks"][0]["children"][0] & { beats: { tags?: string[] }[] }).beats[0]!.tags = ["barked"];
    expect(codes(base(), [s])).toEqual([]);
  });

  it("flags a tag containing whitespace", () => {
    const s = scene();
    s.tags = ["two words"];
    expect(codes(base(), [s])).toContain("invalid-tag");
  });

  it("flags a tag containing a comma", () => {
    const s = scene();
    s.blocks[0]!.tags = ["a,b"];
    expect(codes(base(), [s])).toContain("invalid-tag");
  });

  it("flags an empty-string tag", () => {
    const s = scene();
    s.blocks[0]!.children[0]!.tags = [""];
    expect(codes(base(), [s])).toContain("invalid-tag");
  });
});

describe("gameData field definitions", () => {
  it("accepts well-formed per-type fields", () => {
    const p: ProjectFile = { ...base(), gameDataFields: {
      scene: [{ name: "music", type: "text", default: "calm" }],
      line: [{ name: "emphasis", type: "boolean", default: false }, { name: "tone", type: "enum", values: ["warm", "cold"] }],
    } };
    expect(codes(p)).not.toContain("invalid-gamedata-field");
  });

  it("flags duplicate field names within a node type (case-insensitive)", () => {
    const p: ProjectFile = { ...base(), gameDataFields: {
      scene: [{ name: "Music", type: "text" }, { name: "music", type: "text" }],
    } };
    expect(codes(p)).toContain("invalid-gamedata-field");
  });

  it("allows the same field name on different node types", () => {
    const p: ProjectFile = { ...base(), gameDataFields: {
      scene: [{ name: "tag", type: "text" }],
      block: [{ name: "tag", type: "text" }],
    } };
    expect(codes(p)).not.toContain("invalid-gamedata-field");
  });

  it("flags an enum field with no values", () => {
    const p: ProjectFile = { ...base(), gameDataFields: { line: [{ name: "tone", type: "enum" }] } };
    expect(codes(p)).toContain("invalid-gamedata-field");
  });
});
