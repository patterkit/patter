// ---------------------------------------------------------------------------
// The project as a view extension reads it (tier 2, patterkit design/view-extensions.md): every node in the
// shell's one envelope, `{ id, kind, parent, label, host, ext, children? }`, built from the scene's model as
// the writer sees it (the surface's live model for the open scene, the saved source for the rest). Pure, so
// the envelope's fields are tested without a DOM; views.ts answers the protocol from it.
//
// The kinds are the manifest's: `project`, `scene`, `block`, `snippet`, `option`, `line`, `text`, and
// `gameEvent`. A group that isn't a choice's option has no manifest kind, so it is a node of kind `group`
// (which never carries extension data), there so the tree keeps the document's shape: its children are its
// snippets and groups. A choice is such a group, and its children are its options. An option's children are
// its prompt (a line or text beat), then its run. An option's prompt is the beat that holds the choice text.
//
// The host fields, by kind (the model's own names; `gameData` is always an object, `{}` for none):
//   project   name, cast [{ token, name }], qualifiers [{ gameId, name }], padAfterDefault (the project's
//             default pause, resolved), localiseDialogueText
//   scene     title, address, gameData, padAfterDefault (its own, when it sets one)
//   block     name, address, gameData, padAfterDefault (its own, when set)
//   group     role (choice, branch, sequence, or group), gameData, padAfterDefault (its own, when set)
//   snippet   gameData, padAfterDefault (its own, when set), padAfterEffective (what its lines take when
//             they set none)
//   option    text (the choice text), gameData, padAfterDefault (its own, when set)
//   line      character, qualifier (a gameId, or null), direction (or null), text, padAfter (the pause after
//             it as Patterplay resolves it, in seconds), padInherited (where that came from when the line
//             sets none: snippet, group, option, block, scene, project, or default), gameData
//   text      text, action (a direction to the people staging the scene, never shown), padAfter,
//             padInherited, gameData
//   gameEvent gameData (a game event is its gameData and nothing else)
// ---------------------------------------------------------------------------

import { DEFAULT_PAD_AFTER, effectiveGameId, textIsAction } from "@patterkit/model";
import type { Beat, Block, Group, Scene, Snippet } from "@patterkit/model";
import type { ViewJson, ViewNode } from "@wildwinter/app-shell";

/** Extension values by extension id: a node's `ext`. */
export type NodeExt = Record<string, Record<string, unknown>>;

/** What the project node says, from the open project. */
export interface ViewProjectFacts {
  /** The project's own node id (its project file's `project.id`), which project-level values are keyed by. */
  id: string;
  name: string;
  cast: readonly string[];
  /** Player-facing names in the source language, by cast name, where they differ. */
  castNames?: Readonly<Record<string, string>>;
  qualifiers: readonly { gameId: string; name: string }[];
  /** The project's default pause, resolved (the built-in default when it sets none). */
  padAfterDefault: number;
  localiseDialogueText: boolean;
  /** The project's own extension values, by extension id. */
  ext: NodeExt;
  /** The scenes in order, for the project's children. */
  scenes: readonly { id: string; name: string }[];
}

/** A scene as the writer sees it: its model, its source-language strings, and each node's extension values. */
export interface ViewScene {
  scene: Scene;
  strings: Readonly<Record<string, string>>;
  ext: Readonly<Record<string, NodeExt>>;
}

/** A node without its children, and its children's ids in document order. */
export interface IndexedNode {
  node: ViewNode;
  children: string[];
}

/** Every node of one scene by id, the scene's own included. */
export type SceneIndex = ReadonlyMap<string, IndexedNode>;

/** Where an inherited pause comes from, as the view is told it. */
export type PadFrom = "snippet" | "group" | "option" | "block" | "scene" | "project" | "default";

const clip = (text: string): string => { const t = text.replace(/\s+/g, " ").trim(); return t.length > 60 ? `${t.slice(0, 59)}…` : t; };
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
/** A value as a view may be handed it: JSON, deep-copied so a view never holds the editor's own objects. */
const json = (v: unknown): ViewJson => (v === undefined ? null : JSON.parse(JSON.stringify(v)) as ViewJson);
const gameData = (v: unknown): ViewJson => (v && typeof v === "object" && !Array.isArray(v) ? json(v) : {});
const ownPad = (v: unknown): { padAfterDefault?: number } => { const n = num(v); return n === undefined ? {} : { padAfterDefault: n }; };

/** The project node. Its children, when asked for, are the scenes (the caller supplies them). */
export function projectNode(p: ViewProjectFacts): ViewNode {
  return {
    id: p.id, kind: "project", parent: null, label: p.name,
    host: {
      name: p.name,
      cast: p.cast.map((token) => ({ token, name: p.castNames?.[token] ?? token })),
      qualifiers: p.qualifiers.map((q) => ({ gameId: q.gameId, name: q.name })),
      padAfterDefault: p.padAfterDefault,
      localiseDialogueText: p.localiseDialogueText,
    },
    ext: json(p.ext) as ViewNode["ext"],
  };
}

/**
 * Index one scene: every node by id, with its host fields, its extension values, and its children's ids in
 * document order. The pause after each line and text beat is resolved as Patterplay resolves it
 * (runtime/src/pads.ts): its own, else the nearest `padAfterDefault` above it (snippet, each group innermost
 * first, block, scene), else the project's; a snippet's last line or text beat never cuts in (a negative
 * pause there is none), and an option's prompt resolves through its option and is never clamped.
 */
export function indexScene(project: ViewProjectFacts, s: ViewScene): SceneIndex {
  const out = new Map<string, IndexedNode>();
  const { scene, strings } = s;
  const extOf = (id: string): ViewNode["ext"] => (json(s.ext[id] ?? {}) as ViewNode["ext"]);
  const words = (id: string): string => strings[id] ?? "";
  const action = textIsAction({ localiseDialogueText: project.localiseDialogueText }, scene);
  const add = (node: ViewNode, children: string[] = []): void => { out.set(node.id, { node, children }); };

  // The pause in force at each level: its value, and where it comes from.
  type Pad = { value: number; from: PadFrom };
  const projectPad: Pad = { value: project.padAfterDefault, from: project.padAfterDefault === DEFAULT_PAD_AFTER ? "default" : "project" };
  const under = (inherited: Pad, own: unknown, from: PadFrom): Pad => { const n = num(own); return n === undefined ? inherited : { value: n, from }; };

  const beat = (b: Beat, parent: string, pad: Pad, clamp: boolean, isPrompt: boolean): void => {
    const gd = gameData(b.gameData);
    if (b.kind === "gameEvent") {
      add({ id: b.id, kind: "gameEvent", parent, label: "Game event", host: { gameData: gd }, ext: extOf(b.id) });
      return;
    }
    const own = num(b.padAfter);
    let padAfter = own ?? pad.value;
    if (clamp && padAfter < 0) padAfter = 0;
    const timing = { padAfter, ...(own === undefined ? { padInherited: pad.from } : {}) };
    const text = words(b.id);
    if (b.kind === "line") {
      const who = b.character ?? "";
      add({
        id: b.id, kind: "line", parent, label: clip(who && text ? `${who}: ${text}` : who || text) || b.id,
        host: { character: who, qualifier: b.qualifier ?? null, direction: b.direction ?? null, text, ...timing, gameData: gd },
        ext: extOf(b.id),
      });
      return;
    }
    add({
      id: b.id, kind: "text", parent, label: clip(text) || b.id,
      host: { text, action: action && !isPrompt, ...timing, gameData: gd },
      ext: extOf(b.id),
    });
  };

  const snippet = (n: Snippet, parent: string, inherited: Pad): void => {
    const pad = under(inherited, n.padAfterDefault, "snippet");
    const beats = n.beats ?? [];
    let last = -1;
    beats.forEach((b, i) => { if (b.kind === "line" || b.kind === "text") last = i; });
    const first = beats[0];
    add({
      id: n.id, kind: "snippet", parent,
      label: (first && first.kind !== "gameEvent" ? clip(words(first.id)) : "") || n.id,
      host: { gameData: gameData(n.gameData), ...ownPad(n.padAfterDefault), padAfterEffective: pad.value },
      ext: extOf(n.id),
    }, beats.map((b) => b.id));
    beats.forEach((b, i) => beat(b, n.id, pad, i === last, false));
  };

  const group = (g: Group, parent: string, inherited: Pad, isOption: boolean): void => {
    const pad = under(inherited, g.padAfterDefault, isOption ? "option" : "group");
    const children = (g.children ?? []).map((c) => c.id);
    if (isOption) {
      const prompt = g.prompt;
      add({
        id: g.id, kind: "option", parent, label: (prompt ? clip(words(prompt.id)) : "") || g.id,
        host: { text: prompt ? words(prompt.id) : "", gameData: gameData(g.gameData), ...ownPad(g.padAfterDefault) },
        ext: extOf(g.id),
      }, [...(prompt ? [prompt.id] : []), ...children]);
      if (prompt) beat(prompt as Beat, g.id, pad, false, true);
    } else {
      const role = g.selector === "choice" || g.selector === "branch" || g.selector === "sequence" ? g.selector : "group";
      add({
        id: g.id, kind: "group", parent, label: role.charAt(0).toUpperCase() + role.slice(1),
        host: { role, gameData: gameData(g.gameData), ...ownPad(g.padAfterDefault) },
        ext: {},
      }, children);
    }
    for (const c of g.children ?? []) walk(c, g.id, pad, g.selector === "choice");
  };

  const walk = (n: Group | Snippet, parent: string, pad: Pad, inChoice: boolean): void => {
    if (n.type === "group") group(n, parent, pad, inChoice);
    else snippet(n, parent, pad);
  };

  const scenePad = under(projectPad, scene.padAfterDefault, "scene");
  add({
    id: scene.id, kind: "scene", parent: project.id, label: scene.name || scene.id,
    host: { title: scene.name, address: effectiveGameId(scene), gameData: gameData(scene.gameData), ...ownPad(scene.padAfterDefault) },
    ext: extOf(scene.id),
  }, scene.blocks.map((b) => b.id));
  for (const b of scene.blocks as Block[]) {
    const pad = under(scenePad, b.padAfterDefault, "block");
    add({
      id: b.id, kind: "block", parent: scene.id, label: b.name || b.id,
      host: { name: b.name, address: effectiveGameId(b), gameData: gameData(b.gameData), ...ownPad(b.padAfterDefault) },
      ext: extOf(b.id),
    }, (b.children ?? []).map((c) => c.id));
    for (const c of b.children ?? []) walk(c, b.id, pad, false);
  }
  return out;
}

/** A node from a scene's index, with its children in order when asked for (each without its own). */
export function nodeOf(index: SceneIndex, id: string, children: boolean): ViewNode | null {
  const found = index.get(id);
  if (!found) return null;
  if (!children) return found.node;
  return { ...found.node, children: found.children.map((c) => index.get(c)?.node).filter((n): n is ViewNode => n !== undefined) };
}
