# GENERATED - vendored from expr/ports/godot/property_bag.gd by scripts/vendor-ports.mjs.
# Do not edit here; edit the shared source and re-run the script.
@tool   # editor-reachable: the bundle inspector plugin resolves bundles in the
        # editor, where a non-tool script loads as a placeholder
# PropertyBag - the state kernel's unit of state, port of
# @wildwinter/scoperegistry's PropertyBag, shared by both product families. A
# typed, declared property bag with defaults, the firing rule
# (engine writes notify subscribers; host writes are silent but always
# auditable), examiner rows, ONE sanctioned clone door, and bare-value
# save/load.
#
# Declarations are Dictionaries: {"name", "type", "default"?, "values"?,
# "writable"?} (PropertyDecl / ScopeDeclaration; "purpose" tolerated and
# ignored). Values are the shared scalars (bool / float / String / Array
# of String).
#
# NO `class_name`. Godot registers class_name in a PROJECT-WIDE namespace, so a shared
# file claiming one would collide the moment a game installed two addons that vendor it.
# Each family wraps this in its own `class_name` shim; identity belongs to the installing
# plugin, never to the shared source. See expr/docs/port-sharing.md.
#
# Name normalisation policy: lowercase by default (the registry's long-standing
# contract). A family whose property names are case-significant as authored passes
# identity instead, through the `normalise` option.
extends RefCounted

## The values module beside this one, vendored from the same place.
const Values := preload("values.gd")

## The live values Dictionary (stable identity across reseed, so an eval
## context built over it stays valid). Read-path for evaluation; writes go
## through set_value so the firing rule applies.
var values: Dictionary = {}

var _decls: Dictionary = {}   # normalised name -> declaration Dictionary
var _subscribers: Array[Callable] = []
var _auditors: Array[Callable] = []
var _normalise: Callable


func _init(declarations: Array = [], opts: Dictionary = {}) -> void:
	var norm = opts.get("normalise")
	_normalise = norm if norm is Callable else func(n: String) -> String: return n.to_lower()
	_seed(declarations)


func _seed(declarations: Array) -> void:
	for d in declarations:
		var name: String = _normalise.call(str(d["name"]))
		_decls[name] = d
		# Deep-copied so bags seeded from one declaration set never share a
		# mutable default (flags arrays).
		values[name] = _copy_value(Values.to_value(d.get("default", default_for(d))))


## The type default for a declaration with no explicit default.
static func default_for(d: Dictionary) -> Variant:
	if d.get("default") != null:
		return d["default"]
	match str(d.get("type", "")):
		"boolean":
			return false
		"number":
			return 0.0
		"string":
			return ""
		"enum":
			var vals: Array = d.get("values", [])
			return str(vals[0]) if not vals.is_empty() else ""
		"flags":
			return []
		"quality":
			# A quality starts at the first rung of its ladder (quality.md).
			var stages: Array = d.get("stages", [])
			return str(stages[0]) if not stages.is_empty() else ""
	return false


static func _copy_value(v) -> Variant:
	return (v as Array).duplicate() if v is Array else v


## Read a property's value, or null when undeclared and never written.
## (Named get_value / set_value because Object already owns get / set.)
func get_value(name: String) -> Variant:
	return values.get(_normalise.call(name))


## Write a property. Engine writes (the default) notify subscribers; pass
## {"silent": true} for a host write, which reaches only the audit hook.
## Returns the change Dictionary {"name", "prev"?, "next", "silent",
## "reason"?}, or {"error": message} (with push_error) on a read-only
## property - the GDScript reading of the TS throw.
func set_value(name: String, value, opts: Dictionary = {}) -> Dictionary:
	var n: String = _normalise.call(name)
	if _decls.has(n) and _decls[n].get("writable", true) == false:
		var msg := "'%s' is read-only" % name
		push_error("PatterPropertyBag: " + msg)
		return {"error": msg}
	var change := {
		"name": n,
		"next": value,
		"silent": bool(opts.get("silent", false)),
	}
	if values.has(n):
		change["prev"] = values[n]
	if opts.has("reason"):
		change["reason"] = opts["reason"]
	values[n] = value
	for audit in _auditors:
		audit.call(change)
	if not change["silent"]:
		for fn in _subscribers:
			fn.call(change)
	return change


## Notified of engine (non-silent) writes. Returns the unsubscribe Callable.
func subscribe(fn: Callable) -> Callable:
	_subscribers.append(fn)
	return func() -> void: _subscribers.erase(fn)


## Notified of EVERY write, silent or not. Returns the unsubscribe Callable.
func on_audit(fn: Callable) -> Callable:
	_auditors.append(fn)
	return func() -> void: _auditors.erase(fn)


## Examiner rows: the declared surface only (stray values are storage, not
## surface). Row shape: {"name", "type", "value", "default", "values"?,
## "writable"}.
func rows() -> Array:
	var out: Array = []
	for name in _decls:
		var d: Dictionary = _decls[name]
		var row := {
			"name": name,
			"type": str(d.get("type", "")),
			"value": get_value(name),
			"default": _copy_value(Values.to_value(d.get("default", default_for(d)))),
			"writable": bool(d.get("writable", true)),
		}
		if d.has("values"):
			row["values"] = d["values"]
		out.append(row)
	return out


func declarations() -> Array:
	return _decls.values()


## The one sanctioned copy door: values deep-copied, declarations shared (they
## are immutable), the normalisation policy carried, subscriptions NOT carried.
## Constructed through get_script(), which is the MOST DERIVED script for this instance,
## so a family's `class_name` shim clones to its own type rather than to this base. A
## A `new(...)` on this base here would hand back a bare bag, and every `as` cast on a
## clone would answer null.
func clone():
	var c = (get_script() as GDScript).new([], {"normalise": _normalise})
	c._decls = _decls.duplicate()
	for k in values:
		c.values[k] = _copy_value(values[k])
	return c


## Clear and re-seed from new declarations, in place (the values Dictionary
## keeps its identity, so contexts built over it stay valid).
func reseed(declarations: Array) -> void:
	values.clear()
	_decls.clear()
	_seed(declarations)


## Bare values, deep-copied and ready to embed in a product's save.
func save() -> Dictionary:
	return values.duplicate(true)


## Lay saved values over the current ones (call after a fresh seed: orphans
## land as strays, new declarations keep their defaults). Does not fire events.
func load(saved: Dictionary) -> void:
	for k in saved:
		values[_normalise.call(str(k))] = _copy_value(Values.to_value(saved[k]))
