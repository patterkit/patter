// ---------------------------------------------------------------------------
// The selection -> zone context (Z2), rebuilt for the zone model. Resolves the
// cursor to its zone (cue / paren / say), the enclosing beat (line / prose /
// action), and the snippet / block, with caret metrics and the structural flags
// the keystroke + navigation layers need. This is the single state model the
// key-dispatch AND the hint bar read (spec section 16) - never a second, drifting
// table. (A snippet's jump is a snippet attr, not a beat - never under the caret.)
//
// Doc shape: doc > block > snippet > (line > cue|paren|say | prose > say |
// action). A caret in a zone's text sits at the zone's depth.
// ---------------------------------------------------------------------------

import { NodeSelection, type EditorState } from "prosemirror-state";
import type { Node as PMNode, ResolvedPos } from "prosemirror-model";

export type ZoneRole = "cue" | "paren" | "say";
export type BeatKind = "line" | "prose" | "gameEvent";

export interface NodeCtx { node: PMNode; pos: number; depth: number; index: number }

export interface ZoneCtx {
  role: ZoneRole;
  node: PMNode;
  /** Position directly before the zone node. */
  pos: number;
  /** Caret offset within the zone. */
  offset: number;
  textLen: number;
  atStart: boolean;
  atEnd: boolean;
  /** Index of this zone among its beat's zones (cue=0 ...). */
  indexInBeat: number;
  /** Is this the first / last zone of its beat. */
  isFirstZone: boolean;
  isLastZone: boolean;
}

export interface BeatCtx extends NodeCtx {
  kind: BeatKind;
  id: string | null;
}

export interface ZoneState {
  zone: ZoneCtx | null;          // null when a non-zone node (action/jump atom) is selected
  beat: BeatCtx | null;
  snippet: NodeCtx | null;
  block: NodeCtx | null;
  firstBeatInSnippet: boolean;
  firstSnippetInBlock: boolean;   // first among its IMMEDIATE container's children (block OR group)
  /** The snippet's immediate container is a group (so block-merge stays inside it). */
  inGroup: boolean;
  hasDirection: boolean;
  /** The caret is inside a choice option's PROMPT cell (a single-line field, not a snippet). */
  inPrompt: boolean;
}

const BEAT_TYPES = new Set(["line", "prose", "gameEvent"]);
const ZONE_TYPES = new Set(["cue", "paren", "say"]);

function ancestorWhere($pos: ResolvedPos, pred: (n: PMNode) => boolean): NodeCtx | null {
  for (let d = $pos.depth; d >= 1; d--) {
    const node = $pos.node(d);
    if (pred(node)) return { node, pos: $pos.before(d), depth: d, index: $pos.index(d - 1) };
  }
  return null;
}

/** The ordered zone child nodes of a line/prose beat. */
export function zonesOf(beat: PMNode): Array<{ role: ZoneRole; node: PMNode; indexInBeat: number }> {
  const out: Array<{ role: ZoneRole; node: PMNode; indexInBeat: number }> = [];
  beat.forEach((child, _offset, i) => {
    if (ZONE_TYPES.has(child.type.name)) out.push({ role: child.type.name as ZoneRole, node: child, indexInBeat: i });
  });
  return out;
}

const beatKind = (typeName: string): BeatKind => typeName as BeatKind;

export function context(state: EditorState): ZoneState {
  const { $head } = state.selection;

  const zoneCtx = ancestorWhere($head, (n) => ZONE_TYPES.has(n.type.name));
  // A beat ancestor (line/prose), or - for an atom selection - the selected node.
  let beatCtx = ancestorWhere($head, (n) => BEAT_TYPES.has(n.type.name));
  const selNode = state.selection instanceof NodeSelection ? state.selection.node : undefined;
  if (!beatCtx && selNode && BEAT_TYPES.has(selNode.type.name)) {
    const $from = state.selection.$from;
    beatCtx = { node: selNode, pos: state.selection.from, depth: $from.depth + 1, index: $from.index($from.depth) };
  }
  const snippetCtx = ancestorWhere($head, (n) => n.type.name === "snippet");
  const blockCtx = ancestorWhere($head, (n) => n.type.name === "block");
  const inPrompt = ancestorWhere($head, (n) => n.type.name === "optionprompt") !== null;

  let zone: ZoneCtx | null = null;
  if (zoneCtx && beatCtx) {
    const zones = zonesOf(beatCtx.node);
    const idx = zones.findIndex((z) => z.node === zoneCtx.node);
    const textLen = zoneCtx.node.content.size;
    const offset = $head.parent.type.name === zoneCtx.node.type.name ? $head.parentOffset : 0;
    zone = {
      role: zoneCtx.node.type.name as ZoneRole,
      node: zoneCtx.node, pos: zoneCtx.pos, offset, textLen,
      atStart: offset === 0, atEnd: offset === textLen,
      indexInBeat: idx, isFirstZone: idx === 0, isLastZone: idx === zones.length - 1,
    };
  }

  const beat: BeatCtx | null = beatCtx && {
    ...beatCtx, kind: beatKind(beatCtx.node.type.name), id: (beatCtx.node.attrs.id as string | undefined) ?? null,
  };

  return {
    zone,
    beat,
    snippet: snippetCtx,
    block: blockCtx,
    firstBeatInSnippet: beat !== null && beat.index === 0,
    firstSnippetInBlock: snippetCtx !== null && snippetCtx.index === 0,
    inGroup: snippetCtx !== null && $head.node(snippetCtx.depth - 1)?.type.name === "group",
    hasDirection: beat !== null && beat.kind === "line" && zonesOf(beat.node).some((z) => z.role === "paren"),
    inPrompt,
  };
}
