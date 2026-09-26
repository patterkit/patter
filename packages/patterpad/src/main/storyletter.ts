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
// Storyletter takes `storyletter <project> --at <gameId>` and forwards a second
// launch to the running app, which opens the card whose gameId is the scene's
// address. So this starts the executable directly, never `open -a` on macOS: a
// cold `open` delivers the project through open-file and drops `--at`.
// ---------------------------------------------------------------------------

import { execFileSync, spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseSource } from "@patterkit/core";

/** Storyletter's appId (storylets packages/studio/package.json, `build.appId`). */
export const STORYLETTER_BUNDLE_ID = "studio.storylet.storyletter";

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
  let budget = 400;   // folders read, at most: the search is a convenience, never a crawl
  const search = (dir: string, depth: number): string | undefined => {
    if (--budget < 0) return undefined;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return undefined; }
    for (const name of entries) {
      if (name.startsWith(".") || name === "node_modules") continue;
      const full = join(dir, name);
      try { if (!statSync(full).isDirectory()) continue; } catch { continue; }
      if (name.endsWith(".storylets") && pointsHere(full)) return full;
      if (depth > 0 && !name.endsWith(".storylets") && !name.endsWith(".patter")) {
        const hit = search(full, depth - 1);
        if (hit) return hit;
      }
    }
    return undefined;
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

/** The executable inside a macOS app bundle, or the path itself for anything else. */
export function storyletterExecutable(path: string, platform: NodeJS.Platform = process.platform): string {
  return platform === "darwin" && path.endsWith(".app") ? join(path, "Contents", "MacOS", "Storyletter") : path;
}

/** Where Storyletter is on this machine, or undefined. `remembered` is the author's own answer. */
export function findStoryletter(remembered?: string, platform: NodeJS.Platform = process.platform): string | undefined {
  const candidates: string[] = [];
  if (remembered) candidates.push(storyletterExecutable(remembered, platform));
  if (platform === "darwin") {
    try {
      const found = execFileSync("mdfind", [`kMDItemCFBundleIdentifier == '${STORYLETTER_BUNDLE_ID}'`], { encoding: "utf8", timeout: 3000 });
      for (const app of found.split("\n").map((l) => l.trim()).filter((l) => l.endsWith(".app"))) candidates.push(storyletterExecutable(app, platform));
    } catch { /* Spotlight off or slow: the fixed places below still count */ }
    candidates.push(
      storyletterExecutable("/Applications/Storyletter.app", platform),
      storyletterExecutable(join(homedir(), "Applications", "Storyletter.app"), platform),
    );
  } else if (platform === "win32") {
    const local = process.env["LOCALAPPDATA"];
    if (local) candidates.push(join(local, "Programs", "Storyletter", "Storyletter.exe"));
  }
  return candidates.find((c) => existsSync(c));
}

/** Start Storyletter on `project`, at the card named `address`. Detached: it outlives Patterpad. */
export function launchStoryletter(executable: string, project: string, address: string): void {
  spawn(executable, [project, "--at", address], { detached: true, stdio: "ignore" }).unref();
}
