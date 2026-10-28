// Project Settings ▸ Game scopes, saved (Ian's ruling of 2026-10-28, patterkit
// design/hands-on-fixes-code-review-2026-10.md section 4, matching Storyletter's host scopes): a scope added
// with its properties, an opaque one and a read-only one; a name the save refuses; a scope removed where the
// game shares its scopes, which goes from the shared file too; and a scope renamed, which carries every
// reference to it (conditions, set effects, `{@scope.x}` in strings) as one undo step.

import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSource, canonicalStringify } from "@patterkit/core";
import type { HostScopeRegistry } from "@patterkit/model";
import * as project from "../src/main/project.js";

type Flow = { scene: { onEntry?: unknown[]; blocks: { children: Record<string, unknown>[] }[] } };
type Loc = { strings: Record<string, string> };

const projectFile = (): { scopeRegistry?: HostScopeRegistry; coverageDrivers?: unknown[] } =>
  parseSource(readFileSync(join(project.currentRoot()!, "story.patterproj"), "utf8")) as never;

const player: HostScopeRegistry = { version: 1, scopes: [
  { token: "world", declarations: [{ name: "threat", type: "number", default: 3 }] },
  { token: "player", declarations: [{ name: "hp", type: "number", default: 10 }, { name: "name", type: "string", default: "Ash" }] },
] };

/** A new project in `dir` whose first scene reads and writes @player.hp everywhere a reference can be. */
async function storyReadingPlayer(dir: string): Promise<{ sceneId: string }> {
  const opened = await project.createProject(join(dir, "story.patter"), "Story");
  const sceneId = opened.scenes[0]!.id;
  expect((await project.saveSettings({ ...project.readSettings()!, scopeRegistry: player })).ok).toBe(true);
  const src = project.readScene(sceneId);
  const flow = parseSource(src.flowSource) as Flow;
  const loc = parseSource(src.locSource) as Loc;
  flow.scene.onEntry = [{ kind: "set", target: "@player.hp", value: "@player.hp + 1" }];
  flow.scene.blocks[0]!.children.push({
    id: "sn_hurt", type: "snippet", condition: "@player.hp > 0 and @world.threat >= 1 and @player.name != \"@player.hp\"",
    onEnter: [{ kind: "set", target: "@player.hp", value: "@player.hp - 1" }],
    beats: [{ id: "L_hurt", kind: "text" }],
  });
  loc.strings["L_hurt"] = "You have {@player.hp} left, {{@player.hp}} is literal, and {@world.threat} is the threat.";
  expect((await project.saveScene(sceneId, canonicalStringify(flow), canonicalStringify(loc))).ok).toBe(true);
  return { sceneId };
}

describe("saving game scopes", () => {
  it("adds a scope with its properties, an opaque one, and a read-only one", async () => {
    await project.createProject(join(mkdtempSync(join(tmpdir(), "pp-scopes-")), "story.patter"), "Story");
    const scopeRegistry: HostScopeRegistry = { version: 1, scopes: [
      { token: "world", declarations: [{ name: "threat", type: "number" }] },
      { token: "player", writable: false, declarations: [{ name: "hp", type: "number", default: 10 }] },
      { token: "weather" },
    ] };
    expect((await project.saveSettings({ ...project.readSettings()!, scopeRegistry })).ok).toBe(true);
    expect(projectFile().scopeRegistry).toEqual(scopeRegistry);
    expect(project.readSettings()!.scopeRegistry).toEqual(scopeRegistry);
  });

  it("refuses Patter's own scope, a malformed name, and the same name twice, and changes nothing", async () => {
    await project.createProject(join(mkdtempSync(join(tmpdir(), "pp-scopes-")), "story.patter"), "Story");
    const before = readFileSync(join(project.currentRoot()!, "story.patterproj"), "utf8");
    const save = (scopes: HostScopeRegistry["scopes"]) => project.saveSettings({ ...project.readSettings()!, scopeRegistry: { version: 1, scopes } });
    expect(await save([{ token: "patter" }])).toMatchObject({ ok: false, error: "@patter is Patter's own scope, so the game can't provide it." });
    expect(await save([{ token: "scene" }])).toMatchObject({ ok: false });
    expect(await save([{ token: "9lives" }])).toMatchObject({ ok: false, error: expect.stringContaining("letters, digits and _") });
    expect(await save([{ token: "player" }, { token: "player", declarations: [] }])).toMatchObject({ ok: false, error: "There is more than one @player scope." });
    expect(readFileSync(join(project.currentRoot()!, "story.patterproj"), "utf8")).toBe(before);
  });
});

describe("a scope removed where the game shares its scopes", () => {
  it("goes from game.scopes.json and the project's copy, and the other tools' scopes stay", async () => {
    const gameDir = mkdtempSync(join(tmpdir(), "pp-scopes-game-"));
    const scopes = join(gameDir, "game-scopes");
    mkdirSync(scopes);
    writeFileSync(join(scopes, "game.scopes.json"), JSON.stringify({ version: 1, owner: "Game", scopes: [
      { token: "world", declarations: [{ name: "threat", type: "number", default: 3 }] },
      { token: "inventory" }, // another tool's: this project never showed it
    ] }, null, 2));
    await project.createProject(join(gameDir, "story.patter"), "Story");
    expect((await project.saveSettings({ ...project.readSettings()!, scopeRegistry: player })).ok).toBe(true);
    const shared = () => (JSON.parse(readFileSync(join(scopes, "game.scopes.json"), "utf8")) as HostScopeRegistry).scopes.map((s) => s.token);
    expect(shared()).toEqual(["world", "inventory", "player"]);

    const s = project.readSettings()!;
    expect(s.scopeRegistry?.scopes.map((x) => x.token)).toEqual(["world", "player"]);
    const withoutPlayer = { version: 1, scopes: s.scopeRegistry!.scopes.filter((x) => x.token !== "player") };
    expect((await project.saveSettings({ ...s, scopeRegistry: withoutPlayer })).ok).toBe(true);
    expect(shared()).toEqual(["world", "inventory"]);
    expect(projectFile().scopeRegistry?.scopes.map((x) => x.token)).toEqual(["world"]);
    // Patter's own file there is written with the settings, and still says only @patter.
    expect(JSON.parse(readFileSync(join(scopes, "patter.scopes.json"), "utf8")).scopes.map((x: { token: string }) => x.token)).toEqual(["patter"]);
  });
});

describe("a scope renamed in Project Settings", () => {
  const renamed: HostScopeRegistry = { version: 1, scopes: [player.scopes[0]!, { ...player.scopes[1]!, token: "hero" }] };

  it("carries @player to @hero through conditions, effects, and strings, compiles clean, and one undo puts it all back", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-scopes-rename-"));
    const { sceneId } = await storyReadingPlayer(dir);
    const read = () => project.readScene(sceneId);
    const flowBefore = read().flowSource;
    const locBefore = read().locSource;
    const fileBefore = readFileSync(join(project.currentRoot()!, "story.patterproj"), "utf8");

    const res = await project.saveSettings({
      ...project.readSettings()!, scopeRegistry: renamed, coverageDrivers: [{ ref: "@hero.hp", kind: "initial", values: [1] }],
      scopeRenames: { player: "hero" },
    });
    expect(res.ok).toBe(true);
    expect(res.step?.label).toBe("Project settings");

    const flow = parseSource(read().flowSource) as Flow;
    expect(flow.scene.onEntry).toEqual([{ kind: "set", target: "@hero.hp", value: "@hero.hp + 1" }]);
    const hurt = flow.scene.blocks[0]!.children.find((c) => c["id"] === "sn_hurt")!;
    // The author's own text, with the string literal that merely looks like a reference left alone.
    expect(hurt["condition"]).toBe("@hero.hp > 0 and @world.threat >= 1 and @hero.name != \"@player.hp\"");
    expect(hurt["onEnter"]).toEqual([{ kind: "set", target: "@hero.hp", value: "@hero.hp - 1" }]);
    expect((parseSource(read().locSource) as Loc).strings["L_hurt"])
      .toBe("You have {@hero.hp} left, {{@player.hp}} is literal, and {@world.threat} is the threat.");
    expect(projectFile().scopeRegistry).toEqual(renamed);
    const problems = project.validate().problems.filter((p) => p.severity === "error");
    expect(problems).toEqual([]);

    // One step: the declarations, the scenes, and the strings come back together.
    const undone = await project.stepProjectHistory("undo");
    expect(undone).toMatchObject({ ok: true, label: "Project settings" });
    expect(read().flowSource).toBe(flowBefore);
    expect(read().locSource).toBe(locBefore);
    expect(readFileSync(join(project.currentRoot()!, "story.patterproj"), "utf8")).toBe(fileBefore);
  });

  it("swaps two scopes' names cleanly", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-scopes-swap-"));
    const { sceneId } = await storyReadingPlayer(dir);
    // @world is fixed, so the swap is between @player and a scope added beside it.
    const both: HostScopeRegistry = { version: 1, scopes: [...player.scopes, { token: "foe", declarations: [{ name: "hp", type: "number" }, { name: "name", type: "string" }] }] };
    expect((await project.saveSettings({ ...project.readSettings()!, scopeRegistry: both })).ok).toBe(true);
    const swapped: HostScopeRegistry = { version: 1, scopes: [player.scopes[0]!, { ...both.scopes[1]!, token: "foe" }, { ...both.scopes[2]!, token: "player" }] };
    expect((await project.saveSettings({ ...project.readSettings()!, scopeRegistry: swapped, scopeRenames: { player: "foe", foe: "player" } })).ok).toBe(true);
    const hurt = (parseSource(project.readScene(sceneId).flowSource) as Flow).scene.blocks[0]!.children.find((c) => c["id"] === "sn_hurt")!;
    expect(hurt["condition"]).toBe("@foe.hp > 0 and @world.threat >= 1 and @foe.name != \"@player.hp\"");
  });

  it("refuses a rename onto a token the project already has, and changes nothing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-scopes-clash-"));
    const { sceneId } = await storyReadingPlayer(dir);
    const flowBefore = project.readScene(sceneId).flowSource;
    const res = await project.saveSettings({ ...project.readSettings()!, scopeRegistry: { version: 1, scopes: [{ ...player.scopes[1]!, token: "world" }] }, scopeRenames: { player: "world" } });
    expect(res).toMatchObject({ ok: false, error: "@player can't be renamed to @world: the project already has an @world scope." });
    expect(project.readScene(sceneId).flowSource).toBe(flowBefore);
  });
});
