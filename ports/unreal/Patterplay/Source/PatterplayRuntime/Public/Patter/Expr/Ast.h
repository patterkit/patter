// GENERATED - vendored from expr/ports/unreal/Ast.h by scripts/vendor-ports.mjs.
// Do not edit here; edit the shared source and re-run the script.
// ---------------------------------------------------------------------------
// @wildwinter/expr - the AST node, for Unreal / std C++. THE SHARED SOURCE.
//
// Authored in expr/ports/unreal and VENDORED into each consuming plugin by
// expr/scripts/vendor-ports.mjs. Do not edit a vendored copy: CI regenerates
// it and fails on `git diff --exit-code`.
//
// The in-memory form of the published tagged-tuple AST. DESERIALISING into it
// is not here, because that needs a JSON type and each plugin ships its own;
// each family keeps its own DeserialiseAst / parseAst beside this.
//
// Lands directly in the plugin's own namespace (`storylets` / `patter`), which
// is what keeps two installed plugins from colliding: `storylets::AstNode` and
// `patter::AstNode` are distinct types, so a game may install both. Identity
// belongs to the installing plugin, never to the shared source. See
// expr/docs/port-sharing.md.
// ---------------------------------------------------------------------------
#pragma once

#include <cstddef>
#include <memory>
#include <string>
#include <vector>

#include "Patter/PatterValue.h"   // the family's EvalError

namespace patter
{
    enum class AstTag { Bool, Number, Str, ScopedVar, Unary, Binary, Call, FlagDelta };

    struct AstNode;
    /** Const: a compiled AST is immutable once built, and is shared freely
     *  between the evaluator, the specificity scorer and any host that walks it. */
    using AstPtr = std::shared_ptr<const AstNode>;

    struct AstNode
    {
        AstTag tag = AstTag::Bool;
        bool b = false;                          // bool literal
        double n = 0;                            // number literal
        std::string s;                           // string literal
        std::string scope, name;                 // scopedvar (scope.name) / flagdelta (name)
        std::string op;                          // unary ("not" | "neg") / binary op
        std::string sign;                        // flagdelta sign ("+" | "-")
        std::string fn;                          // call name
        AstPtr operand, left, right;
        std::vector<AstPtr> args;
    };

    // -----------------------------------------------------------------------
    // Deserialising the published tagged-tuple form.
    //
    // Parameterised on the JSON type through AstJson, rather than written once
    // per JSON library. The six copies this replaced were 77-92% identical to
    // each other within a language once the accessor idiom was normalised away,
    // and differed only in whether they read a neutral tree, a JArray, a
    // JsonElement or an FJsonValue. The tag dispatch is not library-specific
    // and had no business being written six times; the six accessors are, and
    // are all that a new JSON library has to supply.
    //
    // Every tag carries a fixed arity, checked here. A forward-version or
    // corrupt node with too few elements would otherwise index out of bounds,
    // and an unknown tag would evaluate as a silent false. Patterplay's Unreal
    // loader was the only one of the six doing this; sharing it gives the check
    // to everyone.
    // -----------------------------------------------------------------------

    /** How to read one JSON node. The default suits any type shaped like the
     *  neutral trees both families already ship; specialise for anything else
     *  (Unreal's TSharedPtr<FJsonValue> is the live example). */
    template <typename J>
    struct AstJson
    {
        static bool isArray(const J& v) { return v.isArray(); }
        static bool isString(const J& v) { return v.isString(); }
        static std::size_t size(const J& v) { return v.arr.size(); }
        static const J& at(const J& v, std::size_t i) { return v.arr[i]; }
        static std::string str(const J& v) { return v.str; }
        static double num(const J& v) { return v.num; }
        static bool boolean(const J& v) { return v.b; }
    };

    template <typename J>
    inline AstPtr DeserialiseAstFrom(const J& node)
    {
        using A = AstJson<J>;
        if (!A::isArray(node) || A::size(node) < 1 || !A::isString(A::at(node, 0)))
        {
            throw EvalError("malformed ast node");
        }
        const std::string tag = A::str(A::at(node, 0));
        auto arity = [&](std::size_t n)
        {
            if (A::size(node) < n) throw EvalError("malformed '" + tag + "' ast node");
        };
        auto out = std::make_shared<AstNode>();
        if (tag == "b") { arity(2); out->tag = AstTag::Bool; out->b = A::boolean(A::at(node, 1)); }
        else if (tag == "n") { arity(2); out->tag = AstTag::Number; out->n = A::num(A::at(node, 1)); }
        else if (tag == "s") { arity(2); out->tag = AstTag::Str; out->s = A::str(A::at(node, 1)); }
        else if (tag == "sv")
        {
            arity(3); out->tag = AstTag::ScopedVar;
            out->scope = A::str(A::at(node, 1));
            out->name = A::str(A::at(node, 2));
        }
        else if (tag == "u")
        {
            arity(3); out->tag = AstTag::Unary;
            out->op = A::str(A::at(node, 1));
            out->operand = DeserialiseAstFrom<J>(A::at(node, 2));
        }
        else if (tag == "bin")
        {
            arity(4); out->tag = AstTag::Binary;
            out->op = A::str(A::at(node, 1));
            out->left = DeserialiseAstFrom<J>(A::at(node, 2));
            out->right = DeserialiseAstFrom<J>(A::at(node, 3));
        }
        else if (tag == "fd")
        {
            arity(3); out->tag = AstTag::FlagDelta;
            out->sign = A::str(A::at(node, 1));
            out->name = A::str(A::at(node, 2));
        }
        else if (tag == "call")
        {
            arity(2); out->tag = AstTag::Call;
            out->fn = A::str(A::at(node, 1));
            for (std::size_t i = 2; i < A::size(node); ++i) out->args.push_back(DeserialiseAstFrom<J>(A::at(node, i)));
        }
        else throw EvalError("unknown ast tag: " + tag);
        return out;
    }
}
