// Play in game: what the running game's answer means, in plain words. The game sends a short reason
// code when it doesn't start the block; any code passes through, and the ones below have words. The
// game's own `detail` (which speaker is busy, which character has no speaker) follows them.

import type { PlayInGameAnswer } from "./api.js";

const REASONS: Record<string, string> = {
  // Patterpad's own.
  noGame: "No game is connected on the Live Link.",
  noAnswer: "The game didn't answer. It may not handle Play in game.",
  invalid: "The game turned the request down.",
  // Any game's.
  unhandled: "The game doesn't handle Play in game.",
  unknownBlock: "The game doesn't have this block.",
  staleBuild: "The game is running an older version of the story. Save, and try again once it has the new one.",
  busy: "Someone in it is already talking. Use Play in game, taking over, to interrupt them.",
  // Patterstage's.
  castMissing: "A character in it has no speaker free in the game.",
  requesterMissing: "The game has no player character to start it with.",
  limit: "The game is already running as many conversations as it allows.",
  takeover: "The game couldn't stop what was playing.",
  alreadyCarriedOn: "The game has already played it, and it plays only once.",
  nothingToSay: "Nothing in the block can be said right now. Check its conditions.",
  notReady: "The game isn't ready to start conversations yet.",
};

/** The toast for a Play in game answer: whether `block` started, and if not, why. */
export function describePlayAnswer(answer: PlayInGameAnswer, block: string): { text: string; ok: boolean } {
  if (answer.started) return { text: `Playing “${block}” in the game.`, ok: true };
  const code = answer.reason ?? "";
  const why = REASONS[code] ?? (code ? `The game said “${code}”.` : "The game didn't say why.");
  const detail = answer.detail ? `\n${answer.detail}` : "";
  return { text: `“${block}” didn't start. ${why}${detail}`, ok: false };
}
