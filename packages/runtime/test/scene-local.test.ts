// ---------------------------------------------------------------------------
// Scene-local props persist across scene re-entries (spec §7): "you revisit
// scenes, so e.g. a bark set must remember its progress on return." They are
// also per-scene (each scene has its own @scene namespace) and ride along in
// saves.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
import type { StepResult } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import type { ProjectFile, Scene, LocaleFile } from "@patterkit/model";

const project: ProjectFile = {
  schema: "patter/project@0", project: { id: "sl", name: "SL" },
  locales: { default: "en", all: ["en"] },
};

// Each entry of scene "s" bumps its scene-local @scene.count; we loop back into
// the scene until it reaches 3. If @scene.count reset on entry this would loop
// forever - it only terminates because the count PERSISTS across re-entries.
const scene: Scene = {
  id: "s", type: "scene", name: "S",
  sceneProps: [{ name: "count", type: "number", default: 0, shared: false }],
  onEntry: [{ kind: "set", target: "@scene.count", value: "@scene.count + 1" }],
  blocks: [
    { id: "b", type: "block", name: "B", children: [
      { id: "sn", type: "snippet", beats: [{ id: "L", kind: "text" }], jump: { to: "gate" } },
    ] },
    { id: "gate", type: "block", name: "Gate", children: [
      { id: "stop", type: "snippet", condition: "@scene.count >= 3", jump: { to: "END" } },
      { id: "go", type: "snippet", jump: { to: "s" } }, // re-enter the scene
    ] },
  ],
};
const en: LocaleFile = { schema: "patter/strings@0", scene: "s", locale: "en", strings: { L: "visit {@scene.count}" } };
const bundle = exportBundle({ project, scenes: [scene], locales: [en] });

const lines = (flow: { advance(): StepResult }): string[] => {
  const out: string[] = [];
  for (let i = 0; i < 50; i++) {
    const r = flow.advance();
    if (r.type === "end") break;
    if (r.type === "text" || r.type === "line") out.push(r.text);
  }
  return out;
};

describe("scene-local persistence", () => {
  it("a scene-local prop persists across re-entries", () => {
    const flow = new Engine(bundle).openFlow("f", { scene: "s" });
    expect(lines(flow)).toEqual(["visit 1", "visit 2", "visit 3"]);
  });

  it("per-scene bags survive saveGame / loadGame", () => {
    const engine = new Engine(bundle);
    const flow = engine.openFlow("f", { scene: "s" });
    expect(flow.advance()).toMatchObject({ type: "text", text: "visit 1" }); // count is now 1
    const save = JSON.parse(JSON.stringify(engine.saveGame()));
    expect(save.flows.f!.sceneBags.s).toEqual({ count: 1 });

    const restored = new Engine(bundle);
    restored.loadGame(save);
    // resumes mid-loop with count preserved -> reaches 2 then 3, then ends
    expect(lines(restored.getFlow("f")!)).toEqual(["visit 2", "visit 3"]);
  });
});
