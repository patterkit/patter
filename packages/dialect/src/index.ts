// ---------------------------------------------------------------------------
// @patterkit/dialect - the Patter configuration of @wildwinter/expr.
//
// Provides the Patter `Dialect` (scopes + built-in functions) and a helper to
// build an `ExpressionSchema` from Patter property declarations (for static
// validation). Shared by the compiler (parse + validate) and the runtime
// (evaluate), so it depends only on @wildwinter/expr at runtime (plus a
// type-only import from @wildwinter/scoperegistry for the foreign-scope spec).
//
// Scope tokens: just two - `patter` (global, the default; bare `@name`) and
// `scene` (scene-local). The default global token is `@patter` (decision in
// design/scope-registry.md §10.1; renamed from the earlier provisional `@shared`).
// SHARING is an orthogonal per-property axis (PropertyDecl.shared), NOT a scope
// token: a flow-private global is `@patter` declared `shared:false`; a shared
// scene prop is `@scene` declared `shared:true`. (This mirrors Storylet Studio's
// `@world`/`@site` + shared-flag paradigm - the two tools share one model.)
// FUTURE (design/scope-registry.md): this static scope list becomes a *registry*
// (engine-owned + host/foreign tokens).
// ---------------------------------------------------------------------------

import type {
  Dialect, EvalHelpers, ExprNode, ScalarValue,
  ExpressionSchema, PropertyType as ExprPropertyType,
} from "@wildwinter/expr";
import { EvalError } from "@wildwinter/expr";
import type { ScopeRegistrySpec } from "@wildwinter/scoperegistry";
import type { ProjectFile, PropertyDecl, HostScopeRegistry } from "@patterkit/model";

interface PatterHost {
  /** Next float in [0, 1) from the seeded PRNG (for `random`). */
  nextRandom?: () => number;
  /** Times the current flow has entered a node (for `visits` / `seen`). */
  visits?: (id: string) => number;
  /** Times any flow has entered a node, world-wide (for `patter_visits` / `patter_seen`). */
  patterVisits?: (id: string) => number;
}

function host(h: EvalHelpers): PatterHost {
  return (h.ctx.host ?? {}) as PatterHost;
}

/** The Patter dialect: scopes patter/scene + built-in functions. */
export const patterDialect: Dialect = {
  defaultScope: "patter",
  scopes: [
    { token: "patter" },   // global / world state (graceful-false on miss); bare @name
    { token: "scene" },    // scene-local (per-flow or shared, per the property's `shared` flag)
  ],
  functions: {
    random: {
      minArgs: 2, maxArgs: 2, returnType: "number",
      eval(args: ExprNode[], h: EvalHelpers): ScalarValue {
        if (args.length !== 2) throw new EvalError("random(a, b) requires exactly 2 arguments");
        const next = host(h).nextRandom;
        if (!next) throw new EvalError("random() called without a PRNG in context");
        const a = h.evaluate(args[0]!), b = h.evaluate(args[1]!);
        if (typeof a !== "number" || typeof b !== "number") throw new EvalError("random(a, b) arguments must be numbers");
        if (!Number.isInteger(a) || !Number.isInteger(b)) throw new EvalError("random(a, b) arguments must be integers");
        const lo = Math.min(a, b), hi = Math.max(a, b);
        return Math.floor(next() * (hi - lo + 1)) + lo;
      },
    },
    check_flags: {
      minArgs: 1, returnType: "boolean", flagDeltaArgs: true,
      validate: flagsCall("check_flags"),
      eval(args: ExprNode[], h: EvalHelpers): ScalarValue {
        const flags = readFlags(args[0], h, "check_flags");
        for (let i = 1; i < args.length; i++) {
          const arg = args[i]!;
          if (arg.kind !== "flagdelta") throw new EvalError("check_flags() flag args must be +flagName or -flagName");
          if (arg.sign === "+" ? !flags.includes(arg.name) : flags.includes(arg.name)) return false;
        }
        return true;
      },
    },
    set_flags: {
      minArgs: 1, returnType: "flags", flagDeltaArgs: true,
      validate: flagsCall("set_flags"),
      eval(args: ExprNode[], h: EvalHelpers): ScalarValue {
        const result = [...readFlags(args[0], h, "set_flags")];
        for (let i = 1; i < args.length; i++) {
          const arg = args[i]!;
          if (arg.kind !== "flagdelta") throw new EvalError("set_flags() flag args must be +flagName or -flagName");
          if (arg.sign === "+") { if (!result.includes(arg.name)) result.push(arg.name); }
          else { const idx = result.indexOf(arg.name); if (idx >= 0) result.splice(idx, 1); }
        }
        return result;
      },
    },
    // Visit counts (spec §7): how many times a scene / block / node has been
    // *entered*. `visits` / `seen` are this flow's count (flow-local); the
    // `patter_` variants are the world-wide (@patter / shared) count. The arg is a
    // node id - the same id a jump targets.
    visits: {
      minArgs: 1, maxArgs: 1, returnType: "number",
      validate: idArg("visits"),
      eval: (args, h) => host(h).visits?.(nodeId(args, h, "visits")) ?? 0,
    },
    seen: {
      minArgs: 1, maxArgs: 1, returnType: "boolean",
      validate: idArg("seen"),
      eval: (args, h) => (host(h).visits?.(nodeId(args, h, "seen")) ?? 0) > 0,
    },
    patter_visits: {
      minArgs: 1, maxArgs: 1, returnType: "number",
      validate: idArg("patter_visits"),
      eval: (args, h) => host(h).patterVisits?.(nodeId(args, h, "patter_visits")) ?? 0,
    },
    patter_seen: {
      minArgs: 1, maxArgs: 1, returnType: "boolean",
      validate: idArg("patter_seen"),
      eval: (args, h) => (host(h).patterVisits?.(nodeId(args, h, "patter_seen")) ?? 0) > 0,
    },
  },
};

/**
 * A Patter dialect extended with FOREIGN scope tokens imported from another
 * owner's `scopeRegistrySpec` (e.g. a storylet's `@world` / `@player` / `@system`).
 * The parser needs every referenced scope token registered, so authoring tools
 * that allow cross-engine references must compile/validate with this dialect.
 * Foreign scopes use the default missing policy (graceful-false). With no spec
 * (or an empty one) this returns the base `patterDialect` unchanged.
 */
export function dialectWithForeignScopes(spec?: ScopeRegistrySpec): Dialect {
  if (!spec || spec.scopes.length === 0) return patterDialect;
  const known = new Set(patterDialect.scopes.map((s) => s.token));
  const extra = spec.scopes
    .filter((s) => !known.has(s.token))
    .map((s) => ({ token: s.token }));
  if (extra.length === 0) return patterDialect;
  return { ...patterDialect, scopes: [...patterDialect.scopes, ...extra] };
}

/**
 * Split a property ref ("@name" / "@scope.name") into scope + name - THE one
 * ref grammar, shared by the compiler's validators and the runtime so they
 * cannot drift. `isScope` says which tokens are scopes in the caller's context
 * (dialect tokens, plus any foreign tokens); anything else - including a bare
 * `@name` and a dotted name whose head is not a scope - is a `patter` property.
 */
export function splitRef(ref: string, isScope: (token: string) => boolean): { scope: string; name: string } {
  const parts = ref.replace(/^@/, "").split(".");
  if (parts.length === 2 && isScope(parts[0]!)) {
    return { scope: parts[0]!, name: parts[1]!.toLowerCase() };
  }
  return { scope: "patter", name: parts.join(".").toLowerCase() };
}

/** Evaluate a visit-function's single argument to the node id (a string). */
function nodeId(args: ExprNode[], h: EvalHelpers, fn: string): string {
  const v = h.evaluate(args[0]!);
  if (typeof v !== "string") throw new EvalError(`${fn}(id) requires a string node id`);
  return v;
}

/** Validate that a visit function's argument is a string id literal. */
function idArg(fnName: string) {
  return (args: ExprNode[], h: import("@wildwinter/expr").ValidateHelpers): void => {
    const first = args[0];
    if (first && first.kind !== "string") {
      h.report({ path: [...h.path, "args", 0], kind: "wrong-arg-type", severity: "error",
        message: `${fnName}(id): the argument must be a string id literal (a scene / block / node id)` });
    }
  };
}

function readFlags(arg: ExprNode | undefined, h: EvalHelpers, fn: string): string[] {
  if (!arg) throw new EvalError(`${fn}() requires at least one argument (the flags variable)`);
  const v = h.evaluate(arg);
  if (Array.isArray(v)) return v as string[];
  if (v === false || v === null || v === undefined) return []; // empty flags
  throw new EvalError(`${fn}() first argument must be a flags property`);
}

// Validation for the flags functions (first arg a flags property; deltas declared).
function flagsCall(fnName: string) {
  return (args: ExprNode[], h: import("@wildwinter/expr").ValidateHelpers): void => {
    if (args.length === 0) return;
    const first = args[0]!;
    if (first.kind !== "scopedvar") {
      h.report({ path: [...h.path, "args", 0], kind: "wrong-arg-type", severity: "error",
        message: `${fnName}(): first argument must be a flags property reference (@name or @scope.name)` });
      return;
    }
    const meta = h.schema.properties.get(first.scope)?.get(first.name);
    if (meta && meta.type !== "flags") {
      const ref = first.scope === h.defaultScope ? first.name : `${first.scope}.${first.name}`;
      h.report({ path: [...h.path, "args", 0], kind: "wrong-arg-type", severity: "error",
        message: `${fnName}(): '@${ref}' is not a flags property (got ${meta.type})` });
      return;
    }
    // The +flag/-flag SHAPE check is independent of whether the property is
    // declared; only the flag-NAME check needs the declaration's value list.
    for (let i = 1; i < args.length; i++) {
      const arg = args[i]!;
      if (arg.kind !== "flagdelta") {
        h.report({ path: [...h.path, "args", i], kind: "wrong-arg-type", severity: "error",
          message: `${fnName}(): argument ${i + 1} must be +flagName or -flagName` });
      } else if (meta?.type === "flags" && meta.enumValues && !meta.enumValues.includes(arg.name)) {
        h.report({ path: [...h.path, "args", i], kind: "unknown-flag-name", severity: "error",
          message: `${fnName}(): unknown flag '${arg.name}'`, reference: arg.name });
      }
    }
  };
}

// ---------------------------------------------------------------------------
// ExpressionSchema from property declarations (provisional scope mapping).
// ---------------------------------------------------------------------------

/**
 * Project the model's host-scope registry (`@world`, ...) onto the
 * `scopeRegistrySpec` the compiler / validator consume. Patter's property types
 * are now the same vocabulary as expr's, so this is a structural pass-through
 * that drops authoring-only fields (`purpose`) and omits unset `writable`;
 * returns undefined for an absent registry so callers can pass it straight through.
 */
export function hostScopesToSpec(reg?: HostScopeRegistry): ScopeRegistrySpec | undefined {
  if (!reg) return undefined;
  return {
    version: reg.version,
    scopes: reg.scopes.map((s) => ({
      token: s.token,
      ...(s.writable === false ? { writable: false } : {}),
      ...(s.declarations
        ? {
            declarations: s.declarations.map((d) => ({
              name: d.name,
              type: d.type,
              ...(d.values ? { values: d.values } : {}),
              ...(d.default !== undefined ? { default: d.default } : {}),
              ...(d.writable === false ? { writable: false } : {}),
            })),
          }
        : {}),
    })),
  };
}

/**
 * Build an ExpressionSchema for validating a scene's expressions: global
 * properties (`@patter`) plus that scene's scene-local properties (`@scene`),
 * plus any FOREIGN scopes imported from another owner's `scopeRegistrySpec`.
 * Scope mapping:
 *   global (project.properties)   -> @patter
 *   scene-local (scene.sceneProps)-> @scene
 *   foreign (spec)                -> its own token (e.g. @world)
 * The `shared` flag is orthogonal - it does not affect validation (both shared
 * and not-shared globals are `@patter`; both scene props are `@scene`). A foreign
 * scope with no declarations is left opaque (omitted) - matching `ScopeRegistry.toSchema`.
 */
export function buildSchema(
  project: ProjectFile,
  sceneProps: PropertyDecl[] = [],
  foreign?: ScopeRegistrySpec,
): ExpressionSchema {
  const properties = new Map<string, Map<string, { type: ExprPropertyType; enumValues?: string[] }>>();
  const put = (scope: string, decl: PropertyDecl): void => {
    let m = properties.get(scope);
    if (!m) { m = new Map(); properties.set(scope, m); }
    m.set(decl.name.toLowerCase(), { type: decl.type, enumValues: decl.values });
  };
  for (const decl of project.properties ?? []) put("patter", decl);
  for (const decl of sceneProps) put("scene", decl);
  const known = new Set(patterDialect.scopes.map((s) => s.token));
  for (const scope of foreign?.scopes ?? []) {
    if (known.has(scope.token)) continue;      // never let a foreign spec shadow patter/scene
    if (!scope.declarations?.length) continue; // opaque scope
    const m = new Map<string, { type: ExprPropertyType; enumValues?: string[] }>();
    for (const d of scope.declarations) m.set(d.name.toLowerCase(), { type: d.type, enumValues: d.values });
    properties.set(scope.token, m);
  }
  return { properties };
}

// ---------------------------------------------------------------------------
// Inline interpolation (spec §16): `{@ref}` slots inside localised strings.
//
// Committed surface = a BARE property reference only - `{@name}`, `{@patter.x}`,
// `{@scene.y}` - resolved to its value and rendered as text. Full expressions /
// ICU-style formatting are deferred (the `{ ... }` delimiter leaves room). Only
// `{ ... }` whose trimmed body starts with `@` is a slot, so JSON-ish `{foo}`
// stays literal. Braces are escaped by doubling: `{{` -> literal `{` and `}}` ->
// literal `}`, so `{{@name}}` renders the text `{@name}` rather than expanding.
// ---------------------------------------------------------------------------

/** A `{ ... }` candidate whose trimmed body starts with `@`. */
export interface Slot {
  /** The whole matched text including braces, e.g. "{@gold}". */
  raw: string;
  /** The trimmed inner body, e.g. "@gold" or (malformed) "@gold + 1". */
  inner: string;
  /** The bare property ref ("@gold") when well-formed; undefined if malformed. */
  ref?: string;
}

const BARE_REF = /^@[A-Za-z0-9_.]+$/;

type Token =
  | { kind: "text"; value: string }
  | ({ kind: "slot" } & Slot);

/**
 * Tokenise a localised string into literal text and `{@ref}` slots, applying
 * brace-doubling escapes (`{{` -> `{`, `}}` -> `}`). The single source of truth
 * for both `interpolate` (runtime) and `extractSlots` (validator), so they can't
 * disagree on what counts as a slot. A `{ ... }` whose trimmed body does not
 * start with `@` is literal (kept verbatim, braces included).
 */
function* tokenise(text: string): Generator<Token> {
  let buf = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "{" && text[i + 1] === "{") { buf += "{"; i += 2; continue; }
    if (c === "}" && text[i + 1] === "}") { buf += "}"; i += 2; continue; }
    if (c === "{") {
      const close = text.indexOf("}", i + 1);
      if (close !== -1) {
        const raw = text.slice(i, close + 1);
        const inner = text.slice(i + 1, close).trim();
        if (inner.startsWith("@")) {
          if (buf) { yield { kind: "text", value: buf }; buf = ""; }
          yield { kind: "slot", raw, inner, ref: BARE_REF.test(inner) ? inner : undefined };
          i = close + 1;
          continue;
        }
        buf += raw; i = close + 1; continue;           // not a slot -> literal braces
      }
    }
    buf += c; i += 1;                                   // ordinary char (incl. an unclosed `{`)
  }
  if (buf) yield { kind: "text", value: buf };
}

/**
 * Find interpolation slots in a localised string. Only `{ ... }` whose trimmed
 * body begins with `@` is a slot; a slot whose body is not a bare ref is returned
 * with `ref` undefined (so the validator can flag it - the committed surface is a
 * bare property reference only). Escaped `{{ }}` braces are not slots.
 */
export function extractSlots(text: string): Slot[] {
  const out: Slot[] = [];
  for (const tok of tokenise(text)) {
    if (tok.kind === "slot") out.push({ raw: tok.raw, inner: tok.inner, ref: tok.ref });
  }
  return out;
}

/** Render a resolved slot value as display text. */
export function renderSlotValue(v: ScalarValue): string {
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

/** ASCII whitespace for caption-collapse - a FIXED set (space, tab, newline, CR, form-feed, vtab) so
 *  every Patterplay runtime collapses identically (a regex `\s` would drift on Unicode across languages). */
function isCaptionWs(c: string): boolean {
  return c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f" || c === "\v";
}

/** Collapse every run of ASCII whitespace to a single space and trim both ends. Manual (no regex) so it
 *  ports byte-for-byte to C# / C++ / GDScript. */
function collapseCaptionWs(s: string): string {
  let out = "";
  let pendingSpace = false;
  for (const c of s) {
    if (isCaptionWs(c)) { pendingSpace = true; continue; }
    if (pendingSpace && out.length > 0) out += " ";
    pendingSpace = false;
    out += c;
  }
  return out;
}

/**
 * Closed-caption stripping (#214): with captions OFF, remove every `open`…`close` span (delimiters
 * included) from a dialogue line and collapse the surrounding whitespace -
 * `Oh dear. (sigh) What now?` -> `Oh dear. What now?`. A string that contains NO cue is returned
 * unchanged (its original whitespace preserved); only a string we actually edited is whitespace-
 * normalised. `open` and `close` may be the same token (e.g. `*…*`); an unclosed `open` keeps the
 * remainder verbatim. An empty `open` is a no-op. Identical across every Patterplay runtime - part of
 * the conformance contract.
 */
export function stripCaptions(text: string, open: string, close: string): string {
  if (open.length === 0 || text.indexOf(open) < 0) return text; // disabled / no cue: fast path, unchanged
  let out = "";
  let i = 0;
  let removed = false;
  while (i < text.length) {
    if (text.startsWith(open, i)) {
      const end = text.indexOf(close, i + open.length);
      if (end >= 0) { i = end + close.length; removed = true; continue; } // skip the whole span
      out += text.slice(i); // unclosed cue -> keep the rest literally
      break;
    }
    out += text[i];
    i += 1;
  }
  return removed ? collapseCaptionWs(out) : text;
}

/**
 * Expand `{@ref}` slots in a string using `resolve` (a property lookup).
 * Well-formed slots become their rendered value (undefined -> empty string);
 * malformed slots and non-slot braces are left verbatim; `{{`/`}}` unescape to
 * literal `{`/`}`.
 */
export function interpolate(text: string, resolve: (ref: string) => ScalarValue | undefined): string {
  if (text.indexOf("{") < 0) return text; // fast path: no slot opener -> nothing to interpolate (the common case)
  let out = "";
  for (const tok of tokenise(text)) {
    if (tok.kind === "text") { out += tok.value; continue; }
    if (!tok.ref) { out += tok.raw; continue; }        // malformed slot -> verbatim
    const v = resolve(tok.ref);
    out += v === undefined ? "" : renderSlotValue(v);
  }
  return out;
}
