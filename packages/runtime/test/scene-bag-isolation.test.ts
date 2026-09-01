// Two flows in the same scene get their own @scene state, including a FLAGS default.
//
// The hand-rolled seeding this replaced returned `decl.default` directly, so every bag
// seeded from one declaration held the bundle's own array. Nothing mutated a flags value
// in place, so it never bit - but "no live path today" is not the same as safe, and the
// shared PropertyBag has always cloned for exactly this reason:
//
//   // Cloned so bags seeded from one declaration set never share a mutable default.
//   this.values[name] = structuredClone(d.default ?? defaultFor(d));
//
// Probed, and the result is worth recording: these two pass against the OLD uncloned
// seeding as well. They do not prove the move to PropertyBag fixed a live bug, because
// there was not one - set_flags builds a new array and nothing mutates a value in place.
// They are a guard on the behaviour going forward, so the day something does mutate in
// place it is a failing test rather than two flows silently sharing one array.
import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import type { ProjectFile, Scene, LocaleFile } from "@patterkit/model";

const project: ProjectFile = {
  schema: "patter/project@0", project: { id: "p", name: "P" },
  locales: { default: "en", all: ["en"] },
};
const scene: Scene = {
  id: "s", type: "scene", name: "S", gameId: "s",
  sceneProps: [{ name: "marks", type: "flags", default: ["a"], shared: false }],
  blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "sn", type: "snippet", beats: [{ id: "L", kind: "text" }],
      onExit: [{ kind: "set", target: "@scene.marks", value: "set_flags(@scene.marks, +b)" }],
      jump: { to: "END" } },
  ] }],
};
const en: LocaleFile = { schema: "patter/strings@0", scene: "s", locale: "en", strings: { L: "hi" } };
const bundle = exportBundle({ project, scenes: [scene], locales: [en] });

describe("scene bags seeded from one declaration", () => {
  it("do not share the declared flags array between flows", () => {
    const engine = new Engine(bundle, { seed: 0 });

    const one = engine.openFlow("one", { scene: "s", block: "b" });
    for (let i = 0; i < 10 && one.advance().type !== "end"; i++) { /* writes marks */ }
    expect(one.getProperty("@scene.marks")).toEqual(["a", "b"]);

    // A second flow enters the SAME scene, seeded from the SAME declaration. If the two
    // bags shared the array, this would start life carrying the first flow's write.
    const two = engine.openFlow("two", { scene: "s", block: "b" });
    expect(two.getProperty("@scene.marks")).toEqual(["a"]);
  });

  it("does not let a flow's write reach the bundle's own default", () => {
    const engine = new Engine(bundle, { seed: 0 });
    const f = engine.openFlow("f", { scene: "s", block: "b" });
    for (let i = 0; i < 10 && f.advance().type !== "end"; i++) { /* writes marks */ }
    // A fresh engine over the same bundle object must be untouched by that run.
    const fresh = new Engine(bundle, { seed: 0 });
    const g = fresh.openFlow("g", { scene: "s", block: "b" });
    expect(g.getProperty("@scene.marks")).toEqual(["a"]);
  });
});
