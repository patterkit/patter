// ---------------------------------------------------------------------------
// The human label + role for a group, derived from its `raw` (the Group object
// minus children). One source of truth shared by the surface rail header
// (web/views.ts) and the detail inspector (src/inspect.ts) so the structural
// wording never drifts between the script and the inspector.
// ---------------------------------------------------------------------------

/** A coarse role for a group, driving both the label and the inspector's heading. */
export type GroupRole = "option" | "choice" | "branch" | "sequence" | "conditional" | "group";

/** Read the option/selector/condition shape off a group's `raw` to a single role. */
export function groupRole(raw: Record<string, unknown>): GroupRole {
  if (raw.prompt !== undefined || raw.secretUntilEligible !== undefined) return "option";
  const sel = (raw.selector as string | undefined) ?? "run";
  if (sel === "choice") return "choice";
  if (sel === "branch") return "branch";
  if (sel === "sequence") return "sequence";
  return raw.condition ? "conditional" : "group"; // run-group: a conditional block, else a plain run
}

/** An option's label parts: the word, then "secret" when it hides until eligible. The rail and the
 *  inspector both read this, so they never disagree about what an option is called (review 2026-10).
 *  The option's diamond marker is drawn on its prompt cell (CSS), not typed into the label. */
export function optionLabelParts(raw: Record<string, unknown>): string[] {
  return raw.secretUntilEligible ? ["Option", "secret"] : ["Option"];
}

/** The always-visible structural label for a group's rail header (spec / groups §3), as its PARTS:
 *  the kind first, then its qualifiers. Sentence case: the rail reads as a caption in words, never a
 *  tracked all-caps eyebrow (design-language §4). The parts are drawn as a metadata line (the shell's
 *  `metaLine`), never joined with a typed "·" (design-language §4, "separators are drawn"). */
export function groupLabelParts(raw: Record<string, unknown>): string[] {
  switch (groupRole(raw)) {
    case "option": return optionLabelParts(raw);
    case "choice": return ["Choice"];
    case "branch": return ["Branch", "first match"];
    case "sequence": {
      const o = (raw.options as { order?: string; exhaust?: string } | undefined) ?? {};
      const order = o.order === "specificity" ? "best match" : (o.order ?? "sequential");
      return ["Sequence", order, o.exhaust ?? "once"];
    }
    case "conditional": return ["Conditional"];
    default: return ["Group"];
  }
}

/** The label as one plain string (for text-only contexts: a tooltip, an accessible name). */
export const labelText = (parts: string[]): string => parts.join(", ");
