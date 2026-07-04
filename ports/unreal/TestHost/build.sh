#!/usr/bin/env bash
# Compile the standalone C++ corpus TestHost (clang, no Unreal) and run it against the
# committed corpus.json. This is the C++ port's half of the parity contract.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
out="$here/patterplay_testhost"

clang++ -std=c++17 -O2 -Wall -Wextra \
  -I"$here" \
  -I"$root/ports/unreal/Patterplay/Source/PatterplayRuntime/Public" \
  "$here/main.cpp" -o "$out"

"$out" "$root/packages/conformance/corpus.json"
