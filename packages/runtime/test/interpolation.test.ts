// ---------------------------------------------------------------------------
// Inline `{@ref}` interpolation at delivery (spec §16): non-voiced line beats
// and all text beats expand bare-property-reference slots against current state;
// voiced lines stay static; choice labels interpolate.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import type { ProjectFile, Scene, LocaleFile } from "@patterkit/model";

function play(project: ProjectFile, scene: Scene, strings: Record<string, string>) {
  const en: LocaleFile = { schema: "patter/strings@0", scene: scene.id, locale: "en", strings };
  return new Engine(exportBundle({ project, scenes: [scene], locales: [en] }))
    .openFlow("main", { scene: scene.id });
}

const baseProject = (extra: Partial<ProjectFile> = {}): ProjectFile => ({
  schema: "patter/project@0",
  project: { id: "p", name: "P" },
  locales: { default: "en", all: ["en"] },
  properties: [
    { name: "name", type: "string", shared: true, default: "Ada" },
    { name: "gold", type: "number", shared: true, default: 5 },
  ],
  cast: [{ name: "NPC" }],
  ...extra,
});

describe("inline interpolation (spec §16)", () => {
  it("expands {@ref} slots in a non-voiced line beat", () => {
    const scene: Scene = {
      id: "s", type: "scene", name: "S",
      blocks: [{ id: "b", type: "block", name: "B", children: [
        { id: "sn", type: "snippet", beats: [{ id: "L", kind: "line", character: "NPC" }], jump: { to: "END" } },
      ] }],
    };
    const engine = play(baseProject(), scene, { L: "Hi {@name}, you have {@gold} gold." });
    expect(engine.advance()).toMatchObject({ type: "line", text: "Hi Ada, you have 5 gold." });
  });

  it("expands slots in a text beat even when the project is voiced", () => {
    const scene: Scene = {
      id: "s", type: "scene", name: "S",
      blocks: [{ id: "b", type: "block", name: "B", children: [
        { id: "sn", type: "snippet", beats: [{ id: "T", kind: "text" }], jump: { to: "END" } },
      ] }],
    };
    const engine = play(baseProject({ voiced: true }), scene, { T: "{@name}'s journal." });
    expect(engine.advance()).toMatchObject({ type: "text", text: "Ada's journal." });
  });

  it("leaves a voiced line static (slots are not expanded)", () => {
    const scene: Scene = {
      id: "s", type: "scene", name: "S",
      blocks: [{ id: "b", type: "block", name: "B", children: [
        { id: "sn", type: "snippet", beats: [{ id: "L", kind: "line", character: "NPC" }], jump: { to: "END" } },
      ] }],
    };
    const engine = play(baseProject({ voiced: true }), scene, { L: "Hi {@name}." });
    expect(engine.advance()).toMatchObject({ type: "line", text: "Hi {@name}." });
  });

  it("resolves scene- and flow-scoped slots, and renders an empty string for an undefined ref", () => {
    const scene: Scene = {
      id: "s", type: "scene", name: "S",
      sceneProps: [{ name: "mood", type: "string", default: "calm", shared: false }],
      blocks: [{ id: "b", type: "block", name: "B", children: [
        { id: "sn", type: "snippet", beats: [{ id: "T", kind: "text" }], jump: { to: "END" } },
      ] }],
    };
    const engine = play(baseProject(), scene, { T: "mood={@scene.mood} missing=[{@nope}]" });
    expect(engine.advance()).toMatchObject({ type: "text", text: "mood=calm missing=[]" });
  });

  it("leaves a malformed slot (not a bare ref) and non-slot braces verbatim", () => {
    const scene: Scene = {
      id: "s", type: "scene", name: "S",
      blocks: [{ id: "b", type: "block", name: "B", children: [
        { id: "sn", type: "snippet", beats: [{ id: "T", kind: "text" }], jump: { to: "END" } },
      ] }],
    };
    const engine = play(baseProject(), scene, { T: "expr {@gold + 1} literal {json}" });
    expect(engine.advance()).toMatchObject({ type: "text", text: "expr {@gold + 1} literal {json}" });
  });

  it("treats doubled braces as escapes: {{ }} -> { } and {{@name}} stays literal", () => {
    const scene: Scene = {
      id: "s", type: "scene", name: "S",
      blocks: [{ id: "b", type: "block", name: "B", children: [
        { id: "sn", type: "snippet", beats: [{ id: "T", kind: "text" }], jump: { to: "END" } },
      ] }],
    };
    const engine = play(baseProject(), scene, { T: "use {{braces}} so {{@name}} is literal but {@name} is not" });
    expect(engine.advance()).toMatchObject({
      type: "text",
      text: "use {braces} so {@name} is literal but Ada is not",
    });
  });

  it("interpolates a choice label derived from a text beat", () => {
    const scene: Scene = {
      id: "s", type: "scene", name: "S",
      blocks: [{ id: "b", type: "block", name: "B", children: [
        { id: "g", type: "group", selector: "choice", children: [
          { id: "opt", type: "snippet", beats: [{ id: "O", kind: "text" }], jump: { to: "END" } },
        ] },
      ] }],
    };
    const engine = play(baseProject(), scene, { O: "Spend {@gold} gold" });
    expect(engine.advance().type).toBe("choice");
    expect(engine.getChoices()[0]).toMatchObject({ prompt: { text: "Spend 5 gold" } });
  });
});
