// @vitest-environment jsdom
// Game data takes the family's field types (patter-qualities.md section 1): flags and quality beside the
// five it had, a quality's ladder declared in order, a stage renamed in place handed to the save, and a
// quality value in the inspector drawn as the family's rung strip, its unset state naming the fallback.

import { describe, it, expect, vi } from "vitest";
import type { GameDataField } from "@patterkit/model";
import { mountGameDataFields } from "./src/gamedata-fields.js";
import { gameDataFieldRow } from "./src/inspector.js";

const dialogueTab = (host: HTMLElement): void => {
  Array.from(host.querySelectorAll<HTMLButtonElement>(".gd-kindtab")).find((t) => (t.textContent ?? "").startsWith("Dialogue"))!.click();
};

describe("the Game Data editor: flags and quality", () => {
  it("offers the family's seven types, and a quality's ladder in order", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const handle = mountGameDataFields(host, { line: [{ name: "act", type: "text" }] });
    dialogueTab(host);
    const type = host.querySelector<HTMLSelectElement>(".set-type")!;
    expect(Array.from(type.options).map((o) => o.value)).toEqual(["text", "multiline", "number", "boolean", "enum", "flags", "quality"]);
    type.value = "quality";
    type.dispatchEvent(new Event("change"));
    expect(handle.value().line).toEqual([{ name: "act", type: "quality", stages: [] }]);
    expect(Array.from(host.querySelectorAll(".shell-fieldcap")).map((c) => c.textContent)).toContain("Stages (in order)");
    host.remove();
  });

  it("hands a stage renamed in place to the save, with its default carried", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const handle = mountGameDataFields(host, { line: [{ name: "act", type: "quality", stages: ["arrival", "act-1"], default: "arrival" }] });
    dialogueTab(host);
    Array.from(host.querySelectorAll<HTMLElement>(".shell-tag")).find((c) => c.dataset["stage"] === "arrival")!
      .querySelector<HTMLElement>(".shell-tag-label")!.click();
    const input = host.querySelector<HTMLInputElement>(".shell-stage-rename")!;
    input.value = "prologue";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(handle.value().line).toEqual([{ name: "act", type: "quality", stages: ["prologue", "act-1"], default: "prologue" }]);
    expect(handle.stageRenames()).toEqual([{ scope: "gameData", gameData: "line", name: "act", from: "arrival", to: "prologue" }]);
    host.remove();
  });

  it("is the shell's declaration list: any name, purpose kept, a duplicate found on its own tab", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const handle = mountGameDataFields(host, { line: [{ name: "Camera shot", type: "text" }, { name: "camera shot", type: "number" }] });
    expect(host.querySelector(".set-name")).toBeNull();          // Scene first: no fields there
    const dup = handle.firstDuplicate();                          // switches to Dialogue to show it
    expect(dup?.value.toLowerCase()).toBe("camera shot");
    const purpose = host.querySelector<HTMLInputElement>(".set-purpose")!;
    expect(purpose.placeholder).toBe("What this field is for");
    purpose.value = "  How the shot is framed "; purpose.dispatchEvent(new Event("input"));
    expect(handle.value().line?.[0]).toEqual({ name: "Camera shot", type: "text", purpose: "How the shot is framed" });
    host.remove();
  });

  it("keeps a flags field's values", () => {
    const host = document.createElement("div");
    const handle = mountGameDataFields(host, { line: [{ name: "marks", type: "flags", values: ["met", "owed"] }] });
    expect(handle.value().line).toEqual([{ name: "marks", type: "flags", values: ["met", "owed"] }]);
  });
});

describe("a quality game-data value in the inspector", () => {
  const field: GameDataField = { name: "act", type: "quality", stages: ["arrival", "act-1", "act-2"] };
  const marked = (el: Element, cls: string): string[] => Array.from(el.querySelectorAll(`.shell-rung.${cls}`)).map((r) => r.textContent ?? "");
  const rung = (el: Element, text: string): HTMLButtonElement =>
    Array.from(el.querySelectorAll<HTMLButtonElement>(".shell-rung")).find((r) => r.textContent === text)!;

  it("draws the ladder, unset naming its fallback, and writes a picked stage", () => {
    const setGameData = vi.fn();
    const row = gameDataFieldRow(field, "L", undefined, { setGameData });
    expect(marked(row, "on")).toEqual(["default (arrival)"]);
    expect(marked(row, "fallback")).toEqual(["arrival"]);
    rung(row, "act-2").click();
    expect(setGameData).toHaveBeenCalledWith("L", "act", "act-2");
    expect(marked(row, "on")).toEqual(["act-2"]);
  });

  it("clears an override back to the default, and shows a stage the ladder lost", () => {
    const setGameData = vi.fn();
    const row = gameDataFieldRow(field, "L", "finale", { setGameData });
    expect(marked(row, "stray")).toEqual(["finale"]);
    rung(row, "default (arrival)").click();
    expect(setGameData).toHaveBeenCalledWith("L", "act", undefined);
  });

  it("picks a flags value from the declared values, as a list", () => {
    const setGameData = vi.fn();
    const row = gameDataFieldRow({ name: "marks", type: "flags", values: ["met", "owed"] }, "L", ["met"], { setGameData });
    const chips = Array.from(row.querySelectorAll<HTMLButtonElement>(".shell-flag"));
    expect(chips.map((c) => `${c.textContent}${c.classList.contains("on") ? "*" : ""}`)).toEqual(["default (none)", "met*", "owed"]);
    chips[2]!.click();
    expect(setGameData).toHaveBeenCalledWith("L", "marks", ["met", "owed"]);
  });
});
