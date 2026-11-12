import { describe, it, expect } from "vitest";
import { PLACEHOLDER_ACCENTS, PLACEHOLDER_HD_ACCENTS, placeholderVoiceTier, accentForLanguage, defaultPlaceholderVoice, describePlaceholderVoice, placeholderAccent } from "../src/index.js";

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
    expect(accentForLanguage("en")).toBe("en-GB");   // the first English on offer
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

  it("offers HD lists of their own: the same accents, 30 Chirp 3 HD voices each, frozen in Google's order", () => {
    expect(PLACEHOLDER_HD_ACCENTS.map((a) => a.code)).toEqual(PLACEHOLDER_ACCENTS.map((a) => a.code));
    for (const a of PLACEHOLDER_HD_ACCENTS) {
      expect(a.voices.length).toBe(30);
      expect(a.voices.filter((x) => x.gender === "female").length).toBe(14);
      for (const x of a.voices) expect(x.name).toMatch(new RegExp(`^${a.code}-Chirp3-HD-[A-Z][a-z]+$`));
    }
    const gb = placeholderAccent("en-GB", "hd")!.voices;
    expect([gb[0]!.name, gb[5]!.name, gb[29]!.name]).toEqual(["en-GB-Chirp3-HD-Achernar", "en-GB-Chirp3-HD-Aoede", "en-GB-Chirp3-HD-Zubenelgenubi"]);
    // The Standard lists are untouched by HD, and remain the default.
    expect(placeholderAccent("en-GB")!.voices.map((v) => v.name.slice(-1)).join("")).toBe("ABCDF");
  });

  it("picks an HD default from the HD list, by the same hash and gender rule", () => {
    for (const n of ["TAM", "ANNA", "Hale", "Radio Host"]) {
      const hd = defaultPlaceholderVoice(n, "en-GB", undefined, "hd")!;
      expect(placeholderVoiceTier(hd)).toBe("hd");
      expect(defaultPlaceholderVoice(n, "en-GB", undefined, "standard")).toBe(defaultPlaceholderVoice(n, "en-GB"));
      expect(placeholderAccent("en-GB", "hd")!.voices.find((v) => v.name === defaultPlaceholderVoice(n, "en-GB", "male", "hd"))!.gender).toBe("male");
    }
  });

  it("knows a voice's tier from its name, and says an HD voice by its own name", () => {
    expect(placeholderVoiceTier("en-GB-Standard-A")).toBe("standard");
    expect(placeholderVoiceTier("sv-SE-Chirp3-HD-Kore")).toBe("hd");
    expect(placeholderVoiceTier("en-GB-Wavenet-A")).toBeUndefined();
    expect(describePlaceholderVoice("en-GB-Chirp3-HD-Kore")).toBe("Female, English (British) HD: Kore");
    expect(describePlaceholderVoice("en-GB-Chirp3-HD-Charon")).toBe("Male, English (British) HD: Charon");
  });
});
