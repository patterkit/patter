// @vitest-environment jsdom
// Project Settings ▸ Game scopes, as the author edits it (Ian's ruling of 2026-10-28, matching Storyletter's
// host-scopes.ts): @world first and fixed; "+ Add scope" with an "@" name field and Remove; each scope's
// "Read-only to the story" and "Any name, unchecked" switches; a name the game can't use is marked where it
// was typed, says why, and blocks Save; and a renamed scope is reported as a rename for the save to carry,
// its coverage drivers following it.

import { describe, it, expect } from "vitest";
import type { HostScopeRegistry } from "@patterkit/model";
import { mountWorld, scopeTokenProblem } from "./src/settings-world.js";

// jsdom draws nothing, so it has no scrolling: a new row is scrolled into view in the app.
Element.prototype.scrollIntoView ??= function (): void { /* nothing to scroll in jsdom */ };

const type = (input: HTMLInputElement, text: string): void => {
  input.value = text;
  input.dispatchEvent(new Event("input"));
};
const mount = (scopeRegistry?: HostScopeRegistry, extra: Record<string, unknown> = {}) => {
  const host = document.createElement("div");
  document.body.append(host);
  const handle = mountWorld(host, { scopeRegistry, onPropose: () => Promise.resolve([]), ...extra });
  const blocks = () => [...host.querySelectorAll<HTMLElement>(".host-scope")];
  const tokens = () => [...host.querySelectorAll<HTMLInputElement>("input.host-scope-token")];
  const addScope = () => host.querySelector<HTMLButtonElement>(".host-scope-add")!.click();
  const toggle = (block: HTMLElement, label: string) => {
    const row = [...block.querySelectorAll("label")].find((l) => l.textContent?.includes(label))!;
    const input = row.querySelector<HTMLInputElement>("input[type=checkbox]") ?? (row.control as HTMLInputElement);
    input.click();
  };
  return { host, handle, blocks, tokens, addScope, toggle };
};

describe("the scope name's checks", () => {
  it("says why a name can't be used, and passes one that can", () => {
    expect(scopeTokenProblem("", [])).toBe("Give the scope a name, such as player.");
    expect(scopeTokenProblem("9lives", [])).toBe("A scope's name is letters, digits and _, and doesn't start with a digit.");
    expect(scopeTokenProblem("my-scope", [])).toMatch(/letters, digits and _/);
    expect(scopeTokenProblem("world", [])).toBe("@world is already the first scope.");
    expect(scopeTokenProblem("patter", [])).toBe("@patter is Patter's own scope, so the game can't provide it.");
    expect(scopeTokenProblem("scene", [])).toBe("@scene is Patter's own scope, so the game can't provide it.");
    // Another engine's scope may be declared: it is how standalone play stands in for the Storylet Engine.
    expect(scopeTokenProblem("story", [])).toBeUndefined();
    expect(scopeTokenProblem("player", ["world", "player"])).toBe("There is already an @player scope.");
    expect(scopeTokenProblem("player", ["world"])).toBeUndefined();
    expect(scopeTokenProblem("Player_2", ["world", "player"])).toBeUndefined();
  });

  it("keeps another engine's scope a project already declared, but won't take one typed here", () => {
    expect(scopeTokenProblem("story", ["world"], "story")).toBeUndefined();
    expect(scopeTokenProblem("story", ["world"], "player")).toBeUndefined();
  });

  it("marks the field as it's typed, says why in its tip, and blocks Save until it's fixed", () => {
    const { handle, tokens, addScope } = mount();
    addScope();
    const field = tokens()[0]!;
    expect(field.classList.contains("illegal")).toBe(true); // empty
    for (const [name, why] of [["9lives", /letters, digits/], ["patter", /Patter's own/], ["world", /first scope/]] as const) {
      type(field, name);
      expect(field.dataset.tip, name).toMatch(why);
      expect(handle.firstBadScope()).toEqual({ el: field, message: field.dataset.tip });
    }
    type(field, "player");
    expect(field.classList.contains("illegal")).toBe(false);
    expect(handle.firstBadScope()).toBeNull();
  });

  it("marks a repeat on both scopes, and clears both when one changes", () => {
    const { tokens, addScope } = mount();
    addScope(); addScope();
    const [a, b] = tokens();
    type(a!, "player");
    type(b!, "player");
    expect(a!.classList.contains("illegal")).toBe(true);
    expect(b!.dataset.tip).toBe("There is already an @player scope.");
    type(b!, "foe");
    expect(a!.classList.contains("illegal")).toBe(false);
    expect(b!.classList.contains("illegal")).toBe(false);
  });
});

describe("the scopes", () => {
  it("puts @world first, fixed, with no name field and no Remove, even for a project that declares none", () => {
    const { host, blocks, tokens, handle } = mount();
    expect(blocks()).toHaveLength(1);
    expect(blocks()[0]!.querySelector(".host-scope-cap")!.textContent).toBe("@world");
    expect(tokens()).toEqual([]);
    expect(host.querySelectorAll(".host-scope-head button")).toHaveLength(0);
    expect(handle.value().scopeRegistry).toBeUndefined(); // an empty @world is no scope at all
  });

  it("moves @world first when the registry lists it later", () => {
    const { blocks } = mount({ version: 1, scopes: [{ token: "player", declarations: [] }, { token: "world", declarations: [] }] });
    expect(blocks()[0]!.querySelector(".host-scope-cap")!.textContent).toBe("@world");
  });

  it("adds a scope, declares a property on it, and saves it under its name", () => {
    const { host, handle, blocks, tokens, addScope } = mount();
    addScope();
    type(tokens()[0]!, "player");
    blocks()[1]!.querySelector<HTMLButtonElement>(".gd-add")!.click();
    type(blocks()[1]!.querySelector<HTMLInputElement>("input.gd-name")!, "hp");
    expect(blocks()[1]!.querySelector(".world-scope")!.textContent).toBe("player");
    expect(handle.value().scopeRegistry).toEqual({ version: 1, scopes: [{ token: "player", declarations: [{ name: "hp", type: "number", writable: false }] }] });
    expect(handle.value().scopeRenames).toBeUndefined(); // a new scope is no rename
    host.remove();
  });

  it("makes a scope read-only to the story, and opaque, and back", () => {
    const registry: HostScopeRegistry = { version: 1, scopes: [{ token: "player", declarations: [{ name: "hp", type: "number" }] }] };
    const { handle, blocks, toggle } = mount(registry);
    toggle(blocks()[1]!, "Read-only to the story");
    expect(handle.value().scopeRegistry!.scopes[0]).toEqual({ token: "player", writable: false, declarations: [{ name: "hp", type: "number" }] });
    toggle(blocks()[1]!, "Any name, unchecked");
    expect(handle.value().scopeRegistry!.scopes[0]).toEqual({ token: "player", writable: false });
    expect(blocks()[1]!.querySelector("input.gd-name")).toBeNull();
    expect(blocks()[1]!.textContent).toContain("Any @player name is accepted, and nothing checks it.");
    toggle(blocks()[1]!, "Any name, unchecked"); // the rows come back in the same visit
    expect(handle.value().scopeRegistry!.scopes[0]!.declarations).toEqual([{ name: "hp", type: "number" }]);
  });

  it("has no opaque switch on @world", () => {
    const { blocks } = mount();
    expect(blocks()[0]!.textContent).not.toContain("Any name, unchecked");
    expect(blocks()[0]!.textContent).toContain("Read-only to the story");
  });

  it("removes a scope", () => {
    const registry: HostScopeRegistry = { version: 1, scopes: [
      { token: "world", declarations: [{ name: "threat", type: "number" }] }, { token: "player" },
    ] };
    const { host, handle, blocks } = mount(registry);
    const remove = [...blocks()[1]!.querySelectorAll<HTMLButtonElement>(".host-scope-head button")];
    expect(remove).toHaveLength(1);
    remove[0]!.click();
    expect(blocks()).toHaveLength(1);
    expect(handle.value().scopeRegistry!.scopes.map((s) => s.token)).toEqual(["world"]);
    host.remove();
  });
});

describe("a scope renamed", () => {
  const registry: HostScopeRegistry = { version: 1, scopes: [
    { token: "world", declarations: [{ name: "threat", type: "number" }] },
    { token: "player", declarations: [{ name: "hp", type: "number" }] },
  ] };

  it("is reported as a rename from the name it was saved under, and its drivers follow it", () => {
    const { handle, tokens } = mount(registry, { coverageDrivers: [
      { ref: "@player.hp", kind: "initial", values: [1] },
      { ref: "@world.threat", kind: "initial", values: [2] },
    ] });
    type(tokens()[0]!, "her");   // through a name on the way
    type(tokens()[0]!, "hero");
    const v = handle.value();
    expect(v.scopeRegistry!.scopes.map((s) => s.token)).toEqual(["world", "hero"]);
    expect(v.scopeRenames).toEqual({ player: "hero" });
    expect(v.coverageDrivers!.map((d) => d.ref)).toEqual(["@hero.hp", "@world.threat"]);
  });

  it("is no rename when it's typed back to its saved name", () => {
    const { handle, tokens } = mount(registry);
    type(tokens()[0]!, "hero");
    type(tokens()[0]!, "player");
    expect(handle.value().scopeRenames).toBeUndefined();
  });

  it("keeps a stage renamed on one of its qualities under the name the scope was saved with", () => {
    const { host, handle, tokens } = mount({ version: 1, scopes: [
      { token: "player", declarations: [{ name: "mood", type: "quality", stages: ["calm", "tense", "angry"] }] },
    ] });
    type(tokens()[0]!, "hero");
    // The rename gesture is the shell's stage chips (as stage-rename.test.ts drives them); the scope it's
    // kept under is ours: the save carries stage renames before the scope's, while the scenes say @player.
    for (const d of host.querySelectorAll<HTMLElement>("details, .shell-expandable")) d.setAttribute("open", "");
    [...host.querySelectorAll<HTMLElement>(".shell-tag-label")].find((l) => l.textContent?.endsWith("calm"))!.click();
    const field = host.querySelector<HTMLInputElement>("input.shell-stage-rename")!;
    field.value = "serene";
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(handle.stageRenames()).toEqual([{ scope: "player", name: "mood", from: "calm", to: "serene" }]);
    expect(handle.value().scopeRenames).toEqual({ player: "hero" });
    host.remove();
  });

  it("carries no stage rename on a scope added here, which nothing names yet", () => {
    const { host, handle, blocks, tokens, addScope } = mount();
    addScope();
    type(tokens()[0]!, "mood_scope");
    blocks()[1]!.querySelector<HTMLButtonElement>(".gd-add")!.click();
    const row = blocks()[1]!;
    type(row.querySelector<HTMLInputElement>("input.gd-name")!, "mood");
    const sel = row.querySelector<HTMLSelectElement>("select.gd-type")!;
    sel.value = "quality"; sel.dispatchEvent(new Event("change"));
    expect(handle.stageRenames()).toEqual([]);
    host.remove();
  });
});
