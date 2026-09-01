// GENERATED - vendored from expr/ports/unity/Ast.cs by scripts/vendor-ports.mjs.
// Do not edit here; edit the shared source and re-run the script.
// ---------------------------------------------------------------------------
// @wildwinter/expr - the AST node, for Unity / C#. THE SHARED SOURCE.
//
// Authored in expr/ports/unity and VENDORED into each consuming package by
// expr/scripts/vendor-ports.mjs. Do not edit a vendored copy.
//
// The in-memory form of the published tagged-tuple AST. DESERIALISING into it
// is not here, because that needs a JSON type and each package ships its own;
// each family keeps its own DeserialiseAst / ParseAst beside this.
//
//   ["b",v] ["n",v] ["s",v] ["sv",scope,name] ["u",op,operand]
//   ["bin",op,left,right] ["call",name,...args] ["fd",sign,name]
//
// Dialect-agnostic: scope tokens and function names are plain strings here;
// meaning is supplied by a Dialect. Lands in the package's own namespace.
// ---------------------------------------------------------------------------

using System.Collections.Generic;

namespace Patterkit.Patterplay
{
    /// <summary>One node of a compiled expression. A class per node kind, so the
    /// evaluator switches on the type rather than a tag field.</summary>
    public abstract class ExprNode { }

    public sealed class BoolNode : ExprNode { public bool Value; }
    public sealed class NumberNode : ExprNode { public double Value; }
    public sealed class StringNode : ExprNode { public string Value; }

    /// <summary>All property references are scoped: bare `@name` is
    /// canonicalised to `@&lt;defaultScope&gt;.name` at compile time.</summary>
    public sealed class ScopedVarNode : ExprNode { public string Scope; public string Name; }

    public sealed class CallNode : ExprNode { public string Name; public ExprNode[] Args; }
    public sealed class UnaryNode : ExprNode { public string Op; public ExprNode Operand; }         // "not" | "neg"
    public sealed class BinaryNode : ExprNode { public string Op; public ExprNode Left; public ExprNode Right; }

    /// <summary>Produced only by flag-delta function argument parsing; not valid
    /// elsewhere.</summary>
    public sealed class FlagDeltaNode : ExprNode { public string Sign; public string Name; }         // "+" | "-"

    public static class Ast
    {
        /// <summary>
        /// Published tagged-tuple form to node tree.
        /// </summary>
        /// <remarks>
        /// Takes a NORMALISED tree (nested <c>IReadOnlyList&lt;object&gt;</c> over
        /// bool / double / string), never a JSON library's own type. That is the
        /// whole reason one deserialiser can serve every host: the six copies this
        /// replaced were 77-92% identical to each other once the accessor idiom was
        /// normalised away, and differed only in whether they read a JArray, a
        /// JsonElement or a JToken. Converting to plain objects first is about ten
        /// lines per library, and it is genuinely library-specific; the tag
        /// dispatch below is not, and had no business being written six times.
        ///
        /// Every tag carries a fixed arity, checked here. A forward-version or
        /// corrupt node with too few elements would otherwise index out of bounds,
        /// and an unknown tag would evaluate as a silent false. Patterplay's Unreal
        /// loader was the only one of the six doing this; sharing it gives the
        /// check to everyone.
        /// </remarks>
        public static ExprNode DeserialiseAst(IReadOnlyList<object> node)
        {
            if (node == null || node.Count < 1 || !(node[0] is string tag))
            {
                throw new EvalError("malformed ast node");
            }

            void Arity(int n)
            {
                if (node.Count < n) throw new EvalError($"malformed '{tag}' ast node");
            }

            IReadOnlyList<object> Child(int i) => (IReadOnlyList<object>)node[i];

            switch (tag)
            {
                case "b": Arity(2); return new BoolNode { Value = (bool)node[1] };
                case "n": Arity(2); return new NumberNode { Value = (double)node[1] };
                case "s": Arity(2); return new StringNode { Value = (string)node[1] };
                case "sv": Arity(3); return new ScopedVarNode { Scope = (string)node[1], Name = (string)node[2] };
                case "u": Arity(3); return new UnaryNode { Op = (string)node[1], Operand = DeserialiseAst(Child(2)) };
                case "bin":
                    Arity(4);
                    return new BinaryNode
                    {
                        Op = (string)node[1],
                        Left = DeserialiseAst(Child(2)),
                        Right = DeserialiseAst(Child(3)),
                    };
                case "fd": Arity(3); return new FlagDeltaNode { Sign = (string)node[1], Name = (string)node[2] };
                case "call":
                {
                    Arity(2);
                    var args = new List<ExprNode>();
                    for (int i = 2; i < node.Count; i++) args.Add(DeserialiseAst(Child(i)));
                    return new CallNode { Name = (string)node[1], Args = args.ToArray() };
                }
                default: throw new EvalError($"unknown ast tag: {tag}");
            }
        }
    }
}
