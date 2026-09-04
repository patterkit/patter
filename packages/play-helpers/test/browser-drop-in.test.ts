// The browser drop-in (src/browser.ts -> dist/patterplay.min.js) puts the runtime and these helpers
// on ONE global. Two things keep that honest:
//   1. `export *` from both silently DROPS a name exported by each; so the two export sets must not
//      overlap, checked against the real modules, not a list.
//   2. The built file, when present, must define `Patterplay` with members from both sides and play
//      a save round-trip, the way a page uses it. Skips with a note when no dist exists (build it
//      with `npm run build -w @patterkit/play-helpers`); CI builds before it tests.
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as runtime from "@patterkit/runtime";
import * as helpers from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const built = resolve(here, "../dist/patterplay.min.js");

describe("the browser drop-in carries the runtime and the helpers", () => {
  it("the runtime's and the helpers' export names do not overlap (export * would drop a clash)", () => {
    const clash = Object.keys(runtime).filter((k) => k in helpers);
    expect(clash).toEqual([]);
  });

  it.skipIf(!existsSync(built))("dist/patterplay.min.js defines Patterplay with both sides, and a save round-trips", () => {
    const js = readFileSync(built, "utf8");
    // The IIFE assigns `var Patterplay = ...`; run it in a function scope and hand the global back.
    const Patterplay = new Function(`${js}\n;return Patterplay;`)() as Record<string, unknown>;
    for (const name of ["Engine", "Flow", "describeBundle", "serializeState", "deserializeState", "createStateLogger", "createPropertyInspector", "applyLiveBundle"]) {
      expect(typeof Patterplay[name], name).toBe("function");
    }
    const bundle = {
      schema: "patter/bundle@0", content: { project: "p", version: "1.0.0", hash: "h" }, voiced: false,
      locales: { default: "en", included: ["en"] }, properties: [], cast: [],
      strings: { en: { T1: "one", T2: "two" } },
      scenes: { s: { id: "s", name: "S", blocks: [{ id: "b", name: "B", children: [
        { id: "sn", type: "snippet", beats: [{ id: "T1", kind: "text" }, { id: "T2", kind: "text" }], jump: { to: "END" } },
      ] }] } },
    };
    const Engine = Patterplay.Engine as new (b: unknown) => { openFlow: (id: string, at: unknown) => { advance: () => { type: string; text?: string } }; getFlow: (id: string) => { advance: () => { type: string; text?: string } } };
    const serializeState = Patterplay.serializeState as (e: unknown) => string;
    const deserializeState = Patterplay.deserializeState as (e: unknown, s: string) => void;
    const a = new Engine(bundle);
    const flow = a.openFlow("main", { scene: "s", block: "b" });
    expect(flow.advance().text).toBe("one");
    const save = serializeState(a);
    expect(JSON.parse(save).schema).toBe("patter/save@0");
    const b = new Engine(bundle);
    deserializeState(b, save);
    expect(b.getFlow("main").advance().text).toBe("two"); // resumed exactly where the first engine left off
  });
});
