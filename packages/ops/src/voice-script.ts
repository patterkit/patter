// ---------------------------------------------------------------------------
// Voice (VO) script export (spec §16): the industry-standard recording deliverable -
// one row per SPOKEN line (a `line` beat), with enough structure that a director /
// actor can tell when lines run together (a snippet) vs branch. Pure data out; the
// xlsx renderer (voice-script-xlsx.ts) is a view, like report / loc.
//
//   - VOICED lines only (line beats). By default only lines at/past the writing
//     ladder's `readyToRecord` threshold; `everything: true` emits them all.
//   - Each row carries its SCOPE (a readable container trail) so a flat sheet still
//     reads as structured, and a COMMENTS column: the line's own `vo` notes, plus -
//     on the FIRST line of a run - the enclosing group / option's `vo` notes
//     prepended (so the actor sees which option / beat this is).
//   - Status = the line's RECORDING status (missing / scratch / recorded / final).
// ---------------------------------------------------------------------------

import { DEFAULT_WRITING_STATUSES, DEFAULT_RECORDING_STATUSES, DEFAULT_DOCUMENTATION_CLASSES } from "@patterkit/model";
import type { Block, Group, Snippet } from "@patterkit/model";
import { sourceStrings, mergeAuthoring, effectiveRecording } from "./loaded-helpers.js";
import { classesForChannel } from "./documentation.js";
import type { LoadedProject } from "./load.js";

export interface VoiceLine {
  /** Readable container trail (`Scene › Block › Option`) - the scope changes signal a new run / branch. */
  scope: string;
  /** The line beat's id (recordings / filenames key to this). */
  id: string;
  /** The canonical speaker token. */
  character: string;
  /** The cast member's voice actor, if known. */
  actor?: string;
  /** The line's source-locale text. */
  text: string;
  /** `vo` notes: the line's own, plus the enclosing group/option's on the first line of a run. */
  comments: string[];
  /** The line's recording-ladder status (the "voice status"). */
  recordingStatus: string;
}

export interface VoiceScript {
  project: string;
  voiced: boolean;
  recordingLadder: string[];
  /** True when the filter was bypassed (every voiced line, not just ready-to-record). */
  everything: boolean;
  lines: VoiceLine[];
}

/** Voice lines are plain text for the booth - drop the inline formatting vocabulary (<b>/<i>/<bi>) and
 *  decode any legacy entity-escaping so the actor never reads markup. (The game still gets the tags.) */
function plainVoice(text: string): string {
  return text
    .replace(/<\/?(?:b|i|bi)>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** A readable label for a group in the scope trail: an option shows its prompt text; a branch / sequence
 *  shows its role. A `choice` group adds nothing - the option labels that follow already convey it ("" =
 *  omitted from the scope). */
function groupLabel(node: Group, source: Record<string, string>): string {
  if (node.prompt) return plainVoice(source[node.prompt.id]?.trim() || "option");
  if (node.selector === "choice") return "";
  return node.selector ?? "group";
}

/** Compute the production VO script. Pure: data out, no I/O. `recordingOverride` replaces the
 *  manual recording map with status derived from files on disk (#206 Audio Folders) - the same
 *  contract as `runReport`, so the script agrees with the report and the inspector. */
export function runVoiceScript(loaded: LoadedProject, opts: { everything?: boolean; recordingOverride?: Map<string, string> } = {}): VoiceScript {
  const { project } = loaded;
  const everything = !!opts.everything;
  const ladderDecls = project.writingStatuses ?? DEFAULT_WRITING_STATUSES;
  const writingLadder = ladderDecls.map((s) => s.name);
  const recordingLadder = (project.recordingStatuses ?? DEFAULT_RECORDING_STATUSES).map((s) => s.name);
  const stub = writingLadder[0]!;
  const recordThreshold = ladderDecls.findIndex((s) => s.readyToRecord);
  const writingIndex = new Map(writingLadder.map((name, i) => [name, i]));

  // Merge authoring shards: writing / recording status, cut set, re-record flags, and per-node documentation.
  const { writing: writingOf, recording: manualRecordingOf, cut: cutSet, rerecord: rerecordSet, documentation: docsOf } = mergeAuthoring(loaded);
  // An Audio Folders project derives status from the takes on disk, not the manual map (#206). Either way a
  // line flagged "needs re-record" (#227) masks to the reserved `rerecord` status, so the session redoes it.
  const recordingBase = opts.recordingOverride ?? manualRecordingOf;
  const recordingOf = (id: string): string => effectiveRecording(id, recordingBase, rerecordSet, recordingLadder[0]!);

  // Source text (default locale) + cast actors.
  const source = sourceStrings(loaded);
  const actorOf = new Map<string, string>();
  for (const c of project.cast ?? []) if (c.actor) actorOf.set(c.name, c.actor);

  // `vo`-channel classes - the documentation that flows to the voice script (own notes only here; the
  // run-leading prepend gives ancestor context, matching the editor's under-heading surfacing).
  const voClasses = classesForChannel(project.documentationClasses ?? DEFAULT_DOCUMENTATION_CLASSES, "vo");
  const ownVo = (id: string): string[] => (docsOf.get(id) ?? []).filter((d) => d.type !== undefined && voClasses.has(d.type)).map((d) => d.text);

  const lines: VoiceLine[] = [];

  const walkNode = (node: Group | Snippet, scope: string[], ancestorVo: string[]): void => {
    if (node.type === "group") {
      if (cutSet.has(node.id)) return; // a cut branch is excluded wholesale
      const label = groupLabel(node, source);
      const childScope = label ? [...scope, label] : scope; // a `choice` adds nothing - its options do
      const childVo = [...ancestorVo, ...ownVo(node.id)];
      for (const child of node.children ?? []) walkNode(child as Group | Snippet, childScope, childVo);
      return;
    }
    // snippet (a "run"): its line beats record in order; the first emitted line carries the run context.
    if (cutSet.has(node.id)) return;
    let leading = true;
    for (const beat of node.beats ?? []) {
      if (beat.kind !== "line" || cutSet.has(beat.id)) continue;
      const ws = writingOf.get(beat.id) ?? stub;
      if (!everything && recordThreshold !== -1 && (writingIndex.get(ws) ?? 0) < recordThreshold) continue; // not ready to record
      const own = ownVo(beat.id);
      lines.push({
        scope: scope.join(" › "),
        id: beat.id,
        character: beat.character ?? "",
        actor: beat.character ? actorOf.get(beat.character) : undefined,
        text: plainVoice(source[beat.id] ?? ""),
        comments: leading ? [...ancestorVo, ...own] : own, // first line of the run gets the enclosing context
        recordingStatus: recordingOf(beat.id),
      });
      leading = false;
    }
  };

  for (const scene of loaded.scenes) {
    if (cutSet.has(scene.id)) continue;
    const sceneVo = ownVo(scene.id);
    for (const block of scene.blocks as Block[]) {
      if (cutSet.has(block.id)) continue;
      const scope = [scene.name, block.name].filter(Boolean) as string[];
      const blockVo = [...sceneVo, ...ownVo(block.id)];
      for (const child of block.children ?? []) walkNode(child as Group | Snippet, scope, blockVo);
    }
  }

  return { project: project.project.id, voiced: project.voiced ?? false, recordingLadder, everything, lines };
}
