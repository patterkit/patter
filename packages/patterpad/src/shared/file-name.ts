// A name made safe to be a file or folder name: the one rule for every name Patterpad suggests on disk
// (an export's filename, New Project's folder), in main and in the renderer's preview of it alike.

import { gameIdify } from "@patterkit/core";

/** `name` with the characters Windows or macOS forbid in a filename (`/ \ : * ? " < > |`) turned into
 *  single spaces, trimmed. A ':' matters on both: Windows refuses it, and macOS Finder shows it as '/'. */
export function fileSafeName(name: string): string {
  return name.replace(/[/\\:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
}

/** The name New Scene gives a scene: "Untitled scene", or "Untitled scene 2", "Untitled scene 3", ... when
 *  that's taken (by its Game ID, so "untitled scene" counts as taken too), as Storyletter numbers a new
 *  card or deck. */
export const UNTITLED_SCENE = "Untitled scene";
export function untitledSceneName(taken: readonly string[]): string {
  const used = new Set(taken.map(gameIdify));
  let name = UNTITLED_SCENE;
  for (let n = 2; used.has(gameIdify(name)); n++) name = `${UNTITLED_SCENE} ${n}`;
  return name;
}
