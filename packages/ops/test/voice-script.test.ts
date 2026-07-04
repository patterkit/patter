// ---------------------------------------------------------------------------
// The voice-script op (spec §16): voiced lines only, filtered to "ready to record"
// unless `everything`; each row carries its scope trail + the line's vo notes, with
// the enclosing option's vo note prepended on the first line of a run; actor from cast.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { loadProject, runVoiceScript } from "../src/index.js";

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "patter-vo-"));
  for (const d of ["scenes", "loc/en", "authoring"]) mkdirSync(join(dir, d), { recursive: true });
  const w = (p: string, o: unknown) => writeFileSync(join(dir, p), JSON.stringify(o));

  w("game.patterproj", {
    schema: "patter/project@0", project: { id: "vo", name: "VO Game" },
    locales: { default: "en", all: ["en"] }, voiced: true,
    cast: [{ name: "ANNA", displayName: "Anna", actor: "Jane Doe" }, { name: "BO" }],
  });

  w("scenes/one.patterflow", { schema: "patter/flow@0", scene: {
    id: "s1", type: "scene", name: "Opening", blocks: [
      { id: "b1", type: "block", name: "Main", children: [
        { id: "n1", type: "snippet", beats: [
          { id: "L1", kind: "line", character: "ANNA" }, // final -> ready
          { id: "L2", kind: "line", character: "BO" },   // draft 1 -> NOT ready
        ] },
        { id: "g1", type: "group", selector: "choice", children: [
          { id: "o1", type: "group", prompt: { id: "CT1", kind: "text" }, children: [
            { id: "o1c", type: "snippet", beats: [{ id: "L3", kind: "line", character: "ANNA" }], jump: { to: "END" } },
          ] },
        ] },
      ] },
    ] } });

  w("loc/en/strings.patterloc", { schema: "patter/strings@0", scene: "s1", locale: "en", default: true,
    strings: { L1: "Hello there.", L2: "Yo.", L3: "Sure.", CT1: "Order a drink" } });

  w("authoring/one.patterx", { schema: "patter/authoring@0",
    writing: { L1: "final", L2: "draft 1", L3: "edited" }, // edited+ = ready to record (default ladder)
    recording: { L1: "recorded" },
    documentation: {
      L1: [{ type: "vo", text: "Weary, resigned." }, { type: "writing", text: "internal only" }],
      o1: [{ type: "vo", text: "The drink option." }],
    } });
  return dir;
}

const loaded = loadProject(makeProject());

describe("runVoiceScript", () => {
  it("includes only ready-to-record voiced lines by default", () => {
    const ids = runVoiceScript(loaded).lines.map((l) => l.id);
    expect(ids).toEqual(["L1", "L3"]); // L2 (draft 1) excluded; L3 (edited) ready
  });

  it("--all includes every voiced line regardless of writing status", () => {
    const ids = runVoiceScript(loaded, { everything: true }).lines.map((l) => l.id);
    expect(ids).toEqual(["L1", "L2", "L3"]);
  });

  it("carries scope, actor, recording status, and vo-only comments", () => {
    const byId = Object.fromEntries(runVoiceScript(loaded).lines.map((l) => [l.id, l]));
    expect(byId["L1"]).toMatchObject({ scope: "Opening › Main", character: "ANNA", actor: "Jane Doe", text: "Hello there.", recordingStatus: "recorded" });
    expect(byId["L1"]!.comments).toEqual(["Weary, resigned."]); // the `writing`-class note is excluded
    // L3 is inside the choice's option: scope reaches the option, and its run-leading comment is the option's vo note.
    expect(byId["L3"]!.scope.endsWith("Order a drink")).toBe(true);
    expect(byId["L3"]!.comments).toEqual(["The drink option."]);
    expect(byId["L3"]!.recordingStatus).toBe("missing"); // no recording set -> ladder[0]
  });

  it("recordingOverride replaces the manual map (Audio Folders projects derive from files on disk, #206)", () => {
    const derived = new Map([["L1", "scratch"], ["L3", "final"]]);
    const byId = Object.fromEntries(runVoiceScript(loaded, { recordingOverride: derived }).lines.map((l) => [l.id, l]));
    expect(byId["L1"]!.recordingStatus).toBe("scratch"); // the manual map said "recorded" - the files win
    expect(byId["L3"]!.recordingStatus).toBe("final");
    // A beat absent from the derived map has no take on disk: the lowest rung, exactly as before.
    const partial = Object.fromEntries(runVoiceScript(loaded, { recordingOverride: new Map() }).lines.map((l) => [l.id, l]));
    expect(partial["L1"]!.recordingStatus).toBe("missing");
  });
});

describe("runVoiceScript: plain text for the booth", () => {
  // Strings carrying inline formatting tags + a legacy entity, on a voiced line and an option prompt.
  // The voice script hands the actor PLAIN text - no <b>/<i> tags, no &amp;.
  function makeFormatted(): string {
    const dir = mkdtempSync(join(tmpdir(), "patter-vo-fmt-"));
    for (const d of ["scenes", "loc/en", "authoring"]) mkdirSync(join(dir, d), { recursive: true });
    const w = (p: string, o: unknown) => writeFileSync(join(dir, p), JSON.stringify(o));
    w("game.patterproj", { schema: "patter/project@0", project: { id: "vo", name: "VO" },
      locales: { default: "en", all: ["en"] }, voiced: true, formatting: true, cast: [{ name: "ANNA" }] });
    w("scenes/one.patterflow", { schema: "patter/flow@0", scene: {
      id: "s1", type: "scene", name: "S", blocks: [{ id: "b1", type: "block", name: "M", children: [
        { id: "g1", type: "group", selector: "choice", children: [
          { id: "o1", type: "group", prompt: { id: "CT1", kind: "text" }, children: [
            { id: "n1", type: "snippet", beats: [{ id: "L1", kind: "line", character: "ANNA" }], jump: { to: "END" } },
          ] },
        ] },
      ] }] } });
    w("loc/en/strings.patterloc", { schema: "patter/strings@0", scene: "s1", locale: "en", default: true,
      strings: { L1: "Take <b>five</b> gold &amp; glory.", CT1: "Fight <i>&amp;</i> flee" } });
    w("authoring/one.patterx", { schema: "patter/authoring@0", writing: { L1: "final" } });
    return dir;
  }

  it("strips <b>/<i>/<bi> tags and decodes legacy entities in line text and the option scope", () => {
    const vs = runVoiceScript(loadProject(makeFormatted()), { everything: true });
    const line = vs.lines.find((l) => l.id === "L1")!;
    expect(line.text).toBe("Take five gold & glory.");      // tags gone, &amp; -> &
    expect(line.scope.endsWith("Fight & flee")).toBe(true);  // option prompt likewise plain
  });
});
