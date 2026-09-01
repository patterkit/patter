// The save envelope's SHAPE, pinned deliberately rather than incidentally.
//
// `sceneBags` and `stageBags` are plain `Record<string, Record<string, ScalarValue>>`
// in the envelope, and games have saves on disk written that way. They are about to be
// backed by @wildwinter/scoperegistry's PropertyBag instead of hand-rolled maps, and a
// PropertyBag is an OBJECT: serialise it directly and the envelope gains `_decls`,
// `_subscribers` and the rest, or loses the bare shape entirely.
//
// Other tests reach into these bags to check behaviour (scene-local, shared-scene). None
// of them asserts the envelope is still the shape a save on disk has. This one does, and
// it loads a save written out by hand TODAY - which is the check that cannot be satisfied
// by a refactor that changes both the writer and the reader together.
import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
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
  it("writes scene and stage bags as PLAIN records of bare scalars", () => {
    const save = JSON.parse(JSON.stringify(played().saveGame()));

    // Plain objects: no class, no private fields, no wrapper.
    expect(save.flows.f.sceneBags).toEqual({ s: { count: 1 } });
    expect(save.stageBags).toEqual({ s: { tally: 2 } });

    // And nothing else has crept in beside the values.
    expect(Object.keys(save.flows.f.sceneBags.s)).toEqual(["count"]);
    expect(Object.keys(save.stageBags.s)).toEqual(["tally"]);
  });

  it("round-trips through JSON with the values intact", () => {
    const before = played();
    const blob = JSON.parse(JSON.stringify(before.saveGame()));
    const after = new Engine(bundle, { seed: 0 });
    after.loadGame(blob);
    expect(after.getProperty("@gold")).toBe(7);
    expect(JSON.parse(JSON.stringify(after.saveGame()))).toEqual(blob);
  });

  it("loads a save written by HAND in today's format", () => {
    // Written out here rather than produced by saveGame(), so a change that alters the
    // writer and the reader together cannot satisfy it. This is what a player's save
    // looks like on disk.
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
    const back = JSON.parse(JSON.stringify(engine.saveGame()));
    expect(back.stageBags).toEqual({ s: { tally: 2 } });
    expect(back.flows.f.sceneBags).toEqual({ s: { count: 1 } });
  });
});
