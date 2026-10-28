// @vitest-environment jsdom
// The hands-on fixes review, step 5 (patterkit design/hands-on-fixes-code-review-2026-10.md, section 4 and
// "Step 5 ruled"), renderer side: what Edit ▸ Move Up / Move Down act on; focus coming back after a dialog
// opened from the inspector, which redraws while it's up; the new-property choice; a scene's and a block's
// writing status as a floor (Q17); a deleted jump target in the inspector (Q15); and the Cast tab keeping a
// member's colour.

import { describe, it, expect, beforeAll } from "vitest";
import { dialogFrame, setDialogFocusFallback } from "@wildwinter/app-shell";
import { sceneMoveTarget, sceneMoveState, moveMenuState } from "./src/scene-move.js";
import { returnToTwin } from "./src/focus-return.js";
import { askPropertyType, withNewProperty } from "./src/new-property.js";
import { planStatus, lowestStatus } from "./src/status-raise.js";
import { renderInspector, type InspectorHandlers } from "./src/inspector.js";
import { mountCast } from "./src/settings-cast.js";
import type { InspectorContext } from "@patterkit/patterpad-surface/surface";

beforeAll(() => {
  Element.prototype.scrollIntoView ??= function () { /* jsdom lays nothing out */ };
  // jsdom has the element but not the modal half of <dialog>.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute("open"); };
});
const noop = (): void => {};
/** Every handler the inspector reaches, doing nothing; a test overrides what it watches. */
const base: InspectorHandlers = {
  reveal: noop, editNote: noop, hasNotes: () => false,
  editCondition: noop, editGameId: noop, editGroupProps: noop, editJump: noop,
  editEffects: noop, condPreview: () => document.createElement("span"), effectsPreview: () => document.createElement("span"),
  jumpLabel: () => "", setJumpMode: noop, setTags: noop,
  gameDataFields: () => [], setGameData: noop, sceneProps: () => [], editSceneProps: noop,
  writingStatuses: () => [], lineStatus: () => null, setLineStatus: noop, statusBeats: () => [], setStatusOf: noop,
  recordingStatuses: () => [], recordingStatus: () => null, setRecordingStatus: noop,
  audioFoldersOn: () => false, recordingFolderStatus: () => null, playRecording: noop,
  scratchStatus: () => null, recordScratch: noop, scratchStale: () => false,
  needsRerecord: () => false, setNeedsRerecord: noop,
  qualifiers: () => [], setQualifier: noop,
  projectPadAfter: () => 0.6, setPadAfter: noop, setPadAfterDefault: noop,
  levelOpen: () => undefined, setLevelOpen: noop,
  batch: (edits) => edits(), editConditionMany: noop, editJumpMany: noop,
  extensions: () => [], setExtensionValue: noop, extensionLock: () => null, extensionAdapter: () => ({ nodes: () => [] }),
};
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 450)); // the frame's exit, then the focus hand-back

/** A Scenes list as the renderer draws it: a row button per scene. */
function navList(ids: string[]): HTMLElement {
  const nav = document.createElement("div");
  for (const id of ids) {
    const row = document.createElement("div"); row.className = "nav-scene"; row.dataset["id"] = id;
    const b = document.createElement("button"); b.className = "nav-item"; b.dataset["id"] = id;
    row.append(b); nav.append(row);
  }
  document.body.append(nav);
  return nav;
}

describe("Move Up / Move Down: a scene or the script's selection", () => {
  it("acts on the focused scene row, else the open scene while focus is in the list, else the script", () => {
    const nav = navList(["a", "b", "c"]);
    const rowB = nav.querySelector<HTMLElement>('.nav-item[data-id="b"]')!;
    expect(sceneMoveTarget(nav, rowB, "a")).toBe("b");
    const search = document.createElement("button"); nav.prepend(search);
    expect(sceneMoveTarget(nav, search, "a")).toBe("a");
    expect(sceneMoveTarget(nav, document.body, "a")).toBeNull();
    nav.remove();
  });

  it("greys what can't apply: the first scene can't go up, the last can't go down", () => {
    expect(sceneMoveState(["a", "b", "c"], "a")).toEqual({ up: false, down: true });
    expect(sceneMoveState(["a", "b", "c"], "c")).toEqual({ up: true, down: false });
    expect(sceneMoveState(["a"], "a")).toEqual({ up: false, down: false });
    const nav = navList(["a", "b"]);
    const rowA = nav.querySelector<HTMLElement>(".nav-item")!;
    expect(moveMenuState({ navList: nav, active: rowA, openScene: "b", order: ["a", "b"], canMoveSelection: () => true })).toEqual({ up: false, down: true });
    expect(moveMenuState({ navList: nav, active: document.body, openScene: "b", order: ["a", "b"], canMoveSelection: (d) => d > 0 })).toEqual({ up: false, down: true });
    expect(moveMenuState({ navList: nav, active: document.body, openScene: null, order: [] })).toEqual({ up: false, down: false });
    nav.remove();
  });
});

describe("focus after a dialog opened from the inspector", () => {
  /** An inspector with two rows' buttons, the second the opener; `redraw` rebuilds them all. */
  const inspector = (): { host: HTMLElement; opener: () => HTMLButtonElement; redraw: () => void } => {
    const host = document.createElement("div");
    const draw = (): void => {
      host.replaceChildren();
      for (const label of ["Game ID", "Scene properties"]) {
        const b = document.createElement("button"); b.className = "insp-cond"; b.textContent = label; host.append(b);
      }
    };
    draw();
    document.body.append(host);
    return { host, opener: () => host.querySelectorAll<HTMLButtonElement>("button")[1]!, redraw: draw };
  };

  it("fell to <body> when the redraw took the opener away (the bug, reproduced)", async () => {
    setDialogFocusFallback(null);
    const { host, opener, redraw } = inspector();
    opener().focus();
    const frame = dialogFrame({ title: "Scene properties" });
    frame.open();
    redraw(); // the inspector re-renders after the commit the dialog made
    frame.close();
    await settle();
    expect(document.activeElement).toBe(document.body);
    host.remove();
  });

  it("comes back to the button the redraw put in the opener's place", async () => {
    const { host, opener, redraw } = inspector();
    opener().focus();
    const frame = dialogFrame({ title: "Scene properties", returnFocus: returnToTwin(host, document.activeElement) });
    frame.open();
    redraw();
    frame.close();
    await settle();
    expect(document.activeElement).toBe(opener());
    expect(document.activeElement?.textContent).toBe("Scene properties");
    host.remove();
  });

  it("with nothing to come back to, lands on the host's fallback (the script), never <body>", async () => {
    const script = document.createElement("div"); script.tabIndex = 0; document.body.append(script);
    setDialogFocusFallback(() => script);
    const { host, opener } = inspector();
    opener().focus();
    const frame = dialogFrame({ title: "Notes" });
    frame.open();
    host.remove();
    frame.close();
    await settle();
    expect(document.activeElement).toBe(script);
    setDialogFocusFallback(null);
    script.remove();
  });
});

describe("a new @patter property from the effects editor", () => {
  it("asks the kind of value, Number the default, and answers what was chosen", async () => {
    const asked = askPropertyType("gold");
    const dialog = document.querySelector<HTMLDialogElement>("dialog.new-prop-dialog")!;
    expect(dialog.textContent).toContain("@gold");
    const buttons = [...dialog.querySelectorAll<HTMLButtonElement>("button")].map((b) => b.textContent);
    expect(buttons).toEqual(["Cancel", "Text", "True or false", "Number"]);
    expect(document.activeElement?.textContent).toBe("Number");
    dialog.querySelector<HTMLButtonElement>('button[data-type="boolean"]')!.click();
    expect(await asked).toBe("boolean");

    const cancelled = askPropertyType("gold");
    [...document.querySelectorAll<HTMLButtonElement>("dialog.new-prop-dialog button")].find((b) => b.textContent === "Cancel")!.click();
    expect(await cancelled).toBeNull();
  });

  it("adds the declaration, or answers the one that already has the name", () => {
    const made = withNewProperty([{ name: "gold", type: "number" }], "met_anna", "boolean");
    expect(made).toMatchObject({ added: true, decl: { name: "met_anna", type: "boolean" } });
    expect(made.props.map((p) => p.name)).toEqual(["gold", "met_anna"]);
    expect(withNewProperty(made.props, "GOLD", "string")).toMatchObject({ added: false, decl: { name: "gold", type: "number" } });
  });
});

describe("a scene's or block's writing status is a floor (Q17)", () => {
  const ladder = [{ name: "stub" }, { name: "draft" }, { name: "edited" }, { name: "final" }];
  const map: Record<string, string> = { a: "draft", b: "final" }; // c is unset (reads as stub)
  const of = (id: string): string | undefined => map[id];

  it("shows the lowest status among the lines, and says when they differ", () => {
    expect(lowestStatus(["a", "b", "c"], of, ladder)).toEqual({ status: "stub", mixed: true });
    expect(lowestStatus(["a", "b"], of, ladder)).toEqual({ status: "draft", mixed: true });
    expect(lowestStatus(["b"], of, ladder)).toEqual({ status: "final", mixed: false });
    expect(lowestStatus([], of, ladder)).toBeNull();
  });

  it("raises the lines below the choice and leaves those further along", () => {
    expect([...planStatus(["a", "b", "c"], "edited", of, ladder)]).toEqual([["a", "edited"], ["c", "edited"]]);
    expect([...planStatus(["a", "b", "c"], "draft", of, ladder)]).toEqual([["c", "draft"]]);
    expect(planStatus(["a", "b"], "draft", of, ladder).size).toBe(0); // nothing below it
  });

  it("the lowest rung clears every line rather than writing it", () => {
    expect([...planStatus(["a", "b", "c"], "stub", of, ladder)]).toEqual([["a", null], ["b", null]]);
    expect([...planStatus(["a", "b", "c"], null, of, ladder)]).toEqual([["a", null], ["b", null]]);
  });

  it("a single line takes exactly what's chosen, down as well as up", () => {
    expect([...planStatus(["b"], "draft", of, ladder)]).toEqual([["b", "draft"]]);
    expect([...planStatus(["a"], "stub", of, ladder)]).toEqual([["a", null]]);
  });

  it("the scene's inspector shows the floor, a quiet Mixed, and sets every line as one call", () => {
    const sets: Array<[string[], string | null]> = [];
    const h: InspectorHandlers = {
      ...base,
      writingStatuses: () => ladder, lineStatus: (id) => map[id] ?? null,
      statusBeats: (id) => (id === "scn_a" ? ["a", "b", "c"] : []),
      setStatusOf: (ids, status) => { sets.push([ids, status]); },
    };
    const host = document.createElement("div");
    renderInspector(host, { levels: [{ kind: "scene", id: "scn_a", name: "Harbour", address: "harbour" }] } as unknown as InspectorContext, h);
    const sel = host.querySelector<HTMLSelectElement>("select.insp-status-select")!;
    expect(sel.value).toBe("stub");
    expect(host.querySelector(".insp-status-mixed")?.textContent).toBe("Mixed");
    sel.value = "edited";
    sel.dispatchEvent(new Event("change"));
    expect(sets).toEqual([[["a", "b", "c"], "edited"]]);
    // A block with no lines has no status row.
    const empty = document.createElement("div");
    renderInspector(empty, { levels: [{ kind: "block", id: "blk_x", name: "Empty", address: "empty" }] } as unknown as InspectorContext, h);
    expect(empty.querySelector("select.insp-status-select")).toBeNull();
  });
});

describe("a deleted jump target in the inspector (Q15)", () => {
  it("reads Missing scene / Missing block in the problem colour, the old id in its tooltip", () => {
    const h: InspectorHandlers = { ...base, jumpLabel: (id) => (id === "scn_here" ? "Here" : null) };
    const host = document.createElement("div");
    renderInspector(host, { levels: [{ kind: "snippet", id: "sn_1", jump: { to: "blk_gone" } }] } as unknown as InspectorContext, h);
    const missing = host.querySelector<HTMLElement>(".insp-jump .missing-target")!;
    expect(missing.textContent).toBe("Missing block");
    expect(missing.dataset["tip"]).toContain("blk_gone");
    const fine = document.createElement("div");
    renderInspector(fine, { levels: [{ kind: "snippet", id: "sn_1", jump: { to: "scn_here" } }] } as unknown as InspectorContext, h);
    expect(fine.querySelector(".insp-jump")?.textContent).toBe("Here");
  });
});

describe("the Cast tab keeps a member's colour", () => {
  it("carries a stored colour slot through the save round-trip", () => {
    const host = document.createElement("div");
    const cast = mountCast(host, [{ name: "INNKEEPER", colour: 4 }, { name: "ANNA" }]);
    expect(cast.value()).toEqual([{ name: "INNKEEPER", colour: 4 }, { name: "ANNA" }]);
  });
});
