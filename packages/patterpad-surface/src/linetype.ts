// ---------------------------------------------------------------------------
// Line-type toggling (Z7, spec section 4). Kept conceptually separate:
//
//   toggleLineType   (Cmd-T) - the symmetric in-place toggle. Dialogue -> free
//                    text collapses the prefix to literal "CHARACTER: " text;
//                    free text -> dialogue parses a leading "word:" as the name,
//                    else drops into an empty cue (popup opens).
//   flipToFreeText   - the §4.2 in-flow flip: a leading Space in an EMPTY cue
//                    means "plain text here" - convert to free text, consume the
//                    space.
//   promoteToDialogue- the §4.2 in-flow flip: Tab at a free-text line's start
//                    promotes it to dialogue and opens the cast popup.
//
// Beat ids and `raw` are preserved across a toggle. Space / Tab reach these via
// the web layer; the commands are pure over EditorState.
// ---------------------------------------------------------------------------

import { TextSelection, type Command, type EditorState, type Transaction } from "prosemirror-state";
import { Fragment, type Node as PMNode } from "prosemirror-model";
import { patterSchema as S } from "./schema.js";
import { context } from "./context.js";
import { zoneText, sayNode, beatNode } from "./zoneutil.js";
import { rawWithoutQualifier } from "./qualifier.js";

// The say moves as a Fragment, never as text, so bold / italic survive a toggle (review 2026-10,
// MEDIUM 32: rebuilding through textContent stripped them).
const makeLine = (id: string, raw: string, character: string, direction: string, content: Fragment): PMNode =>
  beatNode("line", { id, raw, speaker: character, direction, say: content });
// A text beat has no speaker qualifier, so a line becoming text leaves its qualifier behind; turned back
// into dialogue and named, it takes one again by the run rule (src/qualifier.ts).
const makeProse = (id: string, raw: string, content: Fragment): PMNode => beatNode("prose", { id, raw: rawWithoutQualifier(raw), say: content });
const sayOf = (beat: PMNode): Fragment => sayNode(beat)?.content ?? Fragment.empty;

/** Parse a leading "word:" name and "(direction)" out of free-text content (free text -> dialogue). */
function parsePrefix(content: string): { character: string; direction: string; rest: string } {
  const m = /^(?:([^\s:]+):\s*)?(?:\(([^)]*)\)\s*)?([\s\S]*)$/.exec(content);
  return { character: m?.[1] ?? "", direction: m?.[2] ?? "", rest: m?.[3] ?? content };
}

/** Cmd-T - toggle dialogue <-> free text in place. */
export const toggleLineType: Command = (state, dispatch) => {
  const c = context(state);
  if (!c.beat || (c.beat.kind !== "line" && c.beat.kind !== "prose")) return false;
  const { node, pos } = c.beat;
  const id = node.attrs.id as string;
  const raw = node.attrs.raw as string;

  if (!dispatch) return true;
  // Where the caret sits now, so we can keep it in the same logical spot.
  const zoneRole = c.zone?.role;
  const zoneOffset = c.zone?.offset ?? 0;

  if (c.beat.kind === "line") {
    const character = zoneText(node, "cue");
    const direction = zoneText(node, "paren");
    const charPrefix = character ? `${character}: ` : "";
    const dirPrefix = direction ? `(${direction}) ` : "";
    const prefix = charPrefix + dirPrefix;
    const content = prefix ? Fragment.from(S.text(prefix)).append(sayOf(node)) : sayOf(node);
    const prose = makeProse(id, raw, content);
    // Map the caret into the collapsed content: a content caret keeps its spot
    // (shifted past the prefix); a cue/direction caret maps into the prefix.
    let offset = prefix.length + zoneOffset;            // say (content)
    if (zoneRole === "cue") offset = Math.min(zoneOffset, charPrefix.length);
    else if (zoneRole === "paren") offset = charPrefix.length + 1 + zoneOffset; // after the "("
    const tr = state.tr.replaceWith(pos, pos + node.nodeSize, prose);
    dispatch(tr.setSelection(TextSelection.create(tr.doc, pos + 2 + offset)).scrollIntoView());
  } else {
    const original = zoneText(node, "say");
    const { character, direction, rest } = parsePrefix(original);
    const prefixLen = original.length - rest.length; // chars consumed as "name:" + "(direction)"
    const line = makeLine(id, raw, character, direction, sayOf(node).cut(original.length - rest.length));
    // say content-start, accounting for the optional paren zone before it.
    let beforeSay = pos + 1;
    line.forEach((z) => { if (z.type.name !== "say") beforeSay += z.nodeSize; });
    const sayContentStart = beforeSay + 1;
    // No parsed name -> drop into the empty cue to name the speaker (spec §4.1).
    // A caret inside the parsed name stays in the cue; otherwise it stays in the
    // content at the same spot (minus the now-removed prefix).
    let caret: number;
    if (!character) caret = pos + 2;
    else if (zoneOffset <= character.length) caret = pos + 2 + zoneOffset;
    else caret = sayContentStart + Math.max(0, zoneOffset - prefixLen);
    const tr = state.tr.replaceWith(pos, pos + node.nodeSize, line);
    dispatch(tr.setSelection(TextSelection.create(tr.doc, caret)).scrollIntoView());
  }
  return true;
};

/**
 * A leading Space - flip to free text, consuming the space and dropping the
 * speaker. Fires in the cue zone (a name can't contain a space - this is the
 * "I want text here" gesture, including when the mirrored name is selected), or
 * at empty content-start. Spec §4.2.
 */
export function flipToFreeText(state: EditorState): Transaction | null {
  const c = context(state);
  if (!c.beat || c.beat.kind !== "line" || !c.zone) return null;
  const inCue = c.zone.role === "cue";
  const atEmptyContentStart = c.zone.role === "say" && c.zone.atStart && c.zone.textLen === 0;
  if (!inCue && !atEmptyContentStart) return null;
  const { node, pos } = c.beat;
  const prose = makeProse(node.attrs.id as string, node.attrs.raw as string, sayOf(node));
  const tr = state.tr.replaceWith(pos, pos + node.nodeSize, prose);
  return tr.setSelection(TextSelection.create(tr.doc, pos + 2)).scrollIntoView();
}

/** Tab at a free-text line's start - promote to dialogue (empty cue, popup opens). */
export const promoteToDialogue: Command = (state, dispatch) => {
  const c = context(state);
  if (!c.beat || c.beat.kind !== "prose" || c.zone?.role !== "say" || !c.zone.atStart) return false;
  if (dispatch) {
    const { node, pos } = c.beat;
    const line = makeLine(node.attrs.id as string, node.attrs.raw as string, "", "", sayOf(node));
    const tr = state.tr.replaceWith(pos, pos + node.nodeSize, line);
    dispatch(tr.setSelection(TextSelection.create(tr.doc, pos + 2)).scrollIntoView()); // empty cue
  }
  return true;
};
