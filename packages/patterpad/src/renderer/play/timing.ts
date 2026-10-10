// ---------------------------------------------------------------------------
// The Play window's timing (design/proposals/line-padding.md, sections 3.2 and 5): when each beat of a
// played-through run starts, from each line's length and the pause after it (`padAfter`). Pure, so the
// rules are tested here and play.ts only waits and plays.
//
//   - A line lasts as long as its recording, else the duration estimate (play.ts works that out).
//   - The next line starts `padAfter` after it ends; a negative pause cuts in, but never before the
//     line it cuts into starts.
//   - The first line of a run starts at once: after a start, a restart, or a choice there's no line
//     before it to carry a pause.
//   - A game event fires when the line before it ends. Play doesn't hold events, so it's done at once,
//     and the pause after that line counts from then.
//   - The last line's pause is ignored. The choices appear as the last line before them starts (they show
//     while it plays); the end comes when every line still playing has ended, including an earlier line
//     that a later one cut in on and that runs on past it.
//   - Under Step (manual advance) none of this applies: each beat appears when it's asked for.
//
// Times are in seconds of the script's own timing; the Speed setting scales them (`SPEED_RATE`), through a
// clock that re-anchors when the speed changes mid-run.
//
// The playable HTML export runs the same rules (packages/ops/src/play-timeline.ts, inlined into the page).
// This renderer can't load that Node package, so it restates them, and play-timing.test.ts holds the two to
// one table of cases.
// ---------------------------------------------------------------------------

import { DEFAULT_PAD_AFTER } from "@patterkit/model";

/** The Speed setting: a speed-up of the whole timing. The stored values (localStorage `patter.playSpeed`)
 *  are shared with the playable HTML export, so a choice made in one holds in the other. */
export type PlaySpeed = "half" | "normal" | "double" | "instant";
export const PLAY_SPEEDS: readonly PlaySpeed[] = ["half", "normal", "double", "instant"];
/** How fast the script plays at each speed: 2 = twice as fast. Instant has no timing at all. */
export const SPEED_RATE: Record<PlaySpeed, number> = { half: 0.5, normal: 1, double: 2, instant: Infinity };

/** The stored speed, read tolerantly: the reading-pace values it replaced map across (slow to half, fast
 *  to double), and anything else is normal. */
export function readSpeed(stored: string | null | undefined): PlaySpeed {
  if (stored === "slow") return "half";
  if (stored === "fast") return "double";
  return (PLAY_SPEEDS as readonly string[]).includes(stored ?? "") ? (stored as PlaySpeed) : "normal";
}

/** A beat as the timeline needs it. */
export interface TimedBeat {
  kind: "line" | "text" | "gameEvent";
  /** The pause after a line or text beat, in seconds (the runtime always resolves one). */
  padAfter?: number;
}

/** Where a beat sits on the timeline, in seconds from the start of the run. */
export interface Slot { start: number; end: number }

/** The run's timeline, built one beat at a time: `startOf` says when the next beat starts (it needs only
 *  the beats before it), and `place` records how long it lasts. So play.ts can find a recording's length
 *  while it waits for the beat's turn. */
export class Timeline {
  /** The time the pending pause counts from: the end of the last line, or the moment an event was done. */
  private anchor = 0;
  /** The pause after the last line, or null at the start of a run (nothing to pause after). */
  private pad: number | null = null;
  /** When the last line started: a cut-in never starts before it. */
  private floor = 0;
  /** When the last thing still playing ends. */
  private last = 0;

  /** When `beat` starts. An event fires when the line before it ends. */
  startOf(beat: TimedBeat): number {
    if (this.pad === null || beat.kind === "gameEvent") return this.anchor;
    return Math.max(this.anchor + this.pad, this.floor);
  }

  /** Put `beat` on the timeline, lasting `duration` seconds (an event takes none: Play's events aren't
   *  held). Returns its slot. */
  place(beat: TimedBeat, duration: number): Slot {
    const start = this.startOf(beat);
    if (beat.kind === "gameEvent") {
      // Done as soon as it fires: the pause after the line before counts from here, and it's still that
      // line's pause (an event carries none of its own).
      this.anchor = start;
      return { start, end: start };
    }
    const end = start + Math.max(0, duration);
    this.anchor = end;
    this.pad = beat.padAfter ?? DEFAULT_PAD_AFTER;
    this.floor = start;
    this.last = Math.max(this.last, end);
    return { start, end };
  }

  /** When the choices appear: as the last line before them starts, so they show while it plays. */
  get choicesAt(): number { return this.floor; }

  /** When the run ends: as the last line still playing ends (its own pause ignored). */
  get end(): number { return Math.max(this.last, this.anchor); }
}

/** Script time on the wall clock, at a speed that can change mid-run. It keeps a (wall, script) anchor and
 *  moves it on each change, so a change applies from the moment it's made: the time already played keeps
 *  the pace it was played at, and only what's to come is re-timed. The playable HTML's `createClock`, alike. */
export class PlayClock {
  private wall: number; // the anchor's wall time, in ms
  private script = 0; // the anchor's script time, in seconds (under Instant: the furthest time asked for)
  constructor(now: number, private rate: number) { this.wall = now; }

  /** The wall time (ms) that script time `seconds` falls at. At Instant it's now: the clock jumps there. */
  at(seconds: number): number {
    if (this.rate === Infinity) { this.script = Math.max(this.script, seconds); return this.wall; }
    return this.wall + ((seconds - this.script) * 1000) / this.rate;
  }

  /** The script time reached at wall time `now`. */
  position(now: number): number {
    return this.rate === Infinity ? this.script : this.script + ((now - this.wall) * this.rate) / 1000;
  }

  /** Play at `rate` (`SPEED_RATE`) from `now` on. */
  setRate(now: number, rate: number): void {
    this.script = this.position(now);
    this.wall = now;
    this.rate = rate;
  }

  /** Move everything still to come `ms` later: a beat that started late (its recording loaded after its
   *  turn) takes the rest of the run with it, so no overlap appears that nobody set. */
  delay(ms: number): void { if (ms > 0) this.wall += ms; }
}

/** The longest a recording is believed to run, at the least: a broken header can claim hours, which would
 *  hold the run that long. Four times the line's estimate when that's longer, so a slow read still fits. */
export const MAX_RECORDING_SECONDS = 60;

/** How long a line lasts on the timeline: its recording's length when that's readable, else the duration
 *  estimate (a recording whose length can't be read still plays), capped at a plausible length. */
export function lineLength(recorded: number | null | undefined, estimate: number): number {
  if (recorded === null || recorded === undefined || !Number.isFinite(recorded) || recorded <= 0) return estimate;
  return Math.min(recorded, Math.max(MAX_RECORDING_SECONDS, estimate * 4));
}

/** The whole timeline for beats whose lengths are known: each beat's slot, and when the run ends. */
export function schedule(beats: ReadonlyArray<TimedBeat & { duration: number }>): { slots: Slot[]; end: number } {
  const tl = new Timeline();
  const slots = beats.map((b) => tl.place(b, b.kind === "gameEvent" ? 0 : b.duration));
  return { slots, end: tl.end };
}

/** Script seconds to wall-clock milliseconds at a speed (instant: none). */
export const toMs = (seconds: number, speed: PlaySpeed): number =>
  speed === "instant" ? 0 : Math.max(0, (seconds * 1000) / SPEED_RATE[speed]);
