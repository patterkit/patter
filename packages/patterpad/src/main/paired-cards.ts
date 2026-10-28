// The paired Storylets project's cards (the hands-on fixes review, Q19).
//
// Patterpad warns before a change that would leave a storylet card without its scene: deleting a scene
// cards play, editing its Game ID, renaming it while its Game ID follows the name. So it reads the paired
// project's decks (`**/decks/*.storyletdeck`, Storylets' deck shards: `{ deck, cards }`) and keeps each
// card's title and the scene reference it plays: its effective gameId, as Storylets works it out (a pinned
// gameId, else its title's slug, else its id).
//
// Read when a project opens and again whenever the window regains focus (Storyletter may have changed the
// cards meanwhile). A refresh lists the deck folders again but re-reads only the files whose size or
// modification time moved, so it stays cheap. Nothing here writes to the Storylets project.

import { type Dirent, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { gameIdify, parseSource } from "@patterkit/core";
import type { PairedCard } from "../shared/paired-cards.js";

/** Storylets' deck shard extension (storylets packages/model, `SHARD_EXTENSIONS.deck`). */
export const DECK_EXTENSION = ".storyletdeck";

/** The most folders one walk reads: a Storylets project is small, and a stray link mustn't start a crawl. */
const FOLDER_BUDGET = 2000;

interface CachedDeck { mtimeMs: number; size: number; cards: PairedCard[] }

let root: string | undefined;
let decks = new Map<string, CachedDeck>();
let cards: PairedCard[] = [];

/** A card's scene reference, as Storylets' `effectiveGameId` gives it: pinned, else the title's slug, else
 *  the id. Patter's own `gameIdify` for now; the two families' copies are the same rule. */
function cardRef(card: { id?: unknown; gameId?: unknown; title?: unknown }): string {
  const pinned = typeof card.gameId === "string" ? card.gameId.trim() : "";
  if (pinned) return pinned;
  const fromTitle = typeof card.title === "string" ? gameIdify(card.title) : "";
  return fromTitle || (typeof card.id === "string" ? card.id : "");
}

/** The cards a deck shard's text holds. A shard that won't parse holds none (Storyletter will say why). */
export function readDeckCards(text: string): PairedCard[] {
  let shard: unknown;
  try { shard = parseSource(text); } catch { return []; }
  const list = (shard as { cards?: unknown }).cards;
  if (!Array.isArray(list)) return [];
  const out: PairedCard[] = [];
  for (const c of list) {
    if (!c || typeof c !== "object") continue;
    const card = c as { id?: unknown; gameId?: unknown; title?: unknown };
    const ref = cardRef(card);
    if (!ref) continue;
    const title = typeof card.title === "string" && card.title.trim() ? card.title.trim() : ref;
    out.push({ title, ref });
  }
  return out;
}

/** Every deck shard under `dir`: a `.storyletdeck` in a folder called `decks`, anywhere below. */
export function findDeckFiles(dir: string): string[] {
  const found: string[] = [];
  let budget = FOLDER_BUDGET;
  const walk = (at: string): void => {
    if (--budget < 0) return;
    let entries: Dirent[];
    try { entries = readdirSync(at, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const full = join(at, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && e.name.endsWith(DECK_EXTENSION) && basename(dirname(full)) === "decks") found.push(full);
    }
  };
  walk(dir);
  return found.sort();
}

/** Pair with the Storylets project at `dir` (or none), and read its cards. */
export function setPairedStorylets(dir: string | undefined): void {
  if (dir !== root) { root = dir; decks = new Map(); cards = []; }
  refreshPairedCards();
}

/** Read the paired project's cards again: only the deck files whose size or time moved are re-read. */
export function refreshPairedCards(): readonly PairedCard[] {
  if (!root) { cards = []; return cards; }
  const next = new Map<string, CachedDeck>();
  for (const path of findDeckFiles(root)) {
    let st: { mtimeMs: number; size: number };
    try { st = statSync(path); } catch { continue; }
    const had = decks.get(path);
    if (had && had.mtimeMs === st.mtimeMs && had.size === st.size) { next.set(path, had); continue; }
    let text: string;
    try { text = readFileSync(path, "utf8"); } catch { continue; }
    next.set(path, { mtimeMs: st.mtimeMs, size: st.size, cards: readDeckCards(text) });
  }
  decks = next;
  cards = [...next.values()].flatMap((d) => d.cards);
  return cards;
}

/** The cards read last (no refresh). */
export function pairedCards(): readonly PairedCard[] {
  return cards;
}

/** The paired Storylets project, if any. */
export function pairedStoryletsRoot(): string | undefined {
  return root;
}
