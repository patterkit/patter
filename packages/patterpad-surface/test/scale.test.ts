// ---------------------------------------------------------------------------
// S7: correctness and speed at scale. A large scene (60 blocks x 12 snippets x 3
// beats ~ 2160 beats) must still round-trip byte-identically with every id
// preserved, and the model-layer build + serialize must stay well under a
// generous ceiling - the sanity check behind the virtualization/fast-paint plan
// (rendering perf itself is a real-browser concern, documented in the build doc).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { canonicalStringify } from "@patterkit/core";
import type { Scene } from "@patterkit/model";
import { sceneToDoc, docToScene } from "../src/bridge.js";

function largeScene(blocks: number, snipsPerBlock: number, beatsPerSnip: number): { scene: Scene; strings: Record<string, string> } {
  let n = 0;
  const id = (p: string): string => `${p}${n++}`;
  const strings: Record<string, string> = {};
  const KINDS = ["line", "text", "gameEvent"] as const;

  const scene: Scene = {
    id: "scn_big", type: "scene", name: "Big",
    blocks: Array.from({ length: blocks }, (_, bi) => ({
      id: `blk${bi}`, type: "block" as const, name: `Block ${bi}`,
      children: Array.from({ length: snipsPerBlock }, () => {
        const beats = Array.from({ length: beatsPerSnip }, () => {
          const kind = KINDS[n % 3]!;
          const bid = id("L");
          const beat: Record<string, unknown> = { id: bid, kind };
          if (kind === "line") beat.character = n % 2 === 0 ? "ANNA" : "BO";
          if (kind !== "gameEvent") strings[bid] = `Line ${bid}`;
          return beat;
        });
        return { id: id("sn"), type: "snippet" as const, beats, jump: { to: "END" } } as never;
      }),
    })),
  };
  return { scene, strings };
}

const allIds = (s: Scene): string[] => {
  const ids: string[] = [];
  const walk = (node: { id?: string; blocks?: unknown[]; children?: unknown[]; beats?: unknown[] }) => {
    if (node.id) ids.push(node.id);
    [...(node.blocks ?? []), ...(node.children ?? []), ...(node.beats ?? [])].forEach((c) => walk(c as typeof node));
  };
  walk(s); return ids;
};

describe("scale: a large scene round-trips correctly and quickly", () => {
  it("2160-beat scene is lossless, id-stable, and builds + serializes well under budget", () => {
    const { scene, strings } = largeScene(60, 12, 3);
    const ids = allIds(scene);
    expect(ids.length).toBe(1 + 60 + 60 * 12 + 60 * 12 * 3); // scene + blocks + snippets + beats

    const t0 = performance.now();
    const back = docToScene(sceneToDoc(scene, strings));
    const canonical = canonicalStringify(back.scene);
    const ms = performance.now() - t0;

    expect(canonical).toBe(canonicalStringify(scene)); // byte-identical at scale
    expect(back.strings).toEqual(strings);
    expect(allIds(back.scene)).toEqual(allIds(scene));
    expect(new Set(ids).size).toBe(ids.length);        // unique
    // Generous ceiling - catches a pathological regression without being flaky.
    expect(ms).toBeLessThan(2000);
  });
});
