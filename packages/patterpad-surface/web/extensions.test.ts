// @vitest-environment jsdom
// The surface handle's extension calls, mounted on the probe fixture (patterkit design/patterpad-undo.md,
// half A): setExtensionValue is one recorded step the scene's history undoes, getSource hands back the
// changed shard, a locked extension refuses the edit (and its undo) with a sentence naming who holds it,
// and nodesOfKind offers what a reference field may point at.
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseSource } from "@patterkit/core";
import { mountSurface } from "./surface.js";

// jsdom's import.meta.url isn't a file URL: the root runs the tests, as view.test.ts reads its fixture.
const root = resolve(process.cwd(), "packages/ops/test/fixtures/probe-extension.patter") + "/";
const file = (p: string): string => readFileSync(root + p, "utf8");
const SHARD = file("extensions/probe/harbour.patterextension");
type Obj = Record<string, unknown>;

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  (HTMLElement.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
});

function mount() {
  const editor = document.createElement("div"); document.body.appendChild(editor);
  (editor as unknown as { scrollTo: () => void }).scrollTo = () => undefined;
  const said: string[] = [];
  let steps = 0;
  const s = mountSurface({
    editor, flowSource: file("scenes/harbour.patterflow"), locSource: file("loc/en/harbour.patterloc"),
    extensions: [{ id: "probe", source: SHARD, live: true }], hostUndo: true,
    onRefuse: (m) => said.push(m), onHistoryStep: () => { steps++; },
  });
  return { s, said, steps: () => steps };
}
const entries = (text: string | null | undefined): Record<string, Record<string, Obj>> => (parseSource(text!) as Obj)["entries"] as Record<string, Record<string, Obj>>;

describe("the surface's extension handle", () => {
  it("round-trips: an untouched scene writes no shard", () => {
    const { s } = mount();
    expect(s.getSource().extensions).toEqual({});
    expect(s.getSource({ prune: true }).extensions).toEqual({});
  });

  it("sets and clears a field as one undoable step, on any node kind and the scene", () => {
    const { s, steps } = mount();
    expect(s.setExtensionValue("L_reply", "probe", "note", "Twice?")).toBe(true);
    expect(steps()).toBe(1);
    expect(entries(s.getSource().extensions["probe"])["line"]!["L_reply"]).toEqual({ note: "Twice?" });
    expect(s.setExtensionValue("scn_harbour", "probe", "theme", undefined)).toBe(true);
    expect(entries(s.getSource().extensions["probe"])["scene"]).toBeUndefined();
    expect(s.setExtensionValue("o_go", "probe", "icon", "door")).toBe(true);
    expect(entries(s.getSource().extensions["probe"])["option"]).toEqual({ o_stay: { icon: "anchor" }, o_go: { icon: "door" } });
    // Setting what's there already is no step at all.
    const depth = s.undoDepth();
    expect(s.setExtensionValue("o_go", "probe", "icon", "door")).toBe(true);
    expect(s.undoDepth()).toBe(depth);
    expect(s.setExtensionValue("nope", "probe", "note", "x")).toBe(false);

    s.undo(); s.undo(); s.undo();
    expect(s.getSource().extensions).toEqual({ probe: SHARD }); // back where it opened, still reported
    const leaf = s.selectionContext().levels.find((l) => l.kind === "scene");
    expect(leaf?.kind === "scene" && leaf.ext).toEqual({ probe: { theme: "salt" } });
  });

  it("refuses an edit, and says why, while somebody holds the extension's shard", () => {
    const { s, said } = mount();
    expect(s.setExtensionValue("L_bell", "probe", "note", "x")).toBe(true);
    expect(entries(s.getSource().extensions["probe"])["line"]!["L_bell"]!["note"]).toBe("x");
    s.setLockedExtensions({ probe: { name: "Probe", by: ["bob"] } });
    expect(s.setExtensionValue("L_bell", "probe", "note", "y")).toBe(false);
    expect(said).toEqual(["Probe's data here is locked by bob."]);
    expect(s.historyRefusal("undo")).toBe("Probe's data here is locked by bob.");
    s.setLockedExtensions({});
    expect(s.historyRefusal("undo")).toBeNull();
    expect(s.undo()).toBe(true);
    expect(s.getSource().extensions).toEqual({ probe: SHARD });
  });

  it("writes several fields on several nodes as one step of their own, and refuses the lot on a held shard", () => {
    const { s, steps, said } = mount();
    const depth = s.undoDepth();
    const done = s.setExtensionValues("probe", [
      { id: "L_bell", field: "note", value: "Louder" },
      { id: "L_reply", field: "note", value: "Softer" },
      { id: "L_bell", field: "weight", value: 3 },
      { id: "scn_harbour", field: "theme" },
    ]);
    expect(done).toEqual({ ok: true, changed: true });
    expect(steps()).toBe(1);
    expect(s.undoDepth()).toBe(depth + 1);
    const line = entries(s.getSource().extensions["probe"])["line"]!;
    expect(line["L_bell"]).toMatchObject({ note: "Louder", weight: 3 });
    expect(line["L_reply"]).toEqual({ note: "Softer" });
    expect(s.model().ext["L_bell"]?.["probe"]).toMatchObject({ note: "Louder", weight: 3 });
    expect(s.model().ext["scn_harbour"]).toBeUndefined();
    // Nothing to change is no step; a single setExtensionValue straight after is a step of its own.
    expect(s.setExtensionValues("probe", [{ id: "L_reply", field: "note", value: "Softer" }])).toEqual({ ok: true, changed: false });
    expect(s.setExtensionValue("L_reply", "probe", "note", "Again")).toBe(true);
    expect(s.undoDepth()).toBe(depth + 2);
    s.undo(); s.undo();
    expect(s.getSource().extensions).toEqual({ probe: SHARD });

    // A node that isn't here refuses the whole write, as does a held shard, and neither is a step.
    expect(s.setExtensionValues("probe", [{ id: "L_bell", field: "note", value: "x" }, { id: "nope", field: "note", value: "y" }]))
      .toMatchObject({ ok: false, why: "gone" });
    s.setLockedExtensions({ probe: { name: "Probe", by: ["bob"] } });
    expect(s.setExtensionValues("probe", [{ id: "L_bell", field: "note", value: "x" }]))
      .toEqual({ ok: false, why: "held", message: "Probe's data here is locked by bob." });
    s.setLockedExtensions({});
    s.setEditable(false);
    expect(s.setExtensionValues("probe", [{ id: "L_bell", field: "note", value: "x" }])).toMatchObject({ ok: false, why: "read-only" });
    expect(steps()).toBe(2);
    expect(said).toEqual([]);
  });

  it("offers the scene's nodes of each kind for a reference", () => {
    const { s } = mount();
    expect(s.nodesOfKind("line")).toEqual([
      { id: "L_bell", label: "ANNA: Ring the bell." },
      { id: "L_reply", label: "BEN: Twice?" },
      { id: "P_go", label: "ANNA: Let's go." },
    ]);
    expect(s.nodesOfKind("text")).toEqual([{ id: "T_tide", label: "The tide turns." }, { id: "P_stay", label: "Stay a while." }]);
    expect(s.nodesOfKind("option")).toEqual([{ id: "o_stay", label: "Stay a while." }, { id: "o_go", label: "Let's go." }]);
    expect(s.nodesOfKind("scene")).toEqual([{ id: "scn_harbour", label: "The Harbour" }]);
    expect(s.nodesOfKind("block")).toEqual([{ id: "b_dock", label: "The Dock" }]);
    expect(s.nodesOfKind("gameEvent")).toEqual([{ id: "E_horn", label: "E_horn" }]);
  });
});
