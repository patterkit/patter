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
// Lands in the plugin's own namespace, so two installed plugins never collide.
// The family supplies its own EvalError before including this.
// ---------------------------------------------------------------------------
#pragma once

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

namespace patter
{
    enum class PatterKind { Bool, Number, Str, Flags };

    struct PatterValue
    {
        PatterKind kind = PatterKind::Bool;
        bool b = false;
        double n = 0;
        std::string s;
        std::vector<std::string> f;

        static PatterValue Bool(bool v) { PatterValue x; x.kind = PatterKind::Bool; x.b = v; return x; }
        static PatterValue Num(double v) { PatterValue x; x.kind = PatterKind::Number; x.n = v; return x; }
        static PatterValue Str(std::string v) { PatterValue x; x.kind = PatterKind::Str; x.s = std::move(v); return x; }
        /** Flags list (copied in; a value is a value). */
        static PatterValue Flags(std::vector<std::string> v) { PatterValue x; x.kind = PatterKind::Flags; x.f = std::move(v); return x; }

        bool isBool() const { return kind == PatterKind::Bool; }
        bool isNumber() const { return kind == PatterKind::Number; }
        bool isString() const { return kind == PatterKind::Str; }
        bool isFlags() const { return kind == PatterKind::Flags; }

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
        bool valueEquals(const PatterValue& o) const
        {
            if (kind == PatterKind::Flags || o.kind == PatterKind::Flags)
            {
                if (kind != PatterKind::Flags || o.kind != PatterKind::Flags) return false;
                if (f.size() != o.f.size()) return false;
                std::vector<std::string> x = f, y = o.f;
                std::sort(x.begin(), x.end());
                std::sort(y.begin(), y.end());
                return x == y;
            }
            if (kind != o.kind) return false;
            switch (kind)
            {
                case PatterKind::Bool: return b == o.b;
                case PatterKind::Number: return n == o.n;
                case PatterKind::Str: return s == o.s;
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
                case PatterKind::Bool: return b;
                case PatterKind::Number: return n != 0;
                case PatterKind::Str: return !s.empty();
                case PatterKind::Flags: return !f.empty();
                default: return false;
            }
        }

        /** The JSON.stringify-stable rendering: for diagnostics, failure reports
         *  and anything a runner compares. */
        std::string toJsonString() const
        {
            switch (kind)
            {
                case PatterKind::Bool: return b ? "true" : "false";
                case PatterKind::Number: return JsNumber(n);
                case PatterKind::Str: return JsonQuote(s);
                case PatterKind::Flags:
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
                case PatterKind::Bool: return b ? "true" : "false";
                case PatterKind::Number: return JsNumber(n);
                case PatterKind::Str: return s;
                case PatterKind::Flags:
                {
                    std::string out;
                    for (size_t i = 0; i < f.size(); ++i) { if (i) out += ","; out += f[i]; }
                    return out;
                }
                default: return "";
            }
        }

        /**
         * Format a double the way JavaScript's String(n) does. This is the
         * cross-runtime number-rendering contract, and it did NOT hold: five of
         * the six ports got it wrong, in four different ways. Patterplay's C++
         * used a 1e15 integral cutoff and a fixed `%.15g`, so 1e16 printed as
         * "1e+16" and 0.1+0.2 as "0.3"; both families' C# cast to `long`, which
         * overflows above 2^63, so 1e20 printed as "9223372036854775807"; both
         * GDScript ports used String.num's 14-decimal default and its trailing
         * ".0". Only the Storylet Engine's C++ was faithful, and this is it.
         *
         * Integral values below 1e21 print with no decimal point and no
         * exponent. Everything else takes the SHORTEST representation that
         * round-trips, which is what JS picks.
         */
        static std::string JsNumber(double v)
        {
            if (std::isnan(v)) return "NaN";
            if (std::isinf(v)) return v > 0 ? "Infinity" : "-Infinity";
            if (v == std::floor(v) && std::fabs(v) < 1e21)
            {
                char buf[64];
                std::snprintf(buf, sizeof(buf), "%.0f", v);   // not (long long): 1e20 is past int64
                return std::string(buf);
            }
            for (int precision = 1; precision <= 17; ++precision)
            {
                char buf[64];
                std::snprintf(buf, sizeof(buf), "%.*g", precision, v);
                if (std::strtod(buf, nullptr) == v) return std::string(buf);
            }
            char buf[64];
            std::snprintf(buf, sizeof(buf), "%.17g", v);
            return std::string(buf);
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
}
