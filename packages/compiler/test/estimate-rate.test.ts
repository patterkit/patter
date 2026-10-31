// ---------------------------------------------------------------------------
// The timing for lines without audio (design/proposals/syllable-counter.md): a project's own
// `estimateSyllablesPerSecond` reaches the bundle only when it sets one, so a bundle without it is exactly as it was.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import type { ProjectFile, Scene } from "@patterkit/model";
import { exportBundle } from "@patterkit/compiler";

const project = (extra: Partial<ProjectFile> = {}): ProjectFile =>
  ({ schema: "patter/project@0", project: { id: "p", name: "P" }, locales: { default: "en", all: ["en"] }, cast: [{ name: "TAM" }], ...extra });
const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [
  { id: "b", type: "block", name: "B", children: [{ id: "sn", type: "snippet", beats: [{ id: "L1", kind: "line", character: "TAM" }] }] },
] };

describe("the timing for lines without audio in the bundle", () => {
  it("reaches the bundle only when the project sets one, and changes its hash", () => {
    const plain = exportBundle({ project: project(), scenes: [scene], locales: [] });
    const own = exportBundle({ project: project({ estimateSyllablesPerSecond: 4 }), scenes: [scene], locales: [] });
    expect("estimateSyllablesPerSecond" in plain).toBe(false);
    expect(own.estimateSyllablesPerSecond).toBe(4);
    expect(own.content.hash).not.toBe(plain.content.hash);
    expect(own.content.structureHash).not.toBe(plain.content.structureHash);
  });});
