// The Patterplay version, and the one check against it. A port of @patterkit/runtime's version.ts.
//
// An extension (Patterstage, Pattershot) ships apart from Patterplay and never bundles it, so it checks at start-up
// that the Patterplay it finds is one it was built for. Unreal's .uplugin can't declare a version range for a plugin
// it depends on, so the check runs in code: PatterplayVersion says what this runtime is, and versionInRange tests it.
// An extension built for Patterplay 0.41 checks `patter::versionInRange(patter::PatterplayVersion, "0.41.0", "0.42.0")`.
#pragma once

#include <cstddef>
#include <string>
#include <vector>

namespace patter
{
    /** This runtime's version, as in its .uplugin's VersionName. Written by `npm run bump:play`; never edit it by
     *  hand. */
    inline constexpr const char* PatterplayVersion = "0.46.2";

    namespace version_detail
    {
        /** A version taken apart: major, minor, and patch as digit runs with leading zeros stripped (so they compare
         *  by length, then lexically, at any size), and the prerelease identifiers. */
        struct ParsedVersion
        {
            std::string core[3];
            std::vector<std::string> pre;
        };

        inline bool isDigit(char c) { return c >= '0' && c <= '9'; }
        inline bool isIdentChar(char c)
        {
            return isDigit(c) || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c == '-';
        }
        inline bool allDigits(const std::string& s)
        {
            if (s.empty()) return false;
            for (char c : s) if (!isDigit(c)) return false;
            return true;
        }
        inline std::string stripZeros(const std::string& digits)
        {
            std::size_t i = 0;
            while (i + 1 < digits.size() && digits[i] == '0') ++i;
            return digits.substr(i);
        }
        /** Two digit runs (zeros already stripped) compared as numbers of any size. */
        inline int compareDigits(const std::string& a, const std::string& b)
        {
            if (a.size() != b.size()) return a.size() < b.size() ? -1 : 1;
            return a == b ? 0 : (a < b ? -1 : 1);
        }

        /** Dot-separated identifiers of [0-9A-Za-z-], none empty. False on anything else. */
        inline bool splitIdentifiers(const std::string& s, std::vector<std::string>& out)
        {
            std::string cur;
            for (char c : s)
            {
                if (c == '.') { if (cur.empty()) return false; out.push_back(cur); cur.clear(); }
                else if (isIdentChar(c)) cur += c;
                else return false;
            }
            if (cur.empty()) return false;
            out.push_back(cur);
            return true;
        }

        /** major.minor.patch, then an optional -prerelease and an optional +build, exactly as the JS reference's
         *  pattern allows. False when the text isn't a version. */
        inline bool parse(const std::string& v, ParsedVersion& out)
        {
            std::size_t i = 0;
            for (int part = 0; part < 3; ++part)
            {
                const std::size_t start = i;
                while (i < v.size() && isDigit(v[i])) ++i;
                if (i == start) return false;
                out.core[part] = stripZeros(v.substr(start, i - start));
                if (part < 2) { if (i >= v.size() || v[i] != '.') return false; ++i; }
            }
            const std::size_t plus = v.find('+', i);
            const std::string rest = v.substr(i, plus == std::string::npos ? std::string::npos : plus - i);
            if (!rest.empty())
            {
                if (rest[0] != '-' || !splitIdentifiers(rest.substr(1), out.pre)) return false;
            }
            if (plus != std::string::npos)
            {
                std::vector<std::string> build; // ignored for precedence, but it must be well formed
                if (!splitIdentifiers(v.substr(plus + 1), build)) return false;
            }
            return true;
        }

        /** Semantic-version precedence: negative when a comes first, positive when b does, 0 when they're equal. */
        inline int compare(const ParsedVersion& a, const ParsedVersion& b)
        {
            for (int i = 0; i < 3; ++i)
            {
                const int c = compareDigits(a.core[i], b.core[i]);
                if (c != 0) return c;
            }
            // A prerelease comes before its release.
            if (a.pre.empty() || b.pre.empty())
                return a.pre.empty() == b.pre.empty() ? 0 : (a.pre.empty() ? 1 : -1);
            const std::size_t n = a.pre.size() < b.pre.size() ? a.pre.size() : b.pre.size();
            for (std::size_t i = 0; i < n; ++i)
            {
                const std::string& x = a.pre[i];
                const std::string& y = b.pre[i];
                if (x == y) continue;
                const bool xn = allDigits(x), yn = allDigits(y);
                if (xn && yn)
                {
                    const int c = compareDigits(stripZeros(x), stripZeros(y));
                    if (c != 0) return c;
                    continue; // equal as numbers ("01" and "1"), as the reference's Number() comparison has it
                }
                if (xn != yn) return xn ? -1 : 1; // a numeric identifier comes before a word
                return x < y ? -1 : 1;             // byte (ASCII) order
            }
            if (a.pre.size() == b.pre.size()) return 0;
            return a.pre.size() < b.pre.size() ? -1 : 1;
        }
    }

    /** Whether `version` is at least `min` and below `maxExclusive`, by semantic-version precedence (build metadata
     *  after `+` is ignored, and a prerelease comes before its release). False, never a throw, when any of the
     *  three isn't a version. */
    inline bool versionInRange(const std::string& version, const std::string& min, const std::string& maxExclusive)
    {
        version_detail::ParsedVersion v, lo, hi;
        if (!version_detail::parse(version, v) || !version_detail::parse(min, lo) || !version_detail::parse(maxExclusive, hi))
            return false;
        return version_detail::compare(v, lo) >= 0 && version_detail::compare(v, hi) < 0;
    }
}
