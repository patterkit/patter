// @vitest-environment jsdom
// #44: "Clicking on a Game Data list value removes first value, if not clicked on the x".
//
// The cause is not a wrong index. `labelled()` wrapped the values editor in a `<label>` with no `for`,
// and a label forwards clicks to its first labelable descendant - which, for a chips editor, is the
// FIRST chip's remove button. So every click on the row that was not on some other control pressed it.
// The click never reached the chip that was clicked at all.

import { describe, it, expect } from "vitest";
import { labelled, tagChips } from "./src/dom.js";
import { mountGameDataFields } from "./src/gamedata-fields.js";

const clickOn = (node: Element): void => {
  node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
};

describe("game data list values (#44)", () => {
  it("clicking a value's text removes nothing", () => {
    const holder = { values: ["alpha", "beta", "gamma"] };
    const row = labelled("Values", tagChips(holder));
    document.body.append(row);

    clickOn(row.querySelector(".gd-tag")!);          // the first chip's body
    expect(holder.values).toEqual(["alpha", "beta", "gamma"]);

    clickOn(row.querySelector(".gd-fieldcap")!);     // the caption itself
    expect(holder.values).toEqual(["alpha", "beta", "gamma"]);
    row.remove();
  });

  it("clicking a value's ✕ still removes THAT value", () => {
    const holder = { values: ["alpha", "beta", "gamma"] };
    const row = labelled("Values", tagChips(holder));
    document.body.append(row);

    const chips = [...row.querySelectorAll<HTMLElement>(".gd-tag")];
    clickOn(chips[1]!.querySelector(".gd-tag-x")!);

    expect(holder.values).toEqual(["alpha", "gamma"]);
    row.remove();
  });

  it("holds through the real Game Data editor, which is where it was reported", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const handle = mountGameDataFields(host, { line: [{ name: "tone", type: "enum", values: ["warm", "cold"] }] });

    // The fields are per node kind, and "line" is captioned Dialogue; its rows only exist once that
    // tab is active. Getting this wrong makes the test pass while touching nothing, which it did.
    [...host.querySelectorAll<HTMLButtonElement>(".gd-kindtab")]
      .find((t) => (t.textContent ?? "").startsWith("Dialogue"))!.click();

    const chips = [...host.querySelectorAll<HTMLElement>(".gd-tag")];
    expect(chips.map((c) => c.textContent?.replace("✕", ""))).toEqual(["warm", "cold"]);

    clickOn(chips[0]!);
    expect(handle.value().line?.[0]?.values).toEqual(["warm", "cold"]);

    // And the ✕ still does its job, on the value it belongs to.
    clickOn(chips[0]!.querySelector(".gd-tag-x")!);
    expect(handle.value().line?.[0]?.values).toEqual(["cold"]);
    host.remove();
  });
});
