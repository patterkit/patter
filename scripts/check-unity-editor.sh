#!/usr/bin/env bash
# Compile the Patterplay Unity package for real, with the editor you already have.
#
# The dotnet TestHost covers the RUNTIME (pure C#, no editor needed, and it runs in CI). It
# cannot cover Editor/ or Samples~/, which talk to UnityEditor and UnityEngine - so until
# 2026-09-01 nothing compiled them at all. The Runtime State window and the two sample
# scripts could break and no check anywhere would notice; the state window's decision-log
# view was written and verified by hand for exactly that reason.
#
# The Storylet Engine has scripts/check-unity-demo.sh doing this for its demo. This is the
# matching half, and the same trap applies: a batch-mode Unity EXITS 0 with a project full
# of compiler errors, so the LOG decides the outcome here, not the exit code.
#
#   npm run check:unity-editor
#   UNITY_PATH=/path/to/Unity npm run check:unity-editor
set -e

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
project="$root/ports/unity/PatterplayDemo"
samples="$root/ports/unity/Patterplay/Samples~"
staged="$project/Assets/Samples"
log="${TMPDIR:-/tmp}/patter-unity-editor.log"

unity="${UNITY_PATH:-}"
if [ -z "$unity" ]; then
  # Newest Hub editor. `sort -V` so 6000.4.10 beats 6000.4.6 rather than losing to it
  # alphabetically.
  unity="$(ls -d /Applications/Unity/Hub/Editor/*/Unity.app/Contents/MacOS/Unity 2>/dev/null | sort -V | tail -1 || true)"
fi
if [ ! -x "$unity" ]; then
  echo "check-unity-editor: no Unity editor found." >&2
  echo "  Install one through Unity Hub, or point at it: UNITY_PATH=/path/to/Unity $0" >&2
  exit 2
fi

# Unity ignores a `~` directory by design, so the samples are invisible where they live.
# Copy them in for the run rather than keeping a second copy in the repository: Samples~
# stays their one home, and a duplicate is the thing this whole exercise exists to remove.
# Unity writes a .meta beside the staged directory; take that with it, or the next
# commit sweeps up an artefact of the check.
cleanup() { rm -rf "$staged" "$staged.meta"; }
trap cleanup EXIT
rm -rf "$staged"
mkdir -p "$staged"
cp -R "$samples/." "$staged/"

echo "check-unity-editor: $unity"
rm -f "$log"
# -ignorecompilererrors so Unity reports EVERY error rather than stopping at the first.
set +e
"$unity" -batchmode -quit -nographics -projectPath "$project" -logFile "$log" -ignorecompilererrors >/dev/null 2>&1
set -e

if [ ! -f "$log" ]; then
  echo "check-unity-editor: Unity wrote no log; something stopped it before it started." >&2
  exit 1
fi

# Proof the compile actually happened, so a silently skipped one cannot pass. A licence
# prompt or a locked project library will produce a clean-looking log that built nothing.
if ! grep -q "Compiling Scripts\|Assembly-CSharp\|Patterplay.Editor" "$log"; then
  echo "check-unity-editor: the log shows no script compilation - treating that as a failure." >&2
  echo "  See: $log" >&2
  exit 1
fi

errors="$(grep -c "error CS" "$log" || true)"
if [ "$errors" -gt 0 ]; then
  echo "check-unity-editor: $errors compiler error(s):" >&2
  grep "error CS" "$log" | sort -u | sed 's/^/  /' >&2
  exit 1
fi

echo "check-unity-editor: the package (Runtime + Editor) and the samples compile."
