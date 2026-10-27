// The detail inspector (Patterpad.md §4): renders the caret's container stack - leaf -> snippet ->
// group(s) -> block, most-specific at the TOP - into the right pane. A READ projection of the
// surface's `onSelect` context; a header click jumps to that node (revealNode). The snippet / group
// CONDITION rows are editable - clicking opens the visual expression editor (M1, editCondition).
//
// Since the October 2026 UI review (patterkit design/ui-review-2026-10/3-composition.md, proposal 1) the
// stack is flat sections divided by hairlines, not cards, and it shows what is SET. Each level draws a few
// keys always (a line's Writing and Character, a snippet's Condition and Jump, an option's Condition and
// behaviour, a block's or scene's Game ID); every other property draws only once it has a value, and until
// then it waits in the level's one Add menu. The leaf and the snippet open; the outer levels fold to their
// header and a one-line summary, and the author's open or closed choice is remembered per kind of level.

import { fieldRows, iconNode, iconHtml, iconSvg, metaLine, openContextMenu } from "@wildwinter/app-shell"; // the family's drawn icon set: one spelling of every icon across the suite; the drawn separator
import type {
  InspectorContext, InspectLevel, LeafLevel, SnippetLevel, GroupLevel, BlockLevel, SceneLevel, MultiLevel, GroupPropsPatch, PadSource,
} from "@patterkit/patterpad-surface/surface";
import type { GameData, GameDataField, GameDataNodeKind, PropertyDecl, DocLine, WritingStatusDecl, RecordingStatusDecl, SpeakerQualifier } from "@patterkit/model";
import { RERECORD_STATUS_DECL, PAD_AFTER_MIN, PAD_AFTER_MAX } from "@patterkit/model";
import { colourIndex } from "@patterkit/patterpad-surface/colour";
import { el } from "./dom.js";
import { extensionSections, sweepExtensionRows, type ExtensionHandlers } from "./extension-rows.js";

type Reveal = (id: string) => void;

/** A property a level offers but doesn't draw while it's unset: it waits in the level's Add menu. Picking it
 *  either builds the row (inserted at the foot, its control focused, or its editor opened) or acts at once
 *  (`act`, anchored to the Add button), for a property whose row would only be a button to the same place.
 *  `gameData` puts the row in the level's Game Data section. */
interface Addable { label: string; build?: () => HTMLElement | null; act?: (anchor: HTMLElement) => void; gameData?: boolean }
/** What a body builder returns: rows to draw, properties to offer, and nothing. */
type Part = HTMLElement | Addable | null;
const isAddable = (p: Part): p is Addable => p != null && !(p instanceof HTMLElement);
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

// Condition / effect rows show PILLS (the visual format non-coders read); the editors they open show
// name-form text on request, inside the editor.

/** A label : value row. Returns null for an empty value so callers can skip blanks cheaply. */
/** The same row with nothing in it: a muted "None" in the value column. A typed dash for "nothing"
 *  is a placeholder glyph, and the family writes the word (copy-house-style.md rule 32). */
function emptyRow(label: string): HTMLElement {
  const r = el("div", "insp-row");
  r.append(el("span", "insp-key", label), el("span", "insp-val insp-none", "None"));
  return r;
}

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

/** The author-defined gameData fields for a node type: the ones this node SETS as editable rows, plus any
 *  orphaned keys read-only, and the unset ones offered in the Add menu (the field default holds until then). */
function gameDataFieldRows(kind: GameDataNodeKind, id: string | null, gd: GameData | undefined, h: InspectorHandlers): { rows: HTMLElement[]; unset: Addable[] } {
  const fields = h.gameDataFields(kind);
  const rows: HTMLElement[] = [];
  const unset: Addable[] = [];
  const defined = new Set<string>();
  for (const f of fields) {
    defined.add(f.name);
    if (gd?.[f.name] !== undefined) rows.push(gameDataFieldRow(f, id, gd[f.name], h, kind));
    else if (id) unset.push({ label: f.name, gameData: true, build: () => gameDataFieldRow(f, id, undefined, h, kind) });
  }
  for (const [k, v] of Object.entries(gd ?? {})) {
    if (!defined.has(k)) { const r = el("div", "insp-row"); r.append(el("span", "insp-key insp-gd", k), el("span", "insp-val insp-mono", typeof v === "string" ? v : JSON.stringify(v))); rows.push(r); }
  }
  return { rows, unset };
}

/** The gameData fields as one grouped section sitting BELOW a subtle divider (so a node's own data is
 *  visually separated from the host's custom fields), drawn only when the node sets one, followed by the
 *  unset fields for the Add menu. */
function gameDataSection(kind: GameDataNodeKind, id: string | null, gd: GameData | undefined, h: InspectorHandlers): Part[] {
  const { rows, unset } = gameDataFieldRows(kind, id, gd, h);
  return [rows.length ? gameDataBox(rows) : null, ...unset];
}

/** The Game Data section's box: its caption, then the rows. */
function gameDataBox(rows: HTMLElement[]): HTMLElement {
  const sec = el("div", "insp-gd-section");
  sec.append(el("div", "insp-gd-cap", "Game Data"), ...rows);
  return sec;
}

/** The game-data rows, kept across the inspector's redraws: the inspector rebuilds its whole stack whenever
 *  its levels change, and a game-data value is in them, so a value typed into a fresh row every keystroke
 *  would lose the focus. The shell's cache hands back the same row, focus and caret included. */
const fieldRowCache = fieldRows();

/** One editable gameData field row: the family's field row (`@wildwinter/app-shell` fieldRow), drawn by the
 *  field's type, its purpose under it, and unset saying what it falls back to, "default (x)". `current` is the
 *  node's override (undefined = falls back to the field default); clearing it removes the override (sparse
 *  storage). A value commits as it is typed, and Esc puts back what the field held, as everywhere in the
 *  family. Read-only when there is no node to write to. */
export function gameDataFieldRow(
  f: GameDataField, id: string | null, current: unknown, h: Pick<InspectorHandlers, "setGameData">, kind = "",
): HTMLElement {
  return fieldRowCache.row(`${kind}\u0000${id ?? ""}\u0000${f.name}`, {
    decl: f, value: current ?? undefined, disabled: id === null,
    onCommit: (v) => { if (id) h.setGameData(id, f.name, v); },
    className: "insp-row insp-gd-row", labelClassName: "insp-key", controlClassName: "insp-gd-input",
  });
}

/** Esc puts back the value the field held when it got focus (the family's field rule, ruling N). The
 *  event is not stopped: whatever Esc does next (the blur) still happens, and with the value back where
 *  it started, no change event follows it. Registered before the field's own keydown handlers. */
function escRestores(input: HTMLInputElement): void {
  let atFocus = input.value;
  input.addEventListener("focus", () => { atFocus = input.value; });
  input.addEventListener("keydown", (e) => { if (e.key === "Escape" && input.value !== atFocus) input.value = atFocus; });
}

/** The gameData node-kind for a leaf beat (the inspector calls a text beat "prose"; the model "text"). */
const leafNodeKind = (beat: LeafLevel["beat"]): GameDataNodeKind => (beat === "prose" ? "text" : beat);

const LEAF_HEAD: Record<LeafLevel["beat"], string> = { line: "Line", prose: "Text", gameEvent: "Game Event" };

function leafBody(lv: LeafLevel, h: InspectorHandlers): Part[] {
  const rows: Part[] = [];
  if (lv.beat !== "gameEvent") rows.push(statusRow(lv.id, h)); // writing status, line + text only (#196); game events aren't tracked
  if (lv.beat === "line") rows.push(recordingStatusRow(lv.id, h)); // recording status, dialogue lines only (#206)
  if (lv.beat === "line") rows.push(rerecordPart(lv.id, h));        // "needs re-record" override, dialogue lines only (#227)
  if (lv.beat === "line") {
    rows.push(lv.character ? row("Character", lv.character) : emptyRow("Character"));
    rows.push(lv.qualifier ? qualifierRow(lv.id, lv.qualifier, h) : addable("Qualifier", () => qualifierRow(lv.id, lv.qualifier, h), lv.id && h.qualifiers().length));
    rows.push(row("Direction", lv.direction));
  }
  if (lv.beat !== "gameEvent") rows.push(lv.padAfter !== undefined ? leafPadRow(lv, h) : addable("Pad after", () => leafPadRow(lv, h), lv.id));
  rows.push(tagsPart(lv.id, lv.tags, h));
  rows.push(...gameDataSection(leafNodeKind(lv.beat), lv.id, lv.gameData, h));
  rows.push(...extensionSections(leafNodeKind(lv.beat), lv.id, lv.ext, h));
  return rows;
}

/** An Add-menu entry for a row built on demand, or nothing when `offer` is falsy (no node to write to, or
 *  nothing to pick from). */
function addable(label: string, build: () => HTMLElement | null, offer: unknown = true): Addable | null {
  return offer ? { label, build } : null;
}

/** Tags: the chips when the node has any, otherwise the Add menu's "Tags". */
function tagsPart(id: string | null, tags: string[] | undefined, h: InspectorHandlers): Part {
  return tags?.length ? tagsRow(id, tags, h) : addable("Tags", () => tagsRow(id, tags, h), id);
}

// --- line padding (design/proposals/line-padding.md) ---------------------------------------------------
// A line or text beat's Pad after field, and the Default pad field on a snippet, group, block, or scene.
// Empty means "inherit": the placeholder says what the line takes then, and from where. Seconds, commit on
// change (blur / Enter) as the Game Data fields do, since the inspector re-renders on every edit.

/** Seconds as a field shows them: up to three decimals, no trailing zeros. */
export const formatSeconds = (n: number): string => String(Math.round(n * 1000) / 1000);

/** What a pause field's text means: null for blank (inherit), a number clamped to [min, max], or
 *  undefined for text that isn't a number (the field puts its old value back). */
export function parsePad(text: string, min: number, max = PAD_AFTER_MAX): number | null | undefined {
  const t = text.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(max, Math.max(min, Math.round(n * 1000) / 1000));
}

/** The words a pause field shows when it's empty: what applies instead, and where it comes from. */
export function inheritedPadText(inherited: PadSource | undefined, projectDefault: number, endsSnippet = false): string {
  const value = inherited?.value ?? projectDefault;
  if (endsSnippet && value < 0) return "0 at the end of a snippet"; // the runtime clamps it at the seam
  return `${formatSeconds(value)} from the ${inherited?.from ?? "project"}`;
}

/** One seconds field: `own` is the node's value (empty when it sets none), `min` the lowest it offers. */
function padRow(label: string, id: string | null, own: number | undefined, placeholder: string, min: number, tip: string, set: (id: string, seconds: number | null) => void): HTMLElement {
  const r = el("div", "insp-row");
  r.append(el("span", "insp-key", label));
  const wrap = el("div", "insp-pad");
  const input = el("input", "insp-gd-input insp-pad-input") as HTMLInputElement;
  input.type = "number"; input.step = "0.1";
  input.min = String(min); input.max = String(PAD_AFTER_MAX);
  input.value = own === undefined ? "" : formatSeconds(own);
  input.placeholder = placeholder;
  input.setAttribute("aria-label", label);
  input.dataset.tip = tip;
  if (!id) input.disabled = true;
  escRestores(input);
  let committed = input.value;
  input.addEventListener("change", () => {
    const v = parsePad(input.value, min);
    if (v === undefined) { input.value = committed; return; }
    input.value = v === null ? "" : formatSeconds(v);
    if (input.value === committed) return;
    committed = input.value;
    if (id) set(id, v);
  });
  wrap.append(input, el("span", "insp-unit", "seconds"));
  r.append(wrap);
  return r;
}

/** The Pad after field on a line or text beat (or an option's prompt). A snippet's last line can't cut in
 *  across the seam, so its field starts at 0 there; a prompt times the reply, which is certain. */
function leafPadRow(lv: LeafLevel, h: InspectorHandlers): HTMLElement {
  const seam = lv.endsSnippet === true;
  const tip = lv.prompt ? "The pause after this prompt before the reply. Below zero, the reply cuts in early."
    : seam ? "The pause after this line. It ends its snippet, so nothing can cut in on it."
    : "The pause after this line before what comes next. Below zero, it starts before this line ends.";
  return padRow("Pad after", lv.id, lv.padAfter, inheritedPadText(lv.padInherited, h.projectPadAfter(), seam),
    seam ? 0 : PAD_AFTER_MIN, tip, h.setPadAfter);
}

/** The Default pad field on a snippet, group, block, or scene: the pause after each line inside that
 *  sets none of its own. */
function defaultPadRow(lv: SnippetLevel | GroupLevel | BlockLevel | SceneLevel, h: InspectorHandlers): HTMLElement {
  const inherited = lv.kind === "scene" ? undefined : lv.padInherited;
  return padRow("Default pad", lv.id, lv.padAfterDefault, inheritedPadText(inherited, h.projectPadAfter()), PAD_AFTER_MIN,
    "The pause after each line inside that doesn't set its own.", h.setPadAfterDefault);
}

/** The speaker qualifier dropdown on a dialogue line or line prompt: "None" and the project's qualifiers,
 *  by the name the cue shows (`TAM (O.S.)`). Picking writes the line's gameId through the surface, as any
 *  edit does. A qualifier the project no longer lists stays selected, marked, until another is picked.
 *  Null when the project has none and the line carries none. */
function qualifierRow(id: string | null, current: string | undefined, h: InspectorHandlers): HTMLElement | null {
  const list = h.qualifiers();
  if (!list.length && !current) return null;
  const r = el("div", "insp-row");
  r.append(el("span", "insp-key", "Qualifier"));
  const sel = el("select", "insp-select insp-qualifier") as HTMLSelectElement;
  const add = (value: string, label: string): void => {
    const o = el("option", undefined, label) as HTMLOptionElement;
    o.value = value;
    sel.append(o);
  };
  add("", "None");
  for (const q of list) add(q.gameId, q.name);
  if (current && !list.some((q) => q.gameId === current)) add(current, `${current} (not in the list)`);
  sel.value = current ?? "";
  sel.dataset.tip = "How the line is delivered. The speaker stays the same character.";
  if (!id) sel.disabled = true;
  sel.addEventListener("change", () => { if (id) h.setQualifier(id, sel.value); });
  r.append(sel);
  return r;
}

/** A soft, READABLE fill for a status chip: the rung's palette colour mixed heavily toward the theme
 *  background, so the chip carries the colour's identity while `--ink` text stays legible on ANY palette
 *  (light, dark, or a colour theme) - a saturated `--char-N` fill left the text unreadable. No colour ->
 *  a neutral muted tint. Shared by the manual status selects + the folder-derived recording chip so they match. */
export function statusTint(slot: number | undefined): string {
  const base = slot != null ? `var(--char-${slot})` : "var(--muted)";
  return `color-mix(in oklab, ${base} 26%, var(--card))`;
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
    chip.dataset.tip = "Derived from audio folders";
    wrap.append(chip);
    // Stale scratch take (#224): the WAV's stamped text-hash no longer matches the line (it was edited).
    if (derived && h.scratchStale(id)) {
      const warn = el("span", "insp-rec-stale"); warn.append(iconNode("warning", 12), "out of date");
      warn.dataset.tip = "This scratch take was recorded against an earlier version of the line.";
      wrap.append(warn);
    }
    // A play button only when a file actually resolved (not for an implicitly-missing line).
    if (derived) {
      const play = el("button", "insp-rec-play") as HTMLButtonElement;
      play.type = "button"; play.append(iconNode("play", 12)); play.dataset.tip = "Play audio";
      play.setAttribute("aria-label", "Play audio");
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
        rec.type = "button"; rec.append(iconNode("record", 12), "Record"); rec.dataset.tip = "Record a scratch take";
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

/** The "needs re-record" toggle (#227) for a dialogue line: a checkbox flagging an existing take for a
 *  retake. When set, the line's recording status is MASKED to the reserved "re-record" status in the
 *  recording script, the report, and status browse - a coloured pill echoes that here, and the underlying
 *  chip / take stays visible and playable above. Shares the recording row's gate (shown only when the
 *  project tracks recording status); null otherwise. */
function rerecordPart(id: string | null, h: InspectorHandlers): Part {
  if (!h.recordingStatuses().length || !id) return null;
  return h.needsRerecord(id) ? rerecordRow(id, h) : { label: "Needs re-record", act: () => h.setNeedsRerecord(id, true) };
}

function rerecordRow(id: string | null, h: InspectorHandlers): HTMLElement | null {
  if (!h.recordingStatuses().length || !id) return null;
  const on = h.needsRerecord(id);
  const r = el("div", "insp-row");
  r.append(el("span", "insp-key", "Re-record"));
  const wrap = el("div", "insp-status");
  const label = el("label", "insp-rerecord") as HTMLLabelElement;
  const cb = el("input") as HTMLInputElement;
  cb.type = "checkbox"; cb.checked = on;
  cb.addEventListener("change", () => h.setNeedsRerecord(id, cb.checked));
  label.append(cb, document.createTextNode(" Needs re-record"));
  label.dataset.tip = 'The take exists but must be redone (bad quality, wrong take). Masks the recording status as "re-record".';
  wrap.append(label);
  if (on) {
    const pill = el("span", "insp-rec-chip", "re-record");
    pill.style.background = statusTint(RERECORD_STATUS_DECL.colour);
    pill.dataset.tip = "This line is flagged for a retake.";
    wrap.append(pill);
  }
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
  input.type = "text"; input.placeholder = current.length ? "" : "Add tag…";
  input.setAttribute("aria-label", "add a tag");
  input.spellcheck = false; input.autocapitalize = "off"; (input as HTMLInputElement).autocomplete = "off";

  const commit = (): void => { h.setTags(id, current); };
  const repaint = (): void => {
    box.querySelectorAll(".insp-tag").forEach((n) => n.remove());
    for (const [i, t] of current.entries()) {
      const chip = el("span", "insp-tag");
      chip.style.setProperty("--tag-c", `var(--char-${colourIndex(t)})`);
      chip.append(el("span", "insp-tag-text", t));
      const x = el("button", "insp-tag-x"); x.append(iconNode("close", 10));
      x.type = "button"; x.dataset.tip = "Remove tag"; x.setAttribute("aria-label", `Remove tag ${t}`);
      x.addEventListener("click", () => { current.splice(i, 1); repaint(); commit(); input.focus(); });
      chip.append(x);
      box.insertBefore(chip, input);
    }
    input.placeholder = current.length ? "" : "Add tag…";
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

  escRestores(input); // Esc drops a half-typed tag rather than letting the blur that follows add it
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

/** One effect-phase row (On enter / On exit), shown directly under Condition in the snippet body. A
 *  summary of that phase's effects (or "+ Add"); clicking opens the effects editor scoped to the phase.
 *  Both lists are passed so the editor can still show context, but `phase` focuses it on this one. */
function phaseRow(id: string | null, label: string, phase: "onEnter" | "onExit", onEnter: EffectLike[], onExit: EffectLike[], h: InspectorHandlers): HTMLElement {
  const mine = phase === "onEnter" ? onEnter : onExit;
  // Stacked (value UNDER the label) so the effect pills get the row's full width.
  const r = el("div", "insp-row insp-row-stack");
  r.append(el("span", "insp-key", label));
  const btn = el("button", `insp-cond${mine.length ? "" : " muted"}`);
  btn.type = "button";
  if (!mine.length) btn.textContent = "None";
  else btn.append(h.effectsPreview(mine)); // pills (inert → click opens editor)
  if (id) { btn.dataset.tip = `Edit ${label.toLowerCase()} effects`; btn.setAttribute("aria-label", `Edit ${label.toLowerCase()} effects`); btn.addEventListener("click", () => h.editEffects(id, onEnter, onExit, btn, phase)); }
  else btn.disabled = true;
  r.append(btn);
  return r;
}

/** An editable Condition row: clicking opens the visual expression editor (or "+ Add condition"). The
 *  current condition shows as PILLS. */
function condRow(id: string | null, src: string | undefined, h: InspectorHandlers): HTMLElement {
  // Stacked (value UNDER the label) once it holds pills, so they get the row's full width to breathe; an
  // unset one is a quiet field beside its label, as Jump is.
  const r = el("div", src ? "insp-row insp-row-stack" : "insp-row");
  r.append(el("span", "insp-key", "Condition"));
  const btn = el("button", `insp-cond${src ? "" : " muted"}`);
  btn.type = "button";
  if (!src) btn.textContent = "None"; // a quiet field: unset reads as the word, and a click opens the editor
  else { btn.append(el("span", "insp-if", "if "), h.condPreview(src)); } // pills (inert → click opens editor)
  if (id) { btn.dataset.tip = "Edit condition"; btn.setAttribute("aria-label", "Edit condition"); btn.addEventListener("click", () => h.editCondition(id, src ?? "", btn)); }
  else btn.disabled = true;
  r.append(btn);
  return r;
}

/** A label : <select> row. Commits on change (the native dropdown closes before the re-render). */
/** A full-width advisory note under the controls (e.g. the Best-match degeneracy nudge). Muted, never an error. */
function noteRow(text: string): HTMLElement {
  return el("div", "insp-advice", text); // not `.insp-note`, which is the header's note icon
}

function selectRow(label: string, value: string, opts: Array<[string, string]>, onChange: (v: string) => void): HTMLElement {
  const r = el("div", "insp-row");
  r.append(el("span", "insp-key", label));
  const sel = el("select", "insp-select") as HTMLSelectElement;
  for (const [v, l] of opts) { const o = el("option", undefined, l) as HTMLOptionElement; o.value = v; if (v === value) o.selected = true; sel.append(o); }
  sel.addEventListener("change", () => onChange(sel.value));
  r.append(sel);
  return r;
}

/** A row of on / off flags, each a small toggle button whose word is the control (an option's Sticky,
 *  Fallback and Secret: three checkbox rows became one in the October 2026 review). */
function flagsRow(label: string, flags: Array<{ name: string; on: boolean; tip: string; set: (on: boolean) => void }>): HTMLElement {
  const r = el("div", "insp-row");
  r.append(el("span", "insp-key", label));
  const box = el("div", "insp-flags");
  for (const f of flags) {
    const b = el("button", "insp-flag", f.name) as HTMLButtonElement;
    b.type = "button"; b.dataset.tip = f.tip;
    b.setAttribute("aria-pressed", String(f.on));
    b.addEventListener("click", () => f.set(!f.on));
    box.append(b);
  }
  r.append(box);
  return r;
}

/** A jump's value as the script draws it: the arrow (or a call's out-and-back loop) and the target. */
function paintJump(btn: HTMLElement, jump: { mode?: string; to: string }, h: InspectorHandlers): void {
  const call = jump.mode === "call";
  btn.classList.add("insp-jump");
  btn.replaceChildren(iconNode(call ? "call" : "jump", 13), el("span", "", h.jumpLabel(jump.to)));
}

/** An editable Jump row: a chip showing the target's READABLE label (or "+ Set jump"); click
 *  opens the picker. Storage is the internal id; `h.jumpLabel` resolves it to a name / gameId. */
function jumpRow(id: string | null, jump: SnippetLevel["jump"], h: InspectorHandlers): HTMLElement {
  const r = el("div", "insp-row");
  r.append(el("span", "insp-key", "Jump"));
  const btn = el("button", `insp-cond${jump ? "" : " muted"}`);
  btn.type = "button";
  if (jump) paintJump(btn, jump, h); else btn.textContent = "None";
  if (id) { btn.dataset.tip = "Set jump target"; btn.setAttribute("aria-label", "Set jump target"); btn.addEventListener("click", () => h.editJump(id, jump?.to ?? "", btn)); }
  else btn.disabled = true;
  const val = el("div", "insp-jumpval");
  val.append(btn);
  // Mode toggle: only meaningful once a jump is set. "go" leaves for good; "call" returns here when the
  // target finishes (jump-and-return). Storage default is one-way, so a missing mode reads as "go".
  if (id && jump) {
    const mode: "jump" | "call" = jump.mode === "call" ? "call" : "jump";
    const seg = el("span", "seg");
    const opt = (m: "jump" | "call", label: string, tip: string): HTMLElement => {
      const b = el("button", `seg-opt${mode === m ? " on" : ""}`, label);
      b.type = "button";
      b.dataset.tip = tip; b.setAttribute("aria-label", tip); b.setAttribute("aria-pressed", String(mode === m));
      if (mode !== m) b.addEventListener("click", () => h.setJumpMode(id, m));
      return b;
    };
    seg.append(opt("jump", "Jump", "One-way jump"), opt("call", "Call", "Jump and return here"));
    val.append(seg);
  }
  r.append(val);
  return r;
}

function snippetBody(lv: SnippetLevel, h: InspectorHandlers): Part[] {
  const rows: Part[] = [];
  const onEnter = lv.onEnter ?? [];
  const onExit = lv.onExit ?? [];
  rows.push(condRow(lv.id, lv.condition, h));
  // Jump sits right under Condition - they are the two routing/eligibility rows an author scans first.
  rows.push(jumpRow(lv.id, lv.jump, h));
  // On begin / On end draw once they hold an effect; until then the Add menu opens their editor directly.
  const phase = (label: string, which: "onEnter" | "onExit", mine: EffectLike[]): Part =>
    mine.length ? phaseRow(lv.id, label, which, onEnter, onExit, h)
      : lv.id ? { label, act: (anchor) => h.editEffects(lv.id!, onEnter, onExit, anchor, which) } : null;
  rows.push(phase("On begin", "onEnter", onEnter));
  rows.push(phase("On end", "onExit", onExit));
  if (lv.beatCount === 0) rows.push(row("Beats", "none (a jump-only snippet)"));
  rows.push(defaultPadPart(lv, h));
  rows.push(tagsPart(lv.id, lv.tags, h));
  rows.push(...gameDataSection("snippet", lv.id, lv.gameData, h));
  rows.push(...extensionSections("snippet", lv.id, lv.ext, h));
  return rows;
}

/** Default pad: the field when the node sets one, otherwise the Add menu's "Default pad". */
function defaultPadPart(lv: SnippetLevel | GroupLevel | BlockLevel | SceneLevel, h: InspectorHandlers): Part {
  return lv.padAfterDefault !== undefined ? defaultPadRow(lv, h) : addable("Default pad", () => defaultPadRow(lv, h), lv.id);
}

const GROUP_HEAD: Record<GroupLevel["role"], string> = {
  option: "Option", choice: "Choice", branch: "Branch", sequence: "Sequence", conditional: "Conditional", group: "Group",
};

// The "copy" glyph: a clean front sheet with only the back sheet's top-right corner peeking out behind it
// (stroke-only, so no lines cross the front sheet's interior - theme-proof). A tick replaces it on copy.
const COPY_SVG = iconHtml("copy", 13); // the family's drawn copy icon (app-shell 0.47.0), not one of our own
const COPY_CHECK = iconHtml("tick", 13); // the vocabulary's tick, at the copy glyph's size

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

// The note-page pair (outline = no notes, filled = notes set) is the shell's `iconSvg.noteFilled` /
// `noteOutline`: the same bytes this file used to carry, now with one owner.

/** The title-bar note icon: outline when no notes, filled when notes are set; opens the notes modal. */
function noteButton(id: string, kind: string | undefined, has: boolean, h: InspectorHandlers): HTMLButtonElement {
  const b = el("button", `insp-note${has ? " has" : ""}`) as HTMLButtonElement; b.type = "button";
  b.dataset.tip = has ? "Edit notes" : "Add a note";
  b.setAttribute("aria-label", has ? "Edit notes" : "Add a note");
  b.innerHTML = has ? iconSvg.noteFilled : iconSvg.noteOutline;
  b.addEventListener("click", (e) => { e.stopPropagation(); e.preventDefault(); h.editNote(id, b, kind); });
  return b;
}

function groupBody(lv: GroupLevel, h: InspectorHandlers): Part[] {
  const rows: Part[] = [];
  const set = (patch: GroupPropsPatch): void => { if (lv.id) h.editGroupProps(lv.id, patch); };
  rows.push(condRow(lv.id, lv.condition, h));
  if (lv.role === "option") {
    // Option behaviour (spec §5): sticky = repeatable (off = once-only); fallback = auto-followed when
    // it is the last option left; secret = hidden while ineligible.
    rows.push(flagsRow("Behaviour", [
      { name: "Sticky", on: lv.sticky ?? false, tip: "Offered again after it's picked", set: (on) => set({ sticky: on }) },
      { name: "Fallback", on: lv.fallback ?? false, tip: "Followed by itself when it's the last option left", set: (on) => set({ fallback: on }) },
      { name: "Secret", on: lv.secretUntilEligible ?? false, tip: "Hidden while its condition doesn't hold", set: (on) => set({ secretUntilEligible: on }) },
    ]));
  } else if (lv.role === "choice") {
    // Nothing more: a choice IS its options, which are already surfaced in the script (and each
    // option's flags / condition are editable by selecting that option). A duplicate list here just
    // added complexity, so the Choice level shows only its Condition + any gameData.
  } else {
    const selector = (lv.selector ?? "run") as "run" | "branch" | "sequence" | "choice";
    rows.push(selectRow("Selector", selector, [["run", "Run (in order)"], ["branch", "Branch (first match)"], ["sequence", "Sequence"]], (v) => set({ selector: v as GroupPropsPatch["selector"] })));
    if (selector === "sequence") {
      rows.push(selectRow("Order", lv.order ?? "sequential", [["sequential", "In order"], ["shuffle", "Shuffle"], ["specificity", "Best match"]], (v) => set({ order: v as GroupPropsPatch["order"] })));
      rows.push(selectRow("Exhaust", lv.exhaust ?? "once", [["once", "Play once"], ["repeat", "Repeat"], ["stick", "Stick on last"]], (v) => set({ exhaust: v as GroupPropsPatch["exhaust"] })));
      // Best match with no conditioned children just re-shuffles - nudge the author (the degeneracy hint;
      // see the proposal §8.1). A soft note, never an error: the group is valid, only redundant.
      if (lv.order === "specificity" && lv.conditionedChildren === 0) {
        rows.push(noteRow("No conditions yet, so this behaves like Shuffle. Add a condition to a child to make it more specific."));
      }
    }
  }
  rows.push(defaultPadPart(lv, h));
  rows.push(tagsPart(lv.id, lv.tags, h));
  // An option's fields are declared (the `option` node kind) and edit here; any other group's gameData has no
  // declared fields, so it shows as it stands.
  if (lv.role === "option") rows.push(...gameDataSection("option", lv.id, lv.gameData, h), ...extensionSections("option", lv.id, lv.ext, h));
  else rows.push(...gameDataRows(lv.gameData));
  return rows;
}

/** The host-facing Game ID row: a clickable chip showing the effective address the runtime targets;
 *  clicking opens the Game ID editor. Muted when it is auto-derived from the name (not pinned). */
function addressRow(id: string | null, gameId: string | undefined, address: string, edit: EditGameId): HTMLElement {
  const r = el("div", "insp-row");
  r.append(el("span", "insp-key", "Game ID"));
  const btn = el("button", `insp-cond${gameId ? "" : " muted"}`);
  btn.type = "button";
  btn.textContent = address || "None";
  if (id) {
    // Publish Bundle pins every derived address (pin on publish), so "derived" lasts until then.
    const tip = gameId ? "Edit the Game ID" : "Derived from the name until the bundle is first published. Click to pin a fixed Game ID.";
    btn.dataset.tip = tip; btn.setAttribute("aria-label", tip);
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
  btn.type = "button"; btn.dataset.tip = "Scene-local @scene properties"; btn.setAttribute("aria-label", "Scene-local @scene properties");
  btn.textContent = n ? `${n} scene ${n === 1 ? "property" : "properties"}` : "None";
  btn.addEventListener("click", () => h.editSceneProps());
  r.append(btn);
  return r;
}


function addressBody(lv: SceneLevel | BlockLevel, h: InspectorHandlers): Part[] {
  const rows: Part[] = [addressRow(lv.id, lv.gameId, lv.address, h.editGameId)];
  if (lv.kind === "scene") rows.push(h.sceneProps().length ? scenePropsRow(h) : { label: "Scene properties", act: () => h.editSceneProps() });
  rows.push(defaultPadPart(lv, h));
  rows.push(tagsPart(lv.id, lv.tags, h));
  rows.push(...gameDataSection(lv.kind, lv.id, lv.gameData, h));
  rows.push(...extensionSections(lv.kind, lv.id, lv.ext, h));
  return rows;
}

/** Several whole chunks selected (a shift-click run): the properties they SHARE, so a writer can set a
 *  condition, a jump, a default pause or a tag on all of them at once (the October 2026 UI review,
 *  3-composition.md proposal 10). A value every chunk has shows as it is; one that differs reads "Mixed",
 *  and setting it writes every chunk, as one undo step. Jump is offered only when they are all snippets.
 *  What the run can DO (wrap, move, delete) stays in the hint bar and the ⋯ menu. */
function multiLevelView(lv: MultiLevel, h: InspectorHandlers): HTMLElement {
  const noun = lv.groups === 0 ? "snippets" : lv.snippets === 0 ? "groups" : "items";
  const section = el("section", "insp-level insp-multi");
  const headerRow = el("div", "insp-head-row");
  const header = el("div", "insp-head");
  header.append(el("span", "insp-head-name", `${lv.count} ${noun} selected`));
  headerRow.append(header);
  section.append(headerRow);
  const items = lv.items.filter((i) => i.id !== null);
  if (items.length < 2) return section;
  const ids = items.map((i) => i.id!);
  /** Every item's value, as text for comparing: one distinct value is shared, more is Mixed. */
  const same = <T>(get: (i: (typeof items)[number]) => T): { shared: boolean; value: T } => {
    const values = items.map(get);
    const keys = new Set(values.map((v) => JSON.stringify(v ?? null)));
    return { shared: keys.size === 1, value: values[0]! };
  };
  const body = el("div", "insp-body");

  // Condition: the shared one as pills, or Mixed; the editor writes them all.
  const cond = same((i) => i.condition ?? "");
  const condBtn = el("button", `insp-cond${cond.shared && cond.value ? "" : " muted"}`) as HTMLButtonElement;
  condBtn.type = "button";
  if (!cond.shared) condBtn.append(el("span", "insp-mixed", "Mixed"));
  else if (cond.value) condBtn.append(el("span", "insp-if", "if "), h.condPreview(cond.value));
  else condBtn.textContent = "None";
  condBtn.dataset.tip = `Edit the condition on all ${lv.count}`;
  condBtn.setAttribute("aria-label", condBtn.dataset.tip);
  condBtn.addEventListener("click", () => h.editConditionMany(ids, cond.shared ? cond.value : "", condBtn));
  const condRowEl = el("div", cond.shared && cond.value ? "insp-row insp-row-stack" : "insp-row");
  condRowEl.append(el("span", "insp-key", "Condition"), condBtn);
  body.append(condRowEl);

  // Jump: only when every item is a snippet, the one kind that carries one.
  if (lv.groups === 0) {
    const jump = same((i) => (i.kind === "snippet" && i.jump ? `${i.jump.mode ?? "jump"}:${i.jump.to}` : ""));
    const first = items[0]!.kind === "snippet" ? items[0]!.jump : undefined;
    const jumpBtn = el("button", `insp-cond${jump.shared && jump.value ? "" : " muted"}`) as HTMLButtonElement;
    jumpBtn.type = "button";
    if (!jump.shared) jumpBtn.append(el("span", "insp-mixed", "Mixed"));
    else if (first) paintJump(jumpBtn, first, h);
    else jumpBtn.textContent = "None";
    jumpBtn.dataset.tip = `Set the jump on all ${lv.count}`;
    jumpBtn.setAttribute("aria-label", jumpBtn.dataset.tip);
    jumpBtn.addEventListener("click", () => h.editJumpMany(ids, jumpBtn));
    const r = el("div", "insp-row");
    r.append(el("span", "insp-key", "Jump"), jumpBtn);
    body.append(r);
  }

  // Default pad: the shared pause, or a Mixed placeholder; a value typed here sets it on all of them.
  const pad = same((i) => i.padAfterDefault);
  const padRowEl = padRow("Default pad", ids[0]!, pad.shared ? pad.value : undefined, pad.shared ? "Inherited" : "Mixed", PAD_AFTER_MIN,
    `The pause after each line inside, on all ${lv.count}.`, (_id, seconds) => h.batch(() => { for (const id of ids) h.setPadAfterDefault(id, seconds); }));
  body.append(padRowEl);

  body.append(multiTagsRow(items, h));
  section.append(body);
  return section;
}

/** Tags across a multi-selection: a tag every item has is a plain chip, one only some have is drawn with a
 *  dashed edge and how many ("night, 2 of 3"). Adding a tag puts it on all of them; removing a chip takes it
 *  off all of them, as one undo step either way. */
function multiTagsRow(items: Array<{ id: string | null; tags?: string[] }>, h: InspectorHandlers): HTMLElement {
  const r = el("div", "insp-row insp-row-tags");
  r.append(el("span", "insp-key", "Tags"));
  const box = el("div", "insp-tags");
  const lists = items.map((i) => i.tags ?? []);
  const all = [...new Set(lists.flat())];
  const write = (change: (tags: string[]) => string[]): void => {
    h.batch(() => { items.forEach((i, n) => { if (i.id) h.setTags(i.id, change(lists[n]!)); }); });
  };
  for (const t of all) {
    const have = lists.filter((l) => l.includes(t)).length;
    const partial = have < lists.length;
    const chip = el("span", `insp-tag${partial ? " partial" : ""}`);
    chip.style.setProperty("--tag-c", `var(--char-${colourIndex(t)})`);
    chip.append(el("span", "insp-tag-text", partial ? `${t}, ${have} of ${lists.length}` : t));
    const x = el("button", "insp-tag-x"); x.append(iconNode("close", 10));
    x.type = "button"; x.dataset.tip = "Remove from all"; x.setAttribute("aria-label", `Remove tag ${t} from all`);
    x.addEventListener("click", () => write((tags) => tags.filter((x2) => x2 !== t)));
    chip.append(x);
    box.append(chip);
  }
  const input = el("input", "insp-tag-input") as HTMLInputElement;
  input.type = "text"; input.placeholder = all.length ? "" : "Add tag…";
  input.setAttribute("aria-label", "add a tag to all");
  input.spellcheck = false; input.autocapitalize = "off"; input.autocomplete = "off";
  const add = (): void => {
    const fresh = input.value.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean);
    input.value = "";
    if (fresh.length) write((tags) => [...tags, ...fresh.filter((t) => !tags.includes(t))]);
  };
  escRestores(input);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } });
  input.addEventListener("blur", () => { if (input.value.trim()) add(); });
  box.append(input);
  r.append(box);
  return r;
}

/** The kind of level, as the open / closed memory keys it: a group by its role ("option", "choice", ...). */
const levelKey = (lv: Exclude<InspectLevel, MultiLevel>): string => (lv.kind === "group" ? lv.role : lv.kind);

/** Which levels open by default: the ones that hold the caret's own text and its snippet. The rest fold to a
 *  summary line until the author opens them, and the author's choice is remembered per kind. */
const OPEN_BY_DEFAULT = new Set(["leaf", "snippet"]);

/** A folded level's one-line summary: what it SETS, in words ("Sticky, has a condition"). Empty when it
 *  sets nothing beyond its header. */
function levelSummary(lv: Exclude<InspectLevel, MultiLevel>, h: InspectorHandlers): string {
  const parts: string[] = [];
  if (lv.kind === "group" && lv.role === "option") {
    if (lv.sticky) parts.push("Sticky");
    if (lv.fallback) parts.push("Fallback");
    if (lv.secretUntilEligible) parts.push("Secret");
  }
  if ((lv.kind === "group" || lv.kind === "snippet") && lv.condition) parts.push("has a condition");
  if (lv.kind === "snippet" && lv.jump) parts.push(`${lv.jump.mode === "call" ? "calls" : "jumps to"} ${h.jumpLabel(lv.jump.to)}`);
  if (lv.kind === "scene" && h.sceneProps().length) parts.push(`${h.sceneProps().length} scene ${h.sceneProps().length === 1 ? "property" : "properties"}`);
  if (lv.kind !== "leaf" && lv.padAfterDefault !== undefined) parts.push(`pad ${formatSeconds(lv.padAfterDefault)}s`);
  const tags = lv.tags?.length ?? 0;
  if (tags) parts.push(`${tags} ${tags === 1 ? "tag" : "tags"}`);
  const fields = Object.keys(lv.gameData ?? {}).length;
  if (fields) parts.push(`${fields} game data ${fields === 1 ? "field" : "fields"}`);
  if (!parts.length) return "";
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The level's Add button: one menu of the properties it offers but doesn't draw yet. Picking one builds its
 *  row at the foot of the level (inside Game Data for a field) and puts the author in it: the control
 *  focused, or the editor a row's button opens. Absent when the level offers nothing. */
function addButton(body: HTMLElement, offers: Addable[]): HTMLElement {
  const btn = el("button", "insp-add") as HTMLButtonElement;
  btn.type = "button";
  btn.append(iconNode("add", 12), "Add");
  btn.dataset.tip = "Add a property";
  btn.setAttribute("aria-haspopup", "menu");
  btn.addEventListener("click", () => {
    const r = btn.getBoundingClientRect();
    openContextMenu(r.left, r.bottom + 4, offers.map((o) => ({
      label: o.label,
      onClick: () => {
        if (o.act) { o.act(btn); return; }
        const row = o.build?.();
        if (!row) return;
        if (o.gameData) {
          const box = body.querySelector<HTMLElement>(":scope > .insp-gd-section");
          if (box) box.append(row); else body.insertBefore(gameDataBox([row]), btn);
        } else body.insertBefore(row, btn);
        offers.splice(offers.indexOf(o), 1);
        if (!offers.length) btn.remove();
        const target = row.querySelector<HTMLElement>("input, select, textarea, button.insp-cond");
        if (target instanceof HTMLButtonElement) target.click(); else target?.focus();
      },
    })));
  });
  return btn;
}

function levelView(lv: InspectLevel, h: InspectorHandlers): HTMLElement {
  if (lv.kind === "multi") return multiLevelView(lv, h);
  let head: string;
  let sub: string | HTMLElement = "";
  let parts: Part[];
  switch (lv.kind) {
    case "leaf": head = LEAF_HEAD[lv.beat]; parts = leafBody(lv, h); break;
    case "snippet": head = "Snippet"; parts = snippetBody(lv, h); break; // always "Snippet" - a jump is a snippet property, not its identity (the body notes a jump-only snippet)
    case "group": head = GROUP_HEAD[lv.role]; sub = lv.role === "sequence" && lv.labelParts.length > 1 ? metaLine(lv.labelParts.slice(1)) : ""; parts = groupBody(lv, h); break; // a sequence's sub: its order and exhaust, drawn separators
    case "block": head = "Block"; sub = lv.name; parts = addressBody(lv, h); break;
    case "scene": head = "Scene"; sub = lv.name; parts = addressBody(lv, h); break;
  }
  const rows = parts.filter((p): p is HTMLElement => p instanceof HTMLElement);
  const offers = parts.filter(isAddable);

  const key = levelKey(lv);
  let open = h.levelOpen(key) ?? OPEN_BY_DEFAULT.has(key);
  const section = el("section", `insp-level insp-${lv.kind}${open ? "" : " insp-folded"}`);
  const headerRow = el("div", "insp-head-row");
  // The fold: a drawn chevron on the header's left. Structural, so it moves (the chevron turns); the
  // header itself still reveals the node in the script.
  const fold = el("button", "insp-fold") as HTMLButtonElement;
  fold.type = "button";
  const paintFold = (): void => {
    fold.replaceChildren(iconNode(open ? "expanded" : "collapsed", 12));
    fold.setAttribute("aria-expanded", String(open));
    fold.setAttribute("aria-label", `${open ? "Fold" : "Open"} ${head}`);
  };
  paintFold();
  fold.addEventListener("click", () => {
    open = !open;
    section.classList.toggle("insp-folded", !open);
    paintFold();
    h.setLevelOpen(key, open);
  });
  const header = el("button", "insp-head");
  (header as HTMLButtonElement).type = "button";
  header.append(el("span", "insp-head-name", head));
  if (sub) { const subEl = el("span", "insp-head-sub"); subEl.append(sub); header.append(subEl); }
  const summary = levelSummary(lv, h);
  if (summary) header.append(el("span", "insp-head-sum", summary));
  if (lv.id) {
    header.dataset.tip = `Reveal this ${head.toLowerCase()} in the script`; // no opaque id surfaced (spec §6)
    header.addEventListener("click", () => h.reveal(lv.id!));
  } else {
    (header as HTMLButtonElement).disabled = true;
  }
  headerRow.append(fold, header);
  // Top-right action cluster, shown as the pointer comes to the level: an optional COPY icon (the node's
  // address / loc ID - shown on rollover, click to copy) then - wherever notes are allowed (every node with
  // an id) - a NOTE icon (outline = none, filled = notes set) that opens the notes modal for this node.
  const actions = el("div", "insp-head-actions");
  if ((lv.kind === "scene" || lv.kind === "block") && lv.address) actions.append(addrCopyButton(lv.address, "address"));
  else if (lv.kind === "leaf" && lv.id && (lv.beat === "line" || lv.beat === "prose")) actions.append(addrCopyButton(lv.id, "line ID")); // loc / audio id (not game-event)
  if (lv.id) actions.append(noteButton(lv.id, lv.kind === "leaf" ? lv.beat : undefined, h.hasNotes(lv.id), h));
  if (actions.childElementCount) headerRow.append(actions);
  section.append(headerRow);

  if (rows.length || offers.length) {
    const bodyEl = el("div", "insp-body");
    bodyEl.append(...rows);
    if (offers.length) bodyEl.append(addButton(bodyEl, offers));
    section.append(bodyEl);
  }
  return section;
}

export interface InspectorHandlers extends ExtensionHandlers {
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
  /** Render a condition (name-form `src`) as a read-only PILL strip for the inspector row. */
  condPreview: (src: string) => HTMLElement;
  /** Render an effects list as a read-only PILL strip for the inspector row. */
  effectsPreview: (effects: EffectLike[]) => HTMLElement;
  /** Resolve a jump target id to its readable label (block / scene name or gameId). */
  jumpLabel: (id: string) => string;
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
  /** Whether a dialogue line is flagged "needs re-record" (#227) - an existing take that must be redone. */
  needsRerecord: (id: string) => boolean;
  /** Tick / untick a dialogue line's "needs re-record" flag. Ticking with no VO note prompts for the reason. */
  setNeedsRerecord: (id: string, on: boolean) => void;
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
  /** The project's speaker qualifiers, in display order (the Qualifier dropdown on a dialogue line). */
  qualifiers: () => SpeakerQualifier[];
  /** Set (or clear, with "") a dialogue line's speaker qualifier gameId. */
  setQualifier: (id: string, gameId: string) => void;
  /** The project's default pause after a line, in seconds (line padding): what an empty field shows
   *  when nothing nearer sets one. */
  projectPadAfter: () => number;
  /** Set (or clear, with null) the pause after a line or text beat, in seconds. */
  setPadAfter: (id: string, seconds: number | null) => void;
  /** Set (or clear, with null) a snippet, group, block, or scene's default pause, in seconds. */
  setPadAfterDefault: (id: string, seconds: number | null) => void;
  /** Run `edits` as ONE undo step (the surface's batch): the multi-selection's edits write each chunk. */
  batch: (edits: () => void) => void;
  /** Open the condition editor for several snippets / groups at once, seeded with `src` (their shared
   *  condition, or "" when it's Mixed); what's written goes to all of them. */
  editConditionMany: (ids: string[], src: string, anchor: HTMLElement) => void;
  /** Open the jump picker for several snippets at once; a pick sets all of them. */
  editJumpMany: (ids: string[], anchor: HTMLElement) => void;
  /** Whether the author left this kind of level ("snippet", "option", "block", ...) open or folded, or
   *  undefined when they never chose (the default then holds). */
  levelOpen: (key: string) => boolean | undefined;
  /** Remember the author's open or folded choice for a kind of level. */
  setLevelOpen: (key: string, open: boolean) => void;
}

/** Render the whole stack into `host`. Empty selection -> a muted placeholder. */
export function renderInspector(host: HTMLElement, ctx: InspectorContext, h: InspectorHandlers): void {
  host.replaceChildren();
  if (!ctx.levels.length) {
    host.append(el("p", "empty", "Click in the script to inspect what's there."));
  } else {
    for (const lv of ctx.levels) host.append(levelView(lv, h));
  }
  fieldRowCache.sweep();
  sweepExtensionRows();
}
