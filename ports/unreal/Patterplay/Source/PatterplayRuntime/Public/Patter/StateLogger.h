// The Patterplay state logger: the ADAPTER half, plus logStep, which is this product's own.
//
// The core - push-based property logging on the PropertyBag audit hook, the diff for what has
// no hook, the re-mount that survives a load - is the shared kernel's, vendored as
// Patter/Expr/StateLogger.h and shared with the Storylet Engine.
//
// This used to diff whole saveGame() snapshots, so it reported the NET change between
// captures: a value that changed and changed back was invisible, and every write was late.
// StateChange and diffState are the kernel's now (`from`/`to` are std::optional, where this
// file had a bool beside each value).
//
// Paths, unchanged:
//   @patter.x            the shared globals
//   @scene:<sceneId>.x   the shared scene props
//   visit:<nodeId>       shared visit counts
//   <flowId>/...         the same three, per flow (its not-shared halves)

#pragma once

#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>
#include "Engine.h"
#include "Expr/StateLogger.h"

namespace patter
{
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
    /** The visit counts, which live in no bag and so have no audit hook: the kernel diffs
     *  these on capture(), which is all this logger used to do for everything. */
    inline StateSnapshot visitState(Engine& engine)
    {
        SaveGame save = engine.saveGame();
        StateSnapshot out;
        for (const auto& kv : save.sharedVisits) out.set("visit:" + kv.first, PatterValue::Num(kv.second));
        for (const auto& fkv : save.flows)
        {
            for (const auto& kv : fkv.second.visits)
                out.set(fkv.first + "/visit:" + kv.first, PatterValue::Num(kv.second));
        }
        return out;
    }

    /** The changed paths between two whole-game snapshots, for callers holding the flat map
     *  snapshotState returns. Delegates to the kernel's diff, so there is one rule, not two. */
    inline std::vector<StateChange> diffState(const std::map<std::string, PatterValue>& prev,
                                              const std::map<std::string, PatterValue>& next)
    {
        return diffState(orderedOf(prev), orderedOf(next));
    }

    /** Patterplay's state logger: the kernel logger plus logStep.
     *
     *  Named PatterStateLog rather than StateLogger because the kernel's class - vendored into
     *  this namespace - is the StateLogger now. */
    class PatterStateLog
    {
    public:
        using Sink = std::function<void(const std::string&)>;

        explicit PatterStateLog(Engine& engine, Sink sink = nullptr, const std::string& label = "")
            : engine_(engine), sink_(std::move(sink)), tag_(label.empty() ? "" : "[" + label + "] ")
        {
            StateLoggerAdapter adapter;
            Engine* enginePtr = &engine;
            // Re-read on every capture: openFlow and loadGame both replace bags, and the kernel
            // re-mounts whatever it is handed.
            adapter.mounts = [enginePtr]()
            {
                std::vector<LogMount> mounts = enginePtr->listBags();
                for (Flow* f : enginePtr->flows())
                {
                    std::vector<LogMount> own = f->listBags();
                    mounts.insert(mounts.end(), own.begin(), own.end());
                }
                return mounts;
            };
            adapter.extra = [enginePtr]() { return visitState(*enginePtr); };

            StateLoggerOptions opts;
            opts.sink = sink_;
            opts.label = tag_;
            kernel_ = std::make_unique<StateLogger>(std::move(adapter), std::move(opts));
        }

        /** The current flattened state (no logging): the whole game, off the save envelope. */
        std::map<std::string, PatterValue> snapshot() { return snapshotState(engine_); }

        /** Everything since the last capture: the property writes already logged as they landed,
         *  plus the visit counts, diffed and re-baselined. */
        std::vector<StateChange> capture() { return kernel_->capture(); }

        /** Unhook the bag auditors. The logger is inert afterwards. */
        void dispose() { kernel_->dispose(); }

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
        std::unique_ptr<StateLogger> kernel_;
    };
}
