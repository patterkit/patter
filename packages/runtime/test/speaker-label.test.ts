// Speaker labels: the corpus pins what a step carries on all four runtimes. Here: a save written before prompts
// carried a label works it out again on load, both for a pending choice and for a prompt still to be spoken
// back, in the locale active at the load; and the beat info gives the source-locale label.
import { describe, it, expect } from "vitest";
import { Engine, type SaveGame } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import { castStringKey, type ProjectFile, type Scene, type LocaleFile } from "@patterkit/model";

const project: ProjectFile = {
  schema: "patter/project@0", project: { id: "p", name: "P" },
  locales: { default: "en", all: ["en", "fr"] },
  cast: [{ name: "PLAYER", displayName: "You", qualifierLabels: { vo: "Your thoughts" } }],
};
const scene: Scene = {
  id: "s", type: "scene", name: "S",
  blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "g", type: "group", selector: "choice", children: [
      { id: "o", type: "group", prompt: { id: "P", kind: "line", character: "PLAYER", qualifier: "os" }, children: [
        { id: "sn", type: "snippet", beats: [{ id: "L", kind: "line", character: "PLAYER", qualifier: "vo" }], jump: { to: "END" } },
      ] },
    ] },
  ] }],
};
const loc = (sc: string, strings: Record<string, string>, locale = "en"): LocaleFile => ({ schema: "patter/strings@0", scene: sc, locale, strings });
const bundle = exportBundle({
  project, scenes: [scene],
  locales: [loc("s", { P: "Hello?", L: "Quiet." }), loc("s", { P: "Allo ?", L: "Calme." }, "fr"), loc("@project", { [castStringKey("PLAYER")]: "Vous" }, "fr")],
});

/** A save as a runtime before speaker labels wrote it: every `speakerLabel` gone. */
function withoutLabels(save: SaveGame): SaveGame {
  return JSON.parse(JSON.stringify(save), (key, value: unknown) => (key === "speakerLabel" ? undefined : value)) as SaveGame;
}

describe("speaker labels", () => {
  it("an older save works out a pending choice's labels again, in the locale active at the load", () => {
    const first = new Engine(bundle);
    first.openFlow("main", { scene: "s" }).advance();
    const old = withoutLabels(first.saveGame());
    expect(JSON.stringify(old)).not.toContain("speakerLabel");
    const later = new Engine(bundle, { locale: "fr" });
    later.loadGame(old);
    expect(later.getFlow("main")!.advance()).toMatchObject({ type: "choice", options: [{ id: "o", prompt: { speakerLabel: "Vous (O.S.)" } }] });
  });

  it("an older save works out the label of a prompt still to be spoken back", () => {
    const first = new Engine(bundle, { replayPromptOnChoose: true });
    const flow = first.openFlow("main", { scene: "s" });
    flow.advance();
    flow.choose("o");
    const later = new Engine(bundle, { replayPromptOnChoose: true });
    later.loadGame(withoutLabels(first.saveGame()));
    const again = later.getFlow("main")!;
    expect(again.advance()).toMatchObject({ type: "line", id: "P", speakerLabel: "You (O.S.)" });
    expect(again.advance()).toMatchObject({ type: "line", id: "L", speakerLabel: "Your thoughts" });
  });

  it("gives the source-locale label in a beat's info, whatever the active locale", () => {
    const engine = new Engine(bundle, { locale: "fr" });
    expect(engine.getBeatSequence().find((f) => f.beat.id === "L")?.beat.speakerLabel).toBe("Your thoughts");
  });
});
