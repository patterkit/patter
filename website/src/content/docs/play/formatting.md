---
title: Formatting markup
description: "How a Patterplay runtime hands you bold/italic: a fixed, flat, closed tag vocabulary you map to your engine's rich text. No entity encoding; rendering is the host's job."
sidebar:
  label: Formatting markup
---

When a project enables **formatting**, a line's display text may carry a tiny, **closed** tag
vocabulary, and only this:

- `<b>…</b>`: bold
- `<i>…</i>`: italic
- `<bi>…</bi>`: bold + italic

The runtime treats the line as an **opaque string**: it interpolates `{@refs}` and strips closed-caption
cues, but it never parses or rewrites these tags, it hands them to you verbatim. **Rendering them is your
job**, because every engine's rich-text system differs (Unity TextMeshPro `<b>`, Godot BBCode `[b]`,
Unreal decorators, HTML `<b>`…). Map Patter's three tags to whatever your renderer wants.

Two deliberate rules make this safe and predictable:

- **No entity encoding.** Patter never emits `&amp;`, `&lt;`, or `&gt;`: a literal `&`, `<`, or `>` in
  the writer's text reaches you as exactly that character. If your renderer needs those escaped (an HTML
  view, for instance), **escape them yourself** at render time, the same way you would any user-facing
  string.
- **The vocabulary is fixed and flat** (no nesting, no attributes), so a small replace or a three-pattern
  regex is enough; a `<` only ever means a tag when it forms a complete `<b>…</b>` / `<i>…</i>` /
  `<bi>…</bi>` pair.

If formatting is **off** for the project, lines are plain text with no tags at all. See
[the writing surface](/patterpad/writing-surface/) for how a writer applies bold and italic.

Each runtime's bundled tour demo shows its engine's mapping in working code: HTML tags on the
web, IMGUI rich text in Unity, an `SRichTextBlock` style set in Unreal, BBCode in Godot - and
all four strip the tags where a widget (a choice button) renders plain text.
