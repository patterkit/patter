// ---------------------------------------------------------------------------
// Cross-engine integration: a Patter project validating + running against a
// FOREIGN scope (`@world`) declared by another owner's `scopeRegistrySpec`
// (e.g. a storylet's published bundle). Exercises the full loop with the real
// packages: scoperegistry (read the spec), dialect/compiler (parse + validate +
// compile cross-engine refs), and runtime (evaluate through a host resolver,
// enforce per-property read-only). This is Phase D in miniature: one registry,
// owned (Patter) + foreign (storylet) scopes, feeding both validation and play.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
import { exportBundle, validateConditions } from "@patterkit/compiler";
import { readScopeRegistrySpec } from "@wildwinter/scoperegistry";
import type { ScopeResolver } from "@wildwinter/scoperegistry";
import type { ScalarValue } from "@wildwinter/expr";
import type { ProjectFile, Scene, LocaleFile } from "@patterkit/model";

// A storylet's published bundle carries its scope declarations under the
// well-known `scopeRegistrySpec` key. `@world.gold` is writable; `@world.locked`
// is read-only to a foreign engine (e.g. a capability-restricted system prop).
const storyworldBundle = {
  storyletsVersion: "2.3",
  scopeRegistrySpec: {
    version: 1,
    scopes: [
      {
        token: "world",
        declarations: [
          { name: "gold", type: "number" },
          { name: "locked", type: "number", writable: false },
        ],
      },
    ],
  },
};

const spec = readScopeRegistrySpec(storyworldBundle)!;

const project: ProjectFile = {
  schema: "patter/project@0",
  project: { id: "p", name: "P" },
  locales: { default: "en", all: ["en"] },
  properties: [{ name: "hp", type: "number", shared: true, default: 10 }],
  cast: [{ name: "NPC" }],
  // The project declares its own @world properties (gold writable, locked read-only); these bake into
  // the bundle's scopeRegistry, so a bound world resolver still gets read-only enforcement at runtime.
  scopeRegistry: {
    version: 1,
    scopes: [{ token: "world", declarations: [
      { name: "gold", type: "number" },
      { name: "locked", type: "number", writable: false },
    ] }],
  },
};

describe("cross-engine: validation against a foreign scopeRegistrySpec", () => {
  // onEntry writes to a writable foreign prop (ok) and a read-only one (flagged);
  // conditions reference a known foreign prop (ok) and an unknown one (flagged).
  const scene: Scene = {
    id: "val", type: "scene", name: "Val",
    onEntry: [
      { kind: "set", target: "@world.gold", value: "@world.gold + 1" },
      { kind: "set", target: "@world.locked", value: "1" },
    ],
    blocks: [{
      id: "b", type: "block", name: "B",
      children: [
        { id: "s_ok", type: "snippet", condition: "@world.gold > @hp", jump: { to: "END" } },
        { id: "s_bad", type: "snippet", condition: "@world.unknown > 0", jump: { to: "END" } },
      ],
    }],
  };

  it("permits + checks foreign refs and flags writes to a read-only foreign prop", () => {
    const issues = validateConditions({ project, scenes: [scene] }, { foreignScopes: spec });
    // The known foreign ref (mixed with an owned @hp) is clean.
    expect(issues.some((i) => i.src === "@world.gold > @hp")).toBe(false);
    // The unknown foreign property is flagged.
    expect(issues.some((i) => i.src === "@world.unknown > 0")).toBe(true);
    // The write to the read-only foreign property is rejected at validation.
    expect(issues.some((i) => i.src === "@world.locked" && /read-only/.test(i.message))).toBe(true);
    // ...and the write to the writable one is not.
    expect(issues.some((i) => i.field === "onEntry.set" && i.src === "@world.gold")).toBe(false);
  });

  it("rejects foreign refs entirely when no spec is supplied (unregistered scope)", () => {
    const issues = validateConditions({ project, scenes: [scene] });
    // Without the spec the parser does not know `@world`, so the ref errors.
    expect(issues.some((i) => i.src === "@world.gold > @hp")).toBe(true);
  });
});

describe("cross-engine: runtime evaluation through a host resolver", () => {
  // A snippet gated on a foreign-vs-owned comparison, whose onEnter writes back
  // into the foreign scope through the host resolver.
  const scene: Scene = {
    id: "play", type: "scene", name: "Play",
    blocks: [{
      id: "b", type: "block", name: "B",
      children: [{
        id: "sn", type: "snippet",
        condition: "@world.gold > @hp",
        // Write back into the foreign scope when the snippet finishes (onExit
        // fires after its beats, on the advance that follows the line).
        onExit: [{ kind: "set", target: "@world.gold", value: "@world.gold + 1" }],
        beats: [{ id: "L", kind: "line", character: "NPC" }],
        jump: { to: "END" },
      }],
    }],
  };
  const en: LocaleFile = { schema: "patter/strings@0", scene: "play", locale: "en", strings: { L: "Hi." } };
  const bundle = exportBundle({ project, scenes: [scene], locales: [en], foreignScopes: spec });

  function engineFor(world: Record<string, ScalarValue>) {
    const resolver: ScopeResolver = {
      get: (n) => world[n],
      set: (n, v) => { world[n] = v; },
    };
    return new Engine(bundle, { world: resolver });
  }

  it("evaluates a mixed owned+foreign condition and writes back through the resolver", () => {
    const world: Record<string, ScalarValue> = { gold: 42, locked: 1 };
    const engine = engineFor(world);
    const flow = engine.openFlow("main", { scene: "play" });

    // The foreign value is read live through the resolver.
    expect(engine.getProperty("@world.gold")).toBe(42);

    // gold(42) > hp(10): the gated snippet is eligible and its line plays.
    expect(flow.advance()).toMatchObject({ type: "line", id: "L", character: "NPC" });

    // Advancing past the line runs onExit, writing @world.gold + 1 back into the
    // host's world state through the resolver.
    expect(flow.advance()).toEqual({ type: "end" });
    expect(world.gold).toBe(43);
    expect(engine.getProperty("@world.gold")).toBe(43);
  });

  it("a foreign-gated snippet is skipped when the foreign condition fails", () => {
    const engine = engineFor({ gold: 5, locked: 1 }); // gold(5) > hp(10) is false
    const flow = engine.openFlow("main", { scene: "play" });
    expect(flow.advance()).toEqual({ type: "end" });
  });

  it("enforces per-property read-only on foreign writes (declared writable:false)", () => {
    const world: Record<string, ScalarValue> = { gold: 42, locked: 1 };
    const engine = engineFor(world);
    const flow = engine.openFlow("main", { scene: "play" });

    // Writable foreign prop: the write reaches the host.
    engine.setProperty("@world.gold", 100);
    expect(world.gold).toBe(100);

    // Read-only foreign prop: rejected even though the resolver has a setter.
    expect(() => engine.setProperty("@world.locked", 9)).toThrow(/read-only/);
    expect(world.locked).toBe(1);
  });
});
