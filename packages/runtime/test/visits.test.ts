// ---------------------------------------------------------------------------
// Visit counts (spec §7) surfaced as functions: `visits(id)` / `seen(id)` are
// this flow's entry count; `patter_visits(id)` / `patter_seen(id)` are the
// world-wide (shared) count. Counts are entered-only and ride along in saves.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
import type { StepResult } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import type { ProjectFile, Scene, LocaleFile } from "@patterkit/model";

const project: ProjectFile = {
  schema: "patter/project@0", project: { id: "v", name: "V" },
  locales: { default: "en", all: ["en"] },
};

function lines(flow: { advance(): StepResult }): string[] {
  const out: string[] = [];
  for (let i = 0; i < 50; i++) {
    const r = flow.advance();
    if (r.type === "end") break;
    if (r.type === "line" || r.type === "text") out.push(r.text);
  }
  return out;
}

describe("visits() / seen() in conditions", () => {
  // Loop through "room": play a different line on the first visit vs later ones,
  // and stop after the third entry - all gated by visits('room').
  const scene: Scene = {
    id: "s", type: "scene", name: "S",
    blocks: [
      { id: "room", type: "block", name: "Room", children: [
        { id: "first", type: "snippet", condition: "visits('room') == 1", beats: [{ id: "F", kind: "text" }], jump: { to: "gate" } },
        { id: "again", type: "snippet", condition: "visits('room') > 1", beats: [{ id: "A", kind: "text" }], jump: { to: "gate" } },
      ] },
      { id: "gate", type: "block", name: "Gate", children: [
        { id: "stop", type: "snippet", condition: "visits('room') >= 3", jump: { to: "END" } },
        { id: "go", type: "snippet", jump: { to: "room" } },
      ] },
    ],
  };
  const en: LocaleFile = { schema: "patter/strings@0", scene: "s", locale: "en", strings: { F: "First time here.", A: "Back again." } };
  const bundle = exportBundle({ project, scenes: [scene], locales: [en] });

  it("counts entries and gates content on them", () => {
    const flow = new Engine(bundle).openFlow("f", { scene: "s" });
    expect(lines(flow)).toEqual(["First time here.", "Back again.", "Back again."]); // visits 1, 2, 3
  });
});

describe("flow-local vs world (patter) counts", () => {
  // A one-shot scene; two flows each enter it once.
  const scene: Scene = {
    id: "s", type: "scene", name: "S",
    blocks: [{ id: "room", type: "block", name: "Room", children: [
      { id: "sn", type: "snippet", beats: [{ id: "L", kind: "text" }], jump: { to: "END" } },
    ] }],
  };
  const en: LocaleFile = { schema: "patter/strings@0", scene: "s", locale: "en", strings: { L: "hi" } };
  const bundle = exportBundle({ project, scenes: [scene], locales: [en] });

  it("each flow counts its own visits; the world counts all of them", () => {
    const engine = new Engine(bundle);

    const alice = engine.openFlow("alice", { scene: "s" });
    lines(alice);
    let save = engine.saveGame();
    expect(save.flows.alice!.visits.room).toBe(1);
    expect(save.sharedVisits.room).toBe(1);

    const bob = engine.openFlow("bob", { scene: "s" });
    lines(bob);
    save = engine.saveGame();
    expect(save.flows.alice!.visits.room).toBe(1); // alice's own count unchanged
    expect(save.flows.bob!.visits.room).toBe(1);
    expect(save.sharedVisits.room).toBe(2);        // alice + bob, world-wide
  });

  it("patter_seen reflects another flow's prior visit; counts survive save/load", () => {
    // A flow whose only line is gated on `patter_seen('room')` - true iff some
    // flow has already been to "room".
    const gated: Scene = {
      id: "g", type: "scene", name: "G",
      blocks: [{ id: "b", type: "block", name: "B", children: [
        { id: "sn", type: "snippet", condition: "patter_seen('room')", beats: [{ id: "L2", kind: "text" }], jump: { to: "END" } },
      ] }],
    };
    const en2: LocaleFile = { schema: "patter/strings@0", scene: "g", locale: "en", strings: { L2: "someone has been to the room" } };
    const b2 = exportBundle({ project, scenes: [scene, gated], locales: [en, en2] });

    const engine = new Engine(b2);
    lines(engine.openFlow("alice", { scene: "s" }));        // alice visits room (world room = 1)
    expect(lines(engine.openFlow("seer", { scene: "g" }))).toEqual(["someone has been to the room"]);

    // round-trip the whole game; the world count + the seer flow restore intact.
    const restored = new Engine(b2);
    restored.loadGame(JSON.parse(JSON.stringify(engine.saveGame())));
    expect(restored.saveGame().sharedVisits.room).toBe(1);
    expect(lines(restored.openFlow("seer2", { scene: "g" }))).toEqual(["someone has been to the room"]);
  });
});
