// Placeholder Speech in Patterpad (patterkit design/proposals/placeholder-speech.md): the queue of lines edited
// this session, made a moment after the writer moves on; "Make Placeholder Speech Now"; Make again; the key's
// status for the settings page; hearing a voice; and the per-machine memory (lines still waiting, kept across
// a restart, and the switch that stops this machine making any). The work itself is ops', shared with
// `patter placeholder-speech`.

import { app, dialog, type BrowserWindow } from "electron";
import { mkdirSync, readFileSync, writeFileSync, realpathSync, existsSync, unlinkSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { writeBinaryFileAsync, deleteFileAsync, renameFileAsync } from "@wildwinter/simple-vc-lib";
import {
  planPlaceholderSpeech, runPlaceholderSpeech, resolveKeyFile, storedKeyPath, readGoogleKey, tokenSource, synthesize, finishTake,
  describeSpeechError, placeholderAccentOf, requestHash, runVoiceScript, manifestLineIds, sourceStrings, type RunResult, type GoogleKey, type GoogleAuth,
} from "@patterkit/ops";
import { textHash, readTextStamp, readGeneratedStamp } from "@patterkit/core";
import type { JobHost } from "@wildwinter/app-shell/job";
import * as project from "./project.js";

/** How long after the last edit, with no move off the line, waiting lines are made anyway. */
const IDLE_MS = 30_000;

// --- Per-machine memory ----------------------------------------------------------------------------------------

interface SpeechMemory {
  /** This machine makes no Placeholder Speech, and says nothing about a missing key. */
  optOut?: boolean;
  /** Lines waiting to be made, by project (its real path). */
  pending?: Record<string, string[]>;
  /** Lines deleted by an edit here, with when, by project: a scratch take goes a week after its line. */
  deleted?: Record<string, Record<string, string>>;
}
const memoryFile = (): string => join(app.getPath("userData"), "placeholder-speech.json");
function readMemory(): SpeechMemory {
  try { return JSON.parse(readFileSync(memoryFile(), "utf8")) as SpeechMemory; } catch { return {}; }
}
function writeMemory(m: SpeechMemory): void {
  try { mkdirSync(dirname(memoryFile()), { recursive: true }); writeFileSync(memoryFile(), JSON.stringify(m, null, 2)); } catch { /* best effort */ }
}
/** A project's key in the memory: its real path, case-folded where the file system ignores case. */
export function projectKey(root: string): string {
  let p = root;
  try { p = realpathSync(root); } catch { /* not there: as given */ }
  return process.platform === "linux" ? p : p.toLowerCase();
}

export function optedOut(): boolean { return readMemory().optOut === true; }
export function setOptOut(on: boolean): void { const m = readMemory(); if (on) m.optOut = true; else delete m.optOut; writeMemory(m); }

// --- The session -----------------------------------------------------------------------------------------------

export interface SpeechHost {
  jobs: JobHost;
  /** Say something in the window: a quiet note (once per session) or a notice. */
  note(message: string, kind: "info" | "error"): void;
  win(): BrowserWindow | null;
}

let host: SpeechHost | null = null;
let pending = new Set<string>();
let pendingFor: string | null = null;
let idle: NodeJS.Timeout | undefined;
let notedNoKey = false;
let notedOffline = false;
let tokens: { keyPath: string; get: () => Promise<GoogleAuth> } | null = null;

export function initPlaceholderSpeech(h: SpeechHost): void {
  host = h;
  project.onLinesSaved((_scene, changed, removed) => {
    void linesSaved(changed, removed).then(() => { if (changed.length) queue(changed); });
  });
}

/** The project opened (or closed): pick up its waiting lines from last time, and start them in a moment. */
export function projectOpened(): void {
  setTimeout(() => void sweepDeleted(), 5_000); // takes whose line went a week ago, once the project has settled
  const root = project.currentRoot();
  notedNoKey = false;
  notedOffline = false;
  tokens = null;
  if (idle) clearTimeout(idle);
  pendingFor = root ? projectKey(root) : null;
  pending = new Set(pendingFor ? readMemory().pending?.[pendingFor] ?? [] : []);
  if (pending.size) schedule();
}

function savePending(): void {
  if (!pendingFor) return;
  const m = readMemory();
  m.pending ??= {};
  if (pending.size) m.pending[pendingFor] = [...pending]; else delete m.pending[pendingFor];
  writeMemory(m);
}

const featureOn = (): boolean => !!project.loadedProject()?.project.placeholderSpeech;

/** Lines whose words or speaker changed: made once the writer moves on, or after a pause. */
export function queue(ids: string[]): void {
  if (!featureOn() || !ids.length) return;
  for (const id of ids) pending.add(id);
  savePending();
  schedule();
}
function schedule(): void {
  if (idle) clearTimeout(idle);
  idle = setTimeout(() => void runPending(), IDLE_MS);
}
/** The writer moved off a line: make what's waiting now. */
export function nudge(): void { if (pending.size) void runPending(); }

async function runPending(): Promise<void> {
  if (idle) { clearTimeout(idle); idle = undefined; }
  if (!pending.size || !featureOn()) return;
  if (host?.jobs.running("placeholder")) { schedule(); return; }
  const ids = new Set(pending);
  const r = await run({ only: ids }, false);
  if (typeof r === "string") return; // off, no key, opted out, or stopped: kept for later
  for (const id of ids) if (!r.failed.some((f) => f.beatId === id) && !r.skippedLocked.includes(id)) pending.delete(id);
  savePending();
}

// --- Running ---------------------------------------------------------------------------------------------------

type RunOutcome = RunResult | "no-key" | "opted-out" | "stopped" | "off";

function keyFor(): { account: GoogleKey; path: string } | string {
  const loaded = project.loadedProject();
  const ps = loaded?.project.placeholderSpeech;
  if (!loaded || !ps) return "Placeholder Speech is off for this project.";
  const key = resolveKeyFile(loaded.root, ps.keyFile);
  if (!key.path) return "Placeholder Speech isn't being made on this machine: there's no Google key here.";
  try { return { account: readGoogleKey(key.path), path: key.path }; } catch (e) { return describeSpeechError(e); }
}

/** Plan and make. `loud` runs say why they can't run (a command the writer chose); quiet ones say it once. */
async function run(opts: Parameters<typeof planPlaceholderSpeech>[1], loud: boolean): Promise<RunOutcome> {
  const loaded = project.loadedProject();
  const ps = loaded?.project.placeholderSpeech;
  if (!loaded || !ps) return "off";
  if (optedOut()) { if (loud) host?.note("This machine is set not to make Placeholder Speech (Preferences).", "info"); return "opted-out"; }
  const key = keyFor();
  if (typeof key === "string") {
    if (loud) host?.note(`${key} Set the key file in Project settings > Placeholder Speech.`, "error");
    else if (!notedNoKey) { notedNoKey = true; host?.note(key, "info"); }
    return "no-key";
  }
  // The planner reads the audio folders itself: the live index can be a moment behind (just after a project
  // opens or the ladder changes), and an empty view would plan speech for lines that already have takes.
  const plan = planPlaceholderSpeech(loaded, opts);
  if (!plan) return "off";
  if (!plan.accent) { host?.note("Placeholder Speech needs an accent: choose one in Project settings > Placeholder Speech.", "error"); return "stopped"; }
  if (!plan.tasks.length) { if (loud) host?.note("Placeholder Speech is up to date.", "info"); return { made: [], failed: [], skippedLocked: [], notTried: 0 }; }
  if (!tokens || tokens.keyPath !== key.path) tokens = { keyPath: key.path, get: tokenSource(key.account) };
  const token = tokens.get;
  mkdirSync(plan.folder, { recursive: true });
  const keepOut = ps.keepOutOfVersionControl === true;
  // Kept out of version control: the folder ignores itself for git, and its files are never added (written
  // straight to disk), so no other system picks them up either.
  if (keepOut) { const ignore = join(plan.folder, ".gitignore"); if (!existsSync(ignore)) { try { writeFileSync(ignore, "# Placeholder Speech: made on each machine, kept out of version control\n*\n"); } catch { /* best effort */ } } }
  const controller = new AbortController();
  const out = await host!.jobs.start("placeholder", async (ctx) => runPlaceholderSpeech(plan.tasks, {
    token,
    signal: controller.signal,
    write: async (path, bytes) => {
      if (keepOut) { writeFileSync(path, bytes); return true; }
      const res = await writeBinaryFileAsync(path, Buffer.from(bytes));
      if (res.success) return true;
      if (res.status === "locked") return false; // someone else has it: skipped quietly
      throw new Error(res.message);
    },
    onProgress: (done, total) => { if (ctx.cancelled) controller.abort(); void ctx.step(done, total); },
  }));
  project.rescanAudio();
  if ("error" in out) { host?.note(out.error, "error"); return "stopped"; }
  const r = out.value;
  if (!r) return "stopped";
  if (r.stopped) {
    // No network: quiet, once; the lines wait for next time. Anything else is said.
    if (r.stopped.kind === "offline") { if (loud || !notedOffline) { notedOffline = true; host?.note(`${r.stopped.message} Placeholder Speech will catch up later.`, "info"); } }
    else host?.note(`Placeholder Speech stopped: ${r.stopped.message}`, "error");
    return "stopped";
  }
  if (r.failed.length) host?.note(`Placeholder Speech couldn't make ${r.failed.length} line${r.failed.length === 1 ? "" : "s"}: ${r.failed[0]!.error}`, "error");
  else if (loud) host?.note(`Placeholder Speech made ${r.made.length} line${r.made.length === 1 ? "" : "s"}.`, "info");
  return r;
}

/** Which lines a request means: some lines by id, every line some characters speak (a voice change), a scene,
 *  or (none of them) the project. */
export interface SpeechRequestScope { scene?: string; ids?: string[]; characters?: string[] }
function idsFor(req: SpeechRequestScope): Set<string> | undefined {
  if (req.ids) return new Set(req.ids);
  if (!req.characters) return undefined;
  const loaded = project.loadedProject();
  const who = new Set(req.characters);
  return new Set(loaded ? runVoiceScript(loaded, { everything: true }).lines.filter((l) => who.has(l.character)).map((l) => l.id) : []);
}

/** Production > Placeholder Speech (a scene or the project), Make again (lines, forced), and a voice
 *  change's lines. */
export async function makeNow(req: SpeechRequestScope & { force?: boolean }): Promise<{ ok: boolean; message?: string }> {
  const ids = idsFor(req);
  const opts = {
    ...(req.scene ? { scene: req.scene } : {}),
    ...(ids ? { only: ids } : {}),
    ...(req.force && req.ids ? { force: new Set(req.ids) } : {}),
  };
  const r = await run(opts, true);
  return { ok: typeof r === "object" && !r.stopped };
}

/** How many lines a run would make, for a confirmation (a voice change, the whole project). */
export function countToMake(req: SpeechRequestScope): number {
  const loaded = project.loadedProject();
  if (!loaded) return 0;
  const ids = idsFor(req);
  const plan = planPlaceholderSpeech(loaded, { ...(req.scene ? { scene: req.scene } : {}), ...(ids ? { only: ids } : {}) });
  return plan?.tasks.length ?? 0;
}

// --- The settings page and the Cast editor ----------------------------------------------------------------------

/** The key file picker: the chosen path in the form it's stored in (`~/...` or relative, forward slashes). */
export async function chooseKeyFile(win: BrowserWindow): Promise<string | null> {
  const root = project.currentRoot();
  if (!root) return null;
  const r = await dialog.showOpenDialog(win, {
    title: "Choose the Google Cloud key file",
    message: "Choose the service-account key (a .json file) for Placeholder Speech. Keep it outside version control.",
    properties: ["openFile"], filters: [{ name: "Key file", extensions: ["json"] }],
  });
  const path = r.filePaths[0];
  return r.canceled || !path ? null : storedKeyPath(root, path);
}

/** Whether this machine can use the key: the stored path, else the environment. A line for the page. */
export function keyStatus(keyFile: string): { ok: boolean; message: string } {
  const root = project.currentRoot();
  if (!root) return { ok: false, message: "No project is open." };
  if (optedOut()) return { ok: false, message: "This machine is set not to make Placeholder Speech (Preferences)." };
  const key = resolveKeyFile(root, keyFile || undefined);
  if (!key.path) {
    return { ok: false, message: keyFile.trim()
      ? `There's no key at ${keyFile.trim()} on this machine, GOOGLE_APPLICATION_CREDENTIALS isn't set, and there's no gcloud sign-in. Speech made elsewhere still plays.`
      : "No key on this machine: set the key file, or GOOGLE_APPLICATION_CREDENTIALS, or sign in with gcloud auth application-default login. Speech made elsewhere still plays." };
  }
  let account: GoogleKey;
  try { account = readGoogleKey(key.path); } catch (e) { return { ok: false, message: describeSpeechError(e) }; }
  const where = key.source === "environment" ? " (from GOOGLE_APPLICATION_CREDENTIALS)" : key.source === "gcloud" ? " (gcloud's sign-in on this machine)" : "";
  // A service account says its project and account; a person's gcloud sign-in, the account and the project billed.
  const who = account.kind === "user"
    ? `your Google sign-in${account.account ? ` (${account.account})` : ""}, billed to project ${account.projectId}`
    : `project ${account.projectId}, account ${account.account}`;
  // A key inside the project's working copy can be committed by accident: say so. (Telling "ignored" needs
  // simple-vc-lib to report it; until then, inside the folder that holds the project is the test.)
  const checkout = dirname(resolve(root));
  const inside = resolve(key.path).startsWith(checkout + sep);
  if (inside) return { ok: false, message: `Ready: ${who}${where}. But the key sits beside your project, where version control can pick it up: move it outside, or make sure it's ignored.` };
  return { ok: true, message: `Ready: ${who}${where}.` };
}

/** One sentence in a voice, for the Cast editor's Hear button: the WAV bytes, or why not. */
export async function hear(voice: string, text: string): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; error: string }> {
  if (optedOut()) return { ok: false, error: "This machine is set not to make Placeholder Speech (Preferences)." };
  const key = keyFor();
  if (typeof key === "string") return { ok: false, error: key };
  if (!tokens || tokens.keyPath !== key.path) tokens = { keyPath: key.path, get: tokenSource(key.account) };
  try {
    const request = { text, voice, languageCode: voice.split("-").slice(0, 2).join("-") };
    const raw = await synthesize(await tokens.get(), request);
    return { ok: true, bytes: finishTake(raw, { text: textHash(text), request: requestHash(request) }) };
  } catch (e) { return { ok: false, error: describeSpeechError(e) }; }
}

/** The accent in use, for the Cast editor's default voices. */
export function accentInUse(): string | undefined {
  const p = project.loadedProject()?.project;
  return p ? placeholderAccentOf(p) : undefined;
}

// --- Takes for deleted lines (the proposal's section 6) ------------------------------------------------------------

/** A scratch take waits this long after its line was deleted before it goes. */
const SCRATCH_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

interface TakeInfo { status: string; path: string }
function takeOf(id: string): TakeInfo | undefined { return project.audioCurrentSnapshot()[id]; }
const stampOf = (path: string): { text: string | null; generated: string | null } => {
  try { const b = new Uint8Array(readFileSync(path)); return { text: readTextStamp(b), generated: readGeneratedStamp(b) }; }
  catch { return { text: null, generated: null }; }
};

/** Delete a take through version control (falling back to the disk), quietly. */
async function removeTake(path: string): Promise<boolean> {
  try { const r = await deleteFileAsync(path); if (r.success) return true; } catch { /* no VC layer */ }
  try { if (existsSync(path)) unlinkSync(path); return true; } catch { return false; }
}

/** A save's lines: those it removed start a clock (only lines deleted here, by an edit), those that came back
 *  stop theirs, and a removed line's take that matches a new line's words moves to it (a cut and paste gives
 *  the line a new id). Placeholder takes of removed lines go now; scratch takes wait a week. */
async function linesSaved(changed: string[], removed: string[]): Promise<void> {
  const loaded = project.loadedProject();
  if (!loaded || !pendingFor) return;
  const p = loaded.project;
  const scratch = p.scratchStatus;
  const ps = p.placeholderSpeech?.status;
  const m = readMemory();
  const deleted = (m.deleted ??= {})[pendingFor] ??= {};
  for (const id of changed) delete deleted[id]; // back (an undo, a revert): its take stays
  if (!removed.length) { writeMemory(m); return; }

  // Cut and paste: a removed line's take whose words match a new line with no take moves to the new id.
  const strings = sourceStrings(loaded);
  const homeless = changed.filter((id) => !takeOf(id) && strings[id] !== undefined);
  let moved = 0;
  for (const gone of removed) {
    const take = takeOf(gone);
    if (!take || (take.status !== scratch && take.status !== ps)) continue;
    const stamp = stampOf(take.path).text;
    if (!stamp) continue;
    const match = homeless.find((id) => textHash(strings[id]!) === stamp);
    if (!match) continue;
    const to = join(dirname(take.path), `${match}${take.path.slice(take.path.lastIndexOf("."))}`);
    let ok = false;
    try { ok = (await renameFileAsync(take.path, to)).success; } catch { /* no VC layer */ }
    if (!ok) { try { writeFileSync(to, readFileSync(take.path)); unlinkSync(take.path); ok = true; } catch { ok = false; } }
    if (ok) { moved++; homeless.splice(homeless.indexOf(match), 1); delete deleted[gone]; }
  }

  const now = new Date().toISOString();
  let removedNow = 0;
  for (const id of removed) {
    const take = takeOf(id);
    if (!take) continue;
    if (moved && !existsSync(take.path)) continue; // it moved with its line
    if (ps && take.status === ps && p.placeholderSpeech && stampOf(take.path).generated) { if (await removeTake(take.path)) removedNow++; }
    else if (scratch && take.status === scratch) deleted[id] = now;
  }
  writeMemory(m);
  if (moved || removedNow) project.rescanAudio();
}

/** Scratch takes whose line was deleted here more than a week ago, and is still gone: removed, said once. */
export async function sweepDeleted(): Promise<void> {
  const loaded = project.loadedProject();
  if (!loaded || !pendingFor) return;
  const scratch = loaded.project.scratchStatus;
  const m = readMemory();
  const deleted = m.deleted?.[pendingFor];
  if (!deleted || !Object.keys(deleted).length) return;
  const lines = manifestLineIds(loaded);
  let n = 0;
  for (const [id, when] of Object.entries(deleted)) {
    if (lines.has(id)) { delete deleted[id]; continue; } // back after all
    if (Date.now() - Date.parse(when) < SCRATCH_GRACE_MS) continue;
    const take = takeOf(id);
    if (scratch && take?.status === scratch && await removeTake(take.path)) n++;
    delete deleted[id];
  }
  writeMemory(m);
  if (n) { project.rescanAudio(); host?.note(`Removed ${n} scratch voice clip${n === 1 ? "" : "s"} for lines deleted over a week ago.`, "info"); }
}

/** Production > Remove Takes for Deleted Lines: what it would remove (every scratch and placeholder take whose
 *  line isn't in the project), by file name. */
export function takesForDeletedLines(): string[] {
  const loaded = project.loadedProject();
  if (!loaded) return [];
  const statuses = new Set([loaded.project.scratchStatus, loaded.project.placeholderSpeech?.status].filter((x): x is string => !!x));
  const lines = manifestLineIds(loaded);
  return Object.entries(project.audioCurrentSnapshot()).filter(([id, e]) => !lines.has(id) && statuses.has(e.status)).map(([, e]) => e.path);
}
export async function removeTakesForDeletedLines(): Promise<number> {
  let n = 0;
  for (const path of takesForDeletedLines()) if (await removeTake(path)) n++;
  if (pendingFor) { const m = readMemory(); if (m.deleted) delete m.deleted[pendingFor]; writeMemory(m); }
  project.rescanAudio();
  return n;
}
