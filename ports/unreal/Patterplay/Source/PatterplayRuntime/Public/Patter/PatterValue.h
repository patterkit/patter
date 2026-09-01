// The runtime's error type, and the scalar value type.
//
// PatterValue and PatterKind are the SHARED source, vendored from
// expr/ports/unreal/Value.h to Expr/Value.h beside this; they land in the
// `patter` namespace, so `v.kind`, `v.n`, `v.f` and the accessors read here
// exactly as they did when this file held them. The error stays, because the
// shared evaluator throws EvalError and expects the family to declare it.
#pragma once

#include <stdexcept>
#include <string>

#include "Patter/Expr/Value.h"

namespace patter
{
    /** An expression that cannot be evaluated. */
    struct EvalError : std::runtime_error { explicit EvalError(const std::string& m) : std::runtime_error(m) {} };
}
