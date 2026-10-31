// Speech units (design/proposals/syllable-counter.md), a port of @patterkit/model's speech.ts, rule for rule: a line
// broken into the syllables it would be spoken in, the beats with the mouth shut, and the pauses at its punctuation,
// each with a weight. Bundle.EstimateLineDuration times a line with no recording by their total weight; a game lays
// the same units over a line's real or estimated length to move a mouth, so the timing and the mouth can't disagree.
//
// Counted from text alone, per script, by one generated table (SpeechTable.cs) that every runtime carries:
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
//   one pause, the stronger; a pause before the first syllable or after the last is dropped (the line's PadAfter
//   is the pause after it), as is a `.` or `,` between digits (3.5, 1,000).
//
// Offsets are code points, not UTF-16 chars: a surrogate pair counts once, so every runtime agrees.

using System.Collections.Generic;
using K = Patterkit.Patterplay.SpeechClass;
using Table = Patterkit.Patterplay.SpeechTable;

namespace Patterkit.Patterplay
{
    /// <summary>What a speech unit is: a syllable (the mouth opens), a beat with the mouth shut (っ), or a pause.</summary>
    public enum SpeechUnitKind { Syllable, Closed, Pause }

    /// <summary>One unit of a line as it would be spoken (<see cref="Bundle.SpeechUnits"/>). <see cref="Start"/> and
    /// <see cref="End"/> are code-point offsets into the text (a surrogate pair counts once), end exclusive.</summary>
    public sealed class SpeechUnit
    {
        public SpeechUnitKind Kind;
        public double Weight;
        public int Start;
        public int End;

        public SpeechUnit(SpeechUnitKind kind, double weight, int start, int end)
        {
            Kind = kind; Weight = weight; Start = start; End = end;
        }
    }

    /// <summary>The speech counter behind <see cref="Bundle.SpeechUnits"/>, <see cref="Bundle.CountSyllables"/>,
    /// and <see cref="Bundle.EstimateLineDuration"/>.</summary>
    internal static class Speech
    {
        /// <summary>An array's entry, or -1 past either end (every array here holds numbers that are never negative).</summary>
        private static int At(int[] a, int j) => j >= 0 && j < a.Length ? a[j] : -1;
        private static int At(List<int> a, int j) => j >= 0 && j < a.Count ? a[j] : -1;

        /// <summary>A code point's class, by binary search of the table.</summary>
        private static int ClassOf(int cp)
        {
            int[] r = Table.Ranges;
            int lo = 0, hi = r.Length / 3 - 1;
            while (lo <= hi)
            {
                int mid = (lo + hi) >> 1;
                if (cp < r[mid * 3]) hi = mid - 1;
                else if (cp > r[mid * 3 + 1]) lo = mid + 1;
                else return r[mid * 3 + 2];
            }
            return K.None;
        }

        /// <summary>A locale's language, lower case: `en-GB`, `en_gb`, and `EN` are all `en`.</summary>
        private static string LanguageOf(string locale)
            => (locale ?? "").Split('-', '_')[0].ToLowerInvariant();

        private static bool IsAsciiLetter(int cp) => (cp >= 0x41 && cp <= 0x5A) || (cp >= 0x61 && cp <= 0x7A);
        private static bool IsAsciiDigit(int cp) => cp >= 0x30 && cp <= 0x39;

        // The classes each kind of word is made of (a mark or a joining apostrophe continues any of them).
        private static bool IsLatin(int k) => k == K.LatinVowel || k == K.LatinLetter;
        private static bool IsCyrillic(int k) => k == K.CyrillicVowel || k == K.CyrillicLetter;
        private static bool IsArabic(int k) => k == K.ArabicLetter || k == K.ArabicVowel;
        private static bool IsThai(int k) => k == K.ThaiConsonant || k == K.ThaiLead || k == K.ThaiVowel;
        private static bool IsOther(int k) => k == K.OtherLetter;
        private static bool IsKana(int k) => k == K.Kana || k == K.KanaSmall || k == K.KanaSokuon || k == K.KanaLong;

        /// <summary>A string's code points: a surrogate pair is one, a lone surrogate stands for itself.</summary>
        private static int[] CodePoints(string text)
        {
            var cps = new List<int>(text.Length);
            for (int i = 0; i < text.Length; i++)
            {
                char c = text[i];
                if (char.IsHighSurrogate(c) && i + 1 < text.Length && char.IsLowSurrogate(text[i + 1]))
                {
                    cps.Add(char.ConvertToUtf32(c, text[i + 1]));
                    i++;
                }
                else cps.Add(c);
            }
            return cps.ToArray();
        }

        /// <summary>Where markup starting at `i` ends (exclusive): a formatting tag (`&lt;b&gt;`, `&lt;/bi&gt;`) or an
        /// entity (`&amp;amp;`, `&amp;#38;`). `i` itself when there's none.</summary>
        private static int MarkupEnd(int[] cps, int i)
        {
            if (At(cps, i) == 0x3C) // <
            {
                int j = i + 1;
                if (At(cps, j) == 0x2F) j++; // /
                int from = j;
                while (IsAsciiLetter(At(cps, j))) j++;
                return j > from && At(cps, j) == 0x3E ? j + 1 : i; // >
            }
            if (At(cps, i) == 0x26) // &
            {
                int j = i + 1;
                bool numeric = At(cps, j) == 0x23; // &#38;
                if (numeric) j++;
                int from = j;
                while (numeric ? IsAsciiDigit(At(cps, j)) : IsAsciiLetter(At(cps, j))) j++;
                return j > from && At(cps, j) == 0x3B ? j + 1 : i; // ;
            }
            return i;
        }

        /// <summary>A line broken into the units it would be spoken in (see <see cref="Bundle.SpeechUnits"/>).</summary>
        internal static List<SpeechUnit> Units(string text, string locale)
        {
            int[] cps = CodePoints(text ?? "");
            int n = cps.Length;
            var cls = new int[n];
            bool anyKana = false;
            for (int j = 0; j < n; j++) { cls[j] = ClassOf(cps[j]); if (IsKana(cls[j])) anyKana = true; }
            string lang = LanguageOf(locale);
            bool japanese = lang == "ja" || anyKana;
            var units = new List<SpeechUnit>();
            void Syllable(int start, int end, double weight = 1) => units.Add(new SpeechUnit(SpeechUnitKind.Syllable, weight, start, end));
            int ClassAt(int j) => j >= 0 && j < n ? cls[j] : K.None;
            // A character's own unit runs on over the marks after it.
            int MarksEnd(int j) { while (j < n && cls[j] == K.Mark) j++; return j; }
            // Where a word of these classes starting at `i` ends: marks continue it, and an apostrophe between two of
            // its letters joins it.
            int WordEnd(int i0, System.Func<int, bool> family)
            {
                int j = i0 + 1;
                while (j < n && (family(cls[j]) || cls[j] == K.Mark || (cls[j] == K.Joiner && family(ClassAt(j + 1))))) j++;
                return j;
            }
            // Units for a word from [start, end) and the positions that close each syllable, in order: each unit runs
            // from just after the one before to its own position, the first from the word's start and the last to its
            // end. A syllable's last letter takes the marks after it (é written as e and a mark).
            void FromAnchors(int start, int end, List<int> anchors)
            {
                var set = new SortedSet<int>();
                foreach (int a in anchors) set.Add(System.Math.Min(MarksEnd(a + 1), end) - 1);
                var sorted = new List<int>(set);
                for (int j = 0; j < sorted.Count; j++)
                    Syllable(j == 0 ? start : sorted[j - 1] + 1, j == sorted.Count - 1 ? end : sorted[j] + 1);
            }
            // Positions that pick `count` syllables out of a list of letters, every `step` letters (the last at the
            // last letter).
            List<int> Spread(List<int> letters, int count, int step)
            {
                var picks = new List<int>(count);
                for (int j = 0; j < count; j++) picks.Add(At(letters, System.Math.Min(step * j + step - 1, letters.Count - 1)));
                return picks;
            }

            int i = 0;
            while (i < n)
            {
                int k = cls[i];
                int skip = MarkupEnd(cps, i);
                if (skip > i) { i = skip; continue; }
                if (IsLatin(k))
                {
                    int end = WordEnd(i, IsLatin);
                    // Each vowel group's last vowel, and how many vowels it has (a mark inside a group continues it).
                    var lasts = new List<int>();
                    var sizes = new List<int>();
                    bool inGroup = false;
                    for (int j = i; j < end; j++)
                    {
                        if (cls[j] == K.LatinVowel)
                        {
                            if (inGroup) { lasts[lasts.Count - 1] = j; sizes[sizes.Count - 1] = sizes[sizes.Count - 1] + 1; }
                            else { lasts.Add(j); sizes.Add(1); }
                            inGroup = true;
                        }
                        else if (cls[j] != K.Mark) inGroup = false;
                    }
                    if (lasts.Count >= 2 && sizes[sizes.Count - 1] == 1 && SilentE(cps, cls, i, end, lasts[lasts.Count - 1], lang)) lasts.RemoveAt(lasts.Count - 1);
                    FromAnchors(i, end, lasts.Count > 0 ? lasts : new List<int> { end - 1 });
                    i = end;
                }
                else if (IsCyrillic(k))
                {
                    int end = WordEnd(i, IsCyrillic);
                    var vowels = new List<int>();
                    for (int j = i; j < end; j++) if (cls[j] == K.CyrillicVowel) vowels.Add(j);
                    FromAnchors(i, end, vowels.Count > 0 ? vowels : new List<int> { end - 1 });
                    i = end;
                }
                else if (IsArabic(k))
                {
                    int end = WordEnd(i, IsArabic);
                    var vowels = new List<int>();
                    var letters = new List<int>();
                    for (int j = i; j < end; j++)
                    {
                        if (cls[j] == K.ArabicVowel) vowels.Add(j);
                        else if (cls[j] == K.ArabicLetter) letters.Add(j);
                    }
                    FromAnchors(i, end, vowels.Count > 0 ? vowels : Spread(letters, System.Math.Max(1, (letters.Count + 1) / 2), 2));
                    i = end;
                }
                else if (IsThai(k))
                {
                    int end = WordEnd(i, IsThai);
                    FromAnchors(i, end, ThaiAnchors(cls, i, end));
                    i = end;
                }
                else if (IsOther(k))
                {
                    int end = WordEnd(i, IsOther);
                    var letters = new List<int>();
                    for (int j = i; j < end; j++) if (cls[j] == K.OtherLetter) letters.Add(j);
                    FromAnchors(i, end, Spread(letters, System.Math.Max(1, (letters.Count + 2) / 3), 3));
                    i = end;
                }
                else if (k == K.Han)
                {
                    int end = MarksEnd(i + 1);
                    Syllable(i, end, japanese ? Bundle.SpeechKanjiWeight : 1);
                    i = end;
                }
                else if (k == K.Kana || k == K.Hangul)
                {
                    int end = MarksEnd(i + 1);
                    Syllable(i, end);
                    i = end;
                }
                else if (k == K.KanaSmall || k == K.KanaLong)
                {
                    // A small kana merges with the kana before it; ー holds it for another beat. With none before, a
                    // small kana is a mora of its own and ー says nothing.
                    int end = MarksEnd(i + 1);
                    var last = units.Count > 0 ? units[units.Count - 1] : null;
                    if (last != null && last.Kind == SpeechUnitKind.Syllable && last.End == i) { last.End = end; if (k == K.KanaLong) last.Weight += 1; }
                    else if (k == K.KanaSmall) Syllable(i, end);
                    i = end;
                }
                else if (k == K.KanaSokuon)
                {
                    int end = MarksEnd(i + 1);
                    units.Add(new SpeechUnit(SpeechUnitKind.Closed, 1, i, end));
                    i = end;
                }
                else if (k == K.Digit)
                {
                    int end = MarksEnd(i + 1);
                    Syllable(i, end, Bundle.SpeechDigitWeight);
                    i = end;
                }
                else if (k == K.PauseShort || k == K.PauseLong)
                {
                    // A full stop or comma between digits is part of the number (3.5, 1,000).
                    bool inNumber = (cps[i] == 0x2E || cps[i] == 0x2C) && ClassAt(i - 1) == K.Digit && ClassAt(i + 1) == K.Digit;
                    if (!inNumber) units.Add(new SpeechUnit(SpeechUnitKind.Pause, k == K.PauseLong ? Bundle.SpeechPauseLongWeight : Bundle.SpeechPauseShortWeight, i, i + 1));
                    i++;
                }
                else if (k == K.Space)
                {
                    // Thai separates its phrases with a space, so a space between Thai words is a short pause.
                    int end = i + 1;
                    while (end < n && cls[end] == K.Space) end++;
                    if (ThaiBefore(cls, i - 1) && IsThai(ClassAt(end))) units.Add(new SpeechUnit(SpeechUnitKind.Pause, Bundle.SpeechPauseShortWeight, i, end));
                    i = end;
                }
                else
                {
                    i++; // nothing: a symbol, an emoji, a stray mark or apostrophe
                }
            }
            return TidyPauses(units);
        }

        /// <summary>Whether the letter before the marks ending at `j` is Thai.</summary>
        private static bool ThaiBefore(int[] cls, int j)
        {
            while (j >= 0 && cls[j] == K.Mark) j--;
            return j >= 0 && IsThai(cls[j]);
        }

        /// <summary>Whether a Latin word's last vowel group, a single vowel at `e`, is a silent final e: in English, and
        /// in French (where `-es` is silent too), a lone e ending the word, unless English's consonant + le ("table",
        /// "little").</summary>
        private static bool SilentE(int[] cps, int[] cls, int start, int end, int e, string lang)
        {
            if (lang != "en" && lang != "fr") return false;
            if (At(cps, e) != 0x65 && At(cps, e) != 0x45) return false; // e, E
            int after = e + 1;
            if (after < end && At(cls, after) == K.Mark) return false; // an accented e, written as e and a mark (é)
            if (lang == "fr" && after < end && (At(cps, after) == 0x73 || At(cps, after) == 0x53)) after++; // -es
            if (after != end) return false;
            if (lang == "en" && e - 2 >= start && (At(cps, e - 1) == 0x6C || At(cps, e - 1) == 0x4C) && At(cls, e - 2) == K.LatinLetter) return false;
            return true;
        }

        /// <summary>The positions closing each syllable of a Thai word from [start, end). A vowel counts, unless it
        /// follows a vowel written before its consonant (เ แ โ ใ ไ) within two consonants, when they're one vowel
        /// (เรียน). A run of consonants with no vowel between holds one syllable per two of them, beyond the one
        /// consonant a syllable starts or ends with (ถนน, ขอบคุณ).</summary>
        private static List<int> ThaiAnchors(int[] cls, int start, int end)
        {
            var anchors = new List<int>();
            var consonants = new List<int>(); // since the last vowel
            bool leadOpen = false;            // a leading vowel waiting for the vowel signs it takes
            void Implicit()
            {
                for (int j = 0; j < (consonants.Count - 1) / 2; j++) anchors.Add(consonants[2 * j + 1]);
            }
            for (int p = start; p < end; p++)
            {
                int k = cls[p];
                if (k == K.ThaiConsonant) consonants.Add(p);
                else if (k == K.ThaiLead)
                {
                    Implicit();
                    anchors.Add(p + 1 < end && cls[p + 1] == K.ThaiConsonant ? p + 1 : p);
                    consonants = new List<int>();
                    leadOpen = true;
                }
                else if (k == K.ThaiVowel)
                {
                    if (consonants.Count == 0) continue;
                    if (leadOpen && consonants.Count <= 2) { leadOpen = false; consonants = new List<int>(); continue; }
                    Implicit();
                    anchors.Add(p);
                    consonants = new List<int>();
                    leadOpen = false;
                }
            }
            if (anchors.Count == 0)
            {
                int count = System.Math.Max(1, (consonants.Count + 1) / 2);
                for (int j = 0; j < count; j++) anchors.Add(consonants.Count > 0 ? consonants[System.Math.Min(2 * j + 1, consonants.Count - 1)] : end - 1);
            }
            else Implicit();
            return anchors;
        }

        /// <summary>Punctuation in a row is one pause, the stronger; a pause before the first syllable or after the
        /// last goes.</summary>
        private static List<SpeechUnit> TidyPauses(List<SpeechUnit> units)
        {
            var output = new List<SpeechUnit>(units.Count);
            foreach (var u in units)
            {
                var last = output.Count > 0 ? output[output.Count - 1] : null;
                if (u.Kind == SpeechUnitKind.Pause && last != null && last.Kind == SpeechUnitKind.Pause)
                {
                    last.Weight = System.Math.Max(last.Weight, u.Weight);
                    last.End = u.End;
                }
                else output.Add(new SpeechUnit(u.Kind, u.Weight, u.Start, u.End));
            }
            int head = 0;
            while (head < output.Count && output[head].Kind == SpeechUnitKind.Pause) head++;
            output.RemoveRange(0, head);
            while (output.Count > 0 && output[output.Count - 1].Kind == SpeechUnitKind.Pause) output.RemoveAt(output.Count - 1);
            return output;
        }
    }
}
