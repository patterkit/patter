// ---------------------------------------------------------------------------
// The clash resolver's words (clash-words.ts): every shard type's clash paths, said as a writer reads them,
// the sides as text rather than JSON, and which can take theirs.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { canonicalStringify, parseSource } from "@patterkit/core";
import { runMerge, unresolvedClashes, type MarkedShard } from "@patterkit/ops";
import { describeClashes, type ClashContext } from "../src/main/clash-words.js";

type Obj = Record<string, unknown>;

const tavern: Obj = {
  id: "scn_tavern", type: "scene", name: "The Tavern",
  blocks: [{ id: "b_bar", type: "block", name: "At the bar", children: [
    { id: "sn_1", type: "snippet", beats: [{ id: "L12", kind: "line", character: "BARKEEP" }, { id: "T3", kind: "text" }] },
    { id: "sn_2", type: "snippet", beats: [{ id: "L13", kind: "line", character: "ANN" }] },
    { id: "sn_3", type: "snippet", beats: [] },
  ] }],
};
const texts: Record<string, string> = { L12: "What'll it be?", T3: "The fire crackles.", L13: "Ale, please." };

const ctx: ClashContext = {
  defaultLocale: "en",
  sceneName: (id) => (id === "scn_tavern" ? "The Tavern" : undefined),
  sceneTree: (id) => (id === "scn_tavern" ? tavern : undefined),
  sceneOfAuthoring: () => "scn_tavern",
  text: (_s, id) => texts[id],
  extensionName: (id) => (id === "probe" ? "Probe" : id),
};

/** The rows a real merge's marked shard gives. */
function rows(base: Obj, ours: Obj, theirs: Obj, file = "x") {
  const merged = parseSource(canonicalStringify(runMerge(base, ours, theirs).merged)) as Obj;
  const marked: MarkedShard = { file, shard: merged, clashes: unresolvedClashes(merged) };
  return describeClashes(ctx, marked, file);
}

const flowWith = (mut: (scene: Obj) => void): Obj => { const scene = structuredClone(tavern); mut(scene); return { schema: "patter/flow@0", scene }; };
const beats = (scene: Obj): Obj[] => ((((scene["blocks"] as Obj[])[0]!["children"] as Obj[])[0]!)["beats"] as Obj[]);
const children = (scene: Obj): Obj[] => (scene["blocks"] as Obj[])[0]!["children"] as Obj[];

describe("where a clash is", () => {
  it("a beat's field in a flow shard", () => {
    const [r] = rows(flowWith(() => {}), flowWith((s) => { beats(s)[0]!["character"] = "ANN"; }), flowWith((s) => { beats(s)[0]!["character"] = "BOB"; }));
    expect(r!.clash).toMatchObject({ where: "Line L12's speaker in The Tavern", ours: "ANN", theirs: "BOB", settable: true });
    expect(r!.target).toEqual({ kind: "scene", sceneId: "scn_tavern", nodeId: "L12" });
  });

  it("a beat both sides changed, deleted on one: its words, not its JSON", () => {
    const [r] = rows(flowWith(() => {}), flowWith((s) => { beats(s)[0]!["character"] = "ANN"; }), flowWith((s) => { beats(s).splice(0, 1); }));
    expect(r!.clash).toMatchObject({ where: "Line L12 in The Tavern", kind: "delete-vs-edit", ours: "ANN: What'll it be?", base: "BARKEEP: What'll it be?" });
    expect(r!.clash.theirs).toBeUndefined();
  });

  it("a reorder both sides made: moved, not settable, the orders in words", () => {
    const [r] = rows(flowWith(() => {}), flowWith((s) => { const c = children(s); c.push(c.shift()!); }), flowWith((s) => { const c = children(s); c.unshift(c.pop()!); }));
    expect(r!.clash).toMatchObject({ kind: "moved", kindLabel: "Moved on both sides", settable: false, where: "Order of what's in Block At the bar in The Tavern" });
    expect(r!.clash.ours).toBe("Snippet sn_2, then Snippet sn_3, then Snippet sn_1");
  });

  it("a line's writing status in an authoring shard (no-timestamp)", () => {
    const a = (status: string): Obj => ({ schema: "patter/authoring@0", writing: { L12: status } });
    const [r] = rows(a("draft"), a("final"), a("cut"), "authoring/tavern.patterx");
    expect(r!.clash).toMatchObject({ where: "Line L12's writing status in The Tavern", kind: "no-timestamp", settable: true });
    expect(r!.clash.kindLabel).toMatch(/no edit times/);
  });

  it("a translation names its language", () => {
    const l = (t: string): Obj => ({ schema: "patter/strings@0", scene: "scn_tavern", locale: "fr", strings: { L12: t } });
    const [r] = rows(l("Quoi ?"), l("Et pour vous ?"), l("Qu'est-ce que ce sera ?"));
    expect(r!.clash.where).toBe("Line L12 in The Tavern, in French");
  });

  it("the project shard: a property, a cast member's field, scene order", () => {
    const p = (extra: Obj): Obj => ({ schema: "patter/project@0", project: { id: "p", name: "P" }, locales: { default: "en", all: ["en"] }, ...extra });
    const gold = (d: number): Obj => ({ name: "gold", type: "number", default: d });
    const ann = (n: string): Obj => ({ name: "Ann", displayName: n });
    const out = rows(
      p({ properties: [gold(0)], cast: [ann("Ann")], sceneOrder: ["a", "b"] }),
      p({ properties: [gold(5)], cast: [ann("Annie")], sceneOrder: ["b", "a"] }),
      p({ properties: [gold(9)], cast: [ann("Anna")], sceneOrder: ["a", "b", "c"] }),
    );
    const where = Object.fromEntries(out.map((r) => [r.clash.path, r.clash.where]));
    expect(where).toEqual({ "properties[gold]": "Property @gold", "cast[Ann].displayName": "Ann's display name", sceneOrder: "Scene order" });
    expect(out.find((r) => r.clash.path === "properties[gold]")!.clash.ours).toBe("name: gold, default: 5, type: number");
    expect(out.find((r) => r.clash.path === "properties[gold]")!.target).toEqual({ kind: "properties", name: "gold" });
    expect(out.find((r) => r.clash.path === "cast[Ann].displayName")!.target).toEqual({ kind: "settings", tab: "cast", row: "Ann" });
  });

  it("an extension's data on a line", () => {
    const e = (note: string): Obj => ({ schema: "patter/extension@0", extension: "probe", scene: "scn_tavern", entries: { line: { L12: { note } } } });
    const [r] = rows(e("a"), e("b"), e("c"));
    expect(r!.clash).toMatchObject({ where: "Line L12's Probe data in The Tavern", ours: "note: b", theirs: "note: c" });
  });
});
