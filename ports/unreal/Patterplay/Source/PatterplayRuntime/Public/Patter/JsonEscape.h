// Decoding a JSON string's \u escape to UTF-8: the ONE decoder, for each JSON reader written by hand here
// (Save.h's, and the corpus TestHost's Json.h).
//
// JSON writes a character outside the Basic Multilingual Plane (an emoji, say) as an escaped UTF-16
// surrogate pair, "😀", and some writers do so by default. The pair is ONE code point, so it
// must be joined before it is written as UTF-8: decoding each half on its own gives two invalid
// three-byte sequences instead of the four-byte character. A surrogate without its partner has no UTF-8
// form, so it becomes U+FFFD, as JS's UTF-8 encoding does.
//
// (The plugin reads bundles through Unreal's own JSON library, which joins pairs itself.)
#pragma once

#include <cstddef>
#include <string>

namespace patter
{
    namespace jsonescape
    {
        /** One hex digit's value, or -1 when c is no hex digit. */
        inline int hexDigit(char c)
        {
            if (c >= '0' && c <= '9') return c - '0';
            if (c >= 'a' && c <= 'f') return c - 'a' + 10;
            if (c >= 'A' && c <= 'F') return c - 'A' + 10;
            return -1;
        }

        /** The four hex digits at text[pos], advancing pos past them; false when there are not four. */
        inline bool readHex4(const std::string& text, std::size_t& pos, unsigned& out)
        {
            if (pos + 4 > text.size()) return false;
            unsigned v = 0;
            for (int k = 0; k < 4; ++k)
            {
                const int d = hexDigit(text[pos + k]);
                if (d < 0) return false;
                v = (v << 4) | static_cast<unsigned>(d);
            }
            pos += 4;
            out = v;
            return true;
        }

        inline void appendUtf8(std::string& out, unsigned cp)
        {
            if (cp < 0x80) out += static_cast<char>(cp);
            else if (cp < 0x800)
            {
                out += static_cast<char>(0xC0 | (cp >> 6));
                out += static_cast<char>(0x80 | (cp & 0x3F));
            }
            else if (cp < 0x10000)
            {
                out += static_cast<char>(0xE0 | (cp >> 12));
                out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
                out += static_cast<char>(0x80 | (cp & 0x3F));
            }
            else
            {
                out += static_cast<char>(0xF0 | (cp >> 18));
                out += static_cast<char>(0x80 | ((cp >> 12) & 0x3F));
                out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
                out += static_cast<char>(0x80 | (cp & 0x3F));
            }
        }

        /** Decodes the escape whose four hex digits start at text[pos] (just past the "\u"), appending it to
         *  out as UTF-8 and advancing pos past it. A high surrogate followed by an escaped low surrogate takes
         *  both, as one code point; a lone surrogate appends U+FFFD and leaves whatever follows it unread.
         *  False when the digits are short or not hex, for the caller to report its own way. */
        inline bool decodeUnicodeEscape(const std::string& text, std::size_t& pos, std::string& out)
        {
            unsigned cp = 0;
            if (!readHex4(text, pos, cp)) return false;
            if (cp >= 0xD800 && cp <= 0xDBFF)
            {
                std::size_t after = pos;
                unsigned low = 0;
                if (after + 2 <= text.size() && text[after] == '\\' && text[after + 1] == 'u')
                {
                    after += 2;
                    if (readHex4(text, after, low) && low >= 0xDC00 && low <= 0xDFFF)
                    {
                        pos = after;
                        appendUtf8(out, 0x10000 + ((cp - 0xD800) << 10) + (low - 0xDC00));
                        return true;
                    }
                }
                appendUtf8(out, 0xFFFD);
                return true;
            }
            appendUtf8(out, cp >= 0xDC00 && cp <= 0xDFFF ? 0xFFFD : cp);
            return true;
        }
    }
}
