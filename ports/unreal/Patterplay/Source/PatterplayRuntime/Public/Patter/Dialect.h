// The Patter expression dialect - port of @patterkit/dialect.
//
// Split out of Expression.h on 2026-09-01: until then Patterplay fused its
// dialect into its evaluator in all three ports and had no Dialect.* file
// anywhere, which is the one thing that stopped the evaluator ever being
// shared with the Storylet Engine. The seam exists on their side (Dialect.h /
// Dialect.cs / dialect.gd) and now on ours, in the same shape.
//
// Scopes are declared EMPTY on purpose. Patter has no missing-property policy:
// a property absent from a present scope reads as a graceful false, which is
// the core's default when a scope carries no policy. The Storylet Engine
// declares its five scopes Throw because every property there has a declared
// default, so absence means a publish bug. Same evaluator, two configurations,
// which is the point.
#pragma once

#include <algorithm>
#include <cmath>
#include <functional>
#include <string>
#include <vector>

#include "Patter/Expr/Expr.h"
#include "Patter/PatterValue.h"

namespace patter
{
    /** Host callbacks the dialect's functions read at eval time. The context
     *  carries it as `const void*`; every function here casts it back. */
    struct PatterHost
    {
        std::function<double()> nextRandom;
        std::function<int(const std::string&)> visits;
        std::function<int(const std::string&)> patterVisits;
    };

    namespace dialectdetail
    {
        inline const PatterHost* hostOf(const EvalHelpers& h)
        {
            return h.ctx ? static_cast<const PatterHost*>(h.ctx->host) : nullptr;
        }

        inline std::vector<std::string> readFlags(const std::vector<AstPtr>& args, EvalHelpers& h, const char* fn)
        {
            if (args.empty()) throw EvalError(std::string(fn) + "() requires at least one argument (the flags variable)");
            PatterValue v = h.evaluate(args[0]);
            if (v.isFlags()) return v.asFlags();
            // An unset flags property may surface as a graceful false; the empty
            // set is the right reading of that, not an error.
            if (v.isBool() && !v.asBool()) return {};
            throw EvalError(std::string(fn) + "() first argument must be a flags property");
        }

        inline std::string nodeId(const std::vector<AstPtr>& args, EvalHelpers& h, const char* fn)
        {
            if (args.empty()) throw EvalError(std::string(fn) + "(id) requires a string node id");
            PatterValue v = h.evaluate(args[0]);
            if (!v.isString()) throw EvalError(std::string(fn) + "(id) requires a string node id");
            return v.asString();
        }

        inline int visitCount(const std::vector<AstPtr>& args, EvalHelpers& h, const char* fn, bool shared)
        {
            const PatterHost* host = hostOf(h);
            const auto& cb = shared ? (host ? host->patterVisits : nullptr) : (host ? host->visits : nullptr);
            return cb ? cb(nodeId(args, h, fn)) : 0;
        }
    }

    /** The dialect descriptor Evaluate consumes. Callers should hold one (the
     *  flow builds it once). */
    inline const Dialect& PatterDialect()
    {
        static const Dialect d = []
        {
            Dialect out;
            out.defaultScope = "patter";
            // No scope declarations: Patter's missing-property policy is
            // graceful false everywhere, which is the core's default.

            FunctionDef random;
            random.minArgs = 2; random.maxArgs = 2; random.returnType = "number";
            random.eval = [](const std::vector<AstPtr>& args, EvalHelpers& h) -> PatterValue
            {
                if (args.size() != 2) throw EvalError("random(a, b) requires exactly 2 arguments");
                const PatterHost* host = dialectdetail::hostOf(h);
                if (!host || !host->nextRandom) throw EvalError("random() called without a PRNG in context");
                PatterValue a = h.evaluate(args[0]);
                PatterValue b = h.evaluate(args[1]);
                if (!a.isNumber() || !b.isNumber()) throw EvalError("random(a, b) arguments must be numbers");
                if (a.asNumber() != std::floor(a.asNumber()) || b.asNumber() != std::floor(b.asNumber()))
                {
                    throw EvalError("random(a, b) arguments must be integers");
                }
                const double lo = std::min(a.asNumber(), b.asNumber());
                const double hi = std::max(a.asNumber(), b.asNumber());
                return PatterValue::Num(std::floor(host->nextRandom() * (hi - lo + 1)) + lo);
            };
            out.functions["random"] = random;

            FunctionDef checkFlags;
            checkFlags.minArgs = 1; checkFlags.returnType = "boolean"; checkFlags.flagDeltaArgs = true;
            checkFlags.eval = [](const std::vector<AstPtr>& args, EvalHelpers& h) -> PatterValue
            {
                std::vector<std::string> flags = dialectdetail::readFlags(args, h, "check_flags");
                for (size_t i = 1; i < args.size(); ++i)
                {
                    const AstNode& arg = *args[i];
                    if (arg.tag != AstTag::FlagDelta) throw EvalError("check_flags() flag args must be +flagName or -flagName");
                    const bool hasFlag = std::find(flags.begin(), flags.end(), arg.name) != flags.end();
                    if (arg.sign == "+" ? !hasFlag : hasFlag) return PatterValue::Bool(false);
                }
                return PatterValue::Bool(true);
            };
            out.functions["check_flags"] = checkFlags;

            FunctionDef setFlags;
            setFlags.minArgs = 1; setFlags.returnType = "flags"; setFlags.flagDeltaArgs = true;
            setFlags.eval = [](const std::vector<AstPtr>& args, EvalHelpers& h) -> PatterValue
            {
                std::vector<std::string> result = dialectdetail::readFlags(args, h, "set_flags");
                for (size_t i = 1; i < args.size(); ++i)
                {
                    const AstNode& arg = *args[i];
                    if (arg.tag != AstTag::FlagDelta) throw EvalError("set_flags() flag args must be +flagName or -flagName");
                    auto it = std::find(result.begin(), result.end(), arg.name);
                    if (arg.sign == "+") { if (it == result.end()) result.push_back(arg.name); }
                    else if (it != result.end()) result.erase(it);
                }
                return PatterValue::Flags(result);
            };
            out.functions["set_flags"] = setFlags;

            auto visitFn = [](const char* name, bool shared, bool asBool)
            {
                FunctionDef fd;
                fd.minArgs = 1; fd.maxArgs = 1; fd.returnType = asBool ? "boolean" : "number";
                std::string fn = name;
                fd.eval = [fn, shared, asBool](const std::vector<AstPtr>& args, EvalHelpers& h) -> PatterValue
                {
                    const int n = dialectdetail::visitCount(args, h, fn.c_str(), shared);
                    return asBool ? PatterValue::Bool(n > 0) : PatterValue::Num(n);
                };
                return fd;
            };
            out.functions["visits"] = visitFn("visits", false, false);
            out.functions["seen"] = visitFn("seen", false, true);
            out.functions["patter_visits"] = visitFn("patter_visits", true, false);
            out.functions["patter_seen"] = visitFn("patter_seen", true, true);
            return out;
        }();
        return d;
    }
}
