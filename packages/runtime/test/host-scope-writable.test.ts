// A host-scope declaration's `writable: false` is the STORY's promise, refused by the engine whether
// the scope is bound by the game or self-backed. This runtime has always done so (the registry wraps
// every foreign resolver with the declared flags); the three native ports let a bound scope's write
// straight through until 2026-09-03, which the Unreal wrapper work found
// (from-storylets/unreal-wrapper-host-scopes). Each port's harness now pins the same two cases with
// the same sentence, and this is the reference they match, written out so the contract is in one
// place rather than implied by a registry test.
//
// Distinct from a per-name read-only a GAME keeps on its own container (UPatterWorld.SetReadOnly and
// its kin), which that container refuses itself. Two rules, two owners.
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
  ] }],
};
const en: LocaleFile = { schema: "patter/strings@0", scene: "s", locale: "en", strings: { T: "hi" } };
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

  it("refuses the host's own write through the engine too, and lets a writable name through", () => {
    const { engine } = make();
    expect(() => engine.setProperty("@world.clock", "night")).toThrow("is read-only");
    engine.setProperty("@world.known", true);
    expect(engine.getProperty("@world.known")).toBe(true);
  });
});
