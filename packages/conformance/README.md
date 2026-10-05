# @patterkit/conformance

The Patter **parity contract** (Plan §8): a language-agnostic JSON corpus that
every runtime - the JS reference (`@patterkit/runtime`) and each engine port
(Unity / Godot / Unreal) - must pass. New runtime behaviour lands here as a case
first, then in the implementations.

## The corpus

[`corpus.json`](./corpus.json) (`version: 2`) is the portable artifact. It carries
**compiled** forms only, so a runtime-only port (an AST walker) consumes it with no
parser or compiler. Four case kinds, each with a reference runner in
[`src/runner.ts`](./src/runner.ts):

- **`expressions[]`** - `{ name, src, ast, scopes, seed?, expected }`. Evaluate
  `ast` against `scopes` (a `scope -> name -> value` map), seeding the PRNG from
  `seed` when present, and compare the result to `expected`. `src` is
  informational only.
- **`runtime[]`** - `{ name, bundle, seed?, locale?, engineOptions?, start?, choices?, expectedTranscript }`.
  Load `bundle`, start at `start` (or the first scene), play it - consuming
  `choices` in order at each choice point - and compare the emitted step sequence
  to `expectedTranscript`. When `locale` is set, resolve strings + character names
  in that locale; an **IDs-only** bundle (`bundle.localisation.mode === "ids"`)
  ships no strings, so the engine must emit beat IDs and omit character names.
  `engineOptions` (see below) sets the engine's construction options.
- **`scripted[]`** - `{ name, bundle, bundleB?, seed?, engineOptions?, script }`. Execute the `script`
  ops (`openFlow` / `useFlow` / `advance` / `choose` / `saveLoad` / `setLocale` /
  `setClosedCaptions` / `hotSwap` / `reset`) against your engine; each op carrying
  `expect` must produce exactly that transcript chunk, ops without it none.
  `saveLoad` = serialise the whole game, discard the engine, restore into a fresh one
  (semantic parity, not byte parity). `hotSwap` does the same but restores into the
  case's **edited** `bundleB` (the live-refresh contract). Covers save/load
  round-trips, multiple concurrent flows, live locale / caption switches, and reset.
- **`gameData[]`** - `{ name, bundle, kind, node?, expected }`. Resolve the node's
  sparse `node` override against the `kind`'s declared field defaults (carried in
  `bundle.gameDataFields`) and compare the full effective payload to `expected`.
  Declared fields fill from override-or-default; override-only orphans are kept.

A `TranscriptStep` is a normalised step result: `line` / `text` / `gameEvent` /
`choice` / `end`, pinning the fields the contract fixes - including a line's
`character` / `characterName` and any beat/option `gameData`. A `choice` is pinned
whole: its `groupId`, and each option as `{ id, prompt?, eligible, gameData? }`, where
`prompt` is `{ kind, text, character?, characterName?, direction? }` (the speaker fields
on a `line` prompt only, each only when set). There is no flat `text` on an option.

A speaker field (`character`, `characterName`, `direction`) on a line or a line prompt
is absent only when unset: one set to `""` is written as `""`, never dropped.

A `runtime`, `scripted`, or `saves` case may carry `engineOptions`:
`{ replayPromptOnChoose?, closedCaptions? }`, the engine's construction options of the
same names. Construct the case's engine with them, and every engine a `saveLoad` or
`hotSwap` makes in the case; a key left out keeps the engine's default. With
`replayPromptOnChoose`, `choose` delivers the chosen option's AUTHORED prompt (an Option
group's own prompt beat) as the first beat of its content, with the text and speaker fields
the choice showed, not re-resolved. A prompt borrowed from the option's own first content
line is not replayed. A save taken between `choose` and the next advance still delivers it
as shown: the save carries it as the flow cursor's `pendingPrompt`.

A `saves` case may stand for a save an older runtime wrote, with a field it did not have
yet left out of its `envelope`; its `keyPaths` are that envelope's, so writing the loaded
state back must not invent the field either.

An `openFlow` op may carry `expectResult`: `false` means the address must not resolve
(an unknown scene, or a block that is not in the named scene), and the refused open
must change nothing - no flow opened, a flow already open under that name neither
closed nor replaced, and the current flow unmoved.

### Locale resolution

A string the active locale is missing falls back to the **default-locale (source)**
text, but flagged: `<Untranslated: {id}> {source}`. An untranslated string is a hard
fail authors must see, never silently papered over; only a key absent from the default
locale too (never extracted) degrades to its bare id. Character names resolve the same
way (active cast string -> default cast string -> authoring `displayName`).

## PRNG

Seeded cases pin **mulberry32** (see `mulberry32` in `src/runner.ts`) - a port
must reproduce it bit-for-bit for `random()` and `shuffle` to match. (`random(a, b)`
is `floor(next() * (b - a + 1)) + a`; `shuffle` picks `floor(next() * poolSize)`.)

## Working on it

- Fixtures are authored in [`src/cases.ts`](./src/cases.ts) as **source** with
  **hand-authored** `expected` / `expectedTranscript` - the expectations are the
  contract, never derived from the engine. `buildCorpus` compiles them to
  `corpus.json`.
- The test ([`test/conformance.test.ts`](./test/conformance.test.ts)) replays the
  corpus through the runtime-only runners and asserts every expectation, and file-
  snapshots `corpus.json`. After changing fixtures, regenerate + review:

  ```
  npx vitest run packages/conformance -u
  ```

- A port's reference harness re-implements the four runners (`runExpressionCase`,
  `runRuntimeCase`, `runScriptedCase`, `runGameDataCase`) in its own language and
  drives them from `corpus.json`.
