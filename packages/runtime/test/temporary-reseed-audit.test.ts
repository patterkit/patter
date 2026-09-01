// A `temporary` scene property is reset to its default on EVERY entry to the scene.
// This pins the fact that the reset is AUDITED - it goes through bag.set(), so a state
// logger sees it.
//
// This is a deliberate behaviour change from the hand-rolled bags, which wrote the
// default straight into a plain record and notified nobody. Keeping it silent was never
// a decision, it was a consequence of the storage; and a temporary snapping back to its
// default is a state change, so a log that omits it is wrong. All four runtimes emit it.
import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import type { ProjectFile, Scene, LocaleFile } from "@patterkit/model";

const project: ProjectFile = { schema: "patter/project@0", project: { id: "p", name: "P" }, locales: { default: "en", all: ["en"] } };
// A holds the temporary, and the flow runs A -> B -> A, so A is entered more than once.
const a: Scene = { id: "a", type: "scene", name: "A", gameId: "a",
  sceneProps: [{ name: "temp", type: "number", default: 7, temporary: true, shared: false }],
  blocks: [{ id: "ab", type: "block", name: "AB", children: [
    { id: "a1", type: "snippet", beats: [{ id: "L1", kind: "text" }], jump: { to: "bb" } }] }] };
const b: Scene = { id: "b", type: "scene", name: "B", gameId: "b",
  blocks: [{ id: "bb", type: "block", name: "BB", children: [
    { id: "b1", type: "snippet", beats: [{ id: "L2", kind: "text" }], jump: { to: "ab" } }] }] };
const ea: LocaleFile = { schema: "patter/strings@0", scene: "a", locale: "en", strings: { L1: "a" } };
const eb: LocaleFile = { schema: "patter/strings@0", scene: "b", locale: "en", strings: { L2: "b" } };
const bundle = exportBundle({ project, scenes: [a, b], locales: [ea, eb] });

type Auditable = { onAudit(fn: (c: { name: string; next: unknown }) => void): () => void };

describe("a temporary scene property", () => {
  it("audits its reset on every re-entry", () => {
    const engine = new Engine(bundle, { seed: 0 });
    const f = engine.openFlow("f", { scene: "a", block: "ab" });
    const seen: Array<{ name: string; next: unknown }> = [];
    const bag = (f as never as { sceneBags: Map<string, Auditable> }).sceneBags.get("a");
    bag?.onAudit((c) => seen.push({ name: c.name, next: c.next }));

    for (let i = 0; i < 8 && f.advance().type !== "end"; i++) { /* a -> b -> a -> b -> a */ }

    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((c) => c.name === "temp" && c.next === 7)).toBe(true);
  });
});
