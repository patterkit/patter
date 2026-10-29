// How the page shows the references an expression holds (the hands-on fixes review, Q15 and Q16).
//
// Two rules, used by every chip the surface paints (a snippet's or a group's condition, a snippet's
// On begin / On end effects, the scene's entry effects):
//
//   - A property in Patter's own scope reads `@gold`, never `@patter.gold`; any other scope keeps its
//     name in full (`@scene.mood`, `@world.day`).
//   - A `visits(id)` / `seen(id)` naming a scene or block that no longer exists reads "Missing scene" or
//     "Missing block" in the problem colour, with the old id in its tooltip. The jump chip uses the same
//     label and style (`missingTargetEl`), so a deleted target looks the same wherever it shows.

import { humanizeNodeRefs } from "@patterkit/core";

export const MISSING_SCENE = "Missing scene";
export const MISSING_BLOCK = "Missing block";
/** What a target reads while the host's targets are still coming in (a lazy open, before the other scenes
 *  load): nothing alarming, since it may well be there. Only a target absent from the whole list is missing. */
export const PENDING_TARGET = "…";

/** `@patter.gold` -> `@gold`: Patter's own scope is the default one, so the page drops its name. */
export function shortRefs(src: string): string {
  return src.replace(/@patter\.(?=[A-Za-z_])/g, "@");
}

/** Which kind of target an id that no longer resolves most likely named. Ids don't record their kind, so
 *  this reads the prefix every new block gets ("blk"); anything else is taken to be a scene. */
export function missingKind(id: string): "scene" | "block" {
  return /^blk[_-]?/i.test(id) ? "block" : "scene";
}

/** The label a deleted target shows: "Missing scene" or "Missing block". */
export const missingLabel = (id: string): string => (missingKind(id) === "block" ? MISSING_BLOCK : MISSING_SCENE);

/** The tooltip on a deleted target: what's wrong, and the id it used to have. */
export const missingTip = (id: string): string => `${missingLabel(id)}. Its id was ${id}.`;

/** The one element a deleted target is drawn as: the label, in the problem colour, the old id in its tooltip. */
export function missingTargetEl(id: string): HTMLElement {
  const s = document.createElement("span");
  s.className = "missing-target";
  s.textContent = missingLabel(id);
  s.dataset.tip = missingTip(id);
  return s;
}

/** A resolver from a node id to its readable title; null (or undefined) when nothing has that id now. */
export type TargetLabel = (id: string) => string | null | undefined;

// Private-use characters fence the placeholder a missing target stands in as while the text is rewritten,
// so it can be swapped for its element afterwards. Nothing an author types uses them.
const OPEN = "", CLOSE = "";
const SLOT_RE = new RegExp(`${OPEN}(\\d+)${CLOSE}`, "g");

/** An expression as page text: Patter's scope shortened, node ids swapped for their titles. A missing
 *  target reads as its label. */
export function refText(src: string, label: TargetLabel): string {
  return humanizeNodeRefs(shortRefs(src), (id) => label(id) ?? missingLabel(id));
}

/** The same text as DOM: a missing target becomes its problem-coloured element (`missingTargetEl`). */
export function refNodes(src: string, label: TargetLabel): Node[] {
  const missing: string[] = [];
  const text = humanizeNodeRefs(shortRefs(src), (id) => {
    const l = label(id);
    if (l != null) return l;
    missing.push(id);
    return `${OPEN}${missing.length - 1}${CLOSE}`;
  });
  if (!missing.length) return [document.createTextNode(text)];
  const out: Node[] = [];
  let last = 0;
  for (const m of text.matchAll(SLOT_RE)) {
    if (m.index! > last) out.push(document.createTextNode(text.slice(last, m.index)));
    out.push(missingTargetEl(missing[Number(m[1])]!));
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(document.createTextNode(text.slice(last)));
  return out;
}

/** One effect as it reads on the page: "set @gold to @gold + 1". */
export interface EffectLike { kind?: string; target?: string; value?: string }

/** An effects chip's content: "On begin: set @gold to @gold + 1; set @met to true". Empty for no effects. */
export function effectNodes(lead: string, effects: readonly EffectLike[], label: TargetLabel): Node[] {
  const list = effects.filter((e) => e && typeof e.target === "string" && e.target);
  if (!list.length) return [];
  const out: Node[] = [document.createTextNode(`${lead}: `)];
  list.forEach((e, i) => {
    if (i) out.push(document.createTextNode("; "));
    out.push(document.createTextNode(`set ${shortRefs(e.target!)} to `), ...refNodes(e.value ?? "", label));
  });
  return out;
}

/** The effects a node's raw JSON carries under `key`, or none. */
export function effectsOf(raw: Record<string, unknown>, key: string): EffectLike[] {
  const v = raw[key];
  return Array.isArray(v) ? (v as EffectLike[]) : [];
}
