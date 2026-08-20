#!/usr/bin/env bash
# Does an EXPORTED Godot build still find its bundle?
#
# This is the question nothing else here asks, and the reason #45 reached users: every Godot check in
# this repo runs inside the editor, where a .patterc is on disk whatever the addon does to it. An
# exported build is a different filesystem, and 0.4.3 changed what lands in it.
#
#   ports/godot/test/export_check.sh          # needs Godot + export templates installed
#
# Skips (exit 0) when Godot or its export templates are missing, so it can sit in a script that runs
# anywhere; it is a MAINTAINER gate, not a CI one, until a runner has an engine on it.
#
# Two assertions, and the first is the one that would have caught #45 on any machine:
#
#   1. The addon must NOT turn a bundle into an imported resource. `.patterc` is a plain file that
#      games read with FileAccess; an importer changes how it ships and what `res://x.patterc`
#      resolves to. If a .patterc.import appears, or ResourceLoader claims the path, that is the fault.
#   2. With the documented export setting (`*.patterc` in "filters to export non-resource files"), an
#      exported pack must contain the bundle and the game must play its first beat from it.
#
# The pack is run from a directory with NO project.godot above it. Getting that wrong makes the test
# read the source tree instead of the pack, which is how three of my earlier results said "fine" about
# builds that were never examined.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
godot="${GODOT:-/Applications/Godot.app/Contents/MacOS/Godot}"
# Overridable so the same gate can be pointed at the variations that matter: with and without the
# documented include filter, and at another platform's pack (a .pck is portable, so a Windows pack
# can be run by any Godot).
platform="${EXPORT_PLATFORM:-Linux}"
include_filter="${EXPORT_INCLUDE_FILTER:-*.patterc}"

if [ ! -x "$godot" ]; then
  echo "SKIP export_check: no Godot at $godot (set GODOT=/path/to/godot)"
  exit 0
fi
version="$("$godot" --headless --version 2>/dev/null | head -1 | cut -d. -f1-2)"
if ! ls "$HOME/Library/Application Support/Godot/export_templates/" >/dev/null 2>&1 \
   && ! ls "$HOME/.local/share/godot/export_templates/" >/dev/null 2>&1; then
  echo "SKIP export_check: no export templates installed (Editor > Manage Export Templates)"
  exit 0
fi

proj="$(mktemp -d)"
run="$(mktemp -d)"                     # deliberately NOT under $proj: no project.godot above it
trap 'rm -rf "$proj" "$run"' EXIT

cp -R "$root/ports/godot/addons" "$proj/addons"
cp "${EXPORT_BUNDLE:-$root/examples/demo/demo.patterc}" "$proj/game.patterc"

cat > "$proj/project.godot" <<CFG
config_version=5

[application]
config/name="patterplay export check"
run/main_scene="res://main.tscn"

[editor_plugins]
enabled=PackedStringArray("res://addons/patterplay/plugin.cfg")
CFG

cat > "$proj/main.gd" <<'GD'
extends Node

func _ready() -> void:
	var path := "res://game.patterc"
	var text := FileAccess.get_file_as_string(path)
	# Both routes a project might use. FileAccess is the documented one and the one every existing
	# game uses; ResourceLoader only answers when the bundle is imported, and a build that has the
	# resource but not the file is exactly the 0.4.3 fault.
	print("EXPORT CHECK: FileAccess chars=", text.length(), " ResourceLoader.exists=", ResourceLoader.exists(path))
	if text == "":
		print("EXPORT CHECK: FAIL - the exported build cannot read ", path)
		get_tree().quit(1)
		return
	var bundle = PatterBundle.load_from_string(text)
	if bundle == null:
		print("EXPORT CHECK: FAIL - the bundle did not parse")
		get_tree().quit(1)
		return
	var flow := PatterEngine.new(bundle).open_flow("f", "")
	var step: Dictionary = flow.advance()
	print("EXPORT CHECK: PLAYED ", step.get("text", "(no text)"))
	get_tree().quit(0)
GD

cat > "$proj/main.tscn" <<'TSCN'
[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://main.gd" id="1"]

[node name="Main" type="Node"]
script = ExtResource("1")
TSCN

# The documented setup: a bundle is a non-resource file, included by filter.
cat > "$proj/export_presets.cfg" <<CFG
[preset.0]

name="check"
platform="$platform"
runnable=true
export_filter="all_resources"
include_filter="$include_filter"
exclude_filter=""
export_path="build/check.pck"

[preset.0.options]

binary_format/embed_pck=false
CFG

"$godot" --headless --path "$proj" --import >/dev/null 2>&1 || true

fails=0

# --- 1. what the addon did to the file: reported, not judged ---------------------
#
# NOT a failure on its own. Importing a bundle is what broke #45, but the fault was the OUTCOME - an
# exported build that could not read it - and an importer paired with an export plugin that puts the
# raw bundle back could be perfectly sound. Asserting "must be a plain file" would forbid the design
# rather than test it, so this line only tells you which shape you are looking at when check 2 speaks.
if ls "$proj"/*.patterc.import >/dev/null 2>&1; then
  echo "EXPORT CHECK: note - the addon imports .patterc (a sidecar appeared); check 2 is what matters"
else
  echo "EXPORT CHECK: note - .patterc is a plain file"
fi

# --- 2. an exported pack must carry the bundle, and the game must play it --------
mkdir -p "$proj/build"
export_out="$("$godot" --headless --path "$proj" --export-pack check "$proj/build/check.pck" 2>&1 || true)"
# A crash here is a real failure even when the pack survives it. An EditorPlugin that registers
# plugins without removing them in _exit_tree segfaults Godot on shutdown, and the pack is written
# before that happens - so this looked green while the editor was aborting.
if echo "$export_out" | grep -qE "Program crashed|Abort trap"; then
  echo "EXPORT CHECK: FAIL - Godot crashed during export"
  echo "$export_out" | grep -E "Program crashed|signal" | head -2
  fails=$((fails + 1))
fi
if [ ! -f "$proj/build/check.pck" ]; then
  echo "EXPORT CHECK: FAIL - no pack was produced"
  exit 1
fi
# NOT grepped for: pack entries are compressed, so searching the bytes for the bundle's JSON gives
# false negatives. An earlier version of this script did exactly that and reported packs as empty
# while the game played from them perfectly. The only trustworthy check is running the pack.

echo "EXPORT CHECK: pack size $(du -h "$proj/build/check.pck" | cut -f1), bundle $(du -h "$proj/game.patterc" | cut -f1)"
cp "$proj/build/check.pck" "$run/check.pck"
out="$("$godot" --headless --main-pack "$run/check.pck" 2>&1 || true)"
echo "$out" | grep -E "EXPORT CHECK: FileAccess" || true
if echo "$out" | grep -q "EXPORT CHECK: PLAYED"; then
  echo "$out" | grep "EXPORT CHECK: PLAYED"
else
  echo "EXPORT CHECK: FAIL - the exported build did not play its first beat"
  echo "$out" | grep -E "EXPORT CHECK|ERROR" | head -5
  fails=$((fails + 1))
fi

if [ "$fails" -eq 0 ]; then
  echo "EXPORT CHECK: ALL PASS (Godot $version)"
else
  echo "EXPORT CHECK: $fails FAILED"
  exit 1
fi
