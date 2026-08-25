// ---------------------------------------------------------------------------
// The quality property type (expr 0.4.0, from-storylets/quality-in-expr.md): a story stage as an
// ordered ladder of named stages. Its runtime value is the stage NAME (a plain string - saves carry it
// as one), the ordering operators compare by ladder position, and `advance()` steps to the next stage,
// saturating at the last. The insertion story is the point: conditions write `>= "confrontation"` and
// outcomes `advance(...)`, so adding a stage mid-production breaks neither.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
import type { StepResult } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import type { ProjectFile, Scene, LocaleFile } from "@patterkit/model";

const STAGES = ["not_started", "underway", "done", "aftermath"];

function makeBundle(stages: string[] = STAGES) {
  const project: ProjectFile = {
    schema: "patter/project@0", project: { id: "q", name: "Q" },
    locales: { default: "en", all: ["en"] },
    properties: [
      { name: "negotiation", type: "quality", stages, shared: true },
      { name: "gold", type: "number", default: 0, shared: true },
    ],
  };
  // b_probe reads the quality three ways (positional gate, exact gate, else); b_step advances it.
  const scene: Scene = {
    id: "s", type: "scene", name: "S", gameId: "s",
    blocks: [
      { id: "b_probe", type: "block", name: "Probe", children: [
        { id: "sn_past", type: "snippet", condition: '@negotiation >= "done"', beats: [{ id: "T_past", kind: "text" }], jump: { to: "END" } },
        { id: "sn_mid", type: "snippet", condition: '@negotiation == "underway"', beats: [{ id: "T_mid", kind: "text" }], jump: { to: "END" } },
        { id: "sn_pre", type: "snippet", beats: [{ id: "T_pre", kind: "text" }], jump: { to: "END" } },
      ] },
      { id: "b_step", type: "block", name: "Step", children: [
        { id: "sn_step", type: "snippet", beats: [{ id: "T_step", kind: "text" }],
          onExit: [{ kind: "set", target: "@negotiation", value: "advance(@negotiation)" }], jump: { to: "END" } },
      ] },
    ],
  };
  const en: LocaleFile = {
    schema: "patter/strings@0", scene: "s", locale: "en",
    strings: { T_past: "past", T_mid: "mid {@negotiation}", T_pre: "pre {@negotiation}", T_step: "step" },
  };
  return exportBundle({ project, scenes: [scene], locales: [en] });
}

const textOf = (r: StepResult): string => (r.type === "text" ? r.text : `<${r.type}>`);

/** Play `block` TO ITS END (so the snippet's onExit effects fire), returning the delivered text. */
function play(engine: Engine, flowId: string, block: string): string {
  const flow = engine.openFlow(flowId, { scene: "s", block });
  let text = "";
  for (let i = 0; i < 10; i++) {
    const r = flow.advance();
    if (r.type === "end") break;
    text = textOf(r);
  }
  flow.close();
  return text;
}

describe("quality properties", () => {
  it("seeds at the FIRST stage and interpolates as its stage name", () => {
    const engine = new Engine(makeBundle());
    expect(play(engine, "f1", "b_probe")).toBe("pre not_started");
  });

  it("gates by ladder position, not string order", () => {
    // Alphabetically "underway" > "done"; positionally it is EARLIER. The mid gate must win.
    const engine = new Engine(makeBundle());
    engine.setProperty("@negotiation", "underway");
    expect(play(engine, "f1", "b_probe")).toBe("mid underway");
    engine.setProperty("@negotiation", "aftermath");
    expect(play(engine, "f2", "b_probe")).toBe("past"); // >= "done" by position
  });

  it("advance() steps the ladder and saturates at the last stage", () => {
    const engine = new Engine(makeBundle());
    expect(play(engine, "f1", "b_step")).toBe("step");
    expect(engine.getProperty("@negotiation")).toBe("underway");
    for (let i = 0; i < 5; i++) play(engine, `fx${i}`, "b_step"); // far past the end
    expect(engine.getProperty("@negotiation")).toBe("aftermath"); // saturated, no wrap, no throw
  });

  it("save/load carries the stage by NAME, so an inserted stage does not shift it", () => {
    const engine = new Engine(makeBundle());
    engine.setProperty("@negotiation", "done");
    const blob = JSON.parse(JSON.stringify(engine.saveGame()));

    // The ladder grows a stage BEFORE "done" (the mid-production insertion). Restoring by name lands on
    // "done" still; by index it would have landed on the new stage.
    const grown = new Engine(makeBundle(["not_started", "underway", "confrontation", "done", "aftermath"]));
    grown.loadGame(blob);
    expect(grown.getProperty("@negotiation")).toBe("done");
    expect(play(grown, "f1", "b_probe")).toBe("past"); // >= "done" by the NEW ladder's positions
  });
});
