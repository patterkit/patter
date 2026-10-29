---
"@patterkit/model": minor
"@patterkit/ops": patch
---

How long a line with no recording lasts is Patter's own rule. The model gains `estimateLineDuration(text, locale?)`: the line's characters at 14 a second (`LINE_CHARS_PER_SECOND`), clamped to 1.5 to 18 seconds (`LINE_DURATION_MIN`, `LINE_DURATION_MAX`), a character outside the Basic Multilingual Plane counted once and soft hyphens (U+00AD) not counted. The locale is reserved for per-language reading rates and changes nothing yet. The playable HTML page times its lines by it, through the runtime it inlines, and ops no longer depends on `@wildwinter/game-subtitles`. A page's line timing is unchanged.
