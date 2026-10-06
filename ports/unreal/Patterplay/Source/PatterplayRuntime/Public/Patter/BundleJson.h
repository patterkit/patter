// Reading a compiled bundle (a .patterc's JSON) into patter::Bundle: the ONE reader, for every JSON
// library a host parses with.
//
// There used to be two, written by hand: the plugin's loader over Unreal's FJsonValue, and the corpus
// TestHost's over its own JsonValue. They drifted (the plugin never read `closedCaptions` while the
// TestHost did), and since the corpus runs through the TestHost, it could not see what the plugin
// missed. Now both call ParseBundle, so the corpus checks the reader games use, and a new bundle field
// is added once, here. What stays per host is how to read its JSON type, which is the BundleJson
// specialisation below, as AstJson already is for the expression AST.
//
// Throws std::runtime_error ("bundle: missing/invalid field '<key>'") when a required field is absent or
// the wrong shape, and the AST deserialiser's ExprError for a malformed expression. The plugin's loader
// catches either and reports it through its Error string; the TestHost lets it throw.
#pragma once

#include <cstddef>
#include <stdexcept>
#include <string>
#include <vector>
#include "Patter/Bundle.h"

namespace patter
{
    /** How to read the OBJECT side of one JSON library, for ParseBundle. Arrays, strings, numbers, and
     *  booleans are read through AstJson<J> (Patter/Expr/Ast.h), which every host already specialises
     *  for the expression AST, so they are said once per library rather than twice. A host supplies:
     *
     *    static bool isObject(const J& v);
     *    static bool isNull(const J& v);
     *    static bool isNumber(const J& v);
     *    static bool isBool(const J& v);
     *    static const J* find(const J& object, const char* key);    // nullptr when absent, or v is no object
     *    template <typename Fn>
     *    static void forEachField(const J& object, Fn&& fn);        // fn(const std::string& key, const J& value)
     *
     *  forEachField MUST visit fields in document order: the scenes object's key order is the authored
     *  scene order (sceneOrder), which a sorted map loses.
     *
     *  There is no default, unlike AstJson's: a missing specialisation is a compile error, not a guess at
     *  the library's shape. */
    template <typename J>
    struct BundleJson;

    template <typename J>
    class BundleReader
    {
        using T = BundleJson<J>;
        using A = AstJson<J>;

    public:
        static Bundle read(const J& root)
        {
            Bundle out;
            if (const J* p = field(root, "schema")) out.schema = text(*p);
            if (const J* p = field(root, "voiced")) out.voiced = flag(*p);
            if (const J* ct = field(root, "content"))
            {
                if (const J* p = field(*ct, "hash")) out.contentHash = text(*p);
                if (const J* p = field(*ct, "structureHash")) out.structureHash = text(*p);
                if (const J* p = field(*ct, "project")) out.contentProject = text(*p);
                if (const J* p = field(*ct, "version")) out.contentVersion = text(*p);
            }
            if (const J* lz = field(root, "localisation"))
            {
                if (const J* p = field(*lz, "mode")) out.localisation.mode = text(*p);
                if (const J* p = field(*lz, "sourceDebug")) out.localisation.sourceDebug = flag(*p);
            }
            // The project's own caption delimiters and caption character (#214). Absent means the default
            // [ ] and SFX; present, both delimiters are required.
            if (const J* cc = field(root, "closedCaptions"))
            {
                out.closedCaptions.present = true;
                out.closedCaptions.open = reqString(*cc, "open");
                out.closedCaptions.close = reqString(*cc, "close");
                if (const J* p = field(*cc, "character")) out.closedCaptions.character = text(*p);
            }

            const J& loc = reqObject(root, "locales");
            out.locales.defaultLocale = reqString(loc, "default");
            if (const J* p = field(loc, "included")) out.locales.included = strList(*p);

            if (const J* p = field(root, "cast"))
                eachElement(*p, [&](const J& c)
                {
                    Cast cast;
                    cast.name = reqString(c, "name");
                    if (const J* q = field(c, "displayName")) cast.displayName = text(*q);
                    out.cast.push_back(cast);
                });

            if (const J* p = field(root, "properties"))
                eachElement(*p, [&](const J& d) { out.properties.push_back(propDecl(d)); });

            // Declared host scopes (@world). Skipping this is not a missing feature but a silently
            // different story: the reference reads as a graceful false and the gated branch never runs.
            if (const J* reg = field(root, "scopeRegistry"))
            {
                out.scopeRegistry.present = true;
                if (const J* p = field(*reg, "version"))
                    if (T::isNumber(*p)) out.scopeRegistry.version = static_cast<int>(A::num(*p));
                if (const J* p = field(*reg, "scopes"))
                    eachElement(*p, [&](const J& s)
                    {
                        HostScopeSpec spec;
                        spec.token = reqString(s, "token");
                        if (const J* w = field(s, "writable"))
                            if (T::isBool(*w)) { spec.hasWritable = true; spec.writable = A::boolean(*w); }
                        // Present-but-empty is a declared scope with nothing in it; ABSENT is opaque.
                        if (const J* decls = field(s, "declarations"))
                            if (A::isArray(*decls))
                            {
                                spec.hasDeclarations = true;
                                eachElement(*decls, [&](const J& d) { spec.declarations.push_back(hostDecl(d)); });
                            }
                        out.scopeRegistry.scopes.push_back(spec);
                    });
            }

            // Other engines' scopes the content names (`story`). Skipped, a write to one would land in
            // @patter under a dotted name, and a game that never registered it would hear nothing.
            if (const J* p = field(root, "externalScopes")) out.externalScopes = strList(*p);

            if (const J* strs = field(root, "strings"))
                eachField(*strs, [&](const std::string& locale, const J& table)
                {
                    std::map<std::string, std::string> t;
                    eachField(table, [&](const std::string& id, const J& s) { t[id] = text(s); });
                    out.strings[locale] = t;
                });

            if (const J* gdf = field(root, "gameDataFields"))
                eachField(*gdf, [&](const std::string& kind, const J& list)
                {
                    std::vector<GameDataField> fields;
                    eachElement(list, [&](const J& f)
                    {
                        GameDataField gf;
                        gf.name = reqString(f, "name");
                        if (const J* q = field(f, "type")) gf.type = text(*q);
                        if (const J* q = field(f, "default")) { gf.hasDefault = true; gf.def = value(*q); }
                        if (const J* q = field(f, "values")) gf.values = strList(*q);
                        fields.push_back(gf);
                    });
                    out.gameDataFields[kind] = fields;
                });

            eachField(reqObject(root, "scenes"), [&](const std::string& key, const J& s)
            {
                if (!T::isObject(s)) missing("scene");
                Scene scene;
                scene.id = reqString(s, "id");
                if (const J* p = field(s, "name")) scene.name = text(*p);
                if (const J* p = field(s, "gameId")) scene.gameId = text(*p);
                if (const J* p = field(s, "tags")) scene.tags = strList(*p);   // author tags (#215)
                if (const J* p = field(s, "gameData")) scene.gameData = gameData(*p);
                if (const J* p = field(s, "sceneProps")) eachElement(*p, [&](const J& d) { scene.sceneProps.push_back(propDecl(d)); });
                if (const J* p = field(s, "onEntry")) scene.onEntry = effects(*p);
                eachElement(reqArray(s, "blocks"), [&](const J& b)
                {
                    if (!T::isObject(b)) missing("block");
                    Block block;
                    block.id = reqString(b, "id");
                    if (const J* p = field(b, "name")) block.name = text(*p);
                    if (const J* p = field(b, "gameId")) block.gameId = text(*p);
                    if (const J* p = field(b, "tags")) block.tags = strList(*p);   // author tags (#215)
                    if (const J* p = field(b, "gameData")) block.gameData = gameData(*p);
                    if (const J* p = field(b, "children")) eachElement(*p, [&](const J& c) { block.children.push_back(node(c)); });
                    scene.blocks.push_back(std::move(block));
                });
                // The fields arrive in document order, which is the authored scene order.
                if (!out.scenes.count(key)) out.sceneOrder.push_back(key);
                out.scenes[key] = std::move(scene);
            });
            return out;
        }

    private:
        [[noreturn]] static void missing(const char* key)
        {
            throw std::runtime_error(std::string("bundle: missing/invalid field '") + key + "'");
        }

        // A JSON null reads as an absent field. The compiler never writes one, but a hand-edited bundle
        // might, and the plugin's loader already treated a null host-scope default this way.
        static const J* field(const J& o, const char* key)
        {
            const J* p = T::find(o, key);
            return p && !T::isNull(*p) ? p : nullptr;
        }

        static const J& reqObject(const J& o, const char* key)
        {
            const J* p = field(o, key);
            if (!p || !T::isObject(*p)) missing(key);
            return *p;
        }

        static const J& reqArray(const J& o, const char* key)
        {
            const J* p = field(o, key);
            if (!p || !A::isArray(*p)) missing(key);
            return *p;
        }

        static std::string reqString(const J& o, const char* key)
        {
            const J* p = field(o, key);
            if (!p || !A::isString(*p)) missing(key);
            return A::str(*p);
        }

        // Optional scalars of the wrong type read as unset ("" or false) rather than asking the library to
        // convert, which in Unreal logs an error per field.
        static std::string text(const J& v) { return A::isString(v) ? A::str(v) : std::string(); }
        static bool flag(const J& v) { return T::isBool(v) && A::boolean(v); }

        template <typename Fn>
        static void eachElement(const J& arr, Fn&& fn)
        {
            if (!A::isArray(arr)) return;
            const std::size_t n = A::size(arr);
            for (std::size_t i = 0; i < n; ++i) fn(A::at(arr, i));
        }

        template <typename Fn>
        static void eachField(const J& obj, Fn&& fn)
        {
            if (T::isObject(obj)) T::forEachField(obj, fn);
        }

        static std::vector<std::string> strList(const J& arr)
        {
            std::vector<std::string> out;
            eachElement(arr, [&](const J& x) { out.push_back(text(x)); });
            return out;
        }

        // Anything that is not a boolean, number, string, or flag list reads as false, as the plugin's
        // loader always did, rather than failing a game's whole bundle over one value.
        static PatterValue value(const J& v)
        {
            if (T::isBool(v)) return PatterValue::Bool(A::boolean(v));
            if (T::isNumber(v)) return PatterValue::Num(A::num(v));
            if (A::isString(v)) return PatterValue::Str(A::str(v));
            if (A::isArray(v)) return PatterValue::Flags(strList(v));
            return PatterValue::Bool(false);
        }

        static std::shared_ptr<GameData> gameData(const J& obj)
        {
            auto gd = std::make_shared<GameData>();
            eachField(obj, [&](const std::string& key, const J& v) { (*gd)[key] = value(v); });
            return gd;
        }

        static Expression expression(const J& o)
        {
            Expression e;
            const J* ast = field(o, "ast");
            if (!ast) missing("ast");
            e.ast = DeserialiseAstFrom<J>(*ast);
            if (const J* p = field(o, "src")) e.src = text(*p);   // the source text, for an error report
            return e;
        }

        static std::vector<Effect> effects(const J& arr)
        {
            std::vector<Effect> out;
            eachElement(arr, [&](const J& x)
            {
                Effect ef;
                ef.target = reqString(x, "target");
                ef.value = expression(reqObject(x, "value"));
                out.push_back(ef);
            });
            return out;
        }

        static PropertyDecl propDecl(const J& o)
        {
            PropertyDecl d;
            d.name = reqString(o, "name");
            d.type = reqString(o, "type");
            if (const J* p = field(o, "shared")) { d.hasShared = true; d.shared = flag(*p); }
            if (const J* p = field(o, "temporary")) d.temporary = flag(*p);
            if (const J* p = field(o, "default")) { d.hasDefault = true; d.def = value(*p); }
            if (const J* p = field(o, "values")) d.values = strList(*p);
            if (const J* p = field(o, "stages")) d.stages = strList(*p);
            return d;
        }

        static HostScopeDecl hostDecl(const J& o)
        {
            HostScopeDecl d;
            d.name = reqString(o, "name");
            d.type = reqString(o, "type");
            if (const J* p = field(o, "values")) d.values = strList(*p);
            if (const J* p = field(o, "stages")) d.stages = strList(*p);
            if (const J* p = field(o, "default")) { d.hasDefault = true; d.def = value(*p); }
            if (const J* p = field(o, "writable"))
                if (T::isBool(*p)) { d.hasWritable = true; d.writable = A::boolean(*p); }
            return d;
        }

        static Beat beat(const J& o)
        {
            Beat b;
            b.id = reqString(o, "id");
            b.kind = reqString(o, "kind");
            // Set (even to "") or absent: a step keeps a "" speaker field, as every runtime does.
            if (const J* p = field(o, "character")) { b.hasCharacter = true; b.character = text(*p); }
            if (const J* p = field(o, "direction")) { b.hasDirection = true; b.direction = text(*p); }
            if (const J* p = field(o, "gameData")) b.gameData = gameData(*p);
            if (const J* p = field(o, "tags")) b.tags = strList(*p);   // author tags (#215)
            return b;
        }

        static NodePtr node(const J& o)
        {
            auto n = std::make_shared<Node>();
            n->id = reqString(o, "id");
            n->type = reqString(o, "type");
            if (const J* p = field(o, "condition")) n->condition = std::make_shared<Expression>(expression(*p));
            if (const J* p = field(o, "onEnter")) n->onEnter = effects(*p);
            if (const J* p = field(o, "onExit")) n->onExit = effects(*p);
            if (const J* p = field(o, "gameData")) n->gameData = gameData(*p);
            if (const J* p = field(o, "tags")) n->tags = strList(*p);   // author tags (#215)
            // Option-position flags, on a bare snippet option as on an Option group.
            if (const J* p = field(o, "sticky")) n->sticky = flag(*p);
            if (const J* p = field(o, "fallback")) n->fallback = flag(*p);
            if (const J* p = field(o, "secretUntilEligible")) n->secretUntilEligible = flag(*p);

            if (n->isGroup())
            {
                if (const J* p = field(o, "selector")) n->selector = text(*p);
                if (const J* p = field(o, "children")) eachElement(*p, [&](const J& c) { n->children.push_back(node(c)); });
                if (const J* p = field(o, "prompt")) n->prompt = std::make_shared<Beat>(beat(*p));
                if (const J* p = field(o, "shared")) n->shared = flag(*p);
                if (const J* op = field(o, "options"))
                {
                    n->options = std::make_shared<SelectorOptions>();
                    if (const J* p = field(*op, "order")) n->options->order = text(*p);
                    if (const J* p = field(*op, "exhaust")) n->options->exhaust = text(*p);
                }
            }
            else
            {
                if (const J* p = field(o, "beats")) eachElement(*p, [&](const J& b) { n->beats.push_back(beat(b)); });
                if (const J* jp = field(o, "jump"))
                {
                    n->jump = std::make_shared<Jump>();
                    n->jump->to = reqString(*jp, "to");
                    if (const J* p = field(*jp, "mode")) n->jump->mode = text(*p);
                }
            }
            return n;
        }
    };

    /** Read a compiled bundle's root JSON object into a Bundle. J is the host's JSON node type; it needs
     *  BundleJson<J> and AstJson<J> (see above). Throws on a missing or malformed required field. */
    template <typename J>
    inline Bundle ParseBundle(const J& root)
    {
        return BundleReader<J>::read(root);
    }
}
