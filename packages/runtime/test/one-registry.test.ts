// ---------------------------------------------------------------------------
// One registry per game (patterkit design/one-registry-handover.md).
//
// The engine registers every property bag it has in the game's ScopeRegistry:
// `@patter` under `patter`, and its per-flow and per-scene bags under keys that
// start `patter/`. `saveGame()` keeps only what is not a property, unless the
// engine made its own registry (a standalone game), when the registry's values
// ride along. These tests hold the engine to that from the GAME's side: what is
// in the registry, what the game saves, and that loading works in either order.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
import type { StepResult } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import { ScopeRegistry } from "@wildwinter/scoperegistry";
import type { ProjectFile, Scene, LocaleFile, HostScopeRegistry } from "@patterkit/model";

const worldSpec: HostScopeRegistry = {
  version: 1,
  scopes: [{ token: "world", declarations: [{ name: "gold", type: "number", default: 0 }] }],
};
const project: ProjectFile = {
  schema: "patter/project@0", project: { id: "or", name: "OR" },
  locales: { default: "en", all: ["en"] },
  properties: [
    { name: "fame", type: "number", default: 0, shared: true },   // -> `patter`
    { name: "mood", type: "number", default: 0, shared: false },  // -> each flow's own bag
  ],
  scopeRegistry: worldSpec,
};
const scene: Scene = {
  id: "s", type: "scene", name: "S", gameId: "s",
  sceneProps: [
    { name: "count", type: "number", default: 0 },                // per flow
    { name: "tally", type: "number", default: 0, shared: true },  // the scene's shared bag
  ],
  blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "sn", type: "snippet", beats: [{ id: "L", kind: "text" }],
      onExit: [
        { kind: "set", target: "@fame", value: "@fame + 1" },
        { kind: "set", target: "@mood", value: "@mood + 2" },
        { kind: "set", target: "@scene.count", value: "@scene.count + 1" },
        { kind: "set", target: "@scene.tally", value: "@scene.tally + 1" },
        { kind: "set", target: "@world.gold", value: "@world.gold + 5" },
      ],
      jump: { to: "END" } },
  ] }],
};
const en: LocaleFile = { schema: "patter/strings@0", scene: "s", locale: "en", strings: { L: "gold {@world.gold}" } };
const bundle = exportBundle({ project, scenes: [scene], locales: [en] });

const playOut = (flow: { advance(): StepResult }): void => {
  for (let i = 0; i < 10 && flow.advance().type !== "end"; i++) { /* play to the end */ }
};

/** A game that owns its registry and registers `@world` itself, as a property the registry stores. */
const game = () => {
  const registry = new ScopeRegistry().defineOwned("world", worldSpec.scopes[0]!.declarations!, { owner: "Game" });
  return { registry, patter: new Engine(bundle, { registry, seed: 1 }) };
};

describe("one registry per game: Patter", () => {
  it("registers every bag in the game's registry, under Patter's keys and owner label", () => {
    const { registry, patter } = game();
    playOut(patter.openFlow("f", { scene: "s" }));
    expect(registry.save()).toEqual({
      world: { gold: 5 },
      patter: { fame: 1 },
      "patter/flow/f/patter": { mood: 2 },
      "patter/flow/f/scene/s": { count: 1 },
      "patter/scene/s": { tally: 1 },
    });
    // Examiner rows keep the story's addresses; the scope column says which bag, the owner whose.
    const rows = registry.listProperties().filter((r) => r.owner === "Patter");
    expect(rows.map((r) => [r.scope, r.path, r.value])).toEqual([
      ["patter", "@patter.fame", 1],
      ["patter/flow/f/patter", "@patter.mood", 2],
      ["patter/flow/f/scene/s", "@scene.count", 1],
      ["patter/scene/s", "@scene.tally", 1],
    ]);
  });

  it("leaves the values out of saveGame when the game passed the registry", () => {
    const { patter } = game();
    playOut(patter.openFlow("f", { scene: "s" }));
    const save = patter.saveGame();
    expect(save.registry).toBeUndefined();
    expect(Object.keys(save.flows.f!).sort()).toEqual(["cursor", "rngState", "visits"]);
  });

  it("uses a @world the game registered, and self-backs nothing", () => {
    const { registry, patter } = game();
    expect(registry.listProperties().find((r) => r.scope === "world")?.owner).toBe("Game");
    playOut(patter.openFlow("f", { scene: "s" }));
    expect(registry.get("world", "gold")).toBe(5);
  });

  it("does not self-back a declared host scope in the game's registry: that token is the game's", () => {
    const registry = new ScopeRegistry();
    new Engine(bundle, { registry });
    expect(registry.has("patter")).toBe(true);
    expect(registry.has("world")).toBe(false);
  });

  it("a standalone engine self-backs @world as a stored property, and saves it", () => {
    const patter = new Engine(bundle, { seed: 1 });
    playOut(patter.openFlow("f", { scene: "s" }));
    const save = JSON.parse(JSON.stringify(patter.saveGame()));
    expect(save.registry.world).toEqual({ gold: 5 });

    const restored = new Engine(bundle, { seed: 1 });
    restored.loadGame(save);
    expect(restored.getProperty("@world.gold")).toBe(5);
  });

  describe("one save for the game, loaded in either order", () => {
    const session1 = () => {
      const g = game();
      const flow = g.patter.openFlow("f", { scene: "s" });
      playOut(flow);
      g.patter.openFlow("g", { scene: "s" }); // a second flow, still at its first beat
      return JSON.parse(JSON.stringify({ registry: g.registry.save(), patter: g.patter.saveGame() }));
    };
    const check = (g: ReturnType<typeof game>) => {
      expect(g.patter.getProperty("@fame")).toBe(1);
      expect(g.patter.getProperty("@world.gold")).toBe(5);
      expect(g.patter.getFlow("f")!.getProperty("@mood")).toBe(2);
      expect(g.patter.getFlow("f")!.getProperty("@scene.count")).toBe(1);
      expect(g.patter.getFlow("g")!.getProperty("@scene.count")).toBe(0);
      expect(g.patter.getFlow("g")!.getProperty("@scene.tally")).toBe(1);
      // Play on: g's exit lands on the restored shared values.
      playOut(g.patter.getFlow("g")!);
      expect(g.patter.getProperty("@fame")).toBe(2);
      expect(g.registry.get("patter/scene/s", "tally")).toBe(2);
    };

    it("registry first, then the engine", () => {
      const save = session1();
      const g = game();
      g.registry.load(save.registry);
      g.patter.loadGame(save.patter);
      check(g);
    });

    it("the engine first, then the registry", () => {
      const save = session1();
      const g = game();
      g.patter.loadGame(save.patter);
      g.registry.load(save.registry);
      check(g);
    });

    it("into a game already playing: live flows are replaced by the saved ones", () => {
      const save = session1();
      const g = game();
      playOut(g.patter.openFlow("f", { scene: "s" }));
      playOut(g.patter.openFlow("stray", { scene: "s" })); // not in the save: its bags must not survive
      g.registry.load(save.registry);
      g.patter.loadGame(save.patter);
      check(g);
      expect(Object.keys(g.registry.save()).filter((k) => k.includes("stray"))).toEqual([]);
    });
  });

  it("reads a scope another engine registered after the flow opened", () => {
    const withStory = exportBundle({
      project: { ...project, scopeRegistry: undefined },
      scenes: [{ ...scene, blocks: [{ id: "b", type: "block", name: "B", children: [
        // Evaluated first, so the flow has built its evaluation context before @story exists.
        { id: "intro", type: "snippet", condition: "@fame >= 0", beats: [{ id: "I", kind: "text" }] },
        { id: "yes", type: "snippet", condition: "@story.act >= 2", beats: [{ id: "L", kind: "text" }], jump: { to: "END" } },
      ] }] }],
      locales: [{ ...en, strings: { I: "intro", L: "act two" } }],
      foreignScopes: { version: 1, scopes: [{ token: "story", declarations: [{ name: "act", type: "number" }] }] },
    });
    const registry = new ScopeRegistry();
    const patter = new Engine(withStory, { registry });
    const flow = patter.openFlow("f", { scene: "s" });
    expect(flow.advance()).toMatchObject({ type: "text", text: "intro" });

    registry.defineOwned("story", [{ name: "act", type: "number", default: 2 }], { owner: "Other engine" });
    expect(flow.advance()).toMatchObject({ type: "text", text: "act two" });
  });

  it("refuses a token another engine holds, naming it, and leaves the registry as it was", () => {
    const registry = new ScopeRegistry();
    new Engine(bundle, { registry });
    expect(() => new Engine(bundle, { registry })).toThrow("scope '@patter' is already registered by Patter");

    const withWorld = new ScopeRegistry().defineOwned("world", [], { owner: "Game" });
    expect(() => new Engine(bundle, { registry: withWorld, world: { get: () => 0 } }))
      .toThrow("scope '@world' is already registered by Game");
    expect(withWorld.has("patter")).toBe(false); // the half-built engine took nothing with it
  });

  it("escapes a flow id in its keys, so no two flows' keys can meet", () => {
    const { registry, patter } = game();
    patter.openFlow("npc/bob", { scene: "s" });
    patter.openFlow("npc%2Fbob", { scene: "s" });
    const keys = Object.keys(registry.save()).filter((k) => k.startsWith("patter/flow/"));
    expect(keys.sort()).toEqual([
      "patter/flow/npc%252Fbob/patter", "patter/flow/npc%252Fbob/scene/s",
      "patter/flow/npc%2Fbob/patter", "patter/flow/npc%2Fbob/scene/s",
    ]);
  });

  it("removes a flow's bags when it closes, and reopening a name starts it fresh", () => {
    const { registry, patter } = game();
    playOut(patter.openFlow("f", { scene: "s" }));
    patter.closeFlow("f");
    expect(Object.keys(registry.save()).some((k) => k.startsWith("patter/flow/f/"))).toBe(false);

    // Values a load left waiting for "f" belong to the saved flow, not to a new one of the same name.
    registry.load({ ...registry.save(), "patter/flow/f/scene/s": { count: 9 } });
    const fresh = patter.openFlow("f", { scene: "s" });
    expect(fresh.getProperty("@scene.count")).toBe(0);
  });

  it("reset drops Patter's waiting values and no other engine's", () => {
    const { registry, patter } = game();
    registry.load({ ...registry.save(), "patter/scene/elsewhere": { tally: 3 }, "other/deck/inn": { drawn: 1 } });
    patter.reset();
    const saved = registry.save();
    expect(saved["patter/scene/elsewhere"]).toBeUndefined();
    expect(saved["other/deck/inn"]).toEqual({ drawn: 1 });
  });

  it("hotSwap hands every bag to the replacement on the same registry", () => {
    const { registry, patter } = game();
    const flow = patter.openFlow("f", { scene: "s" });
    playOut(flow);
    const next = patter.hotSwap(bundle);
    expect(flow.isClosed).toBe(true);                     // the old engine is spent
    expect(next.getProperty("@fame")).toBe(1);
    expect(next.getFlow("f")!.getProperty("@mood")).toBe(2);
    expect(next.getFlow("f")!.getProperty("@scene.tally")).toBe(1);
    expect(registry.listProperties().filter((r) => r.scope === "patter")).toHaveLength(1);
    expect(next.saveGame().registry).toBeUndefined();    // still the game's registry to save
  });

  it("a standalone engine's hotSwap keeps its self-backed @world and keeps saving it", () => {
    const patter = new Engine(bundle, { seed: 1 });
    playOut(patter.openFlow("f", { scene: "s" }));
    const next = patter.hotSwap(bundle);
    expect(next.getProperty("@world.gold")).toBe(5);
    expect(next.saveGame().registry?.world).toEqual({ gold: 5 });
  });
});
