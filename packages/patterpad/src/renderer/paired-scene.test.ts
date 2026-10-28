// The hands-on fixes review, step 6 (Q19), the renderer's side: the delete confirm for a scene storylet
// cards play, the Game ID editor's question before a change that would lose them, and the Game ID a rename
// pins (with its toast). Copy checked word for word: it's what the author reads.

import { describe, it, expect } from "vitest";
import { deletePlayedScenePrompt, gameIdChangePrompt, renamePin } from "./src/paired-scene.js";

const cards = [{ title: "Tavern Brawl", ref: "tavern" }, { title: "Last Orders", ref: "tavern" }, { title: "Street Fight", ref: "street" }];
const ids = new Set(["scn_tavern", "scn_street"]);
const tavern = { id: "scn_tavern", name: "Tavern" };

describe("deleting a scene cards play", () => {
  it("asks first, naming the cards", () => {
    expect(deletePlayedScenePrompt("Tavern", ["Tavern Brawl", "Last Orders"])).toEqual({
      title: "Delete “Tavern”?",
      sub: "2 storylet cards play this scene: Tavern Brawl, Last Orders.",
      body: ["They'll have no scene to play once it's gone."],
      buttons: ["Cancel", "Delete Scene"], defaultId: 0, cancelId: 0,
    });
  });

  it("doesn't ask when no card plays it (it deletes at once, with Undo)", () => {
    expect(deletePlayedScenePrompt("Tavern", [])).toBeNull();
  });
});

describe("changing a played scene's Game ID", () => {
  it("asks first, naming the cards and both Game IDs", () => {
    expect(gameIdChangePrompt(cards, tavern, ids, "pub")).toEqual({
      title: "Change the Game ID?",
      sub: "2 storylet cards play this scene: Tavern Brawl, Last Orders.",
      body: ["They find it by its Game ID 'tavern'. Once it's 'pub', they won't."],
      buttons: ["Cancel", "Change Game ID"], defaultId: 0, cancelId: 0,
    });
  });

  it("asks when clearing a pin moves it back to the name's", () => {
    expect(gameIdChangePrompt(cards, { ...tavern, name: "The Old Inn", gameId: "tavern" }, ids, "")?.body).toEqual(["They find it by its Game ID 'tavern'. Once it's 'the-old-inn', they won't."]);
  });

  it("doesn't ask when the Game ID stays the same, or no card plays the scene", () => {
    expect(gameIdChangePrompt(cards, tavern, ids, "tavern")).toBeNull();
    expect(gameIdChangePrompt(cards, tavern, ids, "")).toBeNull(); // pinning nothing: still 'tavern'
    expect(gameIdChangePrompt(cards, { id: "scn_cellar", name: "Cellar" }, ids, "pub")).toBeNull();
  });
});

describe("renaming a played scene", () => {
  it("pins the Game ID it had when that follows the name, and says so", () => {
    expect(renamePin(cards, tavern, ids, "The Old Inn")).toEqual({ gameId: "tavern", message: "Kept its Game ID 'tavern' so 2 storylet cards still play it." });
    expect(renamePin(cards, { id: "scn_street", name: "Street" }, ids, "Alley")?.message).toBe("Kept its Game ID 'street' so 1 storylet card still plays it.");
  });

  it("pins nothing when the Game ID is pinned already, the new name keeps it, or no card plays the scene", () => {
    expect(renamePin(cards, { ...tavern, gameId: "tavern" }, ids, "The Old Inn")).toBeNull();
    expect(renamePin(cards, tavern, ids, "TAVERN")).toBeNull();
    expect(renamePin(cards, { id: "scn_cellar", name: "Cellar" }, ids, "Wine Cellar")).toBeNull();
  });
});
