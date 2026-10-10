// Line padding on the main side (design/proposals/line-padding.md): the project's default pause is read
// for the settings and the inspector (the built-in one when it sets none), stored only when it differs
// from the built-in one, and the Play window's steps carry each line's resolved pause.

import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSource } from "@patterkit/core";
import { DEFAULT_PAD_AFTER } from "@patterkit/model";
import * as project from "../src/main/project.js";

const TAVERN = resolve(dirname(fileURLToPath(import.meta.url)), "../../../test-fixtures/tavern-example.patter");

function tavern(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "pp-pad-")), "tavern.patter");
  cpSync(TAVERN, dir, { recursive: true });
  return dir;
}
const storedPad = (dir: string): unknown => (parseSource(readFileSync(join(dir, "tavern.patterproj"), "utf8")) as { padAfterDefault?: unknown }).padAfterDefault;

describe("the project's default pause", () => {
  it("reads the built-in one when the project sets none, and stores one only when it differs", async () => {
    const dir = tavern();
    expect(project.openProject(dir).padAfterDefault).toBe(DEFAULT_PAD_AFTER);
    expect(project.readSettings()!.padAfterDefault).toBe(DEFAULT_PAD_AFTER);

    expect((await project.saveSettings({ ...project.readSettings()! })).ok).toBe(true);
    expect(storedPad(dir)).toBeUndefined();

    const saved = await project.saveSettings({ ...project.readSettings()!, padAfterDefault: 0.25 });
    expect(saved.ok).toBe(true);
    expect(saved.project!.padAfterDefault).toBe(0.25);
    expect(storedPad(dir)).toBe(0.25);

    const { padAfterDefault: _omit, ...older } = project.readSettings()!; // an older settings shape sends none
    expect((await project.saveSettings(older)).ok).toBe(true);
    expect(storedPad(dir)).toBe(0.25);

    expect((await project.saveSettings({ ...project.readSettings()!, padAfterDefault: DEFAULT_PAD_AFTER })).ok).toBe(true);
    expect(storedPad(dir)).toBeUndefined();
  });

  it("gives Play each line's resolved pause", async () => {
    const dir = tavern();
    const opened = project.openProject(dir);
    await project.saveSettings({ ...project.readSettings()!, padAfterDefault: 1.25 });
    project.startPlay(opened.scenes[0]!.id);
    const steps = project.playToStop().steps.filter((s) => s.kind !== "gameEvent");
    expect(steps.length).toBeGreaterThan(0);
    for (const s of steps) expect(typeof s.padAfter).toBe("number");
    expect(steps.some((s) => s.padAfter === 1.25)).toBe(true);
  });
});
