// The arbiter between Patterpad's two histories (patterkit design/patterpad-undo.md, "The arbiter").
//
// The open scene's edits are ProseMirror's history; every other write is a step of the project history in
// main. The journal is the one record of the order they happened in, so Cmd+Z undoes the newest step
// wherever it lives: a scene edit, then a Replace, then the scene edit before it, in that order.
//
// Each entry names its history: `{ kind: "scene", sceneId }` or `{ kind: "project", id }`. Entries made by
// one gesture share a group (a duplicate in the scene and the status it carries to the copies, a project
// write) and one Cmd+Z takes the whole group. The journal applies nothing itself: the caller hands it a
// function that sends an entry to its history and says how that went. Pure, so its rules are tested
// without a DOM.

export type JournalEntry =
  | { kind: "scene"; sceneId: string; group: number }
  | { kind: "project"; id: number; label: string; group: number };

/** How one entry went when it was sent to its history:
 *  - `done`: undone (or redone);
 *  - `skip`: its history can no longer take it (ProseMirror dropped the event past its depth, the scene is
 *    gone); the entry goes, and the next one is tried;
 *  - `refused`: not now (a file somebody else holds, a scene locked by someone else); the entry stays;
 *  - `drift`: a file changed since the step; it goes, and so does every project entry below it, since the
 *    project history has dropped them too. */
export type EntryResult = "done" | "skip" | "refused" | "drift";

/** What an undo or redo came to, for the caller to say: something was done, nothing was there to do, or a
 *  refusal (whose reason the caller already said). */
export type JournalResult = "done" | "empty" | "refused" | "drift";

export type Apply = (entry: JournalEntry, way: "undo" | "redo") => Promise<EntryResult> | EntryResult;

export class UndoJournal {
  // Never reassigned: an undo awaits its history with these in hand, and a scene dropped or a step
  // announced meanwhile (the reload a project undo ends in) must change the same arrays it pops from.
  private readonly undos: JournalEntry[] = [];
  private readonly redos: JournalEntry[] = [];
  private nextGroup = 1;
  /** Project steps announced as joining the entry before them, not yet in the journal. */
  private pendingJoins = new Set<number>();
  /** Told after every change, for the Edit menu's labels. */
  onChange: () => void = () => {};

  /** The undo and redo journals, newest last (for tests and the menu). */
  get undoEntries(): readonly JournalEntry[] { return this.undos; }
  get redoEntries(): readonly JournalEntry[] { return this.redos; }

  clear(): void {
    this.undos.length = 0; this.redos.length = 0; this.pendingJoins.clear();
    this.onChange();
  }

  /**
   * A new event in the scene's history. Clears both redo journals: ProseMirror has cleared its own, and
   * the caller tells main to clear the project's when this returns true (there was a project step to redo).
   */
  pushScene(sceneId: string): boolean {
    this.undos.push({ kind: "scene", sceneId, group: this.nextGroup++ });
    return this.clearRedo();
  }

  /** A new step in the project history (announced by main, or answered by the write that made it: the
   *  same id twice is one entry). A step that merged into the one before adds nothing. Clears the redo
   *  journals; main has cleared its own. */
  pushProject(id: number, label: string): void {
    if (this.undos.some((e) => e.kind === "project" && e.id === id)) return;
    if (this.redos.some((e) => e.kind === "project" && e.id === id)) return;
    const below = this.undos[this.undos.length - 1];
    const join = this.pendingJoins.delete(id) && below !== undefined;
    this.undos.push({ kind: "project", id, label, group: join ? below!.group : this.nextGroup++ });
    this.clearRedo();
  }

  /** Project step `id` was made by the same gesture as the entry below it (Duplicate's carried status):
   *  one Cmd+Z takes both. Works whether the step is in the journal yet or not. */
  join(id: number): void {
    const at = this.undos.findIndex((e) => e.kind === "project" && e.id === id);
    if (at < 0) { this.pendingJoins.add(id); return; }
    const below = this.undos[at - 1];
    if (below) this.undos[at] = { ...this.undos[at]!, group: below.group };
    this.onChange();
  }

  /** Drop every entry of a scene whose history is gone: it was switched away from, or remounted (a project
   *  write that rewrote it reloads it), so nothing can undo those edits now (rulings 6 and the barrier). */
  dropScene(sceneId: string): void {
    const keep = (e: JournalEntry): boolean => !(e.kind === "scene" && e.sceneId === sceneId);
    const before = this.undos.length + this.redos.length;
    filterInPlace(this.undos, keep);
    filterInPlace(this.redos, keep);
    if (this.undos.length + this.redos.length !== before) this.onChange();
  }

  /** The newest entry Cmd+Z would take, and Cmd+Shift+Z. */
  peekUndo(): JournalEntry | undefined { return this.undos[this.undos.length - 1]; }
  peekRedo(): JournalEntry | undefined { return this.redos[this.redos.length - 1]; }

  /** The Edit menu's labels: a project step's own ("Replace"); nothing for a scene edit. */
  labels(): { undo?: string; redo?: string } {
    const u = this.peekUndo(), r = this.peekRedo();
    return { ...(u?.kind === "project" ? { undo: u.label } : {}), ...(r?.kind === "project" ? { redo: r.label } : {}) };
  }

  /** Undo the newest group, newest entry first. Entries their history can no longer take are skipped,
   *  and when a whole group is skipped the next is tried. */
  undo(apply: Apply): Promise<JournalResult> { return this.step("undo", apply); }

  /** Redo the group undone last, oldest entry first. */
  redo(apply: Apply): Promise<JournalResult> { return this.step("redo", apply); }

  private async step(way: "undo" | "redo", apply: Apply): Promise<JournalResult> {
    for (;;) {
      const from = way === "undo" ? this.undos : this.redos;
      const top = from[from.length - 1];
      if (!top) return "empty";
      let did = false;
      while (from.length > 0 && from[from.length - 1]!.group === top.group) {
        const entry = from[from.length - 1]!;
        const result = await apply(entry, way);
        if (result === "refused") { this.onChange(); return did ? "done" : "refused"; }
        // Whatever happened while the history worked, the entry goes from where it is now.
        const at = from.lastIndexOf(entry);
        if (at >= 0) from.splice(at, 1);
        if (result === "done") { (way === "undo" ? this.redos : this.undos).push(entry); did = true; continue; }
        if (result === "drift") {
          filterInPlace(from, (e) => e.kind !== "project");
          this.onChange();
          return did ? "done" : "drift";
        }
        // skip: the entry is gone; carry on with the group
      }
      this.onChange();
      if (did) return "done";
    }
  }

  /**
   * Main answered "stale" for project entry `entry`: its history's top is `top`, not this. When `top` is a
   * newer step the journal hasn't heard of yet (a write from another window still on its way here), the
   * journal catches up: the step goes on as the newest entry, `entry` stays where it is, and the caller asks
   * again ("retry"). Otherwise the history has really let the entry go ("skip").
   */
  catchUp(entry: JournalEntry, top: { id: number; label: string } | undefined): "retry" | "skip" {
    if (entry.kind !== "project" || !top || top.id <= entry.id) return "skip";
    if (this.undos.some((e) => e.kind === "project" && e.id === top.id)) return "skip";
    this.pushProject(top.id, top.label);
    return "retry";
  }

  /** A new step merged into the project step before it (a keyed run): nothing is added, but it is a new
   *  edit all the same, so nothing undone before it can be redone (main has cleared its own redo). */
  noteMerged(): void { if (this.redos.length > 0) this.clearRedo(); }

  private clearRedo(): boolean {
    const hadProject = this.redos.some((e) => e.kind === "project");
    this.redos.length = 0;
    this.onChange();
    return hadProject;
  }
}

function filterInPlace<T>(list: T[], keep: (item: T) => boolean): void {
  let w = 0;
  for (const item of list) if (keep(item)) list[w++] = item;
  list.length = w;
}
