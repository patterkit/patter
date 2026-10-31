// Speech units (design/proposals/syllable-counter.md): a line broken into the syllables it would be spoken in, the
// beats with the mouth shut, and the pauses at its punctuation, each with a weight. `estimateLineDuration` times a
// line with no recording by their total weight; a game or Patterstage lays the same units over a line's real or
// estimated length to move a mouth, so the timing and the mouth can't disagree.
//
// Counted from text alone, per script, by one generated table (speech-table.ts) that every runtime carries:
// - Latin: groups of vowels per word, at least one; in English and French a lone final e is silent ("lamps are lit",
//   "une lampe"), except English's consonant + le ("table").
// - Cyrillic: one per vowel letter, at least one a word.
// - Han: one per character, two in Japanese text (a kanji's reading can't be known without a dictionary).
// - Kana: one per mora. A small kana merges with the one before, っ is a beat with the mouth shut, ー holds the one
//   before for another beat.
// - Hangul: one per syllable block.
// - Arabic: one per written short vowel, or with none written, one per two letters, at least one a word.
// - Thai: one per vowel (a vowel written before its consonant takes the vowel signs that follow within two
//   consonants), plus one per two consonants with no vowel between them; a space between Thai words is a short pause.
// - Any other script: one per three letters a word, at least one.
// - A digit weighs 1.5. Emoji, symbols, markup (`<b>`, `&amp;`), and white space weigh nothing.
// - Pauses: short (`,` `;` `:` `、` `،` a dash) weigh 1, long (`.` `!` `?` `。` `؟` `…` `।`) 2. Punctuation in a row is
//   one pause, the stronger; a pause before the first syllable or after the last is dropped (the line's padAfter
//   is the pause after it), as is a `.` or `,` between digits (3.5, 1,000).
//
// Offsets are code points, so every runtime agrees whatever its string encoding.

import { SPEECH_RANGES, SpeechClass as K } from "./speech-table.js";

/** What a speech unit is: a syllable (the mouth opens), a beat with the mouth shut (っ), or a pause. */
export type SpeechUnitKind = "syllable" | "closed" | "pause";

/** One unit of a line as it would be spoken. `start` and `end` are code-point offsets into the text, end exclusive. */
export interface SpeechUnit {
  kind: SpeechUnitKind;
  weight: number;
  start: number;
  end: number;
}

/** A digit's weight: most read as one or two syllables. */
export const SPEECH_DIGIT_WEIGHT = 1.5;
/** A Han character's weight in Japanese text. */
export const SPEECH_KANJI_WEIGHT = 2;
/** A short pause's weight (`,` `;` `、`), and a long one's (`.` `?` `。`). */
export const SPEECH_PAUSE_SHORT_WEIGHT = 1;
export const SPEECH_PAUSE_LONG_WEIGHT = 2;

/** An array's entry, or -1 past its end (every array here holds numbers that are never negative). */
const at = (a: readonly number[], j: number): number => a[j] ?? -1;

/** A code point's class, by binary search of the table. */
function classOf(cp: number): number {
  let lo = 0, hi = SPEECH_RANGES.length / 3 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cp < at(SPEECH_RANGES, mid * 3)) hi = mid - 1;
    else if (cp > at(SPEECH_RANGES, mid * 3 + 1)) lo = mid + 1;
    else return at(SPEECH_RANGES, mid * 3 + 2);
  }
  return K.NONE;
}

/** A locale's language, lower case: `en-GB`, `en_gb`, and `EN` are all `en`. */
function languageOf(locale: string | undefined): string {
  return ((locale ?? "").split(/[-_]/)[0] ?? "").toLowerCase();
}

const isAsciiLetter = (cp: number): boolean => (cp >= 0x41 && cp <= 0x5A) || (cp >= 0x61 && cp <= 0x7A);
const isAsciiDigit = (cp: number): boolean => cp >= 0x30 && cp <= 0x39;

/** Where markup starting at `i` ends (exclusive): a formatting tag (`<b>`, `</bi>`) or an entity (`&amp;`, `&#38;`).
 *  `i` itself when there's none. */
function markupEnd(cps: number[], i: number): number {
  const cp = (j: number): number => at(cps, j);
  if (cp(i) === 0x3C) { // <
    let j = i + 1;
    if (cp(j) === 0x2F) j++; // /
    const from = j;
    while (isAsciiLetter(cp(j))) j++;
    return j > from && cp(j) === 0x3E ? j + 1 : i; // >
  }
  if (cp(i) === 0x26) { // &
    let j = i + 1;
    const numeric = cp(j) === 0x23; // &#38;
    if (numeric) j++;
    const from = j;
    while (numeric ? isAsciiDigit(cp(j)) : isAsciiLetter(cp(j))) j++;
    return j > from && cp(j) === 0x3B ? j + 1 : i; // ;
  }
  return i;
}

/** The classes each kind of word is made of (a mark or a joining apostrophe continues any of them). */
const LATIN = new Set<number>([K.LATIN_VOWEL, K.LATIN_LETTER]);
const CYRILLIC = new Set<number>([K.CYRILLIC_VOWEL, K.CYRILLIC_LETTER]);
const ARABIC = new Set<number>([K.ARABIC_LETTER, K.ARABIC_VOWEL]);
const THAI = new Set<number>([K.THAI_CONSONANT, K.THAI_LEAD, K.THAI_VOWEL]);
const OTHER = new Set<number>([K.OTHER_LETTER]);
const KANA_CLASSES = new Set<number>([K.KANA, K.KANA_SMALL, K.KANA_SOKUON, K.KANA_LONG]);

/**
 * A line broken into the units it would be spoken in: its syllables, its beats with the mouth shut, and its pauses,
 * in order, each with a weight. `locale` is the language the line is spoken in (the project's main language, not the
 * one being shown); it decides English's and French's silent e, and Japanese kanji, which also apply when the line
 * has any kana in it.
 */
export function speechUnits(text: string, locale?: string): SpeechUnit[] {
  const cps = Array.from(text ?? "", (ch) => ch.codePointAt(0) as number);
  const cls = cps.map(classOf);
  const n = cps.length;
  const lang = languageOf(locale);
  const japanese = lang === "ja" || cls.some((k) => KANA_CLASSES.has(k));
  const units: SpeechUnit[] = [];
  const syllable = (start: number, end: number, weight = 1): void => { units.push({ kind: "syllable", weight, start, end }); };
  const classAt = (j: number): number => (j >= 0 && j < n ? at(cls, j) : K.NONE);
  // A character's own unit runs on over the marks after it.
  const marksEnd = (j: number): number => { while (j < n && at(cls, j) === K.MARK) j++; return j; };
  // Where a word of these classes starting at `i` ends: marks continue it, and an apostrophe between two of its
  // letters joins it.
  const wordEnd = (i: number, family: Set<number>): number => {
    let j = i + 1;
    while (j < n && (family.has(at(cls, j)) || at(cls, j) === K.MARK || (at(cls, j) === K.JOINER && family.has(classAt(j + 1))))) j++;
    return j;
  };
  // Units for a word from [start, end) and the positions that close each syllable, in order: each unit runs from
  // just after the one before to its own position, the first from the word's start and the last to its end.
  // A syllable's last letter takes the marks after it (é written as e and a mark).
  const fromAnchors = (start: number, end: number, anchors: number[]): void => {
    const sorted = [...new Set(anchors.map((a) => Math.min(marksEnd(a + 1), end) - 1))].sort((a, b) => a - b);
    sorted.forEach((a, j) => syllable(j === 0 ? start : at(sorted, j - 1) + 1, j === sorted.length - 1 ? end : a + 1));
  };
  // Positions that pick `count` syllables out of a list of letters, every `step` letters (the last at the last letter).
  const spread = (letters: number[], count: number, step: number): number[] =>
    Array.from({ length: count }, (_, j) => at(letters, Math.min(step * j + step - 1, letters.length - 1)));

  let i = 0;
  while (i < n) {
    const k = at(cls, i);
    const skip = markupEnd(cps, i);
    if (skip > i) { i = skip; continue; }
    if (LATIN.has(k)) {
      const end = wordEnd(i, LATIN);
      // Each vowel group's last vowel, and how many vowels it has (a mark inside a group continues it).
      const lasts: number[] = [], sizes: number[] = [];
      let inGroup = false;
      for (let j = i; j < end; j++) {
        if (at(cls, j) === K.LATIN_VOWEL) {
          if (inGroup) { lasts[lasts.length - 1] = j; sizes[sizes.length - 1] = at(sizes, sizes.length - 1) + 1; }
          else { lasts.push(j); sizes.push(1); }
          inGroup = true;
        } else if (at(cls, j) !== K.MARK) inGroup = false;
      }
      if (lasts.length >= 2 && at(sizes, sizes.length - 1) === 1 && silentE(cps, cls, i, end, at(lasts, lasts.length - 1), lang)) lasts.pop();
      fromAnchors(i, end, lasts.length ? lasts : [end - 1]);
      i = end;
    } else if (CYRILLIC.has(k)) {
      const end = wordEnd(i, CYRILLIC);
      const vowels: number[] = [];
      for (let j = i; j < end; j++) if (at(cls, j) === K.CYRILLIC_VOWEL) vowels.push(j);
      fromAnchors(i, end, vowels.length ? vowels : [end - 1]);
      i = end;
    } else if (ARABIC.has(k)) {
      const end = wordEnd(i, ARABIC);
      const vowels: number[] = [], letters: number[] = [];
      for (let j = i; j < end; j++) {
        if (at(cls, j) === K.ARABIC_VOWEL) vowels.push(j);
        else if (at(cls, j) === K.ARABIC_LETTER) letters.push(j);
      }
      fromAnchors(i, end, vowels.length ? vowels : spread(letters, Math.max(1, Math.ceil(letters.length / 2)), 2));
      i = end;
    } else if (THAI.has(k)) {
      const end = wordEnd(i, THAI);
      fromAnchors(i, end, thaiAnchors(cls, i, end));
      i = end;
    } else if (OTHER.has(k)) {
      const end = wordEnd(i, OTHER);
      const letters: number[] = [];
      for (let j = i; j < end; j++) if (at(cls, j) === K.OTHER_LETTER) letters.push(j);
      fromAnchors(i, end, spread(letters, Math.max(1, Math.ceil(letters.length / 3)), 3));
      i = end;
    } else if (k === K.HAN) {
      const end = marksEnd(i + 1);
      syllable(i, end, japanese ? SPEECH_KANJI_WEIGHT : 1);
      i = end;
    } else if (k === K.KANA || k === K.HANGUL) {
      const end = marksEnd(i + 1);
      syllable(i, end);
      i = end;
    } else if (k === K.KANA_SMALL || k === K.KANA_LONG) {
      // A small kana merges with the kana before it; ー holds it for another beat. With none before, a small kana
      // is a mora of its own and ー says nothing.
      const end = marksEnd(i + 1);
      const last = units[units.length - 1];
      if (last && last.kind === "syllable" && last.end === i) { last.end = end; if (k === K.KANA_LONG) last.weight += 1; }
      else if (k === K.KANA_SMALL) syllable(i, end);
      i = end;
    } else if (k === K.KANA_SOKUON) {
      const end = marksEnd(i + 1);
      units.push({ kind: "closed", weight: 1, start: i, end });
      i = end;
    } else if (k === K.DIGIT) {
      const end = marksEnd(i + 1);
      syllable(i, end, SPEECH_DIGIT_WEIGHT);
      i = end;
    } else if (k === K.PAUSE_SHORT || k === K.PAUSE_LONG) {
      // A full stop or comma between digits is part of the number (3.5, 1,000).
      const inNumber = (at(cps, i) === 0x2E || at(cps, i) === 0x2C) && classAt(i - 1) === K.DIGIT && classAt(i + 1) === K.DIGIT;
      if (!inNumber) units.push({ kind: "pause", weight: k === K.PAUSE_LONG ? SPEECH_PAUSE_LONG_WEIGHT : SPEECH_PAUSE_SHORT_WEIGHT, start: i, end: i + 1 });
      i++;
    } else if (k === K.SPACE) {
      // Thai separates its phrases with a space, so a space between Thai words is a short pause.
      let end = i + 1;
      while (end < n && at(cls, end) === K.SPACE) end++;
      if (thaiBefore(cls, i - 1) && THAI.has(classAt(end))) units.push({ kind: "pause", weight: SPEECH_PAUSE_SHORT_WEIGHT, start: i, end });
      i = end;
    } else {
      i++; // nothing: a symbol, an emoji, a stray mark or apostrophe
    }
  }
  return tidyPauses(units);
}

/** Whether the letter before the marks ending at `j` is Thai. */
function thaiBefore(cls: number[], j: number): boolean {
  while (j >= 0 && at(cls, j) === K.MARK) j--;
  return j >= 0 && THAI.has(at(cls, j));
}

/** Whether a Latin word's last vowel group, a single vowel at `e`, is a silent final e: in English, and in French
 *  (where `-es` is silent too), a lone e ending the word, unless English's consonant + le ("table", "little"). */
function silentE(cps: number[], cls: number[], start: number, end: number, e: number, lang: string): boolean {
  if (lang !== "en" && lang !== "fr") return false;
  if (at(cps, e) !== 0x65 && at(cps, e) !== 0x45) return false; // e, E
  let after = e + 1;
  if (after < end && at(cls, after) === K.MARK) return false; // an accented e, written as e and a mark (é)
  if (lang === "fr" && after < end && (at(cps, after) === 0x73 || at(cps, after) === 0x53)) after++; // -es
  if (after !== end) return false;
  if (lang === "en" && e - 2 >= start && (at(cps, e - 1) === 0x6C || at(cps, e - 1) === 0x4C) && at(cls, e - 2) === K.LATIN_LETTER) return false;
  return true;
}

/** The positions closing each syllable of a Thai word from [start, end). A vowel counts, unless it follows a vowel
 *  written before its consonant (เ แ โ ใ ไ) within two consonants, when they're one vowel (เรียน). A run of
 *  consonants with no vowel between holds one syllable per two of them, beyond the one consonant a syllable starts
 *  or ends with (ถนน, ขอบคุณ). */
function thaiAnchors(cls: number[], start: number, end: number): number[] {
  const anchors: number[] = [];
  let consonants: number[] = []; // since the last vowel
  let leadOpen = false;          // a leading vowel waiting for the vowel signs it takes
  const implicit = (): void => {
    for (let j = 0; j < Math.floor((consonants.length - 1) / 2); j++) anchors.push(at(consonants, 2 * j + 1));
  };
  for (let p = start; p < end; p++) {
    const k = at(cls, p);
    if (k === K.THAI_CONSONANT) consonants.push(p);
    else if (k === K.THAI_LEAD) {
      implicit();
      anchors.push(p + 1 < end && at(cls, p + 1) === K.THAI_CONSONANT ? p + 1 : p);
      consonants = [];
      leadOpen = true;
    } else if (k === K.THAI_VOWEL) {
      if (consonants.length === 0) continue;
      if (leadOpen && consonants.length <= 2) { leadOpen = false; consonants = []; continue; }
      implicit();
      anchors.push(p);
      consonants = [];
      leadOpen = false;
    }
  }
  if (anchors.length === 0) {
    const count = Math.max(1, Math.ceil(consonants.length / 2));
    for (let j = 0; j < count; j++) anchors.push(consonants.length ? at(consonants, Math.min(2 * j + 1, consonants.length - 1)) : end - 1);
  } else implicit();
  return anchors;
}

/** Punctuation in a row is one pause, the stronger; a pause before the first syllable or after the last goes. */
function tidyPauses(units: SpeechUnit[]): SpeechUnit[] {
  const out: SpeechUnit[] = [];
  for (const u of units) {
    const last = out[out.length - 1];
    if (u.kind === "pause" && last?.kind === "pause") { last.weight = Math.max(last.weight, u.weight); last.end = u.end; }
    else out.push({ ...u });
  }
  while (out[0]?.kind === "pause") out.shift();
  while (out[out.length - 1]?.kind === "pause") out.pop();
  return out;
}

/** How many syllables a line would be spoken in: its syllables' and shut beats' weights, pauses aside. `locale` is
 *  the language it's spoken in, as for `speechUnits`. */
export function countSyllables(text: string, locale?: string): number {
  let total = 0;
  for (const u of speechUnits(text, locale)) if (u.kind !== "pause") total += u.weight;
  return total;
}
