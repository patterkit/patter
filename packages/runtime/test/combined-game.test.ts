// ---------------------------------------------------------------------------
// Phase D - the combined-game reference harness: a single shared narrative state
// container across two engines, with one unified save/load blob.
//
// Shape of a real combined game: a storylet engine (flow / draw-play) and a
// Patter engine (spoken scenes) run side by side and share world state. Here the
// shared `@world` lives in ONE `ScopeRegistry` instance (the container); both
// sides read/write it LIVE:
//   - the "storylet side" owns @world and reads/writes it directly on the registry
//     (modelled by a small stand-in below; in production this is the storylet
//     engine's WorldContext, bridged through the same resolver);
//   - the Patter engine sees @world as a FOREIGN scope, bridged to the shared
//     registry by a resolver, alongside its own owned shared `@patter` globals.
//
// One unified save blob carries every owner's owned scopes:
//   { world: <shared>, patter: <Patter shared @patter globals>, ... }
// Foreign/host state is saved once at its source (the shared container), never
// duplicated per engine. Restore feeds each section back to its owner and both
// engines resume against consistent state.
//
// Content-drift policy (scoperegistry `load`): values for known properties are
// restored; properties added since the save keep their seeded defaults; values
// for properties that no longer exist are dropped on the floor. So a save taken
// against an older content version loads forward without error.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
import type { EngineSave } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import { ScopeRegistry, readScopeRegistrySpec } from "@wildwinter/scoperegistry";
import type { ScopeResolver } from "@wildwinter/scoperegistry";
import type { ProjectFile, Scene, LocaleFile } from "@patterkit/model";

// The storylet's published bundle declares its global scopes; the foreign engine
// reads them to validate + wire the shared container.
const storyworldBundle = {
  storyletsVersion: "2.3",
  scopeRegistrySpec: {
    version: 1,
    scopes: [{ token: "world", declarations: [
      { name: "gold", type: "number" },
      { name: "reputation", type: "number" },
    ] }],
  },
};
const spec = readScopeRegistrySpec(storyworldBundle)!;
const worldDecls = spec.scopes.find((s) => s.token === "world")!.declarations!;

// A Patter project: scene reads @world.gold (shared), gates on it, and on exit
// both spends from @world.gold (shared) and bumps its own @patter.visits (owned).
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
      condition: "@world.gold >= 10",
      onExit: [
        { kind: "set", target: "@world.gold", value: "@world.gold - 10" },     // shared write
        { kind: "set", target: "@visits", value: "@visits + 1" },              // owned write
      ],
      beats: [{ id: "L", kind: "line", character: "MERCHANT" }],
      jump: { to: "END" },
    }],
  }],
};
const en: LocaleFile = { schema: "patter/strings@0", scene: "shop", locale: "en", strings: { L: "A fine blade." } };
const bundle = exportBundle({ project, scenes: [scene], locales: [en], foreignScopes: spec });

// The shared container + a Patter engine bound to its @world. The container is
// the single source of truth for cross-engine world state.
function combinedGame() {
  const container = new ScopeRegistry().defineOwned("world", worldDecls);
  const worldResolver: ScopeResolver = {
    get: (n) => container.get("world", n),
    set: (n, v) => container.set("world", n, v),
  };
  const patter = new Engine(bundle, { world: worldResolver });
  return { container, patter };
}

// One blob from every owner; foreign @world is saved once, at the container.
function saveAll(container: ScopeRegistry, patter: Engine): EngineSave {
  return { ...container.save(), ...patter.save() };
}

describe("Phase D: combined-game shared container + unified save", () => {
  it("both engines read/write one shared @world live", () => {
    const { container, patter } = combinedGame();
    container.set("world", "gold", 25); // the storylet side stocks the world

    const flow = patter.openFlow("main", { scene: "shop" });
    // Patter reads the shared value through the container.
    expect(patter.getProperty("@world.gold")).toBe(25);
    // gold(25) >= 10: the gated line plays.
    expect(flow.advance()).toMatchObject({ type: "line", id: "L", character: "MERCHANT" });
    // onExit fires on the next advance: spends shared gold + bumps owned visits.
    expect(flow.advance()).toEqual({ type: "end" });

    // The shared write is visible to the storylet side on the same container.
    expect(container.get("world", "gold")).toBe(15);
    expect(patter.getProperty("@world.gold")).toBe(15);
    // The owned write landed in Patter's own scope, not the shared one.
    expect(patter.getProperty("@visits")).toBe(1);
  });

  it("saves all narrative state to one blob and resumes both engines", () => {
    // --- session 1: play once, then save everything ---
    const g1 = combinedGame();
    g1.container.set("world", "gold", 25);
    g1.container.set("world", "reputation", 3);
    const f1 = g1.patter.openFlow("main", { scene: "shop" });
    f1.advance(); // line
    f1.advance(); // end -> onExit: gold 25->15, visits 0->1

    const blob = saveAll(g1.container, g1.patter);
    // One blob, every owner's owned scopes; no foreign duplication.
    expect(blob.world).toEqual({ gold: 15, reputation: 3 });
    expect(blob.patter).toEqual({ visits: 1 });

    // --- session 2: fresh engines, restore the blob, resume ---
    const g2 = combinedGame();
    g2.container.load(blob);          // storylet side restores @world
    g2.patter.load(blob);             // restore Patter's owned scopes (@patter)
    const f2 = g2.patter.openFlow("main", { scene: "shop" }); // resume at the saved position

    // Restored shared + owned state is intact and consistent across both sides.
    expect(g2.container.get("world", "gold")).toBe(15);
    expect(g2.patter.getProperty("@world.gold")).toBe(15);
    expect(g2.patter.getProperty("@visits")).toBe(1);

    // gold(15) >= 10 still holds, so a second purchase proceeds on restored state.
    expect(f2.advance()).toMatchObject({ type: "line", id: "L" });
    expect(f2.advance()).toEqual({ type: "end" });
    expect(g2.container.get("world", "gold")).toBe(5); // 15 - 10
    expect(g2.patter.getProperty("@visits")).toBe(2);  // 1 + 1
  });

  it("loads a save forward across content drift (lenient by design)", () => {
    // A blob from older content: an extra world prop that no longer exists, and
    // missing the newer `reputation` (which keeps its seeded default).
    const stale: EngineSave = { world: { gold: 7, retired_flag: 1 }, patter: { visits: 9 } };
    const { container, patter } = combinedGame();
    container.load(stale);
    patter.load(stale); // @patter restore needs no open flow

    expect(container.get("world", "gold")).toBe(7);           // known -> restored
    expect(container.get("world", "reputation")).toBe(0);     // newer prop -> default
    expect(container.get("world", "retired_flag")).toBe(1);   // unknown -> tolerated, not fatal
    expect(patter.getProperty("@visits")).toBe(9);
  });
});
