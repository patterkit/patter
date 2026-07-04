// The detached SEARCH tool window (#205): a small, frameless, always-on-top helper over the project-wide
// index. It STAYS OPEN while you step through hits - choosing a result jumps the editor (which stays live
// underneath) but keeps this window up and focused, so you can navigate across matches and explore.
// Two modes, switchable in-window:
//   - "content": find by Game ID / title / dialogue-text, OR paste an opaque id (the folded-in "Go to ID").
//   - "status":  pick a writing-status rung and browse every line at it (unset = lowest); the box filters.
import "@patterkit/patterpad-surface/theme.css"; // app design tokens (same look as the editor + play window)
import "./search.css";
import "@fontsource/newsreader/400.css";
import "@fontsource-variable/inter";

import type { SearchEntry, SearchMode, ReplaceHitDto } from "../../shared/api.js";

const search = window.patterSearch!;

const headEl = document.getElementById("swin-head")!;
const modeContentBtn = document.getElementById("mode-content") as HTMLButtonElement;
const modeReplaceBtn = document.getElementById("mode-replace") as HTMLButtonElement;
const modeStatusBtn = document.getElementById("mode-status") as HTMLButtonElement;
const modeRecordingBtn = document.getElementById("mode-recording") as HTMLButtonElement;
const modePropertyBtn = document.getElementById("mode-property") as HTMLButtonElement;
const modeTagBtn = document.getElementById("mode-tag") as HTMLButtonElement;
const replaceRow = document.getElementById("swin-replace-row")!;
const replaceInput = document.getElementById("swin-replace") as HTMLInputElement;
const replaceAllBtn = document.getElementById("swin-replace-all") as HTMLButtonElement;

/** Writing-status ("status") and recording-status ("recording") browse share the same chip + filter UI;
 *  the dimension is resolved server-side from the window's mode (#206). */
const statusLike = (m: SearchMode): boolean => m === "status" || m === "recording";
/** Modes that browse via CHIPS + a filter box (writing / recording status, or author tags) rather than a
 *  free-text query. They share the chip rail, the "filter these" input, and the pick-a-chip flow. */
const chipMode = (m: SearchMode): boolean => statusLike(m) || m === "tag";
const pinBtn = document.getElementById("swin-pin") as HTMLButtonElement;
const closeBtn = document.getElementById("swin-close") as HTMLButtonElement;
const input = document.getElementById("swin-input") as HTMLInputElement;
const chipsEl = document.getElementById("swin-chips")!;
const resultsEl = document.getElementById("swin-results")!;
const hintEl = document.getElementById("swin-hint")!;

const KIND_LABEL: Record<SearchEntry["kind"], string> = {
  scene: "scene", block: "block", group: "group", snippet: "bubble", beat: "beat",
};

let mode: SearchMode = "content";
let voiced = false; // recording status (and its tab) is voiced-only (#206)
// The chip rail's items: writing / recording rungs (with a palette colour) OR author tags (with a node
// count). `activeChip` is the picked one; `chipHits` its full result list (the input box then filters it).
let chips: Array<{ name: string; colour?: number; count?: number }> = [];
let activeChip = "";
let chipHits: SearchEntry[] = [];
let results: SearchEntry[] = [];
let replaceHits: ReplaceHitDto[] = []; // the previewed replacements (Replace mode)
let sel = 0;
let token = 0; // guards against an out-of-order async response overwriting a newer query
let pinned = true;
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
  name.textContent = e.name ?? e.gameId ?? e.text ?? (e.location.length ? e.location.join(" › ") : e.id);
  r.append(kind, name);
  if (e.location.length) { const loc = document.createElement("span"); loc.className = "swin-loc"; loc.textContent = e.location.join(" › "); r.append(loc); }
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

// Jump to the hit but KEEP this window up + focused, so ↑↓ / ↵ keep driving the list while the editor
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
    const arrow = document.createElement("span"); arrow.className = "swin-arrow"; arrow.textContent = " → ";
    const after = document.createElement("span"); after.className = "swin-after"; after.textContent = h.after;
    diff.append(before, arrow, after);
    const loc = document.createElement("span"); loc.className = "swin-loc"; loc.textContent = h.location.join(" › ");
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
    if (!confirm(`Replace ${n} occurrence${n === 1 ? "" : "s"} across ${scenes} scene${scenes === 1 ? "" : "s"}?\n\n“${input.value}” → “${replaceInput.value}”`)) return;
  }
  const res = await search.replaceApply({ ...replaceOpts(), onlyId });
  if (!res.ok) { hintEl.textContent = `Replace failed: ${res.error ?? "unknown error"}`; return; }
  await runReplacePreview(); // refresh: the applied hits are gone
};

const applyChipFilter = (): void => {
  const q = input.value.trim().toLowerCase();
  results = q ? chipHits.filter((e) => (e.text ?? e.name ?? e.location.join(" ")).toLowerCase().includes(q)) : chipHits;
  sel = 0; renderResults();
};

// --- mode switching ----------------------------------------------------------
async function setMode(next: SearchMode): Promise<void> {
  mode = next;
  for (const [btn, m] of [[modeContentBtn, "content"], [modeReplaceBtn, "replace"], [modeStatusBtn, "status"], [modeRecordingBtn, "recording"], [modePropertyBtn, "property"], [modeTagBtn, "tag"]] as const) {
    btn.classList.toggle("active", mode === m);
    btn.setAttribute("aria-selected", String(mode === m));
  }
  chipsEl.hidden = !chipMode(mode);
  replaceRow.hidden = mode !== "replace"; // the replacement field + Replace-all button
  input.placeholder = mode === "tag" ? "Filter tagged nodes…"
    : statusLike(mode) ? "Filter these lines…"
    : mode === "property" ? "Property usage… (@gold, world.threat, faction rebels)"
    : mode === "replace" ? "Find text to replace…"
    : "Search… (text, title, Game ID, or paste an id)";
  hintEl.textContent = mode === "status" ? "Pick a writing status · type to filter · ↑↓ move · ↵ jump"
    : mode === "recording" ? "Pick a recording status · type to filter · ↑↓ move · ↵ jump"
    : mode === "tag" ? "Pick a tag · type to filter · ↑↓ move · ↵ jump"
    : mode === "property" ? "Find where a property is used · ↑↓ move · ↵ jump"
    : mode === "replace" ? "Replaces dialogue / narration / choice text across every scene · review, then Replace all"
    : "↑↓ move · ↵ jump · drag the bar to move · esc to close";
  results = []; replaceHits = []; sel = 0; renderResults();
  if (chipMode(mode)) {
    input.value = ""; // a chip mode's box is a post-filter; start empty so the full list for the picked chip shows
    chips = mode === "tag" ? await search.tags() : await search.statuses(mode === "recording");
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
let debounce: ReturnType<typeof setTimeout> | undefined;
input.addEventListener("input", () => {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    if (chipMode(mode)) applyChipFilter();
    else if (mode === "property") void runProperty();
    else if (mode === "replace") void runReplacePreview();
    else void runContent();
  }, chipMode(mode) ? 0 : 110);
});

// The replacement field re-previews the "after" text as you type it.
replaceInput.addEventListener("input", () => { clearTimeout(debounce); debounce = setTimeout(() => void runReplacePreview(), 110); });
replaceAllBtn.addEventListener("click", () => void applyReplace());

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { e.preventDefault(); search.close(); }
  else if (mode === "replace") { /* no list navigation in Replace mode (rows have their own buttons) */ }
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
closeBtn.addEventListener("click", () => search.close());

const reflectPin = (): void => { pinBtn.classList.toggle("on", pinned); pinBtn.setAttribute("aria-pressed", String(pinned)); };
pinBtn.addEventListener("click", () => { pinned = !pinned; search.setPin(pinned); reflectPin(); });

// The Recording tab is voiced-only (#206): hide it for a text-only project, and never leave the window
// sitting in recording mode there.
const reflectVoiced = (): void => { modeRecordingBtn.hidden = !voiced; };

// The editor re-opened the window in a mode (the window persists): switch to it + refocus.
search.onMode((m) => { void setMode(m === "recording" && !voiced ? "status" : m); });
// The editor seeded a query (coverage's "gated on @x" → property usage): fill it + run.
search.onSeed((query) => { input.value = query; if (mode === "property") void runProperty(); });
// A different project opened under the window: re-read voiced (it may have changed), then refresh.
search.onProject(() => void (async () => {
  voiced = (await search.info()).voiced; reflectVoiced();
  if (mode === "recording" && !voiced) { void setMode("status"); return; }
  if (chipMode(mode)) void setMode(mode); else if (mode === "property") void runProperty(); else void runContent();
})());

// Boot: read the initial mode + pin state (+ any seeded query), then render.
void (async () => {
  const info = await search.info();
  pinned = info.pinned; reflectPin();
  voiced = info.voiced; reflectVoiced();
  if (!info.hasProject) {
    hintEl.textContent = "Open a project to search.";
    return;
  }
  if (info.query) input.value = info.query; // seeded deep-link (property usage)
  await setMode(info.mode === "recording" && !voiced ? "status" : info.mode);
})();

// Keep `headEl` referenced (it carries the -webkit-app-region drag in CSS; no JS handler needed).
void headEl;
