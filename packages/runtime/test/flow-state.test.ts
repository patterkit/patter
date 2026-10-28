// captureFlow / restoreFlow: the host-surface half of the contract the conformance corpus pins (a restored flow
// carries on with its own values, on all four runtimes). Here: what restore refuses and that a refusal leaves
// nothing behind, a state that outlives a save and load, ids that need escaping, and the scene bags of scenes
// the flow has left (or hasn't yet re-entered after a load).
import { describe, it, expect } from "vitest";
import { Engine, type FlowState } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import type { ProjectFile, Scene, LocaleFile } from "@patterkit/model";

const project: ProjectFile = {
  schema: "patter/project@0", project: { id: "p", name: "P" },
  locales: { default: "en", all: ["en"] },
  properties: [{ name: "gold", type: "number", default: 0, shared: false }],
};
const s: Scene = {
  id: "s", type: "scene", name: "S", gameId: "s",
  sceneProps: [{ name: "mine", type: "number", default: 0, shared: false }],
  blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "sn", type: "snippet", beats: [{ id: "T", kind: "text" }], jump: { to: "t" },
      onEnter: [{ kind: "set", target: "@scene.mine", value: "7" }, { kind: "set", target: "@gold", value: "3" }] },
  ] }],
};
const t: Scene = {
  id: "t", type: "scene", name: "T", gameId: "t",
  blocks: [{ id: "b2", type: "block", name: "B2", children: [
    { id: "sn2", type: "snippet", beats: [{ id: "U", kind: "text" }, { id: "U2", kind: "text" }], jump: { to: "s" } },
  ] }],
};
const loc = (scene: string, strings: Record<string, string>): LocaleFile =>
  ({ schema: "patter/strings@0", scene, locale: "en", strings });
const bundle = exportBundle({
  project, scenes: [s, t],
  locales: [loc("s", { T: "mine {@scene.mine}, gold {@gold}" }), loc("t", { U: "u", U2: "u2" })],
});
const viaJson = <T>(data: T): T => JSON.parse(JSON.stringify(data)) as T;

/** A flow that has been through s (setting its values) and is part-way through t. */
function inT(engine: Engine, id = "f") {
  const flow = engine.openFlow(id, { scene: "s" });
  flow.advance();
  flow.advance();
  return flow;
}

describe("captureFlow / restoreFlow", () => {
  it("capture the flow's own values without its id, including a scene it has left", () => {
    const engine = new Engine(bundle);
    inT(engine, "npc/bob");
    const state = engine.captureFlow("npc/bob");
    expect(state.version).toBe(4);
    expect(state.scopes).toEqual({ patter: { gold: 3 } });
    expect(state.sceneBags["s"]).toEqual({ mine: 7 });
    expect(JSON.stringify(state)).not.toContain("npc");
  });

  it("restore under another id, escaped or not, and carry on with the flow's own values", () => {
    for (const id of ["g", "npc/alice", "100%"]) {
      const engine = new Engine(bundle);
      inT(engine, "npc/bob");
      const state = viaJson(engine.captureFlow("npc/bob"));
      engine.closeFlow("npc/bob");
      const flow = engine.restoreFlow(id, state);
      expect(engine.getFlow(id)).toBe(flow);
      expect(flow.advance()).toMatchObject({ type: "text", id: "U2" });
      expect(flow.advance()).toMatchObject({ type: "text", id: "T", text: "mine 7, gold 3" });
    }
  });

  it("outlive a save and load, including values parked for a scene the flow hasn't re-entered", () => {
    const first = new Engine(bundle);
    inT(first);
    const loaded = new Engine(bundle);
    loaded.loadGame(viaJson(first.saveGame()));
    const state = viaJson(loaded.captureFlow("f"));       // s's bag is still parked here
    expect(state.sceneBags["s"]).toEqual({ mine: 7 });
    loaded.closeFlow("f");
    const later = new Engine(bundle);
    later.loadGame(viaJson(loaded.saveGame()));          // a save with no flow in it
    const flow = later.restoreFlow("f", state);
    flow.advance();
    expect(flow.advance()).toMatchObject({ type: "text", id: "T", text: "mine 7, gold 3" });
  });

  it("drop what a load left waiting under the id, as a fresh start does", () => {
    const first = new Engine(bundle);
    inT(first);
    const loaded = new Engine(bundle);
    loaded.loadGame(viaJson(first.saveGame()));          // f's bag for s is parked, waiting for it to re-enter
    loaded.closeFlow("f");
    const elsewhere = new Engine(bundle);
    elsewhere.openFlow("g", { scene: "t" });             // never been in s
    const state = viaJson(elsewhere.captureFlow("g"));
    loaded.restoreFlow("f", state);
    expect(loaded.captureFlow("f").sceneBags["s"]).toBeUndefined();
  });

  it("leave nothing behind when a state won't restore", () => {
    const engine = new Engine(bundle);
    inT(engine);
    const state = viaJson(engine.captureFlow("f"));
    engine.closeFlow("f");
    const before = JSON.stringify(engine.saveGame());
    expect(() => engine.restoreFlow("f", { ...state, cursor: null } as unknown as FlowState)).toThrow("malformed flow state: no cursor");
    const badFrame = { ...state, cursor: { ...state.cursor, stack: [null] } } as unknown as FlowState;
    expect(() => engine.restoreFlow("f", badFrame)).toThrow();          // fails part way: cleaned up after
    expect(engine.getFlow("f")).toBeUndefined();
    expect(JSON.stringify(engine.saveGame())).toBe(before);
    expect(engine.restoreFlow("f", state).advance()).toMatchObject({ type: "text", id: "U2" });
  });

  it("refuse an unknown capture, an open id, a checkpoint, and an unknown version, leaving nothing behind", () => {
    const engine = new Engine(bundle);
    expect(() => engine.captureFlow("nope")).toThrow("no open flow 'nope'");
    inT(engine);
    const state = viaJson(engine.captureFlow("f"));
    const before = JSON.stringify(engine.saveGame());
    expect(() => engine.restoreFlow("f", state)).toThrow("already open");
    const cp = engine.checkpoint();
    expect(() => engine.restoreFlow("g", state)).toThrow("checkpoint");
    expect(engine.captureFlow("f")).toEqual(state);       // capturing only reads, so it's allowed
    engine.commit(cp);
    expect(() => engine.restoreFlow("g", { ...state, version: 99 } as unknown as FlowState))
      .toThrow("unsupported flow state version: 99");
    expect(JSON.stringify(engine.saveGame())).toBe(before);
    expect(engine.getFlow("g")).toBeUndefined();
  });
});
