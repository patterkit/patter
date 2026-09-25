// ---------------------------------------------------------------------------
// Shared game scopes, the file side (patterkit/design/shared-scopes.md): finding the game's
// `game-scopes/` folder, reading and merging it, reporting its problems, keeping Patter's own file
// current, editing the game's file from World properties, and previews standing other engines in.
// With no folder none of it happens, which the rest of the suite pins by passing unchanged.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { parseSource, canonicalStringify } from "@patterkit/core";
import type { FlowFile, ProjectFile } from "@patterkit/model";
import {
  runInit, applyWrites, loadProject, runValidate, runPlay, renderPlay, runCoverage, runExport,
  patterScopesWrite, patterScopesFile, serialiseScopesFile, planWorldSave, planShareScopes, defaultGameScopesDir,
  previewRegistry,
} from "../src/index.js";

const storylets = {
  version: 1, owner: "Storylet Engine",
  scopes: [{ token: "story", declarations: [
    { name: "act", type: "number", default: 2, purpose: "Which act the story is in" },
    { name: "ending", type: "string", default: "", writable: false },
  ] }],
};
const game = {
  version: 1, owner: "Game",
  scopes: [
    { token: "world", declarations: [{ name: "threat", type: "number", default: 3 }] },
    { token: "player", declarations: [{ name: "name", type: "string", default: "Ash" }] },
  ],
};

/** A game folder holding a Patter project (`story.patter`) and, unless told otherwise, a
 *  `game-scopes/` folder with the Storylet Engine's file and the game's own. */
function gameWith(opts: { files?: Record<string, string>; git?: boolean } = {}): { gameDir: string; root: string; scopesDir: string } {
  const gameDir = mkdtempSync(join(tmpdir(), "patter-game-"));
  if (opts.git) mkdirSync(join(gameDir, ".git"));
  const root = join(gameDir, "story.patter");
  applyWrites(runInit({ dir: root, name: "Story" }).writes);
  const scopesDir = join(gameDir, "game-scopes");
  const files = opts.files ?? {
    "storylets.scopes.json": JSON.stringify(storylets, null, 2),
    "game.scopes.json": JSON.stringify(game, null, 2),
  };
  if (Object.keys(files).length) mkdirSync(scopesDir);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(scopesDir, name), text);
  return { gameDir, root, scopesDir };
}

/** Put a condition on the starter scene's first snippet. */
function withCondition(root: string, condition: string): void {
  const path = join(root, "scenes", "start.patterflow");
  const flow = parseSource(readFileSync(path, "utf8")) as FlowFile;
  (flow.scene.blocks[0]!.children[0] as { condition?: string }).condition = condition;
  writeFileSync(path, canonicalStringify(flow));
}

/** Edit the project file in place. */
function editProject(root: string, edit: (p: ProjectFile) => ProjectFile): void {
  const loaded = loadProject(root);
  writeFileSync(loaded.projectFile, canonicalStringify(edit(loaded.project)));
}

describe("finding the game's scopes folder", () => {
  it("walks up from the project to the first game-scopes/ and merges every file in it", () => {
    const { root, scopesDir } = gameWith();
    const loaded = loadProject(root);
    expect(loaded.gameScopes?.dir).toBe(scopesDir);
    expect(loaded.gameScopes?.merged.spec.scopes.map((s) => s.token)).toEqual(["world", "player", "story"]);
    expect(loaded.gameScopes?.issues).toEqual([]);
  });

  it("stops at the version-control root, so a folder above the repository is never picked up", () => {
    const { gameDir } = gameWith();
    const repo = join(gameDir, "repo");
    mkdirSync(join(repo, ".git"), { recursive: true });
    const root = join(repo, "inner.patter");
    applyWrites(runInit({ dir: root, name: "Inner" }).writes);
    expect(loadProject(root).gameScopes).toBeUndefined();
  });

  it("finds nothing, and changes nothing, where there is no folder", () => {
    const { root } = gameWith({ files: {} });
    const loaded = loadProject(root);
    expect(loaded.gameScopes).toBeUndefined();
    expect(runValidate(loaded).gameScopes).toEqual([]);
  });

  it("follows the project's gameScopes override, and a missing one is a project error", () => {
    const { gameDir, root } = gameWith({ files: {} });
    const shared = join(gameDir, "shared", "game-scopes");
    mkdirSync(shared, { recursive: true });
    writeFileSync(join(shared, "game.scopes.json"), JSON.stringify(game));
    editProject(root, (p) => ({ ...p, gameScopes: "../shared/game-scopes" }));
    expect(loadProject(root).gameScopes?.dir).toBe(shared);

    editProject(root, (p) => ({ ...p, gameScopes: "../nowhere/game-scopes" }));
    const v = runValidate(loadProject(root));
    expect(v.ok).toBe(false);
    expect(v.gameScopes).toEqual([expect.objectContaining({ severity: "error", message: expect.stringContaining("doesn't exist") })]);
  });
});

describe("what validate says about the folder", () => {
  it("makes a scopes file that won't parse an error, anchored to that file", () => {
    const { root, scopesDir } = gameWith({ files: { "lockstep.scopes.json": "{ not json" } });
    const v = runValidate(loadProject(root));
    expect(v.ok).toBe(false);
    expect(v.gameScopes).toContainEqual(expect.objectContaining({ severity: "error", file: join(scopesDir, "lockstep.scopes.json") }));
  });

  it("makes a token two files claim an error naming both", () => {
    const { root } = gameWith({ files: {
      "storylets.scopes.json": JSON.stringify(storylets),
      "other.scopes.json": JSON.stringify({ version: 1, owner: "Other", scopes: [{ token: "story" }] }),
    } });
    const v = runValidate(loadProject(root));
    expect(v.gameScopes).toContainEqual(expect.objectContaining({ severity: "error",
      message: expect.stringMatching(/'@story' is declared by both other\.scopes\.json \(Other\) and storylets\.scopes\.json/) }));
  });

  it("warns, without failing, when patter.scopes.json is out of date, and export brings it up to date", () => {
    const { root, scopesDir } = gameWith();
    const stale = runValidate(loadProject(root));
    expect(stale.ok).toBe(true);
    expect(stale.gameScopes).toEqual([expect.objectContaining({ severity: "warning", message: "game-scopes/patter.scopes.json is missing: save the project in Patterpad or run export" })]);

    const write = patterScopesWrite(loadProject(root).project, loadProject(root).gameScopes)!;
    expect(write.path).toBe(join(scopesDir, "patter.scopes.json"));
    applyWrites([write]);
    expect(runValidate(loadProject(root)).gameScopes).toEqual([]);
    // Written again only when it would change.
    expect(patterScopesWrite(loadProject(root).project, loadProject(root).gameScopes)).toBeUndefined();

    editProject(root, (p) => ({ ...p, properties: [...(p.properties ?? []), { name: "gold", type: "number", default: 5 }] }));
    expect(runValidate(loadProject(root)).gameScopes).toEqual([expect.objectContaining({ severity: "warning",
      message: "game-scopes/patter.scopes.json is out of date: save the project in Patterpad or run export" })]);
  });

  it("reports other tools' names as warnings, which never fail a build", () => {
    const { root } = gameWith();
    withCondition(root, "@story.acts >= 2");
    const v = runValidate(loadProject(root));
    expect(v.conditions).toEqual([expect.objectContaining({ severity: "warning", message: expect.stringContaining("@story.acts is not declared by Storylet Engine") })]);
    expect(v.conditions.some((i) => i.severity === "error")).toBe(false);
  });
});

describe("Patter's own file", () => {
  it("holds only the shared @patter properties, in declaration order, deterministically", () => {
    const { root } = gameWith();
    editProject(root, (p) => ({ ...p, properties: [
      { name: "gold", type: "number", default: 5, purpose: "Coins" },
      { name: "mood", type: "enum", values: ["calm", "cross"], shared: false },
      { name: "met", type: "boolean", shared: true },
    ] }));
    const file = patterScopesFile(loadProject(root).project);
    expect(file.owner).toBe("Patter");
    expect(file.scopes).toEqual([{ token: "patter", declarations: [
      { name: "gold", type: "number", default: 5, purpose: "Coins" },
      { name: "met", type: "boolean" },
    ] }]);
    expect(serialiseScopesFile(file)).toBe(serialiseScopesFile(patterScopesFile(loadProject(root).project)));
  });

  it("is never written where there is no folder", () => {
    const { root } = gameWith({ files: {} });
    expect(patterScopesWrite(loadProject(root).project, loadProject(root).gameScopes)).toBeUndefined();
  });
});

describe("previews stand other engines in from the folder", () => {
  it("plays a line naming @story, reading the Storylet Engine's declared default", () => {
    const { root } = gameWith();
    withCondition(root, "@story.act >= 2");
    const result = runPlay(loadProject(root));
    expect(result.outcome).toBe("end");
    expect(renderPlay(result).join("\n")).toContain("Welcome to Story");
  });

  it("is refused, as before, where there is no folder", () => {
    const { root } = gameWith({ files: {} });
    withCondition(root, "@story.act >= 2");
    expect(() => runPlay(loadProject(root))).toThrow(/this content names @story, which no engine on this registry registered/);
  });

  it("runs coverage over it too", () => {
    const { root } = gameWith();
    withCondition(root, "@story.act >= 2");
    const report = runCoverage(loadProject(root), { runs: 5 });
    expect(report.totals.neverHit).toBe(0);
  });

  it("builds a registry with the stand-ins and the bundle's own host scopes, and none when nothing needs it", () => {
    const { root } = gameWith({ files: { "storylets.scopes.json": JSON.stringify(storylets) } });
    editProject(root, (p) => ({ ...p, scopeRegistry: { version: 1, scopes: [{ token: "town", writable: false, declarations: [{ name: "bell", type: "boolean", default: true }] }] } }));
    withCondition(root, "@story.act >= 2 and @town.bell");
    const loaded = loadProject(root);
    const registry = previewRegistry(loaded.gameScopes, runExport(loaded))!;
    expect(registry.get("story", "act")).toBe(2);
    expect(registry.get("town", "bell")).toBe(true);
    expect(() => registry.set("town", "bell", false)).toThrow(); // the scope's read-only default binds

    withCondition(root, "@town.bell");
    const plain = loadProject(root);
    expect(previewRegistry(plain.gameScopes, runExport(plain))).toBeUndefined();
  });
});

describe("World properties where the game has a scopes folder", () => {
  it("writes the game's scopes to game.scopes.json, keeping every scope the project doesn't show, and the project keeps a copy", () => {
    const { root, scopesDir } = gameWith();
    const loaded = loadProject(root);
    const world = { version: 1, scopes: [{ token: "world", declarations: [{ name: "threat", type: "number" as const, default: 7 }] }] };
    const plan = planWorldSave(loaded.project, loaded.gameScopes!, world);
    expect(plan.error).toBeUndefined();
    expect(plan.scopeRegistry).toEqual(world);
    applyWrites([plan.write!]);
    const written = JSON.parse(readFileSync(join(scopesDir, "game.scopes.json"), "utf8"));
    expect(written.owner).toBe("Game");
    expect(written.scopes.map((s: { token: string }) => s.token)).toEqual(["world", "player"]); // @player untouched
    expect(written.scopes[0].declarations[0].default).toBe(7);
    // Saving the same again writes nothing.
    expect(planWorldSave({ ...loaded.project, scopeRegistry: world }, loadProject(root).gameScopes!, world).write).toBeUndefined();
  });

  it("keeps another engine's scope in the project only, and refuses to overwrite a game file that won't parse", () => {
    // Written canonically, as a tool would have: a file only needs rewriting when its text would change.
    const { root, scopesDir } = gameWith({ files: { "game.scopes.json": serialiseScopesFile(game as Parameters<typeof serialiseScopesFile>[0]) } });
    const loaded = loadProject(root);
    const both = { version: 1, scopes: [
      { token: "story", declarations: [{ name: "act", type: "number" as const }] },
      { token: "world", declarations: [{ name: "threat", type: "number" as const, default: 3 }] },
    ] };
    const plan = planWorldSave(loaded.project, loaded.gameScopes!, both);
    expect(plan.scopeRegistry).toEqual(both);
    expect(plan.write).toBeUndefined(); // @world is as the file has it, and @story is not the game's
    writeFileSync(join(scopesDir, "game.scopes.json"), "{ broken");
    expect(planWorldSave(loaded.project, loaded.gameScopes!, both).error).toMatch(/won't parse/);
  });
});

describe("sharing a project's scopes with the other tools", () => {
  /** The plan, or the test fails with its error. */
  const shared = <T,>(plan: T | { error: string }): T => {
    if (plan && typeof plan === "object" && "error" in plan) throw new Error((plan as { error: string }).error);
    return plan as T;
  };
  it("suggests the version-control root, else beside the project", () => {
    const { gameDir, root } = gameWith({ files: {}, git: true });
    expect(defaultGameScopesDir(root)).toBe(join(gameDir, "game-scopes"));
    const lone = gameWith({ files: {} });
    expect(defaultGameScopesDir(lone.root)).toBe(join(lone.gameDir, "game-scopes"));
  });

  it("writes Patter's file and the game's from the project's own scopes, keeping the project's copy", () => {
    const { gameDir, root } = gameWith({ files: {}, git: true });
    const scopeRegistry = { version: 1, scopes: [
      { token: "world", declarations: [{ name: "threat", type: "number" as const }] },
      { token: "story", declarations: [{ name: "act", type: "number" as const }] },
    ] };
    editProject(root, (p) => ({ ...p, scopeRegistry }));
    const loaded = loadProject(root);
    const plan = shared(planShareScopes(root, loaded.project, join(gameDir, "game-scopes")));
    expect(plan.project.scopeRegistry).toEqual(scopeRegistry);
    expect(plan.project.gameScopes).toBeUndefined(); // the walk-up finds it
    applyWrites(plan.writes);
    const gameFile = JSON.parse(readFileSync(join(gameDir, "game-scopes", "game.scopes.json"), "utf8"));
    expect(gameFile.scopes.map((s: { token: string }) => s.token)).toEqual(["world"]); // @story is the Storylet Engine's
    expect(existsSync(join(gameDir, "game-scopes", "patter.scopes.json"))).toBe(true);
    const after = loadProject(root);
    expect(after.gameScopes?.dir).toBe(join(gameDir, "game-scopes"));
    expect(runValidate(after).gameScopes).toEqual([]); // Patter's file is fresh, and the project's copy matches
  });

  it("names a folder the walk-up would not find in the project", () => {
    const { gameDir, root } = gameWith({ files: {} });
    const elsewhere = join(gameDir, "elsewhere", "game-scopes");
    const plan = shared(planShareScopes(root, loadProject(root).project, elsewhere));
    expect(plan.project.gameScopes).toBe(join("..", "elsewhere", "game-scopes"));
  });

  it("joins a folder another tool made: game.scopes.json keeps every scope it holds and gains only the missing ones", () => {
    // A folder in another repository, which the walk-up from this project would never reach.
    const { gameDir, root } = gameWith({ files: {} });
    const theirs = join(gameDir, "other-repo", "game-scopes");
    mkdirSync(theirs, { recursive: true });
    const held = { version: 1, owner: "Game", scopes: [
      { token: "world", declarations: [{ name: "alarm", type: "number", default: 0 }] },
      { token: "player", declarations: [{ name: "hp", type: "number", default: 10 }] },
    ] };
    writeFileSync(join(theirs, "game.scopes.json"), JSON.stringify(held, null, 2));
    editProject(root, (p) => ({ ...p, scopeRegistry: { version: 1, scopes: [
      { token: "world", declarations: [{ name: "threat", type: "number" as const }] },
      { token: "weather", declarations: [{ name: "rain", type: "boolean" as const }] },
    ] } }));
    const plan = shared(planShareScopes(root, loadProject(root).project, theirs));
    applyWrites(plan.writes);
    const after = JSON.parse(readFileSync(join(theirs, "game.scopes.json"), "utf8"));
    expect(after.scopes.map((s: { token: string }) => s.token)).toEqual(["world", "player", "weather"]);
    expect(after.scopes[0].declarations.map((d: { name: string }) => d.name)).toEqual(["alarm"]); // theirs, untouched
  });

  it("refuses to join a folder whose game.scopes.json won't parse, and writes nothing", () => {
    const { gameDir, root } = gameWith({ files: {} });
    const theirs = join(gameDir, "other-repo", "game-scopes");
    mkdirSync(theirs, { recursive: true });
    writeFileSync(join(theirs, "game.scopes.json"), "{ not json");
    const plan = planShareScopes(root, loadProject(root).project, theirs);
    expect("error" in plan && plan.error).toMatch(/game\.scopes\.json in .* won't parse, so it was left alone/);
    expect(readFileSync(join(theirs, "game.scopes.json"), "utf8")).toBe("{ not json");
  });
});
