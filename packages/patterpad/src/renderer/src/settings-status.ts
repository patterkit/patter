// The status-vocabulary editors, split across two Project Settings tabs (spec §13): WRITING statuses
// (each WritingStatusDecl is a name, a palette colour, plus the two readiness THRESHOLD markers - "ready
// to record" / "ready to ship" - each declared on exactly one status, enforced as radio groups) and
// RECORDING statuses (a name + palette colour ladder; #206). Both ladders run not-done -> done; each
// mount returns a clean value(). They share the small row/list/colour helpers below.

import type { WritingStatusDecl, RecordingStatusDecl, RecordingFolder } from "@patterkit/model";
import { deriveRecordingFolders } from "@patterkit/model";
import { PALETTE_SIZE } from "@patterkit/patterpad-surface/colour";
import { el, iconBtn, moveItem } from "./dom.js";
import { focusNewRow } from "./settings-list.js";

export interface WritingStatusHandle { value(): WritingStatusDecl[]; }
export interface AudioHandle { value(): { trackAudioStatus: boolean; recordingStatuses: RecordingStatusDecl[]; audioFolders: boolean; audioRoot: string | null; scratchStatus: string | null }; }

/** A captionless ladder block: a hint line, the rows, and a trailing "+ Add" button. */
function renderLadder(host: HTMLElement, hint: string, rows: HTMLElement[], addLabel: string, add: () => void): void {
  host.append(el("p", "settings-note", hint));
  const list = el("div", "gd-fieldlist"); rows.forEach((r) => list.append(r)); host.append(list);
  const b = el("button", "gd-add", addLabel); b.type = "button"; b.addEventListener("click", add); host.append(b);
}

// The status badge colour (#196 / #206) is drawn from the theme's 12-slot character palette, so it adapts
// to light / dark + the reading palettes. To keep each status row to a single line, the palette lives in a
// POPOVER opened by one swatch button on the row (showing the current colour); picking a slot re-renders.
let popCleanup: (() => void) | null = null;
function closeColourPop(): void {
  popCleanup?.(); popCleanup = null;
  document.querySelectorAll(".sp-colour-pop").forEach((p) => p.remove());
}
function openColourPop(anchor: HTMLElement, s: { colour?: number }, render: () => void): void {
  closeColourPop();
  // Anchor inside the (modal) settings dialog so the popover paints in its top layer; `position: fixed`
  // (set in CSS) escapes the field list's overflow:auto clipping.
  const host = anchor.closest("dialog") ?? document.body;
  const pop = el("div", "sp-colour-pop");
  const swatch = (label: string, colour: number | undefined, none: boolean): void => {
    const sw = el("button", `sp-swatch${none ? " sp-swatch-none" : ""}`) as HTMLButtonElement;
    sw.type = "button"; sw.dataset.tip = label; sw.setAttribute("aria-label", label);
    if (!none) sw.style.background = `var(--char-${colour})`;
    if (s.colour === colour) sw.classList.add("active");
    sw.addEventListener("click", () => { if (colour == null) delete s.colour; else s.colour = colour; closeColourPop(); render(); });
    pop.append(sw);
  };
  swatch("no colour", undefined, true);
  for (let slot = 0; slot < PALETTE_SIZE; slot++) swatch(`colour ${slot + 1}`, slot, false);
  host.append(pop);
  // Place under the button, clamped into the viewport (offsetWidth forces a synchronous layout).
  const r = anchor.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.left, window.innerWidth - 8 - pop.offsetWidth));
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(r.bottom + 4)}px`;
  setTimeout(() => {
    const onDown = (e: PointerEvent): void => { const t = e.target as Node; if (!pop.contains(t) && t !== anchor) closeColourPop(); };
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") { e.stopPropagation(); closeColourPop(); } };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    popCleanup = (): void => { document.removeEventListener("pointerdown", onDown, true); document.removeEventListener("keydown", onKey, true); };
  }, 0);
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
    const row = el("div", "gd-row");
    const line = el("div", "gd-rowline gd-status-line");
    const name = el("input", "gd-input gd-name") as HTMLInputElement;
    name.type = "text"; name.placeholder = "<status name>"; name.value = s.name; name.spellcheck = false;
    name.addEventListener("input", () => { s.name = name.value; });
    const markers = el("div", "gd-markers");
    markers.append(
      marker("sp-rtr", !!s.readyToRecord, "Record", "This status means: ready to record (voice).", () => { for (const w of writing) delete w.readyToRecord; s.readyToRecord = true; }),
      marker("sp-rts", !!s.readyToShip, "Ship", "This status means: ready to ship.", () => { for (const w of writing) delete w.readyToShip; s.readyToShip = true; }),
    );
    const acts = el("div", "gd-acts");
    acts.append(
      iconBtn("↑", "move earlier", () => { moveItem(writing, i, -1); render(); }, i === 0),
      iconBtn("↓", "move later", () => { moveItem(writing, i, 1); render(); }, i === writing.length - 1),
      iconBtn("✕", "delete status", () => { writing.splice(i, 1); ensureMarkers(); render(); }, false, true),
    );
    line.append(name, markers, colourButton(s, render), acts);
    row.append(line);
    return row;
  };

  const render = (): void => {
    ensureMarkers();
    closeColourPop();
    host.replaceChildren();
    renderLadder(host,
      "From not-started to done. The lowest rung is the default for any beat with no status set. Pick which status means ready to record, and which means ready to ship.",
      writing.map(writingRow), "+ Add writing status", () => { writing.push({ name: "" }); render(); focusNewRow(host.querySelector(".gd-fieldlist")); });
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

export function mountAudio(host: HTMLElement, initial: { trackAudioStatus: boolean; statuses: RecordingStatusDecl[]; audioFolders: boolean; audioRoot: string | null; scratchStatus: string | null }): AudioHandle {
  const recording: RecordingStatusDecl[] = structuredClone(initial.statuses ?? []);
  let trackAudioStatus = !!initial.trackAudioStatus; // master gate (#206): off => audio status tracked nowhere
  let audioFolders = !!initial.audioFolders;
  let audioRoot: string = initial.audioRoot ?? ""; // the single root; each rung's subfolder derives from it
  let scratchStatus: string | null = initial.scratchStatus ?? null; // the rung scratch takes record into (#224)

  // Each rung mapped to its derived folder <audioRoot>/<slug(name)> (baseline rung + empty root -> no folder).
  const derived = (): RecordingFolder[] => deriveRecordingFolders(audioRoot, recording);
  // Rungs that can host scratch takes: those that have a derived folder.
  const folderRungs = (): RecordingFolder[] => derived().filter((r) => r.name.trim() && r.folder);

  // In folder mode the LOWEST rung is the fixed "not recorded" fallback (a line with no audio file anywhere):
  // it must exist, and never gets a derived folder. Seed one if the ladder is empty.
  const ensureSentinel = (): void => {
    if (!audioFolders) return;
    if (!recording.length) recording.unshift({ name: "missing", colour: 0 });
  };
  ensureSentinel();

  const recordingRow = (s: RecordingStatusDecl, i: number): HTMLElement => {
    // One line: name | (derived-folder hint, in folder mode) | a colour swatch (palette popover) | move/delete.
    const row = el("div", "gd-row");
    const line = el("div", "gd-rowline gd-status-line");
    // The fixed "not recorded" fallback (folder mode, lowest rung): its name / delete are locked.
    const locked = audioFolders && i === 0;
    const name = el("input", "gd-input gd-name") as HTMLInputElement;
    name.type = "text"; name.placeholder = "<status name>"; name.value = s.name; name.spellcheck = false;
    if (locked) { name.readOnly = true; name.classList.add("sp-locked"); name.dataset.tip = "The fallback for any line with no audio file. Fixed while Audio Folders is on."; }
    else name.addEventListener("input", () => { s.name = name.value; });
    const acts = el("div", "gd-acts");
    acts.append(
      // The sentinel stays first: it can't move, and the rung above it can't move up into its slot.
      iconBtn("↑", "move earlier", () => { moveItem(recording, i, -1); render(); }, i === 0 || (audioFolders && i === 1)),
      iconBtn("↓", "move later", () => { moveItem(recording, i, 1); render(); }, i === recording.length - 1 || locked),
      iconBtn("✕", "delete status", () => { recording.splice(i, 1); render(); }, locked, true),
    );
    line.append(name);
    // Audio Folders mode: show the AUTO-DERIVED subfolder (read-only), not a manual folder field. The fallback
    // rung has none; a rung shows "set an audio root above" until the root is filled in.
    if (audioFolders) {
      const d = derived()[i];
      if (locked) line.append(el("span", "sp-folder-none", "not recorded (the fallback)"));
      else if (d?.folder) line.append(el("span", "sp-folder-derived", d.folder + "/"));
      else line.append(el("span", "sp-folder-none", "set an audio root above"));
    }
    line.append(colourButton(s, render), acts);
    row.append(line);
    return row;
  };

  const render = (): void => {
    closeColourPop();
    host.replaceChildren();

    // Master gate (#206): "Track Audio Status?" at the very top. The tab itself is already disabled unless the
    // project is Voiced (syncAudioSettingsTab), so this is the second, opt-out switch WITHIN a voiced project.
    // Off => everything below is inert, and nothing downstream (inspector, report, .xlsx) shows audio status.
    const trackRow = el("label", "settings-toggle");
    const tcb = el("input") as HTMLInputElement; tcb.type = "checkbox"; tcb.checked = trackAudioStatus;
    const tcap = el("span"); tcap.append(document.createTextNode("Track Audio Status?"));
    tcap.append(el("small", undefined, "Track each voiced line's recording progress - shown in the inspector, production reports, and the .xlsx export."));
    tcb.addEventListener("change", () => { trackAudioStatus = tcb.checked; render(); });
    trackRow.append(tcb, tcap);
    host.append(trackRow);

    // Everything below (the ladder, Audio Folders, scratch) is inert + dimmed until tracking is on.
    const body = el("div", "sp-audio-body");
    if (!trackAudioStatus) { body.setAttribute("inert", ""); body.classList.add("is-disabled"); }
    host.append(body);

    // Audio Folders mode: ONE audio-root folder, above the ladder so each rung's derived subfolder shows below.
    if (audioFolders) {
      const rootRow = el("label", "sp-folder");
      rootRow.append(el("span", "sp-folder-cap", "Audio root folder"));
      const inp = el("input", "gd-input sp-folder-input") as HTMLInputElement;
      inp.type = "text"; inp.placeholder = "../audio"; inp.spellcheck = false; inp.value = audioRoot;
      inp.dataset.tip = "One folder; each rung gets an auto-named subfolder under it (from the status name).";
      inp.addEventListener("input", () => { audioRoot = inp.value; });
      inp.addEventListener("change", () => render()); // refresh the derived subfolder hints once you finish typing
      rootRow.append(inp);
      body.append(rootRow);
    }

    renderLadder(body,
      audioFolders
        ? "A line's recording status is the HIGHEST rung whose derived folder holds its <beatId>.wav (preferred) or .mp3, else the fallback. Each rung's subfolder is named from its status."
        : "From not-recorded to done. The lowest rung is the default for any line with no recording status.",
      recording.map(recordingRow), "+ Add recording status", () => { recording.push({ name: "" }); render(); focusNewRow(body.querySelector(".gd-fieldlist")); });

    // The Audio Folders toggle sits BELOW the ladder: off = manual recording status (set per line in the
    // inspector); on = derive each dialogue line's status from which derived folder holds its <beatId>.wav (#206).
    const modeRow = el("label", "settings-toggle");
    const cb = el("input") as HTMLInputElement; cb.type = "checkbox"; cb.checked = audioFolders;
    cb.addEventListener("change", () => {
      audioFolders = cb.checked;
      // Turning folder mode ON: guarantee the "not recorded" fallback, and seed a sensible default audio root
      // (../audio) so the derived subfolders are immediately meaningful. Never clobber an existing root.
      if (audioFolders) { ensureSentinel(); if (!audioRoot.trim()) audioRoot = "../audio"; }
      render();
    });
    const cap = el("span"); cap.append(document.createTextNode("Use Audio Folders"));
    const sub = el("small", undefined, "Derive each dialogue line's recording status from audio files on disk."); cap.append(sub);
    modeRow.append(cb, cap);
    body.append(modeRow);

    // Scratch recording (#224, folder mode only): a toggle + a picker for which rung's derived folder receives
    // in-app scratch takes. The picker lists only rungs that have a derived folder (needs an audio root).
    if (audioFolders) {
      const rungs = folderRungs();
      if (scratchStatus && !rungs.some((r) => r.name.trim() === scratchStatus)) scratchStatus = null; // its folder went away
      const scratchOn = scratchStatus != null;
      const row = el("label", "settings-toggle");
      const cb2 = el("input") as HTMLInputElement; cb2.type = "checkbox"; cb2.checked = scratchOn; cb2.disabled = rungs.length === 0;
      const cap2 = el("span"); cap2.append(document.createTextNode("Enable scratch recording"));
      const sub2 = el("small", undefined, rungs.length === 0
        ? "Set an audio root first: scratch takes record into a rung's derived folder."
        : "Record quick scratch takes in-app, straight into a status folder."); cap2.append(sub2);
      cb2.addEventListener("change", () => { scratchStatus = cb2.checked ? (scratchStatus ?? rungs[0]?.name.trim() ?? null) : null; render(); });
      row.append(cb2, cap2);
      body.append(row);
      if (scratchOn) {
        const pick = el("label", "sp-folder");
        pick.append(el("span", "sp-folder-cap", "Records into"));
        const sel = el("select", "gd-input sp-folder-input") as HTMLSelectElement;
        for (const r of rungs) { const o = el("option", undefined, r.name.trim()) as HTMLOptionElement; o.value = r.name.trim(); sel.append(o); }
        sel.value = scratchStatus!;
        sel.addEventListener("change", () => { scratchStatus = sel.value; });
        pick.append(sel);
        body.append(pick);
      }
    }
  };
  render();

  return {
    value(): { trackAudioStatus: boolean; recordingStatuses: RecordingStatusDecl[]; audioFolders: boolean; audioRoot: string | null; scratchStatus: string | null } {
      const recordingStatuses = recording.filter((s) => s.name.trim()).map((s): RecordingStatusDecl => {
        const c: RecordingStatusDecl = { name: s.name.trim() };
        if (s.colour != null) c.colour = s.colour;
        return c;
      });
      // Only valid in folder mode, and only when the chosen rung still has a derived folder.
      const scratch = audioFolders && scratchStatus && folderRungs().some((r) => r.name.trim() === scratchStatus) ? scratchStatus : null;
      const root = audioRoot.trim();
      return { trackAudioStatus, recordingStatuses, audioFolders, audioRoot: root || null, scratchStatus: scratch };
    },
  };
}
