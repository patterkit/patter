import { describe, it, expect } from "vitest";
import { PLACEHOLDER_ACCENTS, accentForLanguage, defaultPlaceholderVoice, describePlaceholderVoice, placeholderAccent } from "../src/index.js";

describe("Placeholder Speech voices", () => {
  it("offers Standard voices only, each named for its own accent", () => {
    for (const a of PLACEHOLDER_ACCENTS) for (const v of a.voices) {
      expect(v.name).toMatch(/-Standard-[A-Z]$/);
      expect(v.name.startsWith(a.code + "-")).toBe(true);
    }
  });

  it("keeps the frozen lists as shipped", () => {
    // Changing a list changes defaults and remakes speech in every project: a new accent gets a new list.
    expect(placeholderAccent("en-GB")!.voices.map((v) => v.name.slice(-1)).join("")).toBe("ABCDF");
    expect(placeholderAccent("en-US")!.voices.length).toBe(10);
  });

  it("finds the accent from the main language, and asks when the language has several", () => {
    expect(accentForLanguage("en-GB")).toBe("en-GB");
    expect(accentForLanguage("en_us")).toBe("en-US");
    expect(accentForLanguage("en")).toBeUndefined();
    expect(accentForLanguage("sv")).toBe("sv-SE");
    expect(accentForLanguage("xx")).toBeUndefined();
  });

  it("gives a name the same voice every time, and moves it only when a gender disagrees", () => {
    const names = ["BARKEEP", "TAM", "GUIDE", "ANNA", "OLD MAN", "CAPTAIN"];
    for (const n of names) {
      const plain = defaultPlaceholderVoice(n, "en-GB")!;
      expect(defaultPlaceholderVoice(n, "en-GB")).toBe(plain);
      const g = placeholderAccent("en-GB")!.voices.find((v) => v.name === plain)!.gender;
      expect(defaultPlaceholderVoice(n, "en-GB", g.toUpperCase())).toBe(plain); // already fits, any case
      const other = g === "male" ? "female" : "male";
      const moved = defaultPlaceholderVoice(n, "en-GB", other)!;
      expect(placeholderAccent("en-GB")!.voices.find((v) => v.name === moved)!.gender).toBe(other);
      expect(defaultPlaceholderVoice(n, "en-GB", "neuter")).toBe(plain);
    }
    expect(defaultPlaceholderVoice("X", "xx-XX")).toBeUndefined();
  });

  it("says a voice in words", () => {
    expect(describePlaceholderVoice("en-GB-Standard-B")).toBe("Male, English (British) 1");
    expect(describePlaceholderVoice("en-GB-Standard-F")).toBe("Female, English (British) 3");
    expect(describePlaceholderVoice("en-GB-Wavenet-A")).toBe("en-GB-Wavenet-A");
  });
});
