// What the state logger gained by becoming an adapter over the kernel logger: it watches
// the property bags through their audit hook instead of diffing whole save snapshots.
//
// The difference is not a refactor detail. A differ can only ever report the NET change
// between two captures, so a value that changed and changed back is invisible to it, and
// every write is reported late - at the next capture, not when it happened.
import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import type { ProjectFile, Scene, LocaleFile } from "@patterkit/model";
import { setProperty, createStateLogger, snapshotState, diffState } from "../src/index.js";

const project: ProjectFile = {
  schema: "patter/project@0", project: { id: "p", name: "P" },
  locales: { default: "en", all: ["en"] },
  properties: [{ name: "hp", type: "number", default: 0 }],
};
const scene: Scene = {
  id: "s", type: "scene", name: "S", gameId: "s",
  blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "sn", type: "snippet", beats: [{ id: "T", kind: "text" }], jump: { to: "END" } },
  ] }],
};
const en: LocaleFile = { schema: "patter/strings@0", scene: "s", locale: "en", strings: { T: "hi" } };
const bundle = exportBundle({ project, scenes: [scene], locales: [en] });

describe("the state logger", () => {
  it("logs a write when it lands, not at the next capture", () => {
    const lines: string[] = [];
    const engine = new Engine(bundle);
    createStateLogger(engine, { sink: (l) => lines.push(l), label: "t" });

    setProperty(engine, "@hp", 9);
    expect(lines).toEqual(["[t] @patter.hp: 0 -> 9"]);   // before any capture()
  });

  it("sees a value that changed and changed back", () => {
    const lines: string[] = [];
    const engine = new Engine(bundle);
    const log = createStateLogger(engine, { sink: (l) => lines.push(l), label: "t" });

    const before = snapshotState(engine);
    setProperty(engine, "@hp", 9);
    setProperty(engine, "@hp", 0);

    expect(lines).toEqual(["[t] @patter.hp: 0 -> 9", "[t] @patter.hp: 9 -> 0"]);
    expect(log.capture()).toHaveLength(2);

    // What the old shape reported for the same two writes: nothing at all. The snapshots
    // either side are equal, so there was no change to find.
    expect(diffState(before, snapshotState(engine))).toEqual([]);
  });

  it("goes inert after dispose", () => {
    const lines: string[] = [];
    const engine = new Engine(bundle);
    const log = createStateLogger(engine, { sink: (l) => lines.push(l) });
    log.dispose();
    setProperty(engine, "@hp", 4);
    expect(lines).toEqual([]);
  });

  it("picks up a flow opened after the logger was made", () => {
    const lines: string[] = [];
    const engine = new Engine(bundle);
    const log = createStateLogger(engine, { sink: (l) => lines.push(l) });
    log.capture();                       // baseline

    const flow = engine.openFlow("main", { scene: "s", block: "b" });
    log.capture();                       // re-mounts: the flow's bags are new
    flow.setProperty("@hp", 3);          // a per-flow write on the flow's own half
    expect(lines.some((l) => l.startsWith("main/@patter.hp:") || l.startsWith("@patter.hp:"))).toBe(true);
  });
});
