// AST - the in-memory expression tree. Port of @wildwinter/expr's ast.ts.
//
// The node classes are the SHARED source, vendored from expr/ports/unity/Ast.cs
// to Expr/Ast.cs beside this, so Patterplay and the Storylet Engine walk the
// same shape. Deserialising into them is NOT shared: that needs a JSON type and
// each package ships its own (Patterplay's is ParseAst, in PatterBundleLoader
// and the corpus TestHost).
//
//   ["b",v] ["n",v] ["s",v] ["sv",scope,name] ["u",op,operand]
//   ["bin",op,left,right] ["call",name,...args] ["fd",sign,name]
//
// Dialect-agnostic: scope tokens and function names are plain strings here;
// meaning is supplied by a Dialect (see Dialect.cs).
