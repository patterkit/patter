// ---------------------------------------------------------------------------
// Inline formatting <-> markup tags. The editor carries bold / italic as ProseMirror
// marks (strong / em) on the say + paren zones; on disk they live INSIDE the stored
// string as a CLOSED three-tag vocabulary - <b>bold</b>, <i>italic</i>, <bi>both</bi>.
// Literal text is stored AS-IS: a bare `&`, `<` or `>` is just itself. We deliberately do
// NOT HTML-entity-escape (no &amp; / &lt; / &gt;) - the vocabulary is tiny and closed, so a
// `<` only reads as markup when it forms a complete, matched tag pair; everything else is
// literal. Entity escaping was an over-greedy encoding that leaked `&amp;` into the loc
// strings, the voice script, and the game (the runtime passes the string through opaquely,
// and each engine has its OWN rich-text syntax + escaping - that translation is the game's
// job, not ours). The one accepted edge: typing the literal string "<b>…</b>" renders as bold.
//
// The vocabulary is flat (no nesting): keystroke authoring only ever produces runs that
// are plain / bold / italic / bold+italic, so each run maps to exactly one tag (or none).
// Parsing is tolerant - anything that is not one of the three known tags is treated as
// literal text, so a hand-edited or malformed string degrades to plain rather than breaking.
// ---------------------------------------------------------------------------

import type { Node as PMNode } from "prosemirror-model";
import { patterSchema as S } from "./schema.js";

/** Back-compat ONLY: decode the entity escaping older files used, so a legacy string normalises
 *  to clean literals on read (and writes back clean - we never emit entities again). `&amp;` LAST
 *  so an escaped `&lt;` doesn't double-decode. */
function decodeLegacyEntities(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

const TAG = /<(b|i|bi)>([\s\S]*?)<\/\1>/g;

/** A stored markup string -> the inline text nodes (with strong / em marks) for a zone. */
export function parseMarkup(text: string): PMNode[] {
  if (!text) return [];
  const out: PMNode[] = [];
  const push = (raw: string, marks: ReturnType<typeof S.mark>[]): void => {
    const t = decodeLegacyEntities(raw);
    if (t.length > 0) out.push(S.text(t, marks));
  };
  const marksFor = (tag: string): ReturnType<typeof S.mark>[] =>
    tag === "b" ? [S.mark("strong")] : tag === "i" ? [S.mark("em")] : [S.mark("strong"), S.mark("em")];
  let last = 0;
  let m: RegExpExecArray | null;
  TAG.lastIndex = 0;
  while ((m = TAG.exec(text)) !== null) {
    if (m.index > last) push(text.slice(last, m.index), []); // plain run before the tag
    push(m[2]!, marksFor(m[1]!));
    last = TAG.lastIndex;
  }
  if (last < text.length) push(text.slice(last), []);
  return out;
}

/** A zone node (say / paren) -> its stored markup string: marks become tags, literal text is verbatim
 *  (no entity escaping - see the header note). */
export function serializeMarkup(zone: PMNode): string {
  let out = "";
  zone.forEach((child) => {
    if (!child.isText) return; // zones only ever hold text
    const t = child.text ?? "";
    const strong = child.marks.some((mk) => mk.type === S.marks.strong);
    const em = child.marks.some((mk) => mk.type === S.marks.em);
    const tag = strong && em ? "bi" : strong ? "b" : em ? "i" : "";
    out += tag ? `<${tag}>${t}</${tag}>` : t;
  });
  return out;
}
