// AST - the in-memory expression tree. Port of @wildwinter/expr's ast.ts.
//
// The node struct is the SHARED source, vendored from expr/ports/unreal/Ast.h
// to Expr/Ast.h beside this, so Patterplay and the Storylet Engine walk the
// same shape. Deserialising into it is shared too (DeserialiseAstFrom, over a
// host's AstJson accessors); Patterplay's bundle reader, BundleJson.h, calls it
// for every expression.
//
//   ["b",v] ["n",v] ["s",v] ["sv",scope,name] ["u",op,operand]
//   ["bin",op,left,right] ["call",name,...args] ["fd",sign,name]
//
// Dialect-agnostic: scope tokens and function names are plain strings here;
// meaning is supplied by a Dialect (see Dialect.h).
#pragma once

#include "Patter/Kernel.h"   // the shared node struct, Expr/Ast.h, and its names in `patter`
