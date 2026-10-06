// GENERATED - vendored from expr/ports/unreal/Value.h by scripts/vendor-ports.mjs.
// Do not edit here; edit the shared source and re-run the script.
// ---------------------------------------------------------------------------
// The scalar value type, for Unreal / std C++. THE SHARED SOURCE.
//
// Authored in expr/ports/unreal and VENDORED into each consuming plugin by
// expr/scripts/vendor-ports.mjs. Do not edit a vendored copy.
//
// The four kinds the expression language has: boolean, number, string, and a
// flag list. Both families had their own, 48% alike, and the shared evaluator
// already required both to expose the same predicates and accessors, so most
// of the difference was spelling.
//
// The shape is Patterplay's: public fields with accessors beside them, because
// its own code reads `v.n` and `v.kind` thirty-five times and the Storylet
// Engine's reads the accessors three.
//
// ExprValue, one type in every product since 2026-09-24 (it was stamped as
// PatterValue and StoryletValue until then, which each product keeps as an
// alias), so one registry can hold every engine's values. Part of the kernel:
// see Errors.h for how the kernel stays one type.
// ---------------------------------------------------------------------------
#include "Errors.h"   // the kernel id tripwire, WILDWINTER_EXPR_VISIBLE, ExprError, RegistryError
// Compiled once per translation unit, and never beside a different kernel: Errors.h stops
// that build with an #error, and this copy then stays out of the way of the first.
#if !defined(WILDWINTER_EXPR_k492cf234_VALUE_H) && WILDWINTER_EXPR_KERNEL == 0x492cf234
#define WILDWINTER_EXPR_k492cf234_VALUE_H

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

namespace wildwinter { namespace expr { inline namespace k492cf234
{
    enum class ExprKind { Bool, Number, Str, Flags };

    struct ExprValue
    {
        ExprKind kind = ExprKind::Bool;
        bool b = false;
        double n = 0;
        std::string s;
        std::vector<std::string> f;

        static ExprValue Bool(bool v) { ExprValue x; x.kind = ExprKind::Bool; x.b = v; return x; }
        static ExprValue Num(double v) { ExprValue x; x.kind = ExprKind::Number; x.n = v; return x; }
        static ExprValue Str(std::string v) { ExprValue x; x.kind = ExprKind::Str; x.s = std::move(v); return x; }
        /** Flags list (copied in; a value is a value). */
        static ExprValue Flags(std::vector<std::string> v) { ExprValue x; x.kind = ExprKind::Flags; x.f = std::move(v); return x; }

        bool isBool() const { return kind == ExprKind::Bool; }
        bool isNumber() const { return kind == ExprKind::Number; }
        bool isString() const { return kind == ExprKind::Str; }
        bool isFlags() const { return kind == ExprKind::Flags; }

        bool asBool() const { return b; }
        double asNumber() const { return n; }
        const std::string& asString() const { return s; }
        const std::vector<std::string>& asFlags() const { return f; }

        /** `==` / `!=` semantics: primitives by value; flags as a SET, order
         *  irrelevant; mixed kinds unequal, and never an error.
         *
         *  Order was significant until 2026-09-01, and that was a bug: a flags
         *  value IS a set, and its stored order is an artefact of the order
         *  somebody happened to add things in. Compared as MULTISETS (sorted
         *  copies), so a duplicate still counts. */
        bool valueEquals(const ExprValue& o) const
        {
            if (kind == ExprKind::Flags || o.kind == ExprKind::Flags)
            {
                if (kind != ExprKind::Flags || o.kind != ExprKind::Flags) return false;
                if (f.size() != o.f.size()) return false;
                std::vector<std::string> x = f, y = o.f;
                std::sort(x.begin(), x.end());
                std::sort(y.begin(), y.end());
                return x == y;
            }
            if (kind != o.kind) return false;
            switch (kind)
            {
                case ExprKind::Bool: return b == o.b;
                case ExprKind::Number: return n == o.n;
                case ExprKind::Str: return s == o.s;
                default: return false;
            }
        }

        /** Truthiness for a bare condition: booleans and numbers as you would
         *  expect, a string when non-empty, a flag list when non-empty. The two
         *  families disagreed about this until 2026-09-01, which mattered
         *  because they share a property registry: the same value read from the
         *  same registry answered a condition differently depending on which
         *  engine asked. */
        bool truthy() const
        {
            switch (kind)
            {
                case ExprKind::Bool: return b;
                case ExprKind::Number: return n != 0;
                case ExprKind::Str: return !s.empty();
                case ExprKind::Flags: return !f.empty();
                default: return false;
            }
        }

        /** The JSON.stringify-stable rendering: for diagnostics, failure reports
         *  and anything a runner compares. */
        std::string toJsonString() const
        {
            switch (kind)
            {
                case ExprKind::Bool: return b ? "true" : "false";
                case ExprKind::Number: return JsNumber(n);
                case ExprKind::Str: return JsonQuote(s);
                case ExprKind::Flags:
                {
                    std::string out = "[";
                    for (size_t i = 0; i < f.size(); ++i) { if (i) out += ","; out += JsonQuote(f[i]); }
                    return out + "]";
                }
                default: return "null";
            }
        }

        /** The string a JS host would interpolate or display: a bare string, a
         *  comma-joined flag list. Distinct from toJsonString, which quotes. */
        std::string toDisplayString() const
        {
            switch (kind)
            {
                case ExprKind::Bool: return b ? "true" : "false";
                case ExprKind::Number: return JsNumber(n);
                case ExprKind::Str: return s;
                case ExprKind::Flags:
                {
                    std::string out;
                    for (size_t i = 0; i < f.size(); ++i) { if (i) out += ","; out += f[i]; }
                    return out;
                }
                default: return "";
            }
        }

        /**
         * Format a double the way JavaScript's String(n) does: the cross-runtime number-rendering contract.
         * The shortest digits that round-trip, laid out by ECMAScript's Number::toString rules: plain digits
         * from 1e-7 up to (not including) 1e21; outside that, an exponent with a lower-case "e" and its sign
         * ("1.5e-7", "1e+21"); -0 as "0". %g alone printed "5e-05", "1.5e-07" and "-0", and a whole number
         * past 2^53 printed exactly where JS prints its shortest digits padded with zeros.
         */
        static std::string JsNumber(double v)
        {
            if (std::isnan(v)) return "NaN";
            if (std::isinf(v)) return v > 0 ? "Infinity" : "-Infinity";
            if (v == 0) return "0"; // -0 included
            if (v == std::floor(v) && std::fabs(v) < 9007199254740992.0)
            {
                char buf[64];
                std::snprintf(buf, sizeof(buf), "%.0f", v);   // a whole number below 2^53 prints exactly
                return std::string(buf);
            }
            const double a = std::fabs(v);
            char buf[64];
            for (int precision = 1; precision <= 17; ++precision)
            {
                std::snprintf(buf, sizeof(buf), "%.*e", precision - 1, a);   // "1.5e-07"
                if (precision == 17 || std::strtod(buf, nullptr) == a) break;
            }
            // Split "d.ddde+XX" into its digits and exponent. Only digits are kept from the mantissa, so a
            // locale's decimal separator never leaks in.
            std::string digits;
            const char* p = buf;
            for (; *p && *p != 'e' && *p != 'E'; ++p) if (*p >= '0' && *p <= '9') digits += *p;
            const int exp10 = *p ? std::atoi(p + 1) : 0;
            while (digits.size() > 1 && digits.back() == '0') digits.pop_back();
            return (v < 0 ? "-" : "") + JsLayout(digits, exp10 + 1);
        }

        /** ECMAScript's layout for digits d1..dk with the decimal point `point` places from the left (the
         *  value is 0.d1..dk x 10^point). */
        static std::string JsLayout(const std::string& d, int point)
        {
            const int k = static_cast<int>(d.size());
            if (k <= point && point <= 21) return d + std::string(static_cast<size_t>(point - k), '0');
            if (0 < point && point <= 21) return d.substr(0, static_cast<size_t>(point)) + "." + d.substr(static_cast<size_t>(point));
            if (-6 < point && point <= 0) return "0." + std::string(static_cast<size_t>(-point), '0') + d;
            const int e = point - 1;
            const std::string exp = (e < 0 ? "-" : "+") + std::to_string(e < 0 ? -e : e);
            return (k == 1 ? d : d.substr(0, 1) + "." + d.substr(1)) + "e" + exp;
        }

        /** A JSON string literal, escaped. */
        static std::string JsonQuote(const std::string& in)
        {
            std::string out = "\"";
            for (char c : in)
            {
                switch (c)
                {
                    case '"': out += "\\\""; break;
                    case '\\': out += "\\\\"; break;
                    case '\n': out += "\\n"; break;
                    case '\r': out += "\\r"; break;
                    case '\t': out += "\\t"; break;
                    default:
                        if (static_cast<unsigned char>(c) < 0x20)
                        {
                            char buf[8];
                            std::snprintf(buf, sizeof(buf), "\\u%04x", static_cast<unsigned>(static_cast<unsigned char>(c)));
                            out += buf;
                        }
                        else out += c;
                }
            }
            return out + "\"";
        }
    };
}}} // namespace wildwinter::expr

#endif
