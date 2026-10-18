// ---------------------------------------------------------------------------
// A cast member renamed: what follows the name (ruling 8 of patterkit
// design/proposals/patter-storylet-extensions.md). A line names its speaker by
// the member's canonical name (`character`), and the project-level strings key
// a member's shown name and own labels by it (`cast:<NAME>`,
// `speaker:<NAME>:<gameId>`), so all three move with the rename; extension
// data follows through `renameCastKeys` (extensions.ts). Pure, over models the
// caller owns: Patterpad's Settings save plans the writes and sends them
// through the VC layer.
//
// Left as they are: suggestions and edit records in authoring shards, and
// editable-script handoff records, which keep the name a line had when they
// were made (a suggestion's baseline is history, and an out-of-date one says
// so when it's reviewed).
// ---------------------------------------------------------------------------

import { castStringKey, speakerLabelKey, walkNodes } from "@patterkit/model";
import type { Beat, Group, LocaleFile, Scene, Snippet } from "@patterkit/model";

/** Old name -> new name, with no-ops and blanks dropped. Null when nothing is renamed. */
export function cleanCastRenames(renames: Record<string, string> | undefined): Map<string, string> | null {
  const out = new Map<string, string>();
  for (const [from, to] of Object.entries(renames ?? {})) if (from && to && from !== to) out.set(from, to);
  return out.size ? out : null;
}

/** Rewrite the speaker of `scene`'s lines (option prompts among them) through `renames`, in place; all at
 *  once, so a swap of two names lands as a swap. Returns how many lines changed. */
export function renameCastInScene(scene: Scene, renames: ReadonlyMap<string, string>): number {
  let n = 0;
  const visit = (beat: Beat | undefined): void => {
    if (beat?.kind !== "line" || beat.character === undefined) return;
    const to = renames.get(beat.character);
    if (to !== undefined) { beat.character = to; n++; }
  };
  for (const block of scene.blocks ?? []) {
    walkNodes<Group | Snippet>(block.children, (node) => {
      if (node.type === "group") { visit(node.prompt); return; }
      for (const beat of node.beats ?? []) visit(beat);
    });
  }
  return n;
}

const CAST_PREFIX = castStringKey("");
const SPEAKER_PREFIX = speakerLabelKey("", "").slice(0, -1); // `speaker:`, the name and gameId after it

/** The key a project-level string moves to when its member is renamed: `cast:<NAME>`, and the member's own
 *  labels, `speaker:<NAME>:<gameId>`. Undefined for a key no rename touches (the speaker pattern among
 *  them, whose key has no gameId after a name). */
function renamedKey(key: string, renames: ReadonlyMap<string, string>): string | undefined {
  if (key.startsWith(CAST_PREFIX)) {
    const to = renames.get(key.slice(CAST_PREFIX.length));
    return to !== undefined ? castStringKey(to) : undefined;
  }
  if (key.startsWith(SPEAKER_PREFIX)) {
    const at = key.lastIndexOf(":"); // a gameId has no colon, so the last one ends the name
    if (at <= SPEAKER_PREFIX.length) return undefined;
    const to = renames.get(key.slice(SPEAKER_PREFIX.length, at));
    return to !== undefined ? speakerLabelKey(to, key.slice(at + 1)) : undefined;
  }
  return undefined;
}

/** Move a record's `cast:` and `speaker:` keys through `renames`, in place, keeping their order; all at once.
 *  A key whose new name is already there keeps its old name. True when anything moved. */
export function moveCastKeys<T>(record: Record<string, T>, renames: ReadonlyMap<string, string>): boolean {
  const keys = Object.keys(record);
  const finals = keys.map((k) => renamedKey(k, renames) ?? k);
  const count = new Map<string, number>();
  for (const f of finals) count.set(f, (count.get(f) ?? 0) + 1);
  if (finals.every((f, i) => f === keys[i] || count.get(f)! > 1)) return false;
  const entries = keys.map((k, i): [string, T] => [count.get(finals[i]!) === 1 ? finals[i]! : k, record[k]!]);
  for (const k of keys) delete record[k];
  for (const [k, v] of entries) record[k] = v;
  return true;
}

/** A project-level loc shard's strings moved through `renames`, in place. True when anything moved. */
export function renameCastStrings(loc: LocaleFile, renames: ReadonlyMap<string, string>): boolean {
  return loc.strings ? moveCastKeys(loc.strings, renames) : false;
}
