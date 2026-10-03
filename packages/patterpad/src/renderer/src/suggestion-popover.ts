// The "suggest a rewrite" popovers (review flow, design/proposals/suggest-rewrite.md): anchored panels
// (share openAnchoredPanel with the comment / condition editors). TWO entry points:
//   - COMPOSE: a textarea prefilled with the beat's current say text; the reviewer edits it and submits a
//     proposal (Enter submits + closes, Shift+Enter newline - matching the comment composer).
//   - REVIEW: the beat's open proposals, each showing current -> proposed (re-diffed against the live text;
//     a stale proposal - the line changed since it was made - is banner-flagged), with Accept / Reject.

import { iconNode } from "@wildwinter/app-shell";
import { el } from "./dom.js";
import { openPanel } from "./panel.js";

const fmtTs = (ts: string): string => {
  try { return new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); }
  catch { return ts; }
};

/** Compose a new rewrite proposal, prefilled with the beat's current say text. */
export function openSuggestionCompose(opts: {
  anchor: HTMLElement;
  current: string;
  onSubmit: (proposed: string) => void;
  onClose?: () => void;
}): void {
  const panel = openPanel({ anchor: opts.anchor, className: "suggestion-popover", title: "Suggest a rewrite", width: 340, onClose: opts.onClose });
  if (!panel) return; // re-click on the same anchor toggled it off
  const { body, close } = panel;

  body.append(el("p", "sg-hint", "Edit the line, then Suggest. The author sees your version and accepts or rejects it."));
  const ta = el("textarea", "sg-input") as HTMLTextAreaElement;
  ta.rows = 3; ta.value = opts.current; ta.placeholder = "The rewritten line";
  body.append(ta);

  const submit = (): void => { const v = ta.value.trim(); if (!v || v === opts.current.trim()) { close(); return; } opts.onSubmit(v); close(); };
  ta.addEventListener("keydown", (e) => { if (e.key !== "Enter" || e.shiftKey) return; e.preventDefault(); submit(); });

  const actions = el("div", "cmt-actions");
  const go = el("button", "btn primary", "Suggest"); go.type = "button";
  go.addEventListener("click", submit);
  actions.append(go);
  body.append(actions);
  ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
}

export interface SuggestionRow {
  id: string;
  author: string;
  ts: string;
  /** What accepting would replace (the live say text - the baseline if unchanged, or the current line if drifted). */
  before: string;
  proposed: string;
  /** The line changed since this was suggested (a competing accept, or a manual edit). */
  stale: boolean;
  resolved?: boolean;
  outcome?: "accepted" | "rejected";
  /** Whether the text itself is part of the proposal (a speaker, direction, or cut suggestion may not be). */
  textChanged?: boolean;
  /** A proposed new speaker or direction (the editable-script handoff), shown from -> to. */
  speaker?: { from: string; to: string };
  direction?: { from: string; to: string };
  /** A proposal to cut the line (an editor emptied it). */
  cut?: boolean;
  /** The handoff it arrived in ("H-7Q2K"). */
  handoff?: string;
}

/** Review the beat's proposals: current -> proposed, Accept / Reject per row. */
export function openSuggestionReview(opts: {
  anchor: HTMLElement;
  rows: SuggestionRow[];
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onClose?: () => void;
}): void {
  const title = opts.rows.length > 1 ? `${opts.rows.length} suggestions` : opts.rows[0]?.cut ? "Suggested cut" : opts.rows[0]?.textChanged === false ? "Suggested change" : "Suggested rewrite";
  const panel = openPanel({ anchor: opts.anchor, className: "suggestion-popover", title, width: 340, onClose: opts.onClose });
  if (!panel) return;
  const { body, close } = panel;

  for (const r of opts.rows) {
    const card = el("div", `sg-card${r.resolved ? " resolved" : ""}`);
    const head = el("div", "sg-head");
    head.append(el("span", "sg-author", r.author || "Someone"), el("span", "sg-ts", fmtTs(r.ts)));
    if (r.handoff) head.append(el("span", "sg-source", `from ${r.handoff}`));
    if (r.resolved) head.append(el("span", "sg-outcome", r.outcome === "accepted" ? "Accepted" : "Rejected"));
    card.append(head);
    if (r.stale && !r.resolved) card.append(el("div", "sg-stale", "The line has changed since this was suggested. Review it against the current text."));
    if (r.cut) {
      card.append(el("div", "sg-diff-label", "Cut this line"), el("blockquote", "sg-before sg-cut", r.before || "(empty)"));
    } else if (r.textChanged !== false) {
      card.append(el("div", "sg-diff-label", "Current"), el("blockquote", "sg-before", r.before || "(empty)"));
      card.append(el("div", "sg-diff-label", "Proposed"), el("blockquote", "sg-after", r.proposed));
    }
    // From -> to, the arrow drawn rather than typed.
    const change = (from: string, to: string): HTMLElement => {
      const row = el("div", "sg-part");
      row.append(el("span", undefined, from), iconNode("arrowRight", 12), el("span", undefined, to));
      return row;
    };
    const paren = (d: string): string => (d ? `(${d})` : "(none)");
    if (r.speaker) card.append(el("div", "sg-diff-label", "Speaker"), change(r.speaker.from || "(none)", r.speaker.to));
    if (r.direction) card.append(el("div", "sg-diff-label", "Direction"), change(paren(r.direction.from), paren(r.direction.to)));

    if (!r.resolved) {
      const actions = el("div", "cmt-actions");
      const acc = el("button", "btn primary", "Accept"); acc.type = "button";
      acc.addEventListener("click", () => { opts.onAccept(r.id); close(); });
      const rej = el("button", "btn", "Reject"); rej.type = "button";
      rej.addEventListener("click", () => { opts.onReject(r.id); close(); });
      actions.append(acc, rej);
      card.append(actions);
    }
    body.append(card);
  }
}
