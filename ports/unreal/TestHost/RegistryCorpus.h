// GENERATED - vendored from expr/ports/unreal/testing/RegistryCorpus.h by scripts/vendor-ports.mjs.
// Do not edit here; edit the shared source and re-run the script.
// ---------------------------------------------------------------------------
// The registry corpus runner, for std C++. THE SHARED SOURCE. TEST CODE: it is
// vendored into each family's standalone TestHost and never shipped in a plugin.
//
// Authored in expr/ports/unreal/testing and VENDORED by
// expr/scripts/vendor-ports.mjs. Do not edit a vendored copy.
//
// Runs expr/packages/scoperegistry/corpus.json (vendored beside each family's
// own corpus as registry-corpus.json) against the vendored ScopeRegistry. The
// NORMATIVE interpreter is the TypeScript one,
// expr/packages/scoperegistry/test/corpus/runner.ts: every step here means
// exactly what it means there, and a runner that did something else would be
// testing something else. Where this one is stricter, it is only in refusing
// to pass quietly: a missing or unreadable corpus, an empty one, a version it
// does not know, or a step it does not know, is a failure rather than a skip.
//
// Depends on no family JSON type. It carries its own small JSON reader, whose
// nodes have the neutral shape the shared Ast.h deserialiser and the
// registry's spec reader both read by default.
//
// A host calls RunRegistryCorpus(path) and gets passed, total and one line
// per failure; it prints them and adds the failures to its own count.
// ---------------------------------------------------------------------------
#pragma once

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <exception>
#include <fstream>
#include <functional>
#include <memory>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

#include "Patter/Expr/ScopeRegistry.h"

namespace patter
{
    namespace registrycorpus
    {
        // -------------------------------------------------------------------
        // A minimal JSON tree and reader (test-only).
        // -------------------------------------------------------------------

        struct Json
        {
            enum Type { Null, Bool, Number, String, Array, Object };
            Type type = Null;
            bool b = false;
            double num = 0;
            std::string str;
            std::vector<Json> arr;
            std::vector<std::pair<std::string, Json>> obj;   // document order kept

            bool isNull() const { return type == Null; }
            bool isBool() const { return type == Bool; }
            bool isNumber() const { return type == Number; }
            bool isString() const { return type == String; }
            bool isArray() const { return type == Array; }
            bool isObject() const { return type == Object; }

            const Json* find(const std::string& key) const
            {
                if (type != Object) return nullptr;
                for (const auto& kv : obj)
                {
                    if (kv.first == key) return &kv.second;
                }
                return nullptr;
            }

            static Json MakeBool(bool v) { Json j; j.type = Bool; j.b = v; return j; }
            static Json MakeNumber(double v) { Json j; j.type = Number; j.num = v; return j; }
            static Json MakeString(std::string v) { Json j; j.type = String; j.str = std::move(v); return j; }
            static Json MakeArray() { Json j; j.type = Array; return j; }
            static Json MakeObject() { Json j; j.type = Object; return j; }
        };

        class JsonReader
        {
        public:
            explicit JsonReader(const std::string& text) : text_(text) {}

            Json parse()
            {
                Json value = parseValue();
                skipSpace();
                if (pos_ != text_.size()) fail("trailing characters");
                return value;
            }

        private:
            [[noreturn]] void fail(const std::string& what) const
            {
                throw std::runtime_error("JSON: " + what + " at offset " + std::to_string(pos_));
            }

            void skipSpace()
            {
                while (pos_ < text_.size() && (text_[pos_] == ' ' || text_[pos_] == '\t' || text_[pos_] == '\n' || text_[pos_] == '\r')) ++pos_;
            }

            bool literal(const char* word)
            {
                const std::string w(word);
                if (text_.compare(pos_, w.size(), w) != 0) return false;
                pos_ += w.size();
                return true;
            }

            Json parseValue()
            {
                skipSpace();
                if (pos_ >= text_.size()) fail("unexpected end");
                const char c = text_[pos_];
                if (c == '{') return parseObject();
                if (c == '[') return parseArray();
                if (c == '"') return Json::MakeString(parseString());
                if (literal("true")) return Json::MakeBool(true);
                if (literal("false")) return Json::MakeBool(false);
                if (literal("null")) return Json();
                if (c == '-' || (c >= '0' && c <= '9')) return parseNumber();
                fail(std::string("unexpected '") + c + "'");
            }

            Json parseObject()
            {
                Json out = Json::MakeObject();
                ++pos_;
                skipSpace();
                if (pos_ < text_.size() && text_[pos_] == '}') { ++pos_; return out; }
                while (true)
                {
                    skipSpace();
                    if (pos_ >= text_.size() || text_[pos_] != '"') fail("expected a key");
                    std::string key = parseString();
                    skipSpace();
                    if (pos_ >= text_.size() || text_[pos_] != ':') fail("expected ':'");
                    ++pos_;
                    Json value = parseValue();
                    out.obj.emplace_back(std::move(key), std::move(value));
                    skipSpace();
                    if (pos_ < text_.size() && text_[pos_] == ',') { ++pos_; continue; }
                    if (pos_ < text_.size() && text_[pos_] == '}') { ++pos_; return out; }
                    fail("expected ',' or '}'");
                }
            }

            Json parseArray()
            {
                Json out = Json::MakeArray();
                ++pos_;
                skipSpace();
                if (pos_ < text_.size() && text_[pos_] == ']') { ++pos_; return out; }
                while (true)
                {
                    out.arr.push_back(parseValue());
                    skipSpace();
                    if (pos_ < text_.size() && text_[pos_] == ',') { ++pos_; continue; }
                    if (pos_ < text_.size() && text_[pos_] == ']') { ++pos_; return out; }
                    fail("expected ',' or ']'");
                }
            }

            Json parseNumber()
            {
                const std::size_t start = pos_;
                if (text_[pos_] == '-') ++pos_;
                while (pos_ < text_.size())
                {
                    const char c = text_[pos_];
                    if ((c >= '0' && c <= '9') || c == '.' || c == 'e' || c == 'E' || c == '+' || c == '-') ++pos_;
                    else break;
                }
                const std::string digits = text_.substr(start, pos_ - start);
                char* end = nullptr;
                const double v = std::strtod(digits.c_str(), &end);
                if (!end || *end != '\0') fail("malformed number");
                return Json::MakeNumber(v);
            }

            unsigned hex4()
            {
                if (pos_ + 4 > text_.size()) fail("short \\u escape");
                unsigned v = 0;
                for (int i = 0; i < 4; ++i)
                {
                    const char c = text_[pos_++];
                    v <<= 4;
                    if (c >= '0' && c <= '9') v |= static_cast<unsigned>(c - '0');
                    else if (c >= 'a' && c <= 'f') v |= static_cast<unsigned>(c - 'a' + 10);
                    else if (c >= 'A' && c <= 'F') v |= static_cast<unsigned>(c - 'A' + 10);
                    else fail("bad \\u escape");
                }
                return v;
            }

            static void utf8(std::string& out, unsigned cp)
            {
                if (cp < 0x80) out += static_cast<char>(cp);
                else if (cp < 0x800)
                {
                    out += static_cast<char>(0xC0 | (cp >> 6));
                    out += static_cast<char>(0x80 | (cp & 0x3F));
                }
                else if (cp < 0x10000)
                {
                    out += static_cast<char>(0xE0 | (cp >> 12));
                    out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
                    out += static_cast<char>(0x80 | (cp & 0x3F));
                }
                else
                {
                    out += static_cast<char>(0xF0 | (cp >> 18));
                    out += static_cast<char>(0x80 | ((cp >> 12) & 0x3F));
                    out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
                    out += static_cast<char>(0x80 | (cp & 0x3F));
                }
            }

            std::string parseString()
            {
                ++pos_;   // the opening quote
                std::string out;
                while (true)
                {
                    if (pos_ >= text_.size()) fail("unterminated string");
                    const char c = text_[pos_++];
                    if (c == '"') return out;
                    if (c != '\\') { out += c; continue; }
                    if (pos_ >= text_.size()) fail("unterminated escape");
                    const char e = text_[pos_++];
                    switch (e)
                    {
                        case '"': out += '"'; break;
                        case '\\': out += '\\'; break;
                        case '/': out += '/'; break;
                        case 'b': out += '\b'; break;
                        case 'f': out += '\f'; break;
                        case 'n': out += '\n'; break;
                        case 'r': out += '\r'; break;
                        case 't': out += '\t'; break;
                        case 'u':
                        {
                            unsigned cp = hex4();
                            if (cp >= 0xD800 && cp <= 0xDBFF && pos_ + 6 <= text_.size() && text_[pos_] == '\\' && text_[pos_ + 1] == 'u')
                            {
                                pos_ += 2;
                                const unsigned low = hex4();
                                cp = 0x10000 + ((cp - 0xD800) << 10) + (low - 0xDC00);
                            }
                            utf8(out, cp);
                            break;
                        }
                        default: fail("unknown escape");
                    }
                }
            }

            const std::string& text_;
            std::size_t pos_ = 0;
        };

        /** JSON.stringify, near enough for a failure message. */
        inline std::string Show(const Json& v)
        {
            switch (v.type)
            {
                case Json::Null: return "null";
                case Json::Bool: return v.b ? "true" : "false";
                case Json::Number: return PatterValue::JsNumber(v.num);
                case Json::String: return PatterValue::JsonQuote(v.str);
                case Json::Array:
                {
                    std::string out = "[";
                    for (std::size_t i = 0; i < v.arr.size(); ++i) out += (i ? "," : "") + Show(v.arr[i]);
                    return out + "]";
                }
                case Json::Object:
                {
                    std::string out = "{";
                    for (std::size_t i = 0; i < v.obj.size(); ++i)
                    {
                        out += (i ? "," : "") + PatterValue::JsonQuote(v.obj[i].first) + ":" + Show(v.obj[i].second);
                    }
                    return out + "}";
                }
            }
            return "null";
        }

        /** An absent value, as the reference prints undefined. */
        inline std::string Show(const std::optional<Json>& v) { return v.has_value() ? Show(*v) : "<unset>"; }

        /** The reference runner's same(): flags (arrays) compared element-wise IN
         *  ORDER, since a saved list must come back as it went; objects by key
         *  set, whatever the order; everything else by strict equality. An absent
         *  value equals only another absent value. */
        inline bool Same(const std::optional<Json>& a, const std::optional<Json>& b)
        {
            if (!a.has_value() || !b.has_value()) return !a.has_value() && !b.has_value();
            const Json& x = *a;
            const Json& y = *b;
            if (x.isArray() || y.isArray())
            {
                if (!x.isArray() || !y.isArray() || x.arr.size() != y.arr.size()) return false;
                for (std::size_t i = 0; i < x.arr.size(); ++i)
                {
                    if (!Same(x.arr[i], y.arr[i])) return false;
                }
                return true;
            }
            if (x.isObject() && y.isObject())
            {
                if (x.obj.size() != y.obj.size()) return false;
                for (const auto& kv : x.obj)
                {
                    const Json* other = y.find(kv.first);
                    if (!other || !Same(kv.second, *other)) return false;
                }
                return true;
            }
            if (x.type != y.type) return false;
            switch (x.type)
            {
                case Json::Null: return true;
                case Json::Bool: return x.b == y.b;
                case Json::Number: return x.num == y.num;
                case Json::String: return x.str == y.str;
                default: return false;
            }
        }

        // -------------------------------------------------------------------
        // Between the corpus's JSON and the registry's values.
        // -------------------------------------------------------------------

        inline Json ToJson(const PatterValue& v)
        {
            if (v.isBool()) return Json::MakeBool(v.asBool());
            if (v.isNumber()) return Json::MakeNumber(v.asNumber());
            if (v.isString()) return Json::MakeString(v.asString());
            Json out = Json::MakeArray();
            for (const auto& flag : v.asFlags()) out.arr.push_back(Json::MakeString(flag));
            return out;
        }

        inline std::optional<Json> ToJson(const std::optional<PatterValue>& v)
        {
            return v.has_value() ? std::optional<Json>(ToJson(*v)) : std::nullopt;
        }

        inline Json ToJson(const OrderedMap<std::string, PatterValue>& values)
        {
            Json out = Json::MakeObject();
            for (const auto& pair : values) out.obj.emplace_back(pair.first, ToJson(pair.second));
            return out;
        }

        inline Json ToJson(const ScopeRegistry::SaveBlob& blob)
        {
            Json out = Json::MakeObject();
            for (const auto& pair : blob) out.obj.emplace_back(pair.first, ToJson(pair.second));
            return out;
        }

        /** A corpus value (boolean, number, string, list of strings). */
        inline PatterValue ToValue(const Json& v)
        {
            std::optional<PatterValue> value = ScopeRegistry::ReadSpecValue<Json>(v);
            if (!value.has_value()) throw std::runtime_error("the corpus carries a value that is not a scalar: " + Show(v));
            return *value;
        }

        inline OrderedMap<std::string, PatterValue> ToValues(const Json& obj)
        {
            if (!obj.isObject()) throw std::runtime_error("the corpus carries a bag that is not an object: " + Show(obj));
            OrderedMap<std::string, PatterValue> out;
            for (const auto& kv : obj.obj) out.set(kv.first, ToValue(kv.second));
            return out;
        }

        inline ScopeRegistry::SaveBlob ToBlob(const Json& obj)
        {
            if (!obj.isObject()) throw std::runtime_error("the corpus carries a blob that is not an object: " + Show(obj));
            ScopeRegistry::SaveBlob out;
            for (const auto& kv : obj.obj) out.set(kv.first, ToValues(kv.second));
            return out;
        }

        inline std::vector<ScopeDeclaration> ToDecls(const Json* ds)
        {
            std::vector<ScopeDeclaration> out;
            if (!ds) return out;
            for (const auto& d : ds->arr) out.push_back(ScopeRegistry::ReadSpecDeclaration<Json>(d));
            return out;
        }

        /** The game's own store behind a foreign scope: a plain map, kept by the
         *  runner so a `store` step can prove where a write did or did not land. */
        using Store = OrderedMap<std::string, PatterValue>;

        class StoreResolver : public IScopeResolver
        {
        public:
            StoreResolver(std::shared_ptr<Store> store, bool settable) : store_(std::move(store)), settable_(settable) {}
            std::optional<PatterValue> get(const std::string& name) const override
            {
                const PatterValue* v = store_->get(name);
                return v ? std::optional<PatterValue>(*v) : std::nullopt;
            }
            bool canSet() const override { return settable_; }
            void set(const std::string& name, const PatterValue& value) override { store_->set(name, value); }
        private:
            std::shared_ptr<Store> store_;
            bool settable_;
        };

        /** The dialect the corpus is compiled with: five neutral tokens, `game`
         *  the default, and no functions. */
        inline Dialect CorpusDialect()
        {
            Dialect d;
            for (const char* token : { "game", "world", "here", "a", "b" })
            {
                ScopeDef def;
                def.token = token;
                d.scopes.push_back(def);
            }
            d.defaultScope = "game";
            return d;
        }

        inline std::string Identity(const std::string& name) { return name; }

        inline const Json& Need(const Json& step, const std::string& key)
        {
            const Json* v = step.find(key);
            if (!v) throw std::runtime_error("the step has no '" + key + "'");
            return *v;
        }

        inline std::optional<std::string> OptString(const Json& step, const std::string& key)
        {
            const Json* v = step.find(key);
            return v && v->isString() ? std::optional<std::string>(v->str) : std::nullopt;
        }

        inline bool Flag(const Json& step, const std::string& key)
        {
            const Json* v = step.find(key);
            return v && v->isBool() && v->b;
        }

        // -------------------------------------------------------------------
        // One case.
        // -------------------------------------------------------------------

        /** Run one case: a fresh registry, then each step in order. Returns one
         *  line per divergence (empty is a pass), so a run reports every way a
         *  case went wrong rather than stopping at the first. */
        inline std::vector<std::string> RunRegistryCase(const Json& c)
        {
            std::vector<std::string> fails;
            const std::string caseName = OptString(c, "name").value_or("<unnamed>");
            const Json* steps = c.find("steps");
            if (!steps || !steps->isArray())
            {
                fails.push_back(caseName + ": the case has no steps");
                return fails;
            }

            ScopeRegistry r;
            OrderedMap<std::string, std::shared_ptr<Store>> stores;
            const Dialect dialect = CorpusDialect();

            // Run fn. With want, it must throw a message containing want;
            // without, it must not throw. True when it ran without throwing.
            auto attempt = [&fails](const std::string& at, const std::optional<std::string>& want, const std::function<void()>& fn)
            {
                std::optional<std::string> message;
                try { fn(); }
                catch (const std::exception& ex) { message = ex.what(); }
                catch (...) { message = "a non-standard exception"; }
                if (message.has_value())
                {
                    if (!want.has_value()) fails.push_back(at + ": unexpected error: " + *message);
                    else if (message->find(*want) == std::string::npos) fails.push_back(at + ": error \"" + *message + "\" does not say \"" + *want + "\"");
                    return false;
                }
                if (want.has_value()) fails.push_back(at + ": expected an error saying \"" + *want + "\", none was raised");
                return true;
            };

            for (std::size_t i = 0; i < steps->arr.size(); ++i)
            {
                const Json& step = steps->arr[i];
                const std::string op = OptString(step, "op").value_or("<none>");
                const std::string at = caseName + " [step " + std::to_string(i + 1) + ": " + op + "]";
                const std::optional<std::string> expectError = OptString(step, "expectError");
                try
                {
                    if (op == "owned")
                    {
                        const std::vector<ScopeDeclaration> decls = ToDecls(step.find("declarations"));
                        OwnedScopeOptions options;
                        options.pathPrefix = OptString(step, "pathPrefix");
                        if (OptString(step, "normalise") == std::optional<std::string>("identity")) options.normalise = &Identity;
                        options.owner = OptString(step, "owner");
                        const std::string token = Need(step, "token").str;
                        attempt(at, expectError, [&]() { r.defineOwned(token, decls, options); });
                    }
                    else if (op == "mount")
                    {
                        const std::vector<ScopeDeclaration> decls = ToDecls(step.find("declarations"));
                        PropertyBag::Normalise norm;
                        if (OptString(step, "normalise") == std::optional<std::string>("identity")) norm = &Identity;
                        auto bag = std::make_shared<PropertyBag>(&decls, norm, OptString(step, "pathPrefix").value_or(""));
                        const std::string token = Need(step, "token").str;
                        const std::optional<std::string> owner = OptString(step, "owner");
                        attempt(at, expectError, [&]() { r.mountOwned(token, bag, owner); });
                    }
                    else if (op == "foreign")
                    {
                        auto store = std::make_shared<Store>();
                        if (const Json* seed = step.find("store")) *store = ToValues(*seed);
                        const Json* settable = step.find("settable");
                        const bool canSet = !(settable && settable->isBool() && !settable->b);
                        auto resolver = std::make_shared<StoreResolver>(store, canSet);
                        const std::vector<ScopeDeclaration> decls = ToDecls(step.find("declarations"));
                        ForeignScopeOptions options;
                        if (const Json* w = step.find("writable")) { if (w->isBool()) options.writable = w->b; }
                        if (OptString(step, "normalise") == std::optional<std::string>("identity")) options.normalise = &Identity;
                        options.owner = OptString(step, "owner");
                        const std::string token = Need(step, "token").str;
                        const bool ok = attempt(at, expectError, [&]() { r.defineForeign(token, resolver, &decls, options); });
                        if (ok) stores.set(token, store);
                    }
                    else if (op == "set")
                    {
                        const std::string scope = Need(step, "scope").str;
                        const std::string name = Need(step, "name").str;
                        const PatterValue value = ToValue(Need(step, "value"));
                        const bool host = Flag(step, "host");
                        attempt(at, expectError, [&]() { r.set(scope, name, value, host); });
                    }
                    else if (op == "get")
                    {
                        const std::optional<Json> got = ToJson(r.get(Need(step, "scope").str, Need(step, "name").str));
                        if (Flag(step, "expectUnset"))
                        {
                            if (got.has_value()) fails.push_back(at + ": expected unset, got " + Show(got));
                        }
                        else
                        {
                            const Json* expect = step.find("expect");
                            const std::optional<Json> want = expect ? std::optional<Json>(*expect) : std::nullopt;
                            if (!Same(got, want)) fails.push_back(at + ": got " + Show(got) + ", expected " + Show(want));
                        }
                    }
                    else if (op == "has")
                    {
                        const std::string token = Need(step, "token").str;
                        const bool expect = Need(step, "expect").b;
                        if (r.has(token) != expect)
                        {
                            fails.push_back(at + ": has('" + token + "') is " + (expect ? "false" : "true") + ", expected " + (expect ? "true" : "false"));
                        }
                    }
                    else if (op == "remove")
                    {
                        const std::string token = Need(step, "token").str;
                        const bool keep = Flag(step, "keep");
                        attempt(at, expectError, [&]() { r.remove(token, keep); });
                    }
                    else if (op == "save")
                    {
                        const Json got = ToJson(r.save());
                        const Json& expect = Need(step, "expect");
                        if (!Same(got, expect)) fails.push_back(at + ": saved " + Show(got) + ", expected " + Show(expect));
                    }
                    else if (op == "load")
                    {
                        const ScopeRegistry::SaveBlob blob = ToBlob(Need(step, "blob"));
                        const bool keepParked = Flag(step, "keepParked");
                        attempt(at, std::nullopt, [&]() { r.load(blob, keepParked); });
                    }
                    else if (op == "discardParked")
                    {
                        r.discardParked(OptString(step, "prefix"));
                    }
                    else if (op == "revision")
                    {
                        const double expect = Need(step, "expect").num;
                        if (static_cast<double>(r.revision()) != expect)
                        {
                            fails.push_back(at + ": revision is " + std::to_string(r.revision()) + ", expected " + PatterValue::JsNumber(expect));
                        }
                    }
                    else if (op == "store")
                    {
                        const std::string scope = Need(step, "scope").str;
                        const std::shared_ptr<Store>* store = stores.get(scope);
                        const std::optional<Json> got = store ? std::optional<Json>(ToJson(**store)) : std::nullopt;
                        const Json& expect = Need(step, "expect");
                        if (!Same(got, expect)) fails.push_back(at + ": the game's store holds " + Show(got) + ", expected " + Show(expect));
                    }
                    else if (op == "rows")
                    {
                        Json got = Json::MakeArray();
                        for (const ScopePropertyRow& row : r.listProperties())
                        {
                            Json o = Json::MakeObject();
                            o.obj.emplace_back("scope", Json::MakeString(row.scope));
                            if (row.owner.has_value()) o.obj.emplace_back("owner", Json::MakeString(*row.owner));
                            o.obj.emplace_back("name", Json::MakeString(row.name));
                            o.obj.emplace_back("path", Json::MakeString(row.path));
                            o.obj.emplace_back("value", ToJson(row.value));
                            o.obj.emplace_back("writable", Json::MakeBool(row.writable));
                            got.arr.push_back(std::move(o));
                        }
                        const Json& expect = Need(step, "expect");
                        if (!Same(got, expect)) fails.push_back(at + ": rows " + Show(got) + ", expected " + Show(expect));
                    }
                    else if (op == "eval")
                    {
                        const Json* ast = step.find("ast");
                        if (!ast)
                        {
                            fails.push_back(at + ": no compiled ast (the corpus was not built)");
                            continue;
                        }
                        ScopeRegistry::Aliases aliases;
                        if (const Json* a = step.find("aliases"))
                        {
                            for (const auto& kv : a->obj) aliases.set(kv.first, kv.second.str);
                        }
                        std::optional<PatterValue> got;
                        const bool ok = attempt(at, expectError, [&]()
                        {
                            EvalContext ctx = r.toEvalContext(nullptr, aliases);
                            got = Evaluate(DeserialiseAstFrom<Json>(*ast), ctx, dialect);
                        });
                        if (ok && !expectError.has_value())
                        {
                            const Json* expect = step.find("expect");
                            const std::optional<Json> want = expect ? std::optional<Json>(*expect) : std::nullopt;
                            if (!Same(ToJson(got), want))
                            {
                                fails.push_back(at + ": " + OptString(step, "src").value_or("") + " is " + Show(ToJson(got)) + ", expected " + Show(want));
                            }
                        }
                    }
                    else if (op == "spec")
                    {
                        const Json& source = Need(step, "source");
                        std::optional<ScopeRegistrySpec> spec;
                        const bool ok = attempt(at, expectError, [&]() { spec = ScopeRegistry::readScopeRegistrySpec(source); });
                        if (!ok || expectError.has_value()) continue;
                        if (Flag(step, "expectAbsent"))
                        {
                            if (spec.has_value()) fails.push_back(at + ": expected no spec, got one");
                        }
                        else if (!spec.has_value())
                        {
                            fails.push_back(at + ": expected a spec, got none");
                        }
                        else
                        {
                            Json summary = Json::MakeObject();
                            summary.obj.emplace_back("version", Json::MakeNumber(spec->version));
                            Json tokens = Json::MakeArray();
                            for (const auto& s : spec->scopes) tokens.arr.push_back(Json::MakeString(s.token));
                            summary.obj.emplace_back("tokens", std::move(tokens));
                            const Json& expect = Need(step, "expect");
                            if (!Same(summary, expect)) fails.push_back(at + ": read " + Show(summary) + ", expected " + Show(expect));
                        }
                    }
                    else
                    {
                        // The reference's step union has no other member, so a
                        // step this runner does not know is a corpus it cannot run.
                        fails.push_back(at + ": unknown step");
                    }
                }
                catch (const std::exception& ex)
                {
                    fails.push_back(at + ": the runner could not run the step: " + ex.what());
                }
            }
            return fails;
        }
    }

    /** What a host prints: cases passed, cases run, and one line per failure. */
    struct RegistryCorpusResult
    {
        int passed = 0;
        int total = 0;
        std::vector<std::string> failures;
    };

    /** The corpus version this runner understands. */
    constexpr int REGISTRY_CORPUS_VERSION = 1;

    /** Run the registry corpus at `path`. A corpus that is missing, unreadable,
     *  empty or of a version this runner does not know is a FAILURE, never a
     *  skip: a parity gate that does nothing when its fixture is absent is the
     *  shape of check this codebase has been bitten by. */
    inline RegistryCorpusResult RunRegistryCorpus(const std::string& path)
    {
        using registrycorpus::Json;
        RegistryCorpusResult result;
        std::ifstream in(path);
        if (!in)
        {
            result.failures.push_back("registry corpus not found: " + path);
            return result;
        }
        std::stringstream buffer;
        buffer << in.rdbuf();
        const std::string text = buffer.str();
        Json root;
        try
        {
            root = registrycorpus::JsonReader(text).parse();
        }
        catch (const std::exception& ex)
        {
            result.failures.push_back("registry corpus unreadable: " + path + ": " + ex.what());
            return result;
        }
        const Json* version = root.find("version");
        if (!version || !version->isNumber() || version->num != REGISTRY_CORPUS_VERSION)
        {
            result.failures.push_back("registry corpus version " + (version ? registrycorpus::Show(*version) : std::string("<none>"))
                + " is not the one this runner reads (" + std::to_string(REGISTRY_CORPUS_VERSION) + ")");
            return result;
        }
        const Json* cases = root.find("cases");
        if (!cases || !cases->isArray() || cases->arr.empty())
        {
            result.failures.push_back("registry corpus has no cases: " + path);
            return result;
        }
        for (const Json& c : cases->arr)
        {
            ++result.total;
            std::vector<std::string> fails = registrycorpus::RunRegistryCase(c);
            if (fails.empty()) ++result.passed;
            for (auto& f : fails) result.failures.push_back(std::move(f));
        }
        return result;
    }
}
