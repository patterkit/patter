// Scratch recording (#224): the in-app "record a quick take" flow. A full-window blocking overlay opens on
// a CUE screen - the line, its speaker, and a badge saying whether its existing take is missing, out of
// date, or up to date - from which you record, skip a line, hop to the next line that NEEDS a take, or
// finish (so a tidy-up sweep starts anywhere and visits only the lines that need work). Recording runs a
// 3·2·1 countdown (Esc cancels), captures the mic, and on Space finalises - decoding the take, trimming
// silence, stamping the line's text-hash, and encoding a 16-bit WAV that's handed to main to save into the
// scratch folder. The overlay STAYS UP while the take is processed (a progress bar), and on success offers
// to REPLAY it, RE-RECORD it, carry straight on to the NEXT line, or jump ahead to the next line needing a
// take. While it's up, keys other than the recording shortcuts are swallowed and the native menu is
// stripped, so nothing happens behind it. The audio codec lives in wav.ts (pure + tested); this file owns
// the UX + mic.

import { encodeScratchWav, textHash } from "./wav.js";
import { el } from "./dom.js";

/** A line to record: its beat id, say text, and speaker (for the on-screen cue). */
export interface ScratchLine { beatId: string; text: string; character?: string; }

/** The state of a line's existing take, shown as a badge on every recording opportunity: no take on disk,
 *  a take recorded against an earlier version of the line, or a take that still matches it. */
export type TakeState = "missing" | "stale" | "current";

export interface ScratchDeps {
  /** Save the encoded WAV into the scratch folder (lock-aware, in main). */
  saveScratch: (beatId: string, bytes: Uint8Array) => Promise<{ ok: boolean; error?: string }>;
  /** OS-level mic permission (macOS TCC): checked before opening the stream; may show the system prompt.
   *  False = the user denied it, so getUserMedia would "succeed" but capture silence. */
  micAccess: () => Promise<boolean>;
  /** Strip / restore the native menu around the recording (so accelerators can't fire behind the overlay). */
  setRecordingMode: (on: boolean) => void;
  /** Called after each take is saved (so the caller can refresh the folder index / play it). */
  onComplete?: (beatId: string) => void;
  /** The next line to offer after `beatId` (null = end of the run) - drives "carry on to the next line". */
  nextLine?: (beatId: string) => ScratchLine | null;
  /** The next line after `beatId` that still NEEDS a take (missing or out of date) - drives the tidy-up
   *  sweep ("Next needed"), which hops over lines whose takes are already up to date. */
  nextNeeded?: (beatId: string) => ScratchLine | null;
  /** The badge state of a line's existing take (against `text`, the version being shown). */
  takeState: (beatId: string, text: string) => TakeState;
}

/** What the author chose in the saved state. */
type SavedChoice = "next" | "needed" | "rerecord" | "finish";
/** Handlers the saved state wires to its buttons (replay stays in the saved state; the rest resolve). */
interface SavedActions { onReplay: () => void; onRerecord: () => void; onNext?: () => void; onNeeded?: () => void; onFinish: () => void; }

/** What the author chose on the cue screen (shown at the start of a run, before anything records). */
type CueChoice = "record" | "skip" | "needed" | "finish";
interface CueActions { onRecord: () => void; onSkip?: () => void; onNeeded?: () => void; onFinish: () => void; }

let recording = false;
/** True while a scratch recording overlay is up - callers can guard re-entry. */
export function isScratchRecording(): boolean { return recording; }

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A short sine beep for the countdown / start cues (its own short-lived AudioContext). */
function beep(freq: number, ms: number): void {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.frequency.value = freq; osc.connect(gain); gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    osc.start(); osc.stop(ctx.currentTime + ms / 1000);
    setTimeout(() => void ctx.close(), ms + 100);
  } catch { /* audio output unavailable - the visual cue is enough */ }
}

/** Play back an encoded WAV take (the saved-state "Replay"). Fire-and-forget. */
function playWav(bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
  const audio = new Audio(url);
  audio.onended = (): void => URL.revokeObjectURL(url);
  void audio.play().catch(() => URL.revokeObjectURL(url));
}

interface Overlay {
  root: HTMLElement;
  setLine(line: ScratchLine, state: TakeState): void;
  cue(hasNext: boolean, hasNeeded: boolean, actions: CueActions): void;
  count(n: string): void;
  recordingState(): void;
  processing(): void;
  saved(next: ScratchLine | null, nextState: TakeState | null, hasNeeded: boolean, actions: SavedActions): void;
  error(msg: string): void;
}

/** Badge copy per take state (styled by the matching scratch-badge-* class). */
const BADGE: Record<TakeState, string> = { missing: "no take yet", stale: "take out of date", current: "take up to date" };

/** Build the blocking overlay: the speaker + line being recorded, a big state area (countdown / REC /
 *  processing bar / saved), the saved-state action buttons, and the key hints. */
function buildOverlay(): Overlay {
  const root = el("div", "scratch-overlay");
  const card = el("div", "scratch-card");
  const cue = el("div", "scratch-cue");                 // the speaker, above the line
  const line = el("div", "scratch-line");
  const badge = el("div", "scratch-badge");             // the line's take state (missing / stale / current)
  const stage = el("div", "scratch-stage");
  const bar = el("div", "scratch-bar"); bar.append(el("div", "scratch-bar-fill")); bar.hidden = true; // processing
  const next = el("div", "scratch-next"); next.hidden = true;       // the next line, in the saved state
  const actions = el("div", "scratch-actions"); actions.hidden = true; // cue- + saved-state buttons
  const hint = el("div", "scratch-hint");
  card.append(cue, line, badge, stage, bar, next, actions, hint);
  root.append(card);
  const reset = (): void => { bar.hidden = true; next.hidden = true; actions.hidden = true; };
  const btn = (label: string, cls: string, fn: () => void): HTMLButtonElement => {
    const b = el("button", `scratch-btn ${cls}`.trim()) as HTMLButtonElement; b.type = "button"; b.textContent = label;
    b.addEventListener("click", fn);
    return b;
  };
  const setBadge = (into: HTMLElement, state: TakeState): void => { into.className = `scratch-badge scratch-badge-${state}`; into.textContent = BADGE[state]; };
  return {
    root,
    setLine(l: ScratchLine, state: TakeState): void {
      cue.textContent = l.character ?? ""; cue.hidden = !l.character;
      line.textContent = l.text || "(empty line)";
      setBadge(badge, state);
    },
    cue(hasNext: boolean, hasNeeded: boolean, a: CueActions): void {
      reset();
      stage.className = "scratch-stage scratch-ready"; stage.textContent = "Ready?";
      actions.hidden = false;
      actions.replaceChildren();
      actions.append(btn("● Record", "scratch-btn-primary", a.onRecord));
      if (hasNext && a.onSkip) actions.append(btn("Skip ▸", "", a.onSkip));
      if (hasNeeded && a.onNeeded) actions.append(btn("Next needed ▸▸", "", a.onNeeded));
      actions.append(btn("Finish", "", a.onFinish));
      hint.textContent = "Space / Enter: record  ·  Esc: finish";
    },
    count(n: string): void { reset(); stage.className = "scratch-stage scratch-count"; stage.textContent = n; hint.textContent = "Get ready…  ·  Esc to cancel"; },
    recordingState(): void { reset(); stage.className = "scratch-stage scratch-rec"; stage.textContent = "● REC"; hint.textContent = "Speak the line  ·  Space to finish  ·  Esc to cancel"; },
    processing(): void { reset(); bar.hidden = false; stage.className = "scratch-stage scratch-processing"; stage.textContent = "Saving…"; hint.textContent = ""; },
    saved(nextLine: ScratchLine | null, nextState: TakeState | null, hasNeeded: boolean, a: SavedActions): void {
      reset();
      stage.className = "scratch-stage scratch-saved"; stage.textContent = "Saved ✓";
      if (nextLine) {
        next.hidden = false;
        const nextBadge = el("span", "scratch-badge");
        if (nextState) setBadge(nextBadge, nextState);
        next.replaceChildren(el("span", "scratch-next-label", "Next line"), el("span", "scratch-next-cue", nextLine.character ?? ""), el("span", "scratch-next-text", nextLine.text || "(empty line)"), nextBadge);
      }
      actions.hidden = false;
      actions.replaceChildren();
      actions.append(btn("▶ Replay", "", a.onReplay), btn("● Re-record", "", a.onRerecord));
      if (a.onNext) actions.append(btn("Record next ▸", "scratch-btn-primary", a.onNext));
      if (a.onNeeded) actions.append(btn("Next needed ▸▸", "", a.onNeeded));
      actions.append(btn("Finish", "", a.onFinish));
      hint.textContent = nextLine ? "Space / Enter: record next  ·  Esc: finish" : "Enter / Esc: finish";
    },
    error(msg: string): void { reset(); stage.className = "scratch-stage scratch-error"; stage.textContent = msg; hint.textContent = ""; },
  };
}

/** Record ONE take for `line` on the shared `stream`: countdown, capture, and (on Space) encode + save.
 *  Returns the saved WAV bytes, or cancelled (Esc) / errored (the overlay shows the error briefly). */
async function recordOne(line: ScratchLine, stream: MediaStream, overlay: Overlay, deps: ScratchDeps): Promise<{ status: "saved"; wav: Uint8Array } | { status: "cancelled" | "error" }> {
  overlay.setLine(line, deps.takeState(line.beatId, line.text));

  // Countdown (Esc cancels).
  let cancelled = false;
  const escWatch = (e: KeyboardEvent): void => { if (e.key === "Escape") cancelled = true; };
  document.addEventListener("keydown", escWatch, true);
  for (const n of ["3", "2", "1"]) {
    if (cancelled) break;
    overlay.count(n); beep(880, 90);
    await wait(800);
  }
  document.removeEventListener("keydown", escWatch, true);
  if (cancelled) return { status: "cancelled" };

  // Record until Space (complete) or Esc (cancel).
  overlay.recordingState();
  beep(440, 180);
  const rec = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e): void => { if (e.data.size) chunks.push(e.data); };
  rec.start();
  const outcome = await new Promise<"complete" | "cancel">((resolve) => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === " ") { e.preventDefault(); document.removeEventListener("keydown", onKey, true); resolve("complete"); }
      else if (e.key === "Escape") { e.preventDefault(); document.removeEventListener("keydown", onKey, true); resolve("cancel"); }
    };
    document.addEventListener("keydown", onKey, true);
  });
  await new Promise<void>((resolve) => { rec.onstop = (): void => resolve(); rec.stop(); });
  if (outcome === "cancel" || chunks.length === 0) return { status: "cancelled" };

  // Decode -> PCM channels -> trimmed, hash-stamped WAV -> save. The overlay stays up (progress bar).
  overlay.processing();
  try {
    const blob = new Blob(chunks, { type: chunks[0]?.type || "audio/webm" });
    const ctx = new AudioContext();
    const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
    await ctx.close();
    const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
    const wav = encodeScratchWav(channels, audio.sampleRate, textHash(line.text));
    const res = await deps.saveScratch(line.beatId, wav);
    if (res.ok) return { status: "saved", wav };
    console.error("scratch save failed:", res.error);
    overlay.error("Save failed"); await wait(1600); return { status: "error" };
  } catch (e) {
    console.error("scratch encode/save failed:", e);
    overlay.error("Recording failed"); await wait(1600); return { status: "error" };
  }
}

/** Show the saved state and wait for a choice: Replay the take (stays here), Re-record this line, carry on
 *  to `next`, jump to the next line that still NEEDS a take, or Finish. Space / Enter records next (or
 *  finishes if there is none); Esc finishes. `needed` is offered only when it's a different line than
 *  `next` (when the very next line needs a take, "Record next" already IS the tidy-up path). */
function promptNext(overlay: Overlay, next: ScratchLine | null, needed: ScratchLine | null, nextState: TakeState | null, wav: Uint8Array): Promise<SavedChoice> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: SavedChoice): void => { if (done) return; done = true; document.removeEventListener("keydown", onKey, true); resolve(v); };
    const offerNeeded = !!needed && needed.beatId !== next?.beatId;
    overlay.saved(next, nextState, offerNeeded, {
      onReplay: () => playWav(wav),
      onRerecord: () => finish("rerecord"),
      onNext: next ? () => finish("next") : undefined,
      onNeeded: offerNeeded ? () => finish("needed") : undefined,
      onFinish: () => finish("finish"),
    });
    const onKey = (e: KeyboardEvent): void => {
      if (next && (e.key === " " || e.key === "Enter")) { e.preventDefault(); e.stopImmediatePropagation(); finish("next"); }
      else if (e.key === "Escape" || e.key === "Enter") { e.preventDefault(); e.stopImmediatePropagation(); finish("finish"); }
    };
    document.addEventListener("keydown", onKey, true);
  });
}

/** Show the cue screen for `line` (its speaker, text, and take-state badge) and wait for a choice: record
 *  it, skip to the next line, jump to the next line that still needs a take, or finish. Shown at the start
 *  of a run so a tidy-up sweep can hop straight past lines that are already covered. */
function promptCue(overlay: Overlay, line: ScratchLine, deps: ScratchDeps): Promise<CueChoice> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: CueChoice): void => { if (done) return; done = true; document.removeEventListener("keydown", onKey, true); resolve(v); };
    overlay.setLine(line, deps.takeState(line.beatId, line.text));
    const next = deps.nextLine?.(line.beatId) ?? null;
    const needed = deps.nextNeeded?.(line.beatId) ?? null;
    const offerNeeded = !!needed && needed.beatId !== next?.beatId;
    overlay.cue(!!next, offerNeeded, {
      onRecord: () => finish("record"),
      onSkip: next ? () => finish("skip") : undefined,
      onNeeded: offerNeeded ? () => finish("needed") : undefined,
      onFinish: () => finish("finish"),
    });
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); e.stopImmediatePropagation(); finish("record"); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); finish("finish"); }
    };
    document.addEventListener("keydown", onKey, true);
  });
}

/**
 * Record scratch takes starting at `start`, offering (after each save) to replay, re-record, or carry on to
 * the next line. Opens the blocking overlay, acquires the mic once, and loops until the author finishes or
 * cancels. Resolves once everything is torn down. A no-op if a recording is already in progress.
 */
export async function recordScratch(start: ScratchLine, deps: ScratchDeps): Promise<void> {
  if (recording) return;
  recording = true;
  deps.setRecordingMode(true);
  const overlay = buildOverlay();
  document.body.appendChild(overlay.root);

  // Swallow every key but the recording shortcuts (Esc / Space / Enter) while the overlay is up (capture
  // phase, before the editor sees them). Replay / Re-record are mouse-driven buttons, so they need no keys.
  const blocker = (e: KeyboardEvent): void => {
    if (e.key !== "Escape" && e.key !== " " && e.key !== "Enter") { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); }
  };
  document.addEventListener("keydown", blocker, true);

  let stream: MediaStream | null = null;
  const cleanup = (): void => {
    recording = false;
    document.removeEventListener("keydown", blocker, true);
    overlay.root.remove();
    stream?.getTracks().forEach((t) => t.stop());
    deps.setRecordingMode(false);
  };

  // Acquire the mic once, up front - reused across every take in the run. The OS permission comes first:
  // on macOS a missing TCC grant does NOT fail getUserMedia, it hands over a silent stream.
  overlay.setLine(start, deps.takeState(start.beatId, start.text));
  if (!(await deps.micAccess())) {
    overlay.error("Microphone access denied. Allow Patterpad in System Settings › Privacy & Security › Microphone.");
    await wait(3200); cleanup(); return;
  }
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch { overlay.error("Microphone unavailable"); await wait(1600); cleanup(); return; }

  // Cue phase: show the start line + its badge and let the author move to where recording should begin
  // (skip line by line, or hop to the next line that needs a take) BEFORE anything records - a tidy-up
  // sweep starts wherever you clicked, not necessarily on a line that needs work.
  let current: ScratchLine = start;
  for (;;) {
    const choice = await promptCue(overlay, current, deps);
    if (choice === "record") break;
    const to = choice === "skip" ? deps.nextLine?.(current.beatId) : choice === "needed" ? deps.nextNeeded?.(current.beatId) : null;
    if (!to) { cleanup(); return; } // finish, or ran out of lines
    current = to;
  }

  for (;;) {
    const result = await recordOne(current, stream, overlay, deps);
    if (result.status !== "saved") break; // cancelled or errored -> stop the run
    deps.onComplete?.(current.beatId);
    overlay.setLine(current, "current"); // the take we JUST saved is by definition up to date
    const next = deps.nextLine?.(current.beatId) ?? null;
    const needed = deps.nextNeeded?.(current.beatId) ?? null;
    const choice = await promptNext(overlay, next, needed, next ? deps.takeState(next.beatId, next.text) : null, result.wav);
    if (choice === "rerecord") continue;          // record the SAME line again
    if (choice === "next" && next) { current = next; continue; }     // on to the next line
    if (choice === "needed" && needed) { current = needed; continue; } // hop to the next line needing a take
    break;                                        // finish
  }
  cleanup();
}
