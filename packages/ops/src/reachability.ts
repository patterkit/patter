// ---------------------------------------------------------------------------
// Conditions that can never hold.
//
// Offered from the Storylet Studio side on 2026-08-30 (their `design/reachability.md`), from a fault
// their author found by playing and no existing check could see: a card gated on
// `@deck.connected && !@deck.torin_offer_seen`, where the only writer of `connected` was itself gated on
// `torin_offer_seen`, which nothing set back to false. Unsatisfiable, and silent - coverage reports
// bodies rather than causes, and the unwritten-input hint found both refs perfectly wired.
//
// THE ONE RULE, above every detail below: only report what can be REFUTED. A false "this can never
// happen" on a snippet that plays fine teaches authors to stop reading the problems panel, and this is
// exactly the sort of check that gets ignored once it cries wolf. Every step here is conservative in the
// same direction: anything not provably monotonic drops out of the analysis rather than being guessed at.
//
// Scope, deliberately small: MONOTONIC LATCHES - a boolean only ever written `true`, and a flag only ever
// `+set`. That is where the faults live, and it is decidable by walking a graph. Numbers, strings, enums
// and qualities are out: they are ordered or many-valued comparisons that want their own argument, and a
// wrong answer about one would cost more than the check is worth. No solver: full satisfiability over the
// expression language is a different project, answering questions nobody is asking.
//
// A WARNING, never an error, and deliberately outside `ok`: content is written in pieces, so "I have not
// written that bit yet" has to stay an obvious reading of every message here.
//
// TWO RULES THIS MODEL NEEDS AND THEIRS DOES NOT, both of which would otherwise produce exactly the false
// positive above. A Patter property carries a DEFAULT, so a boolean defaulting to `true` (or a flags
// property whose default already holds the flag) is set before anything writes it, and no ordering
// argument about it holds. And a scene-local property may be `temporary`, which reseeds it to that
// default on every scene entry: a latch that can go back down is not a latch.
// ---------------------------------------------------------------------------

import type { Bundle, CompiledGroup, CompiledSnippet, Expression, PropertyDecl, ScalarValue } from "@patterkit/model";
import type { ConditionIssue } from "@patterkit/compiler";
import { compileLoaded } from "./compile.js";
import { disjuncts, latchOf, scopedRef, terms } from "@wildwinter/expr";
import type { Term } from "@wildwinter/expr";
import type { LoadedProject } from "./load.js";

type AstNode = Expression["ast"];

/** `@x` is `@patter.x`: the default scope is always `patter`, whatever the name is declared in. */
const normaliseRef = (ref: string): string => (ref.includes(".") ? ref : `@patter.${ref.slice(1)}`);

/** A `@scene.x` is a DIFFERENT property in every scene, so its key carries the scene. Anything else is
 *  global to the project, or foreign to it: that is handled by letting only `@patter` and `@scene` be
 *  latches. */
const SEP = "\u0000";
const keyOf = (ref: string, sceneId: string): string => (ref.startsWith("@scene.") ? `${sceneId}${SEP}${ref}` : ref);

/** The half of a key a person reads: `@patter.connected`, or `@patter.mood +armed`. */
const shown = (key: string): string => {
  const bare = key.includes(SEP) ? key.slice(key.indexOf(SEP) + 1) : key;
  const at = bare.indexOf(":");
  return at < 0 ? bare : `${bare.slice(0, at)} +${bare.slice(at + 1)}`;
};

// The latch GRAMMAR - which shapes assert a latch, and how a condition
// decomposes into terms - is @wildwinter/expr's, not a copy here. It was
// written twice, character for character including the flag key format, and it
// is the piece most likely to drift: teach one family that `@x != false`
// asserts what `@x` does and the other silently does not learn it. What stays
// below is the part that genuinely differs, the walk over THIS model's scenes
// and snippets, with its property defaults and `temporary` reseeding.
//
// `keyOf` below is what makes it ours: an owner here is the scene a reference
// was seen in.
const latchOfAst = (ast: AstNode, sceneId: string) => latchOf(ast, sceneId, keyOf);
const termsOfAst = (ast: AstNode, sceneId: string) => terms(ast, sceneId, keyOf);

/** What a condition says must ALREADY hold. A condition that is a disjunction requires none of its
 *  branches for certain, and yields nothing here: that is `terms` declining to descend an `or`, rather
 *  than a separate guard, so there is one place to change if `or` ever gains a meaning. */
const requirementsOf = (expr: Expression | undefined, sceneId: string): Term[] =>
  (expr === undefined ? [] : termsOfAst(expr.ast, sceneId));

/** A flags default is a list of flag names; anything else means "no flags set". */
const asFlags = (v: ScalarValue | undefined): string[] =>
  (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

interface Writer { requires: Term[] }

/**
 * Conditions that can never hold, as warnings. Empty for a project with no monotonic latches, which is
 * most of them: this only speaks when it can prove an ordering.
 */
export function reachabilityIssues(loaded: LoadedProject, compiled?: Bundle): ConditionIssue[] {
  const bundle = compiled ?? compileLoaded(loaded);

  // --- 0. what a DEFAULT already gives away ----------------------------------
  //
  // A latch is an argument about ORDER, and a property that starts set has no order to argue about. Same
  // for a `temporary` scene-local, which goes back to that default on every entry.
  const preset = new Set<string>();
  const notALatch = (decl: PropertyDecl, key: string): void => {
    if (decl.temporary) {
      preset.add(key);
      for (const v of decl.values ?? []) preset.add(`${key}:${v}`);
      return;
    }
    if (decl.type === "boolean" && decl.default === true) preset.add(key);
    if (decl.type === "flags") for (const v of asFlags(decl.default)) preset.add(`${key}:${v}`);
  };
  for (const decl of loaded.project.properties ?? []) notALatch(decl, `@patter.${decl.name}`);
  for (const scene of loaded.scenes) {
    for (const decl of scene.sceneProps ?? []) notALatch(decl, `${scene.id}${SEP}@scene.${decl.name}`);
  }

  // --- 1. classify: which latches only ever move one way ---------------------
  const latched = new Set<string>();
  const broken = new Set<string>();
  const writers = new Map<string, Writer[]>();
  const noteWrite = (key: string, requires: Term[]): void => {
    latched.add(key);
    (writers.get(key) ?? writers.set(key, []).get(key)!).push({ requires });
  };
  const breakKey = (key: string): void => {
    broken.add(key);
    for (const k of latched) if (k.startsWith(`${key}:`)) broken.add(k);
  };

  const scanEffects = (effects: CompiledSnippet["onEnter"], sceneId: string, need: Term[]): void => {
    for (const e of effects ?? []) {
      const ref = normaliseRef(e.target);
      const key = keyOf(ref, sceneId);
      const ast = e.value.ast;
      if (Array.isArray(ast) && ast[0] === "b" && ast[1] === true) { noteWrite(key, need); continue; }
      // `@x = set_flags(@x, +a, ...)`: each named flag is a latch. Any OTHER shape of write to a flags
      // property - a clear, an assignment, a computed value - breaks every flag it holds, because the set
      // can no longer be said to only grow.
      if (Array.isArray(ast) && ast[0] === "call" && ast[1] === "set_flags" && scopedRef(ast[2] as AstNode) === ref) {
        let clean = true;
        for (const arg of ast.slice(3)) {
          if (Array.isArray(arg) && arg[0] === "fd" && arg[1] === "+") noteWrite(`${key}:${String(arg[2])}`, need);
          else clean = false;
        }
        if (clean) continue;
      }
      breakKey(key);
    }
  };

  const walk = (nodes: Array<CompiledGroup | CompiledSnippet>, sceneId: string, gate: Term[]): void => {
    for (const node of nodes) {
      const here = [...gate, ...requirementsOf(node.condition, sceneId)];
      if (node.type === "group") walk(node.children, sceneId, here);
      else { scanEffects(node.onEnter, sceneId, here); scanEffects(node.onExit, sceneId, here); }
    }
  };
  for (const scene of Object.values(bundle.scenes)) {
    scanEffects(scene.onEntry, scene.id, []);   // entry effects run whenever the scene is entered
    for (const block of scene.blocks) walk(block.children, scene.id, []);
  }
  // A property written unsafely poisons its own flags, whichever order we met them in.
  for (const key of [...latched]) {
    const at = key.indexOf(":");
    if (at > 0 && broken.has(key.slice(0, at))) broken.add(key);
  }
  // Only the project's OWN scopes, `@patter` and `@scene`, can be latches: they are the only ones whose
  // every writer is in this bundle. Every other scope is someone else's to write, at any moment and in any
  // direction: a host scope, the game's own scopes, and the family's other engines' (`@story` is the
  // Storylet Engine's, which sets it whenever its storylets say so). So it can anchor nothing: not a
  // positive term, and not a "nothing sets it back" either. This used to ask which scopes were the
  // host's, a list that missed `@story` whenever no game scopes folder named it, so a story setting
  // `@story.met` read as the only writer. Naming what the project owns needs no such list, and one answer
  // at the classification boundary means no guard at each use site to drift apart.
  //
  // And `@patter` is the project's alone only while the game does not share it. Where the game keeps a
  // game scopes folder, Patter's file there publishes every SHARED property (`shared` is the default) to
  // the family's other engines, which may write it on the same registry (the Storylet Engine compiles a
  // family token's writes unchecked). Nothing in this bundle can then refute a reset, so a shared
  // `@patter` property is no latch either; an unshared one, and every `@scene` one, still is.
  const sharedWithGame = new Set(loaded.gameScopes
    ? (loaded.project.properties ?? []).filter((p) => p.shared ?? true).map((p) => `@patter.${p.name}`)
    : []);
  const projectOwned = (key: string): boolean => {
    const bare = key.includes(SEP) ? key.slice(key.indexOf(SEP) + 1) : key;
    const prop = bare.includes(":") ? bare.slice(0, bare.indexOf(":")) : bare;
    if (bare.startsWith("@patter.")) return !sharedWithGame.has(prop);
    return bare.startsWith("@scene.");
  };
  const monotonic = (key: string): boolean =>
    latched.has(key) && !broken.has(key) && !preset.has(key) && projectOwned(key);

  // --- 2. what must already be true before a latch can be set ---------------
  //
  // INTERSECTION across writers, never union: any one live route to a latch is enough, so only a
  // requirement EVERY route shares is a requirement of the latch. Backwards, this would flag every second
  // snippet in the project.
  const cache = new Map<string, Set<string>>();
  const inFlight = new Set<string>();
  /** `cut` means a cycle was broken to reach this answer, so it is an approximation - and an
   *  approximation must never reach the refutation. Two latches requiring each other are indeed both
   *  unreachable, but that is a DIFFERENT diagnosis, and reporting it here would give a true verdict with
   *  a false reason. Cut answers are never cached either, or the first walk to hit a cycle would poison
   *  the cache for every later one. */
  const mustHold = (key: string): { need: Set<string>; cut: boolean } => {
    const done = cache.get(key);
    if (done !== undefined) return { need: done, cut: false };
    if (inFlight.has(key)) return { need: new Set(), cut: true };
    const routes = writers.get(key);
    if (routes === undefined || routes.length === 0) return { need: new Set(), cut: false }; // nothing writes it
    inFlight.add(key);
    let shared: Set<string> | undefined;
    let cut = false;
    for (const route of routes) {
      const need = new Set<string>();
      for (const t of route.requires) {
        if (t.negated || !monotonic(t.key)) continue;
        need.add(t.key);
        const deeper = mustHold(t.key);
        cut ||= deeper.cut;
        for (const k of deeper.need) need.add(k);
      }
      shared = shared === undefined ? need : new Set([...shared].filter((k) => need.has(k)));
    }
    inFlight.delete(key);
    const result = shared ?? new Set<string>();
    if (!cut) cache.set(key, result);
    return { need: result, cut };
  };

  // --- 3. refute -------------------------------------------------------------
  /** The gate a node actually runs under is its own condition AND its ancestors', so a contradiction
   *  between a group and the snippet inside it is the same fault and reads the same way. */
  const refute = (gate: Term[]): string | undefined => {
    for (const no of gate.filter((t) => t.negated)) {
      if (!monotonic(no.key)) continue;
      if (gate.some((t) => !t.negated && t.key === no.key)) {
        return `it asks for ${shown(no.key)} to be both set and not set`;
      }
      for (const yes of gate.filter((t) => !t.negated && t.key !== no.key)) {
        // The POSITIVE latch has to be monotonic too, not just the negated one. A latch that starts set
        // (a boolean defaulting to true, a flags property whose default holds the flag) is true before
        // any writer runs, so it implies nothing about what ran first; and one written in a shape we
        // cannot read could have been set by anything. Their version asks this only of the negated term,
        // which is right for a model without defaults and produced a false positive in the first fixture
        // here that had one.
        if (!monotonic(yes.key)) continue;
        const chain = mustHold(yes.key);
        if (!chain.cut && chain.need.has(no.key)) {
          return `${shown(yes.key)} can only become true after ${shown(no.key)}, `
            + `which nothing sets back, so this condition can never hold`;
        }
      }
    }
    return undefined;
  };

  const issues: ConditionIssue[] = [];
  const report = (nodes: Array<CompiledGroup | CompiledSnippet>, sceneId: string, gate: Term[]): void => {
    for (const node of nodes) {
      const own = node.condition;
      // For REFUTING, every branch of a disjunction has to fall, so they are checked one at a time.
      const branches = own ? disjuncts(own.ast) : [undefined];
      let reason: string | undefined;
      const refuted = branches.every((b) => {
        const r = refute([...gate, ...(b ? termsOfAst(b, sceneId) : [])]);
        reason ??= r;
        return r !== undefined;
      });
      if (refuted && reason !== undefined && own) {
        issues.push({
          nodeId: node.id, field: "condition", src: own.src, severity: "warning",
          message: `this can never run: ${reason}`,
        });
        continue; // the root cause is here; every child would only repeat it
      }
      if (node.type === "group") report(node.children, sceneId, [...gate, ...requirementsOf(own, sceneId)]);
    }
  };
  for (const scene of Object.values(bundle.scenes)) {
    for (const block of scene.blocks) report(block.children, scene.id, []);
  }
  return issues;
}
