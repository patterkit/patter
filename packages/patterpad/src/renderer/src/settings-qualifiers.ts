// The speaker-qualifier editor (Project Settings > Qualifiers; design/proposals/speaker-qualifiers.md §2).
// Each qualifier has the name the cue shows (`O.S.`), the Game ID a line stores (`os`), and an optional
// description for writers. A line holds the Game ID, so renaming a qualifier touches no line; changing a
// Game ID is a rename that rewrites every line using it, which `renames()` reports for the save. A new
// qualifier's Game ID follows its name (`gameIdify`) until the writer edits it. Two standard sets are
// offered to start from.

import type { SpeakerQualifier } from "@patterkit/model";
import { DEFAULT_QUALIFIERS, gameIdify, isValidGameId } from "@patterkit/model";
import { el } from "./dom.js";
import { iconBtn, labelled, moveItem, dupGuard, expandableRow, focusNewRow } from "@wildwinter/app-shell";

export interface QualifiersHandle {
  /** The list to store, blank rows pruned. */
  value(): SpeakerQualifier[];
  /** Game IDs changed on qualifiers the project already had, old -> new (the lines to rewrite). */
  renames(): Record<string, string>;
  /** The first field the Save gate should stop on: a duplicate name or Game ID, or a Game ID that won't do. */
  firstInvalid(): { el: HTMLElement; message: string } | null;
}

/** One row: the qualifier as edited, the Game ID it had when the tab opened (none for a new one), and
 *  whether its Game ID still follows its name. */
interface Row { name: string; gameId: string; description?: string; origin?: string; autoId: boolean }

const describe = (gameId: string): string | undefined => DEFAULT_QUALIFIERS.find((q) => q.gameId === gameId)?.description;

/** The standard sets to start from. A screenplay's CONT'D is not a qualifier (it is the export's to add). */
export const QUALIFIER_SETS: Array<{ label: string; tip: string; list: SpeakerQualifier[] }> = [
  {
    label: "Screenplay set", tip: "V.O., O.S., and O.C. (off camera).",
    list: [
      { gameId: "vo", name: "V.O.", description: describe("vo") },
      { gameId: "os", name: "O.S.", description: describe("os") },
      { gameId: "oc", name: "O.C.", description: "Off camera: the character is in the scene, but out of shot." },
    ],
  },
  {
    label: "Game set", tip: "V.O., O.S., RADIO, and PHONE.",
    list: [
      { gameId: "vo", name: "V.O.", description: describe("vo") },
      { gameId: "os", name: "O.S.", description: describe("os") },
      { gameId: "radio", name: "RADIO", description: describe("radio") },
      { gameId: "phone", name: "PHONE", description: "Heard through a phone." },
    ],
  },
];

export function mountQualifiers(host: HTMLElement, initial: SpeakerQualifier[]): QualifiersHandle {
  const rows: Row[] = (initial ?? []).map((q) => ({ name: q.name, gameId: q.gameId, description: q.description, origin: q.gameId, autoId: false }));
  const origins = new Set(rows.map((r) => r.origin!));
  const names = dupGuard();
  const ids = dupGuard();
  let idInputs: HTMLInputElement[] = [];

  const row = (r: Row, i: number): HTMLElement => {
    const name = el("input", "gd-input gd-name") as HTMLInputElement;
    name.type = "text"; name.placeholder = "Name"; name.value = r.name; name.spellcheck = false;
    name.dataset.tip = "What the script shows after the speaker's name.";
    const gameId = el("input", "gd-input qual-gameid") as HTMLInputElement;
    gameId.type = "text"; gameId.placeholder = "game-id"; gameId.value = r.gameId; gameId.spellcheck = false;
    gameId.dataset.tip = "What a line stores and your game reads. Changing it updates every line that uses it.";
    // Its own class: the duplicate guard owns `.invalid` and clears it on every check.
    const paintId = (): void => { gameId.classList.toggle("bad-id", !!gameId.value.trim() && !isValidGameId(gameId.value.trim())); };
    name.addEventListener("input", () => {
      r.name = name.value;
      if (r.autoId) { r.gameId = gameIdify(name.value); gameId.value = r.gameId; paintId(); ids.check(); }
    });
    gameId.addEventListener("input", () => { r.gameId = gameId.value.trim(); r.autoId = false; paintId(); });
    paintId();
    names.track(name);
    ids.track(gameId);
    idInputs.push(gameId);

    const acts = el("div", "gd-acts");
    acts.append(
      iconBtn("up", "Move up", () => { moveItem(rows, i, -1); render(); }, i === 0),
      iconBtn("down", "Move down", () => { moveItem(rows, i, 1); render(); }, i === rows.length - 1),
      iconBtn("close", "Remove qualifier", () => { rows.splice(i, 1); render(); }, false, true),
    );

    const desc = el("input", "gd-input") as HTMLInputElement;
    desc.type = "text"; desc.placeholder = "What it means, for writers"; desc.value = r.description ?? "";
    desc.addEventListener("input", () => { r.description = desc.value.trim() || undefined; });
    return expandableRow({ line: [name, gameId, acts], details: [labelled("Description", desc)], name: r.gameId });
  };

  /** Replace the list with a standard set. A qualifier the project already had keeps its place as the
   *  same qualifier (so it is not read as a rename); the rest are new. */
  const useSet = (list: SpeakerQualifier[]): void => {
    rows.splice(0, rows.length, ...list.map((q) => ({
      name: q.name, gameId: q.gameId, description: q.description, autoId: false,
      ...(origins.has(q.gameId) ? { origin: q.gameId } : {}),
    })));
    render();
  };

  const render = (): void => {
    names.reset(); ids.reset(); idInputs = [];
    host.replaceChildren();
    const sets = el("div", "qual-sets");
    sets.append(el("span", "qual-sets-label", "Start from"));
    for (const set of QUALIFIER_SETS) {
      const b = el("button", "btn", set.label) as HTMLButtonElement;
      b.type = "button"; b.dataset.tip = `Replace the list with ${set.tip}`;
      b.addEventListener("click", () => useSet(set.list));
      sets.append(b);
    }
    host.append(sets);
    const list = el("div", "gd-fieldlist");
    if (!rows.length) list.append(el("p", "empty", "No qualifiers. Add one, or start from a set."));
    else rows.forEach((r, i) => list.append(row(r, i)));
    host.append(list);
    names.check(); ids.check();
    const add = el("button", "gd-add", "+ Add qualifier") as HTMLButtonElement; add.type = "button";
    add.addEventListener("click", () => { rows.push({ name: "", gameId: "", autoId: true }); render(); focusNewRow(host.querySelector<HTMLElement>(".gd-fieldlist")); });
    host.append(add);
  };
  render();

  const kept = (): Row[] => rows.filter((r) => r.name.trim() || r.gameId.trim());

  return {
    value: () => kept().map((r): SpeakerQualifier => ({
      gameId: r.gameId.trim(), name: r.name.trim(), ...(r.description ? { description: r.description } : {}),
    })),
    renames: () => {
      const out: Record<string, string> = {};
      for (const r of kept()) if (r.origin && r.gameId.trim() && r.gameId.trim() !== r.origin) out[r.origin] = r.gameId.trim();
      return out;
    },
    firstInvalid: () => {
      const dupName = names.firstDuplicate();
      if (dupName) return { el: dupName, message: "Two qualifiers share a name. Names must be unique." };
      const dupId = ids.firstDuplicate();
      if (dupId) return { el: dupId, message: "Two qualifiers share a Game ID. Each must be unique." };
      // The inputs are in row order, so input i is row i.
      for (const [i, r] of rows.entries()) {
        const at = idInputs[i];
        if (!at || (!r.name.trim() && !r.gameId.trim())) continue; // a blank row is pruned, not an error
        if (!isValidGameId(r.gameId.trim())) return { el: at, message: "A Game ID uses lowercase letters, digits, and hyphens." };
        if (!r.name.trim()) return { el: at.closest(".set-row")?.querySelector<HTMLInputElement>(".gd-name") ?? at, message: "Give every qualifier a name." };
      }
      return null;
    },
  };
}
