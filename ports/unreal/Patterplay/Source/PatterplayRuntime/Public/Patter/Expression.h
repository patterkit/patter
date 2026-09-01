// Kept as a forwarding header for SOURCE COMPATIBILITY.
//
// The evaluator moved to the shared source (Expr/Expr.h, vendored from
// expr/ports/unreal) and the dialect to Dialect.h on 2026-09-01. This file has
// been part of the plugin's PUBLIC surface since 0.3, so a game that includes
// "Patter/Expression.h" must keep compiling: deleting it would be a breaking
// change to buy nothing.
//
// New code should include Patter/Dialect.h (which brings in the evaluator it
// configures) directly.
#pragma once

#include "Patter/Ast.h"
#include "Patter/Dialect.h"
#include "Patter/Expr/Expr.h"
#include "Patter/PatterValue.h"
