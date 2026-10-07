// ---------------------------------------------------------------------------
// Project-wide find-and-replace over the SOURCE-language prose (spec §6/§13).
// The counterpart to runSearch: where search navigates, replace rewrites.
//
// Scope is deliberately narrow: only the localisable text a line / narration /
// choice prompt carries, which lives in the default-locale `.patterloc` shards.
// It NEVER touches opaque ids (immutable join keys), Game IDs / scene+block
// names (addresses, edited elsewhere), condition / effect expressions, or the
// `@project` cast-display-name table. Translations stay in their own shards and
// round-trip through the localisation tools, not here.
//
// Pure: it indexes the loaded project and returns the matched hits (for a
// preview / confirm) PLUS the planned shard writes + the rewritten shard objects
// (so the caller can both commit to disk and refresh its in-memory model). The
// caller commits the writes through the VC layer.
//
// A replaced string is a source edit like any other, so each one gets a fresh
// `edits[id].modifiedAt` in its scene's authoring shard, as accepting a suggestion
// and Patterpad's save both stamp it. That stamp is what makes a translation of the
// line go stale; without it a replace changed the source and every translation
// still read as current.
// ---------------------------------------------------------------------------

import { canonicalStringify } from "@patterkit/core";
import { walkNodes, PROJECT_LOCALE_SCENE, AUTHORING_SCHEMA } from "@patterkit/model";
import type { Group, Snippet, LocaleFile, AuthoringFile } from "@patterkit/model";
import type { LoadedProject } from "./load.js";
import type { PlannedWrite } from "./write.js";
import { authoringPath } from "./localisation.js";
import { findMatcher } from "@wildwinter/toolkit";   // the escaped, global find regex

export interface ReplaceOptions {
  /** The literal text to find (not a regex: special characters match themselves). */
  query: string;
  /** The literal replacement text. */
  replacement: string;
  /** Match case (default off). */
  caseSensitive?: boolean;
  /** Match whole words only (word boundaries around the query; default off). */
  wholeWord?: boolean;
  /** Restrict the replacement to a single beat id (the per-row "Replace this one"). */
  onlyId?: string;
  /** The time stamped as each replaced string's `modifiedAt` (ISO 8601; default now). For tests. */
  now?: string;
}

/** One replaced string, for the preview / confirm list. */
export interface ReplaceHit {
  id: string;
  sceneId: string;
  /** Scene › block breadcrumb. */
  location: string[];
  before: string;
  after: string;
}

export interface ReplacePlan {
  hits: ReplaceHit[];
  /** Shard writes the caller commits through the VC layer: the string shards (one per touched scene) first,
   *  then the authoring shards that carry their `modifiedAt` stamps (one per touched scene). */
  writes: PlannedWrite[];
  /** The rewritten string shard objects (index-aligned with the first `shards.length` of `writes`), so the
   *  caller can swap them into its in-memory `LoadedProject.locales` after committing: keeping reads + the
   *  open scene current. */
  shards: LocaleFile[];
  /** The stamped authoring shards (the rest of `writes`, in order), for the caller to swap into its
   *  in-memory `LoadedProject.authoring` after committing, so a later edit builds on the stamps. */
  authoring: Array<{ path: string; file: AuthoringFile }>;
  /** Distinct scenes touched. */
  scenes: number;
}



/**
 * Plan a project-wide replacement. Walks the default-locale string shards (the source prose), substitutes
 * matches, and returns the hits + the shard writes. With `onlyId`, only that one beat's string is touched.
 */
export function runReplace(loaded: LoadedProject, opts: ReplaceOptions): ReplacePlan {
  const plan: ReplacePlan = { hits: [], writes: [], shards: [], authoring: [], scenes: 0 };
  const re = findMatcher(opts);
  if (!re) return plan;
  const def = loaded.project.locales.default;
  const now = opts.now ?? new Date().toISOString();
  const stamped = new Map<string, AuthoringFile>(); // authoring path -> the stamped copy

  // id -> [scene name, block name] for the preview breadcrumb; scene id -> scene name for the fallback.
  const locOf = new Map<string, string[]>();
  const sceneName = new Map<string, string>();
  for (const scene of loaded.scenes) {
    sceneName.set(scene.id, scene.name);
    for (const block of scene.blocks) {
      const segs = [scene.name, block.name];
      walkNodes<Group | Snippet>(block.children, (node) => {
        if (node.type === "group") { if (node.prompt) locOf.set(node.prompt.id, segs); return; }
        for (const b of node.beats ?? []) locOf.set(b.id, segs);
      });
    }
  }

  for (let i = 0; i < loaded.locales.length; i++) {
    const shard = loaded.locales[i]!;
    // Source prose only: the default locale, and never the @project display-name table.
    if (shard.locale !== def || shard.scene === PROJECT_LOCALE_SCENE) continue;
    const path = loaded.localeFiles[i];
    if (!path) continue;

    const changedIds: string[] = [];
    const merged: Record<string, string> = { ...shard.strings };
    for (const [id, before] of Object.entries(shard.strings)) {
      if (opts.onlyId && id !== opts.onlyId) continue;
      re.lastIndex = 0;
      if (!re.test(before)) continue;
      const after = before.replace(re, () => opts.replacement); // function form → replacement is literal ($ safe)
      if (after === before) continue;
      plan.hits.push({ id, sceneId: shard.scene, location: locOf.get(id) ?? [sceneName.get(shard.scene) ?? shard.scene], before, after });
      merged[id] = after;
      changedIds.push(id);
    }
    if (changedIds.length) {
      const next: LocaleFile = { ...shard, strings: merged };
      plan.writes.push({ path, content: canonicalStringify(next) });
      plan.shards.push(next);
      plan.scenes++;
      // The per-string stamp, merged over the scene's authoring shard (a copy: `loaded` stays untouched).
      // Keyed by path, so two string shards for one scene still make one authoring write holding both.
      const aPath = authoringPath(loaded, shard.scene);
      let af = stamped.get(aPath);
      if (!af) {
        const ai = loaded.authoringFiles.indexOf(aPath);
        af = ai >= 0 ? structuredClone(loaded.authoring[ai]!) : { schema: AUTHORING_SCHEMA };
        stamped.set(aPath, af);
      }
      const edits = { ...af.edits };
      for (const id of changedIds) edits[id] = { ...edits[id], modifiedAt: now };
      af.edits = edits;
    }
  }
  // String shards first, then the stamps, so `shards` stays index-aligned with the head of `writes`.
  for (const [path, file] of stamped) {
    plan.authoring.push({ path, file });
    plan.writes.push({ path, content: canonicalStringify(file) });
  }
  return plan;
}
