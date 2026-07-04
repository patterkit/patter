// The detail inspector (Patterpad.md §4): renders the caret's container stack - leaf -> snippet ->
// group(s) -> block, most-specific at the TOP - into the right pane. A READ projection of the
// surface's `onSelect` context; a header click jumps to that node (revealNode). The snippet / group
// CONDITION rows are editable - clicking opens the visual expression editor (M1, editCondition).

import type {
  InspectorContext, InspectLevel, LeafLevel, SnippetLevel, GroupLevel, BlockLevel, SceneLevel, MultiLevel, GroupPropsPatch,
} from "@patterkit/patterpad-surface/surface";
import type { GameData, GameDataField, GameDataNodeKind, PropertyDecl, DocLine, WritingStatusDecl, RecordingStatusDecl } from "@patterkit/model";
import { colourIndex } from "@patterkit/patterpad-surface/colour";
import { el } from "./dom.js";

type Reveal = (id: string) => void;
/** Open the visual condition editor for the node `id`, seeded with `src`, anchored to `anchor`. */
export type EditCondition = (id: string, src: string, anchor: HTMLElement) => void;
/** Open the gameId (address) editor for the node `id`; `gameId` is the pinned value ("" = auto),
 *  `address` the effective display value, anchored to `anchor`. */
export type EditGameId = (id: string, gameId: string, address: string, anchor: HTMLElement) => void;
/** Patch a group's behaviour (selector / sequence order×exhaust / option secrecy) by id. */
export type EditGroupProps = (id: string, patch: GroupPropsPatch) => void;
/** Open the jump-target picker for a snippet `id` (current target or ""), anchored to `anchor`. */
export type EditJump = (id: string, current: string, anchor: HTMLElement) => void;
/** Open the effects editor for a snippet `id`, seeded with its onEnter / onExit lists, anchored.
 *  `phase` scopes the editor to a single list (the inspector surfaces On enter / On exit separately). */
export type EditEffects = (id: string, onEnter: EffectLike[], onExit: EffectLike[], anchor: HTMLElement, phase?: "onEnter" | "onExit") => void;

/** A snippet effect as carried by the inspector context. SET-ONLY (spec §15): an effect is a
 *  property mutation; host event emission rides on gameData, not effects. */
export interface EffectLike { kind: "set"; target?: string; value?: string; }

// Condition / effect rows show PILLS by default (the visual format non-coders read). One global
// toggle (under the inspector name, owned by the renderer) flips ALL rows to name-form text; the
// inspector reads that preference via `h.textMode()` and the renderer also flips any open editor.

/** A label : value row. Returns null for an empty value so callers can skip blanks cheaply. */
function row(label: string, value: string | null | undefined): HTMLElement | null {
  if (value == null || value === "") return null;
  const r = el("div", "insp-row");
  r.append(el("span", "insp-key", label), el("span", "insp-val", value));
  return r;
}

/** gameData -> one row per key (compact JSON value). Read-only - used for a group's opaque gameData
 *  and for any key on a node with no matching field definition (an orphan, e.g. a deleted field). */
function gameDataRows(gd: Record<string, unknown> | undefined): HTMLElement[] {
  if (!gd) return [];
  return Object.entries(gd).map(([k, v]) => {
    const r = el("div", "insp-row");
    r.append(el("span", "insp-key insp-gd", k), el("span", "insp-val insp-mono", typeof v === "string" ? v : JSON.stringify(v)));
    return r;
  });
}

/** The author-defined gameData fields for a node type, as EDITABLE rows (value or, when unset, the
 *  field default), plus any orphaned keys read-only. The `purpose` is the row's hover hint. */
function gameDataFieldRows(kind: GameDataNodeKind, id: string | null, gd: GameData | undefined, h: InspectorHandlers): HTMLElement[] {
  const fields = h.gameDataFields(kind);
  const rows: HTMLElement[] = [];
  const defined = new Set<string>();
  for (const f of fields) { defined.add(f.name); rows.push(gameDataFieldRow(f, id, gd?.[f.name], h)); }
  for (const [k, v] of Object.entries(gd ?? {})) {
    if (!defined.has(k)) { const r = el("div", "insp-row"); r.append(el("span", "insp-key insp-gd", k), el("span", "insp-val insp-mono", typeof v === "string" ? v : JSON.stringify(v))); rows.push(r); }
  }
  return rows;
}

/** The gameData fields as one grouped section sitting BELOW a subtle divider (so a node's own data is
 *  visually separated from the host's custom fields). Returns null when there are no fields to show. */
function gameDataSection(kind: GameDataNodeKind, id: string | null, gd: GameData | undefined, h: InspectorHandlers): HTMLElement | null {
  const rows = gameDataFieldRows(kind, id, gd, h);
  if (!rows.length) return null;
  const sec = el("div", "insp-gd-section");
  sec.append(el("div", "insp-gd-cap", "Game Data"), ...rows);
  return sec;
}

/** One editable gameData field row. `current` is the node's override (undefined = falls back to the
 *  field default). Committing an empty / "default" value clears the override (sparse storage). */
function gameDataFieldRow(f: GameDataField, id: string | null, current: unknown, h: InspectorHandlers): HTMLElement {
  const r = el("div", "insp-row insp-gd-row");
  const key = el("span", "insp-key", f.name);
  if (f.purpose) key.dataset.tip = f.purpose; // rollover hint
  r.append(key);
  const set = (v: unknown): void => { if (id) h.setGameData(id, f.name, v); };
  const defHint = f.default != null ? String(f.default) : "";

  if (f.type === "boolean" || f.type === "enum") {
    const sel = el("select", "insp-select") as HTMLSelectElement;
    const opts: Array<[string, string]> = f.type === "boolean"
      ? [["", defHint ? `default (${defHint})` : "(unset)"], ["true", "True"], ["false", "False"]]
      : [["", defHint ? `default (${defHint})` : "(unset)"], ...(f.values ?? []).map((v): [string, string] => [v, v])];
    for (const [v, l] of opts) { const o = el("option", undefined, l) as HTMLOptionElement; o.value = v; sel.append(o); }
    sel.value = current == null ? "" : String(current);
    sel.addEventListener("change", () => {
      if (sel.value === "") set(undefined);
      else set(f.type === "boolean" ? sel.value === "true" : sel.value);
    });
    if (!id) sel.disabled = true;
    r.append(sel);
  } else {
    const input = el("input", "insp-gd-input") as HTMLInputElement;
    input.type = f.type === "number" ? "number" : "text";
    input.placeholder = `<${defHint ? `default: ${defHint}` : f.type}>`;
    input.value = current == null ? "" : String(current);
    if (!id) input.disabled = true;
    // Commit on change (blur / Enter), not per keystroke - so the inspector re-render doesn't steal focus.
    input.addEventListener("change", () => {
      const raw = input.value.trim();
      if (raw === "") set(undefined);
      else set(f.type === "number" ? Number(raw) : raw);
    });
    r.append(input);
  }
  return r;
}

/** The gameData node-kind for a leaf beat (the inspector calls a text beat "prose"; the model "text"). */
const leafNodeKind = (beat: LeafLevel["beat"]): GameDataNodeKind => (beat === "prose" ? "text" : beat);

const LEAF_HEAD: Record<LeafLevel["beat"], string> = { line: "Line", prose: "Text", gameEvent: "Game Event" };

function leafBody(lv: LeafLevel, h: InspectorHandlers): HTMLElement[] {
  const rows: Array<HTMLElement | null> = [];
  if (lv.beat !== "gameEvent") rows.push(statusRow(lv.id, h)); // writing status, line + text only (#196); game events aren't tracked
  if (lv.beat === "line") rows.push(recordingStatusRow(lv.id, h)); // recording status, dialogue lines only (#206)
  if (lv.beat === "line") {
    rows.push(row("Character", lv.character ?? "—"));
    rows.push(row("Direction", lv.direction));
  }
  rows.push(tagsRow(lv.id, lv.tags, h));
  rows.push(gameDataSection(leafNodeKind(lv.beat), lv.id, lv.gameData, h));
  return rows.filter((r): r is HTMLElement => r != null);
}

/** A soft, READABLE fill for a status chip: the rung's palette colour mixed heavily toward the theme
 *  background, so the chip carries the colour's identity while `--ink` text stays legible on ANY palette
 *  (light, dark, or a reading palette) - a saturated `--char-N` fill left the text unreadable. No colour ->
 *  a neutral muted tint. Shared by the manual status selects + the folder-derived recording chip so they match. */
export function statusTint(slot: number | undefined): string {
  const base = slot != null ? `var(--char-${slot})` : "var(--muted)";
  return `color-mix(in oklab, ${base} 26%, var(--bg))`;
}

/** Tint a status <select> to its selected rung's (readable) colour, so the control itself reads as a coloured
 *  chip (matching the folder-derived recording chip) instead of carrying a separate swatch dot. */
function paintStatusSelect(sel: HTMLSelectElement, slot: number | undefined): void {
  sel.style.background = statusTint(slot);
}

/** Build a status dropdown that renders as a tinted chip: options tinted per rung, the closed control tinted
 *  to the current pick. Picking the lowest rung clears the explicit status (unset == lowest). Shared by the
 *  Writing (#196) and manual Audio (#206) rows so the two read identically. */
function statusSelect(ladder: { name: string; colour?: number }[], effective: string, lowest: string, onPick: (status: string | null) => void): HTMLSelectElement {
  const slotOf = (name: string): number | undefined => ladder.find((s) => s.name === name)?.colour;
  const sel = el("select", "insp-status-select") as HTMLSelectElement;
  for (const s of ladder) {
    const o = el("option", undefined, s.name) as HTMLOptionElement;
    o.value = s.name; if (s.name === effective) o.selected = true;
    if (s.colour != null) o.style.background = statusTint(s.colour); // tint where the platform honours it
    sel.append(o);
  }
  paintStatusSelect(sel, slotOf(effective));
  sel.addEventListener("change", () => { const v = sel.value; paintStatusSelect(sel, slotOf(v)); onPick(v === lowest ? null : v); });
  return sel;
}

/** The writing-status dropdown at the top of a line / text beat's inspector bar (#196): a select of the
 *  ladder, tinted to the selected rung's colour (a chip). An unset beat reads as the LOWEST rung (there is
 *  no "unset" - unset == the lowest status), and picking the lowest rung clears the explicit status to keep
 *  the sidecar tidy. Null when there's no ladder (no statuses configured -> no field) or no beat id. */
function statusRow(id: string | null, h: InspectorHandlers): HTMLElement | null {
  const ladder = h.writingStatuses();
  if (!ladder.length || !id) return null;
  const lowest = ladder[0]!.name;
  const effective = h.lineStatus(id) ?? lowest; // unset beats show the lowest rung, never "unset"

  const r = el("div", "insp-row");
  r.append(el("span", "insp-key", "Writing"));
  const wrap = el("div", "insp-status");
  wrap.append(statusSelect(ladder, effective, lowest, (status) => h.setLineStatus(id, status)));
  r.append(wrap);
  return r;
}

/** The recording-status dropdown for a dialogue (line) beat (#206, manual mode): mirrors the writing-status
 *  row - a colour swatch + a select of the recording ladder. Unset reads as the lowest rung; picking the
 *  lowest clears the explicit status. Null when there's no ladder or no beat id. */
function recordingStatusRow(id: string | null, h: InspectorHandlers): HTMLElement | null {
  const ladder = h.recordingStatuses();
  if (!ladder.length || !id) return null;
  const lowest = ladder[0]!.name;
  const slotOf = (name: string): number | undefined => ladder.find((s) => s.name === name)?.colour;

  // Audio Folders mode: the status is derived from files on disk, so it's READ-ONLY here - a coloured chip
  // showing the resolved rung (missing when no file was found), not the manual dropdown.
  if (h.audioFoldersOn()) {
    const derived = h.recordingFolderStatus(id); // null = no file found = missing
    const status = derived ?? lowest;
    const r = el("div", "insp-row");
    r.append(el("span", "insp-key", "Audio"));
    const wrap = el("div", "insp-status");
    const chip = el("span", "insp-rec-chip", status);
    chip.style.background = statusTint(slotOf(status));
    chip.dataset.tip = "derived from audio folders";
    wrap.append(chip);
    // Stale scratch take (#224): the WAV's stamped text-hash no longer matches the line (it was edited).
    if (derived && h.scratchStale(id)) {
      const warn = el("span", "insp-rec-stale", "⚠ out of date");
      warn.dataset.tip = "this scratch take was recorded against an earlier version of the line";
      wrap.append(warn);
    }
    // A play button only when a file actually resolved (not for an implicitly-missing line).
    if (derived) {
      const play = el("button", "insp-rec-play") as HTMLButtonElement;
      play.type = "button"; play.textContent = "▶"; play.dataset.tip = "play audio";
      play.setAttribute("aria-label", "play audio");
      play.addEventListener("click", () => h.playRecording(id, play));
      wrap.append(play);
    }
    // Record scratch (#224): offered when the line is AT OR BELOW the scratch rung - i.e. not yet given a
    // more-finished take. (Once it's recorded/final, scratch would only downgrade it, so we don't offer it.)
    const scratch = h.scratchStatus();
    if (scratch) {
      const order = ladder.map((s) => s.name);
      const curIdx = order.indexOf(derived ?? lowest);
      const scrIdx = order.indexOf(scratch);
      if (curIdx >= 0 && scrIdx >= 0 && curIdx <= scrIdx) {
        const rec = el("button", "insp-rec-record") as HTMLButtonElement;
        rec.type = "button"; rec.textContent = "● Record"; rec.dataset.tip = "record a scratch take";
        rec.addEventListener("click", () => h.recordScratch(id));
        wrap.append(rec);
      }
    }
    r.append(wrap);
    return r;
  }

  const effective = h.recordingStatus(id) ?? lowest;
  const r = el("div", "insp-row");
  r.append(el("span", "insp-key", "Audio"));
  const wrap = el("div", "insp-status");
  wrap.append(statusSelect(ladder, effective, lowest, (status) => h.setRecordingStatus(id, status)));
  r.append(wrap);
  return r;
}

/** The author-tags chip editor (#215): hash-coloured chips (reusing the `--char-N` cue palette) plus an
 *  input where a comma or Return commits the typed tag and Backspace on an empty input removes the last.
 *  Tags are freeform minus whitespace/commas (the entry delimiters), deduped. Self-contained: it owns its
 *  working list and repaints in place (a tag edit doesn't change the inspector's selection signature, so
 *  the panel won't rebuild under it - keeping the input focused across adds). Null when there's no id. */
function tagsRow(id: string | null, tags: string[] | undefined, h: InspectorHandlers): HTMLElement | null {
  if (!id) return null;
  const current = [...(tags ?? [])];
  const r = el("div", "insp-row insp-row-tags");
  r.append(el("span", "insp-key", "Tags"));
  const box = el("div", "insp-tags");

  const input = el("input", "insp-tag-input") as HTMLInputElement;
  input.type = "text"; input.placeholder = current.length ? "" : "add tag…";
  input.setAttribute("aria-label", "add a tag");
  input.spellcheck = false; input.autocapitalize = "off"; (input as HTMLInputElement).autocomplete = "off";

  const commit = (): void => { h.setTags(id, current); };
  const repaint = (): void => {
    box.querySelectorAll(".insp-tag").forEach((n) => n.remove());
    for (const [i, t] of current.entries()) {
      const chip = el("span", "insp-tag");
      chip.style.setProperty("--tag-c", `var(--char-${colourIndex(t)})`);
      chip.append(el("span", "insp-tag-text", t));
      const x = el("button", "insp-tag-x", "×");
      x.type = "button"; x.dataset.tip = "remove tag"; x.setAttribute("aria-label", `remove tag ${t}`);
      x.addEventListener("click", () => { current.splice(i, 1); repaint(); commit(); input.focus(); });
      chip.append(x);
      box.insertBefore(chip, input);
    }
    input.placeholder = current.length ? "" : "add tag…";
  };

  const add = (rawText: string): void => {
    // A paste / typed run may contain several tags; split on the delimiters and drop blanks + dups.
    let changed = false;
    for (const piece of rawText.split(/[\s,]+/)) {
      const t = piece.trim();
      if (t && !current.includes(t)) { current.push(t); changed = true; }
    }
    if (changed) { repaint(); commit(); }
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(input.value); input.value = ""; }
    else if (e.key === "Backspace" && input.value === "" && current.length) {
      e.preventDefault(); current.pop(); repaint(); commit();
    }
  });
  // A comma typed/pasted mid-string also delimits; and commit whatever's left on blur.
  input.addEventListener("input", () => { if (input.value.includes(",")) { add(input.value); input.value = ""; } });
  input.addEventListener("blur", () => { if (input.value.trim()) { add(input.value); input.value = ""; } });

  box.append(input);
  repaint();
  r.append(box);
  return r;
}

function effectText(e: EffectLike): string {
  return `${e.target} = ${e.value}`;
}

/** One effect-phase row (On enter / On exit), shown directly under Condition in the snippet body. A
 *  summary of that phase's effects (or "+ add"); clicking opens the effects editor scoped to the phase.
 *  Both lists are passed so the editor can still show context, but `phase` focuses it on this one. */
function phaseRow(id: string | null, label: string, phase: "onEnter" | "onExit", onEnter: EffectLike[], onExit: EffectLike[], h: InspectorHandlers): HTMLElement {
  const mine = phase === "onEnter" ? onEnter : onExit;
  // Stacked (value UNDER the label) so the effect pills get the row's full width.
  const r = el("div", "insp-row insp-row-stack");
  r.append(el("span", "insp-key", label));
  const btn = el("button", `insp-cond${mine.length ? "" : " muted"}`);
  btn.type = "button";
  if (!mine.length) btn.textContent = "+ add";
  else if (h.textMode()) { const p = mine.slice(0, 2).map(effectText).join(" · "); btn.textContent = mine.length > 2 ? `${p} · +${mine.length - 2}` : p; }
  else btn.append(h.effectsPreview(mine)); // pills (inert → click opens editor)
  if (id) { btn.dataset.tip = `edit ${label.toLowerCase()} effects`; btn.setAttribute("aria-label", `edit ${label.toLowerCase()} effects`); btn.addEventListener("click", () => h.editEffects(id, onEnter, onExit, btn, phase)); }
  else btn.disabled = true;
  r.append(btn);
  return r;
}

/** An editable Condition row: clicking opens the visual expression editor (or "+ add condition"). The
 *  current condition shows as PILLS by default (a `</>` toggle switches to name-form text). */
function condRow(id: string | null, src: string | undefined, h: InspectorHandlers): HTMLElement {
  // Stacked (value UNDER the label) so the pills get the row's full width to breathe.
  const r = el("div", "insp-row insp-row-stack");
  r.append(el("span", "insp-key", "Condition"));
  const btn = el("button", `insp-cond${src ? "" : " muted"}`);
  btn.type = "button";
  if (!src) btn.textContent = "+ add condition";
  else if (h.textMode()) btn.textContent = `if ${src}`;
  else { btn.append(el("span", "insp-if", "if "), h.condPreview(src)); } // pills (inert → click opens editor)
  if (id) { btn.dataset.tip = "edit condition"; btn.setAttribute("aria-label", "edit condition"); btn.addEventListener("click", () => h.editCondition(id, src ?? "", btn)); }
  else btn.disabled = true;
  r.append(btn);
  return r;
}

/** A label : <select> row. Commits on change (the native dropdown closes before the re-render). */
function selectRow(label: string, value: string, opts: Array<[string, string]>, onChange: (v: string) => void): HTMLElement {
  const r = el("div", "insp-row");
  r.append(el("span", "insp-key", label));
  const sel = el("select", "insp-select") as HTMLSelectElement;
  for (const [v, l] of opts) { const o = el("option", undefined, l) as HTMLOptionElement; o.value = v; if (v === value) o.selected = true; sel.append(o); }
  sel.addEventListener("change", () => onChange(sel.value));
  r.append(sel);
  return r;
}

/** A label : checkbox row. */
function toggleRow(label: string, on: boolean, onChange: (on: boolean) => void): HTMLElement {
  const r = el("div", "insp-row");
  r.append(el("span", "insp-key", label));
  const cb = el("input", "insp-check") as HTMLInputElement;
  cb.type = "checkbox"; cb.checked = on;
  cb.addEventListener("change", () => onChange(cb.checked));
  r.append(cb);
  return r;
}

/** An editable Jump row: a chip showing the target's READABLE label (or "+ set jump"); click
 *  opens the picker. Storage is the internal id; `h.jumpLabel` resolves it to a name / gameId. */
function jumpRow(id: string | null, jump: SnippetLevel["jump"], h: InspectorHandlers): HTMLElement {
  const r = el("div", "insp-row");
  r.append(el("span", "insp-key", "Jump"));
  const btn = el("button", `insp-cond${jump ? "" : " muted"}`);
  btn.type = "button";
  btn.textContent = jump ? `${jump.mode === "call" ? "⤳" : "↪"} ${h.jumpLabel(jump.to)}` : "+ set jump";
  if (id) { btn.dataset.tip = "set jump target"; btn.setAttribute("aria-label", "set jump target"); btn.addEventListener("click", () => h.editJump(id, jump?.to ?? "", btn)); }
  else btn.disabled = true;
  const val = el("div", "insp-jumpval");
  val.append(btn);
  // Mode toggle: only meaningful once a jump is set. "go" leaves for good; "call" returns here when the
  // target finishes (jump-and-return). Storage default is one-way, so a missing mode reads as "go".
  if (id && jump) {
    const mode: "jump" | "call" = jump.mode === "call" ? "call" : "jump";
    const seg = el("span", "insp-seg");
    const opt = (m: "jump" | "call", label: string, tip: string): HTMLElement => {
      const b = el("button", `insp-seg-opt${mode === m ? " on" : ""}`, label);
      b.type = "button";
      b.dataset.tip = tip; b.setAttribute("aria-label", tip); b.setAttribute("aria-pressed", String(mode === m));
      if (mode !== m) b.addEventListener("click", () => h.setJumpMode(id, m));
      return b;
    };
    seg.append(opt("jump", "↪ jump", "one-way jump"), opt("call", "⤳ call", "jump and return here"));
    val.append(seg);
  }
  r.append(val);
  return r;
}

function snippetBody(lv: SnippetLevel, h: InspectorHandlers): HTMLElement[] {
  const rows: Array<HTMLElement | null> = [];
  const onEnter = lv.onEnter ?? [];
  const onExit = lv.onExit ?? [];
  rows.push(condRow(lv.id, lv.condition, h));
  // Jump sits right under Condition - they are the two routing/eligibility rows an author scans first.
  rows.push(jumpRow(lv.id, lv.jump, h));
  // On enter / On exit follow as first-class rows (not behind one "Effects" entry).
  rows.push(phaseRow(lv.id, "On begin", "onEnter", onEnter, onExit, h));
  rows.push(phaseRow(lv.id, "On end", "onExit", onEnter, onExit, h));
  if (lv.beatCount === 0) rows.push(row("Beats", "none (a jump-only snippet)"));
  rows.push(tagsRow(lv.id, lv.tags, h));
  rows.push(gameDataSection("snippet", lv.id, lv.gameData, h));
  return rows.filter((r): r is HTMLElement => r != null);
}

const GROUP_HEAD: Record<GroupLevel["role"], string> = {
  option: "Option", choice: "Choice", branch: "Branch", sequence: "Sequence", conditional: "Conditional", group: "Group",
};

// The "copy" glyph: a clean front sheet with only the back sheet's top-right corner peeking out behind it
// (stroke-only, so no lines cross the front sheet's interior - theme-proof). A tick replaces it on copy.
const COPY_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><rect x="3" y="9" width="12" height="12" rx="2"/><path d="M9 9V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-4"/></svg>';
const COPY_CHECK = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 13l4 4 10-11"/></svg>';

/** A quiet "click to copy" button. `text` is the value copied (a string, or a getter read at click
 *  time); briefly flips to a tick. Stops propagation so it never triggers an enclosing header click. */
export function copyButton(text: string | (() => string), title: string): HTMLButtonElement {
  const b = el("button", "insp-copy") as HTMLButtonElement; b.type = "button"; b.dataset.tip = title; b.setAttribute("aria-label", title); b.innerHTML = COPY_SVG;
  b.addEventListener("click", (e) => {
    e.stopPropagation(); e.preventDefault();
    const value = typeof text === "function" ? text() : text;
    void navigator.clipboard?.writeText(value).then(() => {
      b.innerHTML = COPY_CHECK; b.classList.add("copied");
      window.setTimeout(() => { b.innerHTML = COPY_SVG; b.classList.remove("copied"); }, 900);
    });
  });
  return b;
}

/** A title-bar copy icon whose ROLLOVER is the address / ID itself (so hovering reveals it); click copies. */
function addrCopyButton(value: string, what: string): HTMLButtonElement {
  const b = copyButton(value, value);          // the tooltip shows the value on rollover; click copies it
  b.setAttribute("aria-label", `Copy ${what}`);
  return b;
}

// The note-page glyph for the inspector title bar: OUTLINE when the node has no notes, FILLED when it does
// (the filled form mirrors the surface's gutter note glyph). currentColor, no colour emoji.
const NOTE_FILLED = '<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" fill-rule="evenodd" aria-hidden="true"><path d="M3.4 1.4h5.3L12.6 5.3v8.1a1.2 1.2 0 0 1-1.2 1.2H3.4a1.2 1.2 0 0 1-1.2-1.2V2.6A1.2 1.2 0 0 1 3.4 1.4ZM4.9 6.8h6.2v1.1H4.9Zm0 2.1h6.2v1.1H4.9Zm0 2.1h3.7v1.1H4.9Z"/></svg>';
const NOTE_OUTLINE = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M3.4 2h4.9l3.9 3.9v7.5a1 1 0 0 1-1 1H3.4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z"/><path d="M8.3 2.2v3.8h3.8"/><path d="M4.9 8h6.2M4.9 10h6.2M4.9 12h3.7" stroke-width="0.95"/></svg>';

/** The title-bar note icon: outline when no notes, filled when notes are set; opens the notes modal. */
function noteButton(id: string, kind: string | undefined, has: boolean, h: InspectorHandlers): HTMLButtonElement {
  const b = el("button", `insp-note${has ? " has" : ""}`) as HTMLButtonElement; b.type = "button";
  b.dataset.tip = has ? "Edit notes" : "Add a note";
  b.setAttribute("aria-label", has ? "Edit notes" : "Add a note");
  b.innerHTML = has ? NOTE_FILLED : NOTE_OUTLINE;
  b.addEventListener("click", (e) => { e.stopPropagation(); e.preventDefault(); h.editNote(id, b, kind); });
  return b;
}

function groupBody(lv: GroupLevel, h: InspectorHandlers): HTMLElement[] {
  const rows: Array<HTMLElement | null> = [];
  const set = (patch: GroupPropsPatch): void => { if (lv.id) h.editGroupProps(lv.id, patch); };
  rows.push(condRow(lv.id, lv.condition, h));
  if (lv.role === "option") {
    // Option behaviour (spec §5): sticky = repeatable (off = once-only); fallback = auto-followed when
    // it is the last option left; secret = hidden while ineligible.
    rows.push(toggleRow("Sticky", lv.sticky ?? false, (on) => set({ sticky: on })));
    rows.push(toggleRow("Fallback", lv.fallback ?? false, (on) => set({ fallback: on })));
    rows.push(toggleRow("Secret", lv.secretUntilEligible ?? false, (on) => set({ secretUntilEligible: on })));
  } else if (lv.role === "choice") {
    // Nothing more: a choice IS its options, which are already surfaced in the script (and each
    // option's flags / condition are editable by selecting that option). A duplicate list here just
    // added complexity, so the Choice level shows only its Condition + any gameData.
  } else {
    const selector = (lv.selector ?? "run") as "run" | "branch" | "sequence" | "choice";
    rows.push(selectRow("Selector", selector, [["run", "Run (in order)"], ["branch", "Branch (first match)"], ["sequence", "Sequence"]], (v) => set({ selector: v as GroupPropsPatch["selector"] })));
    if (selector === "sequence") {
      rows.push(selectRow("Order", lv.order ?? "sequential", [["sequential", "In order"], ["shuffle", "Shuffle"]], (v) => set({ order: v as GroupPropsPatch["order"] })));
      rows.push(selectRow("Exhaust", lv.exhaust ?? "once", [["once", "Play once"], ["repeat", "Repeat"], ["stick", "Stick on last"]], (v) => set({ exhaust: v as GroupPropsPatch["exhaust"] })));
    }
  }
  rows.push(tagsRow(lv.id, lv.tags, h));
  rows.push(...gameDataRows(lv.gameData));
  return rows.filter((r): r is HTMLElement => r != null);
}

/** The host-facing Game ID row: a clickable chip showing the effective address the runtime targets;
 *  clicking opens the Game ID editor. Muted when it is auto-derived from the name (not pinned). */
function addressRow(id: string | null, gameId: string | undefined, address: string, edit: EditGameId): HTMLElement {
  const r = el("div", "insp-row");
  r.append(el("span", "insp-key", "Game ID"));
  const btn = el("button", `insp-cond${gameId ? "" : " muted"}`);
  btn.type = "button";
  btn.textContent = address || "—";
  if (id) {
    btn.dataset.tip = gameId ? "edit the Game ID" : "auto from name; click to pin a fixed Game ID"; btn.setAttribute("aria-label", gameId ? "edit the Game ID" : "auto from name; click to pin a fixed Game ID");
    btn.addEventListener("click", () => edit(id, gameId ?? "", address, btn));
  } else btn.disabled = true;
  r.append(btn);
  return r;
}

/** The Scene level's "Properties" row: a button into the scene-local @scene property editor, labelled
 *  with the current count. (Scene-only; blocks have no scene-local properties.) */
function scenePropsRow(h: InspectorHandlers): HTMLElement {
  const r = el("div", "insp-row");
  r.append(el("span", "insp-key", "Properties"));
  const n = h.sceneProps().length;
  const btn = el("button", `insp-cond${n ? "" : " muted"}`);
  btn.type = "button"; btn.dataset.tip = "scene-local @scene properties"; btn.setAttribute("aria-label", "scene-local @scene properties");
  btn.textContent = n ? `${n} scene ${n === 1 ? "property" : "properties"}, edit` : "+ add scene properties";
  btn.addEventListener("click", () => h.editSceneProps());
  r.append(btn);
  return r;
}


function addressBody(lv: SceneLevel | BlockLevel, h: InspectorHandlers): HTMLElement[] {
  const rows: Array<HTMLElement | null> = [addressRow(lv.id, lv.gameId, lv.address, h.editGameId)];
  if (lv.kind === "scene") rows.push(scenePropsRow(h));
  rows.push(tagsRow(lv.id, lv.tags, h));
  rows.push(gameDataSection(lv.kind, lv.id, lv.gameData, h));
  return rows.filter((r): r is HTMLElement => r != null);
}

/** The summary shown when several whole chunks are selected (a shift-click run): just the count - it
 *  isn't one node, so there are no per-node fields. (What the run can do lives in the contextual hint
 *  bar at the bottom of the window, not here.) */
function multiLevelView(lv: MultiLevel): HTMLElement {
  const noun = lv.groups === 0 ? "snippets" : lv.snippets === 0 ? "groups" : "items";
  const section = el("section", "insp-level insp-multi");
  const header = el("div", "insp-head");
  header.append(el("span", "insp-head-name", `${lv.count} ${noun} selected`));
  section.append(header);
  return section;
}

function levelView(lv: InspectLevel, h: InspectorHandlers): HTMLElement {
  if (lv.kind === "multi") return multiLevelView(lv);
  let head: string;
  let sub = "";
  let body: HTMLElement[];
  switch (lv.kind) {
    case "leaf": head = LEAF_HEAD[lv.beat]; body = leafBody(lv, h); break;
    case "snippet": head = "Snippet"; body = snippetBody(lv, h); break; // always "Snippet" - a jump is a snippet property, not its identity (the body notes a jump-only bubble)
    case "group": head = GROUP_HEAD[lv.role]; sub = lv.role === "sequence" ? lv.label.replace(/^sequence · /, "") : ""; body = groupBody(lv, h); break;
    case "block": head = "Block"; sub = lv.name; body = addressBody(lv, h); break;
    case "scene": head = "Scene"; sub = lv.name; body = addressBody(lv, h); break;
  }

  const section = el("section", `insp-level insp-${lv.kind}`);
  const headerRow = el("div", "insp-head-row");
  const header = el("button", "insp-head");
  (header as HTMLButtonElement).type = "button";
  header.append(el("span", "insp-head-name", head));
  if (sub) header.append(el("span", "insp-head-sub", sub));
  if (lv.id) {
    header.dataset.tip = `Reveal this ${head.toLowerCase()} in the script`; // no opaque id surfaced (spec §6)
    header.addEventListener("click", () => h.reveal(lv.id!));
  } else {
    (header as HTMLButtonElement).disabled = true;
  }
  headerRow.append(header);
  // Top-right action cluster: an optional COPY icon (the node's address / loc ID - shown on rollover, click
  // to copy) then - wherever notes are allowed (every node with an id) - a NOTE icon (outline = none, filled
  // = notes set) that opens the notes modal for this node.
  const actions = el("div", "insp-head-actions");
  if ((lv.kind === "scene" || lv.kind === "block") && lv.address) actions.append(addrCopyButton(lv.address, "address"));
  else if (lv.kind === "leaf" && lv.id && (lv.beat === "line" || lv.beat === "prose")) actions.append(addrCopyButton(lv.id, "line ID")); // loc / audio id (not game-event)
  if (lv.id) actions.append(noteButton(lv.id, lv.kind === "leaf" ? lv.beat : undefined, h.hasNotes(lv.id), h));
  if (actions.childElementCount) headerRow.append(actions);
  section.append(headerRow);

  if (body.length) {
    const bodyEl = el("div", "insp-body");
    bodyEl.append(...body);
    section.append(bodyEl);
  }
  return section;
}

export interface InspectorHandlers {
  reveal: Reveal;
  /** Open the documentation-notes modal for this node (the title-bar note icon); `kind` narrows the classes. */
  editNote: (id: string, anchor: HTMLElement, kind?: string) => void;
  /** Whether the node currently has any documentation notes (drives the note icon: filled vs outline). */
  hasNotes: (id: string) => boolean;
  editCondition: EditCondition;
  editGameId: EditGameId;
  editGroupProps: EditGroupProps;
  editJump: EditJump;
  /** Set an existing jump's mode: "jump" (one-way) or "call" (jump-and-return), keeping its target. */
  setJumpMode: (id: string, mode: "jump" | "call") => void;
  editEffects: EditEffects;
  /** The global pills/text preference (owned by the renderer's single toggle). true = name-form text. */
  textMode: () => boolean;
  /** Render a condition (name-form `src`) as a read-only PILL strip for the inspector row. */
  condPreview: (src: string) => HTMLElement;
  /** Render an effects list as a read-only PILL strip for the inspector row. */
  effectsPreview: (effects: EffectLike[]) => HTMLElement;
  /** Resolve a jump target id to its readable label (block / scene name or gameId). */
  jumpLabel: (id: string) => string;
  /** Append an option to the choice `choiceId`. */
  addOption: (choiceId: string) => void;
  /** Delete the chunk (option / snippet / group) `id`. */
  removeChunk: (id: string) => void;
  /** Reorder the chunk `id` up / down within its container. */
  moveChunk: (id: string, dir: "up" | "down") => void;
  /** The author-defined gameData fields for a node type (the project's Game Data schema). */
  gameDataFields: (kind: GameDataNodeKind) => GameDataField[];
  /** Set (or clear, with `undefined`) one gameData field value on a node by id. */
  setGameData: (id: string, key: string, value: unknown) => void;
  /** The open scene's local @scene property declarations (for the Scene level's count + editor). */
  sceneProps: () => PropertyDecl[];
  /** Open the scene-local @scene properties editor. */
  editSceneProps: () => void;
  /** The writing-status ladder (#196): each rung's name + theme-palette colour slot, for the status row. */
  writingStatuses: () => WritingStatusDecl[];
  /** The beat's current writing status (ladder rung name), or null when unset. */
  lineStatus: (id: string) => string | null;
  /** Set (or clear, with null) a beat's writing status. */
  setLineStatus: (id: string, status: string | null) => void;
  /** The recording-status ladder (#206, manual mode): name + colour, for the dropdown on dialogue lines. */
  recordingStatuses: () => RecordingStatusDecl[];
  /** The dialogue line's current recording status (rung name), or null when unset. */
  recordingStatus: (id: string) => string | null;
  /** Set (or clear, with null) a dialogue line's recording status. */
  setRecordingStatus: (id: string, status: string | null) => void;
  /** Audio Folders mode (#206): when true the recording status is derived from files on disk and the
   *  inspector shows it READ-ONLY (the manual dropdown is replaced by a status chip). */
  audioFoldersOn: () => boolean;
  /** In Audio Folders mode, the folder-derived recording status for a line (rung name), or null = missing. */
  recordingFolderStatus: (id: string) => string | null;
  /** Play a line's audio file (Audio Folders mode, fire-and-forget) - the inspector's ▶ button. `btn` (the
   *  clicked button) pulses while the clip sounds. */
  playRecording: (id: string, btn?: HTMLButtonElement) => void;
  /** Scratch recording (#224): the rung scratch takes record into, or null when scratch recording is off. */
  scratchStatus: () => string | null;
  /** Start an in-app scratch recording for a line (folder mode, status ≤ the scratch rung). */
  recordScratch: (id: string) => void;
  /** True when a line's scratch take is stale - its WAV's stamped text-hash no longer matches the line. */
  scratchStale: (id: string) => boolean;
  /** Replace the author tags (#215) on a node by id (an empty list clears them). */
  setTags: (id: string, tags: string[]) => void;
}

/** The host-facing Game ID address for the caret's location: `<scene>` or `<scene>.<block>` (spec §6).
 *  Shown right-aligned in the inspector title bar for quick reference. "" when nothing is selected. */
export function inspectorAddress(ctx: InspectorContext): string {
  const scene = ctx.levels.find((l): l is SceneLevel => l.kind === "scene");
  const block = ctx.levels.find((l): l is BlockLevel => l.kind === "block");
  if (!scene) return "";
  return block ? `${scene.address}.${block.address}` : scene.address;
}

/** Render the whole stack into `host`. Empty selection -> a muted placeholder. */
export function renderInspector(host: HTMLElement, ctx: InspectorContext, h: InspectorHandlers): void {
  host.replaceChildren();
  if (!ctx.levels.length) {
    host.append(el("p", "insp-empty", "Click in the script to inspect what's there."));
    return;
  }
  for (const lv of ctx.levels) host.append(levelView(lv, h));
}
