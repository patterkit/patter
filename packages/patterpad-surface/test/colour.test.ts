import { describe, it, expect } from "vitest";
import { colourFor, colourIndex, PALETTE } from "../src/colour.js";

describe("character colour (hash -> curated palette index)", () => {
  it("is stable / repeatable for a name", () => {
    expect(colourFor("ANNA")).toBe(colourFor("ANNA"));
  });
  it("is always one of the curated palette colours", () => {
    for (const name of ["ANNA", "BO", "narrator", "DR. KANE", "x"]) {
      expect(PALETTE).toContain(colourFor(name));
      expect(colourIndex(name)).toBeLessThan(PALETTE.length);
    }
  });
});
