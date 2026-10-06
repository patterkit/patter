// A rollback after a load must not lose saved `@scene` values. After loadGame, a flow mounts bags only for
// the scenes its cursor stands in; every other scene's saved values wait in the registry, PARKED, until the
// flow enters that scene and its new bag claims them. Entering such a scene inside a checkpoint claims
// them, and the rollback's undo used to remove the bag outright, so the claimed values went with it: the
// next real entry seeded the defaults, and the next save dropped them (2026-10 review, all four runtimes).
import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import type { ProjectFile, Scene, LocaleFile } from "@patterkit/model";

const project: ProjectFile = {
  schema: "patter/project@0", project: { id: "p", name: "P" },
  locales: { default: "en", all: ["en"] },
};
const block = (id: string, beat: string) => ({ id, type: "block" as const, name: id, children: [
  { id: `sn_${id}`, type: "snippet" as const, beats: [{ id: beat, kind: "text" as const }], jump: { to: "END" } },
] });
const scenes: Scene[] = [
  { id: "a", type: "scene", name: "A", gameId: "a", blocks: [block("ba", "TA")] },
  { id: "b", type: "scene", name: "B", gameId: "b",
    sceneProps: [
      { name: "doorOpen", type: "boolean", default: false },         // per-flow
      { name: "lit", type: "boolean", default: false, shared: true }, // shared by every flow
    ],
    blocks: [block("bb", "TB")] },
];
const locales: LocaleFile[] = [
  { schema: "patter/strings@0", scene: "a", locale: "en", strings: { TA: "in a" } },
  { schema: "patter/strings@0", scene: "b", locale: "en", strings: { TB: "door={@scene.doorOpen} lit={@scene.lit}" } },
];
const bundle = exportBundle({ project, scenes, locales });

/** A saved game whose flow stands in A, with B's `@scene` values set to true. */
function savedWithSceneValues() {
  const engine = new Engine(bundle);
  const flow = engine.openFlow("f", { scene: "a" });
  flow.goto("b");
  flow.setProperty("@scene.doorOpen", true);
  flow.setProperty("@scene.lit", true);
  expect(flow.advance()).toMatchObject({ text: "door=true lit=true" });
  flow.goto("a");
  return engine.saveGame();
}

describe("a rollback after a load", () => {
  it("keeps the saved @scene values of a scene first entered inside the checkpoint", () => {
    const engine = new Engine(bundle);
    engine.loadGame(savedWithSceneValues());
    const flow = engine.getFlow("f")!;
    const cp = engine.checkpoint();
    flow.goto("b");
    expect(flow.advance()).toMatchObject({ text: "door=true lit=true" });
    engine.rollback(cp);
    flow.goto("b");
    expect(flow.advance()).toMatchObject({ text: "door=true lit=true" });
  });

  it("still carries them in the next save", () => {
    const engine = new Engine(bundle);
    engine.loadGame(savedWithSceneValues());
    const flow = engine.getFlow("f")!;
    const cp = engine.checkpoint();
    flow.goto("b");
    engine.rollback(cp);
    const again = new Engine(bundle);
    again.loadGame(engine.saveGame());
    again.getFlow("f")!.goto("b");
    expect(again.getFlow("f")!.advance()).toMatchObject({ text: "door=true lit=true" });
  });

  it("and a scene with nothing saved still seeds fresh after the rollback", () => {
    const engine = new Engine(bundle);
    const flow = engine.openFlow("f", { scene: "a" });
    const cp = engine.checkpoint();
    flow.goto("b");
    flow.setProperty("@scene.doorOpen", true);
    engine.rollback(cp);
    flow.goto("b");
    expect(flow.advance()).toMatchObject({ text: "door=false lit=false" });
  });
});
