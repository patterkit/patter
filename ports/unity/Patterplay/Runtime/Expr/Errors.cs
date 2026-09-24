// GENERATED - vendored from expr/ports/unity/Errors.cs by scripts/vendor-ports.mjs.
// Do not edit here; edit the shared source and re-run the script.
// ---------------------------------------------------------------------------
// The kernel's own errors, for Unity / C#. THE SHARED SOURCE.
//
// Authored in expr/ports/unity and VENDORED into each consuming package by
// expr/scripts/vendor-ports.mjs. Do not edit a vendored copy.
//
// THE KERNEL. Value, OrderedMap, Ast, Expr, Specificity, Mulberry32,
// PropertyBag, StateLogger, ScopeRegistry, and this file are one kernel, in
// one namespace (Wildwinter.Expr), with no product identity in it. Every
// product vendors it byte-identical into its own kernel assembly definition
// (Patterplay.Expr, StoryletEngine.Expr), and a game with more than one
// product installed compiles it ONCE: one product hosts the kernel, and every
// other product's kernel assembly switches itself off when a new enough host
// is installed (a defineConstraints entry on a versionDefines symbol, written
// by the vendor script). So ExprValue and ScopeRegistry are one type in a
// game, and one registry object can be handed to every engine in it.
//
// Because every product runs on whichever kernel the host ships, changes
// within a kernel version are additive only.
//
// The kernel cannot throw a product's error type, so it throws these two. A
// product catches them where it calls the kernel and rethrows its own
// (Patterplay's EvalError, the Storylet Engine's StoryletError), keeping the
// message, so a game's existing catch keeps working. A game calling the
// registry directly sees RegistryError.
// ---------------------------------------------------------------------------

using System;

namespace Wildwinter.Expr
{
    /// <summary>An expression that cannot be evaluated: a type error, an unknown
    /// operator or function, a malformed AST node, a division by zero.</summary>
    public sealed class ExprError : Exception
    {
        public ExprError(string message) : base(message) { }
    }

    /// <summary>A refusal from the registry or a property bag: a clashing or
    /// unknown scope, a write to a read-only property, a malformed registry
    /// spec.</summary>
    public sealed class RegistryError : Exception
    {
        public RegistryError(string message) : base(message) { }
    }
}
