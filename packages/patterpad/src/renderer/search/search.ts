// The detached FIND tool window (#205): a small, frameless, always-on-top helper over the project-wide
// index. It STAYS OPEN while you step through hits - choosing a result jumps the editor (which stays live
// underneath) but keeps this window up and focused, so you can navigate across matches and explore.
// Its modes, switchable in-window:
//   - "content":     find by Game ID / title / dialogue text, OR paste an opaque id (the folded-in "Go to ID").
//   - "replace":     find and replace in the source text, previewed before anything is written.
//   - "status":      pick a writing-status rung and browse every line at it (unset = lowest); the box filters.
//   - "recording":   the same over the recording ladder, in a project that tracks audio status.
//   - "property":    every place a property is used (conditions, effects, interpolated text).
//   - "tag":         every node carrying a tag.
//   - "suggestions": the open suggestions, to accept or reject.
import "@patterkit/patterpad-surface/theme.css"; // app design tokens (same look as the editor + play window)
import "@wildwinter/app-shell/tooltip.css"; // the themed bubble initTooltips() below draws
import "@wildwinter/app-shell/controls.css"; // the segmented mode control is the family's `.seg`
import "@wildwinter/app-shell/toast.css"; // a shared module carries its own CSS (multi-window-rules.md)
import "./search.css";
import "@fontsource/newsreader/400.css";
import "@fontsource-variable/inter";

import { applyTheme } from "../src/apply-theme.js";
import { initTooltips } from "@wildwinter/app-shell";
import type { SearchEntry, SearchMode, ReplaceHitDto, OpenSuggestionDto } from "../../shared/api.js";
import { confirmDialog } from "@wildwinter/app-shell";
import "@wildwinter/app-shell/dialog.css"; // the modal frame the confirm sits on (without it, Replace all's confirm drew unstyled)
import "@wildwinter/app-shell/confirm.css"; // a shared module carries its own CSS (multi-window-rules.md)
import "@wildwinter/app-shell/tool-window.css"; // ...and the tool-window chrome (drag bar, pin, close)
import "@wildwinter/app-shell/keys.css"; // ...and the keycaps of the hint line
import { modeHint, locationCrumbs } from "./pieces.js";
import { pinButton, toolWindowHead, iconNode, toast, plural, debounce } from "@wildwinter/app-shell";

// The THEMED rollover. Without this call `data-tip` is inert: the shell's `pinButton` sets it and
// nothing renders it, so this window had a pin with no tooltip at all. Only the editor mounted it.
initTooltips();

const search = window.patterSearch!;

const modesEl = document.getElementById("swin-modes")!;
const modeContentBtn = document.getElementById("mode-content") as HTMLButtonElement;
const modeReplaceBtn = document.getElementById("mode-replace") as HTMLButtonElement;
const modeStatusBtn = document.getElementById("mode-status") as HTMLButtonElement;
const modeRecordingBtn = document.getElementById("mode-recording") as HTMLButtonElement;
const modePropertyBtn = document.getElementById("mode-property") as HTMLButtonElement;
const modeTagBtn = document.getElementById("mode-tag") as HTMLButtonElement;
const modeSuggestionsBtn = document.getElementById("mode-suggestions") as HTMLButtonElement;
const suggRow = document.getElementById("swin-sugg-row")!;
const suggSummary = document.getElementById("swin-sugg-summary")!;
const acceptCleanBtn = document.getElementById("swin-accept-clean") as HTMLButtonElement;
const replaceRow = document.getElementById("swin-replace-row")!;
const replaceInput = document.getElementById("swin-replace") as HTMLInputElement;
const replaceAllBtn = document.getElementById("swin-replace-all") as HTMLButtonElement;

/** Writing-status ("status") and recording-status ("recording") browse share the same chip + filter UI;
 *  the dimension is resolved server-side from the window's mode (#206). */
const statusLike = (m: SearchMode): boolean => m === "status" || m === "recording";
/** Modes that browse via CHIPS + a filter box (writing / recording status, or author tags) rather than a
 *  free-text query. They share the chip rail, the "filter these" input, and the pick-a-chip flow. */
const chipMode = (m: SearchMode): boolean => statusLike(m) || m === "tag" || m === "suggestions";
/** The Suggestions tab's "every handoff" chip (also catches suggestions made by hand in the editor). */
const ALL = "All";
// The head is the shell's `toolWindowHead`: the drag bar, the pin, one "Close (Esc)" and Escape
// closing the window are decided there for every tool window in the family. The mode tabs stand in
// its title slot. The pin is BUILT, not marked up: it owns its own class, aria-pressed and the
// tooltip that says what a click will do.
const pin = pinButton({ pinned: true, onToggle: (on) => search.setPin(on) });
// Escape closes from the query box too (`esc: "always"`): this window's focus lives in a field, and
// the field's own Escape must never swallow the way out.
document.body.prepend(toolWindowHead({ tabs: modesEl, pin, onClose: () => search.close(), esc: "always" }));
const input = document.getElementById("swin-input") as HTMLInputElement;
const chipsEl = document.getElementById("swin-chips")!;
const resultsEl = document.getElementById("swin-results")!;
const hintEl = document.getElementById("swin-hint")!;

const KIND_LABEL: Record<SearchEntry["kind"], string> = {
  scene: "Scene", block: "Block", group: "Group", snippet: "Snippet", beat: "Beat",
};

let mode: SearchMode = "content";
let voiced = false; // recording status (and its tab) is voiced-only (#206)
let hasProject = false; // nothing to re-run against until one is open
// The chip rail's items: writing / recording rungs (with a palette colour) OR author tags (with a node
// count). `activeChip` is the picked one; `chipHits` its full result list (the input box then filters it).
let chips: Array<{ name: string; colour?: number; count?: number }> = [];
let activeChip = "";
let chipHits: SearchEntry[] = [];
let results: SearchEntry[] = [];
let replaceHits: ReplaceHitDto[] = []; // the previewed replacements (Replace mode)
let suggHits: OpenSuggestionDto[] = []; // the open suggestions for the picked chip (Suggestions mode)
let suggShown: OpenSuggestionDto[] = []; // ...after the box's filter
let sel = 0;
let token = 0; // guards against an out-of-order async response overwriting a newer query
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// --- rendering ---------------------------------------------------------------
// Move the highlight by toggling `.sel` on the EXISTING rows (not a full re-render), so the selection
// background eases between rows via the CSS transition and the list scrolls smoothly toward the target
// (design-language §4 "navigation animates toward its target"). A full rebuild would teleport the highlight.
const setSel = (next: number): void => {
  if (!results.length) return;
  const rows = resultsEl.children;
  rows[sel]?.classList.remove("sel");
  sel = (next + results.length) % results.length;
  const row = rows[sel] as HTMLElement | undefined;
  if (row) { row.classList.add("sel"); row.scrollIntoView({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" }); }
};
const rowEl = (e: SearchEntry, i: number): HTMLElement => {
  const r = document.createElement("button");
  r.type = "button";
  r.className = `swin-row${i === sel ? " sel" : ""}`;
  const kind = document.createElement("span"); kind.className = "swin-kind"; kind.textContent = KIND_LABEL[e.kind];
  const name = document.createElement("span"); name.className = "swin-name";
  // What this row IS: a title / Game ID / the line's text - falling back to its location, then its id.
  const what = e.name ?? e.gameId ?? e.text;
  if (what !== undefined) name.textContent = what; else if (e.location.length) name.append(locationCrumbs(e.location)); else name.textContent = e.id;
  r.append(kind, name);
  if (e.location.length) { const loc = document.createElement("span"); loc.className = "swin-loc"; loc.append(locationCrumbs(e.location)); r.append(loc); }
  if (e.gameId && e.name) { const gid = document.createElement("span"); gid.className = "swin-gid"; gid.textContent = e.gameId; r.append(gid); }
  // The opaque id on every row, so an "id → line" lookup confirms the match (and is one click to copy/eye).
  const id = document.createElement("span"); id.className = "swin-id"; id.textContent = e.id; r.append(id);
  // Move the keyboard highlight onto a clicked / hovered row, so it follows the pointer instead of being
  // stuck on the first result.
  r.addEventListener("mouseenter", () => { if (sel !== i) setSel(i); });
  r.addEventListener("mousedown", (ev) => { ev.preventDefault(); sel = i; choose(e); });
  return r;
};

const renderResults = (): void => {
  resultsEl.replaceChildren();
  if (!results.length) {
    const empty = document.createElement("div");
    empty.className = "swin-empty";
    empty.textContent = chipMode(mode)
      ? (activeChip ? (mode === "tag" ? `Nothing tagged “${activeChip}”.` : `No ${activeChip} lines.`) : "")
      : (input.value.trim() ? "No matches." : "");
    resultsEl.append(empty);
    return;
  }
  results.forEach((e, i) => resultsEl.append(rowEl(e, i)));
  resultsEl.children[sel]?.scrollIntoView({ block: "nearest" });
};

const renderChips = (): void => {
  chipsEl.replaceChildren();
  for (const s of chips) {
    const c = document.createElement("button");
    c.type = "button";
    c.className = `swin-chip${s.name === activeChip ? " active" : ""}`;
    if (s.colour != null) { const dot = document.createElement("span"); dot.className = "swin-chip-dot"; dot.style.background = `var(--char-${s.colour})`; c.append(dot); }
    c.append(document.createTextNode(s.name));
    // Tags carry a node count instead of a ladder colour: show it so you can see how used each tag is.
    if (s.count != null) { const n = document.createElement("span"); n.className = "swin-chip-count"; n.textContent = String(s.count); c.append(n); }
    c.addEventListener("mousedown", (ev) => { ev.preventDefault(); void loadChip(s.name); });
    chipsEl.append(c);
  }
};

// Jump to the hit but KEEP this window up + focused, so the arrows / Enter keep driving the list while the editor
// shows the centred result behind.
const choose = (e: SearchEntry): void => { search.jump(e); setTimeout(() => input.focus(), 0); };

// --- queries -----------------------------------------------------------------
const runContent = async (): Promise<void> => {
  const q = input.value;
  const mine = ++token;
  const hits = q.trim() ? await search.search(q) : [];
  if (mine !== token) return; // a newer query superseded this one
  results = hits; sel = 0; renderResults();
};

const runProperty = async (): Promise<void> => {
  const q = input.value;
  const mine = ++token;
  const hits = q.trim() ? await search.propertyUsage(q) : [];
  if (mine !== token) return;
  results = hits; sel = 0; renderResults();
};

const loadChip = async (name: string): Promise<void> => {
  activeChip = name;
  renderChips();
  const mine = ++token;
  if (mode === "suggestions") {
    const hits = await search.suggestions(name === ALL ? {} : { handoff: name });
    if (mine !== token) return;
    suggHits = hits; applyChipFilter(); return;
  }
  const hits = mode === "tag" ? await search.tagUsage(name) : await search.linesByStatus(name, mode === "recording");
  if (mine !== token) return;
  chipHits = hits; applyChipFilter();
};

// --- Replace mode ------------------------------------------------------------
const replaceOpts = () => ({ query: input.value, replacement: replaceInput.value });

/** Preview: list the lines a Replace-all would change, as before → after. */
const runReplacePreview = async (): Promise<void> => {
  const mine = ++token;
  const hits = input.value.trim() ? (await search.replacePreview(replaceOpts())).hits : [];
  if (mine !== token) return;
  replaceHits = hits; sel = 0; renderReplace();
};

/** Render the previewed replacements: each row shows before → after + location, with a per-row Replace. */
const renderReplace = (): void => {
  resultsEl.replaceChildren();
  replaceAllBtn.textContent = replaceHits.length ? `Replace all (${replaceHits.length})` : "Replace all";
  replaceAllBtn.disabled = replaceHits.length === 0;
  if (!replaceHits.length) {
    const empty = document.createElement("div"); empty.className = "swin-empty";
    empty.textContent = input.value.trim() ? "No matches." : "";
    resultsEl.append(empty); return;
  }
  for (const h of replaceHits) {
    const r = document.createElement("div"); r.className = "swin-row swin-rrow";
    const diff = document.createElement("span"); diff.className = "swin-name";
    const before = document.createElement("span"); before.className = "swin-before"; before.textContent = h.before;
    const arrow = document.createElement("span"); arrow.className = "swin-arrow"; arrow.append(iconNode("arrowRight", 12));
    const after = document.createElement("span"); after.className = "swin-after"; after.textContent = h.after;
    diff.append(before, arrow, after);
    const loc = document.createElement("span"); loc.className = "swin-loc"; loc.append(locationCrumbs(h.location));
    const btn = document.createElement("button"); btn.type = "button"; btn.className = "swin-rone"; btn.textContent = "Replace";
    btn.addEventListener("click", () => void applyReplace(h.id));
    r.append(diff, loc, btn);
    resultsEl.append(r);
  }
};

/** Apply the replacement: all matches, or just `onlyId`. Confirm bulk changes; never touch ids/addresses. */
const applyReplace = async (onlyId?: string): Promise<void> => {
  const n = onlyId ? 1 : replaceHits.length;
  if (n === 0) return;
  if (!onlyId) {
    const scenes = new Set(replaceHits.map((h) => h.sceneId)).size;
    const ok = await confirmDialog({
      title: `Replace ${plural(n, "occurrence")} across ${plural(scenes, "scene")}?`,
      // House style rule 30: a confirmation ends with what undo does. Here, nothing: main rewrites the
      // shards and the open scene is remounted from disk, so its editor history starts again.
      body: `Replace “${input.value}” with “${replaceInput.value}”. You can't undo this.`,
      confirmLabel: "Replace",
    });
    if (!ok) return;
  }
  const res = await search.replaceApply({ ...replaceOpts(), onlyId });
  if (!res.ok) { toast(`Replace failed: ${res.error ?? "unknown error"}`, "error"); return; }
  await runReplacePreview(); // refresh: the applied hits are gone
};

const applyChipFilter = (): void => {
  const q = input.value.trim().toLowerCase();
  if (mode === "suggestions") {
    suggShown = q ? suggHits.filter((s) => [s.baseline, s.proposed, s.author, s.sceneName ?? "", s.proposedCharacter ?? ""].some((t) => t.toLowerCase().includes(q))) : suggHits;
    renderSuggestions(); return;
  }
  results = q ? chipHits.filter((e) => (e.text ?? e.name ?? e.location.join(" ")).toLowerCase().includes(q)) : chipHits;
  sel = 0; renderResults();
};

// --- Suggestions mode (bulk review) -------------------------------------------

/** The chips: every open suggestion, then each open handoff's, with counts. */
const suggestionChips = async (): Promise<Array<{ name: string; count: number }>> => {
  const [all, handoffs] = await Promise.all([search.suggestions({}), search.handoffs()]);
  const count = (id: string): number => all.filter((s) => s.handoff === id).length;
  return [{ name: ALL, count: all.length }, ...handoffs.map((h) => ({ name: h.id, count: count(h.id) })).filter((c) => c.count > 0)];
};

/** One suggestion as a row: what it changes, where, by whom, and Accept / Reject. Clicking the row (not a
 *  button) shows the line in the editor. */
const suggestionRow = (s: OpenSuggestionDto): HTMLElement => {
  const r = document.createElement("div");
  r.className = `swin-row swin-rrow swin-srow${s.stale.length ? " stale" : ""}`;
  const what = document.createElement("span"); what.className = "swin-name swin-swhat";
  const part = (cls: string, text: string): HTMLSpanElement => { const x = document.createElement("span"); x.className = cls; x.textContent = text; return x; };
  const arrow = (): HTMLSpanElement => { const a = document.createElement("span"); a.className = "swin-arrow"; a.append(iconNode("arrowRight", 12)); return a; };
  if (s.proposedCut) what.append(part("swin-slabel", "Cut"), part("swin-before swin-cut", s.baseline));
  else if (s.proposed !== s.baseline) what.append(part("swin-before", s.baseline), arrow(), part("swin-after", s.proposed));
  if (s.proposedCharacter !== undefined) what.append(part("swin-slabel", "Speaker"), part("swin-before", s.baselineCharacter || "(none)"), arrow(), part("swin-after", s.proposedCharacter));
  if (s.proposedDirection !== undefined) what.append(part("swin-slabel", "Direction"), part("swin-before", s.baselineDirection || "(none)"), arrow(), part("swin-after", s.proposedDirection || "(none)"));
  const meta = document.createElement("span"); meta.className = "swin-loc";
  meta.append(locationCrumbs(s.sceneName ? [s.sceneName] : []), part("swin-sauthor", s.author));
  if (s.stale.length) { const st = part("swin-stale", "Out of date"); st.dataset.tip = `${s.stale.join(" and ")} changed since this was suggested.`; meta.append(st); }
  const accept = document.createElement("button"); accept.type = "button"; accept.className = "swin-rone"; accept.textContent = "Accept";
  accept.disabled = s.stale.length > 0;
  if (accept.disabled) accept.dataset.tip = "It's out of date. Open the line and review it there.";
  const reject = document.createElement("button"); reject.type = "button"; reject.className = "swin-rone"; reject.textContent = "Reject";
  accept.addEventListener("click", (ev) => { ev.stopPropagation(); void decide([{ id: s.id, accept: true }]); });
  reject.addEventListener("click", (ev) => { ev.stopPropagation(); void decide([{ id: s.id, accept: false }]); });
  r.append(what, meta, accept, reject);
  r.addEventListener("click", () => {
    if (!s.sceneId) return;
    search.jump({ id: s.anchor, kind: "beat", location: s.sceneName ? [s.sceneName] : [], sceneId: s.sceneId });
  });
  return r;
};

const renderSuggestions = (): void => {
  resultsEl.replaceChildren();
  const clean = suggShown.filter((s) => !s.stale.length).length;
  acceptCleanBtn.textContent = clean ? `Accept all clean (${clean})` : "Accept all clean";
  acceptCleanBtn.disabled = clean === 0;
  const stale = suggShown.length - clean;
  suggSummary.textContent = suggShown.length ? `${plural(suggShown.length, "open suggestion")}${stale ? `, ${stale} out of date` : ""}` : "";
  if (!suggShown.length) {
    const empty = document.createElement("div"); empty.className = "swin-empty";
    empty.textContent = input.value.trim() ? "No matches." : "No open suggestions.";
    resultsEl.append(empty); return;
  }
  for (const sg of suggShown) resultsEl.append(suggestionRow(sg));
};

/** Accept or reject on the files, then refresh the chips and the list. */
const decide = async (decisions: Array<{ id: string; accept: boolean }>): Promise<void> => {
  const res = await search.decideSuggestions(decisions);
  if (!res.ok) { toast(res.error ? `Couldn't apply: ${res.error}` : "Couldn't apply", "error"); return; }
  const refused = (res.results ?? []).filter((r) => r.outcome === "stale" || r.outcome === "missing");
  if (refused.length) toast(`${plural(refused.length, "suggestion")} not applied: ${refused[0]!.reason ?? "out of date"}`, "error");
  chips = await suggestionChips();
  if (!chips.some((c) => c.name === activeChip)) activeChip = ALL;
  renderChips();
  await loadChip(activeChip);
};

/** Accept every suggestion shown that still applies cleanly, after a count. */
const acceptAllClean = async (): Promise<void> => {
  const clean = suggShown.filter((s) => !s.stale.length);
  if (!clean.length) return;
  const stale = suggShown.length - clean.length;
  const ok = await confirmDialog({
    title: `Accept ${plural(clean.length, "suggestion")}?`,
    // A sentence, the action on the button, and what undo does (house style rules 29 and 30).
    body: `This accepts every suggestion shown that still applies cleanly.${stale ? ` ${plural(stale, "out-of-date one")} ${stale === 1 ? "stays" : "stay"} open for review.` : ""} You can't undo this.`,
    confirmLabel: "Accept suggestions",
  });
  if (!ok) return;
  await decide(clean.map((s) => ({ id: s.id, accept: true })));
};
acceptCleanBtn.addEventListener("click", () => void acceptAllClean());

// --- mode switching ----------------------------------------------------------
async function setMode(next: SearchMode): Promise<void> {
  mode = next;
  for (const [btn, m] of [[modeContentBtn, "content"], [modeReplaceBtn, "replace"], [modeStatusBtn, "status"], [modeRecordingBtn, "recording"], [modePropertyBtn, "property"], [modeTagBtn, "tag"], [modeSuggestionsBtn, "suggestions"]] as const) {
    btn.classList.toggle("on", mode === m);
    btn.setAttribute("aria-selected", String(mode === m));
  }
  chipsEl.hidden = !chipMode(mode);
  replaceRow.hidden = mode !== "replace"; // the replacement field + Replace-all button
  suggRow.hidden = mode !== "suggestions"; // the summary + Accept all clean
  input.placeholder = mode === "suggestions" ? "Filter suggestions…"
    : mode === "tag" ? "Filter tagged nodes…"
    : statusLike(mode) ? "Filter these lines…"
    : mode === "property" ? "Property usage… (@gold, world.threat, faction rebels)"
    : mode === "replace" ? "Find text to replace…"
    : "Search… (text, title, Game ID, or paste an id)";
  hintEl.replaceChildren(...modeHint(mode)); // the lead phrase + the shell's key bar (pieces.ts)
  results = []; replaceHits = []; sel = 0; renderResults();
  if (chipMode(mode)) {
    input.value = ""; // a chip mode's box is a post-filter; start empty so the full list for the picked chip shows
    chips = mode === "suggestions" ? await suggestionChips() : mode === "tag" ? await search.tags() : await search.statuses(mode === "recording");
    if (!chips.length) {
      activeChip = ""; renderChips();
      resultsEl.replaceChildren();
      const empty = document.createElement("div"); empty.className = "swin-empty";
      empty.textContent = mode === "tag" ? "No tags in this project yet." : "";
      resultsEl.append(empty);
      input.focus(); input.select(); return;
    }
    if (!chips.some((s) => s.name === activeChip)) activeChip = chips[0]!.name;
    renderChips();
    await loadChip(activeChip);
  } else if (mode === "property") {
    await runProperty();
  } else if (mode === "replace") {
    await runReplacePreview();
  } else {
    await runContent();
  }
  input.focus(); input.select();
}

// --- input + keys ------------------------------------------------------------
/** Re-run the current mode's query against what the box holds now. */
const rerun = (): void => {
  if (chipMode(mode)) applyChipFilter();
  else if (mode === "property") void runProperty();
  else if (mode === "replace") void runReplacePreview();
  else void runContent();
};
// A chip mode's box is a post-filter over a list already in hand, so it answers at once; the others
// query the index and wait for the typing to settle.
const rerunSettled = debounce(rerun, 110);
input.addEventListener("input", () => { if (chipMode(mode)) rerun(); else rerunSettled(); });

// The replacement field re-previews the "after" text as you type it.
replaceInput.addEventListener("input", () => rerunSettled());
replaceAllBtn.addEventListener("click", () => void applyReplace());

// The index moved on while this window was behind the editor (a save, a rename): re-run on the way
// back rather than showing hits for a script that has since changed (parity row 35).
window.addEventListener("focus", () => { if (hasProject) { if (chipMode(mode) && activeChip) void loadChip(activeChip); else rerun(); } });

document.addEventListener("keydown", (e) => {
  // Escape is the shell head's, from the box as well as outside it.
  if (mode === "replace" || mode === "suggestions") { /* no list navigation: the rows have their own buttons */ }
  else if (e.key === "ArrowDown") { e.preventDefault(); setSel(sel + 1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); setSel(sel - 1); }
  else if (e.key === "Enter") { e.preventDefault(); const e2 = results[sel]; if (e2) choose(e2); }
});

modeContentBtn.addEventListener("click", () => void setMode("content"));
modeReplaceBtn.addEventListener("click", () => void setMode("replace"));
modeStatusBtn.addEventListener("click", () => void setMode("status"));
modeRecordingBtn.addEventListener("click", () => void setMode("recording"));
modePropertyBtn.addEventListener("click", () => void setMode("property"));
modeTagBtn.addEventListener("click", () => void setMode("tag"));
modeSuggestionsBtn.addEventListener("click", () => void setMode("suggestions"));


// The Recording tab is voiced-only (#206): hide it for a text-only project, and never leave the window
// sitting in recording mode there.
const reflectVoiced = (): void => { modeRecordingBtn.hidden = !voiced; };

// The editor re-opened the window in a mode (the window persists): switch to it + refocus.
search.onMode((m) => { void setMode(m === "recording" && !voiced ? "status" : m); });
// The editor seeded a query (coverage's "gated on @x" → property usage): fill it + run.
search.onSeed((query) => { input.value = query; if (mode === "property") void runProperty(); });
// A different project opened under the window: re-read voiced (it may have changed), then refresh.
// Reset View re-pins every helper window in main. The button chose its own state and would go on
// showing it, so main tells it: this is the case `pinButton`'s `set` handle exists for.
search.onPin((on) => pin.set(on));
search.onTheme((t) => applyTheme(t));

search.onProject(() => void (async () => {
  const info = await search.info();
  voiced = info.voiced; hasProject = info.hasProject; reflectVoiced();
  if (mode === "recording" && !voiced) { void setMode("status"); return; }
  // `rerun` knows every mode, Replace included: falling through to the content search left Replace's
  // previous-project hits behind its "Replace all (n)" button.
  if (chipMode(mode)) void setMode(mode); else rerun();
})());

// Boot: read the initial mode + pin state (+ any seeded query), then render.
void (async () => {
  const info = await search.info();
  pin.set(info.pinned); // main decided this one, so no toggle callback
  applyTheme(info.theme);  // the palette is the app's; importing theme.css alone leaves this on Paper
  voiced = info.voiced; hasProject = info.hasProject; reflectVoiced();
  if (!info.hasProject) {
    hintEl.textContent = "Open a project to search.";
    return;
  }
  if (info.query) input.value = info.query; // seeded deep-link (property usage)
  await setMode(info.mode === "recording" && !voiced ? "status" : info.mode);
})();
