# PatterAudioResolver (#206): map a beat id to the path of its winning audio take, using the `patteraudio.json`
# manifest Patterpad (or the CLI) emits next to the Audio Folders. It RESOLVES ONLY; playback stays yours
# (an AudioStreamPlayer + a stream you load from the returned path). The manifest already encodes the
# highest-rung winner per beat, so there is no folder search at runtime. Mirrors the JS createAudioResolver
# and the Unity and Unreal PatterAudioResolver.
#
#   var audio := PatterAudioResolver.new(manifest_json, "res://audio")
#   var path = audio.resolve(step.get("id", ""))   # full path, or null when the beat has no recording
#   if path != null: my_player.stream = load(path)
class_name PatterAudioResolver
extends RefCounted

var _base: String
var _files: Dictionary = {}


# Parse a patteraudio.json manifest; base_path is where you deployed the audio folder (res:// or user://).
func _init(manifest_json: String, base_path: String) -> void:
	# A base that already ends in a separator is joined as it stands: trimming it turned a root such as
	# "user://" into "user:", and the path lost its root.
	_base = base_path
	var parsed = JSON.parse_string(manifest_json)
	if typeof(parsed) != TYPE_DICTIONARY:
		push_error("Patterplay: not a valid patteraudio.json manifest")
		return
	var clips = parsed.get("clips", {})
	if typeof(clips) == TYPE_DICTIONARY:
		for beat_id in clips:
			var file: String = str(clips[beat_id].get("file", ""))
			if file != "":
				_files[beat_id] = file


# The full path of a beat's winning audio take, or null when it has none, as on every other runtime.
func resolve(beat_id: String):
	if not _files.has(beat_id):
		return null
	var file: String = _files[beat_id]
	if _base == "" or _base.ends_with("/") or _base.ends_with("\\"):
		return _base + file
	return _base + "/" + file
