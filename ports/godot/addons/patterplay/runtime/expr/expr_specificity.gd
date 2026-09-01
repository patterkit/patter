# GENERATED - vendored from expr/ports/godot/expr_specificity.gd by scripts/vendor-ports.mjs.
# Do not edit here; edit the shared source and re-run the script.
# ---------------------------------------------------------------------------
# @wildwinter/expr-specificity - for Godot. THE SHARED SOURCE.
#
# Authored in expr/ports/godot and VENDORED into each consuming addon by
# expr/scripts/vendor-ports.mjs. Do not edit a vendored copy.
#
# NO `class_name`: Godot registers those project-wide, so a shared file claiming
# one would collide the moment a game installed two addons that vendor it. Each
# family wraps this in its own thin class_name shim.
#
# This is a PURER shared thing than the evaluator: no value type, no dialect, no
# scopes. Just an AST walk plus a truthiness callback the host supplies, which
# is exactly why truthiness being host policy does not stop it being shared.
# ---------------------------------------------------------------------------

## Score `node` via `eval_truthy` (a Callable(node Array) -> bool that
## must never raise; an erroring condition counts as false). Root polarity
## defaults to true (production only scores conditions already known eligible).
static func matched_specificity(node: Array, eval_truthy: Callable, want: bool = true) -> int:
	var tag = node[0]
	if tag == "bin" and (node[1] == "and" or node[1] == "or"):
		var l := matched_specificity(node[2], eval_truthy, want)
		var r := matched_specificity(node[3], eval_truthy, want)
		# De Morgan: an `and` under negation behaves like an `or`, and vice versa.
		var behave_as_and: bool = (node[1] == "and") == want
		if behave_as_and:
			return l + r if (l > 0 and r > 0) else 0   # both must hold -> sum
		return maxi(l, r)                              # either holds -> strongest branch
	if tag == "u" and node[1] == "not":
		return matched_specificity(node[2], eval_truthy, not want)
	if tag == "call" and node[1] == "check_flags":
		# ["call","check_flags",source,fd...]: args[0] is the flags source, so
		# the operand count is size - 3.
		var operands: int = maxi(1, node.size() - 3)
		var holds: bool = eval_truthy.call(node)
		if want:
			return operands if holds else 0
		return 0 if holds else 1   # negated: at least one operand fails -> 1
	# Any other node is an atom worth one constraint when its truth matches want.
	return 1 if eval_truthy.call(node) == want else 0
