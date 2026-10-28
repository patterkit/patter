// @vitest-environment jsdom
// The detail inspector's DOM projection (renderer/src/inspector.ts): each title bar carries a top-right
// action cluster - a copy icon (the node's address / loc ID, shown on rollover, click to copy; scene /
// block / line / prose only) and a note icon (outline = no notes, filled = notes set) that opens the notes
// modal. DOM test - lives under src/renderer (outside the Node tc, like the surface's web tests), run by vitest.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderInspector, type InspectorHandlers } from "./src/inspector.js";
import type { InspectorContext } from "@patterkit/patterpad-surface/surface";

const noop = (): void => {};
const handlers: InspectorHandlers = {
  reveal: noop, editNote: noop, hasNotes: () => false,
  editCondition: noop, editGameId: noop, editGroupProps: noop, editJump: noop,
  editEffects: noop, condPreview: () => document.createElement("span"), effectsPreview: () => document.createElement("span"),
  jumpLabel: () => "",
  // These three arrived after this stub was written and it never followed. Nothing failed, because a
  // missing handler is only reached by the branch that calls it: the gap surfaced when this file came
  // inside the typecheck, not when the tests ran.
  setJumpMode: noop, setTags: noop,
  gameDataFields: () => [], setGameData: noop, sceneProps: () => [], editSceneProps: noop,
  writingStatuses: () => [], lineStatus: () => null, setLineStatus: noop, statusBeats: () => [], setStatusOf: () => {},
  recordingStatuses: () => [], recordingStatus: () => null, setRecordingStatus: noop,
  audioFoldersOn: () => false, recordingFolderStatus: () => null, playRecording: noop,
  scratchStatus: () => null, recordScratch: noop, scratchStale: () => false,
  needsRerecord: () => false, setNeedsRerecord: noop,
  qualifiers: () => [], setQualifier: noop,
  projectPadAfter: () => 0.6, setPadAfter: noop, setPadAfterDefault: noop,
  levelOpen: () => undefined, setLevelOpen: noop,
  batch: (edits) => edits(), editConditionMany: noop, editJumpMany: noop,
  // Patter extensions (extension-rows.test.ts draws them): a project taking none.
  extensions: () => [], setExtensionValue: noop, extensionLock: () => null, extensionAdapter: () => ({ nodes: () => [] }),
};
const ctx = (level: unknown): InspectorContext => ({ levels: [level] }) as InspectorContext;

/** What a level's Add menu offers (its labels), opening and closing the menu to read them. */
function addOffers(host: HTMLElement, level = 0): string[] {
  const btn = host.querySelectorAll<HTMLButtonElement>(".insp-level")[level]?.querySelector<HTMLButtonElement>(".insp-add");
  if (!btn) return [];
  btn.click();
  const labels = [...document.querySelectorAll(".ctxmenu button, .ctxmenu [role=menuitem]")].map((b) => b.textContent ?? "");
  document.querySelector(".ctxmenu")?.remove();
  return labels;
}

/** Pick `label` from a level's Add menu (the October 2026 inspector draws an unset property only once it's
 *  added, or once it has a value). */
function pickAdd(host: HTMLElement, label: string, level = 0): void {
  host.querySelectorAll<HTMLElement>(".insp-level")[level]!.querySelector<HTMLButtonElement>(".insp-add")!.click();
  const item = [...document.querySelectorAll<HTMLElement>(".ctxmenu button, .ctxmenu [role=menuitem]")].find((b) => b.textContent === label);
  if (!item) throw new Error(`the Add menu offers no "${label}"`);
  item.click();
  document.querySelector(".ctxmenu")?.remove();
}

describe("inspector: surfaced line ID + copy", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis.navigator, "clipboard", { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });
  });

  it("a Dialogue (line) leaf shows a copy icon whose rollover is its loc ID", () => {
    const host = document.createElement("div");
    renderInspector(host, ctx({ kind: "leaf", beat: "line", id: "L_greet" }), handlers);
    const copy = host.querySelector(".insp-head-actions .insp-copy");
    expect(copy).toBeTruthy();
    expect(copy?.getAttribute("data-tip")).toBe("L_greet"); // the ID itself is the rollover
  });

  it("a Text (prose) leaf shows its copy icon too", () => {
    const host = document.createElement("div");
    renderInspector(host, ctx({ kind: "leaf", beat: "prose", id: "T_room" }), handlers);
    expect(host.querySelector(".insp-head-actions .insp-copy")?.getAttribute("data-tip")).toBe("T_room");
  });

  it("the copy icon copies the raw id (no #) to the clipboard", () => {
    const host = document.createElement("div");
    renderInspector(host, ctx({ kind: "leaf", beat: "line", id: "L_greet" }), handlers);
    (host.querySelector(".insp-head-actions .insp-copy") as HTMLButtonElement).click();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("L_greet");
  });

  it("a game-event leaf does NOT surface a copy icon (the loc/audio ID is for Text / Dialogue lines)", () => {
    const host = document.createElement("div");
    renderInspector(host, ctx({ kind: "leaf", beat: "gameEvent", id: "A_focus" }), handlers);
    expect(host.querySelector(".insp-head-actions .insp-copy")).toBeNull();
    expect(host.querySelector(".insp-head-actions .insp-note")).toBeTruthy(); // ...but notes are still allowed
  });

  it("scene + block leaves expose the address (not a line id) as the copy rollover", () => {
    const scene = document.createElement("div");
    renderInspector(scene, ctx({ kind: "scene", id: "sc_1", name: "Tavern", address: "tavern", tags: [] }), handlers);
    expect(scene.querySelector(".insp-head-actions .insp-copy")?.getAttribute("data-tip")).toBe("tavern");

    const block = document.createElement("div");
    renderInspector(block, ctx({ kind: "block", id: "bl_1", name: "Intro", address: "tavern.intro", tags: [] }), handlers);
    expect(block.querySelector(".insp-head-actions .insp-copy")?.getAttribute("data-tip")).toBe("tavern.intro");
  });

  it("the note icon is outline with no notes, filled (.has) when notes are set, and opens the editor", () => {
    const none = document.createElement("div");
    renderInspector(none, ctx({ kind: "leaf", beat: "line", id: "L_greet" }), handlers);
    const outline = none.querySelector(".insp-head-actions .insp-note") as HTMLButtonElement;
    expect(outline).toBeTruthy();
    expect(outline.classList.contains("has")).toBe(false);

    const edit = vi.fn();
    const withNotes = { ...handlers, hasNotes: (id: string) => id === "L_greet", editNote: edit };
    const filledHost = document.createElement("div");
    renderInspector(filledHost, ctx({ kind: "leaf", beat: "line", id: "L_greet" }), withNotes);
    const filled = filledHost.querySelector(".insp-head-actions .insp-note") as HTMLButtonElement;
    expect(filled.classList.contains("has")).toBe(true);
    filled.click();
    expect(edit).toHaveBeenCalledWith("L_greet", expect.anything(), "line");
  });

  it("shows a writing-status dropdown for line + text beats, set to the current rung, but NOT for game-event (#196)", () => {
    const ladder = [{ name: "stub", colour: 0 }, { name: "draft 1", colour: 1 }, { name: "final", colour: 4 }];
    const withStatus = { ...handlers, writingStatuses: () => ladder, lineStatus: (id: string) => (id === "L_greet" ? "draft 1" : null) };

    const line = document.createElement("div");
    renderInspector(line, ctx({ kind: "leaf", beat: "line", id: "L_greet" }), withStatus);
    const sel = line.querySelector(".insp-status select") as HTMLSelectElement | null;
    expect(sel).toBeTruthy();
    expect(sel!.value).toBe("draft 1"); // reflects the beat's current status
    expect(sel!.querySelectorAll("option").length).toBe(ladder.length); // just the ladder - no "unset" option
    expect([...sel!.options].some((o) => o.value === "")).toBe(false); // there is no "unset" choice

    // An UNSET beat reads as the LOWEST rung (never "unset").
    const unset = document.createElement("div");
    renderInspector(unset, ctx({ kind: "leaf", beat: "line", id: "L_other" }), withStatus);
    expect((unset.querySelector(".insp-status select") as HTMLSelectElement).value).toBe("stub");

    const text = document.createElement("div");
    renderInspector(text, ctx({ kind: "leaf", beat: "prose", id: "T_room" }), withStatus);
    expect(text.querySelector(".insp-status select")).toBeTruthy(); // text beats track status too

    const gameEvent = document.createElement("div");
    renderInspector(gameEvent, ctx({ kind: "leaf", beat: "gameEvent", id: "A_focus" }), withStatus);
    expect(gameEvent.querySelector(".insp-status")).toBeNull(); // game-event beats are never tracked

    // No ladder configured -> no status field at all.
    const noLadder = document.createElement("div");
    renderInspector(noLadder, ctx({ kind: "leaf", beat: "line", id: "L_greet" }), { ...handlers, writingStatuses: () => [] });
    expect(noLadder.querySelector(".insp-status")).toBeNull();
  });

  it("recording row: an editable dropdown in manual mode, a read-only chip in Audio Folders mode (#206)", () => {
    const ladder = [{ name: "missing", colour: 0 }, { name: "scratch", colour: 2 }, { name: "recorded", colour: 4 }];
    const recRow = (host: HTMLElement): HTMLElement | undefined =>
      [...host.querySelectorAll(".insp-row")].find((r) => r.querySelector(".insp-key")?.textContent === "Audio") as HTMLElement | undefined;

    // Manual mode: a select bound to the line's stored status; no folder chip.
    const manual = { ...handlers, recordingStatuses: () => ladder, recordingStatus: (id: string) => (id === "L_greet" ? "scratch" : null) };
    const m = document.createElement("div");
    renderInspector(m, ctx({ kind: "leaf", beat: "line", id: "L_greet" }), manual);
    const mSel = recRow(m)?.querySelector("select") as HTMLSelectElement | undefined;
    expect(mSel?.value).toBe("scratch");
    expect(recRow(m)?.querySelector(".insp-rec-chip")).toBeFalsy();

    // Audio Folders mode: a read-only chip showing the folder-derived status, no dropdown, + a ▶ play button.
    const folder = { ...handlers, recordingStatuses: () => ladder, audioFoldersOn: () => true, recordingFolderStatus: (id: string) => (id === "L_greet" ? "recorded" : null) };
    const f = document.createElement("div");
    renderInspector(f, ctx({ kind: "leaf", beat: "line", id: "L_greet" }), folder);
    expect(recRow(f)?.querySelector("select")).toBeFalsy();
    expect(recRow(f)?.querySelector(".insp-rec-chip")?.textContent).toBe("recorded");
    expect(recRow(f)?.querySelector(".insp-rec-play")).toBeTruthy(); // a file resolved -> playable

    // Folder mode, no file found -> the chip falls back to the lowest rung ("missing"), no play button.
    const g = document.createElement("div");
    renderInspector(g, ctx({ kind: "leaf", beat: "line", id: "L_silent" }), folder);
    expect(recRow(g)?.querySelector(".insp-rec-chip")?.textContent).toBe("missing");
    expect(recRow(g)?.querySelector(".insp-rec-play")).toBeFalsy(); // nothing to play for a missing line

    // Recording is dialogue-only: a text/prose beat never gets the row, in either mode.
    const text = document.createElement("div");
    renderInspector(text, ctx({ kind: "leaf", beat: "prose", id: "T_room" }), folder);
    expect(recRow(text)).toBeUndefined();
  });

  it("the Re-record row: offered in the Add menu until flagged, then a ticked box and a pill (#227)", () => {
    const ladder = [{ name: "missing", colour: 0 }, { name: "recorded", colour: 4 }];
    const rrRow = (host: HTMLElement): HTMLElement | undefined =>
      [...host.querySelectorAll(".insp-row")].find((r) => r.querySelector(".insp-key")?.textContent === "Re-record") as HTMLElement | undefined;

    // Unflagged: no row; the Add menu offers it, and picking it sets the flag.
    const setNeedsRerecord = vi.fn();
    const off = { ...handlers, recordingStatuses: () => ladder, needsRerecord: () => false, setNeedsRerecord };
    const a = document.createElement("div");
    renderInspector(a, ctx({ kind: "leaf", beat: "line", id: "L_greet" }), off);
    expect(rrRow(a)).toBeUndefined();
    pickAdd(a, "Needs re-record");
    expect(setNeedsRerecord).toHaveBeenCalledWith("L_greet", true);

    // Flagged: checked, plus a "re-record" pill echoing the masked status.
    const on = { ...handlers, recordingStatuses: () => ladder, needsRerecord: (id: string) => id === "L_greet" };
    const b = document.createElement("div");
    renderInspector(b, ctx({ kind: "leaf", beat: "line", id: "L_greet" }), on);
    expect((rrRow(b)?.querySelector("input[type=checkbox]") as HTMLInputElement).checked).toBe(true);
    expect(rrRow(b)?.querySelector(".insp-rec-chip")?.textContent).toBe("re-record");

    // Gated with the recording row: no ladder (recording untracked) -> no Re-record row.
    const untracked = document.createElement("div");
    renderInspector(untracked, ctx({ kind: "leaf", beat: "line", id: "L_greet" }), { ...handlers, recordingStatuses: () => [] });
    expect(rrRow(untracked)).toBeUndefined();

    // Dialogue-only: a prose beat never gets it.
    const prose = document.createElement("div");
    renderInspector(prose, ctx({ kind: "leaf", beat: "prose", id: "T_room" }), on);
    expect(rrRow(prose)).toBeUndefined();
  });

  it("Record scratch is offered only for lines at or below the scratch rung (#224)", () => {
    const ladder = [{ name: "missing", colour: 0 }, { name: "scratch", colour: 2 }, { name: "recorded", colour: 4 }];
    const recRow = (host: HTMLElement): HTMLElement | undefined =>
      [...host.querySelectorAll(".insp-row")].find((r) => r.querySelector(".insp-key")?.textContent === "Audio") as HTMLElement | undefined;
    // scratch records into the "scratch" rung; a line resolves to its derived folder status.
    const base = { ...handlers, recordingStatuses: () => ladder, audioFoldersOn: () => true, scratchStatus: () => "scratch" };

    // A "missing" line (below scratch) -> offered.
    const miss = document.createElement("div");
    renderInspector(miss, ctx({ kind: "leaf", beat: "line", id: "L_miss" }), { ...base, recordingFolderStatus: () => null });
    expect(recRow(miss)?.querySelector(".insp-rec-record")).toBeTruthy();

    // A line already at the scratch rung -> still offered (re-record).
    const scr = document.createElement("div");
    renderInspector(scr, ctx({ kind: "leaf", beat: "line", id: "L_scr" }), { ...base, recordingFolderStatus: () => "scratch" });
    expect(recRow(scr)?.querySelector(".insp-rec-record")).toBeTruthy();

    // A "recorded" line (above scratch) -> NOT offered (scratch would only downgrade it).
    const rec = document.createElement("div");
    renderInspector(rec, ctx({ kind: "leaf", beat: "line", id: "L_rec" }), { ...base, recordingFolderStatus: () => "recorded" });
    expect(recRow(rec)?.querySelector(".insp-rec-record")).toBeFalsy();

    // Scratch recording off -> never offered.
    const off = document.createElement("div");
    renderInspector(off, ctx({ kind: "leaf", beat: "line", id: "L_miss" }), { ...base, scratchStatus: () => null, recordingFolderStatus: () => null });
    expect(recRow(off)?.querySelector(".insp-rec-record")).toBeFalsy();
  });

  it("an 'out of date' badge shows when a scratch take is stale (#224)", () => {
    const ladder = [{ name: "missing", colour: 0 }, { name: "scratch", colour: 2 }, { name: "recorded", colour: 4 }];
    const recRow = (host: HTMLElement): HTMLElement | undefined =>
      [...host.querySelectorAll(".insp-row")].find((r) => r.querySelector(".insp-key")?.textContent === "Audio") as HTMLElement | undefined;
    const base = { ...handlers, recordingStatuses: () => ladder, audioFoldersOn: () => true, scratchStatus: () => "scratch", recordingFolderStatus: () => "scratch" };

    const stale = document.createElement("div");
    renderInspector(stale, ctx({ kind: "leaf", beat: "line", id: "L_x" }), { ...base, scratchStale: () => true });
    expect(recRow(stale)?.querySelector(".insp-rec-stale")).toBeTruthy();

    const fresh = document.createElement("div");
    renderInspector(fresh, ctx({ kind: "leaf", beat: "line", id: "L_x" }), { ...base, scratchStale: () => false });
    expect(recRow(fresh)?.querySelector(".insp-rec-stale")).toBeFalsy();
  });

  it("a snippet level surfaces no copy icon (no address / loc ID), but does get a note icon", () => {
    const host = document.createElement("div");
    renderInspector(host, ctx({ kind: "snippet", id: "sn_1", beatCount: 1 }), handlers);
    expect(host.querySelector(".insp-head-actions .insp-copy")).toBeNull();
    expect(host.querySelector(".insp-head-actions .insp-note")).toBeTruthy();
  });
});

describe("inspector: the speaker qualifier row", () => {
  const LIST = [{ gameId: "vo", name: "V.O." }, { gameId: "os", name: "O.S." }];
  const line = (over: Record<string, unknown> = {}): InspectorContext => ctx({ kind: "leaf", beat: "line", id: "L1", character: "TAM", ...over });
  const select = (host: HTMLElement): HTMLSelectElement | null => host.querySelector<HTMLSelectElement>("select.insp-qualifier");

  it("offers None and the project's qualifiers by name, the line's selected", () => {
    const host = document.createElement("div");
    renderInspector(host, line({ qualifier: "os" }), { ...handlers, qualifiers: () => LIST });
    const sel = select(host)!;
    expect([...sel.options].map((o) => o.textContent)).toEqual(["None", "V.O.", "O.S."]);
    expect(sel.value).toBe("os");
  });

  it("waits in the Add menu while unset, then writes the picked gameId (and \"\" for None)", () => {
    const host = document.createElement("div");
    const setQualifier = vi.fn();
    renderInspector(host, line(), { ...handlers, qualifiers: () => LIST, setQualifier });
    expect(select(host)).toBeNull();
    pickAdd(host, "Qualifier");
    const sel = select(host)!;
    expect(sel.value).toBe("");
    sel.value = "vo"; sel.dispatchEvent(new Event("change"));
    sel.value = ""; sel.dispatchEvent(new Event("change"));
    expect(setQualifier.mock.calls).toEqual([["L1", "vo"], ["L1", ""]]);
  });

  it("keeps a qualifier the project no longer lists, marked, and shows no row when there is nothing to pick", () => {
    const host = document.createElement("div");
    renderInspector(host, line({ qualifier: "phone" }), { ...handlers, qualifiers: () => LIST });
    expect(select(host)!.selectedOptions[0]?.textContent).toBe("phone (not in the list)");
    const bare = document.createElement("div");
    renderInspector(bare, line(), handlers); // no qualifiers in the project, none on the line
    expect(select(bare)).toBeNull();
  });
});

describe("inspector: line padding fields", () => {
  const field = (host: HTMLElement): HTMLInputElement | null => host.querySelector<HTMLInputElement>("input.insp-pad-input");
  const commit = (input: HTMLInputElement, value: string): void => { input.value = value; input.dispatchEvent(new Event("change")); };

  it("offers an unset pause in the Add menu, its placeholder naming where the inherited one comes from", () => {
    const host = document.createElement("div");
    renderInspector(host, ctx({ kind: "leaf", beat: "line", id: "L1", character: "TAM", padInherited: { value: 0.25, from: "block" } }), handlers);
    expect(field(host)).toBeNull();
    pickAdd(host, "Pad after");
    const input = field(host)!;
    expect(input.value).toBe("");
    expect(input.placeholder).toBe("0.25 from the block");
    expect(input.min).toBe("-10");
    const bare = document.createElement("div");
    renderInspector(bare, ctx({ kind: "leaf", beat: "prose", id: "T1" }), { ...handlers, projectPadAfter: () => 0.6 });
    pickAdd(bare, "Pad after");
    expect(field(bare)!.placeholder).toBe("0.6 from the project");
  });

  it("writes a typed pause, clears it when emptied, and puts back text that isn't a number", () => {
    const host = document.createElement("div");
    const setPadAfter = vi.fn();
    renderInspector(host, ctx({ kind: "leaf", beat: "line", id: "L1", character: "TAM", padAfter: -0.5 }), { ...handlers, setPadAfter });
    const input = field(host)!;
    expect(input.value).toBe("-0.5");
    commit(input, "1.2");
    commit(input, "");
    commit(input, "abc");
    expect(input.value).toBe("");
    commit(input, "99"); // above the range: clamped to the maximum
    expect(setPadAfter.mock.calls).toEqual([["L1", 1.2], ["L1", null], ["L1", 60]]);
  });

  it("never offers a negative pause on a snippet's last line, and says so for an inherited one", () => {
    const host = document.createElement("div");
    const setPadAfter = vi.fn();
    renderInspector(host, ctx({ kind: "leaf", beat: "line", id: "L9", character: "TAM", endsSnippet: true, padInherited: { value: -0.4, from: "snippet" } }), { ...handlers, setPadAfter });
    pickAdd(host, "Pad after");
    const input = field(host)!;
    expect(input.min).toBe("0");
    expect(input.placeholder).toBe("0 at the end of a snippet");
    commit(input, "-1");
    expect(setPadAfter).toHaveBeenCalledWith("L9", 0);
    // A prompt times the reply, which is certain: its field goes below zero.
    const prompt = document.createElement("div");
    renderInspector(prompt, ctx({ kind: "leaf", beat: "line", id: "P1", character: "TAM", prompt: true }), handlers);
    pickAdd(prompt, "Pad after");
    expect(field(prompt)!.min).toBe("-10");
  });

  it("puts a Default pad on snippets, groups, blocks, and scenes (drawn once set, offered until then), and none on a game event", () => {
    const setPadAfterDefault = vi.fn();
    const levels = [
      { kind: "snippet", id: "sn", beatCount: 1, padAfterDefault: 0.3 },
      { kind: "group", id: "g", role: "sequence", labelParts: ["Sequence"], label: "Sequence", padInherited: { value: 1, from: "scene" } },
      { kind: "block", id: "b", name: "B", address: "b" },
      { kind: "scene", id: "s", name: "S", address: "s" },
    ];
    const host = document.createElement("div");
    renderInspector(host, { levels } as InspectorContext, { ...handlers, setPadAfterDefault });
    const set = [...host.querySelectorAll<HTMLInputElement>("input.insp-pad-input")];
    expect(set.map((i) => i.getAttribute("aria-label"))).toEqual(["Default pad"]); // only the snippet sets one
    expect(set[0]!.value).toBe("0.3");
    for (const level of [1, 2, 3]) expect(addOffers(host, level)).toContain("Default pad");
    pickAdd(host, "Default pad", 1);
    expect(host.querySelectorAll<HTMLElement>(".insp-level")[1]!.querySelector<HTMLInputElement>("input.insp-pad-input")!.placeholder).toBe("1 from the scene");
    pickAdd(host, "Default pad", 2);
    commit(host.querySelectorAll<HTMLElement>(".insp-level")[2]!.querySelector<HTMLInputElement>("input.insp-pad-input")!, "0.9");
    expect(setPadAfterDefault).toHaveBeenCalledWith("b", 0.9);
    const event = document.createElement("div");
    renderInspector(event, ctx({ kind: "leaf", beat: "gameEvent", id: "A1" }), handlers);
    expect(field(event)).toBeNull();
  });
});

describe("inspector: an option's game data", () => {
  it("edits an option's declared fields, and shows any other group's game data as it stands", () => {
    const host = document.createElement("div");
    const set: Array<[string, string, unknown]> = [];
    const fields = [{ name: "tone", type: "text" as const }];
    const h: InspectorHandlers = { ...handlers, gameDataFields: (kind) => (kind === "option" ? fields : []), setGameData: (id, key, v) => { set.push([id, key, v]); } };
    renderInspector(host, ctx({ kind: "group", id: "o1", role: "option", labelParts: ["Option"], label: "Option", gameData: { outcome: "o-leave" } }), h);
    expect(host.querySelector(".insp-gd-row")).toBeNull(); // unset: offered, not drawn
    pickAdd(host, "tone");
    const input = host.querySelector<HTMLInputElement>(".insp-gd-row input")!;
    input.value = "kind";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(set).toEqual([["o1", "tone", "kind"]]);
    expect(host.querySelector(".insp-gd-cap")?.textContent).toBe("Game Data");
    expect([...host.querySelectorAll(".insp-gd")].map((k) => k.textContent)).toEqual(["outcome"]);   // undeclared, shown
    renderInspector(host, ctx({ kind: "group", id: "g", role: "sequence", labelParts: ["Sequence"], label: "Sequence", gameData: { tone: "x" } }), h);
    expect(host.querySelector(".insp-gd-row")).toBeNull();
    expect([...host.querySelectorAll(".insp-gd")].map((k) => k.textContent)).toEqual(["tone"]);
  });
});

describe("inspector: a game-data value typed through a redraw", () => {
  it("commits as typed, keeps the row, its text and the focus while the inspector rebuilds, and shows the purpose", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    let gd: Record<string, unknown> = {};
    const fields = [{ name: "mood", type: "text" as const, purpose: "How the line is played" }];
    const draw = (): void => renderInspector(host, ctx({ kind: "leaf", beat: "gameEvent", id: "A_1", gameData: gd }), h);
    // The renderer redraws the whole stack on every change, as showInspector does when a value lands.
    const h: InspectorHandlers = { ...handlers, gameDataFields: () => fields, setGameData: (_id, key, v) => { gd = v === undefined ? {} : { [key]: v }; draw(); } };
    draw();
    pickAdd(host, "mood");
    expect(host.querySelector(".shell-fieldrow-purpose")?.textContent).toBe("How the line is played");
    const input = host.querySelector<HTMLInputElement>(".insp-gd-row input")!;
    input.focus();
    for (const text of ["c", "ca", "cal"]) { input.value = text; input.dispatchEvent(new Event("input", { bubbles: true })); }
    await new Promise<void>((r) => queueMicrotask(r));
    expect(gd).toEqual({ mood: "cal" });
    expect(host.querySelector(".insp-gd-row input")).toBe(input);
    expect(document.activeElement).toBe(input);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(gd).toEqual({});   // Esc puts back what it held at focus: nothing set
    host.remove();
  });
});

describe("inspector: sections that fold, and the option's behaviour flags (October 2026 UI review)", () => {
  const option = { kind: "group", id: "o1", role: "option", labelParts: ["Option"], label: "Option", sticky: true, condition: "@x > 1" };
  const stack = (): InspectorContext => ({ levels: [{ kind: "leaf", beat: "line", id: "L1", character: "TAM" }, { kind: "snippet", id: "sn", beatCount: 1 }, option, { kind: "block", id: "b", name: "Main", address: "main" }] }) as InspectorContext;
  const folded = (host: HTMLElement): boolean[] => [...host.querySelectorAll(".insp-level")].map((l) => l.classList.contains("insp-folded"));

  it("opens the line and the snippet, folds the outer levels, and sums up what a folded one sets", () => {
    const host = document.createElement("div");
    renderInspector(host, stack(), handlers);
    expect(folded(host)).toEqual([false, false, true, true]);
    expect(host.querySelectorAll(".insp-level")[2]!.querySelector(".insp-head-sum")?.textContent).toBe("Sticky, has a condition");
  });

  it("remembers the author's open or folded choice per kind of level", () => {
    const remembered: Record<string, boolean> = {};
    const h: InspectorHandlers = { ...handlers, levelOpen: (k) => remembered[k], setLevelOpen: (k, open) => { remembered[k] = open; } };
    const host = document.createElement("div");
    renderInspector(host, stack(), h);
    host.querySelectorAll<HTMLButtonElement>(".insp-fold")[2]!.click(); // open the option
    expect(folded(host)[2]).toBe(false);
    expect(remembered).toEqual({ option: true });
    renderInspector(host, stack(), h);
    expect(folded(host)).toEqual([false, false, false, true]);
  });

  it("draws Sticky, Fallback and Secret as one row of toggles that write the group's props", () => {
    const editGroupProps = vi.fn();
    const host = document.createElement("div");
    renderInspector(host, ctx(option), { ...handlers, editGroupProps });
    const flags = [...host.querySelectorAll<HTMLButtonElement>(".insp-flag")];
    expect(flags.map((f) => [f.textContent, f.getAttribute("aria-pressed")])).toEqual([["Sticky", "true"], ["Fallback", "false"], ["Secret", "false"]]);
    flags[1]!.click();
    expect(editGroupProps).toHaveBeenCalledWith("o1", { fallback: true });
  });

  it("shows an unset condition as a quiet None, and offers the unset properties in one Add menu", () => {
    const host = document.createElement("div");
    renderInspector(host, ctx({ kind: "snippet", id: "sn", beatCount: 1 }), handlers);
    expect(host.querySelector(".insp-cond.muted")?.textContent).toBe("None");
    expect(addOffers(host)).toEqual(["On begin", "On end", "Default pad", "Tags"]);
  });
});

describe("inspector: a multi-selection's shared properties (October 2026 UI review, proposal 10)", () => {
  const multi = (items: unknown[]): InspectorContext =>
    ({ levels: [{ kind: "multi", count: items.length, snippets: items.filter((i) => (i as { kind: string }).kind === "snippet").length,
      groups: items.filter((i) => (i as { kind: string }).kind === "group").length, items }] }) as InspectorContext;
  const snip = (id: string, over: Record<string, unknown> = {}): unknown => ({ kind: "snippet", id, beatCount: 1, ...over });
  const rowOf = (host: HTMLElement, key: string): HTMLElement | undefined =>
    [...host.querySelectorAll<HTMLElement>(".insp-row")].find((r) => r.querySelector(".insp-key")?.textContent === key);

  it("shows a value they share as it is, and one they don't as Mixed", () => {
    const host = document.createElement("div");
    renderInspector(host, multi([snip("a", { condition: "@x > 1" }), snip("b", { condition: "@x > 1" })]), handlers);
    expect(host.querySelector(".insp-head-name")?.textContent).toBe("2 snippets selected");
    expect(rowOf(host, "Condition")?.querySelector(".insp-mixed")).toBeNull();
    const mixed = document.createElement("div");
    renderInspector(mixed, multi([snip("a", { condition: "@x > 1" }), snip("b")]), handlers);
    expect(rowOf(mixed, "Condition")?.textContent).toContain("Mixed");
  });

  it("offers Jump only when every item is a snippet", () => {
    const host = document.createElement("div");
    renderInspector(host, multi([snip("a"), { kind: "group", id: "g", role: "sequence", labelParts: ["Sequence"], label: "Sequence" }]), handlers);
    expect(rowOf(host, "Jump")).toBeUndefined();
    expect(host.querySelector(".insp-head-name")?.textContent).toBe("2 items selected");
  });

  it("opens one condition editor for all of them, seeded with the shared condition", () => {
    const editConditionMany = vi.fn();
    const host = document.createElement("div");
    renderInspector(host, multi([snip("a", { condition: "@x > 1" }), snip("b", { condition: "@x > 1" })]), { ...handlers, editConditionMany });
    rowOf(host, "Condition")!.querySelector<HTMLButtonElement>("button")!.click();
    expect(editConditionMany).toHaveBeenCalledWith(["a", "b"], "@x > 1", expect.any(HTMLElement));
  });

  it("writes a default pause to every item, inside one batch", () => {
    const calls: string[] = [];
    const setPadAfterDefault = vi.fn((id: string) => { calls.push(id); });
    const batch = vi.fn((edits: () => void) => { calls.push("batch"); edits(); });
    const host = document.createElement("div");
    renderInspector(host, multi([snip("a"), snip("b", { padAfterDefault: 1 })]), { ...handlers, setPadAfterDefault, batch });
    const input = rowOf(host, "Default pad")!.querySelector<HTMLInputElement>("input")!;
    expect(input.placeholder).toBe("Mixed");
    input.value = "0.5"; input.dispatchEvent(new Event("change"));
    expect(calls).toEqual(["batch", "a", "b"]);
    expect(setPadAfterDefault).toHaveBeenCalledWith("b", 0.5);
  });

  it("draws a tag only some items carry with its count, and a removal takes it off them all", () => {
    const setTags = vi.fn();
    const host = document.createElement("div");
    renderInspector(host, multi([snip("a", { tags: ["night", "rain"] }), snip("b", { tags: ["night"] }), snip("c", { tags: ["night"] })]), { ...handlers, setTags });
    const chips = [...host.querySelectorAll<HTMLElement>(".insp-tag")];
    expect(chips.map((c) => [c.querySelector(".insp-tag-text")?.textContent, c.classList.contains("partial")])).toEqual([["night", false], ["rain, 1 of 3", true]]);
    chips[0]!.querySelector<HTMLButtonElement>(".insp-tag-x")!.click();
    expect(setTags.mock.calls).toEqual([["a", ["rain"]], ["b", []], ["c", []]]);
  });
});
