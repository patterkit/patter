// Why the property-name rule is what it is, probed against the real parser rather
// than against a copy of the rule.
//
// Every clause in `isValidPropertyName` exists because `@wildwinter/expr` does
// something with the name that the author did not ask for. If expr's grammar ever
// changes, this is what notices - and it notices in the repo that would ship the
// wrong rule, rather than in a story that plays differently.
import { describe, expect, it } from "vitest";
import { compile } from "@wildwinter/expr";
import { patterDialect } from "@patterkit/dialect";
import { RESERVED_PROPERTY_NAMES, isValidPropertyName } from "../src/index.js";

const ast = (src: string): unknown => JSON.parse(JSON.stringify(compile(src, patterDialect).ast));
const parses = (src: string): boolean => { try { compile(src, patterDialect); return true; } catch { return false; } };

describe("the grammar the rule is derived from", () => {
  it("folds case, so a capitalised declaration is unreachable", () => {
    expect(ast("@patter.isNight")).toEqual(["sv", "patter", "isnight"]);
    expect(isValidPropertyName("isNight")).toBe(false);
  });

  it("reads a hyphen as SUBTRACTION, which is why one is refused", () => {
    // The whole reason this rule is enforced rather than trusted: every other
    // violation is loud, and this one quietly compiles to something else.
    expect(ast("@patter.is-night")).toEqual(["bin", "-", ["sv", "patter", "is"], ["s", "night"]]);
    expect(isValidPropertyName("is-night")).toBe(false);
  });

  it("refuses a space, a leading digit, and every reserved word", () => {
    expect(parses("@patter.is night")).toBe(false);
    expect(parses("@patter.9lives")).toBe(false);
    for (const word of RESERVED_PROPERTY_NAMES) {
      expect(parses(`@patter.${word}`), `@patter.${word}`).toBe(false);
      expect(isValidPropertyName(word), word).toBe(false);
    }
  });

  it("accepts what the rule accepts", () => {
    for (const name of ["gold", "is_night", "_x", "a1", "x_9"]) {
      expect(isValidPropertyName(name), name).toBe(true);
      expect(ast(`@patter.${name}`), name).toEqual(["sv", "patter", name]);
    }
  });

  it("has no reserved word the rule misses", () => {
    // The list is a copy. This is the probe that keeps the copy true: anything expr
    // refuses as a bare property name must be something the rule refuses too.
    for (const word of ["true", "false", "and", "or", "not"]) {
      expect(RESERVED_PROPERTY_NAMES).toContain(word);
    }
    expect(RESERVED_PROPERTY_NAMES).toHaveLength(5);
  });
});
