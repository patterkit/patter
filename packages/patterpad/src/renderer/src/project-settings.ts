// Project Settings (File > Project Settings...): the dialog, its sections, saving what they hold, and the
// extension actions it offers. Moved out of renderer.ts; what it needs from the rest of the window comes in once,
// through `initProjectSettings`.

import type { ProjectSettingsDto, VcsKind, AddExtensionResult, ConditionProperty, OpenedProject, ProjectStep, SaveResult, VcStatusDto } from "../../shared/api.js";
import { formatSeconds } from "./inspector.js";
import { setHostScopeTokens } from "./expr-shared.js";
import { el } from "./dom.js";
import { mountSettingsDialog, confirmDialog, stageGateNote, toast, labelled, labelledToggle, type SettingsSectionHandle, type SettingsSection, type SettingsDialog } from "@wildwinter/app-shell";
import { mountProjectSection, settingsExtensions, settingsSectionId, type extensionAdapter } from "./extension-rows.js";
import { landed } from "./results.js";
import { mountGameDataFields } from "./gamedata-fields.js";
import { mountCast } from "./settings-cast.js";
import { mountQualifiers } from "./settings-qualifiers.js";
import { mountWorld } from "./settings-world.js";
import { mountWritingStatus, createAudioSettings, mountRecordingStatus, mountScratchRecording, mountPlaceholderSpeech, type AudioSettings } from "./settings-status.js";
import { PLACEHOLDER_ACCENTS, accentForLanguage, defaultPlaceholderVoice } from "@patterkit/core";
import { mountEstimating } from "./settings-estimating.js";
import { mountDictionary } from "./settings-dictionary.js";
import { mountLanguages } from "./settings-languages.js";
import type { CastMember, PropertyDecl } from "@patterkit/model";
import { DEFAULT_PAD_AFTER, PAD_AFTER_MIN, PAD_AFTER_MAX, DEFAULT_ESTIMATE_SPEED, ESTIMATE_SPEED_MIN, ESTIMATE_SPEED_MAX } from "@patterkit/model";
import type { InspectorContext, SurfaceHandle } from "@patterkit/patterpad-surface/surface";
import type { createViewHost } from "./view-extensions.js";

/** What Project Settings reads and calls from the rest of the window. `project`, `sceneProps` and
 *  `lastInspectorSig` are written back after a save. */
export interface SettingsContext {
  project: OpenedProject | null;
  sceneProps: ConditionProperty[];
  lastInspectorSig: string | null;
  readonly lastInspectorCtx: InspectorContext | null;
  readonly currentSceneId: string | null;
  readonly surface: SurfaceHandle | null;
  readonly projectExtensionVc: NonNullable<VcStatusDto["projectExtensions"]>;
  readonly views: ReturnType<typeof createViewHost>;
  $<T extends HTMLElement>(id: string): T;
  buildBundle(): Promise<void>;
  buildSpellcheck(): Promise<void>;
  currentExtensionAdapter(): ReturnType<typeof extensionAdapter>;
  declToConditionProperty(scope: "patter" | "scene", d: PropertyDecl): ConditionProperty;
  lockedLine(by: string[] | undefined): string | null;
  makeProjectSpeech(): Promise<void>;
  noteStep(step: ProjectStep | undefined): void;
  pushCast(): void;
  pushWritingStatus(): void;
  refreshProblems(): Promise<void>;
  refreshVcStatus(): Promise<void>;
  save(): Promise<void>;
  showInspector(ctx: InspectorContext): void;
  showProjectTitle(p: { name: string; root: string }): void;
  tracked<T extends SaveResult>(p: Promise<T>): Promise<T>;
}

let c: SettingsContext;

/** Hand Project Settings what it needs and build its dialog, once, before anything opens it. */
export function initProjectSettings(context: SettingsContext): void {
  c = context;
  settingsDlg = buildSettingsDialog();
}

// --- Project Settings (File > Project Settings…) -------------------------------
// The dialog is the shell's `mountSettingsDialog` (ui-review-2026-09, finding 4): the modal, the grouped
// tab rail, the Enter guard and the Save gate are its. The sections below own their content and their
// state, mount fresh on every open from `settingsRead` (read just before open(), because mount() is
// synchronous), and hand what they hold to `saveSettingsFromDialog` through `live`.

type SettingsRead = {
  s: ProjectSettingsDto; dictionaries: Awaited<ReturnType<typeof window.patter.listDictionaries>>;
  /** The character and qualifier pairs the lines use (the Cast tab's "Shown with" fields). */
  speakerPairs: Awaited<ReturnType<typeof window.patter.speakerPairs>>;
};
let settingsRead: SettingsRead | null = null;
/** The controls and editors of the OPEN dialog, filled by each section's mount() and read by Save. */
interface LiveSettings {
  name: HTMLInputElement; start: HTMLSelectElement;
  voiced: HTMLInputElement; formatting: HTMLInputElement; padAfter: HTMLInputElement; estimateSpeed: HTMLInputElement;
  build: HTMLInputElement; buildLocales: HTMLSelectElement; buildSourceDebug: HTMLInputElement;
  vcs: HTMLSelectElement;
  ccOpen: HTMLInputElement; ccClose: HTMLInputElement; ccCharacter: HTMLInputElement;
  langs: ReturnType<typeof mountLanguages>; localiseDialogueText: HTMLInputElement; gd: ReturnType<typeof mountGameDataFields>;
  world: ReturnType<typeof mountWorld>; worldHost: HTMLElement; cast: ReturnType<typeof mountCast>;
  qualifiers: ReturnType<typeof mountQualifiers>;
  writingStatus: ReturnType<typeof mountWritingStatus>; estimating: ReturnType<typeof mountEstimating>;
  audio: AudioSettings; dictionary: ReturnType<typeof mountDictionary>;
}
export let live: Partial<LiveSettings> = {};

// The small field kit the static markup used to spell out: a captioned field, a checkbox row with its
// sub-line, and the two kinds of note.
// The family's settings rows (ruling C of the October 2026 review): the shell's `labelled` and
// `labelledToggle`, as Storyletter's settings use, so the two apps' dialogs look the same. Caption on the
// left, control inline, any explanation underneath.
const sField = (caption: string, control: HTMLElement, ...notes: HTMLElement[]): HTMLElement =>
  labelled(caption, control, notes.length ? notes.flatMap((n) => [...n.childNodes]) : undefined);
const sToggle = (label: string, sub: string, checked: boolean, cls = "settings-toggle"): { row: HTMLElement; input: HTMLInputElement } =>
  labelledToggle(label, { checked, hint: sub, sub: cls.includes("settings-suboption") });
const sNote = (cls: string, ...parts: Array<string | Node>): HTMLElement => { const n = el(cls === "settings-note" ? "p" : "small", cls); n.append(...parts); return n; };
const code = (text: string): HTMLElement => el("code", undefined, text);
const bold = (text: string): HTMLElement => el("b", undefined, text);
const sSelect = (options: Array<[string, string]>, value: string, cls?: string): HTMLSelectElement => {
  const sel = el("select", cls);
  for (const [v, label] of options) sel.append(new Option(label, v));
  sel.value = value;
  return sel;
};
export const VCS_OPTIONS: Array<[string, string]> = [["git", "Git"], ["perforce", "Perforce"], ["plastic", "Plastic SCM"], ["svn", "Subversion (SVN)"], ["none", "None"]];
/** The bundle path's explanation, said once for both places that ask for it (Project Settings and New
 *  Project), under the name Storyletter gives the same setting. */
export const bundlePathHint = (): (string | HTMLElement)[] => [
  "Where Publish ▸ Publish Bundle writes the ", code(".patterc"), ", relative to the project folder. The default is a ",
  code("patter-dist/"), " folder beside it.",
];
export const DUP_MESSAGE = "Two entries share a name. Names must be unique.";

/** The project's own values for its Patter extensions, edited in their Settings sections since the dialog
 *  opened, by extension id: each the whole entry, carried at Save. */
let settingsExtensionEdits: Record<string, Record<string, unknown>> = {};

/** A section of Project Settings for each Patter extension declaring project fields, under their own Extensions
 *  heading after Version control: the extension and the version the project uses, then the project's own values. */
function projectExtensionSections(): SettingsSection[] {
  return settingsExtensions(c.project?.extensions).map((extension): SettingsSection => ({
    id: settingsSectionId(extension.id), label: extension.name, group: "Extensions", mount: (host): SettingsSectionHandle => {
      // Mounted fresh on every open, from the project as it now stands (its values may have been saved since
      // the dialog was built).
      mountProjectSection(host, {
        extension: c.project?.extensions?.find((x) => x.id === extension.id) ?? extension, adapter: c.currentExtensionAdapter(),
        locked: c.lockedLine(c.projectExtensionVc[extension.id]?.lockedBy),
        onChange: (entry) => { settingsExtensionEdits[extension.id] = entry; },
      });
      return {};
    },
  }));
}

/** The extensions the dialog was built with: a project taking others rebuilds it. */
let settingsDlgShape = "";
const extensionShape = (): string => settingsExtensions(c.project?.extensions).map((x) => `${x.id}:${x.name}`).join(",");

function buildSettingsDialog(): SettingsDialog {
  settingsDlgShape = extensionShape();
  return mountSettingsDialog({
  title: "Project settings",
  sections: [
    { id: "general", label: "General", group: "Project", mount: (host): SettingsSectionHandle => {
      const { s } = settingsRead!;
      const name = el("input"); name.type = "text"; name.required = true; name.value = s.name;
      // Start scene picker: "(unset)" plus every scene; select the project's current start.
      const start = sSelect([["", "(unset)"], ...(c.project?.scenes ?? []).map((sc): [string, string] => [sc.id, sc.name])], s.start?.scene ?? "", "field");
      const voiced = sToggle("Voiced", "Tracks recording status and exports voice scripts.", s.voiced);
      // Audio is meaningful only for a VOICED project (#206): the Audio tab reads this box (its `disabled`
      // below), and flipping it here updates the tab without reopening.
      voiced.input.addEventListener("change", () => settingsDlg.refreshTabs());
      const formatting = sToggle("Inline formatting", "Bold and italic in dialogue and text.", s.formatting);
      // Line padding: the project's default pause after a line. Blank goes back to the built-in one.
      const padAfter = el("input", "settings-seconds"); padAfter.type = "number"; padAfter.step = "0.1";
      padAfter.min = String(PAD_AFTER_MIN); padAfter.max = String(PAD_AFTER_MAX);
      padAfter.value = formatSeconds(s.padAfterDefault ?? DEFAULT_PAD_AFTER); padAfter.placeholder = formatSeconds(DEFAULT_PAD_AFTER);
      // How fast a line with no recording is timed: a factor of the default. Blank goes back to the built-in speed.
      const estimateSpeed = el("input", "settings-seconds"); estimateSpeed.type = "number"; estimateSpeed.step = "0.1";
      estimateSpeed.min = String(ESTIMATE_SPEED_MIN); estimateSpeed.max = String(ESTIMATE_SPEED_MAX);
      estimateSpeed.value = formatSeconds(s.estimateSpeed ?? DEFAULT_ESTIMATE_SPEED);
      estimateSpeed.placeholder = formatSeconds(DEFAULT_ESTIMATE_SPEED);
      host.append(sField("Project name", name), sField("Start", start, sNote("settings-fieldnote", "The scene Play from Start opens.")),
        sField("Pad after", padAfter, sNote("settings-fieldnote", "Seconds of pause after each line, unless the line or something around it sets its own.")),
        sField("Timing for lines without audio", estimateSpeed, sNote("settings-fieldnote", `How fast a line with no recording is timed against the default of ${DEFAULT_ESTIMATE_SPEED}, from ${ESTIMATE_SPEED_MIN} to ${ESTIMATE_SPEED_MAX}: higher is faster. It's worked out from the line's text in the project's main language. Lines with a recording always last as long as the recording.`)),
        voiced.row, formatting.row);
      Object.assign(live, { name, start, voiced: voiced.input, formatting: formatting.input, padAfter, estimateSpeed });
      // A blank name used to close the dialog and drop every other edit with it (parity row 7); now it
      // is the fault the gate names.
      return { firstInvalid: () => {
        if (!name.value.trim()) return { el: name, message: "Give the project a name." };
        const pad = padAfter.value.trim() === "" ? DEFAULT_PAD_AFTER : Number(padAfter.value);
        if (!Number.isFinite(pad) || pad < PAD_AFTER_MIN || pad > PAD_AFTER_MAX) return { el: padAfter, message: `Use a number of seconds from ${PAD_AFTER_MIN} to ${PAD_AFTER_MAX}.` };
        const speed = estimateSpeed.value.trim() === "" ? DEFAULT_ESTIMATE_SPEED : Number(estimateSpeed.value);
        if (!Number.isFinite(speed) || speed < ESTIMATE_SPEED_MIN || speed > ESTIMATE_SPEED_MAX) {
          return { el: estimateSpeed, message: `Use a speed from ${ESTIMATE_SPEED_MIN} to ${ESTIMATE_SPEED_MAX}.` };
        }
        return null;
      } };
    } },
    { id: "build", label: "Publish", mount: (host): SettingsSectionHandle => {
      const { s } = settingsRead!;
      const build = el("input"); build.type = "text"; build.spellcheck = false; build.placeholder = "../patter-dist/your-project.patterc"; build.value = s.buildBundle;
      const buildLocales = sSelect([["embedded", "Embedded"], ["ids", "IDs only"]], s.buildLocalisation, "insp-select");
      const sourceDebug = sToggle("Embed source language for debug", "Adds the source strings so an IDs-only build can be played. The runtime marks it as not shippable.", s.buildSourceDebug, "settings-toggle settings-suboption");
      // The source-debug toggle only applies to an IDs-only build; show it only then.
      const syncRows = (): void => { sourceDebug.row.hidden = buildLocales.value !== "ids"; };
      buildLocales.addEventListener("change", syncRows); syncRows();
      host.append(
        sField("Bundle path", build, sNote("identity-hint", ...bundlePathHint())),
        sField("Localisation", buildLocales, sNote("identity-hint", bold("Embedded"), " ships every language in the bundle and the runtime returns the right string. ", bold("IDs only"), " ships no text, so the runtime returns the line ID and your game looks it up.")),
        sourceDebug.row);
      Object.assign(live, { build, buildLocales, buildSourceDebug: sourceDebug.input });
      return {};
    } },
    { id: "vcs", label: "Version control", mount: (host): SettingsSectionHandle => {
      const vcs = sSelect(VCS_OPTIONS, settingsRead!.s.vcs, "insp-select");
      host.append(sField("Version control system", vcs),
        sNote("settings-note", "Patterpad checks a file out before writing where the system locks files, and writes straight away where it merges. Switching systems regenerates the project's ", code("vcs-setup.md"), " and ignore rules."));
      live.vcs = vcs;
      return {};
    } },
    ...projectExtensionSections(),
    { id: "world", label: "Game scopes", group: "Story data", mount: (host): SettingsSectionHandle => {
      const { s } = settingsRead!;
      const worldHost = el("div"); host.append(worldHost);
      const world = mountWorld(worldHost, { scopeRegistry: s.scopeRegistry, coverageDrivers: s.coverageDrivers, onPropose: () => window.patter.proposeCoverageDrivers(), ...(s.worldFile ? { worldFile: s.worldFile } : {}),
        onStageReorder: (target, note) => void fillStageNote(note, target) });
      Object.assign(live, { world, worldHost });
      // Three gates. A scope name that can't be used says why. A duplicate name is a data hazard. An
      // illegal one is a declared property no expression can reach (a hyphen reads as subtraction, a
      // leading digit or a keyword will not parse, a capital is folded away); the field's own rollover
      // says which fault, so the line repeats it.
      return { firstInvalid: () => {
        const scope = world.firstBadScope(); if (scope) return scope;
        const dup = world.firstDuplicate(); if (dup) return { el: dup, message: DUP_MESSAGE };
        const bad = world.firstIllegalName(); return bad ? { el: bad, message: bad.title || "That property name can't be used in an expression." } : null;
      } };
    } },
    { id: "gamedata", label: "Game Data", mount: (host): SettingsSectionHandle => {
      host.append(sNote("settings-note", "Fields your game reads from a scene, block, snippet, or line. Define them here and fill them in from the inspector."));
      const gdHost = el("div"); host.append(gdHost);
      const gd = mountGameDataFields(gdHost, settingsRead!.s.gameDataFields);
      live.gd = gd;
      return { firstInvalid: () => { const dup = gd.firstDuplicate(); return dup ? { el: dup, message: DUP_MESSAGE } : null; } };
    } },
    { id: "cast", label: "Cast", mount: (host): SettingsSectionHandle => {
      host.append(sNote("settings-note", "A line's speaker must be one of these names."));
      const castHost = el("div"); host.append(castHost);
      const { s, speakerPairs } = settingsRead!;
      // A pair's label follows the Qualifiers tab as it's edited: its names and the pattern, read live.
      const cast = mountCast(castHost, s.cast, {
        pairs: speakerPairs,
        qualifierName: (gameId) => live.qualifiers?.nameOf(gameId) ?? s.qualifiers.find((q) => q.gameId === gameId)?.name ?? gameId,
        pattern: () => live.qualifiers?.pattern() ?? s.speakerPattern ?? "",
      }, {
        // Placeholder Speech's Voice field, read live from the dialog's own audio pages.
        on: () => audioSettings().value().placeholderSpeech != null,
        accent: () => audioSettings().value().placeholderSpeech?.accent ?? accentForLanguage(s.localeDefault),
        tier: () => (audioSettings().value().placeholderSpeech?.tier === "hd" ? "hd" : "standard"),
        hear: (voice, name) => void hearVoice(voice, name),
      });
      audioSettings().onChange(() => cast.refreshSpeech());
      live.cast = cast;
      return { firstInvalid: () => { const dup = cast.firstDuplicate(); return dup ? { el: dup, message: DUP_MESSAGE } : null; } };
    } },
    { id: "qualifiers", label: "Qualifiers", mount: (host): SettingsSectionHandle => {
      host.append(sNote("settings-note", "How a line is delivered, shown after the speaker's name: TAM (O.S.). The speaker stays one character."));
      const qHost = el("div"); host.append(qHost);
      const { s } = settingsRead!;
      const qualifiers = mountQualifiers(qHost, s.qualifiers ?? [], { pattern: s.speakerPattern, onChange: () => live.cast?.refreshLabels() });
      live.qualifiers = qualifiers;
      return { firstInvalid: () => qualifiers.firstInvalid() };
    } },
    { id: "writing-status", label: "Writing status", group: "Writing & audio", mount: (host): SettingsSectionHandle => {
      const wsHost = el("div"); host.append(wsHost);
      live.writingStatus = mountWritingStatus(wsHost, settingsRead!.s.writingStatuses);
      return {};
    } },
    { id: "estimating", label: "Estimating", mount: (host): SettingsSectionHandle => {
      const { s } = settingsRead!;
      const estHost = el("div"); host.append(estHost);
      live.estimating = mountEstimating(estHost, s.estimating, s.writingStatuses);
      return {};
    } },
    // Recording status, Scratch recording, and Placeholder Speech: three pages over one audio state (each sees
    // the others' changes), made by whichever mounts first.
    { id: "recording-status", label: "Recording status", mount: (host): SettingsSectionHandle => {
      const audioHost = el("div", "sp-page"); host.append(audioHost);
      mountRecordingStatus(audioHost, audioSettings());
      return {};
    }, disabled: () => live.voiced?.checked ? null : "Enable Voiced (General tab) to track recording status and audio." },
    { id: "scratch-recording", label: "Scratch recording", mount: (host): SettingsSectionHandle => {
      const h = el("div", "sp-page"); host.append(h);
      mountScratchRecording(h, audioSettings());
      return {};
    }, disabled: () => !live.voiced?.checked ? "Enable Voiced (General tab) first." : audioSettings().foldersOn() ? null : "Turn on Use Audio Folders (Recording status) first: scratch voice clips record into a status's folder." },
    { id: "placeholder-speech", label: "Placeholder Speech", mount: (host): SettingsSectionHandle => {
      const h = el("div", "sp-page"); host.append(h);
      const { s } = settingsRead!;
      mountPlaceholderSpeech(h, audioSettings(), {
        accents: PLACEHOLDER_ACCENTS.map((a) => [a.code, a.label]),
        impliedAccent: accentForLanguage(s.localeDefault),
        chooseKeyFile: () => window.patter.speechChooseKey(),
        keyStatus: (keyFile) => window.patter.speechKeyStatus(keyFile),
        openKeyGuide: () => window.patter.openExternal("https://patterkit.dev/production/placeholder-speech/#getting-a-key"),
        openPricing: () => window.patter.openExternal("https://cloud.google.com/text-to-speech/pricing"),
      });
      return {};
    }, disabled: () => !live.voiced?.checked ? "Enable Voiced (General tab) first." : audioSettings().foldersOn() ? null : "Turn on Use Audio Folders (Recording status) first: Placeholder Speech goes in a status's folder." },
    { id: "captions", label: "Closed captions", mount: (host): SettingsSectionHandle => {
      const { s } = settingsRead!;
      host.append(sNote("settings-note", "Closed captions describe sounds inside dialogue. A game can turn them off at runtime, and every cue between these delimiters is then removed from the line. Lines spoken by the caption character are removed entirely."));
      const delim = (value: string): HTMLInputElement => { const i = el("input"); i.type = "text"; i.spellcheck = false; i.maxLength = 4; i.value = value; return i; };
      const ccOpen = delim(s.closedCaptions.open);
      const ccClose = delim(s.closedCaptions.close);
      const warn = sNote("settings-fieldnote caption-delims-warn", "A ", code("("), " at the start of a line opens a performance direction, so a caption there won't work. Use ", code("["), " or another token.");
      // Guardrail (#214): "(" at a line start opens a performance direction in the surface, so it can't also
      // be a caption start. Warn when the author picks it (round brackets stay allowed, e.g. for mid-line cues).
      const syncWarn = (): void => { warn.hidden = ccOpen.value.trim() !== "("; };
      ccOpen.addEventListener("input", syncWarn); syncWarn();
      const delims = el("div", "caption-delims");
      delims.append(sField("Caption start", ccOpen), sField("Caption end", ccClose),
        sNote("settings-fieldnote caption-delims-note", "The default pair is ", code("["), " and ", code("]"), "."), warn);
      const ccCharacter = el("input"); ccCharacter.type = "text"; ccCharacter.spellcheck = false; ccCharacter.value = s.closedCaptions.character;
      host.append(delims, sField("Caption character", ccCharacter, sNote("settings-fieldnote", "A cast member whose whole lines are captions. The default is ", code("SFX"), ".")));
      Object.assign(live, { ccOpen, ccClose, ccCharacter });
      return {};
    } },
    { id: "dictionary", label: "Dictionary", mount: (host): SettingsSectionHandle => {
      const { s, dictionaries } = settingsRead!;
      const dictHost = el("div"); host.append(dictHost);
      // Dictionary tab (#177): the available dictionaries (built-ins + imports) drive the picker; Import / Remove
      // route through the main process.
      live.dictionary = mountDictionary(dictHost, {
        language: s.dictionaryLanguage, words: s.dictionaryWords, ignore: s.dictionaryIgnore, enabled: s.dictionaryEnabled,
        dictionaries,
        onImport: () => window.patter.importDictionary(),
        onRemove: (id) => window.patter.removeDictionary(id),
      });
      return {};
    } },
    { id: "language", label: "Language", group: "Localisation", mount: (host): SettingsSectionHandle => {
      const { s } = settingsRead!;
      host.append(sNote("settings-note", "The default language is the one you write in. The others are translation targets."));
      const langHost = el("div"); host.append(langHost);
      live.langs = mountLanguages(langHost, { localeDefault: s.localeDefault, locales: s.locales });
      const dialogueText = sToggle("Localise text lines in dialogue scenes",
        "When this is off, a text line in a scene where characters speak is action: a direction for whoever stages the scene. It isn't translated or shown to the player.",
        s.localiseDialogueText ?? false);
      host.append(dialogueText.row);
      live.localiseDialogueText = dialogueText.input;
      return {};
    } },
  ],
  onSave: () => saveSettingsFromDialog(), // false (a refused write) keeps the dialog open with the edits in it
  });
}
// Built by initProjectSettings, once the window has handed over what the dialog reads.
let settingsDlg: SettingsDialog;

/** The Cast editor's Hear: the voice says the character's name. */
async function hearVoice(voice: string, name: string): Promise<void> {
  const r = await window.patter.speechHear(voice, `This is ${name.charAt(0) + name.slice(1).toLowerCase()}, speaking as a placeholder.`);
  if (!r.ok) { toast(r.error, "error"); return; }
  const url = URL.createObjectURL(new Blob([r.bytes as BlobPart], { type: "audio/wav" }));
  const a = new Audio(url);
  a.addEventListener("ended", () => URL.revokeObjectURL(url));
  void a.play();
}

/** After a settings save: the characters whose Placeholder Speech voice changed (their own voice, their
 *  gender, the accent), so their lines can be made again; and, turned on just now, an offer to make it all. */
async function afterSpeechSettings(before: ProjectSettingsDto, after: { cast: CastMember[]; placeholderSpeech: ProjectSettingsDto["placeholderSpeech"]; localeDefault: string }, renames: Record<string, string>): Promise<void> {
  const ps = after.placeholderSpeech;
  if (!ps) return;
  if (!before.placeholderSpeech) { void c.makeProjectSpeech(); return; }
  const accentWas = before.placeholderSpeech.accent ?? accentForLanguage(before.localeDefault);
  const accent = ps.accent ?? accentForLanguage(after.localeDefault);
  const tierWas = before.placeholderSpeech.tier === "hd" ? "hd" : "standard";
  const tier = ps.tier === "hd" ? "hd" : "standard";
  const voiceOf = (m: CastMember | undefined, name: string, acc: string | undefined, t: "standard" | "hd"): string | undefined => m?.placeholderVoice ?? defaultPlaceholderVoice(name, acc, m?.gender, t);
  const byNewName = new Map(Object.entries(renames).map(([from, to]) => [to, from]));
  const changed = after.cast.filter((m) => {
    const was = byNewName.get(m.name) ?? m.name;
    return voiceOf(m, m.name, accent, tier) !== voiceOf(before.cast.find((c) => c.name === was), was, accentWas, tierWas);
  }).map((m) => m.name);
  if (!changed.length) return;
  const n = await window.patter.speechCount({ characters: changed });
  if (n === 0) return;
  const who = changed.length === 1 ? changed[0]! : `${changed.length} characters`;
  const go = await confirmDialog({
    title: `Make ${n} line${n === 1 ? "" : "s"} again for ${who}?`,
    body: tier === "hd" && tierWas !== "hd"
      ? "Their Placeholder Speech voice changed to an HD voice, which Google bills at a higher rate on your own Google account. If you'd rather wait, Production > Placeholder Speech makes it later."
      : "Their Placeholder Speech voice changed. If you'd rather wait, Production > Placeholder Speech makes it later.",
    confirmLabel: "Make Again",
  });
  if (go) void window.patter.speechMake({ characters: changed });
}

/** The open dialog's audio state, shared by its three audio pages: made on first use after each open, and
 *  refreshing the dialog's tabs when Audio Folders comes and goes. */
function audioSettings(): AudioSettings {
  if (live.audio) return live.audio;
  const { s } = settingsRead!;
  const a = createAudioSettings({ trackAudioStatus: s.trackAudioStatus, statuses: s.recordingStatuses, audioFolders: s.audioFolders, audioRoot: s.audioRoot, scratchStatus: s.scratchStatus, placeholderSpeech: s.placeholderSpeech });
  a.onChange(() => settingsDlg.refreshTabs());
  live.audio = a;
  return a;
}

/** File > Project Settings: read the project-level settings, open the dialog on a tab (General by default;
 *  the coverage window's "Game scopes…" and a `@world` pill's "Go to definition" open "world"). */
export async function openProjectSettings(initialTab = "general"): Promise<void> {
  if (!c.project) return; // nothing open
  const s = await window.patter.readSettings();
  if (!s) return;
  settingsRead = { s, dictionaries: await window.patter.listDictionaries(), speakerPairs: await window.patter.speakerPairs() };
  live = {};
  settingsExtensionEdits = {};
  // The extension set decides the dialog's sections: rebuilt when it has changed since it was built.
  if (extensionShape() !== settingsDlgShape) { settingsDlg.destroy(); settingsDlg = buildSettingsDialog(); }
  settingsDlg.open(initialTab);
  if (initialTab === "general") setTimeout(() => live.name?.focus(), 0);
}

/** A quality's stages were reordered: say how many gates order it by them, since the new order changes what
 *  they mean though no value moves. Empty when none do. */
export async function fillStageNote(note: HTMLElement, target: { scope: string; name: string; scene?: string }): Promise<void> {
  if (!target.name) { note.textContent = ""; return; }
  note.textContent = stageGateNote(await window.patter.stageGates(target));   // the family's one wording
}

/** Save is clicked and every section's gate passed: read the sections back and persist. False when the
 *  write was refused, which keeps the dialog open with the edits in it. */
async function saveSettingsFromDialog(): Promise<boolean> {
  const read = settingsRead;
  const l = live as LiveSettings; // every section mounted on open(), so every handle is set
  if (!read || !l.name) return true;
  const dto: ProjectSettingsDto = {
    name: l.name.value.trim(), vcs: l.vcs.value as VcsKind, ...(l.start.value ? { start: { scene: l.start.value } } : {}),
    voiced: l.voiced.checked, formatting: l.formatting.checked,
    padAfterDefault: l.padAfter.value.trim() === "" ? DEFAULT_PAD_AFTER : Number(l.padAfter.value), // the gate checked its range
    estimateSpeed: l.estimateSpeed.value.trim() === "" ? DEFAULT_ESTIMATE_SPEED : Number(l.estimateSpeed.value),
    closedCaptions: { open: l.ccOpen.value, close: l.ccClose.value, character: l.ccCharacter.value.trim() },
    buildBundle: l.build.value.trim(), buildLocalisation: l.buildLocales.value as "embedded" | "ids", buildSourceDebug: l.buildSourceDebug.checked,
    ...l.langs.value(), localiseDialogueText: l.localiseDialogueText.checked, gameDataFields: l.gd.value(),
    properties: read.s.properties, // @patter lives in the Properties document now; pass the current set through untouched
    ...l.world.value(), ...(() => {
      // Stages renamed in place on World properties and on game-data fields: the save carries each into
      // every value that names it, in the same batch as the declarations.
      const stageRenames = [...l.world.stageRenames(), ...l.gd.stageRenames()];
      return stageRenames.length ? { stageRenames } : {};
    })(), cast: l.cast.value(), castRenames: l.cast.renames(),
    qualifiers: l.qualifiers.value(), qualifierRenames: l.qualifiers.renames(), speakerPattern: l.qualifiers.pattern(),
    writingStatuses: l.writingStatus.value(), estimating: l.estimating.value(), ...l.audio.value(),
    ...l.dictionary.value(),
    ...(Object.keys(settingsExtensionEdits).length ? { extensionValues: { ...settingsExtensionEdits } } : {}),
  };
  const saved = await saveProjectSettings(dto);
  // Once the dialog has closed: a changed voice offers to remake its lines; turned on, to make them all.
  if (saved) setTimeout(() => void afterSpeechSettings(read.s, { cast: dto.cast, placeholderSpeech: dto.placeholderSpeech, localeDefault: dto.localeDefault }, dto.castRenames ?? {}), 0);
  return saved;
}

/** Save the project's settings; false (after saying why) when the write was refused, so the Settings dialog
 *  can stay open with the author's edits in it. */
export async function saveProjectSettings(s: ProjectSettingsDto, opts: { propertiesOnly?: boolean; undo?: { label: string; key: string } } = {}): Promise<boolean> {
  const res = await c.tracked(window.patter.saveSettings(s, opts.undo));
  if (!landed(res, "Couldn't save the project settings")) return false;
  if (res.project) {
    c.project = res.project; c.showProjectTitle(c.project);
    // The project's @patter properties may have changed (added / renamed / re-typed / enum values edited):
    // rebuild the condition-editor catalogue so they're selectable immediately, without a scene reload or a
    // restart. Mirrors openSceneProps for the scene scope; keeps the load-time order (@patter first). New
    // default values reach the run through the play window's live refresh (the main process triggers it).
    // The host scopes (#159) may have changed too, and with a game scopes folder so may the shared file:
    // rebuild their properties, and the editors' dialect.
    c.sceneProps = [
      ...s.properties.map((d) => c.declToConditionProperty("patter", d)),
      ...c.sceneProps.filter((p) => p.scope === "scene"),
    ];
    await refreshEditorScopes();
    void c.refreshVcStatus(); // the PROJECT shard just changed on disk: re-badge the Properties row
    if (!opts.propertiesOnly) {
      await c.buildSpellcheck(); // the Dictionary settings (language / words / on-off) may have changed (#177)
      c.pushWritingStatus(); // the writing-status ladder (names / colours) may have changed - re-push to the surface (#196)
      c.surface?.setQualifiers(c.project.qualifiers ?? []); // the qualifier names (and list) may have changed: the cues repaint
      c.pushCast(); // the Cast tab may have added, removed, or renamed someone (who keeps their colour)
      c.surface?.setLocaliseDialogueText(c.project.localiseDialogueText); // action text may have become shown text, or the reverse
    }
    void c.refreshProblems();  // revalidate against the new declarations (and, after a full save, the new spelling setup)
    c.lastInspectorSig = null; if (c.lastInspectorCtx) c.showInspector(c.lastInspectorCtx); // refresh the status dropdown + condition pills
  }
  return true;
}

/** Rebuild the editors' other scopes from the main process, the one place that knows them all: the
 *  host scopes, and the game scopes folder's (another engine's `@story`, whose tip says whose it is).
 *  Keeps this scene's `@patter` and `@scene` entries as they are, since those may be unsaved edits. */
async function refreshEditorScopes(): Promise<void> {
  if (!c.currentSceneId) return;
  const fresh = await window.patter.readScene(c.currentSceneId);
  c.sceneProps = [
    ...c.sceneProps.filter((p) => p.scope === "patter"),
    ...fresh.properties.filter((p) => p.scope !== "patter" && p.scope !== "scene"),
    ...c.sceneProps.filter((p) => p.scope === "scene"),
  ];
  setHostScopeTokens(fresh.hostScopes);
}

/** Add extension… (the Extensions window, or a view's "(not installed)…"): main picks and checks the package, takes it into the project as one undo step (with
 *  any extension it requires that the project lacks), and installs its views on this machine (then reloads the
 *  open scene, which now takes the extension's data). For an extension the project takes already, main installs
 *  its views and offers a newer version (`expect`, from a view "(not installed)…" in the Window menu, says which).
 *  Here the project is refreshed, and the writer told what happened. */
export async function addExtension(expect?: string): Promise<void> {
  if (!c.project) return;
  landExtension(await window.patter.addExtension(expect));
}

/** Update… in the Extensions window: main asks for the package and says what will happen (a newer version taken
 *  as one undo step and installed, the same version reinstalled, an older one or another extension refused). The
 *  result lands as Add's does. */
export async function updateExtension(id: string): Promise<void> {
  if (!c.project) return;
  landExtension(await window.patter.updateExtension(id));
}

/** What Add or Update did: the step noted, the project refreshed, and the writer told. */
function landExtension(r: AddExtensionResult | null): void {
  if (!r) return; // cancelled, or refused (main has said why)
  if (r.ok && r.reinstalled && r.installedOnly) {
    const what = `${r.name ?? "The extension"} ${r.version ?? ""}`.trim();
    if (r.installError) toast(`${what} couldn't be reinstalled on this machine: ${r.installError}`, "error");
    else toast(`Reinstalled ${what} on this machine`, "ok");
    return;
  }
  if (r.ok && r.installedOnly) {
    const what = `${r.name ?? "The extension"} ${r.version ?? ""}`.trim();
    if (r.installError) toast(`${what}'s views couldn't be installed on this machine: ${r.installError}`, "error");
    else toast(`${what}'s views are installed on this machine.${r.note ? `\n${r.note}` : ""}`, r.note ? "info" : "ok");
    return;
  }
  c.noteStep(r.step);
  if (!landed(r, "Couldn't add the extension")) return;
  if (r.project) { c.project = r.project; c.showProjectTitle(c.project); }
  c.views.changed("all"); // over the project as it is now: a view's requirement may be met
  c.lastInspectorSig = null; if (c.lastInspectorCtx) c.showInspector(c.lastInspectorCtx);
  void c.refreshVcStatus();
  void c.refreshProblems();
  const also = (r.also ?? []).map((a) => `${a.name} ${a.version}`);
  const done = r.reinstalled ? "Reinstalled" : r.was !== undefined ? "Updated" : "Added";
  const what = `${done} ${[...also, `${r.name ?? "the extension"} ${r.version ?? ""}`.trim()].join(" and ")}`;
  if (r.installError) toast(`${what}\nIts views couldn't be installed on this machine: ${r.installError}`, "error");
  else toast(`${what}${r.warnings?.length ? `\n${r.warnings.join(" ")}` : ""}`, r.warnings?.length ? "info" : "ok");
}

/** Remove from Project…, asked for in the Extensions window (patterkit design/extensions-window.md): main refuses
 *  while another extension needs it, asks first, and takes it out of the project as one undo step that keeps its
 *  data. Here the step is noted and the project refreshed, as for Add. */
export async function removeExtension(id: string): Promise<void> {
  if (!c.project) return;
  const r = await window.patter.removeExtension(id);
  if (!r) return; // refused or cancelled (main has said why)
  c.noteStep(r.step);
  if (!landed(r, "Couldn't remove the extension")) return;
  if (r.project) { c.project = r.project; c.showProjectTitle(c.project); }
  c.views.changed("all");
  c.lastInspectorSig = null; if (c.lastInspectorCtx) c.showInspector(c.lastInspectorCtx);
  void c.refreshVcStatus();
  void c.refreshProblems();
  toast(`Removed ${r.name ?? "the extension"}`, "ok");
}

/** File ▸ Share Scopes with Other Tools: make the game's shared scopes folder (main asks where), then
 *  pick up the folder's scopes in the editors. */
export async function shareScopes(): Promise<void> {
  if (!c.project) return;
  const r = await window.patter.shareScopes();
  if (!r) return; // cancelled
  if ("error" in r) { landed({ ok: false, error: r.error }, "Couldn't share the scopes"); return; }
  if ("shared" in r) { toast(`This project already shares its scopes.\nThey're in ${r.shared}.`, "ok"); return; }
  await refreshEditorScopes();
  void c.refreshProblems();
  c.lastInspectorSig = null; if (c.lastInspectorCtx) c.showInspector(c.lastInspectorCtx);
  toast(`Scopes shared\n${r.dir}`, "ok");
}

/** Scene inspector > Properties: edit the open scene's local `@scene` property declarations. Persists
 *  through the surface (the scene doc's raw, round-tripped on save) and refreshes the condition
 *  catalogue so the new props are usable immediately. Returns the list's host, so "Go to definition" can
 *  reveal a row in it, or null with no scene open. */
