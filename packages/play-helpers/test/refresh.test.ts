// ---------------------------------------------------------------------------
// applyLiveBundle: the game-side applier for the editor's pushed bundles. Picks
// tier 1 (strings-only, same structureHash) vs tier 2 (full hotSwap) itself,
// exactly the JSON-in/engine-out path a host wires into createDebugLink's
// onBundle.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import type { ProjectFile, Scene, LocaleFile } from "@patterkit/model";
import { applyLiveBundle } from "../src/index.js";

const project: ProjectFile = {
  schema: "patter/project@0",
  project: { id: "alb", name: "ApplyLive" },
  locales: { default: "en", all: ["en"] },
  cast: [{ name: "NPC" }],
};
const scene = (extra = false): Scene => ({
  id: "s", type: "scene", name: "S",
  blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "sn", type: "snippet", beats: [
      { id: "L1", kind: "line", character: "NPC" },
      { id: "L2", kind: "line", character: "NPC" },
      ...(extra ? [{ id: "L3", kind: "line" as const, character: "NPC" }] : []),
    ] },
  ] }],
});
const locale = (strings: Record<string, string>): LocaleFile =>
  ({ schema: "patter/strings@0", scene: "s", locale: "en", strings });
const bundleOf = (extra: boolean, strings: Record<string, string>) =>
  exportBundle({ project, scenes: [scene(extra)], locales: [locale(strings)] });

describe("applyLiveBundle", () => {
  const v1 = bundleOf(false, { L1: "Hi.", L2: "Bye." });

  it("same structure: tier 1, the SAME engine, next beat reads new text", () => {
    const engine = new Engine(v1);
    const flow = engine.openFlow("main", { scene: "s" });
    flow.advance(); // L1

    const pushed = bundleOf(false, { L1: "Hi.", L2: "Farewell, friend." });
    const r = applyLiveBundle(engine, v1, JSON.stringify(pushed));
    expect(r.kind).toBe("text");
    expect(r.engine).toBe(engine); // nothing restarted
    expect(flow.advance()).toMatchObject({ text: "Farewell, friend." }); // the live flow handle still works
  });

  it("changed structure: tier 2, a REPLACEMENT engine carrying the run", () => {
    const engine = new Engine(v1);
    engine.openFlow("main", { scene: "s" }).advance(); // L1

    const pushed = bundleOf(true, { L1: "Hi.", L2: "Bye.", L3: "One more thing." });
    const r = applyLiveBundle(engine, v1, JSON.stringify(pushed));
    expect(r.kind).toBe("structure");
    expect(r.engine).not.toBe(engine);
    const flow = r.engine.getFlow("main")!;
    expect(flow.advance()).toMatchObject({ text: "Bye." });            // resumed where it was
    expect(flow.advance()).toMatchObject({ text: "One more thing." }); // the new content plays
  });

  it("throws only on unparseable JSON (the host's guard)", () => {
    const engine = new Engine(v1);
    expect(() => applyLiveBundle(engine, v1, "{ nope")).toThrow();
  });
});
