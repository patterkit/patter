// ---------------------------------------------------------------------------
// `shared` on a memoried selector (spec §7): the selector's cursor is pooled
// across all flows (one world-wide cursor) instead of kept per-flow. A shared
// `sequence` hands its children out globally - flow A takes the first, flow B the
// next - and the cursor rides in the whole-game save. Default (omitted) is per-flow.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import type { ProjectFile, Scene, LocaleFile } from "@patterkit/model";

const project: ProjectFile = {
  schema: "patter/project@0", project: { id: "sel", name: "Sel" },
  locales: { default: "en", all: ["en"] },
};

// A block whose single child is a `sequence` of three lines. `shared` is a param
// so the same shape exercises both the pooled and the per-flow cursor.
const sceneWith = (shared: boolean): Scene => ({
  id: "s", type: "scene", name: "S",
  blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "seq", type: "group", selector: "sequence", shared, children: [
      { id: "a", type: "snippet", beats: [{ id: "L1", kind: "text" }], jump: { to: "END" } },
      { id: "b2", type: "snippet", beats: [{ id: "L2", kind: "text" }], jump: { to: "END" } },
      { id: "c", type: "snippet", beats: [{ id: "L3", kind: "text" }], jump: { to: "END" } },
    ] },
  ] }],
});
const en: LocaleFile = { schema: "patter/strings@0", scene: "s", locale: "en", strings: { L1: "one", L2: "two", L3: "three" } };
const bundle = (shared: boolean) => exportBundle({ project, scenes: [sceneWith(shared)], locales: [en] });

describe("shared selector memory", () => {
  it("a shared sequence cursor is pooled across flows", () => {
    const engine = new Engine(bundle(true));
    expect(engine.openFlow("alice", { scene: "s" }).advance()).toMatchObject({ text: "one" });  // seq 0 -> 1
    expect(engine.openFlow("bob", { scene: "s" }).advance()).toMatchObject({ text: "two" });     // seq 1 -> 2 (pooled)
    expect(engine.openFlow("cara", { scene: "s" }).advance()).toMatchObject({ text: "three" });   // seq 2 -> third
  });

  it("default (per-flow) gives every flow its own cursor", () => {
    const engine = new Engine(bundle(false));
    expect(engine.openFlow("alice", { scene: "s" }).advance()).toMatchObject({ text: "one" });
    expect(engine.openFlow("bob", { scene: "s" }).advance()).toMatchObject({ text: "one" });      // independent: starts over
  });

  it("the shared cursor rides in saveGame / loadGame", () => {
    const engine = new Engine(bundle(true));
    engine.openFlow("alice", { scene: "s" }).advance(); // seq -> 1
    engine.openFlow("bob", { scene: "s" }).advance();   // seq -> 2

    const save = JSON.parse(JSON.stringify(engine.saveGame()));
    expect(save.sharedSelectors.seq.seq).toBe(2);

    const restored = new Engine(bundle(true));
    restored.loadGame(save);
    expect(restored.openFlow("cara", { scene: "s" }).advance()).toMatchObject({ text: "three" }); // resumes at 2
  });

  it("engine.reset() clears the shared selector cursor", () => {
    const engine = new Engine(bundle(true));
    engine.openFlow("alice", { scene: "s" }).advance(); // seq -> 1
    engine.reset();
    expect(engine.openFlow("bob", { scene: "s" }).advance()).toMatchObject({ text: "one" }); // back to start
  });
});
