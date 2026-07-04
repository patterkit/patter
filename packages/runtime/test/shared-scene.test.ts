// ---------------------------------------------------------------------------
// Shared `@scene` props - the SHARED half of the scene scope. A `@scene` property
// is per-flow by default (each flow keeps its own), but a property declared
// `shared:true` holds one value across every flow in the scene. Both are `@scene`;
// the reference is the same - only the declared `shared` flag differs. Plus
// engine.reset() (drop everything, including shared scene props) and flow.reset()
// (restart one flow; shared scene props kept).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import type { ProjectFile, Scene, LocaleFile } from "@patterkit/model";

// On entry each flow bumps BOTH its per-flow @scene.mine and the shared
// @scene.tally, then speaks both. Sharing is a per-property flag on the same
// scope: `mine` is per-flow (default), `tally` is `shared:true`.
const project: ProjectFile = {
  schema: "patter/project@0",
  project: { id: "st", name: "Stage" },
  locales: { default: "en", all: ["en"] },
};
const scene: Scene = {
  id: "s", type: "scene", name: "S",
  sceneProps: [
    { name: "mine", type: "number", default: 0 },                 // per-flow (default)
    { name: "tally", type: "number", default: 0, shared: true },  // shared across flows
  ],
  blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "sn", type: "snippet",
      onEnter: [
        { kind: "set", target: "@scene.mine", value: "@scene.mine + 1" },
        { kind: "set", target: "@scene.tally", value: "@scene.tally + 1" },
      ],
      beats: [{ id: "L", kind: "text" }],
      jump: { to: "END" } },
  ] }],
};
const en: LocaleFile = {
  schema: "patter/strings@0", scene: "s", locale: "en",
  strings: { L: "mine={@scene.mine} tally={@scene.tally}" },
};
const bundle = exportBundle({ project, scenes: [scene], locales: [en] });

describe("shared @scene props (the shared half of the scene scope)", () => {
  it("a shared @scene prop is one value across flows; a default @scene prop stays per-flow", () => {
    const engine = new Engine(bundle);

    const alice = engine.openFlow("alice", { scene: "s" }); // mine 0->1, tally 0->1
    expect(alice.advance()).toMatchObject({ type: "text", text: "mine=1 tally=1" });

    const bob = engine.openFlow("bob", { scene: "s" });      // mine 0->1 (own), tally 1->2 (shared)
    expect(bob.advance()).toMatchObject({ type: "text", text: "mine=1 tally=2" });

    expect(alice.getProperty("@scene.mine")).toBe(1);        // per-flow: each its own
    expect(bob.getProperty("@scene.mine")).toBe(1);
    expect(alice.getProperty("@scene.tally")).toBe(2);       // shared: both see the world value
    expect(bob.getProperty("@scene.tally")).toBe(2);
  });

  it("saveGame / loadGame round-trips the shared scene bag", () => {
    const engine = new Engine(bundle);
    engine.openFlow("alice", { scene: "s" }).advance();
    engine.openFlow("bob", { scene: "s" }).advance();        // tally now 2

    const save = JSON.parse(JSON.stringify(engine.saveGame()));
    expect(save.stageBags.s.tally).toBe(2);

    const restored = new Engine(bundle);
    restored.loadGame(save);
    expect(restored.getFlow("alice")!.getProperty("@scene.tally")).toBe(2);
    expect(restored.getFlow("bob")!.getProperty("@scene.mine")).toBe(1);
  });

  it("engine.reset() clears the shared scene prop back to its declared default", () => {
    const engine = new Engine(bundle);
    engine.openFlow("alice", { scene: "s" }).advance();      // tally -> 1
    expect(engine.getFlow("alice")).toBeDefined();

    engine.reset();
    expect(engine.flows()).toEqual([]);                      // every flow dropped

    const carol = engine.openFlow("carol", { scene: "s" });  // re-seeded: tally 0 -> 1
    expect(carol.advance()).toMatchObject({ type: "text", text: "mine=1 tally=1" });
  });

  it("flow.reset() restarts one flow but leaves the shared scene prop intact", () => {
    const engine = new Engine(bundle);
    const alice = engine.openFlow("alice", { scene: "s" });
    alice.advance();                                          // tally -> 1
    engine.openFlow("bob", { scene: "s" }).advance();         // tally -> 2

    alice.reset("s");                                        // restart: @scene.mine re-seeds (per-flow), tally kept (shared)
    expect(alice.advance()).toMatchObject({ type: "text", text: "mine=1 tally=3" }); // mine 0->1, tally 2->3
  });
});
