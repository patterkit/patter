// @vitest-environment jsdom
// The pick-qualifier quick fix's chooser (renderer/src/value-picker.ts): its rows are the project's
// qualifiers by name, then a row for none, and a pick is read by its row, never by its label, so a
// qualifier that is itself named "None" is still that qualifier.

import { describe, it, expect } from "vitest";
import { openValuePicker, qualifierRows } from "./src/value-picker.js";

const qualifiers = [
  { name: "O.S.", gameId: "os" },
  { name: "None", gameId: "none_q" }, // a writer's own qualifier, literally named None
];

describe("the pick-qualifier chooser", () => {
  it("offers each qualifier, then none", () => {
    const rows = qualifierRows(qualifiers);
    expect(rows.values).toEqual(["O.S.", "None", "None"]);
    expect(rows.gameIdAt(0)).toBe("os");
    expect(rows.gameIdAt(1)).toBe("none_q"); // the qualifier named None
    expect(rows.gameIdAt(2)).toBe(""); // the row for no qualifier
  });

  it("tells the pick by its row, so two rows with one label stay apart", () => {
    const anchor = document.createElement("button");
    document.body.append(anchor);
    const rows = qualifierRows(qualifiers);
    const picked: string[] = [];
    openValuePicker({ anchor, title: "Instead of", values: rows.values, onPick: (_v, i) => picked.push(rows.gameIdAt(i)) });
    const buttons = [...document.querySelectorAll<HTMLButtonElement>(".value-list button")];
    expect(buttons.map((b) => b.textContent)).toEqual(["O.S.", "None", "None"]);
    buttons[1]!.click();
    expect(picked).toEqual(["none_q"]);
  });
});
