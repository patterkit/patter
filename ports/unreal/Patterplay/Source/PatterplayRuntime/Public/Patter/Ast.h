// AST - the in-memory expression tree. Port of @wildwinter/expr's ast.ts.
//
// The node struct is the SHARED source, vendored from expr/ports/unreal/Ast.h
// to Expr/Ast.h beside this, so Patterplay and the Storylet Engine walk the
// same shape. Deserialising into it is NOT shared: that needs a JSON type and
// each plugin ships its own (Patterplay's is parseAst, in the bundle loader
// and the corpus TestHost).
//
//   ["b",v] ["n",v] ["s",v] ["sv",scope,name] ["u",op,operand]
//   ["bin",op,left,right] ["call",name,...args] ["fd",sign,name]
//
// Dialect-agnostic: scope tokens and function names are plain strings here;
// meaning is supplied by a Dialect (see Dialect.h).
#pragma once

#include "Patter/Expr/Ast.h"
