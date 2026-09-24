// GENERATED - vendored from expr/ports/unity/Expr.cs by scripts/vendor-ports.mjs.
// Do not edit here; edit the shared source and re-run the script.
// ---------------------------------------------------------------------------
// @wildwinter/expr - the evaluator, for Unity / C#. THE SHARED SOURCE.
//
// Authored in expr/ports/unity and VENDORED into each consuming package by
// expr/scripts/vendor-ports.mjs. Do not edit a vendored copy: CI regenerates
// it and fails on `git diff --exit-code`.
//
// Port of evaluate.ts + dialect.ts. Operators, short-circuiting and type
// checking are generic; scope resolution uses the context's scope sources plus
// the dialect's per-scope missing-property policy; calls dispatch to the
// dialect's functions.
//
// Part of the kernel assembly, which carries no product identity: how one
// kernel is shared by every product installed in a game is in Errors.cs and
// expr/docs/port-sharing.md. It needs only the rest of the kernel: ExprValue
// (Value.cs), the AST (Ast.cs), and ExprError (Errors.cs), which is what every
// refusal here throws. A family catches ExprError where it evaluates and
// rethrows its own error type, so its games keep the catch they had.
//
// TRUTHINESS IS NOT HERE, on purpose: turning a value into a condition's
// yes/no is applied to a condition rather than computed by the evaluator, so
// it lives in each family's own code.
// ---------------------------------------------------------------------------

using System;
using System.Collections.Generic;

namespace Wildwinter.Expr
{
    /// <summary>A scope readable by the evaluator: a static bag or a host
    /// resolver. Get returns null when the property is not present (TS
    /// undefined).</summary>
    public interface IScopeSource
    {
        ExprValue Get(string name);
    }

    public static class MissingPolicy
    {
        public const string False = "false";
        public const string Throw = "throw";
    }

    public sealed class ScopeDef
    {
        /// <summary>The scope token, e.g. "story" / "world" / "hand".</summary>
        public string Token;
        /// <summary>Policy when a property is missing from a PRESENT scope:
        /// "false" resolves to false (the default), "throw" raises an ExprError.
        /// A scope entirely absent from the EvalContext always resolves to false
        /// regardless.</summary>
        public string Missing;
    }

    public sealed class EvalContext
    {
        /// <summary>Values per scope token. A scope absent from this map resolves
        /// to false (graceful) for any reference.</summary>
        public readonly Dictionary<string, IScopeSource> Scopes = new Dictionary<string, IScopeSource>();
        /// <summary>Arbitrary host callbacks a Dialect's functions read at eval
        /// time (the storylets dialect casts to StoryletsHost). The core never
        /// inspects this.</summary>
        public object Host;
        /// <summary>The quality channel (design/quality.md): "is @scope.name a
        /// quality, and what is its ladder?" Null when the bundle declares no
        /// quality, and evaluation is then byte-identical to before.</summary>
        public Func<string, string, List<string>> Qualities;
    }

    public sealed class EvalHelpers
    {
        /// <summary>Evaluate a child node (for functions to evaluate their arguments).</summary>
        public Func<ExprNode, ExprValue> Evaluate;
        /// <summary>The active evaluation context (scopes + host).</summary>
        public EvalContext Ctx;
    }

    public sealed class FunctionDef
    {
        public int MinArgs;
        public int? MaxArgs;
        public string ReturnType;           // "boolean" | "number" | "string" | "flags" | "unknown"
        /// <summary>When true, trailing arguments (after the first) reach Eval as
        /// FlagDeltaNodes rather than expressions (check_flags / set_flags).</summary>
        public bool FlagDeltaArgs;
        /// <summary>Evaluate the call. Receives the RAW argument nodes (not
        /// pre-evaluated); implementations own their own arity/type checks.</summary>
        public Func<ExprNode[], EvalHelpers, ExprValue> Eval;
    }

    public sealed class Dialect
    {
        public List<ScopeDef> Scopes = new List<ScopeDef>();
        /// <summary>Bare `@name` is shorthand for `@&lt;defaultScope&gt;.name` (already
        /// resolved at compile time; kept for parity).</summary>
        public string DefaultScope;
        public Dictionary<string, FunctionDef> Functions = new Dictionary<string, FunctionDef>();
    }

    public static class Expr
    {
        public static ExprValue Evaluate(ExprNode node, EvalContext ctx, Dialect dialect)
        {
            // Per-scope missing-property policy, precomputed once per top-level evaluate.
            var missingPolicy = new Dictionary<string, string>();
            foreach (var s in dialect.Scopes) missingPolicy[s.Token] = s.Missing ?? MissingPolicy.False;

            ExprValue Rec(ExprNode n)
            {
                switch (n)
                {
                    case BoolNode b: return ExprValue.Bool(b.Value);
                    case NumberNode num: return ExprValue.Num(num.Value);
                    case StringNode str: return ExprValue.Str(str.Value);

                    case ScopedVarNode sv:
                    {
                        if (!ctx.Scopes.TryGetValue(sv.Scope, out var scope) || scope == null)
                        {
                            // Scope context absent -> graceful false.
                            return ExprValue.False;
                        }
                        var val = scope.Get(sv.Name);
                        if (val == null)
                        {
                            // Property not declared on the present scope. Policy decides.
                            if (missingPolicy.TryGetValue(sv.Scope, out var policy) && policy == MissingPolicy.Throw)
                            {
                                throw new ExprError($"@{sv.Scope}.{sv.Name} is not declared on the current {sv.Scope}.");
                            }
                            return ExprValue.False;
                        }
                        return val;
                    }

                    case CallNode call:
                    {
                        // `advance` is the language's own (quality.md): the next
                        // stage in the argument's ladder, saturating at the last.
                        // A dialect defining its own advance still wins.
                        if (call.Name == "advance" && !dialect.Functions.ContainsKey("advance"))
                        {
                            if (call.Args.Length != 1)
                            {
                                throw new ExprError($"advance() takes exactly 1 argument, got {call.Args.Length}");
                            }
                            var ladder = LadderOf(call.Args[0], ctx);
                            if (ladder == null)
                            {
                                throw new ExprError("advance() needs a quality reference (@scope.name of a quality property)");
                            }
                            var current = StageIndex(Rec(call.Args[0]), ladder, "advance");
                            return ExprValue.Str(ladder[Math.Min(current + 1, ladder.Count - 1)]);
                        }
                        if (!dialect.Functions.TryGetValue(call.Name, out var def))
                        {
                            throw new ExprError($"unknown function '{call.Name}'");
                        }
                        return def.Eval(call.Args, new EvalHelpers { Evaluate = Rec, Ctx = ctx });
                    }

                    case FlagDeltaNode _:
                        throw new ExprError("flagdelta node is only valid as an argument to a flag-delta function");

                    case UnaryNode u:
                    {
                        if (u.Op == "not")
                        {
                            var val = Rec(u.Operand);
                            if (!val.IsBool) throw new ExprError($"'not' requires a boolean operand, got {TypeOf(val)}");
                            return ExprValue.Bool(!val.AsBool);
                        }
                        // neg
                        var operand = Rec(u.Operand);
                        if (!operand.IsNumber) throw new ExprError($"unary '-' requires a numeric operand, got {TypeOf(operand)}");
                        return ExprValue.Num(-operand.AsNumber);
                    }

                    case BinaryNode bin:
                    {
                        // Short-circuit operators first.
                        if (bin.Op == "and")
                        {
                            var l = Rec(bin.Left);
                            if (!l.IsBool) throw new ExprError($"'and' requires boolean operands, left is {TypeOf(l)}");
                            if (!l.AsBool) return ExprValue.False;
                            var r = Rec(bin.Right);
                            if (!r.IsBool) throw new ExprError($"'and' requires boolean operands, right is {TypeOf(r)}");
                            return r;
                        }
                        if (bin.Op == "or")
                        {
                            var l = Rec(bin.Left);
                            if (!l.IsBool) throw new ExprError($"'or' requires boolean operands, left is {TypeOf(l)}");
                            if (l.AsBool) return ExprValue.True;
                            var r = Rec(bin.Right);
                            if (!r.IsBool) throw new ExprError($"'or' requires boolean operands, right is {TypeOf(r)}");
                            return r;
                        }

                        var left = Rec(bin.Left);
                        var right = Rec(bin.Right);

                        // Quality (quality.md): when either operand REFERENCES a
                        // quality, ordering compares by ladder position and
                        // arithmetic is refused. == and != fall through to plain
                        // value equality, unchanged.
                        var lLadder = LadderOf(bin.Left, ctx);
                        var rLadder = LadderOf(bin.Right, ctx);
                        var ladderQ = lLadder ?? rLadder;
                        if (ladderQ != null)
                        {
                            bool ordering = bin.Op == ">" || bin.Op == ">=" || bin.Op == "<" || bin.Op == "<=";
                            if (ordering && lLadder != null && rLadder != null && !SameLadder(lLadder, rLadder))
                            {
                                throw new ExprError($"'{bin.Op}' compares two different qualities, whose stage orders are unrelated");
                            }
                            switch (bin.Op)
                            {
                                case ">": return ExprValue.Bool(StageIndex(left, ladderQ, ">") > StageIndex(right, ladderQ, ">"));
                                case ">=": return ExprValue.Bool(StageIndex(left, ladderQ, ">=") >= StageIndex(right, ladderQ, ">="));
                                case "<": return ExprValue.Bool(StageIndex(left, ladderQ, "<") < StageIndex(right, ladderQ, "<"));
                                case "<=": return ExprValue.Bool(StageIndex(left, ladderQ, "<=") <= StageIndex(right, ladderQ, "<="));
                                case "+": case "-": case "*": case "/":
                                    throw new ExprError($"'{bin.Op}' cannot be applied to a quality - a stage is a position, not a number; use advance() to move it");
                            }
                        }

                        switch (bin.Op)
                        {
                            case "==": return ExprValue.Bool(left.ValueEquals(right));
                            case "!=": return ExprValue.Bool(!left.ValueEquals(right));
                            case ">": AssertNumbers(left, right, ">"); return ExprValue.Bool(left.AsNumber > right.AsNumber);
                            case ">=": AssertNumbers(left, right, ">="); return ExprValue.Bool(left.AsNumber >= right.AsNumber);
                            case "<": AssertNumbers(left, right, "<"); return ExprValue.Bool(left.AsNumber < right.AsNumber);
                            case "<=": AssertNumbers(left, right, "<="); return ExprValue.Bool(left.AsNumber <= right.AsNumber);
                            case "+":
                                if (left.IsNumber && right.IsNumber) return ExprValue.Num(left.AsNumber + right.AsNumber);
                                if (left.IsString && right.IsString) return ExprValue.Str(left.AsString + right.AsString);
                                throw new ExprError($"'+' requires two numbers or two strings, got {TypeOf(left)} and {TypeOf(right)}");
                            case "-": AssertNumbers(left, right, "-"); return ExprValue.Num(left.AsNumber - right.AsNumber);
                            case "*": AssertNumbers(left, right, "*"); return ExprValue.Num(left.AsNumber * right.AsNumber);
                            case "/":
                                AssertNumbers(left, right, "/");
                                if (right.AsNumber == 0) throw new ExprError("division by zero");
                                return ExprValue.Num(left.AsNumber / right.AsNumber);
                            default:
                                throw new ExprError($"unknown operator '{bin.Op}'");
                        }
                    }

                    default:
                        throw new ExprError("unknown expression node");
                }
            }

            return Rec(node);
        }

        /// <summary>JS typeof for error messages (a flags array is "object").</summary>
        internal static string TypeOf(ExprValue v)
        {
            if (v.IsBool) return "boolean";
            if (v.IsNumber) return "number";
            if (v.IsString) return "string";
            return "object";
        }

        /// <summary>The ladder behind an operand NODE, when the context's quality
        /// channel says it references one. Values are plain strings; the node is
        /// what carries the scope+name the channel needs.</summary>
        private static List<string> LadderOf(ExprNode node, EvalContext ctx)
        {
            if (ctx.Qualities == null || !(node is ScopedVarNode sv)) return null;
            return ctx.Qualities(sv.Scope, sv.Name);
        }

        /// <summary>Index of a stage in a ladder; an unknown stage is an error
        /// naming the value (a drifted save is exactly what lands here).</summary>
        private static int StageIndex(ExprValue value, List<string> ladder, string op)
        {
            if (!value.IsString) throw new ExprError($"'{op}' on a quality compares stages, got {TypeOf(value)}");
            var i = ladder.IndexOf(value.AsString);
            if (i < 0) throw new ExprError($"\"{value.AsString}\" is not a stage of this quality (stages: {string.Join(", ", ladder)})");
            return i;
        }

        private static bool SameLadder(List<string> a, List<string> b)
        {
            if (a.Count != b.Count) return false;
            for (int i = 0; i < a.Count; i++) if (a[i] != b[i]) return false;
            return true;
        }

        private static void AssertNumbers(ExprValue l, ExprValue r, string op)
        {
            if (!l.IsNumber || !r.IsNumber)
            {
                throw new ExprError($"'{op}' requires numeric operands, got {TypeOf(l)} and {TypeOf(r)}");
            }
        }
    }
}
