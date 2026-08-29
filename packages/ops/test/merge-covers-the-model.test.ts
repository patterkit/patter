// ---------------------------------------------------------------------------
// Two guards over pairs of lists that must agree but have nothing holding them together
// (from-storylets/merge-holes-worth-checking: "a merge spec is a SECOND description of a data model,
// and nothing makes it track the first"). Both were true in prose and unchecked in code.
//
//   1. Every extension `pack` ships has a merge strategy, or `unpack --merge` throws on the return
//      leg - and because it merges every shard the pack carries, ONE such file kills the whole run.
//      Storyletter shipped exactly this: a comments file it packed and could not merge.
//   2. Every field of AuthoringFile survives an authoring merge. `suggestions` and `rerecord` did
//      not: they were dropped silently, which is how this brief started.
//
// These read the real lists rather than restating them, so a new shard type or model field fails
// here rather than in somebody's project.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SHARD_EXTENSIONS } from "../src/pack.js";
import { detectMergeType, runMerge } from "../src/merge.js";

const here = dirname(fileURLToPath(import.meta.url));

/** The schema string each packed extension carries, as its writer sets it. */
const SCHEMA_FOR: Record<string, string> = {
  ".patterflow": "patter/flow@0",
  ".patterloc": "patter/strings@0",
  ".patterx": "patter/authoring@0",
  ".patterproj": "patter/project@0",
};

describe("every packed shard type can be merged", () => {
  it("has a schema mapping for each packed extension", () => {
    // If this fails, the case below cannot speak for the new extension: add it here first.
    expect(Object.keys(SCHEMA_FOR).sort()).toEqual([...SHARD_EXTENSIONS].sort());
  });

  it("detects a merge type from each one", () => {
    for (const ext of SHARD_EXTENSIONS) {
      expect(() => detectMergeType({ schema: SCHEMA_FOR[ext] }), `${ext} has no merge strategy`).not.toThrow();
    }
  });
});

describe("an authoring merge covers every field the model declares", () => {
  it("loses none of AuthoringFile's fields", () => {
    // Read the model's own interface rather than a copy of it: a field added there and forgotten
    // here is precisely the failure this guards.
    const model = readFileSync(resolve(here, "../../model/src/index.ts"), "utf8");
    const body = /export interface AuthoringFile\b[^{]*\{([\s\S]*?)\n\}/.exec(model);
    expect(body, "AuthoringFile not found in the model").toBeTruthy();
    const fields = [...body![1]!.matchAll(/^\s*(?:readonly\s+)?([A-Za-z][A-Za-z0-9_]*)\??:/gm)].map((m) => m[1]!);
    expect(fields.length).toBeGreaterThan(5); // the regex still finds the interface

    // A value shaped plausibly for each field, on OUR side only: whatever the strategy, it must come
    // out the other side. (Empty objects/arrays are legitimately dropped, so use non-empty ones.)
    const sample: Record<string, unknown> = {
      schema: "patter/authoring@0",
      comments: [{ id: "c1", anchor: "L1", messages: [{ author: "a", ts: "2026-01-01", body: "hi" }] }],
      suggestions: [{ id: "s1", anchor: "L1", baseline: "a", proposed: "b", author: "a", ts: "2026-01-01" }],
      edits: { L1: { modifiedAt: "2026-01-01" } },
      writing: { L1: "draft 1" },
      recording: { L1: "scratch" },
      rerecord: { L1: true },
      audio: { L1: "scratch" },
      documentation: { L1: [{ text: "note" }] },
      cut: { L1: true },
    };
    const missing = fields.filter((f) => !(f in sample));
    expect(missing, `no sample value for ${missing.join(", ")} - add one so this guard can speak for it`).toEqual([]);

    const base = { schema: "patter/authoring@0" };
    const merged = runMerge(base, sample, base).merged;
    const dropped = fields.filter((f) => merged[f] === undefined);
    expect(dropped, `an authoring merge DROPPED ${dropped.join(", ")}`).toEqual([]);
  });
});
