# Matched-constraint specificity: a thin shim over the SHARED implementation.
#
# The scorer lives once, in expr/ports/godot/expr_specificity.gd, vendored
# beside this as expr/expr_specificity.gd. This file only gives it a Patterplay
# identity, because Godot registers class_name project-wide and the shared
# source must not claim one.
#
# Until 2026-09-01 this was `_matched_spec`, inline in flow.gd, and the Storylet
# Engine had its own module: one scorer, six hand transliterations of the same
# thirty lines. It is the PUREST thing in the family to share, because it takes
# truthiness as a callback and so never needed to know a value type, a dialect
# or a scope.
class_name PatterSpecificity

const Impl := preload("expr/expr_specificity.gd")

## Score `node` via `eval_truthy` (a Callable(node Array) -> bool that must
## never raise; an erroring condition counts as false). Root polarity defaults
## to true (production only scores conditions already known eligible).
static func matched_specificity(node: Array, eval_truthy: Callable, want: bool = true) -> int:
	return Impl.matched_specificity(node, eval_truthy, want)
