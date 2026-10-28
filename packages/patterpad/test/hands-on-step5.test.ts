// ---------------------------------------------------------------------------
// The hands-on fixes review, step 5 (patterkit design/hands-on-fixes-code-review-2026-10.md, section 4 and
// "Step 5 ruled"), main-process side: a new scene lands after the open one and stays there on reload; a
// scene moves up and down as one undoable step; a renamed character keeps their colour in the project file,
// the play window, and the readable script; the play window's refusal names Game scopes; a plain "en"
// project spell-checks in the system's English; and Edit ▸ Move Up / Move Down carry the surface's keys.
// ---------------------------------------------------------------------------

import { describe, it, expect, afterEach } from "vitest";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalStringify, parseSource } from "@patterkit/core";
import { colourIndex as shellHash, hashColour } from "@wildwinter/app-shell";
import { loadProject, runScriptDoc, characterColour } from "@patterkit/ops";
import type { ProjectFile } from "@patterkit/model";
import * as project from "../src/main/project.js";

const TAVERN = fileURLToPath(new URL("../../../test-fixtures/tavern-example.patter", import.meta.url));

function openCopy(edit?: (dir: string) => void): string {
  const dir = join(mkdtempSync(join(tmpdir(), "pp-step5-")), "tavern.patter");
  cpSync(TAVERN, dir, { recursive: true });
  edit?.(dir);
  project.openProject(dir);
  project.hydrate();
  return dir;
}
const projectFile = (dir: string): ProjectFile => parseSource(readFileSync(join(dir, "tavern.patterproj"), "utf8")) as ProjectFile;
const order = (): string[] => project.hydrate()!.scenes.map((s) => s.id);

afterEach(() => { project.setSystemLocales([]); });

describe("a new scene goes after the open one (ruling 3)", () => {
  it("lands straight after `after`, written into sceneOrder in the same step, and stays there on reload", async () => {
    const dir = openCopy();
    expect(order()).toEqual(["scn_street", "scn_tavern"]);
    const res = await project.createScene("Cellar", "blank", undefined, "scn_street");
    expect(res.ok).toBe(true);
    expect(order()).toEqual(["scn_street", res.sceneId, "scn_tavern"]);
    expect(projectFile(dir).sceneOrder).toEqual(["scn_street", res.sceneId, "scn_tavern"]);
    // A fresh load reads it back in the same place.
    expect(loadProject(dir).scenes.map((s) => s.id)).toEqual(["scn_street", res.sceneId, "scn_tavern"]);
    // One step: its undo takes the scene and its place in the order back out.
    expect(project.projectHistoryState().undo?.label).toBe("New Scene");
    expect(await project.stepProjectHistory("undo")).toMatchObject({ ok: true });
    expect(order()).toEqual(["scn_street", "scn_tavern"]);
    expect(projectFile(dir).sceneOrder).toBeUndefined();
  });

  it("without `after` it goes at the end, as before, and leaves the project file alone", async () => {
    const dir = openCopy();
    const before = readFileSync(join(dir, "tavern.patterproj"), "utf8");
    const res = await project.createScene("Cellar");
    expect(order().at(-1)).toBe(res.sceneId);
    expect(readFileSync(join(dir, "tavern.patterproj"), "utf8")).toBe(before);
  });
});

describe("Move Up / Move Down for a scene (ruling 3)", () => {
  it("swaps it with its neighbour, writes the whole order, and undoes as one step", async () => {
    const dir = openCopy();
    const res = await project.moveScene("scn_tavern", -1);
    expect(res).toMatchObject({ ok: true, moved: true });
    expect(order()).toEqual(["scn_tavern", "scn_street"]);
    expect(res.project!.scenes.map((s) => s.id)).toEqual(["scn_tavern", "scn_street"]);
    expect(projectFile(dir).sceneOrder).toEqual(["scn_tavern", "scn_street"]);
    expect(project.projectHistoryState().undo?.label).toBe("Move Scene Up");
    await project.stepProjectHistory("undo");
    expect(projectFile(dir).sceneOrder).toBeUndefined();
  });

  it("at the first or last place moves nothing and writes nothing", async () => {
    const dir = openCopy();
    const before = readFileSync(join(dir, "tavern.patterproj"), "utf8");
    expect(await project.moveScene("scn_street", -1)).toMatchObject({ ok: true, moved: false });
    expect(await project.moveScene("scn_tavern", 1)).toMatchObject({ ok: true, moved: false });
    expect(readFileSync(join(dir, "tavern.patterproj"), "utf8")).toBe(before);
    expect((await project.moveScene("scn_gone", 1)).ok).toBe(false);
  });
});

describe("a renamed character keeps their colour (Q16)", () => {
  const renameBarkeep = async (): Promise<void> => {
    const s = project.readSettings()!;
    const res = await project.saveSettings({
      ...s, cast: s.cast.map((c) => (c.name === "BARKEEP" ? { ...c, name: "INNKEEPER" } : c)), castRenames: { BARKEEP: "INNKEEPER" },
    });
    expect(res.ok).toBe(true);
  };

  it("stamps the old name's slot on the member in the same save, and hands it to the renderer", async () => {
    const dir = openCopy();
    expect(hashColour("BARKEEP")).not.toBe(hashColour("INNKEEPER")); // otherwise the test proves nothing
    await renameBarkeep();
    const member = projectFile(dir).cast!.find((c) => c.name === "INNKEEPER")!;
    expect(member.colour).toBe(hashColour("BARKEEP"));
    expect(project.hydrate()!.castColours).toEqual({ INNKEEPER: hashColour("BARKEEP") });
    // A slot already kept stays through a second rename.
    const s = project.readSettings()!;
    expect(s.cast.find((c) => c.name === "INNKEEPER")!.colour).toBe(hashColour("BARKEEP"));
    await project.saveSettings({ ...s, cast: s.cast.map((c) => (c.name === "INNKEEPER" ? { ...c, name: "HOST" } : c)), castRenames: { INNKEEPER: "HOST" } });
    expect(projectFile(dir).cast!.find((c) => c.name === "HOST")!.colour).toBe(hashColour("BARKEEP"));
  });

  it("the play window paints the line in the kept colour", async () => {
    openCopy();
    await renameBarkeep();
    project.startPlay("scn_tavern");
    const line = project.playToStop().steps.find((st) => st.kind === "line" && st.character === "INNKEEPER");
    expect(line?.colour).toBe(hashColour("BARKEEP"));
  });

  it("the readable script and the Word export paint the cue in the kept colour", async () => {
    const dir = openCopy();
    await renameBarkeep();
    const doc = runScriptDoc(loadProject(dir));
    const cue = doc.elements.find((e) => e.kind === "line" && e.character === "INNKEEPER");
    expect(cue && cue.kind === "line" ? cue.colour : undefined).toBe(hashColour("BARKEEP"));
    expect(characterColour("INNKEEPER", hashColour("BARKEEP"))).toBe(characterColour("BARKEEP"));
    const docx = await project.scriptDocument("docx");
    const JSZip = (await import("jszip")).default;
    const xml = await (await JSZip.loadAsync(docx!)).file("word/document.xml")!.async("string");
    expect(xml).toContain(`w:color w:val="${characterColour("BARKEEP")}"`);
  });

  it("ops' hash is the shell's, so the stamp and every lookup agree", () => {
    for (const n of ["BARKEEP", "INNKEEPER", "ANNA", "x"]) expect(hashColour(n)).toBe(shellHash(n));
  });
});

describe("the play window's refusal names Game scopes (Q16)", () => {
  it("advises declaring the scope under Project Settings > Game scopes", () => {
    const msg = project.playRefusal("this content names @story, which nothing provides");
    expect(msg).toContain("Project Settings > Game scopes");
    expect(msg).not.toContain("World properties");
  });
});

describe("spell-check follows the source language (Q16)", () => {
  const withLocale = (locale: string) => (dir: string): void => {
    const p = projectFile(dir);
    writeFileSync(join(dir, "tavern.patterproj"), canonicalStringify({ ...p, locales: { default: locale, all: [locale] } }));
  };

  it("a plain \"en\" project uses the system's English", () => {
    project.setSystemLocales(["en-GB", "fr-FR"]);
    openCopy(withLocale("en"));
    expect(project.hydrate()!.dictionary.language).toBe("en-GB");
    expect(project.hydrate()!.sourceLocale).toBe("en");
  });

  it("with no English on the system, or a project that names its variety, the system doesn't decide", () => {
    project.setSystemLocales(["de-DE"]);
    openCopy(withLocale("en"));
    expect(project.hydrate()!.dictionary.language).toBe("en-US");
    project.setSystemLocales(["en-GB"]);
    openCopy(withLocale("en-US"));
    expect(project.hydrate()!.dictionary.language).toBe("en-US");
  });
});
