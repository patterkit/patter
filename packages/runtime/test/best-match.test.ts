// ---------------------------------------------------------------------------
// Best match (`sequence` with `order: "specificity"`, spec: Best-match selector):
// among the eligible children, prefer the one whose condition most specifically
// fits the current state; equally-specific ties break by the seeded shuffle; a
// child with no condition is the filler that wins only when nothing more specific
// is eligible. Covers the matched-specificity metric (AND sums, OR takes the
// stronger branch, check_flags operand count + its AND-expansion identity), the
// filler tier, tie -> seeded shuffle, re-pickable (repeat) vs graceful
// degradation (once), and the dry fall-through. These are the parity contract.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import type { ProjectFile, Scene, LocaleFile, Group, Snippet } from "@patterkit/model";

const PROPS = [
  { name: "x", type: "number" as const, shared: true, default: 0 },
  { name: "y", type: "number" as const, shared: true, default: 0 },
  { name: "z", type: "number" as const, shared: true, default: 0 },
  { name: "q", type: "flags" as const, shared: true },
];
const project = (): ProjectFile => ({
  schema: "patter/project@0", project: { id: "bm", name: "BM" },
  locales: { default: "en", all: ["en"] },
  properties: PROPS,
});
const loc = (strings: Record<string, string>): LocaleFile => ({ schema: "patter/strings@0", scene: "s", locale: "en", strings });
// Children never jump: the group yields the selected line, then control falls through (the block ends
// for a single draw, or the loop gate re-enters the group). A jump would end the flow after one pick.
const text = (id: string): Snippet => ({ id, type: "snippet", beats: [{ id: `T_${id}`, kind: "text" }] });
const cond = (id: string, condition: string): Snippet => ({ ...text(id), condition });

const STRINGS = { T_a: "A", T_b: "B", T_c: "C", T_f: "F" };

/** One Best-match draw: enter the group once; the selected line yields, then the block ends. Returns the line (or none). */
function pickOnce(children: Array<Group | Snippet>, state: (e: Engine) => void, seed = 1): string[] {
  const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "g", type: "group", selector: "sequence", options: { order: "specificity", exhaust: "repeat" }, children } as Group,
  ] }] };
  const bundle = exportBundle({ project: project(), scenes: [scene], locales: [loc(STRINGS)] });
  const engine = new Engine(bundle, { seed });
  state(engine);
  return drain(engine);
}

/** Loop the Best-match group `n` times (a gate re-enters it), collecting each yielded line. */
function pickLoop(children: Array<Group | Snippet>, exhaust: "repeat" | "once" | "stick", n: number, state: (e: Engine) => void, seed = 1): string[] {
  const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [{ id: "loop", type: "block", name: "Loop", children: [
    { id: "g", type: "group", selector: "sequence", options: { order: "specificity", exhaust }, children } as Group,
    { id: "gate", type: "snippet", condition: `visits('loop') < ${n}`, jump: { to: "loop" } },
    { id: "done", type: "snippet", jump: { to: "END" } },
  ] }] };
  const bundle = exportBundle({ project: project(), scenes: [scene], locales: [loc(STRINGS)] });
  const engine = new Engine(bundle, { seed });
  state(engine);
  return drain(engine);
}

function drain(engine: Engine): string[] {
  const flow = engine.openFlow("main", { scene: "s" });
  const out: string[] = [];
  for (let i = 0; i < 200; i++) {
    const r = flow.advance();
    if (r.type === "end") return out;
    if (r.type === "text" && r.text) out.push(r.text);
  }
  throw new Error("did not end");
}

describe("Best match: the specificity metric", () => {
  it("prefers the more specific line (AND sums: @x==5 and @y>3 beats @x==5)", () => {
    const children = [
      cond("a", "@x == 5"),                 // score 1
      cond("b", "@x == 5 and @y > 3"),      // score 2 -> wins
    ];
    expect(pickOnce(children, (e) => { e.setProperty("@x", 5); e.setProperty("@y", 4); })).toEqual(["B"]);
  });

  it("scores OR by its stronger matching branch, not the sum (max, so AND still wins)", () => {
    const children = [
      cond("a", "@x == 5 or @y == 5"),      // both true -> max(1,1) = 1
      cond("b", "@x == 5 and @z == 5"),     // score 2 -> wins
    ];
    expect(pickOnce(children, (e) => { e.setProperty("@x", 5); e.setProperty("@y", 5); e.setProperty("@z", 5); })).toEqual(["B"]);
  });

  it("counts check_flags operands (3 flags beats a single comparison)", () => {
    const children = [
      cond("a", "check_flags(@q, +a, +b, +c)"),  // score 3 -> wins
      cond("b", "@z == 1"),                       // score 1
    ];
    expect(pickOnce(children, (e) => { e.setProperty("@q", ["a", "b", "c"]); e.setProperty("@z", 1); })).toEqual(["A"]);
  });

  it("check_flags(q,a,b) scores the same as check_flags(q,a) and check_flags(q,b) (the AND-expansion identity)", () => {
    // If the two scored differently one would always win; a tie means the seeded shuffle decides,
    // so BOTH ids appear across a range of seeds. A score-3 sibling would beat either.
    const children = [
      cond("a", "check_flags(@q, +a, +b)"),                        // score 2
      cond("b", "check_flags(@q, +a) and check_flags(@q, +b)"),    // score 2 (identical)
    ];
    const winners = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) winners.add(pickOnce(children, (e) => e.setProperty("@q", ["a", "b"]), seed)[0]!);
    expect(winners).toEqual(new Set(["A", "B"]));
  });
});

describe("Best match: the filler tier", () => {
  const children = [cond("a", "@x == 5"), text("f")]; // 'f' has no condition -> filler (score 0)

  it("prefers the specific line when it is eligible", () => {
    expect(pickOnce(children, (e) => e.setProperty("@x", 5))).toEqual(["A"]);
  });
  it("falls back to the filler when nothing more specific applies", () => {
    expect(pickOnce(children, (e) => e.setProperty("@x", 1))).toEqual(["F"]);
  });
});

describe("Best match: exhaustion", () => {
  // Three tiers, all eligible: A (2) > B (1) > filler F (0).
  const tiers = () => [
    cond("a", "@x == 5 and @y == 5"),
    cond("b", "@x == 5"),
    text("f"),
  ];
  const allEligible = (e: Engine) => { e.setProperty("@x", 5); e.setProperty("@y", 5); };

  it("re-pickable by default (repeat): keeps choosing the most specific line every visit", () => {
    expect(pickLoop(tiers(), "repeat", 4, allEligible)).toEqual(["A", "A", "A", "A"]);
  });

  it("once: uses each pick up, sliding down to the filler, then dries (graceful degradation)", () => {
    expect(pickLoop(tiers(), "once", 4, allEligible)).toEqual(["A", "B", "F"]); // 4 loops, 3 distinct picks
  });

  it("yields nothing when no child is eligible (dry fall-through)", () => {
    expect(pickOnce([cond("a", "@x == 5")], (e) => e.setProperty("@x", 1))).toEqual([]);
  });
});

describe("Best match: tie -> seeded shuffle", () => {
  const tie = () => [cond("a", "@x == 5"), cond("b", "@x == 5")]; // both score 1

  it("is deterministic for a given seed and never repeats back-to-back", () => {
    const a = pickLoop(tie(), "repeat", 6, (e) => e.setProperty("@x", 5), 99);
    const b = pickLoop(tie(), "repeat", 6, (e) => e.setProperty("@x", 5), 99);
    expect(a).toEqual(b);                                   // reproducible
    expect(a).toHaveLength(6);
    expect(new Set(a)).toEqual(new Set(["A", "B"]));        // both tiers drawn
    for (let i = 1; i < a.length; i++) expect(a[i]).not.toBe(a[i - 1]); // no immediate repeat
  });
});
