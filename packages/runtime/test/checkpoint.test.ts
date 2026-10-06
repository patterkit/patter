// Checkpoints: the host-surface half of the contract the conformance corpus pins (what a rollback puts
// back is there, on all four runtimes). Here: the calls refused while one is open, one at a time, a game's
// own `@world` store written back on rollback, a commit that keeps, and a live Flow.restore that leaves the
// flow's property values alone.
import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import type { ProjectFile, Scene, LocaleFile } from "@patterkit/model";

const project: ProjectFile = {
  schema: "patter/project@0", project: { id: "p", name: "P" },
  locales: { default: "en", all: ["en"] },
  properties: [
    { name: "count", type: "number", default: 0 },
    { name: "mine", type: "number", default: 0, shared: false },
  ],
  scopeRegistry: { version: 1, scopes: [{ token: "world", declarations: [{ name: "alarms", type: "number", default: 0 }] }] },
};
const scene: Scene = {
  id: "s", type: "scene", name: "S", gameId: "s",
  blocks: [
    { id: "b", type: "block", name: "B", children: [
      { id: "sn", type: "snippet", beats: [{ id: "T", kind: "text" }],
        onEnter: [
          { kind: "set", target: "@count", value: "@count + 1" },
          { kind: "set", target: "@mine", value: "@mine + 1" },
          { kind: "set", target: "@world.alarms", value: "@world.alarms + 1" },
        ] },
      { id: "sn2", type: "snippet", beats: [{ id: "T2", kind: "text" }], jump: { to: "END" } },
    ] },
  ],
};
const en: LocaleFile = { schema: "patter/strings@0", scene: "s", locale: "en", strings: { T: "t", T2: "t2" } };
const bundle = exportBundle({ project, scenes: [scene], locales: [en] });

describe("checkpoints", () => {
  it("allow one at a time, and only the open one can be closed", () => {
    const engine = new Engine(bundle);
    const cp = engine.checkpoint();
    expect(engine.inCheckpoint).toBe(true);
    expect(() => engine.checkpoint()).toThrow("already open");
    engine.commit(cp);
    expect(engine.inCheckpoint).toBe(false);
    expect(() => engine.rollback(cp)).toThrow("not the open one");
  });

  it("refuse the calls a rollback couldn't undo", () => {
    const engine = new Engine(bundle);
    const flow = engine.openFlow("f", { scene: "s" });
    const snap = flow.snapshot();
    const cp = engine.checkpoint();
    expect(() => engine.reset()).toThrow("checkpoint");
    expect(() => engine.closeFlow("f")).toThrow("checkpoint");
    expect(() => engine.loadGame(engine.saveGame())).toThrow("checkpoint");
    expect(() => engine.hotSwap(bundle)).toThrow("checkpoint");
    expect(() => engine.openFlow("f", { scene: "s" })).toThrow("checkpoint");
    expect(() => flow.reset()).toThrow("checkpoint");
    expect(() => flow.restore(snap)).toThrow("checkpoint");
    engine.rollback(cp);
    expect(engine.getFlow("f")).toBe(flow);
  });

  it("write a game's own @world store back on rollback, and keep everything on commit", () => {
    const store = new Map<string, unknown>([["alarms", 0]]);
    const engine = new Engine(bundle, { hostScopes: { world: { get: (n) => store.get(n) as never, set: (n, v) => { store.set(n, v); } } } });
    let cp = engine.checkpoint();
    engine.openFlow("f", { scene: "s" }).advance();
    expect(store.get("alarms")).toBe(1);
    engine.rollback(cp);
    expect(store.get("alarms")).toBe(0);
    expect(engine.getProperty("@count")).toBe(0);
    expect(engine.getFlow("f")).toBeUndefined();

    cp = engine.checkpoint();
    engine.openFlow("f", { scene: "s" }).advance();
    engine.commit(cp);
    expect(store.get("alarms")).toBe(1);
    expect(engine.getProperty("@count")).toBe(1);
    expect(engine.getFlow("f")?.getProperty("@mine")).toBe(1);
  });

  it("let a live Flow.restore keep the flow's own property values", () => {
    const engine = new Engine(bundle);
    const flow = engine.openFlow("f", { scene: "s" });
    const snap = flow.snapshot();
    flow.advance();
    expect(flow.getProperty("@mine")).toBe(1);
    flow.restore(snap);
    expect(flow.getProperty("@mine")).toBe(1); // a snapshot holds the cursor, not the values
  });
});
