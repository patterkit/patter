// The expression evaluator + the Patter dialect - a faithful port of @wildwinter/expr's
// evaluate.ts and @patterkit/dialect. Same operator typing, short-circuiting, value-equality,
// and built-ins (random / check_flags / set_flags / seen / visits / patter_*).
#pragma once

#include <string>
#include <map>
#include <functional>
#include <stdexcept>
#include <cmath>
#include <algorithm>
#include "PatterValue.h"
#include "Ast.h"

namespace patter
{
    struct EvalError : std::runtime_error { explicit EvalError(const std::string& m) : std::runtime_error(m) {} };

    struct EvalContext
    {
        // scope token -> resolver returning the value pointer, or null when absent.
        std::map<std::string, std::function<const PatterValue*(const std::string&)>> scopes;
        std::function<double()> nextRandom;
        std::function<int(const std::string&)> visits;
        std::function<int(const std::string&)> patterVisits;
    };

    namespace detail
    {
        inline const char* kindName(const PatterValue& v)
        {
            switch (v.kind)
            {
                case PatterKind::Bool: return "boolean";
                case PatterKind::Number: return "number";
                case PatterKind::Str: return "string";
                default: return "object";
            }
        }
        inline void assertNumbers(const PatterValue& l, const PatterValue& r, const char* op)
        {
            if (!l.isNumber() || !r.isNumber())
                throw EvalError(std::string("'") + op + "' requires numeric operands, got " + kindName(l) + " and " + kindName(r));
        }
    }

    inline PatterValue evaluate(const AstNode& node, const EvalContext& ctx);

    inline std::vector<std::string> readFlags(const AstNode* arg, const EvalContext& ctx, const char* fn)
    {
        if (!arg) throw EvalError(std::string(fn) + "() requires at least one argument (the flags variable)");
        PatterValue v = evaluate(*arg, ctx);
        if (v.isFlags()) return v.f;
        if (v.isBool() && !v.b) return {};
        throw EvalError(std::string(fn) + "() first argument must be a flags property");
    }

    inline std::string nodeId(const AstNode& call, const EvalContext& ctx, const char* fn)
    {
        if (call.args.empty()) throw EvalError(std::string(fn) + "(id) requires a string node id");
        PatterValue v = evaluate(*call.args[0], ctx);
        if (!v.isString()) throw EvalError(std::string(fn) + "(id) requires a string node id");
        return v.s;
    }

    inline PatterValue evalCall(const AstNode& call, const EvalContext& ctx)
    {
        const std::string& fn = call.fn;
        if (fn == "random")
        {
            if (call.args.size() != 2) throw EvalError("random(a, b) requires exactly 2 arguments");
            if (!ctx.nextRandom) throw EvalError("random() called without a PRNG in context");
            PatterValue a = evaluate(*call.args[0], ctx), b = evaluate(*call.args[1], ctx);
            if (!a.isNumber() || !b.isNumber()) throw EvalError("random(a, b) arguments must be numbers");
            if (a.n != std::floor(a.n) || b.n != std::floor(b.n)) throw EvalError("random(a, b) arguments must be integers");
            double lo = std::min(a.n, b.n), hi = std::max(a.n, b.n);
            return PatterValue::Num(std::floor(ctx.nextRandom() * (hi - lo + 1)) + lo);
        }
        if (fn == "check_flags")
        {
            std::vector<std::string> flags = readFlags(call.args.empty() ? nullptr : call.args[0].get(), ctx, "check_flags");
            for (size_t i = 1; i < call.args.size(); ++i)
            {
                const AstNode& arg = *call.args[i];
                if (arg.tag != AstTag::FlagDelta) throw EvalError("check_flags() flag args must be +flagName or -flagName");
                bool hasFlag = std::find(flags.begin(), flags.end(), arg.name) != flags.end();
                if (arg.sign == "+" ? !hasFlag : hasFlag) return PatterValue::Bool(false);
            }
            return PatterValue::Bool(true);
        }
        if (fn == "set_flags")
        {
            std::vector<std::string> result = readFlags(call.args.empty() ? nullptr : call.args[0].get(), ctx, "set_flags");
            for (size_t i = 1; i < call.args.size(); ++i)
            {
                const AstNode& arg = *call.args[i];
                if (arg.tag != AstTag::FlagDelta) throw EvalError("set_flags() flag args must be +flagName or -flagName");
                auto it = std::find(result.begin(), result.end(), arg.name);
                if (arg.sign == "+") { if (it == result.end()) result.push_back(arg.name); }
                else if (it != result.end()) result.erase(it);
            }
            return PatterValue::Flags(result);
        }
        if (fn == "visits") return PatterValue::Num(ctx.visits ? ctx.visits(nodeId(call, ctx, "visits")) : 0);
        if (fn == "seen") return PatterValue::Bool((ctx.visits ? ctx.visits(nodeId(call, ctx, "seen")) : 0) > 0);
        if (fn == "patter_visits") return PatterValue::Num(ctx.patterVisits ? ctx.patterVisits(nodeId(call, ctx, "patter_visits")) : 0);
        if (fn == "patter_seen") return PatterValue::Bool((ctx.patterVisits ? ctx.patterVisits(nodeId(call, ctx, "patter_seen")) : 0) > 0);
        throw EvalError("unknown function '" + fn + "'");
    }

    inline PatterValue evaluate(const AstNode& node, const EvalContext& ctx)
    {
        using detail::kindName;
        using detail::assertNumbers;
        switch (node.tag)
        {
            case AstTag::Bool: return PatterValue::Bool(node.b);
            case AstTag::Number: return PatterValue::Num(node.n);
            case AstTag::Str: return PatterValue::Str(node.s);
            case AstTag::ScopedVar:
            {
                auto it = ctx.scopes.find(node.scope);
                if (it == ctx.scopes.end()) return PatterValue::Bool(false);
                const PatterValue* v = it->second(node.name);
                return v ? *v : PatterValue::Bool(false);
            }
            case AstTag::Call: return evalCall(node, ctx);
            case AstTag::FlagDelta:
                throw EvalError("flagdelta node is only valid as an argument to a flag-delta function");
            case AstTag::Unary:
            {
                if (node.op == "not")
                {
                    PatterValue v = evaluate(*node.operand, ctx);
                    if (!v.isBool()) throw EvalError(std::string("'not' requires a boolean operand, got ") + kindName(v));
                    return PatterValue::Bool(!v.b);
                }
                PatterValue v = evaluate(*node.operand, ctx);
                if (!v.isNumber()) throw EvalError(std::string("unary '-' requires a numeric operand, got ") + kindName(v));
                return PatterValue::Num(-v.n);
            }
            case AstTag::Binary:
            {
                if (node.op == "and")
                {
                    PatterValue l = evaluate(*node.left, ctx);
                    if (!l.isBool()) throw EvalError(std::string("'and' requires boolean operands, left is ") + kindName(l));
                    if (!l.b) return PatterValue::Bool(false);
                    PatterValue r = evaluate(*node.right, ctx);
                    if (!r.isBool()) throw EvalError(std::string("'and' requires boolean operands, right is ") + kindName(r));
                    return PatterValue::Bool(r.b);
                }
                if (node.op == "or")
                {
                    PatterValue l = evaluate(*node.left, ctx);
                    if (!l.isBool()) throw EvalError(std::string("'or' requires boolean operands, left is ") + kindName(l));
                    if (l.b) return PatterValue::Bool(true);
                    PatterValue r = evaluate(*node.right, ctx);
                    if (!r.isBool()) throw EvalError(std::string("'or' requires boolean operands, right is ") + kindName(r));
                    return PatterValue::Bool(r.b);
                }
                PatterValue l = evaluate(*node.left, ctx), r = evaluate(*node.right, ctx);
                const std::string& op = node.op;
                if (op == "==") return PatterValue::Bool(l.valueEquals(r));
                if (op == "!=") return PatterValue::Bool(!l.valueEquals(r));
                if (op == ">") { assertNumbers(l, r, ">"); return PatterValue::Bool(l.n > r.n); }
                if (op == ">=") { assertNumbers(l, r, ">="); return PatterValue::Bool(l.n >= r.n); }
                if (op == "<") { assertNumbers(l, r, "<"); return PatterValue::Bool(l.n < r.n); }
                if (op == "<=") { assertNumbers(l, r, "<="); return PatterValue::Bool(l.n <= r.n); }
                if (op == "+")
                {
                    if (l.isNumber() && r.isNumber()) return PatterValue::Num(l.n + r.n);
                    if (l.isString() && r.isString()) return PatterValue::Str(l.s + r.s);
                    throw EvalError(std::string("'+' requires two numbers or two strings, got ") + kindName(l) + " and " + kindName(r));
                }
                if (op == "-") { assertNumbers(l, r, "-"); return PatterValue::Num(l.n - r.n); }
                if (op == "*") { assertNumbers(l, r, "*"); return PatterValue::Num(l.n * r.n); }
                if (op == "/")
                {
                    assertNumbers(l, r, "/");
                    if (r.n == 0) throw EvalError("division by zero");
                    return PatterValue::Num(l.n / r.n);
                }
                throw EvalError("unknown operator '" + op + "'");
            }
        }
        throw EvalError("unknown ast node");
    }
}
