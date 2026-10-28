// ---------------------------------------------------------------------------
// Two smaller bugs from the October 2026 hands-on review (patterkit design/patter-hands-on-review-2026-10.md):
// "Bea saw Restart play the old content until a save", and "Dev's coverage row didn't leave the overview".
//
// Restart: the play window plays the last save with the editor's stashed live source laid over it. Only the
// START scene's stash was applied, so an edit in a scene the run had jumped into showed live (the refresh
// applies any scene's) and then went back to the saved copy on Restart. And a stash older than a save that
// had since landed was laid over that save, playing the edit before the last one. Main now also writes the
// editor's text before every run starts, so an edit inside the write and refresh debounces is in it.
//
// Coverage: the sweep reads the project in main, which the editor's text reaches only when written. A run
// straight after a fix swept the script from before it. Main now writes the editor's text first, as Replace
// and the imports do. A fix that HAS been written already leaves the table on the next run (pinned below).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalStringify, parseSource } from "@patterkit/core";
import * as project from "../src/main/project.js";
import type { PlayStep } from "../src/shared/api.js";

const TAVERN = fileURLToPath(new URL("../../../test-fixtures/tavern-example.patter", import.meta.url));

function openCopy(): void {
  const dir = join(mkdtempSync(join(tmpdir(), "pp-restart-")), "tavern.patter");
  cpSync(TAVERN, dir, { recursive: true });
  project.openProject(dir);
  project.hydrate();
}

/** The scene's source with one string reworded. */
function reworded(sceneId: string, id: string, text: string): { flow: string; loc: string } {
  const src = project.readScene(sceneId);
  const loc = parseSource(src.locSource) as { strings: Record<string, string> };
  loc.strings[id] = text;
  return { flow: src.flowSource, loc: canonicalStringify(loc) };
}

const texts = (steps: PlayStep[]): string[] => steps.map((s) => s.text ?? "");

/** Play the tavern from its start and take Leave, into the street: every text the run delivers. */
function playIntoTheStreet(): string[] {
  const out: string[] = [];
  for (let i = 0; i < 5; i++) {
    const batch = project.playToStop();
    expect(batch.stop).not.toBe("error");
    out.push(...texts(batch.steps));
    if (batch.stop !== "choice") break;
    project.playChoose("opt_leave");
  }
  return out;
}

describe("Restart plays what the editor shows", () => {
  it("an edit in a scene the run jumped into, not the one it started in", () => {
    openCopy();
    project.startPlay("scn_tavern");
    project.setPlaySource({ sceneId: "scn_street", ...reworded("scn_street", "T_street", "The street, edited.") });
    expect(project.refreshPlay().kind).toBe("text"); // the running session shows it live, as it always did
    project.startPlay("scn_tavern");                   // Restart
    const played = playIntoTheStreet();
    expect(played).toContain("The street, edited.");
    expect(played).not.toContain("Cold night air. The tavern door thuds shut behind you.");
  });

  it("a save that landed after the stash wins over it", async () => {
    openCopy();
    project.setPlaySource({ sceneId: "scn_tavern", ...reworded("scn_tavern", "T_scene", "First edit.") });
    const second = reworded("scn_tavern", "T_scene", "Second edit.");
    expect((await project.saveScene("scn_tavern", second.flow, second.loc)).ok).toBe(true);
    project.startPlay("scn_tavern");
    const played = texts(project.playToStop().steps);
    expect(played).toContain("Second edit.");
    expect(played).not.toContain("First edit.");
  });

  it("a stash pushed while a save is landing is newer, and stays", async () => {
    openCopy();
    const saved = reworded("scn_tavern", "T_scene", "Saved.");
    const saving = project.saveScene("scn_tavern", saved.flow, saved.loc);
    project.setPlaySource({ sceneId: "scn_tavern", ...reworded("scn_tavern", "T_scene", "Typed after.") });
    expect((await saving).ok).toBe(true);
    project.startPlay("scn_tavern");
    expect(texts(project.playToStop().steps)).toContain("Typed after.");
  });
});

describe("a coverage row leaves once its fix is in", () => {
  it("a written fix: the next run no longer lists the beat as never reached", async () => {
    openCopy();
    const run = async () => (await project.coverageAsync({ runs: 200, maxSteps: 100, seed: 1, scene: "scn_tavern" }, {}))!.report;
    const never = (r: Awaited<ReturnType<typeof run>>): string[] => r.beats.filter((b) => b.reachedRuns === 0).map((b) => b.id);
    expect(never(await run())).toContain("L_intim"); // gated on @strength >= 5, and strength is 2
    const src = project.readScene("scn_tavern");
    const flow = src.flowSource.replace('"condition": "@strength >= 5",', "");
    expect(flow).not.toBe(src.flowSource);
    expect((await project.saveScene("scn_tavern", flow, src.locSource)).ok).toBe(true);
    expect(never(await run())).not.toContain("L_intim");
  });
});

describe("main writes the editor's text before reading the project for a run", () => {
  // main/index.ts runs under Electron, so its handlers are read as source, as dialog-copy.test.ts does.
  const main = readFileSync(fileURLToPath(new URL("../src/main/index.ts", import.meta.url)), "utf8");
  /** The body of one `ipcMain.handle` registration, up to the next one. */
  const handler = (channel: string): string => {
    const at = main.indexOf(`ipcMain.handle("${channel}"`);
    expect(at).toBeGreaterThan(-1);
    const next = main.indexOf("ipcMain.handle(", at + 1);
    return main.slice(at, next < 0 ? undefined : next);
  };
  const before = (body: string, first: string, then: string): boolean =>
    body.includes(first) && body.includes(then) && body.indexOf(first) < body.indexOf(then);

  it("a play run (the window opening, Restart, a language switch)", () => {
    expect(before(handler("play:start"), "await flushEditorScene()", "project.startPlay(")).toBe(true);
  });

  it("a coverage run", () => {
    expect(before(handler("covWin:run"), "await flushEditorScene()", "project.coverageAsync(")).toBe(true);
  });
});
