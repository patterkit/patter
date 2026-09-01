// GENERATED - vendored from expr/ports/unity/Specificity.cs by scripts/vendor-ports.mjs.
// Do not edit here; edit the shared source and re-run the script.
// ---------------------------------------------------------------------------
// @wildwinter/expr-specificity - for Unity / C#. THE SHARED SOURCE.
//
// Authored in expr/ports/unity and VENDORED into each consuming package by
// expr/scripts/vendor-ports.mjs. Do not edit a vendored copy.
//
// Lands in the package's own namespace, inside its existing Runtime asmdef.
//
// A PURER shared thing than the evaluator: no value type, no dialect, no
// scopes. Just an AST walk plus a truthiness callback the host supplies, which
// is exactly why truthiness being host policy does not stop it being shared.
// ---------------------------------------------------------------------------

using System;
using System.Collections.Generic;

namespace Patterkit.Patterplay
{
    /// <summary>Evaluate an expression subtree to a boolean, with the host's own
    /// truthiness coercion (storylets' conditionPasses).</summary>
    public delegate bool EvalTruthy(ExprNode node);

    /// <summary>A call treated as a conjunction of constraints rather than a
    /// single atom, so it contributes its operand count instead of 1.</summary>
    public sealed class CountingCall
    {
        /// <summary>The function name this rule applies to.</summary>
        public string Name;
        /// <summary>How many constraints the call contributes when it holds (at least 1).</summary>
        public Func<CallNode, int> Count;
    }

    public static class Specificity
    {
        /// <summary>check_flags(v, f1..fN) counts as N constraints - an N-ary AND
        /// over the flag operands - never fewer than 1.</summary>
        public static readonly CountingCall CHECK_FLAGS_COUNTING_CALL = new CountingCall
        {
            Name = "check_flags",
            Count = node => Math.Max(1, node.Args.Length - 1),
        };

        private static readonly CountingCall[] DefaultCountingCalls = { CHECK_FLAGS_COUNTING_CALL };

        /// <summary>Score how many atomic constraints in `node` are actively
        /// holding it true against current state, via `evalTruthy`. `want` is the
        /// root polarity (production only scores conditions already known
        /// eligible, so it defaults to true).</summary>
        public static int MatchedSpecificity(
            ExprNode node,
            EvalTruthy evalTruthy,
            bool want = true,
            IReadOnlyList<CountingCall> countingCalls = null)
        {
            return Walk(node, want, evalTruthy, countingCalls ?? DefaultCountingCalls);
        }

        private static int Walk(
            ExprNode node,
            bool want,
            EvalTruthy evalTruthy,
            IReadOnlyList<CountingCall> countingCalls)
        {
            if (node is BinaryNode bin && (bin.Op == "and" || bin.Op == "or"))
            {
                var l = Walk(bin.Left, want, evalTruthy, countingCalls);
                var r = Walk(bin.Right, want, evalTruthy, countingCalls);
                // De Morgan: an `and` under negation behaves like an `or`, and vice versa.
                var behaveAsAnd = (bin.Op == "and") == want;
                if (behaveAsAnd) return l > 0 && r > 0 ? l + r : 0;   // both must hold -> sum
                return Math.Max(l, r);                                // either holds -> strongest branch
            }
            if (node is UnaryNode u && u.Op == "not")
            {
                return Walk(u.Operand, !want, evalTruthy, countingCalls);
            }
            if (node is CallNode call)
            {
                CountingCall rule = null;
                foreach (var c in countingCalls)
                {
                    if (c.Name == call.Name) { rule = c; break; }
                }
                if (rule != null)
                {
                    var operands = rule.Count(call);
                    var callHolds = evalTruthy(call);
                    if (want) return callHolds ? operands : 0;
                    return callHolds ? 0 : 1;   // negated: De Morgan -> at least one operand fails -> 1
                }
            }
            // Any other node is an atom worth one constraint when its truth matches want.
            return evalTruthy(node) == want ? 1 : 0;
        }
    }
}
