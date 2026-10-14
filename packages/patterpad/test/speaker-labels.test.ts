// Speaker labels on the main side (design/proposals/qualified-speaker-labels.md): the speaker pattern is stored
// only when it isn't the default; the Cast tab's pairs come from every scene; a character's own labels with a
// qualifier save with the cast; and changing a qualifier's Game ID moves those labels, their translations,
// and their edit records with it, through the same lock-aware write path as any save.

import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, cpSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSource, canonicalStringify } from "@patterkit/core";
import { walkNodes, DEFAULT_SPEAKER_PATTERN } from "@patterkit/model";
import type { AuthoringFile, CastMember, FlowFile, Group, LocaleFile, ProjectFile, Snippet } from "@patterkit/model";
import * as project from "../src/main/project.js";
import { renameQualifierLabels, renameQualifierStrings, renameQualifiersInAuthoring, cleanRenames } from "../src/main/qualifiers.js";

const TAVERN = resolve(dirname(fileURLToPath(import.meta.url)), "../../../test-fixtures/tavern-example.patter");

/** A private copy of the tavern, in English and French, where BARKEEP's greeting is O.S. and PLAYER has a
 *  label of their own with V.O. (no line uses it) and its French translation. */
function tavernWithLabels(): { dir: string; projFile: string; frPath: string; authoringPath: string } {
  const dir = join(mkdtempSync(join(tmpdir(), "pp-labels-")), "tavern.patter");
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
  proj.cast = [{ name: "BARKEEP", qualifierLabels: { os: "The barkeep, out back" } }, { name: "PLAYER", qualifierLabels: { vo: "Your thoughts" } }];
  writeFileSync(projFile, canonicalStringify(proj));

  mkdirSync(join(dir, "loc", "fr"));
  const frPath = join(dir, "loc", "fr", "_project.patterloc");
  writeFileSync(frPath, canonicalStringify({ schema: "patter/strings@0", scene: "@project", locale: "fr",
    strings: { "speaker:BARKEEP:os": "Le tavernier, dehors", "speaker:PLAYER:vo": "Tes pensées", "speaker:pattern": "{name} [{qualifier}]", "qualifier:os": "H.C." } }));

  const authoringPath = join(dir, "authoring", "tavern.patterx");
  const af = parseSource(readFileSync(authoringPath, "utf8")) as AuthoringFile;
  af.edits = { ...af.edits, "speaker:BARKEEP:os": { modifiedAt: "2026-10-01T00:00:00Z" } };
  writeFileSync(authoringPath, canonicalStringify(af));
  return { dir, projFile, frPath, authoringPath };
}

const read = <T>(path: string): T => parseSource(readFileSync(path, "utf8")) as T;

describe("speaker labels in the project session", () => {
  it("lists the pairs the lines use, across every scene", () => {
    const { dir } = tavernWithLabels();
    project.openProject(dir);
    expect(project.speakerPairs()).toEqual([{ character: "BARKEEP", qualifier: "os" }]);
  });

  it("stores the speaker pattern only when it isn't the default, and blank drops it", async () => {
    const { dir, projFile } = tavernWithLabels();
    project.openProject(dir);
    expect(project.readSettings()!.speakerPattern).toBe("");
    expect((await project.saveSettings({ ...project.readSettings()!, speakerPattern: "{name}, {qualifier}" })).ok).toBe(true);
    expect(read<ProjectFile>(projFile).speakerPattern).toBe("{name}, {qualifier}");
    expect(project.readSettings()!.speakerPattern).toBe("{name}, {qualifier}");
    expect((await project.saveSettings({ ...project.readSettings()!, speakerPattern: DEFAULT_SPEAKER_PATTERN })).ok).toBe(true);
    expect(read<ProjectFile>(projFile).speakerPattern).toBeUndefined();
    expect((await project.saveSettings({ ...project.readSettings()!, speakerPattern: "{qualifier}: {name}" })).ok).toBe(true);
    expect((await project.saveSettings({ ...project.readSettings()!, speakerPattern: "" })).ok).toBe(true);
    expect(read<ProjectFile>(projFile).speakerPattern).toBeUndefined();
    // A caller that sends none (an older settings shape) leaves it as it is.
    expect((await project.saveSettings({ ...project.readSettings()!, speakerPattern: "{name}/{qualifier}" })).ok).toBe(true);
    const { speakerPattern: _omit, ...older } = project.readSettings()!;
    expect((await project.saveSettings(older)).ok).toBe(true);
    expect(read<ProjectFile>(projFile).speakerPattern).toBe("{name}/{qualifier}");
  });

  it("saves a character's own labels with the cast", async () => {
    const { dir, projFile } = tavernWithLabels();
    project.openProject(dir);
    const s = project.readSettings()!;
    const cast: CastMember[] = s.cast.map((c) => (c.name === "PLAYER" ? { name: "PLAYER", qualifierLabels: { vo: "Inner voice" } } : c));
    expect((await project.saveSettings({ ...s, cast })).ok).toBe(true);
    expect(read<ProjectFile>(projFile).cast!.find((c) => c.name === "PLAYER")!.qualifierLabels).toEqual({ vo: "Inner voice" });
  });

  it("a Game ID change moves the cast's labels, their translations, and their edit records, a swap as a swap", async () => {
    const { dir, projFile, frPath, authoringPath } = tavernWithLabels();
    project.openProject(dir);
    const s = project.readSettings()!;
    const swapped = s.qualifiers.map((q) => (q.gameId === "os" ? { ...q, gameId: "vo" } : q.gameId === "vo" ? { ...q, gameId: "os" } : q));
    expect((await project.saveSettings({ ...s, qualifiers: swapped, qualifierRenames: { os: "vo", vo: "os" } })).ok).toBe(true);

    expect(read<ProjectFile>(projFile).cast).toEqual([
      { name: "BARKEEP", qualifierLabels: { vo: "The barkeep, out back" } },
      { name: "PLAYER", qualifierLabels: { os: "Your thoughts" } },
    ]);
    expect(read<LocaleFile>(frPath).strings).toEqual({
      "speaker:BARKEEP:vo": "Le tavernier, dehors", "speaker:PLAYER:os": "Tes pensées", "speaker:pattern": "{name} [{qualifier}]", "qualifier:vo": "H.C.",
    });
    const edits = read<AuthoringFile>(authoringPath).edits!;
    expect(edits["speaker:BARKEEP:vo"]).toEqual({ modifiedAt: "2026-10-01T00:00:00Z" });
    expect(edits["speaker:BARKEEP:os"]).toBeUndefined();
    // The line moved with it, so BARKEEP's pair is still used; PLAYER's label is the one no line uses.
    expect(project.speakerPairs()).toEqual([{ character: "BARKEEP", qualifier: "vo" }]);
    const stray = project.validate().problems.filter((p) => p.message.includes("own label")).map((p) => p.message);
    expect(stray).toHaveLength(1);
    expect(stray[0]).toContain("'PLAYER'");
  });
});

describe("the label rename helpers", () => {
  const renames = cleanRenames({ vo: "os", os: "vo" })!;

  it("moves each cast member's labels, a swap as a swap, and says when nothing moved", () => {
    const cast: CastMember[] = [{ name: "A", qualifierLabels: { vo: "a-vo", os: "a-os", radio: "a-radio" } }, { name: "B" }];
    expect(renameQualifierLabels(cast, renames)).toBe(true);
    expect(cast[0]!.qualifierLabels).toEqual({ os: "a-vo", vo: "a-os", radio: "a-radio" });
    expect(cast[1]).toEqual({ name: "B" });
    expect(renameQualifierLabels([{ name: "C", qualifierLabels: { radio: "x" } }], renames)).toBe(false);
    expect(renameQualifierLabels(undefined, renames)).toBe(false);
  });

  it("moves translated labels and their edit records, leaving the pattern and other strings alone", () => {
    const loc = { schema: "patter/strings@0", scene: "@project", locale: "fr",
      strings: { "speaker:A:vo": "1", "speaker:A:os": "2", "speaker:pattern": "{name}", "cast:A": "A", "speaker:A:radio": "3" } };
    expect(renameQualifierStrings(loc, renames)).toBe(true);
    expect(loc.strings).toEqual({ "speaker:A:os": "1", "speaker:A:vo": "2", "speaker:pattern": "{name}", "cast:A": "A", "speaker:A:radio": "3" });
    expect(renameQualifierStrings({ schema: "patter/strings@0", scene: "@project", locale: "fr", strings: { "speaker:pattern": "x" } }, renames)).toBe(false);

    const af: AuthoringFile = { schema: "patter/authoring@0", edits: { "speaker:A:vo": { modifiedAt: "1" }, "speaker:pattern": { modifiedAt: "2" } } };
    expect(renameQualifiersInAuthoring(af, renames)).toBe(true);
    expect(af.edits).toEqual({ "speaker:A:os": { modifiedAt: "1" }, "speaker:pattern": { modifiedAt: "2" } });
  });
});
