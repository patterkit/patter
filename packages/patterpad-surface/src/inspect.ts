// ---------------------------------------------------------------------------
// The detail-inspector context stack (Patterpad.md §4). Resolves the caret to the
// full chain of containers it sits inside - the LEAF beat, the SNIPPET that holds
// it, every enclosing GROUP, and the BLOCK - innermost-first, each carrying the
// salient model data at that level (a line's character / direction / gameData; a
// snippet's condition / jump / effects; a group's selector / condition; a
// block's name). The host (the Patterpad renderer) renders one subpanel per level,
// most-specific at the top - "the data at every level of where you are, in one
// place". This is a READ projection over the live doc; it never mutates.
//
// It reads the same `raw` JSON each node round-trips (schema.ts) plus the live
// zone text (so an in-progress character / direction edit shows immediately),
// and labels groups through the shared grouplabel helper so the inspector wording
// matches the rail header exactly.
// ---------------------------------------------------------------------------

import { NodeSelection, type EditorState } from "prosemirror-state";
import type { Node as PMNode } from "prosemirror-model";
import type { Jump, Effect, GameData } from "@patterkit/model";
import { effectiveGameId } from "@patterkit/model";
import { cueText, zoneText, sayText, isChoiceGroup, rawAttr } from "./zoneutil.js";
import { groupLabel, groupRole, type GroupRole } from "./grouplabel.js";
import { multiSelectPositions } from "./multiselect.js";

export type LeafKind = "line" | "prose" | "gameEvent";

/** The beat under the caret (or the selected game-event atom). */
export interface LeafLevel {
  kind: "leaf";
  beat: LeafKind;
  id: string | null;
  /** line only - the speaker cue (live zone text). */
  character?: string;
  /** line only - the performance direction (live zone text). */
  direction?: string;
  gameData?: GameData;
  /** Author tags (#215) on this beat. */
  tags?: string[];
}

/** The snippet (bubble) holding the leaf: its routing + eligibility + effects. */
export interface SnippetLevel {
  kind: "snippet";
  id: string | null;
  condition?: string;
  jump?: Jump;
  onEnter?: Effect[];
  onExit?: Effect[];
  secretUntilEligible?: boolean;
  gameData?: GameData;
  /** Author tags (#215) on this snippet. */
  tags?: string[];
  /** Beats in the snippet; 0 = a pure-jump / un-entered bubble. */
  beatCount: number;
}

/** One option of a choice (for the consolidated choice editor): its prompt text + eligibility. */
export interface OptionSummary {
  id: string | null;
  /** The option's prompt (choice text), from its optionprompt cell. */
  prompt: string;
  condition?: string;
  secret: boolean;
  /** Repeatable (spec §5): default false = once-only (gone after one use). */
  sticky: boolean;
  /** The choice's fallback (spec §5): auto-followed when it is the only one left. */
  fallback: boolean;
}

/** An enclosing group: its selector behaviour + eligibility (there may be several, nested). */
export interface GroupLevel {
  kind: "group";
  id: string | null;
  role: GroupRole;
  /** The same human label the rail header shows (e.g. "sequence · shuffle · once"). */
  label: string;
  condition?: string;
  selector?: string;
  order?: string;
  exhaust?: string;
  shared?: boolean;
  secretUntilEligible?: boolean;
  /** Option-position (spec §5): repeatable (default false = once-only). */
  sticky?: boolean;
  /** Option-position (spec §5): the choice's fallback (auto-followed when last). */
  fallback?: boolean;
  /** For a `choice`: its options, in order (the consolidated options editor). */
  options?: OptionSummary[];
  /** For a Best-match (`order: "specificity"`) sequence: how many direct children carry a condition.
   *  Zero means the group degenerates to a plain shuffle (drives the inspector's soft nudge). */
  conditionedChildren?: number;
  gameData?: GameData;
  /** Author tags (#215) on this group. */
  tags?: string[];
}

/** The block the caret is in. */
export interface BlockLevel {
  kind: "block";
  id: string | null;
  name: string;
  /** The author-pinned address, if any (undefined = derived from the name). */
  gameId?: string;
  /** The effective host-facing address (pinned gameId, else the name slug). */
  address: string;
  gameData?: GameData;
  /** Author tags (#215) on this block. */
  tags?: string[];
}

/** The scene the caret is in (the outermost level shown). */
export interface SceneLevel {
  kind: "scene";
  id: string | null;
  name: string;
  gameId?: string;
  address: string;
  gameData?: GameData;
  /** Author tags (#215) on this scene. */
  tags?: string[];
}

/** Several whole chunks are selected at once (a shift-click run, groups §6) - the inspector shows a
 *  summary ("N snippets selected") instead of a single node's fields. */
export interface MultiLevel {
  kind: "multi";
  /** Total chunks in the run. */
  count: number;
  /** How many are snippets vs groups (for a precise label). */
  snippets: number;
  groups: number;
}

export type InspectLevel = LeafLevel | SnippetLevel | GroupLevel | BlockLevel | SceneLevel | MultiLevel;

/** The selection's container chain, innermost-first (leaf -> snippet -> group(s) -> block). */
export interface InspectorContext {
  levels: InspectLevel[];
}

const EMPTY: InspectorContext = { levels: [] };

/** Parse a node's `raw` attr (the round-tripped model object minus rebuilt parts); {} on failure. */
const idAttr = (node: PMNode): string | null => (typeof node.attrs.id === "string" ? node.attrs.id : null);
const rawId = (raw: Record<string, unknown>): string | null => (typeof raw.id === "string" ? raw.id : null);
const gd = (raw: Record<string, unknown>): GameData | undefined =>
  raw.gameData && typeof raw.gameData === "object" ? (raw.gameData as GameData) : undefined;
/** Author tags (#215) from a node's raw, or undefined when none. */
const tagsOf = (raw: Record<string, unknown>): string[] | undefined =>
  Array.isArray(raw.tags) && raw.tags.length ? (raw.tags as string[]) : undefined;

function leafLevel(beat: PMNode): LeafLevel {
  const beatKind = beat.type.name as LeafKind;
  const raw = rawAttr(beat);
  const base: LeafLevel = { kind: "leaf", beat: beatKind, id: idAttr(beat), gameData: gd(raw), tags: tagsOf(raw) };
  if (beatKind === "line") {
    const character = cueText(beat);
    const direction = zoneText(beat, "paren");
    if (character) base.character = character;
    if (direction) base.direction = direction;
  }
  return base;
}

function snippetLevel(node: PMNode): SnippetLevel {
  const raw = rawAttr(node);
  const level: SnippetLevel = { kind: "snippet", id: rawId(raw) ?? idAttr(node), beatCount: node.childCount };
  if (typeof raw.condition === "string" && raw.condition) level.condition = raw.condition;
  if (Array.isArray(raw.onEnter) && raw.onEnter.length) level.onEnter = raw.onEnter as Effect[];
  if (Array.isArray(raw.onExit) && raw.onExit.length) level.onExit = raw.onExit as Effect[];
  if (raw.secretUntilEligible === true) level.secretUntilEligible = true;
  const gameData = gd(raw); if (gameData) level.gameData = gameData;
  const tags = tagsOf(raw); if (tags) level.tags = tags;
  // The jump is a snippet ATTR (a JSON Jump, or "" for none), not part of `raw`.
  const jumpAttr = node.attrs.jump as string;
  if (jumpAttr) { try { level.jump = JSON.parse(jumpAttr) as Jump; } catch { /* ignore */ } }
  return level;
}

function groupLevel(node: PMNode, parent: PMNode | null): GroupLevel {
  const raw = rawAttr(node);
  // An option is recognised by its CONTAINER being a choice group (the bridge strips `prompt` from raw).
  const option = isChoiceGroup(parent);
  const level: GroupLevel = option
    ? { kind: "group", id: rawId(raw) ?? idAttr(node), role: "option", label: "◇ option" }
    : { kind: "group", id: rawId(raw) ?? idAttr(node), role: groupRole(raw), label: groupLabel(raw) };
  if (typeof raw.condition === "string" && raw.condition) level.condition = raw.condition;
  if (typeof raw.selector === "string") level.selector = raw.selector;
  const opts = raw.options as { order?: string; exhaust?: string } | undefined;
  if (opts?.order) level.order = opts.order;
  if (opts?.exhaust) level.exhaust = opts.exhaust;
  if (raw.shared === true) level.shared = true;
  if (raw.secretUntilEligible === true) level.secretUntilEligible = true;
  if (raw.sticky === true) level.sticky = true;
  if (raw.fallback === true) level.fallback = true;
  const gameData = gd(raw); if (gameData) level.gameData = gameData;
  const tags = tagsOf(raw); if (tags) level.tags = tags;
  if (level.role === "choice") {
    const options: OptionSummary[] = [];
    node.forEach((child) => { if (child.type.name === "group") options.push(optionSummary(child)); });
    level.options = options;
  }
  // Best match degenerates to a plain shuffle with no conditioned children: count them for the nudge.
  if (level.order === "specificity") {
    let conditioned = 0;
    node.forEach((child) => {
      if (child.type.name !== "snippet" && child.type.name !== "group") return;
      const cr = rawAttr(child);
      if (typeof cr.condition === "string" && cr.condition) conditioned++;
    });
    level.conditionedChildren = conditioned;
  }
  return level;
}

/** The prompt (choice text) of an option, read from its optionprompt cell's say zone. */
function optionPromptText(optionNode: PMNode): string {
  let text = "";
  optionNode.forEach((child) => {
    if (child.type.name !== "optionprompt") return;
    child.forEach((beat) => { text = sayText(beat); });
  });
  return text;
}

function optionSummary(optionNode: PMNode): OptionSummary {
  const raw = rawAttr(optionNode);
  return {
    id: rawId(raw) ?? idAttr(optionNode),
    prompt: optionPromptText(optionNode),
    condition: typeof raw.condition === "string" && raw.condition ? raw.condition : undefined,
    secret: raw.secretUntilEligible === true,
    sticky: raw.sticky === true,
    fallback: raw.fallback === true,
  };
}

const gameIdOf = (raw: Record<string, unknown>): string | undefined =>
  typeof raw.gameId === "string" && raw.gameId ? raw.gameId : undefined;

function blockLevel(node: PMNode): BlockLevel {
  const raw = rawAttr(node);
  const name = typeof raw.name === "string" ? raw.name : "";
  const gameId = gameIdOf(raw);
  return { kind: "block", id: rawId(raw) ?? idAttr(node), name, gameId, address: effectiveGameId({ gameId, name }), gameData: gd(raw), tags: tagsOf(raw) };
}

function sceneLevel(doc: PMNode): SceneLevel {
  const raw = rawAttr(doc);
  const name = typeof raw.name === "string" ? raw.name : "";
  const gameId = gameIdOf(raw);
  return { kind: "scene", id: rawId(raw), name, gameId, address: effectiveGameId({ gameId, name }), gameData: gd(raw), tags: tagsOf(raw) };
}

/**
 * Build the container chain for the current selection, innermost-first. Climbs the
 * caret's ancestor depths (leaf -> snippet -> group(s) -> block); when an action
 * atom is node-selected (no caret inside it) the leaf is taken from the selected
 * node and the chain from its position's ancestors.
 */
export function inspect(state: EditorState): InspectorContext {
  // A multi-chunk selection (groups §6) is its own thing: show a count, not one node's fields.
  const multi = multiSelectPositions(state);
  if (multi.length >= 2) {
    let snippets = 0;
    for (const p of multi) { if (state.doc.nodeAt(p)?.type.name === "snippet") snippets++; }
    return { levels: [{ kind: "multi", count: multi.length, snippets, groups: multi.length - snippets }] };
  }

  const { $head } = state.selection;
  const selNode = state.selection instanceof NodeSelection ? state.selection.node : undefined;
  const levels: InspectLevel[] = [];
  let sawLeaf = false;

  for (let d = $head.depth; d >= 0; d--) {
    const node = $head.node(d);
    switch (node.type.name) {
      case "line": case "prose": case "gameEvent": levels.push(leafLevel(node)); sawLeaf = true; break;
      case "snippet": levels.push(snippetLevel(node)); break;
      case "group": levels.push(groupLevel(node, d > 0 ? $head.node(d - 1) : null)); break;
      case "block": levels.push(blockLevel(node)); break;
      case "doc": levels.push(sceneLevel(node)); break; // the scene (outermost level)
      default: break; // zone / optionprompt - not an inspector level
    }
  }

  // A node-selected chunk / block isn't an ancestor of $head; surface it as the innermost level. An atom
  // beat (game event) becomes the leaf; a node-selected snippet / group / block (clicking a jump-only bubble's
  // chip, a group's rail head, or a block heading) becomes its own level - $head's climb already supplied
  // the ancestors ABOVE the selected node (its group / block / scene), so we just prepend the focus.
  if (selNode) {
    const n = selNode.type.name;
    if (!sawLeaf && (n === "gameEvent" || n === "line" || n === "prose")) {
      levels.unshift(leafLevel(selNode));
    } else if (n === "snippet" && !levels.some((l) => l.kind === "snippet")) {
      levels.unshift(snippetLevel(selNode));
    } else if (n === "group") {
      levels.unshift(groupLevel(selNode, $head.parent)); // parent = the group's container (option detection)
    } else if (n === "block") {
      levels.unshift(blockLevel(selNode));
    }
  }

  return levels.length ? { levels } : EMPTY;
}

/** The scene-only inspector context: the scene title sits OUTSIDE the editable flow, so clicking it
 *  can't move the caret; the surface calls this to focus the inspector on the whole scene instead. */
export function inspectScene(state: EditorState): InspectorContext {
  return { levels: [sceneLevel(state.doc)] };
}
