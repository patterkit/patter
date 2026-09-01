# PatterStatePanel - an in-game debug overlay that watches AND edits a live engine's @patter
# properties during play, and saves / loads the whole run to a JSON file. The Godot-idiomatic
# counterpart of the Unity "Window > Patterplay > Runtime State" inspector: because a Godot game
# runs in its own process (not inside the editor like Unity Play mode), the live inspector has to
# live in the running game, not an editor dock.
#
# Usage - drop it into your scene and point it at engines:
#   var panel := preload("res://addons/patterplay/ui/state_panel.gd").new()
#   add_child(panel)
#   PatterDebug.register(engine)          # the panel auto-discovers registered engines
# or assign panel.engine = my_engine directly for a single engine.
#
# A live property inspector: live viewing + live modifying + Save/Load JSON.
class_name PatterStatePanel
extends PanelContainer

## Optional single engine to inspect. If null, the panel shows every PatterDebug-registered engine.
var engine = null

const REFRESH_SECONDS := 0.25

var _body: VBoxContainer
var _signature := ""
var _value_widgets: Array = []   # of { "widget":, "type":, "engine":, "path": }

## The decision log's per-kind filters. The vocabulary is this engine's: `select` is a
## group choosing among its children, `chose` is the player answering a choice, `dry` is a
## choice that fell through with nothing takeable.
const LOG_KINDS := ["select", "choice", "chose", "dry", "jump", "write"]
const LOG_KIND_LABELS := ["Select", "Choice", "Chose", "Dry", "Jump", "Write"]
var _log_kind_on: Dictionary = {}
var _log_autoscroll := true
var _log_boxes: Array = []       # of { "engine":, "scroll":, "text": }


func _ready() -> void:
	# Debug-only tool: stay inert in a release export (OS.is_debug_build() is false there), so it is
	# safe to leave the panel wired into a scene that also ships. Hidden + no rows built.
	if not OS.is_debug_build():
		hide()
		return
	custom_minimum_size = Vector2(360, 280)
	var scroll := ScrollContainer.new()
	scroll.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	add_child(scroll)
	_body = VBoxContainer.new()
	_body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(_body)

	var timer := Timer.new()
	timer.wait_time = REFRESH_SECONDS
	timer.autostart = true
	timer.timeout.connect(_tick)
	add_child(timer)
	_rebuild()


func _engines() -> Array:
	if engine != null:
		return [engine]
	return PatterDebug.engines


# A cheap fingerprint of "which engines, with which property refs" - rebuild the rows only when it
# changes, so editing a field isn't interrupted by the refresh timer.
func _current_signature() -> String:
	var parts: Array = []
	for e in _engines():
		parts.append(str(e.get_instance_id()))
		for row in e.list_properties():
			parts.append(row["path"])
	return "|".join(parts)


func _tick() -> void:
	var sig := _current_signature()
	if sig != _signature:
		_rebuild()
	else:
		_refresh_values()


# -- build ---------------------------------------------------------------------

func _rebuild() -> void:
	_signature = _current_signature()
	_value_widgets.clear()
	_log_boxes.clear()
	for child in _body.get_children():
		child.queue_free()

	_build_link()

	var engines := _engines()
	if engines.is_empty():
		_body.add_child(_hint("No engines registered. Call PatterDebug.register(engine), or set panel.engine."))
		return

	var idx := 0
	for e in engines:
		var header := Label.new()
		header.text = "Engine #%d" % idx
		header.add_theme_font_size_override("font_size", 16)
		_body.add_child(header)
		idx += 1
		_build_save_load(e)
		_build_properties(e)
		_build_log(e)
		_body.add_child(HSeparator.new())


## The Live Link's state, so the panel answers the question a link's user asks first: from inside a
## running game "the editor is not listening" and "I never attached" look identical, and only the game
## knows which (from-storylets/weak-debug-registries).
func _build_link() -> void:
	var links: Array = PatterDebug.links
	if links.is_empty():
		_body.add_child(_hint("Live Link: not attached (PatterDebug.register_link(link))"))
		return
	for l in links:
		var s: Dictionary = l.status()
		_body.add_child(_hint("Live Link: %s - %s - build %s" % [s["state"], s["url"], s["build"]]))


func _hint(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	return l


func _build_save_load(e) -> void:
	var row := HBoxContainer.new()
	var save_btn := Button.new()
	save_btn.text = "Save State…"
	save_btn.pressed.connect(_pick_save.bind(e))
	row.add_child(save_btn)
	var load_btn := Button.new()
	load_btn.text = "Load State…"
	load_btn.pressed.connect(_pick_load.bind(e))
	row.add_child(load_btn)
	_body.add_child(row)


func _build_properties(e) -> void:
	var caption := Label.new()
	caption.text = "@patter properties"
	_body.add_child(caption)
	var rows: Array = e.list_properties()
	if rows.is_empty():
		_body.add_child(_hint("  (none)"))
		return
	for row in rows:
		_build_property_row(e, row)


func _build_property_row(e, row: Dictionary) -> void:
	var line := HBoxContainer.new()
	var label := Label.new()
	label.text = row["path"]
	label.custom_minimum_size = Vector2(140, 0)
	line.add_child(label)

	var widget := _make_widget(e, row)
	widget.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	line.add_child(widget)
	_value_widgets.append({"widget": widget, "type": row["type"], "engine": e, "path": row["path"]})

	var reset := Button.new()
	reset.text = "↺"
	reset.tooltip_text = "Reset to default"
	reset.pressed.connect(_reset.bind(e, row["path"], row["default"]))
	line.add_child(reset)
	_body.add_child(line)


func _make_widget(e, row: Dictionary) -> Control:
	var ref: String = row["path"]
	match row["type"]:
		"boolean":
			var cb := CheckBox.new()
			cb.button_pressed = bool(row["value"])
			cb.toggled.connect(_on_bool.bind(e, ref))
			return cb
		"number":
			var sb := SpinBox.new()
			sb.min_value = -1000000000
			sb.max_value = 1000000000
			sb.step = 0.0001
			sb.allow_greater = true
			sb.allow_lesser = true
			sb.value = float(row["value"]) if row["value"] != null else 0.0
			sb.value_changed.connect(_on_number.bind(e, ref))
			return sb
		"string":
			var le := LineEdit.new()
			le.text = str(row["value"]) if row["value"] != null else ""
			le.text_submitted.connect(_on_string.bind(e, ref))
			return le
		"enum", "quality":
			# A quality edits as a dropdown of its STAGE LADDER - closed, like an enum's values.
			var ob := OptionButton.new()
			var opts: Array = row.get("stages", []) if row.get("type", "") == "quality" else row.get("values", [])
			for o in opts:
				ob.add_item(str(o))
			var cur := opts.find(row["value"]) if row["value"] != null else -1
			ob.selected = cur if cur >= 0 else 0
			ob.item_selected.connect(_on_enum.bind(e, ref, opts))
			return ob
		"flags":
			var fe := LineEdit.new()
			fe.placeholder_text = "comma, separated, flags"
			fe.text = _join_flags(row["value"])
			fe.text_submitted.connect(_on_flags.bind(e, ref))
			return fe
	var ro := Label.new()
	ro.text = str(row["value"])
	return ro


# -- live value refresh (skip whatever the user is editing) --------------------

## The run's decisions: what the engine CHOSE, not what it produced. A step says which line
## played; this says why THAT line and not its siblings. Mirrors the Storylet Engine's log
## panel - per-kind filters, autoscroll, copy, clear - with this engine's vocabulary.
func _build_log(e) -> void:
	var caption := Label.new()
	caption.text = "Log (decisions)"
	_body.add_child(caption)

	if not e.has_method("log"):
		_body.add_child(_hint("  (this engine build has no log)"))
		return
	if (e.log() as Array).is_empty():
		_body.add_child(_hint("  (empty - create the engine with {\"log\": true} to record decisions)"))

	var kinds_row := HBoxContainer.new()
	for i in LOG_KINDS.size():
		var kind: String = LOG_KINDS[i]
		if not _log_kind_on.has(kind):
			_log_kind_on[kind] = true
		var cb := CheckBox.new()
		cb.text = LOG_KIND_LABELS[i]
		cb.button_pressed = _log_kind_on[kind]
		cb.toggled.connect(_on_log_kind.bind(kind))
		kinds_row.add_child(cb)
	_body.add_child(kinds_row)

	var tools_row := HBoxContainer.new()
	var auto_cb := CheckBox.new()
	auto_cb.text = "Autoscroll"
	auto_cb.tooltip_text = "Scroll to the latest entry on every refresh."
	auto_cb.button_pressed = _log_autoscroll
	auto_cb.toggled.connect(func(on: bool) -> void: _log_autoscroll = on)
	tools_row.add_child(auto_cb)
	var copy_btn := Button.new()
	copy_btn.text = "Copy"
	copy_btn.tooltip_text = "Copy the visible (filtered) log to the clipboard."
	copy_btn.pressed.connect(_copy_log.bind(e))
	tools_row.add_child(copy_btn)
	var clear_btn := Button.new()
	clear_btn.text = "Clear"
	clear_btn.tooltip_text = "Drop the retained entries. Cosmetic - no game state changes."
	clear_btn.pressed.connect(_clear_log.bind(e))
	tools_row.add_child(clear_btn)
	_body.add_child(tools_row)

	var scroll := ScrollContainer.new()
	scroll.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.custom_minimum_size = Vector2(0, 150)
	var text := Label.new()
	text.autowrap_mode = TextServer.AUTOWRAP_OFF
	text.text = "\n".join(_visible_log_lines(e))
	scroll.add_child(text)
	_body.add_child(scroll)
	_log_boxes.append({"engine": e, "scroll": scroll, "text": text})


func _on_log_kind(on: bool, kind: String) -> void:
	_log_kind_on[kind] = on
	_refresh_log()


func _clear_log(e) -> void:
	e.clear_log()
	_refresh_log()


func _copy_log(e) -> void:
	DisplayServer.clipboard_set("\n".join(_visible_log_lines(e)))


func _visible_log_lines(e) -> Array:
	var lines: Array = []
	for entry in e.log():
		if _log_kind_on.get(str(entry["type"]), true):
			lines.append(_format_log_entry(entry))
	return lines


## Redraw the log text in place, without rebuilding the panel: a filter toggle should not
## interrupt a field somebody is editing.
func _refresh_log() -> void:
	for box in _log_boxes:
		var label: Label = box["text"]
		label.text = "\n".join(_visible_log_lines(box["engine"]))
		if _log_autoscroll:
			var scroll: ScrollContainer = box["scroll"]
			scroll.set_deferred("scroll_vertical", int(1 << 30))


static func _show_log_value(v) -> String:
	return "<unset>" if v == null else PatterValues.show(v)


## One line per entry. A `select` names the children it walked and their verdicts, because
## that is the whole point: "why is my line missing" is unanswerable from the winner alone.
static func _format_log_entry(e: Dictionary) -> String:
	var stamp := "[%d] " % int(e.get("seq", 0))
	# The run's log names the flow; a flow's own would only repeat its heading.
	if e.has("flow"):
		stamp += "%s " % str(e["flow"])
	match str(e["type"]):
		"select":
			var parts: Array = []
			for c in e.get("children", []):
				parts.append("%s%s" % [c["id"], "" if c["eligible"] else " (x)"])
			return "%sselect %s [%s]: %s -> %s" % [stamp, e.get("group", ""), e.get("selector", ""),
				", ".join(parts), str(e.get("picked", "(nothing)"))]
		"choice":
			var opts: Array = []
			for o in e.get("options", []):
				opts.append("%s%s" % [o["id"], "" if o["eligible"] else " (greyed)"])
			return "%schoice %s: %s" % [stamp, e.get("group", ""), ", ".join(opts)]
		"chose":
			return "%schose %s -> %s" % [stamp, e.get("group", ""), e.get("option", "")]
		"dry":
			return "%sdry %s (nothing takeable, no eligible fallback)" % [stamp, e.get("group", "")]
		"jump":
			return "%sjump %s (%s)" % [stamp, e.get("to", ""), e.get("mode", "")]
		"write":
			return "%swrite %s: %s -> %s" % [stamp, e.get("target", ""),
				_show_log_value(e.get("prev")), _show_log_value(e.get("value"))]
	return "%s(unknown)" % stamp


func _refresh_values() -> void:
	for entry in _value_widgets:
		var widget: Control = entry["widget"]
		if widget.has_focus():
			continue
		var value = entry["engine"].get_property(entry["path"])
		match entry["type"]:
			"boolean":
				(widget as CheckBox).set_pressed_no_signal(bool(value))
			"number":
				(widget as SpinBox).set_value_no_signal(float(value) if value != null else 0.0)
			"string":
				(widget as LineEdit).text = str(value) if value != null else ""
			"enum", "quality":
				var ob := widget as OptionButton
				var i := ob.get_item_index(ob.get_selected_id())
				if value != null and ob.get_item_text(max(i, 0)) != str(value):
					for k in ob.item_count:
						if ob.get_item_text(k) == str(value):
							ob.select(k)
							break
			"flags":
				(widget as LineEdit).text = _join_flags(value)


func _join_flags(value) -> String:
	if value is Array:
		var parts: Array = []
		for v in value:
			parts.append(str(v))
		return ", ".join(parts)
	return ""


# -- edit handlers -------------------------------------------------------------

func _on_bool(pressed: bool, e, ref: String) -> void:
	e.set_property(ref, pressed)


func _on_number(value: float, e, ref: String) -> void:
	e.set_property(ref, value)


func _on_string(text: String, e, ref: String) -> void:
	e.set_property(ref, text)


func _on_enum(index: int, e, ref: String, opts: Array) -> void:
	if index >= 0 and index < opts.size():
		e.set_property(ref, str(opts[index]))


func _on_flags(text: String, e, ref: String) -> void:
	var out: Array = []
	for piece in text.split(",", false):
		var trimmed := piece.strip_edges()
		if trimmed != "":
			out.append(trimmed)
	e.set_property(ref, out)


func _reset(e, ref: String, default_value) -> void:
	e.set_property(ref, default_value)
	_refresh_values()


# -- save / load ---------------------------------------------------------------

func _pick_save(e) -> void:
	var dlg := FileDialog.new()
	dlg.access = FileDialog.ACCESS_FILESYSTEM
	dlg.file_mode = FileDialog.FILE_MODE_SAVE_FILE
	dlg.add_filter("*.patterstate", "Patter state")
	dlg.current_file = "save.patterstate"
	dlg.file_selected.connect(_do_save.bind(e, dlg))
	dlg.canceled.connect(dlg.queue_free)
	add_child(dlg)
	dlg.popup_centered_ratio(0.6)


func _pick_load(e) -> void:
	var dlg := FileDialog.new()
	dlg.access = FileDialog.ACCESS_FILESYSTEM
	dlg.file_mode = FileDialog.FILE_MODE_OPEN_FILE
	dlg.add_filter("*.patterstate", "Patter state")
	dlg.file_selected.connect(_do_load.bind(e, dlg))
	dlg.canceled.connect(dlg.queue_free)
	add_child(dlg)
	dlg.popup_centered_ratio(0.6)


func _do_save(path: String, e, dlg: FileDialog) -> void:
	dlg.queue_free()
	var f := FileAccess.open(path, FileAccess.WRITE)
	if f == null:
		push_error("Patter: cannot write " + path)
		return
	f.store_string(PatterSave.serialize_state(e, "\t")) # the tagged patter/save@0 envelope
	f.close()


func _do_load(path: String, e, dlg: FileDialog) -> void:
	dlg.queue_free()
	var text := FileAccess.get_file_as_string(path)
	if text == "":
		push_error("Patter: cannot read " + path)
		return
	# PatterSave accepts the patter/save@0 envelope AND the bare snapshots this panel
	# used to write, so old .patterstate files keep loading; a foreign blob is refused.
	if not PatterSave.deserialize_state(e, text):
		push_error("Patter: not a valid state file: " + path)
		return
	_rebuild()
