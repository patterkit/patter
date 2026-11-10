// ---------------------------------------------------------------------------
// Placeholder Speech: stand-in speech for every spoken line, made by Google's Text-to-Speech from the line's
// words, into the folder of one recording status (`project.placeholderSpeech.status`). Shared by Patterpad and
// `patter placeholder-speech`, so the two make identical files.
//
// It sounds like a stand-in on purpose: Google's Standard voices only, 16 kHz mono, trimmed of silence as
// scratch takes are. Each file is a WAV stamped with PTRK (the text hash, so the editor flags it out of date)
// and PTPS (a hash of the whole request, so a changed voice or line remakes it, and so a file without it is a
// person's and never touched).
//
// No Google client library: the REST endpoint, with an OAuth token minted from the service account's key by a
// JWT signed with node:crypto.
// ---------------------------------------------------------------------------

import { createHash, createSign } from "node:crypto";
import { existsSync, readFileSync, openSync, readSync, closeSync, fstatSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { DEFAULT_CAPTION_CHARACTER, DEFAULT_CAPTION_DELIMITERS, DEFAULT_RECORDING_STATUSES, deriveRecordingFolders } from "@patterkit/model";
import type { CastMember, ProjectFile } from "@patterkit/model";
import { stripCaptions } from "@patterkit/dialect";
import { textHash, withStamps, readInfoChunks, accentForLanguage, defaultPlaceholderVoice, TEXT_STAMP, GENERATED_STAMP } from "@patterkit/core";
import { runVoiceScript } from "./voice-script.js";
import { scanAudio } from "./audio-index.js";
import type { AudioSnapshot } from "./audio-index.js";
import type { LoadedProject } from "./load.js";

/** The fixed output: low on purpose. */
export const PLACEHOLDER_SAMPLE_RATE = 16000;
const TRIM_THRESHOLD = 0.01;   // amplitude below this counts as silence (as scratch takes)
const TRIM_PAD_SECONDS = 0.05; // keep 50 ms either side

// --- The key -------------------------------------------------------------------------------------------------

/** Where the key file is: the project's path (relative to the `.patter` folder, or `~/...`), else the
 *  `GOOGLE_APPLICATION_CREDENTIALS` environment variable. `source` says which, for the settings page. */
export function resolveKeyFile(projectRoot: string, keyFile: string | undefined, env: Record<string, string | undefined> = process.env): { path?: string; source: "project" | "environment" | "none"; stored?: string } {
  const stored = keyFile?.trim();
  if (stored) {
    const path = expandKeyPath(projectRoot, stored);
    if (existsSync(path)) return { path, source: "project", stored };
  }
  const fromEnv = env["GOOGLE_APPLICATION_CREDENTIALS"]?.trim();
  if (fromEnv && existsSync(fromEnv)) return { path: fromEnv, source: "environment", ...(stored ? { stored } : {}) };
  return { source: "none", ...(stored ? { stored } : {}) };
}

/** A stored key path made absolute: a leading `~/` is the home folder on every system (Node expands it nowhere),
 *  a relative path is against the project folder, forward slashes work everywhere. */
export function expandKeyPath(projectRoot: string, stored: string): string {
  const p = stored.trim();
  if (p === "~" || p.startsWith("~/") || p.startsWith("~\\")) return join(homedir(), p.slice(2));
  return isAbsolute(p) ? p : resolve(projectRoot, p);
}

/** How a chosen key file should be stored: `~/...` under the home folder, else relative to the project folder,
 *  always with forward slashes, so one stored path works on every system. */
export function storedKeyPath(projectRoot: string, chosen: string): string {
  const home = homedir();
  const norm = (s: string): string => s.replace(/\\/g, "/");
  const c = norm(resolve(chosen));
  const h = norm(home);
  if (c === h || c.startsWith(h + "/")) return "~/" + c.slice(h.length + 1);
  const rel = relative(projectRoot, chosen);
  return norm(isAbsolute(rel) ? chosen : rel); // another drive on Windows: the absolute path
}

export interface ServiceAccount { projectId: string; clientEmail: string; privateKey: string }

/** Read a service-account key file. Throws, in plain words, when it isn't one. */
export function readServiceAccount(path: string): ServiceAccount {
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(path, "utf8")); } catch { throw new Error("That file isn't a Google key: it isn't readable JSON."); }
  const k = raw as Record<string, unknown>;
  if (k["type"] !== "service_account") throw new Error("That file isn't a service-account key (Google's \"JSON key\" for a service account).");
  const projectId = String(k["project_id"] ?? ""), clientEmail = String(k["client_email"] ?? ""), privateKey = String(k["private_key"] ?? "");
  if (!clientEmail || !privateKey) throw new Error("That key file is missing its account or its private key.");
  return { projectId, clientEmail, privateKey };
}

const b64url = (b: Buffer | string): string => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

/** A short-lived OAuth token for the key, minted from a signed JWT. */
export async function mintToken(key: ServiceAccount, fetchFn: typeof fetch = fetch): Promise<{ token: string; expiresAt: number }> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: key.clientEmail, scope: "https://www.googleapis.com/auth/cloud-platform", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const jwt = `${header}.${claims}.${b64url(signer.sign(key.privateKey))}`;
  const res = await fetchFn("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }).toString(),
  });
  if (!res.ok) throw new SpeechError(res.status === 400 || res.status === 401 ? "auth" : kindForStatus(res.status), `Google refused this key (${res.status}): ${await errorText(res)}`);
  const body = await res.json() as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new SpeechError("auth", "Google gave no token for this key.");
  return { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 - 60_000 };
}

// --- Errors --------------------------------------------------------------------------------------------------

/** Why a request failed. `auth` and `forbidden` stop a run; `rate` backs off; `offline` stops quietly. */
export type SpeechErrorKind = "auth" | "forbidden" | "rate" | "offline" | "bad-request" | "server";
export class SpeechError extends Error {
  constructor(readonly kind: SpeechErrorKind, message: string) { super(message); }
}
function kindForStatus(status: number): SpeechErrorKind {
  if (status === 401) return "auth";
  if (status === 403) return "forbidden";
  if (status === 429) return "rate";
  if (status >= 500) return "server";
  return "bad-request";
}
async function errorText(res: Response): Promise<string> {
  try {
    const j = await res.json() as { error?: { message?: string } | string; error_description?: string };
    if (typeof j.error === "object" && j.error?.message) return j.error.message;
    return j.error_description ?? (typeof j.error === "string" ? j.error : res.statusText);
  } catch { return res.statusText; }
}
/** A plain-words line for a stopped run (the settings page and the notice). */
export function describeSpeechError(e: unknown): string {
  if (e instanceof SpeechError) {
    if (e.kind === "forbidden" && /not been used|disabled|SERVICE_DISABLED/i.test(e.message)) return "Google refused this key: the Text-to-Speech service isn't switched on for its project.";
    if (e.kind === "forbidden" && /billing/i.test(e.message)) return "Google refused this key: its project has no billing account.";
    return e.message;
  }
  if (e instanceof TypeError || (e as { code?: string })?.code === "ENOTFOUND") return "Couldn't reach Google: no network connection.";
  return e instanceof Error ? e.message : String(e);
}
const isNetworkError = (e: unknown): boolean => e instanceof TypeError || ["ENOTFOUND", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "ECONNRESET"].includes((e as { code?: string; cause?: { code?: string } })?.code ?? (e as { cause?: { code?: string } })?.cause?.code ?? "");

// --- Making one take -----------------------------------------------------------------------------------------

export interface SpeechRequest { text: string; voice: string; languageCode: string }

/** The request hash stamped as PTPS: everything that shapes the audio. */
export function requestHash(r: SpeechRequest): string {
  const shape = { text: r.text, voice: r.voice, languageCode: r.languageCode, encoding: "LINEAR16", sampleRate: PLACEHOLDER_SAMPLE_RATE, trim: TRIM_PAD_SECONDS };
  return createHash("sha256").update(JSON.stringify(shape)).digest("hex").slice(0, 16);
}

/** Ask Google for one line's speech: the raw WAV it returns (LINEAR16 comes with a WAV header). */
export async function synthesize(token: string, r: SpeechRequest, fetchFn: typeof fetch = fetch): Promise<Uint8Array> {
  let res: Response;
  try {
    res = await fetchFn("https://texttospeech.googleapis.com/v1/text:synthesize", {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ input: { text: r.text }, voice: { languageCode: r.languageCode, name: r.voice }, audioConfig: { audioEncoding: "LINEAR16", sampleRateHertz: PLACEHOLDER_SAMPLE_RATE } }),
    });
  } catch (e) {
    if (isNetworkError(e)) throw new SpeechError("offline", "Couldn't reach Google: no network connection.");
    throw e;
  }
  if (!res.ok) throw new SpeechError(kindForStatus(res.status), `Google refused the request (${res.status}): ${await errorText(res)}`);
  const body = await res.json() as { audioContent?: string };
  if (!body.audioContent) throw new SpeechError("server", "Google sent no audio.");
  return new Uint8Array(Buffer.from(body.audioContent, "base64"));
}

/** Trim leading and trailing silence from a 16-bit mono WAV (as scratch takes are), and stamp it. */
export function finishTake(wav: Uint8Array, stamps: { text: string; request: string }): Uint8Array {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const ascii = (at: number): string => String.fromCharCode(wav[at]!, wav[at + 1]!, wav[at + 2]!, wav[at + 3]!);
  let fmtAt = -1, dataAt = -1, dataLen = 0;
  for (let pos = 12; pos + 8 <= wav.length;) {
    const id = ascii(pos), len = view.getUint32(pos + 4, true);
    if (id === "fmt ") fmtAt = pos + 8;
    if (id === "data") { dataAt = pos + 8; dataLen = Math.min(len, wav.length - dataAt); }
    pos += 8 + len + (len % 2);
  }
  if (fmtAt < 0 || dataAt < 0) throw new SpeechError("server", "Google's audio wasn't a WAV.");
  const channels = view.getUint16(fmtAt + 2, true), rate = view.getUint32(fmtAt + 4, true), bits = view.getUint16(fmtAt + 14, true);
  if (bits !== 16) throw new SpeechError("server", "Google's audio wasn't 16-bit.");
  const frames = Math.floor(dataLen / (2 * channels));
  const amp = (i: number): number => { let m = 0; for (let c = 0; c < channels; c++) m = Math.max(m, Math.abs(view.getInt16(dataAt + (i * channels + c) * 2, true)) / 32768); return m; };
  const pad = Math.floor(rate * TRIM_PAD_SECONDS);
  let start = 0, end = frames - 1;
  for (let i = 0; i < frames; i++) if (amp(i) > TRIM_THRESHOLD) { start = Math.max(0, i - pad); break; }
  for (let i = frames - 1; i >= start; i--) if (amp(i) > TRIM_THRESHOLD) { end = Math.min(frames - 1, i + pad); break; }
  const pcm = wav.subarray(dataAt + start * 2 * channels, dataAt + (end + 1) * 2 * channels);
  const out = new Uint8Array(44 + pcm.length);
  const o = new DataView(out.buffer);
  const put = (at: number, s: string): void => { for (let i = 0; i < 4; i++) out[at + i] = s.charCodeAt(i); };
  put(0, "RIFF"); o.setUint32(4, 36 + pcm.length, true); put(8, "WAVE");
  put(12, "fmt "); o.setUint32(16, 16, true); o.setUint16(20, 1, true); o.setUint16(22, channels, true);
  o.setUint32(24, rate, true); o.setUint32(28, rate * channels * 2, true); o.setUint16(32, channels * 2, true); o.setUint16(34, 16, true);
  put(36, "data"); o.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return withStamps(out, [[TEXT_STAMP, stamps.text], [GENERATED_STAMP, stamps.request]]);
}

/** The generated stamp of a file on disk (PTPS, or Patterstage's PSVT), read from its chunk headers only;
 *  null when it has none or can't be read. */
export function readGeneratedStampFromFile(path: string): string | null {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const size = fstatSync(fd).size;
    const head = Buffer.alloc(12); readSync(fd, head, 0, 12, 0);
    if (head.toString("ascii", 0, 4) !== "RIFF" || head.toString("ascii", 8, 12) !== "WAVE") return null;
    const hdr = Buffer.alloc(8);
    for (let pos = 12; pos + 8 <= size;) {
      readSync(fd, hdr, 0, 8, pos);
      const len = hdr.readUInt32LE(4);
      if (hdr.toString("ascii", 0, 4) === "LIST" && len <= 64 * 1024) {
        const list = Buffer.alloc(8 + len); readSync(fd, list, 0, list.length, pos);
        const info = readInfoChunks(new Uint8Array(Buffer.concat([head, list])));
        const g = info.get(GENERATED_STAMP) ?? info.get("PSVT");
        if (g) return g;
      }
      pos += 8 + len + (len % 2);
    }
    return null;
  } catch { return null; }
  finally { if (fd !== undefined) closeSync(fd); }
}

// --- Planning ------------------------------------------------------------------------------------------------

/** One line to make. */
export interface PlaceholderTask {
  beatId: string;
  character: string;
  request: SpeechRequest;
  /** The PTPS value it will carry. */
  hash: string;
  /** The PTRK value: the line's text hash. */
  textHash: string;
  /** Where it goes. */
  path: string;
}

/** Why a line was left alone. */
export type PlaceholderSkip = "unchanged" | "better" | "not-ours" | "no-voice" | "unspoken";

export interface PlaceholderPlan {
  /** The status and folder speech goes in. */
  status: string;
  folder: string;
  accent: string | undefined;
  tasks: PlaceholderTask[];
  skipped: Partial<Record<PlaceholderSkip, number>>;
}

export interface PlanOptions {
  /** Only these lines (Patterpad's "edited this session"); absent, every spoken line. */
  only?: Set<string>;
  /** Only this scene, by id. */
  scene?: string;
  /** Remake these lines even when their stamp matches (Make again). */
  force?: Set<string> | "all";
  /** The current audio snapshot; read from disk when absent. */
  snapshot?: AudioSnapshot;
}

/** The voice a character speaks with: their own, else the default from the name and gender. */
export function voiceFor(cast: CastMember[] | undefined, character: string, accent: string | undefined): string | undefined {
  const m = cast?.find((c) => c.name === character);
  return m?.placeholderVoice ?? defaultPlaceholderVoice(character, accent, m?.gender);
}

/** The accent in use: the project's choice, else the one its main language implies. */
export function placeholderAccentOf(p: ProjectFile): string | undefined {
  return p.placeholderSpeech?.accent ?? accentForLanguage(p.locales?.default);
}

/** Work out what to make: every spoken line (or the ones asked for) whose placeholder take is missing or no
 *  longer matches its request, skipping lines with a take on a higher status (even an out-of-date one: speech
 *  under it would never be heard), files in the folder that a person put there, and lines with no voice.
 *  Undefined when the project doesn't have Placeholder Speech on with Audio Folders. */
export function planPlaceholderSpeech(loaded: LoadedProject, opts: PlanOptions = {}): PlaceholderPlan | undefined {
  const p = loaded.project;
  const ps = p.placeholderSpeech;
  if (!ps || !p.audioFolders || !p.audioRoot?.trim()) return undefined;
  const ladder = p.recordingStatuses ?? DEFAULT_RECORDING_STATUSES;
  const rung = deriveRecordingFolders(p.audioRoot, ladder).find((r) => r.name === ps.status);
  if (!rung?.folder) return undefined;
  const folder = resolve(loaded.root, rung.folder);
  const rank = new Map(ladder.map((r, i) => [r.name, i]));
  const myRank = rank.get(ps.status) ?? 0;
  const accent = placeholderAccentOf(p);
  const snap = opts.snapshot ?? scanAudio(loaded) ?? {};
  const caps = { open: p.closedCaptions?.open ?? DEFAULT_CAPTION_DELIMITERS.open, close: p.closedCaptions?.close ?? DEFAULT_CAPTION_DELIMITERS.close };
  const captionCharacter = p.closedCaptions?.character ?? DEFAULT_CAPTION_CHARACTER;
  const sceneIds = opts.scene ? new Set([opts.scene]) : undefined;
  const plan: PlaceholderPlan = { status: ps.status, folder, accent, tasks: [], skipped: {} };
  const skip = (why: PlaceholderSkip): void => { plan.skipped[why] = (plan.skipped[why] ?? 0) + 1; };
  const script = runVoiceScript(loaded, { everything: true });
  const inScene = sceneIds ? lineIdsInScenes(loaded, sceneIds) : undefined;
  for (const line of script.lines) {
    if (opts.only && !opts.only.has(line.id)) continue;
    if (inScene && !inScene.has(line.id)) continue;
    const text = stripCaptions(line.text, caps.open, caps.close).replace(/\s+/g, " ").trim();
    if (!text || line.character === captionCharacter) { skip("unspoken"); continue; }
    const have = snap[line.id];
    if (have && (rank.get(have.status) ?? 0) > myRank) { skip("better"); continue; }
    const voice = voiceFor(p.cast, line.character, accent);
    if (!voice) { skip("no-voice"); continue; }
    const request: SpeechRequest = { text, voice, languageCode: voice.split("-").slice(0, 2).join("-") };
    const hash = requestHash(request);
    const forced = opts.force === "all" || opts.force?.has(line.id);
    if (have && have.status === ps.status) {
      const stamp = have.generated ?? readGeneratedStampFromFile(have.path);
      if (!stamp) { skip("not-ours"); continue; }
      if (stamp === hash && !forced) { skip("unchanged"); continue; }
    }
    plan.tasks.push({ beatId: line.id, character: line.character, request, hash, textHash: textHash(line.text), path: join(folder, `${line.id}.wav`) });
  }
  return plan;
}

function lineIdsInScenes(loaded: LoadedProject, scenes: Set<string>): Set<string> {
  const ids = new Set<string>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const n = node as { id?: unknown; kind?: unknown };
    if (typeof n.id === "string") ids.add(n.id);
    for (const v of Object.values(node as Record<string, unknown>)) if (v && typeof v === "object") walk(v);
  };
  for (const s of loaded.scenes) if (scenes.has(s.id)) walk(s);
  return ids;
}

// --- Running ---------------------------------------------------------------------------------------------------

export interface RunOptions {
  /** A fresh token when asked (minted once, then reused until near expiry). */
  token(): Promise<string>;
  /** Write a finished take; return false to say it was skipped (a file someone else has open). */
  write(path: string, bytes: Uint8Array): Promise<boolean>;
  onProgress?(done: number, total: number, task: PlaceholderTask): void;
  signal?: AbortSignal;
  concurrency?: number;
  fetchFn?: typeof fetch;
}
export interface RunResult { made: string[]; failed: Array<{ beatId: string; error: string }>; skippedLocked: string[]; stopped?: { kind: SpeechErrorKind; message: string }; notTried: number }

/** Make the planned takes, two at a time. Bad keys, a refused project, and no network stop the run with one
 *  reason; a rate limit backs off and retries, and stops only if it persists; other failures are counted. */
export async function runPlaceholderSpeech(tasks: PlaceholderTask[], o: RunOptions): Promise<RunResult> {
  const result: RunResult = { made: [], failed: [], skippedLocked: [], notTried: 0 };
  let next = 0, done = 0;
  const worker = async (): Promise<void> => {
    while (next < tasks.length && !result.stopped && !o.signal?.aborted) {
      const t = tasks[next++]!;
      let wait = 2000;
      for (let attempt = 0; ; attempt++) {
        try {
          const raw = await synthesize(await o.token(), t.request, o.fetchFn);
          const bytes = finishTake(raw, { text: t.textHash, request: t.hash });
          if (await o.write(t.path, bytes)) result.made.push(t.beatId); else result.skippedLocked.push(t.beatId);
          break;
        } catch (e) {
          const kind = e instanceof SpeechError ? e.kind : isNetworkError(e) ? "offline" : undefined;
          if (kind === "rate" && attempt < 4) { await new Promise((r) => setTimeout(r, wait)); wait *= 2; continue; }
          if (kind === "auth" || kind === "forbidden" || kind === "offline" || kind === "rate") {
            result.stopped ??= { kind, message: describeSpeechError(e) };
          } else result.failed.push({ beatId: t.beatId, error: describeSpeechError(e) });
          break;
        }
      }
      done++; // counted apart: an absent onProgress would skip evaluating its arguments
      o.onProgress?.(done, tasks.length, t);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, o.concurrency ?? 2) }, () => worker()));
  result.notTried = tasks.length - done;
  return result;
}

/** A token source for a key: mints once, refreshes near expiry. */
export function tokenSource(key: ServiceAccount, fetchFn?: typeof fetch): () => Promise<string> {
  let cached: { token: string; expiresAt: number } | undefined;
  let pending: Promise<{ token: string; expiresAt: number }> | undefined;
  return async () => {
    if (cached && cached.expiresAt > Date.now()) return cached.token;
    pending ??= mintToken(key, fetchFn).finally(() => { pending = undefined; });
    cached = await pending;
    return cached.token;
  };
}
