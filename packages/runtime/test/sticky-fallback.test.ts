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
    expect(flow.advance()).toEqual({ type: "end", reason: "ended" }); // the fallback jumped to END: nothing ran dry
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
    // gathers and, with nothing after it, the flow ends. No auto-follow, no throw: the end says it ran dry.
    expect(flow.advance()).toEqual({ type: "end", reason: "ran-dry" });
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
    expect(flow.advance()).toEqual({ type: "end", reason: "ran-dry" }); // choice gathers dry -> hook fires, flow ends
    expect(dry).toEqual(["g"]); // the dry choice's group id, surfaced for the coverage harness
  });
});

// A dry choice that ends the flow is reported, never thrown (Ian's rulings on choices that run dry, 2026-10-30).
describe("a choice that runs dry and ends the flow", () => {
  /** The hub: one once-only option that comes back. `after` follows the choice in the hub block. */
  const hubScene = (after: Snippet[] = []): Scene => ({
    id: "s", type: "scene", name: "S", blocks: [
      { id: "hub", type: "block", name: "Hub", children: [{ id: "g", type: "group", selector: "choice", children: [opt("ask", "hub")] }, ...after] },
    ],
  });
  const play = (scene: Scene, extraStrings: Record<string, string> = {}) => {
    const bundle = exportBundle({ project: project(), scenes: [scene], locales: [loc({ ...strings(["ask"]), ...extraStrings })] });
    const errors: Array<{ kind: string; node: string; flow: string }> = [];
    const engine = new Engine(bundle, { onError: (e) => errors.push({ kind: e.kind, node: e.node, flow: e.flow }) });
    const flow = engine.openFlow("f", { scene: "s" });
    flow.advance(); flow.choose("ask"); flow.advance(); // played ask, back at the hub, the option used
    return { bundle, engine, flow, errors };
  };

  it("reports it through onError once, and ends with reason ran-dry", () => {
    const { flow, errors } = play(hubScene());
    expect(flow.advance()).toEqual({ type: "end", reason: "ran-dry" });
    expect(errors).toEqual([{ kind: "dry-choice", node: "g", flow: "f" }]);
    expect(flow.advance()).toEqual({ type: "end", reason: "ran-dry" }); // asked again: same end, no second report
    expect(errors).toHaveLength(1);
  });

  it("an END straight after the dry choice still ends because it ran dry", () => {
    const { flow, errors } = play(hubScene([{ id: "fin", type: "snippet", jump: { to: "END" } }]));
    expect(flow.advance()).toEqual({ type: "end", reason: "ran-dry" });
    expect(errors.map((e) => e.kind)).toEqual(["dry-choice"]);
  });

  it("is silent when play carries on after it: the gather idiom", () => {
    const { flow, errors } = play(hubScene([{ id: "on", type: "snippet", beats: [{ id: "T_on", kind: "text" }] }]), { T_on: "carried on" });
    expect(flow.advance()).toMatchObject({ type: "text", text: "carried on" });
    expect(flow.advance()).toEqual({ type: "end", reason: "ended" });
    expect(errors).toEqual([]);
  });

  it("keeps the reason across a save and load, without reporting it again", () => {
    const { bundle, engine, flow } = play(hubScene());
    flow.advance();
    const blob = JSON.parse(JSON.stringify(engine.saveGame()));
    const errors: string[] = [];
    const again = new Engine(bundle, { onError: (e) => errors.push(e.kind) });
    again.loadGame(blob);
    expect(again.getFlow("f")!.advance()).toEqual({ type: "end", reason: "ran-dry" });
    expect(errors).toEqual([]);
  });

  it("is plain ended once the host ends it or moves it on", () => {
    const { flow } = play(hubScene());
    flow.advance();
    flow.goto("END");
    expect(flow.advance()).toEqual({ type: "end", reason: "ended" });
    const b = play(hubScene());
    b.flow.advance();
    b.flow.goto("s"); // an ended flow resumes; the choice is dry again, so it ends the same way, reported again
    expect(b.flow.advance()).toEqual({ type: "end", reason: "ran-dry" });
    expect(b.errors.map((e) => e.kind)).toEqual(["dry-choice", "dry-choice"]);
  });
});
