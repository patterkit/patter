// ---------------------------------------------------------------------------
// Live bundle refresh, tier 1 (strings only): the compiler's structure hash
// tells a text-only edit from a structural one, and engine.replaceStrings()
// swaps every locale's table in place - no restart, no flow state touched.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import type { ProjectFile, Scene, LocaleFile } from "@patterkit/model";

const project: ProjectFile = {
  schema: "patter/project@0",
  project: { id: "lr", name: "LiveRefresh" },
  locales: { default: "en", all: ["en"] },
  properties: [{ name: "gold", type: "number", shared: true, default: 7 }],
  cast: [{ name: "NPC" }],
};

const scene = (extraLine = false): Scene => ({
  id: "s", type: "scene", name: "S",
  blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "sn1", type: "snippet", beats: [
      { id: "L1", kind: "line", character: "NPC" },
      { id: "L2", kind: "line", character: "NPC" },
      ...(extraLine ? [{ id: "L3", kind: "line" as const, character: "NPC" }] : []),
    ] },
  ] }],
});

const locale = (strings: Record<string, string>): LocaleFile =>
  ({ schema: "patter/strings@0", scene: "s", locale: "en", strings });

const V1 = { L1: "Hello.", L2: "You carry {@gold} gold." };
const V2 = { L1: "Well met!", L2: "That's {@gold} gold in your purse." };

describe("content.structureHash", () => {
  const a = exportBundle({ project, scenes: [scene()], locales: [locale(V1)] });
  const reworded = exportBundle({ project, scenes: [scene()], locales: [locale(V2)] });
  const restructured = exportBundle({ project, scenes: [scene(true)], locales: [locale({ ...V1, L3: "New line." })] });

  it("is stable across a text-only edit while the full hash changes", () => {
    expect(reworded.content.structureHash).toBe(a.content.structureHash);
    expect(reworded.content.hash).not.toBe(a.content.hash);
  });

  it("changes when the structure changes", () => {
    expect(restructured.content.structureHash).not.toBe(a.content.structureHash);
  });
});

describe("engine.replaceStrings (tier-1 hot swap)", () => {
  it("mid-run: the next delivered beat reads the new text; position and state are untouched", () => {
    const engine = new Engine(exportBundle({ project, scenes: [scene()], locales: [locale(V1)] }));
    const flow = engine.openFlow("f", { scene: "s" });
    expect(flow.advance()).toMatchObject({ type: "line", text: "Hello." });

    engine.replaceStrings(exportBundle({ project, scenes: [scene()], locales: [locale(V2)] }));

    // The flow was not restarted: the NEXT beat plays (L2), in the new wording, with {@gold}
    // interpolated against untouched state.
    expect(flow.advance()).toMatchObject({ type: "line", text: "That's 7 gold in your purse." });
    expect(flow.advance()).toEqual({ type: "end" });
  });

  it("reaches every open flow at once", () => {
    const engine = new Engine(exportBundle({ project, scenes: [scene()], locales: [locale(V1)] }));
    const one = engine.openFlow("one", { scene: "s" });
    const two = engine.openFlow("two", { scene: "s" });
    one.advance(); // one is past L1; two hasn't started
    engine.replaceStrings(exportBundle({ project, scenes: [scene()], locales: [locale(V2)] }));
    expect(one.advance()).toMatchObject({ text: "That's 7 gold in your purse." });
    expect(two.advance()).toMatchObject({ text: "Well met!" });
  });
});

// --- tier 2: the full structural swap ----------------------------------------

/** v1: greet[G1] -> gate[G2, +1 gold on enter] -> a choice. v2 inserts an opener before greet,
 *  rewords G2, and drops the "no" option. */
const swapScene = (v2 = false): Scene => ({
  id: "s", type: "scene", name: "S",
  blocks: [{ id: "b", type: "block", name: "B", children: [
    ...(v2 ? [{ id: "sn0", type: "snippet" as const, beats: [{ id: "G0", kind: "line" as const, character: "NPC" }] }] : []),
    { id: "sn_greet", type: "snippet", beats: [{ id: "G1", kind: "line", character: "NPC" }] },
    { id: "sn_gate", type: "snippet", onEnter: [{ kind: "set", target: "@gold", value: "@gold + 1" }],
      beats: [{ id: "G2", kind: "line", character: "NPC" }] },
    { id: "g", type: "group", selector: "choice", children: [
      { id: "opt_yes", type: "group", prompt: { id: "C_yes", kind: "text" },
        children: [{ id: "yc", type: "snippet", beats: [{ id: "Gy", kind: "line", character: "NPC" }], jump: { to: "END" } }] },
      ...(v2 ? [] : [{ id: "opt_no", type: "group" as const, prompt: { id: "C_no", kind: "text" as const },
        children: [{ id: "nc", type: "snippet" as const, beats: [{ id: "Gn", kind: "line" as const, character: "NPC" }], jump: { to: "END" } }] }]),
    ] },
  ] }],
});
const swapStrings = (v2 = false): Record<string, string> => ({
  ...(v2 ? { G0: "Ahem." } : {}), G1: "Hello.", G2: v2 ? "You now hold {@gold} gold, friend." : "You now hold {@gold} gold.",
  Gy: "Deal.", Gn: "Suit yourself.", C_yes: "Yes", C_no: "No",
});
const swapBundle = (v2 = false) => exportBundle({ project, scenes: [swapScene(v2)], locales: [locale(swapStrings(v2))] });

describe("engine.hotSwap (tier-2 full swap)", () => {
  it("carries the run across a structural edit: position by id, state, and the pending path", () => {
    const engine = new Engine(swapBundle());
    const flow = engine.openFlow("f", { scene: "s" });
    expect(flow.advance()).toMatchObject({ text: "Hello." });

    const next = engine.hotSwap(swapBundle(true));
    const resumed = next.getFlow("f")!;
    // The inserted opener (G0) is behind the cursor: not replayed. The next beat is the
    // REWORDED gate line, its on-enter effect firing exactly once (gold 7 -> 8).
    expect(resumed.advance()).toMatchObject({ text: "You now hold 8 gold, friend." });
    // The choice arrives with the surviving option only (opt_no was deleted).
    const stop = resumed.advance();
    expect(stop.type).toBe("choice");
    expect(resumed.getChoices().map((o) => o.id)).toEqual(["opt_yes"]);
    resumed.choose("opt_yes");
    expect(resumed.advance()).toMatchObject({ text: "Deal." });
    expect(resumed.advance()).toEqual({ type: "end" });
  });

  it("keeps a pending choice's option set verbatim, minus options that drifted out", () => {
    const engine = new Engine(swapBundle());
    const flow = engine.openFlow("f", { scene: "s" });
    flow.advance(); flow.advance(); // G1, G2
    expect(flow.advance().type).toBe("choice"); // both options offered
    expect(flow.getChoices().map((o) => o.id)).toEqual(["opt_yes", "opt_no"]);

    const resumed = engine.hotSwap(swapBundle(true)).getFlow("f")!;
    expect(resumed.getChoices().map((o) => o.id)).toEqual(["opt_yes"]); // opt_no dissolved (§9.8)
    resumed.choose("opt_yes");
    expect(resumed.advance()).toMatchObject({ text: "Deal." });
  });

  it("carries over presentation state that is not in the save (captions toggle)", () => {
    const engine = new Engine(swapBundle());
    engine.setClosedCaptions(false);
    engine.openFlow("f", { scene: "s" }).advance();
    const next = engine.hotSwap(swapBundle(true));
    expect(next.closedCaptions).toBe(false);
  });
});
