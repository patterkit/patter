// The play WINDOW renderer. A separate window that walks the script interactively over the runtime
// (the main process holds the Engine; this window drives it via window.patterPlay). You drive the
// walk with two buttons - **Step** (one beat) and **Continue** (advance to the next choice / end) -
// and as each beat plays it tells the EDITOR window to move the playhead, leaving a visited trail.
// Choices are buttons; the trail + playhead reset on a fresh run.

import "@patterkit/patterpad-surface/theme.css"; // app-wide design tokens (same look as the editor)
import "./play.css";
import "@fontsource/newsreader/400.css";
import "@fontsource/newsreader/400-italic.css";
import "@fontsource/newsreader/600.css";
import "@fontsource-variable/inter";

import { colourFor } from "@patterkit/patterpad-surface/colour";
import type { PlayBatch, PlayChoiceOption, PlayStep } from "../../shared/api.js";

const play = window.patterPlay!;
const transcriptEl = document.getElementById("transcript")!;
const controlsEl = document.getElementById("choices")!;
const pinEl = document.getElementById("play-pin") as HTMLButtonElement;
const addrEl = document.getElementById("play-addr")!;
const localeEl = document.getElementById("play-locale") as HTMLSelectElement;
const rewindEl = document.getElementById("play-rewind") as HTMLButtonElement;
const continueEl = document.getElementById("play-continue") as HTMLButtonElement;
const audioEl = document.getElementById("play-audio") as HTMLButtonElement;

// "Play with audio" (#206 P3): in Audio Folders mode, Continue becomes a time-paced table-read - each line
// plays its clip and the next beat waits for it to finish; a line with no file (or a text beat) is faked at
// ~150 wpm proportional to its length. Step stays manual: it just fires the clip without pacing. The toggle
// is remembered across runs, and only shown when the project is in folder mode.
let audioAvailable = false;
// Default ON when audio is available: a voiced project plays its table-read by default. `!== "0"` keeps it on
// for a fresh project (no stored value) while still honouring an explicit off the author chose before.
let audioOn = localStorage.getItem("patter.playAudio") !== "0";
// Continue mode (a persistent header toggle): when on, advancing runs to the next natural stop (a choice or
// the end) as a paced reveal instead of one beat at a time. It lives in the header rather than beside Step
// because in Continue mode the per-beat Step row never appears (we run straight to the next choice), so an
// inline checkbox would be unreachable once ticked. Remembered across runs; like audio above, it defaults
// ON for a fresh install (no stored value) while still honouring an explicit off.
let continueMode = localStorage.getItem("patter.playContinue") !== "0";
let runGen = 0; // bumped on start / restart / stale so a paced read bails the moment it's superseded
// Stop / pause a paced run: `stopRequested` halts the reveal at the CURRENT line (the un-played rest waits
// behind a resume control - it never rushes ahead); `skipFire` cuts short the current beat's delay; `stopClip`
// stops + unblocks its sounding clip. `resumeState` remembers where a paused reveal left off.
let stopRequested = false;
let skipFire: (() => void) | null = null;
let stopClip: (() => void) | null = null;
let resumeState: { batch: PlayBatch; gen: number; nextIdx: number } | null = null;

function setAudio(on: boolean): void {
  audioOn = on;
  localStorage.setItem("patter.playAudio", on ? "1" : "0");
  audioEl.setAttribute("aria-pressed", String(on));
  audioEl.classList.toggle("on", on);
}
audioEl.addEventListener("click", () => setAudio(!audioOn));

function setContinue(on: boolean): void {
  continueMode = on;
  localStorage.setItem("patter.playContinue", on ? "1" : "0");
  continueEl.setAttribute("aria-pressed", String(on));
  continueEl.classList.toggle("on", on);
  // Turning Continue OFF while a paced run is in flight (the Stop control is up) pauses it at the current
  // line - otherwise the reveal keeps auto-advancing, ignoring the toggle. If we're paused mid-reveal, or on
  // an idle Step row, re-label the control to the new mode instead.
  if (!on && controlsEl.querySelector(".play-stop")) { stopRequested = true; skipFire?.(); stopClip?.(); }
  else if (controlsEl.querySelector(".presume") && resumeState) showResume(resumeState.batch, resumeState.gen, resumeState.nextIdx);
  else if (controlsEl.querySelector(".padv-row")) showAdvance();
}
continueEl.setAttribute("aria-pressed", String(continueMode));
continueEl.classList.toggle("on", continueMode);
continueEl.addEventListener("click", () => setContinue(!continueMode));

// Closed-captions toggle (#214): default ON (cues shown). Flipping it applies LIVE to the running engine -
// it does NOT restart the run (that lost your place and made the change hard to compare). Lines already in
// the transcript stay as they were; everything from here on reflects the new setting.
const ccEl = document.getElementById("play-cc") as HTMLButtonElement;
let captionsOn = true;
function reflectCaptions(on: boolean): void {
  captionsOn = on;
  ccEl.setAttribute("aria-pressed", String(on));
  ccEl.classList.toggle("off", !on);
  ccEl.title = on ? "Closed captions on: non-spoken cues shown. Click to hide them." : "Closed captions off: non-spoken cues hidden. Click to show them.";
}
ccEl.addEventListener("click", () => { reflectCaptions(!captionsOn); void play.setClosedCaptions(captionsOn); });


// Reading speed: how long a beat is held in a paced reveal before the next appears. Sets the words/min
// pace of the faked (non-audio) delay; "instant" drops it. A voiced line still plays to the end of its
// clip regardless. Persisted; the dropdown lives in the top bar (#196-style control).
const SPEED_WPM: Record<string, number> = { slow: 300, normal: 500, fast: 800, instant: 0 };
let speedKey = localStorage.getItem("patter.playSpeed") ?? "normal";
if (SPEED_WPM[speedKey] === undefined) speedKey = "normal";
const speedEl = document.getElementById("play-speed") as HTMLSelectElement | null;
function setSpeed(key: string): void {
  speedKey = SPEED_WPM[key] === undefined ? "normal" : key;
  localStorage.setItem("patter.playSpeed", speedKey);
  if (speedEl) speedEl.value = speedKey;
}
if (speedEl) { setSpeed(speedKey); speedEl.addEventListener("change", () => setSpeed(speedEl.value)); }

function fakeDuration(text: string | undefined): number {
  const wpm = SPEED_WPM[speedKey] ?? 300;
  if (wpm === 0) return 0; // "instant" - no reading delay (a voiced line, when audio is on, still plays out)
  const words = (text ?? "").trim().split(/\s+/).filter(Boolean).length;
  return Math.max(450, Math.round((words / wpm) * 60000)); // a beat needs to land
}
/** Play a beat's audio clip and resolve when it ends; false (immediately) if there's no file for it. While
 *  it plays, `lineEl` (the transcript line) pulses via `.pline-playing` so it's clear which line is sounding. */
async function playClip(beatId: string, lineEl?: HTMLElement): Promise<boolean> {
  const data = await play.audioBytes(beatId);
  if (!data) return false;
  const url = URL.createObjectURL(new Blob([data.bytes], { type: data.mime }));
  const audio = new Audio(url);
  lineEl?.classList.add("pline-playing");
  await audio.play().catch(() => undefined);
  // Resolve when the clip ends or errors. Stop interrupts via an EXPLICIT resolver (`stopClip`), not the
  // 'pause' event - a stray pause on this or a later clip must never cut a playing line short.
  let resolveWait: () => void = () => {};
  const wait = new Promise<void>((res) => { resolveWait = res; });
  audio.onended = () => resolveWait();
  audio.onerror = () => resolveWait();
  const myStop = (): void => { audio.pause(); resolveWait(); };
  stopClip = myStop;
  await wait;
  if (stopClip === myStop) stopClip = null;
  URL.revokeObjectURL(url);
  lineEl?.classList.remove("pline-playing");
  return true;
}
/** A delay that resolves after `ms` OR when Stop cuts it short (via `skipFire`), so a long paced reveal can
 *  be interrupted mid-beat. Only one is ever in flight at a time. */
function raceDelay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    skipFire = () => { clearTimeout(t); resolve(); };
  });
}
/** A breathing gap after a voiced line's clip so the next line doesn't tread on its tail. */
const AUDIO_GAP_MS = 600;
/** Pace one beat in a paced reveal: a voiced line (audio on + a clip exists) holds for its own duration
 *  plus a short gap; everything else - text, a missing clip, or audio off entirely - waits out a
 *  reading-length delay so the beat still lands before the next one appears. */
async function paceBeat(step: PlayStep, lineEl?: HTMLElement): Promise<void> {
  if (audioOn && step.kind === "line" && await playClip(step.id, lineEl)) { if (!stopRequested) await raceDelay(AUDIO_GAP_MS); return; }
  if (SPEED_WPM[speedKey] === 0) return; // "instant": no faked delay
  await raceDelay(step.kind === "gameEvent" ? 350 : fakeDuration(step.text));
}

function button(label: string, cls: string, onClick?: () => void): HTMLButtonElement {
  const b = document.createElement("button"); b.type = "button"; b.className = cls; b.textContent = label;
  if (onClick) b.addEventListener("click", onClick);
  return b;
}

// Patter's closed formatting vocabulary (<b>/<i>/<bi>); the game would translate it for its own
// renderer, and here - an HTML surface - we render it to <strong>/<em>. Literal segments become text
// nodes, so a bare & / < / > shows as itself (no innerHTML, nothing to entity-escape).
const MARKUP = /<(b|i|bi)>([\s\S]*?)<\/\1>/g;
function renderMarkup(parent: HTMLElement, text: string): void {
  const lit = (s: string): void => { if (s) parent.appendChild(document.createTextNode(s)); };
  let last = 0; let m: RegExpExecArray | null; MARKUP.lastIndex = 0;
  while ((m = MARKUP.exec(text)) !== null) {
    if (m.index > last) lit(text.slice(last, m.index));
    const tag = m[1]!, inner = m[2]!;
    const el = document.createElement(tag === "i" ? "em" : "strong");
    if (tag === "bi") { const em = document.createElement("em"); em.textContent = inner; el.appendChild(em); }
    else el.textContent = inner;
    parent.appendChild(el);
    last = MARKUP.lastIndex;
  }
  lit(text.slice(last));
}

function appendStep(step: PlayStep): HTMLElement {
  const div = document.createElement("div");
  div.className = `pline ${step.kind}`;
  if (step.kind === "line") {
    // Show the localised display name when the character has one; fall back to the canonical token.
    const cue = document.createElement("span"); cue.className = "pcue"; cue.textContent = step.characterName ?? step.character ?? "";
    // Tint the cue by the SAME hash-selected palette slot the editor uses (#196 colour-by-character), so the
    // cast scans by colour here too. Key off the canonical token, never the localised name, so the slot is
    // stable across locales. Empty/narrator keeps the CSS --accent default.
    if (step.character) cue.style.color = colourFor(step.character);
    const body = document.createElement("span");
    if (step.direction) { const d = document.createElement("em"); d.className = "pdir"; d.textContent = `(${step.direction}) `; body.appendChild(d); }
    renderMarkup(body, step.text ?? "");
    div.append(cue, body);
  } else if (step.kind === "text") {
    renderMarkup(div, step.text ?? "");
  } else {
    div.textContent = "⚙ game event";
  }
  transcriptEl.appendChild(div);
  return div;
}

// Jump the transcript to its end so the most recent line sits just above the choice prompts. Called AFTER
// the controls render into the footer below: reading scrollHeight forces a synchronous layout that already
// accounts for the footer shrinking the transcript's viewport, so the jump lands at the true bottom (not
// the taller pre-tray height, which would hide the last line behind the tray). Synchronous and instant on
// purpose - rAF / smooth scrolling is throttled when the window isn't painting and would leave it un-applied,
// and correctness (the last line MUST be in view) can't ride on an animation that a relayout can cancel.
function scrollToEnd(): void {
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

/** The Stop control shown during a paced reveal: pauses the run at the current line (stopping its sounding
 *  clip / delay). The un-played beats stay queued behind a resume control (showResume) - it does NOT rush
 *  ahead through the rest. */
function showStop(): void {
  controlsEl.replaceChildren(button("◼ Stop", "play-stop", () => { stopRequested = true; skipFire?.(); stopClip?.(); }));
}

function showAdvance(): void {
  trayShown = false;
  const row = document.createElement("div"); row.className = "padv-row";
  // Step's behaviour follows the header Continue toggle: off = one beat; on = run to the next natural stop (a
  // choice or the end) as a paced reveal - each beat held for its audio or a reading-length delay.
  const step = button(continueMode ? "▸▸ Continue to next stop" : "▸ Step", "padv", () =>
    void advance(continueMode ? play.toStop() : play.step(), continueMode));
  row.append(step);
  controlsEl.replaceChildren(row);
}

function showChoices(options: PlayChoiceOption[]): void {
  if (options.length === 0) { showEnd(); return; }
  trayShown = true; // a live structural refresh re-syncs a shown tray (options may have changed)
  controlsEl.replaceChildren();
  options.forEach((o, i) => {
    const label = `${o.character ? `${o.character}: ` : ""}${o.text || "(choice)"}`;
    const b = button(label, `pchoice${o.eligible ? "" : " ineligible"}`, o.eligible ? () => void chooseThen(o.id) : undefined);
    b.disabled = !o.eligible;
    b.style.animationDelay = `${i * 45}ms`; // gentle stagger so the options fade in one after another
    controlsEl.appendChild(b);
  });
}

function showEnd(error?: string): void {
  trayShown = false;
  const note = document.createElement("div");
  note.className = `pnote${error ? " error" : ""}`;
  note.textContent = error ? `Error: ${error}` : "The End";
  controlsEl.replaceChildren(note, button("↺ Restart", "pchoice restart", () => void startRun()));
}

// The script changed under this run: freeze Step / Continue / choices and prompt a restart, which
// rebuilds the run from the new source. (Also reachable via the persistent "Rewind to start".)
function showStale(): void {
  trayShown = false;
  runGen++; // freeze any in-flight table-read - the script changed underneath it
  const note = document.createElement("div");
  note.className = "pnote stale";
  note.textContent = "Scene changed in the editor: restart to play the new version.";
  controlsEl.replaceChildren(note, button("↺ Restart", "pchoice restart", () => void startRun()));
  scrollToEnd(); // keep the last line above the freeze note, not hidden behind it
}

// Is a choice tray currently on screen? A live structural refresh re-renders it from the run's
// re-derived options (a dissolved / drifted option must not stay clickable); any other control state
// is left alone (clobbering a paced reveal's Stop would break the reveal).
let trayShown = false;

/** A quiet, self-dismissing toast: the editor's edit just landed in this running session. */
function flashLive(text: string): void {
  document.querySelector(".plive")?.remove(); // rapid edits: replace, don't stack
  const t = document.createElement("div");
  t.className = "plive";
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200); // matches the CSS fade
}

/** Run an advance (step / toStop): append its beats, move the editor playhead through each, then
 *  render the next controls (more to play / choices / end). */
async function advance(pending: Promise<PlayBatch>, paced = false): Promise<void> {
  trayShown = false;
  controlsEl.replaceChildren(); // buttons off while advancing
  const gen = runGen;
  const batch = await pending;
  if (gen !== runGen) return; // a restart / rewind / stale superseded this advance
  if (paced) { await revealFrom(batch, gen, 0); return; } // Continue: a paced, pausable reveal
  // Single Step: reveal the beat at once (it still fades in); fire its clip if audio is on, don't block.
  for (const s of batch.steps) {
    const el = appendStep(s); play.mark(s.id, s.scene);
    if (audioOn && s.kind === "line") void playClip(s.id, el);
  }
  showTerminal(batch);
}

/** Reveal a paced (Continue) batch from `startIdx`: one beat at a time, each held for the length of its
 *  audio (a voiced line, audio on) or a reading-length delay (text, a missing clip, or audio off); each
 *  line fades in (CSS). Stop pauses at the current line - the un-played rest waits behind a resume control
 *  (showResume) rather than rushing through. */
async function revealFrom(batch: PlayBatch, gen: number, startIdx: number): Promise<void> {
  stopRequested = false;
  showStop();
  for (let i = startIdx; i < batch.steps.length; i++) {
    if (gen !== runGen) return;
    const s = batch.steps[i]!;
    const el = appendStep(s); play.mark(s.id, s.scene); scrollToEnd();
    await paceBeat(s, el);
    if (gen !== runGen) return;
    if (stopRequested) { stopRequested = false; showResume(batch, gen, i + 1); return; } // paused: queue the rest
  }
  if (gen !== runGen) return;
  skipFire = null;
  showTerminal(batch);
}

/** Reveal a single queued beat of a paused paced batch (the reader is stepping the rest by hand), then
 *  offer the next resume control - or the terminal once the batch is spent. */
function revealOne(batch: PlayBatch, gen: number, idx: number): void {
  if (gen !== runGen) return;
  const s = batch.steps[idx]!;
  const el = appendStep(s); play.mark(s.id, s.scene);
  if (audioOn && s.kind === "line") void playClip(s.id, el); // fire its clip, don't block (single-step)
  showResume(batch, gen, idx + 1);
}

/** After Stop pauses a paced reveal, the un-played beats stay queued behind this control so the reader
 *  resumes at their own pace: Step reveals the next queued beat; Continue plays the rest out paced. Its
 *  label + behaviour track the header Continue toggle. */
function showResume(batch: PlayBatch, gen: number, nextIdx: number): void {
  if (nextIdx >= batch.steps.length) { showTerminal(batch); return; } // nothing left queued
  resumeState = { batch, gen, nextIdx };
  const row = document.createElement("div"); row.className = "padv-row presume";
  const b = button(continueMode ? "▸▸ Continue" : "▸ Step", "padv", () =>
    continueMode ? void revealFrom(batch, gen, nextIdx) : revealOne(batch, gen, nextIdx));
  row.append(b);
  controlsEl.replaceChildren(row);
  scrollToEnd();
}

/** Render the control that follows a fully-revealed batch: the choices, the end, an error, or a plain
 *  Advance when there's simply more to play. */
function showTerminal(batch: PlayBatch): void {
  if (batch.stop === "choice") {
    if (batch.choiceId) play.mark(batch.choiceId, batch.choiceScene); // move the editor playhead onto the choice while we wait for a pick
    showChoices(batch.options ?? []);
  }
  else if (batch.stop === "end") showEnd();
  else if (batch.stop === "error") showEnd(batch.error);
  else showAdvance(); // "continue" - more to play
  scrollToEnd(); // now the controls are in the footer, settle the last line just above them
}

// Take the first advance after a start / choice. In Continue mode this runs to the next natural stop (so
// the whole segment plays out, not just its first line); otherwise it reveals one beat.
const firstAdvance = (): Promise<PlayBatch> => (continueMode ? play.toStop() : play.step());

async function chooseThen(optionId: string): Promise<void> {
  await play.choose(optionId);
  await advance(firstAdvance(), continueMode); // advance immediately on the pick - don't wait for another Advance
}

async function startRun(): Promise<void> {
  runGen++; // cancel any in-flight table-read from the previous run
  stopRequested = false; skipFire?.(); stopClip?.(); resumeState = null; // stop any sounding clip / pending delay / paused reveal
  transcriptEl.replaceChildren();
  play.resetMarks();
  await play.start();
  await advance(firstAdvance(), continueMode); // always take the first Advance automatically (start / restart / rewind)
}

// --- header (starting address) + always-on-top pin ---------------------------
let pinned = true;
function setPin(on: boolean): void {
  pinned = on;
  pinEl.setAttribute("aria-pressed", String(on));
  pinEl.classList.toggle("on", on);
  pinEl.title = on ? "Pinned on top: click to unpin" : "Click to keep on top";
}
pinEl.addEventListener("click", () => { setPin(!pinned); play.setPin(pinned); });
rewindEl.addEventListener("click", () => void startRun());

// --- play-language switcher (#195) -------------------------------------------
// Populate from the project's declared locales; hidden for a monolingual project. Changing it sets the
// run's locale in the main process, then restarts so the whole script replays in the new language.
type PlayInfo = Awaited<ReturnType<typeof play.info>>;
function applyInfo(info: PlayInfo): void {
  addrEl.textContent = info.address;
  audioAvailable = info.audio;            // only offer "Play with audio" in Audio Folders mode (#206)
  audioEl.hidden = !audioAvailable;
  if (audioAvailable) setAudio(audioOn);  // reflect the remembered toggle state
  reflectCaptions(info.captions);         // closed-captions toggle state (#214, default on)
  if (info.locales.length > 1) {
    localeEl.replaceChildren(...info.locales.map((code) => {
      const o = document.createElement("option");
      o.value = code;
      o.textContent = code === info.defaultLocale ? `${code} · source` : code;
      return o;
    }));
    localeEl.value = info.locale;
    localeEl.hidden = false;
  } else {
    localeEl.hidden = true;
  }
}
localeEl.addEventListener("change", () => { void play.setLocale(localeEl.value).then(() => startRun()); });

void play.info().then((info) => { applyInfo(info); setPin(info.pinned); });
play.onRestart(() => { void play.info().then(applyInfo); void startRun(); });
play.onStale(showStale); // editor edited the scene mid-run AND the swap failed: freeze until restart
// Live bundle refresh (phase 1): the edit landed in the running session in place. Confirm quietly;
// a structural swap also re-syncs a SHOWN choice tray from the re-derived options (a drifted option
// must not stay clickable; a dissolved choice falls back to the Step control). An in-flight paced
// reveal keeps playing its already-fetched batch (best-effort); the next fetch reads the new script.
play.onRefreshed((kind, options) => {
  flashLive(kind === "text" ? "Edits applied live" : "Scene updated live");
  if (trayShown && kind === "structure") {
    if (options.length > 0) showChoices(options); else showAdvance();
  }
});
void startRun();
