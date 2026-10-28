// ---------------------------------------------------------------------------
// The runtime foundations before 1.0 (the hands-on review, 2026-10), where JS has more to say than the
// conformance corpus can carry: how a set-up report reaches the game and the decision log, the option keys a
// typed runtime can't be handed, a host write to `@scene` on a flow, and the gameData copies the static reads
// hand out. The corpus pins the rest on every runtime.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { Engine } from "@patterkit/runtime";
import type { EngineOptions, PlayError } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import type { ProjectFile, Scene, LocaleFile } from "@patterkit/model";

const project: ProjectFile = {
  schema: "patter/project@0", project: { id: "f", name: "F" },
  locales: { default: "en", all: ["en"] },
  scopeRegistry: { version: 1, scopes: [{ token: "world", declarations: [{ name: "alarm", type: "boolean", default: false }] }] },
};
const scene: Scene = {
  id: "s", type: "scene", name: "S", gameData: { music: "jig", moods: ["calm"] },
  sceneProps: [{ name: "knocks", type: "number", default: 0 }],
  blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "n", type: "snippet", beats: [{ id: "T", kind: "text", gameData: { cam: "wide", marks: ["x"] } }], jump: { to: "END" } },
  ] }],
};
const en: LocaleFile = { schema: "patter/strings@0", scene: "s", locale: "en", strings: { T: "knocks {@scene.knocks}" } };
const bundle = exportBundle({ project, scenes: [scene], locales: [en] });

describe("set-up reports", () => {
  it("reach onError as the constructor ends, in the order found, and the decision log with flow ''", () => {
    const errors: PlayError[] = [];
    const options = {
      locale: "EN", hostScopes: { World: { get: () => undefined } }, colour: "blue",
      log: true, onError: (e: PlayError) => errors.push(e),
    } as EngineOptions; // a plain-JS caller's options
    const engine = new Engine(bundle, options);
    expect(errors.map((e) => [e.kind, e.node, e.flow])).toEqual([["setup", "colour", ""], ["setup", "EN", ""], ["setup", "World", ""]]);
    expect(errors[0]!.message).toBe(`"colour" isn't an engine option, so it's ignored`);
    expect(errors[2]!.message).toContain(`it declares "world"`);
    expect(engine.log().map((e) => [e.type, e.flow, (e as { node?: string }).node])).toEqual([
      ["diagnostic", "", "colour"], ["diagnostic", "", "EN"], ["diagnostic", "", "World"],
    ]);
  });

  it("name an undeclared token plainly when no declared one is near it", () => {
    const errors: PlayError[] = [];
    new Engine(bundle, { hostScopes: { weather: { get: () => undefined } }, onError: (e) => errors.push(e) });
    expect(errors).toEqual([{ flow: "", kind: "setup", node: "weather", message: `hostScopes binds "weather", which this bundle doesn't declare` }]);
  });

  it("go to console.warn with no onError", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      new Engine(bundle, { locale: "de" });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(`this bundle has no locale "de"`));
    } finally { warn.mockRestore(); }
  });

  it("are made again by a hot swap, which builds a new engine", () => {
    const errors: string[] = [];
    const engine = new Engine(bundle, { locale: "en-GB", onError: (e) => errors.push(e.node) });
    engine.hotSwap(bundle);
    expect(errors).toEqual(["en-GB", "en-GB"]);
  });

  it("are made once by a hot swap whose load is refused, not again by the engine it falls back on", () => {
    const errors: string[] = [];
    const engine = new Engine(bundle, { locale: "en-GB", onError: (e) => errors.push(e.node) });
    const load = vi.spyOn(Engine.prototype, "loadGame").mockImplementationOnce(() => { throw new Error("refused"); });
    engine.hotSwap(bundle);
    load.mockRestore();
    expect(errors).toEqual(["en-GB", "en-GB"]);
  });
});

describe("a start the bundle doesn't have (a hand-edited bundle)", () => {
  it("is passed over: the flow starts at the first scene", () => {
    const flow = new Engine({ ...bundle, start: { scene: "gone" } }).openFlow("f");
    expect(flow.advance()).toMatchObject({ type: "text", id: "T" });
  });

  it("starts at its scene when only its block has gone", () => {
    const flow = new Engine({ ...bundle, start: { scene: "s", block: "gone" } }).openFlow("f");
    expect(flow.advance()).toMatchObject({ type: "text", id: "T" });
  });
});

describe("a host write on a flow", () => {
  it("is held to the @scene declaration of the scene the flow is in", () => {
    const flow = new Engine(bundle).openFlow("f", { scene: "s" });
    expect(() => flow.setProperty("@scene.knocks", "two")).toThrow(`"@scene.knocks" takes a number; "two" doesn't fit`);
    expect(() => flow.setProperty("@scene.door", 1)).toThrow(`no property at "@scene.door"`);
    expect(() => flow.setProperty("@world.alarm", "yes")).toThrow(`"@world.alarm" takes true or false; "yes" doesn't fit`);
    flow.setProperty("@scene.knocks", 2);
    expect(flow.getProperty("@scene.knocks")).toBe(2);
  });

  it("is refused before a checkpoint records anything, so a rollback has nothing of it to undo", () => {
    const engine = new Engine(bundle);
    engine.openFlow("f", { scene: "s" });
    const cp = engine.checkpoint();
    expect(() => engine.setProperty("@world.alarm", 1)).toThrow();
    engine.setProperty("@world.alarm", true);
    engine.rollback(cp);
    expect(engine.getProperty("@world.alarm")).toBe(false);
  });
});

describe("gameData handed out is the game's own copy", () => {
  it("from the outline, the beat sequence, and a scene's gameData, flags lists included", () => {
    const engine = new Engine(bundle);
    const outline = engine.getOutline();
    (outline[0]!.gameData!.moods as string[]).push("scribbled");
    (outline[0]!.blocks[0]!.children[0]!.beats![0]!.gameData!.marks as string[]).push("scribbled");
    (engine.getBeatSequence()[0]!.beat.gameData!.marks as string[]).push("scribbled");
    (engine.gameDataForScene("s").moods as string[]).push("scribbled");
    expect(engine.gameDataForScene("s")).toEqual({ music: "jig", moods: ["calm"] });
    expect(engine.getBeatSequence()[0]!.beat.gameData).toEqual({ cam: "wide", marks: ["x"] });
    expect(new Engine(bundle).getOutline()[0]!.gameData).toEqual({ music: "jig", moods: ["calm"] });
  });

  it("and so is a saved pending choice's", () => {
    const withChoice = exportBundle({ project, locales: [en], scenes: [{ ...scene, blocks: [{ id: "b", type: "block", name: "B", children: [
      { id: "g", type: "group", selector: "choice", children: [
        { id: "o", type: "group", gameData: { tags: ["a"] }, prompt: { id: "T", kind: "text" }, children: [{ id: "o_c", type: "snippet", jump: { to: "END" } }] },
      ] },
    ] }] }] });
    const engine = new Engine(withChoice);
    engine.openFlow("f", { scene: "s" }).advance();
    (engine.saveGame().flows.f!.cursor.pendingChoice!.options[0]!.gameData!.tags as string[]).push("scribbled");
    expect(engine.getFlow("f")!.getChoices()[0]!.gameData).toEqual({ tags: ["a"] });
  });
});
