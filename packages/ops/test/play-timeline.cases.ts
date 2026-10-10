// The player rules of line padding (design/proposals/line-padding.md, section 3.2) as one table of cases,
// run against the playable page's timeline (src/play-timeline.ts) here and against Patterpad's Play window
// timeline (packages/patterpad/src/renderer/play/timing.ts) by its tests, so the two time a scene alike.

export interface CaseBeat { kind: "line" | "text" | "gameEvent"; duration: number; padAfter?: number }
export interface TimelineCase {
  name: string;
  beats: CaseBeat[];
  /** When each line or text beat starts (game events left out). */
  starts: number[];
  /** When the choices appear, if a choice follows. */
  choicesAt: number;
  /** When the end appears, if the run ends there. */
  end: number;
}

const line = (duration: number, padAfter?: number): CaseBeat => ({ kind: "line", duration, ...(padAfter !== undefined ? { padAfter } : {}) });
const text = (duration: number, padAfter?: number): CaseBeat => ({ kind: "text", duration, ...(padAfter !== undefined ? { padAfter } : {}) });
const event: CaseBeat = { kind: "gameEvent", duration: 0 };

export const TIMELINE_CASES: TimelineCase[] = [
  { name: "nothing played", beats: [], starts: [], choicesAt: 0, end: 0 },
  { name: "the first line at once, each next one its pause after the last ends",
    beats: [line(2, 0.5), text(1, 0), line(3, 1)], starts: [0, 2.5, 3.5], choicesAt: 3.5, end: 6.5 },
  { name: "a negative pause cuts the next line in",
    beats: [line(4, -1.5), line(1)], starts: [0, 2.5], choicesAt: 2.5, end: 4 },
  { name: "a cut-in never starts before the line it cuts into",
    beats: [line(1, 0.2), line(1, -5), line(1)], starts: [0, 1.2, 1.2], choicesAt: 1.2, end: 2.2 },
  { name: "the built-in pause when a step carries none",
    beats: [line(1), line(1)], starts: [0, 1.6], choicesAt: 1.6, end: 2.6 },
  { name: "a game event isn't held: the pause runs from the line's end",
    beats: [line(2, 0.5), event, line(1)], starts: [0, 2.5], choicesAt: 2.5, end: 3.5 },
  { name: "a negative pause before a game event stands",
    beats: [line(3, -1), event, line(1)], starts: [0, 2], choicesAt: 2, end: 3 },
  { name: "an earlier line cut in on and running longer holds the end, not the choices",
    beats: [line(6, -4), line(1.5)], starts: [0, 2], choicesAt: 2, end: 6 },
  { name: "nothing before an event: no pause",
    beats: [event, line(1, 2)], starts: [0], choicesAt: 0, end: 1 },
];
