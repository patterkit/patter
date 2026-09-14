// @vitest-environment jsdom
// "Go to definition" lands on the ROW, not only on its page (from-storylets/go-to-definition-lands-on-the-row).
//
// It used to open the page a property is declared on and stop there: on a long list the declaration was
// below the fold with nothing marking it, and for an enum the values you went to look at were also shut
// behind the row's expander. app-shell 0.38.0 carries the reveal (expandableRow's `name` stamp +
// revealRow); what is Patterpad's is that its lists STAMP their declaration rows, and stamp nothing else.

import { describe, it, expect, beforeAll } from "vitest";
import { revealRow } from "@wildwinter/app-shell";
import { mountProperties } from "./src/settings-properties.js";
import { mountWorld } from "./src/settings-world.js";

beforeAll(() => {
  // jsdom has no layout, so no scrollIntoView; the reveal calls it, and the centring is app-shell's to test.
  Element.prototype.scrollIntoView = function scrollIntoView() {};
});

const rowFor = (host: HTMLElement, name: string): HTMLElement | undefined =>
  [...host.querySelectorAll<HTMLElement>(".set-row")].find((r) => r.dataset.name === name);

describe("the @patter / @scene properties list stamps its declaration rows", () => {
  const mount = (scope: "patter" | "scene") => {
    const host = document.createElement("div");
    document.body.append(host);
    mountProperties(host, [
      { name: "gold", type: "number" },
      { name: "mood", type: "enum", values: ["calm", "wry"] },
    ] as never, { scope });
    return host;
  };

  for (const scope of ["patter", "scene"] as const) {
    it(`every row carries its property's name (${scope})`, () => {
      const host = mount(scope);
      expect(rowFor(host, "gold")).toBeTruthy();
      expect(rowFor(host, "mood")).toBeTruthy();
    });
  }

  it("landing on an enum opens its details, where the values are, and lights that row alone", () => {
    const host = mount("patter");
    const mood = rowFor(host, "mood")!;
    expect(mood.querySelector<HTMLElement>(".set-details")!.hidden).toBe(true);   // shut before the jump

    expect(revealRow(host, "mood")).toBe(true);
    expect(mood.querySelector<HTMLElement>(".set-details")!.hidden).toBe(false);  // ...open after it
    expect(mood.classList.contains("landed")).toBe(true);
    expect(rowFor(host, "gold")!.classList.contains("landed")).toBe(false);
  });

  it("answers false for a name no row carries, so the jump can ask again once the page fills in", () => {
    expect(revealRow(mount("patter"), "nowhere")).toBe(false);
  });
});

describe("the World tab stamps declarations and NOT coverage drivers", () => {
  it("a driver naming the same property is never the row a jump lands on", () => {
    // A driver row is built with the same expandableRow, and it NAMES @world.time without declaring it. If
    // it were stamped too, "Go to definition" could light the driver and leave the declaration unseen.
    const host = document.createElement("div");
    document.body.append(host);
    mountWorld(host, {
      scopeRegistry: { scopes: [{ token: "world", declarations: [{ name: "time", type: "enum", values: ["dawn", "dusk"], writable: false }] }] },
      coverageDrivers: [{ ref: "@world.time", values: ["dawn"], kind: "initial" }],
      onPropose: async () => [],
    } as never);

    const stamped = [...host.querySelectorAll<HTMLElement>(".set-row")].filter((r) => r.dataset.name !== undefined);
    expect(stamped.map((r) => r.dataset.name)).toEqual(["time"]);                 // the declaration, only

    expect(revealRow(host, "time")).toBe(true);
    expect(stamped[0]!.classList.contains("landed")).toBe(true);
  });
});
