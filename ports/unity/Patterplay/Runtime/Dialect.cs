// The Patter expression dialect - port of @patterkit/dialect.
//
// Split out of Expression.cs on 2026-09-01: until then Patterplay fused its
// dialect into its evaluator in all three ports and had no Dialect.* file
// anywhere, which is the one thing that stopped the evaluator ever being shared
// with the Storylet Engine. The seam exists on their side (Dialect.h /
// Dialect.cs / dialect.gd) and now on ours, in the same shape.
//
// Scopes are declared EMPTY on purpose. Patter has no missing-property policy:
// a property absent from a present scope reads as a graceful false, which is
// the core's default when a scope carries no policy. The Storylet Engine
// declares its five scopes Throw because every property there has a declared
// default, so absence means a publish bug. Same evaluator, two configurations,
// which is the point.

using System;
using System.Collections.Generic;

namespace Patterkit.Patterplay
{
    /// <summary>Host callbacks the dialect's functions read at eval time. The
    /// context carries it as an opaque object; every function here casts it
    /// back.</summary>
    public sealed class PatterHost
    {
        public Func<double> NextRandom;
        public Func<string, int> Visits;
        public Func<string, int> PatterVisits;
    }

    public static class PatterDialect
    {
        private static readonly Dialect _dialect = Build();

        /// <summary>The dialect descriptor Expr.Evaluate consumes.</summary>
        public static Dialect Instance => _dialect;

        private static PatterHost HostOf(EvalHelpers h) => h.Ctx?.Host as PatterHost;

        private static List<string> ReadFlags(ExprNode[] args, EvalHelpers h, string fn)
        {
            if (args.Length == 0) throw new EvalError($"{fn}() requires at least one argument (the flags variable)");
            var v = h.Evaluate(args[0]);
            if (v.IsFlags) return new List<string>(v.AsFlags);
            // An unset flags property may surface as a graceful false; the empty
            // set is the right reading of that, not an error.
            if (v.IsBool && !v.AsBool) return new List<string>();
            throw new EvalError($"{fn}() first argument must be a flags property");
        }

        private static string NodeId(ExprNode[] args, EvalHelpers h, string fn)
        {
            if (args.Length < 1) throw new EvalError($"{fn}(id) requires a string node id");
            var v = h.Evaluate(args[0]);
            if (!v.IsString) throw new EvalError($"{fn}(id) requires a string node id");
            return v.AsString;
        }

        private static FunctionDef VisitFn(string name, bool shared, bool asBool) => new FunctionDef
        {
            MinArgs = 1,
            MaxArgs = 1,
            ReturnType = asBool ? "boolean" : "number",
            Eval = (args, h) =>
            {
                var host = HostOf(h);
                var cb = shared ? host?.PatterVisits : host?.Visits;
                int n = cb != null ? cb(NodeId(args, h, name)) : 0;
                return asBool ? PatterValue.Bool(n > 0) : PatterValue.Num(n);
            },
        };

        private static Dialect Build()
        {
            var d = new Dialect { DefaultScope = "patter" };
            // No scope declarations: Patter's missing-property policy is
            // graceful false everywhere, which is the core's default.

            d.Functions["random"] = new FunctionDef
            {
                MinArgs = 2, MaxArgs = 2, ReturnType = "number",
                Eval = (args, h) =>
                {
                    if (args.Length != 2) throw new EvalError("random(a, b) requires exactly 2 arguments");
                    var host = HostOf(h);
                    if (host?.NextRandom == null) throw new EvalError("random() called without a PRNG in context");
                    var a = h.Evaluate(args[0]);
                    var b = h.Evaluate(args[1]);
                    if (!a.IsNumber || !b.IsNumber) throw new EvalError("random(a, b) arguments must be numbers");
                    if (a.AsNumber != Math.Floor(a.AsNumber) || b.AsNumber != Math.Floor(b.AsNumber))
                        throw new EvalError("random(a, b) arguments must be integers");
                    double lo = Math.Min(a.AsNumber, b.AsNumber), hi = Math.Max(a.AsNumber, b.AsNumber);
                    return PatterValue.Num(Math.Floor(host.NextRandom() * (hi - lo + 1)) + lo);
                },
            };

            d.Functions["check_flags"] = new FunctionDef
            {
                MinArgs = 1, ReturnType = "boolean", FlagDeltaArgs = true,
                Eval = (args, h) =>
                {
                    var flags = ReadFlags(args, h, "check_flags");
                    for (int i = 1; i < args.Length; i++)
                    {
                        if (!(args[i] is FlagDeltaNode fd))
                            throw new EvalError("check_flags() flag args must be +flagName or -flagName");
                        bool has = flags.Contains(fd.Name);
                        if (fd.Sign == "+" ? !has : has) return PatterValue.False;
                    }
                    return PatterValue.True;
                },
            };

            d.Functions["set_flags"] = new FunctionDef
            {
                MinArgs = 1, ReturnType = "flags", FlagDeltaArgs = true,
                Eval = (args, h) =>
                {
                    var result = ReadFlags(args, h, "set_flags");
                    for (int i = 1; i < args.Length; i++)
                    {
                        if (!(args[i] is FlagDeltaNode fd))
                            throw new EvalError("set_flags() flag args must be +flagName or -flagName");
                        if (fd.Sign == "+") { if (!result.Contains(fd.Name)) result.Add(fd.Name); }
                        else { result.Remove(fd.Name); }
                    }
                    return PatterValue.Flags(result);
                },
            };

            d.Functions["visits"] = VisitFn("visits", false, false);
            d.Functions["seen"] = VisitFn("seen", false, true);
            d.Functions["patter_visits"] = VisitFn("patter_visits", true, false);
            d.Functions["patter_seen"] = VisitFn("patter_seen", true, true);
            return d;
        }
    }
}
