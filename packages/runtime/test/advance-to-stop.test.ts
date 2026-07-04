// Flow.advanceToStop(): walk, collecting every played beat, until a choice or the end.

import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import type { ProjectFile, Scene, LocaleFile } from "@patterkit/model";

function bundle() {
  const project: ProjectFile = {
    schema: "patter/project@0",
    project: { id: "p", name: "Demo" },
    locales: { default: "en", all: ["en"] },
    voiced: false,
    cast: [{ name: "NPC" }],
  };
  const scene: Scene = {
    id: "scn", type: "scene", name: "Demo",
    blocks: [
      { id: "start", type: "block", name: "Start", children: [
        { id: "sn_a", type: "snippet", beats: [
          { id: "T_intro", kind: "text" },
          { id: "L_hi", kind: "line", character: "NPC" },
        ], jump: { to: "menu" } },
      ] },
      { id: "menu", type: "block", name: "Menu", children: [
        { id: "grp", type: "group", selector: "choice", children: [
          { id: "opt_go", type: "group", prompt: { id: "C_go", kind: "text" },
            children: [{ id: "sn_go", type: "snippet", jump: { to: "after" } }] },
        ] },
      ] },
      { id: "after", type: "block", name: "After", children: [
        { id: "sn_done", type: "snippet", beats: [{ id: "L_done", kind: "line", character: "NPC" }], jump: { to: "END" } },
      ] },
    ],
  };
  const en: LocaleFile = {
    schema: "patter/strings@0", scene: "scn", locale: "en", default: true,
    strings: { T_intro: "The room is quiet.", L_hi: "Hello.", C_go: "Go on", L_done: "Done." },
  };
  return exportBundle({ project, scenes: [scene], locales: [en] });
}

describe("Flow.advanceToStop", () => {
  it("collects every played beat up to a choice, then up to the end", () => {
    const flow = new Engine(bundle()).openFlow("main", { scene: "scn" });

    const a = flow.advanceToStop();
    expect(a.played.map((p) => p.id)).toEqual(["T_intro", "L_hi"]); // both beats walked
    expect(a.played.every((p) => p.type === "line" || p.type === "text")).toBe(true);
    expect(a.stop.type).toBe("choice");

    flow.choose("opt_go");
    const b = flow.advanceToStop();
    expect(b.played.map((p) => p.id)).toEqual(["L_done"]);
    expect(b.stop.type).toBe("end");
  });

  it("equals stepping with advance() one beat at a time", () => {
    const flow = new Engine(bundle()).openFlow("main", { scene: "scn" });
    expect(flow.advance()).toMatchObject({ type: "text", id: "T_intro" });
    expect(flow.advance()).toMatchObject({ type: "line", id: "L_hi" });
    expect(flow.advance().type).toBe("choice"); // the next advance is the stop advanceToStop would return
  });
});
