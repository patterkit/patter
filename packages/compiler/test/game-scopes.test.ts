// Shared game scopes, the compiler side (patterkit/design/shared-scopes.md). A game's `game-scopes/`
// folder lets the compiler check names another tool owns: every finding about one is a WARNING, since
// the other project may be a save behind. The game's own `game.scopes.json` wins over the project's
// copy of a host scope, and its `@world` reaches the bundle; another engine's scope never does. With no
// folder, nothing moves: the same host scopes, the same bundle, the same hash.

import { describe, it, expect } from "vitest";
import { exportBundle, validateConditions, validateInterpolation, projectScopes } from "@patterkit/compiler";
import { mergeScopes, parseScopesFile } from "@wildwinter/scoperegistry/scopes";
import type { MergedScopes, NamedScopesFile } from "@wildwinter/scoperegistry/scopes";
import type { ProjectFile, Scene, Effect, LocaleFile, HostScopeRegistry } from "@patterkit/model";

/** A folder from files given as objects, through the real parser (so a bad fixture fails loudly). */
function folder(files: Record<string, unknown>): MergedScopes {
  const named: NamedScopesFile[] = Object.entries(files).map(([fileName, body]) => {
    const { file, issues } = parseScopesFile(JSON.stringify(body), fileName);
    if (!file) throw new Error(issues.map((i) => i.message).join("; "));
    return { fileName, file };
  });
  return mergeScopes(named);
}

const storylets = {
  version: 1, owner: "Storylet Engine",
  scopes: [{ token: "story", declarations: [
    { name: "act", type: "number", default: 1, purpose: "Which act the story is in" },
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
const merged = folder({ "storylets.scopes.json": storylets, "game.scopes.json": game });

function project(over: Partial<ProjectFile> = {}): ProjectFile {
  return {
    schema: "patter/project@0",
    project: { id: "proj_1", name: "Test" },
    locales: { default: "en", all: ["en"] },
    properties: [{ name: "hp", type: "number" }],
    ...over,
  };
}

function scene(condition: string, onEnter?: Effect[]): Scene {
  return {
    id: "scn_1", type: "scene", name: "Scene",
    blocks: [{ id: "blk_1", type: "block", name: "B", children: [
      { id: "sn_1", type: "snippet", condition, ...(onEnter ? { onEnter } : {}), beats: [{ id: "T_1", kind: "text" }] },
    ] }],
  };
}

const issuesFor = (condition: string, opts: { merged?: MergedScopes; project?: ProjectFile; onEnter?: Effect[] } = {}) =>
  validateConditions({ project: opts.project ?? project(), scenes: [scene(condition, opts.onEnter)] }, { gameScopes: opts.merged ?? merged });

describe("checking another tool's scopes from the game's folder", () => {
  it("accepts a declared name read with the right type, and says nothing", () => {
    expect(issuesFor("@story.act >= 2")).toEqual([]);
  });

  it("warns on a name the other tool's file does not declare, naming the file", () => {
    const issues = issuesFor("@story.acts >= 2");
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "warning", message: "@story.acts is not declared by Storylet Engine (game-scopes/storylets.scopes.json)" });
  });

  it("warns on a type mismatch against the other tool's declaration", () => {
    const issues = issuesFor('@story.act == "two"');
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.severity === "warning")).toBe(true);
    expect(issues.map((i) => i.message).join(" ")).toMatch(/number/);
  });

  it("warns on a write to a property the other tool's file marks read-only, and on a write to an undeclared one", () => {
    const readOnly = issuesFor("true", { onEnter: [{ kind: "set", target: "@story.ending", value: '"won"' }] });
    expect(readOnly).toEqual([expect.objectContaining({ severity: "warning", field: "onEnter.set",
      message: "@story.ending is read-only: Storylet Engine (game-scopes/storylets.scopes.json) declares it so" })]);
    const undeclared = issuesFor("true", { onEnter: [{ kind: "set", target: "@story.nope", value: "1" }] });
    expect(undeclared).toEqual([expect.objectContaining({ severity: "warning", message: expect.stringContaining("@story.nope is not declared by Storylet Engine") })]);
  });

  it("checks a game scope the project does not declare (from game.scopes.json) the same way", () => {
    expect(issuesFor('@player.name == "Ash"')).toEqual([]);
    expect(issuesFor('@player.nam == "Ash"')).toEqual([expect.objectContaining({ severity: "warning",
      message: "@player.nam is not declared by Game (game-scopes/game.scopes.json)" })]);
  });

  it("keeps a token nobody declares as today: accepted, unchecked", () => {
    const noStory = folder({ "game.scopes.json": game });
    expect(issuesFor("@story.anything >= 2", { merged: noStory })).toEqual([]);
  });

  it("keeps the project's own host scopes strict: an undeclared @world name is still an error", () => {
    const issues = issuesFor("@world.nope > 1");
    expect(issues).toEqual([expect.objectContaining({ severity: "error" })]);
  });

  it("warns, not errors, in an interpolation slot", () => {
    const loc: LocaleFile = { schema: "patter/strings@0", scene: "scn_1", locale: "en", default: true, strings: { T_1: "Act {@story.act}, {@story.actt}." } };
    const issues = validateInterpolation({ project: project(), scenes: [scene("true")], locales: [loc] }, { gameScopes: merged });
    expect(issues).toEqual([expect.objectContaining({ severity: "warning", src: "{@story.actt}", message: expect.stringContaining("not declared by Storylet Engine") })]);
  });
});

describe("the project's host scopes against the game's folder", () => {
  const worldCopy: HostScopeRegistry = { version: 1, scopes: [{ token: "world", declarations: [{ name: "threat", type: "number", default: 3 }] }] };

  it("changes nothing without a folder: the same object, the same bundle hash", () => {
    const p = project({ scopeRegistry: worldCopy });
    expect(projectScopes(p).host).toBe(worldCopy);
    const alone = exportBundle({ project: p, scenes: [scene("@world.threat > 1")] });
    const withNothing = exportBundle({ project: p, scenes: [scene("@world.threat > 1")], gameScopes: undefined });
    expect(withNothing.content.hash).toBe(alone.content.hash);
    expect(alone.scopeRegistry).toBe(worldCopy);
  });

  it("says nothing when the project's copy matches the game's file", () => {
    expect(projectScopes(project({ scopeRegistry: worldCopy }), merged).notes).toEqual([]);
  });

  it("warns when the project's copy differs, and the shared file wins, for checking and for the bundle", () => {
    const stale: HostScopeRegistry = { version: 1, scopes: [{ token: "world", declarations: [{ name: "threat", type: "string" }] }] };
    const p = project({ scopeRegistry: stale });
    const { notes, host } = projectScopes(p, merged);
    expect(notes).toEqual([expect.objectContaining({ token: "world", file: "game.scopes.json", message: expect.stringContaining("@world in World properties differs from game-scopes/game.scopes.json") })]);
    expect(host?.scopes[0]?.declarations?.[0]).toMatchObject({ name: "threat", type: "number", default: 3 });
    expect(validateConditions({ project: p, scenes: [scene("@world.threat > 1")] }, { gameScopes: merged })).toEqual([]);
    expect(exportBundle({ project: p, scenes: [scene("@world.threat > 1")], gameScopes: merged }).scopeRegistry?.scopes[0]?.declarations?.[0]?.type).toBe("number");
  });

  it("bakes @world from game.scopes.json into the bundle when the project does not declare it", () => {
    const b = exportBundle({ project: project(), scenes: [scene("@world.threat > 1")], gameScopes: merged });
    expect(b.scopeRegistry?.scopes.map((s) => s.token)).toEqual(["world"]);
    expect(b.externalScopes).toBeUndefined();
  });

  it("never bakes another tool's scopes in: they are named in externalScopes for the game to register", () => {
    const b = exportBundle({ project: project(), scenes: [scene('@story.act >= 2 and @player.name == "Ash"')], gameScopes: merged });
    expect(b.scopeRegistry?.scopes.map((s) => s.token)).toEqual(["world"]);
    expect(b.externalScopes).toEqual(["player", "story"]);
  });

  it("supersedes another engine's scope imported as a host scope, with a warning to remove it", () => {
    const imported: HostScopeRegistry = { version: 1, scopes: [{ token: "story", declarations: [{ name: "act", type: "number" }] }] };
    const p = project({ scopeRegistry: imported });
    const { notes, host, external } = projectScopes(p, merged);
    expect(notes).toEqual([expect.objectContaining({ token: "story", message: "@story is declared in game-scopes/storylets.scopes.json; remove it from World properties" })]);
    expect(host?.scopes.map((s) => s.token)).toEqual(["world"]);
    expect(external.map((s) => s.token)).toContain("story");
    // Checked from the engine's own file now, so its findings are warnings.
    expect(validateConditions({ project: p, scenes: [scene("@story.acts > 1")] }, { gameScopes: merged })[0]?.severity).toBe("warning");
  });

  it("never reads Patter's own token back from the folder", () => {
    const withPatter = folder({ ...{ "game.scopes.json": game }, "patter.scopes.json": { version: 1, owner: "Patter", scopes: [{ token: "patter", declarations: [] }] } });
    expect(issuesFor("@hp > 1", { merged: withPatter })).toEqual([]);
    expect(projectScopes(project(), withPatter).external.map((s) => s.token)).toEqual(["player"]);
  });
});
