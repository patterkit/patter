// Action text (patterkit design/proposals/action-text.md): a dialogue scene's text, in a project that doesn't
// localise it, is left out of the loc files, dropped from them at the next import, reported when a scene changes
// kind, and counted beside the written lines. The voice script never had it.

import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { loadProject, extractLoc, applyLoc, applyWrites, actionTextChanges, describeLocExport, runReport, runValidate, runVoiceScript } from "../src/index.js";

function makeProject(over: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "patter-action-"));
  for (const d of ["scenes", "loc/en", "loc/fr", "authoring"]) mkdirSync(join(dir, d), { recursive: true });
  const w = (p: string, o: unknown) => writeFileSync(join(dir, p), JSON.stringify(o));
  w("game.patterproj", {
    schema: "patter/project@0", project: { id: "act", name: "Action" },
    locales: { default: "en", all: ["en", "fr"] }, voiced: true, cast: [{ name: "MARA" }], ...over,
  });
  // s1: a dialogue scene (MARA speaks), with two text beats and a text prompt. s2: a text scene.
  w("scenes/one.patterflow", { schema: "patter/flow@0", scene: { id: "s1", type: "scene", name: "Kitchen", blocks: [
    { id: "b1", type: "block", name: "Main", children: [
      { id: "n1", type: "snippet", beats: [
        { id: "T1", kind: "text" }, { id: "L1", kind: "line", character: "MARA" }, { id: "T2", kind: "text" },
      ] },
      { id: "g1", type: "group", selector: "choice", children: [
        { id: "o1", type: "group", prompt: { id: "CT1", kind: "text" }, children: [{ id: "o1c", type: "snippet", jump: { to: "END" } }] },
      ] },
    ] },
  ] } });
  w("scenes/two.patterflow", { schema: "patter/flow@0", scene: { id: "s2", type: "scene", name: "Letter", blocks: [
    { id: "b2", type: "block", name: "Main", children: [{ id: "n2", type: "snippet", beats: [{ id: "T3", kind: "text" }] }] },
  ] } });
  w("loc/en/one.patterloc", { schema: "patter/strings@0", scene: "s1", locale: "en", default: true,
    strings: { T1: "MARA turns away from the window.", L1: "Leave it.", T2: "She goes.", CT1: "Follow her" } });
  w("loc/en/two.patterloc", { schema: "patter/strings@0", scene: "s2", locale: "en", default: true, strings: { T3: "Dear Tom," } });
  // fr: an older translation of T1, from before the scene's text was action.
  w("loc/fr/one.patterloc", { schema: "patter/strings@0", scene: "s1", locale: "fr", strings: { T1: "MARA se détourne.", L1: "Laisse.", CT1: "La suivre" } });
  w("loc/fr/two.patterloc", { schema: "patter/strings@0", scene: "s2", locale: "fr", strings: { T3: "Cher Tom," } });
  return dir;
}
const setProject = (dir: string, over: Record<string, unknown>): void => {
  const path = join(dir, "game.patterproj");
  writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, "utf8")), ...over }));
};
const ids = (dir: string, locale?: string): string[] => extractLoc(loadProject(dir), { locale }).entries.map((e) => e.id);
const locWarnings = (dir: string): string[] => runValidate(loadProject(dir)).localisation.map((i) => `${i.severity}: ${i.message}`);
const importFile = (dir: string, translate: Record<string, string> = {}) => {
  const loaded = loadProject(dir);
  const cat = extractLoc(loaded, { locale: "fr" });
  for (const e of cat.entries) if (translate[e.id]) e.translation = translate[e.id]!;
  const result = applyLoc(loaded, cat, { now: "2026-10-19T00:00:00Z" });
  applyWrites(result.writes);
  return result;
};
const frShard = (dir: string) => loadProject(dir).locales.find((l) => l.scene === "s1" && l.locale === "fr")!;

describe("loc export", () => {
  it("leaves a dialogue scene's text out, and keeps its prompt, its lines, and a text scene's text", () => {
    const dir = makeProject();
    expect(ids(dir)).toEqual(["L1", "CT1", "T3"]);
    expect(ids(dir, "fr")).toEqual(["L1", "CT1", "T3"]);
  });

  it("with localiseDialogueText on, exports a dialogue scene's text as a text scene's", () => {
    expect(ids(makeProject({ localiseDialogueText: true }))).toEqual(["T1", "L1", "T2", "CT1", "T3"]);
  });

  it("reports a translation that drops out, and validate warns of it, naming the scene", () => {
    const dir = makeProject();
    expect(actionTextChanges(loadProject(dir))).toEqual([{ id: "T1", scene: "s1", locale: "fr", change: "dropped" }]);
    expect(actionTextChanges(loadProject(dir), { locale: "en" })).toEqual([]);
    expect(locWarnings(dir)).toEqual([
      "warning: the text in 'Kitchen' is now action (a dialogue scene's text, which the project doesn't localise), but the 'fr' strings still translate 1 text line: the next loc import drops it",
    ]);
  });
});

describe("what the export says beside the file", () => {
  const SETTING = `"Localise text lines in dialogue scenes" (Project Settings, Language; \`localiseDialogueText\` in the project file)`;

  it("says how many text lines it left out, and the setting that does it, on every export", () => {
    const dir = makeProject();
    importFile(dir); // nothing left to report as changed
    for (const locale of [undefined, "fr"]) {
      expect(describeLocExport(loadProject(dir), { locale })).toEqual([
        `Left out 2 text lines in 1 dialogue scene: they're action, a direction for whoever stages the scene, because ${SETTING} is off. Turn it on to translate them.`,
      ]);
    }
  });

  it("then lists what has dropped out since loc import last wrote the files", () => {
    expect(describeLocExport(loadProject(makeProject()), { locale: "fr" }).slice(1)).toEqual([
      `1 text line now action, so left out of 'fr': the next loc import drops its translation (turn on ${SETTING} to keep it)`,
      "  T1 in 'Kitchen'",
    ]);
  });

  it("says nothing when the export leaves nothing out", () => {
    expect(describeLocExport(loadProject(makeProject({ localiseDialogueText: true })))).toEqual([]);
  });
});

describe("loc import", () => {
  it("drops action text's translations, marks the shard, and leaves nothing to report", () => {
    const dir = makeProject();
    const { stats } = importFile(dir);
    expect(stats.dropped).toBe(1);
    expect(frShard(dir)).toMatchObject({ textAction: true, strings: { L1: "Laisse.", CT1: "La suivre" } });
    expect("T1" in frShard(dir).strings).toBe(false);
    expect(actionTextChanges(loadProject(dir))).toEqual([]);
    expect(locWarnings(dir)).toEqual([]);
  });

  it("never imports a translation of action text an older file still holds", () => {
    const dir = makeProject();
    const loaded = loadProject(dir);
    const cat = extractLoc(loaded, { locale: "fr" });
    cat.entries.push({ id: "T2", scene: "s1", source: "She goes.", translation: "Elle part.", comments: [], stale: false });
    applyWrites(applyLoc(loaded, cat).writes);
    expect("T2" in frShard(dir).strings).toBe(false);
  });

  it("when a scene's text stops being action, reports it as added until it's imported again", () => {
    const dir = makeProject();
    importFile(dir);
    setProject(dir, { localiseDialogueText: true });
    expect(actionTextChanges(loadProject(dir))).toEqual([
      { id: "T1", scene: "s1", locale: "fr", change: "added" },
      { id: "T2", scene: "s1", locale: "fr", change: "added" },
    ]);
    expect(locWarnings(dir)).toEqual([
      "warning: the text in 'Kitchen' is no longer action, so 2 text lines aren't in the 'fr' strings yet: the next loc export sends them for translation",
    ]);
    expect(ids(dir, "fr")).toEqual(["T1", "L1", "T2", "CT1", "T3"]);
    importFile(dir, { T1: "MARA se détourne de la fenêtre." });
    expect(frShard(dir).textAction).toBeUndefined();
    expect(frShard(dir).strings.T1).toBe("MARA se détourne de la fenêtre.");
    expect(actionTextChanges(loadProject(dir))).toEqual([]);
  });

  it("drops nothing the second time, and leaves the shard as it was", () => {
    const dir = makeProject();
    importFile(dir);
    const before = frShard(dir);
    expect(importFile(dir).stats).toMatchObject({ updated: 0, dropped: 0 });
    expect(frShard(dir)).toEqual(before);
  });
});

describe("report", () => {
  it("counts action beside the written lines, never in them or in the localisation", () => {
    const data = runReport(loadProject(makeProject()));
    const kitchen = data.scenes.find((s) => s.sceneId === "s1")!;
    expect(kitchen.action.count).toBe(2);
    expect(kitchen.action.words).toBe(8);
    expect(kitchen.written.count).toBe(2); // L1 and CT1
    expect(data.totals.action.count).toBe(2);
    expect(data.totals.written.count).toBe(3); // and T3
    expect(data.locales[0]).toMatchObject({ locale: "fr", translated: 3, missing: 0 });
  });

  it("with localiseDialogueText on, counts a dialogue scene's text as written", () => {
    const data = runReport(loadProject(makeProject({ localiseDialogueText: true })));
    expect(data.totals.action.count).toBe(0);
    expect(data.totals.written.count).toBe(5);
  });
});

describe("voice script", () => {
  it("takes line beats only: action text is not narration", () => {
    const script = runVoiceScript(loadProject(makeProject()), { everything: true });
    expect(script.lines.map((l) => l.id)).toEqual(["L1"]);
  });
});
