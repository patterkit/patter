// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// Z1 render check: mount a real EditorView from the real tavern shard in the
// zone model and assert it renders - bubbles, cue zones tinted by character, the
// say-zone content, the game-event chip, the jump line, and the choice group rail
// (its option snippets render as bubbles inside the rail).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { openScene } from "../src/load.js";
import { mountSurface } from "./surface.js";
import { nodeViews, setJumpNavHandler, setJumpLabelResolver, refreshJumpLabels, humanizeCondition } from "./views.js";
import flowSource from "../test/fixtures/tavern.patterflow?raw";
import locSource from "../test/fixtures/tavern.patterloc?raw";

describe("EditorView renders the real shard in the zone model (jsdom)", () => {
  it("produces bubbles, cue zones, content, a game-event chip, a jump, and a choice rail", () => {
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const view = new EditorView(mount, {
      state: EditorState.create({ doc: openScene(flowSource, locSource).doc }),
      nodeViews,
    });
    const dom = view.dom as HTMLElement;

    expect(dom.querySelectorAll(".bubble").length).toBe(11);                // 7 scene snippets + 4 choice options' content
    const cues = [...dom.querySelectorAll(".beat.kind-line .zone.cue .cue-text")].map((c) => c.textContent);
    expect(cues.length).toBe(13);                                           // every dialogue line's character cue
    expect(new Set(cues)).toEqual(new Set(["BARKEEP", "ANNA", "BO"]));      // three speakers -> three palette colours
    // narration (text) beats outside the option PROMPT cells, + the four option PROMPT cells (§13.10)
    expect(dom.querySelectorAll(".option-prompt").length).toBe(4);
    expect(dom.querySelectorAll(".beat.kind-prose:not(.option-prompt .beat.kind-prose)").length).toBe(9);
    expect(dom.querySelector(".beat.kind-gameEvent .atom-glyph")?.textContent).toBe("⚙ game event");
    expect(dom.querySelector(".bubble.has-jump .bubble-jump")?.textContent).toBe("↪ menu");   // read-only snippet jump chip
    // the choice is a real recursive group, rendered as a rail (its options live inside it)
    const choice = dom.querySelector(".group-rail.is-choice");
    expect(choice?.querySelector(".group-rail-label")?.textContent).toBe("choice");
    expect(choice!.querySelectorAll(".bubble").length).toBe(4);             // the four options' content bubbles nest inside the rail
    expect(choice!.querySelectorAll(".option-prompt").length).toBe(4);      // ...each with its tied prompt cell

    // content lives in the say zones, from the locale:
    expect(dom.textContent).toContain("What'll it be, stranger?");
    expect(dom.textContent).toContain("pipe-smoke");
    view.destroy();
  });

  it("double-clicking a jump chip follows the divert (calls the nav handler with the target id)", () => {
    let navigatedTo: string | null = null;
    setJumpNavHandler((id) => { navigatedTo = id; });
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const view = new EditorView(mount, { state: EditorState.create({ doc: openScene(flowSource, locSource).doc }), nodeViews });
    const chip = (view.dom as HTMLElement).querySelector(".bubble.has-jump .bubble-jump") as HTMLElement;
    expect(chip).toBeTruthy();
    chip.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    expect(navigatedTo).toBeTruthy();          // the target block's opaque id (the jump points to "menu")
    expect(navigatedTo).not.toBe("END");
    setJumpNavHandler(null);
    view.destroy();
  });

  it("humanizes the real Tour project's bareword AND quoted visits() conditions to the block title", () => {
    // End-to-end against the shipped example: The Tour has visits(blk_v0qnj91x)==1 (bareword) and
    // visits('blk_v0qnj91x')>1 (quoted) referencing "The Crossroads" - both must render the title.
    const flow = readFileSync(resolve(process.cwd(), "examples/projects/tour.patter/scenes/tour.patterflow"), "utf8");
    const loc = readFileSync(resolve(process.cwd(), "examples/projects/tour.patter/loc/en/tour.patterloc"), "utf8");
    const editor = document.createElement("div"); document.body.appendChild(editor);
    (editor as unknown as { scrollTo: () => void }).scrollTo = () => undefined;
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    const surface = mountSurface({ editor, flowSource: flow, locSource: loc });
    const conds = [...editor.querySelectorAll(".bubble-cond, .group-rail-cond")].map((c) => c.textContent?.trim() ?? "");
    const crossroads = conds.filter((c) => /visits\(/.test(c) && /== 1|> 1/.test(c));
    // both the bareword and the quoted condition resolve to the friendly block name, never the raw id
    expect(crossroads.some((c) => c === "if visits(The Crossroads) == 1")).toBe(true);
    expect(conds.every((c) => !/blk_/.test(c))).toBe(true);   // no raw block id leaks into any condition tag
    surface.destroy();
  });

  it("humanizes a visits() node id whether it is QUOTED or a BAREWORD (the dialect treats both the same)", () => {
    // The Tour uses both forms for the same block: visits(blk_v0qnj91x)==1 and visits('blk_v0qnj91x')>1.
    // Both parse to the same string-id arg, so both must humanize to the block title.
    setJumpLabelResolver((id) => (id === "blk_v0qnj91x" ? "The Crossroads" : id));
    expect(humanizeCondition("visits('blk_v0qnj91x') > 1")).toBe("visits(The Crossroads) > 1");
    expect(humanizeCondition("visits(blk_v0qnj91x) == 1")).toBe("visits(The Crossroads) == 1");   // bareword (the bug)
    expect(humanizeCondition("seen(blk_v0qnj91x) && @gold > 5")).toBe("seen(The Crossroads) && @gold > 5");
    expect(humanizeCondition("@gold > 5")).toBe("@gold > 5");                                       // no visits() -> untouched
    setJumpLabelResolver((id) => id);
  });

  it("re-humanizes a cross-scene visits() condition once its target arrives via setJumpTargets (lazy load, #171)", () => {
    // Reproduces the load-time bug: on a lazy project open, a condition tag that references a block in
    // ANOTHER scene is painted before that scene's jump targets stream in, so it shows the raw block id.
    // hydrateProject -> setJumpTargets must then re-humanize it (regression: the id stuck, because the
    // refresh only re-painted jump chips and setJumpTargets never triggered a refresh).
    const flow = `{
      schema: "patter/flow@0",
      scene: { id: "scn_x", type: "scene", name: "Test", blocks: [
        { id: "start", type: "block", name: "Start", children: [
          { id: "sn_same", type: "snippet", condition: 'visits("cross")==1', beats: [ { id: "L_a", kind: "line", character: "X" } ] },
          { id: "sn_far",  type: "snippet", condition: 'visits("blk_far")>1', beats: [ { id: "L_c", kind: "line", character: "X" } ] }
        ] },
        { id: "cross", type: "block", name: "The Crossroads", children: [
          { id: "sn_d", type: "snippet", beats: [ { id: "L_b", kind: "line", character: "X" } ] }
        ] }
      ] }
    }`;
    const loc = `{ schema: "patter/strings@0", scene: "scn_x", locale: "en", default: true, strings: { L_a: "a", L_b: "b", L_c: "c" } }`;
    const editor = document.createElement("div"); document.body.appendChild(editor);
    (editor as unknown as { scrollTo: () => void }).scrollTo = () => undefined;
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

    // Lazy open: the cross-scene block ("blk_far") isn't in the target list yet (only the landing scene loaded).
    const surface = mountSurface({ editor, flowSource: flow, locSource: loc, jumpTargets: [] });
    const at = (): string[] => [...editor.querySelectorAll(".bubble.has-cond .bubble-cond")].map((c) => c.textContent?.trim() ?? "");
    expect(at()).toEqual(["if visits(The Crossroads)==1", "if visits(blk_far)>1"]); // same-scene resolves; cross-scene shows id

    // hydrate: the full cross-scene target list arrives -> the stuck id must re-humanize.
    surface.setJumpTargets([{ id: "scn_far", label: "Far", blocks: [{ id: "blk_far", label: "The Far Room" }] }]);
    expect(at()).toEqual(["if visits(The Crossroads)==1", "if visits(The Far Room)>1"]);
    surface.destroy();
  });

  it("refreshJumpLabels repaints a jump chip when its target is renamed", () => {
    let label = "Menu";
    setJumpLabelResolver(() => label); // resolves the jump's target id to the (current) block title
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const view = new EditorView(mount, { state: EditorState.create({ doc: openScene(flowSource, locSource).doc }), nodeViews });
    const chip = (view.dom as HTMLElement).querySelector(".bubble.has-jump .bubble-jump") as HTMLElement;
    expect(chip.textContent?.trim()).toBe("↪ Menu");
    label = "Specials Board";           // the target block is renamed...
    refreshJumpLabels();                // ...so the host refreshes; the chip re-resolves past the unchanged-jump guard
    expect(chip.textContent?.trim()).toBe("↪ Specials Board");
    setJumpLabelResolver((id) => id);   // reset the shared resolver
    view.destroy();
  });
});
