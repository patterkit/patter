# Play in game, headless: the debug link reads the editor's play request as play-helpers' createDebugLink
# does (a well-formed message only; takeOver false and build "" when missing), and reply_play sends the
# answer in the wire's shape.
#
#   ports/godot/test/run.sh test_play_in_game.gd
extends SceneTree

var _fails := 0


func _initialize() -> void:
	var LinkT := load("res://addons/patterplay/runtime/debug_link.gd")
	var link = LinkT.new("h1", "Test")

	var req = link._play_request({ "t": "play", "v": 1, "id": "p1", "sceneId": "s1", "blockId": "b1", "takeOver": true, "build": "h2" })
	_expect(req != null and req["id"] == "p1" and req["sceneId"] == "s1" and req["blockId"] == "b1", "a full request is read")
	_expect(req != null and req["takeOver"] == true and req["build"] == "h2", "with takeOver and build")
	var bare = link._play_request({ "t": "play", "id": "p2", "sceneId": "s1", "blockId": "b1" })
	_expect(bare != null and bare["takeOver"] == false and bare["build"] == "", "takeOver false and build empty when missing")
	_expect(link._play_request({ "t": "play", "id": "p3", "sceneId": "s1" }) == null, "no block id is not a request")
	_expect(link._play_request({ "t": "play", "id": "", "sceneId": "s1", "blockId": "b1" }) == null, "an empty id is not a request")

	# reply_play queues the answer in the wire's shape (nothing is listening, so it stays queued).
	link._enabled = true
	link.reply_play("p1", { "started": false, "reason": "busy", "detail": "Mara is talking." })
	link.reply_play("p2", { "started": true })
	_expect(link._queue.size() == 2, "both answers are queued")
	if link._queue.size() == 2:
		var a = JSON.parse_string(link._queue[0])
		var b = JSON.parse_string(link._queue[1])
		_expect(a == { "t": "played", "id": "p1", "started": false, "reason": "busy", "detail": "Mara is talking." }, "a refusal carries its reason and detail")
		_expect(b == { "t": "played", "id": "p2", "started": true }, "a start carries no reason")
	link._enabled = false
	link.free()

	if _fails == 0:
		print("test_play_in_game: ALL PASS")
	quit(1 if _fails > 0 else 0)


func _expect(ok: bool, what: String) -> void:
	if not ok:
		_fails += 1
		print("FAIL: ", what)
