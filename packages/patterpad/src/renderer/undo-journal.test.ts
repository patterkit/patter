// The journal that keeps the order between the open scene's history and the project's (patterkit
// design/patterpad-undo.md, "The arbiter"). Pure: the two histories are fakes that say what they did.

import { describe, it, expect } from "vitest";
import { UndoJournal, type EntryResult, type JournalEntry } from "./src/undo-journal.js";

/** Fake histories: the scene's is a depth counter (as ProseMirror's undoDepth), the project's a stack of
 *  ids; `log` records what each Cmd+Z reached, in order. */
function histories() {
  const log: string[] = [];
  const scene = { depth: 0, redo: 0, locked: false };
  const project = { undo: [] as number[], redo: [] as number[], refuse: false, drift: false };
  const name = (e: JournalEntry): string => (e.kind === "scene" ? `scene:${e.sceneId}` : `project:${e.id}`);
  const apply = (e: JournalEntry, way: "undo" | "redo"): EntryResult => {
    if (e.kind === "scene") {
      if (scene.locked) return "refused";
      if (way === "undo") { if (scene.depth === 0) return "skip"; scene.depth--; scene.redo++; }
      else { if (scene.redo === 0) return "skip"; scene.redo--; scene.depth++; }
    } else {
      if (project.refuse) return "refused";
      if (project.drift) { project.undo = []; return "drift"; }
      const from = way === "undo" ? project.undo : project.redo;
      if (from[from.length - 1] !== e.id) return "skip";
      from.pop();
      (way === "undo" ? project.redo : project.undo).push(e.id);
    }
    log.push(`${way} ${name(e)}`);
    return "done";
  };
  return { log, scene, project, apply };
}

describe("the undo journal", () => {
  it("interleaves the two histories: newest first, whichever it lives in", async () => {
    const j = new UndoJournal();
    const h = histories();
    j.pushScene("A"); h.scene.depth++;
    j.pushProject(1, "Replace"); h.project.undo.push(1);
    j.pushScene("A"); h.scene.depth++;
    for (let i = 0; i < 3; i++) expect(await j.undo(h.apply)).toBe("done");
    expect(h.log).toEqual(["undo scene:A", "undo project:1", "undo scene:A"]);
    expect(await j.undo(h.apply)).toBe("empty");
    for (let i = 0; i < 3; i++) expect(await j.redo(h.apply)).toBe("done");
    expect(h.log.slice(3)).toEqual(["redo scene:A", "redo project:1", "redo scene:A"]);
  });

  it("takes a paired gesture in one Cmd+Z, and gives it back in one redo, in order", async () => {
    const j = new UndoJournal();
    const h = histories();
    j.pushScene("A"); h.scene.depth++;                 // an edit before
    j.pushScene("A"); h.scene.depth++;                 // Duplicate
    j.join(7);                                          // the status it carried: announced as joining...
    j.pushProject(7, "Writing Status"); h.project.undo.push(7); // ...before main's step arrived
    j.pushProject(8, "Notes"); h.project.undo.push(8);
    j.join(8);                                          // and the notes it carried, joined after arriving
    expect(await j.undo(h.apply)).toBe("done");
    expect(h.log).toEqual(["undo project:8", "undo project:7", "undo scene:A"]);
    expect(j.undoEntries).toHaveLength(1);
    expect(await j.redo(h.apply)).toBe("done");
    expect(h.log.slice(3)).toEqual(["redo scene:A", "redo project:7", "redo project:8"]);
  });

  it("adds one entry for a step announced twice (by main, and by the write's answer), none for a merged one", () => {
    const j = new UndoJournal();
    j.pushProject(3, "Properties");
    j.pushProject(3, "Properties");
    expect(j.undoEntries).toHaveLength(1);
  });

  it("drops a scene's entries when its history goes (a switch, a reload), keeping the project's", async () => {
    const j = new UndoJournal();
    const h = histories();
    j.pushScene("A");
    j.pushProject(1, "Set Start"); h.project.undo.push(1);
    j.pushScene("A");
    // A project step that rewrote scene A reloads it: everything of A's below goes (the barrier).
    j.dropScene("A");
    expect(j.undoEntries.map((e) => e.kind)).toEqual(["project"]);
    j.pushScene("B"); h.scene.depth = 1;              // switched to B, which has its own history
    expect(await j.undo(h.apply)).toBe("done");
    expect(await j.undo(h.apply)).toBe("done");
    expect(h.log).toEqual(["undo scene:B", "undo project:1"]);
  });

  it("skips scene entries ProseMirror's depth has dropped, then reaches the project step below", async () => {
    const j = new UndoJournal();
    const h = histories();
    j.pushProject(1, "Replace"); h.project.undo.push(1);
    for (let i = 0; i < 5; i++) j.pushScene("A");
    h.scene.depth = 3; // the history kept only the newest three events
    for (let i = 0; i < 3; i++) await j.undo(h.apply);
    expect(await j.undo(h.apply)).toBe("done");
    expect(h.log).toEqual(["undo scene:A", "undo scene:A", "undo scene:A", "undo project:1"]);
    expect(j.undoEntries).toHaveLength(0);
  });

  it("a new entry of either kind clears both redo journals, and says when main's needs clearing", async () => {
    const j = new UndoJournal();
    const h = histories();
    j.pushScene("A"); h.scene.depth++;
    j.pushProject(1, "Replace"); h.project.undo.push(1);
    await j.undo(h.apply); await j.undo(h.apply);
    expect(j.redoEntries).toHaveLength(2);
    expect(j.pushScene("A")).toBe(true); // a project step was redoable: main must clear its redo
    expect(j.redoEntries).toHaveLength(0);
    expect(j.pushScene("A")).toBe(false);
    await j.undo(h.apply);
    j.pushProject(2, "Set Start");          // main cleared its own redo when it recorded this
    expect(j.redoEntries).toHaveLength(0);
  });

  it("leaves an entry refused for a lock where it is", async () => {
    const j = new UndoJournal();
    const h = histories();
    j.pushScene("A"); h.scene.depth++;
    h.scene.locked = true;
    expect(await j.undo(h.apply)).toBe("refused");
    expect(j.undoEntries).toHaveLength(1);
    j.pushProject(1, "Set Start"); h.project.undo.push(1);
    h.project.refuse = true;
    expect(await j.undo(h.apply)).toBe("refused");
    expect(j.undoEntries).toHaveLength(2);
    h.project.refuse = false; h.scene.locked = false;
    expect(await j.undo(h.apply)).toBe("done");
    expect(await j.undo(h.apply)).toBe("done");
  });

  it("drops a drifted project step and every project step below it, keeping the scene's", async () => {
    const j = new UndoJournal();
    const h = histories();
    j.pushProject(1, "Set Start"); h.project.undo.push(1);
    j.pushScene("A"); h.scene.depth++;
    j.pushProject(2, "Replace"); h.project.undo.push(2);
    h.project.drift = true;
    expect(await j.undo(h.apply)).toBe("drift");
    expect(j.undoEntries.map((e) => e.kind)).toEqual(["scene"]);
  });

  it("labels the Edit menu from the newest entries: a project step's own, nothing for a scene edit", async () => {
    const j = new UndoJournal();
    const h = histories();
    const seen: Array<{ undo?: string; redo?: string }> = [];
    j.onChange = () => seen.push(j.labels());
    j.pushProject(1, "Replace"); h.project.undo.push(1);
    expect(j.labels()).toEqual({ undo: "Replace" });
    await j.undo(h.apply);
    expect(j.labels()).toEqual({ redo: "Replace" });
    j.pushScene("A");
    expect(j.labels()).toEqual({});
    expect(seen.length).toBeGreaterThan(0);
  });

  it("a project undo that reloads the open scene (dropping its entries) moves the step to redo once, and off the undo journal", async () => {
    const j = new UndoJournal();
    j.pushScene("A");
    j.pushProject(1, "Replace");
    const apply = async (e: JournalEntry): Promise<EntryResult> => {
      await Promise.resolve();
      if (e.kind === "project") j.dropScene("A"); // the reload after the undo, as afterProjectHistory does
      return "done";
    };
    expect(await j.undo(apply)).toBe("done");
    expect(j.undoEntries).toEqual([]);
    expect(j.redoEntries.map((e) => e.kind)).toEqual(["project"]);
    expect(await j.redo(apply)).toBe("done");
    expect(j.undoEntries.map((e) => e.kind)).toEqual(["project"]);
    expect(j.redoEntries).toEqual([]);
  });

  it("a step that merged into the one before still clears the redo journal", async () => {
    const j = new UndoJournal();
    const h = histories();
    j.pushScene("A"); h.scene.depth++;
    await j.undo(h.apply);
    expect(j.redoEntries).toHaveLength(1);
    j.noteMerged();
    expect(j.redoEntries).toHaveLength(0);
  });

  it("catches up with a step main has and the journal hasn't heard of yet, instead of dropping the entry", async () => {
    const j = new UndoJournal();
    const h = histories();
    j.pushProject(1, "Set Start"); h.project.undo.push(1);
    h.project.undo.push(2); // a Replace from the Search window, its announcement still on the way
    let retried = false;
    const apply = (e: JournalEntry, way: "undo" | "redo"): EntryResult => {
      if (e.kind === "project" && h.project.undo[h.project.undo.length - 1] !== e.id) {
        return j.catchUp(e, { id: 2, label: "Replace" }) === "retry" ? (retried = true, "refused") : "skip";
      }
      return h.apply(e, way);
    };
    expect(await j.undo(apply)).toBe("refused");
    expect(retried).toBe(true);
    expect(j.undoEntries.map((e) => (e.kind === "project" ? e.id : 0))).toEqual([1, 2]);
    expect(await j.undo(apply)).toBe("done");
    expect(await j.undo(apply)).toBe("done");
    expect(h.log).toEqual(["undo project:2", "undo project:1"]);
    // A step main has really let go is skipped.
    expect(j.catchUp({ kind: "project", id: 5, label: "x", group: 0 }, undefined)).toBe("skip");
  });
});
