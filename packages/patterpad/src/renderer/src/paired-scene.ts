// What a change to a scene means for the storylet cards that play it (the hands-on fixes review, Q19).
//
// A storylet card in the paired Storylets project plays a scene by its address (its Game ID, pinned or
// following its name). Three changes can leave cards without their scene, and each is caught here:
//
//   - deleting the scene asks first, naming the cards (an unpaired scene still deletes at once, with Undo);
//   - changing its Game ID in the Game ID editor asks first, the same way;
//   - renaming it while its Game ID follows the name pins the Game ID it had, in the same edit as the
//     rename, and says so with Undo.
//
// The words live here, and the decisions, so they can be tested without the app.

import { gameIdify } from "@patterkit/core";
import type { AppPrompt } from "../../shared/api.js";
import { cardsPlaying, cardsPlayingSentence, sceneAddress, storyletCards, type PairedCard, type SceneRefShape } from "../../shared/paired-cards.js";

/** The delete confirm for a scene cards play, or null when none do (it deletes at once, with Undo). */
export function deletePlayedScenePrompt(sceneName: string, cards: readonly string[]): AppPrompt | null {
  if (cards.length === 0) return null;
  return {
    title: `Delete “${sceneName}”?`,
    sub: cardsPlayingSentence(cards),
    body: [`They'll have no scene to play once it's gone.`],
    buttons: ["Cancel", "Delete Scene"], defaultId: 0, cancelId: 0,
  };
}

/** The Game ID editor's question before `next` replaces the scene's Game ID ("" lets it follow the name),
 *  or null when no card plays the scene or its address doesn't change. */
export function gameIdChangePrompt(cards: readonly PairedCard[], scene: SceneRefShape, sceneIds: ReadonlySet<string>, next: string): AppPrompt | null {
  const before = sceneAddress(scene);
  const after = next.trim() || gameIdify(scene.name);
  if (after === before) return null;
  const playing = cardsPlaying(cards, scene, sceneIds);
  if (playing.length === 0) return null;
  return {
    title: "Change the Game ID?",
    sub: cardsPlayingSentence(playing),
    body: [`They find it by its Game ID '${before}'. Once it's '${after}', they won't.`],
    buttons: ["Cancel", "Change Game ID"], defaultId: 0, cancelId: 0,
  };
}

/** What a rename to `next` pins: the scene's current Game ID and the toast saying so, when cards play the
 *  scene and its Game ID follows its name and would move; otherwise null (a plain rename). */
export function renamePin(cards: readonly PairedCard[], scene: SceneRefShape, sceneIds: ReadonlySet<string>, next: string): { gameId: string; message: string } | null {
  if (scene.gameId?.trim()) return null; // pinned already: the rename can't move it
  const gameId = sceneAddress(scene);
  if (gameIdify(next) === gameId) return null; // the new name has the same Game ID
  const playing = cardsPlaying(cards, scene, sceneIds);
  if (playing.length === 0) return null;
  return { gameId, message: `Kept its Game ID '${gameId}' so ${storyletCards(playing.length)} still play${playing.length === 1 ? "s" : ""} it.` };
}
