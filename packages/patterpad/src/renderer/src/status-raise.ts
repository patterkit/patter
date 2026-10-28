// Writing status set on more than one line at once: a scene or block's dropdown in the inspector, and the
// ⋯ menu's Status ▸ on a scene, block, group, snippet, or selection (the hands-on fixes review, ruling 3
// and Q17).
//
// A container's status is a floor, not a stamp. Choosing one raises every line below it to it and leaves
// the lines already further along where they are, so marking a scene "Draft" never pulls its finished lines
// back. The lowest rung is the one exception: it's how a scene starts again, so it clears every line's
// status (unset reads as the lowest rung), rather than writing the lowest rung into each. A single line
// takes exactly what's chosen, either way, and the lowest rung clears it as it always has. One write, so
// one undo step.

export interface Rung { name: string }

/** A status's place on the ladder; unset reads as the lowest rung, and a name the ladder no longer has
 *  ranks below it (so any status raises it). */
const rankOf = (ladder: readonly Rung[], status: string | undefined): number =>
  status === undefined ? 0 : ladder.findIndex((r) => r.name === status);

/** What a container shows: the lowest status among its lines, and whether they differ. Null with no
 *  ladder or no lines. */
export function lowestStatus(ids: readonly string[], statusOf: (id: string) => string | undefined, ladder: readonly Rung[]): { status: string; mixed: boolean } | null {
  if (!ladder.length || !ids.length) return null;
  const ranks = ids.map((id) => Math.max(0, rankOf(ladder, statusOf(id))));
  return { status: ladder[Math.min(...ranks)]!.name, mixed: new Set(ranks).size > 1 };
}

/** What setting `status` on these lines changes: each line's new status, or null to clear it. Lines that
 *  keep what they have aren't listed. */
export function planStatus(ids: readonly string[], status: string | null, statusOf: (id: string) => string | undefined, ladder: readonly Rung[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  const lowest = ladder[0]?.name;
  const clears = status === null || status === lowest;
  if (ids.length === 1 || !ladder.length) {
    const next = clears ? null : status;
    for (const id of ids) if ((statusOf(id) ?? null) !== next) out.set(id, next);
    return out;
  }
  if (clears) {
    for (const id of ids) if (statusOf(id) !== undefined) out.set(id, null);
    return out;
  }
  const target = rankOf(ladder, status);
  if (target < 0) return out; // not a rung of this ladder: nothing to raise to
  for (const id of ids) if (rankOf(ladder, statusOf(id)) < target) out.set(id, status);
  return out;
}
