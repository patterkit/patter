// ---------------------------------------------------------------------------
// Multi-flow: several flows run concurrently on one Engine. They SHARE the
// shared `@patter` globals (one world value) but each keeps its own per-flow
// `@patter` globals (declared `shared:false`), cursor, and PRNG.
// `engine.saveGame()` / `loadGame()` round-trips every flow at once.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import type { ProjectFile, Scene, LocaleFile } from "@patterkit/model";

// On entry each flow bumps the shared @bell and its own @patter.turns, then speaks
// a line showing both. `@bell` (bare) is a SHARED global; `@patter.turns` is a
// per-flow global (declared `shared:false`) - both `@patter`, split by the flag.
const project: ProjectFile = {
  schema: "patter/project@0",
  project: { id: "mf", name: "MultiFlow" },
  locales: { default: "en", all: ["en"] },
  properties: [
    { name: "bell", type: "number", shared: true, default: 0 },
    { name: "turns", type: "number", shared: false, default: 0 },
  ],
};
const scene: Scene = {
  id: "s", type: "scene", name: "S",
  blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "sn", type: "snippet",
      onEnter: [
        { kind: "set", target: "@bell", value: "@bell + 1" },
        { kind: "set", target: "@patter.turns", value: "@patter.turns + 1" },
      ],
      beats: [{ id: "L", kind: "text" }],
      jump: { to: "END" } },
  ] }],
};
const en: LocaleFile = { schema: "patter/strings@0", scene: "s", locale: "en", strings: { L: "bell={@bell} turns={@patter.turns}" } };
const bundle = exportBundle({ project, scenes: [scene], locales: [en] });

describe("multi-flow", () => {
  it("flows share the shared globals but keep independent per-flow globals", () => {
    const engine = new Engine(bundle);

    const alice = engine.openFlow("alice", { scene: "s" });   // bell 0->1, alice.turns 0->1
    expect(alice.advance()).toMatchObject({ type: "text", text: "bell=1 turns=1" });

    const bob = engine.openFlow("bob", { scene: "s" });        // bell 1->2, bob.turns 0->1
    expect(bob.advance()).toMatchObject({ type: "text", text: "bell=2 turns=1" });

    expect(engine.getProperty("@bell")).toBe(2);               // shared: both bumped it
    expect(alice.getProperty("@patter.turns")).toBe(1);          // independent per flow
    expect(bob.getProperty("@patter.turns")).toBe(1);
    expect(engine.flows().map((f) => f.id).sort()).toEqual(["alice", "bob"]);
  });

  it("closeFlow removes one flow without disturbing the others or @patter", () => {
    const engine = new Engine(bundle);
    engine.openFlow("alice", { scene: "s" }).advance();
    engine.openFlow("bob", { scene: "s" }).advance();

    engine.closeFlow("alice");
    expect(engine.getFlow("alice")).toBeUndefined();
    expect(engine.flows().map((f) => f.id)).toEqual(["bob"]);
    expect(engine.getProperty("@bell")).toBe(2);               // shared world untouched
    expect(engine.getFlow("bob")!.getProperty("@patter.turns")).toBe(1);
  });

  it("saveGame / loadGame round-trips every live flow", () => {
    const engine = new Engine(bundle);
    engine.openFlow("alice", { scene: "s" }).advance();
    engine.openFlow("bob", { scene: "s" }).advance();
    const save = JSON.parse(JSON.stringify(engine.saveGame()));
    expect(Object.keys(save.flows).sort()).toEqual(["alice", "bob"]);

    const restored = new Engine(bundle);
    restored.loadGame(save);
    expect(restored.flows().map((f) => f.id).sort()).toEqual(["alice", "bob"]);
    expect(restored.getProperty("@bell")).toBe(2);             // shared @patter restored
    expect(restored.getFlow("alice")!.getProperty("@patter.turns")).toBe(1);
    expect(restored.getFlow("bob")!.getProperty("@patter.turns")).toBe(1);

    // both flows resume from their saved cursor straight to END
    expect(restored.getFlow("alice")!.advance()).toEqual({ type: "end" });
    expect(restored.getFlow("bob")!.advance()).toEqual({ type: "end" });
  });
});
