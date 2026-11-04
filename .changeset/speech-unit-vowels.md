---
"@patterkit/model": minor
"@patterkit/ops": patch
"@patterkit/conformance": minor
---

Each syllable says its vowel: `speechUnits` gives a `syllable` unit a `vowel` (`"a"`, `"e"`, `"i"`, `"o"`, `"u"`, or `"ə"` for a vowel the script shows that isn't one of the five) where the script says it, for a tool or game that moves a mouth to a shape at each syllable's peak. It's absent on pauses and shut beats, and for Han, digits, and scripts outside the set. Latin takes the first vowel of the syllable's vowel group, its accent dropped (rough for English, close for languages spelt as they're spoken); Cyrillic the vowel letter; kana its vowel row; Hangul the block's medial vowel; Arabic the written short vowel; Thai the vowel sign. Nothing else about the units changes, so no timing moves. New type `SpeechVowel`. The conformance corpus is version 16: speech cases carry each syllable's vowel, with new cases for the vowel rules.
