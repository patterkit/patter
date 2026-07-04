// The "suggest a rewrite" popovers (review flow, design/proposals/suggest-rewrite.md): anchored panels
// (share openAnchoredPanel with the comment / condition editors). TWO entry points:
//   - COMPOSE: a textarea prefilled with the beat's current say text; the reviewer edits it and submits a
//     proposal (Enter submits + closes, Shift+Enter newline - matching the comment composer).
//   - REVIEW: the beat's open proposals, each showing current -> proposed (re-diffed against the live text;
//     a stale proposal - the line changed since it was made - is banner-flagged), with Accept / Reject.

import { el, openAnchoredPanel } from "./dom.js";

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
  const panel = openAnchoredPanel({ anchor: opts.anchor, className: "cond-editor suggestion-popover", title: "Suggest a rewrite", width: 340, onClose: opts.onClose });
  if (!panel) return; // re-click on the same anchor toggled it off
  const { body, close } = panel;

  body.append(el("p", "sg-hint", "Edit the line, then Suggest. The author sees your version and accepts or rejects it."));
  const ta = el("textarea", "sg-input") as HTMLTextAreaElement;
  ta.rows = 3; ta.value = opts.current; ta.placeholder = "<the rewritten line>";
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
}

/** Review the beat's proposals: current -> proposed, Accept / Reject per row. */
export function openSuggestionReview(opts: {
  anchor: HTMLElement;
  rows: SuggestionRow[];
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onClose?: () => void;
}): void {
  const panel = openAnchoredPanel({ anchor: opts.anchor, className: "cond-editor suggestion-popover", title: opts.rows.length > 1 ? `${opts.rows.length} suggested rewrites` : "Suggested rewrite", width: 340, onClose: opts.onClose });
  if (!panel) return;
  const { body, close } = panel;

  for (const r of opts.rows) {
    const card = el("div", `sg-card${r.resolved ? " resolved" : ""}`);
    const head = el("div", "sg-head");
    head.append(el("span", "sg-author", r.author || "Someone"), el("span", "sg-ts", fmtTs(r.ts)));
    if (r.resolved) head.append(el("span", "sg-outcome", r.outcome === "accepted" ? "accepted" : "rejected"));
    card.append(head);
    if (r.stale && !r.resolved) card.append(el("div", "sg-stale", "The line changed since this was suggested - review against the current text."));
    card.append(el("div", "sg-diff-label", "Current"), el("blockquote", "sg-before", r.before || "(empty)"));
    card.append(el("div", "sg-diff-label", "Proposed"), el("blockquote", "sg-after", r.proposed));

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
