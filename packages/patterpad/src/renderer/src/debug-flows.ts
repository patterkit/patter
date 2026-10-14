// The live debug link's flow picker, as data (#181): how a running game's flows are named, grouped, and
// placed beside their scenes, and which node marks an option the game took. No DOM, so it's tested on
// its own; debug-panel.ts draws it.
//
// Flow names carry their owner as a prefix up to the first "/" (`patterstage/gate/talk`, `menu/title`).
// The picker groups by that prefix under a caption and shows the rest, keeping the full name for the
// tooltip. A name without one (`main`) stands on its own, before the groups.

/** One flow's row: its full name, the shortened label, and the display name (else id) of its scene. */
export interface FlowRow { id: string; label: string; scene: string | null }
/** The rows sharing a prefix, or the ungrouped rows (prefix null). */
export interface FlowGroup { prefix: string | null; rows: FlowRow[] }

/** Where a flow name splits: the first "/" with something on both sides of it, else none. */
function split(id: string): { prefix: string; rest: string } | null {
  const at = id.indexOf("/");
  return at > 0 && at < id.length - 1 ? { prefix: id.slice(0, at), rest: id.slice(at + 1) } : null;
}

/** A flow's name without its prefix (`patterstage/gate/talk` is `gate/talk`); a name without one is itself. */
export function shortFlowName(id: string): string {
  return split(id)?.rest ?? id;
}

const byName = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/** The picker's groups: the ungrouped flows first, then each prefix in name order, the rows in name order
 *  inside each (numbers in order, so `#p9` comes before `#p10`). `sceneName` turns a scene id into its
 *  display name; a scene it doesn't know shows as its id. */
export function groupFlows(
  flows: readonly string[], scenes: Readonly<Record<string, string | null>>, sceneName: (sceneId: string) => string | undefined,
): FlowGroup[] {
  const groups = new Map<string | null, FlowRow[]>();
  for (const id of flows) {
    const parts = split(id);
    const sceneId = scenes[id] ?? null;
    const row: FlowRow = { id, label: parts?.rest ?? id, scene: sceneId == null ? null : sceneName(sceneId) ?? sceneId };
    const key = parts?.prefix ?? null;
    const rows = groups.get(key) ?? [];
    rows.push(row);
    groups.set(key, rows);
  }
  const prefixes = [...groups.keys()].filter((k): k is string => k !== null).sort(byName);
  const keys: Array<string | null> = groups.has(null) ? [null, ...prefixes] : prefixes;
  return keys.map((prefix) => ({ prefix, rows: groups.get(prefix)!.sort((a, b) => byName(a.label, b.label)) }));
}

/** The node a debug-link frame marks in the editor. A choice frame sent again with the option the game took
 *  (`optionId`) marks that option's prompt, the beat the playhead then leaves its visited dot on, as it does
 *  for every beat a run passes through. An option with no prompt, or one not in this scene, leaves the
 *  playhead on the choice. */
export function markTarget(beatId: string | null, optionId: string | undefined, promptOf: (optionId: string) => string | null): string | null {
  return optionId ? promptOf(optionId) ?? beatId : beatId;
}
