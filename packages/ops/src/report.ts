// ---------------------------------------------------------------------------
// The report op (spec §13 "Production reporting"): how done is the narrative?
//
// ONE engine computes a structured ReportData from content + authoring
// metadata; the CLI, Patterpad's dashboard, and any other front-end are all
// VIEWS of this data, never separate computations. Renderers: `renderReportText` (console)
// here, `runReportXlsx` (the producer spreadsheet) in report-xlsx.ts.
//
// Two line populations (spec §13):
//   - VOICED lines  = line beats (spoken). Carry writing + RECORDING status.
//   - WRITTEN lines = the superset: voiced + text (narration) + choice labels.
//     The localisation deliverable; recording never applies.
// Statuses are per BEAT against the ordered ladders; the FIRST status ("stub")
// is the absence/level-0 - nothing is inferred from content. Aggregation is
// derived here, never stored.
//
// Scene status (always, needs only a writing ladder): a scene's status is its
// LOWEST-rung status-tracked beat (its weakest link); unset counts as the lowest
// rung, game-events are ignored.
//
// Estimating (opt-in, Project Settings -> Estimating; design/proposals/estimating.md):
// when ON, a scene whose EVERY status-tracked beat is at/below the threshold rung is
// treated as guesswork - its actual (placeholder) line count is REPLACED by an estimate
// (largest matching tag, else the default), shared across the characters in its
// placeholder lines (proportional, largest-remainder). Estimated scenes are excluded
// from the actuals snapshot and contribute only their estimate to the burndown. When
// OFF, no estimate appears anywhere. Cut content is excluded everywhere and surfaced
// separately.
// ---------------------------------------------------------------------------

import { walkNodes, DEFAULT_WRITING_STATUSES, DEFAULT_RECORDING_STATUSES } from "@patterkit/model";
import type { Group, Snippet, EditRecord } from "@patterkit/model";
import type { LoadedProject } from "./load.js";
import { stringsByLocale, mergeAuthoring } from "./loaded-helpers.js";

/** Fallback words-per-line for deriving an estimated scene's word count when the project has no real
 *  written lines yet to average from. */
const DEFAULT_WORDS_PER_LINE = 6;
/** The bucket key for the share of an estimate that falls on narration / character-less lines. */
const UNATTRIBUTED = "(unattributed)";

/** Counts for the WRITTEN population (line + text + label beats). */
export interface WrittenCounts {
  count: number;
  words: number;
  byWriting: Record<string, number>;
}
/** Counts for the VOICED population (line beats only) - adds recording + readiness. */
export interface VoicedCounts extends WrittenCounts {
  byRecording: Record<string, number>;
  readyToRecord: number;
  readyToShip: number;
}

export interface SceneReport {
  sceneId: string;
  name: string;
  file?: string;
  /** The scene's writing status: its LOWEST-rung status-tracked beat. Absent when it has no such beats. */
  status?: string;
  /** True when this scene is guesswork-estimated (its actuals are replaced by `estimate`). */
  estimated: boolean;
  choices: number;
  /** Actual VOICED counts. Empty (zeroed) for an estimated scene - its numbers come from the estimate. */
  voiced: VoicedCounts;
  /** Actual WRITTEN counts. Empty for an estimated scene. */
  written: WrittenCounts;
  /** The scene's estimate in written lines, when `estimated`. */
  estimate?: number;
  /** Written / voiced lines DONE and REMAINING. For an estimated scene: 0 done, the estimate remaining. */
  writtenDone: number;
  writtenRemaining: number;
  voicedDone: number;
  voicedRemaining: number;
}

export interface CharacterReport {
  character: string;
  /** Actual (authored, non-estimated) spoken lines. */
  lines: number;
  words: number;
  /** Lines projected onto this character by estimated scenes (their share of those scenes' estimates). */
  estimatedLines: number;
  recording: Record<string, number>;
}

export interface LocaleReport {
  locale: string;
  translated: number;
  missing: number;
  /** Translated but the source changed since (source modifiedAt > localisedAt). */
  stale: number;
  words: number;
}

export interface ReportTotals {
  voiced: VoicedCounts;
  written: WrittenCounts;
  choices: number;
  writtenDone: number;
  writtenRemaining: number;
  voicedDone: number;
  voicedRemaining: number;
  /** writtenDone + writtenRemaining (built scenes + estimated scenes' estimates). */
  projectedWritten: number;
  projectedVoiced: number;
}

export interface ReportData {
  project: { id: string; name: string };
  voiced: boolean;
  /** Whether audio/recording status is tracked (#206): a voiced project that hasn't opted out via
   *  `trackAudioStatus`. Gates the recording-status breakdown in every renderer (text / xlsx / view). */
  recordingTracked: boolean;
  writingLadder: string[];
  recordingLadder: string[];
  scenes: SceneReport[];
  characters: CharacterReport[];
  locales: LocaleReport[];
  /** Cut content (excluded from everything above), surfaced so removals are visible. */
  cut: { scenes: number; voicedLines: number; writtenLines: number };
  /** Whether Estimating is turned on (renderers hide estimate figures when false). */
  estimating: boolean;
  /** How many scenes sit at each writing-ladder rung (by their lowest-beat status). */
  scenesByStatus: Record<string, number>;
  /** Estimate coverage: only meaningful when `estimating` is on. */
  coverage: { totalScenes: number; estimated: number };
  totals: ReportTotals;
}

interface Unit { id: string; voiced: boolean; words: number; character?: string; }

/**
 * Allocate an integer `total` across weighted keys by the LARGEST-REMAINDER method, so the parts sum
 * back to `total` exactly (no rounding drift). Zero total weight -> empty (nothing to share).
 */
function allocateLargestRemainder<K>(total: number, weights: Map<K, number>): Map<K, number> {
  const sum = [...weights.values()].reduce((a, b) => a + b, 0);
  if (sum <= 0 || total <= 0) return new Map();
  const parts = [...weights.entries()].map(([k, w]) => {
    const ideal = (total * w) / sum;
    const floor = Math.floor(ideal);
    return { k, floor, frac: ideal - floor };
  });
  let remainder = total - parts.reduce((n, p) => n + p.floor, 0);
  parts.sort((a, b) => b.frac - a.frac); // hand the leftover units to the largest fractional parts
  for (let i = 0; i < parts.length && remainder > 0; i++, remainder--) parts[i]!.floor++;
  return new Map(parts.map((p) => [p.k, p.floor]));
}

/** Compute the production report. Pure: data out, no rendering, no I/O. */
export function runReport(loaded: LoadedProject, recordingOverride?: Map<string, string>): ReportData {
  const { project } = loaded;
  const writingLadder = (project.writingStatuses ?? DEFAULT_WRITING_STATUSES).map((s) => s.name);
  const recordingLadder = (project.recordingStatuses ?? DEFAULT_RECORDING_STATUSES).map((s) => s.name);
  const stub = writingLadder[0]!;
  const ladderDecls = project.writingStatuses ?? DEFAULT_WRITING_STATUSES;
  const recordThreshold = ladderDecls.findIndex((s) => s.readyToRecord);
  const shipThreshold = ladderDecls.findIndex((s) => s.readyToShip);
  const writingIndex = new Map(writingLadder.map((name, i) => [name, i]));

  // Estimating config (opt-in). Threshold defaults to the lowest rung; tags map to line counts.
  const est = project.estimating;
  const estimatingOn = est?.enabled ?? false;
  const thresholdIdx = estimatingOn ? (writingIndex.get(est?.thresholdStatus ?? "") ?? 0) : -1;
  const defaultLines = est?.defaultLines ?? 0;
  const tagMap = new Map((est?.tagEstimates ?? []).map((t) => [t.tag, t.lines]));

  // The authoring shards flattened to project-wide lookups. In Audio Folders mode the host passes
  // `recordingOverride` (status derived from files on disk), which replaces the manual recording map (#206).
  const { writing: writingOf, recording: manualRecordingOf, cut: cutSet, edits: editsOf } = mergeAuthoring(loaded);
  const recordingOf = recordingOverride ?? manualRecordingOf;

  // Per-locale id -> text; the default locale drives counts.
  const byLocale = stringsByLocale(loaded);
  const sourceStrings = byLocale.get(project.locales.default) ?? {};
  const wordsOf = (id: string): number => {
    const text = sourceStrings[id];
    return text ? text.split(/\s+/).filter(Boolean).length : 0;
  };

  const cut = { scenes: 0, voicedLines: 0, writtenLines: 0 };
  const characters = new Map<string, CharacterReport>();
  const getChar = (name: string): CharacterReport => {
    let c = characters.get(name);
    if (!c) { c = { character: name, lines: 0, words: 0, estimatedLines: 0, recording: Object.fromEntries(recordingLadder.map((s) => [s, 0])) }; characters.set(name, c); }
    return c;
  };
  const reports: SceneReport[] = [];
  const localeIds: string[] = [];
  const estimatedScenes: Array<{ report: SceneReport; voicedShare: number }> = []; // 2nd pass fills derived words
  let actualWrittenLines = 0, actualWords = 0; // for the words-per-line average estimates lean on

  const rungIdxOf = (id: string): number => writingIndex.get(writingOf.get(id) ?? stub) ?? 0;

  for (const scene of loaded.scenes) {
    const sceneCut = cutSet.has(scene.id);

    // Gather this scene's content units (line/text beats + choice labels) and count its choice points.
    const units: Unit[] = [];
    let choices = 0;
    for (const block of scene.blocks) {
      walkNodes<Group | Snippet>(block.children, (node) => {
        if (node.type === "group") {
          if (node.selector === "choice") choices++;
          if (node.prompt) units.push({ id: node.prompt.id, voiced: node.prompt.kind === "line", words: wordsOf(node.prompt.id),
            character: node.prompt.kind === "line" ? node.prompt.character : undefined });
          return;
        }
        for (const beat of node.beats ?? []) {
          if (beat.kind === "gameEvent") continue;
          units.push({ id: beat.id, voiced: beat.kind === "line", words: wordsOf(beat.id),
            character: beat.kind === "line" ? beat.character : undefined });
        }
      });
    }

    // Cut content: count it and drop out (a whole cut scene never enters the scene list).
    for (const u of units) if (sceneCut || cutSet.has(u.id)) { cut.writtenLines++; if (u.voiced) cut.voicedLines++; }
    if (sceneCut) { cut.scenes++; continue; }
    const live = units.filter((u) => !cutSet.has(u.id));
    for (const u of live) if (sourceStrings[u.id]) localeIds.push(u.id);

    // Scene status = the lowest-rung live beat; eligibility for estimating = the HIGHEST is at/below threshold.
    const statusIdx = live.length ? Math.min(...live.map((u) => rungIdxOf(u.id))) : undefined;
    const status = statusIdx === undefined ? undefined : writingLadder[statusIdx];
    const highestIdx = live.length ? Math.max(...live.map((u) => rungIdxOf(u.id))) : undefined;
    const estimated = estimatingOn && live.length > 0 && highestIdx! <= thresholdIdx;

    if (estimated) {
      const tagLines = (scene.tags ?? []).map((t) => tagMap.get(t)).filter((n): n is number => n != null);
      const estimateLines = tagLines.length ? Math.max(...tagLines) : defaultLines;
      // Weight each character by their placeholder line count; narration / character-less lines pool as UNATTRIBUTED.
      const weights = new Map<string, number>();
      for (const u of live) {
        const key = u.voiced && u.character ? u.character : UNATTRIBUTED;
        weights.set(key, (weights.get(key) ?? 0) + 1);
      }
      const shares = allocateLargestRemainder(estimateLines, weights);
      let voicedShare = 0;
      for (const [key, n] of shares) {
        if (key === UNATTRIBUTED) continue;
        getChar(key).estimatedLines += n;
        voicedShare += n; // the character-attributed portion is the scene's voiced estimate
      }
      const report: SceneReport = {
        sceneId: scene.id, name: scene.name, file: loaded.sceneFiles[scene.id],
        status, estimated: true, choices,
        voiced: emptyVoiced(writingLadder, recordingLadder), written: emptyWritten(writingLadder),
        estimate: estimateLines,
        writtenDone: 0, writtenRemaining: estimateLines,
        voicedDone: 0, voicedRemaining: voicedShare,
      };
      reports.push(report);
      estimatedScenes.push({ report, voicedShare });
      continue;
    }

    // Actuals: tally each live beat against the ladders and its speaker.
    const voiced = emptyVoiced(writingLadder, recordingLadder);
    const written = emptyWritten(writingLadder);
    for (const u of live) {
      const ws = writingOf.get(u.id) ?? stub;
      written.count++; written.words += u.words; written.byWriting[ws] = (written.byWriting[ws] ?? 0) + 1;
      actualWrittenLines++; actualWords += u.words;
      if (!u.voiced) continue;
      voiced.count++; voiced.words += u.words; voiced.byWriting[ws] = (voiced.byWriting[ws] ?? 0) + 1;
      const wi = writingIndex.get(ws) ?? 0;
      if (recordThreshold !== -1 && wi >= recordThreshold) voiced.readyToRecord++;
      if (shipThreshold !== -1 && wi >= shipThreshold) voiced.readyToShip++;
      const rec = recordingOf.get(u.id) ?? recordingLadder[0]!;
      voiced.byRecording[rec] = (voiced.byRecording[rec] ?? 0) + 1;
      const speaker = u.character ?? "(narrator)";
      const ch = getChar(speaker);
      ch.lines++; ch.words += u.words; ch.recording[rec] = (ch.recording[rec] ?? 0) + 1;
    }
    const writtenStub = written.byWriting[stub] ?? 0;
    const voicedStub = voiced.byWriting[stub] ?? 0;
    reports.push({
      sceneId: scene.id, name: scene.name, file: loaded.sceneFiles[scene.id],
      status, estimated: false, choices, voiced, written,
      writtenDone: written.count - writtenStub, writtenRemaining: writtenStub,
      voicedDone: voiced.count - voicedStub, voicedRemaining: voicedStub,
    });
  }

  // Estimated scenes' words are derived from the project's real words-per-line (fallback constant).
  const avgWordsPerLine = actualWrittenLines > 0 ? actualWords / actualWrittenLines : DEFAULT_WORDS_PER_LINE;
  for (const { report, voicedShare } of estimatedScenes) {
    report.written.words = Math.round((report.estimate ?? 0) * avgWordsPerLine);
    report.voiced.words = Math.round(voicedShare * avgWordsPerLine);
  }

  const locales = computeLocales(loaded, byLocale, editsOf, localeIds, project.locales.default);
  const totals = computeTotals(reports, writingLadder, recordingLadder);
  const scenesByStatus: Record<string, number> = Object.fromEntries(writingLadder.map((s) => [s, 0]));
  for (const s of reports) if (s.status) scenesByStatus[s.status] = (scenesByStatus[s.status] ?? 0) + 1;
  const coverage = { totalScenes: reports.length, estimated: reports.filter((s) => s.estimated).length };

  return {
    project: { id: project.project.id, name: project.project.name },
    voiced: project.voiced ?? false,
    // Recording tracking is opt-in (default off) even for a voiced project (#206).
    recordingTracked: (project.voiced ?? false) && (project.trackAudioStatus ?? false),
    writingLadder, recordingLadder,
    scenes: reports,
    characters: [...characters.values()].sort((a, b) => (b.lines + b.estimatedLines) - (a.lines + a.estimatedLines)),
    locales, cut, estimating: estimatingOn, scenesByStatus, coverage, totals,
  };
}

function emptyWritten(ladder: string[]): WrittenCounts {
  return { count: 0, words: 0, byWriting: Object.fromEntries(ladder.map((s) => [s, 0])) };
}
function emptyVoiced(writing: string[], recording: string[]): VoicedCounts {
  return { ...emptyWritten(writing), byRecording: Object.fromEntries(recording.map((s) => [s, 0])), readyToRecord: 0, readyToShip: 0 };
}

/**
 * Per-locale translated / missing / stale, over the WRITTEN-line ids that have source text.
 * `ids` is the localisation set (non-cut written-line ids with source text), gathered by runReport's
 * single content walk - this used to re-walk the whole project to rebuild it.
 */
function computeLocales(
  loaded: LoadedProject,
  byLocale: Map<string, Record<string, string>>,
  editsOf: Map<string, EditRecord>,
  ids: string[],
  defaultLocale: string,
): LocaleReport[] {
  const out: LocaleReport[] = [];
  for (const locale of loaded.project.locales.all) {
    if (locale === defaultLocale) continue;
    const table = byLocale.get(locale) ?? {};
    let translated = 0, missing = 0, stale = 0, words = 0;
    for (const id of ids) {
      const text = table[id];
      if (text === undefined) { missing++; continue; }
      translated++;
      words += text.split(/\s+/).filter(Boolean).length;
      const edit = editsOf.get(id);
      const modified = edit?.modifiedAt, localised = edit?.localisedAt?.[locale];
      if (modified && localised && modified > localised) stale++;
    }
    out.push({ locale, translated, missing, stale, words });
  }
  return out;
}

function computeTotals(
  scenes: SceneReport[],
  writingLadder: string[],
  recordingLadder: string[],
): ReportTotals {
  const t: ReportTotals = {
    voiced: emptyVoiced(writingLadder, recordingLadder),
    written: emptyWritten(writingLadder),
    choices: 0, writtenDone: 0, writtenRemaining: 0, voicedDone: 0, voicedRemaining: 0,
    projectedWritten: 0, projectedVoiced: 0,
  };
  const add = (into: Record<string, number>, from: Record<string, number>) => {
    for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v;
  };
  for (const s of scenes) {
    t.voiced.count += s.voiced.count; t.voiced.words += s.voiced.words;
    t.voiced.readyToRecord += s.voiced.readyToRecord; t.voiced.readyToShip += s.voiced.readyToShip;
    add(t.voiced.byWriting, s.voiced.byWriting); add(t.voiced.byRecording, s.voiced.byRecording);
    t.written.count += s.written.count; t.written.words += s.written.words;
    add(t.written.byWriting, s.written.byWriting);
    t.choices += s.choices;
    t.writtenDone += s.writtenDone; t.writtenRemaining += s.writtenRemaining;
    t.voicedDone += s.voicedDone; t.voicedRemaining += s.voicedRemaining;
  }
  t.projectedWritten = t.writtenDone + t.writtenRemaining;
  t.projectedVoiced = t.voicedDone + t.voicedRemaining;
  return t;
}

/** Render the report as compact console lines (the CLI view). */
export function renderReportText(data: ReportData): string[] {
  const out: string[] = [];
  const t = data.totals;
  out.push(`${data.project.name} - ${data.scenes.length} scene(s)`);
  out.push(`written lines: ${t.writtenDone} done / ${t.writtenRemaining} to write -> ${t.projectedWritten} projected (${t.written.words} words)`);
  // Voiced line counts + the recording breakdown are reported only for a VOICED project (#206).
  if (data.voiced) out.push(`voiced lines:  ${t.voicedDone} done / ${t.voicedRemaining} to write -> ${t.projectedVoiced} projected (${t.voiced.words} words)`);
  out.push(`writing status: ${Object.entries(t.written.byWriting).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  out.push(`scene status: ${Object.entries(data.scenesByStatus).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  if (data.voiced) out.push(`ready to record: ${t.voiced.readyToRecord} / ready to ship: ${t.voiced.readyToShip} (voiced)`);
  // The recording-status breakdown is audio-status-tracking only (#206), a narrower gate than voiced.
  if (data.recordingTracked) out.push(`recording: ${Object.entries(t.voiced.byRecording).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  if (data.estimating) {
    const estLines = data.scenes.reduce((n, s) => n + (s.estimated ? (s.estimate ?? 0) : 0), 0);
    out.push(`estimating: ${data.coverage.estimated}/${data.coverage.totalScenes} scene(s) estimated (${estLines} lines)`);
  }
  if (data.cut.writtenLines > 0) out.push(`cut: ${data.cut.scenes} scene(s), ${data.cut.writtenLines} written / ${data.cut.voicedLines} voiced line(s)`);
  for (const l of data.locales) {
    out.push(`locale ${l.locale}: ${l.translated} translated, ${l.missing} missing, ${l.stale} stale`);
  }
  return out;
}
