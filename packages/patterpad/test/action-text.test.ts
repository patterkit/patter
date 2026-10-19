// Action text on the main side (patterkit design/proposals/action-text.md): the project's "Localise text lines
// in dialogue scenes" is read for the settings and the surface (off when the project sets none), stored only when
// on, and the Play window's text steps in a dialogue scene carry `action` while it's off.

import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSource } from "@patterkit/core";
import * as project from "../src/main/project.js";

const TAVERN = resolve(dirname(fileURLToPath(import.meta.url)), "../../../test-fixtures/tavern-example.patter");

function tavern(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "pp-action-")), "tavern.patter");
  cpSync(TAVERN, dir, { recursive: true });
  return dir;
}
const stored = (dir: string): unknown =>
  (parseSource(readFileSync(join(dir, "tavern.patterproj"), "utf8")) as { localiseDialogueText?: unknown }).localiseDialogueText;

describe("Localise text lines in dialogue scenes", () => {
  it("reads off when the project sets none, and stores it only when on", async () => {
    const dir = tavern();
    expect(project.openProject(dir).localiseDialogueText).toBe(false);
    expect(project.readSettings()!.localiseDialogueText).toBe(false);

    const saved = await project.saveSettings({ ...project.readSettings()!, localiseDialogueText: true });
    expect(saved.ok).toBe(true);
    expect(saved.project!.localiseDialogueText).toBe(true);
    expect(stored(dir)).toBe(true);

    const { localiseDialogueText: _omit, ...older } = project.readSettings()!; // an older settings shape sends none
    expect((await project.saveSettings(older)).ok).toBe(true);
    expect(stored(dir)).toBe(true);

    expect((await project.saveSettings({ ...project.readSettings()!, localiseDialogueText: false })).ok).toBe(true);
    expect(stored(dir)).toBeUndefined();
  });

  it("gives Play a dialogue scene's text as action while it's off, and as shown text when on", async () => {
    const dir = tavern();
    project.openProject(dir);
    const textSteps = () => {
      project.startPlay("scn_tavern"); // the tavern, where the barkeep speaks (the street is a text scene)
      return project.playToStop().steps.filter((s) => s.kind === "text");
    };
    const off = textSteps();
    expect(off.length).toBeGreaterThan(0);
    expect(off.every((s) => s.action === true)).toBe(true);
    await project.saveSettings({ ...project.readSettings()!, localiseDialogueText: true });
    expect(textSteps().some((s) => s.action)).toBe(false);
  });
});
