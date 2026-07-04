// The threaded-comment popover (#148): an anchored panel (shares openAnchoredPanel with the condition /
// jump editors) showing one thread - each message with author + timestamp, Word/Docs style - plus a
// composer to reply, and Mark complete / Reopen. The host owns the data: the callbacks mutate the passed
// `thread` in place (push a message, flip resolved) + persist; the popover re-renders from it.

import { el, openAnchoredPanel } from "./dom.js";
import type { Comment } from "../../shared/api.js";

const fmtTs = (ts: string): string => {
  try { return new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); }
  catch { return ts; }
};

export function openCommentThread(opts: {
  anchor: HTMLElement;
  /** The live thread (may have zero messages: a brand-new thread not yet saved). Mutated by the callbacks. */
  thread: Comment;
  /** Author name stamped on a new message (from the first-run identity). */
  me: string;
  /** Append a message authored by `me` now; the host pushes it into `thread.messages` + persists. */
  onPost: (body: string) => void;
  /** Mark the thread complete (archived): host sets `thread.resolved = true` + persists. */
  onResolve: () => void;
  /** Reopen a resolved thread: host clears `thread.resolved` + persists. */
  onReopen: () => void;
  onClose?: () => void;
}): void {
  const panel = openAnchoredPanel({ anchor: opts.anchor, className: "cond-editor comments-popover", title: "Comments", width: 300, onClose: opts.onClose });
  if (!panel) return; // re-click on the same anchor toggled it off
  const { body, close } = panel;

  const render = (): void => {
    body.replaceChildren();
    const t = opts.thread;

    // A range thread shows the quoted span it's pinned to, so the comment has visible context.
    if (t.range?.quote) body.append(el("blockquote", "cmt-quote", t.range.quote));

    const list = el("div", "cmt-list");
    for (const m of t.messages) {
      const item = el("div", "cmt-msg");
      const head = el("div", "cmt-msg-head");
      head.append(el("span", "cmt-author", m.author || "Someone"), el("span", "cmt-ts", fmtTs(m.ts)));
      item.append(head, el("div", "cmt-body", m.body));
      list.append(item);
    }
    if (t.resolved) list.classList.add("resolved");
    if (t.messages.length) body.append(list); // a brand-new thread shows just the composer, no empty-state line

    const ta = el("textarea", "cmt-input");
    ta.rows = 2;
    ta.placeholder = t.messages.length ? "<reply…>" : "<comment…>";
    // Enter submits AND closes the thread; Shift+Enter inserts a newline for a multi-line comment.
    ta.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.shiftKey) return;
      e.preventDefault();
      const v = ta.value.trim(); if (!v) return;
      opts.onPost(v); close();
    });
    body.append(ta);

    const actions = el("div", "cmt-actions");
    const post = el("button", "btn primary", t.messages.length ? "Reply" : "Comment");
    post.type = "button";
    post.addEventListener("click", () => { const v = ta.value.trim(); if (!v) return; opts.onPost(v); render(); });
    actions.append(post);

    if (t.messages.length) {
      if (t.resolved) {
        const re = el("button", "btn", "Reopen"); re.type = "button";
        re.addEventListener("click", () => { opts.onReopen(); render(); });
        actions.append(re);
      } else {
        const done = el("button", "btn", "Mark complete"); done.type = "button";
        done.addEventListener("click", () => { opts.onResolve(); close(); }); // resolved threads hide
        actions.append(done);
      }
    }
    body.append(actions);
    // Focus the composer only for a brand-new thread; opening an existing thread (to read) must not yank
    // focus out of the script when it was reached by clicking the highlighted text.
    if (!t.messages.length) ta.focus();
  };
  render();
}
