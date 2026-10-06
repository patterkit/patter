#!/usr/bin/env bash
# Run one headless Godot test script and make its result honest for CI:
#   ports/godot/test/run.sh test_choose.gd
#   ports/godot/test/run.sh test_corpus.gd -- "$PWD/packages/conformance/corpus.json"
#
# Godot cannot say "this test failed to compile". A runner (or a script it preloads) with a parse error
# never reaches its own quit(1): Godot prints the error and exits 0 here, and on another machine sat for
# ten minutes instead (2026-10-06, a compile error in the corpus runner). Either way CI saw no failure.
# So this fails the run when the OUTPUT shows a script that did not load, and caps it at RUN_TIMEOUT
# seconds (default 600) where `timeout` exists. Anything else keeps Godot's own exit code. parse_check.sh
# covers the addon's scripts; this covers the test scripts, which nothing else parses.
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
godot="${GODOT:-/Applications/Godot.app/Contents/MacOS/Godot}"
script="$1"; shift

limit=()
command -v timeout >/dev/null 2>&1 && limit=(timeout "${RUN_TIMEOUT:-600}")

log="$(mktemp)"
${limit[@]+"${limit[@]}"} "$godot" --headless --path "$here/.." --script "res://test/$script" "$@" 2>&1 | tee "$log"
code=${PIPESTATUS[0]}

if [ "$code" -eq 124 ]; then
  echo "run.sh: $script did not finish in ${RUN_TIMEOUT:-600}s (a script that failed to load never calls quit)"
elif grep -qE "Parse Error|Failed to load script|Could not (preload|resolve)" "$log"; then
  echo "run.sh: $script did not compile, so none of it ran"
  code=1
fi
rm -f "$log"
exit "$code"
