// ---------------------------------------------------------------------------
// `temporary` on a scene-local (`@scene`) property (spec §7): default props
// PERSIST across scene re-entries, but a `temporary` prop is reseeded to its
// default on every entry ("fresh each playthrough" - Ink's `temp`). Here one
// scene prop persists and one is temporary; the flow leaves and re-enters the
// scene, so the temporary one resets while the persistent one accumulates.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import type { ProjectFile, Scene, LocaleFile } from "@patterkit/model";

const project: ProjectFile = {
  schema: "patter/project@0", project: { id: "tmp", name: "Tmp" },
  locales: { default: "en", all: ["en"] },
};

// s1 owns both props. Each visit bumps both, shows them, then (on the first
// visit) tunnels out to s2 and back - re-entering s1 - before ending.
const s1: Scene = {
  id: "s1", type: "scene", name: "S1",
  sceneProps: [
    { name: "persist", type: "number", default: 0 },                   // persists across re-entries
    { name: "temp", type: "number", default: 0, temporary: true },     // reseeded every entry
  ],
  blocks: [
    { id: "b1", type: "block", name: "B1", children: [
      { id: "bump", type: "snippet",
        onEnter: [
          { kind: "set", target: "@scene.persist", value: "@scene.persist + 1" },
          { kind: "set", target: "@scene.temp", value: "@scene.temp + 1" },
        ],
        beats: [{ id: "T", kind: "text" }], jump: { to: "gate" } },
    ] },
    { id: "gate", type: "block", name: "Gate", children: [
      { id: "again", type: "snippet", condition: "visits('s1') < 2", jump: { to: "s2" } },
      { id: "done", type: "snippet", jump: { to: "END" } },
    ] },
  ],
};
const s2: Scene = {
  id: "s2", type: "scene", name: "S2",
  blocks: [{ id: "b2", type: "block", name: "B2", children: [
    { id: "back", type: "snippet", jump: { to: "s1" } },
  ] }],
};
const en: LocaleFile = { schema: "patter/strings@0", scene: "s1", locale: "en", strings: { T: "persist={@scene.persist} temp={@scene.temp}" } };
const bundle = exportBundle({ project, scenes: [s1, s2], locales: [en] });

describe("temporary scene props", () => {
  it("a temporary prop reseeds on re-entry while a normal prop persists", () => {
    const flow = new Engine(bundle).openFlow("main", { scene: "s1" });
    // first visit: both seeded 0, bumped to 1
    expect(flow.advance()).toMatchObject({ type: "text", text: "persist=1 temp=1" });
    // tunnels s1 -> s2 -> s1: temp reseeds to 0 then bumps to 1; persist stays 1 then bumps to 2
    expect(flow.advance()).toMatchObject({ type: "text", text: "persist=2 temp=1" });
    expect(flow.advance()).toEqual({ type: "end" });
  });
});
