// ---------------------------------------------------------------------------
// A2: a choice OPTION is an Option group - its `children` are the option's
// content (an ordinary run with nesting), played then gathered back when chosen
// (spec §5; design/patterpad-groups.md §8). choiceText / secretUntilEligible live
// on the Option group. The degenerate snippet-option still works (backward-compat,
// covered by the other choice tests).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import type { ProjectFile, Scene, LocaleFile } from "@patterkit/model";

const project = (extra: Partial<ProjectFile> = {}): ProjectFile => ({
  schema: "patter/project@0", project: { id: "og", name: "OG" },
  locales: { default: "en", all: ["en"] }, ...extra,
});
const loc = (strings: Record<string, string>): LocaleFile => ({ schema: "patter/strings@0", scene: "s", locale: "en", strings });

// A choice whose options are Option GROUPS. opt1's content is a run: a line, then
// a branch branch; after the choice, a `gather` line proves it gathers back.
const scene: Scene = {
  id: "s", type: "scene", name: "S",
  blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "g_choice", type: "group", selector: "choice", children: [
      { id: "opt1", type: "group", prompt: { id: "C1", kind: "text" }, children: [
        { id: "o1a", type: "snippet", beats: [{ id: "La", kind: "line" }] },
        { id: "br", type: "group", selector: "branch", children: [
          { id: "o1b", type: "snippet", condition: "@flag", beats: [{ id: "Lb", kind: "line" }] },
          { id: "o1c", type: "snippet", beats: [{ id: "Lc", kind: "line" }] },
        ] },
      ] },
      { id: "opt2", type: "group", prompt: { id: "C2", kind: "text" }, children: [
        { id: "o2", type: "snippet", beats: [{ id: "Ld", kind: "line" }], jump: { to: "END" } },
      ] },
    ] },
    { id: "after", type: "snippet", beats: [{ id: "Lg", kind: "line" }], jump: { to: "END" } },
  ] }],
};
const strings = loc({ La: "first", Lb: "branch-true", Lc: "branch-false", Ld: "second option", Lg: "gathered", C1: "Choice one", C2: "Choice two" });
const bundle = (flag: boolean) => {
  const e = exportBundle({ project: project({ properties: [{ name: "flag", type: "boolean", shared: true, default: flag }] }), scenes: [scene], locales: [strings] });
  return e;
};

describe("choice options as Option groups", () => {
  it("presents both option groups with their choiceText", () => {
    const flow = new Engine(bundle(false)).openFlow("main", { scene: "s" });
    const r = flow.advance();
    expect(r.type).toBe("choice");
    if (r.type !== "choice") throw new Error("not a choice");
    expect(r.options.map((o) => ({ id: o.id, text: o.prompt?.text, eligible: o.eligible })))
      .toEqual([{ id: "opt1", text: "Choice one", eligible: true }, { id: "opt2", text: "Choice two", eligible: true }]);
  });

  it("a chosen Option group plays its content run, branches, and gathers back", () => {
    const engine = new Engine(bundle(false)); // @flag false -> branch takes o1c
    const flow = engine.openFlow("main", { scene: "s" });
    expect(flow.advance().type).toBe("choice");
    flow.choose("opt1");
    expect(flow.advance()).toMatchObject({ type: "line", id: "La", text: "first" });        // option content
    expect(flow.advance()).toMatchObject({ type: "line", id: "Lc", text: "branch-false" }); // nested branch branch
    expect(flow.advance()).toMatchObject({ type: "line", id: "Lg", text: "gathered" });      // gathered back past the choice
    expect(flow.advance()).toEqual({ type: "end" });
  });

  it("the branch follows the variable (flag true -> the other branch)", () => {
    const engine = new Engine(bundle(true)); // @flag true -> branch takes o1b
    const flow = engine.openFlow("main", { scene: "s" });
    expect(flow.advance().type).toBe("choice");
    flow.choose("opt1");
    expect(flow.advance()).toMatchObject({ id: "La" });
    expect(flow.advance()).toMatchObject({ id: "Lb", text: "branch-true" });
    expect(flow.advance()).toMatchObject({ id: "Lg" });
  });

  it("an Option group whose content jumps away does not gather", () => {
    const flow = new Engine(bundle(false)).openFlow("main", { scene: "s" });
    expect(flow.advance().type).toBe("choice");
    flow.choose("opt2");
    expect(flow.advance()).toMatchObject({ type: "line", id: "Ld", text: "second option" });
    expect(flow.advance()).toEqual({ type: "end" }); // o2 jumps END; no gather to `after`
  });
});
