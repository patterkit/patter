// The engine's trace: what it DECIDED, not what it produced.
//
// A step tells you the line that played. This tells you why that line and not its
// siblings - which children were eligible, which choice options were live, which
// condition dropped the one you expected. That question is otherwise unanswerable:
// the state logger sees the effects of the line that ran, never the ones that did not.
import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
import type { TraceEvent } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import type { ProjectFile, Scene, LocaleFile } from "@patterkit/model";

const STAGES = ["not_started", "underway", "done"];

function bundle() {
  const project: ProjectFile = {
    schema: "patter/project@0", project: { id: "q", name: "Q" },
    locales: { default: "en", all: ["en"] },
    properties: [
      { name: "negotiation", type: "quality", stages: STAGES, shared: true },
      { name: "gold", type: "number", default: 0, shared: true },
    ],
  };
  const scene: Scene = {
    id: "s", type: "scene", name: "S", gameId: "s",
    blocks: [
      { id: "b_probe", type: "block", name: "Probe", children: [
        { id: "sn_past", type: "snippet", condition: '@negotiation >= "done"', beats: [{ id: "T_past", kind: "text" }], jump: { to: "END" } },
        { id: "sn_mid", type: "snippet", condition: '@negotiation == "underway"', beats: [{ id: "T_mid", kind: "text" }], jump: { to: "END" } },
        { id: "sn_pre", type: "snippet", beats: [{ id: "T_pre", kind: "text" }],
          onExit: [{ kind: "set", target: "@gold", value: "7" }], jump: { to: "END" } },
      ] },
    ],
  };
  const en: LocaleFile = {
    schema: "patter/strings@0", scene: "s", locale: "en",
    strings: { T_past: "past", T_mid: "mid", T_pre: "pre" },
  };
  return exportBundle({ project, scenes: [scene], locales: [en] });
}

const run = (opts: Record<string, unknown>) => {
  const engine = new Engine(bundle(), opts as never);
  const flow = engine.openFlow("main", { scene: "s", block: "b_probe" });
  for (let i = 0; i < 10 && flow.advance().type !== "end"; i++) { /* play it out */ }
  return { engine, flow };
};

describe("the engine's trace log", () => {
  it("is off unless the run asked for one", () => {
    const { engine, flow } = run({ seed: 0 });
    expect(engine.log()).toEqual([]);
    expect(flow.log()).toEqual([]);
  });

  it("records WHICH siblings were considered and why the loser lost", () => {
    const { flow } = run({ seed: 0, log: true });
    const select = flow.log().find((e): e is Extract<TraceEvent, { type: "select" }> & { seq: number } => e.type === "select");
    expect(select).toBeDefined();
    // The quality starts at its first stage, so both gated snippets are out and the
    // unconditional one wins. The entry has to say that, not just name the winner.
    expect(select!.children).toEqual([
      { id: "sn_past", eligible: false },
      { id: "sn_mid", eligible: false },
      { id: "sn_pre", eligible: true },
    ]);
    expect(select!.picked).toBe("sn_pre");
  });

  it("records the effect that landed, with what it replaced", () => {
    const { flow } = run({ seed: 0, log: true });
    const write = flow.log().find((e) => e.type === "write");
    expect(write).toMatchObject({ type: "write", target: "@gold", value: 7, prev: 0 });
  });

  it("orders the run with a seq that survives a clear", () => {
    const { engine, flow } = run({ seed: 0, log: true });
    const seqs = flow.log().map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(engine.log().every((e) => e.flow === "main")).toBe(true);
    engine.clearLog();
    expect(engine.log()).toEqual([]);
    expect(flow.log().length).toBeGreaterThan(0); // a flow's own log is its own
  });
});
