// @vitest-environment jsdom
// What the fields window shows (renderer/src/fields-state.ts; Pattershot's brief, H1 to H4): the node the
// window follows to, the maps of records its kind has with what the cells need sent as data, and what it says
// when there are none, on the conformance suite's probe manifest (its line's `perf`, a map of records).

import { describe, it, expect } from "vitest";
import probeText from "../../../conformance/fixtures/probe.extension.json?raw";
import { parseManifest } from "@wildwinter/toolkit/extensions";
import type { ProjectFile } from "@patterkit/model";
import type { InspectorContext } from "@patterkit/patterpad-surface/surface";
import { extensionAdapter } from "./src/extension-rows.js";
import { fieldsHint, fieldsState, followTarget, recordMapFields, selectedNodes } from "./src/fields-state.js";
import { extensionDtos } from "../shared/extensions.js";

const extensions = extensionDtos(
  { project: { id: "proj_t", name: "T" }, extensions: { probe: { version: "1.1.0", settings: { deliveryField: "mood" } } } } as unknown as ProjectFile,
  new Map([["probe", parseManifest(probeText)]]),
  new Map(),
)!;
const adapter = extensionAdapter({
  cast: ["ANNA", "BEN"], scenes: [{ id: "scn_a", name: "Harbour", blocks: [] }], openScene: "scn_a",
  openNodes: () => [], index: {},
});
const ctx = (...levels: unknown[]): InspectorContext => ({ levels }) as InspectorContext;

describe("the node the window follows to", () => {
  const levels = ctx(
    { kind: "scene", id: "scn_a" }, { kind: "block", id: "b_1" }, { kind: "snippet", id: "sn_1" },
    { kind: "leaf", beat: "line", id: "L_1", ext: { probe: { perf: { ANNA: {} } } } },
  );

  it("reads the selection's nodes deepest first, with their extension kinds", () => {
    expect(selectedNodes(levels).map((n) => `${n.kind}:${n.id}`)).toEqual(["line:L_1", "snippet:sn_1", "block:b_1", "scene:scn_a"]);
    expect(selectedNodes(ctx({ kind: "leaf", beat: "prose", id: "T_1" }))[0]?.kind).toBe("text");
    expect(selectedNodes(null)).toEqual([]);
  });

  it("is the deepest whose kind has a map of records, else the deepest", () => {
    expect(followTarget(selectedNodes(levels), extensions)?.id).toBe("L_1");
    expect(followTarget(selectedNodes(ctx({ kind: "scene", id: "scn_a" }, { kind: "snippet", id: "sn_1" })), extensions)?.id).toBe("sn_1");
    expect(followTarget([], extensions)).toBeNull();
    expect(recordMapFields(extensions, "line").map((f) => f.decl.name)).toEqual(["perf"]);
  });
});

describe("the state sent", () => {
  it("carries each map of records with the nodes and names its cells need", () => {
    const state = fieldsState({
      hasProject: true, extensions, adapter, lock: () => null, readOnly: false,
      node: { kind: "line", id: "L_1", label: "ANNA: Ring it.", ext: { probe: { perf: { ANNA: { expression: "frown" }, GONE: {} } } } },
    });
    expect(state.node).toEqual({ id: "L_1", kind: "line", label: "ANNA: Ring it." });
    expect(state.grids).toHaveLength(1);
    const g = state.grids[0]!;
    expect([g.extension, g.extensionName, g.field]).toEqual(["probe", "Probe", "perf"]);
    expect(g.value).toEqual({ ANNA: { expression: "frown" }, GONE: {} });
    expect(g.nodes["cast"]?.map((n) => n.id)).toEqual(["ANNA", "BEN"]);
    expect(g.locked).toBeNull();
    expect(state.hint).toBe("Select a line to edit perf here.");
  });

  it("says the lock, the read-only scene, and no node or project", () => {
    const locked = fieldsState({ hasProject: true, extensions, adapter, lock: () => "Locked by bob.", readOnly: true,
      node: { kind: "line", id: "L_1", label: "x", ext: undefined } });
    expect(locked.grids[0]?.locked).toBe("Locked by bob.");
    expect(locked.readOnly).toBe(true);
    expect(fieldsState({ hasProject: true, extensions, adapter, lock: () => null, readOnly: false, node: null }))
      .toMatchObject({ hasProject: true, node: null, grids: [] });
    expect(fieldsState({ hasProject: false, extensions, adapter, lock: () => null, readOnly: false, node: null }).hasProject).toBe(false);
  });

  it("has no hint without a map of records anywhere", () => {
    expect(fieldsHint([])).toBe("");
  });
});
