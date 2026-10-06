// The engine names the build it is playing, as every other runtime does (Unity's BuildId, Unreal's
// BuildId and buildId, Godot's build_id): the bundle's content hash, which a debug link handshakes with.

import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";

const bundle = exportBundle({
  project: { schema: "patter/project@0", project: { id: "b", name: "B" }, locales: { default: "en", all: ["en"] } },
  scenes: [{ id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [] }] }],
  locales: [],
});

describe("buildId", () => {
  it("is the bundle's content hash", () => {
    expect(bundle.content.hash).toBeTruthy();
    expect(new Engine(bundle).buildId).toBe(bundle.content.hash);
  });

  it("is empty for a bundle with no hash", () => {
    const { hash: _hash, ...content } = bundle.content;
    expect(new Engine({ ...bundle, content }).buildId).toBe("");
  });
});
