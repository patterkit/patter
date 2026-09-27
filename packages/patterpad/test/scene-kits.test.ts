// Scene kits (main/scene-kits.ts): each kit lands a scene that validates, compiles and plays through the
// reference runtime to what its gallery words promise (storylet-studio design/kit-gallery.md, 7a), and
// New Scene adds the chosen speaker to the cast only when they are new. Expectations hand-written from
// the kits' own words.

import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProject, runPlay, runValidate } from "@patterkit/ops";
import type { PlayEvent } from "@patterkit/ops";
import * as project from "../src/main/project.js";
import { SCENE_KITS, buildSceneKit, kitNeedsSpeaker } from "../src/main/scene-kits.js";
import type { SceneKit } from "../src/main/scene-kits.js";

/** A fresh project with one scene made from `kit`; returns its folder and the new scene's id. */
async function withKit(kit: SceneKit, speaker?: string): Promise<{ dir: string; sceneId: string }> {
  const dir = mkdtempSync(join(tmpdir(), `pp-kit-${kit}-`));
  await project.createProject(dir, "Kits");
  const res = await project.createScene("The Docks", kit, speaker);
  expect(res.ok, res.error).toBe(true);
  return { dir, sceneId: res.sceneId! };
}

const said = (events: PlayEvent[]): string[] =>
  events.flatMap((e) => (e.type === "line" ? [`${e.character}: ${e.text}`] : e.type === "text" ? [e.text] : e.type === "gameEvent" ? [`[${JSON.stringify(e.gameData)}]`] : []));

describe("scene kits", () => {
  it("offers five, Blank first, and only Blank needs no speaker", () => {
    expect([...SCENE_KITS]).toEqual(["blank", "conversation", "hub", "barks", "cutscene"]);
    expect(SCENE_KITS.filter(kitNeedsSpeaker)).toEqual(["conversation", "hub", "barks", "cutscene"]);
    expect(() => buildSceneKit("hub", "X")).toThrow(/needs a speaker/);
  });

  it.each(SCENE_KITS)("%s validates clean and plays to the end", async (kit) => {
    const { dir, sceneId } = await withKit(kit, "Gareth");
    const loaded = loadProject(dir);
    const v = runValidate(loaded);
    expect({ ok: v.ok, structural: v.structural, conditions: v.conditions, interpolation: v.interpolation })
      .toEqual({ ok: true, structural: [], conditions: [], interpolation: [] });
    expect(runPlay(loaded, { scene: sceneId }).outcome).toBe("end");
  });

  it("Blank: the line, then the end", async () => {
    const { dir, sceneId } = await withKit("blank");
    expect(said(runPlay(loadProject(dir), { scene: sceneId }).events)).toEqual(["A new scene."]);
  });

  it("Conversation: either answer gathers back to the same closing line", async () => {
    const { dir, sceneId } = await withKit("conversation", "Gareth");
    const loaded = loadProject(dir);
    const first = runPlay(loaded, { scene: sceneId });
    const choice = first.events.find((e) => e.type === "choice");
    expect(choice?.type === "choice" && choice.options.map((o) => o.prompt?.text)).toEqual(["Tell them about the road", "Say nothing"]);
    expect(said(first.events)).toEqual([
      "Gareth: You look like you've come a long way.",
      "Gareth: Rough, was it? It always is, this time of year.",
      "Gareth: Well. You're here now.",
    ]);
    const other = choice?.type === "choice" ? choice.options[1]!.id : "";
    expect(said(runPlay(loaded, { scene: sceneId, choices: [other] }).events)).toEqual([
      "Gareth: You look like you've come a long way.",
      "You shrug. They let it go.",
      "Gareth: Well. You're here now.",
    ]);
  });

  it("Hub: the menu returns after each topic, a topic drops off once asked, goodbye ends it", async () => {
    const { dir, sceneId } = await withKit("hub", "Mira");
    const run = runPlay(loadProject(dir), { scene: sceneId }); // takes the first eligible option each time
    const menus = run.events.filter((e) => e.type === "choice").map((e) => (e.type === "choice" ? e.options.map((o) => o.prompt?.text) : []));
    expect(menus).toEqual([
      ["Ask about the town", "Ask about the work", "Say goodbye"],
      ["Ask about the work", "Say goodbye"],
      ["Say goodbye"],
    ]);
    expect(said(run.events).at(-1)).toBe("Mira: Safe travels.");
    expect(run.outcome).toBe("end");
  });

  it("Barks: one line of the four each play", async () => {
    const { dir, sceneId } = await withKit("barks", "Guard");
    const loaded = loadProject(dir);
    const lines = [1, 2, 3, 4, 5, 6].map((seed) => said(runPlay(loaded, { scene: sceneId, seed }).events));
    for (const l of lines) {
      expect(l).toHaveLength(1);
      expect(["Guard: Keep moving.", "Guard: Nothing to see here.", "Guard: Mind how you go.", "Guard: Long day. Longer night."]).toContain(l[0]);
    }
  });

  it("Cutscene: lines in order with the cues between them", async () => {
    const { dir, sceneId } = await withKit("cutscene", "Bryna");
    const run = runPlay(loadProject(dir), { scene: sceneId });
    expect(said(run.events)).toEqual([
      '[{"camera":"wide"}]',
      "Rain on the harbour. A lamp gutters in the wind.",
      "Bryna: You shouldn't have come back.",
      '[{"animation":"turn-to-face"}]',
      "Bryna: But since you're here, you might as well hear it.",
      '[{"camera":"close-up"}]',
    ]);
    const direction = run.events.find((e) => e.type === "line");
    expect(direction?.type === "line" && direction.direction).toBe("quietly, without turning round");
  });

  it("adds a new speaker to the cast once, and leaves an existing one alone", async () => {
    const { dir } = await withKit("conversation", "Gareth");
    expect((loadProject(dir).project.cast ?? []).map((c) => c.name)).toEqual(["Gareth"]);
    expect((await project.createScene("Again", "hub", "Gareth")).ok).toBe(true);
    expect((loadProject(dir).project.cast ?? []).map((c) => c.name)).toEqual(["Gareth"]);
    expect((await project.createScene("Someone else", "barks", "Mira")).ok).toBe(true);
    expect((loadProject(dir).project.cast ?? []).map((c) => c.name)).toEqual(["Gareth", "Mira"]);
  });

  it("refuses a kit with lines and no speaker, and an unknown kit", async () => {
    await withKit("blank");
    expect((await project.createScene("Nobody", "conversation")).ok).toBe(false);
    expect((await project.createScene("Nobody", "conversation", "   ")).ok).toBe(false);
    expect((await project.createScene("Odd", "ballad" as SceneKit, "Gareth")).ok).toBe(false);
  });
});
