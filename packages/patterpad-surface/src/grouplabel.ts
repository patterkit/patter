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

/** The always-visible structural label for a group's rail header (spec / groups §3). */
export function groupLabel(raw: Record<string, unknown>): string {
  switch (groupRole(raw)) {
    case "option": return "◇ option";
    case "choice": return "choice";
    case "branch": return "branch · first match";
    case "sequence": {
      const o = (raw.options as { order?: string; exhaust?: string } | undefined) ?? {};
      return `sequence · ${o.order ?? "sequential"} · ${o.exhaust ?? "once"}`;
    }
    case "conditional": return "conditional";
    default: return "group";
  }
}
