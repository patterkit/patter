import { openPopover } from "@wildwinter/app-shell/context-menu";
// The status-vocabulary editors, across the Project Settings pages (spec §13): WRITING statuses
// (each WritingStatusDecl is a name, a palette colour, plus the two readiness THRESHOLD markers - "ready
// to record" / "ready to ship" - each declared on exactly one status, enforced as radio groups) and
// RECORDING statuses (a name + palette colour ladder; #206). Both ladders run not-done -> done; each
// mount returns a clean value(). They share the small row/list/colour helpers below.

import type { WritingStatusDecl, RecordingStatusDecl } from "@patterkit/model";
import { deriveRecordingFolders } from "@patterkit/model";
import { PALETTE_SIZE } from "@patterkit/patterpad-surface/colour";
import { el } from "./dom.js";
import { iconBtn, moveItem, focusNewRow, labelledToggle } from "@wildwinter/app-shell";

export interface WritingStatusHandle { value(): WritingStatusDecl[]; }

/** A captionless ladder block: a hint line, the rows, and a trailing "+ Add" button. */
function renderLadder(host: HTMLElement, hint: string, rows: HTMLElement[], addLabel: string, add: () => void): void {
  host.append(el("p", "settings-note", hint));
  const list = el("div", "gd-fieldlist"); rows.forEach((r) => list.append(r)); host.append(list);
  const b = el("button", "gd-add", addLabel); b.type = "button"; b.addEventListener("click", add); host.append(b);
}

// The status badge colour (#196 / #206) is drawn from the theme's 12-slot character palette, so it adapts
// to light / dark + the colour themes. To keep each status row to a single line, the palette lives in a
// POPOVER opened by one swatch button on the row (showing the current colour); picking a slot re-renders.
function openColourPop(anchor: HTMLElement, s: { colour?: number }, render: () => void): void {
  // The shell's popover, hosted INSIDE the modal settings dialog so it paints in the dialog's top layer
  // rather than inert beneath the scrim (app-shell 0.39.0, PopoverOptions.host).
  const host = (anchor.closest("dialog") as HTMLElement | null) ?? document.body;
  openPopover(anchor, (close) => {
    const pop = el("div", "sp-colour-pop");
    const swatch = (label: string, colour: number | undefined, none: boolean): void => {
      const sw = el("button", `sp-swatch${none ? " sp-swatch-none" : ""}`) as HTMLButtonElement;
      sw.type = "button"; sw.dataset.tip = label; sw.setAttribute("aria-label", label);
      if (!none) sw.style.background = `var(--char-${colour})`;
      if (s.colour === colour) sw.classList.add("active");
      sw.addEventListener("click", () => { if (colour == null) delete s.colour; else s.colour = colour; close(); render(); });
      pop.append(sw);
    };
    swatch("No colour", undefined, true);
    for (let slot = 0; slot < PALETTE_SIZE; slot++) swatch(`Colour ${slot + 1}`, slot, false);
    return pop;
  }, undefined, { host });
}

/** A single round swatch on the row showing the status's current colour; opens the palette popover. */
function colourButton(s: { colour?: number }, render: () => void): HTMLElement {
  const btn = el("button", `sp-swatch sp-colour-btn${s.colour == null ? " sp-swatch-none" : ""}`) as HTMLButtonElement;
  btn.type = "button";
  if (s.colour != null) btn.style.background = `var(--char-${s.colour})`;
  btn.dataset.tip = s.colour == null ? "No colour. Click to pick." : `Colour ${s.colour + 1}. Click to change.`;
  btn.setAttribute("aria-label", btn.dataset.tip);
  btn.addEventListener("click", () => openColourPop(btn, s, render));
  return btn;
}

// --- Writing statuses ------------------------------------------------------------------------------

export function mountWritingStatus(host: HTMLElement, initial: WritingStatusDecl[]): WritingStatusHandle {
  const writing: WritingStatusDecl[] = structuredClone(initial ?? []);

  // Each marker must sit on exactly one status; if a delete leaves none, pin it to the last (highest) one.
  const ensureMarkers = (): void => {
    if (!writing.length) return;
    if (!writing.some((s) => s.readyToRecord)) writing[writing.length - 1]!.readyToRecord = true;
    if (!writing.some((s) => s.readyToShip)) writing[writing.length - 1]!.readyToShip = true;
  };

  const marker = (group: string, on: boolean, label: string, tip: string, set: () => void): HTMLElement => {
    const l = el("label", "gd-marker"); l.dataset.tip = tip;
    const r = el("input") as HTMLInputElement; r.type = "radio"; r.name = group; r.checked = on;
    r.addEventListener("change", () => { if (r.checked) { set(); } });
    l.append(r, el("span", undefined, label));
    return l;
  };

  const writingRow = (s: WritingStatusDecl, i: number): HTMLElement => {
    // One line: name | the two readiness radios | a colour swatch (opens the palette popover) | move/delete.
    const row = el("div", "set-row");
    const line = el("div", "set-rowline gd-status-line");
    const name = el("input", "gd-input gd-name") as HTMLInputElement;
    name.type = "text"; name.placeholder = "Status name"; name.value = s.name; name.spellcheck = false;
    name.addEventListener("input", () => { s.name = name.value; });
    const markers = el("div", "gd-markers");
    markers.append(
      marker("sp-rtr", !!s.readyToRecord, "Record", "Lines at this status are ready to record.", () => { for (const w of writing) delete w.readyToRecord; s.readyToRecord = true; }),
      marker("sp-rts", !!s.readyToShip, "Ship", "Lines at this status are ready to ship.", () => { for (const w of writing) delete w.readyToShip; s.readyToShip = true; }),
    );
    const acts = el("div", "gd-acts");
    acts.append(
      iconBtn("up", "Move earlier", () => { moveItem(writing, i, -1); render(); }, i === 0),
      iconBtn("down", "Move later", () => { moveItem(writing, i, 1); render(); }, i === writing.length - 1),
      iconBtn("close", "Delete status", () => { writing.splice(i, 1); ensureMarkers(); render(); }, false, true),
    );
    line.append(name, markers, colourButton(s, render), acts);
    row.append(line);
    return row;
  };

  const render = (): void => {
    ensureMarkers();
    
    host.replaceChildren();
    renderLadder(host,
      "The lowest status is the default for a beat with none set. Mark which one means ready to record and which means ready to ship.",
      writing.map(writingRow), "+ Add writing status", () => { writing.push({ name: "" }); render(); focusNewRow(host.querySelector<HTMLElement>(".gd-fieldlist")); });
  };
  render();

  return {
    value(): WritingStatusDecl[] {
      ensureMarkers();
      return writing.filter((s) => s.name.trim()).map((s): WritingStatusDecl => {
        const c: WritingStatusDecl = { name: s.name.trim() };
        if (s.readyToRecord) c.readyToRecord = true;
        if (s.readyToShip) c.readyToShip = true;
        if (s.colour != null) c.colour = s.colour;
        return c;
      });
    },
  };
}

// --- Recording statuses ----------------------------------------------------------------------------

// --- Audio: three settings pages over one state ----------------------------------------------------
// Recording status (the ladder and Audio Folders), Scratch recording, and Placeholder Speech are separate
// pages in the dialog, but one state: renaming a status on the first page is seen by the pickers on the other
// two. Each page re-renders when the state changes. The scratch and Placeholder Speech statuses are held as
// the status objects themselves, so a rename carries them; value() turns them back into names.

export interface PlaceholderSpeechValue { status: string; keyFile?: string; accent?: string; keepOutOfVersionControl?: boolean }
export interface AudioValue {
  trackAudioStatus: boolean; recordingStatuses: RecordingStatusDecl[]; audioFolders: boolean; audioRoot: string | null;
  scratchStatus: string | null; placeholderSpeech: PlaceholderSpeechValue | null;
}
export interface AudioInitial {
  trackAudioStatus: boolean; statuses: RecordingStatusDecl[]; audioFolders: boolean; audioRoot: string | null;
  scratchStatus: string | null; placeholderSpeech: PlaceholderSpeechValue | null;
}
export interface AudioSettings {
  /** Called whenever any page changes the state (each page re-renders; the dialog refreshes its tabs). */
  onChange(fn: () => void): void;
  /** Whether Audio Folders is on, for the dialog's disabled tabs. */
  foldersOn(): boolean;
  value(): AudioValue;
  /** For the pages below. */
  readonly s: AudioState;
  changed(): void;
}
interface AudioState {
  trackAudioStatus: boolean;
  recording: RecordingStatusDecl[];
  audioFolders: boolean;
  audioRoot: string;
  scratch: RecordingStatusDecl | null;
  placeholder: { rung: RecordingStatusDecl | null; on: boolean; keyFile: string; accent: string; keepOut: boolean };
}

const PLACEHOLDER_STATUS = "placeholder";

export function createAudioSettings(initial: AudioInitial): AudioSettings {
  const recording: RecordingStatusDecl[] = structuredClone(initial.statuses ?? []);
  const byName = (n: string | null | undefined): RecordingStatusDecl | null => (n ? recording.find((r) => r.name === n) ?? null : null);
  const ps = initial.placeholderSpeech;
  const s: AudioState = {
    trackAudioStatus: !!initial.trackAudioStatus,
    recording,
    audioFolders: !!initial.audioFolders,
    audioRoot: initial.audioRoot ?? "",
    scratch: byName(initial.scratchStatus),
    placeholder: { rung: byName(ps?.status), on: !!ps, keyFile: ps?.keyFile ?? "", accent: ps?.accent ?? "", keepOut: !!ps?.keepOutOfVersionControl },
  };
  const listeners: Array<() => void> = [];
  const live = (r: RecordingStatusDecl | null): boolean => !!r && recording.includes(r) && recording.indexOf(r) > 0 && !!r.name.trim();
  return {
    s,
    onChange(fn) { listeners.push(fn); },
    changed() { for (const fn of listeners) fn(); },
    foldersOn: () => s.trackAudioStatus && s.audioFolders && !!s.audioRoot.trim(),
    value(): AudioValue {
      const recordingStatuses = recording.filter((r) => r.name.trim()).map((r): RecordingStatusDecl => {
        const c: RecordingStatusDecl = { name: r.name.trim() };
        if (r.colour != null) c.colour = r.colour;
        return c;
      });
      const root = s.audioRoot.trim();
      const folders = s.audioFolders && !!root;
      const scratchStatus = folders && live(s.scratch) && s.scratch !== s.placeholder.rung ? s.scratch!.name.trim() : null;
      const p = s.placeholder;
      const placeholderSpeech: PlaceholderSpeechValue | null = folders && p.on && live(p.rung) ? {
        status: p.rung!.name.trim(),
        ...(p.keyFile.trim() ? { keyFile: p.keyFile.trim() } : {}),
        ...(p.accent ? { accent: p.accent } : {}),
        ...(p.keepOut ? { keepOutOfVersionControl: true } : {}),
      } : null;
      return { trackAudioStatus: s.trackAudioStatus, recordingStatuses, audioFolders: s.audioFolders, audioRoot: root || null, scratchStatus, placeholderSpeech };
    },
  };
}

/** The rungs that have a folder (all but the lowest, once there's an audio root), in ladder order. */
function folderRungs(a: AudioSettings): Array<{ rung: RecordingStatusDecl; folder: string }> {
  const d = deriveRecordingFolders(a.s.audioRoot, a.s.recording);
  return a.s.recording.flatMap((rung, i) => (d[i]?.folder && rung.name.trim() ? [{ rung, folder: d[i]!.folder! }] : []));
}

/** Project settings > Recording status: tracking, Audio Folders and its root, and the ladder. */
export function mountRecordingStatus(host: HTMLElement, a: AudioSettings): void {
  const { s } = a;
  const ensureSentinel = (): void => {
    if (s.audioFolders && !s.recording.length) s.recording.unshift({ name: "missing", colour: 0 });
  };
  ensureSentinel();

  const recordingRow = (r: RecordingStatusDecl, i: number): HTMLElement => {
    const row = el("div", "set-row");
    const line = el("div", "set-rowline gd-status-line");
    const locked = s.audioFolders && i === 0; // the fixed "not recorded" fallback in folder mode
    const name = el("input", "gd-input gd-name") as HTMLInputElement;
    name.type = "text"; name.placeholder = "Status name"; name.value = r.name; name.spellcheck = false;
    if (locked) { name.readOnly = true; name.classList.add("sp-locked"); name.dataset.tip = "The status of any line with no audio file. Fixed while Audio Folders is on."; }
    else {
      name.addEventListener("input", () => { r.name = name.value; });
      name.addEventListener("change", () => a.changed()); // the other pages' pickers show the new name
    }
    const acts = el("div", "gd-acts");
    acts.append(
      iconBtn("up", "Move earlier", () => { moveItem(s.recording, i, -1); a.changed(); }, i === 0 || (s.audioFolders && i === 1)),
      iconBtn("down", "Move later", () => { moveItem(s.recording, i, 1); a.changed(); }, i === s.recording.length - 1 || locked),
      iconBtn("close", "Delete status", () => { s.recording.splice(i, 1); a.changed(); }, locked, true),
    );
    line.append(name);
    if (s.audioFolders) {
      const d = deriveRecordingFolders(s.audioRoot, s.recording)[i];
      const where = el("span", "sp-folder-where");
      if (locked) where.append(el("span", "sp-folder-none", "no audio file"));
      else if (d?.folder) where.append(el("span", "sp-folder-derived", d.folder + "/"));
      else where.append(el("span", "sp-folder-none", "set an audio root above"));
      // Which feature writes into this folder, so the ladder reads with the other two pages.
      const tag = r === s.scratch ? "Scratch recording" : r === s.placeholder.rung && s.placeholder.on ? "Placeholder Speech" : "";
      if (tag) where.append(el("span", "sp-folder-tag", tag));
      line.append(where);
    }
    line.append(colourButton(r, () => a.changed()), acts);
    row.append(line);
    return row;
  };

  const render = (): void => {
    host.replaceChildren();
    host.append(labelledToggle("Track audio status", {
      checked: s.trackAudioStatus, hint: "Shows each voiced line's recording progress in the inspector, reports, and exports.",
      onChange: (on) => { s.trackAudioStatus = on; a.changed(); },
    }).row);

    const body = el("div", "sp-audio-body");
    if (!s.trackAudioStatus) { body.setAttribute("inert", ""); body.classList.add("is-disabled"); }
    host.append(body);

    // Audio Folders and its root first: the ladder below shows the folders they give.
    body.append(labelledToggle("Use Audio Folders", {
      checked: s.audioFolders, hint: "Each status gets a folder, and a line takes the highest status whose folder holds its audio file.",
      onChange: (on) => {
        s.audioFolders = on;
        if (on) { ensureSentinel(); if (!s.audioRoot.trim()) s.audioRoot = "../audio"; }
        a.changed();
      },
    }).row);
    if (s.audioFolders) {
      const rootRow = el("label", "sp-folder sp-folder-root");
      rootRow.append(el("span", "sp-folder-cap sp-field-cap", "Audio root folder"));
      const inp = el("input", "gd-input sp-folder-input") as HTMLInputElement;
      inp.type = "text"; inp.placeholder = "../audio"; inp.spellcheck = false; inp.value = s.audioRoot;
      inp.dataset.tip = "Relative to the project folder. Each status's folder is named from the status.";
      inp.addEventListener("input", () => { s.audioRoot = inp.value; });
      inp.addEventListener("change", () => a.changed());
      rootRow.append(inp);
      body.append(rootRow);
    }

    const ladder = el("div", s.audioFolders ? "sp-ladder sp-ladder-folders" : "sp-ladder");
    body.append(el("h4", "sp-heading", "Statuses"));
    renderLadder(ladder,
      s.audioFolders
        ? "From not done to done. The first is a line with no audio file anywhere."
        : "From not done to done. The first is the status of a line with none set.",
      s.recording.map(recordingRow), "+ Add recording status", () => { s.recording.push({ name: "" }); a.changed(); focusNewRow(ladder.querySelector<HTMLElement>(".gd-fieldlist")); });
    body.append(ladder);
  };
  a.onChange(render);
  render();
}

/** Project settings > Scratch recording: in-app scratch takes, and the status they record into. */
export function mountScratchRecording(host: HTMLElement, a: AudioSettings): void {
  const { s } = a;
  /** The statuses scratch can record into: any with a folder, except Placeholder Speech's. */
  const choices = (): RecordingStatusDecl[] => folderRungs(a).map((f) => f.rung).filter((r) => !(s.placeholder.on && r === s.placeholder.rung));
  /** The default: the status named "scratch", else the lowest folder above Placeholder Speech's. */
  const preferred = (): RecordingStatusDecl | null => {
    const c = choices();
    const named = c.find((r) => r.name.trim().toLowerCase() === "scratch");
    if (named) return named;
    const above = s.placeholder.on && s.placeholder.rung ? s.recording.indexOf(s.placeholder.rung) : 0;
    return c.find((r) => s.recording.indexOf(r) > above) ?? c[0] ?? null;
  };
  const render = (): void => {
    host.replaceChildren();
    const c = choices();
    if (s.scratch && !c.includes(s.scratch)) s.scratch = null; // its folder went, or Placeholder Speech took it
    host.append(labelledToggle("Enable scratch recording", {
      checked: s.scratch != null, disabled: c.length === 0,
      hint: c.length === 0 ? "Scratch voice clips record into a status's folder: set up Audio Folders first." : "Record quick voice clips in Patterpad, straight into a status's folder.",
      onChange: (on) => { s.scratch = on ? preferred() : null; a.changed(); },
    }).row);
    if (s.scratch) {
      const pick = el("label", "sp-folder");
      pick.append(el("span", "sp-folder-cap", "Records into"));
      const sel = el("select", "gd-input sp-folder-input") as HTMLSelectElement;
      c.forEach((r, i) => { const o = new Option(r.name.trim(), String(i)); sel.append(o); });
      sel.value = String(c.indexOf(s.scratch));
      sel.addEventListener("change", () => { s.scratch = c[Number(sel.value)] ?? null; a.changed(); });
      pick.append(sel);
      host.append(pick);
      host.append(el("p", "settings-note", "Each voice clip is trimmed of silence and stamped with the words it was recorded against, so a line edited afterwards shows its voice clip as out of date."));
    }
  };
  a.onChange(render);
  render();
}

export interface PlaceholderPageOptions {
  /** The accents on offer, [code, label]. */
  accents: Array<[string, string]>;
  /** The accent the project's main language implies, or undefined when the writer must pick. */
  impliedAccent: string | undefined;
  /** Pick a key file (the native picker); the path as it should be stored, or null when cancelled. */
  chooseKeyFile(): Promise<string | null>;
  /** Whether this machine can use the key (the stored path, else the environment): a line for the page. */
  keyStatus(keyFile: string): Promise<{ ok: boolean; message: string }>;
  /** Opens the docs page on getting a key. */
  openKeyGuide(): void;
}

/** Project settings > Placeholder Speech. */
export function mountPlaceholderSpeech(host: HTMLElement, a: AudioSettings, opts: PlaceholderPageOptions): void {
  const { s } = a;
  const p = s.placeholder;
  /** On: use a status called "placeholder", else add one just above the lowest. */
  const ensureRung = (): void => {
    if (p.rung && s.recording.includes(p.rung)) return;
    p.rung = s.recording.find((r) => r.name.trim().toLowerCase() === PLACEHOLDER_STATUS) ?? null;
    if (!p.rung) { p.rung = { name: PLACEHOLDER_STATUS, colour: 7 }; s.recording.splice(Math.min(1, s.recording.length), 0, p.rung); }
    if (s.scratch === p.rung) s.scratch = null;
  };
  let statusSeq = 0;
  const render = (): void => {
    host.replaceChildren();
    const ready = a.foldersOn();
    host.append(el("p", "settings-note", "Stand-in speech for every spoken line, made from its words, so a scene can be heard before anyone records it. It sounds like a stand-in on purpose. Any scratch, recorded, or final voice clip is heard instead."));
    host.append(labelledToggle("Generate Placeholder Speech", {
      checked: p.on, disabled: !ready,
      hint: ready ? `Speech goes in the ${p.rung && p.on ? `"${p.rung.name.trim()}"` : `"${PLACEHOLDER_STATUS}"`} status's folder, below scratch.` : "Placeholder Speech goes in a status's folder: set up Audio Folders first.",
      onChange: (on) => { p.on = on; if (on) { ensureRung(); if (!p.accent && opts.impliedAccent) p.accent = opts.impliedAccent; } a.changed(); },
    }).row);
    if (!p.on) return;
    // On with no accent of its own: the one the main language implies (a bare "en" is British), saved with the rest.
    if (!p.accent && opts.impliedAccent) p.accent = opts.impliedAccent;

    // The key file: a path stored in the project (a team often shares one key), never the key itself.
    const keyRow = el("div", "sp-folder sp-key-row");
    keyRow.append(el("span", "sp-folder-cap sp-field-cap", "Google Cloud key file"));
    const key = el("input", "gd-input sp-folder-input") as HTMLInputElement;
    key.type = "text"; key.spellcheck = false; key.value = p.keyFile; key.placeholder = "~/.patter/placeholder-speech-key.json";
    key.dataset.tip = "A path relative to the project folder, or starting ~/ for your home folder. Keep the key outside version control.";
    const choose = el("button", "gd-add sp-key-choose", "Choose…") as HTMLButtonElement; choose.type = "button";
    keyRow.append(key, choose);
    const status = el("p", "settings-fieldnote sp-key-status", "Checking the key…");
    const guide = el("button", "linklike sp-key-guide", "How do I get a key?") as HTMLButtonElement; guide.type = "button";
    guide.addEventListener("click", () => opts.openKeyGuide());
    const check = (): void => {
      const seq = ++statusSeq;
      status.classList.remove("is-bad", "is-good");
      void opts.keyStatus(key.value.trim()).then((r) => {
        if (seq !== statusSeq) return;
        status.textContent = r.message;
        status.classList.add(r.ok ? "is-good" : "is-bad");
      });
    };
    key.addEventListener("input", () => { p.keyFile = key.value; });
    key.addEventListener("change", check);
    choose.addEventListener("click", () => { void opts.chooseKeyFile().then((path) => { if (path != null) { p.keyFile = path; key.value = path; check(); } }); });
    // The key, what it is, and where to get one: one block, spaced from the rest as a setting is.
    host.append(el("div", "sp-group", keyRow, status, guide));
    check();

    // The accent: which of Google's Standard voices the cast draws on.
    const accentRow = el("label", "sp-folder");
    accentRow.append(el("span", "sp-folder-cap sp-field-cap", "Accent"));
    const accent = el("select", "gd-input sp-folder-input") as HTMLSelectElement;
    if (!p.accent) accent.append(new Option("Choose an accent", ""));
    for (const [code, label] of opts.accents) accent.append(new Option(label, code));
    accent.value = p.accent;
    accent.addEventListener("change", () => { p.accent = accent.value; a.changed(); });
    accentRow.append(accent);
    const accentGroup = el("div", "sp-group", accentRow);
    if (!p.accent) accentGroup.append(el("p", "settings-fieldnote is-bad", "Choose an accent: none is on offer for the project's main language."));
    host.append(accentGroup);

    host.append(labelledToggle("Keep Placeholder Speech out of version control", {
      checked: p.keepOut,
      hint: "Each machine with a key makes its own. Saves repository space; anyone without a key hears none.",
      onChange: (on) => { p.keepOut = on; },
    }).row);
    host.append(el("p", "settings-note", "Each character's voice is set in Cast. Speech is made for lines you edit, a moment after you move on. Production > Placeholder Speech makes a whole scene or the project."));
  };
  a.onChange(render);
  render();
}
