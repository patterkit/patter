// A Patter scalar value: bool / number / string / flags (string[]). Mirrors the JS
// runtime's ScalarValue + its value-equality (primitives by value; flags element-wise;
// mixed kinds unequal). std-only (no Unreal types) so the engine compiles standalone.
#pragma once

#include <string>
#include <vector>
#include <utility>
#include <cmath>
#include <cstdio>

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

        static PatterValue Bool(bool v) { PatterValue p; p.kind = PatterKind::Bool; p.b = v; return p; }
        static PatterValue Num(double v) { PatterValue p; p.kind = PatterKind::Number; p.n = v; return p; }
        static PatterValue Str(std::string v) { PatterValue p; p.kind = PatterKind::Str; p.s = std::move(v); return p; }
        static PatterValue Flags(std::vector<std::string> v) { PatterValue p; p.kind = PatterKind::Flags; p.f = std::move(v); return p; }

        bool isBool() const { return kind == PatterKind::Bool; }
        bool isNumber() const { return kind == PatterKind::Number; }
        bool isString() const { return kind == PatterKind::Str; }
        bool isFlags() const { return kind == PatterKind::Flags; }

        // `==` / `!=` semantics: primitives by value; flags element-wise; mixed kinds unequal.
        bool valueEquals(const PatterValue& o) const
        {
            if (kind == PatterKind::Flags || o.kind == PatterKind::Flags)
            {
                if (kind != PatterKind::Flags || o.kind != PatterKind::Flags) return false;
                if (f.size() != o.f.size()) return false;
                for (size_t i = 0; i < f.size(); ++i) if (f[i] != o.f[i]) return false;
                return true;
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

        // The string a JS host would interpolate / display (number with no trailing ".0").
        std::string toDisplayString() const
        {
            switch (kind)
            {
                case PatterKind::Bool: return b ? "true" : "false";
                case PatterKind::Number: return jsNumber(n);
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

        // Format a double the way JavaScript's String(n) does (the interpolation contract) for the
        // integral case the corpus exercises; non-integers use a trimmed shortest-ish form.
        static std::string jsNumber(double v)
        {
            if (std::isnan(v)) return "NaN";
            if (std::isinf(v)) return v < 0 ? "-Infinity" : "Infinity";
            if (v == std::floor(v) && std::fabs(v) < 1e15)
            {
                char buf[32];
                std::snprintf(buf, sizeof(buf), "%lld", static_cast<long long>(v));
                return buf;
            }
            char buf[32];
            std::snprintf(buf, sizeof(buf), "%.15g", v);
            return buf;
        }
    };
}
