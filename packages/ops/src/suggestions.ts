// ---------------------------------------------------------------------------
// Deciding suggestions on the FILES (patterkit/design/editable-script-build-plan.md step 4).
//
// Patterpad's editor accepts a suggestion on the scene it has open by editing the live surface. Accepting
// many at once from the Search window, or from the CLI, has no surface: this does the same work on the
// project's shards and returns the writes for the caller to commit through VC.
//
// A suggestion proposes any of: new text, a new speaker, a new speaker qualifier, a new direction, cutting
// the beat. Each part it
// carries is checked against its own baseline first; if the project has moved on since (the text or the
// speaker isn't what the suggestion was made against), the suggestion is STALE and is refused, never
// applied over the newer work. Rejecting needs no check.
//
// Also the cut writer the model has always read and nothing wrote (`setCut`).
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { canonicalStringify, parseSource } from "@patterkit/core";
import { walkNodes, AUTHORING_SCHEMA } from "@patterkit/model";
import type { AuthoringFile, Beat, FlowFile, Group, LineBeat, LocaleFile, Scene, Snippet, Suggestion } from "@patterkit/model";
import type { LoadedProject } from "./load.js";
import type { PlannedWrite } from "./write.js";
import { authoringPath, existingLocPath } from "./localisation.js";
import { sourceStrings } from "./loaded-helpers.js";

/** Which parts of a suggestion no longer match the project (empty: it still applies cleanly). */
export function staleParts(s: Suggestion, liveText: string, line: LineBeat | undefined): string[] {
  const stale: string[] = [];
  if (liveText !== s.baseline) stale.push("the text");
  if (s.proposedCharacter !== undefined && (line?.character ?? "") !== (s.baselineCharacter ?? "")) stale.push("the speaker");
  if (s.proposedQualifier !== undefined && (line?.qualifier ?? "") !== (s.baselineQualifier ?? "")) stale.push("the speaker qualifier");
  if (s.proposedDirection !== undefined && (line?.direction ?? "") !== (s.baselineDirection ?? "")) stale.push("the direction");
  if ((s.proposedCharacter !== undefined || s.proposedQualifier !== undefined || s.proposedDirection !== undefined) && !line) stale.push("the line (no longer a spoken line)");
  return stale;
}

/** An open suggestion, where it is, and whether it still applies. */
export interface OpenSuggestion {
  suggestion: Suggestion;
  sceneId?: string;
  /** Parts that changed since it was made (empty: clean). */
  stale: string[];
}

/** Every open (unresolved) suggestion in the project, optionally only those from one handoff, in scene
 *  order then by time. One whose line is gone is listed as stale. */
export function listOpenSuggestions(loaded: LoadedProject, filter: { handoff?: string } = {}): OpenSuggestion[] {
  const places = indexPlaces(loaded);
  const live = sourceStrings(loaded);
  const sceneOrder = new Map(loaded.scenes.map((sc, i) => [sc.id, i]));
  const out: OpenSuggestion[] = [];
  for (const af of loaded.authoring) {
    for (const s of af.suggestions ?? []) {
      if (s.resolved || (filter.handoff && s.handoff?.id !== filter.handoff)) continue;
      const place = places.get(s.anchor);
      const line = place?.beat?.kind === "line" ? place.beat : undefined;
      out.push({ suggestion: s, ...(place ? { sceneId: place.sceneId } : {}), stale: place ? staleParts(s, live[s.anchor] ?? "", line) : ["the line (no longer in the project)"] });
    }
  }
  return out.sort((a, b) => (sceneOrder.get(a.sceneId ?? "") ?? 1e9) - (sceneOrder.get(b.sceneId ?? "") ?? 1e9) || a.suggestion.ts.localeCompare(b.suggestion.ts));
}

/** Accept or reject one suggestion. */
export interface SuggestionDecision { id: string; accept: boolean }

/** What became of one decision. */
export interface DecisionResult {
  id: string;
  outcome: "accepted" | "rejected" | "stale" | "missing" | "resolved-already";
  /** Why a stale or missing one wasn't applied, in words for the person who asked. */
  reason?: string;
}

export interface DecisionPlan {
  /** Loc, flow, and authoring shard writes, one per touched file, for the caller to commit. */
  writes: PlannedWrite[];
  results: DecisionResult[];
}

/** Where a node or beat lives. */
export interface Place { sceneId: string; beat?: Beat }

/** Every scene, block, node, beat, and option prompt id, to the scene it is in (and the beat, for beats). */
export function indexPlaces(loaded: LoadedProject): Map<string, Place> {
  const places = new Map<string, Place>();
  for (const scene of loaded.scenes) {
    places.set(scene.id, { sceneId: scene.id });
    for (const block of scene.blocks) {
      places.set(block.id, { sceneId: scene.id });
      walkNodes<Group | Snippet>(block.children, (node) => {
        places.set(node.id, { sceneId: scene.id });
        if (node.type === "group") { if (node.prompt) places.set(node.prompt.id, { sceneId: scene.id }); return; }
        for (const beat of node.beats ?? []) places.set(beat.id, { sceneId: scene.id, beat });
      });
    }
  }
  return places;
}

/** The working copies a batch edits, written once each at the end: only the ones `touch`ed, since a flow
 *  read just to check a suggestion's staleness hasn't changed. */
class Working {
  private readonly authoring = new Map<string, AuthoringFile>();
  private readonly locs = new Map<string, LocaleFile>();
  private readonly flows = new Map<string, FlowFile>();
  private readonly touched = new Set<string>();
  constructor(private readonly loaded: LoadedProject) {}

  /** Mark a file as changed, so `writes` includes it. */
  touch(path: string): void { this.touched.add(path); }

  /** A scene's authoring shard: the loaded one (copied), or a new one at the layout's path. */
  authoringFor(path: string): AuthoringFile {
    let af = this.authoring.get(path);
    if (!af) {
      const i = this.loaded.authoringFiles.indexOf(path);
      const existing = i >= 0 ? this.loaded.authoring[i] : undefined;
      af = existing ? structuredClone(existing) : { schema: AUTHORING_SCHEMA };
      this.authoring.set(path, af);
    }
    return af;
  }

  /** A scene's default-locale strings shard, or undefined when it has none (no text to change). */
  locFor(sceneId: string): { path: string; file: LocaleFile } | undefined {
    const path = existingLocPath(this.loaded, sceneId, this.loaded.project.locales.default);
    if (!path) return undefined;
    let file = this.locs.get(path);
    if (!file) {
      const i = this.loaded.localeFiles.indexOf(path);
      file = structuredClone(this.loaded.locales[i]!);
      this.locs.set(path, file);
    }
    return { path, file };
  }

  /** A scene's flow shard, read from disk for its envelope (as pin does), with the scene to edit. */
  flowFor(sceneId: string): { path: string; file: FlowFile } | undefined {
    const path = this.loaded.sceneFiles[sceneId];
    if (!path) return undefined;
    let file = this.flows.get(path);
    if (!file) {
      const onDisk = parseSource(readFileSync(path, "utf8")) as FlowFile;
      const scene = this.loaded.scenes.find((s) => s.id === sceneId);
      file = { ...onDisk, scene: structuredClone(scene ?? onDisk.scene) };
      this.flows.set(path, file);
    }
    return { path, file };
  }

  writes(): PlannedWrite[] {
    return [...this.locs, ...this.flows, ...this.authoring]
      .filter(([path]) => this.touched.has(path))
      .map(([path, file]) => ({ path, content: canonicalStringify(file) }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }
}

/** The beat with this id in a scene, for editing. */
function beatIn(scene: Scene, id: string): Beat | undefined {
  let found: Beat | undefined;
  for (const block of scene.blocks) {
    walkNodes<Group | Snippet>(block.children, (node) => {
      if (found || node.type !== "snippet") return;
      found = (node.beats ?? []).find((b) => b.id === id);
    });
  }
  return found;
}

/**
 * Accept or reject suggestions, planning the writes. Decisions apply in order, so two suggestions on one
 * line both accepted leaves the second stale (the first changed the text it was made against).
 */
export function applySuggestionDecisions(
  loaded: LoadedProject,
  decisions: SuggestionDecision[],
  opts: { now?: string; by?: string } = {},
): DecisionPlan {
  const now = opts.now ?? new Date().toISOString();
  const places = indexPlaces(loaded);
  const work = new Working(loaded);

  // Suggestion id -> the authoring shard (path) that holds it.
  const holder = new Map<string, string>();
  loaded.authoring.forEach((af, i) => { for (const s of af.suggestions ?? []) holder.set(s.id, loaded.authoringFiles[i]!); });

  const results: DecisionResult[] = [];
  for (const d of decisions) {
    const path = holder.get(d.id);
    const s = path ? work.authoringFor(path).suggestions?.find((x) => x.id === d.id) : undefined;
    if (!path || !s) { results.push({ id: d.id, outcome: "missing", reason: "no suggestion with this id" }); continue; }
    if (s.resolved) { results.push({ id: d.id, outcome: "resolved-already" }); continue; }

    if (!d.accept) {
      s.resolved = true; s.outcome = "rejected"; work.touch(path);
      results.push({ id: d.id, outcome: "rejected" });
      continue;
    }

    const place = places.get(s.anchor);
    if (!place) { results.push({ id: d.id, outcome: "missing", reason: "its line is no longer in the project" }); continue; }
    const loc = work.locFor(place.sceneId);
    const flow = work.flowFor(place.sceneId);
    const beat = flow ? beatIn(flow.file.scene, s.anchor) : undefined;
    const line = beat?.kind === "line" ? beat : undefined;

    // Staleness, part by part: each part present must still match what it was suggested against.
    const liveText = loc?.file.strings[s.anchor] ?? "";
    const stale = staleParts(s, liveText, line);
    if (stale.length) {
      results.push({ id: d.id, outcome: "stale", reason: `${stale.join(" and ")} changed since this was suggested` });
      continue;
    }

    const aPath = authoringPath(loaded, place.sceneId);
    const sceneAuthoring = work.authoringFor(aPath);
    let edited = false;
    if (loc && s.proposed !== liveText) {
      loc.file.strings[s.anchor] = s.proposed; work.touch(loc.path);
      // The per-string stamp is what makes a translation of this line go stale (as Patterpad's save does).
      sceneAuthoring.edits = { ...sceneAuthoring.edits, [s.anchor]: { ...sceneAuthoring.edits?.[s.anchor], modifiedAt: now } };
      edited = true;
    }
    if (line && flow && s.proposedCharacter !== undefined && s.proposedCharacter !== (line.character ?? "")) {
      line.character = s.proposedCharacter; work.touch(flow.path); edited = true;
    }
    if (line && flow && s.proposedQualifier !== undefined && s.proposedQualifier !== (line.qualifier ?? "")) {
      if (s.proposedQualifier === "") delete line.qualifier; else line.qualifier = s.proposedQualifier;
      work.touch(flow.path); edited = true;
    }
    if (line && flow && s.proposedDirection !== undefined && s.proposedDirection !== (line.direction ?? "")) {
      if (s.proposedDirection === "") delete line.direction; else line.direction = s.proposedDirection;
      work.touch(flow.path); edited = true;
    }
    if (s.proposedCut) { sceneAuthoring.cut = { ...sceneAuthoring.cut, [s.anchor]: true }; edited = true; }
    if (edited && opts.by) sceneAuthoring.edits = { ...sceneAuthoring.edits, [place.sceneId]: { ...sceneAuthoring.edits?.[place.sceneId], modifiedAt: now, by: opts.by } };
    if (edited) work.touch(aPath);

    // `s` is the working copy of the suggestion (its shard may be the same one just edited).
    s.resolved = true; s.outcome = "accepted"; work.touch(path);
    results.push({ id: d.id, outcome: "accepted" });
  }

  return { writes: work.writes(), results };
}

/** Mark nodes or beats cut (or bring them back), planning the authoring writes, one per scene touched.
 *  Ids that aren't in the project are skipped and returned. */
export function setCut(loaded: LoadedProject, ids: string[], cut: boolean): { writes: PlannedWrite[]; unknown: string[] } {
  const places = indexPlaces(loaded);
  const work = new Working(loaded);
  const unknown: string[] = [];
  for (const id of ids) {
    const place = places.get(id);
    if (!place) { unknown.push(id); continue; }
    const aPath = authoringPath(loaded, place.sceneId);
    const af = work.authoringFor(aPath);
    if ((af.cut?.[id] === true) === cut) continue; // already so
    const next = { ...af.cut };
    if (cut) next[id] = true; else delete next[id];
    if (Object.keys(next).length) af.cut = next; else delete af.cut;
    work.touch(aPath);
  }
  return { writes: work.writes(), unknown };
}
