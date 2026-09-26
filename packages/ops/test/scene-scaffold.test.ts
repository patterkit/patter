// ---------------------------------------------------------------------------
// planScene (core): a stub scene Storyletter asks for when a card has none. The
// proof that matters is that the files it plans are a real scene: they load into
// a project, compile, and play in the runtime with the options labelled as the
// pairing rule needs. Expectations hand-written from the tavern fixture.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { planProject, planScene, parseSource } from "@patterkit/core";
import type { FlowFile } from "@patterkit/model";
import { Engine } from "@patterkit/runtime";
import { loadProject, runExport } from "../src/index.js";

const fixtureDir = fileURLToPath(new URL("./fixture", import.meta.url));

/** A copy of the fixture with the planned scene written into it. */
function withScene(outcomes: { gameId: string; title?: string }[], opening?: string): { dir: string; plan: ReturnType<typeof planScene> } {
  const dir = mkdtempSync(join(tmpdir(), "scaffold-"));
  cpSync(fixtureDir, dir, { recursive: true });
  const taken = new Set(readdirSync(join(dir, "scenes")).map((f) => f.replace(/\.patterflow$/, "")));
  const plan = planScene({ locale: "en", takenStems: taken }, { name: "The Moneylender's Men", gameId: "the-moneylenders-men", outcomes, ...(opening ? { opening } : {}) });
  for (const w of plan.writes) {
    mkdirSync(dirname(join(dir, w.path)), { recursive: true });
    writeFileSync(join(dir, w.path), w.content);
  }
  return { dir, plan };
}

describe("planScene", () => {
  it("plans a flow shard and its strings, named after the card, address pinned", () => {
    const { plan } = withScene([{ gameId: "continue" }]);
    // Patter's own file naming (core `slug`, as Patterpad's New Scene uses): the address is pinned
    // separately, so the file name never matters to the pairing.
    expect(plan.writes.map((w) => w.path)).toEqual(["scenes/the_moneylenders_men.patterflow", "loc/en/the_moneylenders_men.patterloc"]);
    const flow = parseSource(plan.writes[0]!.content) as FlowFile;
    expect([flow.scene.name, flow.scene.gameId, flow.scene.id]).toEqual(["The Moneylender's Men", "the-moneylenders-men", plan.sceneId]);
  });

  it("gives a card with several outcomes one labelled option each, and it plays", () => {
    const { dir } = withScene([
      { gameId: "pay-them-off", title: "Pay the debt yourself" },
      { gameId: "walk-away", title: "Walk away" },
    ], "Two of Aldric's men lean on the forge door.");
    const bundle = runExport(loadProject(dir));
    const flow = new Engine(bundle).openFlow("f", { scene: "the-moneylenders-men" });
    expect(flow.advance()).toMatchObject({ type: "text", text: "Two of Aldric's men lean on the forge door." });
    const choice = flow.advance();
    expect(choice.type).toBe("choice");
    if (choice.type !== "choice") return;
    expect(choice.options.map((o) => [o.prompt?.text, o.gameData?.["outcome"]])).toEqual([
      ["Pay the debt yourself", "pay-them-off"],
      ["Walk away", "walk-away"],
    ]);
    flow.choose(choice.options[1]!.id);
    expect(flow.advance()).toMatchObject({ type: "text", text: "What happens next." });
    expect(flow.advance()).toEqual({ type: "end" });
  });

  it("gives a card with one outcome no choice at all: the scene just ends", () => {
    const { dir } = withScene([{ gameId: "continue" }]);
    const flow = new Engine(runExport(loadProject(dir))).openFlow("f", { scene: "the-moneylenders-men" });
    expect(flow.advance()).toMatchObject({ type: "text", text: 'Write the scene for "The Moneylender\'s Men" here.' });
    expect(flow.advance()).toEqual({ type: "end" });
  });

  it("plans a new project another tool can create, which takes planned scenes and plays", () => {
    const dir = mkdtempSync(join(tmpdir(), "planned-"));
    const project = planProject({ name: "The Village" });
    expect(project.path).toBe("the_village.patterproj");
    writeFileSync(join(dir, project.path), project.content);
    const plan = planScene({ locale: "en", takenStems: new Set() }, { name: "Arrive", gameId: "arrive", outcomes: [{ gameId: "go" }] });
    for (const w of plan.writes) { mkdirSync(dirname(join(dir, w.path)), { recursive: true }); writeFileSync(join(dir, w.path), w.content); }
    const loaded = loadProject(dir);
    expect(loaded.project.project.name).toBe("The Village");
    const flow = new Engine(runExport(loaded)).openFlow("f", { scene: "arrive" });
    expect(flow.advance()).toMatchObject({ type: "text" });
    expect(flow.advance()).toEqual({ type: "end" });
  });

  it("never overwrites a scene file already there", () => {
    const plan = planScene({ locale: "fr", layout: { flow: "story/", strings: "strings/" }, takenStems: new Set(["gate", "gate-2"]) },
      { name: "Gate", gameId: "gate", outcomes: [] });
    expect(plan.writes.map((w) => w.path)).toEqual(["story/gate-3.patterflow", "strings/fr/gate-3.patterloc"]);
  });
});
