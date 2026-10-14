// A project-level string's translations go stale when its source changes in Project Settings, as a changed
// line's do: a cast display name, a qualifier's name, the speaker pattern, or a character's own label with a
// qualifier. The save stamps the string's `modifiedAt` in `_project.patterx`, and the next localisation export
// flags the translation. Only a translated string is stamped, and a qualifier rename moves ids without making
// anything stale.

import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, cpSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSource, canonicalStringify } from "@patterkit/core";
import { walkNodes } from "@patterkit/model";
import type { AuthoringFile, FlowFile, Group, ProjectFile, Snippet } from "@patterkit/model";
import { loadProject, extractLoc } from "@patterkit/ops";
import * as project from "../src/main/project.js";

const TAVERN = resolve(dirname(fileURLToPath(import.meta.url)), "../../../test-fixtures/tavern-example.patter");
const TRANSLATED = ["cast:BARKEEP", "qualifier:os", "speaker:pattern", "speaker:BARKEEP:os"];

/** A private copy of the tavern, in English and French, where BARKEEP's greeting is O.S., BARKEEP has a display
 *  name and a label of their own with O.S., and French translates those four strings (imported a while ago).
 *  `translated: false` leaves French without them. */
function tavern(translated = true): { dir: string; projectAuthoring: string } {
  const dir = join(mkdtempSync(join(tmpdir(), "pp-stale-")), "tavern.patter");
  cpSync(TAVERN, dir, { recursive: true });
  const flowPath = join(dir, "scenes", "tavern.patterflow");
  const flow = parseSource(readFileSync(flowPath, "utf8")) as FlowFile;
  walkNodes<Group | Snippet>(flow.scene.blocks[0]!.children, (n) => {
    if (n.type === "snippet") for (const b of n.beats ?? []) if (b.id === "L_greet" && b.kind === "line") b.qualifier = "os";
  });
  writeFileSync(flowPath, canonicalStringify(flow));

  const projFile = join(dir, "tavern.patterproj");
  const proj = parseSource(readFileSync(projFile, "utf8")) as ProjectFile;
  proj.locales = { default: "en", all: ["en", "fr"] };
  proj.cast = [{ name: "BARKEEP", displayName: "The Barkeep", qualifierLabels: { os: "The barkeep, out back" } }, { name: "PLAYER", displayName: "You" }];
  writeFileSync(projFile, canonicalStringify(proj));

  mkdirSync(join(dir, "loc", "fr"));
  writeFileSync(join(dir, "loc", "fr", "_project.patterloc"), canonicalStringify({ schema: "patter/strings@0", scene: "@project", locale: "fr",
    strings: translated ? { "cast:BARKEEP": "Le tavernier", "qualifier:os": "H.C.", "speaker:pattern": "{name} [{qualifier}]", "speaker:BARKEEP:os": "Le tavernier, dehors" } : {} }));
  const projectAuthoring = join(dir, "authoring", "_project.patterx");
  if (translated) {
    const edits = Object.fromEntries(TRANSLATED.map((id) => [id, { localisedAt: { fr: "2026-10-01T00:00:00Z" } }]));
    writeFileSync(projectAuthoring, canonicalStringify({ schema: "patter/authoring@0", edits } satisfies AuthoringFile));
  }
  return { dir, projectAuthoring };
}

/** The ids the French export flags stale, read back from disk. */
function staleIds(dir: string): string[] {
  return extractLoc(loadProject(dir), { locale: "fr" }).entries.filter((e) => e.stale).map((e) => e.id).sort();
}

describe("project-level strings go stale when their source changes in settings", () => {
  it("starts with nothing stale", () => {
    const { dir } = tavern();
    expect(staleIds(dir)).toEqual([]);
  });

  it("flags each changed string, and only it", async () => {
    const cases: Array<[string, (s: ReturnType<typeof project.readSettings> & object) => object]> = [
      ["cast:BARKEEP", (s) => ({ cast: s.cast.map((c) => (c.name === "BARKEEP" ? { ...c, displayName: "The Landlord" } : c)) })],
      ["qualifier:os", (s) => ({ qualifiers: s.qualifiers!.map((q) => (q.gameId === "os" ? { ...q, name: "OFF" } : q)) })],
      ["speaker:pattern", () => ({ speakerPattern: "{name}, {qualifier}" })],
      ["speaker:BARKEEP:os", (s) => ({ cast: s.cast.map((c) => (c.name === "BARKEEP" ? { ...c, qualifierLabels: { os: "The landlord, out back" } } : c)) })],
    ];
    for (const [id, change] of cases) {
      const { dir } = tavern();
      project.openProject(dir);
      const s = project.readSettings()!;
      expect((await project.saveSettings({ ...s, ...change(s) })).ok).toBe(true);
      expect(staleIds(dir)).toEqual([id]);
    }
  });

  it("doesn't flag a save that changes nothing, or stamp a string nobody has translated", async () => {
    const { dir, projectAuthoring } = tavern();
    project.openProject(dir);
    const before = readFileSync(projectAuthoring, "utf8");
    expect((await project.saveSettings(project.readSettings()!)).ok).toBe(true);
    const s = project.readSettings()!;
    expect((await project.saveSettings({ ...s, cast: s.cast.map((c) => (c.name === "PLAYER" ? { ...c, displayName: "Yourself" } : c)) })).ok).toBe(true);
    expect(readFileSync(projectAuthoring, "utf8")).toBe(before);
    expect(staleIds(dir)).toEqual([]);
  });

  it("writes no project authoring shard when no language has translated anything", async () => {
    const { dir, projectAuthoring } = tavern(false);
    project.openProject(dir);
    const s = project.readSettings()!;
    expect((await project.saveSettings({ ...s, speakerPattern: "{name}, {qualifier}" })).ok).toBe(true);
    expect(existsSync(projectAuthoring)).toBe(false);
  });

  it("moves ids on a qualifier rename without flagging them, and flags a rename that also changes the name", async () => {
    const { dir } = tavern();
    project.openProject(dir);
    const s = project.readSettings()!;
    const renamed = s.qualifiers!.map((q) => (q.gameId === "os" ? { ...q, gameId: "off" } : q));
    expect((await project.saveSettings({ ...s, qualifiers: renamed, qualifierRenames: { os: "off" } })).ok).toBe(true);
    expect(staleIds(dir)).toEqual([]);

    const again = project.readSettings()!;
    const both = again.qualifiers!.map((q) => (q.gameId === "off" ? { ...q, gameId: "out", name: "OUT" } : q));
    expect((await project.saveSettings({ ...again, qualifiers: both, qualifierRenames: { off: "out" } })).ok).toBe(true);
    expect(staleIds(dir)).toEqual(["qualifier:out"]);
  });
});
