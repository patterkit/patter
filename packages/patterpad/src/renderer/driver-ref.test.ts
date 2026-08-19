// @vitest-environment jsdom
// A coverage-driver ref points AT a declared @world property, so it takes a different rule from the
// declaration fields beside it: case is fine, because expressions fold every reference, but a name
// nothing declares is refused - declare-then-reference.
//
// The cost of getting this wrong is quiet, which is why it is worth blocking: a driver aimed at a
// property that does not exist feeds a value nobody reads, and the branches it was meant to exercise
// are reported as never hit.

import { describe, it, expect } from "vitest";
import { mountWorld } from "./src/settings-world.js";

const mount = () => {
  const host = document.createElement("div");
  const handle = mountWorld(host, {
    scopeRegistry: { version: 1, scopes: [{ token: "world", declarations: [
      { name: "danger", type: "number" },
      { name: "phase", type: "string" },
    ] }] },
    coverageDrivers: [{ ref: "@world.danger", kind: "recurring", values: [1, 2] }],
    onPropose: () => Promise.resolve([]),
  });
  const fields = [...host.querySelectorAll<HTMLInputElement>("input.gd-name")];
  // the declaration rows come first, then the driver rows
  return { host, handle, declarations: fields.slice(0, 2), driver: fields[fields.length - 1]! };
};
const type = (input: HTMLInputElement, text: string): void => {
  input.value = text;
  input.dispatchEvent(new Event("input"));
};

describe("a coverage-driver ref", () => {
  it("accepts a declared name, in any case", () => {
    const { driver } = mount();
    type(driver, "phase");
    expect(driver.classList.contains("illegal")).toBe(false);
    type(driver, "PHASE");
    expect(driver.classList.contains("illegal")).toBe(false);   // references fold
  });

  it("refuses a name nothing declares, and blocks Save", () => {
    const { handle, driver } = mount();
    type(driver, "dangr");
    expect(driver.classList.contains("illegal")).toBe(true);
    expect(driver.title).toContain('Did you mean "danger"');
    expect(handle.firstIllegalName()).toBe(driver);
  });

  it("refuses a name no declaration could ever have", () => {
    const { driver } = mount();
    type(driver, "is-night");
    expect(driver.title).toMatch(/subtraction/);
  });

  it("re-checks when a declaration is renamed under it", () => {
    // The case no per-field listener can catch: nothing is typed into the driver, and it is wrong.
    const { handle, declarations, driver } = mount();
    type(driver, "danger");
    expect(driver.classList.contains("illegal")).toBe(false);

    type(declarations[0]!, "danger_level");

    expect(driver.classList.contains("illegal")).toBe(true);
    expect(handle.firstIllegalName()).toBe(driver);
  });

  it("offers the declared names as a datalist", () => {
    const { host, driver } = mount();
    const list = host.querySelector(`datalist#${driver.getAttribute("list")}`);
    expect([...list!.querySelectorAll("option")].map((o) => o.value)).toEqual(["danger", "phase"]);
  });
});
