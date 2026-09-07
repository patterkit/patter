// ---------------------------------------------------------------------------
// Node references inside a written condition, and how to read them out loud.
//
// The visit-counting functions (`visits` / `seen`, and their world-wide `patter_` variants) take a NODE
// ID - the same opaque id a jump targets. Nobody wants to read `visits("blk_x7q2")`, so every surface
// that shows a condition to a person swaps the id for the scene / block title: the editor's condition
// tag, and the readable script the writer hands a director.
//
// It lives here because it was written twice and the copies drifted. The editor's took a bareword arg;
// the script export's insisted on quotes, and Patterpad writes barewords - so a PDF full of
// `‹ if not seen(blk_lcd858q2) ›` went out while the editor showed `‹ if not seen(Intro) ›` for the
// same condition (#64). One rule, one place, both callers.
//
// Both forms are valid and equivalent: the dialect parses a bareword argument as the same string
// literal a quoted one gives, so either may appear in a file.
// ---------------------------------------------------------------------------

const VISIT_FN_RE = /\b(patter_visits|patter_seen|visits|seen)\s*\(\s*(?:(['"])(.*?)\2|([A-Za-z_]\w*))\s*\)/g;

/**
 * Rewrite every `visits(id)` / `seen(id)` in `cond` with `label(id)` in place of the id, leaving the
 * rest of the expression untouched. `label` returns the id itself for anything it cannot name, so an
 * id that no longer resolves still reads as it always did rather than vanishing.
 */
export function humanizeNodeRefs(cond: string, label: (id: string) => string): string {
  return cond.replace(VISIT_FN_RE, (_m, fn: string, _q: string | undefined, quoted: string | undefined, bare: string | undefined) =>
    `${fn}(${label(quoted ?? bare ?? "")})`);
}
