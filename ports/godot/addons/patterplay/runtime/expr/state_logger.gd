# GENERATED - vendored from expr/ports/godot/state_logger.gd by scripts/vendor-ports.mjs.
# Do not edit here; edit the shared source and re-run the script.
@tool   # editor-reachable, like the bag it watches
# The state logger's product-agnostic core, shared by both product families.
#
# Property logging is PUSH-based on the PropertyBag audit hook: every write, engine or host,
# arrives with its previous value and logs the moment it lands. A diff is kept for what has
# no hook - a product's non-property state (turns, cooldowns, visit counts) arrives through
# the extra provider and is compared on capture(), as do bag values replaced wholesale by a
# load, which fires no events.
#
# A diff alone is strictly weaker, which is why this shape won: it can only report the NET
# change between two captures, so a value that changed and changed back is invisible to it,
# and every write is reported late.
#
# Changes are Dictionaries {"path", "from", "to"} (null = unset; a stored value is never
# null). Line format: `${label}${path}: ${from} -> ${to}`, `<unset>` for null.
#
# A MOUNT is {"bag": <PropertyBag>, "path_prefix": String?}. The prefix is used VERBATIM,
# separator included, exactly as the bag's own is; omit it and the bag's own path_prefix is
# used. They differ when a product's log path is not its address: Patterplay addresses a
# scene property `@scene.mood` relative to a flow's current scene, but must log it as
# `@scene:kitchen.mood`, because a log spans scenes and has to say which one.
#
# NO `class_name`: Godot registers those project-wide, so each family wraps this in a shim.
# See expr/docs/port-sharing.md.
#
# LIFETIME: the auditor Callables bound into the bags reference this logger, so a live
# logger and its bags keep each other alive until dispose() (RefCounted collects no cycles).
# Dispose a logger you are done with.
extends RefCounted

const Values := preload("values.gd")

var _mounts_provider: Callable   # -> Array of {"bag", "path_prefix"?}
var _extra_provider: Callable    # -> Dictionary path -> value
var _sink: Callable
var _label: String
var _baseline: Dictionary = {}
var _pushed: Array = []
var _mounted: Array = []   # of {"bag", "off": Callable}


## opts: {"sink": Callable(String), "label": String}; sink defaults to print.
func _init(mounts_provider: Callable, extra_provider: Callable, opts: Dictionary = {}) -> void:
	_mounts_provider = mounts_provider
	_extra_provider = extra_provider
	var sink = opts.get("sink")
	_sink = sink if sink is Callable else func(line: String) -> void: print(line)
	_label = str(opts.get("label", ""))
	_baseline = _full()
	_mount()


static func _show(v) -> String:
	return "<unset>" if v == null else Values.show(v)


## A stored value, safe to hand out: arrays are duplicated so a snapshot cannot be mutated
## through the bag's own list, scalars are immutable already.
static func _copy(v) -> Variant:
	return (v as Array).duplicate() if v is Array else v


static func _prefix_of(mount: Dictionary) -> String:
	return str(mount["path_prefix"]) if mount.has("path_prefix") else str(mount["bag"].path_prefix)


func _emit(change: Dictionary) -> void:
	_sink.call("%s%s: %s -> %s" % [_label, change["path"], _show(change["from"]), _show(change["to"])])


## The full flattened snapshot: every mounted bag's values under its prefix, plus the
## adapter's non-property paths.
func snapshot() -> Dictionary:
	return _full()


func _full() -> Dictionary:
	var out := {}
	for mount in _mounts_provider.call():
		var prefix := _prefix_of(mount)
		var bag = mount["bag"]
		for name in bag.values:
			out[prefix + name] = _copy(bag.values[name])
	var extra: Dictionary = _extra_provider.call()
	for path in extra:
		out[path] = _copy(extra[path])
	return out


func _hook(prefix: String, bag) -> void:
	# The write logs as it lands, `from` straight off the audit event; the baseline moves
	# with it so capture() never re-reports what was already said.
	var auditor := func(change: Dictionary) -> void:
		var c := {
			"path": prefix + str(change["name"]),
			"from": _copy(change.get("prev")),
			"to": _copy(change["next"]),
		}
		_emit(c)
		_pushed.append(c)
		_baseline[c["path"]] = _copy(change["next"])
	# Typed explicitly: `bag` is untyped here (the shared source cannot name a family's bag
	# class), so := has nothing to infer from.
	var off: Callable = bag.on_audit(auditor)
	_mounted.append({"bag": bag, "off": off})


func _mount() -> void:
	var mounts: Array = _mounts_provider.call()
	var same := _mounted.size() == mounts.size()
	if same:
		for i in mounts.size():
			if _mounted[i]["bag"] != mounts[i]["bag"]:
				same = false
				break
	if same:
		return
	for m in _mounted:
		(m["off"] as Callable).call()
	_mounted = []
	for mount in mounts:
		_hook(_prefix_of(mount), mount["bag"])


## Everything since the last capture: the audited writes already logged as they landed, plus
## anything that changed WITHOUT an audit event, diffed, logged and re-baselined.
func capture() -> Array:
	var next := _full()
	var diffed := diff_state(_baseline, next)
	for c in diffed:
		_emit(c)
	var changes := _pushed + diffed
	_pushed = []
	_baseline = next
	_mount()   # a load replaces a product's bags; re-hook them
	return changes


## Unhook the bag auditors. The logger is inert afterwards.
func dispose() -> void:
	for m in _mounted:
		(m["off"] as Callable).call()
	_mounted = []
	_pushed = []


## The changed paths between two snapshots, sorted; null = unset.
static func diff_state(prev: Dictionary, next: Dictionary) -> Array:
	var paths := {}
	for p in prev:
		paths[p] = true
	for p in next:
		paths[p] = true
	var sorted := paths.keys()
	sorted.sort()
	var changes: Array = []
	for path in sorted:
		var from = prev.get(path)
		var to = next.get(path)
		var equal: bool = (to == null) if from == null else (to != null and Values.value_equals(from, to))
		if not equal:
			changes.append({"path": path, "from": from, "to": to})
	return changes
