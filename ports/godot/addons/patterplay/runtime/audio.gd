# Deprecated: the name PatterAudioResolver had before it took the name every Patterplay runtime uses.
# A subclass, so code that makes a PatterAudio keeps working for now; it goes in a later release.
class_name PatterAudio
extends PatterAudioResolver


func _init(manifest_json: String, base_path: String) -> void:
	super(manifest_json, base_path)
