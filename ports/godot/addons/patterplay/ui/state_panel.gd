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
var _value_widgets: Array = []   # of { "widget":, "type":, "engine":, "ref": }


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
			parts.append(row["ref"])
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
	for child in _body.get_children():
		child.queue_free()

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
		_body.add_child(HSeparator.new())


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
	label.text = row["ref"]
	label.custom_minimum_size = Vector2(140, 0)
	line.add_child(label)

	var widget := _make_widget(e, row)
	widget.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	line.add_child(widget)
	_value_widgets.append({"widget": widget, "type": row["type"], "engine": e, "ref": row["ref"]})

	var reset := Button.new()
	reset.text = "↺"
	reset.tooltip_text = "Reset to default"
	reset.pressed.connect(_reset.bind(e, row["ref"], row["default"]))
	line.add_child(reset)
	_body.add_child(line)


func _make_widget(e, row: Dictionary) -> Control:
	var ref: String = row["ref"]
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
		"enum":
			var ob := OptionButton.new()
			var opts: Array = row.get("values", [])
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

func _refresh_values() -> void:
	for entry in _value_widgets:
		var widget: Control = entry["widget"]
		if widget.has_focus():
			continue
		var value = entry["engine"].get_property(entry["ref"])
		match entry["type"]:
			"boolean":
				(widget as CheckBox).set_pressed_no_signal(bool(value))
			"number":
				(widget as SpinBox).set_value_no_signal(float(value) if value != null else 0.0)
			"string":
				(widget as LineEdit).text = str(value) if value != null else ""
			"enum":
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
	f.store_string(JSON.stringify(e.save_game(), "\t"))
	f.close()


func _do_load(path: String, e, dlg: FileDialog) -> void:
	dlg.queue_free()
	var text := FileAccess.get_file_as_string(path)
	if text == "":
		push_error("Patter: cannot read " + path)
		return
	var data = JSON.parse_string(text)
	if typeof(data) != TYPE_DICTIONARY:
		push_error("Patter: not a valid state file: " + path)
		return
	e.load_game(data)
	_rebuild()
