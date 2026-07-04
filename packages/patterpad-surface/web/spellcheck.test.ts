// The inline spell-check squiggle logic (#177): build a doc with a say zone and confirm `misspellings`
// flags exactly the wrong words (with correct ranges) and honours the ignore set. A fake checker stands in
// for nspell so the test is fast and deterministic.

import { describe, it, expect } from "vitest";
import type { Scene } from "@patterkit/model";
import { sceneToDoc } from "../src/bridge.js";
import { misspellings, spellingIssuesIn } from "./spellcheck.js";

// "teh" and "wuld" are wrong; everything else is "correct".
const checker = { check: (w: string) => !["teh", "wuld"].includes(w.toLowerCase()), suggest: () => ["the"] };

function docWith(text: string): ReturnType<typeof sceneToDoc> {
  const scene: Scene = {
    id: "s", type: "scene", name: "S", blocks: [
      { id: "b1", type: "block", name: "M", children: [{ id: "sn1", type: "snippet", beats: [{ id: "T1", kind: "text" }] }] },
    ],
  };
  return sceneToDoc(scene, { T1: text });
}

describe("spell-check squiggle ranges (#177)", () => {
  it("flags only the misspelled words in the say zone", () => {
    const hits = misspellings(docWith("the teh tavern wuld end"), checker, new Set());
    expect(hits.map((h) => h.word)).toEqual(["teh", "wuld"]);
  });

  it("each range slices back to exactly the flagged word", () => {
    const doc = docWith("a teh here");
    const [hit] = misspellings(doc, checker, new Set());
    expect(doc.textBetween(hit!.from, hit!.to)).toBe("teh");
  });

  it("honours the ignore set (a session 'Ignore')", () => {
    expect(misspellings(docWith("teh wuld"), checker, new Set(["teh"])).map((h) => h.word)).toEqual(["wuld"]);
  });

  it("flags nothing when every word is correct", () => {
    expect(misspellings(docWith("the tavern is dim"), checker, new Set())).toHaveLength(0);
  });

  it("maps each misspelling to its enclosing beat id (for the problems panel, #177)", () => {
    expect(spellingIssuesIn(docWith("the teh wuld end"), checker, new Set())).toEqual([
      { nodeId: "T1", word: "teh" },
      { nodeId: "T1", word: "wuld" },
    ]);
  });
});
