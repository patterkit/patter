// ---------------------------------------------------------------------------
// Content that can never run, found from the tree alone (the hands-on review, 2026-10; Q6).
//
// One walk, read by two passes: the structural validator warns on what it finds after a jump
// (`unreachable-after-jump`), and coverage keeps every input hint off it all (its `shadowed` set).
//
// What each selector does with its children, and so where content can be proved never to run:
//  - `run` (a block's children, a plain group, an option's own run): the children play in order. An
//    unconditioned snippet that jumps (a `jump`, END included, not a `call`, which comes back) leaves
//    the run for good, so every sibling after it never runs. A plain run group with no condition whose
//    own run certainly jumps counts as that jump in the run it sits in: it always runs, and always leaves.
//  - `branch`: the first eligible child plays, and only that one. A child with no condition is always
//    eligible, so every sibling after it is never picked. A jump inside a child never hides a sibling.
//  - `sequence`: one child per visit, chosen by its order and exhaust settings. Every child can be picked,
//    so nothing is hidden, and a jump inside a child hides nothing outside it.
//  - `choice`: the player picks an option, or a fallback is followed. Nothing is hidden among the options,
//    and a jump inside one never hides what follows the choice (another option, or a dry choice, gathers).
// A condition anywhere on the way (on the jumping snippet, or on a group around it) is a branch that
// might not be taken, so it never hides anything. Each child is then walked as its own container, by
// its own selector: an option's or a branch child's run is a run like any other.
// ---------------------------------------------------------------------------

import type { Selector } from "@patterkit/model";

/** The shape the walk reads: an authored node (condition as source text) or a compiled one (an
 *  expression), so the validator and coverage both pass theirs as they are. */
export interface RunTreeNode {
  id: string;
  type: "group" | "snippet";
  condition?: unknown;
  selector?: Selector;
  prompt?: unknown;
  children?: readonly RunTreeNode[];
  jump?: { to: string; mode?: "jump" | "call" };
}

/** A node that never runs, and why. Only the outermost such node is listed: everything inside it never
 *  runs either. */
export type NeverRuns =
  /** After an unconditioned snippet that jumps, in the same run. `jumper` is that snippet (inside a plain
   *  run group before this node, when that is where the jump is); `to` is where it jumps (`END` included). */
  | { id: string; type: "group" | "snippet"; reason: "after-jump"; jumper: string; to: string }
  /** In a `branch`, after a sibling with no condition, which is always picked first. */
  | { id: string; type: "group" | "snippet"; reason: "branch-shadowed"; by: string };

const isNode = (n: unknown): n is RunTreeNode =>
  !!n && typeof n === "object" && typeof (n as { id?: unknown }).id === "string";

/** The nodes in a block that can never run, in script order. `children` is the block's children (a run).
 *  Malformed shapes (a missing children array, a node that is not one) are skipped, never thrown on. */
export function neverRunNodes(children: unknown): NeverRuns[] {
  const out: NeverRuns[] = [];
  walkContainer(children, "run", out);
  return out;
}

type Divert = { jumper: string; to: string };

/** Walk one container's children by its selector. For a run, returns the snippet whose jump the run
 *  certainly takes (so the run never ends normally) and where it goes, or undefined. */
function walkContainer(children: unknown, selector: Selector, out: NeverRuns[]): Divert | undefined {
  if (!Array.isArray(children)) return undefined;
  if (selector === "run") {
    let jumper: Divert | undefined;
    for (const n of children) {
      if (!isNode(n)) continue;
      if (jumper !== undefined) { out.push({ id: n.id, type: n.type, reason: "after-jump", ...jumper }); continue; }
      if (n.type === "snippet") {
        if (!n.condition && n.jump && typeof n.jump.to === "string" && n.jump.mode !== "call") jumper = { jumper: n.id, to: n.jump.to };
        continue;
      }
      const inner = walkContainer(n.children, n.selector ?? "run", out);
      // Only a plain run group that always runs carries its jump out: one with a condition might not run,
      // and a prompt belongs to an option, which a run never holds.
      if (inner !== undefined && !n.condition && !n.prompt && (n.selector ?? "run") === "run") jumper = inner;
    }
    return jumper;
  }
  let winner: string | undefined;
  for (const n of children) {
    if (!isNode(n)) continue;
    if (selector === "branch") {
      if (winner !== undefined) { out.push({ id: n.id, type: n.type, reason: "branch-shadowed", by: winner }); continue; }
      if (!n.condition) winner = n.id;
    }
    if (n.type === "group") walkContainer(n.children, n.selector ?? "run", out);
  }
  return undefined;
}
