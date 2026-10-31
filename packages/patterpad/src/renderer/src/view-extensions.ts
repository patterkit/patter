// ---------------------------------------------------------------------------
// The editor's side of tier 2 view extensions (patterkit design/view-extensions.md): a view runs in a
// sandboxed window of its own, and main hands it a MessagePort straight to this renderer, which holds what
// the writer sees. Each port is answered by the shell's `hostView` from the adapter below, over the project
// as view-nodes.ts builds it: the open scene's unsaved state from the surface, the other scenes as saved.
//
// A write is the view's own extension's data, as ONE undo step with the view's label: in the open scene one
// transaction on the surface (one journal entry, carrying the label for Edit > Undo), on the project node one
// step of the project history. It is refused whole, with a sentence, for a node somewhere other than the open
// scene, a node that's gone, a value the inspector would refuse, a scene somebody else holds, or a shard
// somebody else holds (a node of it says `held`). The app tells every open view when the project changes, the selection moves, the
// theme changes, or a lock comes or goes.
// ---------------------------------------------------------------------------

import { hostViews } from "@wildwinter/app-shell";
import type { ViewAdapter, ViewEdit, ViewMediaLength, ViewNode, ViewRefusal, ViewSelection, ViewWritable } from "@wildwinter/app-shell";
import { estimateLineDuration } from "@patterkit/model"; // Patter's own rule, the one Play times a line by
import type { ValueAdapter } from "@wildwinter/app-shell/value-rows";
import type { ExtensionWrite, InspectorContext, SceneModel } from "@patterkit/patterpad-surface/surface";
import type { ExtensionDto, OpenedProject } from "../../shared/api.js";
import { lineMedia } from "../play/timing.js";
import { extensionScoped, valueProblem } from "./extension-rows.js";
import { indexScene, nodeOf, projectNode } from "./view-nodes.js";
import type { SceneIndex, ViewProjectFacts, ViewScene } from "./view-nodes.js";

/** What the adapter reads and does through the editor. */
export interface ViewHostDeps {
  project(): OpenedProject | null;
  /** The scene open in the editor, and its live model; null on the overview or the Properties page. */
  openScene(): { id: string; model: SceneModel } | null;
  /** Another scene as saved. */
  readScene(id: string): Promise<ViewScene>;
  /** The inspector's levels, innermost first. */
  selection(): InspectorContext | null;
  /** Why the open scene can't be changed (somebody else holds it), or null. */
  sceneLocked(): string | null;
  /** The sentence for an extension's shard in the open scene somebody else holds, or null. */
  extensionLocked(extension: string): string | null;
  /** The same for the project's own data for an extension. */
  projectExtensionLocked(extension: string): string | null;
  /** The project's nodes and lists, for checking a reference or a pick (the inspector's). */
  valueAdapter(): ValueAdapter;
  /** Apply edits in the open scene as one undo step with the label. */
  writeScene(extension: string, label: string, edits: readonly { id: string; field: string; value?: unknown }[]): ExtensionWrite;
  /** Replace the project's own entry for an extension, as one step of the project history with the label. */
  writeProject(extension: string, entry: Record<string, unknown>, label: string): Promise<{ ok: boolean; error?: string }>;
  /** Reveal and select a node, in `sceneId` when it isn't the open scene. */
  reveal(id: string, sceneId: string | null): Promise<boolean>;
  /** A line's recording's length in seconds, when it has one this machine can read. */
  recordedSeconds(id: string): Promise<number | null>;
  /** Play a beat's take as the inspector's ▶ does: whether it plays, or null when the project has no audio. */
  play(id: string): Promise<boolean | null>;
  /** Stop the take sounding: whether one was. */
  stop(): boolean;
  /** Run a key combination the view passed on. */
  key(combo: string): void;
}

/** The project facts the project node and every scene's pauses come from. */
function projectFacts(p: OpenedProject): ViewProjectFacts {
  const ext: Record<string, Record<string, unknown>> = {};
  for (const x of p.extensions ?? []) if (x.projectValues) ext[x.id] = x.projectValues;
  return {
    id: p.extensions?.[0]?.projectNode ?? "project",
    name: p.name, cast: p.cast, ...(p.castNames ? { castNames: p.castNames } : {}),
    qualifiers: p.qualifiers ?? [], padAfterDefault: p.padAfterDefault, localiseDialogueText: p.localiseDialogueText,
    ext, scenes: p.scenes.map((s) => ({ id: s.id, name: s.name })),
  };
}

const refuse = (code: ViewRefusal["code"], message: string): ViewRefusal => ({ code, message });

/** A node kind as the writer reads it in a sentence. */
const KIND_WORDS: Record<string, string> = {
  project: "the project", scene: "a scene", block: "a block", snippet: "a snippet", option: "an option", line: "a line",
  text: "a text line", gameEvent: "a game event", group: "a group",
};

/** The views' host: the shell's `hostViews` (one `hostView` per view window, replaced on a new port, dropped
 *  when its window closes) over this editor's adapter, and what the editor tells every open view. */
export interface ViewHost {
  /** Every view goes (the project closed or changed). */
  closeAll(): void;
  /** The project changed: these nodes, or anything. `saved` false says the other scenes are as they were
   *  (an edit in the open scene, a new recording), so they needn't be read again. */
  changed(nodes: readonly string[] | "all", opts?: { saved?: boolean }): void;
  selection(): void;
  theme(): void;
  writable(): void;
  /** The take sounding in the editor, by its beat's id, or null when it stops or ends. */
  playing(id: string | null): void;
  /** How many views are open (for tests). */
  readonly size: number;
}

/** Host every view main hands this editor. `target` is where the ports arrive: the window, but for tests. */
export function createViewHost(deps: ViewHostDeps, target?: Window): ViewHost {
  /** The other scenes, as read, by id; dropped whenever anything may have changed them. */
  let saved = new Map<string, Promise<SceneIndex>>();
  /** The open scene's index, and the model it was built from. */
  let live: { model: SceneModel; index: SceneIndex } | null = null;

  const facts = (): ViewProjectFacts | null => { const p = deps.project(); return p ? projectFacts(p) : null; };
  const extensionOf = (id: string): ExtensionDto | undefined => deps.project()?.extensions?.find((x) => x.id === id);

  const openIndex = (): { id: string; index: SceneIndex } | null => {
    const open = deps.openScene();
    const f = facts();
    if (!open || !f) return null;
    if (!live || live.model !== open.model) live = { model: open.model, index: indexScene(f, open.model) };
    return { id: open.id, index: live.index };
  };
  const savedIndex = (sceneId: string): Promise<SceneIndex> => {
    let hit = saved.get(sceneId);
    if (!hit) {
      hit = deps.readScene(sceneId).then((s) => indexScene(facts()!, s));
      hit.catch(() => saved.delete(sceneId));
      saved.set(sceneId, hit);
    }
    return hit;
  };
  /** The index holding a node, and its scene: the open scene first, then a scene by its id or its blocks', then
   *  the project's index of extension nodes, then every other scene as saved. */
  const locate = async (id: string): Promise<{ sceneId: string; index: SceneIndex; open: boolean } | null> => {
    const open = openIndex();
    if (open?.index.has(id)) return { sceneId: open.id, index: open.index, open: true };
    const p = deps.project();
    if (!p) return null;
    const candidates: string[] = [];
    const direct = p.scenes.find((s) => s.id === id || s.blocks.some((b) => b.id === id))?.id;
    if (direct) candidates.push(direct);
    for (const list of Object.values(p.extensionNodes ?? {})) { const n = list.find((x) => x.id === id); if (n?.scene) candidates.push(n.scene); }
    for (const s of p.scenes) candidates.push(s.id);
    for (const sceneId of new Set(candidates)) {
      if (sceneId === open?.id) continue;
      const index = await savedIndex(sceneId).catch(() => null);
      if (index?.has(id)) return { sceneId, index, open: false };
    }
    return null;
  };

  const sceneName = (id: string): string => deps.project()?.scenes.find((s) => s.id === id)?.name ?? id;

  const writable = (extension: string): ViewWritable => {
    if (!deps.project()) return { readOnly: true, why: "No project is open." };
    if (!extensionOf(extension)) return { readOnly: true, why: `This project doesn't take ${extension}, so a view can't change its data.` };
    // The scene somebody else holds. A shard of the extension's they hold isn't said here: a write to it is
    // refused `held`, with the lock's sentence, so the view can tell the two apart.
    const locked = deps.sceneLocked();
    return locked ? { readOnly: true, why: locked } : { readOnly: false };
  };

  /** Check every edit against the extension's declarations, as the inspector checks a value. */
  const checkEdits = (x: ExtensionDto, kindOf: (node: string) => string, edits: readonly ViewEdit[]): ViewRefusal | null => {
    const adapter = extensionScoped(deps.valueAdapter(), x);
    for (const e of edits) {
      const kind = kindOf(e.node);
      const decl = x.targets[kind]?.fields.find((f) => f.name === e.field);
      if (!decl) return refuse("bad-request", `${x.name} has no field called “${e.field}” on ${KIND_WORDS[kind] ?? kind}.`);
      if (e.value === undefined) continue;
      const problem = valueProblem(decl, e.value, adapter);
      if (problem) return refuse("bad-request", problem);
    }
    return null;
  };

  /**
   * The adapter for a view of `viewExtension`. A node whose data for it somebody else holds says so (`held`,
   * the lock's sentence): the open scene's nodes while its shard of the extension is held, and the project
   * node while the project's is. A scene's own lock is `writable`'s to say.
   */
  const adapterFor = (viewExtension: string): ViewAdapter => {
  const heldOn = (node: ViewNode, open: boolean): ViewNode => {
    const why = node.kind === "project" ? deps.projectExtensionLocked(viewExtension)
      : open && node.kind !== "group" ? deps.extensionLocked(viewExtension) : null;
    const out = why ? { ...node, held: why } : node;
    return node.children ? { ...out, children: node.children.map((c) => heldOn(c, open)) } : out;
  };
  return {
    host: "patter",
    project() {
      const f = facts();
      if (!f) throw new Error("No project is open.");
      return heldOn(projectNode(f), false);
    },
    async node(id, children) {
      const f = facts();
      if (!f) return null;
      if (id === f.id) {
        const node = heldOn(projectNode(f), false);
        if (!children) return node;
        const open = openIndex();
        const scenes = await Promise.all(f.scenes.map(async (s) => {
          const index = open?.id === s.id ? open.index : await savedIndex(s.id).catch(() => null);
          const scene = index ? nodeOf(index, s.id, false) : null;
          return scene ? heldOn(scene, open?.id === s.id) : null;
        }));
        return { ...node, children: scenes.filter((n): n is ViewNode => n !== null) };
      }
      const at = await locate(id);
      const node = at ? nodeOf(at.index, id, children) : null;
      return node && at ? heldOn(node, at.open) : null;
    },
    selection(): ViewSelection {
      const levels = deps.selection()?.levels ?? [];
      const path: { id: string; kind: string }[] = [];
      for (const l of levels) {
        if (l.kind === "multi" || !l.id) continue;
        const kind = l.kind === "leaf" ? (l.beat === "prose" ? "text" : l.beat)
          : l.kind === "group" ? (l.role === "option" ? "option" : "group") : l.kind;
        path.push({ id: l.id, kind });
      }
      return { path };
    },
    async media(ids): Promise<{ [id: string]: ViewMediaLength }> {
      const out: { [id: string]: ViewMediaLength } = {};
      for (const id of ids) {
        const at = await locate(id);
        const node = at?.index.get(id)?.node;
        if (!node || (node.kind !== "line" && node.kind !== "text")) continue;
        // Action text is a direction, never played: it takes no time, as in Play.
        if (node.kind === "text" && node.host["action"] === true) { out[id] = { seconds: 0, measured: false }; continue; }
        const recorded = node.kind === "line" ? await deps.recordedSeconds(id) : null;
        // The authored text is the project's main language, the one a line is spoken in.
        const p = deps.project();
        out[id] = lineMedia(recorded, estimateLineDuration(String(node.host["text"] ?? ""), p?.sourceLocale, p?.estimateSyllablesPerSecond));
      }
      return out;
    },
    async write(extension, label, edits) {
      const x = extensionOf(extension);
      if (!x) return refuse("read-only", `This project doesn't take ${extension}, so a view can't change its data.`);
      const f = facts()!;
      // A write is all on the project node or none of it (hostView refuses a mix): they undo separately.
      if (edits[0]?.node === f.id) {
        const bad = checkEdits(x, () => "project", edits);
        if (bad) return bad;
        const held = deps.projectExtensionLocked(extension);
        if (held) return refuse("held", held);
        const entry: Record<string, unknown> = { ...(x.projectValues ?? {}) };
        for (const e of edits) { if (e.value === undefined) delete entry[e.field]; else entry[e.field] = e.value; }
        const r = await deps.writeProject(extension, entry, label);
        return r.ok ? undefined : refuse("failed", r.error ?? "The project couldn't be written.");
      }
      const open = openIndex();
      for (const e of edits) {
        if (open?.index.has(e.node)) continue;
        const at = await locate(e.node);
        if (!at) return refuse("gone", `There's no node called ${e.node} in this project now.`);
        return refuse("read-only", `A view changes only the scene open in the editor. Open “${sceneName(at.sceneId)}” to change this.`);
      }
      const index = open!.index;
      const bad = checkEdits(x, (n) => index.get(n)!.node.kind, edits);
      if (bad) return bad;
      const locked = deps.sceneLocked();
      if (locked) return refuse("read-only", locked);
      const held = deps.extensionLocked(extension);
      if (held) return refuse("held", held);
      const done = deps.writeScene(extension, label, edits.map((e) => ({ id: e.node, field: e.field, ...(e.value !== undefined ? { value: e.value } : {}) })));
      if (done.ok) return undefined;
      return refuse(done.why, done.message);
    },
    async play(id) {
      const at = await locate(id);
      const kind = at?.index.get(id)?.node.kind;
      if (!at || (kind !== "line" && kind !== "text")) return refuse("gone", `There's no line called ${id} in this project now.`);
      const played = await deps.play(id);
      if (played === null) return refuse("unsupported", "Patterpad plays recordings in Audio Folders mode only: turn it on in Project Settings to hear takes.");
      return played;
    },
    stop: () => deps.stop(),
    async select(id) {
      const open = openIndex();
      if (open?.index.has(id)) return deps.reveal(id, null);
      const at = await locate(id);
      return at ? deps.reveal(id, at.sceneId) : false;
    },
    writable,
    missing: (extension) => extensionOf(extension)?.missing ?? [],
    key: (combo) => deps.key(combo),
  };
  };

  const views = hostViews((meta) => {
    const x = extensionOf(meta.extension);
    const view = x?.views?.find((v) => v.id === meta.view);
    return {
      adapter: adapterFor(meta.extension), reads: x?.reads ?? [],
      names: { extension: x?.name ?? meta.extension, view: view?.name ?? meta.view },
    };
  }, target ? { target } : {});

  let lockSig = "";
  return {
    closeAll() { views.close(); saved = new Map(); live = null; lockSig = ""; },
    changed(nodes, opts) {
      // The other scenes may have changed on disk (a project step, the scene just left): read them again. The
      // open scene's index holds the project's facts too (its default pause, its cast), so it's built again.
      if (opts?.saved !== false) saved = new Map();
      live = null;
      views.changed(nodes);
      // An extension taken or undone may meet a view's requirement, or take it away.
      views.missing();
    },
    selection: () => views.selection(),
    theme: () => views.theme(),
    playing: (id) => views.playing(id),
    // A lock came or went: the scene's is `writable`, a shard's is each node's `held`, so both are told. Version
    // control is polled, so only a lock that changed (or a scene switched to) is news.
    writable: () => {
      const sig = JSON.stringify([deps.openScene()?.id ?? null, deps.sceneLocked(),
        (deps.project()?.extensions ?? []).map((x) => [x.id, deps.extensionLocked(x.id), deps.projectExtensionLocked(x.id)])]);
      if (sig === lockSig) return;
      lockSig = sig;
      views.writable();
      views.changed("all");
    },
    get size() { return views.size; },
  };
}

/**
 * Recordings' lengths, measured once per take (`key`: its path and its line's text hash). A take that couldn't
 * be measured isn't remembered, so the next ask tries again; a measure that never settles counts as none
 * after `timeoutMs`.
 */
export function takeLengths(measure: (id: string) => Promise<number | null>, timeoutMs = 5000): (key: string, id: string) => Promise<number | null> {
  const cache = new Map<string, Promise<number | null>>();
  return (key, id) => {
    const hit = cache.get(key);
    if (hit) return hit;
    const run = new Promise<number | null>((res) => {
      const timer = setTimeout(() => res(null), timeoutMs);
      measure(id).then((n) => { clearTimeout(timer); res(n); }, () => { clearTimeout(timer); res(null); });
    });
    cache.set(key, run);
    void run.then((n) => { if (n === null && cache.get(key) === run) cache.delete(key); });
    return run;
  };
}
