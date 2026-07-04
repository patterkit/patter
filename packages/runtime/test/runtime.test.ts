import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import type { ProjectFile, Scene, LocaleFile } from "@patterkit/model";

// A small bundle exercising: a line, a block jump, a choice group with one
// eligible + one ineligible option, the chosen pure-jump option, a `set`
// effect mutating a property, and an END jump.
function makeBundle() {
  const project: ProjectFile = {
    schema: "patter/project@0",
    project: { id: "proj_1", name: "Demo" },
    locales: { default: "en", all: ["en"] },
    voiced: false,
    properties: [{ name: "hp", type: "number", shared: true, default: 10 }],
    cast: [{ name: "NPC" }],
  };

  const scene: Scene = {
    id: "scn_1", type: "scene", name: "Demo",
    blocks: [
      {
        id: "start", type: "block", name: "Start",
        children: [
          {
            id: "sn_intro", type: "snippet",
            beats: [{ id: "L_intro", kind: "line", character: "NPC" }],
            jump: { to: "menu" },
          },
        ],
      },
      {
        id: "menu", type: "block", name: "Menu",
        children: [
          {
            id: "grp_choice", type: "group", selector: "choice",
            children: [
              { id: "sn_yes", type: "group", prompt: { id: "L_yes", kind: "text" },
                children: [{ id: "sn_yes_c", type: "snippet", jump: { to: "after_yes" } }] },
              { id: "sn_locked", type: "snippet", condition: "@hp > 100",
                beats: [{ id: "L_locked", kind: "line", character: "NPC" }] },
            ],
          },
        ],
      },
      {
        id: "after_yes", type: "block", name: "AfterYes",
        children: [
          {
            id: "sn_done", type: "snippet",
            onEnter: [{ kind: "set", target: "@hp", value: "@hp + 5" }],
            beats: [{ id: "L_done", kind: "line", character: "NPC" }],
            jump: { to: "END" },
          },
        ],
      },
    ],
  };

  const en: LocaleFile = {
    schema: "patter/strings@0", scene: "scn_1", locale: "en", default: true,
    strings: { L_intro: "Welcome.", L_yes: "Continue", L_locked: "[locked]", L_done: "Done." },
  };

  return exportBundle({ project, scenes: [scene], locales: [en] });
}

describe("Engine", () => {
  it("plays a flow: line -> jump -> choice -> effect -> end", () => {
    const engine = new Engine(makeBundle());
    const flow = engine.openFlow("main", { scene: "scn_1" });

    // First the intro line.
    expect(flow.advance()).toMatchObject({ type: "line", id: "L_intro", text: "Welcome.", character: "NPC" });

    // The jump lands on the choice group.
    const step = flow.advance();
    expect(step.type).toBe("choice");

    const options = flow.getChoices();
    expect(options.map((o) => o.id)).toEqual(["sn_yes", "sn_locked"]);
    expect(options.find((o) => o.id === "sn_yes")).toMatchObject({ eligible: true, prompt: { text: "Continue" } });
    expect(options.find((o) => o.id === "sn_locked")).toMatchObject({ eligible: false, prompt: { text: "[locked]" } });

    // hp starts at its declared default.
    expect(flow.getProperty("@hp")).toBe(10);

    // Choosing the ineligible option is rejected.
    expect(() => flow.choose("sn_locked")).toThrow(/not eligible/);

    flow.choose("sn_yes");

    // The chosen pure-jump option routes to after_yes, whose onEnter set fires.
    expect(flow.advance()).toMatchObject({ type: "line", id: "L_done", text: "Done." });
    expect(flow.getProperty("@hp")).toBe(15);

    // Falling off the END jump ends the flow.
    expect(flow.advance()).toEqual({ type: "end" });
    expect(flow.isEnded()).toBe(true);
  });

  it("hides options flagged secretUntilEligible", () => {
    const project: ProjectFile = {
      schema: "patter/project@0",
      project: { id: "p", name: "P" },
      locales: { default: "en", all: ["en"] },
      properties: [{ name: "hp", type: "number", shared: true, default: 0 }],
    };
    const scene: Scene = {
      id: "s", type: "scene", name: "S",
      blocks: [{
        id: "b", type: "block", name: "B",
        children: [{
          id: "g", type: "group", selector: "choice",
          children: [
            { id: "shown", type: "snippet", jump: { to: "END" } },
            { id: "gone", type: "snippet", condition: "@hp > 5", secretUntilEligible: true, jump: { to: "END" } },
          ],
        }],
      }],
    };
    const en: LocaleFile = { schema: "patter/strings@0", scene: "s", locale: "en", strings: { L_a: "A", L_b: "B" } };

    const engine = new Engine(exportBundle({ project, scenes: [scene], locales: [en] }));
    const flow = engine.openFlow("main", { scene: "s" });
    expect(flow.advance().type).toBe("choice");
    expect(flow.getChoices().map((o) => o.id)).toEqual(["shown"]);
  });

  it("seeds flow-local defaults and fires set effects", () => {
    const project: ProjectFile = {
      schema: "patter/project@0",
      project: { id: "p", name: "P" },
      locales: { default: "en", all: ["en"] },
      properties: [
        { name: "mood", type: "string", shared: false, default: "calm" },
        { name: "pinged", type: "number", shared: false, default: 0 },
      ],
    };
    const scene: Scene = {
      id: "s", type: "scene", name: "S",
      blocks: [{
        id: "b", type: "block", name: "B",
        children: [{
          id: "sn", type: "snippet",
          // Effects are set-only (spec §15): an onEnter set mutates a property; its value is an expression.
          onEnter: [{ kind: "set", target: "@patter.pinged", value: "1 + 1" }],
          beats: [{ id: "L", kind: "line" }],
          jump: { to: "END" },
        }],
      }],
    };
    const en: LocaleFile = { schema: "patter/strings@0", scene: "s", locale: "en", strings: { L: "hi" } };

    const engine = new Engine(exportBundle({ project, scenes: [scene], locales: [en] }));
    const flow = engine.openFlow("main", { scene: "s" });
    flow.advance();

    // The flow-local default survived start().
    expect(flow.getProperty("@patter.mood")).toBe("calm");
    // The onEnter set effect fired, its value expression evaluated.
    expect(flow.getProperty("@patter.pinged")).toBe(2);
  });

  it("delivers a scene of text beats as a stream (codex-style prose)", () => {
    const project: ProjectFile = {
      schema: "patter/project@0",
      project: { id: "p", name: "P" },
      locales: { default: "en", all: ["en"] },
      voiced: false,
    };
    // A scene whose snippets carry only text beats; the host pulls them as a flat
    // stream and concatenates to build, e.g., a codex entry.
    const scene: Scene = {
      id: "codex", type: "scene", name: "Codex",
      blocks: [{
        id: "entry", type: "block", name: "Entry",
        children: [
          { id: "p1", type: "snippet", beats: [{ id: "T1", kind: "text" }], jump: { to: "more" } },
        ],
      }, {
        id: "more", type: "block", name: "More",
        children: [
          { id: "p2", type: "snippet", beats: [{ id: "T2", kind: "text" }], jump: { to: "END" } },
        ],
      }],
    };
    const en: LocaleFile = {
      schema: "patter/strings@0", scene: "codex", locale: "en",
      strings: { T1: "A great winged beast,", T2: "seldom seen." },
    };

    const engine = new Engine(exportBundle({ project, scenes: [scene], locales: [en] }));
    const flow = engine.openFlow("main", { scene: "codex" });

    const body: string[] = [];
    for (;;) {
      const step = flow.advance();
      if (step.type === "end") break;
      expect(step.type).toBe("text");
      if (step.type === "text") body.push(step.text);
    }
    expect(body.join(" ")).toBe("A great winged beast, seldom seen.");
  });

  it("runs a scene's onEntry effects against its scene-local props", () => {
    const project: ProjectFile = {
      schema: "patter/project@0",
      project: { id: "p", name: "P" },
      locales: { default: "en", all: ["en"] },
      voiced: false,
      properties: [{ name: "flips", type: "number", shared: true, default: 0 }],
    };
    const scene: Scene = {
      id: "codex2", type: "scene", name: "Codex",
      sceneProps: [{ name: "local", type: "number", default: 7, shared: false }],
      onEntry: [{ kind: "set", target: "@flips", value: "@scene.local + 1" }],
      blocks: [{
        id: "b", type: "block", name: "B",
        children: [{ id: "s", type: "snippet", beats: [{ id: "T", kind: "text" }], jump: { to: "END" } }],
      }],
    };
    const en: LocaleFile = { schema: "patter/strings@0", scene: "codex2", locale: "en", strings: { T: "hi" } };

    const engine = new Engine(exportBundle({ project, scenes: [scene], locales: [en] }));
    const flow = engine.openFlow("main", { scene: "codex2" });
    // onEntry ran at entry, reading the scene-local default (7) + 1.
    expect(flow.getProperty("@flips")).toBe(8);
    expect(flow.advance()).toMatchObject({ type: "text", id: "T", text: "hi" });
    expect(flow.advance()).toEqual({ type: "end" });
  });

  it("mixes line, narration, and a choice in one scene (text-adventure shape)", () => {
    const project: ProjectFile = {
      schema: "patter/project@0",
      project: { id: "p", name: "P" },
      locales: { default: "en", all: ["en"] },
      voiced: false,
      cast: [{ name: "BARKEEP" }],
    };
    // One scene: a spoken line, then prose narration, then narrative choices -
    // the host's tagged beat stream goes line -> text -> choice.
    const tavern: Scene = {
      id: "tavern", type: "scene", name: "Tavern",
      blocks: [{
        id: "greet", type: "block", name: "Greet",
        children: [
          {
            id: "sn_g", type: "snippet",
            beats: [
              { id: "L_g", kind: "line", character: "BARKEEP" }, // spoken
              { id: "T_desc", kind: "text" },                    // narration in the same snippet
            ],
            jump: { to: "choices" },
          },
        ],
      }, {
        id: "choices", type: "block", name: "Choices",
        children: [{
          id: "grp", type: "group", selector: "choice",
          children: [
            // A bare-snippet option: its prompt is its own first content line (tolerance).
            { id: "north", type: "snippet", beats: [{ id: "O_north", kind: "text" }], jump: { to: "END" } },
            { id: "leave", type: "snippet", beats: [{ id: "O_leave", kind: "text" }], jump: { to: "END" } },
          ],
        }],
      }],
    };
    const en: LocaleFile = {
      schema: "patter/strings@0", scene: "tavern", locale: "en",
      strings: { L_g: "Welcome.", T_desc: "A dim room.", O_north: "Go north", O_leave: "Leave" },
    };

    const engine = new Engine(exportBundle({ project, scenes: [tavern], locales: [en] }));
    const flow = engine.openFlow("main", { scene: "tavern" });

    expect(flow.advance()).toMatchObject({ type: "line", id: "L_g", character: "BARKEEP" });
    // Same snippet, next beat: the stream switches line -> text.
    expect(flow.advance()).toMatchObject({ type: "text", id: "T_desc", text: "A dim room." });

    const step = flow.advance();
    expect(step.type).toBe("choice");
    const opts = flow.getChoices();
    expect(opts.find((o) => o.id === "north")).toMatchObject({ prompt: { text: "Go north" }, eligible: true });
    expect(opts.find((o) => o.id === "leave")).toMatchObject({ prompt: { text: "Leave" }, eligible: true });

    flow.choose("north");
    expect(flow.advance()).toMatchObject({ type: "text", id: "O_north", text: "Go north" });
    expect(flow.advance()).toEqual({ type: "end" });
  });

  it("advances a sequence selector across re-entries", () => {
    const project: ProjectFile = {
      schema: "patter/project@0",
      project: { id: "p", name: "P" },
      locales: { default: "en", all: ["en"] },
    };
    // The first child jumps back into its own block, re-entering the sequence
    // group (default sequential, once), which then yields its second child.
    const scene: Scene = {
      id: "s", type: "scene", name: "S",
      blocks: [{
        id: "loop", type: "block", name: "Loop",
        children: [{
          id: "seq", type: "group", selector: "sequence",
          children: [
            { id: "a", type: "snippet", beats: [{ id: "L1", kind: "line" }], jump: { to: "loop" } },
            { id: "b", type: "snippet", beats: [{ id: "L2", kind: "line" }], jump: { to: "END" } },
          ],
        }],
      }],
    };
    const en: LocaleFile = { schema: "patter/strings@0", scene: "s", locale: "en", strings: { L1: "one", L2: "two" } };

    const engine = new Engine(exportBundle({ project, scenes: [scene], locales: [en] }));
    const flow = engine.openFlow("main", { scene: "s" });
    expect(flow.advance()).toMatchObject({ type: "line", id: "L1" });
    expect(flow.advance()).toMatchObject({ type: "line", id: "L2" });
    expect(flow.advance()).toEqual({ type: "end" });
  });
});
