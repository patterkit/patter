// ---------------------------------------------------------------------------
// A quality's stages, edited where they are used.
//
// A quality's value is stored by stage NAME, which is what makes a stage insertable: put one between two
// others and no value anywhere moves. The same choice makes a RENAME the one edit that has to reach every
// value naming the stage, or each of them quietly stops being on the ladder (patterkit
// design/proposals/patter-qualities.md section 2). The declaration and its default are the editor's to
// change; this carries the stage literals in the scenes' expressions:
//
//   - conditions on any node, where the literal is compared with the quality
//   - set effects (a scene's onEntry, a snippet's onEnter and onExit): a comparison in the value, and the
//     whole value when it's the literal and the effect sets the quality
//
// A literal is rewritten in the author's own text where that is unambiguous, and the expression re-written
// through the parser only where it isn't: a condition that also compares another quality with the same word
// keeps that one as it was. The rules are Storyletter's (storylets packages/ops/src/stages.ts), so a rename
// means the same in both editors.
//
// Reordering changes no value at all, and is the one edit that changes what gates MEAN without saying so.
// `stageGateCount` is how the editor says so.
//
// Pure over the scenes: mutates them in place and reports which changed, for the caller to write.
// ---------------------------------------------------------------------------

import { parse, unparse } from "@wildwinter/expr";
import type { Dialect, ExprNode } from "@wildwinter/expr";
import { dialectWithForeignScopes } from "@patterkit/dialect";
import { hostScopesToSpec, projectScopes } from "@patterkit/compiler";
import { walkNodes } from "@patterkit/model";
import type { Effect, ProjectFile, Scene } from "@patterkit/model";
import type { GameScopes } from "./game-scopes.js";

/** The quality a stage edit is about: a property in a scope (`patter`, `scene`, or a host scope such as
 *  `world`) by name. A `scene` property lives in one scene, which `scene` names. */
export interface StageTarget {
  scope: string;
  name: string;
  /** The scene a `scene`-scope quality is declared in. */
  scene?: string;
}

/** What a rename touched, for the caller to write and to report. */
export interface StageRenameResult {
  /** The scenes whose expressions changed. */
  scenes: Scene[];
  /** Expressions rewritten. */
  expressions: number;
}

const COMPARISONS = new Set(["==", "!=", "<", "<=", ">", ">="]);
const ORDERING = new Set(["<", "<=", ">", ">="]);

type Ref = (scope: string, name: string) => boolean;

/** Patter's dialect, with the project's host scopes, so `@world.act` parses as it compiles. */
export function stageDialect(project: ProjectFile, gameScopes?: GameScopes): Dialect {
  return dialectWithForeignScopes(hostScopesToSpec(projectScopes(project, gameScopes?.merged).host));
}

/**
 * Rewrite the stage literal `from` to `to` wherever `src` compares it with the quality `isTarget` names (or,
 * with `assigned`, where the whole expression is that literal: a set effect's value assigned to the quality).
 * Undefined when nothing changed or the source doesn't parse.
 */
export function renameStageInExpression(
  src: string, dialect: Dialect, isTarget: Ref, from: string, to: string, assigned = false,
): string | undefined {
  let ast: ExprNode;
  try { ast = parse(src, dialect); } catch { return undefined; }
  let hits = 0;
  const isRef = (n: ExprNode): boolean => n.kind === "scopedvar" && isTarget(n.scope, n.name);
  const walk = (n: ExprNode): ExprNode => {
    switch (n.kind) {
      case "binary": {
        let left = walk(n.left);
        let right = walk(n.right);
        if (COMPARISONS.has(n.op)) {
          if (isRef(left) && right.kind === "string" && right.value === from) { right = { kind: "string", value: to }; hits++; }
          if (isRef(right) && left.kind === "string" && left.value === from) { left = { kind: "string", value: to }; hits++; }
        }
        return { ...n, left, right };
      }
      case "unary": return { ...n, operand: walk(n.operand) };
      case "call": return { ...n, args: n.args.map(walk) };
      default: return n;
    }
  };
  let next = walk(ast);
  if (assigned && next.kind === "string" && next.value === from) { next = { kind: "string", value: to }; hits++; }
  if (hits === 0) return undefined;

  // The author's own text, with the literals that changed changed: of the quoted occurrences of `from`, the
  // set whose replacement parses to exactly the rewritten expression. Every one first, as that's the usual
  // case; then each other choice, while there are few enough to try. Otherwise the parser's form of it.
  const wanted = JSON.stringify(next);
  const esc = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const quotedTo = (q: string): string => `${q}${to.replace(/\\/g, "\\\\").replace(new RegExp(q, "g"), `\\${q}`)}${q}`;
  const found = [...src.matchAll(new RegExp(`(["'])${esc}\\1`, "g"))];
  const says = (text: string): boolean => {
    try { return JSON.stringify(parse(text, dialect)) === wanted; } catch { return false; }
  };
  const replaced = (mask: number): string => {
    let text = "";
    let at = 0;
    found.forEach((m, i) => {
      if (!(mask & (1 << i))) return;
      text += src.slice(at, m.index) + quotedTo(m[1]!);
      at = m.index! + m[0].length;
    });
    return text + src.slice(at);
  };
  if (found.length > 0 && found.length <= 8) {
    const all = (1 << found.length) - 1;
    if (says(replaced(all))) return replaced(all);
    for (let mask = all - 1; mask > 0; mask--) if (says(replaced(mask))) return replaced(mask);
  }
  return unparse(next, { defaultScope: dialect.defaultScope });
}

/** Does `(scope, name)` in an expression name the target's quality? */
const refersTo = (target: StageTarget): Ref => (scope, name) => scope === target.scope && name === target.name;

/** A set effect's target (`@act`, `@scene.act`) as scope and name. */
function effectTarget(ref: string, dialect: Dialect): { scope: string; name: string } | undefined {
  try {
    const n = parse(ref, dialect);
    return n.kind === "scopedvar" ? { scope: n.scope, name: n.name } : undefined;
  } catch { return undefined; }
}

/** Every expression a scene holds, with a setter, and the property a set effect assigns it to. */
interface ExprSite { get: () => string | undefined; set: (src: string) => void; assignedTo?: string }

function sceneSites(scene: Scene): ExprSite[] {
  const sites: ExprSite[] = [];
  const effects = (list: Effect[] | undefined): void => {
    for (const e of list ?? []) {
      sites.push({ get: () => e.value, set: (src) => { e.value = src; }, assignedTo: e.target });
    }
  };
  effects(scene.onEntry);
  for (const block of scene.blocks) {
    walkNodes(block.children, (node) => {
      if (typeof node.condition === "string") {
        sites.push({ get: () => node.condition, set: (src) => { node.condition = src; } });
      }
      if (node.type === "snippet") { effects(node.onEnter); effects(node.onExit); }
    });
  }
  return sites;
}

/** The scenes whose expressions can name the target: one for a `scene` property, every scene otherwise. */
const reach = (scenes: Scene[], target: StageTarget): Scene[] =>
  target.scope === "scene" ? scenes.filter((s) => s.id === target.scene) : scenes;

/**
 * Carry a quality's stage rename, `from` to `to`, into every expression that compares the quality with the
 * old name or sets it to it. Mutates the scenes in place. The declaration (and its default) is the caller's
 * to change; this is everything that names the stage beside it.
 */
export function renameStage(
  scenes: Scene[], target: StageTarget, from: string, to: string, dialect: Dialect,
): StageRenameResult {
  const result: StageRenameResult = { scenes: [], expressions: 0 };
  if (to.trim() === "" || from === to) return result;
  const isTarget = refersTo(target);
  for (const scene of reach(scenes, target)) {
    let changed = false;
    for (const site of sceneSites(scene)) {
      const src = site.get();
      if (src === undefined) continue;
      const t = site.assignedTo !== undefined ? effectTarget(site.assignedTo, dialect) : undefined;
      const next = renameStageInExpression(src, dialect, isTarget, from, to, t !== undefined && isTarget(t.scope, t.name));
      if (next === undefined) continue;
      site.set(next);
      result.expressions++;
      changed = true;
    }
    if (changed) result.scenes.push(scene);
  }
  return result;
}

/**
 * How many expressions order the quality against a stage (`<`, `<=`, `>`, `>=`): the gates whose meaning a
 * reorder changes, though no value does.
 */
export function stageGateCount(scenes: Scene[], target: StageTarget, dialect: Dialect): number {
  const isTarget = refersTo(target);
  const orders = (n: ExprNode): boolean => {
    switch (n.kind) {
      case "binary": {
        const ref = (m: ExprNode): boolean => m.kind === "scopedvar" && isTarget(m.scope, m.name);
        if (ORDERING.has(n.op) && (ref(n.left) || ref(n.right))) return true;
        return orders(n.left) || orders(n.right);
      }
      case "unary": return orders(n.operand);
      case "call": return n.args.some(orders);
      default: return false;
    }
  };
  let count = 0;
  for (const scene of reach(scenes, target)) {
    for (const site of sceneSites(scene)) {
      const src = site.get();
      if (src === undefined) continue;
      try { if (orders(parse(src, dialect))) count++; } catch { /* an expression that doesn't parse gates nothing */ }
    }
  }
  return count;
}
