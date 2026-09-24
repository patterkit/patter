// @vitest-environment jsdom
// World properties save each scope under its own token. The tab was written for @world alone and
// folded every row it was given into @world on save, so a scope imported under another token (an
// engine's `@story`, from before the game shared its scopes) became `@world.act` the first time
// anyone saved Project Settings. And where the game has a shared scopes folder, the tab says which
// file these are saved to.

import { describe, it, expect } from "vitest";
import { mountWorld } from "./src/settings-world.js";

const registry = { version: 1, scopes: [
  { token: "world", declarations: [{ name: "threat", type: "number" as const, default: 3 }] },
  { token: "story", writable: false, declarations: [{ name: "act", type: "number" as const, purpose: "Which act" }] },
  { token: "weather" }, // opaque: no rows to edit, carried through as it is
] };

describe("World properties with more than one scope", () => {
  it("gives each row its own token, and saves each scope back under it", () => {
    const host = document.createElement("div");
    const handle = mountWorld(host, { scopeRegistry: registry, onPropose: () => Promise.resolve([]) });
    expect([...host.querySelectorAll(".world-scopes .world-scope")].map((e) => e.textContent)).toEqual(["world", "story"]);
    expect(handle.value().scopeRegistry).toEqual(registry);
  });

  it("names the shared file when the game has a scopes folder, and says nothing of one otherwise", () => {
    const shared = document.createElement("div");
    mountWorld(shared, { scopeRegistry: registry, onPropose: () => Promise.resolve([]), worldFile: "/game/game-scopes/game.scopes.json" });
    expect(shared.textContent).toContain("saved to /game/game-scopes/game.scopes.json");
    const alone = document.createElement("div");
    mountWorld(alone, { scopeRegistry: registry, onPropose: () => Promise.resolve([]) });
    expect(alone.textContent).not.toContain("game.scopes.json");
  });
});
