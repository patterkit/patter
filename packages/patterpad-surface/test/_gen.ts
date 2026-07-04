// ---------------------------------------------------------------------------
// A seeded, deterministic Patter-scene generator for the S1 corpus + fuzz tests.
// It exercises the full source model: all three beat kinds, characters /
// directions / gameData, snippet conditions / effects / jumps (jump + call) /
// choiceText, nested groups with every selector, multiple blocks, and scene-level
// extras (onEntry / gameData). Strings are registered ONLY for line/text beats in
// block-level snippets - the keys the bridge actually manages - so a clean
// round-trip is the expected result, not a coincidence.
// ---------------------------------------------------------------------------

import type { Scene } from "@patterkit/model";

export type Rng = () => number;

/** mulberry32 - a tiny deterministic PRNG (seed in, reproducible stream out). */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Generated {
  scene: Scene;
  strings: Record<string, string>;
}

const CHARS = ["ANNA", "BO", "BARKEEP", "NARRATOR", "dr. kane"];
const LINES = ["Hello there.", "A long line of words.", "Why?", "...", "The door creaks open slowly."];
const SELECTORS = ["run", "branch", "sequence", "cycle", "once", "shuffle", "choice"];

export function genScene(rng: Rng): Generated {
  const rint = (lo: number, hi: number): number => lo + Math.floor(rng() * (hi - lo + 1));
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)]!;
  const chance = (p: number): boolean => rng() < p;
  let n = 0;
  const id = (p: string): string => `${p}_${n++}`;
  const strings: Record<string, string> = {};

  // `register` = is this beat in a block-level snippet (so its text is a managed
  // locale key)? Beats buried in opaque groups carry no separate locale entry.
  function genBeat(register: boolean): Record<string, unknown> {
    const kind = pick(["line", "line", "text", "gameEvent"]);
    const bid = id(kind === "line" ? "L" : kind === "text" ? "T" : "A");
    const beat: Record<string, unknown> = { id: bid, kind };
    if (kind === "line" && chance(0.8)) beat.character = pick(CHARS);
    if (kind === "line" && chance(0.2)) beat.direction = pick(["weary", "bright", "cold"]);
    if (chance(0.15)) beat.gameData = { tag: id("g") };
    if (register && (kind === "line" || kind === "text") && chance(0.85)) strings[bid] = pick(LINES);
    return beat;
  }

  function genSnippet(topLevel: boolean): Record<string, unknown> {
    const snip: Record<string, unknown> = { id: id("sn"), type: "snippet" };
    const beatCount = rint(0, 4);
    if (beatCount > 0) snip.beats = Array.from({ length: beatCount }, () => genBeat(topLevel));
    if (chance(0.3)) snip.condition = "@x > 0";
    if (chance(0.2)) snip.onExit = [{ kind: "set", target: "@x", value: "@x + 1" }];
    if (chance(0.3)) snip.jump = chance(0.3) ? { to: pick(["END", "menu"]), mode: "call" } : { to: pick(["END", "menu"]) };
    if (chance(0.1)) snip.choiceText = id("C");
    if (chance(0.1)) snip.gameData = { z: 1 };
    if (!snip.beats && !snip.jump) snip.jump = { to: "END" }; // no-beats snippet needs a jump
    return snip;
  }

  function genGroup(depth: number): Record<string, unknown> {
    const grp: Record<string, unknown> = { id: id("grp"), type: "group" };
    if (chance(0.6)) grp.selector = pick(SELECTORS);
    if (chance(0.3)) grp.condition = "@y";
    if (chance(0.2)) grp.shared = true;
    grp.children = Array.from({ length: rint(1, 3) }, () =>
      depth < 2 && chance(0.3) ? genGroup(depth + 1) : genSnippet(false));
    return grp;
  }

  function genBlock(): Record<string, unknown> {
    return {
      id: id("blk"), type: "block", name: `Block ${id("nm")}`,
      children: Array.from({ length: rint(1, 4) }, () => chance(0.25) ? genGroup(1) : genSnippet(true)),
    };
  }

  const scene: Record<string, unknown> = {
    id: id("scn"), type: "scene", name: "Scene",
    blocks: Array.from({ length: rint(1, 3) }, genBlock),
  };
  if (chance(0.4)) scene.onEntry = [{ kind: "set", target: "@scene.entered", value: "true" }];
  if (chance(0.2)) scene.gameData = { location: "tavern" };

  return { scene: scene as unknown as Scene, strings };
}

/** Every id in a scene, sorted - for the id-preservation invariant. */
export function allIds(s: Scene): string[] {
  const ids: string[] = [];
  const walk = (node: { id?: string; blocks?: unknown[]; children?: unknown[]; beats?: unknown[] }): void => {
    if (node.id) ids.push(node.id);
    [...(node.blocks ?? []), ...(node.children ?? []), ...(node.beats ?? [])].forEach((c) => walk(c as typeof node));
  };
  walk(s);
  return ids.sort();
}
