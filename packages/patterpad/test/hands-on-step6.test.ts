// ---------------------------------------------------------------------------
// The hands-on fixes review, step 6 (patterkit design/hands-on-fixes-code-review-2026-10.md, section 5 and
// "Step 6 ruled"), main-process side: `patter.scopes.json` rides every write of the project file (a pack
// merge and its undo included), and the paired Storylets project's cards are read, re-read by mtime, and
// matched to the scenes they play for the delete confirm.
// ---------------------------------------------------------------------------

import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalStringify, parseSource } from "@patterkit/core";
import * as project from "../src/main/project.js";
import { findPairedStorylets } from "../src/main/storyletter.js";
import { findDeckFiles, readDeckCards, refreshPairedCards, setPairedStorylets } from "../src/main/paired-cards.js";
import { cardsPlaying, cardsPlayingSentence } from "../src/shared/paired-cards.js";
import { untitledSceneName } from "../src/shared/file-name.js";

afterEach(() => setPairedStorylets(undefined));

/** The names `patter.scopes.json` declares under @patter, or null when there's no file. */
const patterScopeNames = (gameDir: string): string[] | null => {
  const path = join(gameDir, "game-scopes", "patter.scopes.json");
  if (!existsSync(path)) return null;
  const file = parseSource(readFileSync(path, "utf8")) as { scopes: { token: string; declarations?: { name: string }[] }[] };
  return (file.scopes.find((s) => s.token === "patter")?.declarations ?? []).map((d) => d.name);
};

/** A game folder that shares its scopes, with a new Patter project in it. */
async function sharingGame(): Promise<{ gameDir: string; sceneId: string }> {
  const gameDir = mkdtempSync(join(tmpdir(), "pp-step6-game-"));
  mkdirSync(join(gameDir, "game-scopes"));
  writeFileSync(join(gameDir, "game-scopes", "game.scopes.json"), JSON.stringify({ version: 1, owner: "Game", scopes: [] }, null, 2));
  const opened = await project.createProject(join(gameDir, "story.patter"), "Story");
  return { gameDir, sceneId: opened.scenes[0]!.id };
}

const undo = () => project.stepProjectHistory("undo");

describe("patter.scopes.json rides every write of the project file", () => {
  it("a returned Patterpack's merge brings it in line, and the merge's undo puts it back", async () => {
    const { gameDir } = await sharingGame();
    const sent = join(gameDir, "sent.patterpack");
    writeFileSync(sent, await project.packBytes());
    // The recipient declares @patter.gold; that comes back in the returned pack.
    const settings = project.readSettings()!;
    expect((await project.saveSettings({ ...settings, properties: [...settings.properties, { name: "gold", type: "number", default: 0 }] })).ok).toBe(true);
    expect(patterScopeNames(gameDir)).toContain("gold");
    const returned = join(gameDir, "returned.patterpack");
    writeFileSync(returned, await project.packBytes());
    expect((await undo()).ok).toBe(true); // our side never had it
    expect(patterScopeNames(gameDir) ?? []).not.toContain("gold");

    const plan = await project.planPackMerge(returned, sent);
    if ("error" in plan) throw new Error(plan.error);
    expect((await project.commitPackMerge(plan)).ok).toBe(true);
    expect(project.readSettings()!.properties.map((p) => p.name)).toContain("gold");
    expect(patterScopeNames(gameDir)).toContain("gold");

    const undone = await undo();
    expect(undone.label).toBe("Merge Patterpack");
    expect(project.readSettings()!.properties.map((p) => p.name)).not.toContain("gold");
    expect(patterScopeNames(gameDir) ?? []).not.toContain("gold");
  });

  it("a write that doesn't touch the properties still catches a stale file up, and its undo puts it back", async () => {
    const { gameDir, sceneId } = await sharingGame();
    const settings = project.readSettings()!;
    expect((await project.saveSettings({ ...settings, properties: [...settings.properties, { name: "gold", type: "number", default: 0 }] })).ok).toBe(true);
    const path = join(gameDir, "game-scopes", "patter.scopes.json");
    const inLine = readFileSync(path, "utf8");
    // Another tool (or a pull) left the file behind.
    const stale = inLine.replace(/"gold"/, "\"silver\"");
    writeFileSync(path, stale);
    // New Scene writes the project file (the scene's place in the order), and nothing about properties.
    expect((await project.createScene("The Cellar", "blank", undefined, sceneId)).ok).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(inLine);
    expect((await undo()).label).toBe("New scene");
    expect(readFileSync(path, "utf8")).toBe(stale);
  });

  it("a quick fix's Declare Property brings it with it, as one step", async () => {
    const { gameDir } = await sharingGame();
    expect((await project.applyFix({ kind: "declare-property", name: "trust", propType: "number" } as never)).ok).toBe(true);
    expect(patterScopeNames(gameDir)).toContain("trust");
    expect((await undo()).label).toBe("Declare property");
    expect(patterScopeNames(gameDir) ?? []).not.toContain("trust");
  });

  it("writes nothing to a game that doesn't share its scopes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-step6-alone-"));
    const opened = await project.createProject(join(dir, "story.patter"), "Story");
    expect((await project.createScene("The Cellar", "blank", undefined, opened.scenes[0]!.id)).ok).toBe(true);
    expect(existsSync(join(dir, "game-scopes"))).toBe(false);
  });
});

// --- the paired Storylets project's cards (Q19) ----------------------------------------------------------

/** A deck shard as Storylets writes one: `{ schema, deck, cards }`. */
const deck = (cards: Record<string, unknown>[]): string =>
  canonicalStringify({ schema: "storylets/deck@1", deck: { id: "dk_1", title: "Tavern", properties: [] }, cards: cards.map((c) => ({ priority: 0, outcomes: [], ...c })) });

/** A Patter project with a scene "The Tavern", and beside it a Storylets project paired with it. */
async function pairedGame(): Promise<{ gameDir: string; storylets: string; tavern: string; deckPath: string }> {
  const gameDir = mkdtempSync(join(tmpdir(), "pp-step6-pair-"));
  const opened = await project.createProject(join(gameDir, "story.patter"), "Story");
  const made = await project.createScene("The Tavern", "blank", undefined, opened.scenes[0]!.id);
  if (!made.ok || !made.sceneId) throw new Error("no scene");
  const storylets = join(gameDir, "cards.storylets");
  mkdirSync(join(storylets, "boxes", "inn", "decks"), { recursive: true });
  writeFileSync(join(storylets, "cards.storyletproj"), JSON.stringify({ patter: "../story.patter" }));
  const deckPath = join(storylets, "boxes", "inn", "decks", "tavern.storyletdeck");
  writeFileSync(deckPath, deck([
    { id: "cd_brawl", title: "Tavern Brawl", gameId: "the-tavern" }, // pinned to the scene's address
    { id: "cd_orders", title: "The Tavern" },                        // its title's slug is the address
    { id: "cd_street", title: "Street Fight" },                      // plays some other scene
  ]));
  expect(findPairedStorylets(join(gameDir, "story.patter"))).toBe(storylets);
  setPairedStorylets(storylets);
  return { gameDir, storylets, tavern: made.sceneId, deckPath };
}

describe("the paired project's cards", () => {
  it("are read from every decks/*.storyletdeck, by each card's effective gameId", async () => {
    const { storylets, deckPath } = await pairedGame();
    writeFileSync(join(storylets, "stray.storyletdeck"), deck([{ id: "cd_x", title: "Not in decks" }])); // not in a decks folder
    expect(findDeckFiles(storylets)).toEqual([deckPath]);
    expect(readDeckCards(readFileSync(deckPath, "utf8"))).toEqual([
      { title: "Tavern Brawl", ref: "the-tavern" },
      { title: "The Tavern", ref: "the-tavern" },
      { title: "Street Fight", ref: "street-fight" },
    ]);
    expect(readDeckCards(canonicalStringify({ cards: [{ id: "cd_bare" }] }))).toEqual([{ title: "cd_bare", ref: "cd_bare" }]);
    expect(readDeckCards("{ not a deck")).toEqual([]);
  });

  it("name the cards that play a scene in its delete info", async () => {
    const { tavern } = await pairedGame();
    const info = project.sceneDeleteInfo(tavern)!;
    expect(info.cards).toEqual(["Tavern Brawl", "The Tavern"]);
    expect(cardsPlayingSentence(info.cards)).toBe("2 storylet cards play this scene: Tavern Brawl, The Tavern.");
    // A scene no card plays has none, and with nothing paired neither does this one.
    const other = project.hydrate()!.sceneIds.find((id) => id !== tavern)!;
    expect(project.sceneDeleteInfo(other)!.cards).toEqual([]);
    setPairedStorylets(undefined);
    expect(project.sceneDeleteInfo(tavern)!.cards).toEqual([]);
  });

  it("are read again where a deck changed, and only there", async () => {
    const { tavern, deckPath } = await pairedGame();
    expect(project.sceneDeleteInfo(tavern)!.cards).toHaveLength(2);
    writeFileSync(deckPath, deck([{ id: "cd_brawl", title: "Tavern Brawl", gameId: "the-tavern" }, { id: "cd_orders", title: "Last Orders", gameId: "the-tavern" }, { id: "cd_lock", title: "Lock In", gameId: "the-tavern" }]));
    expect(project.sceneDeleteInfo(tavern)!.cards).toEqual(["Tavern Brawl", "Last Orders", "Lock In"]);
    // Same size, same time: the file isn't read again, so a change that keeps both goes unseen until it moves.
    const at = new Date(Math.floor(statSync(deckPath).mtimeMs / 1000) * 1000 - 60_000); // a whole second, kept exactly
    utimesSync(deckPath, at, at);
    expect(refreshPairedCards().map((c) => c.title)).toContain("Lock In");
    writeFileSync(deckPath, readFileSync(deckPath, "utf8").replace("Lock In", "Lock On"));
    utimesSync(deckPath, at, at);
    expect(refreshPairedCards().map((c) => c.title)).toContain("Lock In");
    utimesSync(deckPath, at, new Date(at.getTime() + 5000));
    expect(refreshPairedCards().map((c) => c.title)).toContain("Lock On");
  });

  it("follow a scene by its id first, as Patter resolves a reference", () => {
    const cards = [{ title: "By id", ref: "scn_b" }, { title: "By address", ref: "tavern" }];
    const ids = new Set(["scn_a", "scn_b"]);
    expect(cardsPlaying(cards, { id: "scn_a", name: "Tavern" }, ids)).toEqual(["By address"]);
    expect(cardsPlaying(cards, { id: "scn_b", name: "Street" }, ids)).toEqual(["By id"]);
    // A reference that is another scene's id goes there, even when it spells this scene's address.
    expect(cardsPlaying([{ title: "X", ref: "scn_b" }], { id: "scn_a", name: "Tavern", gameId: "scn_b" }, ids)).toEqual([]);
  });

  it("cap the list a sentence names", () => {
    expect(cardsPlayingSentence([])).toBe("");
    expect(cardsPlayingSentence(["Tavern Brawl"])).toBe("1 storylet card plays this scene: Tavern Brawl.");
    expect(cardsPlayingSentence(["A", "B", "C", "D", "E"])).toBe("5 storylet cards play this scene: A, B, C, and 2 more.");
  });
});

describe("New Scene's name", () => {
  it("is Untitled scene, numbered past the ones there are", () => {
    expect(untitledSceneName(["The Tavern"])).toBe("Untitled scene");
    expect(untitledSceneName(["Untitled scene"])).toBe("Untitled scene 2");
    expect(untitledSceneName(["untitled scene", "Untitled scene 2"])).toBe("Untitled scene 3");
  });
});
