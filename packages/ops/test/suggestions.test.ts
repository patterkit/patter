// ---------------------------------------------------------------------------
// Deciding suggestions on the files (suggestions.ts): accept applies every part a suggestion carries
// (text, speaker, direction, cut) and stamps the edit trail; a part whose baseline no longer matches makes
// the suggestion stale and nothing is applied; reject only archives. Plus the cut writer.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { cpSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalStringify, parseSource } from "@patterkit/core";
import type { AuthoringFile, FlowFile, LineBeat, LocaleFile, Suggestion } from "@patterkit/model";
import { loadProject, applyWrites, applySuggestionDecisions, setCut, runScriptDoc, listOpenSuggestions } from "../src/index.js";

const fixture = fileURLToPath(new URL("../../../test-fixtures/tavern-example.patter", import.meta.url));
const NOW = "2026-10-03T12:00:00.000Z";

/** A temp copy of the tavern with these suggestions in its tavern authoring shard. */
function tavernWith(suggestions: Suggestion[]): string {
  const dir = join(mkdtempSync(join(tmpdir(), "patter-sugg-")), "tavern.patter");
  cpSync(fixture, dir, { recursive: true });
  const path = join(dir, "authoring/tavern.patterx");
  const af = parseSource(readFileSync(path, "utf8")) as AuthoringFile;
  writeFileSync(path, canonicalStringify({ ...af, suggestions }));
  return dir;
}

const sugg = (id: string, extra: Partial<Suggestion>): Suggestion =>
  ({ id, anchor: "L_greet", baseline: "What'll it be, stranger?", proposed: "What'll it be, stranger?", author: "Sam", ts: "2026-10-01T00:00:00Z", ...extra });

const read = <T>(dir: string, rel: string): T => parseSource(readFileSync(join(dir, rel), "utf8")) as T;
const greet = (dir: string): LineBeat => {
  const flow = read<FlowFile>(dir, "scenes/tavern.patterflow");
  return JSON.parse(JSON.stringify(flow.scene)).blocks.flatMap((b: { children: unknown[] }) => b.children)
    .flatMap((n: { beats?: LineBeat[] }) => n.beats ?? []).find((b: LineBeat) => b.id === "L_greet");
};
const suggestionsOf = (dir: string): Suggestion[] => read<AuthoringFile>(dir, "authoring/tavern.patterx").suggestions ?? [];

describe("applySuggestionDecisions", () => {
  it("accepting new text writes it, stamps the line's edit time, and archives the suggestion", () => {
    const dir = tavernWith([sugg("s1", { proposed: "What'll it be, friend?" })]);
    const plan = applySuggestionDecisions(loadProject(dir), [{ id: "s1", accept: true }], { now: NOW, by: "Ian" });
    expect(plan.results).toEqual([{ id: "s1", outcome: "accepted" }]);
    applyWrites(plan.writes);
    expect(read<LocaleFile>(dir, "loc/en/tavern.patterloc").strings["L_greet"]).toBe("What'll it be, friend?");
    const af = read<AuthoringFile>(dir, "authoring/tavern.patterx");
    expect(af.edits?.["L_greet"]?.modifiedAt).toBe(NOW);          // a translation of it now reads as stale
    expect(af.edits?.["scn_tavern"]).toMatchObject({ modifiedAt: NOW, by: "Ian" });
    expect(af.suggestions?.[0]).toMatchObject({ resolved: true, outcome: "accepted" });
  });

  it("accepting a speaker and a direction change edits the beat in the flow", () => {
    const dir = tavernWith([sugg("s1", { proposedCharacter: "STRANGER", baselineCharacter: "BARKEEP", proposedDirection: "warily", baselineDirection: "" })]);
    applyWrites(applySuggestionDecisions(loadProject(dir), [{ id: "s1", accept: true }], { now: NOW }).writes);
    expect(greet(dir)).toMatchObject({ character: "STRANGER", direction: "warily" });
    // The text didn't change, so its translation isn't made stale.
    expect(read<AuthoringFile>(dir, "authoring/tavern.patterx").edits?.["L_greet"]).toBeUndefined();
  });

  it("accepting a cut marks the beat cut, so exports leave it out", () => {
    const dir = tavernWith([sugg("s1", { proposedCut: true })]);
    applyWrites(applySuggestionDecisions(loadProject(dir), [{ id: "s1", accept: true }], { now: NOW }).writes);
    expect(read<AuthoringFile>(dir, "authoring/tavern.patterx").cut).toEqual({ L_greet: true });
    const lines = runScriptDoc(loadProject(dir)).elements.filter((e) => e.kind === "line").map((e) => e.id);
    expect(lines).not.toContain("L_greet");
  });

  it("refuses a suggestion whose text, or speaker, changed since it was made, and writes nothing", () => {
    const dir = tavernWith([
      sugg("text", { baseline: "Something older.", proposed: "New." }),
      sugg("speaker", { proposedCharacter: "STRANGER", baselineCharacter: "GUARD" }),
    ]);
    const plan = applySuggestionDecisions(loadProject(dir), [{ id: "text", accept: true }, { id: "speaker", accept: true }], { now: NOW });
    expect(plan.results.map((r) => [r.id, r.outcome])).toEqual([["text", "stale"], ["speaker", "stale"]]);
    expect(plan.results[0]!.reason).toContain("the text");
    expect(plan.results[1]!.reason).toContain("the speaker");
    expect(plan.writes).toEqual([]);
  });

  it("applies in order: of two accepted suggestions on one line, the second is stale", () => {
    const dir = tavernWith([sugg("a", { proposed: "First." }), sugg("b", { proposed: "Second." })]);
    const plan = applySuggestionDecisions(loadProject(dir), [{ id: "a", accept: true }, { id: "b", accept: true }], { now: NOW });
    expect(plan.results.map((r) => r.outcome)).toEqual(["accepted", "stale"]);
    applyWrites(plan.writes);
    expect(read<LocaleFile>(dir, "loc/en/tavern.patterloc").strings["L_greet"]).toBe("First.");
  });

  it("rejecting only archives, and needs no staleness check", () => {
    const dir = tavernWith([sugg("s1", { baseline: "Long gone.", proposed: "x" })]);
    const plan = applySuggestionDecisions(loadProject(dir), [{ id: "s1", accept: false }], { now: NOW });
    expect(plan.results).toEqual([{ id: "s1", outcome: "rejected" }]);
    expect(plan.writes.map((w) => w.path.split("/").pop())).toEqual(["tavern.patterx"]);
    applyWrites(plan.writes);
    expect(suggestionsOf(dir)[0]).toMatchObject({ resolved: true, outcome: "rejected" });
    expect(read<LocaleFile>(dir, "loc/en/tavern.patterloc").strings["L_greet"]).toBe("What'll it be, stranger?");
  });

  it("reports an unknown, an already-decided, and an orphaned suggestion without writing", () => {
    const dir = tavernWith([sugg("done", { resolved: true, outcome: "accepted" }), sugg("orphan", { anchor: "L_gone" })]);
    const plan = applySuggestionDecisions(loadProject(dir), [{ id: "nope", accept: true }, { id: "done", accept: true }, { id: "orphan", accept: true }]);
    expect(plan.results.map((r) => r.outcome)).toEqual(["missing", "resolved-already", "missing"]);
    expect(plan.writes).toEqual([]);
  });
});

describe("listOpenSuggestions", () => {
  it("lists the open ones, filtered by handoff, each marked clean or stale and why", () => {
    const dir = tavernWith([
      sugg("clean", { proposed: "New.", handoff: { id: "H-AAAA", marker: "K1" } }),
      sugg("stale", { baseline: "Older.", proposed: "x", handoff: { id: "H-AAAA", marker: "K2" } }),
      sugg("other", { proposed: "y", handoff: { id: "H-BBBB", marker: "K3" } }),
      sugg("done", { proposed: "z", resolved: true, outcome: "accepted" }),
      sugg("gone", { anchor: "L_gone" }),
    ]);
    const all = listOpenSuggestions(loadProject(dir));
    expect(all.map((o) => o.suggestion.id).sort()).toEqual(["clean", "gone", "other", "stale"]);
    const mine = listOpenSuggestions(loadProject(dir), { handoff: "H-AAAA" });
    expect(mine.map((o) => [o.suggestion.id, o.stale])).toEqual([["clean", []], ["stale", ["the text"]]]);
    expect(all.find((o) => o.suggestion.id === "gone")!.stale).toEqual(["the line (no longer in the project)"]);
  });
});

describe("setCut", () => {
  it("cuts and restores, one authoring write per scene, and names ids it doesn't know", () => {
    const dir = tavernWith([]);
    const cut = setCut(loadProject(dir), ["L_greet", "L_intim", "L_nope"], true);
    expect(cut.unknown).toEqual(["L_nope"]);
    expect(cut.writes).toHaveLength(1);
    applyWrites(cut.writes);
    expect(read<AuthoringFile>(dir, "authoring/tavern.patterx").cut).toEqual({ L_greet: true, L_intim: true });

    applyWrites(setCut(loadProject(dir), ["L_greet", "L_intim"], false).writes);
    expect(read<AuthoringFile>(dir, "authoring/tavern.patterx").cut).toBeUndefined();
    expect(setCut(loadProject(dir), ["L_greet"], false).writes).toEqual([]); // already not cut: nothing to write
  });
});
