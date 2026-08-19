// @vitest-environment jsdom
// The manners of a property-name field, in both editors that write a declaration.
//
// These are the gameId editor's manners on purpose (app-shell id-editor.ts): an
// illegal name is REFUSED and marked, never quietly rewritten, and Tab coerces it
// in the field where it can be seen and undone. An earlier version of this folded
// each keystroke to lower case, which is the manner the shell argued against, and
// it also could not have helped with the faults that are not about case: a hyphen
// reads as subtraction, a leading digit or a keyword will not parse at all.

import { describe, it, expect } from "vitest";
import { mountProperties } from "./src/settings-properties.js";
import { mountWorld } from "./src/settings-world.js";

const type = (input: HTMLInputElement, text: string): void => {
  input.value = text;
  input.dispatchEvent(new Event("input"));
};
const tab = (input: HTMLInputElement): void => {
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
};
const nameField = (host: HTMLElement): HTMLInputElement => {
  const f = host.querySelector<HTMLInputElement>("input.gd-name");
  if (!f) throw new Error("no name field");
  return f;
};
const properties = () => {
  const host = document.createElement("div");
  const handle = mountProperties(host, [{ name: "gold", type: "number" }]);
  return { host, handle, field: nameField(host) };
};
const world = () => {
  const host = document.createElement("div");
  const handle = mountWorld(host, {
    scopeRegistry: { version: 1, scopes: [{ token: "world", declarations: [{ name: "phase", type: "string" }] }] },
    onPropose: () => Promise.resolve([]),
  });
  return { host, handle, field: nameField(host) };
};

describe("a property name field refuses rather than rewrites", () => {
  it("keeps what was typed, marks it, and says which fault it is", () => {
    const { handle, field } = properties();

    type(field, "isNight");
    expect(field.value).toBe("isNight");                    // untouched
    expect(field.classList.contains("illegal")).toBe(true);
    expect(field.title).toMatch(/fold/);                    // the case fault, in words
    expect(handle.firstIllegalName()).toBe(field);          // and Save is blocked

    type(field, "is-night");
    expect(field.title).toMatch(/subtraction/);             // the silent one, named

    type(field, "9lives");
    expect(field.title).toMatch(/digit/);

    type(field, "not");
    expect(field.title).toMatch(/keyword/);
  });

  it("coerces on Tab, in the field, and clears the marking", () => {
    const { handle, field } = properties();

    type(field, "Is Night!");
    tab(field);

    expect(field.value).toBe("is_night");
    expect(field.classList.contains("illegal")).toBe(false);
    expect(handle.firstIllegalName()).toBeNull();
    expect(handle.value()[0]!.name).toBe("is_night");       // and the model followed
  });

  it("leaves a legal name alone, including a leading underscore", () => {
    const { handle, field } = properties();
    for (const name of ["gold_pieces", "_private", "a1"]) {
      type(field, name);
      expect(field.classList.contains("illegal"), name).toBe(false);
      expect(handle.value()[0]!.name, name).toBe(name);
    }
  });

  it("holds @world declarations to the same rule, the scope where the fault was found", () => {
    const { handle, field } = world();

    type(field, "isNight");
    expect(field.value).toBe("isNight");
    expect(handle.firstIllegalName()).toBe(field);

    tab(field);
    expect(field.value).toBe("isnight");
    expect(handle.value().scopeRegistry?.scopes[0]?.declarations?.[0]?.name).toBe("isnight");
  });
});
