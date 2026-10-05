// ---------------------------------------------------------------------------
// The authored conformance fixtures. `expected` / `expectedTranscript` are the
// CONTRACT - written by hand, never derived from the engine, with ONE caveat:
// where a seeded PRNG is involved (shuffle / random), the expectation is
// computed from the contractual mulberry32 algorithm (runner.ts pins it), since
// hand-predicting draws is not meaningful. New runtime behaviour lands here
// first (Plan §8). `buildCorpus(cases)` compiles these into the portable
// corpus.json; the test asserts the reference engine reproduces every value.
// ---------------------------------------------------------------------------

import type { Fixtures, GameDataFixture, RuntimeFixture, SaveFixture, ScriptOp, ScriptedFixture } from "./types.js";
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
    { type: "choice", groupId: "g", options: [
      { id: "yes", prompt: { kind: "text", text: "Continue" }, eligible: true },
      { id: "locked", prompt: { kind: "text", text: "[locked]" }, eligible: false },
    ] },
    { type: "line", id: "L_done", text: "Done.", character: "NPC" },
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// --- a declared host scope with no resolver, self-backed from its defaults ---
// The declared name KEEPS its capital deliberately. Since 2026-08-18 the compiler refuses to emit
// this bundle (core's `invalid-declaration`: expressions fold references, so `isNight` could never
// be reached), so no author can produce one - but every runtime is still told to key its self-backed
// bag lower case, and this is the case that proves it did. Lower-casing the fixture would leave that
// instruction untested in three ports for the sake of tidiness.
// The parity contract for `@world` (and any host scope a project declares). A runtime that ignores
// `scopeRegistry` finds no `world` scope, reads the reference as a graceful false, skips the gated
// group and plays "Daylight." instead - which is a silently DIFFERENT STORY from the same bundle,
// not an error anyone would see. Nothing in the corpus covered this until now.
const selfBackedHostScope = {
  name: "a declared host scope with no resolver is self-backed from its defaults",
  project: project({ scopeRegistry: { version: 1, scopes: [
    { token: "world", declarations: [{ name: "isNight", type: "boolean", default: true }] },
  ] } }),
  scenes: [{
    id: "s", type: "scene", name: "S",
    blocks: [{ id: "b", type: "block", name: "B", children: [
      { id: "g", type: "group", condition: "@world.isNight", children: [
        { id: "sn", type: "snippet", beats: [{ id: "L", kind: "text" }], jump: { to: "END" } },
      ] },
      { id: "sn2", type: "snippet", beats: [{ id: "L2", kind: "text" }], jump: { to: "END" } },
    ] }],
  }],
  locales: [loc("s", { L: "Night falls.", L2: "Daylight." })],
  expectedTranscript: [
    { type: "text", id: "L", text: "Night falls." },
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
    { type: "choice", groupId: "g", options: [
      { id: "go", prompt: { kind: "text", text: "Go" }, eligible: true },
      { id: "greyed", prompt: { kind: "text", text: "Locked" }, eligible: false }, // "hidden" is absent entirely
    ] },
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// --- a choice as the host receives it: the group id and each option's structured prompt -----------
// Every shape a prompt takes: a line with a speaker who has a display name and a direction, a line whose
// speaker has no display name (so no characterName), a text prompt that interpolates, a bare-snippet
// option whose first content line stands in for its prompt, and an option with no prompt beat and no
// content line at all (so no prompt). The group is not called "g", so a runtime that invents the id fails.
const choicePrompts = {
  name: "a choice carries its group id and each option's structured prompt",
  project: project({
    cast: [{ name: "ANNA", displayName: "Anna" }, { name: "BO" }],
    properties: [{ name: "coins", type: "number", shared: true, default: 3 }],
  }),
  scenes: [{ id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "g_door", type: "group", selector: "choice", children: [
      { id: "o_ask", type: "group", gameData: { icon: "ear" }, prompt: { id: "P_ask", kind: "line", character: "ANNA", direction: "quietly" }, children: [
        { id: "ask_c", type: "snippet", beats: [{ id: "T_ask", kind: "text" }], jump: { to: "END" } },
      ] },
      { id: "o_shout", type: "group", prompt: { id: "P_shout", kind: "line", character: "BO" }, children: [
        { id: "shout_c", type: "snippet", jump: { to: "END" } },
      ] },
      { id: "o_pay", type: "group", prompt: { id: "P_pay", kind: "text" }, children: [
        { id: "pay_c", type: "snippet", jump: { to: "END" } },
      ] },
      { id: "o_bare", type: "snippet", beats: [{ id: "L_bare", kind: "line", character: "ANNA" }], jump: { to: "END" } },
      { id: "o_mute", type: "group", children: [{ id: "mute_c", type: "snippet", jump: { to: "END" } }] },
    ] },
  ] }] }],
  locales: [loc("s", { P_ask: "Who's there?", P_shout: "Open up!", P_pay: "Pay {@coins} coins", L_bare: "Hello?", T_ask: "No answer." })],
  choices: ["o_ask"],
  expectedTranscript: [
    { type: "choice", groupId: "g_door", options: [
      { id: "o_ask", prompt: { kind: "line", text: "Who's there?", character: "ANNA", characterName: "Anna", direction: "quietly" }, eligible: true, gameData: { icon: "ear" } },
      { id: "o_shout", prompt: { kind: "line", text: "Open up!", character: "BO" }, eligible: true },  // no display name -> no characterName
      { id: "o_pay", prompt: { kind: "text", text: "Pay 3 coins" }, eligible: true },                  // a text prompt interpolates
      { id: "o_bare", prompt: { kind: "line", text: "Hello?", character: "ANNA", characterName: "Anna" }, eligible: true }, // first content line
      { id: "o_mute", eligible: true },                                                                 // nothing to show: no prompt
    ] },
    { type: "text", id: "T_ask", text: "No answer." },
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// The same in an IDs-only build: a prompt's text is its beat id and no characterName is resolved, exactly
// as for a line beat (the game localises both).
const choicePromptsIds = {
  name: "IDs-only build: a prompt's text is its beat id and carries no character name",
  project: project({ cast: [{ name: "ANNA", displayName: "Anna" }] }),
  scenes: [{ id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "g_ids", type: "group", selector: "choice", children: [
      { id: "o_line", type: "group", prompt: { id: "P_line", kind: "line", character: "ANNA" }, children: [
        { id: "line_c", type: "snippet", jump: { to: "END" } },
      ] },
      { id: "o_text", type: "group", prompt: { id: "P_text", kind: "text" }, children: [
        { id: "text_c", type: "snippet", jump: { to: "END" } },
      ] },
    ] },
  ] }] }],
  locales: [loc("s", { P_line: "Hi", P_text: "Leave" })], // stripped by idsOnly
  idsOnly: true,
  choices: ["o_text"],
  expectedTranscript: [
    { type: "choice", groupId: "g_ids", options: [
      { id: "o_line", prompt: { kind: "line", text: "P_line", character: "ANNA" }, eligible: true },
      { id: "o_text", prompt: { kind: "text", text: "P_text" }, eligible: true },
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
    { name: "mine", type: "number", default: 0, shared: false },
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

// Host navigation by address. Pins every part of the contract in one script: a scene-address hop that
// runs the target's onEntry, a scene-SCOPED block address, an unknown address that must NOT move the
// cursor, abandonment of both the rest of a snippet and a pending call-return, and revival of an ended
// flow with per-flow selector memory intact (the bark loop). Addresses are DERIVED from names, so a port
// that forgets the name-slug fallback fails here.
const scriptedGoto = {
  name: "goto: address navigation, immediate landing, and move-without-reset",
  project: project({ properties: [{ name: "entered", type: "number", shared: true, default: 0 }] }),
  scenes: [
    { id: "scn_hub", type: "scene", name: "Hub", blocks: [
      { id: "b_main", type: "block", name: "Main", children: [
        // Calls Far, so a return frame is pending while Far plays; a goto must discard it.
        { id: "sn_call", type: "snippet", beats: [{ id: "L_a", kind: "text" }], jump: { to: "b_far", mode: "call" } },
        { id: "sn_after", type: "snippet", beats: [{ id: "L_after", kind: "text" }], jump: { to: "END" } },
      ] },
      { id: "b_far", type: "block", name: "Far", children: [
        { id: "sn_far", type: "snippet", beats: [{ id: "L_f1", kind: "text" }, { id: "L_f2", kind: "text" }] },
      ] },
      { id: "b_var", type: "block", name: "Var", children: [
        { id: "g_var", type: "group", selector: "sequence", options: { order: "sequential", exhaust: "once" }, children: [
          { id: "sn_v1", type: "snippet", beats: [{ id: "V1", kind: "text" }] },
          { id: "sn_v2", type: "snippet", beats: [{ id: "V2", kind: "text" }] },
        ] },
      ] },
    ] },
    { id: "scn_side", type: "scene", name: "Side Room",
      onEntry: [{ kind: "set", target: "@entered", value: "@entered + 1" }],
      blocks: [{ id: "b_talk", type: "block", name: "Talk", children: [
        { id: "sn_talk", type: "snippet", beats: [{ id: "L_talk", kind: "text" }], jump: { to: "END" } },
      ] }] },
  ],
  locales: [
    loc("scn_hub", { L_a: "a", L_after: "returned", L_f1: "f1", L_f2: "f2", V1: "v1", V2: "v2" }),
    loc("scn_side", { L_talk: "talk {@entered}" }),
  ],
  script: [
    { op: "openFlow", flow: "f", scene: "hub" },
    { op: "advance", expect: [{ type: "text", id: "L_a", text: "a" }] },   // then the CALL into Far
    { op: "advance", expect: [{ type: "text", id: "L_f1", text: "f1" }] }, // mid-snippet, return pending

    // Unknown addresses must not move the cursor. A block address is SCENE-SCOPED, so "talk" (which
    // lives in the side scene) must not resolve against hub.
    { op: "goto", scene: "no-such-scene", expectResult: false },
    { op: "goto", scene: "hub", block: "no-such-block", expectResult: false },
    { op: "goto", scene: "hub", block: "talk", expectResult: false },

    // A real hop: onEntry runs (entered 0 -> 1), the rest of Far's snippet (f2) is abandoned, and the
    // pending call-return ("returned") is discarded because a goto REPLACES the stack.
    { op: "goto", scene: "side-room", block: "talk", expectResult: true },
    { op: "advance", expect: [{ type: "text", id: "L_talk", text: "talk 1" }] },
    { op: "advance", expect: [{ type: "end" }] },

    // The flow has ENDED; goto revives it, and per-flow selector memory survived the hop.
    { op: "goto", scene: "hub", block: "var", expectResult: true },
    { op: "advance", expect: [{ type: "text", id: "V1", text: "v1" }] },
    { op: "advance", expect: [{ type: "end" }] },
    { op: "goto", scene: "hub", block: "var", expectResult: true },
    { op: "advance", expect: [{ type: "text", id: "V2", text: "v2" }] }, // resumes: a reset would replay v1
  ],
} satisfies ScriptedFixture;

// Checkpoints: asking "would this say anything?" without consequences. The side room changes every kind
// of state a step can: its onEntry moves a shared global and a host-scope (`@world`) property, and seeds
// (then bumps) a shared scene prop, the
// talk block draws from a SHARED shuffle with the flow's PRNG and counts world visits, and each pick's
// onEnter bumps a per-flow global. A rollback must put all of it back, and the flow's cursor with it.
const checkpointProject = project({ properties: [
  { name: "entered", type: "number", shared: true, default: 0 },
  { name: "mine", type: "number", default: 0, shared: false },
], scopeRegistry: { version: 1, scopes: [{ token: "world", declarations: [{ name: "alarms", type: "number", default: 0 }] }] } });
const checkpointPick = (n: number) => ({
  id: `sn_s${n}`, type: "snippet" as const,
  onEnter: [{ kind: "set" as const, target: "@mine", value: "@mine + 1" }],
  beats: [{ id: `S${n}`, kind: "text" as const }], jump: { to: "END" },
});
const checkpointScenes: Scene[] = [
  { id: "scn_hub", type: "scene", name: "Hub", blocks: [
    { id: "b_main", type: "block", name: "Main", children: [
      { id: "sn_1", type: "snippet", beats: [{ id: "T1", kind: "text" }] },
      { id: "sn_2", type: "snippet", beats: [{ id: "T2", kind: "text" }] },
      { id: "sn_3", type: "snippet", beats: [{ id: "T3", kind: "text" }], jump: { to: "END" } },
    ] },
    { id: "b_check", type: "block", name: "Check", children: [
      { id: "g_check", type: "group", selector: "branch", children: [
        { id: "sn_seen", type: "snippet", condition: "patter_visits('b_talk') > 0", beats: [{ id: "T_seen", kind: "text" }], jump: { to: "END" } },
        { id: "sn_unseen", type: "snippet", beats: [{ id: "T_unseen", kind: "text" }], jump: { to: "END" } },
      ] },
    ] },
    // A flow's OWN memory: a per-flow once-each sequence, and a check on this flow's visits.
    { id: "b_own", type: "block", name: "Own", children: [
      { id: "g_own", type: "group", selector: "sequence", options: { order: "sequential", exhaust: "once" }, children: [
        { id: "sn_o1", type: "snippet", beats: [{ id: "O1", kind: "text" }], jump: { to: "END" } },
        { id: "sn_o2", type: "snippet", beats: [{ id: "O2", kind: "text" }], jump: { to: "END" } },
      ] },
    ] },
    { id: "b_owncheck", type: "block", name: "Own Check", children: [
      { id: "g_owncheck", type: "group", selector: "branch", children: [
        { id: "sn_been", type: "snippet", condition: "visits('b_own') > 0", beats: [{ id: "T_been", kind: "text" }], jump: { to: "END" } },
        { id: "sn_notbeen", type: "snippet", beats: [{ id: "T_notbeen", kind: "text" }], jump: { to: "END" } },
      ] },
    ] },
  ] },
  { id: "scn_side", type: "scene", name: "Side Room",
    sceneProps: [{ name: "tally", type: "number", default: 0, shared: true }],
    onEntry: [
      { kind: "set", target: "@entered", value: "@entered + 1" },
      { kind: "set", target: "@scene.tally", value: "@scene.tally + 1" },
      { kind: "set", target: "@world.alarms", value: "@world.alarms + 1" },
    ],
    blocks: [
      { id: "b_talk", type: "block", name: "Talk", children: [
        { id: "g_bag", type: "group", selector: "sequence", shared: true, options: { order: "shuffle", exhaust: "repeat" },
          children: [checkpointPick(1), checkpointPick(2), checkpointPick(3)] },
      ] },
      { id: "b_quiet", type: "block", name: "Quiet", children: [
        { id: "sn_q", type: "snippet", condition: "@mine > 5", beats: [{ id: "Q", kind: "text" }], jump: { to: "END" } },
      ] },
    ] },
];
const checkpointLoc = [
  loc("scn_hub", { T1: "one {@entered} {@mine}", T2: "two {@entered} {@mine}", T3: "three {@entered} {@mine}", T_seen: "seen", T_unseen: "unseen", O1: "o1", O2: "o2", T_been: "been", T_notbeen: "not been" }),
  loc("scn_side", { S1: "s1 {@entered} {@mine} {@scene.tally} {@world.alarms}", S2: "s2 {@entered} {@mine} {@scene.tally} {@world.alarms}", S3: "s3 {@entered} {@mine} {@scene.tally} {@world.alarms}", Q: "q" }),
];

const scriptedCheckpoint = {
  name: "checkpoint: rollback undoes a step's every change, commit keeps them",
  project: checkpointProject, scenes: checkpointScenes, locales: checkpointLoc, seed: 7,
  script: [
    { op: "openFlow", flow: "f", scene: "hub" },
    { op: "advance", expect: [{ type: "text", id: "T1", text: "one 0 0" }] },

    // A step that says something, rolled back: the cursor returns to after T1, and nothing it changed stays.
    { op: "checkpoint" },
    { op: "goto", scene: "side-room", block: "talk", expectResult: true },
    { op: "advance", expect: [{ type: "text", id: "S1", text: "s1 1 1 1 1" }] },
    { op: "rollback" },
    { op: "advance", expect: [{ type: "text", id: "T2", text: "two 0 0" }] },
    { op: "openFlow", flow: "probe", scene: "hub", block: "check" },
    { op: "advance", expect: [{ type: "text", id: "T_unseen", text: "unseen" }] }, // the world visit is gone too

    // The pattern this exists for: an address with nothing to say, found out and forgotten.
    { op: "useFlow", flow: "f" },
    { op: "checkpoint" },
    { op: "goto", scene: "side-room", block: "quiet", expectResult: true },
    { op: "advance", expect: [{ type: "end" }] },
    { op: "rollback" },
    { op: "advance", expect: [{ type: "text", id: "T3", text: "three 0 0" }] },

    // The same step again draws the same pick (the PRNG and the shared bag came back), and this time it's
    // committed: the scene prop seeds afresh at 1, and everything it changed stays.
    { op: "checkpoint" },
    { op: "goto", scene: "side-room", block: "talk", expectResult: true },
    { op: "advance", expect: [{ type: "text", id: "S1", text: "s1 1 1 1 1" }] },
    { op: "commit" },
    { op: "advance", expect: [{ type: "end" }] },
    { op: "openFlow", flow: "probe2", scene: "hub", block: "check" },
    { op: "advance", expect: [{ type: "text", id: "T_seen", text: "seen" }] },
    { op: "useFlow", flow: "f" },
    { op: "goto", scene: "side-room", block: "talk", expectResult: true },
    { op: "advance", expect: [{ type: "text", id: "S2", text: "s2 1 2 1 1" }] }, // the bag carried on (no repeat); same scene, so no onEntry
  ],
} satisfies ScriptedFixture;

const scriptedCheckpointOwnMemory = {
  name: "checkpoint: rollback puts back a flow's own visits, sequence positions, and place in a block",
  project: checkpointProject, scenes: checkpointScenes, locales: checkpointLoc, seed: 7,
  script: [
    { op: "openFlow", flow: "f", scene: "hub", block: "own-check" },
    { op: "advance", expect: [{ type: "text", id: "T_notbeen", text: "not been" }] },
    { op: "checkpoint" },
    { op: "goto", scene: "hub", block: "own", expectResult: true },
    { op: "advance", expect: [{ type: "text", id: "O1", text: "o1" }] },
    { op: "rollback" },
    { op: "goto", scene: "hub", block: "own-check", expectResult: true },
    { op: "advance", expect: [{ type: "text", id: "T_notbeen", text: "not been" }] }, // this flow's visit is gone
    { op: "goto", scene: "hub", block: "own", expectResult: true },
    { op: "advance", expect: [{ type: "text", id: "O1", text: "o1" }] },             // and its sequence is back at the start
    { op: "goto", scene: "hub", block: "own", expectResult: true },
    { op: "advance", expect: [{ type: "text", id: "O2", text: "o2" }] },

    // A plain advance, rolled back: the block's position moves in place, and comes back.
    { op: "openFlow", flow: "h", scene: "hub" },
    { op: "advance", expect: [{ type: "text", id: "T1", text: "one 0 0" }] },
    { op: "checkpoint" },
    { op: "advance", expect: [{ type: "text", id: "T2", text: "two 0 0" }] },
    { op: "rollback" },
    { op: "advance", expect: [{ type: "text", id: "T2", text: "two 0 0" }] },
  ],
} satisfies ScriptedFixture;

const scriptedCheckpointNewFlow = {
  name: "checkpoint: a flow opened inside one is closed and forgotten by rollback",
  project: checkpointProject, scenes: checkpointScenes, locales: checkpointLoc, seed: 7,
  script: [
    { op: "openFlow", flow: "f", scene: "hub" },
    { op: "advance", expect: [{ type: "text", id: "T1", text: "one 0 0" }] },
    { op: "checkpoint" },
    { op: "openFlow", flow: "g", scene: "side-room", block: "talk" },
    { op: "advance", expect: [{ type: "text", id: "S1", text: "s1 1 1 1 1" }] },
    { op: "rollback" },
    // The name is free again: opening it afresh plays the same pick, from the same untouched world.
    { op: "openFlow", flow: "g", scene: "side-room", block: "talk" },
    { op: "advance", expect: [{ type: "text", id: "S1", text: "s1 1 1 1 1" }] },
    { op: "useFlow", flow: "f" },
    { op: "advance", expect: [{ type: "text", id: "T2", text: "two 1 0" }] }, // g's committed entry counts once; @mine is per-flow
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
    { op: "advance", expect: [{ type: "choice", groupId: "g", options: [
      { id: "left", prompt: { kind: "text", text: "Left" }, eligible: true },
      { id: "right", prompt: { kind: "text", text: "Right" }, eligible: true },
    ] }] },
    { op: "saveLoad" },
    { op: "advance", expect: [{ type: "choice", groupId: "g", options: [ // replayed whole: group id and prompts
      { id: "left", prompt: { kind: "text", text: "Left" }, eligible: true },
      { id: "right", prompt: { kind: "text", text: "Right" }, eligible: true },
    ] }] },
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
    { op: "advance", expect: [{ type: "choice", groupId: "g", options: [{ id: "opt", prompt: { kind: "line", text: "Hello?" }, eligible: true }] }] }, // line prompt stripped
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
    { op: "advance", expect: [{ type: "choice", groupId: "g", options: [
      { id: "talk", prompt: { kind: "text", text: "Talk" }, eligible: true },
      { id: "leave", prompt: { kind: "text", text: "Leave" }, eligible: true },
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
    { op: "advance", expect: [{ type: "choice", groupId: "g", options: [
      { id: "once", prompt: { kind: "text", text: "Once" }, eligible: true },
      { id: "keep", prompt: { kind: "text", text: "Keep" }, eligible: true },
      { id: "leave", prompt: { kind: "text", text: "Leave" }, eligible: true },
    ] }] },
    { op: "choose", id: "once" },
    { op: "advance", expect: [{ type: "text", id: "T_once", text: "played once" }] },
    { op: "advance", expect: [{ type: "choice", groupId: "g", options: [
      { id: "keep", prompt: { kind: "text", text: "Keep" }, eligible: true },   // 'once' is consumed - absent entirely
      { id: "leave", prompt: { kind: "text", text: "Leave" }, eligible: true },
    ] }] },
    { op: "choose", id: "keep" },
    { op: "advance", expect: [{ type: "text", id: "T_keep", text: "played keep" }] },
    { op: "advance", expect: [{ type: "choice", groupId: "g", options: [
      { id: "keep", prompt: { kind: "text", text: "Keep" }, eligible: true },   // sticky: still here after being followed
      { id: "leave", prompt: { kind: "text", text: "Leave" }, eligible: true },
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
    { op: "advance", expect: [{ type: "choice", groupId: "g", options: [
      { id: "real", prompt: { kind: "text", text: "Real" }, eligible: true },   // the fallback is NOT in the option set
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
    { op: "advance", expect: [{ type: "choice", groupId: "g", options: [
      { id: "left", prompt: { kind: "text", text: "Left" }, eligible: true },
      { id: "right", prompt: { kind: "text", text: "Right" }, eligible: true },
    ] }] },
    { op: "hotSwap" },
    { op: "advance", expect: [{ type: "choice", groupId: "g", options: [
      { id: "left", prompt: { kind: "text", text: "Left" }, eligible: true }, // `right` drifted out: dropped, never re-derived
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

// --- openFlow at an address that does not resolve -------------------------------------------------
// A refused open changes NOTHING: no flow is opened, a flow already open under the name is neither closed
// nor replaced, and the current flow does not move. The address resolves as goto's does, so a block is
// scene-scoped: a real block of ANOTHER scene does not resolve, by internal id or by address. The runner
// checks the name still means the same flow; the advances show it carrying on from where it was.
const scriptedOpenFlowRefused = {
  name: "openFlow at an address that does not resolve opens nothing and leaves the open flow alone",
  project: project(),
  scenes: [
    { id: "s_harbour", type: "scene", name: "Harbour", blocks: [
      { id: "b_quay", type: "block", name: "Quay", children: [
        { id: "sn_quay", type: "snippet", beats: [
          { id: "T_q1", kind: "text" }, { id: "T_q2", kind: "text" }, { id: "T_q3", kind: "text" },
        ], jump: { to: "END" } },
      ] },
      { id: "b_pier", type: "block", name: "Pier", children: [
        { id: "sn_pier", type: "snippet", beats: [{ id: "T_pier", kind: "text" }], jump: { to: "END" } },
      ] },
    ] },
    { id: "s_market", type: "scene", name: "Market", blocks: [
      { id: "b_stalls", type: "block", name: "Stalls", children: [
        { id: "sn_stalls", type: "snippet", beats: [{ id: "T_stalls", kind: "text" }], jump: { to: "END" } },
      ] },
    ] },
  ],
  locales: [
    loc("s_harbour", { T_q1: "Gulls.", T_q2: "Rope.", T_q3: "Tide.", T_pier: "The pier." }),
    loc("s_market", { T_stalls: "Stalls." }),
  ],
  script: [
    { op: "openFlow", flow: "main", scene: "harbour" },
    { op: "advance", expect: [{ type: "text", id: "T_q1", text: "Gulls." }] },
    { op: "openFlow", flow: "main", scene: "nowhere", expectResult: false },                    // unknown scene
    { op: "openFlow", flow: "main", scene: "harbour", block: "b_stalls", expectResult: false }, // a real block of ANOTHER scene
    { op: "openFlow", flow: "main", scene: "harbour", block: "stalls", expectResult: false },   // ...by its address too
    { op: "openFlow", flow: "main", scene: "harbour", block: "no-such-block", expectResult: false },
    { op: "advance", expect: [{ type: "text", id: "T_q2", text: "Rope." }] },   // the open flow carried on, untouched
    { op: "openFlow", flow: "other", scene: "nowhere", expectResult: false },  // a new name: nothing is opened
    { op: "advance", expect: [{ type: "text", id: "T_q3", text: "Tide." }] },   // ...and the current flow is still main
    { op: "openFlow", flow: "other", scene: "market", block: "b_stalls", expectResult: true },
    { op: "advance", expect: [{ type: "text", id: "T_stalls", text: "Stalls." }] },
    { op: "openFlow", flow: "main", scene: "harbour", block: "pier", expectResult: true }, // a good open still replaces
    { op: "advance", expect: [{ type: "text", id: "T_pier", text: "The pier." }] },
    { op: "advance", expect: [{ type: "end" }] },
  ],
} satisfies ScriptedFixture;

// --- cast introspection ------------------------------------------------------
//
// Who speaks, at three scopes. The project's list is what the author DECLARED (MAYOR is in it and never
// opens their mouth); a scene's and a block's are derived from the beats, so they must be deduped, in
// first-appearance document order, and must include speakers a playthrough might never hear: COOK is
// inside a conditional option group, and SFX only ever voices an option's prompt. It is a static query,
// so playing the flow must not change any answer - the script asks again mid-scene to pin that.
const scriptedCast = {
  name: "cast: declared project list, and the speakers of a scene / block",
  project: project({ cast: [{ name: "ANNA" }, { name: "BARD" }, { name: "COOK" }, { name: "GUARD" }, { name: "MAYOR" }, { name: "SFX" }] }),
  scenes: [
    { id: "scn_tavern", type: "scene", name: "Tavern", blocks: [
      { id: "b_greet", type: "block", name: "Greeting", children: [
        { id: "sn1", type: "snippet", beats: [
          { id: "L1", kind: "line", character: "GUARD" },
          { id: "T1", kind: "text" },                      // narration: no speaker to collect
          { id: "L2", kind: "line", character: "ANNA" },
          { id: "L3", kind: "line", character: "GUARD" },   // second GUARD line: deduped, keeps first position
        ] },
        { id: "g_choice", type: "group", selector: "choice", children: [
          { id: "o1", type: "group", condition: "true", prompt: { id: "P1", kind: "line", character: "SFX" }, children: [
            { id: "sn2", type: "snippet", beats: [{ id: "L4", kind: "line", character: "COOK" }], jump: { to: "END" } },
          ] },
          { id: "o2", type: "group", prompt: { id: "P2", kind: "text" }, children: [
            { id: "sn3", type: "snippet", beats: [{ id: "T2", kind: "text" }], jump: { to: "END" } },
          ] },
        ] },
      ] },
      { id: "b_back", type: "block", name: "Back Room", children: [
        { id: "sn4", type: "snippet", beats: [
          { id: "L5", kind: "line", character: "ANNA" },
          { id: "L6", kind: "line", character: "BARD" },
        ], jump: { to: "END" } },
      ] },
    ] },
    { id: "scn_quiet", type: "scene", name: "Quiet", blocks: [
      { id: "b_only", type: "block", name: "Only", children: [
        { id: "sn5", type: "snippet", beats: [{ id: "T3", kind: "text" }], jump: { to: "END" } },
      ] },
    ] },
  ],
  locales: [
    loc("scn_tavern", { L1: "Halt!", T1: "The gate creaks.", L2: "Let me pass.", L3: "No.", L4: "Stew?", L5: "Again?", L6: "A song!", P1: "[a knock]", P2: "Say nothing", T2: "Silence." }),
    loc("scn_quiet", { T3: "Snow falls." }),
  ],
  script: [
    // The declared cast, in authored order, including the member who never speaks.
    { op: "expectCast", expectResult: ["ANNA", "BARD", "COOK", "GUARD", "MAYOR", "SFX"] },

    // A scene: both blocks, deduped, first appearance wins. Addresses derive from names, so a port that
    // forgets the name-slug fallback fails the second of each pair.
    { op: "expectCast", scene: "scn_tavern", expectResult: ["GUARD", "ANNA", "SFX", "COOK", "BARD"] },
    { op: "expectCast", scene: "tavern", expectResult: ["GUARD", "ANNA", "SFX", "COOK", "BARD"] },
    { op: "expectCast", scene: "scn_tavern", block: "b_greet", expectResult: ["GUARD", "ANNA", "SFX", "COOK"] },
    { op: "expectCast", scene: "tavern", block: "greeting", expectResult: ["GUARD", "ANNA", "SFX", "COOK"] },
    { op: "expectCast", scene: "scn_tavern", block: "b_back", expectResult: ["ANNA", "BARD"] },

    // Nothing to report: narration only, and refs that do not resolve.
    { op: "expectCast", scene: "scn_quiet", expectResult: [] },
    { op: "expectCast", scene: "no-such-scene", expectResult: [] },
    { op: "expectCast", scene: "scn_tavern", block: "no-such-block", expectResult: [] },

    // Static: playing into the scene changes none of it.
    { op: "openFlow", flow: "f", scene: "tavern", block: "greeting" },
    { op: "advance", expect: [{ type: "line", id: "L1", text: "Halt!", character: "GUARD" }] },
    { op: "advance", expect: [{ type: "text", id: "T1", text: "The gate creaks." }] },
    { op: "expectCast", scene: "scn_tavern", expectResult: ["GUARD", "ANNA", "SFX", "COOK", "BARD"] },
    { op: "expectCast", expectResult: ["ANNA", "BARD", "COOK", "GUARD", "MAYOR", "SFX"] },
  ],
} satisfies ScriptedFixture;

// A bundle from before any of this existed: its project declares no cast, so the compiler omits the
// `cast` key altogether (not an empty array - the key is simply absent). Every runtime must answer the
// three cast queries with an empty list rather than choking on the missing section, which is what any
// bundle built by an older toolchain looks like.
const scriptedCastAbsent = {
  name: "cast: a bundle with no cast section at all",
  project: project({ cast: undefined }),
  scenes: [
    { id: "scn_only", type: "scene", name: "Only", blocks: [
      { id: "b_only", type: "block", name: "Narration", children: [
        { id: "sn_only", type: "snippet", beats: [{ id: "N1", kind: "text" }], jump: { to: "END" } },
      ] },
    ] },
  ],
  locales: [loc("scn_only", { N1: "Snow falls." })],
  script: [
    { op: "expectCast", expectResult: [] },
    { op: "expectCast", scene: "scn_only", expectResult: [] },
    { op: "expectCast", scene: "scn_only", block: "b_only", expectResult: [] },
    // ... and it still plays.
    { op: "openFlow", flow: "f", scene: "only" },
    { op: "advance", expect: [{ type: "text", id: "N1", text: "Snow falls." }] },
    { op: "advance", expect: [{ type: "end" }] },
  ],
} satisfies ScriptedFixture;


// --- scene / block gameData ------------------------------------------------------
//
// The author's own gameData on a scene and on a block, read by address. The answer is the RAW sparse
// override, the same rule a beat's step follows: the project declares defaults for both node types here,
// and none of them may leak into the answer (a host merges them through the gameData helpers when it
// wants them). A block never inherits its scene's gameData, a falsy value is still a value, an
// undeclared (orphan) key rides along verbatim, and an unknown ref answers `{}` rather than throwing.
const scriptedSceneBlockGameData = {
  name: "gameData: scene and block overrides read by address, raw and uninherited",
  project: project({ gameDataFields: {
    scene: [{ name: "music", type: "text", default: "calm" }, { name: "chapter", type: "number", default: 1 }],
    block: [{ name: "lit", type: "boolean", default: true }],
  } }),
  scenes: [
    { id: "scn_tavern", type: "scene", name: "Tavern", gameData: { music: "jig", chapter: 2, weather: "rain" }, blocks: [
      { id: "b_cellar", type: "block", name: "Cellar", gameData: { lit: false }, children: [
        { id: "sn1", type: "snippet", beats: [{ id: "T1", kind: "text" }], jump: { to: "b_loft" } },
      ] },
      { id: "b_yard", type: "block", name: "Yard", children: [
        { id: "sn2", type: "snippet", beats: [{ id: "T2", kind: "text" }], jump: { to: "END" } },
      ] },
      { id: "b_loft", type: "block", name: "Hay Loft", gameData: { lit: true, volume: 0.5 }, children: [
        { id: "sn3", type: "snippet", beats: [{ id: "T3", kind: "text" }], jump: { to: "END" } },
      ] },
    ] },
    { id: "scn_quiet", type: "scene", name: "Quiet", blocks: [
      { id: "b_only", type: "block", name: "Only", children: [
        { id: "sn4", type: "snippet", beats: [{ id: "T4", kind: "text" }], jump: { to: "END" } },
      ] },
    ] },
  ],
  locales: [loc("scn_tavern", { T1: "Damp stone.", T2: "Mud.", T3: "Straw." }), loc("scn_quiet", { T4: "Snow falls." })],
  script: [
    // A scene, by internal id and by its name-slug address: overrides only, the orphan kept.
    { op: "expectGameData", scene: "scn_tavern", expectResult: { music: "jig", chapter: 2, weather: "rain" } },
    { op: "expectGameData", scene: "tavern", expectResult: { music: "jig", chapter: 2, weather: "rain" } },

    // Blocks: a falsy override, a multi-word name slug, a fractional number.
    { op: "expectGameData", scene: "scn_tavern", block: "b_cellar", expectResult: { lit: false } },
    { op: "expectGameData", scene: "tavern", block: "cellar", expectResult: { lit: false } },
    { op: "expectGameData", scene: "tavern", block: "hay-loft", expectResult: { lit: true, volume: 0.5 } },

    // Nothing set: no inheritance from the scene, and no declared defaults filled in.
    { op: "expectGameData", scene: "scn_tavern", block: "b_yard", expectResult: {} },
    { op: "expectGameData", scene: "quiet", expectResult: {} },
    { op: "expectGameData", scene: "quiet", block: "only", expectResult: {} },

    // Refs that do not resolve.
    { op: "expectGameData", scene: "no-such-scene", expectResult: {} },
    { op: "expectGameData", scene: "scn_tavern", block: "no-such-block", expectResult: {} },

    // Static: playing through the scene, and a save round-trip, change none of it.
    { op: "openFlow", flow: "f", scene: "tavern", block: "cellar" },
    { op: "advance", expect: [{ type: "text", id: "T1", text: "Damp stone." }] },
    { op: "expectGameData", scene: "tavern", block: "cellar", expectResult: { lit: false } },
    { op: "saveLoad" },
    { op: "advance", expect: [{ type: "text", id: "T3", text: "Straw." }] },
    { op: "expectGameData", scene: "tavern", expectResult: { music: "jig", chapter: 2, weather: "rain" } },
    { op: "expectGameData", scene: "tavern", block: "hay-loft", expectResult: { lit: true, volume: 0.5 } },
  ],
} satisfies ScriptedFixture;

// --- quality properties (expr 0.4.0) -----------------------------------------
//
// A story stage as an ORDERED ladder of named stage strings. The value is the stage NAME (a plain
// string in bags and saves); the ladder - `stages` on the declaration, baked into the bundle - is what
// makes ordering compare by POSITION and advance() step. The stage names are chosen so alphabetical
// order disagrees with ladder order: an engine comparing strings instead of positions fails loudly.

const qualityProject = (stages: string[]) => project({
  properties: [{ name: "negotiation", type: "quality", stages, shared: true }],
});
const QUALITY_STAGES = ["not_started", "underway", "done", "aftermath"];

// Gating: three sibling snippets probe the quality (positional >=, exact ==, else). Seeded at the
// FIRST stage, the fallthrough plays; the interpolation shows the stage name travelling as a string.
const qualityGates = {
  name: "quality: seeds at the first stage and gates by ladder position",
  project: qualityProject(QUALITY_STAGES),
  scenes: [{ id: "s", type: "scene", name: "S", blocks: [
    { id: "b_probe", type: "block", name: "Probe", children: [
      { id: "sn_past", type: "snippet", condition: '@negotiation >= "done"', beats: [{ id: "T_past", kind: "text" }], jump: { to: "END" } },
      { id: "sn_mid", type: "snippet", condition: '@negotiation == "underway"', beats: [{ id: "T_mid", kind: "text" }], jump: { to: "END" } },
      { id: "sn_pre", type: "snippet", beats: [{ id: "T_pre", kind: "text" }], jump: { to: "END" } },
    ] },
  ] }],
  locales: [loc("s", { T_past: "past", T_mid: "mid", T_pre: "pre {@negotiation}" })],
  expectedTranscript: [
    { type: "text", id: "T_pre", text: "pre not_started" },
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// advance(): each pass through the block steps the ladder ONE stage and saturates at the last -
// "aftermath" holds on the fourth and fifth passes, with no wrap and no error. Alphabetically
// "underway" < "done" is FALSE ("u" > "d"), so the third pass's gate proves positional comparison
// on the moved value too.
const qualityAdvance = {
  name: "quality: advance() steps one stage per pass and saturates at the last",
  project: qualityProject(QUALITY_STAGES),
  scenes: [{ id: "s", type: "scene", name: "S", blocks: [
    { id: "b", type: "block", name: "B", children: [
      { id: "sn", type: "snippet", beats: [{ id: "T", kind: "text" }],
        onExit: [{ kind: "set", target: "@negotiation", value: "advance(@negotiation)" }],
        jump: { to: "b_loop" } },
      { id: "sn_stop", type: "snippet", condition: '@negotiation >= "aftermath"', beats: [{ id: "T_stop", kind: "text" }], jump: { to: "END" } },
    ] },
    { id: "b_loop", type: "block", name: "loop", gameId: "loop", children: [
      { id: "sn_back", type: "snippet", condition: '@negotiation < "aftermath"', beats: [{ id: "T_back", kind: "text" }], jump: { to: "b" } },
      { id: "sn_done", type: "snippet", beats: [{ id: "T_done", kind: "text" }], jump: { to: "END" } },
    ] },
  ] }],
  locales: [loc("s", { T: "step to {@negotiation}", T_stop: "stop", T_back: "at {@negotiation}", T_done: "done at {@negotiation}" })],
  expectedTranscript: [
    { type: "text", id: "T", text: "step to not_started" },   // onExit runs on LEAVING: text shows the pre-step stage
    { type: "text", id: "T_back", text: "at underway" },
    { type: "text", id: "T", text: "step to underway" },
    { type: "text", id: "T_back", text: "at done" },
    { type: "text", id: "T", text: "step to done" },
    { type: "text", id: "T_done", text: "done at aftermath" },
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// The insertion story, end to end: the save carries "done" BY NAME; the hot-swapped bundle's ladder
// has grown a stage before it. Restoring by name lands on "done" still (by index it would land on the
// inserted "confrontation"), and the >= gate reads the NEW ladder's positions.
const scriptedQualityInsertion = {
  name: "quality: a stage inserted mid-production shifts nothing (save by name)",
  project: qualityProject(QUALITY_STAGES),
  scenes: [{ id: "s", type: "scene", name: "S", blocks: [
    { id: "b_set", type: "block", name: "Set", children: [
      { id: "sn_set", type: "snippet", beats: [{ id: "T_set", kind: "text" }],
        onExit: [{ kind: "set", target: "@negotiation", value: '"done"' }], jump: { to: "END" } },
    ] },
    { id: "b_probe", type: "block", name: "Probe", gameId: "probe", children: [
      { id: "sn_past", type: "snippet", condition: '@negotiation >= "done"', beats: [{ id: "T_past", kind: "text" }], jump: { to: "END" } },
      { id: "sn_pre", type: "snippet", beats: [{ id: "T_pre", kind: "text" }], jump: { to: "END" } },
    ] },
  ] }],
  locales: [loc("s", { T_set: "set", T_past: "past {@negotiation}", T_pre: "pre" })],
  projectB: qualityProject(["not_started", "underway", "confrontation", "done", "aftermath"]),
  scenesB: [{ id: "s", type: "scene", name: "S", blocks: [
    { id: "b_set", type: "block", name: "Set", children: [
      { id: "sn_set", type: "snippet", beats: [{ id: "T_set", kind: "text" }],
        onExit: [{ kind: "set", target: "@negotiation", value: '"done"' }], jump: { to: "END" } },
    ] },
    { id: "b_probe", type: "block", name: "Probe", gameId: "probe", children: [
      { id: "sn_past", type: "snippet", condition: '@negotiation >= "done"', beats: [{ id: "T_past", kind: "text" }], jump: { to: "END" } },
      { id: "sn_pre", type: "snippet", beats: [{ id: "T_pre", kind: "text" }], jump: { to: "END" } },
    ] },
  ] }],
  localesB: [loc("s", { T_set: "set", T_past: "past {@negotiation}", T_pre: "pre" })],
  script: [
    { op: "openFlow", flow: "f", scene: "s", block: "set" },
    { op: "advance", expect: [{ type: "text", id: "T_set", text: "set" }] },
    { op: "advance", expect: [{ type: "end" }] },      // leaving sn_set runs the onExit: @negotiation = "done"
    { op: "saveLoad" },                                 // the stage survives a save as its NAME
    { op: "hotSwap" },                                  // ...and lands in the GROWN ladder
    { op: "goto", scene: "s", block: "probe", expectResult: true },
    { op: "advance", expect: [{ type: "text", id: "T_past", text: "past done" }] },
    { op: "advance", expect: [{ type: "end" }] },
  ],
} satisfies ScriptedFixture;

// A save written by the JS reference, loaded by every runtime. Derived from the scripted save/load
// fixtures: everything before `saveLoad` is the SETUP the reference plays before writing the
// envelope, everything after is what each port must reproduce having loaded it. The corpus carries the
// envelope verbatim, so this is the one place the reader and the writer are different runtimes.
const asSaveFixture = (f: ScriptedFixture, name: string): SaveFixture => {
  const at = f.script.findIndex((op) => op.op === "saveLoad");
  const opened = f.script.find((op): op is Extract<ScriptOp, { op: "openFlow" }> => op.op === "openFlow")!;
  return {
    name, project: f.project, scenes: f.scenes,
    ...(f.locales ? { locales: f.locales } : {}),
    ...(f.seed !== undefined ? { seed: f.seed } : {}),
    setup: f.script.slice(0, at),
    script: [{ op: "useFlow", flow: opened.flow }, ...f.script.slice(at + 1)],
  };
};

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
  // Matched-specificity scores for the `order: "specificity"` selector's ranking
  // key. AST-in, integer-score-out; scores hand-derived from the shared scorer
  // (De-Morgan walk; AND sums, OR takes the max branch, check_flags counts
  // operands, atom = 1). Every port scores these with its own matchedSpec.
  specificity: [
    { name: "single matching atom scores 1", src: "@x == 5", scopes: { patter: { x: 5 } }, expected: 1 },
    { name: "a non-matching atom scores 0", src: "@x == 5", scopes: { patter: { x: 1 } }, expected: 0 },
    { name: "AND of two holding atoms sums to 2", src: "@x == 5 and @y > 3", scopes: { patter: { x: 5, y: 4 } }, expected: 2 },
    { name: "AND with one side not holding scores 0", src: "@x == 5 and @y > 3", scopes: { patter: { x: 5, y: 1 } }, expected: 0 },
    { name: "AND of three holding atoms sums to 3", src: "@x == 5 and @y > 3 and @z < 10", scopes: { patter: { x: 5, y: 4, z: 2 } }, expected: 3 },
    { name: "OR takes the max branch: both holding scores 1", src: "@a == 1 or @b == 1", scopes: { patter: { a: 1, b: 1 } }, expected: 1 },
    { name: "OR takes the max branch: one holding scores 1", src: "@a == 1 or @b == 1", scopes: { patter: { a: 1, b: 0 } }, expected: 1 },
    { name: "OR with neither branch holding scores 0", src: "@a == 1 or @b == 1", scopes: { patter: { a: 0, b: 0 } }, expected: 0 },
    { name: "nested OR matched via the 3-atom left branch scores 3", src: "(@a == 1 and @b == 1 and @c == 1) or @x == 1", scopes: { patter: { a: 1, b: 1, c: 1, x: 0 } }, expected: 3 },
    { name: "nested OR matched via the single-atom right branch scores 1", src: "(@a == 1 and @b == 1 and @c == 1) or @x == 1", scopes: { patter: { a: 0, b: 0, c: 0, x: 1 } }, expected: 1 },
    { name: "not(atom) holding scores 1 via flipped polarity", src: "not (@x == 5)", scopes: { patter: { x: 1 } }, expected: 1 },
    { name: "not(a and b) holding: De-Morgan max scores 1", src: "not (@a == 1 and @b == 1)", scopes: { patter: { a: 1, b: 0 } }, expected: 1 },
    { name: "check_flags with three holding operands scores 3", src: "check_flags(@q, +a, +b, +c)", scopes: { patter: { q: ["a", "b", "c"] } }, expected: 3 },
    { name: "check_flags with one operand scores 1", src: "check_flags(@q, +a)", scopes: { patter: { q: ["a"] } }, expected: 1 },
    { name: "check_flags(+a, -b) holding scores 2 (operand count)", src: "check_flags(@q, +a, -b)", scopes: { patter: { q: ["a"] } }, expected: 2 },
    { name: "(a and b) or c: left AND holds at 2, OR max scores 2", src: "(@a == 1 and @b == 1) or @c == 1", scopes: { patter: { a: 1, b: 1, c: 0 } }, expected: 2 },
  ],
  runtime: [
    lineThenEnd, choicePick, selfBackedHostScope, interpolation, effectsSet, gameEventBeat,
    crossScene, cycle, once, voiced, escaped, shuffle, sequence,
    sequentialBlock, callReturn, runGroup, visitGate, sharedScene, temporaryProp,
    branchPicks, shuffleNonRepeating, seenGate, jumpAbandonsReturn, hiddenOption,
    characterName, localeActive, idsMode, tagsAccumulate, choicePrompts, choicePromptsIds, qualityGates, qualityAdvance,
    specAndSums, specFiller, specCheckFlags, specTie, specDegrades,
  ],
  scripted: [scriptedMultiFlow, scriptedGoto, scriptedReset, scriptedSaveLoad, scriptedSaveLoadChoice, scriptedSetLocale,
    scriptedClosedCaptions, scriptedOptionGroup, scriptedStickyOnce, scriptedFallback,
    scriptedHotSwapReword, scriptedHotSwapInsert, scriptedHotSwapDeleteActive, scriptedHotSwapDropOption,
    scriptedHotSwapEmptiedBlock, scriptedCast, scriptedCastAbsent, scriptedSceneBlockGameData, scriptedQualityInsertion,
    scriptedCheckpoint, scriptedCheckpointOwnMemory, scriptedCheckpointNewFlow, scriptedOpenFlowRefused],
  gameData: [gameDataDefaults, gameDataOrphan, gameDataPureDefaults],
  saves: [
    asSaveFixture(scriptedSaveLoad, "a save written by the JS reference loads elsewhere mid-flow, cursor and selector memory intact"),
    asSaveFixture(scriptedSaveLoadChoice, "a save written by the JS reference loads elsewhere at a pending choice, options replayed"),
  ],
};
