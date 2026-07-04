// ---------------------------------------------------------------------------
// @patterkit/ops - the shared operations layer (spec §13).
//
// Every project operation as a pure, render-free function over the files /
// loaded project: no printing, no process.exit, no prompts - and ops that
// change files RETURN planned writes rather than writing (write.ts). The
// `patter` CLI and Patterpad are both thin front-ends over this package, so
// editor, CLI, and CI behave identically by construction.
// ---------------------------------------------------------------------------

export { loadProject, loadProjectLanding, sceneIdForShard, findProjectFile, applySceneOrder } from "./load.js";
export type { LoadedProject } from "./load.js";
export { applyWrites } from "./write.js";
export type { PlannedWrite } from "./write.js";
export { runValidate } from "./validate.js";
export type { ValidateResult, HygieneIssue } from "./validate.js";
export { runExport, runExportFull, bundleOutputPath } from "./export.js";
export { runExportHtml, runExportWeb } from "./export-html.js";
export { scanAudioStatus } from "./audio-scan.js";
export type { WebExport } from "./export-html.js";
export { runPlay, renderPlay } from "./play.js";
export type { PlayOptions, PlayResult, PlayEvent, PlayOutcome } from "./play.js";
export { runCoverage, renderCoverageText, proposeCoverageDrivers } from "./coverage.js";
export type { CoverageOptions, CoverageHooks, CoverageReport, CoverageBeat } from "./coverage.js";
export { resolveStart } from "./loaded-helpers.js";
export { runFormat } from "./format.js";
export type { FormatResult } from "./format.js";
export { runReport, renderReportText } from "./report.js";
export type {
  ReportData, SceneReport, CharacterReport, LocaleReport,
  ReportTotals, VoicedCounts, WrittenCounts,
} from "./report.js";
export { runReportXlsx } from "./report-xlsx.js";
export { extractLoc, applyLoc } from "./localisation.js";
export type { LocEntry, LocCatalog, ApplyStats } from "./localisation.js";
export { catalogToJson, jsonToCatalog, catalogToPo, poToCatalog } from "./loc-format.js";
export { catalogToXlsx, xlsxToCatalog } from "./loc-xlsx.js";
export { runVoiceScript } from "./voice-script.js";
export type { VoiceScript, VoiceLine } from "./voice-script.js";
export { voiceScriptToXlsx } from "./voice-script-xlsx.js";
export { runScriptDoc } from "./script-doc.js";
export type { ScriptDoc, ScriptElement } from "./script-doc.js";
export { scriptToDocx } from "./script-docx.js";
export { scriptToPdf } from "./script-pdf.js";
export { runInit, vcsConfigWrites } from "./init.js";
export type { InitOptions, InitResult, InitVcs, BundlePosture } from "./init.js";
export { runResolve, runSearch, runStatusBrowse, runPropertyUsage, runTagBrowse, listProjectTags } from "./resolve.js";
export type { ResolveEntry, SearchFocus } from "./resolve.js";
export { runReplace } from "./replace.js";
export type { ReplaceOptions, ReplaceHit, ReplacePlan } from "./replace.js";
export { runPack, SHARD_EXTENSIONS } from "./pack.js";
export type { DocumentManifest } from "./pack.js";
export { runUnpack, runUnpackMerge, UnsafeEntryError, isUnsafeEntry } from "./unpack.js";
export type { UnpackMergeResult, MergedShard } from "./unpack.js";
export { resolveDocumentation, classesForChannel } from "./documentation.js";
export { runMerge, detectMergeType, UnsupportedMergeError } from "./merge.js";
export type { MergeResult, MergeFileType, Conflict, ConflictKind } from "./merge.js";
