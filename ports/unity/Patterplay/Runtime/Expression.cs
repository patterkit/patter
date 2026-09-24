// The Patter expression evaluator: a thin shim over the SHARED implementation.
//
// The algorithm lives once, in expr/ports/unity/Expr.cs, vendored beside this
// file as Expr/Expr.cs. It is part of the expression kernel (namespace
// Wildwinter.Expr: ExprValue, IScopeSource, EvalContext, Dialect, Expr.Evaluate,
// ScopeRegistry, and the rest), which sits in its own assembly definition,
// Patterplay.Expr. The kernel is ONE type in a game: installed beside the
// Storylet Engine, which carries the same kernel, it compiles once, here, so
// both engines can be handed one registry. See expr/docs/port-sharing.md.
//
// Patter's own built-ins (random / check_flags / set_flags / seen / visits /
// patter_*) are Dialect.cs. What stays here is Patterplay's error type, the
// rethrow of the kernel's own errors as it, and the two scope adapters.

using System;
using System.Collections.Generic;
using Wildwinter.Expr;

namespace Patterkit.Patterplay
{
    /// <summary>An expression that cannot be evaluated, or a refused registry
    /// operation (a clashing scope, a story write to a read-only property). What
    /// Patterplay's API throws: the kernel's own ExprError and RegistryError are
    /// rethrown as this, with the same message, wherever the engine calls the
    /// kernel.</summary>
    public sealed class EvalError : Exception
    {
        public EvalError(string message) : base(message) { }
        internal EvalError(string message, Exception inner) : base(message, inner) { }
    }

    /// <summary>The kernel's errors, as Patterplay's. Every call from the engine
    /// into the kernel that can refuse catches with <c>when (KernelErrors.Is(e))</c>
    /// and throws <c>KernelErrors.As(e)</c>, so a game's <c>catch (EvalError)</c>
    /// keeps working. A game calling the registry itself sees RegistryError.</summary>
    internal static class KernelErrors
    {
        internal static bool Is(Exception e) => e is ExprError || e is RegistryError;
        internal static EvalError As(Exception e) => new EvalError(e.Message, e);
    }

    /// <summary>A static bag scope over a plain dictionary.</summary>
    public sealed class BagScope : IScopeSource
    {
        private readonly Dictionary<string, ExprValue> _bag;
        public BagScope(Dictionary<string, ExprValue> bag) { _bag = bag; }
        public ExprValue Get(string name) => _bag.TryGetValue(name, out var v) ? v : null;
    }

    /// <summary>A scope backed by a host callback.</summary>
    public sealed class ResolverScope : IScopeSource
    {
        private readonly Func<string, ExprValue> _get;
        public ResolverScope(Func<string, ExprValue> get) { _get = get; }
        public ExprValue Get(string name) => _get(name);
    }
}
