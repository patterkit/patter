// ---------------------------------------------------------------------------
// validateInterpolation (spec §16): the voiced-line ban + committed-surface and
// unknown-property checks on `{@ref}` slots inside localised strings.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { validateInterpolation } from "@patterkit/compiler";
import type { ProjectFile, Scene, LocaleFile } from "@patterkit/model";

const project = (extra: Partial<ProjectFile> = {}): ProjectFile => ({
  schema: "patter/project@0",
  project: { id: "p", name: "P" },
  locales: { default: "en", all: ["en"] },
  properties: [{ name: "name", type: "string", shared: true, default: "Ada" }],
  cast: [{ name: "NPC" }],
  ...extra,
});

// A scene with one line beat (L) and one text beat (T), plus optional scene props.
const scene: Scene = {
  id: "s", type: "scene", name: "S",
  sceneProps: [{ name: "mood", type: "string", default: "calm", shared: false }],
  blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "sn", type: "snippet",
      beats: [{ id: "L", kind: "line", character: "NPC" }, { id: "T", kind: "text" }],
      jump: { to: "END" } },
  ] }],
};

const run = (proj: ProjectFile, strings: Record<string, string>) =>
  validateInterpolation({
    project: proj,
    scenes: [scene],
    locales: [{ schema: "patter/strings@0", scene: "s", locale: "en", strings } as LocaleFile],
  });

describe("validateInterpolation (spec §16)", () => {
  it("passes valid slots in a non-voiced project (line + text + scene scope)", () => {
    expect(run(project(), { L: "Hi {@name}", T: "{@name} feels {@scene.mood}" })).toEqual([]);
  });

  it("rejects a slot in a voiced line beat", () => {
    const issues = run(project({ voiced: true }), { L: "Hi {@name}", T: "" });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ nodeId: "L", src: "{@name}" });
    expect(issues[0]!.message).toMatch(/voiced line/i);
  });

  it("allows slots in a text beat even when voiced", () => {
    expect(run(project({ voiced: true }), { L: "static", T: "{@name}'s journal" })).toEqual([]);
  });

  it("flags a malformed slot (not a bare reference)", () => {
    const issues = run(project(), { T: "have {@name + 1} coins" });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toMatch(/bare property reference/i);
  });

  it("flags an unknown property in a slot", () => {
    const issues = run(project(), { T: "{@nope}" });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toMatch(/unknown property/i);
  });

  it("ignores non-slot braces and beats with no localised string", () => {
    expect(run(project(), { T: "literal {json} text" })).toEqual([]);
    expect(run(project(), {})).toEqual([]); // no strings -> nothing to check
  });

  it("treats an escaped {{@name}} as literal, so it is allowed in a voiced line", () => {
    // The escaped form is not a slot, so the voiced-line ban does not trigger...
    expect(run(project({ voiced: true }), { L: "say {{@name}} aloud", T: "" })).toEqual([]);
    // ...while the unescaped form in a voiced line is still rejected.
    expect(run(project({ voiced: true }), { L: "say {@name}", T: "" })).toHaveLength(1);
  });
});
