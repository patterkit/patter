// ---------------------------------------------------------------------------
// Shared zone/position helpers for the interaction commands. The keystroke
// modules all need to locate zones and beats by role / id and compute caret
// positions; keeping that math in one place (rather than re-deriving it per
// module) keeps the position arithmetic consistent and auditable.
// ---------------------------------------------------------------------------

import { Fragment, type Node as PMNode } from "prosemirror-model";
import { TextSelection, type Selection, type Transaction } from "prosemirror-state";
import { AddMarkStep, RemoveMarkStep, ReplaceStep } from "prosemirror-transform";
import { newId } from "@patterkit/core";
import { patterSchema as S } from "./schema.js";

/** The zone textblocks (where a caret rests) and the beat kinds, in one place for every module. */
export const ZONE_TYPES: ReadonlySet<string> = new Set(["cue", "paren", "say"]);
export const BEAT_TYPES: ReadonlySet<string> = new Set(["line", "prose", "gameEvent"]);

/** What a beat is built from. `say` is a Fragment so inline bold / italic marks survive whatever
 *  rebuilt the beat (a merge, a split, a line-type toggle); a plain string is accepted for brevity. */
export interface BeatParts {
  id?: string;
  raw?: string;
  speaker?: string;
  direction?: string;
  say?: Fragment | string;
}

const sayFragment = (say: Fragment | string | undefined): Fragment =>
  say == null ? Fragment.empty : typeof say === "string" ? (say ? Fragment.from(S.text(say)) : Fragment.empty) : say;

/**
 * Build a beat of `kind`: a dialogue `line` (cue, an optional direction, say) or a text `prose` (say
 * only). The single source of the line / prose node shape, so every command that makes or rebuilds a
 * beat agrees on it. A fresh id is minted unless one is supplied (a toggle or a merge keeps its own).
 */
export function beatNode(kind: "line" | "prose", parts: BeatParts = {}): PMNode {
  const id = parts.id ?? newId("L");
  const raw = parts.raw ?? "{}";
  const say = S.node("say", null, sayFragment(parts.say));
  if (kind === "prose") return S.node("prose", { id, raw }, [say]);
  const kids = [S.node("cue", null, parts.speaker ? [S.text(parts.speaker)] : [])];
  if (parts.direction) kids.push(S.node("paren", null, [S.text(parts.direction)]));
  kids.push(say);
  return S.node("line", { id, raw }, kids);
}

/**
 * A fresh empty beat of `kind` - a dialogue `line` (optionally carrying a speaker) or a text
 * `prose`. Shared by every creation command (groups, special, lines). A fresh id is minted per call
 * unless one is supplied (a split / jump carries its own).
 */
export function emptyBeatNode(kind: "line" | "prose", speaker = "", id: string = newId("L")): PMNode {
  return beatNode(kind, { id, speaker });
}

/** The `raw` overlay of a brand-new snippet: a fresh id and nothing else. Every command that mints a
 *  bubble (a split's tail, a seeded group's bubble, a jump's continuation) uses this, so a new snippet
 *  never inherits another's condition or effects by accident. */
export const freshSnippetRaw = (): string => JSON.stringify({ id: newId("sn"), type: "snippet" });

/** A fresh snippet holding `beats` (none = an un-entered bubble showing the add-a-line ghost). */
export const freshSnippet = (beats: PMNode[] = [], jump = ""): PMNode => S.node("snippet", { raw: freshSnippetRaw(), jump }, beats);

/**
 * Is this beat BLANK - a line or text beat with nothing in it that would be lost by removing it? No
 * typed text in any zone (character, direction, or words) and no game data or tags. A game event is
 * never blank: it is an atom with no text, and its whole content is what it is. The one emptiness rule,
 * shared by the blur sweep and by a jump collapsing an empty bubble, so neither deletes what the other
 * would keep.
 */
export function isBlankBeat(node: PMNode): boolean {
  if (node.type.name !== "line" && node.type.name !== "prose") return false;
  if (node.textContent.trim() !== "") return false;
  const raw = rawAttr(node);
  const hasGameData = !!raw.gameData && typeof raw.gameData === "object" && Object.keys(raw.gameData as object).length > 0;
  const hasTags = Array.isArray(raw.tags) && raw.tags.length > 0;
  return !hasGameData && !hasTags;
}

export interface ZoneRef { node: PMNode; pos: number }
export interface BeatRef { node: PMNode; pos: number }

/** The text of a named zone within a beat (empty string if absent). */
export function zoneText(beat: PMNode, role: string): string {
  let t = "";
  beat.forEach((c) => { if (c.type.name === role) t = c.textContent; });
  return t;
}
export const cueText = (beat: PMNode): string => zoneText(beat, "cue");
export const sayText = (beat: PMNode): string => zoneText(beat, "say");

/** The say child node of a beat, or null. */
export function sayNode(beat: PMNode): PMNode | null {
  let s: PMNode | null = null;
  beat.forEach((c) => { if (c.type.name === "say") s = c; });
  return s;
}

/** The cue / paren / say child nodes of a line, with absolute positions. */
export function lineZones(beat: PMNode, beatPos: number): { cue?: ZoneRef; paren?: ZoneRef; say?: ZoneRef } {
  const map: Record<string, ZoneRef> = {};
  beat.forEach((child, offset) => { if (ZONE_TYPES.has(child.type.name)) map[child.type.name] = { node: child, pos: beatPos + 1 + offset }; });
  return map;
}

/** Absolute positions of a beat's zone children, in order. */
export function zonePositions(beat: PMNode, beatPos: number): Array<{ role: string } & ZoneRef> {
  const out: Array<{ role: string } & ZoneRef> = [];
  beat.forEach((child, offset) => { if (ZONE_TYPES.has(child.type.name)) out.push({ role: child.type.name, node: child, pos: beatPos + 1 + offset }); });
  return out;
}

/** Content-start position of a named zone within a beat at `beatPos`, or -1. */
export function zoneContentStart(beat: PMNode, beatPos: number, role: string): number {
  let p = -1;
  beat.forEach((child, offset) => { if (child.type.name === role) p = beatPos + 1 + offset + 1; });
  return p;
}

/**
 * Where a caret the EDITOR places should rest: never on a line's speaker. Opening a scene, or jumping to a
 * block or bubble from the navigator, puts the caret at the first spot inside it, and when that is a
 * dialogue line the spot is its cue. A caret in a cue selects the speaker name and raises the cast picker,
 * so browsing scenes whose first line was dialogue popped the picker on every arrival. An empty caret in a
 * cue moves to the start of that line's spoken text; anything else comes back unchanged.
 */
export function offCue(doc: PMNode, sel: Selection): Selection {
  const $h = sel.$head;
  if (!sel.empty || $h.parent.type.name !== "cue" || $h.depth < 2) return sel;
  const beatPos = $h.before($h.depth - 1);
  const beat = doc.nodeAt(beatPos);
  const say = beat ? zoneContentStart(beat, beatPos, "say") : -1;
  return say >= 0 ? TextSelection.create(doc, say) : sel;
}

/** Content-end position of a named zone within a beat at `beatPos`, or -1. */
export function zoneContentEnd(beat: PMNode, beatPos: number, role: string): number {
  let end = -1;
  beat.forEach((child, offset) => { if (child.type.name === role) end = beatPos + 1 + offset + 1 + child.content.size; });
  return end;
}

const CHUNK_TYPES = new Set(["snippet", "group"]);
/** A "chunk" = a selectable / movable container: a snippet (bubble) or a group. */
export const isChunk = (n: PMNode): boolean => CHUNK_TYPES.has(n.type.name);

/** A node's `raw` overlay parsed to an object - tolerant: an absent / corrupt `raw` reads as `{}`. The
 *  single place node JSON is parsed off `raw`, so a malformed node degrades the same way everywhere. */
export function rawAttr(node: PMNode): Record<string, unknown> {
  if (typeof node.attrs.raw !== "string") return {};
  try { return JSON.parse(node.attrs.raw) as Record<string, unknown>; } catch { return {}; }
}

/** A node's stable MODEL id: a beat carries it as the `id` attr; a snippet / group / block carries it
 *  inside its `raw` overlay. The one resolver, so every "find / tag / match this node by id" agrees. */
export function modelIdOf(node: PMNode): string | null {
  if (typeof node.attrs.id === "string") return node.attrs.id;
  const id = rawAttr(node).id;
  return typeof id === "string" ? id : null;
}

/** Is `node` a `choice` group? Asked of a node's PARENT, it answers "is this node a choice OPTION". */
export function isChoiceGroup(node: PMNode | null | undefined): boolean {
  return !!node && node.type.name === "group" && rawAttr(node).selector === "choice";
}

/** The one id-locating document walk: the first node whose `modelIdOf` is `id` (optionally constrained
 *  by `match`), as { node, pos }, or null. Replaces per-module findNodePos / chunkPosById / findBeatById. */
export function findByModelId(doc: PMNode, id: string, match?: (n: PMNode) => boolean): BeatRef | null {
  let found: BeatRef | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if ((!match || match(node)) && modelIdOf(node) === id) { found = { node, pos }; return false; }
    return true;
  });
  return found;
}

/** Locate a line / prose beat by id (node + its position), or null. The one shared id-walk
 *  used wherever a freshly built / just-moved beat must be found again to land the caret. */
export function findBeatById(doc: PMNode, id: string): BeatRef | null {
  return findByModelId(doc, id, isZoneBeat);
}

/** Resolve MANY beats by id in ONE document walk (id -> BeatRef, only for ids found), instead of a
 *  `findBeatById` per id - the single-pass pattern multiSelectPositions uses (#117). The decoration
 *  plugins (comments / suggestions) use it to place N chips in O(nodes), not O(N * nodes). */
export function findBeatsByIds(doc: PMNode, ids: Set<string>): Map<string, BeatRef> {
  const out = new Map<string, BeatRef>();
  if (ids.size === 0) return out;
  doc.descendants((node, pos) => {
    if (isZoneBeat(node)) { const id = modelIdOf(node); if (id && ids.has(id)) out.set(id, { node, pos }); }
    return true;
  });
  return out;
}

/** The say-zone content-start position of a beat located by id, or -1. */
export function sayStartOf(doc: PMNode, beatId: string): number {
  const b = findBeatById(doc, beatId);
  return b ? zoneContentStart(b.node, b.pos, "say") : -1;
}

/** The beat-level node (line/prose/gameEvent) immediately before (`dir -1`) or after (`dir +1`) `pos`
 *  in document order - across snippet / block boundaries - or null at the ends. A targeted walk used
 *  by Left/Right nav, so an arrow press doesn't materialise the whole beat list just to find a neighbour. */
export function adjacentBeat(doc: PMNode, pos: number, dir: -1 | 1): BeatRef | null {
  let before: BeatRef | null = null; // latest beat seen before `pos` (for dir -1)
  let after: BeatRef | null = null;  // first beat seen after `pos` (for dir +1)
  doc.descendants((node, p) => {
    if (after) return false; // dir +1 already satisfied - skip the rest (cheap no-op visits)
    if (BEAT_TYPES.has(node.type.name)) {
      if (p < pos) before = { node, pos: p };
      else if (p > pos && dir === 1) after = { node, pos: p };
      return false; // never descend into a beat
    }
    return true;
  });
  return dir === 1 ? after : before;
}

export const isZoneBeat = (n: PMNode): boolean => n.type.name === "line" || n.type.name === "prose";

/**
 * The KIND of the nearest preceding content beat in document order before `beforePos`
 * (the insertion seam) - so a freshly injected line follows the flow: a text line after
 * text, a dialogue line after dialogue. Actions are skipped (they carry no line type), and so are
 * **choice-option PROMPT cells** - a prompt is always a text label, but the surrounding flow is
 * usually dialogue, so a new content line in a choice should follow the real flow, not the prompt
 * (most games are all-dialogue except the prompts). With nothing before the seam we default to "line".
 */
export function prevBeatKind(doc: PMNode, beforePos: number): "line" | "prose" {
  let kind: "line" | "prose" = "line";
  doc.descendants((node, pos, parent) => {
    if (parent?.type.name === "optionprompt") return false; // a prompt cell is the choice label, not flow
    if (node.type.name === "line" || node.type.name === "prose") {
      if (pos < beforePos) kind = node.type.name; // the last such beat before the seam wins
      return false;
    }
    return true;
  });
  return kind;
}

/**
 * Does every step of `tr` stay inside one textblock (typing, a word deleted, a mark toggled)? Then no
 * node was added, removed, or replaced, so a decoration keyed to a node can simply be MAPPED through the
 * transaction instead of rebuilt by a document walk - the common keystroke. Anything else (a split, a
 * merge, an attribute change) answers false and the caller rebuilds.
 */
export function editsInsideTextblocks(tr: Transaction): boolean {
  return tr.steps.every((step, i) => {
    if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) return true;
    if (!(step instanceof ReplaceStep)) return false;
    const { from, to, slice } = step as unknown as { from: number; to: number; slice: import("prosemirror-model").Slice };
    let inline = slice.openStart === 0 && slice.openEnd === 0;
    slice.content.forEach((n) => { if (!n.isInline) inline = false; });
    if (!inline) return false;
    const doc = tr.docs[i]!;
    const $from = doc.resolve(from), $to = doc.resolve(to);
    return $from.sameParent($to) && $from.parent.inlineContent;
  });
}
