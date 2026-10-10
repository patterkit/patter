// Speaker qualifiers on the main side (design/proposals/speaker-qualifiers.md): the gameId rename that
// rewrites every line using a qualifier (as a cast rename would), and the browse that finds lines by
// qualifier for the search window. Pure over the loaded model, so they test without Electron; the
// writes they plan go through the VC layer in project.ts. A rename reaches everything that holds a gameId:
// the lines, the translated names, suggestions, edit records, and editable-script handoff records.

import { walkNodes, projectQualifiers, qualifierStringKey, PROJECT_LOCALE_SCENE } from "@patterkit/model";
import type { AuthoringFile, Beat, Group, HandoffFile, Snippet, Scene, ProjectFile, LocaleFile } from "@patterkit/model";

/** Old gameId -> new gameId, with no-ops and blanks dropped. Null when nothing is renamed. */
export function cleanRenames(renames: Record<string, string> | undefined): Map<string, string> | null {
  const out = new Map<string, string>();
  for (const [from, to] of Object.entries(renames ?? {})) if (from && to && from !== to) out.set(from, to);
  return out.size ? out : null;
}

/** Every line beat (and line-kind option prompt) in a scene, for a visitor. */
function eachLine(scene: Scene, visit: (beat: Beat & { kind: "line" }) => void): void {
  for (const block of scene.blocks) {
    walkNodes<Group | Snippet>(block.children, (node) => {
      if (node.type === "group") { if (node.prompt?.kind === "line") visit(node.prompt as Beat & { kind: "line" }); return; }
      for (const beat of node.beats ?? []) if (beat.kind === "line") visit(beat as Beat & { kind: "line" });
    });
  }
}

/** Rewrite the qualifiers of `scene`'s lines through `renames`, in place; all at once, so a swap of two
 *  gameIds lands as a swap. Returns how many lines changed. */
export function renameQualifiersInScene(scene: Scene, renames: Map<string, string>): number {
  let n = 0;
  eachLine(scene, (beat) => {
    const to = beat.qualifier !== undefined ? renames.get(beat.qualifier) : undefined;
    if (to !== undefined) { beat.qualifier = to; n++; }
  });
  return n;
}

/** Move the values of `record` keyed `qualifier:<gameId>` to their new gameIds, in place, reading every key
 *  before any moves so a swap stays a swap. True when anything moved. */
function moveQualifierKeys<T>(record: Record<string, T>, renames: Map<string, string>): boolean {
  const moved = new Map<string, T>();
  for (const [from, to] of renames) {
    const value = record[qualifierStringKey(from)];
    if (value !== undefined) moved.set(qualifierStringKey(to), value);
  }
  if (!moved.size) return false;
  for (const from of renames.keys()) delete record[qualifierStringKey(from)];
  for (const [key, value] of moved) record[key] = value;
  return true;
}

/** Move a project-level loc shard's `qualifier:<gameId>` strings to their new gameIds, in place, so a
 *  translated qualifier name follows its rename. True when anything moved. */
export function renameQualifierStrings(loc: LocaleFile, renames: Map<string, string>): boolean {
  if (loc.scene !== PROJECT_LOCALE_SCENE || !loc.strings) return false;
  return moveQualifierKeys(loc.strings, renames);
}

/** Rewrite an authoring shard's qualifier gameIds through `renames`, in place: each suggestion's proposed and
 *  baseline qualifier (so accepting one writes the new gameId, and its stale check still matches), and the
 *  edit records of translated qualifier names (`qualifier:<gameId>`, translation staleness). True when
 *  anything changed. */
export function renameQualifiersInAuthoring(af: AuthoringFile, renames: Map<string, string>): boolean {
  let changed = false;
  for (const s of af.suggestions ?? []) {
    const proposed = s.proposedQualifier ? renames.get(s.proposedQualifier) : undefined;
    const baseline = s.baselineQualifier ? renames.get(s.baselineQualifier) : undefined;
    if (proposed !== undefined) { s.proposedQualifier = proposed; changed = true; }
    if (baseline !== undefined) { s.baselineQualifier = baseline; changed = true; }
  }
  if (af.edits && moveQualifierKeys(af.edits, renames)) changed = true;
  return changed;
}

/** Rewrite a handoff record's lines' qualifier gameIds through `renames`, in place, so a reimport compares
 *  against the line as it now is. The name the cue printed is kept as it was. True when anything changed. */
export function renameQualifiersInHandoff(handoff: HandoffFile, renames: Map<string, string>): boolean {
  let changed = false;
  for (const line of Object.values(handoff.lines)) {
    const to = line.qualifier ? renames.get(line.qualifier) : undefined;
    if (to !== undefined) { line.qualifier = to; changed = true; }
  }
  return changed;
}

/** The project's qualifiers with how many lines (and line prompts) in `scenes` use each, in display order. */
export function qualifierCounts(project: Pick<ProjectFile, "qualifiers">, scenes: Scene[]): Array<{ gameId: string; name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const scene of scenes) eachLine(scene, (beat) => { if (beat.qualifier) counts.set(beat.qualifier, (counts.get(beat.qualifier) ?? 0) + 1); });
  return projectQualifiers(project).map((q) => ({ gameId: q.gameId, name: q.name, count: counts.get(q.gameId) ?? 0 }));
}

/** One line found by qualifier, in the search window's entry shape. */
export interface QualifierHit { id: string; kind: "beat"; text?: string; location: string[]; sceneId: string; file?: string }

/** Every line (and line prompt) whose qualifier is `gameId`, in document order, the `focusScene`'s first. */
export function linesWithQualifier(
  scenes: Scene[], gameId: string, strings: Record<string, string>, files: Record<string, string>, focusScene?: string,
): QualifierHit[] {
  if (!gameId) return [];
  const out: QualifierHit[] = [];
  for (const scene of scenes) {
    for (const block of scene.blocks) {
      const location = [scene.name, block.name];
      const one: Scene = { ...scene, blocks: [block] };
      eachLine(one, (beat) => {
        if (beat.qualifier !== gameId) return;
        const hit: QualifierHit = { id: beat.id, kind: "beat", location, sceneId: scene.id };
        if (strings[beat.id] !== undefined) hit.text = strings[beat.id];
        if (files[scene.id]) hit.file = files[scene.id];
        out.push(hit);
      });
    }
  }
  if (focusScene) out.sort((a, b) => (a.sceneId === focusScene ? 0 : 1) - (b.sceneId === focusScene ? 0 : 1));
  return out;
}

/** gameId -> shown name for the project's qualifiers ("" stays "", an unlisted gameId shows as itself). */
export function qualifierName(project: Pick<ProjectFile, "qualifiers">, gameId: string): string {
  if (!gameId) return "";
  return projectQualifiers(project).find((q) => q.gameId === gameId)?.name ?? gameId;
}
