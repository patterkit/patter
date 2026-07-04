// A tiny, dependency-free JSON value + parser, just for the standalone corpus TestHost
// (the UE plugin uses FJsonObject instead). Parses the well-formed corpus.json / bundles
// into an ordered JsonValue tree, and offers small builders for producing comparison output.
#pragma once

#include <string>
#include <vector>
#include <utility>
#include <stdexcept>
#include <cstdlib>

struct JsonValue
{
    enum Type { Null, Bool, Number, String, Array, Object } type = Null;
    bool b = false;
    double num = 0;
    std::string str;
    std::vector<JsonValue> arr;
    std::vector<std::pair<std::string, JsonValue>> obj;   // insertion order preserved

    bool isObject() const { return type == Object; }
    bool isArray() const { return type == Array; }
    bool isString() const { return type == String; }
    bool isNumber() const { return type == Number; }
    bool isBool() const { return type == Bool; }
    bool isNull() const { return type == Null; }

    const JsonValue* find(const std::string& key) const
    {
        for (const auto& kv : obj) if (kv.first == key) return &kv.second;
        return nullptr;
    }
    bool has(const std::string& key) const { return find(key) != nullptr; }
    const JsonValue& at(const std::string& key) const
    {
        const JsonValue* v = find(key);
        if (!v) throw std::runtime_error("missing key: " + key);
        return *v;
    }

    // builders
    static JsonValue Str(std::string s) { JsonValue v; v.type = String; v.str = std::move(s); return v; }
    static JsonValue Num(double n) { JsonValue v; v.type = Number; v.num = n; return v; }
    static JsonValue Boolean(bool x) { JsonValue v; v.type = Bool; v.b = x; return v; }
    static JsonValue Arr() { JsonValue v; v.type = Array; return v; }
    static JsonValue Obj() { JsonValue v; v.type = Object; return v; }
    void set(const std::string& k, JsonValue val) { obj.emplace_back(k, std::move(val)); }
    void push(JsonValue val) { arr.push_back(std::move(val)); }
};

class JsonParser
{
public:
    explicit JsonParser(const std::string& text) : s_(text), i_(0) {}

    JsonValue parse()
    {
        skipWs();
        JsonValue v = parseValue();
        return v;
    }

private:
    const std::string& s_;
    size_t i_;

    void skipWs() { while (i_ < s_.size() && (s_[i_] == ' ' || s_[i_] == '\t' || s_[i_] == '\n' || s_[i_] == '\r')) ++i_; }
    char peek() { return i_ < s_.size() ? s_[i_] : '\0'; }
    char next() { return s_[i_++]; }
    [[noreturn]] void err(const std::string& m) { throw std::runtime_error("JSON parse error at " + std::to_string(i_) + ": " + m); }

    JsonValue parseValue()
    {
        skipWs();
        char c = peek();
        if (c == '{') return parseObject();
        if (c == '[') return parseArray();
        if (c == '"') { JsonValue v; v.type = JsonValue::String; v.str = parseString(); return v; }
        if (c == 't' || c == 'f') return parseBool();
        if (c == 'n') { expect("null"); return JsonValue(); }
        return parseNumber();
    }

    void expect(const char* lit) { for (const char* p = lit; *p; ++p) { if (next() != *p) err("expected literal"); } }

    JsonValue parseBool()
    {
        JsonValue v; v.type = JsonValue::Bool;
        if (peek() == 't') { expect("true"); v.b = true; } else { expect("false"); v.b = false; }
        return v;
    }

    JsonValue parseNumber()
    {
        size_t start = i_;
        if (peek() == '-') ++i_;
        while (i_ < s_.size())
        {
            char c = s_[i_];
            if ((c >= '0' && c <= '9') || c == '.' || c == 'e' || c == 'E' || c == '+' || c == '-') ++i_;
            else break;
        }
        JsonValue v; v.type = JsonValue::Number;
        v.num = std::strtod(s_.substr(start, i_ - start).c_str(), nullptr);
        return v;
    }

    std::string parseString()
    {
        if (next() != '"') err("expected string");
        std::string out;
        while (i_ < s_.size())
        {
            char c = next();
            if (c == '"') return out;
            if (c == '\\')
            {
                char e = next();
                switch (e)
                {
                    case '"': out += '"'; break;
                    case '\\': out += '\\'; break;
                    case '/': out += '/'; break;
                    case 'n': out += '\n'; break;
                    case 't': out += '\t'; break;
                    case 'r': out += '\r'; break;
                    case 'b': out += '\b'; break;
                    case 'f': out += '\f'; break;
                    case 'u':
                    {
                        // Decode \uXXXX to UTF-8 (BMP only - enough for the corpus).
                        unsigned code = 0;
                        for (int k = 0; k < 4; ++k) { char h = next(); code = code * 16 + hexVal(h); }
                        appendUtf8(out, code);
                        break;
                    }
                    default: out += e; break;
                }
            }
            else out += c;
        }
        err("unterminated string");
    }

    static int hexVal(char h)
    {
        if (h >= '0' && h <= '9') return h - '0';
        if (h >= 'a' && h <= 'f') return h - 'a' + 10;
        if (h >= 'A' && h <= 'F') return h - 'A' + 10;
        return 0;
    }
    static void appendUtf8(std::string& out, unsigned code)
    {
        if (code < 0x80) out += static_cast<char>(code);
        else if (code < 0x800) { out += static_cast<char>(0xC0 | (code >> 6)); out += static_cast<char>(0x80 | (code & 0x3F)); }
        else { out += static_cast<char>(0xE0 | (code >> 12)); out += static_cast<char>(0x80 | ((code >> 6) & 0x3F)); out += static_cast<char>(0x80 | (code & 0x3F)); }
    }

    JsonValue parseArray()
    {
        JsonValue v; v.type = JsonValue::Array;
        next(); // [
        skipWs();
        if (peek() == ']') { next(); return v; }
        for (;;)
        {
            v.arr.push_back(parseValue());
            skipWs();
            char c = next();
            if (c == ']') break;
            if (c != ',') err("expected , or ]");
            skipWs();
        }
        return v;
    }

    JsonValue parseObject()
    {
        JsonValue v; v.type = JsonValue::Object;
        next(); // {
        skipWs();
        if (peek() == '}') { next(); return v; }
        for (;;)
        {
            skipWs();
            std::string key = parseString();
            skipWs();
            if (next() != ':') err("expected :");
            v.obj.emplace_back(key, parseValue());
            skipWs();
            char c = next();
            if (c == '}') break;
            if (c != ',') err("expected , or }");
        }
        return v;
    }
};
