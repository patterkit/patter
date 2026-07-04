// ---------------------------------------------------------------------------
// Pending-choice save/load REPLAYS the saved option set (decision per schema
// §9.3): conditions are NOT re-evaluated on restore - so `random()` draws are
// not consumed twice (saved run == unsaved run) and the options cannot mutate
// under the player. An option whose node drifted out of the bundle is dropped.
// Plus the dry-choice rule: a choice with no surviving option gathers (falls through), not an error.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import type { ProjectFile, Scene, LocaleFile } from "@patterkit/model";

const project = (extra: Partial<ProjectFile> = {}): ProjectFile => ({
  schema: "patter/project@0", project: { id: "cr", name: "CR" },
  locales: { default: "en", all: ["en"] },
  ...extra,
});
const loc = (strings: Record<string, string>): LocaleFile =>
  ({ schema: "patter/strings@0", scene: "s", locale: "en", strings });

describe("pending-choice replay on load", () => {
  it("does not re-consume PRNG draws: a run saved+loaded at a choice matches an unsaved run", () => {
    // The option condition draws from the PRNG; the post-choice shuffle draws
    // again. Re-deriving on load would shift the shuffle's draw.
    const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [
      { id: "b", type: "block", name: "B", children: [
        { id: "g", type: "group", selector: "choice", children: [
          { id: "lucky", type: "snippet", condition: "random(1, 100) > 0" }, // always true, consumes a draw
        ] },
        { id: "sh", type: "group", selector: "sequence", options: { order: "shuffle", exhaust: "repeat" }, children: [
          { id: "a", type: "snippet", beats: [{ id: "T_a", kind: "text" }], jump: { to: "END" } },
          { id: "b2", type: "snippet", beats: [{ id: "T_b", kind: "text" }], jump: { to: "END" } },
          { id: "c", type: "snippet", beats: [{ id: "T_c", kind: "text" }], jump: { to: "END" } },
        ] },
      ] },
    ] };
    const bundle = exportBundle({ project: project(), scenes: [scene],
      locales: [loc({ C_go: "Go", T_a: "A", T_b: "B", T_c: "C" })] });

    const run = (saveAtChoice: boolean): string => {
      let engine = new Engine(bundle, { seed: 42 });
      let flow = engine.openFlow("f", { scene: "s" });
      const r = flow.advance();
      if (r.type !== "choice") throw new Error("expected choice");
      if (saveAtChoice) {
        const blob = JSON.parse(JSON.stringify(engine.saveGame()));
        engine = new Engine(bundle, { seed: 42 });
        engine.loadGame(blob);
        flow = engine.getFlow("f")!;
        expect(flow.getChoices()).toHaveLength(1); // the replayed option set
      }
      flow.choose("lucky");
      const after = flow.advance();
      if (after.type !== "text") throw new Error("expected text");
      return after.text;
    };

    expect(run(true)).toBe(run(false));
  });

  it("replays the option set verbatim even when state changed between save and load", () => {
    const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [
      { id: "b", type: "block", name: "B", children: [
        { id: "g", type: "group", selector: "choice", children: [
          { id: "gated", type: "snippet", condition: "@open", jump: { to: "END" } },
          { id: "always", type: "snippet", jump: { to: "END" } },
        ] },
      ] },
    ] };
    const bundle = exportBundle({
      project: project({ properties: [{ name: "open", type: "boolean", shared: true, default: true }] }),
      scenes: [scene], locales: [loc({ C_g: "Gated", C_a: "Always" })],
    });
    const a = new Engine(bundle);
    const fa = a.openFlow("f", { scene: "s" });
    const r = fa.advance();
    if (r.type !== "choice") throw new Error("expected choice");
    expect(r.options.find((o) => o.id === "gated")?.eligible).toBe(true);
    const blob = JSON.parse(JSON.stringify(a.saveGame()));

    const b = new Engine(bundle);
    b.setProperty("@open", false); // the world moved on - but the SAVED choice is what the player saw
    b.loadGame(blob);
    const restored = b.getFlow("f")!.getChoices();
    expect(restored.find((o) => o.id === "gated")?.eligible).toBe(true); // replayed, not re-derived
  });

  it("drops a replayed option whose node drifted out of the bundle", () => {
    const sceneWith = (extra: boolean): Scene => ({ id: "s", type: "scene", name: "S", blocks: [
      { id: "b", type: "block", name: "B", children: [
        { id: "g", type: "group", selector: "choice", children: [
          { id: "keep", type: "snippet", jump: { to: "END" } },
          ...(extra ? [{ id: "gone", type: "snippet" as const, jump: { to: "END" } }] : []),
        ] },
      ] },
    ] });
    const strings = loc({ C_k: "Keep", C_x: "Gone" });
    const a = new Engine(exportBundle({ project: project(), scenes: [sceneWith(true)], locales: [strings] }));
    a.openFlow("f", { scene: "s" }).advance();
    const blob = JSON.parse(JSON.stringify(a.saveGame()));

    const b = new Engine(exportBundle({ project: project(), scenes: [sceneWith(false)], locales: [strings] }));
    b.loadGame(blob);
    const options = b.getFlow("f")!.getChoices();
    expect(options.map((o) => o.id)).toEqual(["keep"]);
    b.getFlow("f")!.choose("keep"); // the surviving option is still choosable
  });
});

describe("a dry / empty choice gathers (falls through) instead of deadlocking", () => {
  it("an all-ineligible-and-hidden choice contributes nothing; the run continues past it", () => {
    // No normal option survives (all hidden + ineligible) and there is no fallback, so the choice
    // gathers - it delivers nothing and the run carries straight on to the following content. (The
    // validator warns about choices that can run dry; the runtime no longer treats it as an error.)
    const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [
      { id: "b", type: "block", name: "B", children: [
        { id: "g", type: "group", selector: "choice", children: [
          { id: "h1", type: "snippet", condition: "@never", secretUntilEligible: true, jump: { to: "END" } },
          { id: "h2", type: "snippet", condition: "@never", secretUntilEligible: true, jump: { to: "END" } },
        ] },
        { id: "after", type: "snippet", beats: [{ id: "T_after", kind: "text" }], jump: { to: "END" } },
      ] },
    ] };
    const bundle = exportBundle({
      project: project({ properties: [{ name: "never", type: "boolean", shared: true, default: false }] }),
      scenes: [scene], locales: [loc({ T_after: "the run continued" })],
    });
    const flow = new Engine(bundle).openFlow("f", { scene: "s" });
    const r = flow.advance();
    expect(r.type).toBe("text");                          // gathered straight through, no choice, no throw
    expect((r as { text: string }).text).toBe("the run continued");
  });
});
