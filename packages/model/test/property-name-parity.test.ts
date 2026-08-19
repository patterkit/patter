// The property-name rules exist TWICE on purpose, exactly as the gameId rules do
// (see id-parity.test.ts for the argument): `@wildwinter/app-shell` ships them as
// the defaults its editors use, and this model ships its own because the compiler,
// the CLI and the embedded runtime resolve state by them and none may depend on a
// UI kit. Storyletter holds the same test against the same shell default, which is
// what makes a property name mean the same thing in both families.
//
// DORMANT UNTIL THE SHELL BUMP. The rules landed in app-shell 0.29.0 and this app
// is on an earlier one, so the parity half cannot run yet. It wakes by itself the
// moment `@wildwinter/app-shell` is bumped - nothing to remember - and until then
// the pending case below fails if anyone bumps the dependency past 0.29.0 without
// the export appearing.
//
// If parity fails: decide which is right, fix that one, and bump the other. Never
// "fix" it by loosening the assertion.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { propertyNameify, isValidPropertyName, RESERVED_PROPERTY_NAMES } from "../src/index.js";

const shell = await import("@wildwinter/app-shell").catch(() => null) as Record<string, unknown> | null;
const shellHasRule = typeof shell?.["propertyNameify"] === "function";

// The canonical tables, identical in all three repos.
const NAMES = ["isNight", "is night", "is-night", "Gareth's Debt", "  gold  ", "gold!!!",
  "9 lives", "not", "TRUE", "_private", "a__b", "", "!!!", "___", "café"];
const IDS = ["gold", "is_night", "_x", "a1", "x_9", "isNight", "is-night", "is night",
  "9lives", "", "_", "true", "and", "Gold", "gold "];

describe.runIf(shellHasRule)("the property-name rules match the shell's defaults", () => {
  it("coerces identically", () => {
    const shellify = shell!["propertyNameify"] as (t: string) => string;
    for (const name of NAMES) {
      expect(propertyNameify(name), `propertyNameify(${JSON.stringify(name)})`).toBe(shellify(name));
    }
  });

  it("validates identically", () => {
    const shellValid = shell!["isValidPropertyName"] as (n: string) => boolean;
    for (const id of IDS) {
      expect(isValidPropertyName(id), `isValidPropertyName(${JSON.stringify(id)})`).toBe(shellValid(id));
    }
  });

  it("reserves the same words", () => {
    expect([...RESERVED_PROPERTY_NAMES]).toEqual([...(shell!["RESERVED_PROPERTY_NAMES"] as string[])]);
  });
});

describe.runIf(!shellHasRule)("parity is pending a shell bump", () => {
  it("is only pending because the installed shell predates 0.29.0", () => {
    // Fails the day someone bumps the dependency and does not get the export, which
    // is the only way this file could go quiet for a bad reason.
    const pkg = fileURLToPath(new URL("../../patterpad/package.json", import.meta.url));
    const range = (JSON.parse(readFileSync(pkg, "utf8")) as { dependencies: Record<string, string> })
      .dependencies["@wildwinter/app-shell"];
    expect(range, "app-shell dependency range").toMatch(/^\^0\.(1\d|2[0-8])\./);
  });

  it("still holds this app's own copy to the table", () => {
    // Parity is asleep; the rule is not. These are the shell's expected outputs.
    expect(NAMES.map(propertyNameify)).toEqual(["isnight", "is_night", "is_night", "gareths_debt",
      "gold", "gold", "_9_lives", "not_", "true_", "_private", "a_b", "", "", "", "caf"]);
    expect(IDS.map(isValidPropertyName)).toEqual([true, true, true, true, true, false, false, false,
      false, false, true, false, false, false, false]);
  });
});
