// ---------------------------------------------------------------------------
// Select All (Cmd/Ctrl-A): the FIELD, not the whole scene.
//
// Both routes to this key selected the entire document: ProseMirror's baseKeymap
// binds Mod-a to `selectAll`, and the host's native Edit menu had Electron's
// `role: "selectAll"`, which runs the DOM equivalent. So a keystroke every editor
// trains as "select what I am typing in" silently selected the whole scene and
// scrolled to the end of it, with nothing visibly selected where the author was
// looking (reported 2026-09-04). Same finding as undo / redo before it: a native
// editing role knows nothing about this app's model.
//
// What it selects instead, from wherever the caret is in a beat:
//   dialogue line  -> the spoken text. NEVER the character: the cue is a token the
//                     cast popup owns (patter-cue-token-model), not text to select,
//                     so Cmd-A in the cue selects the line's words.
//   text line      -> its text.
//   direction      -> the direction being typed, when the caret is in one: that is
//                     the field the author is in, and its own parenthetical field.
//   choice prompt  -> the prompt's text (its cell holds an ordinary beat).
//   game event     -> nothing at all. An atom holds no text, and the key is
//                     SWALLOWED rather than left to fall through to the old
//                     document-wide select.
// A caret in the beat but in no zone at all (clicking a cue can leave it on the
// beat's own boundary) counts as the line's words: the author is in that line.
// Outside a beat entirely (a node-selected bubble or group) it returns false and
// the document-wide select still stands: at the structural level "everything" is
// what the key means.
// ---------------------------------------------------------------------------

import { TextSelection, type Command } from "prosemirror-state";
import { context } from "./context.js";
import { zoneContentStart, zoneContentEnd } from "./zoneutil.js";

export const selectAllInBeat: Command = (state, dispatch) => {
  const c = context(state);
  if (!c.beat) return false;                    // not in a beat: leave the key to the document-wide select
  if (c.beat.kind === "gameEvent") return true; // an atom: nothing to select, and nothing to fall through to

  // The direction when the caret is in one; the line's words otherwise. "Otherwise" deliberately
  // includes a caret with no zone at all: clicking a cue can leave the position at the beat's own
  // boundary rather than inside a zone, and that must still select the words, not swallow the key.
  const role = c.zone?.role === "paren" ? "paren" : "say";
  const from = zoneContentStart(c.beat.node, c.beat.pos, role);
  const to = zoneContentEnd(c.beat.node, c.beat.pos, role);
  // An empty line has nothing to select: swallow, rather than moving the caret to a field the author
  // did not ask to be in (Cmd-A in the cue of a blank line must not jump them into the say).
  if (from < 0 || to <= from) return true;
  // No scrollIntoView: the text is already on screen, and being scrolled somewhere else was half the
  // complaint.
  if (dispatch) dispatch(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
  return true;
};
