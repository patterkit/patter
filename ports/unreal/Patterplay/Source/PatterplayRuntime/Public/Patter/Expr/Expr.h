// GENERATED - vendored from expr/ports/unreal/Expr.h by scripts/vendor-ports.mjs.
// Do not edit here; edit the shared source and re-run the script.
// ---------------------------------------------------------------------------
// @wildwinter/expr - the evaluator, for Unreal / std C++. THE SHARED SOURCE.
//
// Authored in expr/ports/unreal and VENDORED into each consuming plugin by
// expr/scripts/vendor-ports.mjs. Do not edit a vendored copy: CI regenerates
// it and fails on `git diff --exit-code`, so a hand edit downstream is caught
// rather than silently becoming a seventh dialect of the same 250 lines.
//
// Port of evaluate.ts + dialect.ts. Operators, short-circuiting and type
// checking are generic; scope resolution uses the context's scope sources plus
// the dialect's per-scope missing-property policy; calls dispatch to the
// dialect's functions.
//
// Lands directly in the plugin's own namespace (`storylets` / `patter`). Two
// header-only copies under ONE name would be an ODR violation the linker
// resolves silently, which is the worst failure mode available here because it
// is invisible; two copies under the two plugins' own namespaces are simply
// two types. Identity belongs to the installing plugin, never to the shared
// source. See expr/docs/port-sharing.md.
//
// What the family must provide before including this:
//   - its value type, with Bool/Num/Str/Flags factories, isBool/isNumber/
//     isString/isFlags, asBool/asNumber/asString/asFlags, and valueEquals
//   - `EvalError`, a std::runtime_error subclass
//   - the AST (the shared Ast.h beside this one)
//
// TRUTHINESS IS NOT HERE, on purpose. Turning a value into a condition's
// yes/no is applied to a condition rather than computed by the evaluator, so
// it lives in each family's own code.
// ---------------------------------------------------------------------------
#pragma once

#include <algorithm>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

#include "Patter/PatterValue.h"
#include "Patter/Expr/Ast.h"

namespace patter
{
    /** A scope readable by the evaluator: a static bag or a host resolver.
     *  get returns nullopt when the property is not present (TS undefined). */
    class IScopeSource
    {
    public:
        virtual ~IScopeSource() = default;
        virtual std::optional<PatterValue> get(const std::string& name) const = 0;
    };

    /** A scope backed by a plain callable, for a host that would rather write a
     *  lambda than a class. */
    class FnScope : public IScopeSource
    {
    public:
        using Fn = std::function<std::optional<PatterValue>(const std::string&)>;
        explicit FnScope(Fn fn) : fn_(std::move(fn)) {}
        std::optional<PatterValue> get(const std::string& name) const override
        {
            return fn_ ? fn_(name) : std::nullopt;
        }
    private:
        Fn fn_;
    };

    /** Policy when a property is missing from a PRESENT scope: False resolves
     *  to false (the default), Throw raises an EvalError. A scope entirely
     *  absent from the EvalContext always resolves to false regardless. */
    enum class MissingPolicy { False, Throw };

    struct ScopeDef
    {
        /** The scope token, e.g. "story" / "world" / "hand" / "patter". */
        std::string token;
        MissingPolicy missing = MissingPolicy::False;
    };

    struct EvalContext
    {
        /** Values per scope token. A scope absent from this map resolves to
         *  false (graceful) for any reference. */
        std::unordered_map<std::string, std::shared_ptr<const IScopeSource>> scopes;
        /** Arbitrary host callbacks a dialect's functions read at eval time;
         *  each dialect casts it to its own host struct. The core never
         *  inspects it. Non-owning. */
        const void* host = nullptr;
        /** The quality channel: "is @scope.name a quality, and what is its
         *  ladder?" Unset when the bundle declares no quality, and evaluation
         *  is then byte-identical to before. */
        std::function<const std::vector<std::string>*(const std::string&, const std::string&)> qualities;
    };

    struct EvalHelpers
    {
        /** Evaluate a child node (for functions to evaluate their arguments). */
        std::function<PatterValue(const AstPtr&)> evaluate;
        /** The active evaluation context (scopes + host). */
        EvalContext* ctx = nullptr;
    };

    struct FunctionDef
    {
        int minArgs = 0;
        std::optional<int> maxArgs;
        std::string returnType;             // "boolean" | "number" | "string" | "flags" | "unknown"
        /** When true, trailing arguments (after the first) reach eval as
         *  FlagDelta nodes rather than expressions (check_flags / set_flags). */
        bool flagDeltaArgs = false;
        /** Evaluate the call. Receives the RAW argument nodes (not
         *  pre-evaluated); implementations own their own arity/type checks. */
        std::function<PatterValue(const std::vector<AstPtr>&, EvalHelpers&)> eval;
    };

    struct Dialect
    {
        std::vector<ScopeDef> scopes;
        /** Bare `@name` is shorthand for `@<defaultScope>.name` (already
         *  resolved at compile time; kept for parity). */
        std::string defaultScope;
        std::unordered_map<std::string, FunctionDef> functions;
    };

    /** JS typeof for error messages (a flags array is "object"). */
    inline std::string TypeOf(const PatterValue& v)
    {
        if (v.isBool()) return "boolean";
        if (v.isNumber()) return "number";
        if (v.isString()) return "string";
        return "object";
    }

    namespace detail
    {
        /** The ladder behind an operand NODE, when the context's quality channel
         *  says it references one. */
        inline const std::vector<std::string>* LadderOf(const AstPtr& node, const EvalContext& ctx)
        {
            if (!ctx.qualities || !node || node->tag != AstTag::ScopedVar) return nullptr;
            return ctx.qualities(node->scope, node->name);
        }

        /** Index of a stage in a ladder; an unknown stage is an error naming the
         *  value (a drifted save is exactly what lands here). */
        inline int StageIndex(const PatterValue& value, const std::vector<std::string>& ladder, const std::string& op)
        {
            if (!value.isString()) throw EvalError("'" + op + "' on a quality compares stages, got " + TypeOf(value));
            for (size_t i = 0; i < ladder.size(); i++) if (ladder[i] == value.asString()) return (int)i;
            std::string all;
            for (size_t i = 0; i < ladder.size(); i++) all += (i ? ", " : "") + ladder[i];
            throw EvalError("\"" + value.asString() + "\" is not a stage of this quality (stages: " + all + ")");
        }

        inline void AssertNumbers(const PatterValue& l, const PatterValue& r, const std::string& op)
        {
            if (!l.isNumber() || !r.isNumber())
            {
                throw EvalError("'" + op + "' requires numeric operands, got " + TypeOf(l) + " and " + TypeOf(r));
            }
        }

        struct Evaluator
        {
            EvalContext& ctx;
            const Dialect& dialect;
            /** Per-scope missing-property policy, precomputed once per top-level
             *  evaluate. */
            std::unordered_map<std::string, MissingPolicy> missingPolicy;

            Evaluator(EvalContext& c, const Dialect& d) : ctx(c), dialect(d)
            {
                for (const auto& s : d.scopes) missingPolicy[s.token] = s.missing;
            }

            PatterValue rec(const AstPtr& n)
            {
                if (!n) throw EvalError("null expression node");
                switch (n->tag)
                {
                    case AstTag::Bool: return PatterValue::Bool(n->b);
                    case AstTag::Number: return PatterValue::Num(n->n);
                    case AstTag::Str: return PatterValue::Str(n->s);

                    case AstTag::ScopedVar:
                    {
                        auto it = ctx.scopes.find(n->scope);
                        if (it == ctx.scopes.end() || !it->second)
                        {
                            // Scope context absent -> graceful false.
                            return PatterValue::Bool(false);
                        }
                        std::optional<PatterValue> val = it->second->get(n->name);
                        if (!val.has_value())
                        {
                            // Property not declared on the present scope. Policy decides.
                            auto policy = missingPolicy.find(n->scope);
                            if (policy != missingPolicy.end() && policy->second == MissingPolicy::Throw)
                            {
                                throw EvalError("@" + n->scope + "." + n->name
                                    + " is not declared on the current " + n->scope + ".");
                            }
                            return PatterValue::Bool(false);
                        }
                        return *val;
                    }

                    case AstTag::Call:
                    {
                        // `advance` is the language's own: the next stage,
                        // saturating at the last. Core rather than dialect,
                        // because it IS the quality design's insertion
                        // mechanism. A dialect defining its own advance wins.
                        if (n->fn == "advance" && dialect.functions.find("advance") == dialect.functions.end())
                        {
                            if (n->args.size() != 1)
                            {
                                throw EvalError("advance() takes exactly 1 argument, got " + std::to_string(n->args.size()));
                            }
                            const std::vector<std::string>* ladder = LadderOf(n->args[0], ctx);
                            if (!ladder)
                            {
                                throw EvalError("advance() needs a quality reference (@scope.name of a quality property)");
                            }
                            const int current = StageIndex(rec(n->args[0]), *ladder, "advance");
                            const size_t next = std::min((size_t)current + 1, ladder->size() - 1);
                            return PatterValue::Str((*ladder)[next]);
                        }
                        auto def = dialect.functions.find(n->fn);
                        if (def == dialect.functions.end())
                        {
                            throw EvalError("unknown function '" + n->fn + "'");
                        }
                        EvalHelpers helpers;
                        helpers.evaluate = [this](const AstPtr& child) { return rec(child); };
                        helpers.ctx = &ctx;
                        return def->second.eval(n->args, helpers);
                    }

                    case AstTag::FlagDelta:
                        throw EvalError("flagdelta node is only valid as an argument to a flag-delta function");

                    case AstTag::Unary:
                    {
                        if (n->op == "not")
                        {
                            PatterValue val = rec(n->operand);
                            if (!val.isBool()) throw EvalError("'not' requires a boolean operand, got " + TypeOf(val));
                            return PatterValue::Bool(!val.asBool());
                        }
                        // neg
                        PatterValue operand = rec(n->operand);
                        if (!operand.isNumber()) throw EvalError("unary '-' requires a numeric operand, got " + TypeOf(operand));
                        return PatterValue::Num(-operand.asNumber());
                    }

                    case AstTag::Binary:
                    {
                        // Short-circuit operators first.
                        if (n->op == "and")
                        {
                            PatterValue l = rec(n->left);
                            if (!l.isBool()) throw EvalError("'and' requires boolean operands, left is " + TypeOf(l));
                            if (!l.asBool()) return PatterValue::Bool(false);
                            PatterValue r = rec(n->right);
                            if (!r.isBool()) throw EvalError("'and' requires boolean operands, right is " + TypeOf(r));
                            return r;
                        }
                        if (n->op == "or")
                        {
                            PatterValue l = rec(n->left);
                            if (!l.isBool()) throw EvalError("'or' requires boolean operands, left is " + TypeOf(l));
                            if (l.asBool()) return PatterValue::Bool(true);
                            PatterValue r = rec(n->right);
                            if (!r.isBool()) throw EvalError("'or' requires boolean operands, right is " + TypeOf(r));
                            return r;
                        }

                        PatterValue left = rec(n->left);
                        PatterValue right = rec(n->right);

                        // Quality: when either operand REFERENCES a quality,
                        // ordering compares by ladder position and arithmetic is
                        // refused; == and != stay plain value equality.
                        {
                            const std::vector<std::string>* lLadder = LadderOf(n->left, ctx);
                            const std::vector<std::string>* rLadder = LadderOf(n->right, ctx);
                            const std::vector<std::string>* ladder = lLadder ? lLadder : rLadder;
                            if (ladder)
                            {
                                const bool ordering = n->op == ">" || n->op == ">=" || n->op == "<" || n->op == "<=";
                                if (ordering && lLadder && rLadder && *lLadder != *rLadder)
                                {
                                    throw EvalError("'" + n->op + "' compares two different qualities, whose stage orders are unrelated");
                                }
                                if (ordering)
                                {
                                    const int li = StageIndex(left, *ladder, n->op);
                                    const int ri = StageIndex(right, *ladder, n->op);
                                    if (n->op == ">") return PatterValue::Bool(li > ri);
                                    if (n->op == ">=") return PatterValue::Bool(li >= ri);
                                    if (n->op == "<") return PatterValue::Bool(li < ri);
                                    return PatterValue::Bool(li <= ri);
                                }
                                if (n->op == "+" || n->op == "-" || n->op == "*" || n->op == "/")
                                {
                                    throw EvalError("'" + n->op + "' cannot be applied to a quality - a stage is a position, not a number; use advance() to move it");
                                }
                            }
                        }

                        if (n->op == "==") return PatterValue::Bool(left.valueEquals(right));
                        if (n->op == "!=") return PatterValue::Bool(!left.valueEquals(right));
                        if (n->op == ">")
                        {
                            AssertNumbers(left, right, ">");
                            return PatterValue::Bool(left.asNumber() > right.asNumber());
                        }
                        if (n->op == ">=")
                        {
                            AssertNumbers(left, right, ">=");
                            return PatterValue::Bool(left.asNumber() >= right.asNumber());
                        }
                        if (n->op == "<")
                        {
                            AssertNumbers(left, right, "<");
                            return PatterValue::Bool(left.asNumber() < right.asNumber());
                        }
                        if (n->op == "<=")
                        {
                            AssertNumbers(left, right, "<=");
                            return PatterValue::Bool(left.asNumber() <= right.asNumber());
                        }
                        if (n->op == "+")
                        {
                            if (left.isNumber() && right.isNumber()) return PatterValue::Num(left.asNumber() + right.asNumber());
                            if (left.isString() && right.isString()) return PatterValue::Str(left.asString() + right.asString());
                            throw EvalError("'+' requires two numbers or two strings, got " + TypeOf(left) + " and " + TypeOf(right));
                        }
                        if (n->op == "-")
                        {
                            AssertNumbers(left, right, "-");
                            return PatterValue::Num(left.asNumber() - right.asNumber());
                        }
                        if (n->op == "*")
                        {
                            AssertNumbers(left, right, "*");
                            return PatterValue::Num(left.asNumber() * right.asNumber());
                        }
                        if (n->op == "/")
                        {
                            AssertNumbers(left, right, "/");
                            if (right.asNumber() == 0) throw EvalError("division by zero");
                            return PatterValue::Num(left.asNumber() / right.asNumber());
                        }
                        throw EvalError("unknown operator '" + n->op + "'");
                    }

                    default:
                        throw EvalError("unknown expression node");
                }
            }
        };
    }

    inline PatterValue Evaluate(const AstPtr& node, EvalContext& ctx, const Dialect& dialect)
    {
        detail::Evaluator evaluator(ctx, dialect);
        return evaluator.rec(node);
    }
}
