// The Cast editor (Project Settings > Cast tab). The master cast: each member has a canonical name
// (matched by a beat's speaker), an optional player-facing display name, a grammatical gender for
// translators, and free-text production notes. value() returns a clean list (blank names pruned) for
// the save round-trip.

import type { CastMember, GrammaticalGender } from "@patterkit/model";
import { el, iconBtn, labelled, moveItem } from "./dom.js";
import { dupGuard, expandableRow, focusNewRow } from "./settings-list.js";

export interface CastHandle { value(): CastMember[]; firstDuplicate(): HTMLInputElement | null; }


export function mountCast(host: HTMLElement, initial: CastMember[]): CastHandle {
  const state: CastMember[] = structuredClone(initial ?? []);
  const guard = dupGuard();

  const memberRow = (m: CastMember, i: number): HTMLElement => {
    // Main line: the canonical name, the player-facing display name, and the voice actor. Notes (longer
    // free text) tuck behind the ▸ expander.
    // The canonical name is stored in CAPITALS (the house style for cue tokens): upper-case any imported
    // lower-case name on display, and live as the author types (caret preserved). Display name + actor are
    // player- / actor-facing, so they keep their typed case.
    const name = el("input", "gd-input gd-name") as HTMLInputElement;
    m.name = m.name.toUpperCase();
    name.type = "text"; name.placeholder = "<name (speaker)>"; name.dataset.tip = "The canonical name. A line's speaker must match it."; name.value = m.name; name.spellcheck = false;
    name.addEventListener("input", () => {
      const s = name.selectionStart, e = name.selectionEnd;
      name.value = name.value.toUpperCase(); // length is preserved, so the caret restores cleanly
      if (s !== null && e !== null) name.setSelectionRange(s, e);
      m.name = name.value;
    });
    guard.track(name);

    const display = el("input", "gd-input cast-field") as HTMLInputElement;
    display.type = "text"; display.placeholder = "<display name>"; display.dataset.tip = "Player-facing name (optional)."; display.value = m.displayName ?? "";
    display.addEventListener("input", () => { m.displayName = display.value.trim() || undefined; });
    const actor = el("input", "gd-input cast-field") as HTMLInputElement;
    actor.type = "text"; actor.placeholder = "<actor>"; actor.dataset.tip = "Voice actor (optional)."; actor.value = m.actor ?? "";
    actor.addEventListener("input", () => { m.actor = actor.value.trim() || undefined; });

    const acts = el("div", "gd-acts");
    acts.append(
      iconBtn("↑", "move up", () => { moveItem(state, i, -1); render(); }, i === 0),
      iconBtn("↓", "move down", () => { moveItem(state, i, 1); render(); }, i === state.length - 1),
      iconBtn("✕", "remove from cast", () => { state.splice(i, 1); render(); }, false, true),
    );

    // Grammatical gender: translator context, exported into the localisation formats. "Not specified"
    // is the absent value, so a project that never sets it carries nothing.
    const gender = el("select", "insp-select") as HTMLSelectElement;
    gender.dataset.tip = "Grammatical gender, sent to translators so gendered languages can inflect this character's lines.";
    for (const [v, l] of [["", "Not specified"], ["male", "Male"], ["female", "Female"], ["neuter", "Neuter"]] as const) {
      const o = el("option", undefined, l) as HTMLOptionElement;
      o.value = v; if (v === (m.gender ?? "")) o.selected = true; gender.append(o);
    }
    gender.addEventListener("change", () => { m.gender = (gender.value || undefined) as GrammaticalGender | undefined; });

    const notes = el("input", "gd-input") as HTMLInputElement;
    notes.type = "text"; notes.placeholder = "<casting / voice / intent notes>"; notes.value = m.notes ?? "";
    notes.addEventListener("input", () => { m.notes = notes.value.trim() || undefined; });

    return expandableRow({ line: [name, display, actor, acts], details: [labelled("Grammatical gender", gender), labelled("Notes", notes)] });
  };

  const render = (): void => {
    guard.reset();
    host.replaceChildren();
    const list = el("div", "gd-fieldlist");
    if (!state.length) list.append(el("p", "gd-empty", "No cast members yet."));
    else state.forEach((m, i) => list.append(memberRow(m, i)));
    host.append(list);
    guard.check();
    const add = el("button", "gd-add", "+ Add cast member"); add.type = "button";
    add.addEventListener("click", () => { state.push({ name: "" }); render(); focusNewRow(host.querySelector(".gd-fieldlist")); });
    host.append(add);
  };
  render();

  return {
    firstDuplicate: () => guard.firstDuplicate(),
    value(): CastMember[] {
      return state.filter((m) => m.name.trim()).map((m): CastMember => {
        const c: CastMember = { name: m.name.trim().toUpperCase() };
        if (m.displayName) c.displayName = m.displayName;
        if (m.gender) c.gender = m.gender;
        if (m.actor) c.actor = m.actor;
        if (m.notes) c.notes = m.notes;
        if (m.gameData) c.gameData = m.gameData; // preserve any host gameData on the member
        return c;
      });
    },
  };
}
