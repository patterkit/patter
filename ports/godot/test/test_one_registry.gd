@tool
extends SceneTree

# One registry per game (patterkit design/one-registry-handover.md), held from the GAME's side: what
# is in the registry, what the game saves, and that loading works in either order. The GDScript half
# of the JS runtime's one-registry.test.ts and combined-game.test.ts.
#
# The engine registers every property bag it has in the game's scope registry: `@patter` under
# `patter`, and its per-flow and per-scene bags under keys that start `patter/`. save_game() keeps
# only what is not a property, unless the engine made its own registry (a standalone game), when the
# registry's values ride along.
#
# The combined-game half runs a small stand-in for the Storylet Engine that registers its own scope
# (`@story`) the way an engine does; the real Storylet Engine is proven beside Patter in the
# storylets repo.
#
#   godot --headless --path ports/godot --script res://test/test_one_registry.gd

var _fails := 0

const WORLD_DECLS := [{"name": "gold", "type": "number", "default": 0}]


static func _eff(target: String, ast: Array) -> Dictionary:
	return {"kind": "set", "target": target, "value": {"src": "", "ast": ast}}


static func _plus(scope: String, name: String, n: float) -> Array:
	return ["bin", "+", ["sv", scope, name], ["n", n]]


## The JS test's project: a shared global, a per-flow global, a per-flow and a shared scene prop, and
## a declared @world, each bumped once as the one snippet exits.
static func _bundle() -> Dictionary:
	return {
		"schema": "patter/bundle@0",
		"locales": {"default": "en", "included": ["en"]},
		"strings": {"en": {"L": "a line"}},
		"properties": [
			{"name": "fame", "type": "number", "default": 0, "shared": true},    # -> `patter`
			{"name": "mood", "type": "number", "default": 0, "shared": false},   # -> each flow's own bag
		],
		"scopeRegistry": {"version": 1, "scopes": [{"token": "world", "declarations": WORLD_DECLS}]},
		"scenes": {"s": {"id": "s", "gameId": "s", "name": "S",
			"sceneProps": [
				{"name": "count", "type": "number", "default": 0},                 # per flow
				{"name": "tally", "type": "number", "default": 0, "shared": true}, # the scene's shared bag
			],
			"blocks": [{"id": "b", "gameId": "b", "name": "B", "children": [
				{"id": "sn", "type": "snippet", "beats": [{"id": "L", "kind": "text"}],
					"onExit": [
						_eff("@fame", _plus("patter", "fame", 1)),
						_eff("@mood", _plus("patter", "mood", 2)),
						_eff("@scene.count", _plus("scene", "count", 1)),
						_eff("@scene.tally", _plus("scene", "tally", 1)),
						_eff("@world.gold", _plus("world", "gold", 5)),
					],
					"jump": {"to": "END"}},
			]}]}},
	}


static func _play_out(flow) -> void:
	for i in range(10):
		if flow.advance().get("type", "") == "end":
			return


## A game that owns its registry and registers `@world` itself, as a property the registry stores.
static func _game() -> Dictionary:
	var registry := PatterScopeRegistry.new()
	registry.define_owned("world", WORLD_DECLS, {"owner": "Game"})
	return {"registry": registry, "patter": PatterEngine.new(_bundle(), {"registry": registry, "seed": 1})}


func _initialize() -> void:
	_registration()
	_saving()
	_host_scopes()
	_either_order()
	_old_save()
	_late_scope()
	_clash()
	_keys_and_lifetime()
	_hot_swap()
	_combined_game()
	print("test_one_registry: " + ("ALL PASS" if _fails == 0 else str(_fails) + " FAILED"))
	quit(1 if _fails > 0 else 0)


# -- registration ----------------------------------------------------------------

func _registration() -> void:
	var g := _game()
	var registry = g["registry"]
	_play_out(g["patter"].open_flow("f", "s"))
	_check("registers every bag in the game's registry, under Patter's keys", _eq(registry.save(), {
		"world": {"gold": 5},
		"patter": {"fame": 1},
		"patter/flow/f/patter": {"mood": 2},
		"patter/flow/f/scene/s": {"count": 1},
		"patter/scene/s": {"tally": 1},
	}), JSON.stringify(registry.save()))
	# Examiner rows keep the story's addresses; the scope column says which bag, the owner whose.
	var rows: Array = []
	for r in registry.list_properties():
		if r.get("owner") == "Patter":
			rows.append([r["scope"], r["path"], r["value"]])
	_check("and labels them Patter, with the story's addresses", _eq(rows, [
		["patter", "@patter.fame", 1],
		["patter/flow/f/patter", "@patter.mood", 2],
		["patter/flow/f/scene/s", "@scene.count", 1],
		["patter/scene/s", "@scene.tally", 1],
	]), str(rows))

	var world_owner = null
	for r in registry.list_properties():
		if r["scope"] == "world":
			world_owner = r.get("owner")
	_check("uses a @world the game registered", world_owner == "Game" and _eq(registry.get_value("world", "gold"), 5),
		"%s %s" % [world_owner, registry.get_value("world", "gold")])

	var bare := PatterScopeRegistry.new()
	PatterEngine.new(_bundle(), {"registry": bare})
	_check("does not self-back a declared host scope in the game's registry: that token is the game's",
		bare.has("patter") and not bare.has("world"), "")


# -- saving ----------------------------------------------------------------------

func _saving() -> void:
	var g := _game()
	_play_out(g["patter"].open_flow("f", "s"))
	var save: Dictionary = g["patter"].save_game()
	_check("leaves the values out of save_game when the game passed the registry", not save.has("registry"), str(save.keys()))
	var fkeys: Array = save["flows"]["f"].keys()
	fkeys.sort()
	_check("and a flow's snapshot is its cursor, PRNG and visits", fkeys == ["cursor", "rngState", "visits"], str(fkeys))

	var alone := PatterEngine.new(_bundle(), {"seed": 1})
	_play_out(alone.open_flow("f", "s"))
	var blob = JSON.parse_string(JSON.stringify(alone.save_game()))
	_check("a standalone engine self-backs @world as a stored property, and saves it",
		blob.has("registry") and _eq(blob["registry"].get("world"), {"gold": 5}), JSON.stringify(blob.get("registry")))
	var restored := PatterEngine.new(_bundle(), {"seed": 1})
	restored.load_game(blob)
	_check("and it loads back", _eq(restored.get_property("@world.gold"), 5), str(restored.get_property("@world.gold")))


# -- the host_scopes option, re-based on the registry ------------------------------

func _host_scopes() -> void:
	# A game binding @world through "host_scopes" keeps the values itself: an EXTERNAL scope, read and
	# written through the game's resolver and never stored or saved by the registry.
	var store := {"gold": 0}
	var engine := PatterEngine.new(_bundle(), {"seed": 1, "host_scopes": {"world": {
		"get": func(n): return store.get(str(n)),
		"set": func(n, v): store[str(n)] = v,
	}}})
	_play_out(engine.open_flow("f", "s"))
	_check("host_scopes: a story write reaches the game's own store", _eq(store["gold"], 5), str(store))
	_check("host_scopes: the engine reads it back", _eq(engine.get_property("@world.gold"), 5), str(engine.get_property("@world.gold")))
	var save: Dictionary = engine.save_game()
	_check("host_scopes: a bound scope is never in the save", not save["registry"].has("world"), JSON.stringify(save["registry"]))
	engine.set_property("@world.gold", 11)
	_check("host_scopes: the game's own write lands in its store", _eq(store["gold"], 11), str(store))


# -- one save for the game, loaded in either order ----------------------------------

static func _session1() -> Dictionary:
	var g := _game()
	_play_out(g["patter"].open_flow("f", "s"))
	g["patter"].open_flow("g", "s")   # a second flow, still at its first beat
	return JSON.parse_string(JSON.stringify({"registry": g["registry"].save(), "patter": g["patter"].save_game()}))


func _check_resumed(label: String, g: Dictionary) -> void:
	var p = g["patter"]
	_check(label + ": shared global", _eq(p.get_property("@fame"), 1), str(p.get_property("@fame")))
	_check(label + ": the game's @world", _eq(p.get_property("@world.gold"), 5), str(p.get_property("@world.gold")))
	_check(label + ": a flow's own global", p.get_flow("f") != null and _eq(p.get_flow("f").get_property("@mood"), 2), "")
	_check(label + ": a flow's own scene prop", p.get_flow("f") != null and _eq(p.get_flow("f").get_property("@scene.count"), 1), "")
	_check(label + ": the other flow's own scene prop", p.get_flow("g") != null and _eq(p.get_flow("g").get_property("@scene.count"), 0), "")
	_check(label + ": a shared scene prop", p.get_flow("g") != null and _eq(p.get_flow("g").get_property("@scene.tally"), 1), "")
	if p.get_flow("g") == null:
		return
	# Play on: g's exit lands on the restored shared values.
	_play_out(p.get_flow("g"))
	_check(label + ": play continues on the shared global", _eq(p.get_property("@fame"), 2), str(p.get_property("@fame")))
	_check(label + ": and on the shared scene bag", _eq(g["registry"].get_value("patter/scene/s", "tally"), 2),
		str(g["registry"].get_value("patter/scene/s", "tally")))


func _either_order() -> void:
	var save := _session1()

	var g1 := _game()
	g1["registry"].load(save["registry"])
	g1["patter"].load_game(save["patter"])
	_check_resumed("registry first", g1)

	var g2 := _game()
	g2["patter"].load_game(save["patter"])
	g2["registry"].load(save["registry"])
	_check_resumed("engine first", g2)

	var g3 := _game()
	_play_out(g3["patter"].open_flow("f", "s"))
	_play_out(g3["patter"].open_flow("stray", "s"))   # not in the save: its bags must not survive
	g3["registry"].load(save["registry"])
	g3["patter"].load_game(save["patter"])
	_check_resumed("into a game already playing", g3)
	var strays: Array = g3["registry"].save().keys().filter(func(k): return str(k).contains("stray"))
	_check("into a game already playing: a flow the save does not have is gone", strays.is_empty(), str(strays))


# -- a version 2 save (property values in the save itself) ---------------------------

func _old_save() -> void:
	# Every section carries a value, so a section left behind is seen.
	var v2 := {
		"version": 2,
		"shared": {"patter": {"fame": 4}},
		"sharedVisits": {},
		"sharedSelectors": {},
		"stageBags": {"s": {"tally": 6}},
		"flows": {"f": {
			"scopes": {"patter": {"mood": 8}},
			"sceneBags": {"s": {"count": 3}},
			"rngState": 1,
			"visits": {},
			"cursor": {
				"flowEnded": false, "currentSceneId": "s",
				"stack": [{"sceneId": "s", "containerId": "b", "index": 0, "nextId": "sn"}],
				"activeSnippetId": null, "beatIndex": 0, "pendingChoice": null,
				"pendingPromptOwnerId": null, "selectors": {},
			},
		}},
	}
	var moved := {
		"patter": {"fame": 4},
		"patter/flow/f/patter": {"mood": 8},
		"patter/flow/f/scene/s": {"count": 3},
		"patter/scene/s": {"tally": 6},
	}
	var g := _game()
	_check("a version 2 save loads into the game's registry", g["patter"].load_game(v2.duplicate(true)), "")
	var want := moved.duplicate(true)
	want["world"] = {"gold": 0}
	_check("its values move into the registry under Patter's keys", _eq(g["registry"].save(), want), JSON.stringify(g["registry"].save()))
	var f = g["patter"].get_flow("f")
	_check("and the flow reads them", f != null and _eq(f.get_property("@mood"), 8) and _eq(f.get_property("@scene.count"), 3)
		and _eq(f.get_property("@scene.tally"), 6) and _eq(f.get_property("@fame"), 4), "")

	var alone := PatterEngine.new(_bundle(), {"seed": 1})
	alone.load_game(v2.duplicate(true))
	var back: Dictionary = alone.save_game()
	var want_alone := moved.duplicate(true)
	want_alone["world"] = {"gold": 0}
	_check("a standalone engine writes a version 2 save back as version 3, values under `registry`",
		_eq(back.get("version"), 3) and _eq(back.get("registry"), want_alone), JSON.stringify(back.get("registry")))


# -- a scope another engine registers after the flow opened ---------------------------

func _late_scope() -> void:
	var bundle := _bundle()
	bundle.erase("scopeRegistry")
	bundle["strings"] = {"en": {"I": "intro", "L": "act two"}}
	bundle["scenes"]["s"]["blocks"] = [{"id": "b", "gameId": "b", "name": "B", "children": [
		# Evaluated first, so the flow has built its evaluation context before @story exists.
		{"id": "intro", "type": "snippet", "condition": {"src": "@fame >= 0", "ast": ["bin", ">=", ["sv", "patter", "fame"], ["n", 0]]},
			"beats": [{"id": "I", "kind": "text"}]},
		{"id": "yes", "type": "snippet", "condition": {"src": "@story.act >= 2", "ast": ["bin", ">=", ["sv", "story", "act"], ["n", 2]]},
			"beats": [{"id": "L", "kind": "text"}], "jump": {"to": "END"}},
	]}]
	var registry := PatterScopeRegistry.new()
	var patter := PatterEngine.new(bundle, {"registry": registry})
	var flow := patter.open_flow("f", "s")
	var first: Dictionary = flow.advance()
	_check("reads a scope registered after the flow opened: the intro plays first", first.get("text") == "intro", str(first))
	registry.define_owned("story", [{"name": "act", "type": "number", "default": 2}], {"owner": "Other engine"})
	var second: Dictionary = flow.advance()
	_check("reads a scope registered after the flow opened", second.get("text") == "act two", str(second))


# -- clashes ---------------------------------------------------------------------

func _clash() -> void:
	var registry := PatterScopeRegistry.new()
	PatterEngine.new(_bundle(), {"registry": registry})
	var before: Dictionary = registry.save()
	var second := PatterEngine.new(_bundle(), {"registry": registry})
	_check("refuses a token another engine holds, naming it",
		second.init_error().contains("scope '@patter' is already registered by Patter"), second.init_error())
	_check("and the refused engine is inert", second.open_flow("f", "s") == null, "")
	_check("and the registry is as it was", _eq(registry.save(), before) and registry.has("patter"), JSON.stringify(registry.save()))

	var with_world := PatterScopeRegistry.new()
	with_world.define_owned("world", [], {"owner": "Game"})
	var bound := PatterEngine.new(_bundle(), {"registry": with_world, "host_scopes": {"world": {"get": func(_n): return 0}}})
	_check("refuses a host scope the game already registered, naming the game",
		bound.init_error().contains("scope '@world' is already registered by Game"), bound.init_error())
	_check("and the half-built engine took nothing with it", not with_world.has("patter"), "")

	var fine := PatterEngine.new(_bundle(), {})
	_check("an engine that registered cleanly has no init_error", fine.init_error() == "", fine.init_error())


# -- keys, closing, reopening, reset -------------------------------------------------

func _keys_and_lifetime() -> void:
	var g := _game()
	g["patter"].open_flow("npc/bob", "s")
	g["patter"].open_flow("npc%2Fbob", "s")
	var keys: Array = g["registry"].save().keys().filter(func(k): return str(k).begins_with("patter/flow/"))
	keys.sort()
	_check("escapes a flow id in its keys, so no two flows' keys can meet", keys == [
		"patter/flow/npc%252Fbob/patter", "patter/flow/npc%252Fbob/scene/s",
		"patter/flow/npc%2Fbob/patter", "patter/flow/npc%2Fbob/scene/s",
	], str(keys))

	var h := _game()
	var reg = h["registry"]
	_play_out(h["patter"].open_flow("f", "s"))
	h["patter"].close_flow("f")
	var left: Array = reg.save().keys().filter(func(k): return str(k).begins_with("patter/flow/f/"))
	_check("removes a flow's bags when it closes", left.is_empty(), str(left))
	# Values a load left waiting for "f" belong to the saved flow, not to a new one of the same name.
	var blob: Dictionary = reg.save()
	blob["patter/flow/f/scene/s"] = {"count": 9}
	reg.load(blob)
	var fresh = h["patter"].open_flow("f", "s")
	_check("reopening a name starts it fresh, not on values a load left for it",
		_eq(fresh.get_property("@scene.count"), 0), str(fresh.get_property("@scene.count")))

	var k := _game()
	var kreg = k["registry"]
	var loaded: Dictionary = kreg.save()
	loaded["patter/scene/elsewhere"] = {"tally": 3}
	loaded["other/deck/inn"] = {"drawn": 1}
	kreg.load(loaded)
	k["patter"].reset()
	var saved: Dictionary = kreg.save()
	_check("reset drops Patter's waiting values", not saved.has("patter/scene/elsewhere"), JSON.stringify(saved))
	_check("and no other engine's", _eq(saved.get("other/deck/inn"), {"drawn": 1}), JSON.stringify(saved))


# -- hot_swap ----------------------------------------------------------------------

func _hot_swap() -> void:
	var g := _game()
	var registry = g["registry"]
	var flow = g["patter"].open_flow("f", "s")
	_play_out(flow)
	var next = g["patter"].hot_swap(_bundle())
	_check("hot_swap: the old engine is spent", flow.is_closed(), "")
	_check("hot_swap hands the shared global over", _eq(next.get_property("@fame"), 1), str(next.get_property("@fame")))
	_check("hot_swap hands a flow's own global over", next.get_flow("f") != null and _eq(next.get_flow("f").get_property("@mood"), 2), "")
	_check("hot_swap hands a shared scene bag over", next.get_flow("f") != null and _eq(next.get_flow("f").get_property("@scene.tally"), 1), "")
	var patter_rows: Array = registry.list_properties().filter(func(r): return r["scope"] == "patter")
	_check("hot_swap leaves one `patter` in the registry", patter_rows.size() == 1, str(patter_rows))
	_check("hot_swap: still the game's registry to save", not next.save_game().has("registry"), "")

	var alone := PatterEngine.new(_bundle(), {"seed": 1})
	_play_out(alone.open_flow("f", "s"))
	var swapped = alone.hot_swap(_bundle())
	_check("a standalone engine's hot_swap keeps its self-backed @world", _eq(swapped.get_property("@world.gold"), 5),
		str(swapped.get_property("@world.gold")))
	var ssave: Dictionary = swapped.save_game()
	_check("and keeps saving it", ssave.has("registry") and _eq(ssave["registry"].get("world"), {"gold": 5}), JSON.stringify(ssave.get("registry")))


# -- the combined game: one registry, one save ------------------------------------------
#
# Shape of a real combined game: a storylet engine (draw and play) and a Patter engine (spoken
# scenes) side by side, sharing world state. The game owns the registry and hands it to each engine.
#   - The game registers `@world` itself, as a property the registry stores.
#   - Patter registers `@patter` and its per-flow and per-scene bags.
#   - Every expression reads every scope: Patter gates on `@story.act`.
# One save: {registry, patter}. The registry's values are saved once, for every engine; Patter's part
# holds only what is not a property. Loading works in either order, and across content drift.

const STORY_WORLD_DECLS := [
	{"name": "gold", "type": "number"},
	{"name": "reputation", "type": "number"},
]


## The storylet side, as far as this test needs it: an engine that registers its own scope. Its
## names are case-significant, so it passes identity normalisation. Returns the refusal, or "".
static func _story_stand_in(registry) -> String:
	return registry.define_owned("story", [{"name": "act", "type": "number", "default": 1}],
		{"normalise": func(n: String) -> String: return n, "owner": "Storylet Engine"})


static func _shop_bundle() -> Dictionary:
	var gate := ["bin", "and",
		["bin", ">=", ["sv", "world", "gold"], ["n", 10]],
		["bin", ">=", ["sv", "story", "act"], ["n", 2]]]
	return {
		"schema": "patter/bundle@0",
		"locales": {"default": "en", "included": ["en"]},
		"strings": {"en": {"L": "A fine blade."}},
		"cast": [{"name": "MERCHANT"}],
		"properties": [{"name": "visits", "type": "number", "shared": true, "default": 0}],
		# The storylet's published spec: the scopes Patter may read, which Patter compiled against.
		"scopeRegistry": {"version": 1, "scopes": [
			{"token": "world", "declarations": STORY_WORLD_DECLS},
			{"token": "story", "declarations": [{"name": "act", "type": "number"}]},
		]},
		"scenes": {"shop": {"id": "shop", "gameId": "shop", "name": "Shop", "blocks": [{"id": "b", "gameId": "b", "name": "B", "children": [
			{"id": "buy", "type": "snippet", "condition": {"src": "@world.gold >= 10 && @story.act >= 2", "ast": gate},
				"onExit": [
					_eff("@world.gold", ["bin", "-", ["sv", "world", "gold"], ["n", 10]]),
					_eff("@visits", _plus("patter", "visits", 1)),
				],
				"beats": [{"id": "L", "kind": "line", "character": "MERCHANT"}],
				"jump": {"to": "END"}},
		]}]}},
	}


## The game: one registry, `@world` registered by the game, then each engine.
static func _combined() -> Dictionary:
	var registry := PatterScopeRegistry.new()
	registry.define_owned("world", STORY_WORLD_DECLS, {"owner": "Game"})
	_story_stand_in(registry)
	return {"registry": registry, "patter": PatterEngine.new(_shop_bundle(), {"registry": registry})}


static func _save_all(g: Dictionary) -> Dictionary:
	return JSON.parse_string(JSON.stringify({"registry": g["registry"].save(), "patter": g["patter"].save_game()}))


func _combined_game() -> void:
	# Both sides read and write one registry live, and each reads the other's scope.
	var g := _combined()
	var registry = g["registry"]
	registry.set_value("world", "gold", 25, {"host": true})   # the game stocks the world
	registry.set_value("story", "act", 2)                    # the storylet side moves the story on
	var flow = g["patter"].open_flow("main", "shop")
	_check("combined: Patter reads the storylet side's scope", _eq(g["patter"].get_property("@story.act"), 2), "")
	var step: Dictionary = flow.advance()
	_check("combined: the gate on both sides' state opens", step.get("type") == "line" and step.get("id") == "L"
		and step.get("character") == "MERCHANT", str(step))
	_check("combined: then ends", flow.advance().get("type") == "end", "")
	_check("combined: Patter's write reaches the game's @world", _eq(registry.get_value("world", "gold"), 15), "")
	_check("combined: and its own global", _eq(registry.get_value("patter", "visits"), 1), "")

	# Saves the registry once, with every engine's properties, and Patter's save holds none.
	var s := _combined()
	s["registry"].set_value("world", "gold", 25, {"host": true})
	s["registry"].set_value("world", "reputation", 3, {"host": true})
	s["registry"].set_value("story", "act", 2)
	var f = s["patter"].open_flow("main", "shop")
	f.advance()
	f.advance()
	var save := _save_all(s)
	_check("combined: one save holds the game's @world", _eq(save["registry"]["world"], {"gold": 15, "reputation": 3}), JSON.stringify(save["registry"]))
	_check("combined: and the storylet side's scope", _eq(save["registry"]["story"], {"act": 2}), "")
	_check("combined: and Patter's", _eq(save["registry"]["patter"], {"visits": 1}), "")
	_check("combined: Patter's save carries no registry", not save["patter"].has("registry"), "")
	_check("combined: nor any property value", not JSON.stringify(save["patter"]).contains("reputation"), "")

	# Resumes both sides from the one save, loading the registry first or last.
	var g1 := _combined()
	g1["registry"].set_value("world", "gold", 25, {"host": true})
	g1["registry"].set_value("story", "act", 2)
	var f1 = g1["patter"].open_flow("main", "shop")
	f1.advance()
	f1.advance()
	g1["patter"].open_flow("main", "shop")   # a fresh run at the gate, saved mid-flow
	var one := _save_all(g1)
	for registry_first in [true, false]:
		var label := "combined, registry %s" % ("first" if registry_first else "last")
		var g2 := _combined()
		if registry_first:
			g2["registry"].load(one["registry"])
		g2["patter"].load_game(one["patter"])
		if not registry_first:
			g2["registry"].load(one["registry"])
		_check(label + ": @world", _eq(g2["patter"].get_property("@world.gold"), 15), str(g2["patter"].get_property("@world.gold")))
		_check(label + ": @story", _eq(g2["patter"].get_property("@story.act"), 2), "")
		_check(label + ": @patter", _eq(g2["patter"].get_property("@visits"), 1), "")
		# gold 15 >= 10 and act 2: a second purchase proceeds on the restored state.
		var f2 = g2["patter"].get_flow("main")
		_check(label + ": the flow plays on", f2 != null and f2.advance().get("id") == "L", "")
		if f2 != null:
			f2.advance()
		_check(label + ": and writes to the one registry", _eq(g2["registry"].get_value("world", "gold"), 5)
			and _eq(g2["registry"].get_value("patter", "visits"), 2), JSON.stringify(g2["registry"].save()))

	# Loads a save forward across content drift (lenient by design): a world property that no longer
	# exists, none of the newer `reputation`, and a section for an engine this build no longer runs.
	var stale := {"world": {"gold": 7, "retired_flag": 1}, "patter": {"visits": 9}, "story": {"act": 3}, "retired_engine": {"x": 1}}
	var d := _combined()
	d["registry"].load(stale)
	_check("drift: a known property is restored", _eq(d["registry"].get_value("world", "gold"), 7), "")
	_check("drift: a newer one keeps its default", _eq(d["registry"].get_value("world", "reputation"), 0), "")
	_check("drift: a vanished one is kept as a stray", _eq(d["registry"].get_value("world", "retired_flag"), 1), "")
	_check("drift: Patter reads its restored global", _eq(d["patter"].get_property("@visits"), 9), "")
	_check("drift: a section nobody claims is kept", _eq(d["registry"].save().get("retired_engine"), {"x": 1}), "")
	d["registry"].discard_parked()
	_check("drift: until the game discards it", not d["registry"].save().has("retired_engine"), "")

	# A clash between engines fails as the game combines them, naming who holds the token.
	var clash := PatterScopeRegistry.new()
	_story_stand_in(clash)
	var refused := _story_stand_in(clash)
	_check("combined: a clash names who holds the token", refused.contains("scope '@story' is already registered by Storylet Engine"), refused)


# -- helpers ---------------------------------------------------------------------

func _check(what: String, ok: bool, detail: String) -> void:
	if ok:
		print("  ok   " + what)
	else:
		_fails += 1
		print("  FAIL " + what + "  <- " + detail)


## Structural equality, a produced float equal to an expected JSON int.
static func _eq(a, b) -> bool:
	var num := func(v): return typeof(v) == TYPE_INT or typeof(v) == TYPE_FLOAT
	if num.call(a) and num.call(b):
		return float(a) == float(b)
	if typeof(a) != typeof(b):
		return false
	if a is Dictionary:
		if a.size() != b.size():
			return false
		for k in a:
			if not b.has(k) or not _eq(a[k], b[k]):
				return false
		return true
	if a is Array:
		if a.size() != b.size():
			return false
		for i in a.size():
			if not _eq(a[i], b[i]):
				return false
		return true
	return a == b
