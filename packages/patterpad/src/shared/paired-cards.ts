// The storylet cards that play a scene, in the paired Storylets project (the hands-on fixes review, Q19).
//
// A card plays a scene by its own effective gameId (a pinned gameId, else its title's slug, else its id),
// which Patter's runtime resolves as any scene reference: a scene's internal id first, else a scene's
// address (its pinned gameId, else its name's slug). Main reads the cards (main/paired-cards.ts); main and
// the renderer both match them here, so the delete confirm, the Game ID editor, and a rename agree.

import { gameIdify } from "@patterkit/core";

/** One card in the paired project: what it's called, and the scene reference it plays. */
export interface PairedCard {
  title: string;
  ref: string;
}

/** A scene as the matcher needs it: its id, its name, and its pinned gameId if any. */
export interface SceneRefShape {
  id: string;
  name: string;
  gameId?: string;
}

/** A scene's address: its pinned gameId, else its name's slug (`effectiveGameId`). */
export function sceneAddress(scene: { name: string; gameId?: string }): string {
  const pinned = scene.gameId?.trim();
  return pinned ? pinned : gameIdify(scene.name);
}

/**
 * The titles of the cards that play `scene`, in the order read. `sceneIds` is every scene's id in the
 * project: a reference that IS some scene's id goes to that scene, never to a scene whose address it
 * happens to spell, as Patter's `resolveSceneRef` takes it.
 */
export function cardsPlaying(cards: readonly PairedCard[], scene: SceneRefShape, sceneIds: ReadonlySet<string>): string[] {
  const address = sceneAddress(scene);
  return cards.filter((c) => c.ref === scene.id || (c.ref === address && !sceneIds.has(c.ref))).map((c) => c.title);
}

/** The most card names a sentence lists before it says how many more. */
export const CARD_NAMES_SHOWN = 3;

/**
 * "2 storylet cards play this scene: Tavern Brawl, Last Orders." Past `CARD_NAMES_SHOWN` names, the rest
 * are counted: "5 storylet cards play this scene: A, B, C, and 2 more." Empty for no cards.
 */
export function cardsPlayingSentence(titles: readonly string[]): string {
  if (titles.length === 0) return "";
  const n = titles.length;
  const head = n === 1 ? "1 storylet card plays this scene" : `${n} storylet cards play this scene`;
  const shown = titles.slice(0, CARD_NAMES_SHOWN);
  const more = n - shown.length;
  return `${head}: ${shown.join(", ")}${more > 0 ? `, and ${more} more` : ""}.`;
}

/** "2 storylet cards" / "1 storylet card", for the rename's toast. */
export function storyletCards(n: number): string {
  return n === 1 ? "1 storylet card" : `${n} storylet cards`;
}
