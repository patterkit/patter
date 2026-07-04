// The compiled expression AST (the corpus's tagged-tuple form) as a single tagged node.
//   ["b",v] ["n",v] ["s",v] ["sv",scope,name] ["u",op,operand]
//   ["bin",op,left,right] ["call",name,...args] ["fd",sign,name]
#pragma once

#include <string>
#include <vector>
#include <memory>

namespace patter
{
    enum class AstTag { Bool, Number, Str, ScopedVar, Unary, Binary, Call, FlagDelta };

    struct AstNode
    {
        AstTag tag = AstTag::Bool;
        bool b = false;
        double n = 0;
        std::string s;                          // string literal
        std::string scope, name;                // scopedvar / flagdelta
        std::string op;                         // unary / binary op
        std::string sign;                       // flagdelta sign
        std::string fn;                         // call name
        std::shared_ptr<AstNode> left, right, operand;
        std::vector<std::shared_ptr<AstNode>> args;
    };

    using AstPtr = std::shared_ptr<AstNode>;
}
