// ---------------------------------------------------------------------------
// `patter` CLI - argv parsing, output, and exit codes ONLY (importable, so the
// parser and exit mapping are testable). All the work lives in @patterkit/ops
// (the shared, pure operations layer - Patterpad consumes the same functions).
//
// Flags are declared per command: a VALUED flag always consumes the next token
// (so `--seed -5` works), a BOOLEAN flag never does (so `--check a.patterflow`
// cannot eat a file), and an unknown flag is an error rather than a silent
// no-op. Exit codes: 0 ok, 1 the operation found problems / failed, 2 usage.
// ---------------------------------------------------------------------------

import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { canonicalStringify, parseSource } from "@patterkit/core";
import {
  loadProject, runValidate, runExport, runExportHtml, bundleOutputPath, runFormat, runPlay, renderPlay, runCoverage, renderCoverageText, proposeCoverageDrivers, runInit, runResolve, runPropertyUsage,
  runReport, renderReportText, runReportXlsx, runPack, runUnpack, runUnpackMerge, runMerge, UnsupportedMergeError, SHARD_EXTENSIONS,
  extractLoc, applyLoc, catalogToJson, jsonToCatalog, catalogToPo, poToCatalog, catalogToXlsx, xlsxToCatalog,
  runVoiceScript, voiceScriptToXlsx, runScriptDoc, scriptToDocx, scriptToPdf, scanAudioStatus, patterScopesWrite,
  planShareScopes, defaultGameScopesDir, GAME_SCOPES_DIR,
  exportEditableScript, readEditableDocx, planEditableImport, listOpenSuggestions, applySuggestionDecisions,
} from "@patterkit/ops";
import type { InitVcs, BundlePosture, MergeFileType, MergeResult, PlannedWrite, LocCatalog, ImportPlan, LoadedProject } from "@patterkit/ops";
import { createHash } from "node:crypto";

/** A file the structured merger handles (source shards only - not bundle / document). */
const isPatterSource = (path: string): boolean => SHARD_EXTENSIONS.some((ext) => path.endsWith(ext));

/**
 * Write a merge result to `out` (canonical source) + a `.patterconflict` sidecar
 * when there are conflicts; a clean merge clears any stale sidecar. Returns the
 * exit code (0 clean, 1 conflicts). Shared by `merge -o` and `mergetool`.
 */
function writeMergeResult(result: MergeResult, out: string, announce: boolean): number {
  if (!commitWrites([{ path: out, content: canonicalStringify(result.merged) }])) return 1;
  for (const w of result.warnings) console.error(`warning: ${w.message} (${w.path})`);
  const sidecar = `${out}.patterconflict`;
  if (result.conflicts.length > 0) {
    const body = JSON.stringify({ type: result.type, conflicts: result.conflicts, warnings: result.warnings }, null, 2) + "\n";
    if (!commitWrites([{ path: sidecar, content: body }])) return 1;
    console.error(`${result.conflicts.length} conflict(s) - wrote ${out} (provisional OURS) + ${sidecar}`);
    return 1;
  }
  if (existsSync(sidecar)) deleteFile(sidecar); // clear a stale sidecar through VC, not a raw unlink
  if (announce) console.log(`merged ${out} (${result.type}, no conflicts)`);
  return 0;
}
import { writeTextFiles, writeBinaryFile, deleteFile, currentUser } from "@wildwinter/simple-vc-lib";
// The number comes from the MANIFEST, inlined by both shipping paths (tsup and Bun --compile), rather
// than a hand-kept constant. A release is tagged from the manifest, so a constant that drifts from it
// drifts from the name of the file the user downloaded, which is the one thing they can still read.
import pkg from "../package.json" with { type: "json" };

export const USAGE = `patter - Patter CLI

Usage:
  patter --version                Print the version (also -v / version)
  patter --help                   Print this usage (also -h / help)
  patter init    [dir]            Scaffold a new project (the <dir>.patter folder, starter scene, VCS config)
                 [--name X] [--vcs git|perforce|plastic|svn] [--bundle commit|ignore]
  patter validate [path]          Validate a project (structural + expressions + encoding + bundle)
  patter format  [files...]       Rewrite source files to canonical form (alias: fmt)
                 [--check]         Report what would change; write nothing (for CI)
  patter export  [path] [-o file] Compile to a .patterc bundle (default: dist/<name>.patterc; -o - for stdout)
                 [--ids]          IDs-only build: ship no strings; the game localises from beat IDs
                 [--source-debug] IDs-only but embed the source language for debug playback (not shippable)
  patter export-html [path] [-o file]  A single self-contained, playable .html (runtime + story inlined;
                 send it to anyone, opens in any browser; default: dist/<name>.html; -o - for stdout)
  patter play    [path]           Play a project through the reference runtime (transcript)
                 [--scene id] [--block id] [--choices a,b,c] [--seed N]
  patter coverage [path]          Narrative coverage: random playthroughs, find never-reached content
                 [--runs N] [--max-steps M] [--seed S] [--scene id] [--block id]
                 [--order least|script]   (least reached first, the default, or the script's own order)
                 [--json] [--fail-on-gap]   (--fail-on-gap exits 1 if any beat is never reached)
                 [--propose]   (print auto-proposed @world input drivers instead of running)
  patter resolve <query> [path]   Find a line by id, Game ID, or name: shows where it lives + what it says
  patter usage   <query> [path]   Find where a property is used (conditions / effects / text)
                 [--json]   (query: @gold · world.threat · "faction rebels"; quote a value)
  patter report  [path]           Production report: status, burndown, recording coverage (alias: stats)
                 [--xlsx file] [--json]  Also write the spreadsheet / emit JSON (for pipelines)
  patter loc-export [path] -o file  Export strings for localisation (spec §14)
                 --format json|xlsx|po  [--locale xx]   (no --locale = a blank template / POT)
  patter loc-import <file> [path]  Import translated strings back into the project
                 [--locale xx]     (format by extension; --locale overrides the file's)
  patter export-script [path] [-o file.pdf|.docx]  Readable screenplay of the script + flow
                 (dialogue, narration, choices, jumps). Format from the extension; default
                 dist/<name>.pdf. PDF uses built-in fonts (Latin); use .docx for full Unicode.
  patter voice-export [path] -o file.xlsx  Voice (VO) recording script (spec §16)
                 [--all]           Include every voiced line (else only "ready to record")
  patter export-editable [path] -o file.docx  An editable script to send to an editor outside Patter
                 [--scene name]... (repeatable; default the whole project) [--recipient "Sam"]
                 [--status] [--cast] [--all-notes] [--by name]   (writes a handoffs/<id>.json record too)
  patter import-editable <file.docx> [path]  Bring an editor's file back as suggestions and comments
                 [--dry-run] [--direct] [--as name] [--by name] [--strict-quotes]
                 (--direct accepts clean changes; --as credits untracked edits; nothing half-written)
  patter suggestions [path]       List open suggestions, clean or out of date
                 [--handoff H-XXXX] [--accept-clean] [--json]
  patter share-scopes [path]      Share the project's scopes with the game's other tools: make the game's
                 [--at dir]        game-scopes/ folder (in --at, else the version-control root above the
                                   project) with patter.scopes.json and game.scopes.json; joins a folder
                                   that already exists, adding only the scopes it doesn't hold
  patter pack    [path] -o file   Pack a project (the .patter folder) into a portable .patterpack
  patter unpack  <file> -o dir    Explode a .patterpack into source shards under dir
                 [--merge --base sent.patterpack]  Merge a returned .patterpack into the project
  patter merge   BASE OURS THEIRS  3-way merge of Patter source by node id (flow/loc/authoring/project)
                 [-o out] [--type flow|loc|authoring|project] [--json]
  patter mergetool BASE THEIRS OURS OUT  VCS merge-tool wrapper: Patter source -> structured merge,
                 [--fallback cmd]        else hand the files to your normal tool (one global tool fits all)
`;

// Per-command flag declarations: anything else is an error.
const FLAGS: Record<string, { boolean: string[]; valued: string[]; repeatable?: string[] }> = {
  init: { boolean: [], valued: ["name", "vcs", "bundle"] },
  validate: { boolean: [], valued: [] },
  format: { boolean: ["check"], valued: [] },
  export: { boolean: ["ids", "source-debug"], valued: ["o"] },
  "export-html": { boolean: [], valued: ["o"] },
  play: { boolean: [], valued: ["scene", "block", "choices", "seed"] },
  coverage: { boolean: ["json", "fail-on-gap", "propose"], valued: ["runs", "max-steps", "seed", "scene", "block", "order"] },
  resolve: { boolean: [], valued: [] },
  usage: { boolean: ["json"], valued: [] },
  report: { boolean: ["json"], valued: ["xlsx"] },
  "loc-export": { boolean: [], valued: ["format", "o", "locale"] },
  "loc-import": { boolean: [], valued: ["locale"] },
  "voice-export": { boolean: ["all"], valued: ["o"] },
  "export-script": { boolean: [], valued: ["o"] },
  "export-editable": { boolean: ["status", "cast", "all-notes"], valued: ["o", "recipient", "by"], repeatable: ["scene"] },
  "import-editable": { boolean: ["dry-run", "direct", "strict-quotes"], valued: ["as", "by"] },
  suggestions: { boolean: ["accept-clean", "json"], valued: ["handoff"] },
  "share-scopes": { boolean: [], valued: ["at"] },
  pack: { boolean: [], valued: ["o"] },
  unpack: { boolean: ["merge"], valued: ["o", "base"] },
  merge: { boolean: ["json"], valued: ["o", "type"] },
  mergetool: { boolean: [], valued: ["fallback"] },
};

export interface ParsedArgs {
  positionals: string[];
  /** A repeatable flag (`--scene a --scene b`) collects its values in order. */
  flags: Record<string, string | boolean | string[]>;
  /** Usage problems (unknown flag, missing value); non-empty means exit 2. */
  errors: string[];
}

export function parseArgs(command: string, args: string[]): ParsedArgs {
  const spec = FLAGS[command] ?? { boolean: [], valued: [] };
  const positionals: string[] = [];
  const flags: Record<string, string | boolean | string[]> = {};
  const errors: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    const key = a === "-o" ? "o" : a.startsWith("--") ? a.slice(2) : null;
    if (key === null) {
      positionals.push(a);
      continue;
    }
    if (spec.boolean.includes(key)) {
      flags[key] = true;
    } else if (spec.repeatable?.includes(key)) {
      const value = args[++i];
      if (value === undefined || value === "") errors.push(`${a} needs a value`);
      else flags[key] = [...((flags[key] as string[] | undefined) ?? []), value];
    } else if (spec.valued.includes(key)) {
      const value = args[++i];
      if (value === undefined || value === "") errors.push(`${a} needs a value`);
      else flags[key] = value;
    } else {
      errors.push(`unknown flag '${a}' for '${command}'`);
    }
  }
  return { positionals, flags, errors };
}

/**
 * Commit planned writes through the VCS (checkout-on-write, add-if-new, via
 * @wildwinter/simple-vc-lib) and report every refusal with its why. On partial
 * failure, also says what DID land. Returns true when all writes landed.
 */
function commitWrites(writes: PlannedWrite[], opts: { allOrNothing?: boolean } = {}): boolean {
  const batch = writeTextFiles(writes.map((w) => ({ filePath: w.path, content: w.content })), "utf8", { allOrNothing: opts.allOrNothing === true });
  const failures = batch.results.filter((r) => !r.success);
  for (const f of failures) console.error(`write failed [${f.status}]: ${f.message}`);
  if (!batch.success) {
    console.error(opts.allOrNothing ? "nothing was written" : `${batch.results.length - failures.length} of ${batch.results.length} file(s) written`);
  }
  return batch.success;
}

/** Write one binary artifact (xlsx / pack) through the VCS, reporting a refusal. Buffer twin of commitWrites. */
function commitBinary(path: string, buffer: Parameters<typeof writeBinaryFile>[1]): boolean {
  const result = writeBinaryFile(path, buffer);
  if (!result.success) { console.error(`write failed [${result.status}]: ${result.message}`); return false; }
  return true;
}

/** Read + parse the three sides of a 3-way merge, or print the parse error under `label` and return null. */
function parseThree(baseP: string, oursP: string, theirsP: string, label: string):
  { base: Record<string, unknown>; ours: Record<string, unknown>; theirs: Record<string, unknown> } | null {
  try {
    return {
      base: parseSource(readFileSync(baseP, "utf8")) as Record<string, unknown>,
      ours: parseSource(readFileSync(oursP, "utf8")) as Record<string, unknown>,
      theirs: parseSource(readFileSync(theirsP, "utf8")) as Record<string, unknown>,
    };
  } catch (e) { console.error(`${label}: cannot parse input - ${e instanceof Error ? e.message : String(e)}`); return null; }
}

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (cmd === undefined) { console.log(USAGE); return 0; }
  // Three spellings, because people try all three. A standalone binary has no package.json beside it and
  // was not installed by npm, so without this there is no way to ask a downloaded `patter` what it is.
  if (cmd === "--version" || cmd === "-v" || cmd === "version") { console.log(pkg.version); return 0; }
  // Asking for help is not a usage error. Without this, `--help` falls through the unknown-command branch
  // below and exits 2, which is the code a script reads as "you invoked me wrongly".
  if (cmd === "--help" || cmd === "-h" || cmd === "help") { console.log(USAGE); return 0; }
  const canonical = cmd === "fmt" ? "format" : cmd === "stats" ? "report" : cmd;
  if (!(canonical in FLAGS)) { console.log(USAGE); return 2; }
  const { positionals, flags, errors } = parseArgs(canonical, rest);
  if (errors.length > 0) {
    for (const e of errors) console.error(`${cmd}: ${e}`);
    return 2;
  }

  try {
    return await run(canonical, positionals, flags);
  } catch (e) {
    console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

async function run(cmd: string, positionals: string[], flags: Record<string, string | boolean | string[]>): Promise<number> {
  switch (cmd) {
    case "init": {
      const vcs = typeof flags.vcs === "string" ? (flags.vcs as InitVcs) : undefined;
      if (vcs && !["git", "perforce", "plastic", "svn"].includes(vcs)) {
        console.error(`init: unknown --vcs '${vcs}' (git | perforce | plastic | svn)`);
        return 2;
      }
      const bundle = typeof flags.bundle === "string" ? (flags.bundle as BundlePosture) : undefined;
      if (bundle && !["commit", "ignore"].includes(bundle)) {
        console.error(`init: unknown --bundle '${bundle}' (commit | ignore)`);
        return 2;
      }
      // The canonical project folder carries the .patter extension (a macOS
      // package / a clear project boundary in any tree). Append it to a named
      // target; an in-place init (".") stays a plain folder.
      const raw = positionals[0] ?? ".";
      const dir = raw !== "." && raw !== "" && !raw.endsWith(".patter") ? `${raw}.patter` : raw;
      const result = runInit({
        dir,
        name: typeof flags.name === "string" ? flags.name : undefined,
        vcs,
        bundle,
      });
      if (!commitWrites(result.writes)) return 1;
      for (const w of result.writes) console.log(`created: ${w.path}`);
      console.log(`\n"${result.name}" is ready - try: patter play ${dir}`);
      return 0;
    }

    case "resolve": {
      const query = positionals[0];
      if (!query) { console.error("resolve: no query given"); return 2; }
      const loaded = loadProject(positionals[1] ?? ".");
      const entries = runResolve(loaded, query);
      if (entries.length === 0) { console.error(`no match for '${query}'`); return 1; }
      for (const e of entries) {
        const name = e.name ? ` "${e.name}"` : "";
        const gid = e.gameId ? `  ${e.gameId}` : "";
        const loc = e.location.length ? `  ${e.location.join(" > ")}` : "";
        const snip = e.text ? `  «${e.text.length > 60 ? `${e.text.slice(0, 59)}…` : e.text}»` : ""; // the line it names
        console.log(`${e.id}  [${e.kind}]${name}${gid}${loc}${snip}${e.file ? `  (${e.file})` : ""}`);
      }
      return 0;
    }

    case "usage": {
      const query = positionals[0];
      if (!query) { console.error("usage: no property given (e.g. @gold, world.threat, \"faction rebels\")"); return 2; }
      const loaded = loadProject(positionals[1] ?? ".");
      const entries = runPropertyUsage(loaded, query);
      if (flags.json === true) { console.log(JSON.stringify(entries)); return 0; }
      if (entries.length === 0) { console.error(`no usages of '${query}'`); return 0; } // unused is a valid answer
      for (const e of entries) console.log(`[${e.kind}] ${e.text ?? ""}   ${e.location.join(" > ")}  (${e.id})`);
      return 0;
    }

    case "validate": {
      const loaded = loadProject(positionals[0] ?? ".");
      const { structural, conditions, interpolation, hygiene, staleBundles, unresolvedMerges, orphans, reachability, gameScopes, ok } = runValidate(loaded);
      // A warning (another tool's scope, say) is printed as one and never fails the run.
      const warn = (i: { severity: "error" | "warning" }): string => (i.severity === "warning" ? "warning: " : "");
      for (const i of structural) console.error(`  [${i.code}] ${i.message}`);
      for (const i of conditions) console.error(`  [${i.field}] ${i.nodeId}: ${warn(i)}${i.message}  (${i.src})`);
      for (const i of interpolation) console.error(`  [${i.field}] ${i.nodeId}: ${warn(i)}${i.message}  (${i.src})`);
      for (const i of hygiene) console.error(`  [hygiene] ${i.file}: ${i.message}`);
      for (const i of staleBundles) console.error(`  [stale-bundle] ${i.file}: ${i.message}`);
      for (const i of unresolvedMerges) console.error(`  [unresolved-merge] ${i.file}: ${i.message}`);
      for (const i of orphans) console.error(`  [not-in-project] ${i.message}`); // the message names the file
      for (const i of gameScopes) console.error(`  [game-scopes] ${i.file}: ${warn(i)}${i.message}`);
      // Advisory, and outside `ok` and the count: a gate whose writer is not authored yet is the normal
      // state mid-work, and must never fail a build.
      for (const i of reachability) console.error(`  [unreachable] ${i.nodeId}: ${i.message}  (${i.src})`);
      const isError = (i: { severity: "error" | "warning" }): boolean => i.severity === "error";
      const warnings = reachability.length + [...conditions, ...interpolation, ...gameScopes].filter((i) => !isError(i)).length;
      const count = structural.length + [...conditions, ...interpolation, ...gameScopes].filter(isError).length
        + hygiene.length + staleBundles.length + unresolvedMerges.length + orphans.length;
      // A warning is not an issue, but "no issues" printed directly under one reads as a contradiction,
      // so say what was said.
      const advisory = warnings ? `, ${warnings} warning(s) above` : "";
      if (ok) console.log(`ok - ${loaded.scenes.length} scene(s), no issues${advisory}`);
      else console.error(`\n${count} issue(s)${advisory}`);
      return ok ? 0 : 1;
    }

    case "format":
    case "fmt": {
      if (positionals.length === 0) { console.error("format: no files given"); return 2; }
      const check = flags.check === true;
      const changed = runFormat(positionals).filter((r) => r.changed);
      if (!check && !commitWrites(changed.map((r) => r.write!))) return 1;
      for (const r of changed) console.log(`${check ? "would format" : "formatted"}: ${r.file}`);
      if (changed.length === 0) console.log("already canonical");
      return check && changed.length > 0 ? 1 : 0;
    }

    case "export": {
      const loaded = loadProject(positionals[0] ?? ".");
      // Localisation mode (spec §11): default to the project's export setting; --ids / --source-debug
      // override it per build. "ids" ships no strings (the game localises from beat IDs); --source-debug
      // also embeds the source language for debug playback (the runtime warns it is not shippable).
      if (flags["source-debug"]) loaded.project.export = { ...loaded.project.export, localisation: { mode: "ids", sourceDebug: true } };
      else if (flags.ids) loaded.project.export = { ...loaded.project.export, localisation: { mode: "ids" } };
      // The compiled bundle is STRICT JSON (runtime ports use stock parsers) -
      // no trailing commas, unlike the source form (spec §11 / merge-doc F1).
      const out = canonicalStringify(runExport(loaded), { trailingComma: false });
      if (flags.o === "-") { process.stdout.write(out); return 0; } // explicit stdout for pipelines
      // No -o: write to the conventional bundle path (project export.bundle, else
      // dist/<name>.patterc) - so `patter export` alone produces the artifact and
      // validate's staleness gate has a stable place to find it (spec §11).
      const target = typeof flags.o === "string" ? flags.o : bundleOutputPath(loaded);
      // The game's scopes folder, when there is one, gets Patter's file too, and only when it changed.
      const scopes = patterScopesWrite(loaded.project, loaded.gameScopes);
      if (!commitWrites([{ path: target, content: out }, ...(scopes ? [scopes] : [])])) return 1;
      console.log(`wrote ${target}`);
      if (scopes) console.log(`wrote ${scopes.path}`);
      return 0;
    }

    case "export-html": {
      const loaded = loadProject(positionals[0] ?? ".");
      const html = runExportHtml(loaded);
      if (flags.o === "-") { process.stdout.write(html); return 0; } // stdout for pipelines
      const target = typeof flags.o === "string" ? flags.o : bundleOutputPath(loaded).replace(/\.patterc$/, ".html");
      if (!commitWrites([{ path: target, content: html }])) return 1;
      console.log(`wrote ${target}`);
      return 0;
    }

    case "play": {
      let seed: number | undefined;
      if (typeof flags.seed === "string") {
        seed = Number(flags.seed);
        if (!Number.isFinite(seed)) { console.error(`play: --seed '${flags.seed}' is not a number`); return 2; }
      }
      const loaded = loadProject(positionals[0] ?? ".");
      const result = runPlay(loaded, {
        scene: typeof flags.scene === "string" ? flags.scene : undefined,
        block: typeof flags.block === "string" ? flags.block : undefined,
        choices: typeof flags.choices === "string" ? flags.choices.split(",") : undefined,
        seed,
      });
      for (const line of renderPlay(result)) console.log(line);
      // A playthrough that didn't reach the end (stalled choice / step bound), or
      // that hit a condition or effect that failed, is a failure - `play` exists
      // to drive flows to completion in CI, and the engine plays through a failing
      // expression rather than stopping, so this is where CI hears about it.
      return result.outcome === "end" && !result.events.some((e) => e.type === "error") ? 0 : 1;
    }

    case "coverage": {
      // Validate the numeric flags up front (exit 2 on a non-number, like `play --seed`).
      const numbers: Record<string, number | undefined> = {};
      for (const [flag, label] of [["runs", "runs"], ["max-steps", "max-steps"], ["seed", "seed"]] as const) {
        if (typeof flags[flag] !== "string") continue;
        const n = Number(flags[flag]);
        if (!Number.isFinite(n)) { console.error(`coverage: --${label} '${flags[flag]}' is not a number`); return 2; }
        numbers[flag] = n;
      }
      const order = flags.order ?? "least";
      if (order !== "least" && order !== "script") { console.error(`coverage: --order '${order}' is not least or script`); return 2; }
      const loaded = loadProject(positionals[0] ?? ".");
      // --propose: print auto-proposed @world input drivers (from the conditions) instead of running.
      // The author pastes the chosen ones into the project's `coverageDrivers`.
      if (flags.propose === true) {
        const drivers = proposeCoverageDrivers(loaded);
        if (flags.json === true) console.log(JSON.stringify(drivers));
        else if (drivers.length === 0) console.log("no host-scope (@world) inputs to drive");
        else for (const d of drivers) console.log(`${d.ref}  ${d.kind}/${d.cadence ?? "sometimes"}  [${d.values.join(", ")}]`);
        return 0;
      }
      const report = runCoverage(loaded, {
        runs: numbers.runs, maxSteps: numbers["max-steps"], seed: numbers.seed,
        scene: typeof flags.scene === "string" ? flags.scene : undefined,
        block: typeof flags.block === "string" ? flags.block : undefined,
      });
      if (flags.json === true) console.log(JSON.stringify(report));
      else {
        const nameOf = (id: string): string => loaded.scenes.find((s) => s.id === id)?.name ?? id;
        for (const line of renderCoverageText(report, nameOf, { order })) console.log(line);
      }
      // --fail-on-gap: a CI gate - any never-reached beat fails the command.
      return flags["fail-on-gap"] === true && report.totals.neverHit > 0 ? 1 : 0;
    }

    case "report": {
      const loaded = loadProject(positionals[0] ?? ".");
      // Audio Folders projects derive recording status from the takes on disk - the same
      // pipeline Patterpad's report uses (undefined = the manual map, exactly as there).
      const data = runReport(loaded, scanAudioStatus(loaded));
      // --xlsx is honoured independently of the stdout view; in --json mode its
      // confirmation goes to stderr so stdout stays pure JSON for pipelines.
      if (typeof flags.xlsx === "string") {
        if (!commitBinary(flags.xlsx, await runReportXlsx(data))) return 1;
        (flags.json === true ? console.error : console.log)(`wrote ${flags.xlsx}`);
      }
      if (flags.json === true) { console.log(JSON.stringify(data)); return 0; }
      for (const line of renderReportText(data)) console.log(line);
      return 0;
    }

    case "loc-export": {
      const format = typeof flags.format === "string" ? flags.format : "";
      if (!["json", "xlsx", "po"].includes(format)) { console.error("loc-export: --format json|xlsx|po is required"); return 2; }
      if (typeof flags.o !== "string") { console.error("loc-export: -o <file> is required"); return 2; }
      const loaded = loadProject(positionals[0] ?? ".");
      const locale = typeof flags.locale === "string" ? flags.locale : undefined; // omitted = blank template / POT
      const catalog = extractLoc(loaded, { locale });
      if (format === "xlsx") {
        if (!commitBinary(flags.o, await catalogToXlsx(catalog))) return 1;
      } else {
        const content = format === "json" ? catalogToJson(catalog) : catalogToPo(catalog);
        if (!commitWrites([{ path: flags.o, content }])) return 1;
      }
      const n = catalog.entries.length;
      console.log(`wrote ${flags.o} - ${n} string(s)${locale ? `, ${locale}` : " (template)"}`);
      return 0;
    }

    case "export-script": {
      const loaded = loadProject(positionals[0] ?? ".");
      const target = typeof flags.o === "string" ? flags.o : bundleOutputPath(loaded).replace(/\.patterc$/, ".pdf");
      const isDocx = /\.docx$/i.test(target);
      if (!isDocx && !/\.pdf$/i.test(target)) { console.error("export-script: -o must end in .pdf or .docx"); return 2; }
      const doc = runScriptDoc(loaded);
      const buf = isDocx ? await scriptToDocx(doc) : await scriptToPdf(doc);
      if (!commitBinary(target, buf)) return 1;
      console.log(`wrote ${target}`);
      return 0;
    }

    case "export-editable": {
      if (typeof flags.o !== "string") { console.error("export-editable: -o <file.docx> is required"); return 2; }
      if (!/\.docx$/i.test(flags.o)) { console.error("export-editable: -o must end in .docx"); return 2; }
      const loaded = loadProject(positionals[0] ?? ".");
      const scenes = Array.isArray(flags.scene) ? resolveScenes(loaded, flags.scene) : undefined;
      if (scenes === null) return 2;
      const out = await exportEditableScript(loaded, {
        by: who(loaded, flags.by), ...(scenes ? { scenes } : {}),
        ...(typeof flags.recipient === "string" ? { recipient: flags.recipient } : {}),
        notes: flags["all-notes"] === true ? "all" : "editor", status: flags.status === true, cast: flags.cast === true,
      });
      if (!commitBinary(flags.o, out.docx)) return 1;
      if (!commitWrites(out.writes)) return 1;
      console.log(`wrote ${flags.o} - ${Object.keys(out.handoff.lines).length} line(s), handoff ${out.handoff.id}`);
      return 0;
    }

    case "import-editable": {
      const file = positionals[0];
      if (!file) { console.error("import-editable: no file given"); return 2; }
      const loaded = loadProject(positionals[1] ?? ".");
      const bytes = readFileSync(file);
      const plan = planEditableImport(loaded, await readEditableDocx(bytes), {
        by: who(loaded, flags.by), fileHash: createHash("sha256").update(bytes).digest("hex"),
        ...(typeof flags.as === "string" ? { as: flags.as } : {}),
        strictQuotes: flags["strict-quotes"] === true, direct: flags.direct === true,
      });
      console.log(renderImportReport(plan));
      if (plan.report.refused) return 1;
      if (flags["dry-run"] === true) { console.log("dry run: nothing written"); return 0; }
      // All or nothing: under lock-based version control, a file someone else holds means no file is written.
      if (!commitWrites(plan.writes, { allOrNothing: true })) return 1;
      console.log(`imported into ${plan.writes.length} file(s)`);
      return 0;
    }

    case "suggestions": {
      const loaded = loadProject(positionals[0] ?? ".");
      const open = listOpenSuggestions(loaded, typeof flags.handoff === "string" ? { handoff: flags.handoff } : {});
      if (flags.json === true && flags["accept-clean"] !== true) { console.log(JSON.stringify(open, null, 2)); return 0; }
      if (flags["accept-clean"] === true) {
        const clean = open.filter((o) => o.stale.length === 0);
        if (!clean.length) { console.log("no clean suggestions to accept"); return 0; }
        const plan = applySuggestionDecisions(loaded, clean.map((o) => ({ id: o.suggestion.id, accept: true })), { by: who(loaded, undefined) });
        if (!commitWrites(plan.writes, { allOrNothing: true })) return 1;
        const accepted = plan.results.filter((r) => r.outcome === "accepted").length;
        console.log(`accepted ${accepted} suggestion(s)${open.length > clean.length ? `; ${open.length - clean.length} out of date, left open` : ""}`);
        return 0;
      }
      if (!open.length) { console.log("no open suggestions"); return 0; }
      for (const o of open) console.log(describeSuggestion(o));
      const stale = open.filter((o) => o.stale.length).length;
      console.log(`${open.length} open suggestion(s)${stale ? `, ${stale} out of date` : ""}`);
      return 0;
    }

    case "voice-export": {
      if (typeof flags.o !== "string") { console.error("voice-export: -o <file.xlsx> is required"); return 2; }
      const loaded = loadProject(positionals[0] ?? ".");
      if (!loaded.project.voiced) { console.error("voice-export: this project is not voiced (set `voiced: true` in the project file)"); return 2; } // #206
      const data = runVoiceScript(loaded, { everything: flags.all === true, recordingOverride: scanAudioStatus(loaded) });
      if (!commitBinary(flags.o, await voiceScriptToXlsx(data))) return 1;
      const n = data.lines.length;
      console.log(`wrote ${flags.o} - ${n} line(s)${flags.all === true ? "" : " (ready to record)"}`);
      return 0;
    }

    case "loc-import": {
      const file = positionals[0];
      if (!file) { console.error("loc-import: no file given"); return 2; }
      const loaded = loadProject(positionals[1] ?? ".");
      const ext = file.slice(file.lastIndexOf(".")).toLowerCase();
      let catalog: LocCatalog;
      if (ext === ".json") catalog = jsonToCatalog(readFileSync(file, "utf8"));
      else if (ext === ".po" || ext === ".pot") catalog = poToCatalog(readFileSync(file, "utf8"));
      else if (ext === ".xlsx") catalog = await xlsxToCatalog(readFileSync(file));
      else { console.error(`loc-import: unknown format '${ext}' (.json | .po | .xlsx)`); return 2; }
      const locale = typeof flags.locale === "string" ? flags.locale : catalog.locale; // --locale overrides the file's
      if (!locale) { console.error("loc-import: no locale (the file carries none; pass --locale xx)"); return 2; }
      if (locale === loaded.project.locales.default) { console.error(`loc-import: '${locale}' is the source locale - nothing to import`); return 2; }
      const { writes, stats } = applyLoc(loaded, { ...catalog, locale });
      if (writes.length === 0) { console.log("no translations to import"); return 0; }
      if (!commitWrites(writes)) return 1;
      console.log(`imported ${stats.updated} string(s) for ${locale} across ${stats.files} scene(s)`);
      return 0;
    }

    case "share-scopes": {
      // The CLI twin of Patterpad's File > Share Scopes with Other Tools (patterkit design/shared-scopes.md):
      // the same plan, so the two can't disagree about what the folder holds.
      const loaded = loadProject(positionals[0] ?? ".");
      if (loaded.gameScopes) { console.error(`share-scopes: this project already shares its scopes through ${loaded.gameScopes.dir}`); return 1; }
      const dir = typeof flags.at === "string" ? join(resolve(flags.at), GAME_SCOPES_DIR) : defaultGameScopesDir(loaded.root);
      const plan = planShareScopes(loaded.root, loaded.project, dir);
      if ("error" in plan) { console.error(`share-scopes: ${plan.error}`); return 1; }
      const named = plan.project.gameScopes !== loaded.project.gameScopes;
      const writes = [...plan.writes, ...(named ? [{ path: loaded.projectFile, content: canonicalStringify(plan.project) }] : [])];
      if (!commitWrites(writes)) return 1;
      for (const w of writes) console.log(`wrote ${w.path}`);
      if (named) console.log(`the project names the folder (gameScopes: ${plan.project.gameScopes}), since looking up from the project wouldn't find it`);
      return 0;
    }

    case "pack": {
      if (typeof flags.o !== "string") { console.error("pack: -o <file.patter> is required"); return 2; }
      if (!commitBinary(flags.o, await runPack(positionals[0] ?? "."))) return 1;
      console.log(`packed ${flags.o}`);
      return 0;
    }

    case "unpack": {
      const file = positionals[0];
      if (!file) { console.error("unpack: no <file.patter> given"); return 2; }
      if (typeof flags.o !== "string") { console.error("unpack: -o <dir> is required"); return 2; }

      if (flags.merge === true) {
        // Fold a RETURNED document's edits into the existing project at -o, using
        // the document we originally sent (--base) as the common ancestor.
        if (typeof flags.base !== "string") { console.error("unpack --merge: --base <sent.patter> is required"); return 2; }
        const res = await runUnpackMerge(readFileSync(file), readFileSync(flags.base), flags.o);
        // Warn BEFORE the writes, so it is the first thing on screen rather than buried above the
        // per-shard list. A warning, not a refusal: an id can legitimately differ (a fork, a reissued
        // id), and the author knows better than we do. See ProvenanceCheck for what this does not catch.
        if (!res.provenance.ok) {
          console.error("warning: these do not look like the same project");
          console.error(`  returned pack: ${res.provenance.returned ?? "(no manifest)"}`);
          console.error(`  base pack:     ${res.provenance.base ?? "(no manifest)"}`);
          console.error(`  project at -o: ${res.provenance.target ?? "(no project file)"}`);
          console.error("  merging anyway; expect spurious conflicts if the ancestor is wrong.");
        }
        if (!commitWrites([...res.writes, ...res.sidecars])) return 1;
        for (const s of res.shards) {
          const n = s.result ? s.result.conflicts.length : 0;
          console.log(`${s.added ? "added" : "merged"}: ${s.path}${n > 0 ? ` (${n} conflict(s))` : ""}`);
        }
        // Their World edit, taken to the game's shared file so the next save doesn't sync it away. The
        // returned pack's own copy of the game's scopes is never written: ours is the truth.
        if (res.gameScopes?.error) console.error(`warning: their World properties were not written to ${res.gameScopes.path}: ${res.gameScopes.error}`);
        else if (res.gameScopes) console.log(`game scopes: ${res.gameScopes.path} (their World properties)`);
        console.log(`\n${res.shards.length} shard(s) -> ${flags.o}; ${res.conflicts} conflict(s), ${res.warnings} warning(s)`);
        return res.conflicts > 0 ? 1 : 0;
      }

      const { shards, scopes } = await runUnpack(readFileSync(file), flags.o);
      if (!commitWrites([...shards, ...scopes])) return 1;
      for (const w of [...shards, ...scopes]) console.log(`unpacked: ${w.path}`);
      console.log(`\n${shards.length} shard(s)${scopes.length ? ` and ${scopes.length} game scopes file(s)` : ""} -> ${flags.o}`);
      return 0;
    }

    case "merge": {
      const [baseP, oursP, theirsP] = positionals;
      if (!baseP || !oursP || !theirsP) { console.error("merge: needs BASE OURS THEIRS"); return 2; }
      const src = parseThree(baseP, oursP, theirsP, "merge");
      if (!src) return 2;

      const typeFlag = typeof flags.type === "string" && flags.type !== "auto" ? (flags.type as MergeFileType) : undefined;
      let result;
      try {
        result = runMerge(src.base, src.ours, src.theirs, { type: typeFlag });
      } catch (e) {
        if (e instanceof UnsupportedMergeError) { console.error(`merge: ${e.message}`); return 2; }
        throw e;
      }

      if (flags.json === true) {
        console.log(JSON.stringify(result));
        return result.conflicts.length > 0 ? 1 : 0;
      }

      const text = canonicalStringify(result.merged);
      // No -o: stream to stdout (non-destructive). The git driver passes `-o %A`
      // so the result lands in the current file, with a conflict sidecar beside it.
      if (typeof flags.o !== "string") {
        process.stdout.write(text);
        if (result.conflicts.length > 0) {
          console.error(`${result.conflicts.length} conflict(s) (provisional OURS); pass -o to write a .patterconflict sidecar`);
          return 1;
        }
        return 0;
      }

      return writeMergeResult(result, flags.o, true);
    }

    case "mergetool": {
      // The sniff-and-dispatch wrapper (patter-merge.md §4): one global external
      // merge tool serves the whole depot. Patter source -> the structured merge;
      // anything else -> the team's normal tool (--fallback). Non-git VCSs pass
      // their four files in the order BASE THEIRS OURS OUT (Perforce / Plastic /
      // SVN all agree); git uses the per-path driver and calls `patter merge`.
      const [baseP, theirsP, oursP, outP] = positionals;
      if (!baseP || !theirsP || !oursP || !outP) { console.error("mergetool: needs BASE THEIRS OURS OUT"); return 2; }
      const fallback = typeof flags.fallback === "string" ? flags.fallback : undefined;

      if (isPatterSource(outP) || isPatterSource(oursP)) {
        const src = parseThree(baseP, oursP, theirsP, "mergetool");
        if (!src) return 2;
        try {
          return writeMergeResult(runMerge(src.base, src.ours, src.theirs), outP, false);
        } catch (e) {
          if (e instanceof UnsupportedMergeError) { console.error(`mergetool: ${e.message}`); return 2; }
          throw e;
        }
      }

      // Not a Patter file: hand the VCS's own arguments to the configured tool.
      // No shell - the four file paths are passed as separate argv entries, so
      // spaces/metacharacters in them are safe; the fallback may carry its own
      // flags (e.g. "code --wait --merge"), split off the command here.
      if (!fallback) { console.error(`mergetool: ${outP} is not Patter source and no --fallback configured`); return 2; }
      const [cmd, ...pre] = fallback.split(/\s+/).filter(Boolean);
      if (!cmd) { console.error("mergetool: empty --fallback"); return 2; }
      const r = spawnSync(cmd, [...pre, baseP, theirsP, oursP, outP], { stdio: "inherit" });
      return r.status ?? 1;
    }

    default:
      console.log(USAGE);
      return 2;
  }
}

// ---------------------------------------------------------------------------
// Editable script helpers
// ---------------------------------------------------------------------------

/** Who is doing this: --by, else the version-control user, else the OS user. */
function who(loaded: LoadedProject, by: string | boolean | string[] | undefined): string {
  if (typeof by === "string" && by.trim()) return by.trim();
  try { const u = currentUser(loaded.root); if (u) return u; } catch { /* no VCS user */ }
  return process.env["USER"] ?? process.env["USERNAME"] ?? "Patter";
}

/** --scene values (an id or a name, any case) to scene ids in project order; null after printing the miss. */
function resolveScenes(loaded: LoadedProject, wanted: string[]): string[] | null {
  const ids = new Set<string>();
  for (const w of wanted) {
    const scene = loaded.scenes.find((sc) => sc.id === w) ?? loaded.scenes.find((sc) => sc.name.toLowerCase() === w.toLowerCase());
    if (!scene) { console.error(`export-editable: no scene called '${w}' (scenes: ${loaded.scenes.map((sc) => sc.name).join(", ")})`); return null; }
    ids.add(scene.id);
  }
  return loaded.scenes.filter((sc) => ids.has(sc.id)).map((sc) => sc.id);
}

/** The import report, for a person reading a terminal. */
export function renderImportReport(plan: ImportPlan): string {
  const r = plan.report;
  const out: string[] = [];
  const h = plan.handoff;
  out.push(h ? `handoff ${h.id}${h.recipient ? ` (sent to ${h.recipient})` : ""}, exported ${h.createdAt.slice(0, 10)} by ${h.createdBy}` : `handoff ${r.handoffId ?? "(none found)"}`);
  if (r.refused) { out.push(`refused: ${r.refused}`); return out.join("\n"); }
  const c = r.counts;
  out.push(`${c.changed} suggestion(s), ${c.unchanged} unchanged, ${c.stale} out of date, ${c.comments} comment(s), ${c.problems} problem(s)`);
  for (const p of r.problems) out.push(`  [${p.severity}] ${p.message}${p.anchor ? ` (${p.anchor})` : ""}`);
  return out.join("\n");
}

/** One open suggestion on one line. */
function describeSuggestion(o: ReturnType<typeof listOpenSuggestions>[number]): string {
  const s = o.suggestion;
  const parts: string[] = [];
  if (s.proposedCut) parts.push("cut this line");
  if (s.proposed !== s.baseline) parts.push(`"${s.baseline}" -> "${s.proposed}"`);
  if (s.proposedCharacter !== undefined) parts.push(`speaker ${s.baselineCharacter || "(none)"} -> ${s.proposedCharacter}`);
  if (s.proposedDirection !== undefined) parts.push(`direction "${s.baselineDirection ?? ""}" -> "${s.proposedDirection}"`);
  const from = s.handoff ? ` [${s.handoff.id}]` : "";
  const stale = o.stale.length ? ` OUT OF DATE (${o.stale.join(", ")})` : "";
  return `${s.id} ${s.anchor} by ${s.author}${from}: ${parts.join("; ")}${stale}`;
}
