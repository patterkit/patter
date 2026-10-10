// The playable page's timing (src/play-timeline.ts): the player rules of line padding on one table of
// cases (shared with Patterpad's Play window, play-timeline.cases.ts), and a clock whose speed can change
// mid-run without re-timing what has already played.

import { describe, it, expect } from "vitest";
import { createTimeline, createClock } from "../src/play-timeline.js";
import { TIMELINE_CASES } from "./play-timeline.cases.js";

describe("the playable page's timeline", () => {
  it.each(TIMELINE_CASES)("$name", ({ beats, starts, choicesAt, end }) => {
    const tl = createTimeline(0.6);
    const got: number[] = [];
    for (const b of beats) {
      if (b.kind === "gameEvent") continue; // the page skips an event: it's done at once
      got.push(tl.place(b, b.duration).start);
    }
    expect(got.length).toBe(starts.length);
    got.forEach((s, i) => expect(s).toBeCloseTo(starts[i]!));
    expect(tl.choicesAt()).toBeCloseTo(choicesAt);
    expect(tl.endAt()).toBeCloseTo(end);
  });

  it("is self-contained, so the page can inline it by its source", () => {
    // Evaluated on its own, with nothing from the module around it.
    const inlined = (0, eval)(`(${createTimeline.toString()})`) as typeof createTimeline;
    const tl = inlined(0.6);
    tl.place({ padAfter: -1 }, 3);
    expect(tl.startOf()).toBe(2);
    const clock = ((0, eval)(`(${createClock.toString()})`) as typeof createClock)(0, 2);
    expect(clock.at(1)).toBe(500);
  });
});

describe("the playable page's clock", () => {
  it("maps script seconds to wall milliseconds at the rate", () => {
    const c = createClock(1000, 1);
    expect(c.at(2)).toBe(3000);
    expect(createClock(1000, 0.5).at(2)).toBe(5000);
    expect(createClock(1000, 2).at(2)).toBe(2000);
  });

  it("re-anchors on a change of rate: what has played keeps its pace", () => {
    const c = createClock(0, 1);
    c.setRate(1000, 0.5); // a second in, at half speed
    expect(c.position(1000)).toBe(1);
    expect(c.at(1)).toBe(1000); // already reached: not moved
    expect(c.at(2)).toBe(3000); // the second still to come takes two
    c.setRate(2000, 2); // half a second further on, at double speed
    expect(c.position(2000)).toBe(1.5);
    expect(c.at(2.5)).toBe(2500);
  });

  it("plays everything at once at Instant, and picks up from there when slowed again", () => {
    const c = createClock(0, 1);
    c.setRate(500, Infinity);
    expect(c.at(10)).toBe(500); // now, whatever is asked
    c.setRate(800, 1);
    expect(c.position(800)).toBe(10); // the furthest it went
    expect(c.at(11)).toBe(1800);
  });

  it("moves everything to come later by a delay", () => {
    const c = createClock(0, 1);
    c.delay(250);
    expect(c.at(1)).toBe(1250);
    c.delay(-100); // never earlier
    expect(c.at(1)).toBe(1250);
  });
});
