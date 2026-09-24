// The shared kernel, as Patterplay sees it.
//
// The kernel (the expression evaluator, the AST, the property bag, the state logger core and the
// one registry per game) is vendored from expr/ports/unreal to Expr/ beside this, byte-identical
// to the Storylet Engine's copy, in the namespace wildwinter::expr. A game that includes both
// plugins compiles it once, so a ScopeRegistry made for one engine IS the other's too.
//
// This header brings every kernel name into `patter`, so Patterplay's code and a game's
// (`patter::ScopeRegistry`, `patter::PropertyBag`, `patter::Evaluate`) read as they did when the
// kernel was stamped into this namespace, and it holds the one rule for kernel errors: the engine
// catches them where it calls the kernel and rethrows them as its own EvalError (kernelCall), so
// none crosses the plugin's API.
//
// Needs exceptions (bEnableExceptions in the including module's Build.cs), as the kernel throws.
// A header that only names the types includes Patter/PatterValue.h instead.
#pragma once

#include "Patter/PatterValue.h"
#include "Patter/Expr/Errors.h"
#include "Patter/Expr/Value.h"
#include "Patter/Expr/OrderedMap.h"
#include "Patter/Expr/Ast.h"
#include "Patter/Expr/Expr.h"
#include "Patter/Expr/Specificity.h"
#include "Patter/Expr/Mulberry32.h"
#include "Patter/Expr/PropertyBag.h"
#include "Patter/Expr/StateLogger.h"
#include "Patter/Expr/ScopeRegistry.h"

namespace patter
{
    // Value.h, Ast.h
    using wildwinter::expr::AstTag;
    using wildwinter::expr::AstPtr;
    using wildwinter::expr::AstJson;
    using wildwinter::expr::DeserialiseAstFrom;
    // Expr.h
    using wildwinter::expr::MissingPolicy;
    using wildwinter::expr::ScopeDef;
    using wildwinter::expr::EvalHelpers;
    using wildwinter::expr::FunctionDef;
    using wildwinter::expr::TypeOf;
    using wildwinter::expr::Evaluate;
    // Specificity.h, Mulberry32.h
    using wildwinter::expr::EvalTruthy;
    using wildwinter::expr::CountingCall;
    using wildwinter::expr::MatchedSpecificity;
    using wildwinter::expr::ShuffleInPlace;
    // PropertyBag.h
    namespace PropertyTypes = wildwinter::expr::PropertyTypes;
    using wildwinter::expr::LowercaseName;
    // StateLogger.h
    using wildwinter::expr::StateSnapshot;
    using wildwinter::expr::StateChange;
    using wildwinter::expr::LogMount;
    using wildwinter::expr::StateLoggerAdapter;
    using wildwinter::expr::StateLoggerOptions;
    using wildwinter::expr::diffState;
    // ScopeRegistry.h
    using wildwinter::expr::ScopeSpec;
    using wildwinter::expr::ScopeRegistrySpec;
    using wildwinter::expr::OwnedScopeOptions;
    using wildwinter::expr::ForeignScopeOptions;
    using wildwinter::expr::RegistrySpecJson;

    /** Run fn, rethrowing a kernel error it raises (ExprError, RegistryError) as Patterplay's
     *  EvalError with the kernel's message, as the engine threw before the kernel was shared.
     *  Every place the engine calls into the kernel for something that can refuse goes through
     *  this, so a game's `catch (const patter::EvalError&)` keeps working and no kernel exception
     *  crosses the plugin's API. Anything else fn throws (a dialect function's own EvalError)
     *  passes through untouched. */
    template <typename Fn>
    inline auto kernelCall(Fn&& fn) -> decltype(fn())
    {
        try { return fn(); }
        catch (const ExprError& e) { throw EvalError(e.what()); }
        catch (const RegistryError& e) { throw EvalError(e.what()); }
    }

    /** For a catch block that has to clean up first: rethrow the exception in flight, a kernel
     *  error as EvalError (see kernelCall), anything else as it is. */
    [[noreturn]] inline void rethrowKernelError()
    {
        try { throw; }
        catch (const ExprError& e) { throw EvalError(e.what()); }
        catch (const RegistryError& e) { throw EvalError(e.what()); }
    }
}
