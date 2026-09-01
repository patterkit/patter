#!/usr/bin/env bash
# GENERATED - vendored from expr/tooling/check-unreal-plugin.sh by scripts/vendor-ports.mjs.
# Do not edit here; edit the shared source and re-run the script.
# Compile the Patterplay UE plugin modules for real, with Unreal.
#
# The standalone TestHost (ports/unreal/TestHost/build.sh) compiles the std-only
# core with clang and runs the corpus. It does NOT compile the UE-dependent
# plugin modules: the Runtime module's Unreal-facing half, the Editor module, or
# the demo. Those need Unreal, so a green TestHost is not evidence that the
# plugin builds.
#
# NO LICENCE SECRET IS INVOLVED. An installed Unreal compiles from the command
# line, which is what this does. A GitHub-hosted runner has no Unreal on it at
# all, which is why .github/workflows/ports.yml cannot run this; a self-hosted
# runner on a machine with Unreal runs this script as it stands.
#
# Usage:  ./scripts/check-unreal-plugin.sh
#         UE_ROOT=/path/to/UE_5.7 ./scripts/check-unreal-plugin.sh
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
project="$root/ports/unreal/PatterplayDemo/PatterplayDemo.uproject"

ue="${UE_ROOT:-}"
if [ -z "$ue" ]; then
  # The .uproject declares its engine version; match it rather than taking the
  # newest, because a newer engine silently upgrades the project on open.
  want="$(sed -n 's/.*"EngineAssociation"[^"]*"\([^"]*\)".*/\1/p' "$project")"
  for base in /Volumes/Data/Unreal /Users/Shared/Epic\ Games /Applications/Epic\ Games; do
    [ -d "$base/UE_$want" ] && ue="$base/UE_$want" && break
  done
fi
if [ -z "$ue" ] || [ ! -x "$ue/Engine/Build/BatchFiles/Mac/Build.sh" ]; then
  echo "check-unreal-plugin: no Unreal found (set UE_ROOT to a UE_x.y directory)" >&2
  exit 2
fi

echo "check-unreal-plugin: $ue"
"$ue/Engine/Build/BatchFiles/Mac/Build.sh" PatterplayDemoEditor Mac Development \
  -Project="$project" -waitmutex
echo "check-unreal-plugin: the plugin modules compile."
