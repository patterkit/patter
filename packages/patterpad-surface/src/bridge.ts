// ---------------------------------------------------------------------------
// The model bridge - Patter scene (+ locale strings) <-> the ZONE-model
// ProseMirror doc. The load-bearing invariant is unchanged: ids survive every
// round-trip and unmodeled fields ride through via the `raw` overlay. New in the
// zone model: a dialogue beat's character / direction live in the cue / paren
// zones (bridging to LineBeat.character / .direction, flow), and a snippet's
// jump rides as the snippet's `jump` attr (a JSON Jump, bridging to
// Snippet.jump). Spoken / narration content lives in the `say` zone, bridging to
// the locale string.
//
// `fmt` (the project's `formatting` setting) decides whether the say + paren text
// carries inline bold / italic: ON, it is parsed from / serialized to the <b><i><bi>
// markup tags (format.ts); OFF, the string is byte-literal (what you type ships).
// The cue (a speaker name) is never formatted.
// ---------------------------------------------------------------------------

import type { Node as PMNode } from "prosemirror-model";
import type { Scene, Block, Group, Snippet, Beat, Jump } from "@patterkit/model";
import { patterSchema as S } from "./schema.js";
import { parseMarkup, serializeMarkup } from "./format.js";

export type Strings = Record<string, string>;

/** A JSON copy of `obj` with the listed keys dropped (so the structure is rebuilt from the PM tree). */
function without(obj: object, ...keys: string[]): string {
  const copy = { ...obj } as Record<string, unknown>;
  for (const k of keys) delete copy[k];
  return JSON.stringify(copy);
}

/** Build a zone. Only the content zone (say) parses markup when formatting is on; the cue (a name)
 *  and the paren (a direction) are always plain. */
const zone = (name: "cue" | "paren" | "say", text: string, fmt: boolean): PMNode => {
  if (fmt && name === "say") return S.node(name, null, parseMarkup(text));
  return S.node(name, null, text.length > 0 ? [S.text(text)] : []);
};

/** Read a zone's stored text: serialize marks -> markup tags when formatting is on, else plain. */
const zoneText = (z: PMNode, fmt: boolean): string => (fmt ? serializeMarkup(z) : z.textContent);

// --- Patter -> ProseMirror ---------------------------------------------------

export function sceneToDoc(scene: Scene, strings: Strings, fmt = false): PMNode {
  return S.node("doc", { raw: without(scene, "blocks") }, scene.blocks.map((b) => blockToNode(b, strings, fmt)));
}

function blockToNode(block: Block, strings: Strings, fmt: boolean): PMNode {
  return S.node("block", { raw: without(block, "children") }, block.children.map((c) => chunkToNode(c, strings, fmt)));
}

/** A block / group child (snippet | group | unknown) to its PM node. */
function chunkToNode(c: Group | Snippet, strings: Strings, fmt: boolean): PMNode {
  if (c.type === "snippet") return snippetToNode(c, strings, fmt);
  if (c.type === "group") return groupToNode(c, strings, fmt);
  return S.node("rawnode", { json: JSON.stringify(c) }); // a chunk the surface does not model
}

/** A group (recursive): everything but `children` (and an option's `prompt`) rides in `raw`. An
 *  option leads with its `prompt` as an `optionprompt` node; children rebuild from the tree. */
function groupToNode(group: Group, strings: Strings, fmt: boolean): PMNode {
  const children = group.children.map((c) => chunkToNode(c, strings, fmt));
  const content = group.prompt ? [promptToNode(group.prompt, strings, fmt), ...children] : children;
  return S.node("group", { raw: without(group, "children", "prompt") }, content);
}

/** A choice option's prompt beat -> an `optionprompt` node wrapping a line / prose beat. */
function promptToNode(prompt: Beat, strings: Strings, fmt: boolean): PMNode {
  return S.node("optionprompt", null, [beatToNode(prompt, strings, fmt)]);
}

function snippetToNode(snip: Snippet, strings: Strings, fmt: boolean): PMNode {
  const beats = (snip.beats ?? []).map((b) => beatToNode(b, strings, fmt));
  // The jump is a snippet-level value (a JSON Jump in the `jump` attr), not a beat.
  return S.node("snippet", { raw: without(snip, "beats", "jump"), jump: snip.jump ? JSON.stringify(snip.jump) : "" }, beats);
}

function beatToNode(beat: Beat, strings: Strings, fmt: boolean): PMNode {
  if (beat.kind === "line") {
    const children: PMNode[] = [zone("cue", beat.character ?? "", fmt)];
    if (beat.direction) children.push(zone("paren", beat.direction, fmt));
    children.push(zone("say", strings[beat.id] ?? "", fmt));
    return S.node("line", { id: beat.id, raw: without(beat, "id", "kind", "character", "direction") }, children);
  }
  if (beat.kind === "text") {
    return S.node("prose", { id: beat.id, raw: without(beat, "id", "kind") }, [zone("say", strings[beat.id] ?? "", fmt)]);
  }
  return S.node("gameEvent", { id: beat.id, raw: without(beat, "id", "kind") });
}

// --- ProseMirror -> Patter ---------------------------------------------------

export function docToScene(doc: PMNode, fmt = false): { scene: Scene; strings: Strings } {
  const strings: Strings = {};
  const scene = JSON.parse(doc.attrs.raw) as Scene;
  scene.blocks = [];
  doc.forEach((blockNode) => scene.blocks.push(blockNodeToBlock(blockNode, strings, fmt)));
  return { scene, strings };
}

function blockNodeToBlock(node: PMNode, strings: Strings, fmt: boolean): Block {
  const block = JSON.parse(node.attrs.raw) as Block;
  block.type = "block"; // the PM node name is the authority - never trust `raw` for the discriminant
  block.children = [];
  node.forEach((child) => block.children.push(chunkNodeToModel(child, strings, fmt)));
  return block;
}

/** A block / group child PM node back to its model (snippet | group | unknown). */
function chunkNodeToModel(child: PMNode, strings: Strings, fmt: boolean): Group | Snippet {
  if (child.type.name === "rawnode") return JSON.parse(child.attrs.json) as Group | Snippet;
  if (child.type.name === "group") return groupNodeToGroup(child, strings, fmt);
  return snippetNodeToSnippet(child, strings, fmt);
}

function groupNodeToGroup(node: PMNode, strings: Strings, fmt: boolean): Group {
  const group = JSON.parse(node.attrs.raw) as Group;
  group.type = "group"; // the PM node name is the authority - never trust `raw` for the discriminant
  group.children = [];
  node.forEach((child) => {
    if (child.type.name === "optionprompt") {
      const beat = child.firstChild; // the option's prompt (a line / prose beat, spec §5)
      if (beat) group.prompt = beatNodeToBeat(beat, strings, fmt) as Group["prompt"];
    } else {
      group.children.push(chunkNodeToModel(child, strings, fmt));
    }
  });
  return group;
}

function snippetNodeToSnippet(node: PMNode, strings: Strings, fmt: boolean): Snippet {
  const snip = JSON.parse(node.attrs.raw) as Snippet & { jump?: Jump };
  snip.type = "snippet"; // the PM node name is the authority - never trust `raw` for the discriminant
  const beats: Beat[] = [];
  node.forEach((child) => beats.push(beatNodeToBeat(child, strings, fmt)));
  if (beats.length > 0) snip.beats = beats; else delete snip.beats;
  const jumpRaw = node.attrs.jump as string;
  if (jumpRaw) snip.jump = JSON.parse(jumpRaw) as Jump; else delete snip.jump;
  return snip;
}

function beatNodeToBeat(node: PMNode, strings: Strings, fmt: boolean): Beat {
  const id = node.attrs.id as string;
  const beat = JSON.parse(node.attrs.raw) as Record<string, unknown>;
  beat.id = id;

  if (node.type.name === "line") {
    beat.kind = "line";
    let character = "", direction = "", say = "";
    node.forEach((z) => {
      if (z.type.name === "cue") character = z.textContent; // a name is never formatted
      else if (z.type.name === "paren") direction = z.textContent; // a direction is never formatted
      else if (z.type.name === "say") say = zoneText(z, fmt);
    });
    if (character) beat.character = character; else delete beat.character;
    if (direction) beat.direction = direction; else delete beat.direction;
    if (say.length > 0) strings[id] = say;
  } else if (node.type.name === "prose") {
    beat.kind = "text";
    const sayNode = node.firstChild;
    const say = sayNode ? zoneText(sayNode, fmt) : "";
    if (say.length > 0) strings[id] = say;
  } else {
    beat.kind = "gameEvent";
  }
  return beat as unknown as Beat;
}
