// The renderer spell-check engine builder (#177): build nspell from the VENDORED en-GB Hunspell pair
// (resources/dictionaries) and confirm checking, dialect spelling, suggestions, and the extra-words set
// (project dictionary + cast names) all work. Node test - nspell runs server-side just as in the renderer.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSpellEngine } from "./src/spellcheck.js";

const dictDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../resources/dictionaries");
const read = (lang: string): { aff: string; dic: string } => ({
  aff: readFileSync(resolve(dictDir, lang, "index.aff"), "utf8"),
  dic: readFileSync(resolve(dictDir, lang, "index.dic"), "utf8"),
});

describe("spell-check engine (#177)", () => {
  it("checks words against the en-GB dictionary, with UK spelling", () => {
    const { aff, dic } = read("en-GB");
    const sp = buildSpellEngine(aff, dic);
    expect(sp.check("tavern")).toBe(true);
    expect(sp.check("teh")).toBe(false);
    expect(sp.check("colour")).toBe(true);  // UK
    expect(sp.check("color")).toBe(false);  // US spelling is wrong in en-GB
  });

  it("checks US spelling against the en-US dictionary", () => {
    const { aff, dic } = read("en-US");
    const sp = buildSpellEngine(aff, dic);
    expect(sp.check("color")).toBe(true);   // US
    expect(sp.check("colour")).toBe(false);
  });

  it("suggests corrections for a misspelling (capped)", () => {
    const { aff, dic } = read("en-GB");
    const sp = buildSpellEngine(aff, dic);
    expect(sp.suggest("recieve")).toContain("receive");
    expect(sp.suggest("recieve").length).toBeLessThanOrEqual(7);
  });

  it("tolerates curly apostrophes in contractions and possessives", () => {
    const { aff, dic } = read("en-GB");
    const sp = buildSpellEngine(aff, dic, ["Eldoria"]);
    expect(sp.check("don’t")).toBe(true);      // curly apostrophe, contraction is in the dict
    expect(sp.check("What’ll")).toBe(true);    // not in dict, but stem "What" is a word
    expect(sp.check("Eldoria’s")).toBe(true);  // possessive of a cast/project name
    expect(sp.check("teh’s")).toBe(false);     // misspelled stem still flags
  });

  it("accepts extra words (project dictionary + cast names) as correct", () => {
    const { aff, dic } = read("en-GB");
    const sp = buildSpellEngine(aff, dic, ["Patterpad", "Eldoria"]);
    expect(sp.check("Patterpad")).toBe(true); // would be wrong without the extra word
    expect(sp.check("Eldoria")).toBe(true);
    expect(sp.check("Xyzzy")).toBe(false);    // a word NOT added is still flagged
  });
});
