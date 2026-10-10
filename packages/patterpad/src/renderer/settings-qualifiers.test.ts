// @vitest-environment jsdom
// The Qualifiers settings tab (renderer/src/settings-qualifiers.ts): a renamed qualifier is a name change
// and touches no line; a changed Game ID is reported as a rename (the lines to rewrite); a new qualifier's
// Game ID follows its name until edited; the standard sets replace the list; and the Save gate stops on a
// duplicate or an unusable Game ID.

import { describe, it, expect } from "vitest";
import { DEFAULT_QUALIFIERS } from "@patterkit/model";
import { mountQualifiers } from "./src/settings-qualifiers.js";

const input = (el: HTMLInputElement, value: string): void => { el.value = value; el.dispatchEvent(new Event("input")); };
const rowsOf = (host: HTMLElement): HTMLElement[] => [...host.querySelectorAll<HTMLElement>(".set-row")];
const nameOf = (row: HTMLElement): HTMLInputElement => row.querySelector<HTMLInputElement>(".gd-name")!;
const idOf = (row: HTMLElement): HTMLInputElement => row.querySelector<HTMLInputElement>(".qual-gameid")!;
const button = (host: HTMLElement, text: string): HTMLButtonElement =>
  [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === text)!;

Element.prototype.scrollIntoView ??= () => undefined; // jsdom has no layout (the add button scrolls the new row in)

describe("the Qualifiers settings tab", () => {
  it("a new name is no rename; a new Game ID is", () => {
    const host = document.createElement("div");
    const h = mountQualifiers(host, DEFAULT_QUALIFIERS);
    const [vo, os] = rowsOf(host);
    input(nameOf(vo!), "VOICE");
    expect(h.renames()).toEqual({});
    input(idOf(os!), "offscreen");
    expect(h.renames()).toEqual({ os: "offscreen" });
    expect(h.value().map((q) => [q.gameId, q.name])).toEqual([["vo", "VOICE"], ["offscreen", "O.S."], ["radio", "RADIO"]]);
    expect(h.firstInvalid()).toBeNull();
  });

  it("a new qualifier's Game ID follows its name until it is edited", () => {
    const host = document.createElement("div");
    const h = mountQualifiers(host, []);
    button(host, "+ Add qualifier").click();
    const row = rowsOf(host)[0]!;
    input(nameOf(row), "Phone Call");
    expect(idOf(row).value).toBe("phone-call");
    input(idOf(row), "phone");
    input(nameOf(row), "PHONE");
    expect(h.value()).toEqual([{ gameId: "phone", name: "PHONE" }]);
    expect(h.renames()).toEqual({}); // new, so nothing on any line to rewrite
  });

  it("offers the screenplay and game sets, keeping the qualifiers the project had as themselves", () => {
    const host = document.createElement("div");
    const h = mountQualifiers(host, DEFAULT_QUALIFIERS);
    button(host, "Screenplay set").click();
    expect(h.value().map((q) => q.name)).toEqual(["V.O.", "O.S.", "O.C."]);
    button(host, "Game set").click();
    expect(h.value().map((q) => q.name)).toEqual(["V.O.", "O.S.", "RADIO", "PHONE"]);
    expect(h.value().some((q) => /CONT/.test(q.name))).toBe(false);
    expect(h.renames()).toEqual({});
  });

  it("stops Save on a duplicate name, a duplicate Game ID, or a Game ID that won't do", () => {
    const host = document.createElement("div");
    const h = mountQualifiers(host, DEFAULT_QUALIFIERS);
    const [vo, os] = rowsOf(host);
    input(nameOf(os!), "v.o.");
    expect(h.firstInvalid()?.message).toMatch(/share a name/);
    input(nameOf(os!), "O.S.");
    input(idOf(os!), "vo");
    expect(h.firstInvalid()?.message).toMatch(/share a Game ID/);
    input(idOf(os!), "Off Screen");
    expect(h.firstInvalid()?.el).toBe(idOf(os!));
    input(idOf(os!), "os");
    expect(h.firstInvalid()).toBeNull();
    void vo;
  });
});
