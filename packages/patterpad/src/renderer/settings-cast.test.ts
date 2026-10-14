// @vitest-environment jsdom
// The Cast settings tab's "Shown with" fields (renderer/src/settings-cast.ts; design/proposals/
// qualified-speaker-labels.md): one for each qualifier a character's lines use, its placeholder the default
// label from the speaker pattern; typing sets the character's own label, clearing goes back to the pattern;
// a label no line uses keeps its field, marked, so it can be cleared; and a character whose lines use no
// qualifier gets nothing new. The Qualifiers tab holds the pattern, blank for the default.

import { describe, it, expect } from "vitest";
import { DEFAULT_QUALIFIERS, DEFAULT_SPEAKER_PATTERN } from "@patterkit/model";
import type { CastMember } from "@patterkit/model";
import { mountCast, type CastLabelSource } from "./src/settings-cast.js";
import { mountQualifiers } from "./src/settings-qualifiers.js";

const input = (el: HTMLInputElement, value: string): void => { el.value = value; el.dispatchEvent(new Event("input", { bubbles: true })); };
const rowsOf = (host: HTMLElement): HTMLElement[] => [...host.querySelectorAll<HTMLElement>(".set-row")];
/** A row's "Shown with" fields, as [caption, the field, the hint under it if any]. */
const shownWith = (row: HTMLElement): Array<{ caption: string; field: HTMLInputElement; hint?: string }> =>
  [...row.querySelectorAll<HTMLInputElement>(".cast-label")].map((field) => {
    const wrap = field.closest(".shell-field") ?? field.closest(".shell-labelled")!;
    return { caption: wrap.querySelector(".shell-fieldcap")!.textContent!, field, hint: wrap.querySelector(".shell-fieldhint")?.textContent ?? undefined };
  });

const NAMES: Record<string, string> = { vo: "V.O.", os: "O.S.", radio: "RADIO" };
const cast = (): CastMember[] => [
  { name: "PLAYER", displayName: "You", qualifierLabels: { vo: "Your thoughts", radio: "You, on the radio" } },
  { name: "TAM" },
  { name: "BO" },
];
const source = (pattern = ""): CastLabelSource & { setPattern(p: string): void } => {
  let current = pattern;
  return {
    pairs: [{ character: "PLAYER", qualifier: "vo" }, { character: "TAM", qualifier: "os" }, { character: "PLAYER", qualifier: "os" }],
    qualifierName: (gameId) => NAMES[gameId] ?? gameId,
    pattern: () => current,
    setPattern: (p) => { current = p; },
  };
};

describe("the Cast tab's Shown with fields", () => {
  it("gives a field for each qualifier the character's lines use, then each label no line uses, marked", () => {
    const host = document.createElement("div");
    mountCast(host, cast(), source());
    const [player, tam, bo] = rowsOf(host);
    expect(shownWith(player!).map((f) => [f.caption, f.field.value, f.field.placeholder, f.hint])).toEqual([
      ["Shown with V.O.", "Your thoughts", "You (V.O.)", undefined],
      ["Shown with O.S.", "", "You (O.S.)", undefined],
      ["Shown with RADIO", "You, on the radio", "You (RADIO)", "No lines use this."],
    ]);
    expect(shownWith(tam!).map((f) => [f.caption, f.field.placeholder])).toEqual([["Shown with O.S.", "TAM (O.S.)"]]); // no display name: the token
    expect(shownWith(bo!)).toEqual([]); // no qualified lines, nothing new
  });

  it("typing sets the character's own label, and clearing goes back to the pattern", () => {
    const host = document.createElement("div");
    const h = mountCast(host, cast(), source());
    const [vo, os, radio] = shownWith(rowsOf(host)[0]!);
    input(os!.field, "  You, outside ");
    input(vo!.field, "");
    expect(h.value()[0]!.qualifierLabels).toEqual({ os: "You, outside", radio: "You, on the radio" });
    input(os!.field, "");
    input(radio!.field, "");
    expect(h.value()[0]).toEqual({ name: "PLAYER", displayName: "You" }); // no labels left, so none stored
    input(shownWith(rowsOf(host)[1]!)[0]!.field, "Tam, off");
    expect(h.value()[1]).toEqual({ name: "TAM", qualifierLabels: { os: "Tam, off" } });
  });

  it("the placeholder follows the display name, the pattern, and the qualifier's name", () => {
    const host = document.createElement("div");
    const src = source("{qualifier}: {name}");
    const h = mountCast(host, cast(), src);
    const row = rowsOf(host)[0]!;
    expect(shownWith(row)[1]!.field.placeholder).toBe("O.S.: You");
    input(row.querySelector<HTMLInputElement>(".cast-field")!, "Player One"); // the display name
    expect(shownWith(row)[1]!.field.placeholder).toBe("O.S.: Player One");
    src.setPattern("");
    h.refreshLabels();
    expect(shownWith(row)[1]!.field.placeholder).toBe("Player One (O.S.)");
  });

  it("without a label source (a caller that has none), the tab is as it was", () => {
    const host = document.createElement("div");
    const h = mountCast(host, cast());
    expect(host.querySelectorAll(".cast-label")).toHaveLength(0);
    expect(h.value()[0]!.qualifierLabels).toEqual({ vo: "Your thoughts", radio: "You, on the radio" }); // kept as they were
  });
});

describe("the Qualifiers tab's speaker pattern", () => {
  it("shows the default as its placeholder, blank means the default, and every edit is reported", () => {
    const host = document.createElement("div");
    let changes = 0;
    const h = mountQualifiers(host, DEFAULT_QUALIFIERS, { onChange: () => { changes++; } });
    const pattern = host.querySelector<HTMLInputElement>(".qual-pattern")!;
    expect(pattern.placeholder).toBe(DEFAULT_SPEAKER_PATTERN);
    expect(h.pattern()).toBe("");
    const before = changes;
    input(pattern, "{name}, {qualifier}");
    expect(h.pattern()).toBe("{name}, {qualifier}");
    expect(changes).toBeGreaterThan(before);
  });

  it("keeps the stored pattern, and names a qualifier by the Game ID its lines still hold", () => {
    const host = document.createElement("div");
    const h = mountQualifiers(host, DEFAULT_QUALIFIERS, { pattern: "{name} [{qualifier}]" });
    expect(host.querySelector<HTMLInputElement>(".qual-pattern")!.value).toBe("{name} [{qualifier}]");
    const os = rowsOf(host)[1]!;
    input(os.querySelector<HTMLInputElement>(".gd-name")!, "OFF");
    input(os.querySelector<HTMLInputElement>(".qual-gameid")!, "offscreen");
    expect(h.nameOf("os")).toBe("OFF");
    expect(h.nameOf("offscreen")).toBe("OFF");
    expect(h.nameOf("phone")).toBe("phone");
  });
});
