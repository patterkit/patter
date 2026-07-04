// The narrative-coverage results view (Review ▸ Run Coverage Test). A read-only render of the
// CoverageReport the main process computes via runCoverage (#159) - the SAME report the CLI's `coverage`
// command prints. A summary header, then a per-scene beat table; never-reached rows are flagged - a danger
// tint for truly-dead beats (‼) and a softer needs-input tint for ones gated on an unwritten @world input
// (?). Clicking a row jumps the editor to that beat.

import type { CoverageReport, CoverageBeat } from "../../shared/api.js";
import { el } from "./dom.js";

const pct = (n: number): string => `${n.toFixed(0)}%`;
const num = (n: number): string => n.toLocaleString();
const clip = (s: string, n = 60): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** A headline stat: big number + label. */
function stat(big: string, label: string): HTMLElement {
  const c = el("div", "cov-stat");
  c.append(el("div", "cov-stat-big", big), el("div", "cov-stat-label", label));
  return c;
}

/**
 * Render the coverage report into `host`. `sceneName` resolves a scene id to its display name; `onReveal`
 * jumps the editor to a beat (its scene + node id); `onFindUsage` (optional) opens property-usage search
 * for a gate ref (the "gated on @x → where else is @x used?" path).
 */
export function renderCoverage(
  host: HTMLElement,
  report: CoverageReport,
  sceneName: (id: string) => string,
  onReveal: (sceneId: string, beatId: string) => void,
  onFindUsage?: (ref: string) => void,
): void {
  host.replaceChildren();
  const t = report.totals;

  // Summary: headline stats + the run parameters + termination breakdown.
  const stats = el("div", "cov-stats");
  stats.append(
    stat(pct(t.coveragePct), "beats reached"),
    stat(`${num(t.covered)} / ${num(t.beats)}`, "covered"),
    stat(num(t.neverHit), t.neverHit === 1 ? "never reached" : "never reached"),
  );
  host.append(stats);

  const term = report.termination;
  const meta = el("div", "cov-meta");
  meta.append(el("span", undefined, `${num(report.runs)} run${report.runs === 1 ? "" : "s"} · ${report.maxSteps} max steps · seed ${report.seed}`));
  meta.append(el("span", "cov-meta-sep", `${num(term.ended)} ended · ${num(term.stalled)} stalled · ${num(term.capped)} capped${term.evalError ? ` · ${num(term.evalError)} errored` : ""}`));
  host.append(meta);

  if (report.drivers.length) {
    host.append(el("p", "cov-note", `Inputs driven: ${report.drivers.map((d) => d.ref).join(", ")}`));
  }
  if (report.unwrittenInputs.length) {
    host.append(el("p", "cov-note cov-note-input", `Some dead branches are gated on inputs nothing writes or drives: ${report.unwrittenInputs.join(", ")}. Add a coverage driver in Project Settings ▸ World Properties.`));
  }
  // Choices that ran DRY (fell through with nothing takeable). The runtime hides this - here it is explicit.
  if (report.dryChoices.length) {
    const n = report.dryChoices.length;
    host.append(el("p", "cov-note cov-note-dry",
      `${n} choice${n === 1 ? "" : "s"} ran dry (fell through with nothing the player could take and no fallback). This is a silent dead-end: give the choice a fallback option, or an unconditional one.`));
    const list = el("div", "cov-dry-list");
    for (const d of report.dryChoices) {
      const row = el("button", "cov-dry-item");
      row.append(el("span", "cov-dry-scene", sceneName(d.scene)), el("span", "cov-dry-id", clip(d.id, 32)));
      row.append(el("span", "cov-dry-count", `${num(d.runs)} / ${num(report.runs)} runs`));
      row.title = `Reveal this choice - ran dry in ${num(d.runs)} of ${num(report.runs)} run${report.runs === 1 ? "" : "s"}`;
      row.addEventListener("click", () => onReveal(d.scene, d.id));
      list.append(row);
    }
    host.append(list);
  }

  // Per-scene beat table, document order. Never-reached rows are clickable + flagged.
  const byScene = new Map<string, CoverageBeat[]>();
  for (const b of report.beats) (byScene.get(b.scene) ?? byScene.set(b.scene, []).get(b.scene)!).push(b);

  if (!report.beats.length) {
    host.append(el("p", "cov-empty", "No content beats to measure yet."));
    return;
  }

  for (const [sceneId, beats] of byScene) {
    const dead = beats.filter((b) => b.reachedRuns === 0).length;
    const cap = el("h3", "cov-scene-cap");
    cap.append(el("span", undefined, sceneName(sceneId)));
    if (dead) cap.append(el("span", "cov-scene-dead", `${dead} never reached`));
    host.append(cap);

    const table = el("table", "cov-table");
    const tbody = el("tbody");
    for (const b of beats) {
      const tr = el("tr", b.reachedRuns === 0 ? (b.needsInput ? "cov-row-input" : "cov-row-dead") : undefined);
      // A clickable row jumps to the beat (its scene + id).
      tr.tabIndex = 0;
      const reveal = (): void => onReveal(b.scene, b.id);
      tr.addEventListener("click", reveal);
      tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); reveal(); } });

      const mark = el("td", "cov-mark", b.reachedRuns === 0 ? (b.needsInput ? "?" : "‼") : "");
      const label = b.character ? `${b.character}: ${clip(b.preview)}` : clip(b.preview || `(${b.kind})`);
      const beatCell = el("td", "cov-beat");
      beatCell.append(el("span", "cov-kind", b.kind), el("span", "cov-text", label));
      if (b.needsInput) {
        const gate = el("span", "cov-gate", "gated on ");
        b.needsInput.forEach((ref, i) => {
          if (i) gate.append(document.createTextNode(", "));
          if (onFindUsage) {
            // Each gate ref is a "where else is @x used?" link → property-usage search.
            const a = el("button", "cov-gate-ref", ref); a.type = "button"; a.title = `Find where ${ref} is used`;
            a.addEventListener("click", (e) => { e.stopPropagation(); onFindUsage(ref); }); // don't also trigger the row reveal
            gate.append(a);
          } else gate.append(document.createTextNode(ref));
        });
        beatCell.append(gate);
      }
      const reachCell = el("td", "cov-n cov-reach", pct(b.reachPct));
      const hitsCell = el("td", "cov-n", num(b.hits));
      tr.append(mark, beatCell, reachCell, hitsCell);
      tbody.append(tr);
    }
    table.append(tbody);
    host.append(table);
  }
}
