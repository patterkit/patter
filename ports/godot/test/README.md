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
  `hot_swap` handing bags over, the `host_scopes` option, and a combined game with a stand-in engine
  that registers `@story`.

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

- `tour_check.gd` - a smoke check that the bundled tour demo loads and steps:

  ```sh
  godot --headless --path ports/godot --script res://test/tour_check.gd
  ```
