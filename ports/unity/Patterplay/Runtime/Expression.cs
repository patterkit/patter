// The Patter expression evaluator: a thin shim over the SHARED implementation.
//
// The algorithm lives once, in expr/ports/unity/Expr.cs, vendored beside this
// file as Expr/Expr.cs. It brings in IScopeSource, MissingPolicy, ScopeDef,
// EvalContext, EvalHelpers, FunctionDef, Dialect and Expr.Evaluate, all
// directly into this package's namespace.
//
// Shipping the shared code as its own assembly definition would break the
// moment a game installed both this and the Storylet Engine, because Unity
// requires asmdef names to be unique project-wide. So it lives inside this
// package's own Runtime asmdef. Identity belongs to the installing package,
// never to the shared source. See expr/docs/port-sharing.md.
//
// Patter's own built-ins (random / check_flags / set_flags / seen / visits /
// patter_*) are Dialect.cs. What stays here is the error type, which the shared
// source expects the family to provide, and the two scope adapters.

using System;
using System.Collections.Generic;

namespace Patterkit.Patterplay
{
    /// <summary>An expression that cannot be evaluated. The shared evaluator
    /// throws this, which is why it is declared here rather than there.
    /// Renamed from EvalException on 2026-09-01, so both families spell it the
    /// same and one evaluator can throw it.</summary>
    public sealed class EvalError : Exception
    {
        public EvalError(string message) : base(message) { }
    }

    /// <summary>A static bag scope over a plain dictionary.</summary>
    public sealed class BagScope : IScopeSource
    {
        private readonly Dictionary<string, PatterValue> _bag;
        public BagScope(Dictionary<string, PatterValue> bag) { _bag = bag; }
        public PatterValue Get(string name) => _bag.TryGetValue(name, out var v) ? v : null;
    }

    /// <summary>A scope backed by a host callback.</summary>
    public sealed class ResolverScope : IScopeSource
    {
        private readonly Func<string, PatterValue> _get;
        public ResolverScope(Func<string, PatterValue> get) { _get = get; }
        public PatterValue Get(string name) => _get(name);
    }
}
