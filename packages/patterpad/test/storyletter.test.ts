// Show Card in Storyletter: finding the Storyletter project that pairs with a Patter project (it
// names this one in its project file's `patter`), in the two usual layouts, and nothing when none
// does; and finding Storyletter itself, with the platform passed in so no install is needed.

import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findPairedStorylets, findStoryletter, storyletterExecutable } from "../src/main/storyletter.js";

/** Temp folders made here, removed after each test so they do not pile up in the system temp folder. */
const made: string[] = [];
function tempRoot(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A Storyletter project at `dir` whose `patter` is `link`. */
function storylets(dir: string, link: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "game.storyletproj"), `{\n  patter: "${link}",\n}\n`);
}

describe("findPairedStorylets", () => {
  it("finds the Storyletter project beside this one that names it", () => {
    const root = tempRoot("pair-");
    mkdirSync(join(root, "the-hamlet.patter"));
    storylets(join(root, "the-hamlet.storylets"), "../the-hamlet.patter");
    expect(findPairedStorylets(join(root, "the-hamlet.patter"))).toBe(join(root, "the-hamlet.storylets"));
  });

  it("finds one under a sibling folder of the game's root", () => {
    const root = tempRoot("pair-");
    mkdirSync(join(root, "story", "village.patter"), { recursive: true });
    storylets(join(root, "cards", "village.storylets"), "../../story/village.patter");
    expect(findPairedStorylets(join(root, "story", "village.patter"))).toBe(join(root, "cards", "village.storylets"));
  });

  it("ignores a Storyletter project paired with a different Patter project, and finds none", () => {
    const root = tempRoot("pair-");
    mkdirSync(join(root, "mine.patter"));
    storylets(join(root, "theirs.storylets"), "../theirs.patter");
    expect(findPairedStorylets(join(root, "mine.patter"))).toBeUndefined();
  });
});

describe("findStoryletter", () => {
  it("runs the executable inside a macOS app bundle", () => {
    expect(storyletterExecutable("/Applications/Storyletter.app", "darwin")).toBe("/Applications/Storyletter.app/Contents/MacOS/Storyletter");
  });

  it("takes the place the author pointed at, and on Linux nothing else", async () => {
    const dir = tempRoot("storyletter-");
    const image = join(dir, "Storyletter.AppImage");
    writeFileSync(image, "");
    expect(await findStoryletter(image, "linux")).toBe(image);
    expect(await findStoryletter(undefined, "linux")).toBeUndefined();
  });
});
