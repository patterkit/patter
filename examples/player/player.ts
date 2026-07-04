// ---------------------------------------------------------------------------
// A game-agnostic browser player for compiled Patter bundles.
//
// Drives @patterkit/runtime's Engine and renders each step: lines (speaker +
// text), prose text beats, game event beats (shows gameData - where host events ride
// now, spec §15), and choices (buttons). Load any compiled `.patterc` bundle with the
// file picker, or click "Play sample" to compile + play a built-in demo.
// ---------------------------------------------------------------------------

import { Engine } from "@patterkit/runtime";
import type { Flow, StepResult, SaveGame } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import type { Bundle } from "@patterkit/model";
import { demoInput } from "./sample.js";

// The Engine is the world + flow manager; this demo plays a single "main" flow.
let engine: Engine | null = null;
let flow: Flow | null = null;
let currentBundle: Bundle | null = null;
const SAVE_KEY = "patter.player.save";

const byId = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
};
const stage = () => byId("stage");
const controls = () => byId("controls");

const esc = (s: string): string =>
  s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));

function add(cls: string, html: string): void {
  const el = document.createElement("div");
  el.className = cls;
  el.innerHTML = html;
  stage().appendChild(el);
  stage().scrollTop = stage().scrollHeight;
}

function button(label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = cls;
  b.textContent = label;
  b.onclick = onClick;
  controls().appendChild(b);
  return b;
}

function newEngine(bundle: Bundle): Engine {
  currentBundle = bundle;
  return new Engine(bundle);
}

function setStatus(msg: string): void {
  const s = document.getElementById("status");
  if (s) s.textContent = msg;
}

function startBundle(bundle: Bundle): void {
  document.getElementById("hint")?.remove();
  stage().innerHTML = "";
  controls().innerHTML = "";
  engine = newEngine(bundle);
  try {
    flow = engine.openFlow("main");
  } catch (e) {
    add("error", `Failed to start: ${esc(String(e))}`);
    return;
  }
  next();
}

// Snapshot the live flow (cursor + state) alongside its bundle, so a load is
// self-contained even after a page reload.
function saveGame(): void {
  if (!engine || !currentBundle) { setStatus("nothing to save - start a flow first"); return; }
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ bundle: currentBundle, save: engine.saveGame() }));
  } catch (e) {
    // QuotaExceededError on a big bundle - tell the user instead of dying silently.
    setStatus(`save failed: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  setStatus("saved ✓");
}

function loadGame(): void {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) { setStatus("no save found"); return; }
  let parsed: { bundle: Bundle; save: SaveGame };
  try {
    parsed = JSON.parse(raw);
  } catch {
    setStatus("save is corrupt");
    return;
  }
  document.getElementById("hint")?.remove();
  stage().innerHTML = "";
  controls().innerHTML = "";
  engine = newEngine(parsed.bundle);
  try {
    engine.loadGame(parsed.save);
    flow = engine.getFlow("main") ?? engine.flows()[0] ?? null;
  } catch (e) {
    add("error", `Could not restore save: ${esc(String(e))}`);
    return;
  }
  if (!flow) { add("error", "save had no flows"); return; }
  add("picked", "↺ resumed from save");
  setStatus("loaded ✓");
  next(); // continue from the restored cursor
}

function next(): void {
  if (!flow) return;
  controls().innerHTML = "";
  let r: StepResult;
  try {
    r = flow.advance();
  } catch (e) {
    add("error", `Runtime error: ${esc(String(e))}`);
    return;
  }
  render(r);
}

function render(r: StepResult): void {
  switch (r.type) {
    case "line":
      add("line", `${r.character ? `<span class="who">${esc(r.character)}</span>` : ""}<span class="txt">${esc(r.text)}</span>`);
      button("Continue ▸", "continue", next);
      break;
    case "text":
      add("prose", esc(r.text));
      button("Continue ▸", "continue", next);
      break;
    case "gameEvent":
      add("gameEvent", `⚙ game event <code>${esc(r.id)}</code>${r.gameData ? ` <span class="data">${esc(JSON.stringify(r.gameData))}</span>` : ""}`);
      button("Continue ▸", "continue", next);
      break;
    case "choice":
      for (const o of r.options) {
        const b = button(o.prompt?.text ?? o.id, "choice" + (o.eligible ? "" : " disabled"), () => {
          if (!o.eligible || !flow) return;
          add("picked", `▸ ${esc(o.prompt?.text ?? o.id)}`);
          flow.choose(o.id);
          next();
        });
        b.disabled = !o.eligible;
      }
      break;
    case "end":
      add("end", "--- END ---");
      break;
  }
}

window.addEventListener("DOMContentLoaded", () => {
  byId("sample").onclick = () => startBundle(exportBundle(demoInput));
  byId("save").onclick = saveGame;
  byId("load").onclick = loadGame;

  byId("file").addEventListener("change", (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        startBundle(JSON.parse(String(reader.result)) as Bundle);
      } catch (err) {
        add("error", `Could not load bundle: ${esc(String(err))}`);
      }
    };
    reader.readAsText(file);
  });
});
