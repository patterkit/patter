// ---------------------------------------------------------------------------
// S1: the round-trip invariant over a CORPUS of generated scenes, not one
// hand-picked example. For every scene the generator emits - all beat kinds,
// nested groups + selectors, conditions / effects / jumps, scene extras - the
// editor document must reproduce it byte-identically (canonical), preserve every
// id, and round-trip the managed strings. Deterministic seeds make any failure
// reproducible.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { canonicalStringify } from "@patterkit/core";
import { sceneToDoc, docToScene } from "../src/bridge.js";
import { makeRng, genScene, allIds } from "./_gen.js";

describe("round-trip corpus (generated scenes)", () => {
  const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);

  it.each(SEEDS)("scene from seed %i round-trips losslessly and id-stably", (seed) => {
    const { scene, strings } = genScene(makeRng(seed));
    const back = docToScene(sceneToDoc(scene, strings));

    expect(canonicalStringify(back.scene)).toBe(canonicalStringify(scene)); // byte-identical flow
    expect(back.strings).toEqual(strings);                                  // managed strings exact
    expect(allIds(back.scene)).toEqual(allIds(scene));                      // every id survived
  });

  it("every generated scene has unique ids to begin with (generator sanity)", () => {
    for (const seed of SEEDS) {
      const ids = allIds(genScene(makeRng(seed)).scene);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
