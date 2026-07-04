// The compiled expression AST, mirroring @wildwinter/expr's published tagged-tuple
// form (the corpus ships these, so a runtime needs no parser):
//   ["b",v] ["n",v] ["s",v] ["sv",scope,name] ["u",op,operand]
//   ["bin",op,left,right] ["call",name,...args] ["fd",sign,name]

namespace Patterkit.Patterplay
{
    public abstract class AstNode { }

    public sealed class BoolNode : AstNode { public bool Value; }
    public sealed class NumberNode : AstNode { public double Value; }
    public sealed class StringNode : AstNode { public string Value; }
    public sealed class ScopedVar : AstNode { public string Scope; public string Name; }
    public sealed class Unary : AstNode { public string Op; public AstNode Operand; }
    public sealed class Binary : AstNode { public string Op; public AstNode Left; public AstNode Right; }
    public sealed class Call : AstNode { public string Name; public AstNode[] Args; }
    public sealed class FlagDelta : AstNode { public string Sign; public string Name; }
}
