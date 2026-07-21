// ---------------------------------------------------------------------------
// Flow.goto(scene, block?) - host navigation by ADDRESS (spec §6 gameIds).
//
// It behaves exactly like an authored `go` jump: the target scene's onEntry runs,
// entering counts as a visit, and the callstack is REPLACED (pending call-returns
// discarded). Unlike an authored jump it is out-of-band, so it lands IMMEDIATELY -
// the rest of the snippet being delivered is abandoned, as is a pending choice.
// It MOVES the cursor; it never resets per-flow state (contrast start()/reset()).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import type { ProjectFile, Scene, LocaleFile } from "@patterkit/model";

const project = (): ProjectFile => ({
  schema: "patter/project@0",
  project: { id: "p", name: "Goto" },
  locales: { default: "en", all: ["en"] },
  voiced: false,
  properties: [{ name: "entered", type: "number", shared: true, default: 0 }],
});

// Addresses are DERIVED from the names (no pinned gameIds), which the goto must resolve:
//   scenes: "Hub" -> hub, "Side Room" -> side-room
//   blocks: "Main" -> main, "Far" -> far, "Corner" -> corner, "Talk" -> talk
const hub: Scene = {
  id: "scn_hub", type: "scene", name: "Hub",
  blocks: [
    { id: "b_main", type: "block", name: "Main", children: [
      // Calls into Far, so a pending RETURN frame exists while Far plays.
      { id: "sn_call", type: "snippet", beats: [{ id: "L_a", kind: "text" }], jump: { to: "b_far", mode: "call" } },
      // Only ever reached by RETURNING from that call - a goto must discard it.
      { id: "sn_after", type: "snippet", beats: [{ id: "L_after", kind: "text" }], jump: { to: "END" } },
    ] },
    { id: "b_far", type: "block", name: "Far", children: [
      // Three beats: a goto after the first must abandon the other two.
      { id: "sn_far", type: "snippet", beats: [
        { id: "L_far1", kind: "text" }, { id: "L_far2", kind: "text" }, { id: "L_far3", kind: "text" },
      ] },
    ] },
    { id: "b_corner", type: "block", name: "Corner", children: [
      { id: "sn_corner", type: "snippet", beats: [{ id: "L_corner", kind: "text" }], jump: { to: "END" } },
    ] },
  ],
};

const side: Scene = {
  id: "scn_side", type: "scene", name: "Side Room",
  onEntry: [{ kind: "set", target: "@entered", value: "@entered + 1" }], // proves a NORMAL scene entry
  blocks: [
    { id: "b_talk", type: "block", name: "Talk", children: [
      { id: "sn_talk", type: "snippet", beats: [{ id: "L_talk", kind: "text" }], jump: { to: "END" } },
    ] },
  ],
};

const strings = (scene: string, s: Record<string, string>): LocaleFile =>
  ({ schema: "patter/strings@0", scene, locale: "en", default: true, strings: s });

const bundle = (): ReturnType<typeof exportBundle> => exportBundle({
  project: project(),
  scenes: [hub, side],
  locales: [
    strings("scn_hub", { L_a: "a", L_after: "returned", L_far1: "far1", L_far2: "far2", L_far3: "far3", L_corner: "corner" }),
    strings("scn_side", { L_talk: "talk (entered {@entered})" }),
  ],
});

const open = () => new Engine(bundle()).openFlow("f", { scene: "hub" });
// `played` mixes line / text / gameEvent, and a gameEvent carries no text - hence `type` here, so the
// whole union is assignable (a text-only shape would trip TS's weak-type check).
const stepTexts = (steps: Array<{ type: string; text?: string }>): string[] => steps.map((s) => s.text ?? "");
const texts = (r: { played: Array<{ type: string; text?: string }> }): string[] => stepTexts(r.played);

// ---------------------------------------------------------------------------
// The BARK loop: one long-lived flow, repositioned by the game. Play a bark, consume
// its lines, goto the next bark location, consume those. Each bark runs out of content
// so the flow ENDS between hops, and the next goto revives it - and because goto moves
// without resetting, a "once each" variation list keeps its place across hops.
// ---------------------------------------------------------------------------
const barks: Scene = {
  id: "scn_barks", type: "scene", name: "Barks",
  blocks: [
    { id: "b_greet", type: "block", name: "Greet", children: [
      { id: "g_greet", type: "group", selector: "sequence", options: { order: "sequential", exhaust: "once" }, children: [
        { id: "sn_g1", type: "snippet", beats: [{ id: "G1", kind: "text" }] },
        { id: "sn_g2", type: "snippet", beats: [{ id: "G2", kind: "text" }] },
        { id: "sn_g3", type: "snippet", beats: [{ id: "G3", kind: "text" }] },
      ] },
    ] },
    { id: "b_alert", type: "block", name: "Alert", children: [
      { id: "sn_alert", type: "snippet", beats: [{ id: "A1", kind: "text" }, { id: "A2", kind: "text" }] },
    ] },
  ],
};

describe("the bark loop (one flow, repositioned by the game)", () => {
  const barkBundle = () => exportBundle({
    project: project(),
    scenes: [barks],
    locales: [strings("scn_barks", {
      G1: "greet one", G2: "greet two", G3: "greet three", A1: "alert a", A2: "alert b",
    })],
  });

  it("plays a bark, ends, repositions, and keeps variation state across hops", () => {
    const flow = new Engine(barkBundle()).openFlow("barks", { scene: "barks" });

    // 1st bark: the flow runs out of content, so it ends. That is normal between barks.
    expect(texts(flow.advanceToStop())).toEqual(["greet one"]);
    expect(flow.isEnded()).toBe(true);

    // Reposition to a different bark location and consume it.
    expect(flow.goto("barks", "alert")).toBe(true);
    expect(texts(flow.advanceToStop())).toEqual(["alert a", "alert b"]);

    // Back to the greeting: the "once each" list RESUMES - it does not replay "greet one".
    expect(flow.goto("barks", "greet")).toBe(true);
    expect(texts(flow.advanceToStop())).toEqual(["greet two"]);

    expect(flow.goto("barks", "greet")).toBe(true);
    expect(texts(flow.advanceToStop())).toEqual(["greet three"]);

    // Exhausted: the block yields nothing and the flow simply ends again - no crash, no replay.
    expect(flow.goto("barks", "greet")).toBe(true);
    expect(texts(flow.advanceToStop())).toEqual([]);
    expect(flow.isEnded()).toBe(true);
  });
});

describe("Engine.runFlow (the one-call bark form)", () => {
  const barkBundle = () => exportBundle({
    project: project(),
    scenes: [barks],
    locales: [strings("scn_barks", {
      G1: "greet one", G2: "greet two", G3: "greet three", A1: "alert a", A2: "alert b",
    })],
  });

  it("opens on first call, then REUSES the named flow so variation advances", () => {
    const engine = new Engine(barkBundle());
    // Same flow name each call: the "once each" list walks forward instead of replaying.
    expect(stepTexts(engine.runFlow("npc1", "barks", "greet"))).toEqual(["greet one"]);
    expect(stepTexts(engine.runFlow("npc1", "barks", "alert"))).toEqual(["alert a", "alert b"]);
    expect(stepTexts(engine.runFlow("npc1", "barks", "greet"))).toEqual(["greet two"]);
    expect(stepTexts(engine.runFlow("npc1", "barks", "greet"))).toEqual(["greet three"]);
    // Exhausted: [] is the "nothing left" signal, not an error.
    expect(engine.runFlow("npc1", "barks", "greet")).toEqual([]);
  });

  it("different names keep independent state, so two speakers don't share a variation list", () => {
    const engine = new Engine(barkBundle());
    expect(stepTexts(engine.runFlow("npc1", "barks", "greet"))).toEqual(["greet one"]);
    expect(stepTexts(engine.runFlow("npc2", "barks", "greet"))).toEqual(["greet one"]); // npc2 starts fresh
    expect(stepTexts(engine.runFlow("npc1", "barks", "greet"))).toEqual(["greet two"]); // npc1 carries on
  });

  it("throws on an address that does not resolve, so [] only ever means 'nothing left'", () => {
    const engine = new Engine(barkBundle());
    engine.runFlow("npc1", "barks", "greet");
    expect(() => engine.runFlow("npc1", "barks", "no-such-bark")).toThrow(/address not found/);
    expect(stepTexts(engine.runFlow("npc1", "barks", "greet"))).toEqual(["greet two"]); // unmoved by the failure
  });
});

describe("dropping a flow finishes it (a stale reference cannot drive the world)", () => {
  // Before this, a dropped flow stayed fully live: unregistered, but still able to run scene onEntry
  // and move shared visit counts / selector cursors if the host kept the object.
  const shared = () => exportBundle({
    project: project(),
    scenes: [side],                       // its onEntry does @entered = @entered + 1
    locales: [strings("scn_side", { L_talk: "talk (entered {@entered})" })],
  });

  it("re-opening a name closes the old flow, so the orphan is inert", () => {
    const engine = new Engine(shared());
    const orphan = engine.openFlow("npc", { scene: "side-room" });   // entered -> 1
    const fresh = engine.openFlow("npc", { scene: "side-room" });    // entered -> 2, orphan closed

    expect(orphan.isClosed).toBe(true);
    expect(fresh.isClosed).toBe(false);
    expect(engine.getFlow("npc")).toBe(fresh);

    // The orphan drives nothing: no beats, and goto refuses rather than reviving it.
    expect(orphan.advance()).toMatchObject({ type: "end" });
    expect(orphan.goto("side-room")).toBe(false);

    // ...so the shared counter is still 2 - the orphan never re-ran the scene's onEntry.
    expect(fresh.advance()).toMatchObject({ text: "talk (entered 2)" });
  });

  it("closeFlow and engine.reset() finish their flows too", () => {
    const engine = new Engine(shared());
    const a = engine.openFlow("a", { scene: "side-room" });
    engine.closeFlow("a");
    expect(a.isClosed).toBe(true);
    expect(a.goto("side-room")).toBe(false);

    const b = engine.openFlow("b", { scene: "side-room" });
    engine.reset();
    expect(b.isClosed).toBe(true);
    expect(b.advance()).toMatchObject({ type: "end" });
  });

  it("runFlow REUSES a name (it never replaces), which is what preserves variation", () => {
    const engine = new Engine(exportBundle({
      project: project(), scenes: [barks],
      locales: [strings("scn_barks", { G1: "greet one", G2: "greet two", G3: "greet three", A1: "a", A2: "b" })],
    }));
    engine.runFlow("npc", "barks", "greet");
    const held = engine.getFlow("npc")!;
    engine.runFlow("npc", "barks", "greet");
    expect(engine.getFlow("npc")).toBe(held);   // same flow object throughout
    expect(held.isClosed).toBe(false);

    // openFlow on that same name, by contrast, resets it - the list restarts at the first variant.
    // Open at a DIFFERENT block: opening straight at "greet" would itself settle onto a variation and
    // consume "greet one" before we ever advanced, hiding the reset we are checking for.
    engine.openFlow("npc", { scene: "barks", block: "alert" });
    expect(held.isClosed).toBe(true);
    expect(stepTexts(engine.runFlow("npc", "barks", "greet"))).toEqual(["greet one"]);
  });
});

describe("Flow.goto", () => {
  it("moves to a scene address, running its onEntry as a normal scene entry", () => {
    const flow = open();
    expect(flow.advance()).toMatchObject({ text: "a" });
    expect(flow.goto("side-room")).toBe(true);
    // onEntry ran (entered 0 -> 1) and we are delivering the target scene's content.
    expect(flow.advance()).toMatchObject({ text: "talk (entered 1)" });
  });

  it("takes a scene-scoped BLOCK address within that scene", () => {
    const flow = open();
    expect(flow.goto("hub", "corner")).toBe(true);
    expect(flow.advance()).toMatchObject({ text: "corner" });
  });

  it("abandons the rest of the snippet AND any pending call-return", () => {
    const flow = open();
    expect(flow.advance()).toMatchObject({ text: "a" });      // Main, then call -> Far
    expect(flow.advance()).toMatchObject({ text: "far1" });   // mid-snippet, with a return frame pending
    expect(flow.goto("side-room", "talk")).toBe(true);

    const rest = texts(flow.advanceToStop());
    expect(rest).toEqual(["talk (entered 1)"]);               // ...and then END
    expect(rest).not.toContain("far2");                       // rest of the snippet abandoned
    expect(rest).not.toContain("far3");
    expect(rest).not.toContain("returned");                   // the pending call-return was discarded
    expect(flow.isEnded()).toBe(true);
  });

  it("an unknown address returns false and leaves the cursor exactly where it was", () => {
    const flow = open();
    expect(flow.advance()).toMatchObject({ text: "a" });
    expect(flow.goto("no-such-scene")).toBe(false);
    expect(flow.goto("hub", "no-such-block")).toBe(false);
    // A block address is SCENE-SCOPED: "talk" exists, but not in hub.
    expect(flow.goto("hub", "talk")).toBe(false);
    expect(flow.advance()).toMatchObject({ text: "far1" });    // untouched: the call proceeded as normal
  });

  it("accepts internal ids as well as addresses", () => {
    const flow = open();
    expect(flow.goto("scn_hub", "b_corner")).toBe(true);
    expect(flow.advance()).toMatchObject({ text: "corner" });
  });

  it("revives a flow that already ended", () => {
    const flow = open();
    flow.advanceToStop();
    expect(flow.isEnded()).toBe(true);
    expect(flow.goto("hub", "corner")).toBe(true);
    expect(flow.isEnded()).toBe(false);
    expect(flow.advance()).toMatchObject({ text: "corner" });
  });

  it("ends the flow on goto(\"END\")", () => {
    const flow = open();
    expect(flow.goto("END")).toBe(true);
    expect(flow.isEnded()).toBe(true);
    expect(flow.advance()).toMatchObject({ type: "end" });
  });

  it("MOVES without resetting: visit counts keep accumulating across a goto", () => {
    const flow = open();
    flow.goto("side-room");        // 1st entry: onEntry sets entered = 1
    flow.goto("hub", "corner");
    flow.goto("side-room");        // 2nd entry: a reset would have put it back to 1
    expect(flow.advance()).toMatchObject({ text: "talk (entered 2)" });
  });
});
