// The Cast editor (Project Settings > Cast tab). The master cast: each member has a character ID
// (matched by a beat's speaker), an optional player-facing character name, a grammatical gender for
// translators, free-text production notes, and its own label with a qualifier where the speaker pattern
// shouldn't apply ("Shown with V.O."), one field for each qualifier its lines use. value() returns a clean
// list (blank names pruned) for the save round-trip, and renames() the members whose name changed, which
// the save carries into the lines they speak and the extension data that names them.

import type { CastMember } from "@patterkit/model";
import { COMMON_GENDERS, DEFAULT_SPEAKER_PATTERN, formatSpeakerLabel } from "@patterkit/model";
import { placeholderAccent, placeholderVoiceTier, defaultPlaceholderVoice, describePlaceholderVoice } from "@patterkit/core";
import type { PlaceholderTier } from "@patterkit/core";
import { el } from "./dom.js";
import { iconBtn, labelled, moveItem, dupGuard, expandableRow, focusNewRow } from "@wildwinter/app-shell";

export interface CastHandle {
  value(): CastMember[];
  /** Names changed on members the project already had, old -> new (the lines and data to rewrite). */
  renames(): Record<string, string>;
  firstDuplicate(): HTMLInputElement | null;
  /** Repaint the "Shown with" placeholders, after the pattern or a qualifier's name changed elsewhere. */
  refreshLabels(): void;
  /** Redraw, after Placeholder Speech was turned on or off, or its accent changed, on its own page. */
  refreshSpeech(): void;
}

/** Placeholder Speech, for the Voice field: shown only while it's on. */
export interface CastSpeech {
  on(): boolean;
  /** The accent in use, or undefined when none is chosen yet. */
  accent(): string | undefined;
  /** The voices' tier in use: Standard or HD. */
  tier(): PlaceholderTier;
  /** Say a sentence in this voice (the Hear button). */
  hear(voice: string, characterName: string): void;
}

/** What the "Shown with" fields need from outside the tab. */
export interface CastLabelSource {
  /** Every character and qualifier pair the project's lines use. */
  pairs: Array<{ character: string; qualifier: string }>;
  /** A qualifier's shown name, by the gameId the lines hold (live: the Qualifiers tab may be editing it). */
  qualifierName(gameId: string): string;
  /** The speaker pattern as it stands, "" for the default (live, as above). */
  pattern(): string;
}

let genderListSeq = 0; // unique <datalist> ids so each gender input binds to its own suggestion list

export function mountCast(host: HTMLElement, initial: CastMember[], labels?: CastLabelSource, speech?: CastSpeech): CastHandle {
  const state: CastMember[] = structuredClone(initial ?? []);
  // The name each member had when the tab opened, by the row's own object (rows move, and are removed, as
  // objects): what the lines still say. A member added here has none.
  const origins = new Map<CastMember, string>(state.map((m) => [m, m.name.trim().toUpperCase()]));
  const guard = dupGuard();
  /** Each "Shown with" field's placeholder repaint, for the rows as last rendered. */
  let repaints: Array<() => void> = [];

  // Auto-suggest values for the gender field: the everyday defaults plus any gender already used
  // elsewhere in this project's cast, so a second Latin-common or "animate" character reuses the exact
  // spelling of the first. Deduped case-insensitively (first spelling wins), defaults listed first.
  const genderSuggestions = (self: CastMember): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    const add = (v: string): void => {
      const key = v.toLowerCase();
      if (!v || seen.has(key)) return;
      seen.add(key); out.push(v);
    };
    for (const g of COMMON_GENDERS) add(g);
    for (const m of state) if (m !== self && m.gender) add(m.gender.trim());
    return out;
  };

  const memberRow = (m: CastMember, i: number): HTMLElement => {
    // Main line: the character ID, the player-facing character name, and the voice actor. Notes (longer
    // free text) tuck behind the ▸ expander.
    // The character ID is stored in CAPITALS (the house style for character IDs): upper-case any imported
    // lower-case ID on display, and live as the author types (caret preserved). Character name + actor are
    // player- / actor-facing, so they keep their typed case.
    const name = el("input", "gd-input gd-name") as HTMLInputElement;
    m.name = m.name.toUpperCase();
    name.type = "text"; name.placeholder = "Character ID"; name.dataset.tip = "What a writer types before a line. A line's speaker must match it."; name.value = m.name; name.spellcheck = false;
    name.addEventListener("input", () => {
      const s = name.selectionStart, e = name.selectionEnd;
      name.value = name.value.toUpperCase(); // length is preserved, so the caret restores cleanly
      if (s !== null && e !== null) name.setSelectionRange(s, e);
      m.name = name.value;
    });
    guard.track(name);

    const display = el("input", "gd-input cast-field") as HTMLInputElement;
    display.type = "text"; display.placeholder = "Character name"; display.dataset.tip = "The name the player sees, translated (optional)."; display.value = m.displayName ?? "";
    const shownWith = labelFields(m);
    display.addEventListener("input", () => { m.displayName = display.value.trim() || undefined; shownWith.repaint(); });
    const actor = el("input", "gd-input cast-field") as HTMLInputElement;
    actor.type = "text"; actor.placeholder = "Actor"; actor.dataset.tip = "Voice actor (optional)."; actor.value = m.actor ?? "";
    actor.addEventListener("input", () => { m.actor = actor.value.trim() || undefined; });

    const acts = el("div", "gd-acts");
    acts.append(
      iconBtn("up", "Move up", () => { moveItem(state, i, -1); render(); }, i === 0),
      iconBtn("down", "Move down", () => { moveItem(state, i, 1); render(); }, i === state.length - 1),
      iconBtn("close", "Remove from cast", () => { state.splice(i, 1); render(); }, false, true),
    );

    // Grammatical gender: translator context, exported into the localisation formats. Free text with
    // auto-suggest (blank = "not specified", so a project that never sets it carries nothing). The
    // suggestion list offers the everyday genders plus any already used in this cast, keeping spellings
    // consistent without locking out languages that need other values.
    const gender = el("input", "gd-input") as HTMLInputElement;
    gender.type = "text"; gender.placeholder = "Gender"; gender.value = m.gender ?? ""; gender.spellcheck = false;
    gender.dataset.tip = "Sent to translators so gendered languages can inflect this character's lines.";
    const genderList = el("datalist") as HTMLDataListElement;
    genderList.id = `gender-list-${genderListSeq++}`;
    gender.setAttribute("list", genderList.id);
    const fillGenderList = (): void => genderList.replaceChildren(
      ...genderSuggestions(m).map((v) => { const o = el("option") as HTMLOptionElement; o.value = v; return o; }),
    );
    fillGenderList();
    gender.addEventListener("focus", fillGenderList); // refresh in case other rows changed since render
    gender.addEventListener("input", () => { m.gender = gender.value.trim() || undefined; });

    const notes = el("input", "gd-input") as HTMLInputElement;
    notes.type = "text"; notes.placeholder = "Notes"; notes.value = m.notes ?? "";
    notes.addEventListener("input", () => { m.notes = notes.value.trim() || undefined; });

    const genderField = labelled("Grammatical gender", gender);
    genderField.append(genderList); // a <datalist> renders nothing; it just needs to be in the DOM
    return expandableRow({ line: [name, display, actor, acts], details: [genderField, ...voiceField(m, gender), labelled("Notes", notes), ...shownWith.fields] });
  };

  /** Placeholder Speech's voice for a member, only while it's on: the default (from the name and, when male or
   *  female, the gender) or one chosen from the accent's voices, in words, with Hear. */
  const voiceField = (m: CastMember, gender: HTMLInputElement): HTMLElement[] => {
    if (!speech?.on()) return [];
    const accent = speech.accent();
    const tier = speech.tier();
    const voices = placeholderAccent(accent, tier)?.voices ?? [];
    const sel = el("select", "gd-input cast-voice") as HTMLSelectElement;
    const defaultOption = (): string => {
      const d = defaultPlaceholderVoice(m.name || "?", accent, m.gender, tier);
      return d ? `Default: ${describePlaceholderVoice(d)}` : "Default (choose an accent first)";
    };
    const def = new Option(defaultOption(), "");
    sel.append(def);
    for (const v of voices) sel.append(new Option(describePlaceholderVoice(v.name), v.name));
    // A voice from another accent or tier (set before either changed) stays, named as it is, and is used as chosen.
    if (m.placeholderVoice && !voices.some((v) => v.name === m.placeholderVoice)) sel.append(new Option(describePlaceholderVoice(m.placeholderVoice), m.placeholderVoice));
    sel.value = m.placeholderVoice ?? "";
    // A voice from the other tier is used as chosen, and said so: an HD one in a Standard project costs HD rates.
    const otherTier = el("p", "settings-fieldnote is-bad cast-voice-tier");
    const syncTier = (): void => {
      const t = sel.value ? placeholderVoiceTier(sel.value) : undefined;
      otherTier.hidden = !t || t === tier;
      otherTier.textContent = t === "hd" ? "An HD voice: used as chosen, though the project uses Standard voices, and billed at the HD rate." : "A Standard voice: used as chosen, though the project uses HD voices.";
    };
    syncTier();
    sel.addEventListener("change", () => { m.placeholderVoice = sel.value || undefined; syncTier(); });
    // The default follows the gender as it's typed (male or female, any case, narrows it when they disagree).
    gender.addEventListener("input", () => { def.text = defaultOption(); });
    const hear = el("button", "gd-add cast-hear", "Hear") as HTMLButtonElement; hear.type = "button";
    hear.dataset.tip = "Hear this voice say the character's name";
    hear.addEventListener("click", () => {
      const v = sel.value || defaultPlaceholderVoice(m.name || "?", accent, m.gender, tier);
      if (v) speech.hear(v, m.displayName || m.name);
    });
    const wrap = el("div", "cast-voice-row"); wrap.append(sel, hear);
    const field = labelled("Placeholder Speech voice", wrap, "With no voice chosen, the name picks one; a gender of male or female narrows it.");
    field.append(otherTier);
    return [field];
  };

  /** One "Shown with" field for each qualifier this character's lines use, then one for each label it has
   *  that no line uses any more (marked, so it can be cleared). Blank follows the speaker pattern, which
   *  the placeholder shows filled in. A character whose lines use no qualifier gets none. */
  const labelFields = (m: CastMember): { fields: HTMLElement[]; repaint(): void } => {
    if (!labels) return { fields: [], repaint: () => undefined };
    const used = labels.pairs.filter((p) => p.character === m.name).map((p) => p.qualifier);
    const unused = Object.keys(m.qualifierLabels ?? {}).filter((q) => !used.includes(q));
    const paints: Array<() => void> = [];
    const fields = [...used, ...unused].map((gameId) => {
      const input = el("input", "gd-input cast-label") as HTMLInputElement;
      input.type = "text"; input.value = m.qualifierLabels?.[gameId] ?? "";
      input.dataset.tip = "Leave blank to use the speaker pattern (Qualifiers tab).";
      input.addEventListener("input", () => {
        const text = input.value.trim();
        const next = { ...m.qualifierLabels };
        if (text) next[gameId] = text; else delete next[gameId];
        m.qualifierLabels = Object.keys(next).length ? next : undefined;
      });
      const field = labelled("Shown with", input, unused.includes(gameId) ? "No lines use this." : undefined);
      const caption = field.querySelector(".shell-fieldcap");
      const paint = (): void => {
        const qualifier = labels.qualifierName(gameId);
        if (caption) caption.textContent = `Shown with ${qualifier}`;
        input.placeholder = formatSpeakerLabel(labels.pattern() || DEFAULT_SPEAKER_PATTERN, m.displayName || m.name, qualifier);
      };
      paint();
      paints.push(paint);
      return field;
    });
    const repaint = (): void => { for (const p of paints) p(); };
    repaints.push(repaint);
    return { fields, repaint };
  };

  const render = (): void => {
    guard.reset();
    repaints = [];
    host.replaceChildren();
    const list = el("div", "gd-fieldlist");
    if (!state.length) list.append(el("p", "empty", "No cast members yet."));
    else state.forEach((m, i) => list.append(memberRow(m, i)));
    host.append(list);
    guard.check();
    const add = el("button", "gd-add", "+ Add cast member"); add.type = "button";
    add.addEventListener("click", () => { state.push({ name: "" }); render(); focusNewRow(host.querySelector<HTMLElement>(".gd-fieldlist")); });
    host.append(add);
  };
  render();

  return {
    firstDuplicate: () => guard.firstDuplicate(),
    refreshLabels: () => { for (const r of repaints) r(); },
    refreshSpeech: () => render(),
    renames(): Record<string, string> {
      const out: Record<string, string> = {};
      for (const m of state) {
        const from = origins.get(m), to = m.name.trim().toUpperCase();
        if (from && to && to !== from) out[from] = to;
      }
      return out;
    },
    value(): CastMember[] {
      return state.filter((m) => m.name.trim()).map((m): CastMember => {
        const c: CastMember = { name: m.name.trim().toUpperCase() };
        if (m.displayName) c.displayName = m.displayName;
        if (m.gender) c.gender = m.gender;
        if (m.actor) c.actor = m.actor;
        if (m.notes) c.notes = m.notes;
        if (m.qualifierLabels && Object.keys(m.qualifierLabels).length) c.qualifierLabels = { ...m.qualifierLabels };
        if (m.gameData) c.gameData = m.gameData; // preserve any host gameData on the member
        if (m.colour !== undefined) c.colour = m.colour; // the colour a rename kept (stamped by the save)
        if (m.placeholderVoice) c.placeholderVoice = m.placeholderVoice; // kept while Placeholder Speech is off, just not shown
        return c;
      });
    },
  };
}
