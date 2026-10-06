# Godot test scripts (maintainers)

Headless checks for the Godot addon. **Not part of the shipped addon zip** (only
`addons/patterplay` ships); end-users never need these.

- `test_debug_registry.gd` - the debug registry is an OBSERVER: it can say what is live and must not
  keep anything alive. Covers weak engines, weak links, and a link's honest state.

  ```sh
  godot --headless --path ports/godot --script res://test/test_debug_registry.gd
  ```

  Prints `ALL PASS` (exit 0) or `N FAILED` (exit 1). Worth knowing when reading it: an engine is
  RefCounted and goes when the last reference does, while a link is a Node the GAME frees - the
  registry's job is to notice, not to hold on.

- `test_corpus.gd` - replays the shared conformance corpus
  ([`packages/conformance`](../../../packages/conformance)) through the addon's runtime and
  asserts the same results the JS reference produces:

  ```sh
  godot --headless --path ports/godot --script res://test/test_corpus.gd -- "$(pwd)/packages/conformance/corpus.json"
  ```

  Prints per-section counts then `ALL PASS` (exit 0) or `N FAILED` (exit 1). The
  `play-godot-v*` release pipeline runs this gate before packaging. It also runs the two corpora
  vendored from `../expr` beside `corpus.json`: `expr-corpus.json` (the evaluator's) and
  `registry-corpus.json` (the ScopeRegistry's, through the shared runner `registry_corpus.gd`,
  vendored here too, printing `registry corpus: N/N`; a missing file is a failure).

- `test_one_registry.gd` - one registry per game, from the GAME's side (the GDScript half of the JS
  runtime's `one-registry.test.ts` and `combined-game.test.ts`): the keys and owner label the engine
  registers under, `save_game()` leaving the values out given a game registry and carrying them
  standalone, loading in either order, a version 2 save's values moving into the registry, a token
  clash leaving the registry as it was, reset and a fresh flow dropping only Patter's waiting values,
  `hot_swap` handing bags over, the `host_scopes` option, a combined game with a stand-in engine
  that registers `@story`, and other engines' scopes (the JS test's "other engines' scopes": a
  bundle's `externalScopes` read and checked, `@story` read and written through the registry,
  `open_flow` and `load_game` refused before anything changes when nobody registered it, and a write
  after another engine took it away landing nowhere rather than in `@patter`).

  ```sh
  godot --headless --path ports/godot --script res://test/test_one_registry.gd
  ```

- `test_save_shape.gd` - the save's SHAPE, pinned against hand-written saves: version 3 as written,
  version 2 and the pre-0.11.0 snake_case shape as still read.

  ```sh
  godot --headless --path ports/godot --script res://test/test_save_shape.gd
  ```

  Both print `ALL PASS` (exit 0) or `N FAILED` (exit 1). A script that fails to PARSE exits 0 without
  printing either, so read for the verdict line.

- `test_flow_lifetime.gd` - a flow the game has let go of is FREED, with every bag it made: closed,
  replaced, dropped with its engine, opened inside a checkpoint, carried over by a load or a hot swap,
  or run by `run_flow`. Flows, engines, and bags are RefCounted, so a reference cycle among them is
  never collected; the check is a weakref per object, and the object count returning to where it
  started (what Godot's "ObjectDB instances leaked at exit" counts).

  ```sh
  godot --headless --path ports/godot --script res://test/test_flow_lifetime.gd
  ```

- `test_play_errors.gd` - content errors play through and are REPORTED: the `on_error` option gets
  `{flow, kind, node, source, message}` for a failing condition, a failing effect, a refused read-only
  `@world` write, and a failing Best-match part; the decision log gets a `diagnostic` entry for each and
  no `write` entry for a skipped effect. Also the load refusals the corpus cannot express: a bare
  snapshot with no envelope, a save with no flows, and a version that is not 2 or 3 are refused, and
  leave the engine exactly as it was.

  ```sh
  godot --headless --path ports/godot --script res://test/test_play_errors.gd
  ```

- `tour_check.gd` - a smoke check that the bundled tour demo loads and steps:

  ```sh
  godot --headless --path ports/godot --script res://test/tour_check.gd
  ```
