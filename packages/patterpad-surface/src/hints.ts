// ---------------------------------------------------------------------------
// The contextual hint bar's content model (spec section 16). A pure mapping from
// the zone state to the 2-4 most relevant transitions for the current cursor
// position, driven off the SAME ZoneState the key-dispatch reads - so it doubles
// as a coverage check (a state with no sensible hints flags an undefined state)
// and never drifts. Kept in truth with the live behaviour:
//   - In the cue the name is a token: typing FILTERS the cast popup (never edits the
//     name), Enter accepts the highlighted character; Enter in content = next line.
//     Enter NEVER ends a bubble.
//   - Shift-Enter (Cmd-Enter) = end the bubble (new bubble).
//   - "(" opens a direction in the cue and at content-START (even with content);
//     mid-content it is a literal.
//   - Space (cue / empty content-start) = "free text"; "/" (empty line) = insert.
// ---------------------------------------------------------------------------

import type { EditorState } from "prosemirror-state";
import type { ZoneState } from "./context.js";
import { multiSelectPositions } from "./multiselect.js";

export interface Hint { key: string; label: string }

/** Hints for a multi-chunk selection (groups §6), or null when it isn't one - so the contextual hint
 *  bar shows what a multi-select can do (delete / move / wrap) rather than one beat's keys. */
export function multiSelectHints(state: EditorState): Hint[] | null {
  if (multiSelectPositions(state).length < 2) return null;
  return [
    { key: "⌫", label: "delete" },
    { key: "drag", label: "move" },
    { key: "right-click", label: "wrap…" },
  ];
}

export function hintsFor(s: ZoneState): Hint[] {
  if (!s.beat) return [];

  // the game-event atom (no zone) - removed via the affordance, not a key
  if (!s.zone) return [{ key: "×", label: "delete game event" }];

  const hints = zoneHints(s);
  // At the LEFT edge of a group's first bubble, Backspace is a no-op (it never
  // merges out across the group seam, §10) - a soft cue says why.
  const atLeftEdge = s.zone.atStart && (s.zone.role === "cue" || (s.beat.kind === "prose" && s.zone.role === "say"));
  return s.inGroup && s.firstSnippetInBlock && s.firstBeatInSnippet && atLeftEdge
    ? [{ key: "⌫", label: "group edge" }, ...hints]
    : hints;
}

function zoneHints(s: ZoneState): Hint[] {
  if (!s.zone || !s.beat) return [];
  // The slash menu is allowed only on an empty say (canInsertSpecial): so the "/" hint shows in the
  // cue and at an empty content-start - never on a line that already has words.
  let sayLen = 1;
  s.beat.node.forEach((z) => { if (z.type.name === "say") sayLen = z.content.size; });
  const sayEmpty = sayLen === 0;
  switch (s.zone.role) {
    case "cue":
      // The name is a token: type to FILTER / add (never edit), pick to accept. "/" inserts a
      // game event / jump / group only while the line has no spoken content yet.
      return [
        { key: "type", label: "filter / add" },
        { key: "Enter", label: "accept" },
        { key: "Space", label: "→ free text" },
        { key: "(", label: "direction" },
        ...(sayEmpty ? [{ key: "/", label: "insert" }] : []),
      ];

    case "paren":
      return [{ key: ")", label: "close" }];

    case "say": {
      if (s.beat.kind === "prose") {
        if (s.zone.textLen === 0) {
          return [
            { key: "Tab", label: "→ dialogue" },
            { key: "Enter", label: "next line" },
            { key: "/", label: "insert" },
          ];
        }
        return s.zone.atStart
          ? [{ key: "Tab", label: "→ dialogue" }, { key: "Enter", label: "next line" }]
          : [{ key: "Enter", label: "next line" }, { key: "Cmd-T", label: "→ dialogue" }];
      }
      // dialogue content
      if (s.zone.textLen === 0) {
        return [
          { key: "Enter", label: "next line" },
          { key: "Shift-Enter", label: "end snippet" },
          { key: "(", label: "direction" },
          { key: "/", label: "insert" },
        ];
      }
      if (s.zone.atStart) {
        return [
          { key: "Enter", label: "next line" },
          { key: "Shift-Enter", label: "end snippet" },
          { key: "(", label: "direction" },
        ];
      }
      return [
        { key: "Enter", label: "next line" },
        { key: "Cmd-T", label: "→ free text" },
        { key: "Shift-Enter", label: "end snippet" },
      ];
    }

    default:
      return [];
  }
}
