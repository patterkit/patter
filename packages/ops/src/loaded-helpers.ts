// Shared read-helpers over a LoadedProject: the locale string tables and the flattened authoring shards.
// Strings live in ONE loc shard PER SCENE and authoring is ONE .patterx PER SCENE, so several ops used to
// hand-roll the same "merge every shard" loop - a latent home for the per-scene-shard merge bug (a single
// `.find()` would only see the first scene). These are the one place that merge happens.

import type { LoadedProject } from "./load.js";
import type { DocLine, EditRecord } from "@patterkit/model";
import { RERECORD_STATUS } from "@patterkit/model";

/** The effective recording status of a dialogue line: the reserved `rerecord` status when the line is
 *  flagged needs-re-record (it masks everything, so a "recorded" take still reads as work), else the
 *  folder-derived / manual rung, else the lowest ("missing") rung. Shared by the recording script, the
 *  production report, and status browse so all three agree with the inspector (#227). */
export function effectiveRecording(id: string, base: Map<string, string>, rerecord: Set<string>, lowest: string): string {
  return rerecord.has(id) ? RERECORD_STATUS : (base.get(id) ?? lowest);
}

/** Merge every shard of one locale into a single id -> text table (strings are one shard per scene). */
export function tableFor(loaded: LoadedProject, locale: string): Record<string, string> {
  const table: Record<string, string> = {};
  for (const l of loaded.locales) if (l.locale === locale) Object.assign(table, l.strings);
  return table;
}

/** The SOURCE (default-locale) string table - the most-used `tableFor`. */
export function sourceStrings(loaded: LoadedProject): Record<string, string> {
  return tableFor(loaded, loaded.project.locales.default);
}

/** Resolve where a flow starts: an explicit override, else the project's authored `start`, else `{}`
 *  (the runtime's first-scene default). Shared by `runPlay` and `runCoverage`. */
export function resolveStart(
  loaded: LoadedProject,
  override?: { scene?: string; block?: string },
): { scene?: string; block?: string } {
  if (override?.scene) return { scene: override.scene, block: override.block };
  if (loaded.project.start) return { scene: loaded.project.start.scene, block: loaded.project.start.block };
  return {};
}

/** Every locale's merged table (locale -> id -> text), for ops that report across all locales. */
export function stringsByLocale(loaded: LoadedProject): Map<string, Record<string, string>> {
  const byLocale = new Map<string, Record<string, string>>();
  for (const l of loaded.locales) {
    const table = byLocale.get(l.locale) ?? {};
    Object.assign(table, l.strings);
    byLocale.set(l.locale, table);
  }
  return byLocale;
}

/** The per-scene authoring shards, flattened to project-wide lookups (every beat / scene id is unique). */
export interface MergedAuthoring {
  /** beat id -> writing-status rung (last shard wins). */
  writing: Map<string, string>;
  /** beat id -> recording-status rung (last shard wins). */
  recording: Map<string, string>;
  /** ids flagged cut (union across shards). */
  cut: Set<string>;
  /** dialogue-line ids flagged "needs re-record" (union across shards) - masks recording status. */
  rerecord: Set<string>;
  /** node/scene id -> its documentation notes (CONCATENATED across shards). */
  documentation: Map<string, DocLine[]>;
  /** scene id -> edit-trail record (last shard wins). */
  edits: Map<string, EditRecord>;
}

/** Flatten `loaded.authoring` once into the project-wide lookups every report / export op needs. */
export function mergeAuthoring(loaded: LoadedProject): MergedAuthoring {
  const writing = new Map<string, string>();
  const recording = new Map<string, string>();
  const cut = new Set<string>();
  const rerecord = new Set<string>();
  const documentation = new Map<string, DocLine[]>();
  const edits = new Map<string, EditRecord>();
  for (const a of loaded.authoring) {
    for (const [id, v] of Object.entries(a.writing ?? {})) writing.set(id, v);
    for (const [id, v] of Object.entries(a.recording ?? {})) recording.set(id, v);
    for (const [id, v] of Object.entries(a.cut ?? {})) if (v) cut.add(id);
    for (const [id, v] of Object.entries(a.rerecord ?? {})) if (v) rerecord.add(id);
    for (const [id, lines] of Object.entries(a.documentation ?? {})) {
      const cur = documentation.get(id);
      if (cur) cur.push(...lines); else documentation.set(id, [...lines]);
    }
    for (const [id, v] of Object.entries(a.edits ?? {})) edits.set(id, v);
  }
  return { writing, recording, cut, rerecord, documentation, edits };
}
