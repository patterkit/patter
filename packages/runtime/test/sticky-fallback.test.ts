// ---------------------------------------------------------------------------
// Sticky / once-only choice options + the fallback (spec §5, Ink `*` / `+` / gather):
//   - default (not sticky): once the player follows an option it is GONE from the choice -
//     absent from getChoices, not flagged unavailable. Consumption rides the per-flow visit
//     count, so it survives save/restore.
//   - sticky: always offered while its condition passes (repeatable).
//   - fallback: never a normal option; auto-followed the moment it is the only one left, but
//     only if its own condition passes - otherwise the choice gathers (falls through).
// Each scene loops back to a hub so the same choice can be reached repeatedly.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import type { ProjectFile, Scene, LocaleFile, Group, Snippet } from "@patterkit/model";

const project = (extra: Partial<ProjectFile> = {}): ProjectFile => ({
  schema: "patter/project@0", project: { id: "sf", name: "SF" },
  locales: { default: "en", all: ["en"] },
  ...extra,
});
const loc = (strings: Record<string, string>): LocaleFile =>
  ({ schema: "patter/strings@0", scene: "s", locale: "en", strings });

/** An option group: prompt + a one-beat content snippet that jumps to `to`. */
const opt = (id: string, to: string, extra: Partial<Group> = {}): Group => ({
  id, type: "group", prompt: { id: `C_${id}`, kind: "text" },
  children: [{ id: `${id}_c`, type: "snippet", beats: [{ id: `T_${id}`, kind: "text" }], jump: { to } } as Snippet],
  ...extra,
});
const choiceScene = (options: Group[]): Scene => ({
  id: "s", type: "scene", name: "S", blocks: [
    { id: "hub", type: "block", name: "Hub", children: [{ id: "g", type: "group", selector: "choice", children: options }] },
  ],
});
const strings = (ids: string[]): Record<string, string> =>
  Object.fromEntries(ids.flatMap((id) => [[`C_${id}`, id], [`T_${id}`, `played ${id}`]]));

const open = (scene: Scene, ids: string[], extra: Partial<ProjectFile> = {}) => {
  const bundle = exportBundle({ project: project(extra), scenes: [scene], locales: [loc(strings(ids))] });
  return new Engine(bundle).openFlow("f", { scene: "s" });
};
const choiceIds = (flow: ReturnType<typeof open>): string[] => flow.getChoices().map((o) => o.id);

describe("once-only (default) vs sticky", () => {
  it("a followed once-only option is gone from the next visit; a sticky one persists", () => {
    const flow = open(choiceScene([opt("once", "hub"), opt("keep", "hub", { sticky: true })]), ["once", "keep"]);
    expect(flow.advance().type).toBe("choice");
    expect(choiceIds(flow)).toEqual(["once", "keep"]);

    flow.choose("once");
    expect(flow.advance()).toMatchObject({ type: "text", text: "played once" });
    // the jump loops back to the hub choice
    expect(flow.advance().type).toBe("choice");
    expect(choiceIds(flow)).toEqual(["keep"]); // 'once' consumed - absent, not flagged

    flow.choose("keep");
    expect(flow.advance()).toMatchObject({ type: "text", text: "played keep" });
    expect(flow.advance().type).toBe("choice");
    expect(choiceIds(flow)).toEqual(["keep"]); // sticky: still here after being followed
  });

  it("once-only consumption survives save/restore (it rides the visit count)", () => {
    const scene = choiceScene([opt("once", "hub"), opt("keep", "hub", { sticky: true })]);
    const bundle = exportBundle({ project: project(), scenes: [scene], locales: [loc(strings(["once", "keep"]))] });
    let engine = new Engine(bundle);
    let flow = engine.openFlow("f", { scene: "s" });
    flow.advance(); flow.choose("once"); flow.advance(); flow.advance(); // back at the hub, 'once' consumed

    const blob = JSON.parse(JSON.stringify(engine.saveGame()));
    engine = new Engine(bundle); engine.loadGame(blob);
    flow = engine.getFlow("f")!;
    expect(choiceIds(flow)).toEqual(["keep"]); // consumption persisted across the save
  });
});

describe("fallback option", () => {
  it("is hidden until it is the only one left, then auto-follows (no choice presented)", () => {
    const fb = opt("fb", "END", { fallback: true });
    const flow = open(choiceScene([opt("real", "hub"), fb]), ["real", "fb"]);
    expect(flow.advance().type).toBe("choice");
    expect(choiceIds(flow)).toEqual(["real"]); // the fallback is not delivered

    flow.choose("real");
    expect(flow.advance()).toMatchObject({ type: "text", text: "played real" });
    // 'real' is now consumed; the only thing left is the fallback -> it auto-follows, the host is
    // never asked to choose again. The next stop is the fallback's content, NOT a choice.
    expect(flow.advance()).toMatchObject({ type: "text", text: "played fb" });
    expect(flow.advance()).toEqual({ type: "end" });
  });

  it("respects its own condition: a condition-failed fallback does not fire; the choice gathers", () => {
    const fb = opt("fb", "END", { fallback: true, condition: "@open" });
    const flow = open(choiceScene([opt("real", "hub"), fb]), ["real", "fb"], {
      properties: [{ name: "open", type: "boolean", shared: true, default: false }],
    });
    expect(flow.advance().type).toBe("choice");
    flow.choose("real");
    expect(flow.advance()).toMatchObject({ type: "text", text: "played real" });
    // 'real' consumed; the fallback's condition (@open) is false, so it is not eligible -> the choice
    // gathers and, with nothing after it, the flow ends. No auto-follow, no error.
    expect(flow.advance()).toEqual({ type: "end" });
  });

  it("fires the onDryChoice diagnostics hook when a choice runs dry (the coverage signal)", () => {
    const fb = opt("fb", "END", { fallback: true, condition: "@open" });
    const bundle = exportBundle({
      project: project({ properties: [{ name: "open", type: "boolean", shared: true, default: false }] }),
      scenes: [choiceScene([opt("real", "hub"), fb])],
      locales: [loc(strings(["real", "fb"]))],
    });
    const dry: string[] = [];
    const flow = new Engine(bundle, { onDryChoice: (id) => dry.push(id) }).openFlow("f", { scene: "s" });
    flow.advance();       // choice
    flow.choose("real");  // consume the only real option
    flow.advance();       // played real, loops back to the hub
    // The hook has NOT fired until the choice is actually re-entered and found dry.
    expect(dry).toEqual([]);
    expect(flow.advance()).toEqual({ type: "end" }); // choice gathers dry -> hook fires, flow ends
    expect(dry).toEqual(["g"]); // the dry choice's group id, surfaced for the coverage harness
  });
});
