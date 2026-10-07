// ---------------------------------------------------------------------------
// One way to read a write's answer, and one voice to say a refusal in.
//
// Main answers every write with `{ ok, error? }`. Most callers used to log the error to the console
// and carry on, so a write version control refused (a lock, a file out of date) failed in silence: a
// Project Settings save closed its dialog and lost the edits with no word. Storyletter reads every
// answer through its `ok()`, which toasts; this is Patterpad's.
// ---------------------------------------------------------------------------

import { toast } from "@wildwinter/app-shell";

/** Main's error as a sentence: a capital first and a full stop last, since it often arrives as a fragment. */
function sentence(error: string | undefined): string {
  const t = (error ?? "").trim();
  if (!t) return "Try again, and check the file isn't locked in version control.";
  const s = t[0]!.toUpperCase() + t.slice(1);
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

/** Did the write land? Toasts `what` (what could not be done, e.g. "Couldn't save the notes") with
 *  main's reason underneath, and answers false, if not. */
export function landed(res: { ok: boolean; error?: string }, what: string): boolean {
  if (res.ok) return true;
  toast(`${what}\n${sentence(res.error)}`, "error");
  return false;
}
