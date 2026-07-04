// The expression evaluator + the Patter dialect - a faithful port of
// @wildwinter/expr's evaluate.ts and @patterkit/dialect. Walks a compiled AstNode
// against an EvalContext (scope bags + host hooks for PRNG / visit counts), with the
// same operator typing, short-circuiting, value-equality, and built-in functions
// (random, check_flags, set_flags, seen, visits, patter_*). Verified against the
// conformance corpus's expression cases.

using System;
using System.Collections.Generic;

namespace Patterkit.Patterplay
{
    public sealed class EvalException : Exception
    {
        public EvalException(string message) : base(message) { }
    }

    /// <summary>A scope the evaluator reads from. A static bag wraps a dictionary; a host can
    /// supply a resolver for live game state (e.g. a foreign @world scope).</summary>
    public interface IScope
    {
        bool TryGet(string name, out PatterValue value);
    }

    public sealed class BagScope : IScope
    {
        private readonly Dictionary<string, PatterValue> _bag;
        public BagScope(Dictionary<string, PatterValue> bag) { _bag = bag; }
        public bool TryGet(string name, out PatterValue value) => _bag.TryGetValue(name, out value);
    }

    public sealed class ResolverScope : IScope
    {
        private readonly Func<string, PatterValue> _get; // returns null when absent
        public ResolverScope(Func<string, PatterValue> get) { _get = get; }
        public bool TryGet(string name, out PatterValue value) { value = _get(name); return value != null; }
    }

    public sealed class EvalContext
    {
        /// <summary>Scope token (e.g. "patter", "scene") -> the scope. A missing scope reads as false.</summary>
        public Dictionary<string, IScope> Scopes = new Dictionary<string, IScope>();
        /// <summary>Next float in [0,1) for random() - required only if an expression calls random().</summary>
        public Func<double> NextRandom;
        /// <summary>Times this flow entered a node (visits/seen). Null => 0.</summary>
        public Func<string, int> Visits;
        /// <summary>Times any flow entered a node, world-wide (patter_visits/patter_seen). Null => 0.</summary>
        public Func<string, int> PatterVisits;
        /// <summary>Scopes whose missing property is an error rather than graceful-false. Default: none.</summary>
        public HashSet<string> ThrowOnMissing = new HashSet<string>();
    }

    public static class Expr
    {
        public static PatterValue Evaluate(AstNode node, EvalContext ctx)
        {
            switch (node)
            {
                case BoolNode b: return PatterValue.Bool(b.Value);
                case NumberNode n: return PatterValue.Num(n.Value);
                case StringNode s: return PatterValue.Str(s.Value);

                case ScopedVar sv:
                {
                    if (!ctx.Scopes.TryGetValue(sv.Scope, out var scope) || scope == null)
                        return PatterValue.False; // scope context absent -> graceful false
                    if (!scope.TryGet(sv.Name, out var val) || val == null)
                    {
                        if (ctx.ThrowOnMissing.Contains(sv.Scope))
                            throw new EvalException($"@{sv.Scope}.{sv.Name} is not declared on the current {sv.Scope}.");
                        return PatterValue.False;
                    }
                    return val;
                }

                case Call call: return EvalCall(call, ctx);

                case FlagDelta _:
                    throw new EvalException("flagdelta node is only valid as an argument to a flag-delta function");

                case Unary u:
                {
                    if (u.Op == "not")
                    {
                        var v = Evaluate(u.Operand, ctx);
                        if (!v.IsBool) throw new EvalException($"'not' requires a boolean operand, got {Kind(v)}");
                        return PatterValue.Bool(!v.AsBool);
                    }
                    var num = Evaluate(u.Operand, ctx);
                    if (!num.IsNumber) throw new EvalException($"unary '-' requires a numeric operand, got {Kind(num)}");
                    return PatterValue.Num(-num.AsNumber);
                }

                case Binary bin: return EvalBinary(bin, ctx);

                default:
                    throw new EvalException("unknown ast node");
            }
        }

        private static PatterValue EvalBinary(Binary n, EvalContext ctx)
        {
            // Short-circuit operators first.
            if (n.Op == "and")
            {
                var l = Evaluate(n.Left, ctx);
                if (!l.IsBool) throw new EvalException($"'and' requires boolean operands, left is {Kind(l)}");
                if (!l.AsBool) return PatterValue.False;
                var r = Evaluate(n.Right, ctx);
                if (!r.IsBool) throw new EvalException($"'and' requires boolean operands, right is {Kind(r)}");
                return PatterValue.Bool(r.AsBool);
            }
            if (n.Op == "or")
            {
                var l = Evaluate(n.Left, ctx);
                if (!l.IsBool) throw new EvalException($"'or' requires boolean operands, left is {Kind(l)}");
                if (l.AsBool) return PatterValue.True;
                var r = Evaluate(n.Right, ctx);
                if (!r.IsBool) throw new EvalException($"'or' requires boolean operands, right is {Kind(r)}");
                return PatterValue.Bool(r.AsBool);
            }

            var left = Evaluate(n.Left, ctx);
            var right = Evaluate(n.Right, ctx);
            switch (n.Op)
            {
                case "==": return PatterValue.Bool(left.ValueEquals(right));
                case "!=": return PatterValue.Bool(!left.ValueEquals(right));
                case ">": AssertNumbers(left, right, ">"); return PatterValue.Bool(left.AsNumber > right.AsNumber);
                case ">=": AssertNumbers(left, right, ">="); return PatterValue.Bool(left.AsNumber >= right.AsNumber);
                case "<": AssertNumbers(left, right, "<"); return PatterValue.Bool(left.AsNumber < right.AsNumber);
                case "<=": AssertNumbers(left, right, "<="); return PatterValue.Bool(left.AsNumber <= right.AsNumber);
                case "+":
                    if (left.IsNumber && right.IsNumber) return PatterValue.Num(left.AsNumber + right.AsNumber);
                    if (left.IsString && right.IsString) return PatterValue.Str(left.AsString + right.AsString);
                    throw new EvalException($"'+' requires two numbers or two strings, got {Kind(left)} and {Kind(right)}");
                case "-": AssertNumbers(left, right, "-"); return PatterValue.Num(left.AsNumber - right.AsNumber);
                case "*": AssertNumbers(left, right, "*"); return PatterValue.Num(left.AsNumber * right.AsNumber);
                case "/":
                    AssertNumbers(left, right, "/");
                    if (right.AsNumber == 0) throw new EvalException("division by zero");
                    return PatterValue.Num(left.AsNumber / right.AsNumber);
                default:
                    throw new EvalException($"unknown operator '{n.Op}'");
            }
        }

        private static PatterValue EvalCall(Call call, EvalContext ctx)
        {
            switch (call.Name)
            {
                case "random":
                {
                    if (call.Args.Length != 2) throw new EvalException("random(a, b) requires exactly 2 arguments");
                    if (ctx.NextRandom == null) throw new EvalException("random() called without a PRNG in context");
                    var a = Evaluate(call.Args[0], ctx);
                    var b = Evaluate(call.Args[1], ctx);
                    if (!a.IsNumber || !b.IsNumber) throw new EvalException("random(a, b) arguments must be numbers");
                    if (a.AsNumber != Math.Floor(a.AsNumber) || b.AsNumber != Math.Floor(b.AsNumber))
                        throw new EvalException("random(a, b) arguments must be integers");
                    double lo = Math.Min(a.AsNumber, b.AsNumber), hi = Math.Max(a.AsNumber, b.AsNumber);
                    return PatterValue.Num(Math.Floor(ctx.NextRandom() * (hi - lo + 1)) + lo);
                }
                case "check_flags":
                {
                    var flags = ReadFlags(call.Args.Length > 0 ? call.Args[0] : null, ctx, "check_flags");
                    for (int i = 1; i < call.Args.Length; i++)
                    {
                        if (!(call.Args[i] is FlagDelta fd))
                            throw new EvalException("check_flags() flag args must be +flagName or -flagName");
                        bool has = flags.Contains(fd.Name);
                        if (fd.Sign == "+" ? !has : has) return PatterValue.False;
                    }
                    return PatterValue.True;
                }
                case "set_flags":
                {
                    var result = new List<string>(ReadFlags(call.Args.Length > 0 ? call.Args[0] : null, ctx, "set_flags"));
                    for (int i = 1; i < call.Args.Length; i++)
                    {
                        if (!(call.Args[i] is FlagDelta fd))
                            throw new EvalException("set_flags() flag args must be +flagName or -flagName");
                        if (fd.Sign == "+") { if (!result.Contains(fd.Name)) result.Add(fd.Name); }
                        else { result.Remove(fd.Name); }
                    }
                    return PatterValue.Flags(result);
                }
                case "visits": return PatterValue.Num(ctx.Visits != null ? ctx.Visits(NodeId(call, ctx, "visits")) : 0);
                case "seen": return PatterValue.Bool((ctx.Visits != null ? ctx.Visits(NodeId(call, ctx, "seen")) : 0) > 0);
                case "patter_visits": return PatterValue.Num(ctx.PatterVisits != null ? ctx.PatterVisits(NodeId(call, ctx, "patter_visits")) : 0);
                case "patter_seen": return PatterValue.Bool((ctx.PatterVisits != null ? ctx.PatterVisits(NodeId(call, ctx, "patter_seen")) : 0) > 0);
                default:
                    throw new EvalException($"unknown function '{call.Name}'");
            }
        }

        private static List<string> ReadFlags(AstNode arg, EvalContext ctx, string fn)
        {
            if (arg == null) throw new EvalException($"{fn}() requires at least one argument (the flags variable)");
            var v = Evaluate(arg, ctx);
            if (v.IsFlags) return new List<string>(v.AsFlags);
            if (v.IsBool && !v.AsBool) return new List<string>(); // empty flags
            throw new EvalException($"{fn}() first argument must be a flags property");
        }

        private static string NodeId(Call call, EvalContext ctx, string fn)
        {
            if (call.Args.Length < 1) throw new EvalException($"{fn}(id) requires a string node id");
            var v = Evaluate(call.Args[0], ctx);
            if (!v.IsString) throw new EvalException($"{fn}(id) requires a string node id");
            return v.AsString;
        }

        private static void AssertNumbers(PatterValue l, PatterValue r, string op)
        {
            if (!l.IsNumber || !r.IsNumber)
                throw new EvalException($"'{op}' requires numeric operands, got {Kind(l)} and {Kind(r)}");
        }

        private static string Kind(PatterValue v) => v.Kind switch
        {
            PatterKind.Bool => "boolean",
            PatterKind.Number => "number",
            PatterKind.Str => "string",
            PatterKind.Flags => "object",
            _ => "unknown",
        };
    }
}
