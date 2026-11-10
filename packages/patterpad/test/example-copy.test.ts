import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { planExampleCopy } from "../src/main/example-copy.js";
import { EXAMPLES } from "../src/shared/examples.js";
import { readTextStamp } from "../src/shared/wav-hash.js";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const projects = join(repo, "examples/projects");

function fixture(audioRoot: string | undefined, makeAudio = true): string {
  const dir = mkdtempSync(join(tmpdir(), "example-copy-"));
  const proj = join(dir, "demo.patter");
  mkdirSync(proj);
  writeFileSync(join(proj, "demo.patterproj"), JSON.stringify(audioRoot === undefined ? {} : { audioRoot }));
  if (makeAudio) mkdirSync(join(dir, "audio"));
  return proj;
}

describe("copying a shipped example", () => {
  it("copies a project with no audio beside it as the .patter folder alone", () => {
    const plan = planExampleCopy(fixture(undefined), "/dest", "The Demo");
    expect(plan.project).toBe(join("/dest", "demo.patter"));
    expect(plan.shown).toBe(plan.project);
    expect(plan.copies).toHaveLength(1);
  });

  it("puts a project and the audio beside it into a folder named after the example", () => {
    const src = fixture("../audio");
    const plan = planExampleCopy(src, "/dest", "The Demo");
    expect(plan.shown).toBe(join("/dest", "The Demo"));
    expect(plan.project).toBe(join("/dest", "The Demo", "demo.patter"));
    expect(plan.copies[1]).toEqual({ from: join(dirname(src), "audio"), to: join("/dest", "The Demo", "audio") });
  });

  it("leaves an audio root that's missing, or further away, behind", () => {
    expect(planExampleCopy(fixture("../audio", false), "/dest", "X").copies).toHaveLength(1);
    expect(planExampleCopy(fixture("../../elsewhere/audio"), "/dest", "X").copies).toHaveLength(1);
  });

  it("finds the tour's audio beside it, and the tour's manifest names only takes that exist", () => {
    const tour = EXAMPLES.find((x) => x.file === "tour.patter")!;
    const plan = planExampleCopy(join(projects, tour.file), "/dest", tour.name);
    expect(plan.copies.map((c) => c.to)).toEqual([join("/dest", tour.name, "tour.patter"), join("/dest", tour.name, "audio")]);
    const manifest = JSON.parse(readFileSync(join(projects, "audio/patteraudio.json"), "utf8")) as { clips: Record<string, { file: string }> };
    const files = Object.values(manifest.clips).map((c) => join(projects, "audio", c.file));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(existsSync(f), f).toBe(true);
      expect(readTextStamp(readFileSync(f)), f).toMatch(/^[A-Za-z0-9+/]{6}$/);
    }
  });
});
