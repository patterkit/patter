// The Play window's timing (renderer/play/timing.ts, design/proposals/line-padding.md section 3.2): when each
// beat of a played-through run starts, from each line's length and its `padAfter`, and the Speed setting.

import { describe, it, expect } from "vitest";
import { schedule, Timeline, PlayClock, lineLength, readSpeed, toMs, SPEED_RATE } from "./play/timing.js";
// The playable HTML export's timeline and clock, and the one table of cases both are held to: the renderer
// can't load @patterkit/ops (a Node package), so it restates the rules and these pin the two together.
import { createTimeline, createClock } from "../../../ops/src/play-timeline.js";
import { TIMELINE_CASES } from "../../../ops/test/play-timeline.cases.js";

const line = (duration: number, padAfter?: number) => ({ kind: "line" as const, duration, ...(padAfter !== undefined ? { padAfter } : {}) });
const event = { kind: "gameEvent" as const, duration: 0 };

describe("Play timing", () => {
  it("starts the first line at once and each next one its pause after the last ends", () => {
    const { slots, end } = schedule([line(2, 0.5), line(1, 0), line(3, 1)]);
    expect(slots).toEqual([{ start: 0, end: 2 }, { start: 2.5, end: 3.5 }, { start: 3.5, end: 6.5 }]);
    expect(end).toBe(6.5); // the last line's own pause is ignored
  });

  it("lets a negative pause cut the next line in, so the two overlap", () => {
    const { slots, end } = schedule([line(4, -1.5), line(1)]);
    expect(slots[1]).toEqual({ start: 2.5, end: 3.5 });
    expect(end).toBe(4); // the run ends when the line still playing does
  });

  it("never starts a cut-in before the line it cuts into", () => {
    const { slots } = schedule([line(1, 0.2), line(1, -5), line(1)]);
    expect(slots[2]!.start).toBe(slots[1]!.start);
  });

  it("uses the built-in pause when a step carries none", () => {
    expect(schedule([line(1), line(1)]).slots[1]!.start).toBeCloseTo(1.6);
  });

  it("fires a game event when the line before ends, and counts that line's pause from it", () => {
    const { slots } = schedule([line(2, 0.5), event, line(1)]);
    expect(slots[1]).toEqual({ start: 2, end: 2 });
    expect(slots[2]!.start).toBe(2.5);
    expect(schedule([event, line(1)]).slots[1]!.start).toBe(0); // nothing before the event: no pause
  });

  it("knows the next start before the beat's length is known", () => {
    const tl = new Timeline();
    expect(tl.startOf({ kind: "line" })).toBe(0);
    tl.place({ kind: "text", padAfter: 0.25 }, 3);
    expect(tl.startOf({ kind: "line" })).toBe(3.25);
  });

  it("shows the choices as the last line starts, and the end when every line still playing has ended", () => {
    const tl = new Timeline();
    tl.place({ kind: "line", padAfter: -4 }, 6);
    tl.place({ kind: "line", padAfter: 1 }, 1.5);
    expect(tl.choicesAt).toBe(2); // the short line's start: the options show while it plays
    expect(tl.end).toBe(6); // the long line it cut in on still plays to here
    expect(new Timeline().choicesAt).toBe(0);
  });

  describe.each(TIMELINE_CASES)("times a scene as the playable HTML does: $name", ({ beats, starts, choicesAt, end }) => {
    it("in the Play window", () => {
      const tl = new Timeline();
      const got = beats.map((b) => tl.place(b, b.duration)).filter((_, i) => beats[i]!.kind !== "gameEvent").map((s) => s.start);
      expect(got.length).toBe(starts.length);
      got.forEach((s, i) => expect(s).toBeCloseTo(starts[i]!));
      expect(tl.choicesAt).toBeCloseTo(choicesAt);
      expect(tl.end).toBeCloseTo(end);
    });
    it("in the playable HTML", () => {
      const tl = createTimeline(0.6);
      const got = beats.filter((b) => b.kind !== "gameEvent").map((b) => tl.place(b, b.duration).start);
      got.forEach((s, i) => expect(s).toBeCloseTo(starts[i]!));
      expect(tl.choicesAt()).toBeCloseTo(choicesAt);
      expect(tl.endAt()).toBeCloseTo(end);
    });
  });

  it("re-anchors on a change of speed: what has played keeps its pace, and the rest takes the new one", () => {
    const run = (c: { at(s: number): number; setRate(now: number, rate: number): void; position(now: number): number; delay(ms: number): void }): number[] => {
      const out = [c.at(1)];
      c.setRate(1000, SPEED_RATE.half); // a second in, at half speed
      out.push(c.position(1000), c.at(1), c.at(2));
      c.setRate(2000, SPEED_RATE.instant);
      out.push(c.at(5));
      c.setRate(2500, SPEED_RATE.double); // back from Instant: on from the furthest it went
      out.push(c.position(2500), c.at(6));
      c.delay(300); // a beat that started late moves the rest on
      out.push(c.at(6));
      return out;
    };
    const expected = [1000, 1, 1000, 3000, 2000, 5, 3000, 3300];
    expect(run(new PlayClock(0, SPEED_RATE.normal))).toEqual(expected);
    expect(run(createClock(0, SPEED_RATE.normal))).toEqual(expected); // the playable HTML's clock, alike
  });

  it("times a recording by its length, by the estimate when it has none, and caps an implausible one", () => {
    expect(lineLength(3.2, 2)).toBe(3.2);
    expect(lineLength(undefined, 2)).toBe(2);
    expect(lineLength(Number.NaN, 2)).toBe(2); // unreadable: the clip still plays, timed by the estimate
    expect(lineLength(Infinity, 2)).toBe(2); // a stream with no length
    expect(lineLength(0, 2)).toBe(2);
    expect(lineLength(45, 2)).toBe(45); // a long, slow read is believed
    expect(lineLength(6 * 3600, 2)).toBe(60); // a broken header claiming hours is not
    expect(lineLength(6 * 3600, 18)).toBe(72); // the cap grows with a long line's estimate
  });

  it("reads the stored speed, mapping the old reading paces", () => {
    expect(readSpeed("slow")).toBe("half");
    expect(readSpeed("fast")).toBe("double");
    expect(readSpeed("double")).toBe("double");
    expect(readSpeed("instant")).toBe("instant");
    expect(readSpeed(null)).toBe("normal");
    expect(readSpeed("ludicrous")).toBe("normal");
  });

  it("scales the whole timing by the speed: twice as long at half, none at instant", () => {
    expect(SPEED_RATE).toEqual({ half: 0.5, normal: 1, double: 2, instant: Infinity });
    expect(toMs(1.5, "half")).toBe(3000);
    expect(toMs(1.5, "normal")).toBe(1500);
    expect(toMs(1.5, "double")).toBe(750);
    expect(toMs(1.5, "instant")).toBe(0);
  });
});
