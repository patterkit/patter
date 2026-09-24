// ---------------------------------------------------------------------------
// The combined-game reference harness: ONE ScopeRegistry for the whole game,
// and one save.
//
// Shape of a real combined game: a storylet engine (draw and play) and a Patter
// engine (spoken scenes) run side by side and share world state. The game owns
// the registry and hands it to each engine. Here the "storylet side" is a small
// stand-in that registers its own game-wide scope (`@story`) the way an engine
// does; the real Storylet Engine is proven beside Patter in the storylets repo.
//
//   - The game registers `@world` itself, as a property the registry stores.
//   - Patter registers `@patter` and its per-flow and per-scene bags.
//   - Every expression reads every scope: Patter gates on `@story.act`.
//
// One save: `{ registry, patter }`. The registry's values are saved once, for
// every engine; Patter's part holds only what is not a property (cursors,
// visits, selectors). Loading works in either order, and across content drift
// (the bag's load rule: known properties restored, new ones keep defaults,
// vanished ones kept as strays).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
import type { SaveGame } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import { ScopeRegistry, readScopeRegistrySpec } from "@wildwinter/scoperegistry";
import type { ProjectFile, Scene, LocaleFile } from "@patterkit/model";

// The storylet's published bundle declares the scopes Patter may read; Patter compiles against it.
const storyworldBundle = {
  storyworldVersion: "2.3",
  scopeRegistrySpec: {
    version: 1,
    scopes: [
      { token: "world", declarations: [
        { name: "gold", type: "number" },
        { name: "reputation", type: "number" },
      ] },
      { token: "story", declarations: [{ name: "act", type: "number" }] },
    ],
  },
};
const spec = readScopeRegistrySpec(storyworldBundle)!;
const worldDecls = spec.scopes.find((s) => s.token === "world")!.declarations!;

// A Patter project: the purchase needs gold AND the second act; on exit it spends shared
// gold and bumps Patter's own shared `@patter.visits`.
const project: ProjectFile = {
  schema: "patter/project@0",
  project: { id: "p", name: "P" },
  locales: { default: "en", all: ["en"] },
  properties: [{ name: "visits", type: "number", shared: true, default: 0 }],
  cast: [{ name: "MERCHANT" }],
};
const scene: Scene = {
  id: "shop", type: "scene", name: "Shop",
  blocks: [{
    id: "b", type: "block", name: "B",
    children: [{
      id: "buy", type: "snippet",
      condition: "@world.gold >= 10 && @story.act >= 2",
      onExit: [
        { kind: "set", target: "@world.gold", value: "@world.gold - 10" },
        { kind: "set", target: "@visits", value: "@visits + 1" },
      ],
      beats: [{ id: "L", kind: "line", character: "MERCHANT" }],
      jump: { to: "END" },
    }],
  }],
};
const en: LocaleFile = { schema: "patter/strings@0", scene: "shop", locale: "en", strings: { L: "A fine blade." } };
const bundle = exportBundle({ project, scenes: [scene], locales: [en], foreignScopes: spec });

/** The storylet side, as far as this test needs it: an engine that registers its own scope. */
class StoryStandIn {
  constructor(readonly registry: ScopeRegistry) {
    registry.defineOwned("story", [{ name: "act", type: "number", default: 1 }], { normalise: (n) => n, owner: "Storylet Engine" });
  }
}

/** The game: one registry, `@world` registered by the game, then each engine. */
function combinedGame() {
  const registry = new ScopeRegistry().defineOwned("world", worldDecls, { owner: "Game" });
  const storylets = new StoryStandIn(registry);
  const patter = new Engine(bundle, { registry });
  return { registry, storylets, patter };
}

interface GameSave { registry: ReturnType<ScopeRegistry["save"]>; patter: SaveGame }
const saveAll = (g: ReturnType<typeof combinedGame>): GameSave =>
  JSON.parse(JSON.stringify({ registry: g.registry.save(), patter: g.patter.saveGame() }));

describe("combined game: one registry, one save", () => {
  it("both sides read and write one registry live, and each reads the other's scope", () => {
    const { registry, patter } = combinedGame();
    registry.set("world", "gold", 25, { host: true }); // the game stocks the world
    registry.set("story", "act", 2);                   // the storylet side moves the story on

    const flow = patter.openFlow("main", { scene: "shop" });
    expect(patter.getProperty("@story.act")).toBe(2);
    expect(flow.advance()).toMatchObject({ type: "line", id: "L", character: "MERCHANT" });
    expect(flow.advance()).toEqual({ type: "end" }); // onExit: spends gold, bumps visits

    expect(registry.get("world", "gold")).toBe(15);
    expect(registry.get("patter", "visits")).toBe(1);
  });

  it("saves the registry once, with every engine's properties, and Patter's save holds none", () => {
    const g = combinedGame();
    g.registry.set("world", "gold", 25, { host: true });
    g.registry.set("world", "reputation", 3, { host: true });
    g.registry.set("story", "act", 2);
    const f = g.patter.openFlow("main", { scene: "shop" });
    f.advance(); f.advance();

    const save = saveAll(g);
    expect(save.registry.world).toEqual({ gold: 15, reputation: 3 });
    expect(save.registry.story).toEqual({ act: 2 });
    expect(save.registry.patter).toEqual({ visits: 1 });
    expect(save.patter.registry).toBeUndefined();
    expect(JSON.stringify(save.patter)).not.toContain("reputation");
  });

  it("resumes both sides from the one save, loading the registry first or last", () => {
    const g1 = combinedGame();
    g1.registry.set("world", "gold", 25, { host: true });
    g1.registry.set("story", "act", 2);
    const f1 = g1.patter.openFlow("main", { scene: "shop" });
    f1.advance(); f1.advance();
    g1.patter.openFlow("main", { scene: "shop" }); // a fresh run at the gate, saved mid-flow
    const save = saveAll(g1);

    for (const registryFirst of [true, false]) {
      const g2 = combinedGame();
      if (registryFirst) g2.registry.load(save.registry);
      g2.patter.loadGame(save.patter);
      if (!registryFirst) g2.registry.load(save.registry);

      expect(g2.patter.getProperty("@world.gold")).toBe(15);
      expect(g2.patter.getProperty("@story.act")).toBe(2);
      expect(g2.patter.getProperty("@visits")).toBe(1);
      // gold(15) >= 10 and act 2: a second purchase proceeds on the restored state.
      const f2 = g2.patter.getFlow("main")!;
      expect(f2.advance()).toMatchObject({ type: "line", id: "L" });
      expect(f2.advance()).toEqual({ type: "end" });
      expect(g2.registry.get("world", "gold")).toBe(5);
      expect(g2.registry.get("patter", "visits")).toBe(2);
    }
  });

  it("loads a save forward across content drift (lenient by design)", () => {
    // A registry save from older content: a world property that no longer exists, none of the newer
    // `reputation`, and a section for an engine this build no longer runs.
    const stale = { world: { gold: 7, retired_flag: 1 }, patter: { visits: 9 }, story: { act: 3 }, retired_engine: { x: 1 } };
    const { registry, patter } = combinedGame();
    registry.load(stale);

    expect(registry.get("world", "gold")).toBe(7);         // known -> restored
    expect(registry.get("world", "reputation")).toBe(0);   // newer -> default
    expect(registry.get("world", "retired_flag")).toBe(1); // vanished -> kept as a stray, not fatal
    expect(patter.getProperty("@visits")).toBe(9);
    expect(registry.save().retired_engine).toEqual({ x: 1 }); // nobody claimed it: kept, until discarded
    registry.discardParked();
    expect(registry.save().retired_engine).toBeUndefined();
  });

  it("a clash between engines fails as the game combines them, naming who holds the token", () => {
    const registry = new ScopeRegistry();
    new StoryStandIn(registry);
    expect(() => new StoryStandIn(registry)).toThrow("scope '@story' is already registered by Storylet Engine");
  });
});
