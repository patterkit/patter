// Placeholder Speech (patterkit design/proposals/placeholder-speech.md): planning what to make, the request
// and its stamps, trimming, and a run against a fake Google. No network.
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { loadProject, runReport, planPlaceholderSpeech, runPlaceholderSpeech, finishTake, requestHash, expandKeyPath, storedKeyPath, resolveKeyFile, readServiceAccount, tokenSource, describeSpeechError, SpeechError } from "../src/index.js";
import { readTextStamp, readGeneratedStamp, textHash, withStamps, defaultPlaceholderVoice } from "@patterkit/core";

const LADDER = [{ name: "missing" }, { name: "placeholder" }, { name: "scratch" }, { name: "recorded" }];
const ON = { voiced: true, trackAudioStatus: true, audioFolders: true, audioRoot: "audio", recordingStatuses: LADDER,
  placeholderSpeech: { status: "placeholder", accent: "en-GB" }, cast: [{ name: "TAM", gender: "male" }, { name: "ANNA", placeholderVoice: "en-GB-Standard-C" }, { name: "SFX" }] };

function makeProject(extra: object = ON): string {
  const dir = mkdtempSync(join(tmpdir(), "patter-ps-"));
  for (const d of ["scenes", "loc/en"]) mkdirSync(join(dir, d), { recursive: true });
  const w = (p: string, o: unknown) => writeFileSync(join(dir, p), JSON.stringify(o));
  w("game.patterproj", { schema: "patter/project@0", project: { id: "a", name: "A" }, locales: { default: "en", all: ["en"] }, ...extra });
  w("scenes/one.patterflow", { schema: "patter/flow@0", scene: { id: "s1", type: "scene", name: "S", blocks: [
    { id: "b1", type: "block", name: "M", children: [{ id: "n1", type: "snippet", beats: [
      { id: "L1", kind: "line", character: "TAM" }, { id: "L2", kind: "line", character: "ANNA" },
      { id: "L3", kind: "line", character: "SFX" }, { id: "L4", kind: "line", character: "TAM" }, { id: "T1", kind: "text" },
    ], jump: { to: "END" } }] },
  ] } });
  w("loc/en/one.patterloc", { schema: "patter/strings@0", scene: "s1", locale: "en", strings: { L1: "Hello [coughs] there.", L2: "Bye.", L3: "[door slams]", L4: "Again.", T1: "Rain falls." } });
  return dir;
}

/** A 16 kHz mono WAV: silence, a burst, silence. */
function googleWav(): Uint8Array {
  const frames = 16000, data = new Int16Array(frames);
  for (let i = 6000; i < 10000; i++) data[i] = Math.round(Math.sin(i / 5) * 12000);
  const out = new Uint8Array(44 + frames * 2), v = new DataView(out.buffer);
  const put = (at: number, s: string): void => { for (let i = 0; i < 4; i++) out[at + i] = s.charCodeAt(i); };
  put(0, "RIFF"); v.setUint32(4, 36 + frames * 2, true); put(8, "WAVE"); put(12, "fmt "); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  put(36, "data"); v.setUint32(40, frames * 2, true); out.set(new Uint8Array(data.buffer), 44);
  return out;
}

describe("Placeholder Speech: planning", () => {
  it("makes every spoken line, with captions taken out, skipping the caption character and text", () => {
    const plan = planPlaceholderSpeech(loadProject(makeProject()))!;
    expect(plan.status).toBe("placeholder");
    expect(plan.tasks.map((t) => t.beatId)).toEqual(["L1", "L2", "L4"]);
    expect(plan.tasks[0]!.request.text).toBe("Hello there.");
    expect(plan.tasks[0]!.request.voice).toBe(defaultPlaceholderVoice("TAM", "en-GB", "male"));
    expect(plan.tasks[0]!.request.languageCode).toBe("en-GB");
    expect(plan.tasks[1]!.request.voice).toBe("en-GB-Standard-C"); // ANNA's own
    expect(plan.tasks[0]!.textHash).toBe(textHash("Hello [coughs] there."));
    expect(plan.skipped.unspoken).toBe(1);
  });

  it("is off without Audio Folders or the setting", () => {
    expect(planPlaceholderSpeech(loadProject(makeProject({ ...ON, placeholderSpeech: undefined })))).toBeUndefined();
    expect(planPlaceholderSpeech(loadProject(makeProject({ ...ON, audioFolders: false })))).toBeUndefined();
  });

  it("skips lines with a better take (even out of date), unchanged takes, and files a person put there", () => {
    const dir = makeProject();
    for (const f of ["placeholder", "scratch"]) mkdirSync(join(dir, "audio", f), { recursive: true });
    writeFileSync(join(dir, "audio/scratch/L1.wav"), withStamps(googleWav(), [["PTRK", "stale!"]]));
    const plan0 = planPlaceholderSpeech(loadProject(dir))!;
    const l2 = plan0.tasks.find((t) => t.beatId === "L2")!;
    writeFileSync(join(dir, "audio/placeholder/L2.wav"), withStamps(googleWav(), [["PTRK", l2.textHash], ["PTPS", l2.hash]]));
    writeFileSync(join(dir, "audio/placeholder/L4.wav"), withStamps(googleWav(), [["PTRK", "x"]])); // no PTPS: a person's
    const plan = planPlaceholderSpeech(loadProject(dir))!;
    expect(plan.tasks).toEqual([]);
    expect(plan.skipped).toMatchObject({ better: 1, unchanged: 1, "not-ours": 1 });
    // Make again remakes an unchanged one; a changed voice remakes too.
    expect(planPlaceholderSpeech(loadProject(dir), { force: new Set(["L2"]) })!.tasks.map((t) => t.beatId)).toEqual(["L2"]);
    expect(planPlaceholderSpeech(loadProject(dir), { only: new Set(["L1"]) })!.tasks).toEqual([]);
  });

  it("hashes the whole request, so a voice change or a rewording remakes", () => {
    const a = requestHash({ text: "Hi.", voice: "en-GB-Standard-A", languageCode: "en-GB" });
    expect(requestHash({ text: "Hi.", voice: "en-GB-Standard-B", languageCode: "en-GB" })).not.toBe(a);
    expect(requestHash({ text: "Hi!", voice: "en-GB-Standard-A", languageCode: "en-GB" })).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("Placeholder Speech: the take", () => {
  it("trims silence to 50 ms either side and stamps PTRK and PTPS", () => {
    const take = finishTake(googleWav(), { text: "abcdef", request: "0123456789abcdef" });
    expect(readTextStamp(take)).toBe("abcdef");
    expect(readGeneratedStamp(take)).toBe("0123456789abcdef");
    const dataLen = new DataView(take.buffer).getUint32(40, true);
    expect(dataLen / 2).toBeGreaterThanOrEqual(4000 + 1500);
    expect(dataLen / 2).toBeLessThanOrEqual(4000 + 1700);
  });
});

describe("Placeholder Speech: the key", () => {
  it("expands ~/ on every system, resolves relative paths from the project, and stores forward slashes", () => {
    expect(expandKeyPath("/p/game.patter", "~/.patter/k.json")).toBe(join(homedir(), ".patter/k.json"));
    expect(expandKeyPath("/p/game.patter", "../keys/k.json")).toBe(join("/p", "keys/k.json"));
    expect(storedKeyPath("/p/game.patter", join(homedir(), ".patter", "k.json"))).toBe("~/.patter/k.json");
    expect(storedKeyPath("/p/game.patter", "/p/keys/k.json")).toBe("../keys/k.json");
  });

  it("falls back to the environment, and reads a service account", () => {
    const dir = mkdtempSync(join(tmpdir(), "patter-key-"));
    const keyPath = join(dir, "k.json");
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
    writeFileSync(keyPath, JSON.stringify({ type: "service_account", project_id: "demo", client_email: "x@demo.iam.gserviceaccount.com", private_key: privateKey }));
    expect(resolveKeyFile(dir, "missing.json", { GOOGLE_APPLICATION_CREDENTIALS: keyPath })).toMatchObject({ path: keyPath, source: "environment" });
    expect(resolveKeyFile(dir, "k.json", {})).toMatchObject({ path: keyPath, source: "project" });
    expect(resolveKeyFile(dir, undefined, {}).source).toBe("none");
    expect(readServiceAccount(keyPath).projectId).toBe("demo");
    writeFileSync(join(dir, "bad.json"), JSON.stringify({ type: "authorized_user" }));
    expect(() => readServiceAccount(join(dir, "bad.json"))).toThrow(/service-account/);
  });
});

describe("Placeholder Speech: a run against a fake Google", () => {
  const key = (() => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
    return { projectId: "demo", clientEmail: "x@demo", privateKey };
  })();
  const fakeGoogle = (synth: (body: { voice: { name: string } }) => Response): typeof fetch => (async (url: string | URL, init?: RequestInit) => {
    if (String(url).includes("oauth2")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
    expect((init!.headers as Record<string, string>)["authorization"]).toBe("Bearer tok");
    return synth(JSON.parse(String(init!.body)));
  }) as typeof fetch;

  it("makes and writes each take, with one token", async () => {
    const dir = makeProject();
    const plan = planPlaceholderSpeech(loadProject(dir))!;
    let mints = 0;
    const fetchFn = fakeGoogle(() => new Response(JSON.stringify({ audioContent: Buffer.from(googleWav()).toString("base64") }), { status: 200 }));
    const counting = (async (u: string | URL, i?: RequestInit) => { if (String(u).includes("oauth2")) mints++; return fetchFn(u, i); }) as typeof fetch;
    const written: string[] = [];
    mkdirSync(plan.folder, { recursive: true });
    const r = await runPlaceholderSpeech(plan.tasks, { token: tokenSource(key, counting), fetchFn: counting, write: async (p, b) => { writeFileSync(p, b); written.push(p); return true; } });
    expect(r.made.sort()).toEqual(["L1", "L2", "L4"]);
    expect(mints).toBe(1);
    expect(readGeneratedStamp(new Uint8Array(readFileSync(written[0]!)))).toMatch(/^[0-9a-f]{16}$/);
    expect(planPlaceholderSpeech(loadProject(dir))!.tasks).toEqual([]); // everything now unchanged
  });

  it("stops the whole run with one reason when Google refuses the project", async () => {
    const plan = planPlaceholderSpeech(loadProject(makeProject()))!;
    const fetchFn = fakeGoogle(() => new Response(JSON.stringify({ error: { message: "Cloud Text-to-Speech API has not been used in project demo before or it is disabled." } }), { status: 403 }));
    const r = await runPlaceholderSpeech(plan.tasks, { token: tokenSource(key, fetchFn), fetchFn, concurrency: 1, write: async () => true });
    expect(r.stopped?.kind).toBe("forbidden");
    expect(r.stopped?.message).toMatch(/isn't switched on/);
    expect(r.made).toEqual([]);
    expect(r.notTried).toBe(2);
  });

  it("says no network in plain words", () => {
    expect(describeSpeechError(new SpeechError("offline", "Couldn't reach Google: no network connection."))).toMatch(/no network/);
  });
});

describe("Placeholder Speech: the report", () => {
  it("counts lines with only placeholder speech as still to record", () => {
    const dir = makeProject();
    mkdirSync(join(dir, "audio/placeholder"), { recursive: true });
    mkdirSync(join(dir, "audio/recorded"), { recursive: true });
    writeFileSync(join(dir, "audio/placeholder/L1.wav"), "x");
    writeFileSync(join(dir, "audio/recorded/L2.wav"), "x");
    const loaded = loadProject(dir);
    const status = new Map([["L1", "placeholder"], ["L2", "recorded"]]);
    const r = runReport(loaded, status);
    expect(r.toRecord).toBe(3); // L1 placeholder, L3 and L4 missing; L2 recorded
    expect(runReport(loadProject(makeProject({ ...ON, placeholderSpeech: undefined }))).toRecord).toBeUndefined();
  });
});
