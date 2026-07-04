// Scratch recording (#224): the in-app "record a quick take" flow. A full-window blocking overlay runs a
// 3·2·1 countdown (Esc cancels), captures the mic, and on Space finalises - decoding the take, trimming
// silence, stamping the line's text-hash, and encoding a 16-bit WAV that's handed to main to save into the
// scratch folder. The overlay STAYS UP while the take is processed (a progress bar), and on success offers
// to REPLAY it, RE-RECORD it, or carry straight on to the NEXT line - so you can work through a run without
// leaving. While it's up, keys other than the recording shortcuts are swallowed and the native menu is
// stripped, so nothing happens behind it. The audio codec lives in wav.ts (pure + tested); this file owns
// the UX + mic.

import { encodeScratchWav, textHash } from "./wav.js";
import { el } from "./dom.js";

/** A line to record: its beat id, say text, and speaker (for the on-screen cue). */
export interface ScratchLine { beatId: string; text: string; character?: string; }

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
}

/** What the author chose in the saved state. */
type SavedChoice = "next" | "rerecord" | "finish";
/** Handlers the saved state wires to its buttons (replay stays in the saved state; the rest resolve). */
interface SavedActions { onReplay: () => void; onRerecord: () => void; onNext?: () => void; onFinish: () => void; }

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
  setLine(line: ScratchLine): void;
  count(n: string): void;
  recordingState(): void;
  processing(): void;
  saved(next: ScratchLine | null, actions: SavedActions): void;
  error(msg: string): void;
}

/** Build the blocking overlay: the speaker + line being recorded, a big state area (countdown / REC /
 *  processing bar / saved), the saved-state action buttons, and the key hints. */
function buildOverlay(): Overlay {
  const root = el("div", "scratch-overlay");
  const card = el("div", "scratch-card");
  const cue = el("div", "scratch-cue");                 // the speaker, above the line
  const line = el("div", "scratch-line");
  const stage = el("div", "scratch-stage");
  const bar = el("div", "scratch-bar"); bar.append(el("div", "scratch-bar-fill")); bar.hidden = true; // processing
  const next = el("div", "scratch-next"); next.hidden = true;       // the next line, in the saved state
  const actions = el("div", "scratch-actions"); actions.hidden = true; // saved-state buttons
  const hint = el("div", "scratch-hint");
  card.append(cue, line, stage, bar, next, actions, hint);
  root.append(card);
  const reset = (): void => { bar.hidden = true; next.hidden = true; actions.hidden = true; };
  const btn = (label: string, cls: string, fn: () => void): HTMLButtonElement => {
    const b = el("button", `scratch-btn ${cls}`.trim()) as HTMLButtonElement; b.type = "button"; b.textContent = label;
    b.addEventListener("click", fn);
    return b;
  };
  return {
    root,
    setLine(l: ScratchLine): void { cue.textContent = l.character ?? ""; cue.hidden = !l.character; line.textContent = l.text || "(empty line)"; },
    count(n: string): void { reset(); stage.className = "scratch-stage scratch-count"; stage.textContent = n; hint.textContent = "Get ready…  ·  Esc to cancel"; },
    recordingState(): void { reset(); stage.className = "scratch-stage scratch-rec"; stage.textContent = "● REC"; hint.textContent = "Speak the line  ·  Space to finish  ·  Esc to cancel"; },
    processing(): void { reset(); bar.hidden = false; stage.className = "scratch-stage scratch-processing"; stage.textContent = "Saving…"; hint.textContent = ""; },
    saved(nextLine: ScratchLine | null, a: SavedActions): void {
      reset();
      stage.className = "scratch-stage scratch-saved"; stage.textContent = "Saved ✓";
      if (nextLine) {
        next.hidden = false;
        next.replaceChildren(el("span", "scratch-next-label", "Next line"), el("span", "scratch-next-cue", nextLine.character ?? ""), el("span", "scratch-next-text", nextLine.text || "(empty line)"));
      }
      actions.hidden = false;
      actions.replaceChildren();
      actions.append(btn("▶ Replay", "", a.onReplay), btn("● Re-record", "", a.onRerecord));
      if (a.onNext) actions.append(btn("Record next ▸", "scratch-btn-primary", a.onNext));
      actions.append(btn("Finish", "", a.onFinish));
      hint.textContent = nextLine ? "Space / Enter: record next  ·  Esc: finish" : "Enter / Esc: finish";
    },
    error(msg: string): void { reset(); stage.className = "scratch-stage scratch-error"; stage.textContent = msg; hint.textContent = ""; },
  };
}

/** Record ONE take for `line` on the shared `stream`: countdown, capture, and (on Space) encode + save.
 *  Returns the saved WAV bytes, or cancelled (Esc) / errored (the overlay shows the error briefly). */
async function recordOne(line: ScratchLine, stream: MediaStream, overlay: Overlay, deps: ScratchDeps): Promise<{ status: "saved"; wav: Uint8Array } | { status: "cancelled" | "error" }> {
  overlay.setLine(line);

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
 *  to `next`, or Finish. Space / Enter records next (or finishes if there is none); Esc finishes. */
function promptNext(overlay: Overlay, next: ScratchLine | null, wav: Uint8Array): Promise<SavedChoice> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: SavedChoice): void => { if (done) return; done = true; document.removeEventListener("keydown", onKey, true); resolve(v); };
    overlay.saved(next, {
      onReplay: () => playWav(wav),
      onRerecord: () => finish("rerecord"),
      onNext: next ? () => finish("next") : undefined,
      onFinish: () => finish("finish"),
    });
    const onKey = (e: KeyboardEvent): void => {
      if (next && (e.key === " " || e.key === "Enter")) { e.preventDefault(); e.stopImmediatePropagation(); finish("next"); }
      else if (e.key === "Escape" || e.key === "Enter") { e.preventDefault(); e.stopImmediatePropagation(); finish("finish"); }
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
  overlay.setLine(start);
  if (!(await deps.micAccess())) {
    overlay.error("Microphone access denied. Allow Patterpad in System Settings › Privacy & Security › Microphone.");
    await wait(3200); cleanup(); return;
  }
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch { overlay.error("Microphone unavailable"); await wait(1600); cleanup(); return; }

  let current: ScratchLine = start;
  for (;;) {
    const result = await recordOne(current, stream, overlay, deps);
    if (result.status !== "saved") break; // cancelled or errored -> stop the run
    deps.onComplete?.(current.beatId);
    const next = deps.nextLine?.(current.beatId) ?? null;
    const choice = await promptNext(overlay, next, result.wav);
    if (choice === "rerecord") continue;         // record the SAME line again
    if (choice === "next" && next) { current = next; continue; } // on to the next line
    break;                                        // finish
  }
  cleanup();
}
