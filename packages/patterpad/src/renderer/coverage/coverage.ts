// The detached COVERAGE results window (#159). It STAYS OPEN while you edit: run a narrative-coverage
// sweep (random playthroughs that tally which beats get reached), see the results grouped by scene, and
// click a flagged row to jump the editor to it. The main process caches the last result for the session,
// so reopening the window shows it again. "World Properties…" opens Project Settings ▸ External
// Properties (declare @world properties + edit the input drivers the sweep feeds them).
import "@patterkit/patterpad-surface/theme.css"; // app design tokens (same look as the editor + play window)
import "./coverage.css";
import "@fontsource/newsreader/400.css";
import "@fontsource-variable/inter";

import { renderCoverage } from "../src/coverage-view.js";
import type { CoverageResult } from "../../shared/api.js";

const cov = window.patterCoverage!;

const runsInput = document.getElementById("cov-runs") as HTMLInputElement;
const maxStepsInput = document.getElementById("cov-maxsteps") as HTMLInputElement;
const seedInput = document.getElementById("cov-seed") as HTMLInputElement;
const sceneSel = document.getElementById("cov-scene") as HTMLSelectElement;
const runBtn = document.getElementById("cov-run") as HTMLButtonElement;
const worldBtn = document.getElementById("cov-world") as HTMLButtonElement;
const pinBtn = document.getElementById("cov-pin") as HTMLButtonElement;
const driversNote = document.getElementById("cov-drivers")!;
const statusEl = document.getElementById("cov-status")!;
const host = document.getElementById("cov-host")!;

let sceneNames: Record<string, string> = {};

const numOr = (input: HTMLInputElement, fallback: number): number => {
  const n = Number(input.value); return Number.isFinite(n) && n > 0 ? n : fallback;
};

function showResult(result: CoverageResult): void {
  sceneNames = result.sceneNames;
  renderCoverage(host, result.report, (id) => sceneNames[id] ?? id, (sceneId, beatId) => cov.reveal(sceneId, beatId), (ref) => cov.findUsage(ref));
  host.hidden = false; host.scrollTop = 0;
}

/** Read the window's boot state: scene list (start picker), the project start (default), the saved driver
 *  count (a note), and any cached result from earlier this session. */
async function boot(): Promise<void> {
  const info = await cov.info();
  sceneSel.replaceChildren(new Option("Project start", ""));
  for (const s of info.scenes) sceneSel.append(new Option(s.name, s.id));
  sceneSel.value = ""; // default to the project start
  pinned = info.pinned; reflectPin();
  driversNote.textContent = !info.hasProject
    ? "No project open."
    : info.driverCount
      ? `${info.driverCount} input driver${info.driverCount === 1 ? "" : "s"} configured (World Properties…).`
      : "No input drivers, branches gated on @world will read as needs-input (World Properties…).";
  if (info.last) showResult(info.last);
  else { host.hidden = true; host.replaceChildren(); }
}

/** Run a sweep with the bar's options and render it. The result is cached in the main process. */
async function run(): Promise<void> {
  runBtn.disabled = true;
  statusEl.hidden = false; statusEl.textContent = "Running…"; host.hidden = true;
  await new Promise((r) => setTimeout(r, 0)); // let "Running…" paint before the (sync, main-thread) run
  try {
    const result = await cov.run({
      runs: numOr(runsInput, 5000), maxSteps: numOr(maxStepsInput, 200),
      seed: Math.max(0, Math.floor(Number(seedInput.value) || 0)),
      scene: sceneSel.value || undefined,
    });
    if (!result) { statusEl.textContent = "No project open."; return; }
    statusEl.hidden = true;
    showResult(result);
  } catch (e) {
    statusEl.textContent = `Coverage failed: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    runBtn.disabled = false;
  }
}

// Always-on-top pin (default pinned, remembered): same affordance as the play + search windows.
let pinned = true;
const reflectPin = (): void => { pinBtn.classList.toggle("on", pinned); pinBtn.setAttribute("aria-pressed", String(pinned)); };
pinBtn.addEventListener("click", () => { pinned = !pinned; cov.setPin(pinned); reflectPin(); });

runBtn.addEventListener("click", () => void run());
worldBtn.addEventListener("click", () => cov.openWorld());
// A different project was opened under the window: clear stale results + re-fetch.
cov.onProject(() => { host.replaceChildren(); host.hidden = true; statusEl.hidden = true; void boot(); });

void boot();
