# PatterAudio (#206): map a beat id to the path of its winning audio take, using the `patteraudio.json`
# manifest Patterpad (or the CLI) emits next to the Audio Folders. It RESOLVES ONLY; playback stays yours
# (an AudioStreamPlayer + a stream you load from the returned path). The manifest already encodes the
# highest-rung winner per beat, so there is no folder search at runtime. Mirrors the JS createAudioResolver
# and the Unity PatterAudioResolver.
#
#   var audio := PatterAudio.new(manifest_json, "res://audio")
#   var path := audio.resolve(step.get("id", ""))   # full path, or "" when the beat has no recording
#   if path != "": my_player.stream = load(path)
class_name PatterAudio
extends RefCounted

var _base: String
var _files: Dictionary = {}


# Parse a patteraudio.json manifest; base_path is where you deployed the audio folder (res:// or user://).
func _init(manifest_json: String, base_path: String) -> void:
	_base = base_path.rstrip("/\\")
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


# The full path of a beat's winning audio take, or "" when it has none.
func resolve(beat_id: String) -> String:
	if not _files.has(beat_id):
		return ""
	var file: String = _files[beat_id]
	return (_base + "/" + file) if _base != "" else file
