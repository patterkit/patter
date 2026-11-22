// ---------------------------------------------------------------------------
// Engine.runText(scene, block?, { flow?, separator? }) - "give me just the text at this address", for a
// letter, a book page, or a sign. It plays the address and returns its text beats joined into one string;
// a line of dialogue or a choice there is an authoring mistake, so it throws. With no flow named it plays
// on a throwaway flow that is never registered or saved.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import type { ProjectFile, Scene, LocaleFile } from "@patterkit/model";

const project = (): ProjectFile => ({
  schema: "patter/project@0",
  project: { id: "p", name: "RunText" },
  locales: { default: "en", all: ["en"] },
  voiced: false,
  properties: [
    { name: "reads", type: "number", shared: true, default: 0 },
    { name: "name", type: "string", shared: true, default: "Ada" },
  ],
});

// Addresses derive from the names: scene "Letters" -> letters; blocks "Mother" -> mother, and so on.
const letters: Scene = {
  id: "scn_l", type: "scene", name: "Letters",
  blocks: [
    { id: "b_mother", type: "block", name: "Mother", children: [
      { id: "sn_m1", type: "snippet", onEnter: [{ kind: "set", target: "@reads", value: "@reads + 1" }],
        beats: [{ id: "M1", kind: "text" }, { id: "M_ev", kind: "gameEvent", gameData: { cue: "flower" } }, { id: "M2", kind: "text" }] },
      { id: "sn_m3", type: "snippet", beats: [{ id: "M3", kind: "text" }] },
    ] },
    { id: "b_notes", type: "block", name: "Notes", children: [
      { id: "g_notes", type: "group", selector: "sequence", options: { order: "sequential", exhaust: "once" }, children: [
        { id: "sn_n1", type: "snippet", beats: [{ id: "N1", kind: "text" }] },
        { id: "sn_n2", type: "snippet", beats: [{ id: "N2", kind: "text" }] },
      ] },
    ] },
    { id: "b_spoken", type: "block", name: "Spoken", children: [
      { id: "sn_s1", type: "snippet", beats: [{ id: "S1", kind: "text" }, { id: "S2", kind: "line", character: "ADA" }] },
      { id: "sn_s3", type: "snippet", onEnter: [{ kind: "set", target: "@reads", value: "@reads + 100" }], beats: [{ id: "S3", kind: "text" }] },
    ] },
    { id: "b_ask", type: "block", name: "Ask", children: [
      { id: "sn_a1", type: "snippet", beats: [{ id: "A1", kind: "text" }] },
      { id: "g_ask", type: "group", selector: "choice", children: [
        { id: "o_yes", type: "group", prompt: { id: "P_yes", kind: "text" }, children: [
          { id: "sn_yes", type: "snippet", beats: [{ id: "YES", kind: "text" }] },
        ] },
      ] },
    ] },
    { id: "b_empty", type: "block", name: "Empty", children: [
      { id: "g_empty", type: "group", selector: "sequence", options: { order: "sequential", exhaust: "once" }, children: [
        { id: "sn_e1", type: "snippet", beats: [{ id: "E1", kind: "text" }] },
      ] },
    ] },
  ],
};

const strings = (scene: string, s: Record<string, string>): LocaleFile =>
  ({ schema: "patter/strings@0", scene, locale: "en", default: true, strings: s });

const engine = (): Engine => new Engine(exportBundle({
  project: project(),
  scenes: [letters],
  locales: [strings("scn_l", {
    M1: "Dear {@name},", M2: "The garden is well.", M3: "Love, Mother",
    N1: "first note", N2: "second note",
    S1: "A plain line.", S2: "Hello!", S3: "after",
    A1: "Choose:", P_yes: "Yes", YES: "yes",
    E1: "only once",
  })],
}));

describe("runText", () => {
  it("joins the text beats with a newline, interpolated, skipping game events", () => {
    expect(engine().runText("letters", "mother")).toBe("Dear Ada,\nThe garden is well.\nLove, Mother");
  });

  it("takes a separator", () => {
    expect(engine().runText("letters", "mother", { separator: "\n\n" })).toBe("Dear Ada,\n\nThe garden is well.\n\nLove, Mother");
  });

  it("plays a throwaway flow: the same text each time, no flow registered, nothing in the save", () => {
    const e = engine();
    expect(e.runText("letters", "notes")).toBe("first note");
    expect(e.runText("letters", "notes")).toBe("first note"); // a "once each" list starts again
    expect(e.getFlow("(runText)")).toBeUndefined();
    expect(Object.keys(JSON.parse(JSON.stringify(e.saveGame())).flows ?? {})).toEqual([]);
  });

  it("keeps its writes to shared properties", () => {
    const e = engine();
    e.runText("letters", "mother");
    e.runText("letters", "mother");
    expect(e.getProperty("@reads")).toBe(2);
  });

  it("reuses a named flow as runFlow does, so variations move on", () => {
    const e = engine();
    expect(e.runText("letters", "notes", { flow: "desk" })).toBe("first note");
    expect(e.runText("letters", "notes", { flow: "desk" })).toBe("second note");
    expect(e.getFlow("desk")).toBeDefined();
  });

  it("returns an empty string when the address has nothing left to give", () => {
    const e = engine();
    expect(e.runText("letters", "empty", { flow: "f" })).toBe("only once");
    expect(e.runText("letters", "empty", { flow: "f" })).toBe("");
  });

  it("throws on a line of dialogue, and nothing after it runs", () => {
    const e = engine();
    expect(() => e.runText("letters", "spoken")).toThrow(/runText: letters \/ spoken has a line of dialogue \(S2\)/);
    expect(e.getProperty("@reads")).toBe(0); // sn_s3's onEnter never ran
  });

  it("throws on a choice", () => {
    expect(() => engine().runText("letters", "ask")).toThrow(/runText: letters \/ ask reaches a choice \(g_ask\)/);
  });

  it("leaves a named flow where it stopped", () => {
    const e = engine();
    expect(() => e.runText("letters", "ask", { flow: "f" })).toThrow(/reaches a choice/);
    expect(e.getFlow("f")?.getChoices().map((o) => o.id)).toEqual(["o_yes"]);
  });

  it("throws on an address that does not resolve, with or without a flow", () => {
    const e = engine();
    expect(() => e.runText("nowhere")).toThrow(/unknown scene: nowhere/);
    expect(() => e.runText("letters", "nope")).toThrow(/unknown block: nope/);
    e.runText("letters", "notes", { flow: "f" });
    expect(() => e.runText("letters", "nope", { flow: "f" })).toThrow(/runText: address not found: letters \/ nope/);
  });

  it("works inside a checkpoint, and a rollback undoes its writes", () => {
    const e = engine();
    const cp = e.checkpoint();
    expect(e.runText("letters", "mother")).toBe("Dear Ada,\nThe garden is well.\nLove, Mother");
    expect(e.getProperty("@reads")).toBe(1);
    e.rollback(cp);
    expect(e.getProperty("@reads")).toBe(0);
    expect(e.runText("letters", "mother")).toBe("Dear Ada,\nThe garden is well.\nLove, Mother");
  });
});
