// ---------------------------------------------------------------------------
// Expression compilation + validation (wires @wildwinter/expr via the Patter
// dialect). `compileExpression` turns a `src` string into the bundle's
// { src, ast } envelope; `validateConditions` parses + validates every
// condition / effect expression in a project against a property schema.
// ---------------------------------------------------------------------------

import { compile, parse, validateExpr } from "@wildwinter/expr";
import type { ExprNode, ExpressionValidationIssue } from "@wildwinter/expr";
import { dialectWithForeignScopes, buildSchema, extractSlots, splitRef, withEngineScopes, hostScopesToSpec } from "@patterkit/dialect";
import type { ScopeRegistrySpec } from "@wildwinter/scoperegistry";
import { referenceNote } from "@wildwinter/scoperegistry/scopes";
import type { MergedScopes } from "@wildwinter/scoperegistry/scopes";
import { externalGameScopes, projectScopes } from "./game-scopes.js";
import { walkNodes } from "@patterkit/model";
import type {
  Expression, ProjectFile, Scene, Block, Effect, Beat, LocaleFile,
} from "@patterkit/model";

/**
 * Compile a condition/effect `src` string to the bundle `{ src, ast }` envelope.
 * Pass `foreign` to allow references into another owner's imported scopes (e.g.
 * a storylet's `@world`); the parser needs every referenced scope registered.
 */
export function compileExpression(src: string, foreign?: ScopeRegistrySpec): Expression {
  return compile(src, dialectWithForeignScopes(foreign));
}

/**
 * What the validators take besides the project. `foreignScopes` is the host spec, checked strictly (a
 * project's own `@world`, or another owner's spec). `gameScopes` is the game's merged `game-scopes/`
 * folder: every scope in it the host spec doesn't hold is checked too, but only ever with WARNINGS
 * (patterkit/design/shared-scopes.md decision 3). Given `gameScopes` and no `foreignScopes`, the host
 * spec is the project's host scopes as the folder leaves them (`projectScopes`).
 */
export interface ValidateOptions {
  foreignScopes?: ScopeRegistrySpec;
  gameScopes?: MergedScopes;
}

/** The scopes a validation pass works over, worked out once per call. */
interface ValidationScopes {
  /** Host scopes plus every external token OPAQUE: the strict pass, as a project with no folder has. */
  foreign: ScopeRegistrySpec;
  /** The same with the folder's external declarations filled in, when there are any: the warning pass. */
  checked?: ScopeRegistrySpec;
  /** Tokens whose findings are warnings: the folder's scopes the host spec doesn't hold. */
  external: Set<string>;
  merged?: MergedScopes;
}

function validationScopes(project: ProjectFile, options: ValidateOptions): ValidationScopes {
  const merged = options.gameScopes;
  const strict = options.foreignScopes ?? (merged ? hostScopesToSpec(projectScopes(project, merged).host) : undefined);
  const external = externalGameScopes(strict, merged);
  const base = strict?.scopes ?? [];
  // The family's other engines (`@story`) are in by default, opaque unless something declares them.
  const foreign = withEngineScopes({ version: strict?.version ?? 1, scopes: [...base, ...external.map((s) => ({ token: s.token }))] });
  const checked = external.some((s) => s.declarations?.length)
    ? withEngineScopes({ version: strict?.version ?? 1, scopes: [...base, ...external] })
    : undefined;
  return { foreign, checked, external: new Set(external.map((s) => s.token)), merged };
}

/** An issue's identity within one expression, for telling the warning pass's findings from the strict pass's. */
const issueKey = (i: ExpressionValidationIssue): string => `${i.kind}|${JSON.stringify(i.path)}|${i.message}`;

/** The warning pass's own words for a finding in another tool's scope: an undeclared name says whose file doesn't declare it. */
function externalMessage(i: ExpressionValidationIssue, merged: MergedScopes | undefined): string {
  if (merged && i.kind === "unresolved-scoped-property" && i.reference) {
    const [token, name] = i.reference.split(".");
    if (token && name) return referenceNote(merged, token, name) ?? i.message;
  }
  return i.message;
}

export interface ConditionIssue {
  /** Id of the node whose expression has the issue. */
  nodeId: string;
  /** Where on the node: "condition" / "onEnter.set" / "onExit.set" / ... */
  field: string;
  /** The offending source expression. */
  src: string;
  message: string;
  /** "error" blocks a clean build; "warning" is advisory. Condition issues carry the expr
   *  validator's own severity; the compiler's own structural pushes are always errors. */
  severity: "error" | "warning";
}

/**
 * Parse + validate every condition and effect expression in a project's scenes.
 * Uses the Patter dialect and a per-scene ExpressionSchema (global properties +
 * the scene's scene-local properties). Pass `options.foreignScopes` (another
 * owner's `scopeRegistrySpec`) to permit + validate references into imported
 * scopes; writes (`set` effects) that target a read-only foreign property are
 * reported. Returns an empty array when all are valid.
 */
export function validateConditions(
  input: { project: ProjectFile; scenes: Scene[] },
  options: ValidateOptions = {},
): ConditionIssue[] {
  const issues: ConditionIssue[] = [];
  const { foreign, checked, external, merged } = validationScopes(input.project, options);
  const dialect = dialectWithForeignScopes(foreign);
  const readOnly = readOnlyForeignTargets(foreign);
  const opaqueForeign = opaqueForeignTokens(foreign);
  const isScopeToken = scopeTokenTest(foreign);
  const nodeIds = collectNodeIds(input.scenes); // for visit-function id checks

  // Flag a visits()/seen()/patter_* call whose literal id isn't a real node.
  const checkVisitIds = (node: ExprNode, nodeId: string, field: string, src: string): void => {
    if (node.kind === "call") {
      if (VISIT_FNS.has(node.name)) {
        const arg = node.args[0];
        if (arg && arg.kind === "string" && !nodeIds.has(arg.value)) {
          issues.push({ nodeId, field, src, severity: "error", message: `${node.name}(): unknown node id '${arg.value}'` });
        }
      }
      for (const a of node.args) checkVisitIds(a, nodeId, field, src);
    } else if (node.kind === "binary") {
      checkVisitIds(node.left, nodeId, field, src);
      checkVisitIds(node.right, nodeId, field, src);
    } else if (node.kind === "unary") {
      checkVisitIds(node.operand, nodeId, field, src);
    }
  };

  const validateElement = (
    blocks: Block[],
    sceneProps: Scene["sceneProps"],
    onEntry: Effect[] | undefined,
    elementId: string,
  ): void => {
    const schema = buildSchema(input.project, sceneProps, foreign);
    const checkedSchema = checked ? buildSchema(input.project, sceneProps, checked) : undefined;

    const check = (nodeId: string, field: string, src: string): void => {
      let ast;
      try {
        ast = parse(src, dialect);
      } catch (e) {
        issues.push({ nodeId, field, src, severity: "error", message: e instanceof Error ? e.message : String(e) });
        return;
      }
      const strict = validateExpr(ast, schema, dialect);
      for (const iss of strict) {
        issues.push({ nodeId, field, src, severity: iss.severity, message: iss.message });
      }
      // Again with the other tools' declarations filled in: whatever that finds and the strict pass
      // did not (an undeclared name, a type mismatch) is about their scopes, so it is a warning.
      if (checkedSchema) {
        const seen = new Set(strict.map(issueKey));
        for (const iss of validateExpr(ast, checkedSchema, dialect)) {
          if (!seen.has(issueKey(iss))) issues.push({ nodeId, field, src, severity: "warning", message: externalMessage(iss, merged) });
        }
      }
      checkVisitIds(ast, nodeId, field, src);
    };

    // A `set` target must be a well-formed property ref that resolves to a
    // DECLARED property (an undeclared target would silently graceful-miss or
    // pollute a bag at runtime). Opaque foreign scopes are the one pass-through:
    // their declarations live with the foreign owner and cannot be checked here.
    const checkTarget = (nodeId: string, field: string, target: string): void => {
      if (!TARGET_REF.test(target)) {
        issues.push({ nodeId, field, src: target, severity: "error",
          message: `set target must be a property reference (@name / @scope.name), got '${target}'` });
        return;
      }
      if (readOnly.has(refKey(target))) {
        issues.push({ nodeId, field, src: target, severity: "error",
          message: `cannot assign to read-only property '${target}'` });
        return;
      }
      const { scope, name } = splitRef(target, isScopeToken);
      // Another tool's scope: its file says whether the name exists and may be written, as a warning.
      if (external.has(scope)) {
        const note = merged ? referenceNote(merged, scope, name, { write: true }) : undefined;
        if (note) issues.push({ nodeId, field, src: target, severity: "warning", message: note });
        return;
      }
      if (opaqueForeign.has(scope)) return;
      if (!schema.properties.get(scope)?.has(name)) {
        issues.push({ nodeId, field, src: target, severity: "error",
          message: `set target '${target}' is not a declared property` });
      }
    };

    const checkEffects = (nodeId: string, list: Effect[] | undefined, label: string): void => {
      // SET-ONLY (spec §15): an effect is a property mutation - check its target + value expression.
      for (const e of list ?? []) {
        checkTarget(nodeId, `${label}.set`, e.target);
        check(nodeId, `${label}.set`, e.value);
      }
    };

    checkEffects(elementId, onEntry, "onEntry");

    for (const block of blocks) {
      walkNodes(block.children, (node) => {
        if (node.condition) check(node.id, "condition", node.condition);
        if (node.type === "snippet") {
          checkEffects(node.id, node.onEnter, "onEnter");
          checkEffects(node.id, node.onExit, "onExit");
        }
      });
    }
  };

  for (const scene of input.scenes) validateElement(scene.blocks, scene.sceneProps, scene.onEntry, scene.id);

  return issues;
}

/**
 * Validate inline `{@ref}` interpolation slots in a project's localised strings
 * (spec §16). Enforces the VO-safety guarantee - **a voiced project rejects any
 * slot in a line beat** - plus the committed surface (a slot holds a bare
 * property reference only) and that the referenced property is declared. Text
 * beats and CHOICE LABELS always interpolate (labels are on-screen text even in
 * voiced projects); game-event beats carry no localised content. Also flags an
 * option `prompt` id with no string in the default locale (the runtime would
 * display the raw id). Pass `options.foreignScopes` so slots into imported
 * scopes (`{@world.x}`) resolve instead of reporting unknown. Returns an empty
 * array when all are valid.
 */
export function validateInterpolation(
  input: { project: ProjectFile; scenes: Scene[]; locales?: LocaleFile[] },
  options: ValidateOptions = {},
): ConditionIssue[] {
  const issues: ConditionIssue[] = [];
  const voiced = input.project.voiced ?? false;
  const tables = (input.locales ?? []).map((l) => ({ locale: l.locale, strings: l.strings }));
  const defaultLocale = input.project.locales.default;
  const { foreign, external, merged } = validationScopes(input.project, options); // `@story` is in by default, opaque
  const opaqueForeign = opaqueForeignTokens(foreign);
  const isScopeToken = scopeTokenTest(foreign);

  for (const scene of input.scenes) {
    const schema = buildSchema(input.project, scene.sceneProps, foreign);
    /** True when the slot's property is known here; a string when another tool's file has something to
     *  say about it (a warning); false when nobody declares it. */
    const known = (ref: string): boolean | string => {
      const { scope, name } = splitRef(ref, isScopeToken);
      if (external.has(scope)) return (merged ? referenceNote(merged, scope, name) : undefined) ?? true;
      if (opaqueForeign.has(scope)) return true; // the foreign owner declares it; graceful here
      return schema.properties.get(scope)?.has(name) ?? false;
    };

    /** Slot-check one localised string. `voicedLine` applies the VO-safety rejection. */
    const checkString = (nodeId: string, id: string, voicedLine: boolean): void => {
      for (const t of tables) {
        const text = t.strings[id];
        if (text === undefined) continue;
        const field = `text[${t.locale}]`;
        for (const slot of extractSlots(text)) {
          if (voicedLine) {
            issues.push({ nodeId, field, src: slot.raw, severity: "error",
              message: `voiced line beats cannot contain interpolation ${slot.raw} (spec §16)` });
            continue;
          }
          if (!slot.ref) {
            issues.push({ nodeId, field, src: slot.raw, severity: "error",
              message: `interpolation slot holds a bare property reference only, got '${slot.inner}' (spec §16)` });
            continue;
          }
          const ok = known(slot.ref);
          if (typeof ok === "string") {
            issues.push({ nodeId, field, src: slot.raw, severity: "warning", message: ok });
          } else if (!ok) {
            issues.push({ nodeId, field, src: slot.raw, severity: "error",
              message: `unknown property in interpolation slot: '${slot.ref}'` });
          }
        }
      }
    };

    const checkBeat = (beat: Beat): void => {
      if (beat.kind === "gameEvent") return; // no localised content
      checkString(beat.id, beat.id, beat.kind === "line" && voiced);
    };

    for (const block of scene.blocks) {
      walkNodes(block.children, (node) => {
        if (node.type === "snippet") { for (const beat of node.beats ?? []) checkBeat(beat); return; }
        // An option group's `prompt` is on-screen choice text - a localised line/text beat (spec §5).
        if (node.prompt) checkBeat(node.prompt);
      });
    }
  }

  return issues;
}

/** Visit-count functions whose single string-literal argument is a node id. */
const VISIT_FNS = new Set(["visits", "seen", "patter_visits", "patter_seen"]);

/** A well-formed `set` target: `@name` or `@scope.name`. */
const TARGET_REF = /^@[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)?$/;

/** Every addressable/selectable node id in the project (scenes, blocks, groups, snippets). */
function collectNodeIds(scenes: Scene[]): Set<string> {
  const ids = new Set<string>();
  for (const scene of scenes) {
    ids.add(scene.id);
    for (const block of scene.blocks) {
      ids.add(block.id);
      walkNodes(block.children, (n) => ids.add(n.id));
    }
  }
  return ids;
}

/** Foreign scope tokens with NO declarations - opaque; refs into them are not checkable here. */
function opaqueForeignTokens(spec?: ScopeRegistrySpec): Set<string> {
  return new Set((spec?.scopes ?? []).filter((s) => !s.declarations?.length).map((s) => s.token));
}

/** The scope-token test for `splitRef`: the dialect's tokens plus any foreign tokens. */
function scopeTokenTest(spec?: ScopeRegistrySpec): (token: string) => boolean {
  const foreign = new Set((spec?.scopes ?? []).map((s) => s.token));
  return (t) => t === "patter" || t === "scene" || foreign.has(t);
}

/** Normalise a property ref ("@world.Locked") to a "scope.name" key (lowercased). */
function refKey(ref: string): string {
  return ref.replace(/^@/, "").toLowerCase();
}

/**
 * The set of read-only foreign property refs ("scope.name"), from a
 * `scopeRegistrySpec`. A property is read-only when its own `writable` is false,
 * or its scope defaults to read-only and it does not override. Mirrors
 * `ScopeRegistry`'s writability rule so validation matches runtime enforcement.
 */
function readOnlyForeignTargets(spec?: ScopeRegistrySpec): Set<string> {
  const out = new Set<string>();
  for (const scope of spec?.scopes ?? []) {
    const scopeWritable = scope.writable ?? true;
    for (const d of scope.declarations ?? []) {
      const writable = d.writable ?? scopeWritable;
      if (!writable) out.add(`${scope.token}.${d.name}`.toLowerCase());
    }
  }
  return out;
}
