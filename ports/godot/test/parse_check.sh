#!/usr/bin/env bash
# Does EVERY script in the addon parse?
#
#   ports/godot/test/parse_check.sh          # needs Godot; skips cleanly without it
#   GODOT=/path/to/godot ports/godot/test/parse_check.sh
#
# Godot parses every script in a project when the project OPENS, so one bad file in an addon does not
# break that file - it stops the whole project loading, and to a user who has just dropped the addon
# in, the addon is what broke. Nothing else here would catch it: the CI runs `--import ... || true`
# and then a handful of NAMED `--script` runs, and a named run parses only the script it is given and
# what that script imports. The addon's demo, editor and UI scripts are reached by none of them, so
# until now the first parse of those files happened in a user's editor.
#
# Not hypothetical: the Storylet Engine shipped exactly this in three Godot releases - one statement
# left at column 0, which GDScript reads as an identifier in the class body - and it was found by an
# author opening a demo project (from-storylets/godot-addon-scripts-are-never-all-parsed, 2026-09-04).
# Patter's addon was clean when they checked ours and when this script was written; this keeps it so.
#
# One `--check-only` run per file, which is the only way to be sure a file was looked at: a run
# named at script A parses B only if A reaches B.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
godot="${GODOT:-/Applications/Godot.app/Contents/MacOS/Godot}"
project="$(cd "$here/.." && pwd)"
addon="${1:-$project/addons}"

if [ ! -x "$godot" ]; then
  echo "SKIP parse_check: no Godot at $godot (set GODOT=/path/to/godot)"
  exit 0
fi

broken=0
count=0
while IFS= read -r file; do
  count=$((count + 1))
  rel="${file#"$project"/}"
  # Godot reports a parse failure on stdout/stderr and still exits 0, so the OUTPUT is the verdict.
  out="$("$godot" --headless --path "$project" --check-only --script "res://$rel" 2>&1 \
        | grep -E "Parse Error|SCRIPT ERROR|Failed to load script" || true)"
  if [ -n "$out" ]; then
    broken=$((broken + 1))
    echo "PARSE CHECK: FAIL $rel"
    echo "$out" | sed 's/^/  /' | head -5
  fi
done < <(find "$addon" -name '*.gd' | sort)

if [ "$broken" -gt 0 ]; then
  echo "PARSE CHECK: $broken of $count script(s) do not parse - a project carrying this addon would fail to OPEN"
  exit 1
fi
echo "PARSE CHECK: ALL PASS ($count scripts, $("$godot" --headless --version 2>/dev/null | head -1))"
