// The Production Information view (File > Production Information…). A read-only render of the production
// report (spec §13) - the SAME ReportData the CLI's `report` command renders, computed in
// the main process by runReport. Nothing here recomputes: it is purely a presentation of the figures.
//
// Layout: a summary line, headline stat cards (written / voiced lines done -> projected), the writing +
// recording status distributions as bars, plan-coverage + cut notes, then per-scene / per-character /
// per-locale tables. Sections with no data are omitted.

import type { ReportData } from "../../shared/api.js";
import { el } from "./dom.js";

const num = (n: number): string => n.toLocaleString();

/** A horizontal distribution: one bar per ladder rung, widths proportional to the largest count. So a
 *  reader sees at a glance where the work sits (lots of "stub", little "locked"). Zero-count rungs show
 *  too, to make the whole ladder legible. */
function bars(ladder: string[], counts: Record<string, number>): HTMLElement {
  const wrap = el("div", "rpt-bars");
  const max = Math.max(1, ...ladder.map((k) => counts[k] ?? 0));
  for (const rung of ladder) {
    const v = counts[rung] ?? 0;
    const row = el("div", "rpt-bar-row");
    row.append(el("span", "rpt-bar-label", rung));
    const track = el("div", "rpt-bar-track");
    const fill = el("div", "rpt-bar-fill"); fill.style.width = `${Math.round((v / max) * 100)}%`;
    if (v === 0) fill.classList.add("zero");
    track.append(fill);
    row.append(track, el("span", "rpt-bar-count", num(v)));
    wrap.append(row);
  }
  return wrap;
}

/** A headline stat: big number + label + an optional sub-line. */
function card(label: string, big: string, sub?: string): HTMLElement {
  const c = el("div", "rpt-card");
  c.append(el("div", "rpt-card-label", label), el("div", "rpt-card-big", big));
  if (sub) c.append(el("div", "rpt-card-sub", sub));
  return c;
}

function section(cap: string, ...body: HTMLElement[]): HTMLElement {
  const s = el("section", "rpt-section");
  s.append(el("h3", "rpt-section-cap", cap), ...body);
  return s;
}

/** A simple table: header cells + rows of strings (numbers right-aligned via the `num` columns set). */
function table(headers: string[], rows: Array<Array<string | HTMLElement>>, numericFrom = 1): HTMLElement {
  const t = el("table", "rpt-table");
  const thead = el("thead"); const htr = el("tr");
  headers.forEach((h, i) => { const th = el("th", i >= numericFrom ? "rpt-n" : undefined, h); htr.append(th); });
  thead.append(htr); t.append(thead);
  const tbody = el("tbody");
  for (const r of rows) {
    const tr = el("tr");
    r.forEach((cell, i) => {
      const td = el("td", i >= numericFrom ? "rpt-n" : undefined);
      if (typeof cell === "string") td.textContent = cell; else td.append(cell);
      tr.append(td);
    });
    tbody.append(tr);
  }
  t.append(tbody);
  return t;
}

/** Render the whole report into `host` (replacing its contents). Read-only. */
export function renderReport(host: HTMLElement, data: ReportData): void {
  host.replaceChildren();
  const t = data.totals;

  // Summary line: project name, scene count, voiced/text-only badge.
  const summary = el("div", "rpt-summary");
  summary.append(el("span", "rpt-summary-name", data.project.name));
  summary.append(el("span", "rpt-summary-scenes", `${data.scenes.length} scene${data.scenes.length === 1 ? "" : "s"}`));
  summary.append(el("span", `rpt-badge${data.voiced ? " voiced" : ""}`, data.voiced ? "Voiced" : "Text-only"));
  host.append(summary);

  // Headline cards: written + (when voiced) voiced line progress.
  const cards = el("div", "rpt-cards");
  cards.append(card("Written lines", `${num(t.writtenDone)} / ${num(t.projectedWritten)}`,
    `${num(t.writtenRemaining)} to write · ${num(t.written.words)} words`));
  if (data.voiced) cards.append(card("Voiced lines", `${num(t.voicedDone)} / ${num(t.projectedVoiced)}`,
    `${num(t.voicedRemaining)} to write · ${num(t.voiced.words)} words`));
  cards.append(card("Choices", num(t.choices)));
  if (data.voiced) {
    cards.append(card("Ready to record", num(t.voiced.readyToRecord), "voiced lines"));
    cards.append(card("Ready to ship", num(t.voiced.readyToShip), "voiced lines"));
  }
  host.append(cards);

  // Status distributions: per-beat writing status, per-scene status (its lowest beat), + recording.
  host.append(section("Writing status", bars(data.writingLadder, t.written.byWriting)));
  host.append(section("Scene status", bars(data.writingLadder, data.scenesByStatus)));
  if (data.recordingTracked) host.append(section("Recording status", bars(data.recordingLadder, t.voiced.byRecording)));

  // Estimating coverage (only when on) + cut content - the confidence/caveat notes.
  const notes = el("div", "rpt-notes");
  if (data.estimating) {
    const c = data.coverage;
    const estLines = data.scenes.reduce((n, s) => n + (s.estimated ? (s.estimate ?? 0) : 0), 0);
    notes.append(el("p", "rpt-note", `Estimating on: ${c.estimated}/${c.totalScenes} scene${c.totalScenes === 1 ? "" : "s"} estimated (${num(estLines)} projected lines).`));
  }
  if (data.cut.writtenLines > 0) notes.append(el("p", "rpt-note", `Cut (excluded above): ${data.cut.scenes} scene${data.cut.scenes === 1 ? "" : "s"}, ${data.cut.writtenLines} written / ${data.cut.voicedLines} voiced line${data.cut.voicedLines === 1 ? "" : "s"}.`));
  if (notes.childElementCount) host.append(notes);

  // Per-scene table. The Status column is text (a rung name), so the numeric styling starts at column 2.
  if (data.scenes.length) {
    const headers = data.voiced
      ? ["Scene", "Status", "Written", "Voiced", "Choices", "Words"]
      : ["Scene", "Status", "Written", "Choices", "Words"];
    const rows = data.scenes.map((s) => {
      // Estimated scenes are guesswork - flag them so their figures read as projections, not actuals.
      const name = el("span", s.estimated ? "rpt-estimated" : undefined, s.estimated ? `${s.name} (est.)` : s.name);
      const written = `${num(s.writtenDone)} / ${num(s.writtenDone + s.writtenRemaining)}`;
      const base: Array<string | HTMLElement> = [name, s.status ?? ""];
      base.push(written);
      if (data.voiced) base.push(`${num(s.voicedDone)} / ${num(s.voicedDone + s.voicedRemaining)}`);
      base.push(num(s.choices), num(s.written.words));
      return base;
    });
    host.append(section("Scenes", table(headers, rows, 2)));
  }

  // Per-character line rollup. Est. lines (from estimated scenes) shows only when Estimating is on; the
  // Recording breakdown is voiced-only (#206) and a text-only project drops it.
  if (data.characters.length) {
    const rows = data.characters.map((ch): Array<string | HTMLElement> => {
      const base: Array<string | HTMLElement> = [ch.character, num(ch.lines)];
      if (data.estimating) base.push(num(ch.estimatedLines));
      base.push(num(ch.words));
      if (data.voiced) base.push(data.recordingLadder.map((r) => `${r} ${ch.recording[r] ?? 0}`).join(", "));
      return base;
    });
    const headers = ["Character", "Lines", ...(data.estimating ? ["Est. lines"] : []), "Words", ...(data.voiced ? ["Recording"] : [])];
    host.append(section("Cast lines", table(headers, rows, 1)));
  }

  // Per-locale translation coverage.
  if (data.locales.length) {
    const rows = data.locales.map((l): Array<string | HTMLElement> =>
      [l.locale, num(l.translated), num(l.missing), num(l.stale), num(l.words)]);
    host.append(section("Localisation", table(["Locale", "Translated", "Missing", "Stale", "Words"], rows)));
  }
}
