// ---------------------------------------------------------------------------
// Content-drift restore (§9.8 + live bundle refresh): a save taken on bundle A
// and restored on an EDITED bundle A′ resumes from the right place. The stack
// stamps each frame with the id of its next child (nextId), so siblings
// inserted / removed / reordered before the cursor don't shift the resume
// point; an older save (no nextId) or a deleted next-child falls back to the
// raw index, best-effort.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import type { ProjectFile, Scene, LocaleFile, Snippet } from "@patterkit/model";

const project: ProjectFile = {
  schema: "patter/project@0",
  project: { id: "hd", name: "HotDrift" },
  locales: { default: "en", all: ["en"] },
  cast: [{ name: "NPC" }],
};

/** A one-line snippet (no jump): sequential children of the single block. */
const snip = (id: string): Snippet => ({ id: `sn_${id}`, type: "snippet", beats: [{ id: `L_${id}`, kind: "line", character: "NPC" }] });

const sceneOf = (order: string[]): Scene => ({
  id: "s", type: "scene", name: "S",
  blocks: [{ id: "b", type: "block", name: "B", children: order.map(snip) }],
});

const locale = (ids: string[]): LocaleFile => ({
  schema: "patter/strings@0", scene: "s", locale: "en",
  strings: Object.fromEntries(ids.map((id) => [`L_${id}`, `line ${id}`])),
});

const bundleOf = (order: string[], allIds: string[] = order) =>
  exportBundle({ project, scenes: [sceneOf(order)], locales: [locale(allIds)] });

/** Play `n` beats on a fresh flow over `bundle`, then return the JSON-round-tripped save. */
const playAndSave = (bundle: ReturnType<typeof bundleOf>, n: number) => {
  const engine = new Engine(bundle);
  const flow = engine.openFlow("f", { scene: "s" });
  for (let i = 0; i < n; i++) flow.advance();
  return JSON.parse(JSON.stringify(engine.saveGame()));
};

/** Restore `save` on `bundle` and return the texts of everything still to play. */
const resumeTexts = (bundle: ReturnType<typeof bundleOf>, save: unknown): string[] => {
  const engine = new Engine(bundle);
  engine.loadGame(save as Parameters<Engine["loadGame"]>[0]);
  const flow = engine.getFlow("f")!;
  const out: string[] = [];
  for (;;) {
    const r = flow.advance();
    if (r.type === "end") return out;
    if (r.type === "line") out.push(r.text);
  }
};

describe("save/load across an edited bundle (nextId stack re-binding)", () => {
  // Play A on [A, B, C]; the save's top frame points at B.
  const save = playAndSave(bundleOf(["a", "b", "c"]), 1);

  it("same bundle: resumes with B then C (baseline)", () => {
    expect(resumeTexts(bundleOf(["a", "b", "c"]), save)).toEqual(["line b", "line c"]);
  });

  it("a sibling inserted BEFORE the cursor does not replay played content", () => {
    // [X, A, B, C]: the raw index (1) would re-play A; nextId re-finds B.
    expect(resumeTexts(bundleOf(["x", "a", "b", "c"]), save)).toEqual(["line b", "line c"]);
  });

  it("a sibling inserted AT the cursor is skipped (the player was about to play B)", () => {
    // [A, X, B, C]: resumes at B exactly as saved; X plays only on a fresh run.
    expect(resumeTexts(bundleOf(["a", "x", "b", "c"]), save)).toEqual(["line b", "line c"]);
  });

  it("reordered siblings resume with the SAVED next node, not whatever sits at the index", () => {
    // [B, C, A]: the raw index (1) would play C; nextId re-finds B at 0.
    expect(resumeTexts(bundleOf(["b", "c", "a"]), save)).toEqual(["line b", "line c", "line a"]);
  });

  it("a deleted next-child falls back to the raw index (best-effort, §9.8)", () => {
    // [A, C]: B is gone; index 1 lands on C and play continues.
    expect(resumeTexts(bundleOf(["a", "c"]), save)).toEqual(["line c"]);
  });

  it("an older save without nextId still restores by index (back-compat)", () => {
    const old = JSON.parse(JSON.stringify(save)) as { flows: Record<string, { cursor: { stack: Array<{ nextId?: string }> } }> };
    for (const f of Object.values(old.flows)) for (const fr of f.cursor.stack) delete fr.nextId;
    expect(resumeTexts(bundleOf(["a", "b", "c"]), old)).toEqual(["line b", "line c"]);
  });

  it("the snapshot actually carries nextId (the ports must mirror this field)", () => {
    const s = save as { flows: Record<string, { cursor: { stack: Array<{ nextId?: string }> } }> };
    const frames = Object.values(s.flows)[0]!.cursor.stack;
    expect(frames[frames.length - 1]!.nextId).toBe("sn_b");
  });
});
