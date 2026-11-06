// ---------------------------------------------------------------------------
// Show Card in Storyletter: the other half of Storyletter's Edit Scene in
// Patterpad. A Storyletter project paired with this one names it in its
// project file (`patter`, a path relative to that file), so this looks NEARBY
// for such a project rather than keeping a Storylets setting in Patter's own
// format: in this project's parent and grandparent folders, looking one folder
// down, which covers the two usual layouts (the two projects side by side, or
// under sibling folders of a game's root). Bounded, since a project near the
// top of a big tree would otherwise start a search of the whole disk.
//
// Finding Storyletter and starting it at the card is the family's, in
// app-shell's sibling-app (Storyletter opens Patterpad the same way).
// ---------------------------------------------------------------------------

import { type Dir, type Dirent, opendirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseSource } from "@patterkit/core";

/** The Storyletter project paired with the Patter project at `patterRoot`, or undefined. */
export function findPairedStorylets(patterRoot: string): string | undefined {
  const target = resolve(patterRoot);
  const pointsHere = (dir: string): boolean => {
    let names: string[];
    try { names = readdirSync(dir); } catch { return false; }
    const file = names.find((n) => n.endsWith(".storyletproj"));
    if (!file) return false;
    try {
      const project = parseSource(readFileSync(join(dir, file), "utf8")) as { patter?: unknown };
      return typeof project.patter === "string" && resolve(dir, project.patter) === target;
    } catch { return false; }
  };
  // The search is a convenience, never a crawl: at most this many folders read and entries looked
  // at. Entries count too, since one huge folder (a system temp folder holds tens of thousands) is
  // a single read, and a miss would otherwise look at all of it.
  let folders = 400;
  let looks = 5000;
  const search = (dir: string, depth: number): string | undefined => {
    if (--folders < 0 || looks <= 0) return undefined;
    let handle: Dir;
    try { handle = opendirSync(dir); } catch { return undefined; }
    try {
      // Streamed, not readdirSync: a huge folder is left part-read once the budget runs out
      for (let entry: Dirent | null; (entry = readEntry(handle)) !== null;) {
        if (--looks < 0) return undefined;
        const name = entry.name;
        if (name.startsWith(".") || name === "node_modules") continue;
        const full = join(dir, name);
        if (entry.isSymbolicLink()) {
          try { if (!statSync(full).isDirectory()) continue; } catch { continue; }
        } else if (!entry.isDirectory()) continue;
        if (name.endsWith(".storylets") && pointsHere(full)) return full;
        if (depth > 0 && !name.endsWith(".storylets") && !name.endsWith(".patter")) {
          const hit = search(full, depth - 1);
          if (hit) return hit;
        }
      }
      return undefined;
    } finally {
      handle.closeSync();
    }
  };
  let base = dirname(target);
  for (let up = 0; up < 2; up++) {
    const hit = search(base, 1);
    if (hit) return hit;
    const parent = dirname(base);
    if (parent === base) break;
    base = parent;
  }
  return undefined;
}

/** The next entry of an open folder, or null at its end or on a read error. */
function readEntry(handle: Dir): Dirent | null {
  try { return handle.readSync(); } catch { return null; }
}
