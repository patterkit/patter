// ---------------------------------------------------------------------------
// The authored conformance fixtures. `expected` / `expectedTranscript` are the
// CONTRACT - written by hand, never derived from the engine, with ONE caveat:
// where a seeded PRNG is involved (shuffle / random), the expectation is
// computed from the contractual mulberry32 algorithm (runner.ts pins it), since
// hand-predicting draws is not meaningful. New runtime behaviour lands here
// first (Plan §8). `buildCorpus(cases)` compiles these into the portable
// corpus.json; the test asserts the reference engine reproduces every value.
// ---------------------------------------------------------------------------

import type { DescribeFixture, Fixtures, GameDataFixture, LogFixture, RuntimeFixture, SaveFixture, ScriptOp, ScriptedFixture, TranscriptStep } from "./types.js";
import type { Bundle, CompiledGroup, CompiledSnippet, ProjectFile, LocaleFile, SaveGame, Scene } from "@patterkit/model";
import { castStringKey, qualifierStringKey, speakerLabelKey, SPEAKER_PATTERN_KEY } from "@patterkit/model";
import type { ExtensionShard } from "@patterkit/model";
import { readFileSync } from "node:fs";

// A minimal project scaffold shared by the runtime fixtures. It localises a dialogue scene's text
// (`localiseDialogueText`), so the cases written before action text keep their text beats shown text, and
// their bundles, exactly as they were; the action-text cases set it as they need.
const project = (extra: Partial<ProjectFile> = {}): ProjectFile => ({
  schema: "patter/project@0",
  project: { id: "conf", name: "Conformance" },
  locales: { default: "en", all: ["en"] },
  cast: [{ name: "NPC" }],
  localiseDialogueText: true,
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

// --- a character outside the Basic Multilingual Plane, escaped in the bundle --------------------------
// The corpus writes every bundle and save envelope with such characters as escaped surrogate pairs
// ("\ud83d\ude00"), as some JSON writers do, while the expectations keep them as raw UTF-8: a reader that
// decodes each half of the pair on its own reads a different string from the one it is compared with.
const escapedEmoji = {
  name: "an emoji the bundle escapes as a surrogate pair reads as the one character",
  project: project({ properties: [{ name: "mood", type: "string", shared: true, default: "\u{1F600}" }] }),
  scenes: [{
    id: "s", type: "scene", name: "S",
    blocks: [{ id: "b", type: "block", name: "B", children: [
      { id: "sn", type: "snippet", beats: [{ id: "L", kind: "line", character: "NPC" }], jump: { to: "END" } },
    ] }],
  }],
  locales: [loc("s", { L: "Welcome \u{1F44B}, I'm {@mood}." })],
  expectedTranscript: [
    { type: "line", id: "L", text: "Welcome \u{1F44B}, I'm \u{1F600}.", character: "NPC" },
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

// ----- The family's play rules, settled 2026-10-06 after a cross-runtime review -----------------------
// Each case pins one rule on all four runtimes, where they had disagreed or all done something wrong.

const rulesProject = project({ properties: [
  { name: "zero", type: "number", default: 0 },
  { name: "a", type: "number", default: 0 },
  { name: "c", type: "number", default: 0 },
  { name: "d", type: "number", default: 0 },
  { name: "met", type: "boolean", default: false },
] });
const oneBlock = (sceneId: string, children: unknown[], extra: Record<string, unknown> = {}) =>
  ({ id: sceneId, type: "scene", name: sceneId, ...extra, blocks: [{ id: `b_${sceneId}`, type: "block", name: "B", children }] }) as never;

// Rule 1: content that fails at run time never stops the story. A condition that fails counts as false; an
// effect that fails is skipped and the rest of its list still runs. (Each is also reported to the game, which
// each runtime's own tests check.) Here a division by zero, in an effect and in a condition.
const ruleErrorsPlayThrough = {
  name: "rule: a failing effect is skipped and the rest run; a failing condition counts as false",
  project: rulesProject,
  scenes: [oneBlock("s", [
    { id: "sn_set", type: "snippet",
      onEnter: [
        { kind: "set", target: "@a", value: "1" },
        { kind: "set", target: "@c", value: "10 / @zero" },
        { kind: "set", target: "@d", value: "1" },
      ],
      beats: [{ id: "T_vals", kind: "text" }] },
    { id: "g_br", type: "group", selector: "branch", children: [
      { id: "sn_bad", type: "snippet", condition: "10 / @zero > 1", beats: [{ id: "T_bad", kind: "text" }] },
      { id: "sn_ok", type: "snippet", beats: [{ id: "T_ok", kind: "text" }] },
    ] },
    { id: "sn_end", type: "snippet", jump: { to: "END" } },
  ])],
  locales: [loc("s", { T_vals: "a={@a} c={@c} d={@d}", T_bad: "bad", T_ok: "ok" })],
  expectedTranscript: [{ type: "text", id: "T_vals", text: "a=1 c=0 d=1" }, { type: "text", id: "T_ok", text: "ok" }, { type: "end" }],
} satisfies RuntimeFixture;

// Rule 2: a selector evaluates each child's condition ONCE. With random(a, b) in a condition, evaluating twice
// draws twice, so a runtime that did would pick differently from one that did not.
const ruleConditionOnce = {
  name: "rule: a selector evaluates each condition once (random draws once per child)",
  project: rulesProject, seed: 3,
  scenes: [oneBlock("s", [
    { id: "g_rand", type: "group", selector: "branch", children: [
      { id: "sn_r1", type: "snippet", condition: "random(1, 2) == 1", beats: [{ id: "R1", kind: "text" }] },
      { id: "sn_r2", type: "snippet", condition: "random(1, 2) == 1", beats: [{ id: "R2", kind: "text" }] },
      { id: "sn_r3", type: "snippet", beats: [{ id: "R3", kind: "text" }] },
    ] },
    { id: "sn_loop", type: "snippet", jump: { to: "b_s" } },
  ])],
  locales: [loc("s", { R1: "one", R2: "two", R3: "three" })],
  script: [
    { op: "openFlow", flow: "f", scene: "s" },
    { op: "advance", expect: [{ type: "text", id: "R2", text: "two" }] }, { op: "advance", expect: [{ type: "text", id: "R1", text: "one" }] }, { op: "advance", expect: [{ type: "text", id: "R2", text: "two" }] },
    { op: "advance", expect: [{ type: "text", id: "R1", text: "one" }] }, { op: "advance", expect: [{ type: "text", id: "R1", text: "one" }] }, { op: "advance", expect: [{ type: "text", id: "R1", text: "one" }] },
  ],
} satisfies ScriptedFixture;

// Rule 3: Best match scores every part of a condition, including an `or` branch eligibility never evaluated.
// A part that fails scores as false. Here sn_x is eligible by its left side and its right side divides by
// zero: it scores 1, so sn_y (2 parts holding) wins.
const ruleBestMatchFailingPart = {
  name: "rule: a Best-match part that fails scores as false",
  project: rulesProject,
  scenes: [oneBlock("s", [
    { id: "sn_init", type: "snippet", onEnter: [{ kind: "set", target: "@a", value: "1" }, { kind: "set", target: "@d", value: "1" }] },
    { id: "g_bm", type: "group", selector: "sequence", options: { order: "specificity", exhaust: "repeat" }, children: [
      { id: "sn_x", type: "snippet", condition: "@zero == 0 or 10 / @zero > 2", beats: [{ id: "X", kind: "text" }] },
      { id: "sn_y", type: "snippet", condition: "@a == 1 and @d == 1", beats: [{ id: "Y", kind: "text" }] },
    ] },
    { id: "sn_end", type: "snippet", jump: { to: "END" } },
  ])],
  locales: [loc("s", { X: "x", Y: "y" })],
  expectedTranscript: [{ type: "text", id: "Y", text: "y" }, { type: "end" }],
} satisfies RuntimeFixture;

// Rule 4: a shuffle draws only from bag members still eligible. The bag fills on the first visit, while
// @met is false; sn_set then sets it, so sn_b may still be in the bag but must never be drawn again.
const ruleShuffleDrawsEligible = {
  name: "rule: a shuffle never draws a bag member that has gone ineligible",
  project: rulesProject, seed: 5,
  scenes: [oneBlock("s", [
    { id: "g_sh", type: "group", selector: "sequence", options: { order: "shuffle", exhaust: "repeat" }, children: [
      { id: "sn_a", type: "snippet", beats: [{ id: "SA", kind: "text" }] },
      { id: "sn_b", type: "snippet", condition: "@met == false", beats: [{ id: "SB", kind: "text" }] },
      { id: "sn_c", type: "snippet", beats: [{ id: "SC", kind: "text" }] },
    ] },
    { id: "sn_set", type: "snippet", onEnter: [{ kind: "set", target: "@met", value: "true" }],
      beats: [{ id: "SET", kind: "text" }], jump: { to: "b_s" } },
  ])],
  locales: [loc("s", { SA: "a", SB: "b", SC: "c", SET: "set" })],
  script: [
    { op: "openFlow", flow: "f", scene: "s" },
    { op: "advance", expect: [{ type: "text", id: "SC", text: "c" }] }, { op: "advance", expect: [{ type: "text", id: "SET", text: "set" }] }, { op: "advance", expect: [{ type: "text", id: "SA", text: "a" }] },
    { op: "advance", expect: [{ type: "text", id: "SET", text: "set" }] }, { op: "advance", expect: [{ type: "text", id: "SC", text: "c" }] }, { op: "advance", expect: [{ type: "text", id: "SET", text: "set" }] },
    { op: "advance", expect: [{ type: "text", id: "SA", text: "a" }] }, { op: "advance", expect: [{ type: "text", id: "SET", text: "set" }] }, { op: "advance", expect: [{ type: "text", id: "SC", text: "c" }] },
    { op: "advance", expect: [{ type: "text", id: "SET", text: "set" }] },
  ],
} satisfies ScriptedFixture;

// Rule 5: one address rule for openFlow and goto: a scene's gameId first, then its internal id; a block
// within its scene. Scene "scn_cellar" is named Kitchen (gameId "kitchen"), and another scene's INTERNAL id
// is "kitchen": the address "kitchen" means the Kitchen. openFlow used to read it as the internal id.
const ruleOneAddressRule = {
  name: "rule: openFlow and goto read an address the same way (gameId first, block within its scene)",
  project: project({}),
  scenes: [
    { id: "scn_cellar", type: "scene", name: "Kitchen", blocks: [{ id: "b_k", type: "block", name: "Stove", children: [
      { id: "sn_k", type: "snippet", beats: [{ id: "K", kind: "text" }], jump: { to: "END" } } ] }] },
    { id: "kitchen", type: "scene", name: "Garden", blocks: [{ id: "b_g", type: "block", name: "Bench", children: [
      { id: "sn_g", type: "snippet", beats: [{ id: "G", kind: "text" }], jump: { to: "END" } } ] }] },
  ],
  locales: [loc("scn_cellar", { K: "kitchen" }), loc("kitchen", { G: "garden" })],
  script: [
    { op: "openFlow", flow: "f", scene: "kitchen" },
    { op: "advance", expect: [{ type: "text", id: "K", text: "kitchen" }] },
    { op: "goto", scene: "garden", expectResult: true },
    { op: "advance", expect: [{ type: "text", id: "G", text: "garden" }] },
    { op: "goto", scene: "kitchen", expectResult: true },
    { op: "advance", expect: [{ type: "text", id: "K", text: "kitchen" }] },
    // A block is found within its scene only: the Stove is the Kitchen's, not the Garden's.
    { op: "openFlow", flow: "g", scene: "garden", block: "stove", expectResult: false },
    { op: "openFlow", flow: "g", scene: "kitchen", block: "stove" },
    { op: "advance", expect: [{ type: "text", id: "K", text: "kitchen" }] },
  ],
} satisfies ScriptedFixture;

// Rule 6: a number shows in text the way JS writes it: no exponent between 1e-7 and 1e21, a lower-case
// "e" with its sign outside that, and -0 as 0.
const ruleNumberText = {
  name: "rule: numbers interpolate as JS writes them (small, large, and negative zero)",
  project: project({ properties: [
    { name: "small", type: "number", default: 0.00005 },
    { name: "tiny", type: "number", default: 1.5e-7 },
    { name: "huge", type: "number", default: 1e21 },
    { name: "big", type: "number", default: 123456789012 },
    { name: "zero", type: "number", default: 0 },
    { name: "negz", type: "number", default: 1 },
  ] }),
  scenes: [oneBlock("s", [
    { id: "sn", type: "snippet", onEnter: [{ kind: "set", target: "@negz", value: "-@zero" }],
      beats: [{ id: "N", kind: "text" }], jump: { to: "END" } },
  ])],
  locales: [loc("s", { N: "{@small}|{@tiny}|{@huge}|{@big}|{@negz}" })],
  expectedTranscript: [{ type: "text", id: "N", text: "0.00005|1.5e-7|1e+21|123456789012|0" }, { type: "end" }],
} satisfies RuntimeFixture;

// Rule 7: an option's prompt beat carries tags like any beat: its own plus the option's (outermost first).
// Spoken back with replayPromptOnChoose, the prompt step shows them.
const rulePromptTags = {
  name: "rule: a replayed prompt carries its tags and the option's",
  project: project({}),
  engineOptions: { replayPromptOnChoose: true },
  scenes: [oneBlock("s", [
    { id: "g_ch", type: "group", selector: "choice", children: [
      { id: "o_ask", type: "group", tags: ["polite"], prompt: { id: "P_ask", kind: "line", character: "PC", tags: ["question"] }, children: [
        { id: "sn_ans", type: "snippet", beats: [{ id: "A", kind: "text" }], jump: { to: "END" } },
      ] },
    ] },
  ])],
  locales: [loc("s", { P_ask: "Where am I?", A: "Home." })],
  choices: ["o_ask"],
  expectedTranscript: [
    { type: "choice", groupId: "g_ch", options: [{ id: "o_ask", eligible: true, prompt: { kind: "line", text: "Where am I?", character: "PC" } }] },
    { type: "line", id: "P_ask", text: "Where am I?", character: "PC", tags: ["polite", "question"] },
    { type: "text", id: "A", text: "Home.", tags: ["polite"] },
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// Rule 8: a choice whose every remaining option is greyed out runs dry, as one with no options does: the
// fallback follows if there is one, otherwise the flow moves on. It used to be offered with nothing to take.
const ruleAllGreyedRunsDry = {
  name: "rule: a choice with every option greyed out runs dry (fallback, else move on)",
  project: rulesProject,
  scenes: [oneBlock("s", [
    { id: "g_fb", type: "group", selector: "choice", children: [
      { id: "sn_l1", type: "snippet", condition: "@met", choiceText: "Locked one", beats: [{ id: "L1", kind: "text" }] },
      { id: "sn_l2", type: "snippet", condition: "@met", choiceText: "Locked two", beats: [{ id: "L2", kind: "text" }] },
      { id: "sn_fb", type: "snippet", fallback: true, beats: [{ id: "FB", kind: "text" }] },
    ] },
    { id: "g_none", type: "group", selector: "choice", children: [
      { id: "sn_l3", type: "snippet", condition: "@met", choiceText: "Locked three", beats: [{ id: "L3", kind: "text" }] },
    ] },
    { id: "sn_after", type: "snippet", beats: [{ id: "AFTER", kind: "text" }], jump: { to: "END" } },
  ])],
  locales: [loc("s", { L1: "one", L2: "two", L3: "three", FB: "nothing for it", AFTER: "moving on" })],
  expectedTranscript: [{ type: "text", id: "FB", text: "nothing for it" }, { type: "text", id: "AFTER", text: "moving on" }, { type: "end" }],
} satisfies RuntimeFixture;

// Flow.reset (an alias of start) on all four runtimes: it forgets the flow's own state and anything waiting
// to be delivered, and begins again. Here the per-flow @mine counts entries to the opening, and a reset between
// choose() and the next advance() must not replay the abandoned run's prompt (it did on every runtime until
// 2026-10-06, when start cleared only the choice).
const scriptedResetFlow = {
  name: "resetFlow: forgets per-flow state and a chosen prompt still waiting, and begins again",
  project: project({ properties: [{ name: "mine", type: "number", default: 0, shared: false }] }),
  engineOptions: { replayPromptOnChoose: true },
  scenes: [
    { id: "scn_r", type: "scene", name: "Room", blocks: [{ id: "b_r", type: "block", name: "B", children: [
      { id: "sn_open", type: "snippet", onEnter: [{ kind: "set", target: "@mine", value: "@mine + 1" }],
        beats: [{ id: "OPEN", kind: "text" }] },
      { id: "g_r", type: "group", selector: "choice", children: [
        { id: "o_ask", type: "group", prompt: { id: "P_ask", kind: "line", character: "PC" }, children: [
          { id: "sn_ans", type: "snippet", beats: [{ id: "ANS", kind: "text" }], jump: { to: "END" } },
        ] },
      ] },
    ] }] },
  ],
  locales: [loc("scn_r", { OPEN: "opening {@mine}", P_ask: "Ask", ANS: "answer" })],
  script: [
    { op: "openFlow", flow: "f", scene: "room" },
    { op: "advance", expect: [{ type: "text", id: "OPEN", text: "opening 1" }] },
    { op: "advance", expect: [{ type: "choice", groupId: "g_r", options: [{ id: "o_ask", eligible: true, prompt: { kind: "line", text: "Ask", character: "PC" } }] }] },
    { op: "choose", id: "o_ask" },
    { op: "resetFlow" },
    { op: "advance", expect: [{ type: "text", id: "OPEN", text: "opening 1" }] },
  ],
} satisfies ScriptedFixture;

// The default start scene is the first AUTHORED scene (the bundle's key order, which is the project's
// nav order), never the first by id. Scene ids are random, so a runtime that sorts them opens a game on
// an arbitrary scene: Unreal kept its scenes in a sorted map and did exactly that (2026-10-06). The ids
// here sort the other way round from the authored order on purpose.
const scriptedDefaultStartScene = {
  name: "openFlow with no scene starts on the first authored scene, not the first by id",
  project: project({}),
  scenes: [
    { id: "scn_zz", type: "scene", name: "Tavern", blocks: [{ id: "b_t", type: "block", name: "B", children: [
      { id: "sn_t", type: "snippet", beats: [{ id: "T_t", kind: "text" }], jump: { to: "END" } },
    ] }] },
    { id: "scn_aa", type: "scene", name: "Gate", blocks: [{ id: "b_g", type: "block", name: "B", children: [
      { id: "sn_g", type: "snippet", beats: [{ id: "T_g", kind: "text" }], jump: { to: "END" } },
    ] }] },
  ],
  locales: [loc("scn_zz", { T_t: "tavern" }), loc("scn_aa", { T_g: "gate" })],
  script: [
    { op: "openFlow", flow: "f" },
    { op: "advance", expect: [{ type: "text", id: "T_t", text: "tavern" }] },
  ],
} satisfies ScriptedFixture;

// The project's start reaches the bundle (`bundle.start`), and a flow opened or reset without a scene starts
// there, at its block when it names one (the hands-on review, 2026-10: the start never reached the runtimes,
// so a game always opened on the first scene whatever the writer had chosen).
const scriptedProjectStart = {
  name: "openFlow and resetFlow with no scene start at the project's start scene and block",
  project: project({ start: { scene: "scn_aa", block: "b_g2" } }),
  scenes: [
    { id: "scn_zz", type: "scene", name: "Tavern", blocks: [{ id: "b_t", type: "block", name: "B", children: [
      { id: "sn_t", type: "snippet", beats: [{ id: "T_t", kind: "text" }], jump: { to: "END" } },
    ] }] },
    { id: "scn_aa", type: "scene", name: "Gate", blocks: [
      { id: "b_g", type: "block", name: "B", children: [
        { id: "sn_g", type: "snippet", beats: [{ id: "T_g", kind: "text" }], jump: { to: "END" } },
      ] },
      { id: "b_g2", type: "block", name: "Second", children: [
        { id: "sn_g2", type: "snippet", beats: [{ id: "T_g2", kind: "text" }], jump: { to: "END" } },
      ] },
    ] },
  ],
  locales: [loc("scn_zz", { T_t: "tavern" }), loc("scn_aa", { T_g: "gate", T_g2: "gate, second block" })],
  script: [
    { op: "openFlow", flow: "f" },
    { op: "advance", expect: [{ type: "text", id: "T_g2", text: "gate, second block" }] },
    { op: "resetFlow" },
    { op: "advance", expect: [{ type: "text", id: "T_g2", text: "gate, second block" }] },
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

// A rollback after a load keeps a scene's saved `@scene` values. After a load, a flow mounts bags only for
// the scenes it stands in; the rest wait in the registry, parked, until the flow enters them. Entering one
// inside a checkpoint claims them, and the rollback used to drop the claimed values with the bag, so the
// next real entry found the defaults (2026-10 review, all four runtimes). Door is per-flow, lamp shared.
const scriptedRollbackKeepsParked = {
  name: "checkpoint: a rollback after a load keeps the saved @scene values of a scene it entered",
  project: project({}),
  scenes: [
    { id: "scn_yard", type: "scene", name: "Yard", blocks: [{ id: "b_yard", type: "block", name: "Yard", children: [
      { id: "sn_yard", type: "snippet", beats: [{ id: "Y", kind: "text" }], jump: { to: "END" } },
    ] }] },
    { id: "scn_shed", type: "scene", name: "Shed",
      sceneProps: [
        { name: "doorOpen", type: "boolean", default: false },
        { name: "lampLit", type: "boolean", default: false, shared: true },
      ],
      blocks: [{ id: "b_shed", type: "block", name: "Shed", children: [
        { id: "g_shed", type: "group", selector: "branch", children: [
          { id: "sn_known", type: "snippet", condition: "@scene.doorOpen and @scene.lampLit", beats: [{ id: "K", kind: "text" }], jump: { to: "END" } },
          { id: "sn_first", type: "snippet",
            onEnter: [
              { kind: "set", target: "@scene.doorOpen", value: "true" },
              { kind: "set", target: "@scene.lampLit", value: "true" },
            ],
            beats: [{ id: "F", kind: "text" }], jump: { to: "END" } },
        ] },
      ] }] },
  ],
  locales: [loc("scn_yard", { Y: "yard" }), loc("scn_shed", { K: "as you left it", F: "you open up" })],
  script: [
    { op: "openFlow", flow: "f", scene: "yard" },
    { op: "advance", expect: [{ type: "text", id: "Y", text: "yard" }] },
    { op: "goto", scene: "shed", expectResult: true },
    { op: "advance", expect: [{ type: "text", id: "F", text: "you open up" }] },
    { op: "goto", scene: "yard", expectResult: true },
    { op: "advance", expect: [{ type: "text", id: "Y", text: "yard" }] },
    { op: "saveLoad" },
    { op: "useFlow", flow: "f" },
    { op: "checkpoint" },
    { op: "goto", scene: "shed", expectResult: true },
    { op: "advance", expect: [{ type: "text", id: "K", text: "as you left it" }] },
    { op: "rollback" },
    { op: "goto", scene: "shed", expectResult: true },
    { op: "advance", expect: [{ type: "text", id: "K", text: "as you left it" }] },
  ],
} satisfies ScriptedFixture;

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

const scriptedEscapedEmojiSaveLoad = {
  name: "save/load keeps an emoji property value, escaped as a surrogate pair in the save",
  project: project({ properties: [{ name: "mood", type: "string", shared: true, default: "calm" }] }),
  scenes: [{ id: "s", type: "scene", name: "S", blocks: [
    { id: "b", type: "block", name: "B", children: [
      { id: "one", type: "snippet", beats: [{ id: "T1", kind: "text" }],
        onEnter: [{ kind: "set", target: "@mood", value: '"\u{1F642}"' }] },
      { id: "two", type: "snippet", beats: [{ id: "T2", kind: "text" }], jump: { to: "END" } },
    ] },
  ] }],
  locales: [loc("s", { T1: "mood={@mood}", T2: "still {@mood}" })],
  script: [
    { op: "openFlow", flow: "main", scene: "s" },
    { op: "advance", expect: [{ type: "text", id: "T1", text: "mood=\u{1F642}" }] },
    { op: "saveLoad" }, // the value comes back from the save
    { op: "advance", expect: [{ type: "text", id: "T2", text: "still \u{1F642}" }] },
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
// follows the swap, and that a locale the bundle doesn't have falls back to the default, reported and marked
// <Untranslated> (the one locale rule: scriptedLocaleRule).
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
    { op: "setLocale", locale: "de" },                                          // not in the bundle -> the default, flagged
    { op: "expectErrors", expectResult: [{ kind: "setup", node: "de", flow: "" }] },
    { op: "expectLocale", expectResult: { locale: "en", default: "en", included: ["en", "fr"] } },
    { op: "advance", expect: [{ type: "text", id: "T2", text: "<Untranslated: T2> Second." }] },
    { op: "advance", expect: [{ type: "end" }] },
  ],
} satisfies ScriptedFixture;

// Closed captions (#214): with captions OFF, a DIALOGUE line's caption cues (between the bundle's
// delimiters) + the surrounding whitespace are stripped; text and everything else are
// untouched. The toggle is live (setClosedCaptions) and not save state. Proves both directions, the
// line-vs-text distinction, a line-kind choice prompt, and the baked custom-default delimiter pair.
const scriptedClosedCaptions = {
  name: "closed captions off strips dialogue-line cues (not text); live toggle, no state change",
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
    { op: "advance", expect: [{ type: "text", id: "T1", text: "A door slams. (off-screen)" }] }, // text kept
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

// --- speaker qualifiers ---------------------------------------------------------------------------------
// A line's speaker qualifier (`TAM (O.S.)`) rides on its step as the qualifier's `gameId` and its resolved
// shown name, beside `character` and `characterName`; a line prompt carries them too. The project here
// declares no list, so it has the defaults (V.O. / O.S. / RADIO), and a line with none carries neither field.
const qualifierScenes: Scene[] = [{ id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
  { id: "sn", type: "snippet", beats: [
    { id: "L_think", kind: "line", character: "TAM", qualifier: "vo" },
    { id: "L_door", kind: "line", character: "TAM", qualifier: "os", direction: "muffled" },
    { id: "L_plain", kind: "line", character: "TAM" },
  ] },
  { id: "g_radio", type: "group", selector: "choice", children: [
    { id: "o_call", type: "group", prompt: { id: "P_call", kind: "line", character: "TAM", qualifier: "radio" }, children: [
      { id: "call_c", type: "snippet", beats: [{ id: "L_reply", kind: "line", character: "BASE", qualifier: "radio" }], jump: { to: "END" } },
    ] },
  ] },
] }] }];
const qualifierLocales = [loc("s", { L_think: "Too quiet.", L_door: "Who's there?", L_plain: "Hello.", P_call: "Base, come in.", L_reply: "Reading you." })];
const speakerQualifiers = {
  name: "a line carries its speaker qualifier's gameId and shown name; a line prompt does too",
  project: project({ cast: [{ name: "TAM", displayName: "Tam" }, { name: "BASE" }] }),
  scenes: qualifierScenes,
  locales: qualifierLocales,
  choices: ["o_call"],
  expectedTranscript: [
    { type: "line", id: "L_think", text: "Too quiet.", character: "TAM", characterName: "Tam", qualifier: "vo", qualifierName: "V.O.", speakerLabel: "Tam (V.O.)" },
    { type: "line", id: "L_door", text: "Who's there?", character: "TAM", characterName: "Tam", direction: "muffled", qualifier: "os", qualifierName: "O.S.", speakerLabel: "Tam (O.S.)" },
    { type: "line", id: "L_plain", text: "Hello.", character: "TAM", characterName: "Tam" }, // none: neither field
    { type: "choice", groupId: "g_radio", options: [
      { id: "o_call", prompt: { kind: "line", text: "Base, come in.", character: "TAM", characterName: "Tam", qualifier: "radio", qualifierName: "RADIO", speakerLabel: "Tam (RADIO)" }, eligible: true },
    ] },
    { type: "line", id: "L_reply", text: "Reading you.", character: "BASE", qualifier: "radio", qualifierName: "RADIO", speakerLabel: "BASE (RADIO)" },
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// The project's own list: a renamed qualifier shows its authored name, and the active locale's
// `qualifier:<gameId>` string (the `@project` shard) wins over it; one the locale lacks falls back to the
// default locale's string, then the authored name.
const speakerQualifiersLocale = {
  name: "a qualifier's shown name follows the active locale, then the default locale, then its authored name",
  project: project({
    cast: [{ name: "TAM" }],
    locales: { default: "en", all: ["en", "fr"] },
    qualifiers: [{ gameId: "vo", name: "VO" }, { gameId: "phone", name: "PHONE" }, { gameId: "os", name: "O.S." }],
  }),
  scenes: [{ id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "sn", type: "snippet", beats: [
      { id: "L_vo", kind: "line", character: "TAM", qualifier: "vo" },
      { id: "L_phone", kind: "line", character: "TAM", qualifier: "phone" },
      { id: "L_os", kind: "line", character: "TAM", qualifier: "os" },
    ], jump: { to: "END" } },
  ] }] }],
  locales: [
    loc("s", { L_vo: "Hm.", L_phone: "Hello?", L_os: "Coming!" }),
    loc("s", { L_vo: "Hm.", L_phone: "Allo ?", L_os: "J'arrive !" }, "fr"),
    loc("@project", { [qualifierStringKey("phone")]: "TELEPHONE" }),         // en (default)
    loc("@project", { [qualifierStringKey("vo")]: "VOIX OFF" }, "fr"),        // fr
  ],
  locale: "fr",
  expectedTranscript: [
    { type: "line", id: "L_vo", text: "Hm.", character: "TAM", qualifier: "vo", qualifierName: "VOIX OFF", speakerLabel: "TAM (VOIX OFF)" },        // fr string
    { type: "line", id: "L_phone", text: "Allo ?", character: "TAM", qualifier: "phone", qualifierName: "TELEPHONE", speakerLabel: "TAM (TELEPHONE)" }, // default-locale string
    { type: "line", id: "L_os", text: "J'arrive !", character: "TAM", qualifier: "os", qualifierName: "O.S.", speakerLabel: "TAM (O.S.)" },       // authored name
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// IDs-only: the `qualifier` gameId is still emitted (the game switches on it); its shown name is omitted,
// as the character name is, for the game to localise.
const speakerQualifiersIds = {
  name: "IDs-only build emits the qualifier gameId and omits its shown name",
  project: project({ cast: [{ name: "TAM", displayName: "Tam" }] }),
  scenes: qualifierScenes,
  locales: qualifierLocales,
  idsOnly: true,
  choices: ["o_call"],
  expectedTranscript: [
    { type: "line", id: "L_think", text: "L_think", character: "TAM", qualifier: "vo" },
    { type: "line", id: "L_door", text: "L_door", character: "TAM", direction: "muffled", qualifier: "os" },
    { type: "line", id: "L_plain", text: "L_plain", character: "TAM" },
    { type: "choice", groupId: "g_radio", options: [
      { id: "o_call", prompt: { kind: "line", text: "P_call", character: "TAM", qualifier: "radio" }, eligible: true },
    ] },
    { type: "line", id: "L_reply", text: "L_reply", character: "BASE", qualifier: "radio" },
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// A line that goes silent with captions off (the caption character's) drops its speaker fields, the
// qualifier with them: no caption shows, so there is nothing to qualify.
const speakerQualifiersSilent = {
  name: "a line silenced by closed captions drops its qualifier with its speaker",
  project: project({ cast: [{ name: "SFX" }, { name: "TAM" }] }),
  scenes: [{ id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "sn", type: "snippet", beats: [
      { id: "L_sfx", kind: "line", character: "SFX", qualifier: "os" },
      { id: "L_tam", kind: "line", character: "TAM", qualifier: "os" },
    ], jump: { to: "END" } },
  ] }] }],
  locales: [loc("s", { L_sfx: "(a door slams)", L_tam: "Sorry!" })],
  engineOptions: { closedCaptions: false },
  expectedTranscript: [
    { type: "line", id: "L_sfx", text: "" },
    { type: "line", id: "L_tam", text: "Sorry!", character: "TAM", qualifier: "os", qualifierName: "O.S.", speakerLabel: "TAM (O.S.)" },
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// replayPromptOnChoose with a save between choose and advance: the pending choice's options and the
// prompt to speak back both keep the qualifier through the save.
const scriptedQualifierSaveLoad = {
  name: "a qualified line prompt keeps its qualifier through a save, pending and spoken back",
  project: project({ cast: [{ name: "TAM", displayName: "Tam" }, { name: "BASE" }] }),
  scenes: qualifierScenes,
  locales: qualifierLocales,
  engineOptions: { replayPromptOnChoose: true },
  script: [
    { op: "openFlow", flow: "main", scene: "s" },
    { op: "advance", expect: [{ type: "line", id: "L_think", text: "Too quiet.", character: "TAM", characterName: "Tam", qualifier: "vo", qualifierName: "V.O.", speakerLabel: "Tam (V.O.)" }] },
    { op: "advance", expect: [{ type: "line", id: "L_door", text: "Who's there?", character: "TAM", characterName: "Tam", direction: "muffled", qualifier: "os", qualifierName: "O.S.", speakerLabel: "Tam (O.S.)" }] },
    { op: "advance", expect: [{ type: "line", id: "L_plain", text: "Hello.", character: "TAM", characterName: "Tam" }] },
    { op: "advance", expect: [{ type: "choice", groupId: "g_radio", options: [
      { id: "o_call", prompt: { kind: "line", text: "Base, come in.", character: "TAM", characterName: "Tam", qualifier: "radio", qualifierName: "RADIO", speakerLabel: "Tam (RADIO)" }, eligible: true },
    ] }] },
    { op: "saveLoad" }, // at the pending choice
    { op: "advance", expect: [{ type: "choice", groupId: "g_radio", options: [
      { id: "o_call", prompt: { kind: "line", text: "Base, come in.", character: "TAM", characterName: "Tam", qualifier: "radio", qualifierName: "RADIO", speakerLabel: "Tam (RADIO)" }, eligible: true },
    ] }] },
    { op: "choose", id: "o_call" },
    { op: "saveLoad" }, // the prompt is still to be spoken back
    { op: "advance", expect: [{ type: "line", id: "P_call", text: "Base, come in.", character: "TAM", characterName: "Tam", qualifier: "radio", qualifierName: "RADIO", speakerLabel: "Tam (RADIO)" }] },
    { op: "advance", expect: [{ type: "line", id: "L_reply", text: "Reading you.", character: "BASE", qualifier: "radio", qualifierName: "RADIO", speakerLabel: "BASE (RADIO)" }] },
    { op: "advance", expect: [{ type: "end" }] },
  ],
} satisfies ScriptedFixture;

// --- speaker labels ------------------------------------------------------------------------------
// A line carries `speakerLabel`, the name to show for its speaker: with a qualifier, the character's own label
// for that pair if the project overrides it, else the speaker pattern filled with the shown name and the
// qualifier's shown name; with none, the shown name. Each piece follows the active locale, then the default, then
// the authored value. A pair's translated label counts only when the project overrides that pair. (Transcripts
// record the label only where it differs from the name an unqualified line shows.)
const speakerLabelScenes: Scene[] = [{ id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
  { id: "sn", type: "snippet", beats: [
    { id: "L_think", kind: "line", character: "PLAYER", qualifier: "vo" },  // overridden pair
    { id: "L_call", kind: "line", character: "PLAYER", qualifier: "os" },   // the pattern
    { id: "L_tam", kind: "line", character: "TAM", qualifier: "vo" },       // the pattern, a name with no translation
    { id: "L_plain", kind: "line", character: "PLAYER" },                   // no qualifier: the shown name
  ] },
  { id: "g", type: "group", selector: "choice", children: [
    { id: "o_wonder", type: "group", prompt: { id: "P_wonder", kind: "line", character: "PLAYER", qualifier: "vo" }, children: [
      { id: "w_c", type: "snippet", beats: [], jump: { to: "END" } },
    ] },
  ] },
] }] }];
const speakerLabelProject = (speakerPattern?: string): ReturnType<typeof project> => project({
  cast: [{ name: "PLAYER", displayName: "You", qualifierLabels: { vo: "Your thoughts" } }, { name: "TAM", displayName: "Tam" }],
  locales: { default: "en", all: ["en", "fr"] },
  ...(speakerPattern !== undefined ? { speakerPattern } : {}),
});
const speakerLabelLocales = [
  loc("s", { L_think: "Quiet.", L_call: "Hello?", L_tam: "Hm.", L_plain: "Right.", P_wonder: "Wonder." }),
  loc("s", { L_think: "Calme.", L_call: "Allo ?", L_tam: "Hm.", L_plain: "Bon.", P_wonder: "Songer." }, "fr"),
  loc("@project", {
    [castStringKey("PLAYER")]: "Vous", [qualifierStringKey("os")]: "H.C.",
    [SPEAKER_PATTERN_KEY]: "{qualifier} : {name}",                // the order changes in French
    [speakerLabelKey("PLAYER", "vo")]: "Vos pensées",             // the overridden pair, translated
    [speakerLabelKey("TAM", "vo")]: "IGNORED",                    // a pair the project doesn't override: not used
  }, "fr"),
];

const speakerLabels = {
  name: "a line's speaker label: a pair's own label, else the speaker pattern, else with no qualifier the shown name",
  project: speakerLabelProject(),
  scenes: speakerLabelScenes,
  locales: speakerLabelLocales,
  expectedTranscript: [
    { type: "line", id: "L_think", text: "Quiet.", character: "PLAYER", characterName: "You", qualifier: "vo", qualifierName: "V.O.", speakerLabel: "Your thoughts" },
    { type: "line", id: "L_call", text: "Hello?", character: "PLAYER", characterName: "You", qualifier: "os", qualifierName: "O.S.", speakerLabel: "You (O.S.)" },
    { type: "line", id: "L_tam", text: "Hm.", character: "TAM", characterName: "Tam", qualifier: "vo", qualifierName: "V.O.", speakerLabel: "Tam (V.O.)" },
    { type: "line", id: "L_plain", text: "Right.", character: "PLAYER", characterName: "You" },
    { type: "choice", groupId: "g", options: [
      { id: "o_wonder", prompt: { kind: "line", text: "Wonder.", character: "PLAYER", characterName: "You", qualifier: "vo", qualifierName: "V.O.", speakerLabel: "Your thoughts" }, eligible: true },
    ] },
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// In French: the translated pattern, names, and overridden pair; a name the locale lacks falls back to the
// default locale's, and a pair the project doesn't override follows the pattern, whatever the locale holds.
const speakerLabelsLocale = {
  name: "a speaker label follows the active locale: the translated pattern, names, and overridden pair",
  project: speakerLabelProject(),
  scenes: speakerLabelScenes,
  locales: speakerLabelLocales,
  locale: "fr",
  expectedTranscript: [
    { type: "line", id: "L_think", text: "Calme.", character: "PLAYER", characterName: "Vous", qualifier: "vo", qualifierName: "V.O.", speakerLabel: "Vos pensées" },
    { type: "line", id: "L_call", text: "Allo ?", character: "PLAYER", characterName: "Vous", qualifier: "os", qualifierName: "H.C.", speakerLabel: "H.C. : Vous" },
    { type: "line", id: "L_tam", text: "Hm.", character: "TAM", characterName: "Tam", qualifier: "vo", qualifierName: "V.O.", speakerLabel: "V.O. : Tam" },
    { type: "line", id: "L_plain", text: "Bon.", character: "PLAYER", characterName: "Vous" },
    { type: "choice", groupId: "g", options: [
      { id: "o_wonder", prompt: { kind: "line", text: "Songer.", character: "PLAYER", characterName: "Vous", qualifier: "vo", qualifierName: "V.O.", speakerLabel: "Vos pensées" }, eligible: true },
    ] },
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// A project's own pattern is the fallback for a locale that doesn't translate it; a live language switch
// changes the labels from the next line on.
const scriptedSpeakerLabelsSetLocale = {
  name: "a project's own speaker pattern, and labels that follow a live setLocale",
  project: speakerLabelProject("{name}, {qualifier}"),
  scenes: speakerLabelScenes,
  locales: [speakerLabelLocales[0]!, speakerLabelLocales[1]!, loc("@project", { [castStringKey("PLAYER")]: "Vous" }, "fr")],
  script: [
    { op: "openFlow", flow: "main", scene: "s" },
    { op: "advance", expect: [{ type: "line", id: "L_think", text: "Quiet.", character: "PLAYER", characterName: "You", qualifier: "vo", qualifierName: "V.O.", speakerLabel: "Your thoughts" }] },
    { op: "advance", expect: [{ type: "line", id: "L_call", text: "Hello?", character: "PLAYER", characterName: "You", qualifier: "os", qualifierName: "O.S.", speakerLabel: "You, O.S." }] },
    { op: "setLocale", locale: "fr" },
    { op: "advance", expect: [{ type: "line", id: "L_tam", text: "Hm.", character: "TAM", characterName: "Tam", qualifier: "vo", qualifierName: "V.O.", speakerLabel: "Tam, V.O." }] },
    { op: "advance", expect: [{ type: "line", id: "L_plain", text: "Bon.", character: "PLAYER", characterName: "Vous" }] },
    { op: "advance", expect: [{ type: "choice", groupId: "g", options: [
      { id: "o_wonder", prompt: { kind: "line", text: "Songer.", character: "PLAYER", characterName: "Vous", qualifier: "vo", qualifierName: "V.O.", speakerLabel: "Your thoughts" }, eligible: true },
    ] }] },                                                                        // the pair isn't translated: the source label
  ],
} satisfies ScriptedFixture;

// --- the step a flow would deliver, by beat id (Flow.stepFor) ------------------------------------------
// A game that keeps lines by id shows them again (after a load, or a language switch) as `advance` would give
// them now, built by the same function: the active locale, interpolation against the flow, closed captions, a
// silenced line, and the speaker's names and label. Nothing moves: asking twice, or before the line plays, changes
// nothing, and `advance` then gives the same step.
const stepForProject = project({
  cast: [{ name: "PLAYER", displayName: "You", qualifierLabels: { vo: "Your thoughts" } }, { name: "TAM", displayName: "Tam" }, { name: "SFX" }],
  locales: { default: "en", all: ["en", "fr"] },
  properties: [{ name: "gold", type: "number", default: 3 }],
});
const stepForScenes: Scene[] = [{ id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
  { id: "sn", type: "snippet", beats: [
    { id: "L_think", kind: "line", character: "PLAYER", qualifier: "vo" },
    { id: "L_tam", kind: "line", character: "TAM", qualifier: "os" },
    { id: "T_gold", kind: "text" },
    { id: "L_sfx", kind: "line", character: "SFX" },
    { id: "L_plain", kind: "line", character: "PLAYER" },
  ] },
  { id: "g", type: "group", selector: "choice", children: [
    { id: "o_go", type: "group", prompt: { id: "P_go", kind: "line", character: "PLAYER", qualifier: "vo" }, children: [
      { id: "go_c", type: "snippet", beats: [], jump: { to: "END" } },
    ] },
  ] },
] }] }];
const stepForLocales = [
  loc("s", { L_think: "Quiet. {@gold} left.", L_tam: "Hm. [sighs]", T_gold: "Gold: {@gold}.", L_sfx: "[a door slams]", L_plain: "Right.", P_go: "Go." }),
  loc("s", { L_think: "Calme. Il en reste {@gold}.", L_tam: "Hm. [soupir]", T_gold: "Or : {@gold}.", L_sfx: "[une porte claque]", L_plain: "Bon.", P_go: "Allons-y." }, "fr"),
  loc("@project", { [castStringKey("PLAYER")]: "Vous", [speakerLabelKey("PLAYER", "vo")]: "Vos pensées" }, "fr"),
];
const stepThink: TranscriptStep = { type: "line", id: "L_think", text: "Quiet. 3 left.", character: "PLAYER", characterName: "You", qualifier: "vo", qualifierName: "V.O.", speakerLabel: "Your thoughts" };

const scriptedStepFor = {
  name: "stepFor gives the step a flow would deliver for a beat now, and moves nothing",
  project: stepForProject,
  scenes: stepForScenes,
  locales: stepForLocales,
  script: [
    { op: "openFlow", flow: "main", scene: "s" },
    { op: "stepFor", beat: "L_think", expect: [stepThink] },                       // before it plays
    { op: "stepFor", beat: "L_think", expect: [stepThink] },                       // asking again changes nothing
    { op: "stepFor", beat: "T_gold", expect: [{ type: "text", id: "T_gold", text: "Gold: 3." }] },
    { op: "stepFor", beat: "P_go", expect: [{ type: "line", id: "P_go", text: "Go.", character: "PLAYER", characterName: "You", qualifier: "vo", qualifierName: "V.O.", speakerLabel: "Your thoughts" }] },
    { op: "stepFor", beat: "o_go", expect: [] },                                   // an option, not a beat: none
    { op: "stepFor", beat: "nope", expect: [] },
    { op: "advance", expect: [stepThink] },                                        // advance gives the same step
    { op: "setLocale", locale: "fr" },
    { op: "stepFor", beat: "L_think", expect: [{ type: "line", id: "L_think", text: "Calme. Il en reste 3.", character: "PLAYER", characterName: "Vous", qualifier: "vo", qualifierName: "V.O.", speakerLabel: "Vos pensées" }] },
    { op: "stepFor", beat: "L_tam", expect: [{ type: "line", id: "L_tam", text: "Hm. [soupir]", character: "TAM", characterName: "Tam", qualifier: "os", qualifierName: "O.S.", speakerLabel: "Tam (O.S.)" }] },
    { op: "setClosedCaptions", on: false },
    { op: "stepFor", beat: "L_tam", expect: [{ type: "line", id: "L_tam", text: "Hm.", character: "TAM", characterName: "Tam", qualifier: "os", qualifierName: "O.S.", speakerLabel: "Tam (O.S.)" }] },
    { op: "stepFor", beat: "L_sfx", expect: [{ type: "line", id: "L_sfx", text: "" }] }, // silenced: no speaker
    { op: "advance", expect: [{ type: "line", id: "L_tam", text: "Hm.", character: "TAM", characterName: "Tam", qualifier: "os", qualifierName: "O.S.", speakerLabel: "Tam (O.S.)" }] },
    { op: "stepFor", beat: "L_plain", expect: [{ type: "line", id: "L_plain", text: "Bon.", character: "PLAYER", characterName: "Vous" }] },
  ],
} satisfies ScriptedFixture;

// A voiced project's lines are static, so stepFor doesn't interpolate them either; text beats still do. In an
// IDs-only build the step carries the beat's id and no names, as a delivered one does.
const scriptedStepForVoiced = {
  name: "stepFor follows a voiced project's static lines",
  project: { ...stepForProject, voiced: true },
  scenes: stepForScenes,
  locales: stepForLocales,
  script: [
    { op: "openFlow", flow: "main", scene: "s" },
    { op: "stepFor", beat: "L_think", expect: [{ ...stepThink, text: "Quiet. {@gold} left." }] },
    { op: "stepFor", beat: "T_gold", expect: [{ type: "text", id: "T_gold", text: "Gold: 3." }] },
  ],
} satisfies ScriptedFixture;

const scriptedStepForIds = {
  name: "stepFor in an IDs-only build gives the beat's id and no names",
  project: stepForProject,
  scenes: stepForScenes,
  locales: stepForLocales,
  idsOnly: true,
  script: [
    { op: "openFlow", flow: "main", scene: "s" },
    { op: "stepFor", beat: "L_think", expect: [{ type: "line", id: "L_think", text: "L_think", character: "PLAYER", qualifier: "vo" }] },
    { op: "advance", expect: [{ type: "line", id: "L_think", text: "L_think", character: "PLAYER", qualifier: "vo" }] },
  ],
} satisfies ScriptedFixture;

// --- line padding -----------------------------------------------------------------------------------
// A line or text step carries `padAfter`, the pause after it in seconds: its own, else the nearest
// `padAfterDefault` above it (snippet, each group innermost first, block, scene), else the project's, else the
// built-in 0.6. A snippet's last line or text beat is clamped to zero or more: what follows the seam isn't
// certain, so nothing can cut in on it. A negative pause before a game event stands (the event starts as the
// line ends). A game event carries no pause of its own, and doesn't count as a snippet's last line.
// (Transcripts record `padAfter` only when it isn't the built-in 0.6.)
const linePadding = {
  name: "a step carries its pause: its own, else the nearest default, else the project's; only a snippet's last line is never negative",
  project: project({ cast: [{ name: "TAM" }], padAfterDefault: 1 }),
  scenes: [{ id: "s", type: "scene", name: "S", padAfterDefault: 2, blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "g", type: "group", padAfterDefault: 0.3, children: [
      { id: "sn1", type: "snippet", padAfterDefault: -0.2, beats: [
        { id: "L_own", kind: "line", character: "TAM", padAfter: -0.5 },  // own: a cut-in, mid-snippet
        { id: "L_snip", kind: "line", character: "TAM" },                 // the snippet's default
        { id: "T_last", kind: "text", padAfter: -1 },                     // the last line or text beat: clamped
        { id: "E_after", kind: "gameEvent", gameData: { cue: "door" } },  // no pause, and not the last line
      ] },
      { id: "sn_ev", type: "snippet", beats: [
        { id: "L_cross", kind: "line", character: "TAM", padAfter: -0.4 }, // a game event next: it stands
        { id: "E_mid", kind: "gameEvent", gameData: { cue: "bell" } },
        { id: "L_after", kind: "line", character: "TAM" },                // the group's default
      ] },
      { id: "sn2", type: "snippet", beats: [
        { id: "L_group", kind: "line", character: "TAM" },                // the group's default
        { id: "L_zero", kind: "line", character: "TAM", padAfter: 0.6 },  // own, equal to the built-in
      ] },
    ] },
    { id: "sn3", type: "snippet", beats: [{ id: "L_scene", kind: "line", character: "TAM" }], jump: { to: "s2" } }, // the scene's
  ] }] }, { id: "s2", type: "scene", name: "S2", blocks: [{ id: "b2", type: "block", name: "B2", children: [
    { id: "sn4", type: "snippet", beats: [{ id: "T_project", kind: "text" }], jump: { to: "END" } },          // the project's
  ] }] }],
  locales: [loc("s", { L_own: "One", L_snip: "Two", T_last: "Three", L_cross: "Wait", L_after: "Ding", L_group: "Four", L_zero: "Five", L_scene: "Six" }), loc("s2", { T_project: "Seven" })],
  expectedTranscript: [
    { type: "line", id: "L_own", text: "One", character: "TAM", padAfter: -0.5 },
    { type: "line", id: "L_snip", text: "Two", character: "TAM", padAfter: -0.2 },
    { type: "text", id: "T_last", text: "Three", padAfter: 0 },
    { type: "gameEvent", id: "E_after", gameData: { cue: "door" } },
    { type: "line", id: "L_cross", text: "Wait", character: "TAM", padAfter: -0.4 },
    { type: "gameEvent", id: "E_mid", gameData: { cue: "bell" } },
    { type: "line", id: "L_after", text: "Ding", character: "TAM", padAfter: 0.3 },
    { type: "line", id: "L_group", text: "Four", character: "TAM", padAfter: 0.3 },
    { type: "line", id: "L_zero", text: "Five", character: "TAM" },
    { type: "line", id: "L_scene", text: "Six", character: "TAM", padAfter: 2 },
    { type: "text", id: "T_project", text: "Seven", padAfter: 1 },
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// An option's spoken prompt is the head of its option's run, so its pause times the reply and may be negative
// (the reply cuts in on the question); it resolves through the option. The choice carries each prompt's pause
// too, for a game that voices the prompts itself. A line silenced by closed captions still fires, so it still
// carries its pause.
const linePaddingPrompt = {
  name: "a spoken prompt's pause resolves through its option and is never clamped; a silenced line keeps its pause",
  project: project({ cast: [{ name: "TAM" }, { name: "SFX" }] }),
  scenes: [{ id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "sn0", type: "snippet", beats: [{ id: "L_sfx", kind: "line", character: "SFX", padAfter: 1.5 }], jump: { to: "b_ask" } },
  ] }, { id: "b_ask", type: "block", name: "Ask", children: [
    { id: "g_ask", type: "group", selector: "choice", children: [
      { id: "o_cut", type: "group", prompt: { id: "P_cut", kind: "line", character: "TAM", padAfter: -0.4 }, children: [
        { id: "cut_c", type: "snippet", beats: [{ id: "T_reply", kind: "text" }], jump: { to: "b_ask" } },
      ] },
      { id: "o_wait", type: "group", padAfterDefault: 3, prompt: { id: "P_wait", kind: "text" }, children: [
        { id: "wait_c", type: "snippet", jump: { to: "END" } },
      ] },
    ] },
  ] }] }],
  locales: [loc("s", { L_sfx: "(a door slams)", P_cut: "Who's there?", T_reply: "Me!", P_wait: "Wait" })],
  engineOptions: { replayPromptOnChoose: true, closedCaptions: false },
  choices: ["o_cut", "o_wait"],
  expectedTranscript: [
    { type: "line", id: "L_sfx", text: "", padAfter: 1.5 },
    { type: "choice", groupId: "g_ask", options: [
      { id: "o_cut", prompt: { kind: "line", text: "Who's there?", character: "TAM", padAfter: -0.4 }, eligible: true },
      { id: "o_wait", prompt: { kind: "text", text: "Wait", padAfter: 3 }, eligible: true },
    ] },
    { type: "line", id: "P_cut", text: "Who's there?", character: "TAM", padAfter: -0.4 },
    { type: "text", id: "T_reply", text: "Me!" },                               // the built-in default
    { type: "choice", groupId: "g_ask", options: [
      { id: "o_wait", prompt: { kind: "text", text: "Wait", padAfter: 3 }, eligible: true },
    ] },
    { type: "text", id: "P_wait", text: "Wait", padAfter: 3 },
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// --- action text (patterkit design/proposals/action-text.md) -------------------------------------------
// A dialogue scene (a line naming a character) in a project that doesn't localise its text: its text beats
// are action, `action: true` on the step, the source text in every locale whatever a translated shard still
// holds, with their own pause. An option's prompt is still localised, text or line. A scene with no named
// speaker is a text scene, localised and shown as before.
const actionScenes: Scene[] = [{ id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
  { id: "sn", type: "snippet", beats: [
    { id: "T_turn", kind: "text", padAfter: 1.25 },
    { id: "L_mara", kind: "line", character: "MARA" },
    { id: "T_gone", kind: "text" },
  ], jump: { to: "b_ask" } },
] }, { id: "b_ask", type: "block", name: "Ask", children: [
  { id: "g_ask", type: "group", selector: "choice", children: [
    { id: "o_go", type: "group", prompt: { id: "P_go", kind: "text" }, children: [
      { id: "go_c", type: "snippet", jump: { to: "s2" } },
    ] },
  ] },
] }] }, { id: "s2", type: "scene", name: "S2", blocks: [{ id: "b2", type: "block", name: "B2", children: [
  { id: "sn2", type: "snippet", beats: [
    { id: "T_page", kind: "text" },
    { id: "L_none", kind: "line" },
  ], jump: { to: "END" } },
] }] }];
const actionLocales: LocaleFile[] = [
  loc("s", { T_turn: "MARA turns away.", L_mara: "Leave it.", T_gone: "She's gone.", P_go: "Follow" }),
  loc("s", { T_turn: "MARA se détourne.", L_mara: "Laisse.", P_go: "Suivre" }, "fr"), // T_turn's old translation
  loc("s2", { T_page: "The page is blank.", L_none: "A voice." }),
  loc("s2", { T_page: "La page est blanche.", L_none: "Une voix." }, "fr"),
];
const actionText = {
  name: "a dialogue scene's text is action: action: true, the source text in every locale, its own pause; prompts and text scenes are localised",
  project: project({ cast: [{ name: "MARA" }], locales: { default: "en", all: ["en", "fr"] }, localiseDialogueText: undefined }), // the default
  scenes: actionScenes,
  locales: actionLocales,
  locale: "fr",
  choices: ["o_go"],
  expectedTranscript: [
    { type: "text", id: "T_turn", text: "MARA turns away.", padAfter: 1.25, action: true }, // its translation is ignored
    { type: "line", id: "L_mara", text: "Laisse.", character: "MARA" },
    { type: "text", id: "T_gone", text: "She's gone.", action: true },                     // no "<Untranslated>"
    { type: "choice", groupId: "g_ask", options: [
      { id: "o_go", prompt: { kind: "text", text: "Suivre" }, eligible: true },            // a prompt is localised
    ] },
    { type: "text", id: "T_page", text: "La page est blanche." },                          // a text scene: shown
    { type: "line", id: "L_none", text: "Une voix." },                                      // names no one
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// The same project with "Localise text lines in dialogue scenes" on: the dialogue scene's text is shown text,
// localised, with no `action`.
const actionTextLocalised = {
  name: "with localiseDialogueText on, a dialogue scene's text is localised and shown, not action",
  project: project({ cast: [{ name: "MARA" }], locales: { default: "en", all: ["en", "fr"] }, localiseDialogueText: true }),
  scenes: actionScenes,
  locales: actionLocales,
  locale: "fr",
  choices: ["o_go"],
  expectedTranscript: [
    { type: "text", id: "T_turn", text: "MARA se détourne.", padAfter: 1.25 },
    { type: "line", id: "L_mara", text: "Laisse.", character: "MARA" },
    { type: "text", id: "T_gone", text: "<Untranslated: T_gone> She's gone." },
    { type: "choice", groupId: "g_ask", options: [
      { id: "o_go", prompt: { kind: "text", text: "Suivre" }, eligible: true },
    ] },
    { type: "text", id: "T_page", text: "La page est blanche." },
    { type: "line", id: "L_none", text: "Une voix." },                                      // names no one
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// --- a flow taken out and put back (captureFlow / restoreFlow) ------------------------------------------
// A captured flow is its save snapshot plus its OWN property values (its @patter locals and its own @scene
// bag), without its id: closed at once, restored later under another id, it carries on exactly where it was,
// with its own values, while shared state (here @bell and the scene's shared @scene.tally) keeps whatever the
// other flows did meanwhile: a restore never rewinds anything but the flow itself. Captured mid-snippet and
// again at a pending choice. The state goes through JSON between capture and restore.
const flowStateScenes: Scene[] = [{
  id: "s", type: "scene", name: "S",
  sceneProps: [
    { name: "mine", type: "number", default: 0, shared: false },
    { name: "tally", type: "number", default: 0, shared: true },
  ],
  blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "sn1", type: "snippet",
      onEnter: [
        { kind: "set", target: "@gold", value: "@gold + 5" },
        { kind: "set", target: "@bell", value: "@bell + 1" },
        { kind: "set", target: "@scene.mine", value: "@scene.mine + 2" },
        { kind: "set", target: "@scene.tally", value: "@scene.tally + 1" },
      ],
      beats: [{ id: "T1", kind: "text" }, { id: "T2", kind: "text" }] },
    { id: "g", type: "group", selector: "choice", children: [
      { id: "o1", type: "group", prompt: { id: "P1", kind: "text" }, children: [
        { id: "o1_c", type: "snippet", beats: [{ id: "T3", kind: "text" }], jump: { to: "END" } },
      ] },
    ] },
  ] }],
}];
const flowStateProject = project({ properties: [
  { name: "gold", type: "number", default: 0, shared: false },
  { name: "bell", type: "number", default: 0, shared: true },
] });
const flowStateLocales = [loc("s", {
  T1: "One: gold {@gold}", T2: "Two: mine {@scene.mine}, bell {@bell}, tally {@scene.tally}", P1: "Go",
  T3: "Gold {@gold}, mine {@scene.mine}",
})];
const flowStateChoice: TranscriptStep = { type: "choice", groupId: "g", options: [{ id: "o1", prompt: { kind: "text", text: "Go" }, eligible: true }] };

const scriptedFlowState = {
  name: "a flow captured, closed, and restored under a new id carries on with its own values; shared state isn't rewound",
  project: flowStateProject,
  scenes: flowStateScenes,
  locales: flowStateLocales,
  script: [
    { op: "openFlow", flow: "main", scene: "s" },
    { op: "advance", expect: [{ type: "text", id: "T1", text: "One: gold 5" }] },
    { op: "captureFlow", flow: "main", into: "mid" },                       // mid-snippet: gold 5, mine 2
    { op: "closeFlow", flow: "main" },
    { op: "openFlow", flow: "other", scene: "s" },                          // another flow moves the shared state on
    { op: "advance", expect: [{ type: "text", id: "T1", text: "One: gold 5" }] },
    { op: "restoreFlow", flow: "carried", from: "mid" },                    // a new id
    { op: "advance", expect: [{ type: "text", id: "T2", text: "Two: mine 2, bell 2, tally 2" }] },
    { op: "advance", expect: [flowStateChoice] },
    { op: "captureFlow", flow: "carried", into: "atChoice" },               // at a pending choice
    { op: "closeFlow", flow: "carried" },
    { op: "restoreFlow", flow: "again", from: "atChoice" },
    { op: "advance", expect: [flowStateChoice] },                           // the choice comes back whole
    { op: "choose", id: "o1" },
    { op: "advance", expect: [{ type: "text", id: "T3", text: "Gold 5, mine 2" }] },
    { op: "advance", expect: [{ type: "end" }] },
  ],
} satisfies ScriptedFixture;

// What restoreFlow refuses, leaving everything as it was: an id that is open, and an open checkpoint. Capturing
// only reads, so a checkpoint doesn't stop it.
const scriptedFlowStateRefusals = {
  name: "restoreFlow is refused over an open id and inside a checkpoint; captureFlow isn't",
  project: flowStateProject,
  scenes: flowStateScenes,
  locales: flowStateLocales,
  script: [
    { op: "openFlow", flow: "main", scene: "s" },
    { op: "advance", expect: [{ type: "text", id: "T1", text: "One: gold 5" }] },
    { op: "captureFlow", flow: "main", into: "mid" },
    { op: "restoreFlow", flow: "main", from: "mid", expectRefused: true },  // "main" is open
    { op: "checkpoint" },
    { op: "restoreFlow", flow: "spare", from: "mid", expectRefused: true }, // a checkpoint is open
    { op: "captureFlow", flow: "main", into: "inside" },                    // allowed: it only reads
    { op: "commit" },
    { op: "closeFlow", flow: "main" },
    { op: "restoreFlow", flow: "main", from: "inside" },                    // the same id, now free
    { op: "advance", expect: [{ type: "text", id: "T2", text: "Two: mine 2, bell 1, tally 1" }] },
  ],
} satisfies ScriptedFixture;

// Against an edited bundle a restore re-finds its place by id, as a load does: here the line it stopped before
// was reworded, and a line was inserted before its place, which neither replays nor shifts it.
const scriptedFlowStateEdited = {
  name: "a captured flow restored onto an edited bundle re-finds its place by id",
  project: project(),
  scenes: [{ id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "sn", type: "snippet", beats: [{ id: "T1", kind: "text" }, { id: "T2", kind: "text" }], jump: { to: "END" } },
  ] }] }],
  locales: [loc("s", { T1: "first", T2: "second" })],
  scenesB: [{ id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "sn0", type: "snippet", beats: [{ id: "T0", kind: "text" }] },
    { id: "sn", type: "snippet", beats: [{ id: "T1", kind: "text" }, { id: "T2", kind: "text" }], jump: { to: "END" } },
  ] }] }],
  localesB: [loc("s", { T0: "inserted", T1: "first", T2: "second, reworded" })],
  script: [
    { op: "openFlow", flow: "main", scene: "s" },
    { op: "advance", expect: [{ type: "text", id: "T1", text: "first" }] },
    { op: "captureFlow", flow: "main", into: "mid" },
    { op: "closeFlow", flow: "main" },
    { op: "hotSwap" },                                                      // the game is now on the edited bundle
    { op: "restoreFlow", flow: "main", from: "mid" },
    { op: "advance", expect: [{ type: "text", id: "T2", text: "second, reworded" }] },
    { op: "advance", expect: [{ type: "end" }] },
  ],
} satisfies ScriptedFixture;

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
  name: "hotSwap: a deleted ACTIVE snippet is skipped, reported; play continues at the next survivor",
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
    { op: "expectErrors", expectResult: [{ kind: "save", node: "sn1", flow: "main" }] }, // and the load says so
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
      { id: "left", prompt: { kind: "text", text: "Left" }, eligible: true }, // `right` drifted out: dropped; the set is never re-derived, only its prompts built
    ] }] },
    { op: "choose", id: "left" },
    { op: "advance", expect: [{ type: "text", id: "TL", text: "went left" }] },
    { op: "advance", expect: [{ type: "end" }] },
  ],
} satisfies ScriptedFixture;

const scriptedHotSwapEmptiedBlock = {
  name: "hotSwap: the cursor's whole container emptied - the frame drops, reported, and the flow ends cleanly",
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
    { op: "expectErrors", expectResult: [{ kind: "save", node: "sn2", flow: "main" }] },
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

// --- replayPromptOnChoose: the chosen option's authored prompt spoken back -------------------------------
// With the engine option on, `choose` delivers the chosen option's AUTHORED prompt (an Option group's own
// prompt beat) as the FIRST beat of its content, as an ordinary step with the beat's id: a line prompt
// comes back as a line step with its speaker, their resolved name, and the direction; a text prompt as a
// text step. It says exactly what the choice showed, text and speaker fields as resolved when the choice
// was presented. So when choosing runs effects before the replay is delivered (an Option group whose
// selector picks a snippet runs that snippet's onEnter at once), the replay still reads the shown value.
const replayPromptProject = project({
  cast: [{ name: "ANNA", displayName: "Anna" }],
  properties: [{ name: "coins", type: "number", shared: true, default: 3 }],
});
const replayPromptScenes: Scene[] = [{ id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
  { id: "g_door", type: "group", selector: "choice", children: [
    { id: "o_ask", type: "group", prompt: { id: "P_ask", kind: "line", character: "ANNA", direction: "quietly" }, children: [
      { id: "ask_c", type: "snippet", beats: [{ id: "T_ask", kind: "text" }] },
    ] },
    { id: "o_go", type: "group", prompt: { id: "P_go", kind: "text" }, children: [{ id: "go_c", type: "snippet", jump: { to: "END" } }] },
  ] },
  { id: "g_pay", type: "group", selector: "choice", children: [
    { id: "o_pay", type: "group", selector: "sequence", prompt: { id: "P_pay", kind: "text" }, children: [
      { id: "pay_c", type: "snippet", onEnter: [{ kind: "set", target: "@coins", value: "0" }], beats: [{ id: "T_paid", kind: "text" }] },
    ] },
  ] },
  { id: "sn_end", type: "snippet", beats: [{ id: "T_end", kind: "text" }], jump: { to: "END" } },
] }] }];
const replayPromptLocales = [loc("s", {
  P_ask: "Who's there?", P_go: "Leave", T_ask: "No answer.", P_pay: "Pay {@coins} coins", T_paid: "Paid. {@coins} left.", T_end: "Done.",
})];
const replayPromptChoices = {
  door: { type: "choice", groupId: "g_door", options: [
    { id: "o_ask", prompt: { kind: "line", text: "Who's there?", character: "ANNA", characterName: "Anna", direction: "quietly" }, eligible: true },
    { id: "o_go", prompt: { kind: "text", text: "Leave" }, eligible: true },
  ] },
  pay: { type: "choice", groupId: "g_pay", options: [{ id: "o_pay", prompt: { kind: "text", text: "Pay 3 coins" }, eligible: true }] },
} satisfies Record<string, TranscriptStep>;
const replayPrompt = {
  name: "replayPromptOnChoose: a chosen option's authored prompt is spoken back as the choice showed it",
  project: replayPromptProject,
  scenes: replayPromptScenes,
  locales: replayPromptLocales,
  engineOptions: { replayPromptOnChoose: true },
  choices: ["o_ask", "o_pay"],
  expectedTranscript: [
    replayPromptChoices.door,
    { type: "line", id: "P_ask", text: "Who's there?", character: "ANNA", characterName: "Anna", direction: "quietly" }, // spoken back
    { type: "text", id: "T_ask", text: "No answer." },
    replayPromptChoices.pay,
    { type: "text", id: "P_pay", text: "Pay 3 coins" }, // as shown, though pay_c's onEnter has already spent the coins
    { type: "text", id: "T_paid", text: "Paid. 0 left." },
    { type: "text", id: "T_end", text: "Done." },
    { type: "end" },
  ],
} satisfies RuntimeFixture;
const replayOff = {
  name: "replayPromptOnChoose off: a chosen option plays only its content",
  project: replayPromptProject,
  scenes: replayPromptScenes,
  locales: replayPromptLocales,
  engineOptions: { replayPromptOnChoose: false },
  choices: ["o_ask", "o_pay"],
  expectedTranscript: [
    replayPromptChoices.door,
    { type: "text", id: "T_ask", text: "No answer." },
    replayPromptChoices.pay,
    { type: "text", id: "T_paid", text: "Paid. 0 left." },
    { type: "text", id: "T_end", text: "Done." },
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// Only an AUTHORED prompt is replayed. An option without one borrows its own first content line as the
// prompt the choice shows (a bare-snippet option, or an Option group authored without a prompt), and that
// borrowed prompt is NOT spoken back: the line plays once, as content, after any onEnter of its snippet.
// An option with no line or text in its content at all has no prompt, and nothing is replayed either.
const replayBorrowed = {
  name: "replayPromptOnChoose: a prompt borrowed from the option's own content is not spoken back",
  project: project({
    cast: [{ name: "ANNA", displayName: "Anna" }],
    properties: [{ name: "coins", type: "number", shared: true, default: 1 }],
  }),
  scenes: [{ id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "g_bare", type: "group", selector: "choice", children: [
      { id: "o_bare", type: "snippet", onEnter: [{ kind: "set", target: "@coins", value: "@coins + 1" }],
        beats: [{ id: "L_bare", kind: "line", character: "ANNA" }, { id: "T_more", kind: "text" }] },
    ] },
    { id: "g_fall", type: "group", selector: "choice", children: [
      { id: "o_fall", type: "group", children: [{ id: "fall_c", type: "snippet", beats: [{ id: "T_fall", kind: "text" }] }] },
    ] },
    { id: "g_quiet", type: "group", selector: "choice", children: [
      { id: "o_quiet", type: "group", children: [{ id: "quiet_c", type: "snippet", beats: [{ id: "E_quiet", kind: "gameEvent" }] }] },
    ] },
    { id: "sn_end", type: "snippet", jump: { to: "END" } },
  ] }] }],
  locales: [loc("s", { L_bare: "I have {@coins}.", T_more: "More.", T_fall: "Falling back." })],
  engineOptions: { replayPromptOnChoose: true },
  expectedTranscript: [
    { type: "choice", groupId: "g_bare", options: [
      { id: "o_bare", prompt: { kind: "line", text: "I have 1.", character: "ANNA", characterName: "Anna" }, eligible: true },
    ] },
    { type: "line", id: "L_bare", text: "I have 2.", character: "ANNA", characterName: "Anna" }, // once, as content (after onEnter)
    { type: "text", id: "T_more", text: "More." },
    { type: "choice", groupId: "g_fall", options: [{ id: "o_fall", prompt: { kind: "text", text: "Falling back." }, eligible: true }] },
    { type: "text", id: "T_fall", text: "Falling back." },                                         // once
    { type: "choice", groupId: "g_quiet", options: [{ id: "o_quiet", eligible: true }] },
    { type: "gameEvent", id: "E_quiet" },
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// Closed captions off from construction (the `closedCaptions` engine option), with the replay on: a line
// and a line prompt lose their cues in the choice, when spoken back, and as content; a text prompt keeps
// its brackets, since captions apply to dialogue only.
const replayCaptionsOff = {
  name: "closedCaptions off at construction strips cues from lines, line prompts, and a replayed line prompt",
  project: project({ cast: [{ name: "ANNA", displayName: "Anna" }] }),
  scenes: [{ id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "sn_open", type: "snippet", beats: [{ id: "L_open", kind: "line", character: "ANNA" }] },
    { id: "g", type: "group", selector: "choice", children: [
      { id: "o_sigh", type: "group", prompt: { id: "P_sigh", kind: "line", character: "ANNA" }, children: [
        { id: "sigh_c", type: "snippet", beats: [{ id: "T_sigh", kind: "text" }], jump: { to: "END" } },
      ] },
      { id: "o_note", type: "group", prompt: { id: "P_note", kind: "text" }, children: [{ id: "note_c", type: "snippet", jump: { to: "END" } }] },
    ] },
  ] }] }],
  locales: [loc("s", { L_open: "Oh dear. [sigh] What now?", P_sigh: "Fine. [groans]", P_note: "Read [the note]", T_sigh: "[A door creaks.]" })],
  engineOptions: { replayPromptOnChoose: true, closedCaptions: false },
  choices: ["o_sigh"],
  expectedTranscript: [
    { type: "line", id: "L_open", text: "Oh dear. What now?", character: "ANNA", characterName: "Anna" },
    { type: "choice", groupId: "g", options: [
      { id: "o_sigh", prompt: { kind: "line", text: "Fine.", character: "ANNA", characterName: "Anna" }, eligible: true },
      { id: "o_note", prompt: { kind: "text", text: "Read [the note]" }, eligible: true },
    ] },
    { type: "line", id: "P_sigh", text: "Fine.", character: "ANNA", characterName: "Anna" },
    { type: "text", id: "T_sigh", text: "[A door creaks.]" }, // text keeps its brackets
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// A save taken between `choose` and the next advance holds the prompt still to be spoken back: its owner
// (pendingPromptOwnerId) and the prompt as the choice showed it (pendingPrompt). Loaded into a fresh
// engine, the next advance says what was shown: not the value the option's onEnter has since changed, and
// not the language switched to after the load.
const scriptedReplaySaveLoadProject = project({
  cast: [{ name: "ANNA", displayName: "Anna" }],
  locales: { default: "en", all: ["en", "fr"] },
  properties: [{ name: "coins", type: "number", shared: true, default: 3 }],
});
const scriptedReplaySaveLoadScenes: Scene[] = [{ id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
  { id: "g", type: "group", selector: "choice", children: [
    { id: "o_ask", type: "group", selector: "sequence", prompt: { id: "P_ask", kind: "line", character: "ANNA", direction: "quietly" }, children: [
      { id: "ask_c", type: "snippet", onEnter: [{ kind: "set", target: "@coins", value: "0" }], beats: [{ id: "T_ask", kind: "text" }], jump: { to: "END" } },
    ] },
    { id: "o_go", type: "group", prompt: { id: "P_go", kind: "text" }, children: [{ id: "go_c", type: "snippet", jump: { to: "END" } }] },
  ] },
] }] }];
const scriptedReplaySaveLoadLocales = [
  loc("s", { P_ask: "Who's there? I have {@coins}.", P_go: "Leave", T_ask: "No answer. {@coins} left." }),
  loc("s", { P_ask: "Qui est la ? J'ai {@coins}.", P_go: "Partir", T_ask: "Pas de reponse. Il reste {@coins}." }, "fr"),
  loc("@project", { [castStringKey("ANNA")]: "Annette" }, "fr"),
];
const scriptedReplaySaveLoad = {
  name: "replayPromptOnChoose: a save between choose and the next advance still speaks the prompt as shown",
  project: scriptedReplaySaveLoadProject,
  scenes: scriptedReplaySaveLoadScenes,
  locales: scriptedReplaySaveLoadLocales,
  engineOptions: { replayPromptOnChoose: true },
  script: [
    { op: "openFlow", flow: "main", scene: "s" },
    { op: "advance", expect: [{ type: "choice", groupId: "g", options: [
      { id: "o_ask", prompt: { kind: "line", text: "Who's there? I have 3.", character: "ANNA", characterName: "Anna", direction: "quietly" }, eligible: true },
      { id: "o_go", prompt: { kind: "text", text: "Leave" }, eligible: true },
    ] }] },
    { op: "choose", id: "o_ask" }, // ask_c's onEnter spends the coins now
    { op: "saveLoad" },            // the prompt is still to be spoken back, as shown
    { op: "setLocale", locale: "fr" },
    { op: "advance", expect: [{ type: "line", id: "P_ask", text: "Who's there? I have 3.", character: "ANNA", characterName: "Anna", direction: "quietly" }] },
    { op: "advance", expect: [{ type: "text", id: "T_ask", text: "Pas de reponse. Il reste 0." }] },
    { op: "advance", expect: [{ type: "end" }] },
  ],
} satisfies ScriptedFixture;

// The same with no save in between, the language switched between choose and the replay: the replay is
// what the choice showed, in the language it was shown in.
const scriptedReplayShown = {
  name: "replayPromptOnChoose: the replay is the prompt as shown, though the language changed after choosing",
  project: scriptedReplaySaveLoadProject,
  scenes: scriptedReplaySaveLoadScenes,
  locales: scriptedReplaySaveLoadLocales,
  engineOptions: { replayPromptOnChoose: true },
  script: [
    { op: "openFlow", flow: "main", scene: "s" },
    { op: "advance", expect: [{ type: "choice", groupId: "g", options: [
      { id: "o_ask", prompt: { kind: "line", text: "Who's there? I have 3.", character: "ANNA", characterName: "Anna", direction: "quietly" }, eligible: true },
      { id: "o_go", prompt: { kind: "text", text: "Leave" }, eligible: true },
    ] }] },
    { op: "choose", id: "o_ask" },
    { op: "setLocale", locale: "fr" },
    { op: "advance", expect: [{ type: "line", id: "P_ask", text: "Who's there? I have 3.", character: "ANNA", characterName: "Anna", direction: "quietly" }] },
    { op: "advance", expect: [{ type: "text", id: "T_ask", text: "Pas de reponse. Il reste 0." }] },
    { op: "advance", expect: [{ type: "end" }] },
  ],
} satisfies ScriptedFixture;

// --- speaker fields set to the empty string ------------------------------------------------------------
// A line's and a line prompt's `character`, `characterName`, and `direction` are kept when they are set to
// "" and absent only when unset: an empty value is a value. `direction: ""` and `character: ""` on a beat
// come through as "". A display name resolves through the cast strings (active locale, then default
// locale) and then the cast's `displayName`, and the first that EXISTS wins, so an empty cast string
// gives `characterName: ""` rather than falling through to the next. An empty `displayName` is not a name,
// though: it gives no `characterName`. A `character: ""` is a speaker token like any other, so its name
// resolves through `cast:` the same way. A line with no character has no speaker fields unless set.
const emptySpeakerProject = project({
  cast: [{ name: "ANNA", displayName: "" }, { name: "BO", displayName: "Bo" }, { name: "CY", displayName: "Cy" }],
  locales: { default: "en", all: ["en", "fr"] },
});
const emptySpeakerStrings = { L_a: "A", L_b: "B", L_c: "C", L_n: "N", L_x: "X", P_a: "Pa", P_b: "Pb", P_n: "Pn", P_x: "Px" };
const emptySpeakerFields = {
  name: "a speaker field set to the empty string is kept, on a line and on a line prompt",
  project: emptySpeakerProject,
  scenes: [{ id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "sn", type: "snippet", beats: [
      { id: "L_a", kind: "line", character: "ANNA", direction: "" },
      { id: "L_b", kind: "line", character: "BO" },
      { id: "L_c", kind: "line", character: "CY" },
      { id: "L_n", kind: "line", character: "" },
      { id: "L_x", kind: "line", direction: "" },
    ] },
    { id: "g_e", type: "group", selector: "choice", children: [
      { id: "o_a", type: "group", prompt: { id: "P_a", kind: "line", character: "ANNA", direction: "" }, children: [{ id: "a_c", type: "snippet", jump: { to: "END" } }] },
      { id: "o_b", type: "group", prompt: { id: "P_b", kind: "line", character: "BO" }, children: [{ id: "b_c", type: "snippet", jump: { to: "END" } }] },
      { id: "o_n", type: "group", prompt: { id: "P_n", kind: "line", character: "" }, children: [{ id: "n_c", type: "snippet", jump: { to: "END" } }] },
      { id: "o_x", type: "group", prompt: { id: "P_x", kind: "line" }, children: [{ id: "x_c", type: "snippet", jump: { to: "END" } }] },
    ] },
  ] }] }],
  locales: [
    loc("s", emptySpeakerStrings),
    loc("s", emptySpeakerStrings, "fr"),
    loc("@project", { [castStringKey("CY")]: "" }),       // en (default): CY's name translated as ""
    loc("@project", { [castStringKey("BO")]: "", [castStringKey("")]: "Someone" }, "fr"), // fr (active): BO's name is "", and the "" speaker's
  ],
  locale: "fr",
  choices: ["o_x"],
  expectedTranscript: [
    { type: "line", id: "L_a", text: "A", character: "ANNA", direction: "" }, // empty displayName: no name
    { type: "line", id: "L_b", text: "B", character: "BO", characterName: "" }, // fr "" wins over "Bo"
    { type: "line", id: "L_c", text: "C", character: "CY", characterName: "" }, // fr has none, en "" wins over "Cy"
    { type: "line", id: "L_n", text: "N", character: "", characterName: "Someone" }, // the "" token's cast string
    { type: "line", id: "L_x", text: "X", direction: "" },
    { type: "choice", groupId: "g_e", options: [
      { id: "o_a", prompt: { kind: "line", text: "Pa", character: "ANNA", direction: "" }, eligible: true },
      { id: "o_b", prompt: { kind: "line", text: "Pb", character: "BO", characterName: "" }, eligible: true },
      { id: "o_n", prompt: { kind: "line", text: "Pn", character: "", characterName: "Someone" }, eligible: true },
      { id: "o_x", prompt: { kind: "line", text: "Px" }, eligible: true }, // a line prompt with no speaker
    ] },
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// The same empty fields on a pending choice carried through a save: each comes back as "" and none is
// dropped. As a save case, a save written by the reference carries them, and a runtime that loads it must
// write them back (its key paths) and offer them again.
const scriptedEmptySpeakerSaveLoad = {
  name: "a pending choice's empty speaker fields survive save and load",
  project: project({ cast: [{ name: "ANNA", displayName: "Anna" }, { name: "BO", displayName: "Bo" }] }),
  scenes: [{ id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "g", type: "group", selector: "choice", children: [
      { id: "o_a", type: "group", prompt: { id: "P_a", kind: "line", character: "ANNA", direction: "" }, children: [
        { id: "a_c", type: "snippet", beats: [{ id: "T_a", kind: "text" }], jump: { to: "END" } },
      ] },
      { id: "o_b", type: "group", prompt: { id: "P_b", kind: "line", character: "BO" }, children: [{ id: "b_c", type: "snippet", jump: { to: "END" } }] },
      { id: "o_n", type: "group", prompt: { id: "P_n", kind: "line", character: "" }, children: [{ id: "n_c", type: "snippet", jump: { to: "END" } }] },
    ] },
  ] }] }],
  locales: [
    loc("s", { P_a: "Pa", P_b: "Pb", P_n: "Pn", T_a: "Gone." }),
    loc("@project", { [castStringKey("BO")]: "" }),
  ],
  script: [
    { op: "openFlow", flow: "main", scene: "s" },
    { op: "advance", expect: [{ type: "choice", groupId: "g", options: [
      { id: "o_a", prompt: { kind: "line", text: "Pa", character: "ANNA", characterName: "Anna", direction: "" }, eligible: true },
      { id: "o_b", prompt: { kind: "line", text: "Pb", character: "BO", characterName: "" }, eligible: true },
      { id: "o_n", prompt: { kind: "line", text: "Pn", character: "" }, eligible: true },
    ] }] },
    { op: "saveLoad" },
    { op: "advance", expect: [{ type: "choice", groupId: "g", options: [
      { id: "o_a", prompt: { kind: "line", text: "Pa", character: "ANNA", characterName: "Anna", direction: "" }, eligible: true },
      { id: "o_b", prompt: { kind: "line", text: "Pb", character: "BO", characterName: "" }, eligible: true },
      { id: "o_n", prompt: { kind: "line", text: "Pn", character: "" }, eligible: true },
    ] }] },
    { op: "choose", id: "o_a" },
    { op: "advance", expect: [{ type: "text", id: "T_a", text: "Gone." }] },
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
          { id: "T1", kind: "text" },                      // text: no speaker to collect
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

    // Nothing to report: text only, and refs that do not resolve.
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
    ...(f.engineOptions !== undefined ? { engineOptions: f.engineOptions } : {}),
    setup: f.script.slice(0, at),
    script: [{ op: "useFlow", flow: opened.flow }, ...f.script.slice(at + 1)],
  };
};

// --- the decision log ------------------------------------------------------------------------
// One run that makes every kind of decision but `dry` and `diagnostic` (those have play-errors and
// dry-choice cases of their own): a `run` walk past a snippet whose condition fails, a write with the
// value it replaced, a choice with a greyed option, the option chosen, a jump, and a sequence pick.
// The log is the contract: each entry's fields, in order, tagged with its flow and scene.
const decisionLog = {
  name: "every decision a run makes, in order, with its reasoning",
  project: project({ properties: [{ name: "gold", type: "number", shared: true, default: 0 }] }),
  scenes: [{
    id: "s", type: "scene", name: "S",
    blocks: [{ id: "b_main", type: "block", name: "Main", children: [
      { id: "sn_rich", type: "snippet", condition: "@gold > 5", beats: [{ id: "T_rich", kind: "text" }], jump: { to: "END" } },
      { id: "sn_open", type: "snippet", beats: [{ id: "T_open", kind: "text" }],
        onExit: [{ kind: "set", target: "@gold", value: "@gold + 3" }] },
      { id: "g_ask", type: "group", selector: "choice", children: [
        { id: "opt_buy", type: "group", condition: "@gold > 1", prompt: { id: "C_buy", kind: "text" },
          children: [{ id: "sn_buy", type: "snippet", jump: { to: "b_end" } }] },
        { id: "opt_rob", type: "group", condition: "@gold > 10", prompt: { id: "C_rob", kind: "text" },
          children: [{ id: "sn_rob", type: "snippet", jump: { to: "END" } }] },
      ] },
    ] }, {
      id: "b_end", type: "block", name: "End", children: [
        { id: "g_seq", type: "group", selector: "sequence", options: { order: "sequential", exhaust: "stick" }, children: [
          { id: "sn_1", type: "snippet", beats: [{ id: "T_1", kind: "text" }], jump: { to: "END" } },
          { id: "sn_2", type: "snippet", beats: [{ id: "T_2", kind: "text" }], jump: { to: "END" } },
        ] },
      ],
    }],
  }],
  locales: [loc("s", { T_rich: "rich", T_open: "open", C_buy: "Buy", C_rob: "Rob", T_1: "one", T_2: "two" })],
  choices: ["opt_buy"],
  expectedLog: [
    // The run walked past sn_rich (gold 0 is not > 5) to sn_open. A walk that skips nothing logs nothing.
    { type: "select", flow: "main", seq: 0, scene: "s", group: "b_main", selector: "run",
      children: [{ id: "sn_rich", eligible: false }, { id: "sn_open", eligible: true }], picked: "sn_open" },
    { type: "write", flow: "main", seq: 1, scene: "s", target: "@gold", value: 3, prev: 0 },
    { type: "choice", flow: "main", seq: 2, scene: "s", group: "g_ask",
      options: [{ id: "opt_buy", eligible: true }, { id: "opt_rob", eligible: false }] },
    { type: "chose", flow: "main", seq: 3, scene: "s", group: "g_ask", option: "opt_buy" },
    { type: "jump", flow: "main", seq: 4, scene: "s", to: "b_end", mode: "jump" },
    { type: "select", flow: "main", seq: 5, scene: "s", group: "g_seq", selector: "sequence", order: "sequential", exhaust: "stick",
      children: [{ id: "sn_1", eligible: true }, { id: "sn_2", eligible: true }], picked: "sn_1" },
    { type: "jump", flow: "main", seq: 6, scene: "s", to: "END", mode: "jump" },
  ],
} satisfies LogFixture;

// --- the bundle description ----------------------------------------------------------------------
// A bundle with something in every part of the description: addresses (one derived, one explicit), a
// declared host scope and an opaque one, @patter and @scene properties with and without defaults,
// gameData fields for two node types (declared out of alphabetical order, which the description keeps)
// with an enum's values and a purpose, and every count.
const describeEverything = {
  name: "a bundle described: addresses, host scopes, properties, gameData, counts",
  project: project({
    cast: [{ name: "ANNA" }, { name: "BRAM" }],
    properties: [
      { name: "gold", type: "number", shared: true, default: 0 },
      { name: "mood", type: "enum", values: ["calm", "tense"], shared: false },
    ],
    scopeRegistry: { version: 1, scopes: [
      { token: "world", writable: false, declarations: [{ name: "isNight", type: "boolean", default: false }, { name: "era", type: "string" }] },
      { token: "story" },
    ] },
    gameDataFields: {
      scene: [{ name: "music", type: "text", default: "calm", purpose: "The track the scene plays under" }],
      line: [
        { name: "camera", type: "enum", values: ["wide", "close"], default: "wide" },
        { name: "shake", type: "number" },
      ],
      option: [{ name: "tone", type: "enum", values: ["kind", "curt"], purpose: "How the option reads" }],
    },
  }),
  scenes: [{
    id: "s_hall", type: "scene", name: "Great Hall",
    sceneProps: [{ name: "knocks", type: "number", default: 0 }, { name: "seen", type: "boolean", shared: true }],
    blocks: [{ id: "b_door", type: "block", name: "The Door", children: [
      { id: "sn_open", type: "snippet", beats: [{ id: "L_open", kind: "line", character: "ANNA" }, { id: "E_bell", kind: "gameEvent" }] },
      { id: "g_ask", type: "group", selector: "choice", children: [
        { id: "o_knock", type: "group", prompt: { id: "P_knock", kind: "line", character: "BRAM" },
          children: [{ id: "sn_k", type: "snippet", beats: [{ id: "T_k", kind: "text" }], jump: { to: "END" } }] },
        { id: "o_leave", type: "group", prompt: { id: "P_leave", kind: "text" }, children: [{ id: "sn_l", type: "snippet", jump: { to: "END" } }] },
      ] },
    ] }],
  }, {
    id: "s_yard", type: "scene", name: "Yard", gameId: "the-yard",
    blocks: [{ id: "b_gate", type: "block", name: "Gate", gameId: "gate", children: [
      { id: "sn_g", type: "snippet", beats: [{ id: "T_g", kind: "text" }], jump: { to: "END" } },
    ] }],
  }],
  locales: [loc("s_hall", { L_open: "Open.", P_knock: "Knock", P_leave: "Leave", T_k: "knocked" }), loc("s_yard", { T_g: "gate" })],
} satisfies DescribeFixture;

// --- checkpoint edge cases ------------------------------------------------------------------------
// Inside an open checkpoint the runtime refuses what it could not undo, and changes nothing doing so: a
// second checkpoint, a hot swap, an engine reset. The flow plays on regardless, and the rollback still
// takes it back to where the checkpoint was opened.
const edgeScenes = [{
  id: "s", type: "scene", name: "S",
  blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "sn_1", type: "snippet", beats: [{ id: "T1", kind: "text" }] },
    { id: "sn_2", type: "snippet", beats: [{ id: "T2", kind: "text" }] },
    { id: "sn_3", type: "snippet", beats: [{ id: "T3", kind: "text" }], jump: { to: "END" } },
  ] }],
}] satisfies Scene[];
const edgeLoc = [loc("s", { T1: "one", T2: "two", T3: "three" })];
const scriptedCheckpointRefusals = {
  name: "checkpoint: a second checkpoint, a hot swap, and an engine reset are refused while one is open",
  project: project(), scenes: edgeScenes, scenesB: edgeScenes, locales: edgeLoc,
  script: [
    { op: "openFlow", flow: "main", scene: "s" },
    { op: "advance", expect: [{ type: "text", id: "T1", text: "one" }] },
    { op: "checkpoint" },
    { op: "advance", expect: [{ type: "text", id: "T2", text: "two" }] },
    { op: "checkpoint", expectRefused: true },
    { op: "hotSwap", expectRefused: true },
    { op: "reset", expectRefused: true },
    { op: "advance", expect: [{ type: "text", id: "T3", text: "three" }] },
    { op: "rollback" },
    { op: "advance", expect: [{ type: "text", id: "T2", text: "two" }] },
  ],
} satisfies ScriptedFixture;

// A save taken inside a checkpoint holds what has happened so far, as a save taken anywhere does: the
// engine it loads into plays on from there, outside any checkpoint.
const scriptedSaveInCheckpoint = {
  name: "checkpoint: a save taken while one is open holds the steps taken inside it",
  project: project(), scenes: edgeScenes, locales: edgeLoc,
  script: [
    { op: "openFlow", flow: "main", scene: "s" },
    { op: "checkpoint" },
    { op: "advance", expect: [{ type: "text", id: "T1", text: "one" }] },
    { op: "advance", expect: [{ type: "text", id: "T2", text: "two" }] },
    { op: "saveLoad" },
    { op: "useFlow", flow: "main" },
    { op: "advance", expect: [{ type: "text", id: "T3", text: "three" }] },
    { op: "checkpoint" },
    { op: "commit" },
  ],
} satisfies ScriptedFixture;

// --- a block is looked up within its scene ----------------------------------------------------------
// A block address is scene-scoped: naming a block of ANOTHER scene finds nothing, for openFlow and goto
// alike, and the flow stays where it was.
const scriptedBlockInOtherScene = {
  name: "addressing: a block named under another scene is not found",
  project: project(),
  scenes: [
    { id: "scn_a", type: "scene", name: "Hall", blocks: [{ id: "b_a", type: "block", name: "Door", children: [
      { id: "sn_a", type: "snippet", beats: [{ id: "A", kind: "text" }], jump: { to: "END" } },
    ] }] },
    { id: "scn_b", type: "scene", name: "Yard", blocks: [{ id: "b_b", type: "block", name: "Gate", children: [
      { id: "sn_b", type: "snippet", beats: [{ id: "B", kind: "text" }], jump: { to: "END" } },
    ] }] },
  ],
  locales: [loc("scn_a", { A: "hall" }), loc("scn_b", { B: "yard" })],
  script: [
    { op: "openFlow", flow: "main", scene: "hall", block: "gate", expectResult: false },
    { op: "openFlow", flow: "main", scene: "hall", block: "b_b", expectResult: false },
    { op: "openFlow", flow: "main", scene: "hall" },
    { op: "goto", scene: "hall", block: "gate", expectResult: false },
    { op: "advance", expect: [{ type: "text", id: "A", text: "hall" }] },
    { op: "goto", scene: "yard", block: "gate", expectResult: true },
    { op: "advance", expect: [{ type: "text", id: "B", text: "yard" }] },
  ],
} satisfies ScriptedFixture;

// --- listProperties ---------------------------------------------------------------------------------
// The state inspector's rows: each shared @patter property in declaration order, with its qualified path,
// its value now, its default (the type's own when it declares none), and values / stages only where the
// declaration has them. A per-flow property is not a row: it has a value per flow.
// A quality's ladder as game code reads it: the engine's and a flow's stageIndex / compareStages / nextStage,
// by the quality's ref, for @patter, @world and (on a flow, in the scene it's in) @scene.
const scriptedStages = {
  name: "stage helpers: a quality's ladder by its ref, on the engine and on a flow",
  project: project({
    properties: [
      { name: "debt", type: "quality", stages: ["troubled", "confronted", "resolved"], shared: true },
      { name: "gold", type: "number", shared: true, default: 1 },
    ],
    scopeRegistry: { version: 1, scopes: [{ token: "world", declarations: [{ name: "act", type: "quality", stages: ["opening", "rising", "end"] }] }] },
  }),
  scenes: [{ id: "s", type: "scene", name: "S",
    sceneProps: [{ name: "step", type: "quality", stages: ["one", "two"] }],
    blocks: [{ id: "b", type: "block", name: "B", children: [
      { id: "sn", type: "snippet", beats: [{ id: "T", kind: "text" }], jump: { to: "END" } },
    ] }] }],
  locales: [loc("s", { T: "t" })],
  script: [
    { op: "openFlow", flow: "main", scene: "s" },
    { op: "stage", call: "index", ref: "@debt", args: ["resolved"], expectResult: 2 },
    { op: "stage", call: "index", ref: "@patter.debt", args: ["settled"], expectResult: -1 },
    { op: "stage", call: "compare", ref: "@debt", args: ["troubled", "confronted"], expectResult: -1 },
    { op: "stage", call: "compare", ref: "@debt", args: ["resolved", "confronted"], expectResult: 1 },
    { op: "stage", call: "next", ref: "@debt", args: ["troubled"], expectResult: "confronted" },
    { op: "stage", call: "next", ref: "@debt", args: ["resolved"], expectResult: "resolved" },
    { op: "stage", call: "compare", ref: "@debt", args: ["troubled", "settled"], expectRefused: true },
    { op: "stage", call: "next", ref: "@debt", args: ["settled"], expectRefused: true },
    { op: "stage", call: "next", ref: "@gold", args: [1], expectRefused: true },
    { op: "stage", call: "next", ref: "@world.act", args: ["opening"], expectResult: "rising" },
    { op: "stage", call: "compare", ref: "@world.act", args: ["end", "rising"], expectResult: 1 },
    { op: "stage", call: "next", ref: "@scene.step", args: ["one"], expectRefused: true },
    { op: "stage", call: "next", ref: "@scene.step", args: ["one"], onFlow: true, expectResult: "two" },
    { op: "stage", call: "index", ref: "@debt", args: ["confronted"], onFlow: true, expectResult: 1 },
    { op: "stage", call: "compare", ref: "@world.act", args: ["opening", "opening"], onFlow: true, expectResult: 0 },
    { op: "advance", expect: [{ type: "text", id: "T", text: "t" }] },
    { op: "advance", expect: [{ type: "end" }] },
  ],
} satisfies ScriptedFixture;

// --- qualities beyond @patter (the qualities brief, C4; patter-qualities.md sections 7 and 8) -------------
//
// A quality on every scope a Patter story reads, a quality game-data value, and a save holding a stage or an
// enum value the edit deleted. Ladders are again chosen so alphabetical order disagrees with ladder order
// wherever a gate orders them. Every expectation is read off the rule, not off a run.

// An @scene ladder gating play: the scene's own quality seeds at its first stage ("one", no default given:
// the compiler writes it in), the early snippet steps it with advance() as it leaves, and the block's second
// pass finds the gate open.
const qualityScene = {
  name: "quality: a @scene ladder gates its own scene's play",
  project: project(),
  scenes: [{ id: "s", type: "scene", name: "S", sceneProps: [{ name: "step", type: "quality", stages: ["one", "two", "three"] }], blocks: [
    { id: "b", type: "block", name: "B", children: [
      { id: "sn_late", type: "snippet", condition: '@scene.step >= "two"', beats: [{ id: "T_late", kind: "text" }], jump: { to: "END" } },
      { id: "sn_early", type: "snippet", beats: [{ id: "T_early", kind: "text" }],
        onExit: [{ kind: "set", target: "@scene.step", value: "advance(@scene.step)" }], jump: { to: "b" } },
    ] },
  ] }],
  locales: [loc("s", { T_late: "late {@scene.step}", T_early: "early {@scene.step}" })],
  expectedTranscript: [
    { type: "text", id: "T_early", text: "early one" },
    { type: "text", id: "T_late", text: "late two" },
    { type: "end" },
  ],
} satisfies RuntimeFixture;

// A @world quality the GAME moves: the story only reads it. Self-backed here (a standalone engine is its own
// game), written with the game's authority; the gate orders the new stage by position and the value survives
// a save.
const worldActProject = project({
  scopeRegistry: { version: 1, scopes: [{ token: "world", declarations: [{ name: "act", type: "quality", stages: ["opening", "rising", "end"] }] }] },
});
const worldActScene = [{ id: "s", type: "scene", name: "S", blocks: [
  { id: "b_probe", type: "block", name: "Probe", gameId: "probe", children: [
    { id: "sn_r", type: "snippet", condition: '@world.act >= "rising"', beats: [{ id: "T_r", kind: "text" }], jump: { to: "END" } },
    { id: "sn_o", type: "snippet", beats: [{ id: "T_o", kind: "text" }], jump: { to: "END" } },
  ] },
] }] as Scene[];
const scriptedWorldQuality = {
  name: "quality: a @world quality the game moves gates by ladder position",
  project: worldActProject,
  scenes: worldActScene,
  locales: [loc("s", { T_r: "past the opening at {@world.act}", T_o: "still {@world.act}" })],
  script: [
    { op: "openFlow", flow: "f", scene: "s" },
    { op: "advance", expect: [{ type: "text", id: "T_o", text: "still opening" }] },
    { op: "advance", expect: [{ type: "end" }] },
    { op: "setProperty", ref: "@world.act", value: "rising" },
    { op: "saveLoad" },
    { op: "goto", scene: "s", block: "probe", expectResult: true },
    { op: "advance", expect: [{ type: "text", id: "T_r", text: "past the opening at rising" }] },
    { op: "advance", expect: [{ type: "end" }] },
    { op: "stage", call: "compare", ref: "@world.act", args: ["end", "rising"], expectResult: 1 },
  ],
} satisfies ScriptedFixture;

// A @story quality, as a Patter bundle compiled against the Storylet Engine's spec declares it: the other
// engine's ladder, which this engine reads and orders. Standalone here, so the engine backs @story itself; the
// game's write stands in for the Storylet Engine moving its act. (The two engines on one registry, each
// moving the other's quality, are the combined-game tests on every runtime.)
const storyActProject = project({
  scopeRegistry: { version: 1, scopes: [{ token: "story", declarations: [{ name: "act", type: "quality", stages: ["arrival", "act-1", "act-2"] }] }] },
});
const scriptedStoryQuality = {
  name: "quality: a @story quality from the Storylet Engine's spec gates Patter's play",
  project: storyActProject,
  scenes: [{ id: "s", type: "scene", name: "S", blocks: [
    { id: "b_probe", type: "block", name: "Probe", gameId: "probe", children: [
      { id: "sn_a", type: "snippet", condition: '@story.act >= "act-1"', beats: [{ id: "T_a", kind: "text" }], jump: { to: "END" } },
      { id: "sn_b", type: "snippet", beats: [{ id: "T_b", kind: "text" }], jump: { to: "END" } },
    ] },
  ] }] as Scene[],
  locales: [loc("s", { T_a: "into {@story.act}", T_b: "on {@story.act}" })],
  script: [
    { op: "openFlow", flow: "f", scene: "s" },
    { op: "advance", expect: [{ type: "text", id: "T_b", text: "on arrival" }] },
    { op: "advance", expect: [{ type: "end" }] },
    { op: "setProperty", ref: "@story.act", value: "act-2" },
    { op: "goto", scene: "s", block: "probe", expectResult: true },
    { op: "advance", expect: [{ type: "text", id: "T_a", text: "into act-2" }] },
    { op: "advance", expect: [{ type: "end" }] },
  ],
} satisfies ScriptedFixture;

// A save holding a stage the edit DELETED. The live refresh carries the game onto the edited bundle, whose
// ladder no longer has "done": the value goes back to the quality's default (its first stage, none given),
// is reported, and the probe reads it there instead of throwing at its first ordering gate.
const negotiationScenes = (probe: string): Scene[] => [{ id: "s", type: "scene", name: "S", blocks: [
  { id: "b_set", type: "block", name: "Set", children: [
    { id: "sn_set", type: "snippet", beats: [{ id: "T_set", kind: "text" }],
      onExit: [{ kind: "set", target: "@negotiation", value: '"done"' }], jump: { to: "END" } },
  ] },
  { id: "b_probe", type: "block", name: "Probe", gameId: "probe", children: [
    { id: "sn_past", type: "snippet", condition: probe, beats: [{ id: "T_past", kind: "text" }], jump: { to: "END" } },
    { id: "sn_pre", type: "snippet", beats: [{ id: "T_pre", kind: "text" }], jump: { to: "END" } },
  ] },
] }] as Scene[];
const scriptedQualityDeletedStage = {
  name: "quality: a saved stage the edit deleted goes back to the default, and is reported",
  project: qualityProject(QUALITY_STAGES),
  scenes: negotiationScenes('@negotiation >= "done"'),
  locales: [loc("s", { T_set: "set", T_past: "past {@negotiation}", T_pre: "pre {@negotiation}" })],
  projectB: qualityProject(["not_started", "underway", "aftermath"]),
  scenesB: negotiationScenes('@negotiation >= "underway"'),
  localesB: [loc("s", { T_set: "set", T_past: "past {@negotiation}", T_pre: "pre {@negotiation}" })],
  script: [
    { op: "openFlow", flow: "f", scene: "s" },
    { op: "advance", expect: [{ type: "text", id: "T_set", text: "set" }] },
    { op: "advance", expect: [{ type: "end" }] },       // leaving sn_set: @negotiation = "done"
    { op: "saveLoad" },                                  // the same bundle: "done" still fits
    { op: "expectRefits", expectResult: [] },
    { op: "hotSwap" },                                   // the edited ladder has no "done"
    { op: "expectRefits", expectResult: [{ scope: "patter", name: "negotiation", value: "done" }] },
    { op: "goto", scene: "s", block: "probe", expectResult: true },
    { op: "advance", expect: [{ type: "text", id: "T_pre", text: "pre not_started" }] },
    { op: "advance", expect: [{ type: "end" }] },
  ],
} satisfies ScriptedFixture;

// The same for an enum value the edit deleted: back to the declared default, and reported.
const moodProject = (values: string[]) => project({
  properties: [{ name: "mood", type: "enum", values, default: "calm", shared: true }],
});
const moodScenes: Scene[] = [{ id: "s", type: "scene", name: "S", blocks: [
  { id: "b_set", type: "block", name: "Set", children: [
    { id: "sn_set", type: "snippet", beats: [{ id: "T_set", kind: "text" }],
      onExit: [{ kind: "set", target: "@mood", value: '"wary"' }], jump: { to: "END" } },
  ] },
  { id: "b_probe", type: "block", name: "Probe", gameId: "probe", children: [
    { id: "sn_p", type: "snippet", beats: [{ id: "T_p", kind: "text" }], jump: { to: "END" } },
  ] },
] }] as Scene[];
const scriptedEnumDeletedValue = {
  name: "enum: a saved value the edit deleted goes back to the default, and is reported",
  project: moodProject(["calm", "tense", "wary"]),
  scenes: moodScenes,
  locales: [loc("s", { T_set: "set", T_p: "mood {@mood}" })],
  projectB: moodProject(["calm", "tense"]),
  scenesB: moodScenes.map((sc) => ({ ...sc, blocks: sc.blocks.filter((b) => b.id === "b_probe") })),
  localesB: [loc("s", { T_set: "set", T_p: "mood {@mood}" })],
  script: [
    { op: "openFlow", flow: "f", scene: "s" },
    { op: "advance", expect: [{ type: "text", id: "T_set", text: "set" }] },
    { op: "advance", expect: [{ type: "end" }] },       // leaving sn_set: @mood = "wary"
    { op: "hotSwap" },
    { op: "expectRefits", expectResult: [{ scope: "patter", name: "mood", value: "wary" }] },
    { op: "goto", scene: "s", block: "probe", expectResult: true },
    { op: "advance", expect: [{ type: "text", id: "T_p", text: "mood calm" }] },
    { op: "advance", expect: [{ type: "end" }] },
  ],
} satisfies ScriptedFixture;

// A quality game-data value: a node's stage, read through the type's fields like any other value, and the
// field's default (none given: its first stage, which the compiler writes into the bundle) where the node
// sets none. The enum beside it takes its first value the same way.
const gameDataQualityProject = project({ gameDataFields: {
  line: [
    { name: "act", type: "quality", stages: ["arrival", "act-1", "act-2"] },
    { name: "mood", type: "enum", values: ["calm", "tense"] },
  ],
} });
const gameDataQuality = {
  name: "gameData: a quality field holds a stage, and defaults to its first",
  project: gameDataQualityProject, kind: "line", node: { act: "act-2" },
  expected: { act: "act-2", mood: "calm" },
} satisfies GameDataFixture;
const gameDataQualityDefaults = {
  name: "gameData: fields declared with no default take their type's, written into the bundle",
  project: gameDataQualityProject, kind: "line",
  expected: { act: "arrival", mood: "calm" },
} satisfies GameDataFixture;

// An option's fields: a choice's options are a node kind of their own, declared like any other, so a host resolves
// the gameData an option arrives with (raw, on getChoices) against the option fields. A key no field declares, such
// as the Storylets pairing's `outcome` where the project leaves it undeclared, comes through as it stands.
const gameDataOptionProject = project({ gameDataFields: {
  option: [
    { name: "tone", type: "enum", values: ["kind", "curt"] },
    { name: "act", type: "quality", stages: ["arrival", "departure"], default: "departure" },
  ],
} });
const gameDataOption = {
  name: "gameData: an option's fields resolve like any node kind's",
  project: gameDataOptionProject, kind: "option", node: { tone: "curt", outcome: "o-leave" },
  expected: { tone: "curt", act: "departure", outcome: "o-leave" },
} satisfies GameDataFixture;
const gameDataOptionDefaults = {
  name: "gameData: an option that sets nothing yields the option fields' defaults",
  project: gameDataOptionProject, kind: "option",
  expected: { tone: "kind", act: "departure" },
} satisfies GameDataFixture;

const scriptedListProperties = {
  name: "listProperties: the shared @patter rows, in declaration order",
  project: project({ properties: [
    { name: "gold", type: "number", shared: true, default: 2 },
    { name: "mood", type: "enum", values: ["calm", "tense"], shared: true, default: "calm" },
    { name: "deal", type: "quality", stages: ["none", "offered", "struck"], shared: true },
    { name: "met", type: "boolean", shared: true },
    { name: "mine", type: "number", shared: false, default: 0 },
  ] }),
  scenes: [{ id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "sn", type: "snippet", beats: [{ id: "T", kind: "text" }],
      onExit: [{ kind: "set", target: "@gold", value: "@gold + 3" }, { kind: "set", target: "@deal", value: "advance(@deal)" }],
      jump: { to: "END" } },
  ] }] }],
  locales: [loc("s", { T: "t" })],
  script: [
    { op: "openFlow", flow: "main", scene: "s" },
    { op: "expectProperties", expectResult: [
      { name: "gold", path: "@patter.gold", type: "number", value: 2, default: 2, writable: true },
      { name: "mood", path: "@patter.mood", type: "enum", values: ["calm", "tense"], value: "calm", default: "calm", writable: true },
      { name: "deal", path: "@patter.deal", type: "quality", stages: ["none", "offered", "struck"], value: "none", default: "none", writable: true },
      { name: "met", path: "@patter.met", type: "boolean", value: false, default: false, writable: true },
    ] },
    { op: "advance", expect: [{ type: "text", id: "T", text: "t" }] },
    { op: "advance", expect: [{ type: "end" }] },
    { op: "expectProperties", expectResult: [
      { name: "gold", path: "@patter.gold", type: "number", value: 5, default: 2, writable: true },
      { name: "mood", path: "@patter.mood", type: "enum", values: ["calm", "tense"], value: "calm", default: "calm", writable: true },
      { name: "deal", path: "@patter.deal", type: "quality", stages: ["none", "offered", "struck"], value: "offered", default: "none", writable: true },
      { name: "met", path: "@patter.met", type: "boolean", value: false, default: false, writable: true },
    ] },
  ],
} satisfies ScriptedFixture;

// --- Patter extensions (patterkit design/proposals/patter-storylet-extensions.md, phase 3) --------------
//
// An extension's values are compiled inline on each node, under `extensions` keyed by extension id, and
// delivered wherever the node's gameData is: on a line, text or game event step, a replayed prompt, a choice's
// option, a scene's and a block's own (`extensionsForScene` / `extensionsForBlock`), and for any node, read off
// the bundle by `extensionsOf`. The engine never interprets them, so the contract is that they arrive exactly as
// the bundle wrote them, in every type (structured ones included, any JSON, compared deeply), and that
// `effectiveGameData(extensionDecls(...))` fills in a field a node leaves out from the bundle's resolved
// declaration. Every case compiles through the real exportBundle. "probe" is the internal test extension
// (never published; its manifest is fixtures/probe.extension.json); "other" shows two extensions on one line
// stay apart.
const probeManifest: unknown = JSON.parse(readFileSync(new URL("../fixtures/probe.extension.json", import.meta.url), "utf8"));
const otherManifest = {
  schema: "wildwinter/extension@0", id: "other", name: "Other", version: "0.1.0",
  targets: { patter: { line: { fields: [{ name: "flag", type: "boolean" }] } } },
};
const extShard = (extension: string, scene: string, entries: ExtensionShard["entries"]): ExtensionShard =>
  ({ schema: "patter/extension@0", extension, scene, entries });

/** The full set of probe line values, raw, as the bundle carries them (keys sorted, as the compiler writes them). */
const probeLineFull = {
  act: "turn", beats: [{ id: "b2", at: 3 }, { id: "b1", at: 1 }], cue: { sound: "bell", gain: 0.5 }, loud: true,
  marks: ["night", "rain"], next: "L_bare", note: "lights down",
  perf: { ANNA: { expression: "frown", look: "away" }, BO: { expression: "smile", look: "" } },
  tone: "tense", weight: 4, words: ["salt", "rope"],
};
/** Every probe line field from its default: a structured default arrives whole, as the bundle resolved it. */
const probeLineDefaults = {
  act: "setup", beats: [], cue: { sound: "", gain: 0 }, loud: false, marks: [], next: "", note: "", perf: {},
  tone: "calm", weight: 1, words: [],
};

const probeProject = (extra: Partial<ProjectFile> = {}): ProjectFile => project({
  cast: [{ name: "ANNA" }, { name: "BO" }],
  gameDataFields: { line: [{ name: "delivery", type: "enum", values: ["calm", "tense"] }] },
  extensions: { probe: { version: "1.1.0" }, other: { version: "0.1.0" } },
  ...extra,
});
const probeScenes: Scene[] = [{
  id: "s_probe", type: "scene", name: "Probe", gameId: "the-probe",
  blocks: [{ id: "b_main", type: "block", name: "Main", children: [
    { id: "sn_a", type: "snippet", beats: [
      { id: "L_full", kind: "line", character: "ANNA", gameData: { delivery: "tense" } },
      { id: "T_one", kind: "text" },
      { id: "E_one", kind: "gameEvent" },
      { id: "L_bare", kind: "line", character: "BO" },
    ] },
    { id: "g_pick", type: "group", selector: "choice", children: [
      { id: "o_go", type: "group", prompt: { id: "P_go", kind: "line", character: "ANNA" }, children: [
        { id: "sn_go", type: "snippet", beats: [{ id: "T_go", kind: "text" }], jump: { to: "END" } },
      ] },
      { id: "o_stay", type: "group", prompt: { id: "P_stay", kind: "text" }, children: [
        { id: "sn_stay", type: "snippet", beats: [{ id: "T_stay", kind: "text" }], jump: { to: "END" } },
      ] },
    ] },
  ] }],
}];
const probeLocales = [loc("s_probe", {
  L_full: "Lights down.", T_one: "The hall goes quiet.", L_bare: "Now?", P_go: "Let's go.", P_stay: "Stay.", T_go: "Gone.", T_stay: "Stayed.",
})];
const probeShards: ExtensionShard[] = [
  extShard("probe", "s_probe", {
    scene: { s_probe: { theme: "harbour" } },
    block: { b_main: { pace: 2 } },
    snippet: { sn_a: { weight: 3 } },
    line: { L_full: probeLineFull, P_go: { note: "prompt" } },
    text: { T_one: { style: "hushed" } },
    gameEvent: { E_one: { cue: "thunder" } },
    option: { o_go: { icon: "door" } },
  }),
  extShard("other", "s_probe", { line: { L_full: { flag: true } } }),
  extShard("probe", "@project", { project: { conf: { studio: "Wildwinter" } } }),
];

const scriptedExtensions: ScriptedFixture = {
  name: "extension values reach the game raw on every step, option and node, in every type, and the helpers fill in defaults",
  project: probeProject(),
  scenes: probeScenes,
  locales: probeLocales,
  extensionManifests: [probeManifest, otherManifest],
  extensionShards: probeShards,
  engineOptions: { replayPromptOnChoose: true },
  script: [
    { op: "openFlow", flow: "main", scene: "s_probe" },
    // Two extensions on one line, side by side, beside the line's own gameData.
    { op: "advance", expect: [{ type: "line", id: "L_full", text: "Lights down.", character: "ANNA", gameData: { delivery: "tense" },
      extensions: { other: { flag: true }, probe: probeLineFull } }] },
    { op: "advance", expect: [{ type: "text", id: "T_one", text: "The hall goes quiet.", extensions: { probe: { style: "hushed" } } }] },
    { op: "advance", expect: [{ type: "gameEvent", id: "E_one", extensions: { probe: { cue: "thunder" } } }] },
    // A beat with none carries no key at all.
    { op: "advance", expect: [{ type: "line", id: "L_bare", text: "Now?", character: "BO" }] },
    { op: "advance", expect: [{ type: "choice", groupId: "g_pick", options: [
      { id: "o_go", prompt: { kind: "line", text: "Let's go.", character: "ANNA" }, eligible: true, extensions: { probe: { icon: "door" } } },
      { id: "o_stay", prompt: { kind: "text", text: "Stay." }, eligible: true },
    ] }] },
    // Saved at the pending choice: the save carries no extension values, and the options read theirs back off
    // their nodes on load.
    { op: "saveLoad" },
    { op: "advance", expect: [{ type: "choice", groupId: "g_pick", options: [
      { id: "o_go", prompt: { kind: "line", text: "Let's go.", character: "ANNA" }, eligible: true, extensions: { probe: { icon: "door" } } },
      { id: "o_stay", prompt: { kind: "text", text: "Stay." }, eligible: true },
    ] }] },
    { op: "stepFor", beat: "P_go", expect: [{ type: "line", id: "P_go", text: "Let's go.", character: "ANNA", extensions: { probe: { note: "prompt" } } }] },
    { op: "choose", id: "o_go" },
    // The prompt spoken back carries its own beat's values.
    { op: "advance", expect: [{ type: "line", id: "P_go", text: "Let's go.", character: "ANNA", extensions: { probe: { note: "prompt" } } }] },
    { op: "advance", expect: [{ type: "text", id: "T_go", text: "Gone." }] },
    { op: "advance", expect: [{ type: "end" }] },
    // A scene's and a block's own values, by id or gameId; none for a ref that doesn't resolve.
    { op: "expectExtensions", scene: "s_probe", expectResult: { probe: { theme: "harbour" } } },
    { op: "expectExtensions", scene: "the-probe", expectResult: { probe: { theme: "harbour" } } },
    { op: "expectExtensions", scene: "s_probe", block: "b_main", expectResult: { probe: { pace: 2 } } },
    { op: "expectExtensions", scene: "the-probe", block: "main", expectResult: { probe: { pace: 2 } } },
    { op: "expectExtensions", scene: "nowhere", expectResult: {} },
    { op: "expectExtensions", scene: "s_probe", block: "nowhere", expectResult: {} },
    // A snippet's own values, by id; none for one with none, an unknown id, or a node that isn't a snippet.
    { op: "expectExtensions", snippet: "sn_a", expectResult: { probe: { weight: 3 } } },
    { op: "expectExtensions", snippet: "sn_go", expectResult: {} },
    { op: "expectExtensions", snippet: "nowhere", expectResult: {} },
    { op: "expectExtensions", snippet: "o_go", expectResult: {} },
    { op: "expectExtensions", snippet: "L_full", expectResult: {} },
    // Any node, off the bundle.
    { op: "expectNodeExtensions", kind: "project", expectResult: { probe: { studio: "Wildwinter" } } },
    { op: "expectNodeExtensions", kind: "project", effective: { extension: "probe" }, expectResult: { studio: "Wildwinter" } },
    { op: "expectNodeExtensions", kind: "scene", address: "the-probe", expectResult: { probe: { theme: "harbour" } } },
    { op: "expectNodeExtensions", kind: "block", address: "the-probe/main", expectResult: { probe: { pace: 2 } } },
    { op: "expectNodeExtensions", kind: "block", address: "s_probe/b_main", effective: { extension: "probe" }, expectResult: { pace: 2 } },
    { op: "expectNodeExtensions", kind: "snippet", address: "sn_a", expectResult: { probe: { weight: 3 } } },
    { op: "expectNodeExtensions", kind: "snippet", address: "sn_go", expectResult: {} },
    { op: "expectNodeExtensions", kind: "snippet", address: "sn_go", effective: { extension: "probe" }, expectResult: { weight: 0 } },
    { op: "expectNodeExtensions", kind: "option", address: "o_go", expectResult: { probe: { icon: "door" } } },
    { op: "expectNodeExtensions", kind: "option", address: "o_stay", effective: { extension: "probe" }, expectResult: { icon: "" } },
    { op: "expectNodeExtensions", kind: "line", address: "L_full", expectResult: { other: { flag: true }, probe: probeLineFull } },
    { op: "expectNodeExtensions", kind: "line", address: "L_full", effective: { extension: "probe" }, expectResult: probeLineFull },
    { op: "expectNodeExtensions", kind: "line", address: "L_bare", effective: { extension: "probe" }, expectResult: probeLineDefaults },
    { op: "expectNodeExtensions", kind: "line", address: "L_full", effective: { extension: "other" }, expectResult: { flag: true } },
    { op: "expectNodeExtensions", kind: "line", address: "L_bare", effective: { extension: "other" }, expectResult: { flag: false } },
    { op: "expectNodeExtensions", kind: "line", address: "P_go", expectResult: { probe: { note: "prompt" } } },
    { op: "expectNodeExtensions", kind: "text", address: "T_one", expectResult: { probe: { style: "hushed" } } },
    { op: "expectNodeExtensions", kind: "gameEvent", address: "E_one", expectResult: { probe: { cue: "thunder" } } },
    // A node of another kind, or no node at all, reads as none.
    { op: "expectNodeExtensions", kind: "line", address: "T_one", expectResult: {} },
    { op: "expectNodeExtensions", kind: "line", address: "nowhere", expectResult: {} },
  ],
};

// What the compile does to the data: an editor-only field never reaches the bundle (not its value, not its
// declaration), a stage the extension renamed arrives under its new name, a node left with only editor-only
// values has no `extensions` at all, an entry with an error is left out, an entry in another scene's shard is
// compiled all the same, and an `extensions` key written by hand on a source beat never leaks.
const scriptedExtensionsCompile: ScriptedFixture = {
  name: "extension values as the compile leaves them: editor-only out, renamed stages renamed, bad entries left out",
  project: probeProject({ extensions: { probe: { version: "1.1.0" } } }),
  scenes: [
    { id: "s_c", type: "scene", name: "C", blocks: [{ id: "b_c", type: "block", name: "B", children: [
      { id: "sn_c", type: "snippet", beats: [
        { id: "L_draft", kind: "line", character: "ANNA" },
        { id: "L_only", kind: "line", character: "ANNA" },
        { id: "L_bad", kind: "line", character: "ANNA" },
        { id: "L_hand", kind: "line", character: "ANNA", extensions: { probe: { note: "sneaky" } } },
      ], jump: { to: "END" } },
    ] }] },
    { id: "s_far", type: "scene", name: "Far", blocks: [{ id: "b_far", type: "block", name: "B", children: [
      { id: "sn_far", type: "snippet", beats: [{ id: "L_far", kind: "line", character: "BO" }], jump: { to: "END" } },
    ] }] },
  ],
  locales: [loc("s_c", { L_draft: "One.", L_only: "Two.", L_bad: "Three.", L_hand: "Four." }), loc("s_far", { L_far: "Far." })],
  extensionManifests: [probeManifest],
  extensionShards: [extShard("probe", "s_c", { line: {
    L_draft: { draft: "working notes", act: "opening", note: "hi" },
    L_only: { draft: "only this" },
    L_bad: { weight: 99, note: "too heavy" },
    L_far: { note: "far" },
  } })],
  script: [
    { op: "openFlow", flow: "main", scene: "s_c" },
    { op: "advance", expect: [{ type: "line", id: "L_draft", text: "One.", character: "ANNA", extensions: { probe: { act: "setup", note: "hi" } } }] },
    { op: "advance", expect: [{ type: "line", id: "L_only", text: "Two.", character: "ANNA" }] },
    { op: "advance", expect: [{ type: "line", id: "L_bad", text: "Three.", character: "ANNA" }] },
    { op: "advance", expect: [{ type: "line", id: "L_hand", text: "Four.", character: "ANNA" }] },
    { op: "advance", expect: [{ type: "end" }] },
    { op: "expectNodeExtensions", kind: "line", address: "L_only", expectResult: {} },
    // The declarations carry no editor-only field, so neither does the filled-in view.
    { op: "expectNodeExtensions", kind: "line", address: "L_only", effective: { extension: "probe" }, expectResult: probeLineDefaults },
    { op: "expectNodeExtensions", kind: "line", address: "L_draft", effective: { extension: "probe" }, expectResult: { ...probeLineDefaults, note: "hi" } },
    { op: "expectNodeExtensions", kind: "line", address: "L_far", expectResult: { probe: { note: "far" } } },
    { op: "openFlow", flow: "far", scene: "s_far" },
    { op: "advance", expect: [{ type: "line", id: "L_far", text: "Far.", character: "BO", extensions: { probe: { note: "far" } } }] },
  ],
};

// A project that takes no extension: a bundle with none hands none back anywhere, and the helpers read `{}`.
const scriptedNoExtensions: ScriptedFixture = {
  name: "a bundle with no extensions hands back none, and the helpers read nothing",
  project: project({ cast: [{ name: "ANNA" }], gameDataFields: { scene: [{ name: "music", type: "text" }] } }),
  scenes: [{ id: "s_none", type: "scene", name: "None", gameData: { music: "harp" }, blocks: [{ id: "b_none", type: "block", name: "B", children: [
    { id: "sn_none", type: "snippet", beats: [{ id: "L_none", kind: "line", character: "ANNA" }, { id: "E_none", kind: "gameEvent" }] },
    { id: "g_none", type: "group", selector: "choice", children: [
      { id: "o_none", type: "group", prompt: { id: "P_none", kind: "text" }, children: [{ id: "sn_o", type: "snippet", jump: { to: "END" } }] },
    ] },
  ] }] }],
  locales: [loc("s_none", { L_none: "Plain.", P_none: "On." })],
  script: [
    { op: "openFlow", flow: "main", scene: "s_none" },
    { op: "advance", expect: [{ type: "line", id: "L_none", text: "Plain.", character: "ANNA" }] },
    { op: "advance", expect: [{ type: "gameEvent", id: "E_none" }] },
    { op: "advance", expect: [{ type: "choice", groupId: "g_none", options: [{ id: "o_none", prompt: { kind: "text", text: "On." }, eligible: true }] }] },
    { op: "expectExtensions", scene: "s_none", expectResult: {} },
    { op: "expectExtensions", scene: "s_none", block: "b_none", expectResult: {} },
    { op: "expectNodeExtensions", kind: "project", expectResult: {} },
    { op: "expectNodeExtensions", kind: "line", address: "L_none", expectResult: {} },
    // An extension the bundle doesn't have: no declarations, nothing filled in.
    { op: "expectNodeExtensions", kind: "line", address: "L_none", effective: { extension: "probe" }, expectResult: {} },
    { op: "expectNodeExtensions", kind: "project", effective: { extension: "probe" }, expectResult: {} },
    { op: "expectNodeExtensions", kind: "scene", address: "nowhere", expectResult: {} },
    { op: "expectNodeExtensions", kind: "nothing", address: "L_none", expectResult: {} },
  ],
};

// The outline carries a scene's, a block's and each beat's extension values beside their gameData, a prompt's
// included; a node with none has no key.
const outlineExtensions: DescribeFixture = {
  name: "the outline and beat sequence carry extension values on scenes, blocks and beats",
  project: probeProject(),
  scenes: probeScenes,
  locales: probeLocales,
  extensionManifests: [probeManifest, otherManifest],
  extensionShards: probeShards,
};

// --- the outline and beat sequence --------------------------------------------------------------------
// One project with something in every field the structure reads: tags and Game Data on a scene, a block,
// and beats; a choice with a spoken prompt and a text one; a sequence; a call jump and a plain one; a
// line with a direction; a game event; and a second block and scene.
const outlineEverything = {
  name: "the outline and beat sequence of a project with every kind of node",
  project: project({
    cast: [{ name: "ANNA" }, { name: "BRAM" }],
    gameDataFields: { scene: [{ name: "music", type: "text" }], line: [{ name: "mood", type: "text" }] },
  }),
  scenes: [{
    id: "s_hall", type: "scene", name: "Great Hall", tags: ["indoor"], gameData: { music: "harp" },
    blocks: [{ id: "b_door", type: "block", name: "Door", tags: ["door"], children: [
      { id: "sn_open", type: "snippet", tags: ["opening"], beats: [
        { id: "L_hi", kind: "line", character: "ANNA", direction: "warmly", qualifier: "os", padAfter: -0.3, gameData: { mood: "glad" }, tags: ["greeting"] },
        { id: "E_bell", kind: "gameEvent", gameData: { mood: "loud" } },
        { id: "T_wind", kind: "text" },
      ] },
      { id: "g_ask", type: "group", selector: "choice", children: [
        { id: "o_knock", type: "group", prompt: { id: "P_knock", kind: "line", character: "BRAM" },
          children: [{ id: "sn_k", type: "snippet", beats: [{ id: "T_k", kind: "text" }], jump: { to: "b_cellar", mode: "call" } }] },
        { id: "o_leave", type: "group", prompt: { id: "P_leave", kind: "text" },
          children: [{ id: "sn_l", type: "snippet", jump: { to: "END" } }] },
      ] },
    ] }, {
      id: "b_cellar", type: "block", name: "Cellar", padAfterDefault: 1.2, children: [
        { id: "g_seq", type: "group", selector: "sequence", options: { order: "sequential", exhaust: "stick" }, children: [
          { id: "sn_c1", type: "snippet", beats: [{ id: "T_c1", kind: "text" }] },
          { id: "sn_c2", type: "snippet", beats: [{ id: "T_c2", kind: "text" }] },
        ] },
      ],
    }],
  }, {
    id: "s_yard", type: "scene", name: "Yard", gameId: "the-yard", blocks: [{ id: "b_gate", type: "block", name: "Gate", children: [
      { id: "sn_g", type: "snippet", beats: [{ id: "T_g", kind: "text" }], jump: { to: "s_hall" } },
    ] }],
  }],
  locales: [
    loc("s_hall", { L_hi: "Hello.", T_wind: "Wind.", P_knock: "Knock", P_leave: "Leave", T_k: "knock", T_c1: "dark", T_c2: "darker" }),
    loc("s_yard", { T_g: "gate" }),
  ],
} satisfies DescribeFixture;

// --- the audio resolver ----------------------------------------------------------------------------
// A manifest names each beat's winning take relative to the audio folder; the resolver joins it to where
// the game deployed that folder. A base that already ends in a separator (a root such as "/" or "res://")
// is kept as it stands; a beat with no take, or a take with no file, is null.
const audioManifest = {
  name: "the audio resolver joins a base and a take, and has nothing for a beat with no take",
  manifest: JSON.stringify({ schema: "patter/audio@0", clips: {
    L1: { file: "final/L1.wav", rung: "final" },
    L2: { file: "scratch/L2.mp3", rung: "scratch" },
    L3: { file: "", rung: "final" },
  } }),
  lookups: [
    { base: "audio", beatId: "L1", expected: "audio/final/L1.wav" },
    { base: "audio/", beatId: "L2", expected: "audio/scratch/L2.mp3" },
    { base: "/", beatId: "L1", expected: "/final/L1.wav" },
    { base: "res://", beatId: "L1", expected: "res://final/L1.wav" },
    { base: "C:\\Game\\Audio\\", beatId: "L1", expected: "C:\\Game\\Audio\\final/L1.wav" },
    { base: "", beatId: "L2", expected: "scratch/L2.mp3" },
    { base: "audio", beatId: "L9", expected: null },
    { base: "audio", beatId: "L3", expected: null },
  ],
};

// --- the runtime foundations before 1.0 (corpus 8) ---------------------------------------------------
// The hands-on review of October 2026 found five ways the runtimes went quiet where they should have spoken, or
// spoke in a language the player had left. Each case below pins one of the fixes on every runtime.

// One rule for a locale (ruling Q2): case and `_` / `-` don't matter, so an exact match wins, then the language
// alone, then the default. Anything but an exact match is reported, `engine.locale` says the locale in use, and
// a hot swap, which builds a new engine, resolves and reports again.
const localeScenes: Scene[] = [{ id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
  { id: "n", type: "snippet", beats: [
    { id: "T1", kind: "text" }, { id: "T2", kind: "text" }, { id: "T3", kind: "text" }, { id: "T4", kind: "text" }, { id: "T5", kind: "text" },
  ], jump: { to: "END" } },
] }] }];
const scriptedLocaleRule = {
  name: "a locale resolves by one rule (case, then language, then the default), each fallback reported",
  project: project({ locales: { default: "en", all: ["en", "fr"] } }),
  scenes: localeScenes,
  scenesB: localeScenes,
  locales: [
    loc("s", { T1: "one", T2: "two", T3: "three", T4: "four", T5: "five" }, "en"),
    loc("s", { T1: "un", T2: "deux", T3: "trois", T4: "quatre", T5: "cinq" }, "fr"),
  ],
  locale: "FR",
  script: [
    { op: "expectErrors", expectResult: [{ kind: "setup", node: "FR", flow: "" }] },  // reported as the engine was made
    { op: "expectLocale", expectResult: { locale: "fr", default: "en", included: ["en", "fr"] } },
    { op: "openFlow", flow: "main", scene: "s" },
    { op: "advance", expect: [{ type: "text", id: "T1", text: "un" }] },
    { op: "setLocale", locale: "fr-CA" },                                               // its language
    { op: "expectErrors", expectResult: [{ kind: "setup", node: "fr-CA" }] },
    { op: "expectLocale", expectResult: { locale: "fr", default: "en", included: ["en", "fr"] } },
    { op: "advance", expect: [{ type: "text", id: "T2", text: "deux" }] },
    { op: "setLocale", locale: "de" },                                                  // the default, marked
    { op: "expectErrors", expectResult: [{ kind: "setup", node: "de" }] },
    { op: "expectLocale", expectResult: { locale: "en", default: "en", included: ["en", "fr"] } },
    { op: "advance", expect: [{ type: "text", id: "T3", text: "<Untranslated: T3> three" }] },
    { op: "setLocale", locale: "en" },                                                  // exact: nothing to say
    { op: "expectErrors", expectResult: [] },
    { op: "advance", expect: [{ type: "text", id: "T4", text: "four" }] },
    { op: "setLocale", locale: "fr_FR" },
    { op: "expectErrors", expectResult: [{ kind: "setup", node: "fr_FR" }] },
    { op: "hotSwap" },                                                                  // a new engine: reported again
    { op: "expectErrors", expectResult: [{ kind: "setup", node: "fr_FR" }] },
    { op: "expectLocale", expectResult: { locale: "fr", default: "en", included: ["en", "fr"] } },
    { op: "advance", expect: [{ type: "text", id: "T5", text: "cinq" }] },
    { op: "advance", expect: [{ type: "end" }] },
  ],
} satisfies ScriptedFixture;

// A language never looks for its regions: "fr" is not "fr-FR", so it falls back to the default, marked.
const scriptedLocaleNoRegion = {
  name: "a locale never looks for its regions: fr falls back to the default when the bundle has only fr-FR",
  project: project({ locales: { default: "en", all: ["en", "fr-FR"] } }),
  scenes: localeScenes,
  locales: [
    loc("s", { T1: "one", T2: "two", T3: "three", T4: "four", T5: "five" }, "en"),
    loc("s", { T1: "un", T2: "deux", T3: "trois", T4: "quatre", T5: "cinq" }, "fr-FR"),
  ],
  locale: "fr",
  script: [
    { op: "expectErrors", expectResult: [{ kind: "setup", node: "fr", flow: "" }] },
    { op: "expectLocale", expectResult: { locale: "en", default: "en", included: ["en", "fr-FR"] } },
    { op: "openFlow", flow: "main", scene: "s" },
    { op: "advance", expect: [{ type: "text", id: "T1", text: "<Untranslated: T1> one" }] },
  ],
} satisfies ScriptedFixture;

// An IDs-only bundle takes the locale as given and says nothing: the game localises it.
const scriptedLocaleIds = {
  name: "an IDs-only bundle takes any locale as given, unreported",
  project: project({ locales: { default: "en", all: ["en"] } }),
  scenes: localeScenes,
  locales: [loc("s", { T1: "one", T2: "two", T3: "three", T4: "four", T5: "five" })],
  idsOnly: true,
  locale: "xx-YY",
  script: [
    { op: "expectErrors", expectResult: [] },
    { op: "expectLocale", expectResult: { locale: "xx-YY", default: "en", included: ["en"] } },
    { op: "openFlow", flow: "main", scene: "s" },
    { op: "advance", expect: [{ type: "text", id: "T1", text: "T1" }] },
  ],
} satisfies ScriptedFixture;

// A host scope bound under a token the bundle doesn't declare is reported, never folded (ruling F): `World` is
// not `world`, which the engine then self-backs from its defaults as it would with nothing bound.
const scriptedHostScopeWrongCase = {
  name: "a host scope bound under a token the bundle doesn't declare (only the case differs) is reported, never folded",
  project: project({ scopeRegistry: { version: 1, scopes: [{ token: "world", declarations: [{ name: "alarms", type: "number", default: 2 }] }] } }),
  scenes: [{ id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "n", type: "snippet", beats: [{ id: "T", kind: "text" }], jump: { to: "END" } },
  ] }] }],
  locales: [loc("s", { T: "alarms: {@world.alarms}" })],
  hostScopes: ["World"],
  script: [
    { op: "expectErrors", expectResult: [{ kind: "setup", node: "World", flow: "" }] },
    { op: "openFlow", flow: "main", scene: "s" },
    { op: "advance", expect: [{ type: "text", id: "T", text: "alarms: 2" }] },  // the self-backed default
  ],
} satisfies ScriptedFixture;

// A host write that doesn't fit its declaration is refused, changing nothing (ruling B), as the Storylet Engine
// refuses one: the kernel's `valueFits`, an enum whose own default is "" taking "" back. A name the content
// doesn't declare is refused too, in @patter and in a host scope the bundle declares.
const scriptedHostWrites = {
  name: "a host write that doesn't fit its declaration, or names nothing declared, is refused and changes nothing",
  project: project({
    properties: [
      { name: "gold", type: "number", shared: true, default: 1 },
      { name: "mood", type: "enum", values: ["calm", "tense"], shared: true, default: "" },
      { name: "keys", type: "flags", values: ["iron", "brass"], shared: true },
      { name: "act", type: "quality", stages: ["one", "two"], shared: true, default: "one" },
      { name: "note", type: "string", shared: true, default: "" },
    ],
    // `fx` is opaque: it declares no names, so any name and value in it is the game's, never refused.
    scopeRegistry: { version: 1, scopes: [{ token: "world", declarations: [{ name: "alarm", type: "boolean", default: false }] }, { token: "fx" }] },
  }),
  scenes: [{ id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "n", type: "snippet", beats: [{ id: "T", kind: "text" }], jump: { to: "END" } },
  ] }] }],
  locales: [loc("s", { T: "{@gold} [{@mood}] {@act} {@note} {@world.alarm} {@keys} {@fx.glow}" })],
  script: [
    { op: "setProperty", ref: "@gold", value: "lots", expectRefused: true },
    { op: "setProperty", ref: "@gold", value: 5 },
    { op: "setProperty", ref: "@mood", value: "angry", expectRefused: true },
    { op: "setProperty", ref: "@mood", value: "tense" },
    { op: "setProperty", ref: "@mood", value: "" },                         // its own default: none chosen
    { op: "setProperty", ref: "@keys", value: ["iron", "gold"], expectRefused: true },
    { op: "setProperty", ref: "@keys", value: ["brass"] },
    { op: "setProperty", ref: "@act", value: "three", expectRefused: true },
    { op: "setProperty", ref: "@act", value: "two" },
    { op: "setProperty", ref: "@note", value: 3, expectRefused: true },
    { op: "setProperty", ref: "@world.alarm", value: 1, expectRefused: true },
    { op: "setProperty", ref: "@world.alarm", value: true },
    { op: "setProperty", ref: "@world.bells", value: 1, expectRefused: true }, // not declared in a declared scope
    { op: "setProperty", ref: "@silver", value: 1, expectRefused: true },      // not declared at all
    { op: "setProperty", ref: "@fx.glow", value: 3 },                           // an opaque scope takes anything
    { op: "openFlow", flow: "main", scene: "s" },
    { op: "advance", expect: [{ type: "text", id: "T", text: "5 [] two  true brass 3" }] },
  ],
} satisfies ScriptedFixture;

// What a host is handed is its own copy of the gameData (ruling Q4): a game that edits a step's, or an option's,
// a flags list among them, changes nothing this engine, or another on the same bundle, hands out next.
const scriptedGameDataCopied = {
  name: "a step's and an option's gameData are the host's own copy: defacing them changes nothing handed out next",
  project: project(),
  scenes: [{ id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "n", type: "snippet", beats: [{ id: "L", kind: "line", character: "NPC", gameData: { cam: "wide", marks: ["x", "y"] } }] },
    { id: "g", type: "group", selector: "choice", children: [
      { id: "o", type: "group", gameData: { icon: "ear", tags: ["calm"] }, prompt: { id: "P", kind: "text" }, children: [
        { id: "o_c", type: "snippet", jump: { to: "END" } },
      ] },
    ] },
  ] }] }],
  locales: [loc("s", { L: "Hello.", P: "Listen" })],
  script: [
    { op: "openFlow", flow: "main", scene: "s" },
    { op: "advance", expect: [{ type: "line", id: "L", text: "Hello.", character: "NPC", gameData: { cam: "wide", marks: ["x", "y"] } }] },
    { op: "scribble" },
    { op: "stepFor", beat: "L", expect: [{ type: "line", id: "L", text: "Hello.", character: "NPC", gameData: { cam: "wide", marks: ["x", "y"] } }] },
    { op: "scribble" },
    { op: "advance", expect: [{ type: "choice", groupId: "g", options: [
      { id: "o", prompt: { kind: "text", text: "Listen" }, eligible: true, gameData: { icon: "ear", tags: ["calm"] } },
    ] }] },
    { op: "scribble" },
    { op: "advance", expect: [{ type: "choice", groupId: "g", options: [
      { id: "o", prompt: { kind: "text", text: "Listen" }, eligible: true, gameData: { icon: "ear", tags: ["calm"] } },
    ] }] },
    { op: "scribble" },
    { op: "saveLoad" },                                                       // a second engine on the same bundle
    { op: "resetFlow", scene: "s" },
    { op: "advance", expect: [{ type: "line", id: "L", text: "Hello.", character: "NPC", gameData: { cam: "wide", marks: ["x", "y"] } }] },
    { op: "advance", expect: [{ type: "choice", groupId: "g", options: [
      { id: "o", prompt: { kind: "text", text: "Listen" }, eligible: true, gameData: { icon: "ear", tags: ["calm"] } },
    ] }] },
  ],
} satisfies ScriptedFixture;

// A pending choice's options follow the language and the values (ruling Q1): their prompts are built whenever the
// choice is delivered, never kept as text, so `setLocale` reaches them and a save loads in the language of the
// engine that loads it. (The replayed prompt is the documented exception: scriptedReplayShown.)
const scriptedChoiceFollowsLocale = {
  name: "a pending choice's prompts follow setLocale and the current values, and a save loads in the loading engine's language",
  project: project({ locales: { default: "en", all: ["en", "fr"] }, properties: [{ name: "coins", type: "number", shared: true, default: 3 }] }),
  scenes: [{ id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "g", type: "group", selector: "choice", children: [
      { id: "o_pay", type: "group", prompt: { id: "P_pay", kind: "text" }, children: [{ id: "pay_c", type: "snippet", beats: [{ id: "T_pay", kind: "text" }], jump: { to: "END" } }] },
      { id: "o_go", type: "group", prompt: { id: "P_go", kind: "text" }, children: [{ id: "go_c", type: "snippet", jump: { to: "END" } }] },
    ] },
  ] }] }],
  locales: [
    loc("s", { P_pay: "Pay {@coins}", P_go: "Leave", T_pay: "Paid." }, "en"),
    loc("s", { P_pay: "Payer {@coins}", P_go: "Partir", T_pay: "Payé." }, "fr"),
  ],
  script: [
    { op: "openFlow", flow: "main", scene: "s" },
    { op: "advance", expect: [{ type: "choice", groupId: "g", options: [
      { id: "o_pay", prompt: { kind: "text", text: "Pay 3" }, eligible: true },
      { id: "o_go", prompt: { kind: "text", text: "Leave" }, eligible: true },
    ] }] },
    { op: "setLocale", locale: "fr" },
    { op: "setProperty", ref: "@coins", value: 5 },
    { op: "advance", expect: [{ type: "choice", groupId: "g", options: [ // the same choice, in French, at 5
      { id: "o_pay", prompt: { kind: "text", text: "Payer 5" }, eligible: true },
      { id: "o_go", prompt: { kind: "text", text: "Partir" }, eligible: true },
    ] }] },
    { op: "saveLoad" },                                                    // the loading engine is in English
    { op: "advance", expect: [{ type: "choice", groupId: "g", options: [
      { id: "o_pay", prompt: { kind: "text", text: "Pay 5" }, eligible: true },
      { id: "o_go", prompt: { kind: "text", text: "Leave" }, eligible: true },
    ] }] },
    { op: "choose", id: "o_pay" },
    { op: "advance", expect: [{ type: "text", id: "T_pay", text: "Paid." }] },
    { op: "advance", expect: [{ type: "end" }] },
  ],
} satisfies ScriptedFixture;

// A save names the next beat by id (ruling D), so an edit to the snippet under the cursor can't move it: a beat
// inserted before it is not replayed, and nothing is reported, since nothing moved.
const scriptedSaveBeatInserted = {
  name: "a beat inserted before the cursor in the active snippet neither replays nor is reported",
  project: project(),
  scenes: [{ id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "n", type: "snippet", beats: [{ id: "T1", kind: "text" }, { id: "T2", kind: "text" }], jump: { to: "END" } },
  ] }] }],
  scenesB: [{ id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "n", type: "snippet", beats: [{ id: "T0", kind: "text" }, { id: "T1", kind: "text" }, { id: "T2", kind: "text" }], jump: { to: "END" } },
  ] }] }],
  locales: [loc("s", { T0: "inserted", T1: "one", T2: "two" })],
  script: [
    { op: "openFlow", flow: "main", scene: "s" },
    { op: "advance", expect: [{ type: "text", id: "T1", text: "one" }] },
    { op: "hotSwap" },                                                     // the raw index (1) would replay T1
    { op: "advance", expect: [{ type: "text", id: "T2", text: "two" }] },
    { op: "expectErrors", expectResult: [] },
    { op: "advance", expect: [{ type: "end" }] },
  ],
} satisfies ScriptedFixture;

// The next beat itself has gone: the snippet ends there (its onExit runs and its jump is followed), so nothing
// plays twice, and the load reports it (`save`, naming the snippet).
const scriptedSaveBeatDeleted = {
  name: "the next beat deleted from the active snippet: the snippet ends there, its onExit and jump run, reported",
  project: project({ properties: [{ name: "left", type: "boolean", shared: true, default: false }] }),
  scenes: [{ id: "s", type: "scene", name: "S", blocks: [
    { id: "b", type: "block", name: "B", children: [
      { id: "n", type: "snippet", beats: [{ id: "T1", kind: "text" }, { id: "T2", kind: "text" }, { id: "T3", kind: "text" }],
        onExit: [{ kind: "set", target: "@left", value: "true" }], jump: { to: "b2" } },
    ] },
    { id: "b2", type: "block", name: "B2", children: [
      { id: "n2", type: "snippet", beats: [{ id: "T4", kind: "text" }], jump: { to: "END" } },
    ] },
  ] }],
  scenesB: [{ id: "s", type: "scene", name: "S", blocks: [
    { id: "b", type: "block", name: "B", children: [
      { id: "n", type: "snippet", beats: [{ id: "T1", kind: "text" }, { id: "T3", kind: "text" }],
        onExit: [{ kind: "set", target: "@left", value: "true" }], jump: { to: "b2" } },
    ] },
    { id: "b2", type: "block", name: "B2", children: [
      { id: "n2", type: "snippet", beats: [{ id: "T4", kind: "text" }], jump: { to: "END" } },
    ] },
  ] }],
  locales: [loc("s", { T1: "one", T2: "two", T3: "three", T4: "after, left={@left}" })],
  script: [
    { op: "openFlow", flow: "main", scene: "s" },
    { op: "advance", expect: [{ type: "text", id: "T1", text: "one" }] },
    { op: "hotSwap" },
    { op: "expectErrors", expectResult: [{ kind: "save", node: "n", flow: "main" }] },
    { op: "advance", expect: [{ type: "text", id: "T4", text: "after, left=true" }] },
    { op: "advance", expect: [{ type: "end" }] },
  ],
} satisfies ScriptedFixture;

// The option the cursor stood in has gone, its choice still there: the choice is offered again, without it
// (visit counts already hold the first time), and the load reports it.
const scriptedSaveOptionDeleted = {
  name: "the option the cursor stood in deleted: its choice is offered again, reported",
  project: project(),
  scenes: [{ id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "g", type: "group", selector: "choice", children: [
      { id: "o_a", type: "group", prompt: { id: "P_a", kind: "text" }, children: [
        { id: "a_c", type: "snippet", beats: [{ id: "A1", kind: "text" }, { id: "A2", kind: "text" }], jump: { to: "END" } },
      ] },
      { id: "o_b", type: "group", prompt: { id: "P_b", kind: "text" }, children: [
        { id: "b_c", type: "snippet", beats: [{ id: "B1", kind: "text" }], jump: { to: "END" } },
      ] },
    ] },
  ] }] }],
  scenesB: [{ id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "g", type: "group", selector: "choice", children: [
      { id: "o_b", type: "group", prompt: { id: "P_b", kind: "text" }, children: [
        { id: "b_c", type: "snippet", beats: [{ id: "B1", kind: "text" }], jump: { to: "END" } },
      ] },
    ] },
  ] }] }],
  locales: [loc("s", { P_a: "Ask", P_b: "Go", A1: "asked", A2: "asked again", B1: "gone" })],
  script: [
    { op: "openFlow", flow: "main", scene: "s" },
    { op: "advance", expect: [{ type: "choice", groupId: "g", options: [
      { id: "o_a", prompt: { kind: "text", text: "Ask" }, eligible: true },
      { id: "o_b", prompt: { kind: "text", text: "Go" }, eligible: true },
    ] }] },
    { op: "choose", id: "o_a" },
    { op: "advance", expect: [{ type: "text", id: "A1", text: "asked" }] },
    { op: "hotSwap" },
    { op: "expectErrors", expectResult: [{ kind: "save", node: "a_c", flow: "main" }] },
    { op: "advance", expect: [{ type: "choice", groupId: "g", options: [
      { id: "o_b", prompt: { kind: "text", text: "Go" }, eligible: true },
    ] }] },
    { op: "choose", id: "o_b" },
    { op: "advance", expect: [{ type: "text", id: "B1", text: "gone" }] },
    { op: "advance", expect: [{ type: "end" }] },
  ],
} satisfies ScriptedFixture;

// Every option of a pending choice has gone, the choice still there: it is offered again with what it has now.
const scriptedSaveChoiceRewritten = {
  name: "every option of the pending choice replaced: the choice is offered again with its new options, reported",
  project: project(),
  scenes: [{ id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "g", type: "group", selector: "choice", children: [
      { id: "o_a", type: "group", prompt: { id: "P_a", kind: "text" }, children: [{ id: "a_c", type: "snippet", jump: { to: "END" } }] },
    ] },
  ] }] }],
  scenesB: [{ id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "g", type: "group", selector: "choice", children: [
      { id: "o_c", type: "group", prompt: { id: "P_c", kind: "text" }, children: [{ id: "c_c", type: "snippet", beats: [{ id: "C1", kind: "text" }], jump: { to: "END" } }] },
    ] },
  ] }] }],
  locales: [loc("s", { P_a: "Old", P_c: "New", C1: "the new way" })],
  script: [
    { op: "openFlow", flow: "main", scene: "s" },
    { op: "advance", expect: [{ type: "choice", groupId: "g", options: [{ id: "o_a", prompt: { kind: "text", text: "Old" }, eligible: true }] }] },
    { op: "hotSwap" },
    { op: "expectErrors", expectResult: [{ kind: "save", node: "g", flow: "main" }] },
    { op: "advance", expect: [{ type: "choice", groupId: "g", options: [{ id: "o_c", prompt: { kind: "text", text: "New" }, eligible: true }] }] },
    { op: "choose", id: "o_c" },
    { op: "advance", expect: [{ type: "text", id: "C1", text: "the new way" }] },
    { op: "advance", expect: [{ type: "end" }] },
  ],
} satisfies ScriptedFixture;

/** A version 4 save as a version 3 runtime wrote it: the next beat by its index, no `choiceId` on its frames, and each
 *  pending option's prompt as text (here stale, to show a load discards it). For the save cases that stand for a
 *  save on a player's disk from before 1.0. */
const asVersion3 = (save: SaveGame, bundle: Bundle): void => {
  const beatsOf = new Map<string, string[]>();
  const walk = (nodes: ReadonlyArray<CompiledGroup | CompiledSnippet>): void => {
    for (const n of nodes) {
      if (n.type === "snippet") beatsOf.set(n.id, (n.beats ?? []).map((b) => b.id));
      else walk(n.children);
    }
  };
  for (const scene of Object.values(bundle.scenes)) for (const block of scene.blocks) walk(block.children);
  (save as { version: number }).version = 3;
  for (const f of Object.values(save.flows)) {
    const c = f.cursor;
    for (const frame of c.stack) delete frame.choiceId;
    const beats = c.activeSnippetId !== null ? beatsOf.get(c.activeSnippetId) ?? [] : [];
    c.beatIndex = c.beatId !== undefined ? beats.indexOf(c.beatId) : beats.length;
    delete c.beatId;
    for (const o of c.pendingChoice?.options ?? []) Object.assign(o, { prompt: { kind: "text", text: "(stale text from the save)" } });
  }
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
    escapedEmoji, characterName, localeActive, idsMode, tagsAccumulate, choicePrompts, choicePromptsIds, qualityGates, qualityAdvance, qualityScene,
    replayPrompt, replayOff, replayBorrowed, replayCaptionsOff, emptySpeakerFields,
    speakerQualifiers, speakerQualifiersLocale, speakerQualifiersIds, speakerQualifiersSilent, speakerLabels, speakerLabelsLocale,
    linePadding, linePaddingPrompt, actionText, actionTextLocalised,
    specAndSums, specFiller, specCheckFlags, specTie, specDegrades,
  ruleErrorsPlayThrough, ruleBestMatchFailingPart, ruleNumberText, rulePromptTags, ruleAllGreyedRunsDry],
  scripted: [scriptedMultiFlow, scriptedDefaultStartScene, scriptedProjectStart, scriptedGoto, scriptedReset, scriptedSaveLoad, scriptedSaveLoadChoice, scriptedEscapedEmojiSaveLoad, scriptedSetLocale,
    scriptedClosedCaptions, scriptedOptionGroup, scriptedStickyOnce, scriptedFallback,
    scriptedHotSwapReword, scriptedHotSwapInsert, scriptedHotSwapDeleteActive, scriptedHotSwapDropOption,
    scriptedHotSwapEmptiedBlock, scriptedCast, scriptedCastAbsent, scriptedSceneBlockGameData, scriptedQualityInsertion,
    scriptedCheckpoint, scriptedRollbackKeepsParked, scriptedCheckpointOwnMemory, scriptedCheckpointNewFlow, scriptedOpenFlowRefused,
    scriptedReplaySaveLoad, scriptedReplayShown, scriptedEmptySpeakerSaveLoad, ruleConditionOnce, ruleShuffleDrawsEligible, ruleOneAddressRule, scriptedResetFlow,
    scriptedCheckpointRefusals, scriptedSaveInCheckpoint, scriptedBlockInOtherScene, scriptedListProperties, scriptedStages,
    scriptedWorldQuality, scriptedStoryQuality, scriptedQualityDeletedStage, scriptedEnumDeletedValue,
    scriptedQualifierSaveLoad, scriptedSpeakerLabelsSetLocale, scriptedStepFor, scriptedStepForVoiced, scriptedStepForIds, scriptedFlowState, scriptedFlowStateRefusals, scriptedFlowStateEdited,
    scriptedExtensions, scriptedExtensionsCompile, scriptedNoExtensions,
    scriptedLocaleRule, scriptedLocaleNoRegion, scriptedLocaleIds, scriptedHostScopeWrongCase, scriptedHostWrites, scriptedGameDataCopied,
    scriptedChoiceFollowsLocale, scriptedSaveBeatInserted, scriptedSaveBeatDeleted, scriptedSaveOptionDeleted, scriptedSaveChoiceRewritten],
  gameData: [gameDataDefaults, gameDataOrphan, gameDataPureDefaults, gameDataQuality, gameDataQualityDefaults, gameDataOption, gameDataOptionDefaults],
  saves: [
    asSaveFixture(scriptedSaveLoad, "a save written by the JS reference loads elsewhere mid-flow, cursor and selector memory intact"),
    asSaveFixture(scriptedSaveLoadChoice, "a save written by the JS reference loads elsewhere at a pending choice, options replayed"),
    asSaveFixture(scriptedReplaySaveLoad, "a save written by the JS reference between choose and advance speaks the prompt back as shown"),
    // The same save as written before saves carried the shown prompt: only its owner. A runtime loading it
    // resolves the prompt beat when the replay is delivered, as runtimes did then (here after the switch
    // to fr, and after the onEnter), and writes the save back without a `pendingPrompt` it never had.
    {
      ...asSaveFixture(scriptedReplaySaveLoad, "a save written before saves carried the shown prompt resolves the prompt when it is delivered"),
      editSave: (save, bundle) => { asVersion3(save, bundle); for (const f of Object.values(save.flows)) delete f.cursor.pendingPrompt; },
      script: [
        { op: "useFlow", flow: "main" },
        { op: "setLocale", locale: "fr" },
        { op: "advance", expect: [{ type: "line", id: "P_ask", text: "Qui est la ? J'ai 0.", character: "ANNA", characterName: "Annette", direction: "quietly" }] },
        { op: "advance", expect: [{ type: "text", id: "T_ask", text: "Pas de reponse. Il reste 0." }] },
        { op: "advance", expect: [{ type: "end" }] },
      ],
    },
    asSaveFixture(scriptedEmptySpeakerSaveLoad, "a save written by the JS reference keeps a pending choice's empty speaker fields"),
    asSaveFixture(scriptedEscapedEmojiSaveLoad, "a save written by the JS reference with an emoji property value, escaped as a surrogate pair, loads as the one character"),
    asSaveFixture(scriptedQualifierSaveLoad, "a save written by the JS reference keeps a qualified prompt's qualifier, pending and spoken back"),
    // Version 3 saves, as a runtime before 1.0 wrote them, still load, and are written back as version 4.
    { ...asSaveFixture(scriptedSaveLoad, "a version 3 save loads mid-flow, cursor and selector memory intact"), editSave: asVersion3 },
    {
      name: "a version 3 save loads mid-snippet, at the beat its index names",
      project: project(),
      scenes: scriptedSaveBeatInserted.scenes,
      locales: scriptedSaveBeatInserted.locales,
      setup: [{ op: "openFlow", flow: "main", scene: "s" }, { op: "advance", expect: [{ type: "text", id: "T1", text: "one" }] }],
      editSave: asVersion3,
      script: [
        { op: "useFlow", flow: "main" },
        { op: "advance", expect: [{ type: "text", id: "T2", text: "two" }] },
        { op: "advance", expect: [{ type: "end" }] },
      ],
    },
    // A version 3 pending choice's prompt text is discarded: the choice is shown in the loading engine's language.
    {
      ...asSaveFixture(scriptedChoiceFollowsLocale, "a version 3 save at a pending choice discards its prompt text and shows the choice in the language in use"),
      editSave: asVersion3,
      script: [
        { op: "useFlow", flow: "main" },
        { op: "setLocale", locale: "fr" },
        { op: "advance", expect: [{ type: "choice", groupId: "g", options: [
          { id: "o_pay", prompt: { kind: "text", text: "Payer 5" }, eligible: true },
          { id: "o_go", prompt: { kind: "text", text: "Partir" }, eligible: true },
        ] }] },
        { op: "choose", id: "o_go" },
        { op: "advance", expect: [{ type: "end" }] },
      ],
    },
    // Version 4 at a pending choice in French: the save keeps no text, so English is what an English engine shows.
    asSaveFixture(scriptedChoiceFollowsLocale, "a save written by the JS reference at a pending choice keeps its options' ids, not their text"),
  ],
  logs: [decisionLog],
  describes: [describeEverything],
  outlines: [outlineEverything, outlineExtensions],
  audio: [audioManifest],
};
