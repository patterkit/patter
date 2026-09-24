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
// Part of the kernel, in wildwinter::expr with no product identity. Two
// header-only copies under ONE name would be an ODR violation the linker
// resolves silently, which is the worst failure mode available here because it
// is invisible, so the kernel's inline namespace is its content hash, its
// guards carry it, and a translation unit that sees two different kernels
// stops: see Errors.h and expr/docs/port-sharing.md.
//
// It needs only the rest of the kernel: ExprValue (Value.h), the AST (Ast.h),
// and ExprError (Errors.h), which is what every refusal here throws. A family
// catches ExprError where it evaluates and rethrows its own error type, so its
// games keep the catch they had. An error a dialect's own function throws
// passes through untouched.
//
// TRUTHINESS IS NOT HERE, on purpose. Turning a value into a condition's
// yes/no is applied to a condition rather than computed by the evaluator, so
// it lives in each family's own code.
// ---------------------------------------------------------------------------
#include "Errors.h"   // the kernel id tripwire, WILDWINTER_EXPR_VISIBLE, ExprError, RegistryError
// Compiled once per translation unit, and never beside a different kernel: Errors.h stops
// that build with an #error, and this copy then stays out of the way of the first.
#if !defined(WILDWINTER_EXPR_k11805ede_EXPR_H) && WILDWINTER_EXPR_KERNEL == 0x11805ede
#define WILDWINTER_EXPR_k11805ede_EXPR_H

#include <algorithm>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

#include "Value.h"
#include "Ast.h"

namespace wildwinter { namespace expr { inline namespace k11805ede
{
    /** A scope readable by the evaluator: a static bag or a host resolver.
     *  get returns nullopt when the property is not present (TS undefined). */
    class WILDWINTER_EXPR_VISIBLE IScopeSource
    {
    public:
        virtual ~IScopeSource() = default;
        virtual std::optional<ExprValue> get(const std::string& name) const = 0;
    };

    /** A scope backed by a plain callable, for a host that would rather write a
     *  lambda than a class. */
    class WILDWINTER_EXPR_VISIBLE FnScope : public IScopeSource
    {
    public:
        using Fn = std::function<std::optional<ExprValue>(const std::string&)>;
        explicit FnScope(Fn fn) : fn_(std::move(fn)) {}
        std::optional<ExprValue> get(const std::string& name) const override
        {
            return fn_ ? fn_(name) : std::nullopt;
        }
    private:
        Fn fn_;
    };

    /** Policy when a property is missing from a PRESENT scope: False resolves
     *  to false (the default), Throw raises an ExprError. A scope entirely
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
        std::function<ExprValue(const AstPtr&)> evaluate;
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
        std::function<ExprValue(const std::vector<AstPtr>&, EvalHelpers&)> eval;
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
    inline std::string TypeOf(const ExprValue& v)
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
        inline int StageIndex(const ExprValue& value, const std::vector<std::string>& ladder, const std::string& op)
        {
            if (!value.isString()) throw ExprError("'" + op + "' on a quality compares stages, got " + TypeOf(value));
            for (size_t i = 0; i < ladder.size(); i++) if (ladder[i] == value.asString()) return (int)i;
            std::string all;
            for (size_t i = 0; i < ladder.size(); i++) all += (i ? ", " : "") + ladder[i];
            throw ExprError("\"" + value.asString() + "\" is not a stage of this quality (stages: " + all + ")");
        }

        inline void AssertNumbers(const ExprValue& l, const ExprValue& r, const std::string& op)
        {
            if (!l.isNumber() || !r.isNumber())
            {
                throw ExprError("'" + op + "' requires numeric operands, got " + TypeOf(l) + " and " + TypeOf(r));
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

            ExprValue rec(const AstPtr& n)
            {
                if (!n) throw ExprError("null expression node");
                switch (n->tag)
                {
                    case AstTag::Bool: return ExprValue::Bool(n->b);
                    case AstTag::Number: return ExprValue::Num(n->n);
                    case AstTag::Str: return ExprValue::Str(n->s);

                    case AstTag::ScopedVar:
                    {
                        auto it = ctx.scopes.find(n->scope);
                        if (it == ctx.scopes.end() || !it->second)
                        {
                            // Scope context absent -> graceful false.
                            return ExprValue::Bool(false);
                        }
                        std::optional<ExprValue> val = it->second->get(n->name);
                        if (!val.has_value())
                        {
                            // Property not declared on the present scope. Policy decides.
                            auto policy = missingPolicy.find(n->scope);
                            if (policy != missingPolicy.end() && policy->second == MissingPolicy::Throw)
                            {
                                throw ExprError("@" + n->scope + "." + n->name
                                    + " is not declared on the current " + n->scope + ".");
                            }
                            return ExprValue::Bool(false);
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
                                throw ExprError("advance() takes exactly 1 argument, got " + std::to_string(n->args.size()));
                            }
                            const std::vector<std::string>* ladder = LadderOf(n->args[0], ctx);
                            if (!ladder)
                            {
                                throw ExprError("advance() needs a quality reference (@scope.name of a quality property)");
                            }
                            const int current = StageIndex(rec(n->args[0]), *ladder, "advance");
                            const size_t next = std::min((size_t)current + 1, ladder->size() - 1);
                            return ExprValue::Str((*ladder)[next]);
                        }
                        auto def = dialect.functions.find(n->fn);
                        if (def == dialect.functions.end())
                        {
                            throw ExprError("unknown function '" + n->fn + "'");
                        }
                        EvalHelpers helpers;
                        helpers.evaluate = [this](const AstPtr& child) { return rec(child); };
                        helpers.ctx = &ctx;
                        return def->second.eval(n->args, helpers);
                    }

                    case AstTag::FlagDelta:
                        throw ExprError("flagdelta node is only valid as an argument to a flag-delta function");

                    case AstTag::Unary:
                    {
                        if (n->op == "not")
                        {
                            ExprValue val = rec(n->operand);
                            if (!val.isBool()) throw ExprError("'not' requires a boolean operand, got " + TypeOf(val));
                            return ExprValue::Bool(!val.asBool());
                        }
                        // neg
                        ExprValue operand = rec(n->operand);
                        if (!operand.isNumber()) throw ExprError("unary '-' requires a numeric operand, got " + TypeOf(operand));
                        return ExprValue::Num(-operand.asNumber());
                    }

                    case AstTag::Binary:
                    {
                        // Short-circuit operators first.
                        if (n->op == "and")
                        {
                            ExprValue l = rec(n->left);
                            if (!l.isBool()) throw ExprError("'and' requires boolean operands, left is " + TypeOf(l));
                            if (!l.asBool()) return ExprValue::Bool(false);
                            ExprValue r = rec(n->right);
                            if (!r.isBool()) throw ExprError("'and' requires boolean operands, right is " + TypeOf(r));
                            return r;
                        }
                        if (n->op == "or")
                        {
                            ExprValue l = rec(n->left);
                            if (!l.isBool()) throw ExprError("'or' requires boolean operands, left is " + TypeOf(l));
                            if (l.asBool()) return ExprValue::Bool(true);
                            ExprValue r = rec(n->right);
                            if (!r.isBool()) throw ExprError("'or' requires boolean operands, right is " + TypeOf(r));
                            return r;
                        }

                        ExprValue left = rec(n->left);
                        ExprValue right = rec(n->right);

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
                                    throw ExprError("'" + n->op + "' compares two different qualities, whose stage orders are unrelated");
                                }
                                if (ordering)
                                {
                                    const int li = StageIndex(left, *ladder, n->op);
                                    const int ri = StageIndex(right, *ladder, n->op);
                                    if (n->op == ">") return ExprValue::Bool(li > ri);
                                    if (n->op == ">=") return ExprValue::Bool(li >= ri);
                                    if (n->op == "<") return ExprValue::Bool(li < ri);
                                    return ExprValue::Bool(li <= ri);
                                }
                                if (n->op == "+" || n->op == "-" || n->op == "*" || n->op == "/")
                                {
                                    throw ExprError("'" + n->op + "' cannot be applied to a quality - a stage is a position, not a number; use advance() to move it");
                                }
                            }
                        }

                        if (n->op == "==") return ExprValue::Bool(left.valueEquals(right));
                        if (n->op == "!=") return ExprValue::Bool(!left.valueEquals(right));
                        if (n->op == ">")
                        {
                            AssertNumbers(left, right, ">");
                            return ExprValue::Bool(left.asNumber() > right.asNumber());
                        }
                        if (n->op == ">=")
                        {
                            AssertNumbers(left, right, ">=");
                            return ExprValue::Bool(left.asNumber() >= right.asNumber());
                        }
                        if (n->op == "<")
                        {
                            AssertNumbers(left, right, "<");
                            return ExprValue::Bool(left.asNumber() < right.asNumber());
                        }
                        if (n->op == "<=")
                        {
                            AssertNumbers(left, right, "<=");
                            return ExprValue::Bool(left.asNumber() <= right.asNumber());
                        }
                        if (n->op == "+")
                        {
                            if (left.isNumber() && right.isNumber()) return ExprValue::Num(left.asNumber() + right.asNumber());
                            if (left.isString() && right.isString()) return ExprValue::Str(left.asString() + right.asString());
                            throw ExprError("'+' requires two numbers or two strings, got " + TypeOf(left) + " and " + TypeOf(right));
                        }
                        if (n->op == "-")
                        {
                            AssertNumbers(left, right, "-");
                            return ExprValue::Num(left.asNumber() - right.asNumber());
                        }
                        if (n->op == "*")
                        {
                            AssertNumbers(left, right, "*");
                            return ExprValue::Num(left.asNumber() * right.asNumber());
                        }
                        if (n->op == "/")
                        {
                            AssertNumbers(left, right, "/");
                            if (right.asNumber() == 0) throw ExprError("division by zero");
                            return ExprValue::Num(left.asNumber() / right.asNumber());
                        }
                        throw ExprError("unknown operator '" + n->op + "'");
                    }

                    default:
                        throw ExprError("unknown expression node");
                }
            }
        };
    }

    inline ExprValue Evaluate(const AstPtr& node, EvalContext& ctx, const Dialect& dialect)
    {
        detail::Evaluator evaluator(ctx, dialect);
        return evaluator.rec(node);
    }
}}} // namespace wildwinter::expr

#endif
