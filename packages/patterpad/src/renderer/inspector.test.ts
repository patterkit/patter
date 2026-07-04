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
  jumpLabel: () => "", addOption: noop, removeChunk: noop, moveChunk: noop,
  gameDataFields: () => [], setGameData: noop, sceneProps: () => [], editSceneProps: noop,
  writingStatuses: () => [], lineStatus: () => null, setLineStatus: noop,
  recordingStatuses: () => [], recordingStatus: () => null, setRecordingStatus: noop,
  audioFoldersOn: () => false, recordingFolderStatus: () => null, playRecording: noop,
  scratchStatus: () => null, recordScratch: noop, scratchStale: () => false,
};
const ctx = (level: unknown): InspectorContext => ({ levels: [level] }) as InspectorContext;

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
