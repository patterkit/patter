// The Play window's timing (renderer/play/timing.ts, design/proposals/line-padding.md section 3.2): when each
// beat of a played-through run starts, from each line's length and its `padAfter`, and the Speed setting.

import { describe, it, expect } from "vitest";
import { schedule, Timeline, readSpeed, toMs, SPEED_RATE } from "./play/timing.js";

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
