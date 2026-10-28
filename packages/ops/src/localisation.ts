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
//   actionTextChanges(loaded)       -> the text that has dropped out of the loc files
//                                      or come into them since loc import last wrote them.
//
// Action text (patterkit design/proposals/action-text.md): a dialogue scene's text beats, in a project that
// doesn't localise them (`textIsAction`), are left out of the export, and import drops any translation of
// them a shard still holds. Each translated shard import writes says whether its scene's text was action
// (`LocaleFile.textAction`), so a scene that changes kind is reported, never silent.
//
// Population mirrors report.ts's localisation set (written-line ids with source
// text), PLUS the project-level cast display names (the `@project` shard, keyed
// `cast:<NAME>`, seeded from CastMember.displayName), the speaker qualifiers' names
// (`qualifier:<gameId>`), and the speaker labels (`speaker:pattern`, and
// `speaker:<NAME>:<gameId>` for a pair a writer overrode). Localiser comments are the
// `loc`-channel documentation (resolveDocumentation(loaded, "loc")). Staleness is
// EditRecord.localisedAt vs source modifiedAt - the same rule report.ts uses.
// ---------------------------------------------------------------------------

import { basename, dirname, join, sep } from "node:path";
import { canonicalStringify } from "@patterkit/core";
import {
  walkNodes, textIsAction, castStringKey, qualifierStringKey, speakerLabelKey, usedQualifiers, usedSpeakerPairs, projectQualifiers,
  SPEAKER_PATTERN_KEY, DEFAULT_SPEAKER_PATTERN, PROJECT_LOCALE_SCENE, projectLayout, STRINGS_SCHEMA, AUTHORING_SCHEMA,
} from "@patterkit/model";
import type { AuthoringFile, GrammaticalGender, Group, LocaleFile, ProjectFile, Scene, Snippet } from "@patterkit/model";
import type { LoadedProject } from "./load.js";
import { tableFor, mergeAuthoring } from "./loaded-helpers.js";
import type { PlannedWrite } from "./write.js";
import { resolveDocumentation } from "./documentation.js";
import { INTERP_RE, MARKUP_RE } from "./script-doc.js";

/** One localisable string. `id` is the beat id (or `cast:<NAME>` for a display name, `qualifier:<gameId>` for a
 *  speaker qualifier's name, `speaker:pattern` for the speaker pattern, `speaker:<NAME>:<gameId>` for a
 *  character's own label with a qualifier). */
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
  context?: { character?: string; kind?: string; gender?: GrammaticalGender; qualifier?: string };
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
  /** Translations dropped because their beat is now action text. */
  dropped: number;
}

/** A line a translated file names that the import left alone, by its id and the scene the file put it in. */
export interface LocImportLine {
  id: string;
  scene: string;
}

/** A translation whose `{@ref}` placeholders or `<b>`/`<i>`/`<bi>` markup differ from the source's as it is now.
 *  It was imported all the same. `missing` is what the source has and the translation lacks, `extra` the reverse:
 *  each a placeholder as written (`{@gold}`) or a markup tag (`<b>`), once for each time it's short or over. */
export interface LocMismatch extends LocImportLine {
  missing: string[];
  extra: string[];
}

/** What an import found beside what it wrote: the lines it skipped because the project has no such line, and
 *  the translations it imported whose placeholders or markup don't match the source. */
export interface LocImportReport {
  unknown: LocImportLine[];
  mismatched: LocMismatch[];
}

/** A text beat whose place in the loc files has changed since loc import last wrote them: `dropped` (its scene's
 *  text is now action, so its translation goes at the next import) or `added` (no longer action, so it's sent
 *  for translation from the next export). */
export interface ActionTextChange {
  id: string;
  scene: string;
  locale: string;
  change: "dropped" | "added";
}

/** The setting's name as Patterpad shows it, and where, for the lines that explain action text to people. */
const SETTING_NAME = `"Localise text lines in dialogue scenes" (Project Settings, Language; \`localiseDialogueText\` in the project file)`;

/**
 * What a loc export tells a person beside the file, for the CLI and Patterpad alike: first, how many text lines it
 * left out because they're action, and the setting that does it, so nobody wonders where they went; then what has
 * dropped out of the loc files or come into them since loc import last wrote them (`actionTextChanges`), a heading
 * per locale and kind of change with each beat's id and scene name indented under it. Empty when the export left
 * nothing out and nothing has changed.
 */
export function describeLocExport(loaded: LoadedProject, opts: { locale?: string } = {}): string[] {
  const source = tableFor(loaded, loaded.project.locales.default);
  let lines = 0, scenes = 0;
  for (const ids of actionTextIds(loaded).values()) {
    const n = [...ids].filter((id) => source[id]).length;
    if (n) { lines += n; scenes++; }
  }
  const out: string[] = [];
  if (lines) {
    out.push(`Left out ${lines} text line${lines === 1 ? "" : "s"} in ${scenes} dialogue scene${scenes === 1 ? "" : "s"}: `
      + `${lines === 1 ? "it's" : "they're"} action, a direction for whoever stages the scene, because ${SETTING_NAME} is off. `
      + `Turn it on to translate ${lines === 1 ? "it" : "them"}.`);
  }
  return [...out, ...describeActionTextChanges(loaded, actionTextChanges(loaded, opts))];
}

/** The lines that tell a person what `actionTextChanges` found: a heading per locale and kind of change, then
 *  each beat's id and scene name. Empty when nothing has changed. */
function describeActionTextChanges(loaded: Pick<LoadedProject, "scenes">, changes: readonly ActionTextChange[]): string[] {
  const nameOf = new Map(loaded.scenes.map((sc) => [sc.id, sc.name]));
  const out: string[] = [];
  const groups = new Map<string, ActionTextChange[]>();
  for (const c of changes) {
    const key = `${c.locale}|${c.change}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(c);
  }
  for (const [key, list] of groups) {
    const [locale, change] = key.split("|") as [string, ActionTextChange["change"]];
    const n = `${list.length} text line${list.length === 1 ? "" : "s"}`;
    out.push(change === "dropped"
      ? `${n} now action, so left out of '${locale}': the next loc import drops ${list.length === 1 ? "its translation" : "their translations"} (turn on ${SETTING_NAME} to keep ${list.length === 1 ? "it" : "them"})`
      : `${n} no longer action, so new to '${locale}' and untranslated`);
    for (const c of list) out.push(`  ${c.id} in '${nameOf.get(c.scene) ?? c.scene}'`);
  }
  return out;
}

/** A scene's text beats, its option prompts left out (a prompt is always localised), in authored order. */
export function sceneTextIds(scene: Scene): string[] {
  const out: string[] = [];
  for (const block of scene.blocks) {
    walkNodes<Group | Snippet>(block.children, (node) => {
      if (node.type === "snippet") for (const beat of node.beats ?? []) if (beat.kind === "text") out.push(beat.id);
    });
  }
  return out;
}

/** Each scene's action text ids (`textIsAction`), by scene id. A scene without action text isn't listed. */
export function actionTextIds(loaded: Pick<LoadedProject, "project" | "scenes">): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const scene of loaded.scenes) if (textIsAction(loaded.project, scene)) out.set(scene.id, new Set(sceneTextIds(scene)));
  return out;
}

/**
 * The text that has dropped out of the loc files, or come into them, since loc import last wrote them, for each
 * translated locale (or the one given). Dropped: a scene's text is now action, and its shard still holds a
 * translation of it. Added: the shard says its scene's text was action (`textAction`) and it no longer is, so
 * each of its text beats with source text is new to the translators. In scene, then authored, order.
 */
export function actionTextChanges(loaded: LoadedProject, opts: { locale?: string } = {}): ActionTextChange[] {
  const defaultLocale = loaded.project.locales.default;
  const locales = opts.locale !== undefined ? (opts.locale === defaultLocale ? [] : [opts.locale]) : loaded.project.locales.all.filter((l) => l !== defaultLocale);
  const source = tableFor(loaded, defaultLocale);
  const out: ActionTextChange[] = [];
  for (const locale of locales) {
    for (const scene of loaded.scenes) {
      const path = existingLocPath(loaded, scene.id, locale);
      const shard = path ? findFile<LocaleFile>(loaded.localeFiles, loaded.locales, path) : undefined;
      if (!shard) continue;
      const action = textIsAction(loaded.project, scene);
      for (const id of sceneTextIds(scene)) {
        if (action && shard.strings[id]) out.push({ id, scene: scene.id, locale, change: "dropped" });
        else if (!action && shard.textAction && source[id]) out.push({ id, scene: scene.id, locale, change: "added" });
      }
    }
  }
  return out;
}


/**
 * The source text of every project-level string the project defines, by id: each cast display name
 * (`cast:<NAME>`), each qualifier's name (`qualifier:<gameId>`), the speaker pattern (`speaker:pattern`), and
 * each character's own label with a qualifier (`speaker:<NAME>:<gameId>`). A string's source is the default
 * locale's `@project` shard value where it has one, else what the project file authors. Not filtered by what
 * the lines use: the export picks from it, and a settings save compares it before and after to know which
 * translations a change makes stale.
 */
export function projectStringSources(project: ProjectFile, sourceTable: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (id: string, authored: string | undefined): void => { if (authored) out[id] = sourceTable[id] ?? authored; };
  for (const c of project.cast ?? []) {
    put(castStringKey(c.name), c.displayName);
    for (const [q, label] of Object.entries(c.qualifierLabels ?? {})) put(speakerLabelKey(c.name, q), label);
  }
  for (const q of projectQualifiers(project)) put(qualifierStringKey(q.gameId), q.name);
  put(SPEAKER_PATTERN_KEY, project.speakerPattern ?? DEFAULT_SPEAKER_PATTERN);
  return out;
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
  const projectSources = projectStringSources(loaded.project, source);
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

  // A line's speaker qualifier, by its shown name: read-only context (how the line is delivered), never text.
  const qualifierName = new Map(projectQualifiers(loaded.project).map((q) => [q.gameId, q.name]));
  const lineContext = (b: { kind: string; character?: string; qualifier?: string }): LocEntry["context"] => {
    const q = b.kind === "line" && b.qualifier ? qualifierName.get(b.qualifier) ?? b.qualifier : undefined;
    return { character: b.kind === "line" ? b.character : undefined, kind: b.kind, ...(q ? { qualifier: q } : {}) };
  };

  const entries: LocEntry[] = [];
  const push = (id: string, scene: string, context?: LocEntry["context"]): void => {
    const src = source[id];
    if (src === undefined) return; // only strings that exist in the source language are localisable
    const translation = isTemplate ? "" : (target[id] ?? "");
    entries.push({ id, scene, source: src, translation, comments: commentsOf(id), context: withGender(context), stale: staleFor(id, translation) });
  };

  // Scene strings: line / text beats + option prompts (the same population report.ts counts), less action text.
  for (const scene of loaded.scenes) {
    const action = textIsAction(loaded.project, scene);
    for (const block of scene.blocks) {
      walkNodes<Group | Snippet>(block.children, (node) => {
        if (node.type === "group") {
          const p = node.prompt; // an option's prompt is localised content (spec §5)
          if (p) push(p.id, scene.id, lineContext(p));
          return;
        }
        for (const beat of node.beats ?? []) {
          if (beat.kind === "gameEvent" || (action && beat.kind === "text")) continue;
          push(beat.id, scene.id, lineContext(beat));
        }
      });
    }
  }

  // Project-level cast display names (the `@project` shard, seeded from displayName).
  for (const c of loaded.project.cast ?? []) {
    if (!c.displayName) continue;
    const id = castStringKey(c.name);
    const src = projectSources[id]!; // default shard if present, else the authoring displayName
    const translation = isTemplate ? "" : (target[id] ?? "");
    entries.push({ id, scene: PROJECT_LOCALE_SCENE, source: src, translation, comments: commentsOf(id), context: withGender({ character: c.name }), stale: staleFor(id, translation) });
  }

  // Project-level speaker qualifier names (`qualifier:<gameId>`), for the qualifiers the lines use, seeded
  // from the authored name as a cast display name is from its displayName.
  for (const q of usedQualifiers(loaded.project, loaded.scenes)) {
    const id = qualifierStringKey(q.gameId);
    const src = projectSources[id] ?? q.name;
    const translation = isTemplate ? "" : (target[id] ?? "");
    entries.push({ id, scene: PROJECT_LOCALE_SCENE, source: src, translation, comments: commentsOf(id), context: { kind: "qualifier" }, stale: staleFor(id, translation) });
  }

  // Speaker labels, only when a line has a speaker with a qualifier. The pattern (`speaker:pattern`) builds
  // every qualified speaker's label, so a language changes its order or punctuation once; seeded from the
  // project's own, else the default. A pair's own label (`speaker:<NAME>:<gameId>`) is a string only where a
  // writer overrode it and a line uses it: every other pair follows the pattern.
  const pairs = usedSpeakerPairs(loaded.scenes);
  if (pairs.length > 0) {
    const id = SPEAKER_PATTERN_KEY;
    const src = projectSources[id]!;
    const translation = isTemplate ? "" : (target[id] ?? "");
    entries.push({ id, scene: PROJECT_LOCALE_SCENE, source: src, translation, comments: [SPEAKER_PATTERN_NOTE, ...commentsOf(id)], context: { kind: "speaker pattern" }, stale: staleFor(id, translation) });
    const labelsOf = new Map((loaded.project.cast ?? []).map((c) => [c.name, c.qualifierLabels]));
    for (const p of pairs) {
      const label = labelsOf.get(p.character)?.[p.qualifier];
      if (!label) continue;
      const pid = speakerLabelKey(p.character, p.qualifier);
      const psrc = projectSources[pid] ?? label;
      const ptranslation = isTemplate ? "" : (target[pid] ?? "");
      const qualifier = qualifierName.get(p.qualifier) ?? p.qualifier;
      entries.push({ id: pid, scene: PROJECT_LOCALE_SCENE, source: psrc, translation: ptranslation, comments: commentsOf(pid), context: withGender({ character: p.character, kind: "speaker", qualifier }), stale: staleFor(pid, ptranslation) });
    }
  }

  return { project: loaded.project.project.id, defaultLocale, locale: targetLocale, entries };
}

/** The translator's note on the speaker pattern: its placeholders are filled in, never translated. */
export const SPEAKER_PATTERN_NOTE =
  "{name} and {qualifier} are filled in with the speaker's name and the qualifier, so keep both as they are. You can put them in any order.";

const layoutOf = (loaded: LoadedProject): { strings: string; authoring: string } => projectLayout(loaded.project);

/** Path of the existing (scene, locale) loc shard, or null. */
export function existingLocPath(loaded: LoadedProject, scene: string, locale: string): string | null {
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
export function authoringPath(loaded: LoadedProject, scene: string): string {
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

/** Every line id the project has, by the scene that holds it: each scene's beats (game events left out, as they
 *  carry no text) and option prompts, and the project-level strings (`@project`). What an import checks a
 *  translated file's ids against. */
export function locLineHomes(loaded: Pick<LoadedProject, "project" | "scenes">, sourceTable: Record<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const scene of loaded.scenes) {
    for (const block of scene.blocks) {
      walkNodes<Group | Snippet>(block.children, (node) => {
        if (node.type === "group") { if (node.prompt) out.set(node.prompt.id, scene.id); return; }
        for (const beat of node.beats ?? []) if (beat.kind !== "gameEvent") out.set(beat.id, scene.id);
      });
    }
  }
  for (const id of Object.keys(projectStringSources(loaded.project, sourceTable))) out.set(id, PROJECT_LOCALE_SCENE);
  return out;
}

/** The `{@ref}` placeholders and markup tags in a text, each as written, in order (`<b>` for a `<b>...</b>` pair). */
function textTokens(text: string): string[] {
  const out = [...text.matchAll(INTERP_RE)].map((m) => m[0]);
  for (const m of text.matchAll(MARKUP_RE)) out.push(`<${m[1]}>`);
  return out;
}

/** What `source` has that `translation` lacks (`missing`) and the reverse (`extra`), as multisets, sorted. Null
 *  when they match. */
export function compareLocTokens(source: string, translation: string): { missing: string[]; extra: string[] } | null {
  const count = (list: string[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const t of list) m.set(t, (m.get(t) ?? 0) + 1);
    return m;
  };
  const a = count(textTokens(source)), b = count(textTokens(translation));
  const short = (x: Map<string, number>, y: Map<string, number>): string[] =>
    [...x].flatMap(([t, n]) => Array<string>(Math.max(0, n - (y.get(t) ?? 0))).fill(t)).sort();
  const missing = short(a, b), extra = short(b, a);
  return missing.length || extra.length ? { missing, extra } : null;
}

/** The language a translated file is imported as, from what the file says (`fileLocale`) and what the person
 *  chose (`chosen`: the CLI's `--locale`, Patterpad's Language). A file for one language is refused as another
 *  unless `force` (the CLI's `--force-locale`); a file that names none (an older spreadsheet) takes the chosen
 *  language, with a warning; with neither there's nothing to go on. */
export function importLocale(fileLocale: string | undefined, chosen: string | undefined, opts: { force?: boolean } = {}):
  { ok: true; locale: string; warning?: string } | { ok: false; reason: "none" | "mismatch"; error: string } {
  if (fileLocale && chosen && fileLocale !== chosen && !opts.force) {
    return { ok: false, reason: "mismatch", error: `This file is for '${fileLocale}', not '${chosen}', so nothing was imported.` };
  }
  const locale = chosen ?? fileLocale;
  if (!locale) return { ok: false, reason: "none", error: "This file doesn't say which language it's for, so nothing was imported." };
  if (!fileLocale) return { ok: true, locale, warning: `This file doesn't say which language it's for, so it was imported as '${locale}'. Check that's the right language.` };
  return { ok: true, locale };
}

/** What a loc import tells a person beside its counts, for the CLI and Patterpad alike: the lines it skipped
 *  because the project doesn't have them, then the translations it imported whose placeholders or markup don't
 *  match the source, each with a heading and the lines indented under it. Empty when there's nothing to say. */
export function describeLocImport(loaded: Pick<LoadedProject, "scenes">, report: LocImportReport): string[] {
  const nameOf = new Map(loaded.scenes.map((sc) => [sc.id, sc.name]));
  const where = (scene: string): string => (scene === PROJECT_LOCALE_SCENE ? "the project's strings" : `'${nameOf.get(scene) ?? scene}'`);
  const out: string[] = [];
  const u = report.unknown.length;
  if (u) {
    out.push(`Skipped ${u} line${u === 1 ? "" : "s"} this project doesn't have, so ${u === 1 ? "its translation wasn't" : "their translations weren't"} imported:`);
    for (const l of report.unknown) out.push(`  ${l.id} in ${where(l.scene)}`);
  }
  const m = report.mismatched.length;
  if (m) {
    out.push(`${m} translation${m === 1 ? "" : "s"} ${m === 1 ? "doesn't" : "don't"} match the source's placeholders or formatting. ${m === 1 ? "It was" : "They were"} imported, but check ${m === 1 ? "it" : "them"}:`);
    for (const l of report.mismatched) {
      const parts = [l.missing.length ? `missing ${l.missing.join(", ")}` : "", l.extra.length ? `extra ${l.extra.join(", ")}` : ""].filter(Boolean);
      out.push(`  ${l.id} in ${where(l.scene)}: ${parts.join("; ")}`);
    }
  }
  return out;
}

/**
 * Write a catalog's translations back. Throws, writing nothing, when the catalogue names a locale the
 * project does not declare or a scene it does not have. Produces the loc-shard writes (one per scene touched) and stamps
 * `localisedAt[locale]` into the per-scene authoring shards (skipped when importing the default locale -
 * staleness is tracked against the source, not for it). Caller commits the returned writes.
 *
 * A line the project doesn't have is skipped (not written, counted or stamped) and listed in the report; a line
 * the file puts in another scene than the one holding it now goes to its own scene. A translation whose
 * placeholders or markup differ from the source as it is now is imported and listed (the 2026-10-28 rulings).
 *
 * Import conflict policy (decision 3a): a translation is accepted even when the source has since changed;
 * the stale flag stays derivable from `localisedAt` vs source `modifiedAt` and surfaces on the next export.
 */
export function applyLoc(loaded: LoadedProject, catalog: LocCatalog, opts: { now?: string } = {}): { writes: PlannedWrite[]; stats: ApplyStats; report: LocImportReport } {
  const report: LocImportReport = { unknown: [], mismatched: [] };
  const locale = catalog.locale;
  if (!locale || locale === loaded.project.locales.default) {
    return { writes: [], stats: { updated: 0, files: 0, dropped: 0 }, report }; // nothing to import into the source language
  }
  // The catalogue is a file from outside (a translator, a vendor), and the target paths are built from
  // its own scene and locale names: refuse any the project does not have before planning a write, or a
  // scene of `../../x` writes outside the project and an unknown one gets a shard nothing reads.
  if (!loaded.project.locales.all.includes(locale)) {
    throw new Error(`'${locale}' is not one of the project's languages (${loaded.project.locales.all.join(", ")}); add it to the project first`);
  }
  const known = new Set([...loaded.scenes.map((sc) => sc.id), PROJECT_LOCALE_SCENE]);
  const unknown = [...new Set(catalog.entries.filter((e) => e.translation.trim() && !known.has(e.scene)).map((e) => e.scene))];
  if (unknown.length) {
    throw new Error(`the file names scene(s) this project does not have: ${unknown.map((u) => `'${u}'`).join(", ")}; nothing was imported`);
  }
  const now = opts.now ?? new Date().toISOString();
  const sourceTable = tableFor(loaded, loaded.project.locales.default);
  const projectSources = projectStringSources(loaded.project, sourceTable);
  const homes = locLineHomes(loaded, sourceTable);

  // Group accepted translations by scene. `fresh` ids (not flagged stale) get their localisedAt
  // restamped to now; stale-flagged ids keep their text written but stay flagged for review (decision
  // 3a) - the translator clears stale by un-flagging the entry, not merely by re-submitting the file.
  const action = actionTextIds(loaded);
  const bySceneText = new Map<string, Map<string, string>>();
  const bySceneFresh = new Map<string, Set<string>>();
  for (const e of catalog.entries) {
    if (!e.translation.trim()) continue; // empty = not translated; leave any existing value untouched
    const scene = homes.get(e.id);
    if (scene === undefined) { report.unknown.push({ id: e.id, scene: e.scene }); continue; } // no such line: skipped, listed
    if (action.get(scene)?.has(e.id)) continue; // action text has no translations (an older file may hold one)
    const source = sourceTable[e.id] ?? projectSources[e.id];
    const diff = source === undefined ? null : compareLocTokens(source, e.translation);
    if (diff) report.mismatched.push({ id: e.id, scene, ...diff });
    (bySceneText.get(scene) ?? bySceneText.set(scene, new Map()).get(scene)!).set(e.id, e.translation);
    if (!e.stale) (bySceneFresh.get(scene) ?? bySceneFresh.set(scene, new Set()).get(scene)!).add(e.id);
  }

  const writes: PlannedWrite[] = [];
  let updated = 0;
  let dropped = 0;
  let files = 0;

  // Every scene the file translates, and every scene with a shard in this locale already, which may need its
  // action text dropped or its `textAction` mark brought up to date.
  const scenes = new Set<string>(bySceneText.keys());
  for (const l of loaded.locales) if (l.locale === locale && l.scene !== PROJECT_LOCALE_SCENE && known.has(l.scene)) scenes.add(l.scene);
  for (const scene of scenes) {
    const strings = bySceneText.get(scene) ?? new Map<string, string>();
    // Loc shard: start from the existing (scene, locale) shard, then overlay the translations.
    const path = targetLocPath(loaded, scene, locale, loaded.project.locales.default);
    const existing = findFile<LocaleFile>(loaded.localeFiles, loaded.locales, path);
    const merged: Record<string, string> = { ...(existing?.strings ?? {}) };
    // Count only strings whose translation actually CHANGED (not every string in the sheet), so a
    // re-import of an unedited file honestly reads "0 updated" instead of "N updated".
    for (const [id, text] of strings) { if (merged[id] !== text) updated++; merged[id] = text; }
    const actionIds = action.get(scene);
    for (const id of actionIds ?? []) if (id in merged) { delete merged[id]; dropped++; }
    const file: LocaleFile = {
      schema: existing?.schema ?? STRINGS_SCHEMA, scene, locale, ...(actionIds ? { textAction: true as const } : {}), strings: merged,
    };
    const content = canonicalStringify(file);
    if (!existing || strings.size > 0 || canonicalStringify(existing) !== content) {
      writes.push({ path, content });
      files++;
    }

    // Authoring shard: stamp localisedAt[locale] for the FRESH ids only (staleness reconciliation).
    const fresh = bySceneFresh.get(scene);
    if (!fresh?.size) continue;
    const aPath = authoringPath(loaded, scene);
    const aExisting = findFile<AuthoringFile>(loaded.authoringFiles, loaded.authoring, aPath);
    const authoring: AuthoringFile = aExisting
      ? { ...aExisting, edits: { ...aExisting.edits } }
      : { schema: AUTHORING_SCHEMA };
    const editsMap = { ...(authoring.edits ?? {}) };
    for (const id of fresh) editsMap[id] = { ...editsMap[id], localisedAt: { ...editsMap[id]?.localisedAt, [locale]: now } };
    authoring.edits = editsMap;
    writes.push({ path: aPath, content: canonicalStringify(authoring) });
  }

  return { writes, stats: { updated, files, dropped }, report };
}
