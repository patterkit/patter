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
// keeps that one as it was. That rewrite, and the gate count, are the kernel's (`@wildwinter/expr`), shared
// with Storyletter, so a rename means the same in both editors.
//
// Reordering changes no value at all, and is the one edit that changes what gates MEAN without saying so.
// `stageGateCount` is how the editor says so.
//
// Pure over the scenes: mutates them in place and reports which changed, for the caller to write.
// ---------------------------------------------------------------------------

import { parse, renameStageInExpression, stageGateCount as gatesIn } from "@wildwinter/expr";
import type { Dialect, StageTargetRef } from "@wildwinter/expr";
import { dialectWithForeignScopes } from "@patterkit/dialect";
import { hostScopesToSpec, projectScopes } from "@patterkit/compiler";
import { walkNodes } from "@patterkit/model";
import type { Effect, GameData, GameDataNodeKind, ProjectFile, Scene } from "@patterkit/model";
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

/** The rewrite inside one expression is the kernel's, shared with Storyletter. */
export { renameStageInExpression };

/** Patter's dialect, with the project's host scopes, so `@world.act` parses as it compiles. */
export function stageDialect(project: ProjectFile, gameScopes?: GameScopes): Dialect {
  return dialectWithForeignScopes(hostScopesToSpec(projectScopes(project, gameScopes?.merged).host));
}

/** Does `(scope, name)` in an expression name the target's quality? */
const refersTo = (target: StageTarget): StageTargetRef => (scope, name) => scope === target.scope && name === target.name;

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
 * How many gates order the quality against a stage (`<`, `<=`, `>`, `>=`), counting each: the gates whose
 * meaning a reorder changes, though no value does.
 */
export function stageGateCount(scenes: Scene[], target: StageTarget, dialect: Dialect): number {
  const isTarget = refersTo(target);
  let count = 0;
  for (const scene of reach(scenes, target)) {
    for (const site of sceneSites(scene)) {
      const src = site.get();
      if (src !== undefined) count += gatesIn(src, dialect, isTarget);
    }
  }
  return count;
}

/** What a gameData stage rename touched: the scenes whose nodes changed, and how many values. */
export interface GameDataStageRenameResult {
  scenes: Scene[];
  values: number;
}

/**
 * Carry a quality gameData field's stage rename, `from` to `to`, into every node of the field's type that
 * holds the old name (patter-qualities.md section 2): a field's values are stored by stage name, as a
 * property's are, so a rename has to reach each of them or they quietly stop being on the ladder. The
 * declaration (`project.gameDataFields`) is the caller's to change. No expression reads a gameData value, so
 * there are no literals to carry and no gates a reorder changes. Mutates the scenes in place.
 */
export function renameGameDataStage(
  scenes: Scene[], kind: GameDataNodeKind, field: string, from: string, to: string,
): GameDataStageRenameResult {
  const result: GameDataStageRenameResult = { scenes: [], values: 0 };
  if (to.trim() === "" || from === to) return result;
  for (const scene of scenes) {
    let changed = false;
    const visit = (holder: { gameData?: GameData }): void => {
      if (holder.gameData?.[field] !== from) return;
      holder.gameData[field] = to;
      result.values++;
      changed = true;
    };
    if (kind === "scene") visit(scene);
    for (const block of scene.blocks) {
      if (kind === "block") visit(block);
      walkNodes(block.children, (node) => {
        if (node.type !== "snippet") return;
        if (kind === "snippet") visit(node);
        for (const beat of node.beats ?? []) if (beat.kind === kind) visit(beat as { gameData?: GameData });
      });
    }
    if (changed) result.scenes.push(scene);
  }
  return result;
}
