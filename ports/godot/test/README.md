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
  `play-godot-v*` release pipeline runs this gate before packaging.

- `tour_check.gd` - a smoke check that the bundled tour demo loads and steps:

  ```sh
  godot --headless --path ports/godot --script res://test/tour_check.gd
  ```
