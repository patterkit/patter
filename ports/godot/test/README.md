# Godot test scripts (maintainers)

Headless checks for the Godot addon. **Not part of the shipped addon zip** (only
`addons/patterplay` ships); end-users never need these.

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
