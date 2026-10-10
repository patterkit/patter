// ---------------------------------------------------------------------------
// The playable page's timing (design/proposals/line-padding.md, sections 3.2 and 5): when each beat of a
// played-through run appears, from each line's length and the pause after it (`padAfter`), and how script
// time maps to the wall clock at a Speed that can change mid-run.
//
// The page is a plain inline script, so these two are written to be inlined BY THEIR SOURCE TEXT
// (export-html.ts puts `createTimeline.toString()` into the page): each function is self-contained, with no
// imports and nothing from this module's scope, so the page runs exactly the code tested here. Patterpad's
// Play window restates the same rules in its renderer (renderer/play/timing.ts, which cannot load this
// Node package), and its tests pin the two to one table of cases.
//
//   - The first line of a run starts at once (after a start, a restart, a load, or a choice).
//   - The next line starts `padAfter` after the last one ends; a negative pause cuts in, but never before the
//     line it cuts into starts.
//   - A game event isn't held here, so it's done at once and the pause still runs from the line's end: a
//     timeline can simply skip it.
//   - The choices appear as the last line before them starts: its pause is ignored and the options show
//     while it plays.
//   - The end appears when every line still playing has finished, including an earlier line that a later
//     one cut in on and that runs on past it.
// Times are script seconds; the clock turns them into wall-clock milliseconds.
// ---------------------------------------------------------------------------

/** A beat as the timeline needs it: a line or text step, and the pause after it in seconds. */
export interface TimelineBeat { padAfter?: number | null }

/** A run's timeline, built one beat at a time. */
export interface PlayTimeline {
  /** When the next line or text beat starts, in script seconds (it needs only the beats before it). */
  startOf(): number;
  /** Put the next beat on the timeline, lasting `duration` seconds; returns when it starts and ends. */
  place(beat: TimelineBeat, duration: number): { start: number; end: number };
  /** When the choices appear: as the last line starts. */
  choicesAt(): number;
  /** When the run ends: as the last line still playing ends. */
  endAt(): number;
}

/** A new, empty timeline. `defaultPad` is the pause for a step that carries none (a bundle from before
 *  line padding). Self-contained: inlined into the playable page by its source text. */
export function createTimeline(defaultPad: number): PlayTimeline {
  let anchor = 0; // the end of the last line: the pending pause counts from here
  let pad: number | null = null; // the pause after the last line, or null at the start of a run
  let floor = 0; // when the last line started: a cut-in never starts before it
  let last = 0; // when the last thing still playing ends
  const startOf = (): number => (pad === null ? anchor : Math.max(anchor + pad, floor));
  return {
    startOf,
    place(beat, duration) {
      const start = startOf();
      const end = start + Math.max(0, duration);
      anchor = end;
      pad = typeof beat.padAfter === "number" ? beat.padAfter : defaultPad;
      floor = start;
      last = Math.max(last, end);
      return { start, end };
    },
    choicesAt: () => floor,
    endAt: () => Math.max(last, anchor),
  };
}

/** Script time on the wall clock, at a rate that can change mid-run. */
export interface PlayClock {
  /** The wall time (ms) that script time `seconds` falls at. At an infinite rate (Instant) it's now. */
  at(seconds: number): number;
  /** The script time (seconds) reached at wall time `now`. */
  position(now: number): number;
  /** Play at `rate` from `now` on: the time already played keeps the pace it was played at. */
  setRate(now: number, rate: number): void;
  /** Move everything still to come `ms` later (a beat that started late). */
  delay(ms: number): void;
}

/** A clock that starts script time 0 at wall time `now` (ms), playing `rate` script seconds per second
 *  (2 = double speed, Infinity = Instant). It keeps a (wall, script) anchor and moves it on each change of
 *  rate, so a change applies from the moment it's made. Self-contained: inlined into the playable page by
 *  its source text. */
export function createClock(now: number, rate: number): PlayClock {
  let wall = now; // the anchor's wall time, in ms
  let script = 0; // the anchor's script time, in seconds (under Instant: the furthest time asked for)
  let r = rate;
  const position = (at: number): number => (r === Infinity ? script : script + ((at - wall) * r) / 1000);
  return {
    at(seconds) {
      if (r === Infinity) { script = Math.max(script, seconds); return wall; } // Instant: the clock jumps there
      return wall + ((seconds - script) * 1000) / r;
    },
    position,
    setRate(at, rate) {
      script = position(at);
      wall = at;
      r = rate;
    },
    delay(ms) { if (ms > 0) wall += ms; },
  };
}
