# Inline {@ref} interpolation (spec §16) - port of @patterkit/dialect's tokenise + interpolate.
# A `{ ... }` whose trimmed body starts with `@` is a slot; `{{` / `}}` unescape to literal braces;
# a malformed slot is kept verbatim. `resolve` is a Callable(ref: String) -> value-or-null.
class_name PatterInterp


static func expand(text: String, resolve: Callable) -> String:
	if text == "":
		return text
	if text.find("{") == -1: # fast path: no slot opener -> nothing to interpolate (the common case)
		return text
	var out := ""
	var buf := ""
	var i := 0
	var n := text.length()
	while i < n:
		var c := text[i]
		if c == "{" and i + 1 < n and text[i + 1] == "{":
			buf += "{"
			i += 2
			continue
		if c == "}" and i + 1 < n and text[i + 1] == "}":
			buf += "}"
			i += 2
			continue
		if c == "{":
			var close := text.find("}", i + 1)
			if close != -1:
				var raw := text.substr(i, close - i + 1)
				var inner := text.substr(i + 1, close - (i + 1)).strip_edges()
				if inner.begins_with("@"):
					out += buf
					buf = ""
					if _is_bare_ref(inner):
						var v = resolve.call(inner)
						out += PatterValues.render_slot(v) if v != null else ""
					else:
						out += raw  # malformed slot -> verbatim
					i = close + 1
					continue
				buf += raw  # not a slot -> literal braces
				i = close + 1
				continue
		buf += c
		i += 1
	out += buf
	return out


# Closed-caption stripping (#214): mirror of @patterkit/dialect's stripCaptions. With captions off,
# remove every open..close cue span (delimiters included) and collapse the surrounding whitespace; a
# string with NO cue is returned unchanged. open/close may be the same token; an unclosed open keeps the
# remainder verbatim. Byte-identical to every other runtime.
static func strip_captions(text: String, open: String, close: String) -> String:
	if open == "" or text.find(open) == -1:
		return text
	var out := ""
	var i := 0
	var n := text.length()
	var removed := false
	while i < n:
		if text.substr(i, open.length()) == open:
			var end := text.find(close, i + open.length())
			if end != -1:
				i = end + close.length()
				removed = true
				continue
			out += text.substr(i)  # unclosed cue -> keep the rest literally
			break
		out += text[i]
		i += 1
	return _collapse_caption_ws(out) if removed else text


# ASCII whitespace collapsed to a single space + trimmed, manually (no regex) so the result matches the
# JS / C# / C++ runtimes byte-for-byte.
static func _is_caption_ws(c: String) -> bool:
	if c.length() == 0:
		return false
	var u := c.unicode_at(0)
	return u == 32 or u == 9 or u == 10 or u == 11 or u == 12 or u == 13


static func _collapse_caption_ws(s: String) -> String:
	var out := ""
	var pending_space := false
	for k in range(s.length()):
		var c := s[k]
		if _is_caption_ws(c):
			pending_space = true
			continue
		if pending_space and out.length() > 0:
			out += " "
		pending_space = false
		out += c
	return out


static func _is_bare_ref(inner: String) -> bool:
	if inner.length() < 2 or inner[0] != "@":
		return false
	for k in range(1, inner.length()):
		var c := inner[k]
		var ok := (c >= "A" and c <= "Z") or (c >= "a" and c <= "z") or (c >= "0" and c <= "9") or c == "_" or c == "."
		if not ok:
			return false
	return true
