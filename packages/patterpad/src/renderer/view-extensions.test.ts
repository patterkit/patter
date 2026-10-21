// @vitest-environment jsdom
// Tier 2 view extensions in the editor (patterkit design/view-extensions.md): the project as a view reads it
// (view-nodes.ts: the envelope, the host fields per kind, the pause as Patterplay resolves it), and the
// adapter answering a view over a real MessagePort through the shell's `hostView`, on ops' probe project
// with the surface mounted on its scene: hello, a node, the selection, media, a labelled write as one undo
// step, and the writes it refuses.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MessageChannel } from "node:worker_threads";
import { parseSource } from "@patterkit/core";
import { parseManifest } from "@wildwinter/toolkit/extensions";
import { VIEW_API, VIEW_PORT_MESSAGE } from "@wildwinter/app-shell/view-protocol";
import type { HostToView, ViewNode, ViewPortMeta } from "@wildwinter/app-shell/view-protocol";
import type { Bundle, FlowFile, LocaleFile, ProjectFile, Scene } from "@patterkit/model";
import { mountSurface, type SurfaceHandle } from "@patterkit/patterpad-surface/surface";
import { buildPadIndex } from "../../../runtime/src/pads.js";
import { extensionDtos } from "../shared/extensions.js";
import { extensionAdapter } from "./src/extension-rows.js";
import { indexScene, nodeOf, projectNode, type ViewProjectFacts } from "./src/view-nodes.js";
import { createViewHost, takeLengths, type ViewHostDeps } from "./src/view-extensions.js";
import type { OpenedProject } from "../shared/api.js";

const root = resolve(process.cwd(), "packages/ops/test/fixtures/probe-extension.patter") + "/";
const file = (p: string): string => readFileSync(root + p, "utf8");
type Obj = Record<string, unknown>;

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  (HTMLElement.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
});

const projectFile = parseSource(file("probe.patterproj")) as ProjectFile;
const extensions = extensionDtos(projectFile, new Map([["probe", parseManifest(file("extensions/probe.extension.json"))]]),
  new Map([["probe", parseSource(file("extensions/probe/_project.patterextension"))]]))!;
const project: OpenedProject = {
  name: "Probe", root: "/x", formatting: true, voiced: false, trackAudioStatus: false, cast: ["ANNA", "BEN"],
  castNames: { ANNA: "Anna" }, qualifiers: [{ gameId: "os", name: "O.S." }], padAfterDefault: 0.6, localiseDialogueText: false,
  gameDataFields: {}, scenes: [{ id: "scn_harbour", name: "The Harbour", blocks: [{ id: "b_dock", name: "The Dock" }] }, { id: "scn_quay", name: "The Quay", blocks: [] }],
  sceneIds: ["scn_harbour", "scn_quay"], extensions,
} as unknown as OpenedProject;
const facts: ViewProjectFacts = {
  id: "proj_probe", name: "Probe", cast: project.cast, castNames: { ANNA: "Anna" }, qualifiers: project.qualifiers,
  padAfterDefault: 0.6, localiseDialogueText: false, ext: {}, scenes: [{ id: "scn_harbour", name: "The Harbour" }],
};
const shardExt = (): Record<string, Record<string, Obj>> => {
  const out: Record<string, Record<string, Obj>> = {};
  const entries = (parseSource(file("extensions/probe/harbour.patterextension")) as { entries: Record<string, Record<string, Obj>> }).entries;
  for (const byNode of Object.values(entries)) for (const [id, e] of Object.entries(byNode)) out[id] = { probe: e };
  return out;
};

describe("the project as a view reads it", () => {
  const scene = (parseSource(file("scenes/harbour.patterflow")) as FlowFile).scene;
  const strings = (parseSource(file("loc/en/harbour.patterloc")) as LocaleFile).strings;
  const index = indexScene(facts, { scene, strings, ext: shardExt() });

  it("gives every node its kind, parent, label, host fields, and extension values", () => {
    expect(projectNode(facts)).toEqual({
      id: "proj_probe", kind: "project", parent: null, label: "Probe", ext: {},
      host: {
        name: "Probe", cast: [{ token: "ANNA", name: "Anna" }, { token: "BEN", name: "BEN" }],
        qualifiers: [{ gameId: "os", name: "O.S." }], padAfterDefault: 0.6, localiseDialogueText: false,
      },
    });
    expect(nodeOf(index, "L_bell", false)).toMatchObject({
      kind: "line", parent: "sn_open", label: "ANNA: Ring the bell.",
      host: { character: "ANNA", qualifier: null, direction: null, text: "Ring the bell.", padAfter: 0.6, padInherited: "default", gameData: { delivery: "tense" } },
      ext: { probe: { note: "Ring it twice." } },
    });
    expect(nodeOf(index, "T_tide", false)).toMatchObject({ kind: "text", host: { text: "The tide turns.", action: true }, ext: { probe: { style: "far" } } });
    expect(nodeOf(index, "E_horn", false)).toEqual({ id: "E_horn", kind: "gameEvent", parent: "sn_open", label: "Game event", host: { gameData: {} }, ext: { probe: { cue: "horn" } } });
    expect(nodeOf(index, "scn_harbour", false)).toMatchObject({ kind: "scene", parent: "proj_probe", host: { title: "The Harbour", address: "the-harbour", gameData: {} }, ext: { probe: { theme: "salt" } } });
    expect(nodeOf(index, "b_dock", false)).toMatchObject({ kind: "block", host: { name: "The Dock", address: "the-dock" }, ext: { probe: { pace: 2 } } });
    expect(nodeOf(index, "sn_open", false)).toMatchObject({ kind: "snippet", label: "Ring the bell.", host: { gameData: {}, padAfterEffective: 0.6 } });
    // An option's prompt is the choice text, never action; the option sits in its choice, a group.
    expect(nodeOf(index, "o_stay", false)).toMatchObject({ kind: "option", parent: "g_pick", label: "Stay a while.", host: { text: "Stay a while." }, ext: { probe: { icon: "anchor" } } });
    expect(nodeOf(index, "P_stay", false)).toMatchObject({ kind: "text", parent: "o_stay", host: { action: false } });
    expect(nodeOf(index, "g_pick", false)).toMatchObject({ kind: "group", parent: "b_dock", label: "Choice", host: { role: "choice" }, ext: {} });
  });

  it("lists children in document order: block, snippet and group, choice and option", () => {
    const ids = (id: string): string[] => nodeOf(index, id, true)!.children!.map((c: ViewNode) => c.id);
    expect(ids("scn_harbour")).toEqual(["b_dock"]);
    expect(ids("b_dock")).toEqual(["sn_open", "g_pick"]);
    expect(ids("sn_open")).toEqual(["L_bell", "L_reply", "T_tide", "E_horn"]);
    expect(ids("g_pick")).toEqual(["o_stay", "o_go"]);
    expect(ids("o_go")).toEqual(["P_go", "sn_go"]);
    expect(nodeOf(index, "nope", true)).toBeNull();
  });

  it("resolves each pause as Patterplay does, saying where an inherited one comes from", () => {
    const padded = structuredClone(scene) as Scene & { blocks: { padAfterDefault?: number; children: { beats?: { padAfter?: number }[]; padAfterDefault?: number }[] }[] };
    padded.blocks[0]!.padAfterDefault = 0.3;
    padded.blocks[0]!.children[0]!.beats![1]!.padAfter = -0.2; // a cut-in, kept: not the snippet's last line
    padded.blocks[0]!.children[0]!.beats![2]!.padAfter = -0.5; // the last line or text: never cuts in
    (padded.blocks[0]!.children[1] as { padAfterDefault?: number }).padAfterDefault = 1.5;
    const ix = indexScene({ ...facts, padAfterDefault: 0.9 }, { scene: padded as Scene, strings, ext: {} });
    const pads = buildPadIndex({ padAfterDefault: 0.9, scenes: { [scene.id]: padded } } as unknown as Bundle);
    for (const id of ["L_bell", "L_reply", "T_tide", "P_stay", "P_go"]) {
      expect(nodeOf(ix, id, false)!.host["padAfter"], id).toBe(pads.get(id)!.resolved);
    }
    expect(nodeOf(ix, "L_bell", false)!.host["padInherited"]).toBe("block");
    expect(nodeOf(ix, "L_reply", false)!.host["padInherited"]).toBeUndefined();
    expect(nodeOf(ix, "P_go", false)!.host["padInherited"]).toBe("group");
    expect(nodeOf(ix, "sn_open", false)!.host).toMatchObject({ padAfterEffective: 0.3 });
    expect(nodeOf(ix, "b_dock", false)!.host).toMatchObject({ padAfterDefault: 0.3 });
  });
});

// --- the adapter over a port ------------------------------------------------------------------------------

function mount(): SurfaceHandle {
  const editor = document.createElement("div"); document.body.appendChild(editor);
  (editor as unknown as { scrollTo: () => void }).scrollTo = () => undefined;
  return mountSurface({
    editor, flowSource: file("scenes/harbour.patterflow"), locSource: file("loc/en/harbour.patterloc"),
    extensions: [{ id: "probe", source: file("extensions/probe/harbour.patterextension"), live: true }], hostUndo: true,
  });
}

/** The editor's side, as renderer.ts wires it, over a mounted surface; `state` is what the test changes. */
function host(s: SurfaceHandle) {
  const state = { project, sceneLocked: null as string | null, held: null as string | null, revealed: [] as string[], keys: [] as string[], labels: [] as string[],
    audio: true, played: [] as string[], stops: 0 };
  const deps: ViewHostDeps = {
    project: () => state.project,
    openScene: () => ({ id: "scn_harbour", model: s.model() }),
    readScene: async () => ({
      scene: { id: "scn_quay", type: "scene", name: "The Quay", blocks: [{ id: "b_quay", type: "block", name: "Quay", children: [
        { id: "sn_q", type: "snippet", beats: [{ id: "L_far", kind: "line", character: "BEN" }] }] }] } as Scene,
      strings: { L_far: "Far off." }, ext: {},
    }),
    selection: () => s.selectionContext(),
    sceneLocked: () => state.sceneLocked,
    extensionLocked: () => state.held,
    projectExtensionLocked: () => null,
    valueAdapter: () => extensionAdapter({ cast: ["ANNA", "BEN"], scenes: project.scenes, openScene: "scn_harbour", openNodes: (k) => s.nodesOfKind(k) }),
    writeScene: (extension, label, edits) => { state.labels.push(label); return s.setExtensionValues(extension, edits); },
    writeProject: async () => ({ ok: true }),
    reveal: async (id) => { state.revealed.push(id); return s.revealNode(id); },
    recordedSeconds: async (id) => (id === "L_bell" ? 2.5 : null),
    play: async (id) => (!state.audio ? null : id === "L_bell" ? (state.played.push(id), true) : false),
    stop: () => { state.stops++; return true; },
    key: (combo) => state.keys.push(combo),
  };
  // Where main's ports arrive, as the editor preload posts them on the window: the shell's hostViews listens.
  const listeners: ((e: unknown) => void)[] = [];
  const target = {
    addEventListener: (_t: string, l: (e: unknown) => void) => { listeners.push(l); },
    removeEventListener: () => {},
  };
  const arrive = (meta: ViewPortMeta & { closed?: true }, port?: MessagePort): void => {
    for (const l of listeners) l({ source: target, data: { type: VIEW_PORT_MESSAGE, meta }, ports: port ? [port] : [] });
  };
  return { views: createViewHost(deps, target as unknown as Window), state, arrive };
}

/** A view at the other end of a port, speaking the protocol as app-shell's probe view does. */
function view(port: MessagePort) {
  const got: HostToView[] = [];
  let next = 1;
  const waiting = new Map<number, (m: HostToView) => void>();
  let onEvent: (() => void) | null = null;
  port.addEventListener("message", (e) => {
    const m = (e as MessageEvent).data as HostToView;
    got.push(m);
    if (m.t === "reply") { waiting.get(m.id)?.(m); waiting.delete(m.id); }
    if (m.t === "welcome" || m.t === "event") onEvent?.();
  });
  port.start();
  return {
    got,
    hello: () => new Promise<HostToView>((res) => { onEvent = () => res(got[got.length - 1]!); port.postMessage({ t: "hello", api: VIEW_API }); }),
    ask: (op: string, args: unknown) => new Promise<HostToView>((res) => { const id = next++; waiting.set(id, res); port.postMessage({ t: "request", id, op, args }); }),
    key: (combo: string) => port.postMessage({ t: "key", combo }),
    nextEvent: () => new Promise<HostToView>((res) => { onEvent = () => res(got[got.length - 1]!); }),
  };
}

const META: ViewPortMeta = { window: 7, extension: "probe", view: "inspect", version: "1.1.0", pinned: "1.1.0" };
const value = (m: HostToView): unknown => (m.t === "reply" && m.ok ? m.value : m);
const refusal = (m: HostToView): unknown => (m.t === "reply" && !m.ok ? m.refusal : m);

describe("a view, answered over its port", () => {
  async function connect() {
    const s = mount();
    const h = host(s);
    const { port1, port2 } = new MessageChannel();
    h.arrive(META, port1 as unknown as MessagePort);
    const v = view(port2 as unknown as MessagePort);
    const welcome = await v.hello();
    return { s, h, v, welcome };
  }

  it("welcomes it, and answers the project, a node, the selection, and media", async () => {
    const { s, h, v, welcome } = await connect();
    expect(welcome).toMatchObject({ t: "welcome", api: VIEW_API, host: "patter", extension: { id: "probe", version: "1.1.0", pinned: "1.1.0" }, view: "inspect", writable: { readOnly: false } });
    expect(welcome).not.toHaveProperty("settings");
    expect(value(await v.ask("project", {}))).toMatchObject({ kind: "project", ext: { probe: { studio: expect.any(String) } } });
    const line = value(await v.ask("node", { id: "L_bell" })) as ViewNode;
    expect(line).toMatchObject({ kind: "line", label: "ANNA: Ring the bell.", ext: { probe: { note: "Ring it twice." } } });
    // Another scene, as saved, and the project's children, the scenes.
    expect(value(await v.ask("node", { id: "L_far" }))).toMatchObject({ kind: "line", parent: "sn_q", host: { text: "Far off." } });
    expect((value(await v.ask("node", { id: "proj_probe", children: true })) as ViewNode).children!.map((c) => c.id)).toEqual(["scn_harbour", "scn_quay"]);
    expect(value(await v.ask("node", { id: "nope" }))).toBeNull();
    s.revealNode("L_reply");
    expect(value(await v.ask("selection", {}))).toEqual({ path: [
      { id: "L_reply", kind: "line" }, { id: "sn_open", kind: "snippet" }, { id: "b_dock", kind: "block" }, { id: "scn_harbour", kind: "scene" },
    ] });
    const media = value(await v.ask("media", { ids: ["L_bell", "L_reply", "T_tide", "E_horn"] })) as Record<string, { seconds: number; measured: boolean }>;
    expect(media["L_bell"]).toEqual({ seconds: 2.5, measured: true });
    expect(media["L_reply"]!.measured).toBe(false);
    expect(media["L_reply"]!.seconds).toBeGreaterThan(0);
    expect(media["T_tide"]).toEqual({ seconds: 0, measured: false }); // action text takes no time
    expect(media["E_horn"]).toBeUndefined();
    expect(value(await v.ask("select", { id: "L_bell" }))).toBe(true);
    expect(h.state.revealed).toEqual(["L_bell"]);
    v.key("Mod+Z");
    await v.ask("selection", {}); // requests are answered in order: the key has been heard
    expect(h.state.keys).toEqual(["Mod+Z"]);
    h.views.closeAll();
  });

  it("says which requirements the project lacks, in the welcome and again when that changes", async () => {
    const s = mount();
    const h = host(s);
    const needing = (missing?: string[]) => ({ ...project, extensions: project.extensions!.map((x) => (x.id === "probe" ? { ...x, ...(missing ? { missing } : {}) } : x)) });
    h.state.project = needing(["patterstage"]);
    const { port1, port2 } = new MessageChannel();
    h.arrive(META, port1 as unknown as MessagePort);
    const v = view(port2 as unknown as MessagePort);
    expect(await v.hello()).toMatchObject({ t: "welcome", missing: ["patterstage"] });
    h.state.project = needing(); // Patterstage added
    const told = v.nextEvent();
    h.views.changed("all");
    expect(await told).toEqual({ t: "event", name: "missing", value: { extensions: [] } });
    h.views.closeAll();
  });

  it("plays a line's take in the editor, says false for one without, and refuses with no audio or no line", async () => {
    const { h, v } = await connect();
    expect(value(await v.ask("play", { id: "L_bell" }))).toBe(true);
    expect(value(await v.ask("play", { id: "L_reply" }))).toBe(false);
    expect(refusal(await v.ask("play", { id: "E_horn" }))).toMatchObject({ code: "gone" });
    expect(refusal(await v.ask("play", { id: "nope" }))).toMatchObject({ code: "gone" });
    const told = v.nextEvent();
    h.views.playing("L_bell");
    expect(await told).toEqual({ t: "event", name: "playing", value: { id: "L_bell" } });
    expect(value(await v.ask("stop", {}))).toBe(true);
    h.state.audio = false;
    expect(refusal(await v.ask("play", { id: "L_bell" }))).toMatchObject({ code: "unsupported" });
    expect(h.state.played).toEqual(["L_bell"]);
    h.views.closeAll();
  });

  it("reads the project's facts afresh after a change, the open scene's pauses among them", async () => {
    const { h, v } = await connect();
    const pad = async (): Promise<unknown> => (value(await v.ask("node", { id: "L_bell" })) as ViewNode).host["padAfter"];
    expect(await pad()).toBe(0.6);
    h.state.project = { ...project, padAfterDefault: 1.2 }; // a Project Settings save, or its undo
    h.views.changed("all");
    expect(await pad()).toBe(1.2);
    h.views.closeAll();
  });

  it("writes as one labelled undo step, tells the view, and refuses what it can't write, whole", async () => {
    const { s, h, v } = await connect();
    const depth = s.undoDepth();
    expect(value(await v.ask("write", { label: "Probe note", edits: [{ node: "L_bell", field: "note", value: "Once." }, { node: "L_reply", field: "weight", value: 2 }] }))).toEqual({ written: 2 });
    expect(s.undoDepth()).toBe(depth + 1);
    expect(h.state.labels).toEqual(["Probe note"]);
    expect(s.model().ext["L_reply"]).toEqual({ probe: { weight: 2 } });
    const changed = v.nextEvent();
    h.views.changed("all", { saved: false });
    expect(await changed).toEqual({ t: "event", name: "changed", value: { nodes: "all" } });

    const refused = async (edits: unknown[]) => refusal(await v.ask("write", { label: "Probe note", edits }));
    expect(await refused([{ node: "L_far", field: "note", value: "x" }])).toEqual({ code: "read-only", message: "A view changes only the scene open in the editor. Open “The Quay” to change this." });
    expect(await refused([{ node: "L_gone", field: "note", value: "x" }])).toMatchObject({ code: "gone" });
    expect(await refused([{ node: "L_bell", field: "weight", value: 11 }])).toMatchObject({ code: "bad-request" });
    expect(await refused([{ node: "L_bell", field: "colour", value: "red" }])).toEqual({ code: "bad-request", message: "Probe has no field called “colour” on a line." });
    expect(await refused([{ node: "g_pick", field: "note", value: "x" }])).toMatchObject({ code: "bad-request" });
    expect(await refused([{ node: "proj_probe", field: "studio", value: "x" }, { node: "L_bell", field: "note", value: "y" }])).toMatchObject({ code: "bad-request" });
    h.state.held = "Probe's data here is locked by bob.";
    expect(await refused([{ node: "L_bell", field: "note", value: "x" }])).toEqual({ code: "held", message: "Probe's data here is locked by bob." });
    // The view is told before it tries: each of the open scene's nodes says who holds its data.
    expect((value(await v.ask("node", { id: "sn_open", children: true })) as ViewNode).children!.every((c) => c.held === "Probe's data here is locked by bob.")).toBe(true);
    expect((value(await v.ask("node", { id: "L_far" })) as ViewNode).held).toBeUndefined();
    h.state.held = null;
    h.state.sceneLocked = "Locked by bob. Read-only until they release it.";
    expect(await refused([{ node: "L_bell", field: "note", value: "x" }])).toEqual({ code: "read-only", message: "Locked by bob. Read-only until they release it." });
    // Nothing refused reached the document.
    expect(s.undoDepth()).toBe(depth + 1);
    expect(s.model().ext["L_bell"]?.["probe"]?.["note"]).toBe("Once.");
    const told = v.nextEvent();
    h.views.writable();
    expect(await told).toEqual({ t: "event", name: "writable", value: { readOnly: true, why: "Locked by bob. Read-only until they release it." } });
    // The window closed: main says so with its meta again, and the editor drops its handle.
    expect(h.views.size).toBe(1);
    h.arrive({ ...META, closed: true });
    expect(h.views.size).toBe(0);
  });
});

describe("recordings' lengths", () => {
  it("measures a take once, tries a failed one again, and gives up on one that never settles", async () => {
    const calls: string[] = [];
    let answer: number | null = null;
    const length = takeLengths(async (id) => {
      calls.push(id);
      if (id === "L_stuck") return new Promise<number | null>(() => {});
      return answer;
    }, 20);
    expect(await length("a.wav|h1", "L_one")).toBeNull();
    answer = 2.5;
    expect(await length("a.wav|h1", "L_one")).toBe(2.5); // the failure wasn't kept
    expect(await length("a.wav|h1", "L_one")).toBe(2.5);
    expect(calls).toEqual(["L_one", "L_one"]); // the success was
    expect(await length("b.wav|h2", "L_stuck")).toBeNull(); // settles at the timeout
  });
});
