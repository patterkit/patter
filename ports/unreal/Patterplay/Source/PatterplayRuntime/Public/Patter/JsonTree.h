// A neutral JSON value tree, for the bundle values the engine hands over without reading: Patter
// extension values (patterkit design/proposals/patter-storylet-extensions.md, "At runtime"), which may be
// any JSON (a record, a map or a list as well as the seven field types), so no PatterValue can hold them.
//
// The core still depends on no JSON library: BundleJson.h builds these trees from whatever node type a
// host parses with (the TestHost's own, the plugin's FJsonValue), as it reads the rest of a bundle. An
// object keeps its keys in document order, as the bundle wrote them.
//
// jsonText writes a tree back as strict, compact JSON (what the Blueprint layer hands a game, since a
// Blueprint struct can't nest itself), and parseJsonText reads that text back.
#pragma once

#include <cmath>
#include <cstddef>
#include <cstdio>
#include <cstdlib>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>
#include "PatterValue.h"   // PatterValue::JsNumber, the one number rendering
#include "JsonEscape.h"

namespace patter
{
    struct JsonTree
    {
        enum Type { Null, Bool, Number, String, Array, Object };

        Type type = Null;
        bool b = false;
        double num = 0;
        std::string str;
        std::vector<JsonTree> arr;
        std::vector<std::pair<std::string, JsonTree>> obj;   // document order

        bool isNull() const { return type == Null; }
        bool isBool() const { return type == Bool; }
        bool isNumber() const { return type == Number; }
        bool isString() const { return type == String; }
        bool isArray() const { return type == Array; }
        bool isObject() const { return type == Object; }

        /** An object's value at `key`; nullptr when absent or this is no object. */
        const JsonTree* find(const std::string& key) const
        {
            for (const auto& kv : obj) if (kv.first == key) return &kv.second;
            return nullptr;
        }

        static JsonTree makeBool(bool x) { JsonTree v; v.type = Bool; v.b = x; return v; }
        static JsonTree makeNumber(double n) { JsonTree v; v.type = Number; v.num = n; return v; }
        static JsonTree makeString(std::string s) { JsonTree v; v.type = String; v.str = std::move(s); return v; }
        static JsonTree makeArray() { JsonTree v; v.type = Array; return v; }
        static JsonTree makeObject() { JsonTree v; v.type = Object; return v; }
    };

    namespace jsontree
    {
        /** A string as JSON.stringify writes it: the two-character escapes, any other control character
         *  as \u00xx, and everything else (UTF-8 included) as it is. */
        inline void writeQuoted(std::string& out, const std::string& s)
        {
            out += '"';
            for (char c : s)
            {
                switch (c)
                {
                    case '"': out += "\\\""; break;
                    case '\\': out += "\\\\"; break;
                    case '\b': out += "\\b"; break;
                    case '\f': out += "\\f"; break;
                    case '\n': out += "\\n"; break;
                    case '\r': out += "\\r"; break;
                    case '\t': out += "\\t"; break;
                    default:
                        if (static_cast<unsigned char>(c) < 0x20)
                        {
                            char buf[8];
                            std::snprintf(buf, sizeof(buf), "\\u%04x", static_cast<unsigned>(static_cast<unsigned char>(c)));
                            out += buf;
                        }
                        else out += c;
                        break;
                }
            }
            out += '"';
        }

        inline void write(std::string& out, const JsonTree& v)
        {
            switch (v.type)
            {
                case JsonTree::Null: out += "null"; break;
                case JsonTree::Bool: out += v.b ? "true" : "false"; break;
                // A number JSON can't carry (NaN, an infinity) writes as null, as JSON.stringify does.
                case JsonTree::Number: out += std::isfinite(v.num) ? PatterValue::JsNumber(v.num) : "null"; break;
                case JsonTree::String: writeQuoted(out, v.str); break;
                case JsonTree::Array:
                    out += '[';
                    for (std::size_t i = 0; i < v.arr.size(); ++i) { if (i) out += ','; write(out, v.arr[i]); }
                    out += ']';
                    break;
                case JsonTree::Object:
                    out += '{';
                    for (std::size_t i = 0; i < v.obj.size(); ++i)
                    {
                        if (i) out += ',';
                        writeQuoted(out, v.obj[i].first);
                        out += ':';
                        write(out, v.obj[i].second);
                    }
                    out += '}';
                    break;
            }
        }

        /** A strict reader for one JSON document: what jsonText writes, and any other well-formed JSON. */
        class Reader
        {
        public:
            explicit Reader(const std::string& text) : s_(text) {}

            JsonTree document()
            {
                JsonTree v = value();
                skipWs();
                if (i_ != s_.size()) fail("trailing text");
                return v;
            }

        private:
            const std::string& s_;
            std::size_t i_ = 0;

            [[noreturn]] void fail(const std::string& what) const
            {
                throw std::runtime_error("JSON: " + what + " at " + std::to_string(i_));
            }
            void skipWs() { while (i_ < s_.size() && (s_[i_] == ' ' || s_[i_] == '\t' || s_[i_] == '\n' || s_[i_] == '\r')) ++i_; }
            char peek() const { return i_ < s_.size() ? s_[i_] : '\0'; }
            void literal(const char* word)
            {
                for (const char* p = word; *p; ++p, ++i_) if (i_ >= s_.size() || s_[i_] != *p) fail("bad literal");
            }

            JsonTree value()
            {
                skipWs();
                const char c = peek();
                if (c == '{') return object();
                if (c == '[') return array();
                if (c == '"') return JsonTree::makeString(string());
                if (c == 't') { literal("true"); return JsonTree::makeBool(true); }
                if (c == 'f') { literal("false"); return JsonTree::makeBool(false); }
                if (c == 'n') { literal("null"); return JsonTree(); }
                if (c == '-' || (c >= '0' && c <= '9')) return number();
                fail("unexpected character");
            }

            JsonTree number()
            {
                const std::size_t start = i_;
                if (peek() == '-') ++i_;
                bool digits = false;
                while (i_ < s_.size())
                {
                    const char c = s_[i_];
                    if (c >= '0' && c <= '9') { digits = true; ++i_; }
                    else if (c == '.' || c == 'e' || c == 'E' || c == '+' || c == '-') ++i_;
                    else break;
                }
                if (!digits) fail("bad number");
                const std::string text = s_.substr(start, i_ - start);
                char* end = nullptr;
                const double n = std::strtod(text.c_str(), &end);
                if (end != text.c_str() + text.size()) fail("bad number");
                return JsonTree::makeNumber(n);
            }

            std::string string()
            {
                ++i_;   // the opening quote
                std::string out;
                while (i_ < s_.size())
                {
                    const char c = s_[i_++];
                    if (c == '"') return out;
                    if (c != '\\') { out += c; continue; }
                    if (i_ >= s_.size()) break;
                    const char e = s_[i_++];
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
                        case 'u': if (!jsonescape::decodeUnicodeEscape(s_, i_, out)) fail("bad \\u escape"); break;
                        default: fail("bad escape");
                    }
                }
                fail("unterminated string");
            }

            JsonTree array()
            {
                ++i_;
                JsonTree v = JsonTree::makeArray();
                skipWs();
                if (peek() == ']') { ++i_; return v; }
                for (;;)
                {
                    v.arr.push_back(value());
                    skipWs();
                    const char c = peek();
                    ++i_;
                    if (c == ']') return v;
                    if (c != ',') fail("expected , or ]");
                }
            }

            JsonTree object()
            {
                ++i_;
                JsonTree v = JsonTree::makeObject();
                skipWs();
                if (peek() == '}') { ++i_; return v; }
                for (;;)
                {
                    skipWs();
                    if (peek() != '"') fail("expected a key");
                    std::string key = string();
                    skipWs();
                    if (peek() != ':') fail("expected :");
                    ++i_;
                    v.obj.emplace_back(std::move(key), value());
                    skipWs();
                    const char c = peek();
                    ++i_;
                    if (c == '}') return v;
                    if (c != ',') fail("expected , or }");
                }
            }
        };
    }

    /** A tree as strict, compact JSON text: object keys in their stored (document) order, numbers as
     *  JavaScript prints them, so a value crosses exactly as the bundle wrote it. */
    inline std::string jsonText(const JsonTree& v)
    {
        std::string out;
        jsontree::write(out, v);
        return out;
    }

    /** One JSON document read into a tree. Throws std::runtime_error when the text isn't JSON. */
    inline JsonTree parseJsonText(const std::string& text)
    {
        return jsontree::Reader(text).document();
    }
}
