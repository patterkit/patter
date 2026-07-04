// The detail-inspector context stack (src/inspect.ts): from a caret, build the container chain
// leaf -> snippet -> group(s) -> block, innermost-first, each carrying its salient model data. These
// build a doc via the bridge, drop the caret in, and assert the projected levels.

import { describe, it, expect } from "vitest";
import { EditorState, TextSelection, NodeSelection } from "prosemirror-state";
import type { Scene } from "@patterkit/model";
import { sceneToDoc } from "../src/bridge.js";
import { sayStartOf } from "../src/zoneutil.js";
import { multiSelectState, SET_MULTI } from "../src/multiselect.js";
import { inspect, type GroupLevel, type LeafLevel, type SnippetLevel, type BlockLevel, type SceneLevel, type MultiLevel } from "../src/inspect.js";

/** Build a state with the caret in the say zone of the beat `beatId`. */
function stateAtSay(scene: Scene, strings: Record<string, string>, beatId: string): EditorState {
  const doc = sceneToDoc(scene, strings);
  const at = sayStartOf(doc, beatId);
  return EditorState.create({ doc, selection: TextSelection.create(doc, at) });
}

describe("inspect: the detail-inspector context stack", () => {
  it("a dialogue line yields leaf(line) -> snippet -> block, innermost-first", () => {
    const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [
      { id: "b", type: "block", name: "Intro", children: [
        { id: "sn", type: "snippet", beats: [{ id: "L1", kind: "line", character: "BARKEEP", direction: "wiping a glass" }] },
      ] },
    ] };
    const { levels } = inspect(stateAtSay(scene, { L1: "What'll it be?" }, "L1"));
    expect(levels.map((l) => l.kind)).toEqual(["leaf", "snippet", "block", "scene"]); // scene is the outermost level
    const leaf = levels[0] as LeafLevel;
    expect(leaf.beat).toBe("line");
    expect(leaf.character).toBe("BARKEEP");
    expect(leaf.direction).toBe("wiping a glass");
    const block = levels[2] as BlockLevel;
    expect(block.name).toBe("Intro");
    expect(block.address).toBe("intro");          // derived from the name
    expect((levels[3] as SceneLevel).address).toBe("s"); // scene name "S" -> "s"
  });

  it("a text beat yields leaf(prose) with no character / direction", () => {
    const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [
      { id: "b", type: "block", name: "Intro", children: [
        { id: "sn", type: "snippet", beats: [{ id: "T1", kind: "text" }] },
      ] },
    ] };
    const leaf = inspect(stateAtSay(scene, { T1: "The tavern is dim." }, "T1")).levels[0] as LeafLevel;
    expect(leaf.beat).toBe("prose");
    expect(leaf.character).toBeUndefined();
    expect(leaf.direction).toBeUndefined();
  });

  it("surfaces the snippet's condition, jump, and effects", () => {
    const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [
      { id: "b", type: "block", name: "B", children: [
        { id: "sn", type: "snippet", condition: "gold > 0", jump: { to: "shop", mode: "call" },
          onEnter: [{ kind: "set", target: "@seen", value: "true" }], beats: [{ id: "L1", kind: "line", character: "X" }] },
      ] },
    ] };
    const snip = inspect(stateAtSay(scene, { L1: "Hi" }, "L1")).levels.find((l) => l.kind === "snippet") as SnippetLevel;
    expect(snip.condition).toBe("gold > 0");
    expect(snip.jump).toEqual({ to: "shop", mode: "call" });
    expect(snip.onEnter).toHaveLength(1);
    expect(snip.beatCount).toBe(1);
  });

  it("a line inside a choice option yields leaf -> option -> choice -> block (optionprompt skipped)", () => {
    const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [
      { id: "b", type: "block", name: "Menu", children: [
        { id: "ch", type: "group", selector: "choice", children: [
          { id: "opt", type: "group", prompt: { id: "P1", kind: "line", character: "HERO" }, secretUntilEligible: true, children: [
            { id: "sn", type: "snippet", beats: [{ id: "L1", kind: "line", character: "BARKEEP" }] },
          ] },
        ] },
      ] },
    ] };
    const { levels } = inspect(stateAtSay(scene, { P1: "Ask about work", L1: "Aye." }, "L1"));
    expect(levels.map((l) => l.kind)).toEqual(["leaf", "snippet", "group", "group", "block", "scene"]);
    const option = levels[2] as GroupLevel;
    const choice = levels[3] as GroupLevel;
    expect(option.role).toBe("option");
    expect(option.secretUntilEligible).toBe(true);
    expect(choice.role).toBe("choice");
  });

  it("detects an option by its choice container even with no secret flag (raw.prompt is stripped)", () => {
    const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [
      { id: "b", type: "block", name: "Menu", children: [
        { id: "ch", type: "group", selector: "choice", children: [
          { id: "opt", type: "group", prompt: { id: "P1", kind: "line" }, children: [ // no secretUntilEligible
            { id: "sn", type: "snippet", beats: [{ id: "L1", kind: "line" }] },
          ] },
        ] },
      ] },
    ] };
    const option = inspect(stateAtSay(scene, { P1: "Go", L1: "Hi" }, "L1")).levels[2] as GroupLevel;
    expect(option.role).toBe("option"); // recognised via the parent choice, not raw.prompt / secret
    expect(option.label).toBe("◇ option");
  });

  it("a choice level carries its options (prompt + condition + secret) for the consolidated editor", () => {
    const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [
      { id: "b", type: "block", name: "Menu", children: [
        { id: "ch", type: "group", selector: "choice", children: [
          { id: "o1", type: "group", prompt: { id: "P1", kind: "text" }, condition: "@gold > 0", children: [{ id: "s1", type: "snippet", beats: [{ id: "L1", kind: "line" }] }] },
          { id: "o2", type: "group", prompt: { id: "P2", kind: "text" }, secretUntilEligible: true, children: [{ id: "s2", type: "snippet", beats: [{ id: "L2", kind: "line" }] }] },
        ] },
      ] },
    ] };
    // caret in the first option's content; the choice is the next-but-one group up
    const choice = inspect(stateAtSay(scene, { P1: "Buy", P2: "Steal", L1: "ok", L2: "ok" }, "L1")).levels.find((l) => l.kind === "group" && l.role === "choice") as GroupLevel;
    expect(choice.options).toHaveLength(2);
    expect(choice.options![0]).toMatchObject({ id: "o1", prompt: "Buy", condition: "@gold > 0", secret: false });
    expect(choice.options![1]).toMatchObject({ id: "o2", prompt: "Steal", secret: true });
  });

  it("surfaces a sequence group's order / exhaust", () => {
    const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [
      { id: "b", type: "block", name: "B", children: [
        { id: "g", type: "group", selector: "sequence", options: { order: "shuffle", exhaust: "repeat" }, children: [
          { id: "sn", type: "snippet", beats: [{ id: "L1", kind: "line", character: "X" }] },
        ] },
      ] },
    ] };
    const grp = inspect(stateAtSay(scene, { L1: "Hi" }, "L1")).levels.find((l) => l.kind === "group") as GroupLevel;
    expect(grp.role).toBe("sequence");
    expect(grp.order).toBe("shuffle");
    expect(grp.exhaust).toBe("repeat");
  });

  it("a caret at the doc boundary still surfaces the scene (the outermost level)", () => {
    // pos 0 resolves at the very top (depth 0 = the doc): just the Scene level, so its address stays editable.
    const scene: Scene = { id: "s", type: "scene", name: "The Tavern", gameId: "tavern", blocks: [
      { id: "b", type: "block", name: "B", children: [{ id: "sn", type: "snippet", beats: [{ id: "L1", kind: "line" }] }] },
    ] };
    const doc = sceneToDoc(scene, { L1: "Hi" });
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 0) });
    const levels = inspect(state).levels;
    expect(levels).toHaveLength(1);
    const sc = levels[0] as SceneLevel;
    expect(sc.kind).toBe("scene");
    expect(sc.name).toBe("The Tavern");
    expect(sc.gameId).toBe("tavern");
    expect(sc.address).toBe("tavern"); // pinned
  });

  it("a node-selected game-event atom is surfaced as the leaf", () => {
    const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [
      { id: "b", type: "block", name: "B", children: [
        { id: "sn", type: "snippet", beats: [{ id: "A1", kind: "gameEvent", gameData: { cue: "door-slam" } }] },
      ] },
    ] };
    const doc = sceneToDoc(scene, {});
    let gameEventPos = -1; doc.descendants((n, pos) => { if (n.type.name === "gameEvent") { gameEventPos = pos; return false; } return true; });
    const state = EditorState.create({ doc, selection: NodeSelection.create(doc, gameEventPos) });
    const leaf = inspect(state).levels[0] as LeafLevel;
    expect(leaf.beat).toBe("gameEvent");
    expect(leaf.gameData).toEqual({ cue: "door-slam" });
  });

  it("a node-selected jump-only snippet is surfaced as the Snippet level", () => {
    // Clicking a jump-only bubble's chip node-selects the snippet (it has no caret-bearing beat).
    const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [
      { id: "b", type: "block", name: "B", children: [
        { id: "sn", type: "snippet", jump: { to: "elsewhere" } }, // beat-less, jump-only
      ] },
    ] };
    const doc = sceneToDoc(scene, {});
    let snipPos = -1; doc.descendants((n, pos) => { if (n.type.name === "snippet") { snipPos = pos; return false; } return true; });
    const state = EditorState.create({ doc, selection: NodeSelection.create(doc, snipPos) });
    const levels = inspect(state).levels;
    expect(levels[0]!.kind).toBe("snippet");                 // the snippet is the innermost level
    expect(levels.some((l) => l.kind === "block")).toBe(true); // its ancestors still climb
  });

  it("a multi-chunk run yields a single 'multi' level with the count, not a node stack", () => {
    const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [
      { id: "b", type: "block", name: "B", children: [
        { id: "s1", type: "snippet", beats: [{ id: "L1", kind: "line" }] },
        { id: "s2", type: "snippet", beats: [{ id: "L2", kind: "line" }] },
        { id: "s3", type: "snippet", beats: [{ id: "L3", kind: "line" }] },
      ] },
    ] };
    const doc = sceneToDoc(scene, { L1: "a", L2: "b", L3: "c" });
    let st = EditorState.create({ doc, plugins: [multiSelectState()] });
    st = st.apply(st.tr.setMeta(SET_MULTI, { ids: ["s1", "s2", "s3"], anchor: "s1" })); // the discontiguous set
    const levels = inspect(st).levels;
    expect(levels).toHaveLength(1);                  // not a node stack - one summary
    const m = levels[0] as MultiLevel;
    expect(m).toMatchObject({ kind: "multi", count: 3, snippets: 3, groups: 0 });
  });
});
