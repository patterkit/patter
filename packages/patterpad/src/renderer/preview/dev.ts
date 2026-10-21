// DEV-ONLY UI preview. Lets the renderer run in a plain browser (no Electron) by stubbing the
// window.patter bridge with canned data, so the shell layout / CSS / states can be eyeballed. NOT
// part of the Electron build (electron-vite's renderer entry is the real index.html). Drive states
// with ?view=welcome / ?view=firstrun in the URL; default is the project workspace.
import tavernFlow from "../../../../patterpad-surface/test/fixtures/tavern.patterflow?raw";
import locSource from "../../../../patterpad-surface/test/fixtures/tavern.patterloc?raw";
// The REAL vendored dictionaries (#177) so the preview's live spell-check engine actually works.
import enGbAff from "../../../resources/dictionaries/en-GB/index.aff?raw";
import enGbDic from "../../../resources/dictionaries/en-GB/index.dic?raw";
import enUsAff from "../../../resources/dictionaries/en-US/index.aff?raw";
import enUsDic from "../../../resources/dictionaries/en-US/index.dic?raw";
import { createFlowFollower } from "../../shared/debug-follow.js";
// Patter extensions: the conformance suite's probe manifest, taken by the preview project, with data on the
// tavern's nodes, so the inspector and Project Settings draw every field type an extension can declare.
import probeManifestText from "../../../../conformance/fixtures/probe.extension.json?raw";
import { parseManifest } from "@wildwinter/toolkit/extensions";
import { extensionDtos } from "../../shared/extensions.js";
import type { ProjectFile } from "@patterkit/model";
const DICT_BYTES: Record<string, { aff: string; dic: string }> = {
  "en-GB": { aff: enGbAff, dic: enGbDic },
  "en-US": { aff: enUsAff, dic: enUsDic },
};

// The fixture with one speaker qualifier on a line, so the preview shows the cue's BARKEEP (O.S.), the
// inspector's Qualifier dropdown, and the run rule (a new BARKEEP line after it takes O.S. too), and a mood.
const flowSource = tavernFlow.replace('direction: "wiping a glass" }', 'direction: "wiping a glass", qualifier: "os", gameData: { mood: "hostile" } }');

// The probe, taken at an older version than its manifest (so the problems bar has a project-level extension
// problem, which opens its Settings section).
// The fields window's preview link (fields-dev.ts): this tab plays main's part.
const fieldsChannel = new BroadcastChannel("patterpad-fields-preview");
let lastFieldsState: unknown = null;
let onFieldsCommit: ((id: string, extension: string, field: string, value: unknown) => void) | undefined;
let onFieldsFollow: ((on: boolean) => void) | undefined;
fieldsChannel.onmessage = (e: MessageEvent<{ t: string; id?: string; extension?: string; field?: string; value?: unknown; on?: boolean }>) => {
  const m = e.data;
  if (m.t === "hello" && lastFieldsState) fieldsChannel.postMessage({ t: "state", state: lastFieldsState });
  else if (m.t === "commit") onFieldsCommit?.(m.id!, m.extension!, m.field!, m.value);
  else if (m.t === "follow") onFieldsFollow?.(m.on === true);
};
const PROBE_TAKEN = { probe: { version: "1.0.0" } };
const probeProject = { values: { studio: "Wildwinter" } as Record<string, unknown> };
const probeDtos = (): ReturnType<typeof extensionDtos> => extensionDtos(
  { project: { id: "proj_tavern", name: "The Tavern" }, extensions: PROBE_TAKEN } as unknown as ProjectFile,
  new Map([["probe", parseManifest(probeManifestText)]]),
  new Map([["probe", { entries: { project: { proj_tavern: probeProject.values } } }]]),
);
// The tavern's probe shard: every type on the greeting (its cue missing the sound it requires, its act a
// stage since renamed, its next line in another scene), a key the probe no longer declares on the second
// line, and a value for each other kind of node.
const probeShard = JSON.stringify({
  schema: "patter/extension@0", extension: "probe", scene: "scn_tavern",
  entries: {
    scene: { scn_tavern: { theme: "smoke and ale" } },
    block: { intro: { pace: 2 } },
    snippet: { sn_intro_greet: { weight: 3 } },
    text: { T_scene: { style: "far" } },
    gameEvent: { A_focus: { cue: "camera" } },
    option: { opt_work: { icon: "coin" } },
    line: {
      L_greet: {
        note: "Ring the bell twice.", draft: "Maybe three times.", weight: 4, loud: true, tone: "tense", marks: ["night"],
        act: "opening", next: "L_street_call", cue: { gain: 0.5 },
        perf: { ANNA: { expression: "frown", look: "at the door" } },
        beats: [{ id: "b1", at: 1 }, { id: "b2", at: 3 }], words: ["salt", "rope"],
      },
      L_greet2: { colour: "red" },
    },
  },
}, null, 2);
// ?view=ext opens the tavern writable (it's locked by bo@studio otherwise), so the rows can be edited;
// ?view=extlock does too, with the probe's data for the scene and the project held by bob.
const extView = ["ext", "extlock"].includes(new URLSearchParams(location.search).get("view") ?? "");
const extLock = new URLSearchParams(location.search).get("view") === "extlock";

// The project's speaker qualifiers (the defaults, as a project that never edited them reads).
const QUALIFIERS = [
  { gameId: "vo", name: "V.O.", description: "Voice-over: the character isn't in the scene (a thought, narration, a voice in the ear)." },
  { gameId: "os", name: "O.S.", description: "Off-screen: the character is there, but not seen (the next room, behind a door)." },
  { gameId: "radio", name: "RADIO", description: "Heard through a radio, a phone, or a loudspeaker." },
];

const project = {
  name: "The Tavern",
  root: "/Users/ian/Projects/the-tavern.patter",
  formatting: true,
  voiced: true, // a voiced demo - audio status / folders / scratch only surface when this is on (#206)
  localiseDialogueText: false,
  trackAudioStatus: true, // audio-status tracking on (voiced + not opted out) -> the inspector Audio row shows
  cast: ["BARKEEP", "ANNA", "BO"],
  qualifiers: QUALIFIERS,
  padAfterDefault: 0.6, // line padding: the built-in default, as a project that sets none reads
  gameDataFields: {
    scene: [{ name: "music", type: "text", default: "tavern-loop", purpose: "Background music cue id for this scene." }],
    line: [{ name: "mood", type: "enum", values: ["calm", "tense", "hostile"], purpose: "Facial-animation mood for this line." }],
  },
  scenes: [
    { id: "scn_tavern", name: "The Tavern", blocks: [{ id: "intro", name: "Intro" }, { id: "menu", name: "Menu" }] },
    { id: "scn_street", name: "Street", blocks: [] },
  ],
  sceneIds: ["scn_tavern", "scn_street"],
  dictionary: { language: "en-GB", words: ["Patterpad", "Eldoria"], ignore: [], enabled: true }, // spell-check (#177)
  // The writing-status ladder with theme-palette colour slots (#196): drives the surface "Status" submenu,
  // the gutter badges, and the inspector dropdown in the preview.
  writingStatuses: [
    { name: "stub", colour: 0 }, { name: "draft 1", colour: 1 }, { name: "draft 2", colour: 2 },
    { name: "edited", readyToRecord: true, colour: 4 }, { name: "final", readyToShip: true, colour: 9 },
  ],
  // The recording-status ladder (#206) - drives the inspector "Recording" dropdown on dialogue lines.
  recordingStatuses: [
    { name: "missing", colour: 0 }, { name: "scratch", colour: 2 }, { name: "recorded", colour: 4 }, { name: "final", colour: 9 },
  ],
  // Audio Folders mode (#206): ?view=audiofolders flips this on so the recording row renders the read-only
  // folder-derived chip (fed by the fake `audioCurrent` snapshot below) instead of the manual dropdown.
  audioFolders: new URLSearchParams(location.search).get("view") === "audiofolders",
  // Audio Folders root (#206): the single folder each rung's subfolder derives under.
  audioRoot: new URLSearchParams(location.search).get("view") === "audiofolders" ? "../audio" : null,
  // Scratch recording (#224): in folder mode, the "scratch" rung receives in-app takes - so the inspector
  // offers "● Record" on any line at/below it (missing / scratch).
  scratchStatus: new URLSearchParams(location.search).get("view") === "audiofolders" ? "scratch" : null,
  // Patter extensions (OpenedProject.extensions): the probe, and a node in another scene its references name.
  extensions: probeDtos(),
  extensionNodes: { line: [{ id: "L_street_call", label: "ANNA: Over here!", scene: "scn_street" }] },
};
// A fake folder-derived index for the preview: a couple of resolved dialogue lines, the rest implicitly missing.
const FAKE_AUDIO_INDEX: Record<string, { status: string; path: string; textHash?: string }> = {
  L_greet: { status: "recorded", path: "/audio/recorded/L_greet.wav" },
  L_bo_reply: { status: "scratch", path: "/audio/scratch/L_bo_reply.mp3", textHash: "0" }, // never matches -> "take out of date" badge
};
const recents = [
  { path: "/Users/ian/Projects/the-tavern.patter", name: "The Tavern" },
  { path: "/Users/ian/Projects/the-heist.patter", name: "The Heist" },
];

// A tiny fake index for the two search palettes. Content fields (name / gameId / text) feed the ⌘F
// search; the opaque id feeds "Go to ID". Mirrors the ops index shape.
const SEARCH_INDEX = [
  { id: "scn_tavern", kind: "scene", name: "The Tavern", gameId: "the-tavern", location: ["The Tavern"], sceneId: "scn_tavern" },
  { id: "scn_street", kind: "scene", name: "Street", gameId: "street", location: ["Street"], sceneId: "scn_street" },
  { id: "blk_intro", kind: "block", name: "Intro", gameId: "intro", location: ["The Tavern", "Intro"], sceneId: "scn_tavern" },
  { id: "blk_menu", kind: "block", name: "Menu", gameId: "menu", location: ["The Tavern", "Menu"], sceneId: "scn_tavern" },
  { id: "L_greet", kind: "beat", text: "What'll it be, stranger?", location: ["The Tavern", "Intro"], sceneId: "scn_tavern" },
  { id: "L_bo_reply", kind: "beat", text: "We don't get many new faces down this way.", location: ["The Tavern", "Intro"], sceneId: "scn_tavern" },
];

const view = new URLSearchParams(location.search).get("view");
let identity: { name: string; email?: string } | null = view === "firstrun" ? null : { name: "Ian Thomas" };
// ?view=overview -> the #3a landing (open with no remembered scene); default -> the editor on a scene.
// Live debug link (#181): a fake link over the REAL follow state (shared/debug-follow.ts), so the flow
// picker, most-recent following, the hand-over, and the taken-option mark run as they do in the app.
// Play > Live Link (or the chip) "connects" a game with three flows. Drive it from the console:
// `__debug.frame(flow, sceneId, beatId, type, choiceId?)`, `__debug.open(flow)`, `__debug.close(flow)`.
let playMark: ((id: string | null, sceneId?: string, optionId?: string) => void) | null = null;
let debugPush: ((s: unknown) => void) | null = null;
let debugOn = false;
const debugNow = (): unknown => debugOn ? { state: "connected", port: 4471, project: "The Tavern", build: "match", ...follower.view() } : { state: "off" };
const follower = createFlowFollower({
  onFrame: (f) => playMark?.(f.beatId, f.sceneId ?? undefined, f.type === "choice" ? f.choiceId : undefined),
  onChange: () => { if (debugOn) debugPush?.(debugNow()); },
});
(window as unknown as { __debug: unknown }).__debug = {
  open: (flow: string) => follower.flowOpen(flow),
  close: (flow: string) => follower.flowClose(flow),
  frame: (flow: string, sceneId: string | null, beatId: string | null, type = "line", choiceId?: string) => follower.frame({ flow, sceneId, beatId, type, choiceId }),
  status: debugNow,
};
const debugConnect = (): unknown => {
  debugOn = true;
  follower.hello(["patterstage/@oda", "patterstage/gate/talk", "patterstage/gate/tale#p7", "patterstage/gate/tale#p12", "menu/title"]);
  follower.frame({ flow: "menu/title", sceneId: "scn_street", beatId: null, type: "line" });
  follower.frame({ flow: "patterstage/@oda", sceneId: "scn_tavern", beatId: "L_bo_reply", type: "line" });
  follower.frame({ flow: "patterstage/gate/talk", sceneId: "scn_tavern", beatId: "L_greet", type: "line" });
  return debugNow();
};

const open = view === "welcome" || view === "firstrun" ? null : view === "overview" ? { project } : { project, lastScene: "scn_tavern" };
let castAdded = false;     // preview-only: the add-to-cast quick-fix flips this so the BO problem clears
let propDeclared = false;  // preview-only: the declare-property quick-fix flips this so the @strength problem clears

const stub = {
  boot: async () => ({ open, recents, identity, panes: { nav: true, inspector: true }, theme: { colour: "system", font: "newsreader" }, fieldsFollow: true }),
  appReady: () => {}, // no Electron window to reveal in the browser preview - a no-op keeps the bridge complete
  openDialog: async () => ({ project }),
  saveAs: async () => ({ project }),
  openPath: async () => ({ project }),
  closeProject: async () => undefined,
  createDialog: async (_name: string, _vcs: string) => ({ project }),
  readScene: async () => ({
    flowSource, locSource, sceneName: "The Tavern",
    hostScopes: ["world"], // the project's host-scope tokens (ReadSceneResult.hostScopes)
    extensions: [{ id: "probe", name: "Probe", source: probeShard, live: true }], // the scene's Patter extension shards (SceneSource.extensions)
    properties: [
      { scope: "patter", name: "gold", type: "number" },
      { scope: "patter", name: "met_anna", type: "boolean" },
      { scope: "patter", name: "reputation", type: "number" },
      { scope: "patter", name: "quest_flags", type: "flags", enumValues: ["rats_cleared", "paid", "betrayed"] },
      { scope: "patter", name: "mood", type: "enum", enumValues: ["calm", "tense", "hostile"] },
      { scope: "patter", name: "negotiation", type: "quality", stages: ["not_started", "underway", "done", "aftermath"] },
      { scope: "scene", name: "asked_about_work", type: "boolean" },
    ],
  }),
  saveScene: async (_id: string, _flow: string, _loc: string, extensions?: Record<string, string | null>) => {
    if (extensions && Object.keys(extensions).length) console.log("[preview] saveScene extension shards", extensions);
    return { ok: true };
  },
  // VC snapshot (#145): the tavern is locked by another author (read-only + chip), the street has
  // uncommitted local changes (the "modified" ● badge, simple-vc-lib 0.1.1 `dirty`).
  vcStatus: async () => ({ vcs: "perforce", system: "perforce", scenes: [
    extView
      ? { sceneId: "scn_tavern", writable: true, ...(extLock ? { extensions: { probe: { writable: false, lockedBy: ["bob"] } } } : {}) }
      : { sceneId: "scn_tavern", writable: false, lockedBy: ["bo@studio"] },
    { sceneId: "scn_street", writable: true, dirty: true },
  ], ...(extLock ? { projectExtensions: { probe: { writable: false, lockedBy: ["bob"] } } } : {}) }),
  // In-memory documentation map so the Notes popover round-trips within a preview session.
  readDocs: async () => (window as unknown as { __docs?: Record<string, unknown> }).__docs ?? {},
  saveDocs: async (_sceneId: string, map: Record<string, unknown>) => { (window as unknown as { __docs?: unknown }).__docs = map; return { ok: true }; },
  // In-memory comment threads so the popover + bubbles round-trip within a preview session (#148).
  readComments: async () => (window as unknown as { __comments?: unknown[] }).__comments ?? [],
  saveComments: async (_sceneId: string, comments: unknown[]) => { (window as unknown as { __comments?: unknown }).__comments = comments; return { ok: true }; },
  // In-memory per-beat writing status so the "Status" submenu + gutter badges round-trip in a preview (#196).
  readWriting: async () => (window as unknown as { __writing?: Record<string, string> }).__writing ?? {},
  saveWriting: async (_sceneId: string, map: Record<string, string>) => { (window as unknown as { __writing?: unknown }).__writing = map; return { ok: true }; },
  readRecording: async () => (window as unknown as { __recording?: Record<string, string> }).__recording ?? {},
  saveRecording: async (_sceneId: string, map: Record<string, string>) => { (window as unknown as { __recording?: unknown }).__recording = map; return { ok: true }; },
  readRerecord: async () => (window as unknown as { __rerecord?: Record<string, boolean> }).__rerecord ?? {},
  saveRerecord: async (_sceneId: string, map: Record<string, boolean>) => { (window as unknown as { __rerecord?: unknown }).__rerecord = map; return { ok: true }; },
  audioCurrent: async () => (project.audioFolders ? FAKE_AUDIO_INDEX : {}), // folder-derived status snapshot (#206)
  onAudioIndex: () => undefined, // preview is static; no live folder watching
  readAudio: async () => null,   // no real audio files in the preview
  saveScratch: async () => ({ ok: true }), // #224: pretend the take saved (no fs in the preview)
  micAccess: async () => true, // no TCC gate in the browser preview

  setRecordingMode: () => undefined,
  // Live debug link (#181): the fake link above, which "connects" several flows so the picker is exercisable.
  debugStart: async () => debugConnect(),
  debugStop: async () => { debugOn = false; follower.clear(); return debugNow(); },
  debugStatus: async () => debugNow(),
  debugFollow: (flow: string | null) => follower.follow(flow),
  onDebugStatus: (h: (s: unknown) => void) => { debugPush = h; },
  // In-memory rewrite proposals so the suggest-rewrite flow round-trips within a preview session.
  readSuggestions: async () => (window as unknown as { __suggestions?: unknown[] }).__suggestions ?? [],
  saveSuggestions: async (_sceneId: string, s: unknown[]) => { (window as unknown as { __suggestions?: unknown }).__suggestions = s; return { ok: true }; },
  // The Review Feedback walk over the in-memory comments + suggestions (single preview scene). Resolved
  // items join only when `scope` asks, mirroring the real reviewFeedback + the "Show Resolved" toggles.
  reviewFeedback: async (scope?: { resolvedComments?: boolean; resolvedSuggestions?: boolean }) => {
    const w = window as unknown as { __comments?: Array<{ id: string; anchor: string; resolved?: boolean; messages?: Array<{ author: string; body: string }> }>; __suggestions?: Array<{ id: string; anchor: string; resolved?: boolean; author: string; proposed: string }> };
    const out: Array<{ sceneId: string; sceneName: string; kind: "comment" | "suggestion"; anchor: string; refId: string; author: string; text: string; resolved?: boolean }> = [];
    for (const c of w.__comments ?? []) { if (!c.messages?.length) continue; if (c.resolved && !scope?.resolvedComments) continue; out.push({ sceneId: "scn_tavern", sceneName: "The Tavern", kind: "comment", anchor: c.anchor, refId: c.id, author: c.messages[0]!.author, text: c.messages[0]!.body, resolved: !!c.resolved }); }
    for (const g of w.__suggestions ?? []) { if (g.resolved && !scope?.resolvedSuggestions) continue; out.push({ sceneId: "scn_tavern", sceneName: "The Tavern", kind: "suggestion", anchor: g.anchor, refId: g.id, author: g.author, text: g.proposed, resolved: !!g.resolved }); }
    return out;
  },
  report: async () => ({
    project: { id: "tavern", name: "The Tavern" },
    voiced: true,
    recordingTracked: true,
    writingLadder: ["stub", "draft 1", "draft 2", "edited", "final"],
    recordingLadder: ["missing", "scratch", "recorded", "final"],
    scenes: [
      { sceneId: "intro", name: "Intro", status: "stub", estimated: false, choices: 2, writtenDone: 12, writtenRemaining: 3, voicedDone: 8, voicedRemaining: 2,
        written: { count: 15, words: 240, byWriting: { "stub": 3, "draft 1": 4, "edited": 5, "final": 3 } },
        voiced: { count: 10, words: 180, byWriting: { "stub": 2, "edited": 5, "final": 3 }, byRecording: { "missing": 4, "scratch": 3, "final": 3 }, readyToRecord: 6, readyToShip: 3 } },
      { sceneId: "bar", name: "At the Bar", status: "stub", estimated: true, choices: 0, estimate: 20, writtenDone: 0, writtenRemaining: 20, voicedDone: 0, voicedRemaining: 14,
        written: { count: 0, words: 116, byWriting: {} },
        voiced: { count: 0, words: 84, byWriting: {}, byRecording: {}, readyToRecord: 0, readyToShip: 0 } },
    ],
    characters: [
      { character: "BARKEEP", lines: 6, estimatedLines: 8, words: 110, recording: { "missing": 2, "scratch": 2, "final": 2 } },
      { character: "ANNA", lines: 4, estimatedLines: 6, words: 70, recording: { "missing": 2, "final": 2 } },
    ],
    locales: [
      { locale: "fr", translated: 8, missing: 7, stale: 1, words: 130 },
    ],
    cut: { scenes: 1, voicedLines: 3, writtenLines: 5 },
    estimating: true,
    scenesByStatus: { "stub": 2, "draft 1": 0, "draft 2": 0, "edited": 0, "final": 0 },
    coverage: { totalScenes: 2, estimated: 1 },
    totals: {
      written: { count: 15, words: 240, byWriting: { "stub": 3, "draft 1": 4, "edited": 5, "final": 3 } },
      voiced: { count: 10, words: 180, byWriting: { "stub": 2, "edited": 5, "final": 3 }, byRecording: { "missing": 4, "scratch": 3, "final": 3 }, readyToRecord: 6, readyToShip: 3 },
      choices: 2, writtenDone: 12, writtenRemaining: 23, voicedDone: 8, voicedRemaining: 16, projectedWritten: 35, projectedVoiced: 24,
    },
  }),
  proposeCoverageDrivers: async () => ([
    { ref: "@world.alarm", kind: "recurring", cadence: "sometimes", values: [true, false] },
    { ref: "@world.mood", kind: "recurring", cadence: "sometimes", values: ["calm", "tense", "hostile"] },
  ]),
  exportReport: async () => ({ ok: true, path: "The Tavern - production.xlsx" }),
  cancelJob: () => undefined,            // the publish paths resolve at once here; nothing to stop
  onJobProgress: () => undefined,        // and report no progress
  recents: async () => recents,
  clearRecents: async () => { recents.splice(1); return recents; }, // the open project stays, as main keeps it
  buildBundle: async () => ({ ok: true, path: "/Users/ian/Projects/patter-dist/the_tavern.patterc" }),
  // Stubs the renderer calls that the preview has no main process for: an edit, an example tile, and the
  // File-menu acts the menu bridge can reach. Each answers as main does when nothing comes of it.
  playEdited: () => {},
  openExample: async () => null,
  shareScopes: async () => null,
  showInStoryletter: async () => ({ ok: false, canceled: true }),
  mergePatterpackPlan: async () => null,
  mergePatterpackCommit: async () => ({ error: "the preview cannot merge" }),
  mergePatterpackDrop: async () => {},
  toggleAutoRebuild: async () => true,
  buildAudioManifest: async () => ({ ok: true, path: "/Users/ian/Projects/the-tavern.patter/audio/patteraudio.json" }),
  exportVoiceScript: async (everything: boolean) => ({ ok: true, path: `The Tavern - voice script${everything ? " (all)" : ""}.xlsx` }),
  exportPlayableHtml: async () => ({ ok: true, path: "The Tavern.html" }),
  exportScript: async () => ({ ok: true, path: "The Tavern.pdf" }),
  // The editable script handoff: a plausible plan with a few problems, so the reimport dialog has content.
  editableLineCounts: async (sceneId: string | null) => ({ scene: sceneId ? 14 : 0, project: 31 }),
  exportEditable: async () => ({ ok: true, path: "The Tavern (editable).docx", handoffId: "H-7Q2K" }),
  pickEditableReturn: async () => "/Users/sam/Downloads/The Tavern (editable) - Sam's edits.docx",
  planEditableImport: async (_path: string, req: { strictQuotes: boolean; direct: boolean; as?: string }) => ({
    planId: "plan-1", handoffId: "H-7Q2K", recipient: "Sam", sentAt: "2026-10-03T12:00:00Z", sentBy: "Ian",
    counts: { changed: req.strictQuotes ? 6 : 5, unchanged: 24, stale: 1, comments: 3, problems: 2 },
    problems: [
      { severity: "warning", message: "The editor added text outside the boxes: “Should he smile here?”; it's a comment on the line before.", anchor: "L_greet", sceneId: "tavern" },
      { severity: "warning", message: "The speaker was changed to STRANGER, who isn't in the cast; it's in a comment.", anchor: "L_work", sceneId: "tavern" },
      { severity: "info", message: "This line has changed in the project since it was sent; its suggestion will show as out of date.", anchor: "L_intim", sceneId: "tavern" },
    ],
    files: 3,
  }),
  applyEditableImport: async () => ({ ok: true }),
  listSuggestions: async () => [],
  decideSuggestions: async () => ({ ok: true, results: [] }),
  openHandoffs: async () => [{ id: "H-7Q2K", recipient: "Sam", createdAt: "2026-10-03T12:00:00Z", createdBy: "Ian" }],
  exportPatterpack: async () => ({ ok: true, path: "The Tavern.patterpack" }),
  openPatterpack: async () => ({ project }),
  exportLoc: async (request: { format: string; locale?: string }) => ({ ok: true, path: `The Tavern - ${request.locale ?? "template"}.${request.format === "xlsx" ? "xlsx" : request.format === "po" ? "po" : "json"}` }),
  importLoc: async (fallbackLocale?: string) => ({ ok: true, locale: fallbackLocale ?? "fr", updated: 7, files: 2 }),
  setStart: async (start: { scene: string }) => ({ ok: true, project: { ...project, start } }),
  exportWeb: async () => ({ ok: true, path: "/Users/ian/Sites/the-tavern", kept: ["index.html", "style.css"] }),
  reorderScenes: async (ids: string[]) => {
    const rank = new Map(ids.map((id, i) => [id, i]));
    project.scenes.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
    return { ok: true, project };
  },
  createScene: async (name: string) => {
    const sceneId = `scn_${project.scenes.length + 1}`;
    project.scenes.push({ id: sceneId, name: name.trim() || "Scene", blocks: [{ id: `${sceneId}_main`, name: "Main" }] });
    return { ok: true, sceneId, project };
  },
  // Canned severities: the tavern is referenced (severity 3), the street is content-only (2),
  // and anything created in-session reads as an untouched scaffold (1 - silent unless unsaved).
  sceneDeleteInfo: async (sceneId: string) => {
    const original = sceneId === "scn_tavern" || sceneId === "scn_street";
    return {
      untouched: !original, lines: original ? 12 : 0, blocks: original ? 2 : 1,
      startsHere: sceneId === "scn_tavern", lastScene: project.scenes.length <= 1, vcs: true,
      referrers: sceneId === "scn_tavern" ? [{ sceneId: "scn_street", name: "Street", jumps: 2, conditions: 1 }] : [],
    };
  },
  deleteScene: async (sceneId: string) => {
    project.scenes = project.scenes.filter((s: { id: string }) => s.id !== sceneId);
    return { ok: true, project };
  },
  openCoverageWindow: async () => undefined,
  // The fields window, over a BroadcastChannel: open fields.html in another tab and it shows what this one
  // sends, and sends its edits back, as main relays them in the app.
  openFieldsWindow: async () => { fieldsChannel.postMessage({ t: "front" }); },
  sendFieldsState: (state: unknown) => { lastFieldsState = state; fieldsChannel.postMessage({ t: "state", state }); },
  onFieldsCommit: (handler: (id: string, extension: string, field: string, value: unknown) => void) => { onFieldsCommit = handler; },
  onFieldsFollow: (handler: (on: boolean) => void) => { onFieldsFollow = handler; },
  // View extensions need main (a package, a window, a port): the preview has none to offer.
  addExtension: async () => null,
  openView: async () => {},
  onViewOffers: () => {},
  writeProjectExtension: async () => ({ ok: false, error: "The preview can't write the project." }),
  onCoverageNavigate: () => undefined,
  onOpenWorldSettings: () => undefined,
  readSettings: async () => ({ name: "The Tavern", vcs: "git", start: { scene: "scn_tavern" }, voiced: true, trackAudioStatus: true, formatting: true, padAfterDefault: 0.6, localiseDialogueText: false, buildBundle: "../patter-dist/the_tavern.patterc", buildLocalisation: "embedded", buildSourceDebug: false, localeDefault: "en", locales: ["en", "fr"],
    gameDataFields: {
      scene: [{ name: "music", type: "text", default: "tavern-loop", purpose: "Background music cue id for this scene." }],
      line: [{ name: "mood", type: "enum", values: ["calm", "tense", "hostile"], purpose: "Facial-animation mood for this line." }],
    },
    properties: [
      { name: "gold", type: "number", default: 10 },
      { name: "met_anna", type: "boolean", default: false },
      { name: "mood", type: "enum", values: ["calm", "tense", "hostile"], default: "calm" },
    ],
    scopeRegistry: { version: 1, scopes: [{ token: "world", declarations: [
      { name: "alarm", type: "boolean", default: false },
      { name: "mood", type: "enum", values: ["calm", "tense", "hostile"], default: "calm", writable: false },
    ] }] },
    coverageDrivers: [{ ref: "@world.mood", kind: "recurring", cadence: "sometimes", values: ["calm", "tense", "hostile"] }],
    cast: [
      { name: "BARKEEP", displayName: "The Barkeep", notes: "Gruff, warm underneath." },
      // ANNA's thoughts have a label of their own, and a radio label no line uses any more (marked unused).
      { name: "ANNA", qualifierLabels: { vo: "Anna's thoughts", radio: "Anna, on the radio" } },
    ],
    qualifiers: QUALIFIERS,
    speakerPattern: "",
    writingStatuses: [
      { name: "stub", colour: 0 }, { name: "draft 1", colour: 1 }, { name: "draft 2", colour: 2 },
      { name: "edited", readyToRecord: true, colour: 4 }, { name: "final", readyToShip: true, colour: 9 },
    ],
    estimating: { enabled: true, defaultLines: 20, tagEstimates: [{ tag: "cutscene", lines: 40 }, { tag: "conversation", lines: 25 }] },
    // In ?view=audiofolders folder mode + scratch are on with an audio root, so the Audio tab shows the
    // root picker, the derived-subfolder hints, and the scratch-recording controls (#206 / #224).
    recordingStatuses: [{ name: "missing", colour: 0 }, { name: "scratch", colour: 2 }, { name: "recorded", colour: 4 }, { name: "final", colour: 9 }],
    audioFolders: project.audioFolders, audioRoot: project.audioRoot, scratchStatus: project.scratchStatus,
    dictionaryLanguage: "en-GB", dictionaryWords: ["Patterpad", "Eldoria"], dictionaryIgnore: [], dictionaryEnabled: true,
    closedCaptions: { open: "[", close: "]", character: "SFX" } }),
  saveSettings: async (s: { name: string; extensionValues?: Record<string, Record<string, unknown>> }) => {
    // The probe's project values, as its Settings section saved them: kept, so reopening shows them.
    if (s.extensionValues) { console.log("[preview] saveSettings extension values", s.extensionValues); if (s.extensionValues["probe"]) probeProject.values = s.extensionValues["probe"]; }
    project.extensions = probeDtos();
    return { ok: true, project: { ...project, name: s.name } };
  },
  // Spell-check (#177): the built-ins plus a fake imported dictionary; readDictionary serves the REAL
  // vendored en-GB/en-US bytes so the live squiggle engine works in the preview.
  // The character and qualifier pairs the lines use (the Cast tab's "Shown with" fields).
  speakerPairs: async () => [{ character: "BARKEEP", qualifier: "os" }, { character: "ANNA", qualifier: "vo" }],
  listDictionaries: async () => ([
    { id: "en-US", label: "English (US)", builtin: true },
    { id: "en-GB", label: "English (UK)", builtin: true },
    { id: "fr_FR", label: "fr_FR", builtin: false },
  ]),
  readDictionary: async (id: string) => DICT_BYTES[id] ?? null,
  importDictionary: async () => ({ ok: true, info: { id: "de_DE", label: "de_DE", builtin: false } }),
  removeDictionary: async () => ({ ok: true }),
  addDictionaryWord: async (word: string) => ({ ok: true, words: [...project.dictionary.words, word] }),
  addIgnoreWord: async (word: string) => ({ ok: true, ignore: [...project.dictionary.ignore, word] }),
  setDictionary: async (patch: { enabled?: boolean; language?: string }) => ({ ok: true, dictionary: { ...project.dictionary, ...patch } }),
  rememberScene: async () => undefined,
  hydrate: async () => project, // lazy-open phase 2 (#171): the full scene list is already complete here
  openPlay: async () => undefined,
  onPlayMark: (h: (id: string | null, sceneId?: string, optionId?: string) => void) => { playMark = h; }, // the fake debug link's frames
  onPlayFollow: () => undefined,
  onPlayReset: () => undefined,
  // The search tool window is a separate Electron window (#205); inert in the browser preview.
  openSearchWindow: async () => undefined,
  onSearchNavigate: () => undefined,
  onEditorFlush: () => undefined,
  onFlushBeforeClose: () => undefined,
  onPrompt: () => undefined,
  editorFlushed: () => undefined,
  onReplaceApplied: () => undefined,
  validate: async () => ({
    ok: false,
    problems: [
      // A problem in ANOTHER scene: the bar names the scene up front and Go to issue switches to it.
      { category: "structure", severity: "error", detail: "empty-snippet", message: "snippet 'sn_street_hollow' has no beats and no jump", nodeId: "sn_street_hollow", sceneId: "scn_street" },
      // Each problem carries a quick-fix; applying one flips its flag so it clears on re-validate.
      ...(propDeclared ? [] : [{ category: "condition", severity: "error", detail: "condition", message: "unknown property '@strength'", nodeId: "opt_intimidate", fix: { kind: "declare-property", name: "strength", propType: "number" } }]),
      ...(castAdded ? [] : [{ category: "structure", severity: "error", detail: "unknown-character", message: "character 'BO' is not in the project cast", nodeId: "L_bo_reply", fix: { kind: "add-to-cast", character: "BO" } }]),
      // Quick-fix demos (surface edits): pick a valid enum value (rewrites a real node's condition);
      // add a prompt to a prompt-less option. Static here - the real validator drives them in Electron.
      { category: "condition", severity: "error", detail: "condition", message: "'angry' is not a valid value for this property - expected one of: calm, tense, hostile", nodeId: "opt_intimidate", fix: { kind: "pick-enum-value", bad: "angry", options: ["calm", "tense", "hostile"], src: "@mood == \"angry\"" } },
      { category: "structure", severity: "error", detail: "missing-prompt", message: "choice option 'opt_leave' has no prompt", nodeId: "opt_leave", fix: { kind: "add-prompt", optionId: "opt_leave" } },
      // Patter extensions: a value the probe requires on the greeting (Go to issue reveals it), and the
      // project taking an older probe than its manifest, which Go to issue opens the probe's Settings for.
      { category: "extensions", severity: "error", detail: "required", message: "entries.line.L_greet.cue.sound: \"cue.sound\" is required and not set", nodeId: "L_greet", sceneId: "scn_tavern", file: "extensions/probe/tavern.patterextension", extension: "probe" },
      { category: "extensions", severity: "warning", message: "the project takes \"probe\" at version 1.0.0, but its manifest is version 1.1.0; run `patter format` to take it (renamed stages are renamed in the data as it does)", file: "the-tavern.patterproj", extension: "probe" },
      // An advisory warning (amber): a stale compiled bundle. No quick-fix - `patter export` repairs it.
      { category: "stale-bundle", severity: "warning", message: "compiled bundle is stale (does not match current source) - run `patter export`", file: "scenes/the-tavern.patterc" },
    ],
  }),
  applyFix: async (fix: { kind: string }) => { if (fix.kind === "add-to-cast") castAdded = true; if (fix.kind === "declare-property") propDeclared = true; return { ok: true }; },
  getIdentity: async () => identity,
  suggestIdentity: async () => null, // no VCS in the browser preview to ask for a name
  // Mirror main's blank-name default (the OS user name; "You" stands in for the preview) so the edit
  // dialog round-trips and the first-run skip yields a stored identity.
  setIdentity: async (id: { name?: string; email?: string }) => { identity = { name: id?.name?.trim() || "You", ...(id?.email?.trim() ? { email: id.email.trim() } : {}) }; },
  setPanes: async () => undefined,
  resetWindows: async () => undefined, // Reset View rescues all windows (inert in the browser preview)
  setTheme: async () => undefined,
  openExternal: (url: string) => { window.open(url, "_blank"); }, // About-dialog links: a real tab in the preview
  revealProject: () => { console.log("[preview] revealProject"); }, // no file manager in a browser
  search: async (q: string) => { // MAIN search: Game ID / title / text content
    const ql = q.toLowerCase();
    return SEARCH_INDEX.filter((e) => (e.gameId?.toLowerCase().includes(ql)) || (e.name?.toLowerCase().includes(ql)) || (e.text?.toLowerCase().includes(ql)) || e.id.toLowerCase().includes(ql));
  },
  linesByStatus: async (status: string) => // STATUS BROWSE (#205): the canned beats sit at "stub" here
    status === "stub" ? SEARCH_INDEX.filter((e) => e.kind === "beat") : [],
  // Stash the menu handler so the browser preview can drive native-menu commands (no real menu here):
  // call `window.__menu("reset-view")` etc. from the console / preview eval.
  onMenu: (h: (cmd: string) => void) => { (window as unknown as { __menu: unknown }).__menu = h; },
  onOpenProject: () => undefined, // no Finder in the browser preview
  // Project-level undo: the preview has no files to restore, so its history is always empty. The renderer
  // subscribes to project steps at module top level, so these MUST exist.
  projectUndo: async () => ({ ok: false, label: "", stale: true, scenes: [], authoring: [] }),
  projectRedo: async () => ({ ok: false, label: "", stale: true, scenes: [], authoring: [] }),
  projectClearRedo: async () => undefined,
  setUndoLabels: async () => undefined,
  onProjectStep: () => undefined,
  // Auto-update hooks (#189) - inert in the browser preview, but they MUST exist: the renderer subscribes
  // at module top level, and a missing method throws and aborts boot.
  onUpdaterCheckDirty: () => undefined,
  onUpdaterSaveBeforeInstall: () => undefined,
  onUpdaterPrompt: () => undefined,
  onUpdaterDownloadProgress: () => undefined,
};

(window as unknown as { patter: unknown }).patter = stub;
import("../src/renderer.js").catch((e) => { console.error("preview: renderer failed to load (a stub method or DOM id is probably missing)", e); }); // run the real renderer against the stub
