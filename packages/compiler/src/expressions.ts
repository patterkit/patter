// ---------------------------------------------------------------------------
// Expression compilation + validation (wires @wildwinter/expr via the Patter
// dialect). `compileExpression` turns a `src` string into the bundle's
// { src, ast } envelope; `validateConditions` parses + validates every
// condition / effect expression in a project against a property schema.
// ---------------------------------------------------------------------------

import { compile, parse, validateExpr } from "@wildwinter/expr";
import type { ExprNode } from "@wildwinter/expr";
import { dialectWithForeignScopes, buildSchema, extractSlots, splitRef } from "@patterkit/dialect";
import type { ScopeRegistrySpec } from "@wildwinter/scoperegistry";
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
  options: { foreignScopes?: ScopeRegistrySpec } = {},
): ConditionIssue[] {
  const issues: ConditionIssue[] = [];
  const foreign = options.foreignScopes;
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

    const check = (nodeId: string, field: string, src: string): void => {
      let ast;
      try {
        ast = parse(src, dialect);
      } catch (e) {
        issues.push({ nodeId, field, src, severity: "error", message: e instanceof Error ? e.message : String(e) });
        return;
      }
      for (const iss of validateExpr(ast, schema, dialect)) {
        issues.push({ nodeId, field, src, severity: iss.severity, message: iss.message });
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
  options: { foreignScopes?: ScopeRegistrySpec } = {},
): ConditionIssue[] {
  const issues: ConditionIssue[] = [];
  const voiced = input.project.voiced ?? false;
  const tables = (input.locales ?? []).map((l) => ({ locale: l.locale, strings: l.strings }));
  const defaultLocale = input.project.locales.default;
  const opaqueForeign = opaqueForeignTokens(options.foreignScopes);
  const isScopeToken = scopeTokenTest(options.foreignScopes);

  for (const scene of input.scenes) {
    const schema = buildSchema(input.project, scene.sceneProps, options.foreignScopes);
    const known = (ref: string): boolean => {
      const { scope, name } = splitRef(ref, isScopeToken);
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
          if (!known(slot.ref)) {
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
