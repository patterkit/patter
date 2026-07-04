// ---------------------------------------------------------------------------
// Save-game: full execution-cursor persistence (Plan §9). Saving and restoring
// at ANY step - into a FRESH engine seeded differently - must reproduce the
// uninterrupted playthrough. That single invariant exercises the whole cursor:
// active scene/snippet/beat, selector visit state, the built-in PRNG position,
// property state, and pending-choice rebuild. The save round-trips through JSON.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
import type { StepResult } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import type { ProjectFile, Scene, LocaleFile } from "@patterkit/model";

const project: ProjectFile = {
  schema: "patter/project@0",
  project: { id: "sg", name: "SaveGame" },
  locales: { default: "en", all: ["en"] },
  properties: [{ name: "gold", type: "number", shared: true, default: 0 }],
  cast: [{ name: "NPC" }],
};

// start -> a line; an onExit `set`; a seeded SHUFFLE (consumes the PRNG); a CHOICE.
const scene: Scene = {
  id: "s", type: "scene", name: "S",
  blocks: [
    { id: "b1", type: "block", name: "B1", children: [
      { id: "sn1", type: "snippet", beats: [{ id: "L1", kind: "line", character: "NPC" }],
        onExit: [{ kind: "set", target: "@gold", value: "@gold + 1" }], jump: { to: "shuf" } },
    ] },
    { id: "shuf", type: "block", name: "Shuf", children: [
      { id: "g_shuf", type: "group", selector: "sequence", options: { order: "shuffle", exhaust: "repeat" }, children: [
        { id: "sa", type: "snippet", beats: [{ id: "Sa", kind: "line", character: "NPC" }], jump: { to: "choose" } },
        { id: "sb", type: "snippet", beats: [{ id: "Sb", kind: "line", character: "NPC" }], jump: { to: "choose" } },
        { id: "sc", type: "snippet", beats: [{ id: "Sc", kind: "line", character: "NPC" }], jump: { to: "choose" } },
      ] },
    ] },
    { id: "choose", type: "block", name: "Choose", children: [
      { id: "g_choose", type: "group", selector: "choice", children: [
        { id: "yes", type: "snippet", beats: [{ id: "L_yes", kind: "line", character: "NPC" }], jump: { to: "END" } },
        { id: "no", type: "snippet", jump: { to: "END" } },
      ] },
    ] },
  ],
};

const en: LocaleFile = {
  schema: "patter/strings@0", scene: "s", locale: "en",
  strings: {
    L1: "begin", Sa: "alpha {@gold}", Sb: "beta {@gold}", Sc: "gamma {@gold}",
    C_yes: "Yes", C_no: "No", L_yes: "you have {@gold} gold",
  },
};

const bundle = exportBundle({ project, scenes: [scene], locales: [en] });

function norm(r: StepResult): unknown {
  if (r.type === "line" || r.type === "text") return { type: r.type, id: r.id, text: r.text };
  if (r.type === "choice") return { type: "choice", options: r.options.map((o) => o.id) };
  return { type: r.type };
}

// Play to the end; when resumeAt is reached, save the whole engine -> JSON ->
// restore into a fresh engine with a DIFFERENT seed (so a correct continuation
// can only come from the restored per-flow PRNG state, not a re-seed).
function play(resumeAt: number): unknown[] {
  let engine = new Engine(bundle, { seed: 99 });
  let flow = engine.openFlow("main", { scene: "s" });
  const scripted = ["yes"];
  const out: unknown[] = [];
  for (let step = 0; step < 50; step++) {
    if (step === resumeAt) {
      const save = JSON.parse(JSON.stringify(engine.saveGame()));
      engine = new Engine(bundle, { seed: 31337 });
      engine.loadGame(save);
      flow = engine.getFlow("main")!;
    }
    const r = flow.advance();
    out.push(norm(r));
    if (r.type === "end") break;
    if (r.type === "choice") flow.choose(scripted.shift() ?? r.options.find((o) => o.eligible)!.id);
  }
  return out;
}

describe("save-game: execution-cursor persistence", () => {
  const reference = play(-1); // never resumes

  it("plays a deterministic seeded flow to the end", () => {
    expect(reference[0]).toEqual({ type: "line", id: "L1", text: "begin" });
    // the shuffle line shows the post-`set` gold (1), proving the effect ran
    expect(reference[1]).toMatchObject({ type: "line", text: expect.stringMatching(/^(alpha|beta|gamma) 1$/) });
    expect(reference[2]).toEqual({ type: "choice", options: ["yes", "no"] });
    expect(reference[3]).toEqual({ type: "line", id: "L_yes", text: "you have 1 gold" });
    expect(reference.at(-1)).toEqual({ type: "end" });
  });

  it("resumes identically when saved + restored at any step", () => {
    for (let k = 0; k <= reference.length; k++) {
      expect(play(k)).toEqual(reference);
    }
  });
});

describe("save-game: resume at a pending choice", () => {
  it("rebuilds the pending choice on load and continues", () => {
    const a = new Engine(bundle, { seed: 99 });
    const fa = a.openFlow("main", { scene: "s" });
    fa.advance(); // L1
    fa.advance(); // shuffle line
    expect(fa.advance().type).toBe("choice"); // pendingChoice now set
    const save = JSON.parse(JSON.stringify(a.saveGame()));

    const b = new Engine(bundle, { seed: 31337 });
    b.loadGame(save);
    const fb = b.getFlow("main")!;
    expect(fb.getChoices().map((o) => o.id)).toEqual(["yes", "no"]); // rebuilt from the saved group
    fb.choose("yes");
    expect(fb.advance()).toMatchObject({ type: "line", id: "L_yes", text: "you have 1 gold" });
    expect(fb.advance()).toEqual({ type: "end" });
  });
});
