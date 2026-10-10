// The play WINDOW renderer. A separate window that walks the script interactively over the runtime
// (the main process holds the Engine; this window drives it via window.patterPlay). You drive the
// walk with one button, **Step** (one beat) or, with the head's Continue toggle on, **Continue** (to the
// next choice or the end), and as each beat plays it tells the EDITOR window to move the playhead,
// leaving a visited trail.
// Choices are buttons; the trail + playhead reset on a fresh run.

import "@patterkit/patterpad-surface/theme.css"; // app-wide design tokens (same look as the editor)
import "@wildwinter/app-shell/tooltip.css"; // the themed bubble initTooltips() below draws
import "@wildwinter/app-shell/controls.css"; // the follow toggle is the family's `.btn`
import "@wildwinter/app-shell/toast.css"; // a shared module carries its own CSS (multi-window-rules.md)
import "./play.css";
import "@wildwinter/app-shell/stale.css";
import "@fontsource/newsreader/400.css";
import "@fontsource/newsreader/400-italic.css";
import "@fontsource/newsreader/600.css";
import "@fontsource-variable/inter";

import { staleBar, el, toast } from "@wildwinter/app-shell";
import { applyTheme } from "../src/apply-theme.js";
import { initTooltips, pinButton, followButton, toolWindowHead, iconNode, type IconName } from "@wildwinter/app-shell";
import "@wildwinter/app-shell/tool-window.css"; // the head bar, the pin and the close travel with it
import { colourFor } from "@patterkit/patterpad-surface/colour";
import { estimateDuration } from "@wildwinter/game-subtitles"; // the same estimate Patterstage times a line by
import type { PlayBatch, PlayChoiceOption, PlayStep } from "../../shared/api.js";
import { Timeline, PlayClock, SPEED_RATE, lineLength, readSpeed, type PlaySpeed } from "./timing.js";

// The THEMED rollover. Without this call `data-tip` is inert: the shell's `pinButton` sets it and
// nothing renders it, so this window had a pin with no tooltip at all. Only the editor mounted it.
initTooltips();

const play = window.patterPlay!;
const transcriptEl = document.getElementById("transcript")!;
const controlsEl = document.getElementById("choices")!;
const localeEl = document.getElementById("play-locale") as HTMLSelectElement;
const continueEl = document.getElementById("play-continue") as HTMLButtonElement;
// The header's drawn icons (the HTML carries the labels alone): Continue is "play through", the one honest
// go-there arrow.
continueEl.prepend(iconNode("arrowRight", 12));
const audioEl = document.getElementById("play-audio") as HTMLButtonElement;
audioEl.prepend(iconNode("speaker", 12)); // the family's drawn speaker (app-shell 0.47.0), in place of one drawn in the markup

// "Play with audio" (#206 P3): in Audio Folders mode, Continue becomes a table-read - each line plays its
// clip, overlapping where a negative pause cuts one line in on another. Continue times every line the same
// way with audio on or off (timing.ts): by its recording's length when one exists, else by the duration
// estimate. Step stays manual: it just fires the clip. The toggle is remembered across runs, and only shown
// when the project is in folder mode.
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
// Stop / pause a paced run: `stopRequested` halts the reveal before the NEXT beat (the un-played rest waits
// behind a resume control - it never rushes ahead); `wake` wakes the wait in flight, which then stops (Stop,
// a restart, a stale script) or works its time out again (a change of speed); `stopSounding` stops every
// line still sounding. `resumeState` remembers where a paused reveal left off.
let stopRequested = false;
let wake: (() => void) | null = null;
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
  if (!on && controlsEl.querySelector(".play-stop")) { stopRequested = true; wake?.(); stopSounding(); }
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
  ccEl.dataset["tip"] = on ? "Closed captions are on. Click to hide non-spoken cues." : "Closed captions are off. Click to show non-spoken cues.";
}
ccEl.addEventListener("click", () => { reflectCaptions(!captionsOn); void play.setClosedCaptions(captionsOn); });


// Speed: a speed-up of the whole timing (half, normal, double, instant), so a writer can skim without losing
// the shape of the scene. Instant reveals a played-through run at once, with no audio. Stored under the key
// and values the playable HTML export reads too. The old reading paces (slow, fast) map across when read,
// but nothing is written back until the writer picks a speed, so an older Patterpad still reads its own.
// A change mid-run applies at once: the run's clock keeps the time already played and re-times the rest,
// the wait in flight is worked out again, and the lines still sounding take the new rate.
let speed: PlaySpeed = readSpeed(localStorage.getItem("patter.playSpeed"));
/** The paced reveal's clock while one is running. */
let activeClock: PlayClock | null = null;
const speedEl = document.getElementById("play-speed") as HTMLSelectElement | null;
if (speedEl) {
  speedEl.value = speed; // the options are in the markup (index.html and the preview copy), in PLAY_SPEEDS order
  speedEl.addEventListener("change", () => {
    speed = readSpeed(speedEl.value);
    localStorage.setItem("patter.playSpeed", speed);
    activeClock?.setRate(performance.now(), SPEED_RATE[speed]);
    for (const s of [...sounding]) s.retime();
    wake?.();
  });
}

/** The rate a clip plays at: the speed's, except under Instant, where only Step sounds a clip (at its own pace). */
const clipRate = (): number => (speed === "instant" ? 1 : SPEED_RATE[speed]);

/** A line's recording, loaded far enough to know its length. `duration` is NaN or Infinity when the file
 *  doesn't say: it still plays, and the line is timed by the estimate (`lineLength`). */
interface Clip { audio: HTMLAudioElement; url: string; duration: number }

/** Load a line's recording (Audio Folders mode), or null when there's no file for it or it won't load. */
async function loadClip(beatId: string): Promise<Clip | null> {
  if (!audioAvailable) return null;
  const data = await play.audioBytes(beatId);
  if (!data) return null;
  const url = URL.createObjectURL(new Blob([data.bytes as BlobPart], { type: data.mime }));
  const audio = new Audio(url);
  audio.preload = "auto";
  const duration = await new Promise<number | null>((res) => {
    audio.onloadedmetadata = () => res(audio.duration);
    audio.onerror = () => res(null);
  });
  if (duration === null) { URL.revokeObjectURL(url); return null; } // it won't load: nothing to play
  return { audio, url, duration };
}

/** Something sounding now (a clip, or a line held for its length): Stop and a restart end them all, and a
 *  change of speed re-times them. */
interface Sounding { stop(): void; retime(): void }
const sounding = new Set<Sounding>();
/** Bumped by `stopSounding`, so a Step clip still loading when everything was stopped never starts. */
let soundGen = 0;
function stopSounding(): void { soundGen++; for (const s of [...sounding]) s.stop(); }

/** Play a loaded clip without waiting for it. While it sounds, `lineEl` (the transcript line) pulses via
 *  `.pline-playing`, so overlapping lines both show. */
function playLoaded(clip: Clip, lineEl: HTMLElement): void {
  let over = false;
  const done = (): void => {
    if (over) return;
    over = true; sounding.delete(entry);
    lineEl.classList.remove("pline-playing");
    URL.revokeObjectURL(clip.url);
  };
  const entry: Sounding = {
    stop: () => { clip.audio.pause(); done(); },
    retime: () => { clip.audio.playbackRate = clipRate(); }, // the pitch is kept (the element's default)
  };
  sounding.add(entry);
  lineEl.classList.add("pline-playing");
  entry.retime();
  clip.audio.onended = done;
  clip.audio.onerror = done;
  void clip.audio.play().catch(done);
}

/** Mark a line as playing for `seconds` of script time with no audio, so a cut-in still shows against the
 *  line it cuts into. It keeps its own clock, so a change of speed re-times what's left of it. */
function holdLine(lineEl: HTMLElement, seconds: number): void {
  if (seconds <= 0 || speed === "instant") return;
  const clock = new PlayClock(performance.now(), SPEED_RATE[speed]);
  let t: ReturnType<typeof setTimeout> | undefined;
  const entry: Sounding = {
    stop: () => { clearTimeout(t); sounding.delete(entry); lineEl.classList.remove("pline-playing"); },
    retime: () => {
      clearTimeout(t);
      clock.setRate(performance.now(), SPEED_RATE[speed]);
      const ms = clock.at(seconds) - performance.now();
      if (ms <= 0) entry.stop(); else t = setTimeout(entry.stop, ms);
    },
  };
  sounding.add(entry);
  lineEl.classList.add("pline-playing");
  entry.retime();
}

/** Step: fire a line's clip if audio is on, without waiting (Step has no timing). A clip that finishes
 *  loading after a restart, or after Stop silenced everything, is dropped. */
function soundOnStep(step: PlayStep, lineEl: HTMLElement): void {
  if (!audioOn || step.kind !== "line") return;
  const gen = runGen, sound = soundGen;
  void loadClip(step.id).then((clip) => {
    if (!clip) return;
    if (gen !== runGen || sound !== soundGen) { URL.revokeObjectURL(clip.url); return; }
    playLoaded(clip, lineEl);
  });
}

/** Wait until script time `seconds` comes on `clock`. Woken (via `wake`), it works the time out again, so
 *  a change of speed re-times it; it returns early once the run is superseded or Stop is pressed. Only one
 *  wait is ever in flight at a time. */
async function waitFor(clock: PlayClock, seconds: number, gen: number): Promise<void> {
  for (;;) {
    if (gen !== runGen || stopRequested) return;
    const ms = clock.at(seconds) - performance.now();
    if (ms <= 0) return;
    let mine: (() => void) | null = null;
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, ms);
      mine = () => { clearTimeout(t); resolve(); };
      wake = mine;
    });
    if (wake === mine) wake = null;
  }
}

/** A control button. `icon` is a LEADING drawn icon from the family's vocabulary (a text button never
 *  carries a typed glyph); Step is `forward` (one beat on), Continue is `arrowRight` (play through). */
function button(label: string, cls: string, onClick?: () => void, icon?: IconName): HTMLButtonElement {
  const b = document.createElement("button"); b.type = "button"; b.className = cls;
  if (icon) b.append(iconNode(icon, 14)); b.append(label);
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

/** A condition or effect that failed: the engine played through it (a failing condition counts as false,
 *  a failing effect is skipped), so the transcript says so where it happened rather than stopping. */
function appendWarnings(batch: PlayBatch): void {
  for (const w of batch.warnings ?? []) {
    const div = document.createElement("div");
    div.className = "pline pwarn";
    div.textContent = `Played through a failing ${w}`;
    transcriptEl.appendChild(div);
  }
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
    // The speaker qualifier after the name, as the script shows it: TAM (O.S.). The localised name the
    // runtime resolved, else the gameId (an IDs-only build carries no names).
    const qualifier = step.qualifierName ?? step.qualifier;
    if (qualifier) { const q = document.createElement("span"); q.className = "pqual"; q.textContent = `(${qualifier})`; cue.append(q); }
    const body = document.createElement("span");
    if (step.direction) { const d = document.createElement("em"); d.className = "pdir"; d.textContent = `(${step.direction}) `; body.appendChild(d); }
    renderMarkup(body, step.text ?? "");
    div.append(cue, body);
  } else if (step.kind === "text") {
    renderMarkup(div, step.text ?? "");
  } else {
    div.append(iconNode("settings", 15), "game event"); // the flex gap sets the space, not a typed one
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
  controlsEl.replaceChildren(button("Stop", "play-stop", () => { stopRequested = true; wake?.(); stopSounding(); }));
}

function showAdvance(): void {
  trayShown = false;
  const row = document.createElement("div"); row.className = "padv-row";
  // Step's behaviour follows the header Continue toggle: off = one beat; on = run to the next natural stop (a
  // choice or the end) as a paced reveal - each beat held for its audio or a reading-length delay.
  const step = button(continueMode ? "Continue to next stop" : "Step", "padv", () =>
    void advance(continueMode ? play.toStop() : play.step(), continueMode), continueMode ? "arrowRight" : "forward");
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
  controlsEl.replaceChildren(note, button("Restart", "pchoice restart", () => void startRun(), "restart"));
}

// The script changed under this run: freeze Step / Continue / choices and prompt a restart, which
// rebuilds the run from the new source. (Also reachable via the head's persistent Restart.)
function showStale(): void {
  trayShown = false;
  runGen++; // freeze any in-flight table-read - the script changed underneath it
  wake?.(); stopSounding(); // and end its wait in flight and the lines still sounding
  // The shell's banner, which carries its own Restart. A BAR rather than the centred grey note this
  // used to draw, because the session is frozen until you act and a note that reads like the end of a
  // passage does not say so. Everything else this function does is unchanged.
  controlsEl.replaceChildren(staleBar({ subject: "The scene", onRestart: () => void startRun() }));
  scrollToEnd(); // keep the last line above the freeze note, not hidden behind it
}

// Is a choice tray currently on screen? A live structural refresh re-renders it from the run's
// re-derived options (a dissolved / drifted option must not stay clickable); any other control state
// is left alone (clobbering a paced reveal's Stop would break the reveal).
let trayShown = false;


/** Run an advance (step / toStop): append its beats, move the editor playhead through each, then
 *  render the next controls (more to play / choices / end). */
async function advance(pending: Promise<PlayBatch>, paced = false): Promise<void> {
  trayShown = false;
  controlsEl.replaceChildren(); // buttons off while advancing
  const gen = runGen;
  const batch = await pending;
  if (gen !== runGen) return; // a restart / rewind / stale superseded this advance
  appendWarnings(batch);
  if (paced) { await revealFrom(batch, gen, 0); return; } // Continue: a paced, pausable reveal
  // Single Step: reveal the beat at once (it still fades in); fire its clip if audio is on, don't block.
  // No pauses apply under Step: the reader decides when the next line starts.
  for (const s of batch.steps) {
    const el = appendStep(s); play.mark(s.id, s.scene);
    soundOnStep(s, el);
  }
  showTerminal(batch);
}

/** Reveal a paced (Continue) batch from `startIdx`, on the timeline of timing.ts: each line lasts as long as
 *  its recording (whether or not audio is on) or the duration estimate, and the next starts its `padAfter`
 *  later, so a negative pause brings it in before the last one ends (their clips overlap). The choices
 *  appear as the last line starts (they show while it plays); the end when every line still playing has
 *  ended. Stop pauses before the next beat - the un-played rest waits behind a resume control (showResume)
 *  rather than rushing through. */
async function revealFrom(batch: PlayBatch, gen: number, startIdx: number): Promise<void> {
  stopRequested = false;
  showStop();
  const timeline = new Timeline(); // the first beat starts at once: nothing before it carries a pause
  const clock = new PlayClock(performance.now(), SPEED_RATE[speed]); // re-anchored by a change of speed
  activeClock = clock;
  for (let i = startIdx; i < batch.steps.length; i++) {
    if (gen !== runGen) return;
    const s = batch.steps[i]!;
    // Load the recording while waiting for the beat's turn: its length is what times the next one.
    const pending = s.kind === "line" && speed !== "instant" ? loadClip(s.id) : Promise.resolve(null);
    const start = timeline.startOf(s);
    await waitFor(clock, start, gen);
    const clip = await pending;
    if (gen !== runGen || stopRequested) {
      if (clip) URL.revokeObjectURL(clip.url);
      if (gen === runGen) { stopRequested = false; showResume(batch, gen, i); } // paused: queue the rest
      return;
    }
    // A recording that loaded after the beat's turn starts it late: the rest of the run moves on by as
    // much, so no overlap appears that nobody set.
    clock.delay(performance.now() - clock.at(start));
    const length = s.kind === "gameEvent" ? 0 : lineLength(clip?.duration, estimateDuration(s.text));
    timeline.place(s, length);
    const el = appendStep(s); play.mark(s.id, s.scene); scrollToEnd();
    if (clip && audioOn) playLoaded(clip, el);
    else {
      if (clip) URL.revokeObjectURL(clip.url);
      holdLine(el, length);
    }
  }
  // The last line's own pause is ignored: the choices come as it starts, the end as the last line still
  // playing ends.
  await waitFor(clock, batch.stop === "choice" ? timeline.choicesAt : timeline.end, gen);
  if (gen !== runGen) return;
  if (activeClock === clock) activeClock = null;
  stopRequested = false;
  wake = null;
  showTerminal(batch);
}

/** Reveal a single queued beat of a paused paced batch (the reader is stepping the rest by hand), then
 *  offer the next resume control - or the terminal once the batch is spent. */
function revealOne(batch: PlayBatch, gen: number, idx: number): void {
  if (gen !== runGen) return;
  const s = batch.steps[idx]!;
  const el = appendStep(s); play.mark(s.id, s.scene);
  soundOnStep(s, el); // fire its clip, don't block (single-step)
  showResume(batch, gen, idx + 1);
}

/** After Stop pauses a paced reveal, the un-played beats stay queued behind this control so the reader
 *  resumes at their own pace: Step reveals the next queued beat; Continue plays the rest out paced. Its
 *  label + behaviour track the header Continue toggle. */
function showResume(batch: PlayBatch, gen: number, nextIdx: number): void {
  if (nextIdx >= batch.steps.length) { showTerminal(batch); return; } // nothing left queued
  resumeState = { batch, gen, nextIdx };
  const row = document.createElement("div"); row.className = "padv-row presume";
  const b = button(continueMode ? "Continue" : "Step", "padv", () =>
    continueMode ? void revealFrom(batch, gen, nextIdx) : revealOne(batch, gen, nextIdx), continueMode ? "arrowRight" : "forward");
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
  const gen = runGen; // a restart while the pick lands has begun its own run: don't advance that one too
  await play.choose(optionId);
  if (gen !== runGen) return;
  await advance(firstAdvance(), continueMode); // advance immediately on the pick - don't wait for another Advance
}

async function startRun(): Promise<void> {
  const gen = ++runGen; // cancel any in-flight table-read from the previous run
  stopRequested = false; wake?.(); stopSounding(); resumeState = null; // stop any sounding clip / pending wait / paused reveal
  transcriptEl.replaceChildren();
  play.resetMarks();
  await play.start();
  // A second Restart while this one was starting has begun its own run: two first advances played twice.
  if (gen !== runGen) return;
  await advance(firstAdvance(), continueMode); // always take the first Advance automatically (start / restart / rewind)
}

// --- the head: title, starting address, rewind, follow, pin, close ------------
// The window is frameless, so the shell's `toolWindowHead` stands in for the OS title bar: the drag
// region, one "Close (Esc)", and Escape closing the window are decided there for every tool window in
// the family. The pin and the follow toggle are the shell's too; their `set` handles are how main
// re-pins on Reset View, and how the remembered follow state lands, without either button choosing it.
//
// "Follow in the editor" sits beside the pin because both are about how this window sits NEXT TO the
// editor rather than about the thing being played. OFF by default and remembered: marking is the
// default behaviour and following is the author asking for it.
const addrEl = el("span", "play-addr");
// "Restart", the one verb for running again: the end of a run says it, and so does Storyletter's Board.
const rewindEl = el("button", { className: "play-rewind", tip: "Restart", onClick: () => void startRun() }, iconNode("restart"));
rewindEl.type = "button";
rewindEl.setAttribute("aria-label", "Restart");
const pin = pinButton({ pinned: true, onToggle: (on) => play.setPin(on) });
const follow = followButton({ on: false, onToggle: (on) => play.setFollow(on) });
document.body.prepend(toolWindowHead({
  title: "Play",
  lead: [el("span", "play-from", "Playing from"), addrEl],
  trail: [rewindEl, follow.el],
  pin,
  onClose: () => play.close(),
}));

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
      // An <option> is text only, so the source language is marked in words, not with a drawn separator.
      o.textContent = code === info.defaultLocale ? `${code} (source)` : code;
      return o;
    }));
    localeEl.value = info.locale;
    localeEl.hidden = false;
  } else {
    localeEl.hidden = true;
  }
}
localeEl.addEventListener("change", () => { void play.setLocale(localeEl.value).then(() => startRun()); });

void play.info().then((info) => { applyInfo(info); pin.set(info.pinned); applyTheme(info.theme); follow.set(info.follow); });
// The palette is the app's, not this window's: apply what the editor last chose, and follow it when
// the author changes it. Importing theme.css is not enough, because the curated palettes only exist
// under the `data-theme` attribute this sets.
play.onTheme((t) => applyTheme(t));
play.onPin((on) => pin.set(on)); // Reset View re-pins in main; the button must be told
// A different project opened underneath: a run belongs to the project it started in, so this window
// closes rather than sit over the new one showing the old scene (it is a satellite of the session now).
play.onProject(() => play.close());
play.onRestart(() => { void play.info().then(applyInfo); void startRun(); });
play.onStale(showStale); // editor edited the scene mid-run AND the swap failed: freeze until restart
// Live bundle refresh (phase 1): the edit landed in the running session in place. Confirm quietly;
// a structural swap also re-syncs a SHOWN choice tray from the re-derived options (a drifted option
// must not stay clickable; a dissolved choice falls back to the Step control). An in-flight paced
// reveal keeps playing its already-fetched batch (best-effort); the next fetch reads the new script.
play.onRefreshed((kind, options) => {
  // The shell's toast, as every other remark in the family is made: this window drew its own pill.
  toast(kind === "text" ? "Edits applied live." : "Scene updated live.", "ok");
  if (trayShown && kind === "structure") {
    if (options.length > 0) showChoices(options); else showAdvance();
  }
});
void startRun();
