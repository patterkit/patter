// ---------------------------------------------------------------------------
// `patter` CLI - argv parsing, output, and exit codes ONLY (importable, so the
// parser and exit mapping are testable). All the work lives in @patterkit/ops
// (the shared, pure operations layer - Patterpad consumes the same functions).
//
// Flags are declared per command: a VALUED flag always consumes the next token
// (so `--seed -5` works) or takes its value inline (`--seed=-5`), a BOOLEAN
// flag never does (so `--check a.patterflow` cannot eat a file), and an unknown
// flag is an error rather than a silent no-op. Every token starting with `-`
// is a flag (`-` alone is a positional), so `-h` is never a project path.
// `<command> --help` prints that command's usage. Every usage error prints
// under one prefix, `usage: `, followed by the command's short form. Exit
// codes: 0 ok, 1 the operation found problems / failed, 2 usage. (The family's
// CLI conventions, shared with storyletengine.)
// ---------------------------------------------------------------------------

import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { canonicalStringify, parseSource } from "@patterkit/core";
import {
  loadProject, runValidate, runExport, runExportHtml, bundleOutputPath, besideBundlePath, runFormat, runPlay, renderPlay, runCoverage, renderCoverageText, proposeCoverageDrivers, runInit, runResolve, runPropertyUsage,
  runReport, renderReportText, runReportXlsx, runPack, runUnpack, runUnpackMerge, runMerge, planBuild, UnsupportedMergeError, SHARD_EXTENSIONS, CONFLICT_SIDECAR,
  extractLoc, applyLoc, catalogToJson, jsonToCatalog, catalogToPo, poToCatalog, catalogToXlsx, xlsxToCatalog,
  runVoiceScript, voiceScriptToXlsx, runScriptDoc, scriptToDocx, scriptToPdf, scanAudioStatus,
  planShareScopes, defaultGameScopesDir, GAME_SCOPES_DIR,
  exportEditableScript, readEditableDocx, planEditableImport, listOpenSuggestions, applySuggestionDecisions,
} from "@patterkit/ops";
import type { InitVcs, BundlePosture, MergeFileType, MergeResult, PlannedWrite, LocCatalog, ImportPlan, LoadedProject } from "@patterkit/ops";
import { createHash } from "node:crypto";

/** A file the structured merger handles (source shards only - not bundle / document). */
const isPatterSource = (path: string): boolean => SHARD_EXTENSIONS.some((ext) => path.endsWith(ext));

/**
 * Write a merge result to `out` (canonical source) + a `.patterconflict` sidecar when there are
 * conflicts; a clean merge clears any stale sidecar. Returns the exit code (0 clean, 1 conflicts).
 * Shared by `merge -o` and `mergetool`.
 *
 * PLAIN fs, deliberately outside the VC layer: as a VCS merge driver this runs while the VCS holds its
 * own locks (git's index.lock), and `out` is usually the VCS's temporary file, not a source-tree shard,
 * so staging it would be wrong even where it worked. The sidecar belongs beside the REAL file
 * (`realPath`, git's %P), not the temporary one, where nothing would ever look for it.
 */
function writeMergeResult(result: MergeResult, out: string, realPath: string, announce: boolean): number {
  const write = (path: string, content: string): boolean => {
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
      return true;
    } catch (e) {
      console.error(`write failed: ${path}: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  };
  const sidecar = `${realPath}${CONFLICT_SIDECAR}`;
  // The sidecar before the merged file: a merged file whose sidecar never landed is a conflict resolved
  // to ours without a word.
  if (result.conflicts.length > 0) {
    const body = JSON.stringify({ type: result.type, conflicts: result.conflicts, warnings: result.warnings }, null, 2) + "\n";
    if (!write(sidecar, body)) return 1;
  }
  if (!write(out, canonicalStringify(result.merged))) return 1;
  for (const w of result.warnings) console.error(`warning: ${w.message} (${w.path})`);
  if (result.conflicts.length > 0) {
    console.error(`${result.conflicts.length} conflict(s) - wrote ${out} (provisional OURS) + ${sidecar}`);
    return 1;
  }
  if (existsSync(sidecar)) rmSync(sidecar);
  if (announce) console.log(`merged ${out} (${result.type}, no conflicts)`);
  return 0;
}
import { writeTextFiles, writeBinaryFile, currentUser } from "@wildwinter/simple-vc-lib";
// The number comes from the MANIFEST, inlined by both shipping paths (tsup and Bun --compile), rather
// than a hand-kept constant. A release is tagged from the manifest, so a constant that drifts from it
// drifts from the name of the file the user downloaded, which is the one thing they can still read.
import pkg from "../package.json" with { type: "json" };

export const USAGE = `patter - Patter CLI

Usage:
  patter --version                Print the version (also -v / version)
  patter --help                   Print this usage (also -h / help)
  patter <command> --help         Print one command's usage (also help <command>)
  patter init    [dir]            Scaffold a new project (the <dir>.patter folder, starter scene, VCS config)
                 [--name X] [--vcs git|perforce|plastic|svn] [--bundle commit|ignore]
  patter validate [path]          Validate a project (structural + expressions + encoding + bundle)
  patter format  [paths...]       Rewrite Patter source (shards, or a project folder's) to canonical form;
                                  anything else is left alone (alias: fmt)
                 [--check]         Report what would change; write nothing (for CI)
  patter export  [path] [-o file] Compile to a .patterc bundle (default: ../patter-dist/<name>.patterc,
                                  beside the project; -o - for stdout). Refuses content validate calls broken
                 [--ids]          IDs-only build: ship no strings; the game localises from beat IDs
                 [--source-debug] IDs-only but embed the source language for debug playback (not shippable)
                 [--allow-invalid] Build even when validate finds errors in the content (not shippable)
  patter export-html [path] [-o file]  A single self-contained, playable .html (runtime + story inlined;
                 send it to anyone, opens in any browser; default: beside the bundle; -o - for stdout)
  patter play    [path]           Play a project through Patterplay and print the transcript
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
  patter loc-export [path] -o file  Export strings for translation (-o - streams json or po)
                 --format json|xlsx|po  [--locale xx]   (no --locale = a blank template / POT)
  patter loc-import <file> [path]  Import translated strings back into the project
                 [--locale xx]     (format by extension; --locale overrides the file's)
  patter export-script [path] [-o file.pdf|.docx]  Readable screenplay of the script + flow
                 (dialogue, narration, choices, jumps). Format from the extension; default
                 beside the bundle, as .pdf. PDF uses built-in fonts (Latin); use .docx for full Unicode.
  patter voice-export [path] -o file.xlsx  The voice (VO) recording script
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
                 [--path realfile]  (where the conflict sidecar belongs when -o is a VCS
                                     temporary file: git's %P)
  patter mergetool BASE THEIRS OURS OUT  VCS merge-tool wrapper: Patter source -> structured merge,
                 [--fallback cmd]        else hand the files to your normal tool (one global tool fits all)

Exit codes: 0 ok, 1 the operation found problems, 2 usage. "merge" and "mergetool" also map
an unreadable INPUT to 2, so a version-control driver can tell "these files are not Patter
source" from "the merge found conflicts" and fall back to its own behaviour.
`;

// Per-command flag declarations: anything else is an error. `positionals` is the most a command takes,
// so a stray word is a usage error rather than silently dropped.
interface FlagSpec { boolean: string[]; valued: string[]; repeatable?: string[]; positionals: number }
const FLAGS = {
  init: { boolean: [], valued: ["name", "vcs", "bundle"], positionals: 1 },
  validate: { boolean: [], valued: [], positionals: 1 },
  format: { boolean: ["check"], valued: [], positionals: Infinity },
  export: { boolean: ["ids", "source-debug", "allow-invalid"], valued: ["o"], positionals: 1 },
  "export-html": { boolean: [], valued: ["o"], positionals: 1 },
  play: { boolean: [], valued: ["scene", "block", "choices", "seed"], positionals: 1 },
  coverage: { boolean: ["json", "fail-on-gap", "propose"], valued: ["runs", "max-steps", "seed", "scene", "block", "order"], positionals: 1 },
  resolve: { boolean: [], valued: [], positionals: 2 },
  usage: { boolean: ["json"], valued: [], positionals: 2 },
  report: { boolean: ["json"], valued: ["xlsx"], positionals: 1 },
  "loc-export": { boolean: [], valued: ["format", "o", "locale"], positionals: 1 },
  "loc-import": { boolean: [], valued: ["locale"], positionals: 2 },
  "voice-export": { boolean: ["all"], valued: ["o"], positionals: 1 },
  "export-script": { boolean: [], valued: ["o"], positionals: 1 },
  "export-editable": { boolean: ["status", "cast", "all-notes"], valued: ["o", "recipient", "by"], repeatable: ["scene"], positionals: 1 },
  "import-editable": { boolean: ["dry-run", "direct", "strict-quotes"], valued: ["as", "by"], positionals: 2 },
  suggestions: { boolean: ["accept-clean", "json"], valued: ["handoff"], positionals: 1 },
  "share-scopes": { boolean: [], valued: ["at"], positionals: 1 },
  pack: { boolean: [], valued: ["o"], positionals: 1 },
  unpack: { boolean: ["merge"], valued: ["o", "base"], positionals: 1 },
  merge: { boolean: ["json"], valued: ["o", "type", "path"], positionals: 3 },
  mergetool: { boolean: [], valued: ["fallback"], positionals: 4 },
} satisfies Record<string, FlagSpec>;

type Command = keyof typeof FLAGS;
/** `in` would answer for `toString` too; only the table's own keys are commands. */
const isCommand = (name: string): name is Command => Object.hasOwn(FLAGS, name);
const ALIASES: Record<string, Command> = { fmt: "format", stats: "report" };

/** Each command's whole short form, printed after every usage error so the fix is on screen. */
const SHORT: Record<Command, string> = {
  init: "init [dir] [--name X] [--vcs git|perforce|plastic|svn] [--bundle commit|ignore]",
  validate: "validate [path]",
  format: "format <paths...> [--check]",
  export: "export [path] [-o FILE] [--ids | --source-debug] [--allow-invalid]",
  "export-html": "export-html [path] [-o FILE]",
  play: "play [path] [--scene id] [--block id] [--choices a,b,c] [--seed N]",
  coverage: "coverage [path] [--runs N] [--max-steps M] [--seed S] [--scene id] [--block id] [--order least|script] [--json] [--fail-on-gap] [--propose]",
  resolve: "resolve <query> [path]",
  usage: "usage <query> [path] [--json]",
  report: "report [path] [--xlsx FILE] [--json]",
  "loc-export": "loc-export [path] -o FILE --format json|xlsx|po [--locale xx]",
  "loc-import": "loc-import <file> [path] [--locale xx]",
  "voice-export": "voice-export [path] -o FILE.xlsx [--all]",
  "export-script": "export-script [path] [-o FILE.pdf|FILE.docx]",
  "export-editable": "export-editable [path] -o FILE.docx [--scene name]... [--recipient X] [--status] [--cast] [--all-notes] [--by name]",
  "import-editable": "import-editable <file.docx> [path] [--dry-run] [--direct] [--as name] [--by name] [--strict-quotes]",
  suggestions: "suggestions [path] [--handoff H-XXXX] [--accept-clean | --json]",
  "share-scopes": "share-scopes [path] [--at DIR]",
  pack: "pack [path] -o FILE",
  unpack: "unpack <file> -o DIR [--merge --base SENT.patterpack]",
  merge: "merge BASE OURS THEIRS [-o out | --json] [--type flow|loc|authoring|project] [--path realfile]",
  mergetool: "mergetool BASE THEIRS OURS OUT [--fallback cmd]",
};

/** Flags that cannot be used together: both at once is a usage error, not a silent win for whichever the
 *  handler happened to read first. */
const EXCLUSIVE: Partial<Record<Command, [string, string][]>> = {
  export: [["ids", "source-debug"]],
  merge: [["json", "o"]],
  suggestions: [["json", "accept-clean"]],
};

/** One command's block of the usage text, for `<command> --help` and `help <command>`: read out of USAGE,
 *  so there is one text to keep right. */
export function commandUsage(command: Command): string {
  const lines = USAGE.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`  patter ${command} `));
  let end = start + 1;
  while (end < lines.length && /^ {3,}\S/.test(lines[end]!)) end++;
  return ["Usage:", ...lines.slice(start, end)].join("\n");
}

/** A usage error, exit 2: each problem on a line, then the command's whole short form, all of it under
 *  the one prefix. */
function usage(command: Command, ...problems: string[]): 2 {
  for (const problem of problems) console.error(`usage: ${problem}`);
  console.error(`usage: patter ${SHORT[command]}`);
  return 2;
}

export interface ParsedArgs {
  positionals: string[];
  /** A repeatable flag (`--scene a --scene b`) collects its values in order. */
  flags: Record<string, string | boolean | string[]>;
  /** Usage problems (unknown flag, missing value); non-empty means exit 2. */
  errors: string[];
}

export function parseArgs(command: string, args: string[]): ParsedArgs {
  const spec: FlagSpec = isCommand(command) ? FLAGS[command] : { boolean: [], valued: [], positionals: Infinity };
  const positionals: string[] = [];
  const flags: Record<string, string | boolean | string[]> = {};
  const errors: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const token = args[i]!;
    if (!token.startsWith("-") || token === "-") {
      positionals.push(token);
      continue;
    }
    // `--flag=value`: split at the first `=`, so a value may hold more of them.
    const eq = token.startsWith("--") ? token.indexOf("=") : -1;
    const shown = eq > 0 ? token.slice(0, eq) : token;
    const key = shown.replace(/^--?/, "");
    const inline = eq > 0 ? token.slice(eq + 1) : undefined;
    if (spec.boolean.includes(key)) {
      if (inline !== undefined) errors.push(`${shown} takes no value`);
      else flags[key] = true;
    } else if (spec.valued.includes(key) || spec.repeatable?.includes(key)) {
      const value = inline ?? args[++i];
      if (value === undefined || value === "") errors.push(`${shown} needs a value`);
      else if (spec.repeatable?.includes(key)) flags[key] = [...((flags[key] as string[] | undefined) ?? []), value];
      else flags[key] = value;
    } else {
      errors.push(`unknown flag '${shown}' for '${command}'`);
    }
  }
  if (positionals.length > spec.positionals) {
    errors.push(`unexpected argument${positionals.length - spec.positionals > 1 ? "s" : ""}: ${positionals.slice(spec.positionals).join(" ")}`);
  }
  for (const [a, b] of (isCommand(command) ? EXCLUSIVE[command] : undefined) ?? []) {
    if (flags[a] !== undefined && flags[b] !== undefined) errors.push(`${a === "o" ? "-o" : `--${a}`} and ${b === "o" ? "-o" : `--${b}`} cannot be used together`);
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

/** Write one binary artifact (xlsx / pack) through the VCS, reporting a refusal. Buffer twin of commitWrites,
 *  and like it makes the folder first: `patter export-script` on a project with no output folder yet failed. */
function commitBinary(path: string, buffer: Parameters<typeof writeBinaryFile>[1]): boolean {
  try { mkdirSync(dirname(resolve(path)), { recursive: true }); } catch { /* the write below reports it */ }
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
  // Three spellings, because people try all three. A standalone binary has no package.json beside it and
  // was not installed by npm, so without this there is no way to ask a downloaded `patter` what it is.
  if (cmd === "--version" || cmd === "-v" || cmd === "version") { console.log(pkg.version); return 0; }
  // `help <command>`: that command's usage, as `<command> --help` gives it.
  if (cmd === "help" && rest[0] !== undefined) {
    const asked = ALIASES[rest[0]] ?? rest[0];
    if (!isCommand(asked)) { console.error(`usage: unknown command "${rest[0]}" (patter --help lists them)`); return 2; }
    console.log(commandUsage(asked));
    return 0;
  }
  // Asking for help is not a usage error: exit 0.
  if (cmd === undefined || cmd === "--help" || cmd === "-h" || cmd === "help") { console.log(USAGE); return 0; }
  const canonical = ALIASES[cmd] ?? cmd;
  if (!isCommand(canonical)) { console.error(`usage: unknown command "${cmd}" (patter --help lists them)`); return 2; }
  if (rest.includes("--help") || rest.includes("-h")) { console.log(commandUsage(canonical)); return 0; }
  const { positionals, flags, errors } = parseArgs(canonical, rest);
  if (errors.length > 0) return usage(canonical, ...errors);

  try {
    return await run(canonical, positionals, flags);
  } catch (e) {
    console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

async function run(cmd: Command, positionals: string[], flags: Record<string, string | boolean | string[]>): Promise<number> {
  switch (cmd) {
    case "init": {
      const vcs = typeof flags.vcs === "string" ? (flags.vcs as InitVcs) : undefined;
      if (vcs && !["git", "perforce", "plastic", "svn"].includes(vcs)) {
        return usage("init", `unknown --vcs '${vcs}' (git | perforce | plastic | svn)`);
      }
      const bundle = typeof flags.bundle === "string" ? (flags.bundle as BundlePosture) : undefined;
      if (bundle && !["commit", "ignore"].includes(bundle)) {
        return usage("init", `unknown --bundle '${bundle}' (commit | ignore)`);
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
      // All or nothing, and the project file last (runInit's order): a scaffold that half landed would
      // refuse every rerun on the files it left.
      if (!commitWrites(result.writes, { allOrNothing: true })) return 1;
      for (const w of result.writes) console.log(`created: ${w.path}`);
      console.log(`\n"${result.name}" is ready - try: patter play ${dir}`);
      return 0;
    }

    case "resolve": {
      const query = positionals[0];
      if (!query) return usage("resolve", "no query given");
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
      if (!query) return usage("usage", "no property given (e.g. @gold, world.threat, \"faction rebels\")");
      const loaded = loadProject(positionals[1] ?? ".");
      const entries = runPropertyUsage(loaded, query);
      if (flags.json === true) { console.log(JSON.stringify(entries)); return 0; }
      if (entries.length === 0) { console.error(`no usages of '${query}'`); return 0; } // unused is a valid answer
      for (const e of entries) console.log(`[${e.kind}] ${e.text ?? ""}   ${e.location.join(" > ")}  (${e.id})`);
      return 0;
    }

    case "validate": {
      const loaded = loadProject(positionals[0] ?? ".");
      const { structural, conditions, interpolation, hygiene, staleBundles, unresolvedMerges, orphans, reachability, gameScopes, localisation, ok } = runValidate(loaded);
      // A warning (another tool's scope, say) is printed as one and never fails the run.
      const warn = (i: { severity: "error" | "warning" }): string => (i.severity === "warning" ? "warning: " : "");
      for (const i of structural) console.error(`  [${i.code}] ${i.severity === "warning" ? "warning: " : ""}${i.message}`);
      for (const i of conditions) console.error(`  [${i.field}] ${i.nodeId}: ${warn(i)}${i.message}  (${i.src})`);
      for (const i of interpolation) console.error(`  [${i.field}] ${i.nodeId}: ${warn(i)}${i.message}  (${i.src})`);
      for (const i of hygiene) console.error(`  [hygiene] ${i.file}: ${i.message}`);
      for (const i of staleBundles) console.error(`  [stale-bundle] ${i.file}: ${i.message}`);
      for (const i of unresolvedMerges) console.error(`  [unresolved-merge] ${i.file}: ${i.message}`);
      for (const i of orphans) console.error(`  [not-in-project] ${i.message}`); // the message names the file
      for (const i of gameScopes) console.error(`  [game-scopes] ${i.file}: ${warn(i)}${i.message}`);
      for (const i of localisation) console.error(`  [localisation] ${i.file}: ${warn(i)}${i.message}`);
      // Advisory, and outside `ok` and the count: a gate whose writer is not authored yet is the normal
      // state mid-work, and must never fail a build.
      for (const i of reachability) console.error(`  [unreachable] ${i.nodeId}: ${i.message}  (${i.src})`);
      const isError = (i: { severity: "error" | "warning" }): boolean => i.severity === "error";
      const structuralWarnings = structural.filter((i) => i.severity === "warning").length;
      const warnings = reachability.length + structuralWarnings + [...conditions, ...interpolation, ...gameScopes, ...localisation].filter((i) => !isError(i)).length;
      const count = structural.length - structuralWarnings + [...conditions, ...interpolation, ...gameScopes, ...localisation].filter(isError).length
        + hygiene.length + staleBundles.length + unresolvedMerges.length + orphans.length;
      // A warning is not an issue, but "no issues" printed directly under one reads as a contradiction,
      // so say what was said.
      const advisory = warnings ? `, ${warnings} warning(s) above` : "";
      if (ok) console.log(`ok - ${loaded.scenes.length} scene(s), no issues${advisory}`);
      else console.error(`\n${count} issue(s)${advisory}`);
      return ok ? 0 : 1;
    }

    case "format": {
      if (positionals.length === 0) return usage("format", "no files given");
      const check = flags.check === true;
      const results = runFormat(positionals);
      // Anything that is not a shard is left alone (the bundle and the scopes files must stay strict JSON);
      // said only when nothing named was Patter source, so `format $(git ls-files)` stays quiet.
      if (results.every((r) => r.skipped)) { console.error("format: no Patter source among the files given (.patterflow, .patterloc, .patterx, .patterproj)"); return 0; }
      const changed = results.filter((r) => r.changed);
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
      const allowInvalid = flags["allow-invalid"] === true;
      // -o -: the bundle alone, to stdout, for pipelines (no scopes or audio manifest written).
      if (flags.o === "-") { process.stdout.write(canonicalStringify(runExport(loaded, { allowInvalid }), { trailingComma: false })); return 0; }
      // No -o: the project's bundle path (export.bundle, else the sibling patter-dist/ Patterpad writes
      // too), so `patter export` alone produces the artifact and validate's staleness gate knows where to
      // find it (spec §11). The plan is the one Patterpad's Build commits: the bundle, the game's scopes
      // file when it changed, and the audio manifest under Audio Folders.
      const plan = planBuild(loaded, { allowInvalid, ...(typeof flags.o === "string" ? { bundlePath: flags.o } : {}) });
      if (!commitWrites(plan.writes)) return 1;
      for (const w of plan.writes) console.log(`wrote ${w.path}`);
      return 0;
    }

    case "export-html": {
      const loaded = loadProject(positionals[0] ?? ".");
      const html = runExportHtml(loaded);
      if (flags.o === "-") { process.stdout.write(html); return 0; } // stdout for pipelines
      const target = typeof flags.o === "string" ? flags.o : besideBundlePath(loaded, ".html");
      if (resolve(target) === bundleOutputPath(loaded)) return usage("export-html", `-o ${target} is the project's bundle`);
      if (!commitWrites([{ path: target, content: html }])) return 1;
      console.log(`wrote ${target}`);
      return 0;
    }

    case "play": {
      let seed: number | undefined;
      if (typeof flags.seed === "string") {
        seed = Number(flags.seed);
        if (!Number.isInteger(seed)) return usage("play", `--seed '${flags.seed}' is not a whole number`);
      }
      const loaded = loadProject(positionals[0] ?? ".");
      const result = runPlay(loaded, {
        scene: typeof flags.scene === "string" ? flags.scene : undefined,
        block: typeof flags.block === "string" ? flags.block : undefined,
        choices: typeof flags.choices === "string" ? flags.choices.split(",") : undefined,
        seed,
      });
      for (const line of renderPlay(result)) console.log(line);
      // A playthrough that didn't reach the end (the engine stopped it, or the step bound), or
      // that hit a condition or effect that failed, is a failure - `play` exists
      // to drive flows to completion in CI, and the engine plays through a failing
      // expression rather than stopping, so this is where CI hears about it.
      return result.outcome === "end" && !result.events.some((e) => e.type === "error") ? 0 : 1;
    }

    case "coverage": {
      // Validate the numeric flags up front: a run count or step bound is a whole number of at least one
      // (`--runs 0` ran nothing and reported every beat never reached), and a seed a whole number.
      const numbers: Record<string, number | undefined> = {};
      for (const [flag, min] of [["runs", 1], ["max-steps", 1], ["seed", -Infinity]] as const) {
        if (typeof flags[flag] !== "string") continue;
        const n = Number(flags[flag]);
        if (!Number.isInteger(n) || n < min) {
          return usage("coverage", `--${flag} '${flags[flag]}' is not ${min === 1 ? "a whole number of at least 1" : "a whole number"}`);
        }
        numbers[flag] = n;
      }
      const order = flags.order ?? "least";
      if (order !== "least" && order !== "script") return usage("coverage", `--order '${order}' is not least or script`);
      const loaded = loadProject(positionals[0] ?? ".");
      // --propose: print auto-proposed @world input drivers (from the conditions) instead of running.
      // The author pastes the chosen ones into the project's `coverageDrivers`.
      if (flags.propose === true) {
        const ignored = ["runs", "max-steps", "seed", "scene", "block", "order", "fail-on-gap"].filter((f) => flags[f] !== undefined);
        if (ignored.length) console.error(`warning: --propose runs nothing, so ${ignored.map((f) => `--${f}`).join(", ")} ${ignored.length > 1 ? "are" : "is"} ignored`);
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
      if (flags.xlsx === "-") return usage("report", "--xlsx - is not supported: a spreadsheet is not text (--json streams the report)");
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
      if (!["json", "xlsx", "po"].includes(format)) return usage("loc-export", "--format json|xlsx|po is required");
      if (typeof flags.o !== "string") return usage("loc-export", "-o <file> is required");
      const loaded = loadProject(positionals[0] ?? ".");
      const locale = typeof flags.locale === "string" ? flags.locale : undefined; // omitted = blank template / POT
      const catalog = extractLoc(loaded, { locale });
      if (format === "xlsx") {
        if (flags.o === "-") return usage("loc-export", "-o - is not supported for --format xlsx: a spreadsheet is not text");
        if (!commitBinary(flags.o, await catalogToXlsx(catalog))) return 1;
      } else {
        const content = format === "json" ? catalogToJson(catalog) : catalogToPo(catalog);
        if (flags.o === "-") { process.stdout.write(content); return 0; } // stdout for pipelines
        if (!commitWrites([{ path: flags.o, content }])) return 1;
      }
      const n = catalog.entries.length;
      console.log(`wrote ${flags.o} - ${n} string(s)${locale ? `, ${locale}` : " (template)"}`);
      return 0;
    }

    case "export-script": {
      const loaded = loadProject(positionals[0] ?? ".");
      if (flags.o === "-") return usage("export-script", "-o - is not supported: a PDF or Word file is not text");
      const target = typeof flags.o === "string" ? flags.o : besideBundlePath(loaded, ".pdf");
      if (resolve(target) === bundleOutputPath(loaded)) return usage("export-script", `-o ${target} is the project's bundle`);
      const isDocx = /\.docx$/i.test(target);
      if (!isDocx && !/\.pdf$/i.test(target)) return usage("export-script", "-o must end in .pdf or .docx");
      const doc = runScriptDoc(loaded);
      const buf = isDocx ? await scriptToDocx(doc) : await scriptToPdf(doc);
      if (!commitBinary(target, buf)) return 1;
      console.log(`wrote ${target}`);
      return 0;
    }

    case "export-editable": {
      if (typeof flags.o !== "string") return usage("export-editable", "-o <file.docx> is required");
      if (!/\.docx$/i.test(flags.o)) return usage("export-editable", "-o must end in .docx");
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
      if (!file) return usage("import-editable", "no file given");
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
      if (flags.json === true) { console.log(JSON.stringify(open)); return 0; } // compact, as every --json is
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
      if (typeof flags.o !== "string") return usage("voice-export", "-o <file.xlsx> is required");
      if (flags.o === "-") return usage("voice-export", "-o - is not supported: a spreadsheet is not text");
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
      if (!file) return usage("loc-import", "no file given");
      const loaded = loadProject(positionals[1] ?? ".");
      const ext = file.slice(file.lastIndexOf(".")).toLowerCase();
      let catalog: LocCatalog;
      if (ext === ".json") catalog = jsonToCatalog(readFileSync(file, "utf8"));
      else if (ext === ".po" || ext === ".pot") catalog = poToCatalog(readFileSync(file, "utf8"));
      else if (ext === ".xlsx") catalog = await xlsxToCatalog(readFileSync(file));
      else return usage("loc-import", `unknown format '${ext}' (.json | .po | .xlsx)`);
      const locale = typeof flags.locale === "string" ? flags.locale : catalog.locale; // --locale overrides the file's
      if (!locale) return usage("loc-import", "no locale (the file carries none; pass --locale xx)");
      if (locale === loaded.project.locales.default) return usage("loc-import", `'${locale}' is the source locale - nothing to import`);
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
      if (typeof flags.o !== "string") return usage("pack", "-o <file.patterpack> is required");
      if (flags.o === "-") return usage("pack", "-o - is not supported: a pack is not text");
      if (!commitBinary(flags.o, await runPack(positionals[0] ?? "."))) return 1;
      console.log(`packed ${flags.o}`);
      return 0;
    }

    case "unpack": {
      const file = positionals[0];
      if (!file) return usage("unpack", "no <file.patterpack> given");
      if (typeof flags.o !== "string") return usage("unpack", "-o <dir> is required");
      if (flags.o === "-") return usage("unpack", "-o - is not supported: unpack writes a folder");

      if (flags.merge === true) {
        // Fold a RETURNED document's edits into the existing project at -o, using
        // the document we originally sent (--base) as the common ancestor.
        if (typeof flags.base !== "string") return usage("unpack", "--merge needs --base <sent.patterpack>");
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
        // Sidecars first: a merged shard whose sidecar never landed is a conflict resolved to ours without a word.
        if (!commitWrites([...res.sidecars, ...res.writes])) return 1;
        for (const s of res.shards.filter((sh) => sh.changed)) {
          const n = s.result ? s.result.conflicts.length : 0;
          console.log(`${s.added ? "added" : "merged"}: ${s.path}${n > 0 ? ` (${n} conflict(s))` : ""}`);
        }
        for (const name of res.other) console.error(`warning: not unpacked (not a project file): ${name}`);
        // Their World edit, taken to the game's shared file so the next save doesn't sync it away. The
        // returned pack's own copy of the game's scopes is never written: ours is the truth.
        if (res.gameScopes?.error) console.error(`warning: their World properties were not written to ${res.gameScopes.path}: ${res.gameScopes.error}`);
        else if (res.gameScopes) console.log(`game scopes: ${res.gameScopes.path} (their World properties)`);
        const changed = res.shards.filter((sh) => sh.changed).length;
        console.log(`\n${changed} of ${res.shards.length} shard(s) changed in ${flags.o}; ${res.conflicts} conflict(s), ${res.warnings} warning(s)`);
        return res.conflicts > 0 ? 1 : 0;
      }

      const { shards, scopes, other } = await runUnpack(readFileSync(file), flags.o);
      if (!commitWrites([...shards, ...scopes])) return 1;
      for (const w of [...shards, ...scopes]) console.log(`unpacked: ${w.path}`);
      for (const name of other) console.error(`warning: not unpacked (not a project file): ${name}`);
      console.log(`\n${shards.length} shard(s)${scopes.length ? ` and ${scopes.length} game scopes file(s)` : ""} -> ${flags.o}`);
      return 0;
    }

    case "merge": {
      const [baseP, oursP, theirsP] = positionals;
      if (!baseP || !oursP || !theirsP) return usage("merge", "needs BASE OURS THEIRS");
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
      // No -o: stream to stdout (non-destructive). The git driver passes `-o %A --path %P`
      // so the result lands in git's file, with a conflict sidecar beside the real shard.
      if (typeof flags.o !== "string" || flags.o === "-") {
        process.stdout.write(text);
        if (result.conflicts.length > 0) {
          console.error(`${result.conflicts.length} conflict(s) (provisional OURS); pass -o to write a .patterconflict sidecar`);
          return 1;
        }
        return 0;
      }

      return writeMergeResult(result, flags.o, typeof flags.path === "string" ? flags.path : flags.o, true);
    }

    case "mergetool": {
      // The sniff-and-dispatch wrapper (patter-merge.md §4): one global external
      // merge tool serves the whole depot. Patter source -> the structured merge;
      // anything else -> the team's normal tool (--fallback). Non-git VCSs pass
      // their four files in the order BASE THEIRS OURS OUT (Perforce / Plastic /
      // SVN all agree); git uses the per-path driver and calls `patter merge`.
      const [baseP, theirsP, oursP, outP] = positionals;
      if (!baseP || !theirsP || !oursP || !outP) return usage("mergetool", "needs BASE THEIRS OURS OUT");
      const fallback = typeof flags.fallback === "string" ? flags.fallback : undefined;

      if (isPatterSource(outP) || isPatterSource(oursP)) {
        const src = parseThree(baseP, oursP, theirsP, "mergetool");
        if (!src) return 2;
        try {
          return writeMergeResult(runMerge(src.base, src.ours, src.theirs), outP, outP, false);
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
      if (!cmd) return usage("mergetool", "empty --fallback");
      const r = spawnSync(cmd, [...pre, baseP, theirsP, oursP, outP], { stdio: "inherit" });
      // A tool that could not start (not installed, not on PATH) has no status: say so, or the merge just fails.
      if (r.error) { console.error(`mergetool: could not run the fallback '${cmd}': ${r.error.message}`); return 1; }
      return r.status ?? 1;
    }

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
    if (!scene) { usage("export-editable", `no scene called '${w}' (scenes: ${loaded.scenes.map((sc) => sc.name).join(", ")})`); return null; }
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
