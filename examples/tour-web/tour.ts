// The web tour demo: play the interactive tour (examples/projects/tour.patter) in a browser,
// with its voice takes. The same demo the engine plugins bundle: load the compiled
// bundle, step the flow, offer the choices, and play each line's WINNING take via the
// patteraudio.json resolver (whatever rung the tour's audio export holds - scratch today,
// recorded or final takes the moment they land in the folder). Assets are served straight out
// of the repo by serve.mjs - nothing is copied.

import { Engine, type Flow, type StepResult } from "@patterkit/runtime";
import { createAudioResolver, type AudioResolver } from "@patterkit/play-helpers";

const transcriptEl = document.getElementById("transcript")!;
const controlsEl = document.getElementById("controls")!;
const audioEl = document.getElementById("clip") as HTMLAudioElement;
const audioToggle = document.getElementById("audio-toggle") as HTMLInputElement;

let engine: Engine;
let flow: Flow;
let audio: AudioResolver | null = null;

function append(kind: string, html: string): void {
  const div = document.createElement("div");
  div.className = `step ${kind}`;
  div.innerHTML = html;
  transcriptEl.appendChild(div);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

// Patter's formatting markup is a fixed, flat vocabulary (<b>/<i>/<bi>) handed over verbatim;
// mapping it is the host's job. Here: escape everything first, then let exactly those tags back
// through as real HTML.
const fmt = (s: string): string =>
  esc(s) // esc turns "<" into "&lt;" (and leaves ">" alone), so the escaped tags look like "&lt;b>"
    .replace(/&lt;bi>/g, "<b><i>").replace(/&lt;\/bi>/g, "</i></b>")
    .replace(/&lt;b>/g, "<b>").replace(/&lt;\/b>/g, "</b>")
    .replace(/&lt;i>/g, "<i>").replace(/&lt;\/i>/g, "</i>");

// Buttons render plain text, so there the tags just come off.
const stripTags = (s: string): string => s.replace(/<\/?(?:bi|b|i)>/g, "");

/** Play one advance: render the step, fire its clip, and offer the next control. */
function step(): void {
  const r: StepResult = flow.advance();
  switch (r.type) {
    case "line": {
      const who = r.characterName ?? r.character ?? "";
      append("line", `<b>${esc(who)}</b> ${fmt(r.text)}`);
      playClip(r.id);
      showNext();
      break;
    }
    case "text":
      append("text", fmt(r.text));
      playClip(r.id); // narration can carry a take too
      showNext();
      break;
    case "gameEvent":
      append("event", `⚙ game event <code>${esc(r.id)}</code>`);
      showNext();
      break;
    case "choice":
      showChoices(r);
      break;
    case "end":
      append("end", "· The End ·");
      showRestart();
      break;
  }
}

/** Fire the beat's winning take, if the manifest resolves one for it. */
function playClip(beatId: string): void {
  if (!audio || !audioToggle.checked) return;
  const src = audio.resolve(beatId);
  if (!src) return;
  audioEl.src = src;
  void audioEl.play().catch(() => { /* autoplay policy before first click - fine, Next is a click */ });
}

function showNext(): void {
  controlsEl.replaceChildren(button("▸ Next", () => step()));
}

function showChoices(r: Extract<StepResult, { type: "choice" }>): void {
  controlsEl.replaceChildren();
  for (const o of r.options) {
    const label = stripTags(o.prompt?.text || "(choice)");
    const b = button(label, () => { flow.choose(o.id); step(); });
    b.disabled = !o.eligible;
    controlsEl.appendChild(b);
  }
}

function showRestart(): void {
  controlsEl.replaceChildren(button("↺ Play again", () => { start(); }));
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

function start(): void {
  transcriptEl.replaceChildren();
  flow = engine.openFlow("main"); // the project's start scene
  step();
}

async function boot(): Promise<void> {
  const bundle = await (await fetch("assets/tour.patterc")).json();
  engine = new Engine(bundle);
  try {
    const manifest = await (await fetch("assets/audio/patteraudio.json")).text();
    audio = createAudioResolver(manifest, "assets/audio");
  } catch { audio = null; } // no manifest served: play silently
  start();
}

void boot();
