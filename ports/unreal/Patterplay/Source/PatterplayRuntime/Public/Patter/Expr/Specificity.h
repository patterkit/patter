// GENERATED - vendored from expr/ports/unreal/Specificity.h by scripts/vendor-ports.mjs.
// Do not edit here; edit the shared source and re-run the script.
// ---------------------------------------------------------------------------
// @wildwinter/expr-specificity - for Unreal / std C++. THE SHARED SOURCE.
//
// Authored in expr/ports/unreal and VENDORED into each consuming plugin by
// expr/scripts/vendor-ports.mjs. Do not edit a vendored copy.
//
// Lands in the plugin's own namespace, so two installed plugins never collide.
//
// A PURER shared thing than the evaluator: no value type, no dialect, no
// scopes. Just an AST walk plus a truthiness callback the host supplies, which
// is exactly why truthiness being host policy does not stop it being shared.
// ---------------------------------------------------------------------------
#pragma once

#include <algorithm>
#include <functional>
#include <string>
#include <vector>

#include "Patter/Expr/Ast.h"

namespace patter
{
    /** Evaluate an expression subtree to a boolean, with the host's own
     *  truthiness coercion (storylets' conditionPasses). */
    using EvalTruthy = std::function<bool(const AstPtr&)>;

    /** A call treated as a conjunction of constraints rather than a single
     *  atom, so it contributes its operand count instead of 1. */
    struct CountingCall
    {
        /** The function name this rule applies to. */
        std::string name;
        /** How many constraints the call contributes when it holds (at least 1). */
        std::function<int(const AstNode&)> count;
    };

    namespace detail
    {
        /** check_flags(v, f1..fN) counts as N constraints - an N-ary AND over
         *  the flag operands - never fewer than 1. */
        inline const std::vector<CountingCall>& DefaultCountingCalls()
        {
            static const std::vector<CountingCall> calls = {
                CountingCall{
                    "check_flags",
                    [](const AstNode& node)
                    {
                        return std::max(1, static_cast<int>(node.args.size()) - 1);
                    },
                },
            };
            return calls;
        }

        inline int SpecificityWalk(
            const AstPtr& node,
            bool want,
            const EvalTruthy& evalTruthy,
            const std::vector<CountingCall>& countingCalls)
        {
            if (node->tag == AstTag::Binary && (node->op == "and" || node->op == "or"))
            {
                int l = SpecificityWalk(node->left, want, evalTruthy, countingCalls);
                int r = SpecificityWalk(node->right, want, evalTruthy, countingCalls);
                // De Morgan: an `and` under negation behaves like an `or`, and vice versa.
                bool behaveAsAnd = (node->op == "and") == want;
                if (behaveAsAnd) return l > 0 && r > 0 ? l + r : 0;   // both must hold -> sum
                return std::max(l, r);                                // either holds -> strongest branch
            }
            if (node->tag == AstTag::Unary && node->op == "not")
            {
                return SpecificityWalk(node->operand, !want, evalTruthy, countingCalls);
            }
            if (node->tag == AstTag::Call)
            {
                const CountingCall* rule = nullptr;
                for (const auto& c : countingCalls)
                {
                    if (c.name == node->fn)
                    {
                        rule = &c;
                        break;
                    }
                }
                if (rule)
                {
                    int operands = rule->count(*node);
                    bool callHolds = evalTruthy(node);
                    if (want) return callHolds ? operands : 0;
                    return callHolds ? 0 : 1;   // negated: De Morgan -> at least one operand fails -> 1
                }
            }
            // Any other node is an atom worth one constraint when its truth matches want.
            return evalTruthy(node) == want ? 1 : 0;
        }
    }

    /** Score how many atomic constraints in `node` are actively holding it
     *  true against current state, via `evalTruthy`. `want` is the root
     *  polarity (production only scores conditions already known eligible, so
     *  it defaults to true). */
    inline int MatchedSpecificity(
        const AstPtr& node,
        const EvalTruthy& evalTruthy,
        bool want = true,
        const std::vector<CountingCall>* countingCalls = nullptr)
    {
        return detail::SpecificityWalk(node, want, evalTruthy,
            countingCalls ? *countingCalls : detail::DefaultCountingCalls());
    }
}
