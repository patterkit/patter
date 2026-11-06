# PatterDebugLink - the game-side client for Patterpad's live debug link. Streams a running game's
# story position to the editor over a loopback WebSocket, so Patterpad can follow the live cursor
# like a debugger. OBSERVE-ONLY: the game stays in control; the editor is a passive mirror. The
# GDScript parity of the JS @patterkit/play-helpers createDebugLink, same `patterplay/debug@1` wire
# protocol.
#
# It is a debug tool: it only opens the link in a debug build (OS.is_debug_build()); in a release
# export it is inert, so it is safe to leave wired in.
#
# It reconnects: while the game has it on, a link whose socket closes (or never opens) is tried again
# after 1 s, doubling to at most 10 s, and sends its hello again when the editor is back. It logs one
# line when an established link is lost and one when it's back, nothing per attempt. A link the editor
# replaced with another game (close code 4000) stays closed.
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

# Play in game: the writer asked the running game to start a block now. `request` is
# { id, sceneId, blockId, takeOver: bool, build } (build "" when the editor sent none; ids are the
# bundle's). Answer with reply_play(request.id, { started, reason?, detail? }), at once or a frame or
# more later; an answer after the editor stopped waiting is ignored. Emitted from _process, so the
# handler runs on the main thread. With no handler connected to it, the link answers
# { started: false, reason: "unhandled" } itself. Never emitted with malformed payloads.
signal play_requested(request: Dictionary)

const DEFAULT_URL := "ws://127.0.0.1:4471"

# The editor's server closes a client it replaced (another game connected) with this code. A replaced
# link stays closed: retrying would only take the editor back from the game that took it over.
const CLOSE_REPLACED := 4000
# The wait before trying again after a close or a failed attempt: 1 s, doubling to at most 10 s, back
# to 1 s once a hello goes out.
const RETRY_FIRST_MS := 1000
const RETRY_MAX_MS := 10000

var _build: String
var _project: String
var _url: String
var _ws := WebSocketPeer.new()
var _flows: Dictionary = {}
var _queue: Array = []          # JSON strings awaiting the first socket's open
var _hello_sent := false
var _enabled := false           # the game wants the link: on until close(), or the editor replaced us
var _queueing := true           # until the first attempt fails or closes; never again after that
var _retry_at := 0              # Time.get_ticks_msec() of the next attempt, 0 while one is under way
var _retry_wait := RETRY_FIRST_MS
var _lost := false              # an established link went away and we said so; say so when it's back


func _init(build: String, project: String = "", url: String = DEFAULT_URL) -> void:
	_build = build
	_project = project
	_url = url


func _ready() -> void:
	# Debug-only: never open the link in a release export.
	if not OS.is_debug_build():
		return
	_enabled = true
	_dial()


func _process(_delta: float) -> void:
	if not _enabled:
		return
	if _retry_at > 0:
		if Time.get_ticks_msec() < _retry_at:
			return
		_retry_at = 0
		_dial()
		return
	if _ws.get_ready_state() == WebSocketPeer.STATE_CONNECTING:
		# Godot warns from inside poll() when an attempt finds nobody listening ("Unable to set TCP no
		# delay option" on macOS), which with retries would be a warning every few seconds for as long
		# as the editor is away. Attempts are meant to be silent, so the poll that settles one is too.
		var printing := Engine.print_error_messages
		Engine.print_error_messages = false
		_ws.poll()
		Engine.print_error_messages = printing
	else:
		_ws.poll()
	match _ws.get_ready_state():
		WebSocketPeer.STATE_OPEN:
			if not _hello_sent:
				# Handshake first, so the editor can verify the build + seed the flow list before frames.
				# On a reconnect it's the same hello, with the build and the flows open now.
				_ws.send_text(JSON.stringify(_hello_message()))
				_hello_sent = true
				_retry_wait = RETRY_FIRST_MS
				if _lost:
					_lost = false
					print("[patterplay] Live Link is back (%s)." % _url)
			_flush()
			_drain_incoming()
		WebSocketPeer.STATE_CLOSED:
			_socket_gone(_ws.get_close_code())


## What the link is doing: "connecting", "connected" or "closed". From inside a running game "the editor
## is not listening" and "I never attached" look identical, and that is the first question a link's
## user asks (from-storylets/weak-debug-registries).
func state() -> String:
	if not _enabled:
		return "closed"
	return "connected" if _ws.get_ready_state() == WebSocketPeer.STATE_OPEN else "connecting"


## The build the link handshook with (moves on set_build after a live refresh).
func build() -> String:
	return _build


## The editor address the link dials.
func url() -> String:
	return _url


# -- public API (mirrors the JS DebugLink) -------------------------------------

func flow_opened(flow_id: String) -> void:
	_flows[flow_id] = true
	_post({ "t": "flowOpen", "flow": flow_id })


func flow_closed(flow_id: String) -> void:
	_flows.erase(flow_id)
	_post({ "t": "flowClose", "flow": flow_id })


# Report a flow's current position - call after each advance() / choose(). An empty beat_id (e.g. a
# choice stop) is sent as null, matching the JS client.
func observe(flow_id: String, scene_id, beat_id: String, type: String, choice_id: String = "") -> void:
	# A flow reports itself: flow_opened is the host's job and nothing could check it, so a game that
	# forgot it left the editor's list short - and the omission survived a reconnect, because the hello
	# sends this set. Announce a flow we have not seen, then the frame.
	if not _flows.has(flow_id):
		_flows[flow_id] = true
		_post({ "t": "flowOpen", "flow": flow_id })
	var frame := {
		"t": "frame",
		"flow": flow_id,
		"sceneId": null if scene_id == null or str(scene_id) == "" else str(scene_id),
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


# Answer a play request (see play_requested). `result` is { started: bool, reason?: String,
# detail?: String }; reason is a short code ("busy", "unknownBlock", "staleBuild", or the game's own).
func reply_play(id: String, result: Dictionary) -> void:
	if id == "":
		return
	var msg := { "t": "played", "id": id, "started": result.get("started", false) == true }
	if result.get("reason", null) is String:
		msg["reason"] = result["reason"]
	if result.get("detail", null) is String:
		msg["detail"] = result["detail"]
	_post(msg)


func close() -> void:
	_enabled = false
	_retry_at = 0
	_queue.clear()
	if _ws.get_ready_state() != WebSocketPeer.STATE_CLOSED:
		_ws.close()


# -- internals -----------------------------------------------------------------

func _hello_message() -> Dictionary:
	return { "t": "hello", "v": 1, "build": _build, "project": _project, "flows": _flows.keys() }


# Dial the editor. An address the peer can't even parse is never going to work, so that one closes
# the link for good, silently, as it always did; anything else that fails is tried again.
func _dial() -> void:
	var err := _ws.connect_to_url(_url)
	if err == ERR_INVALID_PARAMETER:
		_enabled = false
	elif err != OK:
		_socket_gone(-1)


# The socket closed, or never opened. Retry while the game wants the link, unless the editor replaced
# us with another game. One line when an established link is lost, none per attempt, and nothing at
# all for a link that has never opened.
func _socket_gone(code: int) -> void:
	var was_open := _hello_sent
	_hello_sent = false
	# The startup queue only holds frames for the first socket; once that's gone, a frame with no open
	# socket has nowhere to go, so it is dropped rather than kept for the rest of the game.
	_queueing = false
	_queue.clear()
	if code == CLOSE_REPLACED:
		_enabled = false
		print("[patterplay] Live Link: another game took the editor's link (%s)." % _url)
		return
	if was_open and not _lost:
		_lost = true
		print("[patterplay] Live Link lost (%s); retrying." % _url)
	_retry_at = Time.get_ticks_msec() + _retry_wait
	_retry_wait = mini(_retry_wait * 2, RETRY_MAX_MS)


func _post(msg: Dictionary) -> void:
	if not _enabled:
		return
	if not _queueing and _ws.get_ready_state() != WebSocketPeer.STATE_OPEN:
		return
	_queue.append(JSON.stringify(msg))
	_flush()


func _flush() -> void:
	if _ws.get_ready_state() != WebSocketPeer.STATE_OPEN:
		return
	for m in _queue:
		_ws.send_text(m)
	_queue.clear()


# Editor -> game: a live bundle refresh {t:"bundle", build, data}, or Play in game {t:"play", id,
# sceneId, blockId, takeOver, build?}. Validate the shape here so the host's handlers never see a
# malformed payload; anything else the editor sends is ignored.
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
		elif msg.get("t", "") == "play":
			var request = _play_request(msg)
			if request == null:
				continue
			if play_requested.get_connections().is_empty():
				reply_play(request["id"], { "started": false, "reason": "unhandled" })
			else:
				play_requested.emit(request)


# A play message's fields, or null when it isn't a well-formed request.
func _play_request(msg: Dictionary):
	for key in ["id", "sceneId", "blockId"]:
		if not (msg.get(key, null) is String) or msg[key] == "":
			return null
	return {
		"id": msg["id"],
		"sceneId": msg["sceneId"],
		"blockId": msg["blockId"],
		"takeOver": msg.get("takeOver", false) == true,
		"build": msg["build"] if msg.get("build", null) is String else "",
	}
