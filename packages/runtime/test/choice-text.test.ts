// ---------------------------------------------------------------------------
// Choice text (spec §5): an option's `prompt` beat IS its display text - no
// derivation, no look-ahead. A `line` prompt carries character / direction; a
// bare-snippet option (runtime tolerance) takes its first content line; nothing
// derivable => `prompt` undefined (a raw node id is never leaked). The engine
// flag `replayPromptOnChoose` optionally plays the prompt as the first beat.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import type { ProjectFile, Scene, LocaleFile } from "@patterkit/model";

const scene: Scene = {
  id: "s", type: "scene", name: "S",
  blocks: [
    { id: "b", type: "block", name: "B", children: [
      { id: "g", type: "group", selector: "choice", children: [
        // an option group with a text prompt
        { id: "label", type: "group", prompt: { id: "C_label", kind: "text" },
          children: [{ id: "label_c", type: "snippet", jump: { to: "END" } }] },
        // an option group with a LINE prompt (the PC's spoken choice)
        { id: "voiced", type: "group", prompt: { id: "C_voiced", kind: "line", character: "PLAYER" },
          children: [{ id: "voiced_c", type: "snippet", jump: { to: "END" } }] },
        // bare-snippet tolerance: prompt is its own first content line
        { id: "bareline", type: "snippet", beats: [{ id: "L_own", kind: "text" }], jump: { to: "END" } },
        // bare snippet with no content line: nothing derivable
        { id: "bare", type: "snippet", jump: { to: "END" } },
      ] },
    ] },
  ],
};
const locales: LocaleFile[] = [{
  schema: "patter/strings@0", scene: "s", locale: "en",
  strings: { C_label: "Explicit", C_voiced: "I'll go.", L_own: "Own line" },
}];

const project: ProjectFile = {
  schema: "patter/project@0", project: { id: "ct", name: "CT" },
  locales: { default: "en", all: ["en"] },
  cast: [{ name: "PLAYER" }],
};

describe("choice text is the option's prompt (spec §5)", () => {
  it("resolves a text prompt, a line prompt (with speaker), and the bare-snippet tolerance", () => {
    const flow = new Engine(exportBundle({ project, scenes: [scene], locales })).openFlow("f", { scene: "s" });
    const r = flow.advance();
    if (r.type !== "choice") throw new Error("expected a choice");
    const byId = new Map(r.options.map((o) => [o.id, o.prompt]));
    expect(byId.get("label")).toEqual({ kind: "text", text: "Explicit" });
    expect(byId.get("voiced")).toEqual({ kind: "line", text: "I'll go.", character: "PLAYER", direction: undefined });
    expect(byId.get("bareline")).toEqual({ kind: "text", text: "Own line" });
    expect(byId.get("bare")).toBeUndefined(); // nothing derivable; never the raw id
  });

  it("replayPromptOnChoose plays the chosen option's prompt as its first beat (default: off)", () => {
    // default off: choosing plays only the option's content (here, straight to END)
    const off = new Engine(exportBundle({ project, scenes: [scene], locales })).openFlow("f", { scene: "s" });
    off.advance(); off.choose("label");
    expect(off.advance()).toEqual({ type: "end" }); // the prompt is NOT replayed

    const on = new Engine(exportBundle({ project, scenes: [scene], locales }), { replayPromptOnChoose: true })
      .openFlow("f", { scene: "s" });
    on.advance(); on.choose("label");
    expect(on.advance()).toMatchObject({ type: "text", id: "C_label", text: "Explicit" }); // prompt replayed first
    expect(on.advance()).toEqual({ type: "end" });
  });

  it("still replays the prompt when a save is taken BETWEEN choose() and the next advance()", () => {
    // The pending replayed prompt lives only in the cursor until the next advance(); a save in that
    // window must carry it (re-derived from the chosen option on load), or the prompt is silently lost.
    const bundle = exportBundle({ project, scenes: [scene], locales });
    const a = new Engine(bundle, { replayPromptOnChoose: true });
    const fa = a.openFlow("f", { scene: "s" });
    fa.advance();        // -> the choice
    fa.choose("label");  // prompt now pending, but NOT yet delivered
    const blob = JSON.parse(JSON.stringify(a.saveGame())); // save in the choose -> advance window

    const b = new Engine(bundle, { replayPromptOnChoose: true });
    b.loadGame(blob);
    const fb = b.getFlow("f")!;
    expect(fb.advance()).toMatchObject({ type: "text", id: "C_label", text: "Explicit" }); // prompt survived the round-trip
    expect(fb.advance()).toEqual({ type: "end" });
  });
});
