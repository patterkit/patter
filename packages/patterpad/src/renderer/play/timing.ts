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
//   - The last line's pause is ignored: the run ends (or its choices appear) when the last line still
//     playing ends.
//   - Under Step (manual advance) none of this applies: each beat appears when it's asked for.
//
// Times are in seconds of the script's own timing; the Speed setting scales them (`SPEED_RATE`).
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

  /** When the run's last line ends (its own pause ignored): when the choices or the end appear. */
  get end(): number { return Math.max(this.last, this.anchor); }
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
