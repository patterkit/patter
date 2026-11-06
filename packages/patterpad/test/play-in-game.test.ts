// Play in game's answers in plain words: a start names the block, a known reason has its sentence and the
// game's detail after it, and an unknown reason still says what the game sent.

import { describe, it, expect } from "vitest";
import { describePlayAnswer } from "../src/shared/play-in-game.js";

describe("the words for a Play in game answer", () => {
  it("names the block that started", () => {
    expect(describePlayAnswer({ started: true }, "Greeting")).toEqual({ text: "Playing “Greeting” in the game.", ok: true });
  });

  it("gives a known reason its sentence, then the game's detail", () => {
    const { text, ok } = describePlayAnswer({ started: false, reason: "castMissing", detail: "No speaker for Mara." }, "Greeting");
    expect(ok).toBe(false);
    expect(text).toBe("“Greeting” didn't start. A character in it has no speaker free in the game.\nNo speaker for Mara.");
  });

  it("says the asking speaker isn't in the game, with the game's detail naming them", () => {
    expect(describePlayAnswer({ started: false, reason: "requesterMissing", detail: "guard-1 isn't registered" }, "Bark").text)
      .toBe("“Bark” didn't start. The speaker that asks for it isn't in the game yet.\nguard-1 isn't registered");
  });

  it("passes an unknown reason through as the game sent it", () => {
    expect(describePlayAnswer({ started: false, reason: "dragonsAsleep" }, "Greeting").text)
      .toBe("“Greeting” didn't start. The game said “dragonsAsleep”.");
  });
});
