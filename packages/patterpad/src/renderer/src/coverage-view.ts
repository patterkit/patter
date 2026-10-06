// The narrative-coverage results view (Review ▸ Coverage Test…). A read-only render of the
// CoverageReport the main process computes via runCoverageAsync (#159) - the SAME report the CLI's `coverage`
// command prints. A summary header, then the beat table: least reached first by default, so the rows worth a
// look lead, or in script order, scene by scene. Never-reached rows are flagged - a danger tint for
// truly-dead beats and a softer needs-input tint for ones gated on an unwritten @world input (?) - and rows
// reached in only a few runs carry a quiet "Rare" tag. Clicking a row jumps the editor to that beat.

import type { CoverageReport, CoverageBeat } from "../../shared/api.js";

/** Least reached first: never-reached at the top, then by reach %, then by times played, script order kept
 *  among equals. The SAME order as @patterkit/ops' `leastReachedFirst` (the CLI's default), restated here
 *  because the renderer cannot load that Node package; coverage-view.test.ts pins the two together. */
export function leastReachedFirst(beats: readonly CoverageBeat[]): CoverageBeat[] {
  return beats
    .map((b, i) => ({ b, i }))
    .sort((x, y) => x.b.reachPct - y.b.reachPct || x.b.hits - y.b.hits || x.i - y.i)
    .map(({ b }) => b);
}

/** Which order the beat table is in. */
export type CoverageOrder = "least" | "script";
import { el } from "./dom.js";
import { iconNode, formatCount as num, metaLine } from "@wildwinter/app-shell"; // the drawn warning mark on a dead beat; the grouped count; the drawn separator

const pct = (n: number): string => `${n.toFixed(0)}%`;
/** The beat-kind tag beside a row, in the inspector's words: the report's `gameEvent` token is a
 *  key, not a caption. */
const KIND_LABEL: Record<CoverageBeat["kind"], string> = { line: "Line", text: "Text", gameEvent: "Game event" };
const clip = (s: string, n = 60): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** A headline stat: big number + label. */
function stat(big: string, label: string): HTMLElement {
  const c = el("div", "cov-stat");
  c.append(el("div", "cov-stat-big", big), el("div", "cov-stat-label", label));
  return c;
}

/** Options for the beat table: which order it opens in, and who to tell when the author switches it. */
export interface CoverageViewOptions {
  order?: CoverageOrder;
  onOrderChange?: (order: CoverageOrder) => void;
}

/**
 * Render the coverage report into `host`. `sceneName` resolves a scene id to its display name; `onReveal`
 * jumps the editor to a beat (its scene + node id); `onFindUsage` (optional) opens property-usage search
 * for a gate ref (the "gated on @x → where else is @x used?" path). `opts.order` picks the table's order
 * (least reached first when absent); the switch above the table re-draws it in place.
 */
export function renderCoverage(
  host: HTMLElement,
  report: CoverageReport,
  sceneName: (id: string) => string,
  onReveal: (sceneId: string, beatId: string) => void,
  onFindUsage?: (ref: string) => void,
  opts: CoverageViewOptions = {},
): void {
  host.replaceChildren();
  const t = report.totals;
  const rareLimit = report.rareThresholdPct ?? 5;
  const rareCount = t.rare ?? report.beats.filter((b) => b.rare).length;

  // Summary: headline stats + the run parameters + how the runs ended.
  const stats = el("div", "cov-stats");
  const rareStat = stat(num(rareCount), "Rarely reached");
  rareStat.dataset.tip = `Reached, but in fewer than ${rareLimit}% of runs`;
  stats.append(
    stat(pct(t.coveragePct), "Beats reached"),
    stat(`${num(t.covered)} / ${num(t.beats)}`, "Covered"),
    stat(num(t.neverHit), "Never reached"),
    rareStat,
  );
  host.append(stats);

  const term = report.termination;
  const meta = el("div", "cov-meta");
  // A cancelled sweep reports the runs it ACTUALLY took, so the percentages above are real but the
  // sample is smaller than the one that was asked for. Say so beside them, or a stopped sweep reads as
  // a finished one and a thin sample gets trusted like a thick one.
  if (report.cancelled) meta.append(el("span", "cov-stopped", "Stopped early"));
  // Two drawn metadata lines (the shell's metaLine, a disc between parts): the run parameters, then how the
  // runs ended, in words that say what each count means. The `errored` part is passed as undefined when
  // there were none, and the line skips it.
  meta.append(metaLine([`${num(report.runs)} run${report.runs === 1 ? "" : "s"}`, `${report.maxSteps} max steps`, `seed ${report.seed}`]));
  const ended = metaLine([
    `${num(term.ended)} reached the end`,
    `${num(term.stalled)} stalled at a choice`,
    `${num(term.capped)} hit the step limit`,
    term.evalError ? `${num(term.evalError)} errored` : undefined,
  ]);
  ended.classList.add("cov-meta-ended");
  ended.dataset.tip = "How the runs finished. Stalled: stopped at a choice with nothing to pick. Hit the step limit: still going at Max steps, usually looping round a hub.";
  meta.append(ended);
  host.append(meta);

  if (report.drivers.length) {
    host.append(el("p", "cov-note", `Inputs driven: ${report.drivers.map((d) => d.ref).join(", ")}`));
  }
  if (report.unwrittenInputs.length) {
    host.append(el("p", "cov-note cov-note-input", `Some dead branches are gated on inputs nothing writes or drives: ${report.unwrittenInputs.join(", ")}. Add a coverage driver in Project Settings ▸ World properties.`));
  }
  // Choices that ran DRY (fell through with nothing takeable). The runtime hides this - here it is explicit.
  if (report.dryChoices.length) {
    const n = report.dryChoices.length;
    host.append(el("p", "cov-note cov-note-dry",
      `${n} choice${n === 1 ? "" : "s"} ran dry (fell through with nothing the player could take and no fallback). This is a silent dead end. Give the choice a fallback option or an unconditional one.`));
    const list = el("div", "cov-dry-list");
    for (const d of report.dryChoices) {
      const row = el("button", "cov-dry-item");
      row.append(el("span", "cov-dry-scene", sceneName(d.scene)), el("span", "cov-dry-id", clip(d.id, 32)));
      row.append(el("span", "cov-dry-count", `${num(d.runs)} / ${num(report.runs)} runs`));
      row.dataset.tip = `Reveal this choice. It ran dry in ${num(d.runs)} of ${num(report.runs)} run${report.runs === 1 ? "" : "s"}.`;
      row.addEventListener("click", () => onReveal(d.scene, d.id));
      list.append(row);
    }
    host.append(list);
  }

  // Conditions and effects that failed. The engine plays through them (a failing condition counts as false,
  // a failing effect is skipped), so this list is the only place a coverage run shows them.
  if (report.contentErrors.length) {
    const n = report.contentErrors.length;
    host.append(el("p", "cov-note cov-note-dry",
      `${n} condition${n === 1 ? "" : "s"} or effect${n === 1 ? "" : "s"} failed during the runs, and play went on without ${n === 1 ? "it" : "them"}: a failing condition counts as false, and a failing effect is skipped. Fix the expression.`));
    const list = el("div", "cov-dry-list");
    for (const e of report.contentErrors) {
      const row = el("button", "cov-dry-item");
      row.append(el("span", "cov-dry-scene", sceneName(e.scene)), el("span", "cov-dry-id", clip(`${e.kind}: ${e.message}`, 48)));
      row.append(el("span", "cov-dry-count", `${num(e.runs)} / ${num(report.runs)} runs`));
      row.dataset.tip = `Reveal it. ${e.source ? `${e.source}: ` : ""}${e.message}, in ${num(e.runs)} of ${num(report.runs)} run${report.runs === 1 ? "" : "s"}.`;
      row.addEventListener("click", () => onReveal(e.scene, e.node));
      list.append(row);
    }
    host.append(list);
  }

  if (!report.beats.length) {
    host.append(el("p", "cov-empty", "No content beats to measure yet."));
    return;
  }

  // The order switch, then the table(s) under it. Switching re-draws only the tables.
  let order: CoverageOrder = opts.order ?? "least";
  const bar = el("div", "cov-order");
  const seg = el("div", "seg cov-order-seg");
  seg.setAttribute("role", "tablist");
  const choices: [CoverageOrder, string, string][] = [
    ["least", "Least reached first", "The beats the test reached least lead: the ones worth a look"],
    ["script", "Script order", "Every beat in the order the script runs, scene by scene"],
  ];
  const buttons = choices.map(([value, label, tip]) => {
    const b = el("button", "seg-opt", label);
    b.type = "button"; b.setAttribute("role", "tab"); b.dataset.tip = tip; b.dataset.order = value;
    b.addEventListener("click", () => {
      if (order === value) return;
      order = value;
      paint();
      opts.onOrderChange?.(value);
    });
    seg.append(b);
    return b;
  });
  bar.append(seg);
  host.append(bar);
  const tables = el("div", "cov-tables");
  host.append(tables);

  const scenes = new Set(report.beats.map((b) => b.scene));

  const paint = (): void => {
    for (const b of buttons) {
      const on = b.dataset.order === order;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", String(on));
    }
    tables.replaceChildren();
    if (order === "least") {
      // One table across every scene, least reached first; each row names its scene when there are several.
      tables.append(table(leastReachedFirst(report.beats), scenes.size > 1));
      return;
    }
    // Script order: a table per scene, in document order.
    const byScene = new Map<string, CoverageBeat[]>();
    for (const b of report.beats) (byScene.get(b.scene) ?? byScene.set(b.scene, []).get(b.scene)!).push(b);
    for (const [sceneId, beats] of byScene) {
      const dead = beats.filter((b) => b.reachedRuns === 0).length;
      const rare = beats.filter((b) => b.rare).length;
      const cap = el("h3", "cov-scene-cap");
      cap.append(el("span", undefined, sceneName(sceneId)));
      if (dead) cap.append(el("span", "cov-scene-dead", `${dead} never reached`));
      if (rare) cap.append(el("span", "cov-scene-rare", `${rare} rarely reached`));
      tables.append(cap, table(beats, false));
    }
  };

  /** The column headings, each explaining itself on hover. */
  const head = (): HTMLElement => {
    const thead = el("thead");
    const tr = el("tr");
    const th = (text: string, cls: string | undefined, tip?: string): HTMLElement => {
      const c = el("th", cls, text);
      if (tip) c.dataset.tip = tip;
      return c;
    };
    tr.append(
      th("", "cov-mark"),
      th("Beat", undefined),
      th("Runs reached", "cov-n", "The share of runs that played this beat at least once"),
      th("Times played", "cov-n", "How many times it played across all runs. It can be more than the number of runs, when a beat plays again in the same run"),
    );
    thead.append(tr);
    return thead;
  };

  const table = (beats: CoverageBeat[], withScene: boolean): HTMLElement => {
    const tableEl = el("table", "cov-table");
    const tbody = el("tbody");
    for (const b of beats) tbody.append(beatRow(b, withScene));
    tableEl.append(head(), tbody);
    return tableEl;
  };

  const beatRow = (b: CoverageBeat, withScene: boolean): HTMLElement => {
    const cls = b.reachedRuns === 0 ? (b.needsInput || b.blockedBy ? "cov-row-input" : "cov-row-dead") : b.rare ? "cov-row-rare" : undefined;
    const tr = el("tr", cls);
    // A clickable row jumps to the beat (its scene + id).
    tr.tabIndex = 0;
    const reveal = (): void => onReveal(b.scene, b.id);
    tr.addEventListener("click", reveal);
    tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); reveal(); } });

    const mark = el("td", "cov-mark", b.reachedRuns === 0 && (b.needsInput || b.blockedBy) ? "?" : "");
    if (b.reachedRuns === 0 && !(b.needsInput || b.blockedBy)) mark.append(iconNode("warning", 12));
    const label = b.character ? `${b.character}: ${clip(b.preview)}` : clip(b.preview || `(${b.kind})`);
    const beatCell = el("td", "cov-beat");
    beatCell.append(el("span", "cov-kind", KIND_LABEL[b.kind]), el("span", "cov-text", label));
    if (b.rare) {
      const tag = el("span", "cov-rare", "Rare");
      tag.dataset.tip = `Reached in fewer than ${rareLimit}% of runs. Worth a look: an unlikely route, or a condition that is nearly always false. One of several random picks can be rare by design.`;
      beatCell.append(tag);
    }
    if (withScene) beatCell.append(el("span", "cov-row-scene", sceneName(b.scene)));
    if (b.needsInput) {
      const gate = el("span", "cov-gate", "gated on ");
      b.needsInput.forEach((ref, i) => {
        if (i) gate.append(document.createTextNode(", "));
        if (onFindUsage) {
          // Each gate ref is a "where else is @x used?" link → property-usage search.
          const a = el("button", "cov-gate-ref", ref); a.type = "button"; a.dataset.tip = `Find where ${ref} is used`;
          a.addEventListener("click", (e) => { e.stopPropagation(); onFindUsage(ref); }); // don't also trigger the row reveal
          gate.append(a);
        } else gate.append(document.createTextNode(ref));
      });
      beatCell.append(gate);
    }
    // The second hop: this beat's gate IS written, but only by content that never played. Naming the
    // writer turns two dead beats into one question, and the writer is a link, because the next thing
    // the author wants is to look at IT.
    for (const bg of b.blockedBy ?? []) {
      const line = el("span", "cov-gate cov-gate-blocked");
      line.append(document.createTextNode("gated on "));
      if (onFindUsage) {
        const a = el("button", "cov-gate-ref", bg.ref); a.type = "button"; a.dataset.tip = `Find where ${bg.ref} is used`;
        a.addEventListener("click", (e) => { e.stopPropagation(); onFindUsage(bg.ref); });
        line.append(a);
      } else line.append(document.createTextNode(bg.ref));
      line.append(document.createTextNode(", written only by "));
      bg.writers.forEach((w, i) => {
        if (i) line.append(document.createTextNode(", "));
        const target = report.beats.find((x) => x.id === w);
        if (!target) { line.append(document.createTextNode(w)); return; }
        const a = el("button", "cov-gate-ref", clip(target.preview || target.id, 28)); a.type = "button";
        a.dataset.tip = "Open this beat. It never played either.";
        a.addEventListener("click", (e) => { e.stopPropagation(); onReveal(target.scene, target.id); });
        line.append(a);
      });
      line.append(document.createTextNode(", which never played either."));
      beatCell.append(line);
    }
    const reachCell = el("td", "cov-n cov-reach", pct(b.reachPct));
    const hitsCell = el("td", "cov-n", num(b.hits));
    tr.append(mark, beatCell, reachCell, hitsCell);
    return tr;
  };

  paint();
}
