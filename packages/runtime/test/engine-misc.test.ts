// ---------------------------------------------------------------------------
// Smaller engine behaviors the suite lacked: conditional run-groups, starting a
// flow at a block, reset clearing world visit counts, the missing-locale
// fallback, line `direction` propagation, flow-id replacement, the engine-level
// @scene rejection, the no-current-scene write guard, and the jump-cycle
// runaway guard.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import type { ProjectFile, Scene, LocaleFile } from "@patterkit/model";

const project = (extra: Partial<ProjectFile> = {}): ProjectFile => ({
  schema: "patter/project@0", project: { id: "m", name: "M" },
  locales: { default: "en", all: ["en"] }, cast: [{ name: "NPC" }],
  ...extra,
});
const loc = (scene: string, strings: Record<string, string>): LocaleFile =>
  ({ schema: "patter/strings@0", scene, locale: "en", strings });

describe("conditional run-group", () => {
  const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [
    { id: "b", type: "block", name: "B", children: [
      { id: "g", type: "group", condition: "@go", children: [
        { id: "g1", type: "snippet", beats: [{ id: "G1", kind: "text" }] },
      ] },
      { id: "after", type: "snippet", beats: [{ id: "AF", kind: "text" }], jump: { to: "END" } },
    ] },
  ] };
  const bundle = exportBundle({
    project: project({ properties: [{ name: "go", type: "boolean", shared: true, default: false }] }),
    scenes: [scene], locales: [loc("s", { G1: "gated", AF: "always" })],
  });

  it("a failing condition skips the whole run-group", () => {
    const flow = new Engine(bundle).openFlow("f", { scene: "s" });
    expect(flow.advance()).toMatchObject({ text: "always" });
  });

  it("a passing condition plays it inline", () => {
    const engine = new Engine(bundle);
    engine.setProperty("@go", true);
    const flow = engine.openFlow("f", { scene: "s" });
    expect(flow.advance()).toMatchObject({ text: "gated" });
    expect(flow.advance()).toMatchObject({ text: "always" });
  });
});

describe("openFlow at a block", () => {
  // The scene's onEntry SET runs even when starting at a block; we observe it through interpolation
  // (effects are set-only now - spec §15 - so onEntry mutates a property rather than emitting).
  const scene: Scene = { id: "s", type: "scene", name: "S",
    onEntry: [{ kind: "set", target: "@entered", value: "1" }],
    blocks: [
      { id: "b1", type: "block", name: "B1", children: [
        { id: "s1", type: "snippet", beats: [{ id: "L1", kind: "text" }], jump: { to: "END" } },
      ] },
      { id: "b2", type: "block", name: "B2", children: [
        { id: "s2", type: "snippet", beats: [{ id: "L2", kind: "text" }], jump: { to: "END" } },
      ] },
    ] };
  const bundle = exportBundle({
    project: project({ properties: [{ name: "entered", type: "number", shared: true, default: 0 }] }),
    scenes: [scene], locales: [loc("s", { L1: "first", L2: "second {@entered}" })],
  });

  it("starts at the named block, still running the scene's entry setup", () => {
    const engine = new Engine(bundle);
    const flow = engine.openFlow("f", { block: "b2" });
    expect(flow.advance()).toMatchObject({ text: "second 1" }); // scene onEntry set @entered even for a block start
  });

  it("throws on an unknown block id", () => {
    expect(() => new Engine(bundle).openFlow("f", { block: "nope" })).toThrow(/unknown block/);
  });
});

describe("engine.reset() clears world visit counts", () => {
  const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [
    { id: "b", type: "block", name: "B", children: [
      { id: "first", type: "snippet", condition: "not patter_seen('s')", beats: [{ id: "F", kind: "text" }], jump: { to: "END" } },
      { id: "again", type: "snippet", beats: [{ id: "A", kind: "text" }], jump: { to: "END" } },
    ] },
  ] };
  // patter_seen('s') is true the moment any flow enters the scene, so the
  // "first" branch is only reachable when the world counts are truly zeroed.
  const bundle = exportBundle({ project: project(), scenes: [scene], locales: [loc("s", { F: "fresh world", A: "seen before" })] });

  it("after reset, the world is unseen again", () => {
    const engine = new Engine(bundle);
    expect(engine.openFlow("a", { scene: "s" }).advance()).toMatchObject({ text: "seen before" }); // entering bumped it
    engine.reset();
    expect(engine.openFlow("b", { scene: "s" }).advance()).toMatchObject({ text: "seen before" });
  });
});

describe("locale handling", () => {
  const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [
    { id: "b", type: "block", name: "B", children: [
      { id: "s1", type: "snippet", beats: [{ id: "L_1", kind: "line", character: "NPC", direction: "wearily" }], jump: { to: "END" } },
    ] },
  ] };
  const bundle = exportBundle({ project: project(), scenes: [scene], locales: [loc("s", { L_1: "Hello." })] });

  it("a missing locale falls back to the source text, flagged loudly as untranslated", () => {
    const flow = new Engine(bundle, { locale: "fr" }).openFlow("f", { scene: "s" });
    // fr has no table at all: every key falls back to the default-locale source, marked untranslated so
    // a partial/absent translation is impossible to miss (never a bare id when a source string exists).
    expect(flow.advance()).toMatchObject({ type: "line", text: "<Untranslated: L_1> Hello." });
  });

  it("line `direction` propagates to the step result", () => {
    const flow = new Engine(bundle).openFlow("f", { scene: "s" });
    expect(flow.advance()).toMatchObject({ type: "line", text: "Hello.", direction: "wearily" });
  });
});

describe("flow + property guards", () => {
  const scene: Scene = { id: "s", type: "scene", name: "S",
    sceneProps: [{ name: "mood", type: "string", default: "calm" }],
    blocks: [
      { id: "b", type: "block", name: "B", children: [
        { id: "s1", type: "snippet", beats: [{ id: "T", kind: "text" }], jump: { to: "END" } },
      ] },
    ] };
  const bundle = exportBundle({ project: project(), scenes: [scene], locales: [loc("s", { T: "hi" })] });

  it("re-opening an existing flow id replaces it with a fresh flow", () => {
    const engine = new Engine(bundle);
    const first = engine.openFlow("f", { scene: "s" });
    first.advance();
    expect(first.isEnded()).toBe(false); // beat delivered, not yet ended
    first.advance();
    expect(first.isEnded()).toBe(true);
    const second = engine.openFlow("f", { scene: "s" });
    expect(second.isEnded()).toBe(false);            // fresh cursor
    expect(engine.getFlow("f")).toBe(second);        // the id now names the new flow
  });

  it("engine-level @scene access is rejected (scene props are flow-scoped)", () => {
    const engine = new Engine(bundle);
    expect(() => engine.setProperty("@scene.mood", "x")).toThrow(/read\/write them on a Flow/);
    expect(() => engine.getProperty("@scene.mood")).toThrow(/read\/write them on a Flow/);
  });

  it("a flow @scene write before any scene is entered throws instead of vanishing", () => {
    const engine = new Engine(bundle);
    const flow = engine.openFlow("f", { scene: "s" });
    flow.setProperty("@scene.mood", "tense"); // in a scene: fine
    expect(flow.getProperty("@scene.mood")).toBe("tense");

    // loadGame can produce a flow with no current scene; simulate via a fresh restore.
    const save = JSON.parse(JSON.stringify(engine.saveGame()));
    save.flows.f.cursor.currentSceneId = null;
    const b = new Engine(bundle);
    b.loadGame(save);
    expect(() => b.getFlow("f")!.setProperty("@scene.mood", "x")).toThrow(/has not entered a scene/);
  });
});

describe("jump-cycle runaway guard", () => {
  it("two pure jumps jumping at each other error instead of hanging", () => {
    const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [
      { id: "a", type: "block", name: "A", children: [{ id: "pa", type: "snippet", jump: { to: "bb" } }] },
      { id: "bb", type: "block", name: "BB", children: [{ id: "pb", type: "snippet", jump: { to: "a" } }] },
    ] };
    const bundle = exportBundle({ project: project(), scenes: [scene] });
    expect(() => new Engine(bundle).openFlow("f", { scene: "s" })).toThrow(/did not settle/);
  });
});
