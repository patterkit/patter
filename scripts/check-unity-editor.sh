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
cleanup() { rm -rf "$staged" "$staged.meta" "${stamp:-}" "${unity_tmp:-}"; }
trap cleanup EXIT
rm -rf "$staged"
mkdir -p "$staged"
cp -R "$samples/." "$staged/"

# Positive evidence of a compile, not a grep for a name. The old proof was a grep for
# `Assembly-CSharp`, and a crashed build step logs that name too ("... is not valid.
# Loading of assembly skipped"), so on 2026-09-24 this check reported success for a Unity
# that had crashed and compiled nothing. So: clear the compiled assemblies first, forcing a
# real compile, and afterwards require every one of them to exist and to be newer than the
# moment the run started.
assemblies="$project/Library/ScriptAssemblies"
expected=(Patterplay.Runtime.dll Patterplay.Runtime.Json.dll Patterplay.Runtime.Unity.dll Patterplay.Editor.dll Assembly-CSharp.dll)
rm -rf "$assemblies"
stamp="$(mktemp "${TMPDIR:-/tmp}/check-unity-editor-stamp.XXXXXX")"
# Unity's build step crashed ("Unhandled exception during build") under a long TMPDIR, so
# it gets a short one of its own for the run.
unity_tmp="$(mktemp -d /tmp/check-unity-editor.XXXXXX)"
echo "check-unity-editor: $unity"
rm -f "$log"
# -ignorecompilererrors so Unity reports EVERY error rather than stopping at the first.
set +e
TMPDIR="$unity_tmp" "$unity" -batchmode -quit -nographics -projectPath "$project" -logFile "$log" -ignorecompilererrors >/dev/null 2>&1
set -e

if [ ! -f "$log" ]; then
  echo "check-unity-editor: Unity wrote no log; something stopped it before it started." >&2
  exit 1
fi

errors="$(grep -c "error CS" "$log" || true)"
if [ "$errors" -gt 0 ]; then
  echo "check-unity-editor: $errors compiler error(s):" >&2
  grep "error CS" "$log" | sort -u | sed 's/^/  /' >&2
  exit 1
fi

# A crash or an abandoned build can leave a log with no compiler error in it at all.
if grep -q "Unhandled exception\|Aborting batchmode due to failure\|Scripts have compiler errors" "$log"; then
  echo "check-unity-editor: Unity did not finish the build:" >&2
  grep "Unhandled exception\|Aborting batchmode due to failure\|Scripts have compiler errors" "$log" | sort -u | sed 's/^/  /' >&2
  echo "  See: $log" >&2
  exit 1
fi

missing=()
for dll in "${expected[@]}"; do
  [ "$assemblies/$dll" -nt "$stamp" ] || missing+=("$dll")
done
if [ "${#missing[@]}" -gt 0 ]; then
  echo "check-unity-editor: Unity did not compile ${missing[*]}, so nothing proves the scripts build." >&2
  echo "  (A licence prompt, a locked project library, or a crashed build step will do this.)  See: $log" >&2
  exit 1
fi

echo "check-unity-editor: the package (Runtime + Editor) and the samples compile."
