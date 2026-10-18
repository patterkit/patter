// @vitest-environment jsdom
// The Cast tab says which members were renamed (old name -> new), so the save can carry the rename into the
// lines they speak and the extension data that names them: by each row's own name when the tab opened, so a
// move, a removal, or a new member never reads as a rename.

import { describe, it, expect, beforeAll } from "vitest";
import { mountCast } from "../src/renderer/src/settings-cast.js";

beforeAll(() => {
  // jsdom lays nothing out; a new row is scrolled to.
  Element.prototype.scrollIntoView ??= function () { /* nothing to scroll */ };
});

/** Type `text` into the name field of row `i`, as the author would. */
function rename(host: HTMLElement, i: number, text: string): void {
  const input = host.querySelectorAll<HTMLInputElement>("input.gd-name")[i]!;
  input.value = text;
  input.dispatchEvent(new Event("input"));
}

describe("the Cast tab's renames", () => {
  it("names each member whose name changed, by the name it opened with", () => {
    const host = document.createElement("div");
    const cast = mountCast(host, [{ name: "ANNA" }, { name: "BEN" }, { name: "CARA" }]);
    expect(cast.renames()).toEqual({});
    rename(host, 0, "anne");
    rename(host, 2, "CARA");
    expect(cast.renames()).toEqual({ ANNA: "ANNE" });
    expect(cast.value().map((m) => m.name)).toEqual(["ANNE", "BEN", "CARA"]);
  });

  it("follows a row that moves, ignores one removed or added, and reports a swap as a swap", () => {
    const host = document.createElement("div");
    const cast = mountCast(host, [{ name: "ANNA" }, { name: "BEN" }]);
    host.querySelector<HTMLButtonElement>("[aria-label='Move down']")!.click();
    expect(cast.value().map((m) => m.name)).toEqual(["BEN", "ANNA"]);
    expect(cast.renames()).toEqual({});
    rename(host, 0, "ANNA");
    rename(host, 1, "BEN");
    expect(cast.renames()).toEqual({ BEN: "ANNA", ANNA: "BEN" });

    const host2 = document.createElement("div");
    const cast2 = mountCast(host2, [{ name: "ANNA" }]);
    host2.querySelector<HTMLButtonElement>("button.gd-add")!.click();
    rename(host2, 1, "DAN");
    rename(host2, 0, "");
    expect(cast2.renames()).toEqual({});
  });
});
