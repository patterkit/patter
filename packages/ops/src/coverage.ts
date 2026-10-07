// ---------------------------------------------------------------------------
// Narrative coverage (#159): run a story's flow headlessly N times, choosing a
// random eligible option at every choice, and tally how often each beat is
// reached. Surfaces DEAD content (never-reached beats) and gives a confidence
// number. Core lives here in ops; the `patter coverage` CLI and (later) a
// Patterpad dialog are thin front-ends over runCoverage - the same one-engine,
// two-front-ends shape as report / voice-export / loc.
//
// The unit tallied is the deliverable BEAT (line / text / game event) only; choice-
// option prompts are excluded ("covered when offered / eligible / taken?" is
// ambiguous), but the content reached THROUGH an option is tallied normally, so
// a never-taken branch still reads 0%. The harness owns a single seeded PRNG
// used for both the random choice-picks and each run's engine seed, so a
// `--seed` makes the whole coverage run bit-for-bit reproducible.
// ---------------------------------------------------------------------------

import { compileLoaded } from "./compile.js";
import { Engine } from "@patterkit/runtime";
import type { PlayError } from "@patterkit/runtime";
import { isContentlessBeat, walkNodes } from "@patterkit/model";
import type {
  Group, Snippet, Bundle, CompiledGroup, CompiledSnippet, CompiledEffect, Expression,
  CoverageDriver, ScalarValue,
} from "@patterkit/model";
import { deserialiseAst, makePrng } from "@wildwinter/expr";
import type { ExprNode } from "@wildwinter/expr";
import type { LoadedProject } from "./load.js";
import { sourceStrings, resolveStart } from "./loaded-helpers.js";
import { hostScopeTokens, previewRegistry } from "./game-scopes.js";

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
  /** Reached, but in fewer than {@link RARE_REACH_PCT}% of runs: content that CAN play but hangs on an
   *  unlikely route or a condition that is nearly always false. Worth a look, not necessarily a fault
   *  (one of several random picks is rare by design). Absent on a never-reached beat. */
  rare?: true;
  /** Set on a never-reached beat that is gated on a host-scope ref (`@world.x`) nothing writes and no
   *  driver provides, i.e. it may just need an input, not be truly dead. Lists the offending refs. The
   *  gate is the beat's own conditions and its ancestors', plus any ref that every jump into its block
   *  passes (a block reached only past a gated jump is gated too). Absent on a beat a branch sibling
   *  before it always wins over: no input can help that one. */
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
  /** The writers: content that would have to run for this gate to be written. A writer with beats of its
   *  own is named by its beats; one without (a scene's entry effects, a snippet that only jumps, an option
   *  with only a prompt) by its own node id. */
  writers: string[];
  /** The gate is on the way INTO the beat's block (a jump or call taken only past it), not on the beat
   *  itself: the place to look is the jump. */
  onTheWayIn?: true;
}

/** A choice that ran DRY during the coverage run: at some point it had no takeable option and no eligible
 *  fallback, so it fell through silently and the flow carried on past it. This is easy to author by
 *  accident (all options gated and every condition happened to fail, or a re-enterable hub whose once-only
 *  options all got consumed) and the runtime hides it, so coverage surfaces it explicitly. */
/** A condition or effect that failed during the runs. The engine plays through these (a failing condition
 *  counts as false, a failing effect is skipped), so without this list they would pass unseen. */
export interface ContentError {
  /** What failed: a condition, an effect, or a part of a condition scored for Best match; or "stopped",
   *  when the engine threw and the run ended there (a jump cycle with nothing to deliver). */
  kind: PlayError["kind"] | "stopped";
  /** The snippet, group, or option whose condition failed, or the snippet or scene owning the effect. For
   *  "stopped", the scene the run was in when it stopped. */
  node: string;
  /** The scene the node lives in. */
  scene: string;
  /** The expression's source text, when known. */
  source?: string;
  message: string;
  /** Distinct runs in which it failed (out of runs executed). */
  runs: number;
}

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
  /** `rare` counts beats reached in fewer than `rareThresholdPct`% of runs (and not never). */
  totals: { beats: number; covered: number; neverHit: number; rare: number; coveragePct: number };
  /** The reach % below which a reached beat counts as rare ({@link RARE_REACH_PCT}). */
  rareThresholdPct: number;
  /** How each run ended, for the summary header. `evalError` counts the runs the engine stopped, each
   *  with its cause in `contentErrors` (kind "stopped"). `stalled` is always 0 now (a choice with nothing
   *  to pick runs dry and play moves on), and stays only because Patterpad's Coverage window reads it. */
  termination: { ended: number; capped: number; stalled: number; evalError: number };
  /** The input drivers actually applied this run (empty when none). */
  drivers: CoverageDriver[];
  /** Host-scope refs (`@world.x`) that gate a never-reached beat but nothing writes and no driver feeds:
   *  the "add an input?" candidates, deduped across the report. */
  unwrittenInputs: string[];
  /** Choices observed running dry (falling through with nothing takeable) during the run, most-frequent
   *  first. Empty when none. A dry choice is a likely dead-end-by-accident the runtime hides. */
  dryChoices: DryChoice[];
  /** Conditions and effects that failed and were played through, most frequent first. */
  contentErrors: ContentError[];
  cancelled: boolean;
}

/** mulberry32: the harness's own seeded PRNG (matches the runtime's family; only needs to be reproducible). */
function mulberry32(seed: number): () => number {
  // @wildwinter/expr's makePrng, not a fourth copy of the mixing inside this
  // repo. Same algorithm, same draws; it just lives in one place now.
  const prng = makePrng(seed);
  return () => prng.next();
}

/** Below this share of runs, a beat that WAS reached is flagged rare. Coverage used to flag only the never
 *  reached, so a beat that played in 0.5% of runs looked as healthy as one that played in all of them. */
export const RARE_REACH_PCT = 5;

/**
 * The beats least reached first: never-reached at the top, then by reach %, then by times played, with
 * script order kept among equals. The order both Patterpad's Coverage window and `patter coverage` lead
 * with, because the beats a sweep reaches least are the ones worth a look.
 */
export function leastReachedFirst(beats: readonly CoverageBeat[]): CoverageBeat[] {
  return beats
    .map((b, i) => ({ b, i }))
    .sort((x, y) => x.b.reachPct - y.b.reachPct || x.b.hits - y.b.hits || x.i - y.i)
    .map(({ b }) => b);
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
  /** Per gate key (fine or coarse), the sites that write it: the id of the node whose effects do, a
   *  snippet for its `onEnter` / `onExit` (an option is one too), a scene for its `onEntry`. Each site is
   *  witnessed by its OWN visit count, read from the engine after every run. Witnessing it by the beats it
   *  holds blamed the wrong gate: a scene entered and left through a prompt-only choice plays none of its
   *  beats, so its entry effects read as never run when they had. */
  writerSites: Map<string, string[]>;
  /** Per site, the beats that name it to a person (a snippet's own beats); absent for a site with none. */
  siteBeats: Map<string, string[]>;
  /** Coarse refs written by something the flag analysis cannot read as a per-flag delta (a whole-list
   *  assignment, a computed value). Any such write makes every flag of that property unrefutable, so the
   *  hop drops it rather than guessing. */
  opaqueWrites: Set<string>;
  /** Beats that a `branch` sibling before them always wins over (one with no condition): never reached,
   *  whatever any input does, so no hint about an input applies to them. */
  shadowed: Set<string>;
  /** The block each beat is in, for the gates its block's way in adds. */
  blockOfBeat: Map<string, string>;
  /** Every jump and call, from the block it is in, with the host refs gating the snippet that takes it.
   *  A shadowed snippet's jump is left out: it never runs. */
  routes: Route[];
}

/** One way into a block other than the start: a jump or call to a scene (its first block) or a block. */
interface Route { from: string; to: string; gate: Set<string>; fine: Set<string> }

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
  const writerSites = new Map<string, string[]>();
  const siteBeats = new Map<string, string[]>();
  const opaqueWrites = new Set<string>();
  const shadowed = new Set<string>();
  const blockOfBeat = new Map<string, string>();
  const routes: Route[] = [];
  const empty: HostScopeAnalysis = {
    written, gatesByBeat, proposals, fineGatesByBeat, writerSites, siteBeats, opaqueWrites, shadowed, blockOfBeat, routes,
  };
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
  const addSite = (key: string, site: string): void => {
    const sites = writerSites.get(key) ?? writerSites.set(key, []).get(key)!;
    if (!sites.includes(site)) sites.push(site);
  };
  /** `site` is the node whose visit count says whether these effects ran. */
  const scanEffects = (effects: CompiledEffect[] | undefined, site: string): void => {
    for (const e of effects ?? []) {
      const target = targetHostRef(e.target, hostTokens);
      if (target) {
        written.add(target);
        addSite(target, site);
        // A `set_flags(@world.mood, +armed)` write is readable per flag; anything else assigns the whole
        // property, so no per-flag claim about it can be refuted.
        const flags = e.value ? flagKeys(deserialiseAst(e.value.ast), hostTokens, "set_flags") : [];
        if (flags.length) for (const k of flags) addSite(k, site);
        else opaqueWrites.add(target);
      }
      refsIn(e.value); // RHS refs feed proposals
    }
  };

  const walk = (
    nodes: Array<CompiledGroup | CompiledSnippet>, blockId: string, gate: Set<string>, fine: Set<string>,
    branch: boolean, dead: boolean,
  ): void => {
    // In a `branch`, the first eligible child wins, so once a child with no condition has been passed,
    // every later sibling is never picked. Nothing else shadows: a run skips what is ineligible and goes
    // on, a sequence moves along, and a choice offers every option.
    let won = false;
    for (const node of nodes) {
      const shadow = dead || won;
      if (branch && !node.condition) won = true;
      const here = new Set([...gate, ...refsIn(node.condition)]);
      const hereFine = new Set([...fine, ...fineIn(node.condition)]);
      if (node.type === "group") {
        // a group's prompt carries no expression
        walk(node.children, blockId, here, hereFine, node.selector === "branch", shadow);
      } else {
        const beats = (node.beats ?? []).map((b) => b.id);
        if (beats.length) siteBeats.set(node.id, beats);
        scanEffects(node.onEnter, node.id);
        scanEffects(node.onExit, node.id);
        for (const id of beats) {
          gatesByBeat.set(id, here); fineGatesByBeat.set(id, hereFine); blockOfBeat.set(id, blockId);
          if (shadow) shadowed.add(id);
        }
        if (node.jump && node.jump.to !== "END" && !shadow) routes.push({ from: blockId, to: node.jump.to, gate: here, fine: hereFine });
      }
    }
  };

  for (const scene of Object.values(bundle.scenes)) {
    scanEffects(scene.onEntry, scene.id);
    for (const block of scene.blocks) walk(block.children, block.id, new Set(), new Set(), false, false);
  }
  return empty;
}

/** The host refs gating every way into a block: coarse (`@world.door`) and, where a condition reads one,
 *  per flag (`@world.mood:armed`), as a beat's own gates are kept. */
interface EntryGate { gate: Set<string>; fine: Set<string> }

/**
 * The host refs gating every way into each block, from the start point: a block reached only past a jump
 * gated on `@world.door` is gated on it too, though nothing in the block says so. Intersection across the
 * ways in, never union: one ungated way in is enough to reach the block, so only a ref every way passes
 * gates it. A block no way reaches has no entry here (its beats keep only their own gates).
 */
function entryGates(bundle: Bundle, routes: Route[], start: { scene?: string; block?: string }): Map<string, EntryGate> {
  // A jump to a scene enters its first block; the runtime starts at the first scene when nothing says.
  const firstBlock = (sceneId: string | undefined): string | undefined =>
    sceneId === undefined ? undefined : bundle.scenes[sceneId]?.blocks[0]?.id;
  const blockOf = (to: string): string | undefined => (bundle.scenes[to] ? firstBlock(to) : to);
  const startBlock = start.block ?? firstBlock(start.scene ?? Object.keys(bundle.scenes)[0]);
  if (startBlock === undefined) return new Map();
  const none = (): EntryGate => ({ gate: new Set(), fine: new Set() });
  const meet = (a: Set<string>, b: Set<string>): Set<string> => new Set([...a].filter((g) => b.has(g)));

  // A must-analysis, solved by iterating to a fixpoint: a block's gate is only ever narrowed once known,
  // and the set of blocks known only grows, so this ends.
  let entry = new Map<string, EntryGate>([[startBlock, none()]]);
  for (;;) {
    const next = new Map<string, EntryGate>([[startBlock, none()]]);
    for (const r of routes) {
      const from = entry.get(r.from);
      const to = blockOf(r.to);
      if (from === undefined || to === undefined) continue;
      const via: EntryGate = { gate: new Set([...from.gate, ...r.gate]), fine: new Set([...from.fine, ...r.fine]) };
      const had = next.get(to);
      next.set(to, had === undefined ? via : { gate: meet(had.gate, via.gate), fine: meet(had.fine, via.fine) });
    }
    const same = next.size === entry.size && [...next].every(([k, v]) => {
      const was = entry.get(k);
      return was !== undefined && was.gate.size === v.gate.size && was.fine.size === v.fine.size;
    });
    entry = next;
    if (same) return entry;
  }
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
  siteRuns: Map<string, number>,
  entry: EntryGate | undefined,
): BlockedGate[] {
  const out: BlockedGate[] = [];
  // The beat's own gates, and every gate on the way into its block: a block entered only past a jump gated
  // on a flag whose one writer never ran is dead at one remove just the same.
  const own = new Set([...(analysis.gatesByBeat.get(beatId) ?? []), ...(analysis.fineGatesByBeat.get(beatId) ?? [])]);
  const gates = new Set([...own, ...(entry?.gate ?? []), ...(entry?.fine ?? [])]);
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
    // A site entered in any run may have written the gate. Entered is a little wider than ran (a run
    // capped part-way through a snippet never reaches its onExit), and wider is the safe direction here:
    // only a site never entered at all is one that provably never wrote.
    if (sites.some((s) => (siteRuns.get(s) ?? 0) > 0)) continue; // some writer did run
    const writers = [...new Set(sites.flatMap((s) => analysis.siteBeats.get(s) ?? [s]))].sort();
    out.push({ ref, writers, ...(own.has(ref) ? {} : { onTheWayIn: true as const }) });
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
  const bundle = compileLoaded(loaded);
  // The bundle's host scopes (the project's, as a game scopes folder leaves them): World properties,
  // where proposals are edited, holds only those.
  const hostScopes = bundle.scopeRegistry?.scopes ?? [];
  const hostTokens = new Set(hostScopes.map((s) => s.token));
  if (hostTokens.size === 0) return [];
  const { written, proposals } = analyzeHostScopes(bundle, hostTokens);

  // Fill in declared enum / bool ranges where the conditions gave no literals (e.g. a bare `if @world.flag`).
  const declByRef = new Map<string, { type: string; values?: string[]; stages?: string[] }>();
  for (const s of hostScopes) {
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
  const nodeScene = new Map<string, string>(); // any node id -> scene id (for the content-error report)
  for (const scene of loaded.scenes) {
    nodeScene.set(scene.id, scene.id);
    for (const block of scene.blocks) {
      walkNodes<Group | Snippet>(block.children, (node) => {
        nodeScene.set(node.id, scene.id);
        if (node.type === "group") {
          if (node.selector === "choice") choiceScene.set(node.id, scene.id);
          return;
        }
        for (const beat of (node as Snippet).beats ?? []) {
          if (meta.has(beat.id)) continue;
          // A beat export strips (no text, there only to carry a jump) never ships, so it is not content
          // the sweep can miss: counted, it read as never reached on every run.
          if (isContentlessBeat(beat, !!src[beat.id])) continue;
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
  const errorRuns = new Map<string, ContentError>(); // kind|node|message -> the error, with its run count
  const termination = { ended: 0, capped: 0, stalled: 0, evalError: 0 };
  const siteRuns = new Map<string, number>(); // write site (snippet or scene id) -> distinct runs it was entered in

  const bundle = compileLoaded(loaded);
  const rng = mulberry32(seed);

  // Host-scope (`@world`) drivers + the static analysis behind the unwritten-input hint. Only drivers
  // into a DECLARED host scope with a non-empty pool are live (an undeclared scope can't be set). With a
  // game scopes folder, that is the bundle's host scopes plus the other scopes the preview stands in.
  const hostTokens = hostScopeTokens(loaded, bundle);
  const analysis = analyzeHostScopes(bundle, hostTokens);
  const drivers = (options.drivers ?? loaded.project.coverageDrivers ?? []).filter(
    (d) => d.values.length > 0 && hostTokens.has(d.ref.replace(/^@/, "").split(".")[0] ?? ""),
  );
  const initialDrivers = drivers.filter((d) => d.kind === "initial");
  const recurringDrivers = drivers.filter((d) => d.kind === "recurring");
  const drivenRefs = new Set(drivers.map((d) => d.ref));
  const pick = <T>(vals: T[]): T => vals[Math.floor(rng() * vals.length)]!;
  const sites = [...new Set([...analysis.writerSites.values()].flat())];
  const entered = entryGates(bundle, analysis.routes, start);

  let executed = 0;
  let cancelled = false;

  for (let run = 0; run < runs; run++) {
    if (hooks.signal?.aborted) { cancelled = true; break; }

    // A fresh engine per run = independent shared state (world visits, once-only options, @scene temps all
    // reset), so the samples are unbiased. The per-run engine seed is drawn from the same harness stream.
    // The onDryChoice hook records which choices fell through this run (deduped per run below).
    const dryThisRun = new Set<string>();
    // Content errors this run, deduped by what failed where, so a run counts once per error.
    const errorsThisRun = new Map<string, Omit<ContentError, "runs" | "scene">>();
    // Another engine's scope the story names is stood in from the game's scopes files, afresh each run.
    const registry = previewRegistry(loaded.gameScopes, bundle);
    const engine = new Engine(bundle, {
      seed: Math.floor(rng() * 0x100000000),
      onDryChoice: (groupId) => dryThisRun.add(groupId),
      onError: (e) => {
        const key = `${e.kind}|${e.node}|${e.message}`;
        if (!errorsThisRun.has(key)) errorsThisRun.set(key, { kind: e.kind, node: e.node, ...(e.source ? { source: e.source } : {}), message: e.message });
      },
      ...(registry ? { registry } : {}),
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
        // line / text / game event: a delivered content beat
        if (hitCount.has(r.id)) {
          hitCount.set(r.id, hitCount.get(r.id)! + 1);
          seenThisRun.add(r.id);
        }
      }
    } catch (err) {
      // The engine plays through a failing condition or effect, so a throw here means the run could not go
      // on (a jump cycle with nothing to deliver). Counted, never fatal to the sweep, and its cause kept
      // with the content errors: a bare count of errored runs gave the author nothing to look at.
      term = "evalError";
      const node = flow.currentScene ?? start.scene ?? "";
      const message = err instanceof Error ? err.message : String(err);
      errorsThisRun.set(`stopped|${node}|${message}`, { kind: "stopped", node, message });
    }

    // Each write site by its own visit count: whether its effects ran, whether or not it delivered a beat.
    if (sites.length) {
      const visits = engine.getVisitCounts();
      for (const id of sites) if ((visits[id] ?? 0) > 0) siteRuns.set(id, (siteRuns.get(id) ?? 0) + 1);
    }
    for (const id of seenThisRun) reachedRuns.set(id, reachedRuns.get(id)! + 1);
    for (const id of dryThisRun) dryRuns.set(id, (dryRuns.get(id) ?? 0) + 1);
    for (const [key, e] of errorsThisRun) {
      const seen = errorRuns.get(key);
      if (seen) seen.runs++; else errorRuns.set(key, { ...e, scene: nodeScene.get(e.node) ?? "", runs: 1 });
    }
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
    // A beat a branch sibling always wins over gets neither hint: no input or writer can reach it.
    if (reached === 0 && !analysis.shadowed.has(id)) {
      const block = analysis.blockOfBeat.get(id);
      const way = block !== undefined ? entered.get(block) : undefined;
      const all = new Set([...(analysis.gatesByBeat.get(id) ?? []), ...(way?.gate ?? [])]);
      const gates = [...all].filter((r) => !analysis.written.has(r) && !drivenRefs.has(r));
      if (gates.length) { needsInput = gates; for (const g of gates) unwrittenInputs.add(g); }
      const blocked = blockedGates(id, analysis, drivenRefs, siteRuns, way);
      if (blocked.length) blockedBy = blocked;
    }
    const reachPct = executed ? (reached / executed) * 100 : 0;
    return {
      id, scene: m.scene, kind: m.kind, character: m.character, preview: m.preview,
      hits: hitCount.get(id)!,
      reachedRuns: reached,
      reachPct,
      ...(reached > 0 && reachPct < RARE_REACH_PCT ? { rare: true as const } : {}),
      ...(needsInput ? { needsInput } : {}),
      ...(blockedBy ? { blockedBy } : {}),
    };
  });
  const neverHit = beats.filter((b) => b.reachedRuns === 0).length;
  const covered = beats.length - neverHit;
  const rare = beats.filter((b) => b.rare).length;

  const dryChoices: DryChoice[] = [...dryRuns.entries()]
    .map(([id, r]) => ({ id, scene: choiceScene.get(id) ?? "", runs: r }))
    .sort((a, b) => b.runs - a.runs || a.id.localeCompare(b.id));

  return {
    runs: executed, maxSteps, seed, start, beats,
    totals: { beats: beats.length, covered, neverHit, rare, coveragePct: beats.length ? (covered / beats.length) * 100 : 100 },
    rareThresholdPct: RARE_REACH_PCT,
    termination, drivers, unwrittenInputs: [...unwrittenInputs].sort(), dryChoices,
    contentErrors: [...errorRuns.values()].sort((a, b) => b.runs - a.runs || a.node.localeCompare(b.node)),
    cancelled,
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

/** Which order the beat table is in: least reached first (the default: the rows worth a look lead), or
 *  the script's own order, scene by scene. */
export type CoverageOrder = "least" | "script";

/** Render a coverage report as the CLI's readable text: a summary, then the beat table with never-reached
 *  and rarely reached rows marked, least reached first unless `order` says script order. */
export function renderCoverageText(
  report: CoverageReport,
  sceneName: (id: string) => string = (id) => id,
  opts: { order?: CoverageOrder } = {},
): string[] {
  const order = opts.order ?? "least";
  const out: string[] = [];
  const t = report.totals;
  const pct = (n: number) => `${n.toFixed(0)}%`;
  const rareLimit = report.rareThresholdPct ?? RARE_REACH_PCT;
  const rareCount = t.rare ?? report.beats.filter((b) => b.rare).length;
  out.push(
    `coverage: ${t.covered}/${t.beats} beats reached (${pct(t.coveragePct)})` +
      (t.neverHit ? ` - ${t.neverHit} never reached` : "") +
      (rareCount ? ` - ${rareCount} rarely reached (under ${rareLimit}% of runs)` : ""),
  );
  out.push(`${report.runs} run(s) - ${report.maxSteps} max steps - seed ${report.seed}${report.cancelled ? " - CANCELLED" : ""}`);
  const term = report.termination;
  // A stall can no longer happen (a choice with nothing to pick runs dry and play moves on), so it is named
  // only if one ever does.
  out.push(`runs ended: ${term.ended} reached the end, ${term.stalled ? `${term.stalled} stalled at a choice with nothing to pick, ` : ""}${term.capped} hit the step limit, ${term.evalError} errored`);
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
  if (report.contentErrors.length) {
    out.push("");
    out.push(`content errors (a condition or effect failed and play went on without it, or a run stopped - fix the content): ${report.contentErrors.length}`);
    for (const e of report.contentErrors) {
      const what = e.kind === "stopped" ? "run stopped" : `${e.kind} on '${e.node}'${e.source ? ` (${e.source})` : ""}`;
      out.push(`  ‼ ${String(e.runs).padStart(6)} run(s)  ${sceneName(e.scene)}  ${what}: ${e.message}`);
    }
  }
  if (!report.beats.length) return out;

  const clip = (s: string, n = 48) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const scenes = new Set(report.beats.map((b) => b.scene));
  const heading = "     reached  played  beat";

  const row = (b: CoverageBeat, withScene: boolean): void => {
    // `‼` never reached and truly so; `?` never reached but may just need an input driver; `~` reached,
    // but in fewer than the rare threshold's share of runs.
    const mark = b.reachedRuns === 0 ? (b.needsInput || b.blockedBy ? "? " : "‼ ") : b.rare ? "~ " : "  ";
    const label = b.character ? `${b.character}: ${clip(b.preview)}` : clip(b.preview || `(${b.kind})`);
    const where = withScene ? `[${sceneName(b.scene)}] ` : "";
    out.push(`  ${mark}${pct(b.reachPct).padStart(6)}  ${String(b.hits).padStart(6)}  ${where}${label}`);
    // Dead at one remove: say which beat would have to play first, so the author chases one thing.
    for (const bg of b.blockedBy ?? []) {
      const names = bg.writers.map((w) => {
        const target = report.beats.find((x) => x.id === w);
        return target ? clip(target.preview || target.id, 28) : sceneName(w); // a scene's entry, or a node id
      });
      out.push(`           gated on ${bg.ref}${bg.onTheWayIn ? " on the way in" : ""}, written only by: ${names.join(", ")} (never played either)`);
    }
  };

  out.push("");
  out.push(`reached = share of runs that played the beat at least once; played = times it played in all runs`);
  out.push(`‼ never reached   ? never reached, may need an input   ~ rarely reached (under ${rareLimit}% of runs)`);

  if (order === "least") {
    out.push("");
    out.push(`least reached first${scenes.size > 1 ? ", every scene" : ""}`);
    out.push(heading);
    for (const b of leastReachedFirst(report.beats)) row(b, scenes.size > 1);
    return out;
  }

  // Script order: grouped by scene, in document order.
  const byScene = new Map<string, CoverageBeat[]>();
  for (const b of report.beats) (byScene.get(b.scene) ?? byScene.set(b.scene, []).get(b.scene)!).push(b);
  for (const [scene, beats] of byScene) {
    const dead = beats.filter((b) => b.reachedRuns === 0).length;
    const rare = beats.filter((b) => b.rare).length;
    const notes = [dead ? `${dead} never reached` : "", rare ? `${rare} rarely reached` : ""].filter(Boolean).join(", ");
    out.push("");
    out.push(`${sceneName(scene)}${notes ? `  (${notes})` : ""}`);
    out.push(heading);
    for (const b of beats) row(b, false);
  }
  return out;
}
