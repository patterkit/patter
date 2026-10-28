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
// it loads saves written out by hand, in today's version 4 and in the version 3 that games
// shipped before it - which is the check that cannot be satisfied by a refactor that changes
// both the writer and the reader together. Version 2 and older are no longer read (1.0).
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
    expect(save.version).toBe(4);
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

  it("loads a save written by HAND in today's format (version 4)", () => {
    // Written out here rather than produced by saveGame(), so a change that alters the
    // writer and the reader together cannot satisfy it. This is what a player's save
    // looks like on disk.
    const onDisk = {
      version: 4,
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
            pendingChoice: null, pendingPromptOwnerId: null, selectors: {},
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

  it("loads a version 3 save written by HAND, mid-snippet, and writes it back as version 4", () => {
    // Version 3 named the next beat by its index; version 4 names it by id.
    const onDisk = {
      version: 3,
      registry: { patter: { gold: 0 }, "patter/flow/f/patter": {}, "patter/flow/f/scene/s": { count: 0 }, "patter/scene/s": { tally: 0 } },
      sharedVisits: { s: 1, b: 1, sn: 1 },
      sharedSelectors: {},
      flows: {
        f: {
          rngState: 0,
          visits: { s: 1, b: 1, sn: 1 },
          cursor: {
            flowEnded: false, currentSceneId: "s", stack: [{ sceneId: "s", containerId: "b", index: 1 }], activeSnippetId: "sn",
            beatIndex: 0, pendingChoice: null, pendingPromptOwnerId: null, selectors: {},
          },
        },
      },
    };
    const engine = new Engine(bundle, { seed: 0 });
    engine.loadGame(onDisk as never);
    const back = JSON.parse(JSON.stringify(engine.saveGame()));
    expect(back.version).toBe(4);
    expect(back.flows.f.cursor).toEqual({
      flowEnded: false, currentSceneId: "s", stack: [{ sceneId: "s", containerId: "b", index: 1 }], activeSnippetId: "sn",
      beatId: "L", pendingChoice: null, pendingPromptOwnerId: null, selectors: {},
    });
    expect(engine.getFlow("f")!.advance()).toMatchObject({ type: "text", id: "L" });
  });

  it("refuses a version 2 save, from before the registry held the properties", () => {
    const engine = new Engine(bundle, { seed: 0 });
    expect(() => engine.loadGame({
      version: 2, shared: { patter: { gold: 7 } }, sharedVisits: {}, sharedSelectors: {}, stageBags: {}, flows: {},
    } as never)).toThrow("unsupported save version: 2");
  });
});
