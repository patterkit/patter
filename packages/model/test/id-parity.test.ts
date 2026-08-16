// The gameId rules exist TWICE on purpose, and this asserts the two stay equal.
//
// `@wildwinter/app-shell` ships `gameIdify` / `isValidGameId` as the defaults its
// editor uses, because a UI kit cannot ask an app for them before an app exists.
// This model ships its own, because the compiler, the CLI and the JS runtime that
// gets embedded in game engines all address content by these rules, and none of
// them may carry a dependency on a UI kit to do it.
//
// That is a deliberate duplication, and shared-shell.md states the rule it comes
// from: the shell may own a rule outright when only UI touches it, and owns the
// DEFAULT plus a parity test when the domain touches it too. Two copies drift, so
// this is the thing that notices. Storyletter holds the same test against the same
// shell default, which is what makes the two apps' addresses interchangeable.
//
// If this fails: decide which is right, fix that one, and bump the other. Never
// "fix" it by loosening the assertion.
import { describe, expect, it } from "vitest";
import { gameIdify as shellSlugify, isValidGameId as shellValid } from "@wildwinter/app-shell";
import { gameIdify, isValidGameId } from "../src/index.js";

// Names that have actually caused trouble: apostrophes, punctuation runs, accents,
// leading and trailing junk, and the empty case.
const NAMES = [
  "The Tavern", "Barkeep's Line", "A  double  space", "Trailing-", "-Leading",
  "Mixed CASE 42", "punctuation!?, everywhere", "", "---", "already-a-game-id",
  "Ian's Café", "one_two_three", "9 lives", "tab\tseparated", "new\nline",
];

const IDS = [
  "the-tavern", "a", "a-b-c", "9-lives", "", "-leading", "trailing-", "a--b",
  "Upper", "has space", "has_underscore", "1", "a1-b2",
];

describe("the gameId rules match the shell's defaults", () => {
  it("slugifies identically", () => {
    for (const name of NAMES) {
      expect(gameIdify(name), `gameIdify(${JSON.stringify(name)})`).toBe(shellSlugify(name));
    }
  });

  it("validates identically", () => {
    for (const id of IDS) {
      expect(isValidGameId(id), `isValidGameId(${JSON.stringify(id)})`).toBe(shellValid(id));
    }
  });

  it("agrees that a slugified name is a valid id", () => {
    // The property that actually matters at a call site: the editor offers Tab to
    // slugify, and what comes back has to be something the validator accepts, or
    // the button it enables would refuse its own suggestion.
    for (const name of NAMES) {
      const slug = gameIdify(name);
      if (slug === "") continue; // nothing left to pin: the editor treats "" as "derive one"
      expect(isValidGameId(slug), `slug of ${JSON.stringify(name)} -> ${JSON.stringify(slug)}`).toBe(true);
    }
  });
});
