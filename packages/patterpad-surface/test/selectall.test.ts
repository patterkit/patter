// ---------------------------------------------------------------------------
// Cmd/Ctrl-A selects the FIELD the caret is in, not the whole scene (src/selectall.ts).
// Driven on real EditorStates: what the command selects is read back as the text
// between the selection's ends, so a test says exactly what the author would see
// highlighted.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { EditorState, TextSelection, NodeSelection } from "prosemirror-state";
import type { Scene } from "@patterkit/model";
import { sceneToDoc } from "../src/bridge.js";
import { selectAllInBeat } from "../src/selectall.js";

const scene: Scene = {
  id: "s", type: "scene", name: "S", blocks: [
    { id: "b", type: "block", name: "B", children: [
      { id: "sn", type: "snippet", beats: [
        { id: "L1", kind: "line", character: "ANNA", direction: "wiping a glass" },
        { id: "T1", kind: "text" },
        { id: "L2", kind: "line", character: "BO" },          // no words yet
        { id: "G1", kind: "gameEvent" },
      ] },
      { id: "ch", type: "group", groupType: "choice", children: [
        { id: "opt", type: "group", prompt: { id: "P1", kind: "text" }, children: [] },
      ] },
    ] },
  ],
} as unknown as Scene;

const STRINGS = { L1: "We don't get many new faces.", T1: "The fire spits.", L2: "", P1: "Ask about work" };

function state(): EditorState {
  return EditorState.create({ doc: sceneToDoc(scene, STRINGS) });
}

/** The position just inside a beat's named zone, and that zone's text. */
function zoneAt(s: EditorState, beatId: string, role: "cue" | "paren" | "say"): { pos: number; text: string } {
  let found: { pos: number; text: string } | null = null;
  s.doc.descendants((node, pos) => {
    if (found || node.attrs.id !== beatId) return !found;
    node.forEach((z, offset) => { if (z.type.name === role) found = { pos: pos + 1 + offset + 1, text: z.textContent }; });
    return false;
  });
  if (!found) throw new Error(`no ${role} zone on ${beatId}`);
  return found;
}

/** Run the command from a caret in `beatId`'s `role` zone; the selected text, or null when it declined
 *  to change the selection (and whether it swallowed the key). */
function selectFrom(beatId: string, role: "cue" | "paren" | "say"): { handled: boolean; selected: string | null } {
  const s = state();
  const at = zoneAt(s, beatId, role);
  const start = EditorState.create({ doc: s.doc, selection: TextSelection.create(s.doc, at.pos) });
  const out: { state: EditorState | null } = { state: null };
  const handled = selectAllInBeat(start, (tr) => { out.state = start.apply(tr); });
  const s2 = out.state;
  return { handled, selected: s2 ? s2.doc.textBetween(s2.selection.from, s2.selection.to) : null };
}

describe("Cmd-A selects the field, not the document", () => {
  it("from a dialogue line's words: all of that line's words", () => {
    expect(selectFrom("L1", "say")).toEqual({ handled: true, selected: "We don't get many new faces." });
  });

  it("from the CUE: the line's words, never the character token", () => {
    // The character is a token the cast popup owns, so "select all" in the cue means the dialogue.
    const r = selectFrom("L1", "cue");
    expect(r).toEqual({ handled: true, selected: "We don't get many new faces." });
    expect(r.selected).not.toContain("ANNA");
  });

  it("from a direction: the direction being typed, not the line's words", () => {
    expect(selectFrom("L1", "paren")).toEqual({ handled: true, selected: "wiping a glass" });
  });

  it("from a text line: its text", () => {
    expect(selectFrom("T1", "say")).toEqual({ handled: true, selected: "The fire spits." });
  });

  it("from a choice option's prompt: the prompt's text", () => {
    expect(selectFrom("P1", "say")).toEqual({ handled: true, selected: "Ask about work" });
  });

  it("from a caret on the beat's boundary (no zone at all): still the line's words", () => {
    // Clicking a cue can leave the position on the beat itself rather than inside a zone; the key
    // must not be swallowed there (it was, live, before this case was handled).
    const s = state();
    let beatPos = -1;
    s.doc.descendants((n, p) => { if (n.attrs.id === "L1") { beatPos = p; return false; } return beatPos < 0; });
    const start = EditorState.create({ doc: s.doc, selection: TextSelection.create(s.doc, beatPos + 1) });
    const out: { state: EditorState | null } = { state: null };
    expect(selectAllInBeat(start, (tr) => { out.state = start.apply(tr); })).toBe(true);
    const s2 = out.state!;
    expect(s2.doc.textBetween(s2.selection.from, s2.selection.to)).toBe("We don't get many new faces.");
  });

  it("on an empty line: swallowed, and the caret is left where it was", () => {
    // Nothing to select. It must not fall through to the document-wide select, and must not move the
    // caret into a field the author did not ask for.
    expect(selectFrom("L2", "cue")).toEqual({ handled: true, selected: null });
    expect(selectFrom("L2", "say")).toEqual({ handled: true, selected: null });
  });

  it("on a selected game event: swallowed, and nothing is selected", () => {
    const s = state();
    let pos = -1;
    s.doc.descendants((n, p) => { if (n.type.name === "gameEvent") { pos = p; return false; } return pos < 0; });
    const start = EditorState.create({ doc: s.doc, selection: NodeSelection.create(s.doc, pos) });
    let dispatched = false;
    expect(selectAllInBeat(start, () => { dispatched = true; })).toBe(true); // swallowed: no document select
    expect(dispatched).toBe(false);
  });

  it("outside a beat (a node-selected bubble): declines, so 'everything' still means everything", () => {
    const s = state();
    let pos = -1;
    s.doc.descendants((n, p) => { if (n.type.name === "snippet") { pos = p; return false; } return pos < 0; });
    const start = EditorState.create({ doc: s.doc, selection: NodeSelection.create(s.doc, pos) });
    expect(selectAllInBeat(start, () => { throw new Error("must not dispatch"); })).toBe(false);
  });
});
