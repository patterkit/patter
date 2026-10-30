# PatterRunner - the thin runner: the flow API turned from pull to push, for straightforward games.
# Start a conversation, and the runner hands each beat to the game as a signal; the game shows it however
# it likes and calls next() when it's ready. A choice waits for choose(id). Nothing else: no timing, no
# auto-advance, no UI, no audio. A line carries its beat id, so a game plays its recording with the audio
# resolver, or its own. The same runner in every Patterplay runtime.
#
#   var runner := PatterRunner.new()
#   add_child(runner)
#   runner.attach(engine)                                   # plays flow "main"
#   runner.line.connect(func(step): show(step["speakerLabel"], step["text"]))
#   runner.choice.connect(func(step): offer(step["options"]))   # then runner.choose(id)
#   runner.ended.connect(func(reason): close())   # "ended", or "ran-dry": a choice had nothing left
#   runner.begin()          # the project's start scene; next() on each click
#
# A fuller dialogue manager for more complex games, Patterstage, is coming.
#
# GDScript can't throw, so a refusal is push_error'd and kept for last_error(), as PatterFlow's advance()
# and choose() keep theirs: an address that doesn't resolve, next() or choose() before begin(), or a
# choose() the flow refuses. A refused call changes nothing and delivers nothing.
class_name PatterRunner
extends Node

## A line step, as flow.advance() returns it (its "id" is the beat id).
signal line(step: Dictionary)
## A text step, as flow.advance() returns it.
signal text(step: Dictionary)
## A game event step, as flow.advance() returns it.
signal game_event(step: Dictionary)
## The pending choice: {"groupId", "options"}.
signal choice(step: Dictionary)
## The flow has run out of content. `reason` is why, as its end step says: "ran-dry" when a choice had
## nothing left to offer and nothing came after it, otherwise "ended".
signal ended(reason: String)

## The flow the runner plays.
@export var flow_id := "main"

var _engine: PatterEngine
## next() calls asked for while a signal was being delivered, played once it returns.
var _queued := 0
var _delivering := false
## Why the last begin(), next() or choose() was refused, or "" when it wasn't: see last_error().
var _last_error := ""


## Give the runner its engine, and the flow it plays. Plays nothing until begin().
func attach(engine: PatterEngine, id: String = "main") -> void:
	_engine = engine
	flow_id = id


## The flow the runner plays, looked up by id each time: a load or a hot swap replaces it. Null before the
## first begin().
func get_flow() -> PatterFlow:
	return _engine.get_flow(flow_id) if _engine != null else null


## Start a conversation at a scene (and block), and deliver its first beat. The first begin opens the flow.
## A later one moves the same flow there, as an authored jump does, so visit counts, variations and the
## flow's own properties carry on through the playthrough.
##
## With no scene, the story starts from the beginning, at the project's start scene: the first time opens
## the flow there, and a later time resets it (flow.reset()), forgetting the flow's own state, as a new
## game does. An address that doesn't resolve is refused (see last_error()) before anything changes.
func begin(scene: String = "", block: String = "") -> void:
	_last_error = ""
	if _engine == null:
		_refuse("PatterRunner.begin: no engine; call attach() first")
		return
	var flow := get_flow()
	if flow == null or flow.is_closed():
		if _engine.open_flow(flow_id, scene, block) == null:
			_refuse("PatterRunner.begin: address not found: " + _address(scene, block))
			return
	elif scene == "":
		if block != "":
			_refuse("PatterRunner.begin: a block needs its scene")
			return
		flow.reset()
	elif not flow.goto(scene, block):
		_refuse("PatterRunner.begin: address not found: " + _address(scene, block))
		return
	_queued = 0
	next()


## Deliver the next beat, the pending choice, or the end.
func next() -> void:
	var flow := get_flow()
	if flow == null:
		_last_error = ""
		_refuse("PatterRunner.next: flow '%s' isn't open; call begin() first" % flow_id)
		return
	_queued += 1
	if _delivering:
		return
	_last_error = ""
	_delivering = true
	while _queued > 0:
		_queued -= 1
		# Looked up again each beat: a handler may have loaded a save or rebound the runner.
		flow = get_flow()
		if flow == null:
			break
		var step: Dictionary = flow.advance()
		if flow.last_error() != "":
			_last_error = flow.last_error()   # already push_error'd by the flow
			break
		_deliver(step)
	_delivering = false
	_queued = 0


## Pick an option of the pending choice, then deliver what it leads to. Refused as flow.choose() refuses
## (no choice pending, an unknown option, or one that isn't eligible), delivering nothing.
func choose(id: String) -> void:
	_last_error = ""
	var flow := get_flow()
	if flow == null:
		_refuse("PatterRunner.choose: flow '%s' isn't open; call begin() first" % flow_id)
		return
	flow.choose(id)
	if flow.last_error() != "":
		_last_error = flow.last_error()   # already push_error'd by the flow
		return
	next()


## Stop delivering: any next() a handler asked for is dropped, and nothing more is delivered until the
## game asks. The flow stays where it is, open and saveable, and `ended` is not emitted; next() carries on
## from there and begin() begins elsewhere.
func stop() -> void:
	_queued = 0


## Play on a replacement engine (what engine.hot_swap() or apply_live_bundle() returns).
func rebind(engine: PatterEngine) -> void:
	_engine = engine


## Why the last begin(), next() or choose() was refused (also push_error'd), or "" when it wasn't.
func last_error() -> String:
	return _last_error


func _refuse(message: String) -> void:
	_last_error = message
	push_error(message)


static func _address(scene: String, block: String) -> String:
	return scene if block == "" else "%s / %s" % [scene, block]


func _deliver(step: Dictionary) -> void:
	match step["type"]:
		"line":
			line.emit(step)
		"text":
			text.emit(step)
		"gameEvent":
			game_event.emit(step)
		"choice":
			choice.emit({"groupId": step["groupId"], "options": step["options"]})
		"end":
			ended.emit(str(step.get("reason", "ended")))
