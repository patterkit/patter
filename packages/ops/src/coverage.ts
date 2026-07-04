// ---------------------------------------------------------------------------
// Narrative coverage (#159): run a story's flow headlessly N times, choosing a
// random eligible option at every choice, and tally how often each beat is
// reached. Surfaces DEAD content (never-reached beats) and gives a confidence
// number. Core lives here in ops; the `patter coverage` CLI and (later) a
// Patterpad dialog are thin front-ends over runCoverage - the same one-engine,
// two-front-ends shape as report / voice-export / loc.
//
// The unit tallied is the deliverable BEAT (line / text / action) only; choice-
// option prompts are excluded ("covered when offered / eligible / taken?" is
// ambiguous), but the content reached THROUGH an option is tallied normally, so
// a never-taken branch still reads 0%. The harness owns a single seeded PRNG
// used for both the random choice-picks and each run's engine seed, so a
// `--seed` makes the whole coverage run bit-for-bit reproducible.
// ---------------------------------------------------------------------------

import { exportBundle } from "@patterkit/compiler";
import { Engine } from "@patterkit/runtime";
import { walkNodes } from "@patterkit/model";
import type {
  Group, Snippet, Bundle, CompiledGroup, CompiledSnippet, CompiledEffect, Expression,
  CoverageDriver, ScalarValue,
} from "@patterkit/model";
import { deserialiseAst } from "@wildwinter/expr";
import type { ExprNode } from "@wildwinter/expr";
import type { LoadedProject } from "./load.js";
import { sourceStrings, resolveStart } from "./loaded-helpers.js";

export interface CoverageOptions {
  /** Number of random playthroughs (default 5000). */
  runs?: number;
  /** Per-run step cap, a divert-cycle guard (default 200). */
  maxSteps?: number;
  /** Seed for the harness PRNG; the whole run is reproducible from it (default 0). */
  seed?: number;
  /** Start-point override (else the project's authored start, else the first scene). */
  scene?: string;
  block?: string;
  /** Input drivers to feed host scopes (`@world`) across the run; defaults to the project's
   *  `coverageDrivers`. Pass `proposeCoverageDrivers(loaded)` to auto-drive from the conditions. */
  drivers?: CoverageDriver[];
}

/** How often a `recurring` driver re-rolls at a choice point (probability per choice). */
const CADENCE_PROB: Record<NonNullable<CoverageDriver["cadence"]>, number> = {
  rarely: 0.15,
  sometimes: 0.4,
  often: 0.8,
};

export interface CoverageHooks {
  /** Periodic progress (done runs, total). Called occasionally, not every run. */
  onProgress?: (done: number, total: number) => void;
  /** Cooperative cancel; checked between runs. The partial report is returned. */
  signal?: { readonly aborted: boolean };
}

/** One beat in the coverage population, with how often it was reached. */
export interface CoverageBeat {
  id: string;
  scene: string;
  kind: "line" | "text" | "gameEvent";
  character?: string;
  /** A short text preview for the results table ("(game event)" for game-event beats). */
  preview: string;
  /** Total hits across all runs (weighting). */
  hits: number;
  /** Distinct runs that reached it - the numerator for reach %. */
  reachedRuns: number;
  /** reachedRuns / runs-executed * 100; 0 iff never reached. */
  reachPct: number;
  /** Set on a never-reached beat that is gated on a host-scope ref (`@world.x`) nothing writes and no
   *  driver provides, i.e. it may just need an input, not be truly dead. Lists the offending refs. */
  needsInput?: string[];
}

/** A choice that ran DRY during the coverage run: at some point it had no takeable option and no eligible
 *  fallback, so it fell through silently and the flow carried on past it. This is easy to author by
 *  accident (all options gated and every condition happened to fail, or a re-enterable hub whose once-only
 *  options all got consumed) and the runtime hides it, so coverage surfaces it explicitly. */
export interface DryChoice {
  /** The choice group's id. */
  id: string;
  /** The scene the choice lives in. */
  scene: string;
  /** Distinct runs in which this choice ran dry (out of runs executed). */
  runs: number;
}

export interface CoverageReport {
  /** Runs actually executed (= requested, unless cancelled). */
  runs: number;
  maxSteps: number;
  seed: number;
  start: { scene?: string; block?: string };
  beats: CoverageBeat[];
  totals: { beats: number; covered: number; neverHit: number; coveragePct: number };
  /** How each run ended, for the summary header. */
  termination: { ended: number; capped: number; stalled: number; evalError: number };
  /** The input drivers actually applied this run (empty when none). */
  drivers: CoverageDriver[];
  /** Host-scope refs (`@world.x`) that gate a never-reached beat but nothing writes and no driver feeds:
   *  the "add an input?" candidates, deduped across the report. */
  unwrittenInputs: string[];
  /** Choices observed running dry (falling through with nothing takeable) during the run, most-frequent
   *  first. Empty when none. A dry choice is a likely dead-end-by-accident the runtime hides. */
  dryChoices: DryChoice[];
  cancelled: boolean;
}

/** mulberry32: the harness's own seeded PRNG (matches the runtime's family; only needs to be reproducible). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Host-scope (`@world`) analysis: drives auto-propose + the unwritten-input hint.
// ---------------------------------------------------------------------------

/** What the static scan over the compiled bundle yields about its host scopes. */
interface HostScopeAnalysis {
  /** Host-scope refs (`@world.x`) written by some `set` effect (so they are story-owned, not inputs). */
  written: Set<string>;
  /** Host-scope refs gating each beat (the beat's condition ancestry); keyed by beat id. */
  gatesByBeat: Map<string, Set<string>>;
  /** Per host-scope ref, the literal values seen compared against it: the auto-proposed driver pool. */
  proposals: Map<string, Set<ScalarValue>>;
}

/** Walk an ExprNode, collecting host-scope refs (`@token.name` for a declared token) and, for any
 *  comparison against a literal, proposing nearby values for that ref. */
function scanExpr(node: ExprNode, hostTokens: Set<string>, refs: Set<string>, proposals: Map<string, Set<ScalarValue>>): void {
  const refOf = (n: ExprNode): string | undefined =>
    n.kind === "scopedvar" && hostTokens.has(n.scope) ? `@${n.scope}.${n.name}` : undefined;
  const propose = (ref: string, v: ScalarValue) => (proposals.get(ref) ?? proposals.set(ref, new Set()).get(ref)!).add(v);

  switch (node.kind) {
    case "scopedvar": {
      const r = refOf(node);
      if (r) { refs.add(r); proposals.get(r) ?? proposals.set(r, new Set()); }
      break;
    }
    case "unary":
      scanExpr(node.operand, hostTokens, refs, proposals);
      break;
    case "binary": {
      // A `@world.x <op> literal` (either order) proposes values that straddle the threshold.
      for (const [a, b] of [[node.left, node.right], [node.right, node.left]] as const) {
        const ref = refOf(a);
        if (!ref) continue;
        if (b.kind === "number") { for (const d of [-1, 0, 1]) propose(ref, b.value + d); }
        else if (b.kind === "string") propose(ref, b.value);
        else if (b.kind === "bool") propose(ref, b.value);
      }
      scanExpr(node.left, hostTokens, refs, proposals);
      scanExpr(node.right, hostTokens, refs, proposals);
      break;
    }
    case "call":
      for (const a of node.args) scanExpr(a, hostTokens, refs, proposals);
      break;
    // bool / number / string / flagdelta literals carry no refs
  }
}

/** A `set` target string (`"@world.gold"`) → its host-scope ref, if it targets a declared host token. */
function targetHostRef(target: string, hostTokens: Set<string>): string | undefined {
  const m = /^@([A-Za-z_][\w]*)\.(.+)$/.exec(target);
  return m && hostTokens.has(m[1]!) ? `@${m[1]}.${m[2]}` : undefined;
}

/** Static scan of the compiled bundle: which host-scope refs are written, which gate each beat, and the
 *  literal pool each ref is compared against (for auto-proposed drivers). */
function analyzeHostScopes(bundle: Bundle, hostTokens: Set<string>): HostScopeAnalysis {
  const written = new Set<string>();
  const gatesByBeat = new Map<string, Set<string>>();
  const proposals = new Map<string, Set<ScalarValue>>();
  if (hostTokens.size === 0) return { written, gatesByBeat, proposals };

  const refsIn = (expr?: Expression): Set<string> => {
    const refs = new Set<string>();
    if (expr) scanExpr(deserialiseAst(expr.ast), hostTokens, refs, proposals);
    return refs;
  };
  const scanEffects = (effects?: CompiledEffect[]): void => {
    for (const e of effects ?? []) {
      const t = targetHostRef(e.target, hostTokens);
      if (t) written.add(t);
      refsIn(e.value); // RHS refs feed proposals
    }
  };

  const walk = (nodes: Array<CompiledGroup | CompiledSnippet>, gate: Set<string>): void => {
    for (const node of nodes) {
      const here = new Set([...gate, ...refsIn(node.condition)]);
      if (node.type === "group") {
        walk(node.children, here); // a group's prompt carries no expression
      } else {
        scanEffects(node.onEnter);
        scanEffects(node.onExit);
        for (const beat of node.beats ?? []) gatesByBeat.set(beat.id, here);
      }
    }
  };

  for (const scene of Object.values(bundle.scenes)) {
    scanEffects(scene.onEntry);
    for (const block of scene.blocks) walk(block.children, new Set());
  }
  return { written, gatesByBeat, proposals };
}

/**
 * Auto-propose coverage drivers by scanning the project's conditions for host-scope refs (`@world.x`)
 * and the literals they are compared against. Each proposed driver is `recurring`/`sometimes` and offers
 * the straddling values (e.g. `>= 50` → 49, 50, 51; an enum/bool → its members). Refs the story already
 * writes are skipped (they are covered for free). The author edits + saves the result as `coverageDrivers`.
 */
export function proposeCoverageDrivers(loaded: LoadedProject): CoverageDriver[] {
  const hostTokens = new Set((loaded.project.scopeRegistry?.scopes ?? []).map((s) => s.token));
  if (hostTokens.size === 0) return [];
  const bundle = exportBundle({ project: loaded.project, scenes: loaded.scenes, locales: loaded.locales });
  const { written, proposals } = analyzeHostScopes(bundle, hostTokens);

  // Fill in declared enum / bool ranges where the conditions gave no literals (e.g. a bare `if @world.flag`).
  const declByRef = new Map<string, { type: string; values?: string[] }>();
  for (const s of loaded.project.scopeRegistry?.scopes ?? []) {
    for (const d of s.declarations ?? []) declByRef.set(`@${s.token}.${d.name}`, { type: d.type, values: d.values });
  }

  const drivers: CoverageDriver[] = [];
  for (const [ref, pool] of proposals) {
    if (written.has(ref)) continue; // story-owned → covered for free
    const decl = declByRef.get(ref);
    let values = [...pool];
    if (values.length === 0 && decl) {
      if (decl.type === "boolean") values = [true, false];
      else if (decl.type === "enum" && decl.values) values = [...decl.values];
    }
    if (values.length === 0) continue;
    drivers.push({ ref, kind: "recurring", cadence: "sometimes", values: sortValues(values) });
  }
  return drivers.sort((a, b) => a.ref.localeCompare(b.ref));
}

/** Stable ordering for a proposed value pool (numbers ascending, then strings, then bools). */
function sortValues(values: ScalarValue[]): ScalarValue[] {
  return [...values].sort((a, b) => {
    if (typeof a === "number" && typeof b === "number") return a - b;
    return String(a).localeCompare(String(b));
  });
}

/**
 * Run narrative coverage over a loaded project. Pure (compiles once, then N
 * independent playthroughs); optional progress + cancel via `hooks`.
 */
export function runCoverage(loaded: LoadedProject, options: CoverageOptions = {}, hooks: CoverageHooks = {}): CoverageReport {
  const runs = options.runs ?? 5000;
  const maxSteps = options.maxSteps ?? 200;
  const seed = options.seed ?? 0;
  const start = resolveStart(loaded, options);

  // The population: every line / text / game-event beat, in document order. Group prompts (choice text) are
  // NOT part of it. The first-seen wins, so a duplicate id can't double-count.
  const src = sourceStrings(loaded);
  const order: string[] = [];
  const meta = new Map<string, { scene: string; kind: CoverageBeat["kind"]; character?: string; preview: string }>();
  const choiceScene = new Map<string, string>(); // choice group id -> scene id (for the dry-choice report)
  for (const scene of loaded.scenes) {
    for (const block of scene.blocks) {
      walkNodes<Group | Snippet>(block.children, (node) => {
        if (node.type === "group") {
          if (node.selector === "choice") choiceScene.set(node.id, scene.id);
          return;
        }
        for (const beat of (node as Snippet).beats ?? []) {
          if (meta.has(beat.id)) continue;
          order.push(beat.id);
          meta.set(beat.id, {
            scene: scene.id,
            kind: beat.kind,
            character: beat.kind === "line" ? beat.character : undefined,
            preview: beat.kind === "gameEvent" ? "(game event)" : (src[beat.id] ?? ""),
          });
        }
      });
    }
  }

  const hitCount = new Map<string, number>(order.map((id) => [id, 0]));
  const reachedRuns = new Map<string, number>(order.map((id) => [id, 0]));
  const dryRuns = new Map<string, number>(); // choice group id -> distinct runs it ran dry in
  const termination = { ended: 0, capped: 0, stalled: 0, evalError: 0 };

  const bundle = exportBundle({ project: loaded.project, scenes: loaded.scenes, locales: loaded.locales });
  const rng = mulberry32(seed);

  // Host-scope (`@world`) drivers + the static analysis behind the unwritten-input hint. Only drivers
  // into a DECLARED host scope with a non-empty pool are live (an undeclared scope can't be set).
  const hostTokens = new Set((loaded.project.scopeRegistry?.scopes ?? []).map((s) => s.token));
  const analysis = analyzeHostScopes(bundle, hostTokens);
  const drivers = (options.drivers ?? loaded.project.coverageDrivers ?? []).filter(
    (d) => d.values.length > 0 && hostTokens.has(d.ref.replace(/^@/, "").split(".")[0] ?? ""),
  );
  const initialDrivers = drivers.filter((d) => d.kind === "initial");
  const recurringDrivers = drivers.filter((d) => d.kind === "recurring");
  const drivenRefs = new Set(drivers.map((d) => d.ref));
  const pick = <T>(vals: T[]): T => vals[Math.floor(rng() * vals.length)]!;

  let executed = 0;
  let cancelled = false;

  for (let run = 0; run < runs; run++) {
    if (hooks.signal?.aborted) { cancelled = true; break; }

    // A fresh engine per run = independent shared state (world visits, once-only options, @scene temps all
    // reset), so the samples are unbiased. The per-run engine seed is drawn from the same harness stream.
    // The onDryChoice hook records which choices fell through this run (deduped per run below).
    const dryThisRun = new Set<string>();
    const engine = new Engine(bundle, {
      seed: Math.floor(rng() * 0x100000000),
      onDryChoice: (groupId) => dryThisRun.add(groupId),
    });
    // Initial drivers feed the host scope BEFORE the flow enters its start scene, so first-scene entry
    // gates see them. (No-op when there are none.)
    for (const d of initialDrivers) engine.setProperty(d.ref, pick(d.values));
    const flow = engine.openFlow("cov", { scene: start.scene, block: start.block });
    const seenThisRun = new Set<string>();
    let term: keyof typeof termination = "capped";

    try {
      for (let step = 0; step < maxSteps; step++) {
        const r = flow.advance();
        if (r.type === "end") { term = "ended"; break; }
        if (r.type === "choice") {
          // Recurring drivers re-roll at the choice point (per-cadence), so gated branches downstream of
          // a changing world value get exercised within a single run.
          for (const d of recurringDrivers) {
            if (rng() < CADENCE_PROB[d.cadence ?? "sometimes"]) engine.setProperty(d.ref, pick(d.values));
          }
          const eligible = r.options.filter((o) => o.eligible);
          if (eligible.length === 0) { term = "stalled"; break; } // a choice the player is stuck on
          flow.choose(eligible[Math.floor(rng() * eligible.length)]!.id);
          continue;
        }
        // line / text / action: a delivered content beat
        if (hitCount.has(r.id)) {
          hitCount.set(r.id, hitCount.get(r.id)! + 1);
          seenThisRun.add(r.id);
        }
      }
    } catch {
      term = "evalError"; // a condition / effect that threw: counted, never fatal
    }

    for (const id of seenThisRun) reachedRuns.set(id, reachedRuns.get(id)! + 1);
    for (const id of dryThisRun) dryRuns.set(id, (dryRuns.get(id) ?? 0) + 1);
    termination[term]++;
    executed++;
    if ((run & 0xff) === 0) hooks.onProgress?.(executed, runs); // ~every 256 runs
  }
  hooks.onProgress?.(executed, runs);

  const unwrittenInputs = new Set<string>();
  const beats: CoverageBeat[] = order.map((id) => {
    const m = meta.get(id)!;
    const reached = reachedRuns.get(id)!;
    // A never-reached beat gated on a host-scope ref that nothing writes AND no driver feeds may just
    // need an input: flag it so the author can add a driver rather than assume it is dead.
    let needsInput: string[] | undefined;
    if (reached === 0) {
      const gates = [...(analysis.gatesByBeat.get(id) ?? [])].filter((r) => !analysis.written.has(r) && !drivenRefs.has(r));
      if (gates.length) { needsInput = gates; for (const g of gates) unwrittenInputs.add(g); }
    }
    return {
      id, scene: m.scene, kind: m.kind, character: m.character, preview: m.preview,
      hits: hitCount.get(id)!,
      reachedRuns: reached,
      reachPct: executed ? (reached / executed) * 100 : 0,
      ...(needsInput ? { needsInput } : {}),
    };
  });
  const neverHit = beats.filter((b) => b.reachedRuns === 0).length;
  const covered = beats.length - neverHit;

  const dryChoices: DryChoice[] = [...dryRuns.entries()]
    .map(([id, r]) => ({ id, scene: choiceScene.get(id) ?? "", runs: r }))
    .sort((a, b) => b.runs - a.runs || a.id.localeCompare(b.id));

  return {
    runs: executed, maxSteps, seed, start, beats,
    totals: { beats: beats.length, covered, neverHit, coveragePct: beats.length ? (covered / beats.length) * 100 : 100 },
    termination, drivers, unwrittenInputs: [...unwrittenInputs].sort(), dryChoices, cancelled,
  };
}

/** Render a coverage report as the CLI's readable text: a summary, then a per-scene beat table with
 *  never-reached (0%) rows marked. */
export function renderCoverageText(report: CoverageReport, sceneName: (id: string) => string = (id) => id): string[] {
  const out: string[] = [];
  const t = report.totals;
  const pct = (n: number) => `${n.toFixed(0)}%`;
  out.push(`coverage: ${t.covered}/${t.beats} beats reached (${pct(t.coveragePct)})${t.neverHit ? ` - ${t.neverHit} never reached` : ""}`);
  out.push(`${report.runs} run(s) - ${report.maxSteps} max steps - seed ${report.seed}${report.cancelled ? " - CANCELLED" : ""}`);
  const term = report.termination;
  out.push(`runs ended: ${term.ended} reached the end, ${term.stalled} stalled, ${term.capped} hit the step cap, ${term.evalError} errored`);
  if (report.drivers.length) out.push(`input drivers: ${report.drivers.map((d) => d.ref).join(", ")}`);
  if (report.unwrittenInputs.length) {
    out.push(`? = gated on an input nothing writes/drives: ${report.unwrittenInputs.join(", ")} (add a coverage driver?)`);
  }
  if (report.dryChoices.length) {
    out.push("");
    out.push(`dry choices (fell through with nothing takeable - add a fallback or an unconditional option): ${report.dryChoices.length}`);
    for (const d of report.dryChoices) {
      out.push(`  ‼ ${String(d.runs).padStart(6)} run(s)  ${sceneName(d.scene)}  choice '${d.id}'`);
    }
  }

  // Group beats by scene, preserving document order.
  const byScene = new Map<string, CoverageBeat[]>();
  for (const b of report.beats) (byScene.get(b.scene) ?? byScene.set(b.scene, []).get(b.scene)!).push(b);
  const clip = (s: string, n = 48) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

  for (const [scene, beats] of byScene) {
    const dead = beats.filter((b) => b.reachedRuns === 0).length;
    out.push("");
    out.push(`${sceneName(scene)}${dead ? `  (${dead} never reached)` : ""}`);
    for (const b of beats) {
      // `?` = a never-reached beat that may just need an input driver; `‼` = never-reached and truly so.
      const mark = b.reachedRuns === 0 ? (b.needsInput ? "? " : "‼ ") : "  ";
      const label = b.character ? `${b.character}: ${clip(b.preview)}` : clip(b.preview || `(${b.kind})`);
      out.push(`  ${mark}${b.reachPct.toFixed(0).padStart(3)}%  ${String(b.hits).padStart(6)}  ${label}`);
    }
  }
  return out;
}
