# Scalar value helpers: a thin shim over the SHARED implementation.
#
# The helpers live once in expr/ports/godot/values.gd, vendored beside this as
# expr/values.gd. This file only gives them a Patterplay identity, because Godot
# registers class_name project-wide and the shared source must not claim one.
class_name PatterValues
extends "expr/values.gd"
