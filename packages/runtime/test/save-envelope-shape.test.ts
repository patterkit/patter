// The save envelope's SHAPE, pinned deliberately rather than incidentally.
//
// Property values are plain `Record<string, Record<string, ScalarValue>>` sections keyed by
// registry key, and games have saves on disk written that way. They are backed by
// @wildwinter/scoperegistry's PropertyBag, and a PropertyBag is an OBJECT: serialise it
// directly and the envelope gains `_decls`, `_subscribers` and the rest, or loses the bare
// shape entirely.
//
// Other tests reach into these bags to check behaviour (scene-local, shared-scene). None
// of them asserts the envelope is still the shape a save on disk has. This one does, and
// it loads saves written out by hand, in today's version 3 and in the version 2 that games
// shipped before the registry held the properties - which is the check that cannot be
// satisfied by a refactor that changes both the writer and the reader together.
import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
import { ScopeRegistry } from "@wildwinter/scoperegistry";
import { exportBundle } from "@patterkit/compiler";
import type { ProjectFile, Scene, LocaleFile } from "@patterkit/model";

const project: ProjectFile = {
  schema: "patter/project@0", project: { id: "p", name: "P" },
  locales: { default: "en", all: ["en"] },
  properties: [{ name: "gold", type: "number", default: 0, shared: true }],
};
const scene: Scene = {
  id: "s", type: "scene", name: "S", gameId: "s",
  sceneProps: [
    { name: "count", type: "number", default: 0, shared: false },   // -> flow.sceneBags
    { name: "tally", type: "number", default: 0, shared: true },    // -> engine.stageBags
  ],
  blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "sn", type: "snippet", beats: [{ id: "L", kind: "text" }],
      onExit: [
        { kind: "set", target: "@scene.count", value: "1" },
        { kind: "set", target: "@scene.tally", value: "2" },
        { kind: "set", target: "@gold", value: "7" },
      ], jump: { to: "END" } },
  ] }],
};
const en: LocaleFile = { schema: "patter/strings@0", scene: "s", locale: "en", strings: { L: "hi" } };
const bundle = exportBundle({ project, scenes: [scene], locales: [en] });

const played = () => {
  const engine = new Engine(bundle, { seed: 0 });
  const flow = engine.openFlow("f", { scene: "s", block: "b" });
  for (let i = 0; i < 10 && flow.advance().type !== "end"; i++) { /* play it out */ }
  return engine;
};

describe("the save envelope's shape", () => {
  it("writes every bag as a PLAIN record of bare scalars, under its registry key", () => {
    const save = JSON.parse(JSON.stringify(played().saveGame()));

    // A standalone engine made its own registry, so its values ride in the save. Plain objects:
    // no class, no private fields, no wrapper, and nothing else beside the values.
    expect(save.version).toBe(3);
    expect(save.registry).toEqual({
      patter: { gold: 7 },
      "patter/flow/f/patter": {},
      "patter/flow/f/scene/s": { count: 1 },
      "patter/scene/s": { tally: 2 },
    });
    // A flow's snapshot holds no properties: those are the registry's.
    expect(Object.keys(save.flows.f).sort()).toEqual(["cursor", "rngState", "visits"]);
    expect(Object.keys(save).sort()).toEqual(["flows", "registry", "sharedSelectors", "sharedVisits", "version"]);
  });

  it("leaves the values out when the game passed the registry: the game saves it once", () => {
    const registry = new ScopeRegistry();
    const engine = new Engine(bundle, { seed: 0, registry });
    const flow = engine.openFlow("f", { scene: "s", block: "b" });
    for (let i = 0; i < 10 && flow.advance().type !== "end"; i++) { /* play it out */ }
    const save = JSON.parse(JSON.stringify(engine.saveGame()));
    expect(save.registry).toBeUndefined();
    expect(registry.save()).toEqual(JSON.parse(JSON.stringify(played().saveGame())).registry);
  });

  it("round-trips through JSON with the values intact", () => {
    const before = played();
    const blob = JSON.parse(JSON.stringify(before.saveGame()));
    const after = new Engine(bundle, { seed: 0 });
    after.loadGame(blob);
    expect(after.getProperty("@gold")).toBe(7);
    expect(JSON.parse(JSON.stringify(after.saveGame()))).toEqual(blob);
  });

  it("loads a save written by HAND in today's format (version 3)", () => {
    // Written out here rather than produced by saveGame(), so a change that alters the
    // writer and the reader together cannot satisfy it. This is what a player's save
    // looks like on disk.
    const onDisk = {
      version: 3,
      registry: {
        patter: { gold: 7 },
        "patter/flow/f/patter": {},
        "patter/flow/f/scene/s": { count: 1 },
        "patter/scene/s": { tally: 2 },
      },
      sharedVisits: { s: 1, b: 1, sn: 1 },
      sharedSelectors: {},
      flows: {
        f: {
          rngState: 0,
          visits: { s: 1, b: 1, sn: 1 },
          cursor: {
            flowEnded: true, currentSceneId: "s", stack: [], activeSnippetId: null,
            beatIndex: 0, pendingChoice: null, pendingPromptOwnerId: null, selectors: {},
          },
        },
      },
    };
    const engine = new Engine(bundle, { seed: 0 });
    engine.loadGame(onDisk as never);
    expect(engine.getProperty("@gold")).toBe(7);
    expect(engine.getFlow("f")!.getProperty("@scene.count")).toBe(1);
    expect(engine.getFlow("f")!.getProperty("@scene.tally")).toBe(2);
    expect(JSON.parse(JSON.stringify(engine.saveGame()))).toEqual(onDisk);
  });

  it("loads a version 2 save written by HAND, moving its values into the registry", () => {
    // The shape every runtime wrote before the registry held the properties. Players have these
    // on disk; they must keep loading.
    const onDisk = {
      version: 2,
      shared: { patter: { gold: 7 } },
      sharedVisits: { s: 1, b: 1, sn: 1 },
      sharedSelectors: {},
      stageBags: { s: { tally: 2 } },
      flows: {
        f: {
          scopes: { patter: {} },
          sceneBags: { s: { count: 1 } },
          rngState: 0,
          visits: { s: 1, b: 1, sn: 1 },
          cursor: {
            flowEnded: true, currentSceneId: "s", stack: [], activeSnippetId: null,
            beatIndex: 0, pendingChoice: null, pendingPromptOwnerId: null, selectors: {},
          },
        },
      },
    };
    const engine = new Engine(bundle, { seed: 0 });
    expect(() => engine.loadGame(onDisk as never)).not.toThrow();
    expect(engine.getProperty("@gold")).toBe(7);
    expect(engine.getFlow("f")!.getProperty("@scene.count")).toBe(1);
    const back = JSON.parse(JSON.stringify(engine.saveGame()));
    expect(back.version).toBe(3);
    expect(back.registry).toEqual({
      patter: { gold: 7 },
      "patter/flow/f/patter": {},
      "patter/flow/f/scene/s": { count: 1 },
      "patter/scene/s": { tally: 2 },
    });
  });

  it("moves a version 2 save into a registry the game supplied, beside values the game already loaded", () => {
    const registry = new ScopeRegistry();
    registry.load({ "another-engine/deck/inn": { drawn: 3 } }); // the game's own load, waiting for its engine
    const engine = new Engine(bundle, { seed: 0, registry });
    engine.loadGame({
      version: 2, shared: { patter: { gold: 7 } }, sharedVisits: {}, sharedSelectors: {},
      stageBags: { s: { tally: 2 } },
      flows: { f: {
        scopes: { patter: {} }, sceneBags: { s: { count: 1 } }, rngState: 0, visits: {},
        cursor: { flowEnded: true, currentSceneId: "s", stack: [], activeSnippetId: null, beatIndex: 0, pendingChoice: null, selectors: {} },
      } },
    } as never);
    expect(engine.getFlow("f")!.getProperty("@scene.count")).toBe(1);
    expect(registry.save()).toEqual({
      patter: { gold: 7 },
      "patter/flow/f/patter": {},
      "patter/flow/f/scene/s": { count: 1 },
      "patter/scene/s": { tally: 2 },
      "another-engine/deck/inn": { drawn: 3 },
    });
  });
});
