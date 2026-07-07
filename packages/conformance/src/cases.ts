// ---------------------------------------------------------------------------
// The authored conformance fixtures. `expected` / `expectedTranscript` are the
// CONTRACT - written by hand, never derived from the engine, with ONE caveat:
// where a seeded PRNG is involved (shuffle / random), the expectation is
// computed from the contractual mulberry32 algorithm (runner.ts pins it), since
// hand-predicting draws is not meaningful. New runtime behaviour lands here
// first (Plan §8). `buildCorpus(cases)` compiles these into the portable
// corpus.json; the test asserts the reference engine reproduces every value.
// ---------------------------------------------------------------------------

import type { Fixtures, RuntimeFixture, ScriptedFixture, GameDataFixture } from "./types.js";
import type { ProjectFile, LocaleFile, Scene } from "@patterkit/model";
import { castStringKey } from "@patterkit/model";

// A minimal project scaffold shared by the runtime fixtures.
const project = (extra: Partial<ProjectFile> = {}): ProjectFile => ({
  schema: "patter/project@0",
  project: { id: "conf", name: "Conformance" },
  locales: { default: "en", all: ["en"] },
  cast: [{ name: "NPC" }],
  ...extra,
});
const loc = (scene: string, strings: Record<string, string>, locale = "en"): LocaleFile => ({
  schema: "patter/strings@0", scene, locale, strings,
});

// --- a single line then the end of the flow ---------------------------------
const lineThenEnd = {
  name: "line then end",
  project: project(),
  scenes: [{
    id: "s", type: "scene", name: "S",
    blocks: [{ id: "b", type: "block", name: "B", children: [
      { id: "sn", type: "snippet", beats: [{ id: "L", kind: "line", character: "NPC" }], jump: { to: "END" } },
    ] }],
  }],
  locales: [loc("s", { L: "Welcome." })],
  expectedTranscript: [
    { type: "line", id: "L", text: "Welcome.", character: "NPC" },
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// --- a choice with a greyed (ineligible) option; pick the eligible one -------
const choicePick = {
  name: "choice with greyed option, pick the eligible",
  project: project({ properties: [{ name: "hp", type: "number", shared: true, default: 10 }] }),
  scenes: [{
    id: "s", type: "scene", name: "S",
    blocks: [{ id: "b", type: "block", name: "B", children: [
      { id: "g", type: "group", selector: "choice", children: [
        { id: "yes", type: "group", prompt: { id: "C_yes", kind: "text" }, children: [{ id: "yes_c", type: "snippet", jump: { to: "after" } }] },
        { id: "locked", type: "group", condition: "@hp > 100", prompt: { id: "C_locked", kind: "text" }, children: [{ id: "locked_c", type: "snippet", jump: { to: "END" } }] },
      ] },
    ] }, {
      id: "after", type: "block", name: "After", children: [
        { id: "done", type: "snippet", beats: [{ id: "L_done", kind: "line", character: "NPC" }], jump: { to: "END" } },
      ],
    }],
  }],
  locales: [loc("s", { C_yes: "Continue", C_locked: "[locked]", L_done: "Done." })],
  choices: ["yes"],
  expectedTranscript: [
    { type: "choice", options: [
      { id: "yes", text: "Continue", eligible: true },
      { id: "locked", text: "[locked]", eligible: false },
    ] },
    { type: "line", id: "L_done", text: "Done.", character: "NPC" },
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// --- interpolation in a line + a following text beat ------------------------
const interpolation = {
  name: "interpolation: line + text beats expand {@ref}",
  project: project({ properties: [
    { name: "name", type: "string", shared: true, default: "Ada" },
    { name: "gold", type: "number", shared: true, default: 5 },
  ] }),
  scenes: [{
    id: "s", type: "scene", name: "S",
    blocks: [{ id: "b", type: "block", name: "B", children: [
      { id: "sn", type: "snippet", beats: [
        { id: "L", kind: "line", character: "NPC" },
        { id: "T", kind: "text" },
      ], jump: { to: "END" } },
    ] }],
  }],
  locales: [loc("s", { L: "Hello {@name}, you have {@gold} gold.", T: "{@name}'s ledger." })],
  expectedTranscript: [
    { type: "line", id: "L", text: "Hello Ada, you have 5 gold.", character: "NPC" },
    { type: "text", id: "T", text: "Ada's ledger." },
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// --- a seeded shuffle sequence (pins the PRNG: seed 7 -> index 0 of 3) --------
const shuffle = {
  name: "seeded shuffle selects a deterministic child",
  project: project(),
  seed: 7,
  scenes: [{
    id: "s", type: "scene", name: "S",
    blocks: [{ id: "b", type: "block", name: "B", children: [
      { id: "g", type: "group", selector: "sequence", options: { order: "shuffle", exhaust: "repeat" }, children: [
        { id: "opt0", type: "snippet", beats: [{ id: "O0", kind: "line", character: "NPC" }], jump: { to: "END" } },
        { id: "opt1", type: "snippet", beats: [{ id: "O1", kind: "line", character: "NPC" }], jump: { to: "END" } },
        { id: "opt2", type: "snippet", beats: [{ id: "O2", kind: "line", character: "NPC" }], jump: { to: "END" } },
      ] },
    ] }],
  }],
  locales: [loc("s", { O0: "alpha", O1: "beta", O2: "gamma" })],
  expectedTranscript: [
    { type: "line", id: "O0", text: "alpha", character: "NPC" },
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// --- sequence (sequential, stick): play through, then hold the last child ----
const sequence = {
  name: "sequence (stick) holds the last child after the pass",
  project: project({ properties: [{ name: "count", type: "number", shared: true, default: 0 }] }),
  scenes: [{
    id: "s", type: "scene", name: "S",
    blocks: [
      { id: "loop", type: "block", name: "Loop", children: [
        { id: "seq", type: "group", selector: "sequence", options: { order: "sequential", exhaust: "stick" }, children: [
          { id: "sa", type: "snippet", beats: [{ id: "L1", kind: "line" }], jump: { to: "tick" } },
          { id: "sb", type: "snippet", beats: [{ id: "L2", kind: "line" }], jump: { to: "tick" } },
        ] },
      ] },
      { id: "tick", type: "block", name: "Tick", children: [
        { id: "stop", type: "snippet", condition: "@count >= 2", jump: { to: "END" } },
        { id: "go", type: "snippet", onEnter: [{ kind: "set", target: "@count", value: "@count + 1" }], jump: { to: "loop" } },
      ] },
    ],
  }],
  locales: [loc("s", { L1: "one", L2: "two" })],
  expectedTranscript: [
    { type: "line", id: "L1", text: "one" },   // pass: first child
    { type: "line", id: "L2", text: "two" },   // pass: last child
    { type: "line", id: "L2", text: "two" },   // exhausted -> stick on the last
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// --- Best match (order: "specificity"): the matched-specificity metric --------
// State comes from property DEFAULTS (no host input), so every engine scores the
// same conditions against the same values. A single draw resolves the group.
const bestMatchGroup = (children: Scene["blocks"][number]["children"]): Scene => ({
  id: "s", type: "scene", name: "S",
  blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "g", type: "group", selector: "sequence", options: { order: "specificity", exhaust: "repeat" }, children },
  ] }],
});

// AND sums: `@x == 5 and @y > 3` (2) beats `@x == 5` (1) when both hold.
const specAndSums = {
  name: "specificity prefers the more specific line (AND sums)",
  project: project({ properties: [{ name: "x", type: "number", shared: true, default: 5 }, { name: "y", type: "number", shared: true, default: 4 }] }),
  scenes: [bestMatchGroup([
    { id: "a", type: "snippet", condition: "@x == 5", beats: [{ id: "BA", kind: "line" }], jump: { to: "END" } },
    { id: "b", type: "snippet", condition: "@x == 5 and @y > 3", beats: [{ id: "BB", kind: "line" }], jump: { to: "END" } },
  ])],
  locales: [loc("s", { BA: "generic", BB: "specific" })],
  expectedTranscript: [
    { type: "line", id: "BB", text: "specific" }, // score 2 wins
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// The filler (no condition, score 0) wins only when nothing more specific is eligible.
const specFiller = {
  name: "specificity falls back to the filler when nothing specific is eligible",
  project: project({ properties: [{ name: "x", type: "number", shared: true, default: 1 }] }),
  scenes: [bestMatchGroup([
    { id: "a", type: "snippet", condition: "@x == 5", beats: [{ id: "BA", kind: "line" }], jump: { to: "END" } }, // fails (x=1)
    { id: "f", type: "snippet", beats: [{ id: "BF", kind: "line" }], jump: { to: "END" } },                        // filler
  ])],
  locales: [loc("s", { BA: "specific", BF: "filler" })],
  expectedTranscript: [
    { type: "line", id: "BF", text: "filler" },
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// check_flags counts its flag operands: check_flags(@q, +a, +b, +c) scores 3, beating a lone comparison.
const specCheckFlags = {
  name: "specificity counts check_flags operands (3 flags beat one comparison)",
  project: project({ properties: [{ name: "q", type: "flags", shared: true, default: ["a", "b", "c"] }, { name: "z", type: "number", shared: true, default: 1 }] }),
  scenes: [bestMatchGroup([
    { id: "a", type: "snippet", condition: "check_flags(@q, +a, +b, +c)", beats: [{ id: "BA", kind: "line" }], jump: { to: "END" } }, // score 3
    { id: "b", type: "snippet", condition: "@z == 1", beats: [{ id: "BB", kind: "line" }], jump: { to: "END" } },                       // score 1
  ])],
  locales: [loc("s", { BA: "three flags", BB: "one check" })],
  expectedTranscript: [
    { type: "line", id: "BA", text: "three flags" },
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// Equally-specific tie -> seeded shuffle (pins the PRNG). Both children score 1.
const specTie = {
  name: "specificity breaks an equal-specificity tie by the seeded shuffle",
  project: project({ properties: [{ name: "x", type: "number", shared: true, default: 5 }] }),
  seed: 7,
  scenes: [bestMatchGroup([
    { id: "a", type: "snippet", condition: "@x == 5", beats: [{ id: "BA", kind: "line" }], jump: { to: "END" } },
    { id: "b", type: "snippet", condition: "@x == 5", beats: [{ id: "BB", kind: "line" }], jump: { to: "END" } },
  ])],
  locales: [loc("s", { BA: "first", BB: "second" })],
  expectedTranscript: [
    { type: "line", id: "BA", text: "first" }, // seed 7 -> tier index 0 (verified against mulberry32)
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// exhaust "once": each pick is used up, so the group slides A (2) -> B (1) -> filler (0) over the pass.
const specDegrades = {
  name: "specificity with exhaust once degrades to the filler",
  project: project({ properties: [
    { name: "x", type: "number", shared: true, default: 5 },
    { name: "y", type: "number", shared: true, default: 5 },
    { name: "count", type: "number", shared: true, default: 0 },
  ] }),
  scenes: [{
    id: "s", type: "scene", name: "S",
    blocks: [
      { id: "loop", type: "block", name: "Loop", children: [
        { id: "g", type: "group", selector: "sequence", options: { order: "specificity", exhaust: "once" }, children: [
          { id: "a", type: "snippet", condition: "@x == 5 and @y == 5", beats: [{ id: "BA", kind: "line" }], jump: { to: "tick" } }, // score 2
          { id: "b", type: "snippet", condition: "@x == 5", beats: [{ id: "BB", kind: "line" }], jump: { to: "tick" } },              // score 1
          { id: "f", type: "snippet", beats: [{ id: "BF", kind: "line" }], jump: { to: "tick" } },                                    // filler
        ] },
      ] },
      { id: "tick", type: "block", name: "Tick", children: [
        { id: "stop", type: "snippet", condition: "@count >= 2", jump: { to: "END" } },
        { id: "go", type: "snippet", onEnter: [{ kind: "set", target: "@count", value: "@count + 1" }], jump: { to: "loop" } },
      ] },
    ],
  }],
  locales: [loc("s", { BA: "most specific", BB: "less specific", BF: "filler" })],
  expectedTranscript: [
    { type: "line", id: "BA", text: "most specific" },  // score 2
    { type: "line", id: "BB", text: "less specific" },  // A used -> score 1
    { type: "line", id: "BF", text: "filler" },         // A, B used -> filler
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// --- set effects fire (set-only; spec §15) at snippet seams ------------------
// The mutation order is observed through interpolation: L1 reads @gold BEFORE sn1's
// onExit set, L2 reads it AFTER. (Emit was removed - emission rides on gameData now.)
const effectsSet = {
  name: "set effects fire at snippet seams",
  project: project({ properties: [{ name: "gold", type: "number", shared: true, default: 5 }] }),
  scenes: [{
    id: "s", type: "scene", name: "S",
    blocks: [
      { id: "b1", type: "block", name: "B1", children: [
        { id: "sn1", type: "snippet",
          beats: [{ id: "L1", kind: "line", character: "NPC" }],
          onExit: [{ kind: "set", target: "@gold", value: "@gold + 10" }],
          jump: { to: "b2" } },
      ] },
      { id: "b2", type: "block", name: "B2", children: [
        { id: "sn2", type: "snippet", beats: [{ id: "L2", kind: "line", character: "NPC" }], jump: { to: "END" } },
      ] },
    ],
  }],
  locales: [loc("s", { L1: "gold is {@gold}", L2: "now {@gold}" })],
  expectedTranscript: [
    { type: "line", id: "L1", text: "gold is 5", character: "NPC" },
    { type: "line", id: "L2", text: "now 15", character: "NPC" },
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// --- a game-event beat delivers its gameData (no localised content) ----------
const gameEventBeat = {
  name: "game-event beat delivers its gameData",
  project: project(),
  scenes: [{
    id: "s", type: "scene", name: "S",
    blocks: [{ id: "b", type: "block", name: "B", children: [
      { id: "sn", type: "snippet", beats: [
        { id: "A", kind: "gameEvent", gameData: { cmd: "shake", intensity: 3 } },
      ], jump: { to: "END" } },
    ] }],
  }],
  expectedTranscript: [
    { type: "gameEvent", id: "A", gameData: { cmd: "shake", intensity: 3 } },
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// --- a jump to another scene resets scene-local props ---------------------
const crossScene = {
  name: "cross-scene jump resets scene-local props",
  project: project(),
  scenes: [
    { id: "s1", type: "scene", name: "S1",
      sceneProps: [{ name: "mood", type: "string", default: "calm", shared: false }],
      blocks: [{ id: "b1", type: "block", name: "B1", children: [
        { id: "sn1", type: "snippet", beats: [{ id: "T1", kind: "text" }], jump: { to: "s2" } },
      ] }] },
    { id: "s2", type: "scene", name: "S2",
      sceneProps: [{ name: "mood", type: "string", default: "tense", shared: false }],
      blocks: [{ id: "b2", type: "block", name: "B2", children: [
        { id: "sn2", type: "snippet", beats: [{ id: "T2", kind: "text" }], jump: { to: "END" } },
      ] }] },
  ],
  locales: [loc("s1", { T1: "a {@scene.mood} room" }), loc("s2", { T2: "a {@scene.mood} room" })],
  start: { scene: "s1" },
  expectedTranscript: [
    { type: "text", id: "T1", text: "a calm room" },
    { type: "text", id: "T2", text: "a tense room" },
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// --- sequence (sequential, repeat) wraps past its last child (a, b, a) -------
const cycle = {
  name: "sequence (repeat) wraps (a, b, a)",
  project: project({ properties: [{ name: "count", type: "number", shared: true, default: 0 }] }),
  scenes: [{
    id: "s", type: "scene", name: "S",
    blocks: [
      { id: "loop", type: "block", name: "Loop", children: [
        { id: "cyc", type: "group", selector: "sequence", options: { order: "sequential", exhaust: "repeat" }, children: [
          { id: "ca", type: "snippet", beats: [{ id: "La", kind: "line" }], jump: { to: "tick" } },
          { id: "cb", type: "snippet", beats: [{ id: "Lb", kind: "line" }], jump: { to: "tick" } },
        ] },
      ] },
      { id: "tick", type: "block", name: "Tick", children: [
        { id: "stop", type: "snippet", condition: "@count >= 2", jump: { to: "END" } },
        { id: "go", type: "snippet", onEnter: [{ kind: "set", target: "@count", value: "@count + 1" }], jump: { to: "loop" } },
      ] },
    ],
  }],
  locales: [loc("s", { La: "a", Lb: "b" })],
  expectedTranscript: [
    { type: "line", id: "La", text: "a" },
    { type: "line", id: "Lb", text: "b" },
    { type: "line", id: "La", text: "a" },
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// --- sequence (sequential, once) takes each child once, then the flow ends ---
const once = {
  name: "sequence (once) takes each child once then ends",
  project: project(),
  scenes: [{
    id: "s", type: "scene", name: "S",
    blocks: [{ id: "loop", type: "block", name: "Loop", children: [
      { id: "onc", type: "group", selector: "sequence", options: { order: "sequential", exhaust: "once" }, children: [
        { id: "oa", type: "snippet", beats: [{ id: "Oa", kind: "line" }], jump: { to: "loop" } },
        { id: "ob", type: "snippet", beats: [{ id: "Ob", kind: "line" }], jump: { to: "loop" } },
      ] },
    ] }],
  }],
  locales: [loc("s", { Oa: "first", Ob: "second" })],
  expectedTranscript: [
    { type: "line", id: "Oa", text: "first" },
    { type: "line", id: "Ob", text: "second" },
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// --- voiced project: lines are static, text beats still interpolate ---------
const voiced = {
  name: "voiced project: line stays static, text still interpolates",
  project: project({ voiced: true, properties: [{ name: "name", type: "string", shared: true, default: "Ada" }] }),
  scenes: [{
    id: "s", type: "scene", name: "S",
    blocks: [{ id: "b", type: "block", name: "B", children: [
      { id: "sn", type: "snippet", beats: [
        { id: "L", kind: "line", character: "NPC" },
        { id: "T", kind: "text" },
      ], jump: { to: "END" } },
    ] }],
  }],
  locales: [loc("s", { L: "Hi {@name}", T: "{@name} writes" })],
  expectedTranscript: [
    { type: "line", id: "L", text: "Hi {@name}", character: "NPC" },
    { type: "text", id: "T", text: "Ada writes" },
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// --- escaped braces: {{ }} -> { }, {{@x}} literal, {@x} interpolates ---------
const escaped = {
  name: "escaped braces unescape; {{@x}} stays literal",
  project: project({ properties: [{ name: "name", type: "string", shared: true, default: "Ada" }] }),
  scenes: [{
    id: "s", type: "scene", name: "S",
    blocks: [{ id: "b", type: "block", name: "B", children: [
      { id: "sn", type: "snippet", beats: [{ id: "T", kind: "text" }], jump: { to: "END" } },
    ] }],
  }],
  locales: [loc("s", { T: "use {{braces}} and {{@name}} but {@name}" })],
  expectedTranscript: [
    { type: "text", id: "T", text: "use {braces} and {@name} but Ada" },
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// --- a block plays its children in order (sequential / gather) --------------
const sequentialBlock = {
  name: "sequential block plays its children in order",
  project: project(),
  scenes: [{ id: "s", type: "scene", name: "S", blocks: [
    { id: "b", type: "block", name: "B", children: [
      { id: "a", type: "snippet", beats: [{ id: "A", kind: "line", character: "NPC" }] },
      { id: "b2", type: "snippet", beats: [{ id: "B2", kind: "line", character: "NPC" }] },
      { id: "c", type: "snippet", beats: [{ id: "C", kind: "line", character: "NPC" }] },
    ] },
  ] }],
  locales: [loc("s", { A: "one", B2: "two", C: "three" })],
  expectedTranscript: [
    { type: "line", id: "A", text: "one", character: "NPC" },
    { type: "line", id: "B2", text: "two", character: "NPC" },
    { type: "line", id: "C", text: "three", character: "NPC" },
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// --- call-return jump: tunnel out, resume at the next child ----------------
const callReturn = {
  name: "call jump tunnels out and returns to the next child",
  project: project(),
  scenes: [{ id: "s", type: "scene", name: "S", blocks: [
    { id: "main", type: "block", name: "Main", children: [
      { id: "m1", type: "snippet", beats: [{ id: "M1", kind: "line", character: "NPC" }], jump: { to: "sub", mode: "call" } },
      { id: "m2", type: "snippet", beats: [{ id: "M2", kind: "line", character: "NPC" }] },
    ] },
    { id: "sub", type: "block", name: "Sub", children: [
      { id: "x", type: "snippet", beats: [{ id: "X", kind: "line", character: "NPC" }] },
    ] },
  ] }],
  locales: [loc("s", { M1: "before", X: "tunnel", M2: "after" })],
  expectedTranscript: [
    { type: "line", id: "M1", text: "before", character: "NPC" },
    { type: "line", id: "X", text: "tunnel", character: "NPC" },
    { type: "line", id: "M2", text: "after", character: "NPC" },
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// --- a default group is a RUN: plays children in order, then gathers --------
const runGroup = {
  name: "default run-group plays children in order, then gathers",
  project: project(),
  scenes: [{ id: "s", type: "scene", name: "S", blocks: [
    { id: "b", type: "block", name: "B", children: [
      { id: "g", type: "group", children: [ // omitted selector -> run
        { id: "g1", type: "snippet", beats: [{ id: "G1", kind: "line", character: "NPC" }] },
        { id: "g2", type: "snippet", beats: [{ id: "G2", kind: "line", character: "NPC" }] },
      ] },
      { id: "after", type: "snippet", beats: [{ id: "AF", kind: "line", character: "NPC" }] },
    ] },
  ] }],
  locales: [loc("s", { G1: "one", G2: "two", AF: "three" })],
  expectedTranscript: [
    { type: "line", id: "G1", text: "one", character: "NPC" },
    { type: "line", id: "G2", text: "two", character: "NPC" },
    { type: "line", id: "AF", text: "three", character: "NPC" },
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// --- visits() gates first-vs-return content across a loop (spec §7) ---------
const visitGate = {
  name: "visits() gates first-vs-return content across a loop",
  project: project(),
  scenes: [{ id: "s", type: "scene", name: "S", blocks: [
    { id: "room", type: "block", name: "Room", children: [
      { id: "first", type: "snippet", condition: "visits('room') == 1", beats: [{ id: "F", kind: "text" }], jump: { to: "gate" } },
      { id: "again", type: "snippet", condition: "visits('room') > 1", beats: [{ id: "A", kind: "text" }], jump: { to: "gate" } },
    ] },
    { id: "gate", type: "block", name: "Gate", children: [
      { id: "stop", type: "snippet", condition: "visits('room') >= 3", jump: { to: "END" } },
      { id: "go", type: "snippet", jump: { to: "room" } },
    ] },
  ] }],
  locales: [loc("s", { F: "first time here", A: "back again" })],
  expectedTranscript: [
    { type: "text", id: "F", text: "first time here" },
    { type: "text", id: "A", text: "back again" },
    { type: "text", id: "A", text: "back again" },
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// --- shared @scene prop: set, interpolate, persist across re-entry -----------
// Single-flow here, so a shared @scene prop behaves like a per-flow one; the case
// pins that a port wires a `shared:true` scene prop end-to-end: an effect writes
// it, a text beat interpolates it, and it persists across the loop. (Cross-flow
// sharing isn't expressible in the single-flow harness.)
const sharedScene = {
  name: "shared @scene prop: write, interpolate, persist across re-entry",
  project: project(),
  scenes: [{ id: "s", type: "scene", name: "S",
    sceneProps: [{ name: "tally", type: "number", default: 0, shared: true }],
    blocks: [
      { id: "room", type: "block", name: "Room", children: [
        { id: "bump", type: "snippet",
          onEnter: [{ kind: "set", target: "@scene.tally", value: "@scene.tally + 1" }],
          beats: [{ id: "T", kind: "text" }], jump: { to: "gate" } },
      ] },
      { id: "gate", type: "block", name: "Gate", children: [
        { id: "stop", type: "snippet", condition: "@scene.tally >= 2", jump: { to: "END" } },
        { id: "go", type: "snippet", jump: { to: "room" } },
      ] },
    ] }],
  locales: [loc("s", { T: "tally={@scene.tally}" })],
  expectedTranscript: [
    { type: "text", id: "T", text: "tally=1" },
    { type: "text", id: "T", text: "tally=2" },
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// --- temporary scene prop: reseeds on re-entry while a normal one persists ---
const temporaryProp = {
  name: "temporary scene prop reseeds on re-entry; normal one persists",
  project: project(),
  scenes: [
    { id: "s1", type: "scene", name: "S1",
      sceneProps: [
        { name: "persist", type: "number", default: 0 },
        { name: "temp", type: "number", default: 0, temporary: true },
      ],
      blocks: [
        { id: "b1", type: "block", name: "B1", children: [
          { id: "bump", type: "snippet",
            onEnter: [
              { kind: "set", target: "@scene.persist", value: "@scene.persist + 1" },
              { kind: "set", target: "@scene.temp", value: "@scene.temp + 1" },
            ],
            beats: [{ id: "T", kind: "text" }], jump: { to: "gate" } },
        ] },
        { id: "gate", type: "block", name: "Gate", children: [
          { id: "again", type: "snippet", condition: "visits('s1') < 2", jump: { to: "s2" } },
          { id: "done", type: "snippet", jump: { to: "END" } },
        ] },
      ] },
    { id: "s2", type: "scene", name: "S2",
      blocks: [{ id: "b2", type: "block", name: "B2", children: [
        { id: "back", type: "snippet", jump: { to: "s1" } },
      ] }] },
  ],
  locales: [loc("s1", { T: "persist={@scene.persist} temp={@scene.temp}" })],
  expectedTranscript: [
    { type: "text", id: "T", text: "persist=1 temp=1" },
    { type: "text", id: "T", text: "persist=2 temp=1" },
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// --- branch: the universal conditional branch (if / elseif / else) ------
const branchPicks = {
  name: "branch picks the first passing branch",
  project: project({ properties: [{ name: "hp", type: "number", shared: true, default: 7 }] }),
  scenes: [{ id: "s", type: "scene", name: "S", blocks: [
    { id: "b", type: "block", name: "B", children: [
      { id: "g", type: "group", selector: "branch", children: [
        { id: "hi", type: "snippet", condition: "@hp > 10", beats: [{ id: "T_hi", kind: "text" }], jump: { to: "END" } },
        { id: "mid", type: "snippet", condition: "@hp > 5", beats: [{ id: "T_mid", kind: "text" }], jump: { to: "END" } },
        { id: "low", type: "snippet", beats: [{ id: "T_low", kind: "text" }], jump: { to: "END" } },
      ] },
    ] },
  ] }],
  locales: [loc("s", { T_hi: "high", T_mid: "mid", T_low: "low" })],
  expectedTranscript: [
    { type: "text", id: "T_mid", text: "mid" },
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// --- shuffle draws a bag without replacement, never back-to-back (seeded) -----
const shuffleNonRepeating = {
  name: "shuffle draws without replacement and never repeats back-to-back",
  project: project(),
  seed: 11,
  scenes: [{ id: "s", type: "scene", name: "S", blocks: [
    { id: "loop", type: "block", name: "Loop", children: [
      { id: "g", type: "group", selector: "sequence", options: { order: "shuffle", exhaust: "repeat" }, children: [
        { id: "a", type: "snippet", beats: [{ id: "O0", kind: "text" }] },
        { id: "b2", type: "snippet", beats: [{ id: "O1", kind: "text" }] },
        { id: "c", type: "snippet", beats: [{ id: "O2", kind: "text" }] },
      ] },
      { id: "gate", type: "snippet", condition: "visits('loop') < 5", jump: { to: "loop" } },
      { id: "done", type: "snippet", jump: { to: "END" } },
    ] },
  ] }],
  locales: [loc("s", { O0: "alpha", O1: "beta", O2: "gamma" })],
  // Computed from the contractual mulberry32 (seed 11) + the bag algorithm: a
  // full pass draws all three without replacement, then a reshuffle whose first
  // pick avoids the previous one. No two consecutive picks are equal.
  expectedTranscript: [
    { type: "text", id: "O1", text: "beta" },   // pass 1: b2
    { type: "text", id: "O2", text: "gamma" },  // pass 1: c
    { type: "text", id: "O0", text: "alpha" },  // pass 1: a (bag empty)
    { type: "text", id: "O2", text: "gamma" },  // pass 2 reshuffle: not a
    { type: "text", id: "O1", text: "beta" },   // pass 2: b2
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// --- seen() gates first-vs-return content ------------------------------------
const seenGate = {
  name: "seen() flips after the node has been entered",
  project: project(),
  scenes: [{ id: "s", type: "scene", name: "S", blocks: [
    { id: "main", type: "block", name: "Main", children: [
      { id: "g1", type: "snippet", condition: "seen('sub')", beats: [{ id: "T_yes", kind: "text" }], jump: { to: "END" } },
      { id: "g2", type: "snippet", beats: [{ id: "T_no", kind: "text" }], jump: { to: "sub" } },
    ] },
    { id: "sub", type: "block", name: "Sub", children: [
      { id: "x", type: "snippet", beats: [{ id: "T_sub", kind: "text" }], jump: { to: "main" } },
    ] },
  ] }],
  locales: [loc("s", { T_yes: "been there", T_no: "not yet", T_sub: "in sub" })],
  expectedTranscript: [
    { type: "text", id: "T_no", text: "not yet" },
    { type: "text", id: "T_sub", text: "in sub" },
    { type: "text", id: "T_yes", text: "been there" },
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// --- a jump inside a call abandons the pending return -------------------------
const jumpAbandonsReturn = {
  name: "jump is absolute: it discards a pending call-return",
  project: project(),
  scenes: [{ id: "s", type: "scene", name: "S", blocks: [
    { id: "main", type: "block", name: "Main", children: [
      { id: "m1", type: "snippet", beats: [{ id: "M1", kind: "text" }], jump: { to: "sub", mode: "call" } },
      { id: "m2", type: "snippet", beats: [{ id: "M2", kind: "text" }], jump: { to: "END" } },
    ] },
    { id: "sub", type: "block", name: "Sub", children: [
      { id: "x", type: "snippet", beats: [{ id: "X", kind: "text" }], jump: { to: "out" } },
    ] },
    { id: "out", type: "block", name: "Out", children: [
      { id: "o", type: "snippet", beats: [{ id: "O", kind: "text" }], jump: { to: "END" } },
    ] },
  ] }],
  locales: [loc("s", { M1: "before", M2: "NEVER", X: "tunnel", O: "out" })],
  expectedTranscript: [
    { type: "text", id: "M1", text: "before" },
    { type: "text", id: "X", text: "tunnel" },
    { type: "text", id: "O", text: "out" },
    { type: "end" }, // m2's "NEVER" must not play - the jump cleared the return
  ],
} satisfies RuntimeFixture;

// --- secretUntilEligible removes an option; default keeps it greyed -----------
const hiddenOption = {
  name: "secretUntilEligible hides; default shows ineligible greyed",
  project: project({ properties: [{ name: "ok", type: "boolean", shared: true, default: false }] }),
  scenes: [{ id: "s", type: "scene", name: "S", blocks: [
    { id: "b", type: "block", name: "B", children: [
      { id: "g", type: "group", selector: "choice", children: [
        { id: "go", type: "group", prompt: { id: "C_go", kind: "text" }, children: [{ id: "go_c", type: "snippet", jump: { to: "END" } }] },
        { id: "hidden", type: "group", condition: "@ok", secretUntilEligible: true, prompt: { id: "C_hidden", kind: "text" }, children: [{ id: "hidden_c", type: "snippet", jump: { to: "END" } }] },
        { id: "greyed", type: "group", condition: "@ok", prompt: { id: "C_greyed", kind: "text" }, children: [{ id: "greyed_c", type: "snippet", jump: { to: "END" } }] },
      ] },
    ] },
  ] }],
  locales: [loc("s", { C_go: "Go", C_hidden: "Secret", C_greyed: "Locked" })],
  choices: ["go"],
  expectedTranscript: [
    { type: "choice", options: [
      { id: "go", text: "Go", eligible: true },
      { id: "greyed", text: "Locked", eligible: false }, // "hidden" is absent entirely
    ] },
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// ---------------------------------------------------------------------------
// SCRIPTED cases - the harness for what one play-to-completion can't express:
// save/load round-trips, multiple flows over shared state, engine reset.
// These hold ports to the save and multi-flow contracts (Plan §8).
// ---------------------------------------------------------------------------

// Shared shape: each flow's entry bumps the shared @bell, the SHARED scene
// tally, and its own per-flow scene counter, then speaks all three.
const sharedStateScenes: Scene[] = [{
  id: "s", type: "scene", name: "S",
  sceneProps: [
    { name: "mine", type: "number", default: 0 },
    { name: "tally", type: "number", default: 0, shared: true },
  ],
  blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "sn", type: "snippet",
      onEnter: [
        { kind: "set", target: "@bell", value: "@bell + 1" },
        { kind: "set", target: "@scene.tally", value: "@scene.tally + 1" },
        { kind: "set", target: "@scene.mine", value: "@scene.mine + 1" },
      ],
      beats: [{ id: "T", kind: "text" }],
      jump: { to: "END" } },
  ] }],
}];
const sharedStateProject = project({ properties: [{ name: "bell", type: "number", shared: true, default: 0 }] });
const sharedStateLoc = [loc("s", { T: "b={@bell} t={@scene.tally} m={@scene.mine}" })];

const scriptedMultiFlow = {
  name: "flows share shared globals + shared scene props; per-flow state stays per-flow",
  project: sharedStateProject, scenes: sharedStateScenes, locales: sharedStateLoc,
  script: [
    { op: "openFlow", flow: "alice", scene: "s" },
    { op: "advance", expect: [{ type: "text", id: "T", text: "b=1 t=1 m=1" }] },
    { op: "openFlow", flow: "bob", scene: "s" },
    { op: "advance", expect: [{ type: "text", id: "T", text: "b=2 t=2 m=1" }] }, // shared moved, per-flow fresh
  ],
} satisfies ScriptedFixture;

const scriptedReset = {
  name: "engine reset re-seeds every kind of shared state",
  project: sharedStateProject, scenes: sharedStateScenes, locales: sharedStateLoc,
  script: [
    { op: "openFlow", flow: "a", scene: "s" },
    { op: "advance", expect: [{ type: "text", id: "T", text: "b=1 t=1 m=1" }] },
    { op: "reset" },
    { op: "openFlow", flow: "b", scene: "s" },
    { op: "advance", expect: [{ type: "text", id: "T", text: "b=1 t=1 m=1" }] }, // world born again
  ],
} satisfies ScriptedFixture;

const scriptedSaveLoad = {
  name: "save/load mid-flow preserves the cursor, selector memory, and scene props",
  project: project(),
  scenes: [{
    id: "s", type: "scene", name: "S",
    sceneProps: [{ name: "laps", type: "number", default: 0 }],
    blocks: [{ id: "loop", type: "block", name: "Loop", children: [
      { id: "seq", type: "group", selector: "sequence", children: [
        { id: "one", type: "snippet", beats: [{ id: "T1", kind: "text" }] },
        { id: "two", type: "snippet", beats: [{ id: "T2", kind: "text" }] },
      ] },
      { id: "gate", type: "snippet", condition: "visits('loop') < 2",
        onEnter: [{ kind: "set", target: "@scene.laps", value: "@scene.laps + 1" }],
        jump: { to: "loop" } },
      { id: "done", type: "snippet", beats: [{ id: "TD", kind: "text" }], jump: { to: "END" } },
    ] }],
  }],
  locales: [loc("s", { T1: "first", T2: "second", TD: "laps={@scene.laps}" })],
  script: [
    { op: "openFlow", flow: "main", scene: "s" },
    { op: "advance", expect: [{ type: "text", id: "T1", text: "first" }] },
    { op: "saveLoad" }, // serialise everything, fresh engine, restore
    { op: "advance", expect: [{ type: "text", id: "T2", text: "second" }] }, // sequence cursor survived
    { op: "advance", expect: [{ type: "text", id: "TD", text: "laps=1" }] }, // scene prop + visit count survived
    { op: "advance", expect: [{ type: "end" }] },
  ],
} satisfies ScriptedFixture;

const scriptedSaveLoadChoice = {
  name: "save/load at a pending choice replays the option set",
  project: project(),
  scenes: [{ id: "s", type: "scene", name: "S", blocks: [
    { id: "b", type: "block", name: "B", children: [
      { id: "g", type: "group", selector: "choice", children: [
        { id: "left", type: "group", prompt: { id: "C_l", kind: "text" }, children: [{ id: "left_c", type: "snippet", jump: { to: "END" } }] },
        { id: "right", type: "group", prompt: { id: "C_r", kind: "text" }, children: [{ id: "right_c", type: "snippet", beats: [{ id: "TR", kind: "text" }], jump: { to: "END" } }] },
      ] },
    ] },
  ] }],
  locales: [loc("s", { C_l: "Left", C_r: "Right", TR: "went right" })],
  script: [
    { op: "openFlow", flow: "main", scene: "s" },
    { op: "advance", expect: [{ type: "choice", options: [
      { id: "left", text: "Left", eligible: true },
      { id: "right", text: "Right", eligible: true },
    ] }] },
    { op: "saveLoad" },
    { op: "choose", id: "right" }, // the REPLAYED choice is fully usable
    { op: "advance", expect: [{ type: "text", id: "TR", text: "went right" }] },
    { op: "advance", expect: [{ type: "end" }] },
  ],
} satisfies ScriptedFixture;

// Live language switch (Engine.setLocale): the active string table re-points WITHOUT a rebuild, so the
// flow keeps its cursor and only subsequent beats re-render. Also proves the locale-aware character name
// follows the swap, and that a locale with no table degrades to the source via the <Untranslated> flag.
const scriptedSetLocale = {
  name: "live setLocale swaps the language mid-flow; the cursor + state are untouched",
  project: project({ locales: { default: "en", all: ["en", "fr"] }, cast: [{ name: "GUIDE" }] }),
  scenes: [{
    id: "s", type: "scene", name: "S",
    blocks: [{ id: "b", type: "block", name: "B", children: [
      { id: "n", type: "snippet", beats: [
        { id: "L", kind: "line", character: "GUIDE" },
        { id: "T1", kind: "text" },
        { id: "T2", kind: "text" },
      ], jump: { to: "END" } },
    ] }],
  }],
  locales: [
    loc("s", { L: "Welcome.", T1: "First.", T2: "Second.", "cast:GUIDE": "Guide" }, "en"),
    loc("s", { L: "Bienvenue.", T1: "Premier.", T2: "Deuxième.", "cast:GUIDE": "Guide" }, "fr"),
  ],
  script: [
    { op: "openFlow", flow: "main", scene: "s" },
    { op: "advance", expect: [{ type: "line", id: "L", text: "Welcome.", character: "GUIDE", characterName: "Guide" }] },
    { op: "setLocale", locale: "fr" },
    { op: "advance", expect: [{ type: "text", id: "T1", text: "Premier." }] },  // SAME flow continued, now in fr
    { op: "setLocale", locale: "de" },                                          // no table -> source fallback, flagged
    { op: "advance", expect: [{ type: "text", id: "T2", text: "<Untranslated: T2> Second." }] },
    { op: "advance", expect: [{ type: "end" }] },
  ],
} satisfies ScriptedFixture;

// Closed captions (#214): with captions OFF, a DIALOGUE line's caption cues (between the bundle's
// delimiters) + the surrounding whitespace are stripped; narration (text) and everything else are
// untouched. The toggle is live (setClosedCaptions) and not save state. Proves both directions, the
// line-vs-narration distinction, a line-kind choice prompt, and the baked custom-default delimiter pair.
const scriptedClosedCaptions = {
  name: "closed captions off strips dialogue-line cues (not narration); live toggle, no state change",
  project: project({ closedCaptions: { open: "(", close: ")" }, cast: [{ name: "NPC" }, { name: "SFX" }] }),
  scenes: [{
    id: "s", type: "scene", name: "S",
    blocks: [{ id: "b", type: "block", name: "B", children: [
      { id: "n1", type: "snippet", beats: [
        { id: "L1", kind: "line" },
        { id: "T1", kind: "text" },
        { id: "L2", kind: "line" },
      ] },
      { id: "g", type: "group", selector: "choice", children: [
        { id: "opt", type: "group", prompt: { id: "P1", kind: "line" }, children: [
          { id: "o", type: "snippet", beats: [{ id: "L3", kind: "line" }] },
        ] },
      ] },
      { id: "after", type: "snippet", beats: [{ id: "L5", kind: "line", character: "NPC" }, { id: "L6", kind: "line", character: "SFX" }, { id: "L4", kind: "line" }], jump: { to: "END" } },
    ] }],
  }],
  locales: [loc("s", {
    L1: "Oh dear. (sigh) What now?",
    T1: "A door slams. (off-screen)",
    L2: "Wait. (pause) Listen.",
    P1: "Hello? (timid)",
    L3: "Coming. (footsteps)",
    L5: "(gasps)",
    L6: "Thunder rumbles in the distance.",
    L4: "Done. (smiles)",
  })],
  script: [
    { op: "openFlow", flow: "main", scene: "s" },
    { op: "advance", expect: [{ type: "line", id: "L1", text: "Oh dear. (sigh) What now?" }] }, // captions on -> full
    { op: "setClosedCaptions", on: false },
    { op: "advance", expect: [{ type: "text", id: "T1", text: "A door slams. (off-screen)" }] }, // narration kept
    { op: "advance", expect: [{ type: "line", id: "L2", text: "Wait. Listen." }] },              // dialogue stripped
    { op: "advance", expect: [{ type: "choice", options: [{ id: "opt", text: "Hello?", eligible: true }] }] }, // line prompt stripped
    { op: "choose", id: "opt" },
    { op: "advance", expect: [{ type: "line", id: "L3", text: "Coming." }] },                    // still off
    { op: "advance", expect: [{ type: "line", id: "L5", text: "" }] },                           // whole line was a cue -> SILENT (fires, no text, no speaker)
    { op: "advance", expect: [{ type: "line", id: "L6", text: "" }] },                           // caption CHARACTER (SFX) -> SILENT even with no delimiters
    { op: "setClosedCaptions", on: true },
    { op: "advance", expect: [{ type: "line", id: "L4", text: "Done. (smiles)" }] },             // restored -> full
    { op: "advance", expect: [{ type: "end" }] },
  ],
} satisfies ScriptedFixture;

// A choice OPTION is an Option group: its children are the option's content run,
// played then GATHERED BACK when chosen (spec §5). `leave` is the degenerate shape
// (an Option group wrapping one pure-jump snippet).
const scriptedOptionGroup = {
  name: "choosing an Option group plays its content run and gathers back",
  project: project(),
  scenes: [{ id: "s", type: "scene", name: "S", blocks: [
    { id: "b", type: "block", name: "B", children: [
      { id: "g", type: "group", selector: "choice", children: [
        { id: "talk", type: "group", prompt: { id: "C_talk", kind: "text" }, children: [
          { id: "t1", type: "snippet", beats: [{ id: "T1", kind: "text" }] },
          { id: "t2", type: "snippet", beats: [{ id: "T2", kind: "text" }] },
        ] },
        { id: "leave", type: "group", prompt: { id: "C_leave", kind: "text" }, children: [
          { id: "lv", type: "snippet", jump: { to: "END" } },
        ] },
      ] },
      { id: "after", type: "snippet", beats: [{ id: "TA", kind: "text" }], jump: { to: "END" } },
    ] },
  ] }],
  locales: [loc("s", { C_talk: "Talk", C_leave: "Leave", T1: "hello", T2: "there", TA: "gathered" })],
  script: [
    { op: "openFlow", flow: "main", scene: "s" },
    { op: "advance", expect: [{ type: "choice", options: [
      { id: "talk", text: "Talk", eligible: true },
      { id: "leave", text: "Leave", eligible: true },
    ] }] },
    { op: "choose", id: "talk" },
    { op: "advance", expect: [{ type: "text", id: "T1", text: "hello" }] },
    { op: "advance", expect: [{ type: "text", id: "T2", text: "there" }] },
    { op: "advance", expect: [{ type: "text", id: "TA", text: "gathered" }] }, // gathered back past the choice
    { op: "advance", expect: [{ type: "end" }] },
  ],
} satisfies ScriptedFixture;

// Sticky / once-only options (spec §5, Ink `*` / `+`). The hub choice is re-entered each loop:
// the once-only `once` is GONE after one use (absent from getChoices, not flagged); the sticky
// `keep` / `leave` persist. (Two sticky options keep the choice from running dry.)
const scriptedStickyOnce = {
  name: "once-only option is consumed; sticky options persist across re-entry",
  project: project(),
  scenes: [{ id: "s", type: "scene", name: "S", blocks: [
    { id: "hub", type: "block", name: "Hub", children: [
      { id: "g", type: "group", selector: "choice", children: [
        { id: "once", type: "group", prompt: { id: "C_once", kind: "text" }, children: [
          { id: "once_c", type: "snippet", beats: [{ id: "T_once", kind: "text" }], jump: { to: "hub" } } ] },
        { id: "keep", type: "group", sticky: true, prompt: { id: "C_keep", kind: "text" }, children: [
          { id: "keep_c", type: "snippet", beats: [{ id: "T_keep", kind: "text" }], jump: { to: "hub" } } ] },
        { id: "leave", type: "group", sticky: true, prompt: { id: "C_leave", kind: "text" }, children: [
          { id: "leave_c", type: "snippet", jump: { to: "END" } } ] },
      ] },
    ] },
  ] }],
  locales: [loc("s", { C_once: "Once", C_keep: "Keep", C_leave: "Leave", T_once: "played once", T_keep: "played keep" })],
  script: [
    { op: "openFlow", flow: "main", scene: "s" },
    { op: "advance", expect: [{ type: "choice", options: [
      { id: "once", text: "Once", eligible: true },
      { id: "keep", text: "Keep", eligible: true },
      { id: "leave", text: "Leave", eligible: true },
    ] }] },
    { op: "choose", id: "once" },
    { op: "advance", expect: [{ type: "text", id: "T_once", text: "played once" }] },
    { op: "advance", expect: [{ type: "choice", options: [
      { id: "keep", text: "Keep", eligible: true },   // 'once' is consumed - absent entirely
      { id: "leave", text: "Leave", eligible: true },
    ] }] },
    { op: "choose", id: "keep" },
    { op: "advance", expect: [{ type: "text", id: "T_keep", text: "played keep" }] },
    { op: "advance", expect: [{ type: "choice", options: [
      { id: "keep", text: "Keep", eligible: true },   // sticky: still here after being followed
      { id: "leave", text: "Leave", eligible: true },
    ] }] },
    { op: "choose", id: "leave" },
    { op: "advance", expect: [{ type: "end" }] },
  ],
} satisfies ScriptedFixture;

// The fallback option is never delivered; once the real option is consumed it is the only one left,
// so it AUTO-FOLLOWS (no choice presented) - note the two consecutive advances with no choose between.
const scriptedFallback = {
  name: "fallback option auto-follows when it is the only one left",
  project: project(),
  scenes: [{ id: "s", type: "scene", name: "S", blocks: [
    { id: "hub", type: "block", name: "Hub", children: [
      { id: "g", type: "group", selector: "choice", children: [
        { id: "real", type: "group", prompt: { id: "C_real", kind: "text" }, children: [
          { id: "real_c", type: "snippet", beats: [{ id: "T_real", kind: "text" }], jump: { to: "hub" } } ] },
        { id: "fb", type: "group", fallback: true, prompt: { id: "C_fb", kind: "text" }, children: [
          { id: "fb_c", type: "snippet", beats: [{ id: "T_fb", kind: "text" }], jump: { to: "END" } } ] },
      ] },
    ] },
  ] }],
  locales: [loc("s", { C_real: "Real", C_fb: "Fallback", T_real: "did real", T_fb: "fallback fired" })],
  script: [
    { op: "openFlow", flow: "main", scene: "s" },
    { op: "advance", expect: [{ type: "choice", options: [
      { id: "real", text: "Real", eligible: true },   // the fallback is NOT in the option set
    ] }] },
    { op: "choose", id: "real" },
    { op: "advance", expect: [{ type: "text", id: "T_real", text: "did real" }] },
    // 'real' is now consumed; only the fallback remains -> it auto-follows, no choice is presented.
    { op: "advance", expect: [{ type: "text", id: "T_fb", text: "fallback fired" }] },
    { op: "advance", expect: [{ type: "end" }] },
  ],
} satisfies ScriptedFixture;

// ---------------------------------------------------------------------------
// LOCALE + character-name resolution, and EXTERNAL-locale playback - the
// localisation half of the runtime contract (spec §14 / §11).
// ---------------------------------------------------------------------------

// Default-locale play: a line's resolved characterName is the authoring displayName (no locale cast
// string); a character with no displayName carries no name.
const characterName = {
  name: "line carries the resolved character name (default locale -> authoring displayName)",
  project: project({ cast: [{ name: "ANNA", displayName: "Anna" }, { name: "BO" }] }),
  scenes: [{ id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "sn", type: "snippet", beats: [
      { id: "L_anna", kind: "line", character: "ANNA" },
      { id: "L_bo", kind: "line", character: "BO" },
    ], jump: { to: "END" } },
  ] }] }],
  locales: [loc("s", { L_anna: "Hi", L_bo: "Yo" })],
  expectedTranscript: [
    { type: "line", id: "L_anna", text: "Hi", character: "ANNA", characterName: "Anna" }, // displayName fallback
    { type: "line", id: "L_bo", text: "Yo", character: "BO" },                            // no displayName -> no name
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// Author tags (#215): each delivered beat carries the UNION of its own tags and every ancestor's
// (scene -> block -> group -> snippet -> beat), deduped, outermost-first. Beats with no tags anywhere up
// the chain carry none. The group also contributes (the second snippet sits inside `g`).
const tagsAccumulate = {
  name: "beats carry accumulated author tags (scene/block/group/snippet/beat union)",
  project: project(),
  scenes: [{
    id: "s", type: "scene", name: "S", tags: ["chapter1"],
    blocks: [{ id: "b", type: "block", name: "B", tags: ["hub"], children: [
      { id: "sn1", type: "snippet", tags: ["intro"], beats: [
        { id: "L1", kind: "text", tags: ["barked"] },         // chapter1, hub, intro, barked
        { id: "L2", kind: "text" },                            // chapter1, hub, intro
      ] },
      { id: "g", type: "group", tags: ["combat", "chapter1"], children: [ // dup chapter1 collapses
        { id: "sn2", type: "snippet", beats: [
          { id: "L3", kind: "text" },                          // chapter1, hub, combat
        ], jump: { to: "END" } },
      ] },
    ] }],
  }],
  locales: [loc("s", { L1: "Intro.", L2: "More.", L3: "Fight!" })],
  expectedTranscript: [
    { type: "text", id: "L1", text: "Intro.", tags: ["chapter1", "hub", "intro", "barked"] },
    { type: "text", id: "L2", text: "More.", tags: ["chapter1", "hub", "intro"] },
    { type: "text", id: "L3", text: "Fight!", tags: ["chapter1", "hub", "combat"] },
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// Active locale (fr): the line's text resolves to the fr string and the character name to the fr cast
// string (`@project` shard); a key the fr locale is MISSING falls back to the default (en).
const localeActive = {
  name: "active locale resolves strings + cast name; a missing key falls back to the default locale",
  project: project({
    cast: [{ name: "ANNA", displayName: "Anna" }],
    locales: { default: "en", all: ["en", "fr"] },
  }),
  scenes: [{ id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "sn", type: "snippet", beats: [
      { id: "L_anna", kind: "line", character: "ANNA" },
      { id: "T_fb", kind: "text" },
    ], jump: { to: "END" } },
  ] }] }],
  locales: [
    loc("s", { L_anna: "Hi", T_fb: "english fallback" }),            // en (default)
    loc("s", { L_anna: "Salut" }, "fr"),                            // fr: L_anna translated, T_fb absent
    loc("@project", { [castStringKey("ANNA")]: "Annette" }, "fr"),  // fr cast display name
  ],
  locale: "fr",
  expectedTranscript: [
    { type: "line", id: "L_anna", text: "Salut", character: "ANNA", characterName: "Annette" }, // fr string + fr name
    // fr is MISSING T_fb: fall back to the default-locale source, flagged loudly as untranslated.
    { type: "text", id: "T_fb", text: "<Untranslated: T_fb> english fallback" },
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// IDs-only build (spec §11): the .patterc ships NO strings, so the engine emits each beat's ID as its
// text and OMITS the character display name - the game localises it from its own loc system. The
// `character` token is still emitted (the game maps it). `{@ref}` interpolation is the game's job too
// (via flow.interpolate), so the runtime does not pre-render it.
const idsMode = {
  name: "IDs-only build emits beat IDs as text and omits the character name",
  project: project({ cast: [{ name: "ANNA", displayName: "Anna" }] }),
  scenes: [{ id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "sn", type: "snippet", beats: [
      { id: "L_anna", kind: "line", character: "ANNA" },
      { id: "T_room", kind: "text" },
    ], jump: { to: "END" } },
  ] }] }],
  locales: [loc("s", { L_anna: "Hi {@nope}", T_room: "A room." })], // strings are stripped by idsOnly
  idsOnly: true,
  expectedTranscript: [
    { type: "line", id: "L_anna", text: "L_anna", character: "ANNA" }, // text = id; NO characterName
    { type: "text", id: "T_room", text: "T_room" },
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// ---------------------------------------------------------------------------
// gameData merge-at-read - a node's sparse override resolved against its TYPE's
// declared field defaults (runtime effectiveGameData). Not a transcript; a host
// reads the full effective payload, and every port replicates this resolution.
// ---------------------------------------------------------------------------

const gameDataProject = project({ gameDataFields: {
  line: [
    { name: "mood", type: "enum", values: ["calm", "tense"], default: "calm" },
    { name: "vol", type: "number", default: 1 },
  ],
} });

const gameDataDefaults = {
  name: "gameData: unset fields fall back to their declared defaults",
  project: gameDataProject, kind: "line", node: { vol: 3 },
  expected: { mood: "calm", vol: 3 }, // mood unset -> default; vol overridden
} satisfies GameDataFixture;

const gameDataOrphan = {
  name: "gameData: override-only keys with no declared field are kept verbatim",
  project: gameDataProject, kind: "line", node: { vol: 3, extra: "x" },
  expected: { mood: "calm", vol: 3, extra: "x" },
} satisfies GameDataFixture;

const gameDataPureDefaults = {
  name: "gameData: a node with no overrides yields every default",
  project: gameDataProject, kind: "line",
  expected: { mood: "calm", vol: 1 },
} satisfies GameDataFixture;

// --- live bundle refresh: save/load ACROSS an edited bundle (§9.8) -----------
// `hotSwap` = serialise the whole game, fresh engine on the EDITED bundleB,
// restore. These pin the cross-bundle drift rules every port must share: the
// resume position re-found by the saved next-child id, a dissolved option
// dropped from the replayed set, vanished content skipped, best-effort always.

const scriptedHotSwapReword = {
  name: "hotSwap: a reworded line under the cursor plays the NEW text",
  project: project(),
  scenes: [{ id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "sn", type: "snippet", beats: [{ id: "T1", kind: "text" }, { id: "T2", kind: "text" }], jump: { to: "END" } },
  ] }] }],
  locales: [loc("s", { T1: "first", T2: "second" })],
  scenesB: [{ id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "sn", type: "snippet", beats: [{ id: "T1", kind: "text" }, { id: "T2", kind: "text" }], jump: { to: "END" } },
  ] }] }],
  localesB: [loc("s", { T1: "first", T2: "second, reworded" })],
  script: [
    { op: "openFlow", flow: "main", scene: "s" },
    { op: "advance", expect: [{ type: "text", id: "T1", text: "first" }] },
    { op: "hotSwap" }, // mid-snippet: the cursor (active snippet + beat index) carries over
    { op: "advance", expect: [{ type: "text", id: "T2", text: "second, reworded" }] },
    { op: "advance", expect: [{ type: "end" }] },
  ],
} satisfies ScriptedFixture;

const scriptedHotSwapInsert = {
  name: "hotSwap: a sibling inserted BEFORE the cursor neither replays nor shifts the resume point",
  project: project(),
  scenes: [{ id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "sn1", type: "snippet", beats: [{ id: "T1", kind: "text" }] },
    { id: "sn2", type: "snippet", beats: [{ id: "T2", kind: "text" }] },
  ] }] }],
  locales: [loc("s", { T1: "one", T2: "two", T0: "inserted opener" })],
  scenesB: [{ id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "sn0", type: "snippet", beats: [{ id: "T0", kind: "text" }] }, // inserted at the top
    { id: "sn1", type: "snippet", beats: [{ id: "T1", kind: "text" }] },
    { id: "sn2", type: "snippet", beats: [{ id: "T2", kind: "text" }] },
  ] }] }],
  script: [
    { op: "openFlow", flow: "main", scene: "s" },
    { op: "advance", expect: [{ type: "text", id: "T1", text: "one" }] },
    { op: "hotSwap" }, // the saved next-child id (sn2) re-finds its slot; the raw index would replay T1
    { op: "advance", expect: [{ type: "text", id: "T2", text: "two" }] },
    { op: "advance", expect: [{ type: "end" }] },
  ],
} satisfies ScriptedFixture;

const scriptedHotSwapDeleteActive = {
  name: "hotSwap: a deleted ACTIVE snippet is skipped; play continues at the next survivor",
  project: project(),
  scenes: [{ id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "sn1", type: "snippet", beats: [{ id: "T1a", kind: "text" }, { id: "T1b", kind: "text" }] },
    { id: "sn2", type: "snippet", beats: [{ id: "T2", kind: "text" }] },
  ] }] }],
  locales: [loc("s", { T1a: "cut a", T1b: "cut b", T2: "survivor" })],
  scenesB: [{ id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "sn2", type: "snippet", beats: [{ id: "T2", kind: "text" }] }, // sn1 deleted mid-delivery
  ] }] }],
  script: [
    { op: "openFlow", flow: "main", scene: "s" },
    { op: "advance", expect: [{ type: "text", id: "T1a", text: "cut a" }] }, // sn1 is mid-delivery
    { op: "hotSwap" }, // its remaining beat (T1b) vanishes with it - never delivered
    { op: "advance", expect: [{ type: "text", id: "T2", text: "survivor" }] },
    { op: "advance", expect: [{ type: "end" }] },
  ],
} satisfies ScriptedFixture;

const scriptedHotSwapDropOption = {
  name: "hotSwap: a deleted option drops from the REPLAYED pending choice; survivors stay choosable",
  project: project(),
  scenes: [{ id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "g", type: "group", selector: "choice", children: [
      { id: "left", type: "group", prompt: { id: "C_l", kind: "text" }, children: [{ id: "left_c", type: "snippet", beats: [{ id: "TL", kind: "text" }], jump: { to: "END" } }] },
      { id: "right", type: "group", prompt: { id: "C_r", kind: "text" }, children: [{ id: "right_c", type: "snippet", beats: [{ id: "TR", kind: "text" }], jump: { to: "END" } }] },
    ] },
  ] }] }],
  locales: [loc("s", { C_l: "Left", C_r: "Right", TL: "went left", TR: "went right" })],
  scenesB: [{ id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "g", type: "group", selector: "choice", children: [
      { id: "left", type: "group", prompt: { id: "C_l", kind: "text" }, children: [{ id: "left_c", type: "snippet", beats: [{ id: "TL", kind: "text" }], jump: { to: "END" } }] },
    ] },
  ] }] }],
  script: [
    { op: "openFlow", flow: "main", scene: "s" },
    { op: "advance", expect: [{ type: "choice", options: [
      { id: "left", text: "Left", eligible: true },
      { id: "right", text: "Right", eligible: true },
    ] }] },
    { op: "hotSwap" },
    { op: "advance", expect: [{ type: "choice", options: [
      { id: "left", text: "Left", eligible: true }, // `right` drifted out: dropped, never re-derived
    ] }] },
    { op: "choose", id: "left" },
    { op: "advance", expect: [{ type: "text", id: "TL", text: "went left" }] },
    { op: "advance", expect: [{ type: "end" }] },
  ],
} satisfies ScriptedFixture;

const scriptedHotSwapEmptiedBlock = {
  name: "hotSwap: the cursor's whole container emptied - the frame drops and the flow ends cleanly",
  project: project(),
  scenes: [{ id: "s", type: "scene", name: "S", blocks: [
    { id: "b1", type: "block", name: "B1", children: [
      { id: "sn1", type: "snippet", beats: [{ id: "T1", kind: "text" }], jump: { to: "b2" } },
    ] },
    { id: "b2", type: "block", name: "B2", children: [
      { id: "sn2", type: "snippet", beats: [{ id: "T2a", kind: "text" }, { id: "T2b", kind: "text" }] },
    ] },
  ] }],
  locales: [loc("s", { T1: "intro", T2a: "deep a", T2b: "deep b" })],
  scenesB: [{ id: "s", type: "scene", name: "S", blocks: [
    { id: "b1", type: "block", name: "B1", children: [
      { id: "sn1", type: "snippet", beats: [{ id: "T1", kind: "text" }], jump: { to: "b2" } },
    ] },
    { id: "b2", type: "block", name: "B2", children: [] }, // everything the cursor stood in, deleted
  ] }],
  script: [
    { op: "openFlow", flow: "main", scene: "s" },
    { op: "advance", expect: [{ type: "text", id: "T1", text: "intro" }] },
    { op: "advance", expect: [{ type: "text", id: "T2a", text: "deep a" }] }, // now inside b2
    { op: "hotSwap" }, // active snippet + every sibling gone: nothing left to run
    { op: "advance", expect: [{ type: "end" }] },
  ],
} satisfies ScriptedFixture;

export const cases: Fixtures = {
  expressions: [
    { name: "number comparison", src: "@hp > 5", scopes: { patter: { hp: 10 } }, expected: true },
    { name: "boolean and across scopes", src: "@hp >= 10 and @scene.locked == false",
      scopes: { patter: { hp: 10 }, scene: { locked: false } }, expected: true },
    { name: "string equality", src: '@mood == "calm"', scopes: { patter: { mood: "calm" } }, expected: true },
    { name: "arithmetic", src: "@gold + 5", scopes: { patter: { gold: 3 } }, expected: 8 },
    { name: "check_flags membership", src: "check_flags(@quests, +met, -done)",
      scopes: { patter: { quests: ["met"] } }, expected: true },
    { name: "set_flags returns a new array", src: "set_flags(@quests, +done)",
      scopes: { patter: { quests: ["met"] } }, expected: ["met", "done"] },
    { name: "not + or precedence", src: "not (@hp > 100 or @scene.locked)",
      scopes: { patter: { hp: 10 }, scene: { locked: false } }, expected: true },
    { name: "arithmetic precedence", src: "2 + 3 * 4", scopes: {}, expected: 14 },
    { name: "division yields a float", src: "@a / @b", scopes: { patter: { a: 10, b: 4 } }, expected: 2.5 },
    { name: "string concatenation", src: '@greet + "!"', scopes: { patter: { greet: "hi" } }, expected: "hi!" },
    // Pins the mulberry32 PRNG: seed 42's first draw -> random(1, 6) == 4.
    { name: "seeded random is deterministic", src: "random(1, 6)", scopes: {}, seed: 42, expected: 4 },
  ],
  runtime: [
    lineThenEnd, choicePick, interpolation, effectsSet, gameEventBeat,
    crossScene, cycle, once, voiced, escaped, shuffle, sequence,
    sequentialBlock, callReturn, runGroup, visitGate, sharedScene, temporaryProp,
    branchPicks, shuffleNonRepeating, seenGate, jumpAbandonsReturn, hiddenOption,
    characterName, localeActive, idsMode, tagsAccumulate,
    specAndSums, specFiller, specCheckFlags, specTie, specDegrades,
  ],
  scripted: [scriptedMultiFlow, scriptedReset, scriptedSaveLoad, scriptedSaveLoadChoice, scriptedSetLocale,
    scriptedClosedCaptions, scriptedOptionGroup, scriptedStickyOnce, scriptedFallback,
    scriptedHotSwapReword, scriptedHotSwapInsert, scriptedHotSwapDeleteActive, scriptedHotSwapDropOption,
    scriptedHotSwapEmptiedBlock],
  gameData: [gameDataDefaults, gameDataOrphan, gameDataPureDefaults],
};
