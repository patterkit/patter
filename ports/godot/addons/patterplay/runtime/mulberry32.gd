# mulberry32: a thin shim over the SHARED implementation.
#
# The algorithm lives once, in expr/ports/godot/mulberry32.gd, vendored beside
# this as expr/mulberry32.gd. This file only gives it a Patterplay identity,
# because Godot registers class_name project-wide and the shared source must not
# claim one.
#
# Named PatterMulberry32, not a bare Mulberry32: a generic global name collides
# with any other addon, or the game's own code, that wants it.
class_name PatterMulberry32
extends "expr/mulberry32.gd"
