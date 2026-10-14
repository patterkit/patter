// The live debug link's flow picker, as data (src/debug-flows.ts): names shortened and grouped by their
// prefix, each beside its scene's display name, and the node a taken option marks.

import { describe, it, expect } from "vitest";
import { groupFlows, markTarget, shortFlowName } from "./src/debug-flows.js";

const NAMES: Record<string, string> = { scn_gate: "The Gate", scn_title: "Title" };
const sceneName = (id: string): string | undefined => NAMES[id];

describe("the flow picker", () => {
  it("shortens a name by its prefix up to the first slash, and leaves a bare name alone", () => {
    expect(shortFlowName("patterstage/gate/talk")).toBe("gate/talk");
    expect(shortFlowName("patterstage/@oda")).toBe("@oda");
    expect(shortFlowName("main")).toBe("main");
    expect(shortFlowName("/odd")).toBe("/odd");
    expect(shortFlowName("odd/")).toBe("odd/");
  });

  it("groups by prefix, ungrouped first, in name order with numbers in order", () => {
    const groups = groupFlows(
      ["patterstage/gate/tale#p10", "menu/title", "main", "patterstage/@oda", "patterstage/gate/tale#p9"],
      {}, sceneName,
    );
    expect(groups.map((g) => [g.prefix, g.rows.map((r) => r.label)])).toEqual([
      [null, ["main"]],
      ["menu", ["title"]],
      ["patterstage", ["@oda", "gate/tale#p9", "gate/tale#p10"]],
    ]);
    expect(groups[2]!.rows[0]!.id).toBe("patterstage/@oda"); // the full name, for the tooltip and the pick
  });

  it("shows each flow's scene by its display name, else its id, else nothing", () => {
    const [g] = groupFlows(["menu/a", "menu/b", "menu/c"], { "menu/a": "scn_gate", "menu/b": "scn_gone", "menu/c": null }, sceneName);
    expect(g!.rows.map((r) => r.scene)).toEqual(["The Gate", "scn_gone", null]);
  });
});

describe("marking a taken option", () => {
  const promptOf = (option: string): string | null => (option === "opt_work" ? "C_work" : null);

  it("moves the playhead onto the taken option's prompt", () => {
    expect(markTarget("grp_choice", "opt_work", promptOf)).toBe("C_work");
  });

  it("leaves it on the choice when the option has no prompt or isn't in this scene", () => {
    expect(markTarget("grp_choice", "opt_elsewhere", promptOf)).toBe("grp_choice");
  });

  it("marks any other frame's beat as it is", () => {
    expect(markTarget("L_greet", undefined, promptOf)).toBe("L_greet");
    expect(markTarget(null, undefined, promptOf)).toBeNull();
  });
});
