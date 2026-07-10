// ---------------------------------------------------------------------------
// The localisation engine (spec §14): ONE extraction model that every export
// format (JSON / Excel / PO-POT) renders from, and one apply path that writes
// translations back. The CLI and Patterpad both call these, so the editor and
// CLI localise a project identically by construction.
//
//   extractLoc(loaded, { locale })  -> LocCatalog (read-only; the format-neutral
//                                      list every serializer renders).
//   applyLoc(loaded, catalog)       -> PlannedWrite[] (the loc shards + the
//                                      localisedAt stamps) for the caller to commit.
//
// Population mirrors report.ts's localisation set (written-line ids with source
// text), PLUS the project-level cast display names (the `@project` shard, keyed
// `cast:<NAME>`, seeded from CastMember.displayName). Localiser comments are the
// `loc`-channel documentation (resolveDocumentation(loaded, "loc")). Staleness is
// EditRecord.localisedAt vs source modifiedAt - the same rule report.ts uses.
// ---------------------------------------------------------------------------

import { basename, dirname, join, sep } from "node:path";
import { canonicalStringify } from "@patterkit/core";
import { walkNodes, castStringKey, PROJECT_LOCALE_SCENE } from "@patterkit/model";
import type { AuthoringFile, GrammaticalGender, Group, LocaleFile, Snippet } from "@patterkit/model";
import type { LoadedProject } from "./load.js";
import { tableFor, mergeAuthoring } from "./loaded-helpers.js";
import type { PlannedWrite } from "./write.js";
import { resolveDocumentation } from "./documentation.js";

/** One localisable string. `id` is the beat id (or `cast:<NAME>` for a display name). */
export interface LocEntry {
  id: string;
  /** Owning scene id, or `@project` for project-level strings (display names). */
  scene: string;
  /** The default-locale source text. */
  source: string;
  /** The target-locale text ("" when missing / a template). */
  translation: string;
  /** Localiser-channel notes for this id (DocLine text, ancestors outermost-first). */
  comments: string[];
  /** Best-effort context for the translator. `gender` is the speaker's grammatical gender, looked up
   *  from the cast - what a gendered language needs to inflect the line. Export-only: `applyLoc` never
   *  reads it back, it is regenerated from the cast on every export. */
  context?: { character?: string; kind?: string; gender?: GrammaticalGender };
  /** Translated, but the source changed since (source modifiedAt > localisedAt[locale]). */
  stale: boolean;
}

export interface LocCatalog {
  /** Project id (ProjectFile.project.id). */
  project: string;
  defaultLocale: string;
  /** The target locale this catalog carries, or undefined for a source-only TEMPLATE (POT). */
  locale?: string;
  entries: LocEntry[];
}

export interface ApplyStats {
  /** Distinct ids whose translation was written. */
  updated: number;
  /** Loc shard files touched. */
  files: number;
}


/**
 * Build the format-neutral localisation catalog. With no `locale` (or the default locale) it is a
 * TEMPLATE: every `translation` is "". Otherwise translations come from that locale's shards.
 */
export function extractLoc(loaded: LoadedProject, opts: { locale?: string } = {}): LocCatalog {
  const defaultLocale = loaded.project.locales.default;
  const isTemplate = opts.locale === undefined || opts.locale === defaultLocale;
  const targetLocale = isTemplate ? undefined : opts.locale;

  const source = tableFor(loaded, defaultLocale);
  const target = targetLocale ? tableFor(loaded, targetLocale) : {};
  const edits = mergeAuthoring(loaded).edits;
  const docs = resolveDocumentation(loaded, "loc");
  const commentsOf = (id: string): string[] => (docs.get(id) ?? []).map((d) => d.text);
  const staleFor = (id: string, translation: string): boolean => {
    if (isTemplate || !translation) return false;
    const e = edits.get(id);
    const localised = e?.localisedAt?.[targetLocale!];
    return !!(e?.modifiedAt && localised && e.modifiedAt > localised);
  };

  // A speaker's grammatical gender is translator context: a gendered language inflects the line itself.
  // Keyed on the canonical cast name, exactly as a beat's `character` names it (see voice-script.ts).
  const genderOf = new Map<string, GrammaticalGender>();
  for (const c of loaded.project.cast ?? []) if (c.gender) genderOf.set(c.name, c.gender);
  /** Stamp the speaker's gender onto a context, if we know one. Absent = not specified. */
  const withGender = (context?: LocEntry["context"]): LocEntry["context"] => {
    const g = context?.character ? genderOf.get(context.character) : undefined;
    return g ? { ...context, gender: g } : context;
  };

  const entries: LocEntry[] = [];
  const push = (id: string, scene: string, context?: LocEntry["context"]): void => {
    const src = source[id];
    if (src === undefined) return; // only strings that exist in the source language are localisable
    const translation = isTemplate ? "" : (target[id] ?? "");
    entries.push({ id, scene, source: src, translation, comments: commentsOf(id), context: withGender(context), stale: staleFor(id, translation) });
  };

  // Scene strings: line / text beats + option prompts (the same population report.ts counts).
  for (const scene of loaded.scenes) {
    for (const block of scene.blocks) {
      walkNodes<Group | Snippet>(block.children, (node) => {
        if (node.type === "group") {
          const p = node.prompt; // an option's prompt is localised content (spec §5)
          if (p) push(p.id, scene.id, { character: p.kind === "line" ? p.character : undefined, kind: p.kind });
          return;
        }
        for (const beat of node.beats ?? []) {
          if (beat.kind !== "gameEvent") push(beat.id, scene.id, { character: beat.kind === "line" ? beat.character : undefined, kind: beat.kind });
        }
      });
    }
  }

  // Project-level cast display names (the `@project` shard, seeded from displayName).
  for (const c of loaded.project.cast ?? []) {
    if (!c.displayName) continue;
    const id = castStringKey(c.name);
    const src = source[id] ?? c.displayName; // default shard if present, else the authoring displayName
    const translation = isTemplate ? "" : (target[id] ?? "");
    entries.push({ id, scene: PROJECT_LOCALE_SCENE, source: src, translation, comments: commentsOf(id), context: withGender({ character: c.name }), stale: staleFor(id, translation) });
  }

  return { project: loaded.project.project.id, defaultLocale, locale: targetLocale, entries };
}

const layoutOf = (loaded: LoadedProject): { strings: string; authoring: string } => ({
  strings: loaded.project.layout?.strings ?? "loc/",
  authoring: loaded.project.layout?.authoring ?? "authoring/",
});

/** Path of the existing (scene, locale) loc shard, or null. */
function existingLocPath(loaded: LoadedProject, scene: string, locale: string): string | null {
  for (let i = 0; i < loaded.locales.length; i++) {
    const l = loaded.locales[i]!;
    if (l.scene === scene && l.locale === locale) return loaded.localeFiles[i] ?? null;
  }
  return null;
}

/** A locale's path for a scene, derived by swapping the locale dir of the DEFAULT shard, else a default
 *  `<root>/<strings>/<locale>/<scene>.patterloc`. */
function targetLocPath(loaded: LoadedProject, scene: string, locale: string, defaultLocale: string): string {
  const existing = existingLocPath(loaded, scene, locale);
  if (existing) return existing;
  const fromDefault = existingLocPath(loaded, scene, defaultLocale);
  if (fromDefault) {
    const parts = fromDefault.split(sep);
    // Replace the LAST path segment that is the default locale (the `loc/<locale>/` dir).
    for (let i = parts.length - 2; i >= 0; i--) {
      if (parts[i] === defaultLocale) { parts[i] = locale; return parts.join(sep); }
    }
  }
  const stem = scene === PROJECT_LOCALE_SCENE ? "_project" : scene;
  return join(loaded.root, layoutOf(loaded).strings, locale, `${stem}.patterloc`);
}

/** The authoring shard path for a scene (mirrors the flow stem), or `_project.patterx` for `@project`. */
function authoringPath(loaded: LoadedProject, scene: string): string {
  const dir = join(loaded.root, layoutOf(loaded).authoring);
  if (scene === PROJECT_LOCALE_SCENE) return join(dir, "_project.patterx");
  const flow = loaded.sceneFiles[scene];
  const stem = flow ? basename(flow).replace(/\.patterflow$/, "") : scene;
  return join(dir, `${stem}.patterx`);
}

const findFile = <T>(files: string[], items: T[], path: string): T | undefined => {
  const i = files.indexOf(path);
  return i >= 0 ? items[i] : undefined;
};

/**
 * Write a catalog's translations back. Produces the loc-shard writes (one per scene touched) and stamps
 * `localisedAt[locale]` into the per-scene authoring shards (skipped when importing the default locale -
 * staleness is tracked against the source, not for it). Caller commits the returned writes.
 *
 * Import conflict policy (decision 3a): a translation is accepted even when the source has since changed;
 * the stale flag stays derivable from `localisedAt` vs source `modifiedAt` and surfaces on the next export.
 */
export function applyLoc(loaded: LoadedProject, catalog: LocCatalog, opts: { now?: string } = {}): { writes: PlannedWrite[]; stats: ApplyStats } {
  const locale = catalog.locale;
  if (!locale || locale === loaded.project.locales.default) {
    return { writes: [], stats: { updated: 0, files: 0 } }; // nothing to import into the source language
  }
  const now = opts.now ?? new Date().toISOString();

  // Group accepted translations by scene. `fresh` ids (not flagged stale) get their localisedAt
  // restamped to now; stale-flagged ids keep their text written but stay flagged for review (decision
  // 3a) - the translator clears stale by un-flagging the entry, not merely by re-submitting the file.
  const bySceneText = new Map<string, Map<string, string>>();
  const bySceneFresh = new Map<string, Set<string>>();
  for (const e of catalog.entries) {
    if (!e.translation.trim()) continue; // empty = not translated; leave any existing value untouched
    (bySceneText.get(e.scene) ?? bySceneText.set(e.scene, new Map()).get(e.scene)!).set(e.id, e.translation);
    if (!e.stale) (bySceneFresh.get(e.scene) ?? bySceneFresh.set(e.scene, new Set()).get(e.scene)!).add(e.id);
  }

  const writes: PlannedWrite[] = [];
  let updated = 0;

  for (const [scene, strings] of bySceneText) {
    // Loc shard: start from the existing (scene, locale) shard, then overlay the translations.
    const path = targetLocPath(loaded, scene, locale, loaded.project.locales.default);
    const existing = findFile<LocaleFile>(loaded.localeFiles, loaded.locales, path);
    const merged: Record<string, string> = { ...(existing?.strings ?? {}) };
    for (const [id, text] of strings) { merged[id] = text; updated++; }
    const file: LocaleFile = { schema: existing?.schema ?? "patter/strings@0", scene, locale, strings: merged };
    writes.push({ path, content: canonicalStringify(file) });

    // Authoring shard: stamp localisedAt[locale] for the FRESH ids only (staleness reconciliation).
    const fresh = bySceneFresh.get(scene);
    if (!fresh?.size) continue;
    const aPath = authoringPath(loaded, scene);
    const aExisting = findFile<AuthoringFile>(loaded.authoringFiles, loaded.authoring, aPath);
    const authoring: AuthoringFile = aExisting
      ? { ...aExisting, edits: { ...aExisting.edits } }
      : { schema: "patter/authoring@0" };
    const editsMap = { ...(authoring.edits ?? {}) };
    for (const id of fresh) editsMap[id] = { ...editsMap[id], localisedAt: { ...editsMap[id]?.localisedAt, [locale]: now } };
    authoring.edits = editsMap;
    writes.push({ path: aPath, content: canonicalStringify(authoring) });
  }

  return { writes, stats: { updated, files: bySceneText.size } };
}
