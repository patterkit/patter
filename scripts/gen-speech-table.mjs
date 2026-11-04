#!/usr/bin/env node
// Generates the speech table every runtime counts syllables by (speechUnits, countSyllables, estimateLineDuration):
// each code point's class, as sorted, merged ranges, written identically for JS, Unity, Godot, and Unreal. GDScript
// has no Unicode script property or normalisation, and Unreal's ICU differs from JS, so the four runtimes read one
// generated table instead of their platforms' own Unicode data.
//
// The scripts are the curated game set (Latin, Cyrillic, Han, kana, Hangul, Arabic, Thai). Any other letter is
// OTHER_LETTER (about one syllable per three letters), so a script left out degrades rather than breaks. To add a
// script, give it a class here, teach every runtime's counter the class, and regenerate.
//
// The Unicode data is the running Node's own (property escapes and NFD), recorded in each file's header. Run it from
// the patter root with `node scripts/gen-speech-table.mjs`; the committed tables only change when someone does.

import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The classes, in table order. Every runtime names them the same way (its own idiom for the case).
const CLASSES = [
  "NONE",            // spaces aside, anything that sounds like nothing: symbols, emoji, punctuation not listed
  "LATIN_VOWEL",     // a, e, i, o, u, y and their accented forms, æ, ø, œ, ı
  "LATIN_LETTER",    // any other Latin letter
  "CYRILLIC_VOWEL",  // а е ё и о у ы э ю я і ї є and their accented forms (й isn't one)
  "CYRILLIC_LETTER", // any other Cyrillic letter
  "HAN",             // a Han character: one syllable (about two in Japanese text)
  "KANA",            // a kana: one mora
  "KANA_SMALL",      // a small kana (ゃ ゅ ょ ぁ ...), which merges with the one before
  "KANA_SOKUON",     // っ ッ: a beat with the mouth shut
  "KANA_LONG",       // ー: holds the one before for another beat
  "HANGUL",          // a Hangul syllable block
  "ARABIC_LETTER",   // an Arabic-script letter
  "ARABIC_VOWEL",    // a written short vowel: fatha, damma, kasra, the tanwin, superscript alef
  "THAI_CONSONANT",  // ก to ฮ
  "THAI_LEAD",       // a vowel written before its consonant: เ แ โ ใ ไ
  "THAI_VOWEL",      // any other Thai vowel sign
  "MARK",            // a combining mark, tone mark, or tatweel: part of the word, never a syllable
  "OTHER_LETTER",    // a letter, mark, or digit of any other script
  "DIGIT",           // a decimal digit: ASCII, fullwidth, Arabic-Indic, or Thai
  "PAUSE_SHORT",     // , ; : and their CJK and Arabic forms, a dash
  "PAUSE_LONG",      // . ! ? … and their CJK, Arabic, and Indic forms
  "JOINER",          // an apostrophe or soft hyphen, which joins a word (don't, l'eau) rather than breaking it
  "SPACE",           // white space (only Thai reads it: a space between Thai words is a short pause)
];
const C = Object.fromEntries(CLASSES.map((name, i) => [name, i]));

const has = (re) => (s) => re.test(s);
const isLetter = has(/^\p{L}$/u);
const isMark = has(/^\p{M}$/u);
const isDigit = has(/^\p{Nd}$/u);
const isSpace = has(/^\p{White_Space}$/u);
const script = (name) => has(new RegExp(`^\\p{Script=${name}}$`, "u"));
const latin = script("Latin"), cyrillic = script("Cyrillic"), han = script("Han"), hiragana = script("Hiragana"),
  katakana = script("Katakana"), hangul = script("Hangul"), arabic = script("Arabic"), thai = script("Thai");
const inherited = script("Inherited");
// The digits the set's languages write: ASCII, fullwidth, Arabic-Indic (both), and Thai. Another script's digits count
// with its letters.
const GAME_DIGITS = (cp) => (cp >= 0x30 && cp <= 0x39) || (cp >= 0xFF10 && cp <= 0xFF19) || (cp >= 0x0660 && cp <= 0x0669)
  || (cp >= 0x06F0 && cp <= 0x06F9) || (cp >= 0x0E50 && cp <= 0x0E59);
const base = (s) => s.normalize("NFD")[0];

const cps = (s) => [...s].map((c) => c.codePointAt(0));
const LATIN_VOWELS = new Set(cps("aeiouyAEIOUYæÆøØœŒıİ"));
const CYRILLIC_VOWELS = new Set(cps("аеёиоуыэюяіїєАЕЁИОУЫЭЮЯІЇЄ"));
const CYRILLIC_NOT_VOWELS = new Set(cps("йЙ"));
const KANA_SMALL = new Set([...cps("ぁぃぅぇぉゃゅょゎゕゖァィゥェォャュョヮｧｨｩｪｫｬｭｮ"), ...range(0x31F0, 0x31FF)]);
const KANA_SOKUON = new Set(cps("っッｯ"));
const KANA_LONG = new Set(cps("ーｰ"));
const ARABIC_VOWELS = new Set([0x064B, 0x064C, 0x064D, 0x064E, 0x064F, 0x0650, 0x0670]);
const ARABIC_MARKS = new Set([0x0640]);
const KANA_MARKS = new Set([0x309B, 0x309C, 0xFF9E, 0xFF9F]);
const THAI_LEAD = new Set(range(0x0E40, 0x0E44));
const THAI_VOWEL = new Set([...range(0x0E30, 0x0E39), 0x0E47, 0x0E4D]);
const THAI_MARK = new Set([0x0E2F, 0x0E3A, 0x0E45, 0x0E46, 0x0E48, 0x0E49, 0x0E4A, 0x0E4B, 0x0E4C, 0x0E4E]);
const PAUSE_SHORT = new Set(cps(",;:，；：、､﹐﹑،؛—–"));
const PAUSE_LONG = new Set(cps(".!?。！？．｡؟…।॥۔‽⁇⁈⁉"));
// The apostrophes, and the invisible joiners: a soft hyphen (where a word may break) and the zero-width joiner and
// non-joiner, which sit inside a word without breaking it.
const JOINERS = new Set([...cps("'’ʼ"), 0x00AD, 0x200C, 0x200D]);

function range(from, to) { const out = []; for (let c = from; c <= to; c++) out.push(c); return out; }

function classOf(cp) {
  if (cp >= 0xD800 && cp <= 0xDFFF) return C.NONE;
  const s = String.fromCodePoint(cp);
  if (PAUSE_SHORT.has(cp)) return C.PAUSE_SHORT;
  if (PAUSE_LONG.has(cp)) return C.PAUSE_LONG;
  if (JOINERS.has(cp)) return C.JOINER;
  if (KANA_LONG.has(cp)) return C.KANA_LONG;
  // Unicode puts these in no one script (Common or Inherited), so they're placed by hand: kana's voicing marks, and Arabic's
  // tatweel, which stretches a word and says nothing.
  if (KANA_MARKS.has(cp) || ARABIC_MARKS.has(cp)) return C.MARK;
  if (ARABIC_VOWELS.has(cp)) return C.ARABIC_VOWEL; // Unicode puts the harakat in Inherited, shared with other scripts
  if (isSpace(s)) return C.SPACE;
  if (isDigit(s)) return GAME_DIGITS(cp) ? C.DIGIT : C.OTHER_LETTER;
  if (thai(s)) {
    if (THAI_LEAD.has(cp)) return C.THAI_LEAD;
    if (THAI_VOWEL.has(cp)) return C.THAI_VOWEL;
    if (THAI_MARK.has(cp)) return C.MARK;
    if (cp >= 0x0E01 && cp <= 0x0E2E) return C.THAI_CONSONANT;
    return C.NONE; // Thai punctuation (๏ ๚ ๛)
  }
  if (isMark(s)) {
    if (arabic(s)) return C.MARK;
    // A mark of a script outside the set counts with that script's letters, which keeps the table small (an
    // Indic script alternates letters and vowel signs); the shared combining marks, kana's, and Hangul's are marks.
    return inherited(s) || hiragana(s) || katakana(s) || hangul(s) || han(s) || latin(s) || cyrillic(s) ? C.MARK : C.OTHER_LETTER;
  }
  if (hiragana(s) || katakana(s)) {
    if (KANA_SMALL.has(cp)) return C.KANA_SMALL;
    if (KANA_SOKUON.has(cp)) return C.KANA_SOKUON;
    return isLetter(s) ? C.KANA : C.NONE;
  }
  if (!isLetter(s)) return C.NONE;
  if (latin(s)) return LATIN_VOWELS.has(cp) || LATIN_VOWELS.has(base(s).codePointAt(0)) ? C.LATIN_VOWEL : C.LATIN_LETTER;
  if (cyrillic(s)) {
    if (CYRILLIC_NOT_VOWELS.has(cp)) return C.CYRILLIC_LETTER;
    return CYRILLIC_VOWELS.has(cp) || CYRILLIC_VOWELS.has(base(s).codePointAt(0)) ? C.CYRILLIC_VOWEL : C.CYRILLIC_LETTER;
  }
  if (han(s)) return C.HAN;
  if (hangul(s)) return cp >= 0xAC00 && cp <= 0xD7A3 ? C.HANGUL : C.OTHER_LETTER;
  if (arabic(s)) return C.ARABIC_LETTER;
  return C.OTHER_LETTER;
}

// Each code point's vowel, for a syllable's mouth shape (speechUnits' `vowel`): a code, 1 to 6 for a e i o u ə, plus
// WEAK (8) when another vowel in the same syllable says more (a kana before a small kana, きゃ; y before a vowel,
// "yes"; a Thai leading vowel or ะ before a fuller sign). A syllable's vowel is its first strong one, else its first
// weak one, else none. Hangul is worked out from the block (its medial vowel), not listed.
const VOWELS = ["a", "e", "i", "o", "u", "ə"];
const WEAK = 8;
const V = Object.fromEntries(VOWELS.map((v, i) => [v, i + 1]));
const LATIN_VOWEL_OF = { a: V.a, e: V.e, i: V.i, "ı": V.i, o: V.o, u: V.u, y: V.i | WEAK, "æ": V.e, "œ": V.e, "ø": V.o };
const CYRILLIC_VOWEL_OF = { "а": V.a, "я": V.a, "е": V.e, "э": V.e, "є": V.e, "ё": V.o, "и": V.i, "ы": V.i, "і": V.i, "ї": V.i, "о": V.o, "у": V.u, "ю": V.u };
// The kana's vowel rows, in hiragana (katakana and halfwidth forms are mapped to these). ん has none.
const KANA_ROWS = {
  a: "あぁかがさざただなはばぱまやゃらわゎゕ", i: "いぃきぎしじちぢにひびぴみりゐ", u: "うぅくぐすずつづぬふぶぷむゆゅるゔ",
  e: "えぇけげせぜてでねへべぺめれゑゖ", o: "おぉこごそぞとどのほぼぽもよょろを",
};
const KANA_VOWEL_OF = Object.fromEntries(Object.entries(KANA_ROWS).flatMap(([v, row]) => [...row].map((ch) => [ch, V[v]])));
// The katakana with no hiragana twin: ヷ ヸ ヹ ヺ (va vi ve vo), and the small ones for Ainu (ㇰ to ㇿ).
const KATAKANA_EXTRA = { 0x30F7: V.a, 0x30F8: V.i, 0x30F9: V.e, 0x30FA: V.o, 0x31F0: V.u, 0x31F1: V.i, 0x31F2: V.u, 0x31F3: V.o,
  0x31F4: V.u, 0x31F5: V.a, 0x31F6: V.i, 0x31F7: V.u, 0x31F8: V.e, 0x31F9: V.o, 0x31FA: V.u, 0x31FB: V.a, 0x31FC: V.i,
  0x31FD: V.u, 0x31FE: V.e, 0x31FF: V.o };
const ARABIC_VOWEL_OF = { 0x064B: V.a, 0x064C: V.u, 0x064D: V.i, 0x064E: V.a, 0x064F: V.u, 0x0650: V.i, 0x0670: V.a };
// Thai: a leading vowel, ะ, ั and ำ are weak, so a fuller sign in the same syllable (เ-ีย, เ-า) says the vowel. ึ ื
// (an unrounded u) are i, the mouth's nearest; ็ and ํ say none.
const THAI_VOWEL_OF = { 0x0E40: V.e | WEAK, 0x0E41: V.e | WEAK, 0x0E42: V.o | WEAK, 0x0E43: V.a | WEAK, 0x0E44: V.a | WEAK,
  0x0E30: V.a | WEAK, 0x0E31: V.a | WEAK, 0x0E32: V.a, 0x0E33: V.a | WEAK, 0x0E34: V.i, 0x0E35: V.i, 0x0E36: V.i,
  0x0E37: V.i, 0x0E38: V.u, 0x0E39: V.u };
// Hangul's 21 medial vowels, in jamo order (ㅏ ㅐ ㅑ ... ㅣ): ㅓ ㅕ ㅝ (an open, unrounded o) are ə, ㅡ ㅢ i.
const HANGUL_VOWELS = [V.a, V.e, V.a, V.e, V["ə"], V.e, V["ə"], V.e, V.o, V.a, V.e, V.e, V.o, V.u, V["ə"], V.e, V.i, V.u,
  V.i, V.i, V.i];

function vowelOf(cp, k) {
  const s = String.fromCodePoint(cp);
  const lower = s.toLowerCase();
  if (k === C.LATIN_VOWEL) return LATIN_VOWEL_OF[lower] ?? LATIN_VOWEL_OF[base(lower)] ?? 0;
  if (k === C.CYRILLIC_VOWEL) return CYRILLIC_VOWEL_OF[lower] ?? CYRILLIC_VOWEL_OF[base(lower)] ?? 0;
  if (k === C.KANA || k === C.KANA_SMALL) {
    if (KATAKANA_EXTRA[cp]) return KATAKANA_EXTRA[cp] | (k === C.KANA ? WEAK : 0);
    let h = s.normalize("NFKC");
    h = [...h].map((ch) => { const c = ch.codePointAt(0); return c >= 0x30A1 && c <= 0x30F6 ? String.fromCodePoint(c - 0x60) : ch; }).join("");
    const v = KANA_VOWEL_OF[h[0]] ?? KANA_VOWEL_OF[base(h)] ?? 0;
    return v && k === C.KANA ? v | WEAK : v; // a kana is weak, so a small kana after it says the vowel
  }
  if (k === C.ARABIC_VOWEL) return ARABIC_VOWEL_OF[cp] ?? 0;
  if (k === C.THAI_LEAD || k === C.THAI_VOWEL) return THAI_VOWEL_OF[cp] ?? 0;
  return 0;
}

// Each code point's class. An unassigned code point never appears in text, so a run of them between two code points
// of one class takes that class, which merges their ranges and keeps the table small.
const unassigned = has(/^\p{Cn}$/u);
const classes = new Uint8Array(0x110000);
for (let cp = 0; cp <= 0x10FFFF; cp++) classes[cp] = classOf(cp);
for (let cp = 1; cp <= 0x10FFFF; cp++) {
  if (!(cp < 0xD800 || cp > 0xDFFF) || !unassigned(String.fromCodePoint(cp))) continue;
  let end = cp;
  while (end + 1 <= 0x10FFFF && (end + 1 < 0xD800 || end + 1 > 0xDFFF) && unassigned(String.fromCodePoint(end + 1))) end++;
  if (end + 1 <= 0x10FFFF && classes[cp - 1] === classes[end + 1]) classes.fill(classes[cp - 1], cp, end + 1);
  cp = end;
}

// Each code point's vowel code, by its class (worked out before the unassigned runs below take a class).
const vowelCodes = new Uint8Array(0x110000);
for (let cp = 0; cp <= 0x10FFFF; cp++) if (classes[cp] !== C.NONE) vowelCodes[cp] = vowelOf(cp, classes[cp]);
const vowelRanges = [];
for (let cp = 0; cp <= 0x10FFFF; cp++) {
  const v = vowelCodes[cp];
  if (v === 0) continue;
  const last = vowelRanges[vowelRanges.length - 1];
  if (last && last[1] === cp - 1 && last[2] === v) last[1] = cp;
  else vowelRanges.push([cp, cp, v]);
}

// Sorted, merged ranges of everything that isn't NONE: [start, end, class], end inclusive.
const ranges = [];
for (let cp = 0; cp <= 0x10FFFF; cp++) {
  const k = classes[cp];
  if (k === C.NONE) continue;
  const last = ranges[ranges.length - 1];
  if (last && last[1] === cp - 1 && last[2] === k) last[1] = cp;
  else ranges.push([cp, cp, k]);
}

const unicode = process.versions.unicode;
const header = (comment) => [
  `${comment} Generated by scripts/gen-speech-table.mjs from Unicode ${unicode} (Node ${process.versions.node}). Don't edit by hand:`,
  `${comment} change the generator and run it from the patter root. ${ranges.length} ranges of [start, end, class], end inclusive,`,
  `${comment} sorted by start; a code point in none of them is NONE. And ${vowelRanges.length} ranges of [start, end, vowel code]`,
  `${comment} likewise, a code point in none of them having no vowel. Every runtime carries these same tables.`,
].join("\n");
const rows = (indent, list = ranges, perLine = 6) => {
  const out = [];
  for (let i = 0; i < list.length; i += perLine) {
    out.push(indent + list.slice(i, i + perLine).map(([a, b, k]) => `0x${a.toString(16).toUpperCase()}, 0x${b.toString(16).toUpperCase()}, ${k},`).join(" "));
  }
  return out.join("\n");
};
const list = (items) => items.join(", ");
const quoted = (items) => items.map((v) => `"${v}"`).join(", ");
const camel = (name) => name.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const pascal = (name) => camel(name).replace(/^./, (c) => c.toUpperCase());

const files = {
  "packages/model/src/speech-table.ts": `${header("//")}

/** A code point's class in the speech table (speech.ts). */
export const SpeechClass = {
${CLASSES.map((name, i) => `  ${name}: ${i},`).join("\n")}
} as const;

/** The table's ranges, flat: start, end (inclusive), class, sorted by start. */
export const SPEECH_RANGES: readonly number[] = [
${rows("  ")}
];

/** The vowels a vowel code names, 1 to ${VOWELS.length} (0 is none). */
export const SPEECH_VOWELS = ["", ${quoted(VOWELS)}] as const;
/** Added to a vowel code when another vowel in the same syllable says more. */
export const SPEECH_VOWEL_WEAK = ${WEAK};
/** The vowel codes' ranges, flat: start, end (inclusive), code, sorted by start. */
export const SPEECH_VOWEL_RANGES: readonly number[] = [
${rows("  ", vowelRanges)}
];
/** Each Hangul syllable block's vowel code, by its medial vowel: ((block - 0xAC00) / 28) % 21. */
export const SPEECH_HANGUL_VOWELS: readonly number[] = [${list(HANGUL_VOWELS)}];
`,
  "ports/unity/Patterplay/Runtime/SpeechTable.cs": `${header("//")}

namespace Patterkit.Patterplay
{
    /// <summary>A code point's class in the speech table (Speech.cs).</summary>
    internal static class SpeechClass
    {
${CLASSES.map((name, i) => `        public const int ${pascal(name)} = ${i};`).join("\n")}
    }

    internal static class SpeechTable
    {
        /// <summary>The table's ranges, flat: start, end (inclusive), class, sorted by start.</summary>
        public static readonly int[] Ranges =
        {
${rows("            ")}
        };

        /// <summary>The vowels a vowel code names, 1 to ${VOWELS.length} (0 is none).</summary>
        public static readonly string[] Vowels = { "", ${quoted(VOWELS)} };

        /// <summary>Added to a vowel code when another vowel in the same syllable says more.</summary>
        public const int VowelWeak = ${WEAK};

        /// <summary>The vowel codes' ranges, flat: start, end (inclusive), code, sorted by start.</summary>
        public static readonly int[] VowelRanges =
        {
${rows("            ", vowelRanges)}
        };

        /// <summary>Each Hangul syllable block's vowel code, by its medial vowel: ((block - 0xAC00) / 28) % 21.</summary>
        public static readonly int[] HangulVowels = { ${list(HANGUL_VOWELS)} };
    }
}
`,
  "ports/godot/addons/patterplay/runtime/speech_table.gd": `${header("#")}
class_name PatterSpeechTable

${CLASSES.map((name, i) => `const ${name} := ${i}`).join("\n")}

## The table's ranges, flat: start, end (inclusive), class, sorted by start.
const RANGES: PackedInt32Array = [
${rows("\t")}
]

## The vowels a vowel code names, 1 to ${VOWELS.length} (0 is none).
const VOWELS: PackedStringArray = ["", ${quoted(VOWELS)}]
## Added to a vowel code when another vowel in the same syllable says more.
const VOWEL_WEAK := ${WEAK}
## The vowel codes' ranges, flat: start, end (inclusive), code, sorted by start.
const VOWEL_RANGES: PackedInt32Array = [
${rows("\t", vowelRanges)}
]
## Each Hangul syllable block's vowel code, by its medial vowel: ((block - 0xAC00) / 28) % 21.
const HANGUL_VOWELS: PackedInt32Array = [${list(HANGUL_VOWELS)}]
`,
  "ports/unreal/Patterplay/Source/PatterplayRuntime/Public/Patter/SpeechTable.h": `${header("//")}
#pragma once

#include <cstddef>
#include <cstdint>

namespace patter {
namespace speech_class {
${CLASSES.map((name, i) => `constexpr int ${pascal(name)} = ${i};`).join("\n")}
} // namespace speech_class

/** The table's ranges, flat: start, end (inclusive), class, sorted by start. */
inline constexpr std::int32_t kSpeechRanges[] = {
${rows("    ")}
};
inline constexpr std::size_t kSpeechRangeCount = sizeof(kSpeechRanges) / sizeof(kSpeechRanges[0]) / 3;

/** The vowels a vowel code names, 1 to ${VOWELS.length} (0 is none), as UTF-8. */
inline constexpr const char* kSpeechVowels[] = { "", ${quoted(VOWELS)} };
/** Added to a vowel code when another vowel in the same syllable says more. */
inline constexpr int kSpeechVowelWeak = ${WEAK};
/** The vowel codes' ranges, flat: start, end (inclusive), code, sorted by start. */
inline constexpr std::int32_t kSpeechVowelRanges[] = {
${rows("    ", vowelRanges)}
};
inline constexpr std::size_t kSpeechVowelRangeCount = sizeof(kSpeechVowelRanges) / sizeof(kSpeechVowelRanges[0]) / 3;
/** Each Hangul syllable block's vowel code, by its medial vowel: ((block - 0xAC00) / 28) % 21. */
inline constexpr int kSpeechHangulVowels[] = { ${list(HANGUL_VOWELS)} };
} // namespace patter
`,
};

for (const [path, text] of Object.entries(files)) writeFileSync(resolve(root, path), text);
console.log(`speech table: ${ranges.length} ranges and ${vowelRanges.length} vowel ranges from Unicode ${unicode}, written to ${Object.keys(files).length} runtimes`);
