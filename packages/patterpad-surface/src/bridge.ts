// ---------------------------------------------------------------------------
// The model bridge - Patter scene (+ locale strings) <-> the ZONE-model
// ProseMirror doc. The load-bearing invariant is unchanged: ids survive every
// round-trip and unmodeled fields ride through via the `raw` overlay. New in the
// zone model: a dialogue beat's character / direction live in the cue / paren
// zones (bridging to LineBeat.character / .direction, flow), and a snippet's
// jump rides as the snippet's `jump` attr (a JSON Jump, bridging to
// Snippet.jump). Spoken / text content lives in the `say` zone, bridging to
// the locale string.
//
// `fmt` (the project's `formatting` setting) decides whether the say text carries
// inline bold / italic: ON, it is parsed from / serialized to the <b><i><bi> markup
// tags (format.ts); OFF, the string is byte-literal (what you type ships). The cue
// (a speaker name) and the paren (a direction) are never formatted.
// ---------------------------------------------------------------------------

import type { Node as PMNode } from "prosemirror-model";
import type { Scene, Block, Group, Snippet, Beat, Jump } from "@patterkit/model";
import { patterSchema as S } from "./schema.js";
import { parseMarkup, serializeMarkup } from "./format.js";

export type Strings = Record<string, string>;

/** The node kind a Patter extension's entries are keyed by, for each document node type that carries
 *  extension data (`ext`, schema.ts). A group is an `option` whatever its parent: only a choice's options
 *  take extension fields, and a group no longer in a choice still writes there, for validation to report
 *  as an orphan. A beat's kind follows its node type, so a line / text toggle moves its entry with it. */
const EXT_KIND: Readonly<Record<string, string>> = {
  doc: "scene", block: "block", snippet: "snippet", group: "option", line: "line", prose: "text", gameEvent: "gameEvent",
};

/** The extension kind a document node writes its `ext` under, or null for a node that carries none. */
export const extKindOf = (node: PMNode): string | null => EXT_KIND[node.type.name] ?? null;

/** A node's extension data as the document holds it: kind, model id, and the `ext` JSON string. */
export interface ExtValue { kind: string; id: string; value: string }

/** The `ext` string for a node, by its extension kind and id ("" for none). */
export type ExtLookup = (kind: string, id: string) => string;

const NO_EXT: ExtLookup = () => "";

/** The model id `ext` belongs to, and its kind, for a node that carries it. */
function extOf(node: PMNode, id: string | null | undefined, out: ExtValue[]): void {
  const value = node.attrs.ext as string | undefined;
  const kind = extKindOf(node);
  if (value && kind && typeof id === "string" && id) out.push({ kind, id, value });
}

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

/** The scene as an editor document. `ext` gives each node its extension data (load.ts builds it from the
 *  scene's shards); omitted, no node carries any. */
export function sceneToDoc(scene: Scene, strings: Strings, fmt = false, ext: ExtLookup = NO_EXT): PMNode {
  const c: ToDoc = { strings, fmt, ext };
  return S.node("doc", { raw: without(scene, "blocks"), ext: ext("scene", scene.id) }, scene.blocks.map((b) => blockToNode(b, c)));
}

interface ToDoc { strings: Strings; fmt: boolean; ext: ExtLookup }

function blockToNode(block: Block, c: ToDoc): PMNode {
  return S.node("block", { raw: without(block, "children"), ext: c.ext("block", block.id) }, block.children.map((ch) => chunkToNode(ch, c)));
}

/** A block / group child (snippet | group | unknown) to its PM node. */
function chunkToNode(ch: Group | Snippet, c: ToDoc): PMNode {
  if (ch.type === "snippet") return snippetToNode(ch, c);
  if (ch.type === "group") return groupToNode(ch, c);
  return S.node("rawnode", { json: JSON.stringify(ch) }); // a chunk the surface does not model
}

/** A group (recursive): everything but `children` (and an option's `prompt`) rides in `raw`. An
 *  option leads with its `prompt` as an `optionprompt` node; children rebuild from the tree. */
function groupToNode(group: Group, c: ToDoc): PMNode {
  const children = group.children.map((ch) => chunkToNode(ch, c));
  const content = group.prompt ? [promptToNode(group.prompt, c), ...children] : children;
  return S.node("group", { raw: without(group, "children", "prompt"), ext: c.ext("option", group.id) }, content);
}

/** A choice option's prompt beat -> an `optionprompt` node wrapping a line / prose beat. */
function promptToNode(prompt: Beat, c: ToDoc): PMNode {
  return S.node("optionprompt", null, [beatToNode(prompt, c)]);
}

function snippetToNode(snip: Snippet, c: ToDoc): PMNode {
  const beats = (snip.beats ?? []).map((b) => beatToNode(b, c));
  // The jump is a snippet-level value (a JSON Jump in the `jump` attr), not a beat.
  return S.node("snippet", { raw: without(snip, "beats", "jump"), jump: snip.jump ? JSON.stringify(snip.jump) : "", ext: c.ext("snippet", snip.id) }, beats);
}

function beatToNode(beat: Beat, c: ToDoc): PMNode {
  const { strings, fmt } = c;
  if (beat.kind === "line") {
    const children: PMNode[] = [zone("cue", beat.character ?? "", fmt)];
    if (beat.direction) children.push(zone("paren", beat.direction, fmt));
    children.push(zone("say", strings[beat.id] ?? "", fmt));
    return S.node("line", { id: beat.id, raw: without(beat, "id", "kind", "character", "direction"), ext: c.ext("line", beat.id) }, children);
  }
  if (beat.kind === "text") {
    return S.node("prose", { id: beat.id, raw: without(beat, "id", "kind"), ext: c.ext("text", beat.id) }, [zone("say", strings[beat.id] ?? "", fmt)]);
  }
  return S.node("gameEvent", { id: beat.id, raw: without(beat, "id", "kind"), ext: c.ext("gameEvent", beat.id) });
}

// --- ProseMirror -> Patter ---------------------------------------------------

/** The document back to its scene and strings, and every node's extension data (`ext`), in document
 *  order, for load.ts to split out to the extension shards. */
export function docToScene(doc: PMNode, fmt = false): { scene: Scene; strings: Strings; ext: ExtValue[] } {
  const c: FromDoc = { strings: {}, fmt, ext: [] };
  const scene = JSON.parse(doc.attrs.raw) as Scene;
  extOf(doc, scene.id, c.ext);
  scene.blocks = [];
  doc.forEach((blockNode) => scene.blocks.push(blockNodeToBlock(blockNode, c)));
  return { scene, strings: c.strings, ext: c.ext };
}

interface FromDoc { strings: Strings; fmt: boolean; ext: ExtValue[] }

function blockNodeToBlock(node: PMNode, c: FromDoc): Block {
  const block = JSON.parse(node.attrs.raw) as Block;
  block.type = "block"; // the PM node name is the authority - never trust `raw` for the discriminant
  extOf(node, block.id, c.ext);
  block.children = [];
  node.forEach((child) => block.children.push(chunkNodeToModel(child, c)));
  return block;
}

/** A block / group child PM node back to its model (snippet | group | unknown). */
function chunkNodeToModel(child: PMNode, c: FromDoc): Group | Snippet {
  if (child.type.name === "rawnode") return JSON.parse(child.attrs.json) as Group | Snippet;
  if (child.type.name === "group") return groupNodeToGroup(child, c);
  return snippetNodeToSnippet(child, c);
}

function groupNodeToGroup(node: PMNode, c: FromDoc): Group {
  const group = JSON.parse(node.attrs.raw) as Group;
  group.type = "group"; // the PM node name is the authority - never trust `raw` for the discriminant
  extOf(node, group.id, c.ext);
  group.children = [];
  node.forEach((child) => {
    if (child.type.name === "optionprompt") {
      const beat = child.firstChild; // the option's prompt (a line / prose beat, spec §5)
      if (beat) group.prompt = beatNodeToBeat(beat, c) as Group["prompt"];
    } else {
      group.children.push(chunkNodeToModel(child, c));
    }
  });
  return group;
}

function snippetNodeToSnippet(node: PMNode, c: FromDoc): Snippet {
  const snip = JSON.parse(node.attrs.raw) as Snippet & { jump?: Jump };
  snip.type = "snippet"; // the PM node name is the authority - never trust `raw` for the discriminant
  extOf(node, snip.id, c.ext);
  const beats: Beat[] = [];
  node.forEach((child) => beats.push(beatNodeToBeat(child, c)));
  if (beats.length > 0) snip.beats = beats; else delete snip.beats;
  const jumpRaw = node.attrs.jump as string;
  if (jumpRaw) snip.jump = JSON.parse(jumpRaw) as Jump; else delete snip.jump;
  return snip;
}

function beatNodeToBeat(node: PMNode, c: FromDoc): Beat {
  const { strings, fmt } = c;
  const id = node.attrs.id as string;
  const beat = JSON.parse(node.attrs.raw) as Record<string, unknown>;
  beat.id = id;
  extOf(node, id, c.ext);

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
