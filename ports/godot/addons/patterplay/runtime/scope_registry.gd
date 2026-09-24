@tool   # editor-reachable, like the shared source it wraps
# PatterScopeRegistry - this addon's NAME for the shared scope registry.
#
# The implementation is expr/ports/godot/scope_registry.gd, vendored beside this file as
# runtime/expr/scope_registry.gd and shared with the Storylet Engine: one registry per game,
# holding every engine's property bags, and the eval context the shared evaluator consumes.
# It declares no `class_name`, because Godot registers those in a PROJECT-WIDE namespace and
# two addons vendoring one file cannot both claim the name. So identity lives here, in a
# shim, as it does for the property bag: a game can install this addon and the Storylet
# Engine side by side, and each gets a registry under its own name over one implementation.
#
# Everything is inherited but the one bag factory: an owned scope the registry builds
# (`define_owned`) is a PatterPropertyBag, so `owned_bag()` hands back this addon's type.
class_name PatterScopeRegistry
extends "res://addons/patterplay/runtime/expr/scope_registry.gd"


func _new_bag(declarations: Array, opts: Dictionary):
	return PatterPropertyBag.new(declarations, opts)
