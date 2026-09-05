// A host-scope declaration's `writable: false` is the STORY's promise, and ONLY the story's: the
// engine refuses an effect's write, bound or self-backed, and lets the GAME write the value it owns.
//
// The refusal half has always been here (the registry wraps every foreign resolver with the declared
// flags); the three native ports let a bound scope's write straight through until 2026-09-03
// (from-storylets/unreal-wrapper-host-scopes). The permission half is newer: until 2026-09-05 the
// shared kernel refused EVERY caller, so a game could not move its own clock through
// `setProperty` - which blocked this project's coverage driver and the Storylet Engine's venue
// content alike (from-storylets/host-writes-to-read-only-world). The kernel now takes a host
// authority on `set`, and this runtime passes it from its host surfaces and never from an effect.
//
// Distinct again from a per-name read-only a GAME keeps on its own container (UPatterWorld.SetReadOnly
// and its kin), which that container refuses itself. Three rules, and each says whose it is.
import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import type { ProjectFile, Scene, LocaleFile } from "@patterkit/model";

const project: ProjectFile = {
  schema: "patter/project@0", project: { id: "p", name: "P" },
  locales: { default: "en", all: ["en"] },
  scopeRegistry: { version: 1, scopes: [{ token: "world", declarations: [
    { name: "clock", type: "string", default: "day", writable: false },
    { name: "known", type: "boolean", default: false },
  ] }] },
};
const scene: Scene = {
  id: "s", type: "scene", name: "S", gameId: "s",
  blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "sn", type: "snippet", beats: [{ id: "T", kind: "text" }],
      onEnter: [
        { kind: "set", target: "@world.known", value: "true" },
        { kind: "set", target: "@world.clock", value: '"night"' },
      ], jump: { to: "END" } },
  ] },
  // A block whose snippet writes nothing, so a flow can be opened without meeting the refusal.
  { id: "quiet", type: "block", name: "Quiet", children: [
    { id: "sn_q", type: "snippet", beats: [{ id: "Q", kind: "text" }], jump: { to: "END" } },
  ] }],
};
const en: LocaleFile = { schema: "patter/strings@0", scene: "s", locale: "en", strings: { T: "hi", Q: "quiet" } };
const bundle = exportBundle({ project, scenes: [scene], locales: [en] });

describe.each([
  ["self-backed", () => ({ engine: new Engine(bundle), store: undefined })],
  ["bound", () => {
    // A bound scope has no defaults: the GAME owns its values and seeds them itself.
    const store = new Map<string, unknown>([["clock", "day"], ["known", false]]);
    const engine = new Engine(bundle, { world: { get: (n) => store.get(n) as never, set: (n, v) => { store.set(n, v); } } });
    return { engine, store };
  }],
])("a writable:false host declaration, %s", (_label, make) => {
  it("refuses the story's write, with the family's sentence, and leaves the value alone", () => {
    const { engine, store } = make();
    // The refusal surfaces from openFlow: a flow settles into its first snippet on open and runs that
    // snippet's effects there, before any advance.
    expect(() => engine.openFlow("main", { scene: "s", block: "b" })).toThrow("'@world.clock' is read-only");
    expect(engine.getProperty("@world.clock")).toBe("day");
    if (store) expect(store.get("clock")).toBe("day");
  });

  it("lets the GAME write it through the engine: the flag binds the story, not its owner", () => {
    const { engine, store } = make();
    engine.setProperty("@world.clock", "night");
    expect(engine.getProperty("@world.clock")).toBe("night");
    if (store) expect(store.get("clock")).toBe("night"); // a bound resolver's set really is called
    engine.setProperty("@world.known", true);
    expect(engine.getProperty("@world.known")).toBe(true);
  });

  it("lets the game write it through an open flow's surface too", () => {
    // Flow.setProperty is the same host surface; the story's effects take the other path.
    const { engine } = make();
    const flow = engine.openFlow("f", { scene: "s", block: "quiet" });
    flow.setProperty("@world.clock", "dusk");
    expect(engine.getProperty("@world.clock")).toBe("dusk");
  });
});
