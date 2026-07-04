// ---------------------------------------------------------------------------
// Closed captions (#214): with captions off, a DIALOGUE line's caption cues (between the project's
// delimiters, default `(` / `)`) and the surrounding whitespace are stripped. Narration (text beats) and
// other content are untouched. The toggle is a live presentation setting (EngineOptions + setClosedCaptions),
// not save state. Mirrors the cross-runtime contract the conformance corpus holds the native ports to.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import type { ProjectFile, Scene, LocaleFile } from "@patterkit/model";

const project = (extra: Partial<ProjectFile> = {}): ProjectFile => ({
  schema: "patter/project@0", project: { id: "cc", name: "CC" },
  locales: { default: "en", all: ["en"] }, ...extra,
});
const loc = (strings: Record<string, string>): LocaleFile => ({ schema: "patter/strings@0", scene: "s", locale: "en", strings });

// A line (dialogue) with a cue, a narration text beat with a cue, then a choice whose line-kind option
// prompt also has a cue.
const scene: Scene = {
  id: "s", type: "scene", name: "S",
  blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "n", type: "snippet", beats: [
      { id: "L1", kind: "line", character: "ANNA" },
      { id: "T1", kind: "text" },
    ] },
    { id: "g", type: "group", selector: "choice", children: [
      { id: "opt", type: "group", prompt: { id: "P1", kind: "line", character: "ANNA" }, children: [
        { id: "o", type: "snippet", beats: [{ id: "L2", kind: "line", character: "ANNA" }], jump: { to: "END" } },
      ] },
    ] },
  ] }],
};
const strings = loc({
  L1: "Oh dear. [sigh] What now?",
  T1: "A door slams. [off-screen]",
  P1: "Hello? [timid]",
  L2: "Bye.",
});

const build = (cc?: Partial<NonNullable<ProjectFile["closedCaptions"]>>) =>
  exportBundle({ project: project(cc ? { closedCaptions: { open: cc.open ?? "[", close: cc.close ?? "]" } } : {}), scenes: [scene], locales: [strings] });

describe("closed captions", () => {
  it("shows full text by default (captions on)", () => {
    const flow = new Engine(build()).openFlow("main", { scene: "s" });
    expect(flow.advance()).toMatchObject({ type: "line", text: "Oh dear. [sigh] What now?" });
  });

  it("strips dialogue-line cues when captions are off, leaving narration untouched", () => {
    const flow = new Engine(build(), { closedCaptions: false }).openFlow("main", { scene: "s" });
    expect(flow.advance()).toMatchObject({ type: "line", text: "Oh dear. What now?" }); // line: stripped
    expect(flow.advance()).toMatchObject({ type: "text", text: "A door slams. [off-screen]" }); // narration: kept
  });

  it("strips a line-kind choice prompt when captions are off", () => {
    const flow = new Engine(build(), { closedCaptions: false }).openFlow("main", { scene: "s" });
    flow.advance(); flow.advance(); // line, text
    const step = flow.advance();
    expect(step.type).toBe("choice");
    if (step.type !== "choice") throw new Error("not a choice");
    expect(step.options[0]!.prompt?.text).toBe("Hello?");
  });

  it("toggles live with setClosedCaptions (no rebuild)", () => {
    const engine = new Engine(build());
    expect(engine.closedCaptions).toBe(true);
    const flow = engine.openFlow("main", { scene: "s" });
    expect(flow.advance()).toMatchObject({ text: "Oh dear. [sigh] What now?" });
    engine.setClosedCaptions(false);
    const flow2 = engine.openFlow("main2", { scene: "s" });
    expect(flow2.advance()).toMatchObject({ text: "Oh dear. What now?" });
    expect(engine.closedCaptions).toBe(false);
  });

  it("honours a custom delimiter pair from the bundle", () => {
    const ccLoc = loc({ L1: "Heavy *sigh* breathing", T1: "x", P1: "y", L2: "z" });
    const bundle = exportBundle({ project: project({ closedCaptions: { open: "*", close: "*" } }), scenes: [scene], locales: [ccLoc] });
    expect(bundle.closedCaptions).toEqual({ open: "*", close: "*" });
    const flow = new Engine(bundle, { closedCaptions: false }).openFlow("main", { scene: "s" });
    expect(flow.advance()).toMatchObject({ text: "Heavy breathing" });
  });

  it("exposes flow.stripCaptions for IDs-only parity (unconditional)", () => {
    const flow = new Engine(build()).openFlow("main", { scene: "s" });
    expect(flow.stripCaptions("Oh dear. [sigh] What now?")).toBe("Oh dear. What now?");
  });

  it("omits closedCaptions from a default bundle (stable for existing projects)", () => {
    expect(build().closedCaptions).toBeUndefined();
  });
});

describe("caption character (default SFX)", () => {
  const sfxScene: Scene = {
    id: "s", type: "scene", name: "S",
    blocks: [{ id: "b", type: "block", name: "B", children: [
      { id: "n", type: "snippet", beats: [
        { id: "S1", kind: "line", character: "SFX" },           // pure caption line
        { id: "L1", kind: "line", character: "ANNA" },          // normal dialogue
      ], jump: { to: "END" } },
    ] }],
  };
  const sfxLoc = (): LocaleFile => ({ schema: "patter/strings@0", scene: "s", locale: "en",
    strings: { S1: "Thunder rumbles in the distance.", L1: "Did you hear that?" } });
  const sfxBundle = () => exportBundle({
    project: { schema: "patter/project@0", project: { id: "cc", name: "CC" }, locales: { default: "en", all: ["en"] }, cast: [{ name: "ANNA" }, { name: "SFX" }] },
    scenes: [sfxScene], locales: [sfxLoc()],
  });

  it("renders an SFX line in FULL when captions are on (with speaker)", () => {
    const flow = new Engine(sfxBundle()).openFlow("main", { scene: "s" });
    expect(flow.advance()).toMatchObject({ type: "line", id: "S1", text: "Thunder rumbles in the distance.", character: "SFX" });
  });

  it("makes an SFX line SILENT when captions are off: event fires, no text, no speaker", () => {
    const flow = new Engine(sfxBundle(), { closedCaptions: false }).openFlow("main", { scene: "s" });
    const step = flow.advance();
    expect(step).toMatchObject({ type: "line", id: "S1", text: "" });   // fires (audio + visits) but no caption
    expect(step.type === "line" && step.character).toBeUndefined();      // no speaker label
    expect(flow.advance()).toMatchObject({ type: "line", id: "L1", text: "Did you hear that?", character: "ANNA" }); // a normal line is unaffected
  });
});
