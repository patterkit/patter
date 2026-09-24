// GENERATED - vendored from expr/ports/unreal/Errors.h by scripts/vendor-ports.mjs.
// Do not edit here; edit the shared source and re-run the script.
// ---------------------------------------------------------------------------
// The kernel's own errors, and how the kernel is kept ONE type, for Unreal /
// std C++. THE SHARED SOURCE.
//
// Authored in expr/ports/unreal and VENDORED into each consuming plugin by
// expr/scripts/vendor-ports.mjs. Do not edit a vendored copy.
//
// THE KERNEL. Value, OrderedMap, Ast, Expr, Specificity, Mulberry32,
// PropertyBag, StateLogger, ScopeRegistry, Fwd and this file are one kernel,
// in one namespace (wildwinter::expr), with no product identity in it. Every
// product vendors it byte-identical, and a game that includes two products'
// copies in one translation unit compiles each class once. So ExprValue and
// ScopeRegistry are one type in a game, and one registry object can be handed
// to every engine in it.
//
// A header-only kernel is compiled again by every module that includes it,
// so these rules hold it together, and each is enforced here rather than
// hoped for:
//
//   - The inline namespace is the kernel ID: a content hash of these headers,
//     stamped by the vendor script at copy time and identical in every
//     product. Two different kernels are two different types, never a silent
//     mix of the two.
//   - The include guards carry the ID, in place of #pragma once, which would
//     let the second plugin's copy of a file compile a second time.
//   - Every kernel header includes this file ABOVE its own guard, and the
//     tripwire below, outside this file's guard, stops a translation unit
//     that has already seen a different kernel ID. Without it, two copies that
//     differ would build and then misbehave instead of failing. The macro it
//     checks, WILDWINTER_EXPR_KERNEL, keeps that name in every kernel version
//     (as does WILDWINTER_EXPR_KERNEL_CLASH, which says it once), so an old
//     copy and a new one always meet here. Every guard also checks that macro,
//     so the second kernel compiles nothing and the #error is the only error
//     the build reports.
//   - The errors and every polymorphic type are WILDWINTER_EXPR_VISIBLE. An
//     Unreal editor loads each module as its own library, and a type hidden in
//     each of them can be two types to a catch.
//   - No process-wide state lives in an inline or a function-local static.
//     Statics are per module in an editor and shared in a packaged game, so
//     state held in one would behave differently in each. State lives in the
//     object that owns it: the registry, a bag, a logger.
//
// The kernel cannot throw a product's error type, so it throws these two:
// ExprError from evaluation and the AST reader, RegistryError from the
// registry, a property bag and the ordered map beneath them. A product
// catches them where it calls the kernel and rethrows its own (Patterplay's
// EvalError; the Storylet Engine's EvalError and StoryletError), keeping the
// message, so a game's existing catch keeps working and no kernel exception
// crosses a plugin's public API. A game calling the registry itself sees
// RegistryError.
// ---------------------------------------------------------------------------
#if defined(WILDWINTER_EXPR_KERNEL) && WILDWINTER_EXPR_KERNEL != 0x11805ede && !defined(WILDWINTER_EXPR_KERNEL_CLASH)
#define WILDWINTER_EXPR_KERNEL_CLASH   // said once per translation unit, not once per header
#error "Two different wildwinter::expr kernels in one translation unit (this copy is kernel k11805ede). The Patterplay and Storylet Engine plugins must be built from the same kernel: update the older plugin."
#endif
// The first kernel a translation unit sees claims it; a different one after it compiles
// nothing, so the #error above is the whole of the failure rather than the first of hundreds.
#if !defined(WILDWINTER_EXPR_k11805ede_ERRORS_H) && (!defined(WILDWINTER_EXPR_KERNEL) || WILDWINTER_EXPR_KERNEL == 0x11805ede)
#define WILDWINTER_EXPR_k11805ede_ERRORS_H
#define WILDWINTER_EXPR_KERNEL 0x11805ede

#include <stdexcept>
#include <string>

/** Default symbol visibility, for the errors and every polymorphic kernel
 *  type. Unreal's macOS build uses -fvisibility-ms-compat, which keeps a
 *  type's identity visible across modules, but plain -fvisibility=hidden does
 *  not, and a catch in one module then misses an error thrown in another
 *  (both proven in the route H prototype, 2026-09-24). Empty where there is no
 *  such attribute: MSVC matches a type by its name. */
#ifndef WILDWINTER_EXPR_VISIBLE
#if (defined(__GNUC__) || defined(__clang__)) && !defined(_WIN32)
#define WILDWINTER_EXPR_VISIBLE __attribute__((visibility("default")))
#else
#define WILDWINTER_EXPR_VISIBLE
#endif
#endif

namespace wildwinter { namespace expr { inline namespace k11805ede
{
    /** An expression that cannot be evaluated: a type error, an unknown
     *  operator or function, a malformed AST node, a division by zero. */
    class WILDWINTER_EXPR_VISIBLE ExprError : public std::runtime_error
    {
    public:
        explicit ExprError(const std::string& message) : std::runtime_error(message) {}
    };

    /** A refusal from the registry, a property bag or the ordered map beneath
     *  them: a clashing or unknown scope, a write to a read-only property, a
     *  malformed registry spec, a missing key. */
    class WILDWINTER_EXPR_VISIBLE RegistryError : public std::runtime_error
    {
    public:
        explicit RegistryError(const std::string& message) : std::runtime_error(message) {}
    };
}}} // namespace wildwinter::expr

#endif
