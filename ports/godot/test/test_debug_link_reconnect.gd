# The debug link reconnects, headless, against a real loopback WebSocket server: a close is tried
# again after 1 s, doubling to at most 10 s; a hello puts the wait back to 1 s; the hello on a
# reconnect carries the build and the flows open now; nothing is queued while the editor is away; and
# a link the editor replaced (close code 4000) stays closed.
#
# The waits are read, not slept through: the test moves the next attempt to now rather than wait 1 to
# 10 s for it.
#
#   ports/godot/test/run.sh test_debug_link_reconnect.gd
extends SceneTree

var _fails := 0
var _tcp := TCPServer.new()
var _port := 0
var _peer: WebSocketPeer = null
var _link


func _initialize() -> void:
	for p in range(47910, 47990):
		if _tcp.listen(p, "127.0.0.1") == OK:
			_port = p
			break
	if _port == 0:
		print("FAIL: no free loopback port to listen on")
		quit(1)
		return

	var LinkT := load("res://addons/patterplay/runtime/debug_link.gd")
	_link = LinkT.new("h1", "Test", "ws://127.0.0.1:%d" % _port)
	_link._ready()   # dials (not added to the tree: this script drives _process itself)

	# First connection: the hello, then a flow opened while connected.
	_expect(_accept(), "the link connects")
	var hello = _receive()
	_expect(hello is Dictionary and hello.get("t") == "hello" and hello.get("build") == "h1" and hello.get("flows") == [], "and says hello (got %s)" % [hello])
	_link.flow_opened("main")
	var open = _receive()
	_expect(open is Dictionary and open.get("t") == "flowOpen" and open.get("flow") == "main", "a flow it opens is announced")

	# The editor closes normally: retried after 1 s, the next wait 2 s.
	_server_close(1000)
	_expect(_wait_for(func(): return _link._retry_at > 0), "a closed link schedules a retry")
	_expect(_link.state() == "connecting", "and reads as connecting, not closed (got %s)" % _link.state())
	_expect(_in_wait(1000), "the first retry is 1 s away (got %d ms)" % (_link._retry_at - Time.get_ticks_msec()))
	_expect(_link._retry_wait == 2000, "and the next wait is 2 s (got %d)" % _link._retry_wait)

	# The editor is gone: each failed attempt doubles the wait, to at most 10 s.
	_tcp.stop()
	var seen: Array = []
	for i in 5:
		var before: int = _link._retry_wait
		_link._retry_at = 1   # due now
		_link._process(0.0)    # dials
		_expect(_wait_for(func(): return _link._retry_at > 1), "failed attempt %d schedules another" % (i + 1))
		seen.append(before)
	_expect(seen == [2000, 4000, 8000, 10000, 10000], "the waits double to 10 s (got %s)" % [seen])
	_expect(_link._retry_wait == 10000, "and stay there")

	# While the editor is away nothing is queued, and the build and flows move on.
	_link.observe("side", "s1", "b1", "line")
	_expect(_link._queue.is_empty(), "nothing is queued while there's no open socket")
	_link.set_build("h2")
	_expect(_link._queue.is_empty(), "not even the new build's hello")

	# The editor is back: the same hello, with the current build and open flows; the wait back to 1 s.
	_expect(_tcp.listen(_port, "127.0.0.1") == OK, "the server listens again")
	_link._retry_at = 1
	_expect(_accept(), "the link reconnects")
	var again = _receive()
	var flows: Array = again.get("flows", []) if again is Dictionary else []
	flows.sort()
	_expect(again is Dictionary and again.get("t") == "hello" and again.get("build") == "h2" and again.get("project") == "Test", "it says hello again with the new build (got %s)" % [again])
	_expect(flows == ["main", "side"], "and the flows open now (got %s)" % [flows])
	_expect(_link._retry_wait == 1000, "a hello puts the wait back to 1 s (got %d)" % _link._retry_wait)
	_expect(_link.state() == "connected", "and it reads as connected")
	_link.observe("main", "s1", "b2", "line")
	var frame = _receive()
	_expect(frame is Dictionary and frame.get("t") == "frame" and frame.get("beatId") == "b2", "frames flow again")

	# Closed after a hello: the wait starts at 1 s again.
	_server_close(1001)
	_expect(_wait_for(func(): return _link._retry_at > 0), "a second close schedules a retry")
	_expect(_in_wait(1000), "1 s away, since the hello reset it")
	_link._retry_at = 1
	_expect(_accept(), "and it reconnects")
	_receive()

	# Replaced by another game: closed for good, no retry.
	_server_close(4000, "replaced")
	_expect(_wait_for(func(): return _link.state() == "closed"), "a replaced link reads as closed")
	_expect(_link._retry_at == 0, "and schedules no retry")
	for i in 20:
		_link._process(0.0)
		OS.delay_msec(5)
	_expect(not _tcp.is_connection_available(), "and doesn't dial again")
	_link.observe("main", "s1", "b3", "line")
	_expect(_link._queue.is_empty(), "nor queue anything")

	# Switched off while retrying: closed, and no retry left pending.
	var Off = LinkT.new("h1", "Test", "ws://127.0.0.1:%d" % _port)
	Off._ready()
	_tcp.stop()
	_expect(_wait_for(func(): Off._process(0.0); return Off._retry_at > 0), "a link with nothing to reach retries")
	Off.close()
	_expect(Off.state() == "closed" and Off._retry_at == 0, "and close() stops it")

	_link.free()
	Off.free()
	if _fails == 0:
		print("test_debug_link_reconnect: ALL PASS")
	quit(1 if _fails > 0 else 0)


# Take the link's next connection and finish the WebSocket handshake, polling the link meanwhile.
func _accept() -> bool:
	_peer = null
	for i in 400:
		_link._process(0.0)
		if _peer == null and _tcp.is_connection_available():
			_peer = WebSocketPeer.new()
			_peer.accept_stream(_tcp.take_connection())
		if _peer != null:
			_peer.poll()
			if _peer.get_ready_state() == WebSocketPeer.STATE_OPEN:
				return true
		OS.delay_msec(5)
	return false


# The next message the server receives, parsed, or null.
func _receive():
	for i in 400:
		_link._process(0.0)
		_peer.poll()
		if _peer.get_available_packet_count() > 0:
			return JSON.parse_string(_peer.get_packet().get_string_from_utf8())
		OS.delay_msec(5)
	return null


func _server_close(code: int, reason: String = "") -> void:
	_peer.close(code, reason)
	for i in 100:
		_peer.poll()
		if _peer.get_ready_state() == WebSocketPeer.STATE_CLOSED:
			return
		_link._process(0.0)
		OS.delay_msec(5)


# Poll the link until `cond` holds (2 s at most).
func _wait_for(cond: Callable) -> bool:
	for i in 400:
		if _peer != null:
			_peer.poll()
		_link._process(0.0)
		if cond.call():
			return true
		OS.delay_msec(5)
	return false


# The next attempt is due within `ms` (and not already due).
func _in_wait(ms: int) -> bool:
	var left: int = _link._retry_at - Time.get_ticks_msec()
	return left > ms - 500 and left <= ms


func _expect(ok: bool, what: String) -> void:
	if not ok:
		_fails += 1
		print("FAIL: ", what)
