// Save / load: wrap the Engine's whole-game snapshot in the tagged `patter/save@0` envelope so a
// host can drop it into a file and restore it safely (a foreign blob throws instead of corrupting
// a run). THE WHOLE ENVELOPE IS THE FAMILY'S CONTRACT: `patter/save@0`, the shape the JS reference
// writes (@patterkit/model documents it; design/patter-schema.md 9), written and read identically by
// every Patterplay runtime so a save crosses engines. camelCase literal keys, the execution position
// under `cursor`, a pending choice as `{groupId, options}`, selector cursors with every key optional.
//
// Version 3 (the one-registry model): property values are the registry's, not the engine's. A save
// holds only what is NOT a property (cursors, PRNGs, visits, selectors), plus, when the engine made
// its own registry (a standalone game), that registry's values under `registry`, keyed by registry
// key (`patter`, `patter/scene/<scene>`, `patter/flow/<flow>/patter`, `patter/flow/<flow>/scene/<scene>`,
// and a self-backed host scope's token).
//
// Version 4 (Patterplay 1.0): a pending choice keeps its options' ids, eligibility, and gameData, not
// their prompts, which are built again in the language in use whenever the choice is delivered; the
// cursor names the next beat by id (`beatId`, absent when none is left) rather than by its index; and a
// frame inside a choice's option carries the choice's id (`choiceId`). Versions 3 and 4 are read, and 4
// is written; a version 3 save's prompt text is discarded as it loads. Version 2 no longer loads.
//
// std-only, and deliberately self-contained: the core is JSON-library-agnostic (Bundle.h), so this
// header carries its own compact JSON writer + reader for the SaveGame shape - which also makes the
// envelope testable in the clang TestHost, where Unreal's FJson does not exist. Reading refuses a
// bare snapshot with no envelope, as every Patterplay runtime does.
#pragma once

#include <cstdio>
#include <map>
#include <memory>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>
#include "Engine.h"
#include "JsonEscape.h"    // jsonescape::decodeUnicodeEscape, shared with the TestHost's reader
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

        inline std::string valueMapJson(const OrderedMap<std::string, PatterValue>& m)
        {
            std::string out = "{"; bool first = true;
            for (const auto& kv : m) { if (!first) out += ","; first = false; out += jsonQuote(kv.first) + ":" + valueJson(kv.second); }
            return out + "}";
        }

        // Registry values: registry key -> name -> value, in the registry's own order.
        inline std::string registryJson(const ScopeRegistry::SaveBlob& blob)
        {
            std::string out = "{"; bool first = true;
            for (const auto& kv : blob) { if (!first) out += ","; first = false; out += jsonQuote(kv.first) + ":" + valueMapJson(kv.second); }
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

        inline std::string promptJson(const ChoicePrompt& p)
        {
            // Optional prompt fields are absent when unset and kept when set, even to "" (the JS shape).
            std::string out = "{\"kind\":" + jsonQuote(p.kind) + ",\"text\":" + jsonQuote(p.text);
            if (p.hasCharacter) out += ",\"character\":" + jsonQuote(p.character);
            if (p.hasCharacterName) out += ",\"characterName\":" + jsonQuote(p.characterName);
            if (p.hasDirection) out += ",\"direction\":" + jsonQuote(p.direction);
            if (p.hasQualifier) out += ",\"qualifier\":" + jsonQuote(p.qualifier);
            if (p.hasQualifierName) out += ",\"qualifierName\":" + jsonQuote(p.qualifierName);
            if (p.hasSpeakerLabel) out += ",\"speakerLabel\":" + jsonQuote(p.speakerLabel);
            if (p.hasPadAfter) out += ",\"padAfter\":" + PatterValue::JsNumber(p.padAfter);   // line padding
            return out + "}";
        }

        // A pending choice's option: which, whether it could be taken, and its gameData. Never its prompt.
        inline std::string optionJson(const PendingOption& o)
        {
            std::string out = "{\"id\":" + jsonQuote(o.id) + ",\"eligible\":" + (o.eligible ? "true" : "false");
            if (o.gameData) out += ",\"gameData\":" + valueMapJson(*o.gameData);
            return out + "}";
        }

        // A flow's fields as a save writes them, without the braces, so a FlowState can add its own.
        inline std::string flowFieldsJson(const FlowSnapshot& f)
        {
            std::string out;
            out += "\"rngState\":" + std::to_string(static_cast<unsigned long long>(f.rngState));
            out += ",\"visits\":" + intMapJson(f.visits);
            // The execution position sits under `cursor`, as the JS reference writes it. An absent id
            // is null, not "" (this core keeps "" for none).
            out += ",\"cursor\":{";
            out += std::string("\"flowEnded\":") + (f.flowEnded ? "true" : "false");
            // Why it ended, when a choice running dry ended it (its group), so a loaded game ends the same way.
            // Written only then, as the JS reference writes it.
            if (!f.ranDry.empty()) out += ",\"ranDry\":" + jsonQuote(f.ranDry);
            out += ",\"currentSceneId\":" + nullableJson(f.currentSceneId);
            out += ",\"stack\":[";
            for (size_t i = 0; i < f.stack.size(); ++i)
            {
                if (i) out += ",";
                const StackFrame& fr = f.stack[i];
                out += "{\"sceneId\":" + jsonQuote(fr.sceneId) + ",\"containerId\":" + jsonQuote(fr.containerId)
                     + ",\"index\":" + std::to_string(fr.index);
                if (!fr.nextId.empty()) out += ",\"nextId\":" + jsonQuote(fr.nextId);   // absent at a container's end
                if (!fr.choiceId.empty()) out += ",\"choiceId\":" + jsonQuote(fr.choiceId);   // only inside an option
                out += "}";
            }
            out += "]";
            out += ",\"activeSnippetId\":" + nullableJson(f.activeSnippetId);
            if (!f.beatId.empty()) out += ",\"beatId\":" + jsonQuote(f.beatId);   // absent once every beat is delivered
            if (!f.hasPendingChoice) out += ",\"pendingChoice\":null";
            else
            {
                out += ",\"pendingChoice\":{\"groupId\":" + jsonQuote(f.pendingGroupId) + ",\"options\":[";
                for (size_t i = 0; i < f.pendingOptions.size(); ++i) { if (i) out += ","; out += optionJson(f.pendingOptions[i]); }
                out += "]}";
            }
            out += ",\"pendingPromptOwnerId\":" + nullableJson(f.pendingPromptOwnerId);
            // The prompt still to replay, as the choice showed it: written only in the choose->advance window.
            if (f.pendingPrompt) out += ",\"pendingPrompt\":" + promptJson(*f.pendingPrompt);
            out += ",\"selectors\":" + selectorMapJson(f.selectors);
            return out + "}";
        }

        inline std::string flowJson(const FlowSnapshot& f)
        {
            // A flow holds no properties since version 3: those are the registry's.
            return "{" + flowFieldsJson(f) + "}";
        }

        // A FlowState's own property values: `scopes` in the family's two-level shape, and `sceneBags`
        // (scene id -> name -> value).
        inline std::string flowValuesJson(const FlowState& f)
        {
            std::string out = "\"scopes\":{\"patter\":" + valueMapJson(f.scopes) + "},\"sceneBags\":{";
            bool first = true;
            for (const auto& kv : f.sceneBags) { if (!first) out += ","; first = false; out += jsonQuote(kv.first) + ":" + valueMapJson(kv.second); }
            return out + "}";
        }
    }



    /// Serialise the whole game (visits, selectors, every live flow, and a standalone engine's registry
    /// values) to a tagged JSON string. A game that passed its own registry saves that once, beside this.
    inline std::string serializeState(Engine& engine)
    {
        using namespace savedetail;
        SaveGame s = engine.saveGame();
        std::string out = "{\"schema\":" + jsonQuote(SAVE_SCHEMA) + ",\"save\":{";
        out += "\"version\":" + std::to_string(s.version);
        if (s.registry) out += ",\"registry\":" + registryJson(*s.registry);   // registry key -> name -> value
        out += ",\"sharedVisits\":" + intMapJson(s.sharedVisits);
        out += ",\"sharedSelectors\":" + selectorMapJson(s.sharedSelectors);
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
                            if (!jsonescape::decodeUnicodeEscape(s_, i_, out)) fail("bad \\u escape");
                            break;
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

        // A FlowState's `scopes`: `{"patter": {name: value}}`, the family's two-level shape.
        inline std::map<std::string, PatterValue> toScope(const JV* o)
        {
            return o && o->t == JV::T::Obj ? toValueMap(o->get("patter")) : std::map<std::string, PatterValue>{};
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
            // Presence IS the flag in the family's shape.
            const JV* bag = v.get("bag");
            s.bagInit = bag != nullptr;
            if (bag) for (const auto& e : bag->arr) s.bag.push_back(e.s);
            const JV* last = v.get("last");
            s.hasLast = last != nullptr && last->t == JV::T::Str;
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

        inline std::shared_ptr<ChoicePrompt> toPrompt(const JV& p)
        {
            auto prompt = std::make_shared<ChoicePrompt>();
            prompt->kind = p.str("kind"); prompt->text = p.str("text");
            if (const JV* v = p.get("character")) { prompt->hasCharacter = true; prompt->character = v->t == JV::T::Str ? v->s : ""; }
            if (const JV* v = p.get("characterName")) { prompt->hasCharacterName = true; prompt->characterName = v->t == JV::T::Str ? v->s : ""; }
            if (const JV* v = p.get("direction")) { prompt->hasDirection = true; prompt->direction = v->t == JV::T::Str ? v->s : ""; }
            if (const JV* v = p.get("qualifier")) { prompt->hasQualifier = true; prompt->qualifier = v->t == JV::T::Str ? v->s : ""; }
            if (const JV* v = p.get("qualifierName")) { prompt->hasQualifierName = true; prompt->qualifierName = v->t == JV::T::Str ? v->s : ""; }
            // Absent in a save written before prompts carried it: the engine re-resolves it on load, in the current locale.
            if (const JV* v = p.get("speakerLabel")) if (v->t == JV::T::Str) { prompt->hasSpeakerLabel = true; prompt->speakerLabel = v->s; }
            // Absent in a save written before prompts carried their pause: the engine re-resolves it on load.
            if (const JV* v = p.get("padAfter")) if (v->t == JV::T::Num) { prompt->hasPadAfter = true; prompt->padAfter = v->n; }
            return prompt;
        }

        // A pending choice's option. A version 3 save's `prompt` is discarded: the prompt is built again, in
        // the language in use, when the choice is delivered.
        inline PendingOption toOption(const JV& e)
        {
            PendingOption o;
            o.id = e.str("id"); o.eligible = e.boolean("eligible");
            if (const JV* gd = e.get("gameData")) o.gameData = std::make_shared<GameData>(toValueMap(gd));
            return o;
        }

        // Registry values: an object of objects, each a registry key's name -> value section.
        inline ScopeRegistry::SaveBlob toRegistry(const JV* o)
        {
            ScopeRegistry::SaveBlob blob;
            if (!o || o->t != JV::T::Obj) return blob;
            for (const auto& kv : o->obj)
            {
                OrderedMap<std::string, PatterValue> section;
                if (kv.second.t == JV::T::Obj) for (const auto& p : kv.second.obj) section.set(p.first, toValue(p.second));
                blob.set(kv.first, std::move(section));
            }
            return blob;
        }

        inline FlowSnapshot toFlow(const JV& v)
        {
            FlowSnapshot f;
            // The JS runtime accumulated this state with `| 0` until 0.x, so saves in
            // the wild carry it SIGNED. Casting a negative double straight to
            // uint32_t is undefined behaviour (it gave 0 at -O0 and garbage at -O2),
            // so it goes through the same ToUint32 the seed does.
            f.rngState = Mulberry32::ToUint32(v.num("rngState"));
            f.visits = toIntMap(v.get("visits"));
            // The family nests the execution position under `cursor`.
            const JV* cursor = v.get("cursor");
            if (!cursor || cursor->t != JV::T::Obj) throw std::runtime_error("malformed save: a flow has no cursor");
            const JV& c = *cursor;
            f.flowEnded = c.boolean("flowEnded");
            f.ranDry = c.str("ranDry");                    // absent (any save before it) -> "": it didn't run dry
            f.currentSceneId = c.str("currentSceneId");   // null -> "" (this core's "none")
            if (const JV* stack = c.get("stack"))
                for (const auto& e : stack->arr)
                {
                    StackFrame fr;
                    fr.sceneId = e.str("sceneId"); fr.containerId = e.str("containerId");
                    fr.index = static_cast<int>(e.num("index")); fr.nextId = e.str("nextId"); fr.choiceId = e.str("choiceId");
                    f.stack.push_back(std::move(fr));
                }
            f.activeSnippetId = c.str("activeSnippetId");
            f.beatId = c.str("beatId");                                                    // version 4
            if (const JV* bi = c.get("beatIndex")) if (bi->t == JV::T::Num) f.beatIndex = static_cast<int>(bi->n);   // version 3
            if (const JV* pc = c.get("pendingChoice"))
                if (pc->t == JV::T::Obj)
                {
                    f.hasPendingChoice = true;
                    f.pendingGroupId = pc->str("groupId");
                    if (const JV* opts = pc->get("options")) for (const auto& e : opts->arr) f.pendingOptions.push_back(toOption(e));
                }
            f.pendingPromptOwnerId = c.str("pendingPromptOwnerId");
            if (const JV* pp = c.get("pendingPrompt")) if (pp->t == JV::T::Obj) f.pendingPrompt = toPrompt(*pp);
            f.selectors = toSelectorMap(c.get("selectors"));
            return f;
        }
    }

    namespace savedetail
    {
        // Refuse a version this runtime does not read (exactly 3 or SAVE_VERSION: 3.9 is refused, not
        // read as 3), shown as JS's String() writes it: the same message on every runtime.
        inline void checkVersion(const JV* version, const std::string& refusal)
        {
            if (version && version->t == JV::T::Num && (version->n == 3 || version->n == SAVE_VERSION)) return;
            std::string shown = "undefined";
            if (version)
                switch (version->t)
                {
                    case JV::T::Num: shown = PatterValue::JsNumber(version->n); break;
                    case JV::T::Str: shown = version->s; break;
                    case JV::T::Bool: shown = version->b ? "true" : "false"; break;
                    case JV::T::Null: shown = "null"; break;
                    case JV::T::Arr: shown = ""; break;
                    case JV::T::Obj: shown = "[object Object]"; break;
                }
            throw std::runtime_error(refusal + shown);
        }
    }

    /// Parse + restore a serializeState string: version 4, or a version 3 save written before 1.0, inside
    /// the `patter/save@0` envelope. Throws on malformed JSON, anything that is not that envelope (a bare
    /// snapshot with no envelope included), a save version this runtime does not read (exactly 3 or 4: 3.9
    /// is refused, not read as 3), a save with no `flows` object, or a flow with no `cursor`. Every one of
    /// those is checked before anything changes, so a refused save leaves the engine as it was.
    inline void deserializeState(Engine& engine, const std::string& json)
    {
        using namespace savedetail;
        JV root = JParse(json).parse();
        const JV* saveObj = root.t == JV::T::Obj && root.str("schema") == SAVE_SCHEMA ? root.get("save") : nullptr;
        if (!saveObj || saveObj->t != JV::T::Obj) throw std::runtime_error(std::string("loadState: not a ") + SAVE_SCHEMA + " envelope");

        const JV* version = saveObj->get("version");
        checkVersion(version, "unsupported save version: ");
        const JV* flows = saveObj->get("flows");
        if (!flows || flows->t != JV::T::Obj) throw std::runtime_error("malformed save: no flows");

        SaveGame s;
        s.version = static_cast<int>(version->n);
        if (const JV* reg = saveObj->get("registry")) if (reg->t == JV::T::Obj) s.registry = toRegistry(reg);
        s.sharedVisits = toIntMap(saveObj->get("sharedVisits"));
        s.sharedSelectors = toSelectorMap(saveObj->get("sharedSelectors"));
        for (const auto& kv : flows->obj) s.flows[kv.first] = toFlow(kv.second);
        engine.loadGame(s);
    }

    /// A FlowState (Engine::captureFlow) as JSON, in the save's own spelling: `version`, the flow's
    /// snapshot as a save writes it, and its own values as `scopes` and `sceneBags`.
    inline std::string serializeFlowState(const FlowState& state)
    {
        using namespace savedetail;
        return "{\"version\":" + std::to_string(state.version) + "," + flowFieldsJson(state) + "," + flowValuesJson(state) + "}";
    }

    /// Parse a serializeFlowState string (or one another runtime wrote) for Engine::restoreFlow. Throws on
    /// malformed JSON, anything that is not an object, a version a save reader would refuse, or a state with
    /// no `cursor` object.
    inline FlowState deserializeFlowState(const std::string& json)
    {
        using namespace savedetail;
        JV root = JParse(json).parse();
        if (root.t != JV::T::Obj) throw std::runtime_error("restoreFlow: not a flow state");
        const JV* version = root.get("version");
        checkVersion(version, "unsupported flow state version: ");
        const JV* cursor = root.get("cursor");
        if (!cursor || cursor->t != JV::T::Obj) throw std::runtime_error("malformed flow state: no cursor");
        FlowState state;
        static_cast<FlowSnapshot&>(state) = toFlow(root);
        state.version = static_cast<int>(version->n);
        state.scopes = toScope(root.get("scopes"));
        state.sceneBags = toBagMap(root.get("sceneBags"));
        return state;
    }

    /// The game's registry as JSON (registry key -> name -> value), for a game that passed its own
    /// registry to its engines and saves it once, beside each engine's serializeState. The same object
    /// a standalone engine's save carries under `registry`.
    inline std::string saveRegistry(const ScopeRegistry& registry)
    {
        return savedetail::registryJson(registry.save());
    }

    /// Lay a saveRegistry string over the game's registry. Values for keys nobody has registered yet
    /// wait there and are claimed as the engines re-register (a flow reopening, a scene re-entered),
    /// so this may run before or after each engine's deserializeState. Throws on malformed JSON.
    inline void loadRegistry(ScopeRegistry& registry, const std::string& json)
    {
        using namespace savedetail;
        JV root = JParse(json).parse();
        if (root.t != JV::T::Obj) throw std::runtime_error("loadRegistry: not a registry save");
        registry.load(toRegistry(&root));
    }
}
