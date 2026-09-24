# GENERATED - vendored from expr/ports/godot/scope_registry.gd by scripts/vendor-ports.mjs.
# Do not edit here; edit the shared source and re-run the script.
@tool   # editor-reachable: the bundle inspector plugin resolves bundles in the
        # editor, where a non-tool script loads as a placeholder
# ---------------------------------------------------------------------------
# ScopeRegistry - the scope registry / runtime state container, for Godot. THE
# SHARED SOURCE, a port of @wildwinter/scoperegistry's ScopeRegistry (0.7.0).
#
# Authored in expr/ports/godot and VENDORED into each consuming addon by
# expr/scripts/vendor-ports.mjs. Do not edit a vendored copy.
#
# ONE REGISTRY PER GAME. It holds the game's state as a set of named scopes, each
# either OWNED (a property bag this registry reads, writes, lists and saves) or
# FOREIGN (resolved by the game or another engine at runtime, never stored or saved
# here), and builds the eval context the shared evaluator consumes. A game that
# combines engines hands every engine the same registry; each engine registers its
# bags under keys of its own choosing and says, per evaluation, which key a token
# means (aliases).
#
# Declarations are Dictionaries, as the shared property bag takes them:
# {"name", "type", "default"?, "values"?, "stages"?, "writable"?}.
#
# Foreign resolvers are Dictionaries: {"get": Callable(name) -> value | null,
# "set"?: Callable(name, value)}. Omit "set" for a scope nobody may write.
#
# ERRORS. GDScript has no exceptions, so each operation the TypeScript package lets
# throw reports its refusal in its return value, and push_error()s it as well:
#   - define_owned, mount_owned, define_foreign, remove, set_value and reseed_owned
#     return a String: "" on success, else the TypeScript message word for word;
#   - read_scope_registry_spec returns {"ok": true, "spec": Dictionary | null} or
#     {"ok": false, "error": message};
#   - to_eval_context returns the context, or {"error": message} for an alias to a
#     key nobody registered;
#   - owned_bag returns the bag, or null.
# Nothing is changed by a refused call. The messages are part of the contract: the
# registry corpus matches them as substrings, in every language.
#
# NO `class_name`. Godot registers class_name in a PROJECT-WIDE namespace, so a shared
# file claiming one would collide the moment a game installed two addons that vendor it.
# Each family wraps this in its own `class_name` shim; identity belongs to the installing
# plugin, never to the shared source. See expr/docs/port-sharing.md.
#
# Not ported, on purpose: the deprecated save fragment (saveFragment, loadFragment,
# OwnedStateFragment, SAVE_FRAGMENT_VERSION), since versioning belongs to the save that
# embeds the values; and toSchema, since a runtime evaluates and never validates
# authored text.
# ---------------------------------------------------------------------------
extends RefCounted

## The values and property bag modules beside this one, vendored from the same place.
const Values := preload("values.gd")
const PropertyBag := preload("property_bag.gd")

## The scopeRegistrySpec versions this build understands.
const SUPPORTED_SPEC_VERSIONS: Array[int] = [1]

## token -> {"kind": "owned", "bag", "owner"?} or {"kind": "foreign", "resolver",
## "decls" (normalised name -> declaration), "scope_writable", "norm", "owner"?}.
## A Dictionary keeps insertion order, which is registration order.
var _scopes: Dictionary = {}

## Values loaded for keys nobody has registered yet, waiting to be claimed.
var _parked: Dictionary = {}

var _rev := 0

## A counter that moves whenever a scope is registered or removed, and at no other
## time: it starts at 0 and each registration or removal adds 1. Values changing does
## not move it. A caller that caches a context built by to_eval_context() rebuilds it
## when this moves, because the context's set of scopes is fixed when it is built
## while the values it reads stay live. Read-only.
var revision: int:
	get:
		return _rev
	set(_value):
		push_error("PatterScopeRegistry: revision is read-only")


## Extract and validate a `scopeRegistrySpec` from any parsed JSON value (a parsed
## bundle, or a plain {"scopeRegistrySpec": ...} manifest). Returns {"ok": true,
## "spec": Dictionary | null} (null when the key is absent, so callers can probe
## arbitrary files) or {"ok": false, "error": message} for a malformed or
## unsupported-version spec.
static func read_scope_registry_spec(source) -> Dictionary:
	if not (source is Dictionary) or not source.has("scopeRegistrySpec"):
		return {"ok": true, "spec": null}
	var raw = source["scopeRegistrySpec"]
	# An Array is an object to the TypeScript reader, which then finds no version on
	# it; say what it says.
	if raw is Array:
		return _spec_error("scopeRegistrySpec.version must be a number")
	if not (raw is Dictionary):
		return _spec_error("scopeRegistrySpec must be an object")
	var version = raw.get("version")
	if not Values.is_number(version):
		return _spec_error("scopeRegistrySpec.version must be a number")
	# Compared as a number, not truncated to an int first: 1.5 is not version 1.
	var supported := false
	for v in SUPPORTED_SPEC_VERSIONS:
		if float(v) == float(version):
			supported = true
	if not supported:
		var list: PackedStringArray = []
		for v in SUPPORTED_SPEC_VERSIONS:
			list.append(str(v))
		return _spec_error("unsupported scopeRegistrySpec version %s (supported: %s)" % [
			Values.js_number(float(version)), ", ".join(list)])
	if not (raw.get("scopes") is Array):
		return _spec_error("scopeRegistrySpec.scopes must be an array")
	for s in raw["scopes"]:
		if not (s is Dictionary) or not (s.get("token") is String):
			return _spec_error("each scopeRegistrySpec scope needs a string token")
	return {"ok": true, "spec": raw}


static func _spec_error(msg: String) -> Dictionary:
	push_error("PatterScopeRegistry: " + msg)
	return {"ok": false, "error": msg}


## Register a scope this registry OWNS and stores. Its bag is seeded from each
## declaration's "default" (or a type default), read, written, listed and saved here.
##
## `opts`: {"path_prefix"?: String, "normalise"?: Callable, "owner"?: String}.
##   - path_prefix: the address prefix its examiner rows carry, separator included.
##     Defaults to "<token>."; the address grammar is the product's, not the registry's.
##   - normalise: name normalisation, lower case by default; a case-significant product
##     passes identity.
##   - owner: who registered it (an engine's name), named in a clash error and carried
##     on examiner rows.
## A String in place of `opts` is the path prefix alone (the TypeScript pre-0.7 form).
## Returns "" or the refusal.
func define_owned(token: String, declarations: Array, opts = {}) -> String:
	var o: Dictionary = {"path_prefix": opts} if opts is String else opts
	var bag_opts := {"path_prefix": str(o.get("path_prefix", token + "."))}
	if o.get("normalise") is Callable:
		bag_opts["normalise"] = o["normalise"]
	var mount_opts := {}
	if o.get("owner") != null:
		mount_opts["owner"] = o["owner"]
	# Checked before the bag is built, so a refused registration builds nothing.
	var clash := _clash(token, mount_opts.get("owner"))
	if clash != "":
		return _refuse(clash)
	return mount_owned(token, _new_bag(declarations, bag_opts), mount_opts)


## The bag define_owned builds. A family's shim overrides this to build its own bag
## class, so owned_bag() hands back a bag of the family's type.
func _new_bag(declarations: Array, opts: Dictionary):
	return PropertyBag.new(declarations, opts)


## Attach an EXISTING bag as an owned scope: an engine (or the game) holds the bag,
## and this registry reads, writes, lists and saves it like its own. `opts`:
## {"owner"?: String}.
##
## The bag is duck-typed rather than typed as this file's bag, so a bag from another
## addon's copy of the shared source (a combined game) mounts as well as this one's.
##
## If values were loaded for this key before anyone registered it, the bag claims them
## now, laid over its seeded defaults by the bag's own load rule. Returns "" or the
## refusal.
func mount_owned(token: String, bag, opts: Dictionary = {}) -> String:
	var clash := _clash(token, opts.get("owner"))
	if clash != "":
		return _refuse(clash)
	var e := {"kind": "owned", "bag": bag}
	if opts.get("owner") != null:
		e["owner"] = str(opts["owner"])
	_scopes[token] = e
	_rev += 1
	if _parked.has(token):
		bag.load(_parked[token])
		_parked.erase(token)
	return ""


## Unregister a scope. With {"keep": true} an owned scope's values are parked and
## handed back when the same key is next registered, which is how a live reload hands
## an engine's state to its replacement. `keep` has no effect on a foreign scope,
## whose values were never the registry's. Returns "" or the refusal (an unknown key).
func remove(token: String, opts: Dictionary = {}) -> String:
	if not _scopes.has(token):
		return _refuse("unknown scope '@%s'" % token)
	var e: Dictionary = _scopes[token]
	if bool(opts.get("keep", false)) and e["kind"] == "owned":
		_parked[token] = e["bag"].save()
	_scopes.erase(token)
	_rev += 1
	return ""


## Drop parked values nobody claimed. Parked values are kept in the next save by
## default, so nothing loaded is lost to a flow or deck that simply has not reopened
## yet; a game that knows they are dead drops them here.
##
## With a `prefix`, only keys starting with it are dropped: an engine resetting itself
## drops its own instance keys ("my-engine/") and leaves every other engine's alone.
## The empty prefix drops them all.
func discard_parked(prefix: String = "") -> void:
	if prefix == "":
		_parked.clear()
		return
	for key in _parked.keys():
		if str(key).begins_with(prefix):
			_parked.erase(key)


## An owned scope's bag (subscribe, audit and rows live there); null (with
## push_error) when the token is not an owned scope.
func owned_bag(token: String):
	var e = _scopes.get(token)
	if e == null or e["kind"] != "owned":
		push_error("PatterScopeRegistry: '@%s' is not an owned scope" % token)
		return null
	return e["bag"]


## Re-initialise an existing OWNED scope's bag from new declarations, clearing its
## current values. For scope-local state that resets on a context change (entering a
## new scene, site or deck) without disturbing other scopes. Mutates the bag in place,
## so an eval context already built from this registry stays valid. Returns "" or the
## refusal.
func reseed_owned(token: String, declarations: Array) -> String:
	var e = _scopes.get(token)
	if e == null or e["kind"] != "owned":
		return _refuse("'@%s' is not an owned scope" % token)
	e["bag"].reseed(declarations)
	return ""


## Register a FOREIGN scope backed by a resolver. The values live in the game or
## another engine and are never stored or saved here. `declarations` (optional, for
## instance imported from a scopeRegistrySpec) are used for listing and writability;
## omit them for an opaque scope.
##
## `opts`: {"writable"?: bool, "normalise"?: Callable, "owner"?: String}.
##   - writable: the scope-level read/write default for its declarations (default true);
##   - normalise: name normalisation for the declarations and for the names passed to
##     the resolver, lower case by default; a case-significant product passes identity;
##   - owner: who registered it (see define_owned).
## A bool in place of `opts` is the scope-level writable default alone (the pre-0.7
## form). Returns "" or the refusal.
func define_foreign(token: String, resolver: Dictionary, declarations: Array = [], opts = true) -> String:
	var o: Dictionary = {"writable": opts} if opts is bool else opts
	var clash := _clash(token, o.get("owner"))
	if clash != "":
		return _refuse(clash)
	var norm: Callable = o["normalise"] if o.get("normalise") is Callable else _lower_case
	var decls := {}
	for d in declarations:
		decls[norm.call(str(d["name"]))] = d
	var e := {
		"kind": "foreign", "resolver": resolver, "decls": decls,
		"scope_writable": bool(o.get("writable", true)), "norm": norm,
	}
	if o.get("owner") != null:
		e["owner"] = str(o["owner"])
	_scopes[token] = e
	_rev += 1
	return ""


static func _lower_case(name: String) -> String:
	return name.to_lower()


func has(token: String) -> bool:
	return _scopes.has(token)


## Read a property; null if the scope or property is not present.
## (Named get_value / set_value because Object already owns get / set.)
func get_value(scope: String, name: String) -> Variant:
	var e = _scopes.get(scope)
	if e == null:
		return null
	if e["kind"] == "owned":
		return e["bag"].get_value(name)
	return (e["resolver"]["get"] as Callable).call((e["norm"] as Callable).call(name))


## Write a property (an ENGINE write: the bag's subscribers fire; use the bag directly
## for silent host writes). Returns "" or the refusal: an unknown scope, or a
## read-only property.
##
## `writable: false` is the STORY's promise, so a story write is refused and a HOST
## write is not: pass {"host": true} from a host's own surface (its set_property, its
## tooling, a coverage driver) and never from the path an outcome or effect takes. A
## foreign scope whose resolver has no "set" is refused for everyone, host included:
## that is not a rule to bypass, it is a game that gave no way to write.
func set_value(scope: String, name: String, value, opts: Dictionary = {}) -> String:
	var host := bool(opts.get("host", false))
	var e = _scopes.get(scope)
	if e == null:
		return _refuse("unknown scope '@%s'" % scope)
	if e["kind"] == "owned":
		var change: Dictionary = e["bag"].set_value(name, value, {"host": true} if host else {})
		if change.has("error"):
			return _refuse("'@%s.%s' is read-only" % [scope, name])
		return ""
	var n: String = (e["norm"] as Callable).call(name)
	if not (e["resolver"].get("set") is Callable):
		return _refuse("'@%s.%s' is read-only" % [scope, name])
	if not host and not _foreign_writable(e, n):
		return _refuse("'@%s.%s' is read-only" % [scope, name])
	(e["resolver"]["set"] as Callable).call(n, value)
	return ""


func _foreign_writable(e: Dictionary, name: String) -> bool:
	if not (e["resolver"].get("set") is Callable):
		return false   # no setter: a read-only scope
	var d = e["decls"].get(name)
	if d != null and d.get("writable") != null:
		return bool(d["writable"])
	return bool(e["scope_writable"])


## Examiner rows across every scope with a declared surface, in registration order:
## an owned scope's bag rows, and a declared foreign scope's declarations (values read
## through, writability reflecting the resolver). Opaque foreign scopes are not listed.
##
## Row shape: the bag's row ({"name", "path", "type", "value", "default", "values"?,
## "stages"?, "writable"}) plus "scope" (the registered key) and "owner" (only when
## the scope was registered with one), so one examiner can group a combined game by
## engine. A foreign row's path is "<token>.<name>".
func list_properties() -> Array:
	var out: Array = []
	for token in _scopes:
		var e: Dictionary = _scopes[token]
		if e["kind"] == "owned":
			for row in e["bag"].rows():
				var r: Dictionary = row.duplicate()
				r["scope"] = token
				if e.has("owner"):
					r["owner"] = e["owner"]
				out.append(r)
		else:
			for n in e["decls"]:
				var d: Dictionary = e["decls"][n]
				var r := {
					"scope": token,
					"name": n,
					"path": "%s.%s" % [token, n],
					"type": str(d.get("type", "")),
					"value": (e["resolver"]["get"] as Callable).call(n),
					"default": _copy(Values.to_value(PropertyBag.default_for(d))),
					"writable": _foreign_writable(e, n),
				}
				if e.has("owner"):
					r["owner"] = e["owner"]
				if d.has("values"):
					r["values"] = d["values"]
				if d.has("stages"):
					r["stages"] = d["stages"]
				out.append(r)
	return out


## Build the eval context the shared evaluator consumes: owned scopes as their live
## value Dictionaries, foreign scopes as their resolvers' get Callables. `host` carries
## dialect-function callbacks and is passed through untouched (and left out when null).
##
## `opts`: {"aliases"?: {token: registered key}}. {"scene": "patter/flow-2/scene/tavern"}
## makes `@scene` read that instance bag, for this context only. The registry learns
## nothing about what the token MEANS; the engine names the key per evaluation. It is
## the registry's mechanism rather than the engine patching the context afterwards,
## because quality ladders are looked up by token too, and an alias applies to both.
##
## An alias to a key nobody registered is refused, returning {"error": message} (with
## push_error): a condition evaluated against a scope that is not there is an engine
## bug, not a graceful false.
func to_eval_context(host = null, opts: Dictionary = {}) -> Dictionary:
	var view := _view(opts.get("aliases", {}))
	if view.has("error"):
		push_error("PatterScopeRegistry: " + str(view["error"]))
		return {"error": view["error"]}
	var entries: Dictionary = view["entries"]
	var scopes := {}
	for token in entries:
		var e: Dictionary = entries[token]
		scopes[token] = e["bag"].values if e["kind"] == "owned" else e["resolver"]["get"]
	var ctx := {"scopes": scopes}
	if host != null:
		ctx["host"] = host
	# The quality channel (quality.md): declared here once, so a host that registers a
	# quality gets ordering comparisons and advance() with no further wiring. Only added
	# when a quality exists, so contexts stay identical for products that declare none.
	var qualities := _quality_ladders(entries)
	if not qualities.is_empty():
		ctx["qualities"] = func(scope: String, name: String):
			var e = entries.get(scope)
			if e == null or not qualities.has(scope):
				return null
			return qualities[scope].get(_norm_of(e).call(name))
	return ctx


## The scopes an expression sees: every registered key under its own token, then each
## alias token pointing at its key's entry (an alias shadows a key of the same name).
## Keys an engine uses for instance bags ("engine/flow-2/...") are not valid expression
## tokens, so they are present but unreachable. {"entries": Dictionary} or {"error"}.
func _view(aliases: Dictionary) -> Dictionary:
	var out := _scopes.duplicate()
	for token in aliases:
		var key := str(aliases[token])
		if not _scopes.has(key):
			return {"error": "alias '@%s' names '%s', which is not registered" % [token, key]}
		out[token] = _scopes[key]
	return {"entries": out}


## Every quality declaration's ladder, keyed scope token then name (the scope's own
## normalisation).
func _quality_ladders(entries: Dictionary) -> Dictionary:
	var out := {}
	for token in entries:
		var e: Dictionary = entries[token]
		var decls := _decls_of(e)
		for n in decls:
			var d: Dictionary = decls[n]
			if d.get("type") != "quality" or d.get("stages") == null:
				continue
			if not out.has(token):
				out[token] = {}
			out[token][n] = d["stages"]
	return out


## A scope entry's declarations, keyed by its own normalisation.
static func _decls_of(e: Dictionary) -> Dictionary:
	if e["kind"] == "foreign":
		return e["decls"]
	var norm := _norm_of(e)
	var out := {}
	for d in e["bag"].declarations():
		out[norm.call(str(d["name"]))] = d
	return out


## A scope entry's name normalisation.
static func _norm_of(e: Dictionary) -> Callable:
	if e["kind"] == "foreign":
		return e["norm"]
	# The bag's own policy, so a case-significant (identity) bag is not folded to lower
	# case one layer up.
	return Callable(e["bag"], "normalise")


## Serialise OWNED scopes (foreign scopes are the game's, and the game saves them) as
## bare bags keyed by token, plus any values still parked, so a save taken before every
## engine has re-registered loses nothing. The registry knows nothing about game saves:
## a game embeds this in its own.
func save() -> Dictionary:
	var out := {}
	for token in _scopes:
		var e: Dictionary = _scopes[token]
		if e["kind"] == "owned":
			out[token] = e["bag"].save()
	for token in _parked:
		out[token] = (_parked[token] as Dictionary).duplicate(true)
	return out


## Restore from a save() blob. An owned scope lays its section over its current values
## (the bag's load rule). A section for a key nobody has registered yet is PARKED and
## handed over when that key registers, so a game can load its registry before its
## engines have reopened their flows or decks. A section for a foreign scope is
## ignored: those values are the game's.
##
## A load replaces whatever was parked before it: it is a whole restore, and residue
## from an earlier load must not leak into this one. With {"keep_parked": true} it
## keeps what earlier loads parked instead, adding this blob's unclaimed sections to it
## (a section for the same key replaces the parked one): for an engine moving an older
## save's values into a registry the game has already loaded.
func load(blob: Dictionary, opts: Dictionary = {}) -> void:
	if not bool(opts.get("keep_parked", false)):
		_parked.clear()
	for token in blob:
		var e = _scopes.get(token)
		if e == null:
			_parked[token] = (blob[token] as Dictionary).duplicate(true)
		elif e["kind"] == "owned":
			e["bag"].load(blob[token])


## A token is taken once. There is no reserved-token list: a clash surfaces here, the
## moment a game combines its engines, which is the only moment anyone knows which
## engines are present. With owners recorded the message says whose token it already
## is. "" when the token is free.
func _clash(token: String, owner) -> String:
	if not _scopes.has(token):
		return ""
	var e: Dictionary = _scopes[token]
	var by := (" by %s" % e["owner"]) if e.has("owner") else ""
	var wants := (" (wanted by %s)" % str(owner)) if owner != null else ""
	return "scope '@%s' is already registered%s%s" % [token, by, wants]


## Report a refusal: push_error it under the family's class name, and hand it back.
func _refuse(msg: String) -> String:
	push_error("PatterScopeRegistry: " + msg)
	return msg


static func _copy(v) -> Variant:
	return (v as Array).duplicate() if v is Array else v
