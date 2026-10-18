// ---------------------------------------------------------------------------
// Patter extension data in the document (patterkit design/patterpad-undo.md, half A), on the probe
// fixture: each node's entries ride its `ext` attr, never the flow; a save splits them back out to their
// shard, writing only a shard that changed, keeping what the document has no place for (orphans, a kind
// that doesn't match, an extension without a sound manifest, the unresolved mark), and deleting a shard
// left with nothing. Every command that rebuilds or copies a node keeps or drops `ext` as the id goes, and
// the lock guard refuses any change to a locked extension's data, undo and redo included.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EditorState, NodeSelection, TextSelection, type Command, type Transaction } from "prosemirror-state";
import { history, undo, redo } from "prosemirror-history";
import type { Node as PMNode } from "prosemirror-model";
import { parseSource, canonicalStringify } from "@patterkit/core";
import { openScene, saveScene, type OpenedScene, type SceneExtensionSource } from "../src/load.js";
import { docToScene } from "../src/bridge.js";
import { findByModelId } from "../src/zoneutil.js";
import { duplicateChunk } from "../src/duplicate.js";
import { joinSnippet } from "../src/groups.js";
import { REFUSED, snippetLossMessage } from "../src/guard.js";
import { toggleLineType } from "../src/linetype.js";
import { endBubble, enter } from "../src/lines.js";
import { backspace } from "../src/delete.js";
import { inspect } from "../src/inspect.js";
import { extensionLockGuard, extensionLockLoss } from "../src/extlock.js";

const root = fileURLToPath(new URL("../../ops/test/fixtures/probe-extension.patter/", import.meta.url));
const file = (p: string): string => readFileSync(root + p, "utf8");
const FLOW = file("scenes/harbour.patterflow");
const LOC = file("loc/en/harbour.patterloc");
const SHARD = file("extensions/probe/harbour.patterextension");
type Obj = Record<string, unknown>;

const probe = (source = SHARD, live = true): SceneExtensionSource => ({ id: "probe", source, live });
const open = (exts: SceneExtensionSource[] = [probe()]): OpenedScene => openScene(FLOW, LOC, true, exts);
const extAt = (doc: PMNode, id: string): Obj => {
  const sceneId = (JSON.parse(doc.attrs.raw as string) as { id: string }).id;
  const node = sceneId === id ? doc : findByModelId(doc, id)!.node;
  return node.attrs.ext ? JSON.parse(node.attrs.ext as string) as Obj : {};
};
const entriesOf = (text: string): Obj => (parseSource(text) as Obj)["entries"] as Obj;
/** One recorded transaction setting a node's `ext` (what the handle's setExtensionValue dispatches). */
function setExt(state: EditorState, id: string, ext: Obj): Transaction {
  const value = Object.keys(ext).length ? JSON.stringify(ext) : "";
  const sceneId = (JSON.parse(state.doc.attrs.raw as string) as { id: string }).id;
  if (id === sceneId) return state.tr.setDocAttribute("ext", value);
  const at = findByModelId(state.doc, id)!;
  return state.tr.setNodeMarkup(at.pos, undefined, { ...at.node.attrs, ext: value });
}
const withDoc = (o: OpenedScene, doc: PMNode): OpenedScene => { o.doc = doc; return o; };
const run = (s: EditorState, cmd: Command): EditorState => { let n = s; cmd(s, (tr) => { n = n.apply(tr); }); return n; };
const sayAt = (s: EditorState, id: string, offset: number): EditorState => {
  const b = findByModelId(s.doc, id)!;
  let p = -1;
  b.node.forEach((z, o) => { if (z.type.name === "say") p = b.pos + 1 + o + 1 + offset; });
  return s.apply(s.tr.setSelection(TextSelection.create(s.doc, p)));
};

describe("opening a scene with extension data", () => {
  it("puts each live entry on its node, of every kind", () => {
    const o = open();
    expect((extAt(o.doc, "L_bell")["probe"] as Obj)["note"]).toBe("Ring it twice.");
    expect(extAt(o.doc, "o_stay")).toEqual({ probe: { icon: "anchor" } });
    expect(extAt(o.doc, "scn_harbour")).toEqual({ probe: { theme: "salt" } });
    expect(extAt(o.doc, "b_dock")).toEqual({ probe: { pace: 2 } });
    expect(extAt(o.doc, "sn_open")).toEqual({ probe: { weight: 3 } });
    expect(extAt(o.doc, "T_tide")).toEqual({ probe: { style: "far" } });
    expect(extAt(o.doc, "E_horn")).toEqual({ probe: { cue: "horn" } });
    expect(extAt(o.doc, "L_reply")).toEqual({});
  });

  it("never lets extension data into the flow or the inspector's model fields", () => {
    const o = open();
    const saved = saveScene(o, { rebuildExtensions: true });
    expect(saved.flow).toBe(canonicalStringify(parseSource(FLOW)));
    expect(saved.flow).not.toContain("probe");
    expect(saved.flow).not.toContain("extensions");
    const { scene } = docToScene(o.doc);
    expect(JSON.stringify(scene)).not.toContain("Ring it twice");
  });

  it("carries the entry to the inspector's levels", () => {
    const o = open();
    const s0 = EditorState.create({ doc: o.doc });
    const s = sayAt(s0, "L_bell", 0);
    const levels = inspect(s).levels;
    const leaf = levels.find((l) => l.kind === "leaf")!;
    expect(leaf.kind === "leaf" && (leaf.ext?.["probe"] as Obj)["tone"]).toBe("tense");
    const snippet = levels.find((l) => l.kind === "snippet");
    expect(snippet?.kind === "snippet" && snippet.ext).toEqual({ probe: { weight: 3 } });
    const block = levels.find((l) => l.kind === "block");
    expect(block?.kind === "block" && block.ext).toEqual({ probe: { pace: 2 } });
    const scene = levels.find((l) => l.kind === "scene");
    expect(scene?.kind === "scene" && scene.ext).toEqual({ probe: { theme: "salt" } });
    const opt = EditorState.create({ doc: o.doc, selection: NodeSelection.create(o.doc, findByModelId(o.doc, "o_stay")!.pos) });
    const group = inspect(opt).levels[0]!;
    expect(group.kind === "group" && group.ext).toEqual({ probe: { icon: "anchor" } });
  });
});

describe("saving extension data", () => {
  it("writes nothing for an untouched scene, and a forced rebuild is byte-identical", () => {
    expect(saveScene(open()).extensions).toEqual({});
    expect(saveScene(open(), { prune: true }).extensions).toEqual({});
    expect(saveScene(open(), { rebuildExtensions: true }).extensions).toEqual({ probe: SHARD });
    expect(saveScene(openScene(FLOW, LOC)).extensions).toEqual({}); // no extensions at all
  });

  it("writes the changed shard, keeping everything else in it", () => {
    const o = open();
    const s = EditorState.create({ doc: o.doc });
    const next = s.apply(setExt(s, "L_reply", { probe: { note: "Twice." } })).doc;
    const out = saveScene(withDoc(o, next)).extensions;
    expect(Object.keys(out)).toEqual(["probe"]);
    const entries = entriesOf(out["probe"]!) as Record<string, Obj>;
    expect(entries["line"]!["L_reply"]).toEqual({ note: "Twice." });
    expect(entries["option"]).toEqual({ o_stay: { icon: "anchor" } });
    expect((parseSource(out["probe"]!) as Obj)["scene"]).toBe("scn_harbour");
  });

  it("keeps reporting a shard once reported, so an undo back to the opened data is written too", () => {
    const o = open();
    const s0 = EditorState.create({ doc: o.doc, plugins: [history()] });
    const s1 = s0.apply(setExt(s0, "L_reply", { probe: { note: "Twice." } }));
    expect(Object.keys(saveScene(withDoc(o, s1.doc)).extensions)).toEqual(["probe"]);
    const back = run(s1, undo);
    expect(saveScene(withDoc(o, back.doc)).extensions).toEqual({ probe: SHARD });
  });

  it("holds orphans, a mismatched kind, and kinds that aren't Patter's, untouched", () => {
    const shard = parseSource(SHARD) as Obj & { entries: Record<string, Obj> };
    shard.entries["line"]!["L_gone"] = { note: "orphan" };
    shard.entries["line"]!["T_tide"] = { note: "wrong kind" }; // T_tide is text
    shard.entries["card"] = { c1: { x: 1 } };
    const text = canonicalStringify(shard);
    const o = open([probe(text)]);
    expect(extAt(o.doc, "T_tide")).toEqual({ probe: { style: "far" } });
    const s = EditorState.create({ doc: o.doc });
    const out = saveScene(withDoc(o, s.apply(setExt(s, "E_horn", { probe: { cue: "gong" } })).doc)).extensions;
    const entries = entriesOf(out["probe"]!) as Record<string, Obj>;
    expect(entries["line"]!["L_gone"]).toEqual({ note: "orphan" });
    expect(entries["line"]!["T_tide"]).toEqual({ note: "wrong kind" });
    expect(entries["card"]).toEqual({ c1: { x: 1 } });
    expect(entries["gameEvent"]).toEqual({ E_horn: { cue: "gong" } });
  });

  it("never touches a shard that isn't live, and keeps the unresolved mark", () => {
    const o = open([probe(SHARD, false)]);
    expect(extAt(o.doc, "L_bell")).toEqual({});
    expect(saveScene(o, { rebuildExtensions: true }).extensions).toEqual({});
    const marked = canonicalStringify({ ...(parseSource(SHARD) as Obj), unresolved: [{ path: "line.L_bell.note", kind: "both-changed" }] });
    const m = open([probe(marked)]);
    const s = EditorState.create({ doc: m.doc });
    const out = saveScene(withDoc(m, s.apply(setExt(s, "L_bell", {})).doc)).extensions;
    expect((parseSource(out["probe"]!) as Obj)["unresolved"]).toBeDefined();
  });

  it("gives null for a shard emptied, and writes a fresh shard for a scene that had none", () => {
    const o = open();
    let s = EditorState.create({ doc: o.doc });
    for (const id of ["scn_harbour", "b_dock", "sn_open", "L_bell", "T_tide", "E_horn", "o_stay"]) s = s.apply(setExt(s, id, {}));
    expect(saveScene(withDoc(o, s.doc)).extensions).toEqual({ probe: null });

    const fresh = open([probe("")]);
    const f0 = EditorState.create({ doc: fresh.doc });
    const out = saveScene(withDoc(fresh, f0.apply(setExt(f0, "L_reply", { probe: { loud: true } })).doc)).extensions;
    expect(parseSource(out["probe"]!)).toEqual({
      schema: "patter/extension@0", extension: "probe", scene: "scn_harbour", entries: { line: { L_reply: { loud: true } } },
    });
  });

  it("keeps a blank beat that carries extension data through the save's prune, data and all", () => {
    const o = open();
    let s = EditorState.create({ doc: o.doc });
    s = sayAt(s, "L_reply", 6);
    s = run(s, enter); // a fresh blank line after L_reply
    const blank = s.selection.$head.node(s.selection.$head.depth - 1).attrs.id as string;
    const bare = saveScene(withDoc(o, s.doc), { prune: true });
    expect(bare.flow).not.toContain(blank); // a blank line with nothing on it still goes
    s = s.apply(setExt(s, blank, { probe: { note: "kept" } }));
    const saved = saveScene(withDoc(o, s.doc), { prune: true });
    expect(saved.flow).toContain(blank);
    expect((entriesOf(saved.extensions["probe"]!)["line"] as Obj)[blank]).toEqual({ note: "kept" });
  });

  it("writes nothing for an untouched scene whose shard holds an empty kind", () => {
    const shard = parseSource(SHARD) as Obj & { entries: Record<string, Obj> };
    shard.entries["card"] = {}; // as a hand edit or a merge may leave one
    shard.entries["option"] = { ...shard.entries["option"] };
    const withEmpty = canonicalStringify({ ...shard, entries: { ...shard.entries, scene: { ...shard.entries["scene"] }, text: {} } });
    const o = open([probe(withEmpty)]);
    expect(saveScene(o).extensions).toEqual({});
    expect(saveScene(o, { prune: true }).extensions).toEqual({});
  });
});

describe("commands that rebuild or copy a node", () => {
  it("Duplicate carries the data to the copy", () => {
    const o = open();
    const s = EditorState.create({ doc: o.doc });
    const res = duplicateChunk(s, findByModelId(s.doc, "sn_open")!.pos)!;
    const next = s.apply(res.tr);
    expect(extAt(next.doc, res.idMap["sn_open"]!)).toEqual({ probe: { weight: 3 } });
    expect((extAt(next.doc, res.idMap["L_bell"]!)["probe"] as Obj)["note"]).toBe("Ring it twice.");
  });

  it("a line / text toggle keeps the data, under the new kind", () => {
    const o = open();
    let s = sayAt(EditorState.create({ doc: o.doc }), "L_bell", 0);
    s = run(s, toggleLineType);
    expect(findByModelId(s.doc, "L_bell")!.node.type.name).toBe("prose");
    expect((extAt(s.doc, "L_bell")["probe"] as Obj)["note"]).toBe("Ring it twice.");
    const entries = entriesOf(saveScene(withDoc(o, s.doc)).extensions["probe"]!) as Record<string, Obj>;
    expect(entries["text"]!["L_bell"]).toBeDefined();
    expect(entries["line"]?.["L_bell"]).toBeUndefined();
  });

  it("a split bubble leaves the data with the first half", () => {
    const o = open();
    let s = sayAt(EditorState.create({ doc: o.doc }), "L_reply", 0);
    s = run(s, endBubble);
    expect(extAt(s.doc, "sn_open")).toEqual({ probe: { weight: 3 } });
    const kids: PMNode[] = [];
    findByModelId(s.doc, "b_dock")!.node.forEach((c) => kids.push(c));
    expect(kids[1]!.type.name).toBe("snippet");
    expect(kids[1]!.attrs.ext).toBe("");
  });

  it("a bubble merge that would drop the second bubble's data is refused, saying so", () => {
    const o = open();
    const s = EditorState.create({ doc: o.doc });
    const dup = duplicateChunk(s, findByModelId(s.doc, "sn_open")!.pos)!;
    const s2 = s.apply(dup.tr); // a copy of sn_open after it, carrying its data
    const tr = joinSnippet(s2, findByModelId(s2.doc, "sn_open")!.pos, "down")!;
    expect(tr.getMeta(REFUSED)).toBe("The next bubble has extension data. Move or clear it first.");
    // With no data on the second bubble, the merge goes ahead.
    const bare = s2.apply(setExt(s2, dup.idMap["sn_open"]!, {}));
    expect(joinSnippet(bare, findByModelId(bare.doc, "sn_open")!.pos, "down")!.getMeta(REFUSED)).toBeUndefined();
    const cond = findByModelId(s2.doc, "sn_open")!.node.type.create({ raw: JSON.stringify({ id: "x", condition: "@a" }), ext: "{\"probe\":{}}" });
    expect(snippetLossMessage("This bubble", cond)).toBe("This bubble has a condition and extension data. Move or clear them first.");
  });

  it("a fold keeps the data of the line it folds into", () => {
    const o = open();
    let s = sayAt(EditorState.create({ doc: o.doc }), "L_reply", 0);
    // Backspace at the start of BEN's words selects the name, then merges the line up into L_bell.
    s = run(s, backspace); s = run(s, backspace);
    expect(findByModelId(s.doc, "L_reply")).toBeNull();
    expect((extAt(s.doc, "L_bell")["probe"] as Obj)["note"]).toBe("Ring it twice.");
  });
});

describe("the extension lock guard", () => {
  const locks = { probe: { name: "Probe", by: ["bob"] } };
  const guarded = (o: OpenedScene, said: string[]) =>
    EditorState.create({ doc: o.doc, plugins: [extensionLockGuard(() => locks, (m) => said.push(m)), history()] });

  it("refuses a value edit, a delete of a node carrying it, and a Duplicate", () => {
    const said: string[] = [];
    const s = guarded(open(), said);
    expect(s.apply(setExt(s, "L_bell", {})).doc).toBe(s.doc);
    expect(said).toEqual(["Probe's data here is locked by bob."]);
    const e = findByModelId(s.doc, "E_horn")!;
    expect(s.apply(s.tr.delete(e.pos, e.pos + e.node.nodeSize)).doc).toBe(s.doc);
    const dup = duplicateChunk(s, findByModelId(s.doc, "sn_open")!.pos)!;
    expect(s.apply(dup.tr).doc).toBe(s.doc);
    expect(said).toHaveLength(3);
  });

  it("lets typing and edits to nodes without the data through", () => {
    const said: string[] = [];
    let s = sayAt(guarded(open(), said), "L_bell", 0);
    s = s.apply(s.tr.insertText("Now. "));
    expect(docToScene(s.doc).strings["L_bell"]).toBe("Now. Ring the bell.");
    const r = findByModelId(s.doc, "L_reply")!;
    s = s.apply(s.tr.delete(r.pos, r.pos + r.node.nodeSize));
    expect(findByModelId(s.doc, "L_reply")).toBeNull();
    expect(said).toEqual([]);
  });

  it("refuses an undo or redo that would change the data", () => {
    const o = open();
    const said: string[] = [];
    let locked = false;
    let s = EditorState.create({ doc: o.doc, plugins: [extensionLockGuard(() => (locked ? locks : {}), (m) => said.push(m)), history()] });
    s = s.apply(setExt(s, "L_reply", { probe: { note: "x" } }));
    locked = true;
    expect(extensionLockLoss(s.doc, (() => { let t: Transaction | null = null; undo(s, (tr) => { t = tr; }); return (t as unknown as Transaction).doc; })(), locks)).toBe("Probe's data here is locked by bob.");
    const after = run(s, undo);
    expect(after.doc).toBe(s.doc);
    expect(said).toEqual(["Probe's data here is locked by bob."]);
    locked = false;
    const undone = run(s, undo);
    expect(extAt(undone.doc, "L_reply")).toEqual({});
    locked = true;
    expect(run(undone, redo).doc).toBe(undone.doc);
  });
});
