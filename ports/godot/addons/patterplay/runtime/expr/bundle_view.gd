# GENERATED - vendored from expr/ports/godot/bundle_view.gd by scripts/vendor-ports.mjs.
# Do not edit here; edit the shared source and re-run the script.
# ---------------------------------------------------------------------------
# The bundle Inspector view, for Godot. THE SHARED SOURCE (the frame only).
#
# Authored in expr/ports/godot and VENDORED into each consuming addon by
# expr/scripts/vendor-ports.mjs. Do not edit a vendored copy.
#
# What is shared is the FRAME: build the widgets, hold the selection, clear and
# redraw, and the two states that are not about content at all - nothing
# selected, and a bundle that failed to load. Those were character-identical in
# both addons, INCLUDING the text a person reads.
#
# What is NOT shared is `_render`, which is the whole point of the view: one
# family shows boxes, decks, cards, hands and tag groups, the other shows
# locales, strings and characters. Subclasses override it and nothing else.
#
# The frame is worth sharing because this exact pair has already drifted. The
# Unreal equivalents of these two files diverged on precisely the error state:
# Patterplay learned to distinguish "failed to load" from "never parsed" and
# say so either way, and the Storylet Engine did not, so an unparsed bundle
# showed a blank Inspector there rather than a fault. Same two files, same
# state, one improved and one left behind.
#
# NO `class_name`: Godot registers those project-wide. Each addon subclasses
# this and gives it one.
# ---------------------------------------------------------------------------
@tool
extends VBoxContainer

var _selected: Resource
var _summary: RichTextLabel
var _sections: VBoxContainer


func _ready() -> void:
	if _summary != null:
		return
	_summary = RichTextLabel.new()
	_summary.bbcode_enabled = true
	_summary.fit_content = true
	add_child(_summary)
	_sections = VBoxContainer.new()
	add_child(_sections)
	_refresh()


## The Inspector hands the view its selection; it may arrive before _ready.
func set_bundle_resource(res: Resource) -> void:
	_selected = res
	if _summary != null:
		_refresh()


## Draw a valid bundle. Subclasses MUST override: `res` is the addon's own
## bundle Resource, and what is worth showing about it is the family's business.
func _render(_res: Resource) -> void:
	push_error("bundle_view: _render was not overridden")


func _refresh() -> void:
	if _sections == null:
		return   # not in the tree yet; _ready() renders the stashed selection
	for c in _sections.get_children():
		c.queue_free()
	if _selected == null:
		_summary.text = "[i]No bundle selected.[/i]"
		return
	# A bundle that did not load says so, and says why. This is the state the
	# Unreal pair drifted on, so it lives in one place here.
	if not _selected.is_valid():
		var lines: Array[String] = []
		for e in _selected.get_errors():
			lines.append("- " + str(e))
		_summary.text = ("[b][color=red]Bundle failed to load[/color][/b]\n\n"
			+ "\n".join(lines))
		return
	_render(_selected)


## A section heading in the detail list.
func _add_section(title: String) -> void:
	var label := RichTextLabel.new()
	label.bbcode_enabled = true
	label.fit_content = true
	label.text = "[b]%s[/b]" % title.to_upper()
	label.modulate = Color(0.75, 0.75, 0.75)
	_sections.add_child(label)


## One row of detail; `muted` greys it, for "(none)" style lines.
func _add_row(text: String, muted: bool = false) -> void:
	var label := RichTextLabel.new()
	label.bbcode_enabled = true
	label.fit_content = true
	label.text = text
	if muted:
		label.modulate = Color(0.7, 0.7, 0.7)
	_sections.add_child(label)
