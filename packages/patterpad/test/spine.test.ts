// The M0 data spine, headless. This is exactly what the Electron MAIN process does, minus Electron:
// open the real tavern project through @patterkit/ops, read a scene's source the way `scene:read`
// does, prove the canonical save form is stable (idempotent - what `scene:save` writes survives a
// round-trip), prove the write path lands bytes, and play the project. If this passes, the app's
// data flow is sound and only the GUI wiring (which Electron can't run headlessly here) is untested.

import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProject, runPlay, renderPlay, applyWrites } from "@patterkit/ops";
import { parseSource, canonicalStringify } from "@patterkit/core";

const here = dirname(fileURLToPath(import.meta.url));
const TAVERN = resolve(here, "../../../test-fixtures/tavern-example.patter"); // the PINNED fixture, not the live examples/tavern scratch

describe("patterpad M0 spine: open -> read -> save-stable -> write -> play", () => {
  it("opens the tavern project and discovers its scenes + shards", () => {
    const p = loadProject(TAVERN);
    expect(p.project.project.name).toBe("The Tavern");
    expect(p.scenes.length).toBeGreaterThanOrEqual(2); // tavern + street
    for (const scene of p.scenes) {
      expect(p.sceneFiles[scene.id]).toBeTruthy();      // every scene maps to a flow shard
      expect(readFileSync(p.sceneFiles[scene.id]!, "utf8").length).toBeGreaterThan(0);
    }
  });

  it("the canonical save form is idempotent (what scene:save writes round-trips byte-identically)", () => {
    const p = loadProject(TAVERN);
    for (const scene of p.scenes) {
      const src = readFileSync(p.sceneFiles[scene.id]!, "utf8");
      const once = canonicalStringify(parseSource(src));
      const twice = canonicalStringify(parseSource(once));
      expect(twice).toBe(once); // re-saving an already-canonical file is a no-op (no churn)
    }
  });

  it("the write path (applyWrites) lands canonical bytes on disk", () => {
    const p = loadProject(TAVERN);
    const canonical = canonicalStringify(parseSource(readFileSync(p.sceneFiles[p.scenes[0]!.id]!, "utf8")));
    // Write to a TEMP file (never the shared example file - other tests read it concurrently).
    const out = join(mkdtempSync(join(tmpdir(), "pp-spine-")), "scene.patterflow");
    applyWrites([{ path: out, content: canonical }]);
    expect(readFileSync(out, "utf8")).toBe(canonical);
  });

  it("plays the project and produces a transcript", () => {
    const p = loadProject(TAVERN);
    const result = runPlay(p, { scene: p.scenes[0]!.id });
    expect(["end", "stalled", "max-steps"]).toContain(result.outcome);
    expect(result.events.length).toBeGreaterThan(0);
    expect(renderPlay(result).length).toBeGreaterThan(0);
  });
});
