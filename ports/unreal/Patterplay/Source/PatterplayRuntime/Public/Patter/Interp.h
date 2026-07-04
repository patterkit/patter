// Inline {@ref} interpolation (spec §16) - port of @patterkit/dialect's tokenise +
// interpolate + renderSlotValue. `{ ... }` whose trimmed body starts with `@` is a slot;
// `{{` / `}}` unescape to literal braces; a malformed slot is kept verbatim.
#pragma once

#include <string>
#include <functional>
#include "PatterValue.h"

namespace patter
{
    inline bool isBareRef(const std::string& inner)
    {
        if (inner.size() < 2 || inner[0] != '@') return false;
        for (size_t i = 1; i < inner.size(); ++i)
        {
            char c = inner[i];
            bool ok = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == '.';
            if (!ok) return false;
        }
        return true;
    }

    inline std::string trimCopy(const std::string& s)
    {
        size_t a = s.find_first_not_of(" \t\r\n");
        if (a == std::string::npos) return "";
        size_t b = s.find_last_not_of(" \t\r\n");
        return s.substr(a, b - a + 1);
    }

    // Closed-caption stripping (#214): mirror of @patterkit/dialect's stripCaptions. With captions off,
    // remove every open..close cue span (delimiters included) and collapse the surrounding whitespace; a
    // string with NO cue is returned unchanged. open/close may be the same token; an unclosed open keeps
    // the remainder verbatim. Byte-identical to every other runtime.
    inline bool isCaptionWs(char c) { return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f' || c == '\v'; }

    inline std::string collapseCaptionWs(const std::string& s)
    {
        std::string out;
        bool pendingSpace = false;
        for (char c : s)
        {
            if (isCaptionWs(c)) { pendingSpace = true; continue; }
            if (pendingSpace && !out.empty()) out += ' ';
            pendingSpace = false;
            out += c;
        }
        return out;
    }

    inline std::string stripCaptions(const std::string& text, const std::string& open, const std::string& close)
    {
        if (open.empty() || text.find(open) == std::string::npos) return text;
        std::string out;
        size_t i = 0;
        bool removed = false;
        while (i < text.size())
        {
            if (text.compare(i, open.size(), open) == 0)
            {
                size_t end = text.find(close, i + open.size());
                if (end != std::string::npos) { i = end + close.size(); removed = true; continue; }
                out += text.substr(i); // unclosed cue -> keep the rest literally
                break;
            }
            out += text[i];
            i += 1;
        }
        return removed ? collapseCaptionWs(out) : text;
    }

    inline std::string renderSlot(const PatterValue& v)
    {
        switch (v.kind)
        {
            case PatterKind::Flags:
            {
                std::string out;
                for (size_t i = 0; i < v.f.size(); ++i) { if (i) out += ", "; out += v.f[i]; }
                return out;
            }
            case PatterKind::Bool: return v.b ? "true" : "false";
            case PatterKind::Number: return PatterValue::jsNumber(v.n);
            default: return v.s;
        }
    }

    // resolve returns null when the ref is unset (-> empty string in output).
    inline std::string interpolate(const std::string& text,
                                   const std::function<bool(const std::string&, PatterValue&)>& resolve)
    {
        if (text.find('{') == std::string::npos) return text; // fast path: no slot opener -> nothing to interpolate (the common case)
        std::string out, buf;
        size_t i = 0, len = text.size();
        while (i < len)
        {
            char c = text[i];
            if (c == '{' && i + 1 < len && text[i + 1] == '{') { buf += '{'; i += 2; continue; }
            if (c == '}' && i + 1 < len && text[i + 1] == '}') { buf += '}'; i += 2; continue; }
            if (c == '{')
            {
                size_t close = text.find('}', i + 1);
                if (close != std::string::npos)
                {
                    std::string raw = text.substr(i, close - i + 1);
                    std::string inner = trimCopy(text.substr(i + 1, close - (i + 1)));
                    if (!inner.empty() && inner[0] == '@')
                    {
                        out += buf; buf.clear();
                        if (isBareRef(inner))
                        {
                            PatterValue v;
                            out += resolve(inner, v) ? renderSlot(v) : "";
                        }
                        else { out += raw; }                  // malformed slot -> verbatim
                        i = close + 1;
                        continue;
                    }
                    buf += raw; i = close + 1; continue;      // not a slot -> literal braces
                }
            }
            buf += c; ++i;
        }
        out += buf;
        return out;
    }
}
