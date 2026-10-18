// How the project history restores a `.patterx` (patterkit design/patterpad-undo.md, "The mechanism").
//
// An authoring shard holds blocks the history owns (status, notes, re-record, docs) beside two it does
// not: the EDIT TRAIL, which moves on every scene save, and the CONVERSATION (comments and suggestions),
// which nothing undoes (ruling 3). Restoring the whole file would put an old trail back and withdraw a
// reply posted since, and comparing the whole file would refuse every undo the moment the scene was saved
// or a comment posted. So:
//
// - the trail is never compared, and never restored: the undo stamps it afresh, since an undo is an edit;
// - the conversation is compared and restored only when a step in the history changed it (accepting a
//   suggestion, an editable-script import, a qualifier rename); otherwise it is left as it stands.
//
// Pure: no file system. The history reads and writes; this only says what is the same and what to write.

import { parseSource, canonicalStringify } from "@patterkit/core";
import type { FileRestorer } from "@wildwinter/app-shell/history";

type Shard = Record<string, unknown>;

/** The blocks of a `.patterx` that are a conversation, outside the history unless a step changed them. */
export const CONVERSATION_BLOCKS = ["comments", "suggestions"] as const;
const TRAIL = "edits";

function parse(text: string): Shard | null {
  try {
    const v = parseSource(text);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Shard) : null;
  } catch { return null; }
}

const same = (a: unknown, b: unknown): boolean => canonicalStringify(a ?? null) === canonicalStringify(b ?? null);

/** Did a write change a shard's conversation? Decides whether its later undo restores the conversation. */
export function conversationChanged(before: string | null, after: string | null): boolean {
  const a = before === null ? {} : parse(before);
  const b = after === null ? {} : parse(after);
  if (!a || !b) return before !== after;
  return CONVERSATION_BLOCKS.some((k) => !same(a[k], b[k]));
}

/** The history's restorer for one `.patterx`. `conversation` says whether the history holds a step that
 *  changed its comments or suggestions; `now` stamps the trail. */
export function patterxRestorer(conversation: boolean, now: () => string = () => new Date().toISOString()): FileRestorer {
  const ignored = new Set<string>([TRAIL, ...(conversation ? [] : CONVERSATION_BLOCKS)]);
  const owned = (s: Shard): Shard => Object.fromEntries(Object.entries(s).filter(([k]) => !ignored.has(k)));
  return {
    same(expected, current) {
      if (expected === current) return true;
      if (expected === null || current === null) return false;
      const a = parse(expected), b = parse(current);
      if (!a || !b) return false;
      return same(owned(a), owned(b));
    },
    restore(target, current) {
      if (target === null || current === null) return target;
      const t = parse(target), c = parse(current);
      if (!t || !c) return target;
      const out: Shard = { ...t };
      // The trail as it stands, with each entry the undo changes back stamped now: the strings the step
      // touched are touched again, so their translations go stale as they would for any edit.
      const was = (t[TRAIL] ?? {}) as Record<string, Record<string, unknown>>;
      const is = (c[TRAIL] ?? {}) as Record<string, Record<string, unknown>>;
      const trail: Record<string, Record<string, unknown>> = { ...is };
      const stamp = now();
      for (const id of new Set([...Object.keys(was), ...Object.keys(is)])) {
        if (!same(was[id], is[id])) trail[id] = { ...(is[id] ?? was[id]), modifiedAt: stamp };
      }
      if (Object.keys(trail).length > 0) out[TRAIL] = trail; else delete out[TRAIL];
      if (!conversation) {
        for (const k of CONVERSATION_BLOCKS) { if (c[k] === undefined) delete out[k]; else out[k] = c[k]; }
      }
      return canonicalStringify(out);
    },
  };
}
