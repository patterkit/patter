# PatterDebugLink - the game-side client for Patterpad's live debug link. Streams a running game's
# story position to the editor over a loopback WebSocket, so Patterpad can follow the live cursor
# like a debugger. OBSERVE-ONLY: the game stays in control; the editor is a passive mirror. The
# GDScript parity of the JS @patterkit/play-helpers createDebugLink, same `patterplay/debug@1` wire
# protocol.
#
# It is a debug tool: it only opens the link in a debug build (OS.is_debug_build()); in a release
# export it is inert, so it is safe to leave wired in.
#
# Usage - add it under any node, then report position after each advance() / choose():
#   var link := PatterDebugLink.new(engine.build_id(), "My Game")
#   add_child(link)                                    # starts polling
#   link.flow_opened("main")
#   # ...after each step:
#   link.observe("main", flow.current_scene(), step.get("id", ""), step["type"])
#   # ...and when the flow ends:
#   link.flow_closed("main")
class_name PatterDebugLink
extends Node

# Live bundle refresh: the editor pushed a freshly compiled bundle over the link. `data` is the
# full .patterc JSON - hand it to engine.apply_live_bundle(data), re-bind your flow handles if it
# hot-swapped, then call set_build(build) so the editor's pill flips back to in-sync. Emitted from
# _process, so the handler runs on the main thread. Never emitted with malformed payloads.
signal bundle_pushed(build: String, data: String)

const DEFAULT_URL := "ws://127.0.0.1:4471"

var _build: String
var _project: String
var _url: String
var _ws := WebSocketPeer.new()
var _flows: Dictionary = {}
var _queue: Array = []          # JSON strings awaiting an open socket
var _hello_sent := false
var _enabled := false


func _init(build: String, project: String = "", url: String = DEFAULT_URL) -> void:
	_build = build
	_project = project
	_url = url


func _ready() -> void:
	# Debug-only: never open the link in a release export.
	if not OS.is_debug_build():
		return
	if _ws.connect_to_url(_url) == OK:
		_enabled = true   # otherwise the editor is unreachable - stay a silent no-op


func _process(_delta: float) -> void:
	if not _enabled:
		return
	_ws.poll()
	match _ws.get_ready_state():
		WebSocketPeer.STATE_OPEN:
			if not _hello_sent:
				# Handshake first, so the editor can verify the build + seed the flow list before frames.
				_ws.send_text(JSON.stringify(_hello_message()))
				_hello_sent = true
			_flush()
			_drain_incoming()
		WebSocketPeer.STATE_CLOSED:
			_enabled = false   # editor closed the link - go quiet


# -- public API (mirrors the JS DebugLink) -------------------------------------

func flow_opened(flow_id: String) -> void:
	_flows[flow_id] = true
	_post({ "t": "flowOpen", "flow": flow_id })


func flow_closed(flow_id: String) -> void:
	_flows.erase(flow_id)
	_post({ "t": "flowClose", "flow": flow_id })


# Report a flow's current position - call after each advance() / choose(). An empty beat_id (e.g. a
# choice stop) is sent as null, matching the JS client.
func observe(flow_id: String, scene_id: String, beat_id: String, type: String, choice_id: String = "") -> void:
	var frame := {
		"t": "frame",
		"flow": flow_id,
		"sceneId": scene_id,
		"beatId": null if beat_id == "" else beat_id,
		"type": type,
	}
	if choice_id != "":
		frame["choiceId"] = choice_id
	_post(frame)


# After applying a pushed bundle: report the build now running (re-hellos, so the editor's
# match/stale pill updates and it stops re-pushing the same bundle).
func set_build(build: String) -> void:
	if build == "" or build == _build:
		return
	_build = build
	_post(_hello_message())


func close() -> void:
	_enabled = false
	_queue.clear()
	if _ws.get_ready_state() != WebSocketPeer.STATE_CLOSED:
		_ws.close()


# -- internals -----------------------------------------------------------------

func _hello_message() -> Dictionary:
	return { "t": "hello", "v": 1, "build": _build, "project": _project, "flows": _flows.keys() }


func _post(msg: Dictionary) -> void:
	if not _enabled:
		return
	_queue.append(JSON.stringify(msg))
	_flush()


func _flush() -> void:
	if _ws.get_ready_state() != WebSocketPeer.STATE_OPEN:
		return
	for m in _queue:
		_ws.send_text(m)
	_queue.clear()


# Live bundle refresh: the editor pushes {t:"bundle", build, data}. Validate the shape here so the
# host's handler never sees a malformed payload; anything else the editor sends is ignored.
func _drain_incoming() -> void:
	while _ws.get_available_packet_count() > 0:
		var raw := _ws.get_packet().get_string_from_utf8()
		var msg = JSON.parse_string(raw)
		if typeof(msg) != TYPE_DICTIONARY:
			continue
		if msg.get("t", "") == "bundle" and msg.get("build", "") is String and msg.get("data", "") is String:
			var build: String = msg["build"]
			var data: String = msg["data"]
			if build != "" and data != "":
				bundle_pushed.emit(build, data)
