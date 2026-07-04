// ---------------------------------------------------------------------------
// Shared zone/position helpers for the interaction commands. The keystroke
// modules all need to locate zones and beats by role / id and compute caret
// positions; keeping that math in one place (rather than re-deriving it per
// module) keeps the position arithmetic consistent and auditable.
// ---------------------------------------------------------------------------

import type { Node as PMNode } from "prosemirror-model";
import { newId } from "@patterkit/core";
import { patterSchema as S } from "./schema.js";

const ZONE_TYPES = new Set(["cue", "paren", "say"]);
const BEAT_TYPES = new Set(["line", "prose", "gameEvent"]);

/**
 * A fresh empty beat of `kind` - a dialogue `line` (optionally carrying a speaker) or a text
 * `prose`. The single source for "make a blank beat", shared by every creation command (groups,
 * special), so the cue/say node shape lives in exactly one place. A fresh id is minted per call
 * unless one is supplied (a split / jump carries its own).
 */
export function emptyBeatNode(kind: "line" | "prose", speaker = "", id: string = newId("L")): PMNode {
  if (kind === "prose") return S.node("prose", { id, raw: "{}" }, [S.node("say", null, [])]);
  return S.node("line", { id, raw: "{}" }, [S.node("cue", null, speaker ? [S.text(speaker)] : []), S.node("say", null, [])]);
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

/** All beat-level nodes (line/prose/gameEvent) in document order. (A jump is a snippet attr, not a beat.) */
export function beatList(doc: PMNode): BeatRef[] {
  const out: BeatRef[] = [];
  doc.descendants((node, pos) => {
    if (BEAT_TYPES.has(node.type.name)) { out.push({ node, pos }); return false; }
    return true;
  });
  return out;
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
