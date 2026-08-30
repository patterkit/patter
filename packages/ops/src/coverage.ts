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
  /** Set on a never-reached beat gated on a ref that IS written, but ONLY by content that was itself
   *  never reached: the beat is dead at one remove, and the gate is not the real question. Names the
   *  ref and the beats that witness its only writers, so two mysteries collapse into one. Absent
   *  whenever the chain cannot be refuted (see `writerSites` in the analysis). */
  blockedBy?: BlockedGate[];
}

/** A gate on a never-reached beat whose every writer was itself never reached. */
export interface BlockedGate {
  /** The gating ref, at the granularity the condition reads it: `@world.alarm`, or `@world.mood:armed`
   *  for a single flag of a flags property. */
  ref: string;
  /** Beat ids witnessing the writers: content that would have to play for this gate to be written. */
  writers: string[];
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
  /** Gates again, but at FLAG granularity where the condition has it: a `check_flags(@world.mood, +armed)`
   *  contributes `@world.mood:armed` rather than `@world.mood`. This is the whole trick behind the second
   *  hop. Keyed coarsely, a property half the project writes always looks written, and the hop finds
   *  nothing; keyed by the individual flag, the one writer that matters is visible. */
  fineGatesByBeat: Map<string, Set<string>>;
  /** Per gate key (fine or coarse), the sites that write it. A site is a set of beat ids that WITNESS it
   *  running: a snippet's own beats for its `onEnter` / `onExit`, a scene's beats for its `onEntry`. */
  writerSites: Map<string, string[][]>;
  /** Coarse refs written by something the flag analysis cannot read as a per-flag delta (a whole-list
   *  assignment, a computed value). Any such write makes every flag of that property unrefutable, so the
   *  hop drops it rather than guessing. */
  opaqueWrites: Set<string>;
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

/** The flag keys a `check_flags(@world.mood, +armed, -hurt)` call reads: `@world.mood:armed`,
 *  `@world.mood:hurt`. Empty for anything else, including a check whose first argument is not a plain
 *  host-scope ref (a computed flags value is not something this analysis can key). */
function flagKeys(node: ExprNode, hostTokens: Set<string>, fn: "check_flags" | "set_flags"): string[] {
  if (node.kind !== "call" || node.name !== fn) return [];
  const subject = node.args[0];
  if (!subject || subject.kind !== "scopedvar" || !hostTokens.has(subject.scope)) return [];
  const ref = `@${subject.scope}.${subject.name}`;
  return node.args.slice(1).filter((a) => a.kind === "flagdelta").map((a) => `${ref}:${(a as { name: string }).name}`);
}

/** Every flag key read anywhere in a condition, at any depth. */
function fineRefsIn(node: ExprNode, hostTokens: Set<string>, out: Set<string>): void {
  for (const k of flagKeys(node, hostTokens, "check_flags")) out.add(k);
  switch (node.kind) {
    case "unary": fineRefsIn(node.operand, hostTokens, out); break;
    case "binary": fineRefsIn(node.left, hostTokens, out); fineRefsIn(node.right, hostTokens, out); break;
    case "call": for (const a of node.args) fineRefsIn(a, hostTokens, out); break;
    default: break;
  }
}

/** Static scan of the compiled bundle: which host-scope refs are written, which gate each beat, and the
 *  literal pool each ref is compared against (for auto-proposed drivers). */
function analyzeHostScopes(bundle: Bundle, hostTokens: Set<string>): HostScopeAnalysis {
  const written = new Set<string>();
  const gatesByBeat = new Map<string, Set<string>>();
  const fineGatesByBeat = new Map<string, Set<string>>();
  const proposals = new Map<string, Set<ScalarValue>>();
  const writerSites = new Map<string, string[][]>();
  const opaqueWrites = new Set<string>();
  const empty: HostScopeAnalysis = { written, gatesByBeat, proposals, fineGatesByBeat, writerSites, opaqueWrites };
  if (hostTokens.size === 0) return empty;

  const refsIn = (expr?: Expression): Set<string> => {
    const refs = new Set<string>();
    if (expr) scanExpr(deserialiseAst(expr.ast), hostTokens, refs, proposals);
    return refs;
  };
  const fineIn = (expr?: Expression): Set<string> => {
    const refs = new Set<string>();
    if (expr) fineRefsIn(deserialiseAst(expr.ast), hostTokens, refs);
    return refs;
  };
  const addSite = (key: string, witnesses: string[]): void => {
    (writerSites.get(key) ?? writerSites.set(key, []).get(key)!).push(witnesses);
  };
  /** `witnesses` are the beats whose being reached proves these effects ran. */
  const scanEffects = (effects: CompiledEffect[] | undefined, witnesses: string[]): void => {
    for (const e of effects ?? []) {
      const target = targetHostRef(e.target, hostTokens);
      if (target) {
        written.add(target);
        addSite(target, witnesses);
        // A `set_flags(@world.mood, +armed)` write is readable per flag; anything else assigns the whole
        // property, so no per-flag claim about it can be refuted.
        const flags = e.value ? flagKeys(deserialiseAst(e.value.ast), hostTokens, "set_flags") : [];
        if (flags.length) for (const k of flags) addSite(k, witnesses);
        else opaqueWrites.add(target);
      }
      refsIn(e.value); // RHS refs feed proposals
    }
  };

  const walk = (nodes: Array<CompiledGroup | CompiledSnippet>, gate: Set<string>, fine: Set<string>): void => {
    for (const node of nodes) {
      const here = new Set([...gate, ...refsIn(node.condition)]);
      const hereFine = new Set([...fine, ...fineIn(node.condition)]);
      if (node.type === "group") {
        walk(node.children, here, hereFine); // a group's prompt carries no expression
      } else {
        const witnesses = (node.beats ?? []).map((b) => b.id);
        scanEffects(node.onEnter, witnesses);
        scanEffects(node.onExit, witnesses);
        for (const beat of node.beats ?? []) { gatesByBeat.set(beat.id, here); fineGatesByBeat.set(beat.id, hereFine); }
      }
    }
  };

  for (const scene of Object.values(bundle.scenes)) {
    // A scene's entry effects are witnessed by every beat in it: if any of them played, entry ran.
    const sceneBeats: string[] = [];
    const collect = (nodes: Array<CompiledGroup | CompiledSnippet>): void => {
      for (const n of nodes) {
        if (n.type === "group") collect(n.children);
        else for (const b of n.beats ?? []) sceneBeats.push(b.id);
      }
    };
    for (const block of scene.blocks) collect(block.children);
    scanEffects(scene.onEntry, sceneBeats);
    for (const block of scene.blocks) walk(block.children, new Set(), new Set());
  }
  return empty;
}

/**
 * The second hop, for a beat nothing reached.
 *
 * `needsInput` answers "is this gate fed by anyone?" and stops there, so a gate that IS written reads as
 * perfectly wired. But a write only counts if the content carrying it ever plays: content gated on a flag
 * whose only writer is ITSELF never reached is dead at one remove, and the gate is not the real question.
 * Two silent beats, one cause, and nothing anywhere drawing the arrow between them. (Reported from the
 * Storylet Studio side, 2026-08-30, where exactly this hid two never-dealt cards behind each other.)
 *
 * The rule this holds itself to is **only report what you can refute**. A site whose witnesses are not
 * measurable content, or a flag on a property something assigns wholesale, drops OUT of the analysis
 * rather than being guessed at. A false "this can never happen" on a beat that plays fine is the one
 * failure this class of check does not recover from: it teaches authors to stop reading the panel.
 */
function blockedGates(
  beatId: string,
  analysis: HostScopeAnalysis,
  drivenRefs: Set<string>,
  reachedRuns: Map<string, number>,
): BlockedGate[] {
  const out: BlockedGate[] = [];
  const gates = new Set([...(analysis.gatesByBeat.get(beatId) ?? []), ...(analysis.fineGatesByBeat.get(beatId) ?? [])]);
  for (const ref of [...gates].sort()) {
    const coarse = ref.includes(":") ? ref.slice(0, ref.indexOf(":")) : ref;
    if (drivenRefs.has(coarse)) continue;              // a driver feeds it; the story's writers are moot
    if (!analysis.written.has(coarse)) continue;       // unwritten is hop one's answer, not this one
    // A flag key is only readable while every write to its property is a per-flag delta.
    if (ref !== coarse && analysis.opaqueWrites.has(coarse)) continue;
    // A fine gate keeps the coarse key out of the report: `@world.mood:armed` is the useful sentence.
    if (ref === coarse && [...gates].some((g) => g !== ref && g.startsWith(`${ref}:`))) continue;
    const sites = analysis.writerSites.get(ref) ?? [];
    if (!sites.length) continue;
    // Unwitnessed site = a write whose running we cannot observe (a snippet with no beats of its own).
    // It might well have run, so nothing here is refutable.
    if (sites.some((s) => !s.length || s.some((w) => !reachedRuns.has(w)))) continue;
    if (!sites.every((s) => s.every((w) => reachedRuns.get(w) === 0))) continue; // some writer did play
    const writers = [...new Set(sites.flat())].sort();
    out.push({ ref, writers });
  }
  return out;
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
  const declByRef = new Map<string, { type: string; values?: string[]; stages?: string[] }>();
  for (const s of loaded.project.scopeRegistry?.scopes ?? []) {
    for (const d of s.declarations ?? []) declByRef.set(`@${s.token}.${d.name}`, { type: d.type, values: d.values, stages: d.stages });
  }

  const drivers: CoverageDriver[] = [];
  for (const [ref, pool] of proposals) {
    if (written.has(ref)) continue; // story-owned → covered for free
    const decl = declByRef.get(ref);
    let values = [...pool];
    if (values.length === 0 && decl) {
      if (decl.type === "boolean") values = [true, false];
      else if (decl.type === "enum" && decl.values) values = [...decl.values];
      else if (decl.type === "quality" && decl.stages) values = [...decl.stages]; // stage names ARE the values
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

/** Default sweep size. Named because both drivers below need it to report a total. */
const DEFAULT_RUNS = 5000;

/**
 * The sweep itself, as a generator that yields the completed-run count after each run.
 *
 * ONE loop body, two drivers over it (`runCoverage` and `runCoverageAsync` below), so the synchronous
 * path the CLI takes and the yielding path Patterpad's job host takes can never drift apart. The yield
 * is what makes cancellation possible at all: `hooks.signal` is checked at the top of every run, and in
 * a single-threaded host nothing can flip that flag unless the loop hands the event loop back first.
 */
function* sweep(loaded: LoadedProject, options: CoverageOptions = {}, hooks: CoverageHooks = {}): Generator<number, CoverageReport, void> {
  const runs = options.runs ?? DEFAULT_RUNS;
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
    yield executed; // the driver's chance to report and, on the async path, to hand back the loop
  }
  hooks.onProgress?.(executed, runs);

  const unwrittenInputs = new Set<string>();
  const beats: CoverageBeat[] = order.map((id) => {
    const m = meta.get(id)!;
    const reached = reachedRuns.get(id)!;
    // A never-reached beat gated on a host-scope ref that nothing writes AND no driver feeds may just
    // need an input: flag it so the author can add a driver rather than assume it is dead.
    let needsInput: string[] | undefined;
    let blockedBy: BlockedGate[] | undefined;
    if (reached === 0) {
      const gates = [...(analysis.gatesByBeat.get(id) ?? [])].filter((r) => !analysis.written.has(r) && !drivenRefs.has(r));
      if (gates.length) { needsInput = gates; for (const g of gates) unwrittenInputs.add(g); }
      const blocked = blockedGates(id, analysis, drivenRefs, reachedRuns);
      if (blocked.length) blockedBy = blocked;
    }
    return {
      id, scene: m.scene, kind: m.kind, character: m.character, preview: m.preview,
      hits: hitCount.get(id)!,
      reachedRuns: reached,
      reachPct: executed ? (reached / executed) * 100 : 0,
      ...(needsInput ? { needsInput } : {}),
      ...(blockedBy ? { blockedBy } : {}),
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

/**
 * Run narrative coverage over a loaded project, synchronously. Pure (compiles once, then N independent
 * playthroughs); optional progress via `hooks.onProgress`.
 *
 * `hooks.signal` is honoured but can only ever fire from OUTSIDE this thread of execution (a worker, a
 * test that pre-aborts). A host that wants a Cancel button its own user can press wants
 * `runCoverageAsync`, which yields between runs so the flag can actually change.
 */
export function runCoverage(loaded: LoadedProject, options: CoverageOptions = {}, hooks: CoverageHooks = {}): CoverageReport {
  const it = sweep(loaded, options, hooks);
  let step = it.next();
  while (!step.done) step = it.next();
  return step.value;
}

export interface CoverageAsyncHooks extends CoverageHooks {
  /** Awaited after every completed run. This is both the progress report and the yield point: whatever
   *  it awaits on is when the host gets its event loop back, so IPC flows and a Cancel can be heard.
   *  app-shell's `JobContext.step(done, total)` fits it exactly. */
  onRun?: (done: number, total: number) => void | Promise<void>;
}

/**
 * Run narrative coverage without hogging the thread: the same sweep, awaiting `hooks.onRun` between
 * runs. A cancelled sweep resolves with the PARTIAL report rather than throwing, and that report's
 * `runs` is the count actually executed with `cancelled: true` set, so nothing downstream can mistake
 * it for a full sample.
 */
export async function runCoverageAsync(
  loaded: LoadedProject,
  options: CoverageOptions = {},
  hooks: CoverageAsyncHooks = {},
): Promise<CoverageReport> {
  const total = options.runs ?? DEFAULT_RUNS;
  const it = sweep(loaded, options, hooks);
  let step = it.next();
  while (!step.done) {
    await hooks.onRun?.(step.value, total);
    step = it.next();
  }
  return step.value;
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
      const mark = b.reachedRuns === 0 ? (b.needsInput || b.blockedBy ? "? " : "‼ ") : "  ";
      const label = b.character ? `${b.character}: ${clip(b.preview)}` : clip(b.preview || `(${b.kind})`);
      out.push(`  ${mark}${b.reachPct.toFixed(0).padStart(3)}%  ${String(b.hits).padStart(6)}  ${label}`);
      // Dead at one remove: say which beat would have to play first, so the author chases one thing.
      for (const bg of b.blockedBy ?? []) {
        const names = bg.writers.map((w) => {
          const target = report.beats.find((x) => x.id === w);
          return target ? clip(target.preview || target.id, 28) : w;
        });
        out.push(`         gated on ${bg.ref}, written only by: ${names.join(", ")} (never played either)`);
      }
    }
  }
  return out;
}
