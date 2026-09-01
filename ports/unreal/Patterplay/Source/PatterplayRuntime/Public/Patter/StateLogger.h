// State logger: a debug companion that watches the mutable runtime state - `@patter` globals,
// per-scene `@scene` props, and visit counts (shared + per-flow) - and reports what changed
// between captures. logStep traces each played step, including the gameData payload. Built on
// Engine::saveGame(), so it sees exactly what a save persists.
//
// The port of play-helpers' logger.ts: the flattened path scheme (`@patter.x`, `@scene:scene.x`,
// `visit:nodeId`, `flowId/...`) and the line format (`tag path: from -> to`, `<unset>` for
// missing) are the cross-runtime contract; only the traversal of the native save shape differs.
// std-only (no Unreal types) so the clang TestHost can drive it; the sink is a callback
// defaulting to nothing wired (hosts pass their log idiom, e.g. UE_LOG through a lambda).
#pragma once

#include <algorithm>
#include <cstdio>
#include <functional>
#include <map>
#include <string>
#include <utility>
#include <vector>
#include "Engine.h"

namespace patter
{
    struct StateChange
    {
        std::string path;
        bool hasFrom = false; PatterValue from;
        bool hasTo = false; PatterValue to;
    };

    namespace loggerdetail
    {
        inline std::string jsonQuote(const std::string& s)
        {
            std::string out = "\"";
            for (char c : s)
            {
                switch (c)
                {
                    case '"': out += "\\\""; break;
                    case '\\': out += "\\\\"; break;
                    case '\n': out += "\\n"; break;
                    case '\r': out += "\\r"; break;
                    case '\t': out += "\\t"; break;
                    default:
                        if (static_cast<unsigned char>(c) < 0x20)
                        {
                            char buf[8];
                            std::snprintf(buf, sizeof(buf), "\\u%04x", c);
                            out += buf;
                        }
                        else out += c;
                        break;
                }
            }
            return out + "\"";
        }
    }

    /// JSON.stringify-compatible rendering of one value (the logger line contract).
    inline std::string formatStateValue(const PatterValue& v)
    {
        switch (v.kind)
        {
            case PatterKind::Bool: return v.b ? "true" : "false";
            case PatterKind::Number: return PatterValue::JsNumber(v.n); // String(n) == JSON.stringify(n)
            case PatterKind::Str: return loggerdetail::jsonQuote(v.s);
            case PatterKind::Flags:
            {
                std::string out = "[";
                for (size_t i = 0; i < v.f.size(); ++i) { if (i) out += ","; out += loggerdetail::jsonQuote(v.f[i]); }
                return out + "]";
            }
        }
        return "<unset>";
    }

    /// Flatten the engine's whole-game state into a path -> value map (shared scopes + every live flow).
    inline std::map<std::string, PatterValue> snapshotState(Engine& engine)
    {
        SaveGame save = engine.saveGame();
        std::map<std::string, PatterValue> out;
        for (const auto& kv : save.shared) out["@patter." + kv.first] = kv.second;
        for (const auto& scene : save.stageBags)
            for (const auto& kv : scene.second) out["@scene:" + scene.first + "." + kv.first] = kv.second;
        for (const auto& kv : save.sharedVisits) out["visit:" + kv.first] = PatterValue::Num(kv.second);
        for (const auto& flow : save.flows)
        {
            for (const auto& kv : flow.second.scopes) out[flow.first + "/@patter." + kv.first] = kv.second;
            for (const auto& scene : flow.second.sceneBags)
                for (const auto& kv : scene.second) out[flow.first + "/@scene:" + scene.first + "." + kv.first] = kv.second;
            for (const auto& kv : flow.second.visits) out[flow.first + "/visit:" + kv.first] = PatterValue::Num(kv.second);
        }
        return out;
    }

    /// The sorted set of paths that differ between two snapshots (added / removed / changed).
    /// std::map iterates in key order, so the result is already path-sorted like the JS logger's.
    inline std::vector<StateChange> diffState(const std::map<std::string, PatterValue>& prev,
                                              const std::map<std::string, PatterValue>& next)
    {
        std::vector<StateChange> changes;
        auto p = prev.begin(); auto n = next.begin();
        auto emit = [&changes](const std::string& path, const PatterValue* from, const PatterValue* to)
        {
            const std::string f = from ? formatStateValue(*from) : "<unset>";
            const std::string t = to ? formatStateValue(*to) : "<unset>";
            if (f == t) return;
            StateChange c; c.path = path;
            if (from) { c.hasFrom = true; c.from = *from; }
            if (to) { c.hasTo = true; c.to = *to; }
            changes.push_back(std::move(c));
        };
        while (p != prev.end() || n != next.end())
        {
            if (n == next.end() || (p != prev.end() && p->first < n->first)) { emit(p->first, &p->second, nullptr); ++p; }
            else if (p == prev.end() || n->first < p->first) { emit(n->first, nullptr, &n->second); ++n; }
            else { emit(p->first, &p->second, &n->second); ++p; ++n; }
        }
        return changes;
    }

    /// Create with an engine and a sink; call capture() after each advance/choose to log mutations.
    class StateLogger
    {
    public:
        using Sink = std::function<void(const std::string&)>;

        explicit StateLogger(Engine& engine, Sink sink = nullptr, const std::string& label = "")
            : engine_(engine), sink_(std::move(sink)), tag_(label.empty() ? "" : "[" + label + "] ")
        {
            baseline_ = snapshotState(engine_);
        }

        /// The current flattened state (no logging).
        std::map<std::string, PatterValue> snapshot() { return snapshotState(engine_); }

        /// Diff since the last capture, log each change, and re-baseline. Returns the changes.
        std::vector<StateChange> capture()
        {
            auto next = snapshotState(engine_);
            auto changes = diffState(baseline_, next);
            baseline_ = std::move(next);
            for (const auto& c : changes)
                emit(tag_ + c.path + ": " + (c.hasFrom ? formatStateValue(c.from) : "<unset>")
                     + " -> " + (c.hasTo ? formatStateValue(c.to) : "<unset>"));
            return changes;
        }

        /// Trace one played step (line / text / game-event / choice / end), including any gameData.
        void logStep(const StepResult& step)
        {
            std::string data;
            if (step.gameData && !step.gameData->empty())
            {
                data = " gameData={";
                bool first = true;
                for (const auto& kv : *step.gameData)
                {
                    if (!first) data += ",";
                    first = false;
                    data += loggerdetail::jsonQuote(kv.first) + ":" + formatStateValue(kv.second);
                }
                data += "}";
            }
            switch (step.type)
            {
                case StepType::Line:
                    emit(tag_ + "line " + (step.hasCharacter ? step.character : "?") + ": " + loggerdetail::jsonQuote(step.text) + data);
                    break;
                case StepType::Text:
                    emit(tag_ + "text: " + loggerdetail::jsonQuote(step.text) + data);
                    break;
                case StepType::GameEvent:
                    emit(tag_ + "game event " + step.id + data);
                    break;
                case StepType::Choice:
                    emit(tag_ + "choice (" + std::to_string(step.options.size()) + (step.options.size() == 1 ? " option)" : " options)"));
                    break;
                case StepType::End:
                    emit(tag_ + "end");
                    break;
            }
        }

    private:
        void emit(const std::string& line) { if (sink_) sink_(line); }

        Engine& engine_;
        Sink sink_;
        std::string tag_;
        std::map<std::string, PatterValue> baseline_;
    };
}
