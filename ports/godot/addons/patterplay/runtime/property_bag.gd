@tool   # editor-reachable, like the shared source it wraps
# PatterPropertyBag - this addon's NAME for the shared property bag.
#
# The implementation is expr/ports/godot/property_bag.gd, vendored beside this file as
# runtime/expr/property_bag.gd and shared with the Storylet Engine. It declares no
# `class_name`, because Godot registers those in a PROJECT-WIDE namespace and two addons
# vendoring one file cannot both claim the name. So identity lives here, in a shim, exactly
# as it does for the evaluator: a game can install this addon and Storylet Engine side by
# side, and each gets a bag under its own name over one implementation.
#
# Everything is inherited. `clone()` in the base constructs through get_script(), so a clone
# of one of these is a PatterPropertyBag rather than a bare bag.
class_name PatterPropertyBag
extends "res://addons/patterplay/runtime/expr/property_bag.gd"
