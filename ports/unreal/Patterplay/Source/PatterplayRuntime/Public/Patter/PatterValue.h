// The runtime's error type, and the value type's Patterplay names.
//
// The value type is the SHARED KERNEL's, vendored from expr/ports/unreal to Expr/ beside this:
// wildwinter::expr::ExprValue, one type in every product since 2026-09-24, so a game can hand
// ONE registry to Patterplay and the Storylet Engine. PatterValue and PatterKind stay as
// aliases, so `patter::PatterValue`, `v.kind`, `v.n` and the accessors read exactly as they did.
//
// The kernel throws its own errors (ExprError, RegistryError). Patterplay catches them where it
// calls the kernel and rethrows them as EvalError (kernelCall, in Kernel.h), so a game's
// `catch (const patter::EvalError&)` keeps catching everything it did.
//
// Light on purpose: nothing here throws, so a module built without exceptions can include it
// (PatterWorld.h and PatterEngine.h do). The whole kernel, with every name it brings into
// `patter`, is Patter/Kernel.h.
#pragma once

#include <stdexcept>
#include <string>

#include "Patter/Expr/Value.h"
#include "Patter/Expr/Fwd.h"

namespace patter
{
    using PatterValue = wildwinter::expr::ExprValue;
    using PatterKind = wildwinter::expr::ExprKind;

    // The kernel's types under the names Patterplay code and games have always used
    // (patter::ScopeRegistry, patter::PropertyBag, ...): declared here, defined by Kernel.h.
    using wildwinter::expr::ExprValue;
    using wildwinter::expr::ExprKind;
    using wildwinter::expr::ExprError;
    using wildwinter::expr::RegistryError;
    using wildwinter::expr::OrderedMap;
    using wildwinter::expr::AstNode;
    using wildwinter::expr::IScopeSource;
    using wildwinter::expr::FnScope;
    using wildwinter::expr::EvalContext;
    using wildwinter::expr::Dialect;
    using wildwinter::expr::Mulberry32;
    using wildwinter::expr::ScopeDeclaration;
    using wildwinter::expr::BagChange;
    using wildwinter::expr::PropertyRow;
    using wildwinter::expr::PropertyBag;
    using wildwinter::expr::StateLogger;
    using wildwinter::expr::IScopeResolver;
    using wildwinter::expr::ScopePropertyRow;
    using wildwinter::expr::ScopeRegistry;

    /** An expression that cannot be evaluated; also what the kernel's refusals (a registry
     *  clash, a read-only write) are rethrown as, as the engine threw them before the kernel
     *  was shared. */
    struct EvalError : std::runtime_error { explicit EvalError(const std::string& m) : std::runtime_error(m) {} };
}
