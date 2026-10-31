// Speech units: a line broken into the syllables it would be spoken in, the beats with the mouth shut, and the
// pauses at its punctuation, each with a weight. estimateLineDuration (Bundle.h) times a line with no recording by
// their total weight; a game lays the same units over a line's real or estimated length to move a mouth, so the
// timing and the mouth can't disagree. A port of @patterkit/model's speech.ts, rule for rule, reading the generated
// class table (SpeechTable.h) that every runtime carries:
// - Latin: groups of vowels per word, at least one; in English and French a lone final e is silent ("lamps are lit",
//   "une lampe"), except English's consonant + le ("table").
// - Cyrillic: one per vowel letter, at least one a word.
// - Han: one per character, two in Japanese text (a kanji's reading can't be known without a dictionary).
// - Kana: one per mora. A small kana merges with the one before, a sokuon is a beat with the mouth shut, a long
//   vowel mark holds the one before for another beat.
// - Hangul: one per syllable block.
// - Arabic: one per written short vowel, or with none written, one per two letters, at least one a word.
// - Thai: one per vowel (a vowel written before its consonant takes the vowel signs that follow within two
//   consonants), plus one per two consonants with no vowel between them; a space between Thai words is a short pause.
// - Any other script: one per three letters a word, at least one.
// - A digit weighs 1.5. Emoji, symbols, markup (`<b>`, `&amp;`), and white space weigh nothing.
// - Pauses: short (`,` `;` `:` and their CJK and Arabic forms, a dash) weigh 1, long (`.` `!` `?` and their forms,
//   an ellipsis) 2. Punctuation in a row is one pause, the stronger; a pause before the first syllable or after the
//   last is dropped (the line's padAfter is the pause after it), as is a `.` or `,` between digits (3.5, 1,000).
//
// Text is UTF-8; offsets are code points (a character outside the Basic Multilingual Plane counts once), so every
// runtime agrees whatever its string encoding.
#pragma once

#include <algorithm>
#include <cstdint>
#include <set>
#include <string>
#include <vector>
#include "SpeechTable.h"

namespace patter
{
    /** What a speech unit is: a syllable (the mouth opens), a beat with the mouth shut (a sokuon), or a pause. */
    enum class SpeechUnitKind { Syllable, Closed, Pause };

    /** One unit of a line as it would be spoken. `start` and `end` are code-point offsets into the text, end
     *  exclusive. */
    struct SpeechUnit
    {
        SpeechUnitKind kind = SpeechUnitKind::Syllable;
        double weight = 1;
        int start = 0;
        int end = 0;
    };

    /** A digit's weight: most read as one or two syllables. */
    inline constexpr double SPEECH_DIGIT_WEIGHT = 1.5;
    /** A Han character's weight in Japanese text. */
    inline constexpr double SPEECH_KANJI_WEIGHT = 2;
    /** A short pause's weight (`,` `;`), and a long one's (`.` `?`). */
    inline constexpr double SPEECH_PAUSE_SHORT_WEIGHT = 1;
    inline constexpr double SPEECH_PAUSE_LONG_WEIGHT = 2;

    namespace speech_detail
    {
        namespace K = speech_class;

        /** An entry, or -1 out of range (every array here holds numbers that are never negative). */
        inline int at(const std::vector<int>& a, long j) { return j >= 0 && j < static_cast<long>(a.size()) ? a[static_cast<std::size_t>(j)] : -1; }

        /** UTF-8 to code points. A malformed byte is U+FFFD, one code point. */
        inline std::vector<int> codePoints(const std::string& text)
        {
            std::vector<int> out;
            out.reserve(text.size());
            const std::size_t n = text.size();
            std::size_t i = 0;
            while (i < n)
            {
                const unsigned char b = static_cast<unsigned char>(text[i]);
                int len = b < 0x80 ? 1 : (b >> 5) == 0x6 ? 2 : (b >> 4) == 0xE ? 3 : (b >> 3) == 0x1E ? 4 : 0;
                int cp = len == 1 ? b : len == 2 ? (b & 0x1F) : len == 3 ? (b & 0x0F) : (b & 0x07);
                bool ok = len > 0 && i + static_cast<std::size_t>(len) <= n;
                for (int k = 1; ok && k < len; ++k)
                {
                    const unsigned char c = static_cast<unsigned char>(text[i + static_cast<std::size_t>(k)]);
                    if ((c & 0xC0) != 0x80) ok = false;
                    else cp = (cp << 6) | (c & 0x3F);
                }
                if (!ok) { out.push_back(0xFFFD); ++i; continue; }
                out.push_back(cp);
                i += static_cast<std::size_t>(len);
            }
            return out;
        }

        /** A code point's class, by binary search of the table. */
        inline int classOf(int cp)
        {
            long lo = 0, hi = static_cast<long>(kSpeechRangeCount) - 1;
            while (lo <= hi)
            {
                const long mid = (lo + hi) >> 1;
                if (cp < kSpeechRanges[mid * 3]) hi = mid - 1;
                else if (cp > kSpeechRanges[mid * 3 + 1]) lo = mid + 1;
                else return kSpeechRanges[mid * 3 + 2];
            }
            return K::None;
        }

        /** A locale's language, lower case: `en-GB`, `en_gb`, and `EN` are all `en`. */
        inline std::string languageOf(const std::string& locale)
        {
            std::string out;
            for (char c : locale)
            {
                if (c == '-' || c == '_') break;
                out += (c >= 'A' && c <= 'Z') ? static_cast<char>(c - 'A' + 'a') : c;
            }
            return out;
        }

        inline bool isAsciiLetter(int cp) { return (cp >= 0x41 && cp <= 0x5A) || (cp >= 0x61 && cp <= 0x7A); }
        inline bool isAsciiDigit(int cp) { return cp >= 0x30 && cp <= 0x39; }

        /** Where markup starting at `i` ends (exclusive): a formatting tag (`<b>`, `</bi>`) or an entity (`&amp;`,
         *  `&#38;`). `i` itself when there's none. */
        inline long markupEnd(const std::vector<int>& cps, long i)
        {
            if (at(cps, i) == 0x3C) // <
            {
                long j = i + 1;
                if (at(cps, j) == 0x2F) j++; // /
                const long from = j;
                while (isAsciiLetter(at(cps, j))) j++;
                return j > from && at(cps, j) == 0x3E ? j + 1 : i; // >
            }
            if (at(cps, i) == 0x26) // &
            {
                long j = i + 1;
                const bool numeric = at(cps, j) == 0x23; // &#38;
                if (numeric) j++;
                const long from = j;
                while (numeric ? isAsciiDigit(at(cps, j)) : isAsciiLetter(at(cps, j))) j++;
                return j > from && at(cps, j) == 0x3B ? j + 1 : i; // ;
            }
            return i;
        }

        // The classes each kind of word is made of (a mark or a joining apostrophe continues any of them).
        enum class Family { Latin, Cyrillic, Arabic, Thai, Other };
        inline bool inFamily(Family f, int k)
        {
            switch (f)
            {
                case Family::Latin: return k == K::LatinVowel || k == K::LatinLetter;
                case Family::Cyrillic: return k == K::CyrillicVowel || k == K::CyrillicLetter;
                case Family::Arabic: return k == K::ArabicLetter || k == K::ArabicVowel;
                case Family::Thai: return k == K::ThaiConsonant || k == K::ThaiLead || k == K::ThaiVowel;
                case Family::Other: return k == K::OtherLetter;
            }
            return false;
        }
        inline bool isKanaClass(int k) { return k == K::Kana || k == K::KanaSmall || k == K::KanaSokuon || k == K::KanaLong; }

        /** Whether the letter before the marks ending at `j` is Thai. */
        inline bool thaiBefore(const std::vector<int>& cls, long j)
        {
            while (j >= 0 && at(cls, j) == K::Mark) j--;
            return j >= 0 && inFamily(Family::Thai, at(cls, j));
        }

        /** Whether a Latin word's last vowel group, a single vowel at `e`, is a silent final e: in English, and in
         *  French (where `-es` is silent too), a lone e ending the word, unless English's consonant + le ("table",
         *  "little"). */
        inline bool silentE(const std::vector<int>& cps, const std::vector<int>& cls, long start, long end, long e, const std::string& lang)
        {
            if (lang != "en" && lang != "fr") return false;
            if (at(cps, e) != 0x65 && at(cps, e) != 0x45) return false; // e, E
            long after = e + 1;
            if (after < end && at(cls, after) == K::Mark) return false; // an accented e, written as e and a mark
            if (lang == "fr" && after < end && (at(cps, after) == 0x73 || at(cps, after) == 0x53)) after++; // -es
            if (after != end) return false;
            if (lang == "en" && e - 2 >= start && (at(cps, e - 1) == 0x6C || at(cps, e - 1) == 0x4C) && at(cls, e - 2) == K::LatinLetter) return false;
            return true;
        }

        /** The positions closing each syllable of a Thai word from [start, end). A vowel counts, unless it follows
         *  a vowel written before its consonant within two consonants, when they're one vowel. A run of consonants
         *  with no vowel between holds one syllable per two of them, beyond the one consonant a syllable starts or
         *  ends with. */
        inline std::vector<int> thaiAnchors(const std::vector<int>& cls, long start, long end)
        {
            std::vector<int> anchors;
            std::vector<int> consonants; // since the last vowel
            bool leadOpen = false;       // a leading vowel waiting for the vowel signs it takes
            const auto implicit = [&]()
            {
                const long pairs = (static_cast<long>(consonants.size()) - 1) / 2;
                for (long j = 0; j < pairs; ++j) anchors.push_back(at(consonants, 2 * j + 1));
            };
            for (long p = start; p < end; ++p)
            {
                const int k = at(cls, p);
                if (k == K::ThaiConsonant) consonants.push_back(static_cast<int>(p));
                else if (k == K::ThaiLead)
                {
                    implicit();
                    anchors.push_back(static_cast<int>(p + 1 < end && at(cls, p + 1) == K::ThaiConsonant ? p + 1 : p));
                    consonants.clear();
                    leadOpen = true;
                }
                else if (k == K::ThaiVowel)
                {
                    if (consonants.empty()) continue;
                    if (leadOpen && consonants.size() <= 2) { leadOpen = false; consonants.clear(); continue; }
                    implicit();
                    anchors.push_back(static_cast<int>(p));
                    consonants.clear();
                    leadOpen = false;
                }
            }
            if (anchors.empty())
            {
                const long count = std::max<long>(1, (static_cast<long>(consonants.size()) + 1) / 2);
                for (long j = 0; j < count; ++j)
                    anchors.push_back(consonants.empty() ? static_cast<int>(end - 1)
                                                         : at(consonants, std::min<long>(2 * j + 1, static_cast<long>(consonants.size()) - 1)));
            }
            else implicit();
            return anchors;
        }

        /** Punctuation in a row is one pause, the stronger; a pause before the first syllable or after the last
         *  goes. */
        inline std::vector<SpeechUnit> tidyPauses(const std::vector<SpeechUnit>& units)
        {
            std::vector<SpeechUnit> out;
            for (const SpeechUnit& u : units)
            {
                if (u.kind == SpeechUnitKind::Pause && !out.empty() && out.back().kind == SpeechUnitKind::Pause)
                {
                    out.back().weight = std::max(out.back().weight, u.weight);
                    out.back().end = u.end;
                }
                else out.push_back(u);
            }
            std::size_t first = 0;
            while (first < out.size() && out[first].kind == SpeechUnitKind::Pause) ++first;
            out.erase(out.begin(), out.begin() + static_cast<std::ptrdiff_t>(first));
            while (!out.empty() && out.back().kind == SpeechUnitKind::Pause) out.pop_back();
            return out;
        }
    }

    /**
     * A line broken into the units it would be spoken in: its syllables, its beats with the mouth shut, and its
     * pauses, in order, each with a weight. `text` is UTF-8; offsets are code points. `locale` is the language the
     * line is spoken in (the project's main language, not the one being shown, a step's `spokenLocale`); it decides
     * English's and French's silent e, and Japanese kanji, which also apply when the line has any kana in it.
     */
    inline std::vector<SpeechUnit> speechUnits(const std::string& text, const std::string& locale = "")
    {
        using namespace speech_detail;
        const std::vector<int> cps = codePoints(text);
        std::vector<int> cls;
        cls.reserve(cps.size());
        for (int cp : cps) cls.push_back(classOf(cp));
        const long n = static_cast<long>(cps.size());
        const std::string lang = languageOf(locale);
        const bool japanese = lang == "ja" || std::any_of(cls.begin(), cls.end(), isKanaClass);
        std::vector<SpeechUnit> units;
        const auto push = [&](SpeechUnitKind kind, double weight, long start, long end)
        {
            SpeechUnit u; u.kind = kind; u.weight = weight; u.start = static_cast<int>(start); u.end = static_cast<int>(end);
            units.push_back(u);
        };
        const auto syllable = [&](long start, long end, double weight) { push(SpeechUnitKind::Syllable, weight, start, end); };
        const auto classAt = [&](long j) { return j >= 0 && j < n ? at(cls, j) : static_cast<int>(K::None); };
        // A character's own unit runs on over the marks after it.
        const auto marksEnd = [&](long j) { while (j < n && at(cls, j) == K::Mark) j++; return j; };
        // Where a word of this family starting at `i` ends: marks continue it, and an apostrophe between two of its
        // letters joins it.
        const auto wordEnd = [&](long i, Family family)
        {
            long j = i + 1;
            while (j < n && (inFamily(family, at(cls, j)) || at(cls, j) == K::Mark || (at(cls, j) == K::Joiner && inFamily(family, classAt(j + 1))))) j++;
            return j;
        };
        // Units for a word from [start, end) and the positions that close each syllable, in order: each unit runs
        // from just after the one before to its own position, the first from the word's start and the last to its
        // end. A syllable's last letter takes the marks after it (an e written as e and a mark).
        const auto fromAnchors = [&](long start, long end, const std::vector<int>& anchors)
        {
            std::set<long> unique;
            for (int a : anchors) unique.insert(std::min(marksEnd(a + 1), end) - 1);
            const std::vector<long> sorted(unique.begin(), unique.end());
            for (std::size_t j = 0; j < sorted.size(); ++j)
                syllable(j == 0 ? start : sorted[j - 1] + 1, j == sorted.size() - 1 ? end : sorted[j] + 1, 1);
        };
        // Positions that pick `count` syllables out of a list of letters, every `step` letters (the last at the
        // last letter).
        const auto spread = [](const std::vector<int>& letters, long count, long step)
        {
            std::vector<int> out;
            for (long j = 0; j < count; ++j) out.push_back(at(letters, std::min(step * j + step - 1, static_cast<long>(letters.size()) - 1)));
            return out;
        };

        long i = 0;
        while (i < n)
        {
            const int k = at(cls, i);
            const long skip = markupEnd(cps, i);
            if (skip > i) { i = skip; continue; }
            if (inFamily(Family::Latin, k))
            {
                const long end = wordEnd(i, Family::Latin);
                // Each vowel group's last vowel, and how many vowels it has (a mark inside a group continues it).
                std::vector<int> lasts, sizes;
                bool inGroup = false;
                for (long j = i; j < end; ++j)
                {
                    if (at(cls, j) == K::LatinVowel)
                    {
                        if (inGroup) { lasts.back() = static_cast<int>(j); sizes.back() += 1; }
                        else { lasts.push_back(static_cast<int>(j)); sizes.push_back(1); }
                        inGroup = true;
                    }
                    else if (at(cls, j) != K::Mark) inGroup = false;
                }
                if (lasts.size() >= 2 && sizes.back() == 1 && silentE(cps, cls, i, end, lasts.back(), lang)) lasts.pop_back();
                fromAnchors(i, end, lasts.empty() ? std::vector<int>{ static_cast<int>(end - 1) } : lasts);
                i = end;
            }
            else if (inFamily(Family::Cyrillic, k))
            {
                const long end = wordEnd(i, Family::Cyrillic);
                std::vector<int> vowels;
                for (long j = i; j < end; ++j) if (at(cls, j) == K::CyrillicVowel) vowels.push_back(static_cast<int>(j));
                fromAnchors(i, end, vowels.empty() ? std::vector<int>{ static_cast<int>(end - 1) } : vowels);
                i = end;
            }
            else if (inFamily(Family::Arabic, k))
            {
                const long end = wordEnd(i, Family::Arabic);
                std::vector<int> vowels, letters;
                for (long j = i; j < end; ++j)
                {
                    if (at(cls, j) == K::ArabicVowel) vowels.push_back(static_cast<int>(j));
                    else if (at(cls, j) == K::ArabicLetter) letters.push_back(static_cast<int>(j));
                }
                fromAnchors(i, end, !vowels.empty() ? vowels : spread(letters, std::max<long>(1, (static_cast<long>(letters.size()) + 1) / 2), 2));
                i = end;
            }
            else if (inFamily(Family::Thai, k))
            {
                const long end = wordEnd(i, Family::Thai);
                fromAnchors(i, end, thaiAnchors(cls, i, end));
                i = end;
            }
            else if (inFamily(Family::Other, k))
            {
                const long end = wordEnd(i, Family::Other);
                std::vector<int> letters;
                for (long j = i; j < end; ++j) if (at(cls, j) == K::OtherLetter) letters.push_back(static_cast<int>(j));
                fromAnchors(i, end, spread(letters, std::max<long>(1, (static_cast<long>(letters.size()) + 2) / 3), 3));
                i = end;
            }
            else if (k == K::Han)
            {
                const long end = marksEnd(i + 1);
                syllable(i, end, japanese ? SPEECH_KANJI_WEIGHT : 1);
                i = end;
            }
            else if (k == K::Kana || k == K::Hangul)
            {
                const long end = marksEnd(i + 1);
                syllable(i, end, 1);
                i = end;
            }
            else if (k == K::KanaSmall || k == K::KanaLong)
            {
                // A small kana merges with the kana before it; a long vowel mark holds it for another beat. With
                // none before, a small kana is a mora of its own and a long vowel mark says nothing.
                const long end = marksEnd(i + 1);
                if (!units.empty() && units.back().kind == SpeechUnitKind::Syllable && units.back().end == i)
                {
                    units.back().end = static_cast<int>(end);
                    if (k == K::KanaLong) units.back().weight += 1;
                }
                else if (k == K::KanaSmall) syllable(i, end, 1);
                i = end;
            }
            else if (k == K::KanaSokuon)
            {
                const long end = marksEnd(i + 1);
                push(SpeechUnitKind::Closed, 1, i, end);
                i = end;
            }
            else if (k == K::Digit)
            {
                const long end = marksEnd(i + 1);
                syllable(i, end, SPEECH_DIGIT_WEIGHT);
                i = end;
            }
            else if (k == K::PauseShort || k == K::PauseLong)
            {
                // A full stop or comma between digits is part of the number (3.5, 1,000).
                const bool inNumber = (at(cps, i) == 0x2E || at(cps, i) == 0x2C) && classAt(i - 1) == K::Digit && classAt(i + 1) == K::Digit;
                if (!inNumber) push(SpeechUnitKind::Pause, k == K::PauseLong ? SPEECH_PAUSE_LONG_WEIGHT : SPEECH_PAUSE_SHORT_WEIGHT, i, i + 1);
                i++;
            }
            else if (k == K::Space)
            {
                // Thai separates its phrases with a space, so a space between Thai words is a short pause.
                long end = i + 1;
                while (end < n && at(cls, end) == K::Space) end++;
                if (thaiBefore(cls, i - 1) && inFamily(Family::Thai, classAt(end))) push(SpeechUnitKind::Pause, SPEECH_PAUSE_SHORT_WEIGHT, i, end);
                i = end;
            }
            else
            {
                i++; // nothing: a symbol, an emoji, a stray mark or apostrophe
            }
        }
        return tidyPauses(units);
    }

    /** A speech unit kind as the JS reference names it: "syllable", "closed", or "pause". */
    inline const char* speechUnitKindName(SpeechUnitKind kind)
    {
        switch (kind)
        {
            case SpeechUnitKind::Syllable: return "syllable";
            case SpeechUnitKind::Closed: return "closed";
            case SpeechUnitKind::Pause: return "pause";
        }
        return "syllable";
    }
}
