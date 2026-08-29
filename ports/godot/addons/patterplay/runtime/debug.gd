# A tiny global registry so a debug overlay (PatterStatePanel) can find the engines your game
# created, without you wiring a reference through. Call PatterDebug.register(engine) right after
# you build an Engine, and PatterDebug.unregister(engine) when you tear it down. Parity with the
# Unity PatterDebug.Register(...) hook the PatterStateWindow reads.
#
# The references are WEAK, and that is the point: a debug registry is an OBSERVER, and an observer
# must not decide what stays alive. Held strongly, an engine the game replaced - a Restart button, a
# scene change, a live bundle swap - stayed alive with its whole compiled story for the life of the
# process, and nothing looked wrong: the panel simply went on listing a run that had ended. A registry
# that only behaves when every host remembers to unregister is one that fails quietly on the day
# somebody forgets. (from-storylets/weak-debug-registries.)
class_name PatterDebug

# WeakRefs, pruned wherever this list is read or written. `engines` hands back live engines only, so
# no caller has to test for nulls.
static var _refs: Array = []


static func _live() -> Array:
	var out: Array = []
	var kept: Array = []
	for r in _refs:
		var e = r.get_ref()
		if e != null:
			kept.append(r)
			out.append(e)
	_refs = kept
	return out


# Every live registered engine. A property, so `PatterDebug.engines` reads as it always did.
static var engines: Array:
	get:
		return _live()


static func register(engine) -> void:
	if engine == null:
		return
	for e in _live():
		if e == engine:
			return
	_refs.append(weakref(engine))


static func unregister(engine) -> void:
	var kept: Array = []
	for r in _refs:
		var e = r.get_ref()
		if e != null and e != engine:
			kept.append(r)
	_refs = kept


# -- the live debug link -------------------------------------------------------
# A registered link lets the state panel say whether the editor is actually listening.

static var _link_refs: Array = []


static func _live_links() -> Array:
	var out: Array = []
	var kept: Array = []
	for r in _link_refs:
		var l = r.get_ref()
		if l != null:
			kept.append(r)
			out.append(l)
	_link_refs = kept
	return out


# Every live registered link.
static var links: Array:
	get:
		return _live_links()


static func register_link(link) -> void:
	if link == null:
		return
	for l in _live_links():
		if l == link:
			return
	_link_refs.append(weakref(link))


static func unregister_link(link) -> void:
	var kept: Array = []
	for r in _link_refs:
		var l = r.get_ref()
		if l != null and l != link:
			kept.append(r)
	_link_refs = kept


static func clear() -> void:
	_refs.clear()
	_link_refs.clear()
