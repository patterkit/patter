// Closed-caption stripping (#214): the shared text transform every Patterplay runtime applies when a
// game disables captions. This locks the JS reference behaviour the conformance corpus holds the native
// ports to.

import { describe, it, expect } from "vitest";
import { stripCaptions } from "../src/index.js";

const strip = (t: string, open = "(", close = ")") => stripCaptions(t, open, close);

describe("stripCaptions", () => {
  it("removes a mid-line cue and collapses the surrounding whitespace", () => {
    expect(strip("Oh dear. (sigh) What now?")).toBe("Oh dear. What now?");
  });

  it("trims when the cue is at the start or end", () => {
    expect(strip("(whispering) Hello there")).toBe("Hello there");
    expect(strip("Hello there (waves)")).toBe("Hello there");
  });

  it("removes multiple cues in one line", () => {
    expect(strip("A (x) B (y) C")).toBe("A B C");
    expect(strip("(a)(b)done")).toBe("done");
  });

  it("leaves a string with no cue completely untouched (whitespace preserved)", () => {
    expect(strip("Two  spaces\tand\na tab")).toBe("Two  spaces\tand\na tab");
    expect(strip("plain line")).toBe("plain line");
  });

  it("supports a same-token delimiter pair", () => {
    expect(strip("Heavy *sigh* breathing", "*", "*")).toBe("Heavy breathing");
  });

  it("supports multi-character delimiters", () => {
    expect(strip("Wait [[aside]] for it", "[[", "]]")).toBe("Wait for it");
  });

  it("keeps the remainder verbatim when a cue is never closed", () => {
    expect(strip("Hello (unclosed cue")).toBe("Hello (unclosed cue");
  });

  it("is a no-op when the open delimiter is empty (feature off)", () => {
    expect(strip("Oh dear. (sigh) What now?", "", ")")).toBe("Oh dear. (sigh) What now?");
  });

  it("collapses internal whitespace runs only once a cue was removed", () => {
    expect(strip("a (cue)   b")).toBe("a b");
  });
});
