// Save / load: wrap the Engine's whole-game snapshot in the tagged `patter/save@0` envelope so a
// host can drop it into a file and restore it safely (a foreign blob throws instead of corrupting
// a run). THE WHOLE ENVELOPE IS THE FAMILY'S CONTRACT: `patter/save@0`, the shape the JS reference
// writes (@patterkit/model documents it; design/patter-schema.md 9), written and read identically by
// every Patterplay runtime so a save crosses engines. camelCase literal keys, the execution position
// under `cursor`, a pending choice as `{groupId, options}`, scopes two-level (`{"patter": {...}}`),
// selector cursors with every key optional. Until 0.11.0 this port wrote its own flat shape, which a
// JS save loaded into only partly: the flow came back and its pending choice did not
// (from-storylets/save-shape-across-engines, 2026-09-03). Reading still accepts that shape.
//
// std-only, and deliberately self-contained: the core is JSON-library-agnostic (Bundle.h), so this
// header carries its own compact JSON writer + reader for the SaveGame shape - which also makes the
// envelope testable in the clang TestHost, where Unreal's FJson does not exist. Reading accepts a
// bare version-2 snapshot (no envelope) for compatibility with files written before the envelope.
#pragma once

#include <cstdio>
#include <map>
#include <memory>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>
#include "Engine.h"
#include "StateLogger.h"   // loggerdetail::jsonQuote + formatStateValue (the shared value rendering)

namespace patter
{
    inline const char* SAVE_SCHEMA = "patter/save@0";

    // ----- writing ---------------------------------------------------------

    namespace savedetail
    {
        using loggerdetail::jsonQuote;

        inline std::string valueJson(const PatterValue& v) { return formatStateValue(v); }

        inline std::string valueMapJson(const std::map<std::string, PatterValue>& m)
        {
            std::string out = "{"; bool first = true;
            for (const auto& kv : m) { if (!first) out += ","; first = false; out += jsonQuote(kv.first) + ":" + valueJson(kv.second); }
            return out + "}";
        }

        inline std::string intMapJson(const std::map<std::string, int>& m)
        {
            std::string out = "{"; bool first = true;
            for (const auto& kv : m) { if (!first) out += ","; first = false; out += jsonQuote(kv.first) + ":" + std::to_string(kv.second); }
            return out + "}";
        }

        inline std::string stringListJson(const std::vector<std::string>& v)
        {
            std::string out = "["; for (size_t i = 0; i < v.size(); ++i) { if (i) out += ","; out += jsonQuote(v[i]); } return out + "]";
        }

        // Every key optional and present once used (the family's shape): `seq` after the first
        // sequential pick, `bag` once a shuffle has drawn, `last` once there is a no-repeat memory. The
        // "started" flags this core keeps (bagInit / hasLast) are derived from key presence on read.
        inline std::string selectorJson(const SelectorState& s)
        {
            std::string out = "{"; bool first = true;
            auto field = [&](const char* k, const std::string& v) { if (!first) out += ","; first = false; out += jsonQuote(k) + ":" + v; };
            if (s.seq != 0) field("seq", std::to_string(s.seq));
            if (s.bagInit) field("bag", stringListJson(s.bag));
            if (s.hasLast) field("last", jsonQuote(s.last));
            return out + "}";
        }

        inline std::string nullableJson(const std::string& s) { return s.empty() ? std::string("null") : jsonQuote(s); }

        inline std::string selectorMapJson(const std::map<std::string, SelectorState>& m)
        {
            std::string out = "{"; bool first = true;
            for (const auto& kv : m) { if (!first) out += ","; first = false; out += jsonQuote(kv.first) + ":" + selectorJson(kv.second); }
            return out + "}";
        }

        inline std::string bagMapJson(const std::map<std::string, std::map<std::string, PatterValue>>& m)
        {
            std::string out = "{"; bool first = true;
            for (const auto& kv : m) { if (!first) out += ","; first = false; out += jsonQuote(kv.first) + ":" + valueMapJson(kv.second); }
            return out + "}";
        }

        inline std::string optionJson(const ChoiceOption& o)
        {
            std::string out = "{\"id\":" + jsonQuote(o.id) + ",\"eligible\":" + (o.eligible ? "true" : "false");
            if (o.prompt)
            {
                // Optional prompt fields are absent, not empty, when the option has none (the JS shape).
                out += ",\"prompt\":{\"kind\":" + jsonQuote(o.prompt->kind) + ",\"text\":" + jsonQuote(o.prompt->text);
                if (!o.prompt->character.empty()) out += ",\"character\":" + jsonQuote(o.prompt->character);
                if (!o.prompt->characterName.empty()) out += ",\"characterName\":" + jsonQuote(o.prompt->characterName);
                if (!o.prompt->direction.empty()) out += ",\"direction\":" + jsonQuote(o.prompt->direction);
                out += "}";
            }
            if (o.gameData) out += ",\"gameData\":" + valueMapJson(*o.gameData);
            return out + "}";
        }

        inline std::string flowJson(const FlowSnapshot& f)
        {
            std::string out = "{";
            out += "\"scopes\":{\"patter\":" + valueMapJson(f.scopes) + "}";
            out += ",\"sceneBags\":" + bagMapJson(f.sceneBags);
            out += ",\"rngState\":" + std::to_string(static_cast<unsigned long long>(f.rngState));
            out += ",\"visits\":" + intMapJson(f.visits);
            // The execution position sits under `cursor`, as the JS reference writes it. An absent id
            // is null, not "" (this core keeps "" for none).
            out += ",\"cursor\":{";
            out += std::string("\"flowEnded\":") + (f.flowEnded ? "true" : "false");
            out += ",\"currentSceneId\":" + nullableJson(f.currentSceneId);
            out += ",\"stack\":[";
            for (size_t i = 0; i < f.stack.size(); ++i)
            {
                if (i) out += ",";
                const StackFrame& fr = f.stack[i];
                out += "{\"sceneId\":" + jsonQuote(fr.sceneId) + ",\"containerId\":" + jsonQuote(fr.containerId)
                     + ",\"index\":" + std::to_string(fr.index);
                if (!fr.nextId.empty()) out += ",\"nextId\":" + jsonQuote(fr.nextId);   // absent at a container's end
                out += "}";
            }
            out += "]";
            out += ",\"activeSnippetId\":" + nullableJson(f.activeSnippetId);
            out += ",\"beatIndex\":" + std::to_string(f.beatIndex);
            if (f.pendingOptions.empty()) out += ",\"pendingChoice\":null";
            else
            {
                out += ",\"pendingChoice\":{\"groupId\":" + jsonQuote(f.pendingGroupId) + ",\"options\":[";
                for (size_t i = 0; i < f.pendingOptions.size(); ++i) { if (i) out += ","; out += optionJson(f.pendingOptions[i]); }
                out += "]}";
            }
            out += ",\"pendingPromptOwnerId\":" + nullableJson(f.pendingPromptOwnerId);
            out += ",\"selectors\":" + selectorMapJson(f.selectors);
            return out + "}}";
        }
    }



    /// Serialise the whole game (shared state, visits, every live flow) to a tagged JSON string.
    inline std::string serializeState(Engine& engine)
    {
        using namespace savedetail;
        SaveGame s = engine.saveGame();
        std::string out = "{\"schema\":" + jsonQuote(SAVE_SCHEMA) + ",\"save\":{";
        out += "\"version\":" + std::to_string(s.version);
        out += ",\"shared\":{\"patter\":" + valueMapJson(s.shared) + "}";   // owned scope -> name -> value
        out += ",\"sharedVisits\":" + intMapJson(s.sharedVisits);
        out += ",\"sharedSelectors\":" + selectorMapJson(s.sharedSelectors);
        out += ",\"stageBags\":" + bagMapJson(s.stageBags);
        out += ",\"flows\":{";
        bool first = true;
        for (const auto& kv : s.flows) { if (!first) out += ","; first = false; out += jsonQuote(kv.first) + ":" + flowJson(kv.second); }
        out += "}}}";
        return out;
    }

    // ----- reading ---------------------------------------------------------

    namespace savedetail
    {
        // A compact JSON value + recursive-descent parser, just for the save shape (the same
        // pattern as the TestHost's Json.h; the runtime core stays JSON-library-agnostic).
        struct JV
        {
            enum class T { Null, Bool, Num, Str, Arr, Obj } t = T::Null;
            bool b = false; double n = 0; std::string s;
            std::vector<JV> arr;
            std::vector<std::pair<std::string, JV>> obj;

            const JV* get(const std::string& key) const
            {
                for (const auto& kv : obj) if (kv.first == key) return &kv.second;
                return nullptr;
            }
            std::string str(const std::string& key) const { const JV* v = get(key); return v && v->t == T::Str ? v->s : ""; }
            double num(const std::string& key) const { const JV* v = get(key); return v && v->t == T::Num ? v->n : 0; }
            bool boolean(const std::string& key) const { const JV* v = get(key); return v && v->t == T::Bool && v->b; }
        };

        class JParse
        {
        public:
            explicit JParse(const std::string& src) : s_(src) {}
            JV parse() { JV v = value(); ws(); if (i_ != s_.size()) fail("trailing data"); return v; }

        private:
            [[noreturn]] void fail(const std::string& m) { throw std::runtime_error("save JSON: " + m); }
            void ws() { while (i_ < s_.size() && (s_[i_] == ' ' || s_[i_] == '\t' || s_[i_] == '\n' || s_[i_] == '\r')) ++i_; }
            char peek() { ws(); if (i_ >= s_.size()) fail("unexpected end"); return s_[i_]; }
            void expect(char c) { if (peek() != c) fail(std::string("expected '") + c + "'"); ++i_; }

            JV value()
            {
                char c = peek();
                if (c == '{') return object();
                if (c == '[') return array();
                if (c == '"') { JV v; v.t = JV::T::Str; v.s = string(); return v; }
                if (c == 't') { lit("true"); JV v; v.t = JV::T::Bool; v.b = true; return v; }
                if (c == 'f') { lit("false"); JV v; v.t = JV::T::Bool; v.b = false; return v; }
                if (c == 'n') { lit("null"); return JV{}; }
                return number();
            }
            void lit(const char* w) { ws(); for (const char* p = w; *p; ++p, ++i_) { if (i_ >= s_.size() || s_[i_] != *p) fail("bad literal"); } }
            JV number()
            {
                ws(); size_t start = i_;
                while (i_ < s_.size() && (s_[i_] == '-' || s_[i_] == '+' || s_[i_] == '.' || s_[i_] == 'e' || s_[i_] == 'E' || (s_[i_] >= '0' && s_[i_] <= '9'))) ++i_;
                if (i_ == start) fail("expected number");
                JV v; v.t = JV::T::Num; v.n = std::stod(s_.substr(start, i_ - start)); return v;
            }
            std::string string()
            {
                expect('"');
                std::string out;
                while (true)
                {
                    if (i_ >= s_.size()) fail("unterminated string");
                    char c = s_[i_++];
                    if (c == '"') return out;
                    if (c != '\\') { out += c; continue; }
                    if (i_ >= s_.size()) fail("bad escape");
                    char e = s_[i_++];
                    switch (e)
                    {
                        case '"': out += '"'; break;
                        case '\\': out += '\\'; break;
                        case '/': out += '/'; break;
                        case 'n': out += '\n'; break;
                        case 'r': out += '\r'; break;
                        case 't': out += '\t'; break;
                        case 'b': out += '\b'; break;
                        case 'f': out += '\f'; break;
                        case 'u':
                        {
                            if (i_ + 4 > s_.size()) fail("bad \\u escape");
                            unsigned code = 0;
                            for (int k = 0; k < 4; ++k)
                            {
                                char h = s_[i_++]; code <<= 4;
                                if (h >= '0' && h <= '9') code += h - '0';
                                else if (h >= 'a' && h <= 'f') code += 10 + h - 'a';
                                else if (h >= 'A' && h <= 'F') code += 10 + h - 'A';
                                else fail("bad \\u escape");
                            }
                            // BMP only (the writer never emits surrogate pairs; save keys/values are UTF-8 already).
                            if (code < 0x80) out += static_cast<char>(code);
                            else if (code < 0x800) { out += static_cast<char>(0xC0 | (code >> 6)); out += static_cast<char>(0x80 | (code & 0x3F)); }
                            else { out += static_cast<char>(0xE0 | (code >> 12)); out += static_cast<char>(0x80 | ((code >> 6) & 0x3F)); out += static_cast<char>(0x80 | (code & 0x3F)); }
                            break;
                        }
                        default: fail("bad escape");
                    }
                }
            }
            JV object()
            {
                expect('{'); JV v; v.t = JV::T::Obj;
                if (peek() == '}') { ++i_; return v; }
                while (true)
                {
                    std::string key = string(); expect(':');
                    v.obj.emplace_back(std::move(key), value());
                    char c = peek();
                    if (c == ',') { ++i_; continue; }
                    expect('}'); return v;
                }
            }
            JV array()
            {
                expect('['); JV v; v.t = JV::T::Arr;
                if (peek() == ']') { ++i_; return v; }
                while (true)
                {
                    v.arr.push_back(value());
                    char c = peek();
                    if (c == ',') { ++i_; continue; }
                    expect(']'); return v;
                }
            }

            const std::string& s_;
            size_t i_ = 0;
        };

        inline PatterValue toValue(const JV& v)
        {
            switch (v.t)
            {
                case JV::T::Bool: return PatterValue::Bool(v.b);
                case JV::T::Num: return PatterValue::Num(v.n);
                case JV::T::Str: return PatterValue::Str(v.s);
                case JV::T::Arr:
                {
                    std::vector<std::string> flags;
                    for (const auto& e : v.arr) if (e.t == JV::T::Str) flags.push_back(e.s);
                    return PatterValue::Flags(flags);
                }
                default: return PatterValue::Bool(false);
            }
        }

        inline std::map<std::string, PatterValue> toValueMap(const JV* o)
        {
            std::map<std::string, PatterValue> m;
            if (o && o->t == JV::T::Obj) for (const auto& kv : o->obj) m[kv.first] = toValue(kv.second);
            return m;
        }

        // `{"patter": {name: value}}` (the family's two-level shape) or a bare map (this port before
        // 0.11.0). A bare map's values are scalars and arrays, never objects, which tells the two apart.
        inline std::map<std::string, PatterValue> toScope(const JV* o)
        {
            if (o && o->t == JV::T::Obj && !o->obj.empty())
            {
                bool twoLevel = true;
                for (const auto& kv : o->obj) if (kv.second.t != JV::T::Obj) { twoLevel = false; break; }
                if (twoLevel) return toValueMap(o->get("patter"));
            }
            return toValueMap(o);
        }

        inline std::map<std::string, int> toIntMap(const JV* o)
        {
            std::map<std::string, int> m;
            if (o && o->t == JV::T::Obj) for (const auto& kv : o->obj) m[kv.first] = static_cast<int>(kv.second.n);
            return m;
        }

        inline SelectorState toSelector(const JV& v)
        {
            SelectorState s;
            s.seq = static_cast<int>(v.num("seq"));
            // Presence IS the flag in the family's shape; the explicit booleans are this port's pre-0.11.0 keys.
            const JV* bag = v.get("bag");
            s.bagInit = (bag != nullptr) || v.boolean("bagInit");
            if (bag) for (const auto& e : bag->arr) s.bag.push_back(e.s);
            const JV* last = v.get("last");
            s.hasLast = (last != nullptr && last->t == JV::T::Str) || v.boolean("hasLast");
            s.last = v.str("last");
            return s;
        }

        inline std::map<std::string, SelectorState> toSelectorMap(const JV* o)
        {
            std::map<std::string, SelectorState> m;
            if (o && o->t == JV::T::Obj) for (const auto& kv : o->obj) m[kv.first] = toSelector(kv.second);
            return m;
        }

        inline std::map<std::string, std::map<std::string, PatterValue>> toBagMap(const JV* o)
        {
            std::map<std::string, std::map<std::string, PatterValue>> m;
            if (o && o->t == JV::T::Obj) for (const auto& kv : o->obj) m[kv.first] = toValueMap(&kv.second);
            return m;
        }

        inline ChoiceOption toOption(const JV& e)
        {
            ChoiceOption o;
            o.id = e.str("id"); o.eligible = e.boolean("eligible");
            if (const JV* p = e.get("prompt"))
            {
                auto prompt = std::make_shared<ChoicePrompt>();
                prompt->kind = p->str("kind"); prompt->text = p->str("text");
                prompt->character = p->str("character"); prompt->characterName = p->str("characterName");
                prompt->direction = p->str("direction");
                o.prompt = prompt;
            }
            if (const JV* gd = e.get("gameData")) o.gameData = std::make_shared<GameData>(toValueMap(gd));
            return o;
        }

        inline FlowSnapshot toFlow(const JV& v)
        {
            FlowSnapshot f;
            f.scopes = toScope(v.get("scopes"));
            f.sceneBags = toBagMap(v.get("sceneBags"));
            // The JS runtime accumulated this state with `| 0` until 0.x, so saves in
            // the wild carry it SIGNED. Casting a negative double straight to
            // uint32_t is undefined behaviour (it gave 0 at -O0 and garbage at -O2),
            // so it goes through the same ToUint32 the seed does.
            f.rngState = Mulberry32::ToUint32(v.num("rngState"));
            f.visits = toIntMap(v.get("visits"));
            // The family nests the execution position under `cursor`; this port's pre-0.11.0 shape
            // kept those fields flat on the flow. Same reads either way.
            const JV* cursor = v.get("cursor");
            const JV& c = cursor ? *cursor : v;
            f.flowEnded = c.boolean("flowEnded");
            f.currentSceneId = c.str("currentSceneId");   // null -> "" (this core's "none")
            if (const JV* stack = c.get("stack"))
                for (const auto& e : stack->arr)
                {
                    StackFrame fr;
                    fr.sceneId = e.str("sceneId"); fr.containerId = e.str("containerId");
                    fr.index = static_cast<int>(e.num("index")); fr.nextId = e.str("nextId");
                    f.stack.push_back(std::move(fr));
                }
            f.activeSnippetId = c.str("activeSnippetId");
            f.beatIndex = static_cast<int>(c.num("beatIndex"));
            if (const JV* pc = c.get("pendingChoice"))
            {
                if (pc->t == JV::T::Obj)
                {
                    f.pendingGroupId = pc->str("groupId");
                    if (const JV* opts = pc->get("options")) for (const auto& e : opts->arr) f.pendingOptions.push_back(toOption(e));
                }
            }
            else   // pre-0.11.0: the group id and options flat on the flow
            {
                f.pendingGroupId = c.str("pendingGroupId");
                if (const JV* opts = c.get("pendingOptions")) for (const auto& e : opts->arr) f.pendingOptions.push_back(toOption(e));
            }
            f.pendingPromptOwnerId = c.str("pendingPromptOwnerId");
            f.selectors = toSelectorMap(c.get("selectors"));
            return f;
        }
    }

    /// Parse + restore a serializeState string (or a bare version-2 snapshot from before the
    /// envelope existed). Throws on malformed JSON or a foreign envelope.
    inline void deserializeState(Engine& engine, const std::string& json)
    {
        using namespace savedetail;
        JV root = JParse(json).parse();
        const JV* saveObj = nullptr;
        if (root.get("schema"))
        {
            if (root.str("schema") != SAVE_SCHEMA) throw std::runtime_error(std::string("loadState: not a ") + SAVE_SCHEMA + " envelope");
            saveObj = root.get("save");
            if (!saveObj) throw std::runtime_error(std::string("loadState: not a ") + SAVE_SCHEMA + " envelope");
        }
        else if (root.get("version")) saveObj = &root;  // bare snapshot (pre-envelope file)
        else throw std::runtime_error(std::string("loadState: not a ") + SAVE_SCHEMA + " envelope");

        SaveGame s;
        s.version = static_cast<int>(saveObj->num("version"));
        s.shared = toScope(saveObj->get("shared"));
        s.sharedVisits = toIntMap(saveObj->get("sharedVisits"));
        s.sharedSelectors = toSelectorMap(saveObj->get("sharedSelectors"));
        s.stageBags = toBagMap(saveObj->get("stageBags"));
        if (const JV* flows = saveObj->get("flows"))
            if (flows->t == JV::T::Obj)
                for (const auto& kv : flows->obj) s.flows[kv.first] = toFlow(kv.second);
        engine.loadGame(s);
    }
}
