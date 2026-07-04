// ---------------------------------------------------------------------------
// runReplace: project-wide find-and-replace over the source-language prose.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { loadProject, runReplace } from "../src/index.js";

const fixtureDir = fileURLToPath(new URL("./fixture", import.meta.url));
const loaded = loadProject(fixtureDir); // one string: L_1 = "Welcome." in scene scn_tavern

describe("runReplace", () => {
  it("plans a hit + a shard write for a matched string", () => {
    const plan = runReplace(loaded, { query: "Welcome", replacement: "Hello" });
    expect(plan.hits).toHaveLength(1);
    expect(plan.hits[0]).toMatchObject({ id: "L_1", sceneId: "scn_tavern", before: "Welcome.", after: "Hello." });
    expect(plan.scenes).toBe(1);
    expect(plan.writes).toHaveLength(1);
    expect(plan.writes[0]!.path).toMatch(/tavern\.patterloc$/);
    expect(plan.writes[0]!.content).toContain('"Hello."'); // canonical shard carries the new text
    expect(plan.writes[0]!.content).not.toContain("Welcome");
    // location breadcrumb for the preview (scene › block).
    expect(plan.hits[0]!.location[0]).toBe("Tavern");
  });

  it("is case-insensitive by default, case-sensitive on request", () => {
    expect(runReplace(loaded, { query: "welcome", replacement: "Hi" }).hits).toHaveLength(1); // default: matches "Welcome"
    expect(runReplace(loaded, { query: "welcome", replacement: "Hi", caseSensitive: true }).hits).toHaveLength(0);
  });

  it("matches whole words only when asked", () => {
    expect(runReplace(loaded, { query: "Welcom", replacement: "X" }).hits).toHaveLength(1); // substring matches
    expect(runReplace(loaded, { query: "Welcom", replacement: "X", wholeWord: true }).hits).toHaveLength(0);
    expect(runReplace(loaded, { query: "Welcome", replacement: "X", wholeWord: true }).hits).toHaveLength(1);
  });

  it("treats the query + replacement as literal text (no regex / $ surprises)", () => {
    // A query with regex metacharacters matches literally (no match here → no false hit).
    expect(runReplace(loaded, { query: "Welc.me", replacement: "X" }).hits).toHaveLength(0);
    // A `$&`-style replacement is inserted verbatim, not expanded.
    const plan = runReplace(loaded, { query: "Welcome", replacement: "$&!" });
    expect(plan.hits[0]!.after).toBe("$&!.");
  });

  it("scopes to a single beat with onlyId", () => {
    expect(runReplace(loaded, { query: "Welcome", replacement: "Hi", onlyId: "L_1" }).hits).toHaveLength(1);
    expect(runReplace(loaded, { query: "Welcome", replacement: "Hi", onlyId: "L_999" }).hits).toHaveLength(0);
  });

  it("returns an empty plan for an empty query or no match", () => {
    expect(runReplace(loaded, { query: "", replacement: "x" }).writes).toHaveLength(0);
    expect(runReplace(loaded, { query: "nothinghere", replacement: "x" }).writes).toHaveLength(0);
  });
});
