// Speaker qualifiers on the main side (design/proposals/speaker-qualifiers.md): the project file stores the
// list only when it differs from the defaults; changing a qualifier's Game ID rewrites every line using it
// (and its translated names), through the same lock-aware write path as any save; the search window finds
// lines by qualifier; and a line whose qualifier was removed from the list gets the pick-a-qualifier fix.

import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, cpSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSource, canonicalStringify } from "@patterkit/core";
import { DEFAULT_QUALIFIERS, HANDOFF_SCHEMA, walkNodes } from "@patterkit/model";
import type { AuthoringFile, FlowFile, Group, HandoffFile, Snippet, Scene } from "@patterkit/model";
import * as project from "../src/main/project.js";
import { renameQualifiersInScene, renameQualifierStrings, renameQualifiersInAuthoring, renameQualifiersInHandoff, cleanRenames } from "../src/main/qualifiers.js";

const TAVERN = resolve(dirname(fileURLToPath(import.meta.url)), "../../../test-fixtures/tavern-example.patter");

/** A private copy of the tavern with BARKEEP's greeting qualified O.S. */
function tavernWithQualifier(): { dir: string; flowPath: string } {
  const dir = join(mkdtempSync(join(tmpdir(), "pp-qual-")), "tavern.patter");
  cpSync(TAVERN, dir, { recursive: true });
  const flowPath = join(dir, "scenes", "tavern.patterflow");
  const flow = parseSource(readFileSync(flowPath, "utf8")) as FlowFile;
  walkNodes<Group | Snippet>(flow.scene.blocks[0]!.children, (n) => {
    if (n.type === "snippet") for (const b of n.beats ?? []) if (b.id === "L_greet" && b.kind === "line") b.qualifier = "os";
  });
  writeFileSync(flowPath, canonicalStringify(flow));
  return { dir, flowPath };
}
const qualifierOnDisk = (flowPath: string, id: string): string | undefined => {
  const flow = parseSource(readFileSync(flowPath, "utf8")) as FlowFile;
  let q: string | undefined;
  for (const block of flow.scene.blocks) walkNodes<Group | Snippet>(block.children, (n) => {
    if (n.type === "snippet") for (const b of n.beats ?? []) if (b.id === id && b.kind === "line") q = b.qualifier;
  });
  return q;
};

describe("speaker qualifiers in the project session", () => {
  it("reads the defaults, finds lines by qualifier, and counts them for the chips", () => {
    const { dir } = tavernWithQualifier();
    const opened = project.openProject(dir);
    expect(opened.qualifiers).toEqual(DEFAULT_QUALIFIERS);
    expect(project.readSettings()!.qualifiers).toEqual(DEFAULT_QUALIFIERS);
    expect(project.linesByQualifier("os").map((e) => e.id)).toEqual(["L_greet"]);
    expect(project.linesByQualifier("vo")).toEqual([]);
    expect(project.qualifierList()).toEqual([
      { gameId: "vo", name: "V.O.", count: 0 }, { gameId: "os", name: "O.S.", count: 1 }, { gameId: "radio", name: "RADIO", count: 0 },
    ]);
  });

  it("stores the list only when it differs from the defaults, and an empty list as empty", async () => {
    const { dir } = tavernWithQualifier();
    project.openProject(dir);
    const projFile = join(dir, "tavern.patterproj");
    expect((await project.saveSettings({ ...project.readSettings()! })).ok).toBe(true);
    expect((parseSource(readFileSync(projFile, "utf8")) as { qualifiers?: unknown }).qualifiers).toBeUndefined();
    const game = [...DEFAULT_QUALIFIERS, { gameId: "phone", name: "PHONE" }];
    expect((await project.saveSettings({ ...project.readSettings()!, qualifiers: game })).ok).toBe(true);
    expect((parseSource(readFileSync(projFile, "utf8")) as { qualifiers?: unknown }).qualifiers).toEqual(game);
    expect((await project.saveSettings({ ...project.readSettings()!, qualifiers: [] })).ok).toBe(true);
    expect((parseSource(readFileSync(projFile, "utf8")) as { qualifiers?: unknown }).qualifiers).toEqual([]);
  });

  it("a Game ID change rewrites every line that uses it, and validation stays clean", async () => {
    const { dir, flowPath } = tavernWithQualifier();
    project.openProject(dir);
    const s = project.readSettings()!;
    const renamed = s.qualifiers.map((q) => (q.gameId === "os" ? { ...q, gameId: "offscreen" } : q));
    const res = await project.saveSettings({ ...s, qualifiers: renamed, qualifierRenames: { os: "offscreen" } });
    expect(res.ok).toBe(true);
    expect(res.project?.qualifiers.map((q) => q.gameId)).toEqual(["vo", "offscreen", "radio"]);
    expect(qualifierOnDisk(flowPath, "L_greet")).toBe("offscreen");
    expect(project.linesByQualifier("offscreen").map((e) => e.id)).toEqual(["L_greet"]);
    expect(project.validate().problems.filter((p) => p.detail === "unknown-qualifier")).toEqual([]);
  });

  it("a Game ID change also moves suggestions, edit records, and handoff records to the new gameId", async () => {
    const { dir } = tavernWithQualifier();
    // An open suggestion from an editable-script reimport, the translation-staleness record of the
    // qualifier's name, and the handoff record the script was sent with: all hold the old gameId.
    const authoringPath = join(dir, "authoring", "tavern.patterx");
    const af = parseSource(readFileSync(authoringPath, "utf8")) as AuthoringFile;
    af.suggestions = [{ id: "sg1", anchor: "L_greet", baseline: "x", proposed: "x", author: "Sam", ts: "2026-10-01T00:00:00Z", proposedQualifier: "vo", baselineQualifier: "os" }];
    af.edits = { ...af.edits, "qualifier:os": { modifiedAt: "2026-10-01T00:00:00Z" } };
    writeFileSync(authoringPath, canonicalStringify(af));
    mkdirSync(join(dir, "handoffs"));
    const handoff: HandoffFile = {
      schema: HANDOFF_SCHEMA, id: "H-TEST", createdAt: "2026-10-01T00:00:00Z", createdBy: "Ian", format: "docx",
      range: { scenes: ["tavern"] }, options: { notes: "all", status: false, cast: false },
      lines: { K7Q2M: { id: "L_greet", kind: "line", character: "BARKEEP", qualifier: "os", qualifierName: "O.S.", baseline: "x" } },
      skeleton: [{ kind: "box", marker: "K7Q2M" }],
    };
    const handoffPath = join(dir, "handoffs", "H-TEST.json");
    writeFileSync(handoffPath, JSON.stringify(handoff, null, 2) + "\n");

    project.openProject(dir);
    const s = project.readSettings()!;
    // A swap of two gameIds, to show it lands as a swap everywhere.
    const swapped = s.qualifiers.map((q) => (q.gameId === "os" ? { ...q, gameId: "vo" } : q.gameId === "vo" ? { ...q, gameId: "os" } : q));
    expect((await project.saveSettings({ ...s, qualifiers: swapped, qualifierRenames: { os: "vo", vo: "os" } })).ok).toBe(true);

    const after = parseSource(readFileSync(authoringPath, "utf8")) as AuthoringFile;
    expect(after.suggestions![0]).toMatchObject({ proposedQualifier: "os", baselineQualifier: "vo" });
    expect(after.edits!["qualifier:vo"]).toEqual({ modifiedAt: "2026-10-01T00:00:00Z" });
    expect(after.edits!["qualifier:os"]).toBeUndefined();
    const sentAfter = JSON.parse(readFileSync(handoffPath, "utf8")) as HandoffFile;
    expect(sentAfter.lines.K7Q2M).toMatchObject({ qualifier: "vo", qualifierName: "O.S." });
  });

  it("a qualifier removed from the list is flagged on the line, with the pick-a-qualifier fix", async () => {
    const { dir } = tavernWithQualifier();
    project.openProject(dir);
    const s = project.readSettings()!;
    expect((await project.saveSettings({ ...s, qualifiers: s.qualifiers.filter((q) => q.gameId !== "os") })).ok).toBe(true);
    const flagged = project.validate().problems.filter((p) => p.detail === "unknown-qualifier");
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toMatchObject({ nodeId: "L_greet", fix: { kind: "pick-qualifier", lineId: "L_greet", bad: "os" } });
  });
});

describe("the rename helpers", () => {
  const scene = (): Scene => ({
    id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
      { id: "sn", type: "snippet", beats: [
        { id: "L1", kind: "line", character: "A", qualifier: "vo" },
        { id: "L2", kind: "line", character: "A", qualifier: "os" },
        { id: "L3", kind: "line", character: "A" },
      ] },
      { id: "g", type: "group", selector: "choice", children: [
        { id: "o", type: "group", prompt: { id: "P", kind: "line", character: "A", qualifier: "vo" }, children: [] },
      ] },
    ] }],
  });
  const quals = (sc: Scene): Array<string | undefined> => {
    const out: Array<string | undefined> = [];
    walkNodes<Group | Snippet>(sc.blocks[0]!.children, (n) => {
      if (n.type === "group") { if (n.prompt?.kind === "line") out.push(n.prompt.qualifier); return; }
      for (const b of n.beats ?? []) if (b.kind === "line") out.push(b.qualifier);
    });
    return out;
  };

  it("renames lines and prompts at once, so a swap lands as a swap", () => {
    const sc = scene();
    expect(renameQualifiersInScene(sc, cleanRenames({ vo: "os", os: "vo" })!)).toBe(3);
    expect(quals(sc)).toEqual(["os", "vo", undefined, "os"]);
    expect(cleanRenames({ vo: "vo", os: "" })).toBeNull();
  });

  it("renames suggestions, edit records, and handoff lines, a swap as a swap, and says when nothing moved", () => {
    const renames = cleanRenames({ vo: "os", os: "vo" })!;
    const af: AuthoringFile = {
      schema: "patter/authoring@0",
      suggestions: [
        { id: "a", anchor: "L1", baseline: "", proposed: "", author: "x", ts: "", proposedQualifier: "vo", baselineQualifier: "" },
        { id: "b", anchor: "L2", baseline: "", proposed: "", author: "x", ts: "", proposedQualifier: "", baselineQualifier: "os" },
      ],
      edits: { "qualifier:vo": { modifiedAt: "1" }, "qualifier:os": { modifiedAt: "2" }, L1: { modifiedAt: "3" } },
    };
    expect(renameQualifiersInAuthoring(af, renames)).toBe(true);
    expect(af.suggestions!.map((x) => [x.proposedQualifier, x.baselineQualifier])).toEqual([["os", ""], ["", "vo"]]);
    expect(af.edits).toEqual({ "qualifier:os": { modifiedAt: "1" }, "qualifier:vo": { modifiedAt: "2" }, L1: { modifiedAt: "3" } });
    expect(renameQualifiersInAuthoring({ schema: "patter/authoring@0", edits: { L1: {} } }, renames)).toBe(false);
    const h = { lines: { A: { id: "L1", kind: "line", qualifier: "vo", baseline: "" }, B: { id: "L2", kind: "line", qualifier: "os", baseline: "" }, C: { id: "L3", kind: "narration", baseline: "" } } } as unknown as HandoffFile;
    expect(renameQualifiersInHandoff(h, renames)).toBe(true);
    expect(Object.values(h.lines).map((l) => l.qualifier)).toEqual(["os", "vo", undefined]);
  });

  it("moves a translated qualifier name to its new key, in project-level strings only", () => {
    const loc = { schema: "patter/strings@0", scene: "@project", locale: "fr", strings: { "qualifier:os": "H.C.", "cast:A": "A" } };
    expect(renameQualifierStrings(loc, new Map([["os", "offscreen"]]))).toBe(true);
    expect(loc.strings).toEqual({ "qualifier:offscreen": "H.C.", "cast:A": "A" });
    const sceneLoc = { schema: "patter/strings@0", scene: "s", locale: "fr", strings: { "qualifier:os": "x" } };
    expect(renameQualifierStrings(sceneLoc, new Map([["os", "offscreen"]]))).toBe(false);
  });
});
