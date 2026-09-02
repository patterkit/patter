// GENERATED - vendored from expr/ports/unreal/StateLogger.h by scripts/vendor-ports.mjs.
// Do not edit here; edit the shared source and re-run the script.
// The state logger's product-agnostic core, shared by both product families.
//
// Property logging is PUSH-based on the PropertyBag audit hook: every write, engine or host,
// arrives with its previous value and logs the moment it lands. A diff is kept for what has
// no hook - a product's non-property state (turns, cooldowns, visit counts) arrives through
// the adapter's `extra` provider and is compared on capture(), as do bag values replaced
// wholesale by a load, which fires no events.
//
// A diff alone is strictly weaker, which is why this shape won: it can only report the NET
// change between two captures, so a value that changed and changed back is invisible to it,
// and every write is reported late.
//
// Line format: `${label}${path}: ${from} -> ${to}`, `<unset>` for nullopt.
// Port of @wildwinter/scoperegistry's state logger (expr/packages/scoperegistry/src/state-logger.ts).

#pragma once

#include <cstdio>
#include <functional>
#include <memory>
#include <optional>
#include <set>
#include <string>
#include <utility>
#include <vector>

#include "Patter/Expr/OrderedMap.h"
#include "Patter/Expr/PropertyBag.h"
#include "Patter/PatterValue.h"

namespace patter
{
    /** A flattened snapshot: path -> value. */
    using StateSnapshot = OrderedMap<std::string, PatterValue>;

    /** One flattened state transition. nullopt = unset. */
    struct StateChange
    {
        std::string path;
        std::optional<PatterValue> from;
        std::optional<PatterValue> to;
    };

    /**
     * One bag on the logger's path space.
     *
     * Named for the LOG, not the bag: a product may already have its own type for enumerating
     * bags (the Storylet Engine's BagMount labels a mount "story" for its own purposes), and
     * here the shared file lands in the SAME NAMESPACE as that type.
     *
     * `pathPrefix` is used VERBATIM, separator included, exactly as the bag's own is. Leave it
     * empty and the bag's own pathPrefix is used, which is what a product wants whenever its
     * log paths and its property addresses agree. They do not always: Patterplay addresses a
     * scene property `@scene.mood` relative to a flow's current scene, but has to LOG it as
     * `@scene:kitchen.mood`, because a log spans scenes and has to say which one.
     */
    struct LogMount
    {
        std::shared_ptr<PropertyBag> bag;
        std::optional<std::string> pathPrefix;
    };

    /** What a product supplies: its kernel bags (re-read on every capture, so a product that
     *  replaces its bags on load re-mounts) and its non-property state as flattened paths. */
    struct StateLoggerAdapter
    {
        std::function<std::vector<LogMount>()> mounts;
        std::function<StateSnapshot()> extra;
    };

    struct StateLoggerOptions
    {
        /** Where lines go; defaults to stdout. */
        std::function<void(const std::string&)> sink;
        /** Prefixed to every line, verbatim. */
        std::string label;
    };

    /** The changed paths between two snapshots, sorted; nullopt = unset. */
    inline std::vector<StateChange> diffState(const StateSnapshot& prev, const StateSnapshot& next)
    {
        std::set<std::string> paths;
        for (const auto& pair : prev) paths.insert(pair.first);
        for (const auto& pair : next) paths.insert(pair.first);

        std::vector<StateChange> changes;
        for (const std::string& path : paths)
        {
            const PatterValue* from = prev.get(path);
            const PatterValue* to = next.get(path);
            bool equal = from == nullptr ? to == nullptr : (to != nullptr && from->valueEquals(*to));
            if (equal) continue;
            StateChange c;
            c.path = path;
            if (from) c.from = *from;
            if (to) c.to = *to;
            changes.push_back(std::move(c));
        }
        return changes;
    }

    class StateLogger
    {
    public:
        explicit StateLogger(StateLoggerAdapter adapter, StateLoggerOptions opts = {})
            : adapter_(std::move(adapter))
            , sink_(opts.sink ? std::move(opts.sink)
                : [](const std::string& line) { std::fputs((line + "\n").c_str(), stdout); })
            , label_(std::move(opts.label))
        {
            baseline_ = full();
            mount();
        }

        StateLogger(const StateLogger&) = delete;
        StateLogger& operator=(const StateLogger&) = delete;

        ~StateLogger() { dispose(); }

        /** The full flattened snapshot: every mounted bag's values under its prefix, plus the
         *  adapter's non-property paths. */
        StateSnapshot snapshot() const { return full(); }

        /** Everything since the last capture: the audited writes already logged as they landed,
         *  plus anything that changed WITHOUT an audit event, diffed, logged and re-baselined. */
        std::vector<StateChange> capture()
        {
            StateSnapshot next = full();
            std::vector<StateChange> diffed = diffState(baseline_, next);
            for (const StateChange& c : diffed) emit(c);
            std::vector<StateChange> changes = std::move(pushed_);
            pushed_.clear();
            changes.insert(changes.end(), diffed.begin(), diffed.end());
            baseline_ = std::move(next);
            mount();   // a load replaces a product's bags; re-hook them
            return changes;
        }

        /** Unhook the bag auditors. The logger is inert afterwards. */
        void dispose()
        {
            for (const Mounted& m : mounted_) m.off();
            mounted_.clear();
            pushed_.clear();
        }

    private:
        struct Mounted
        {
            std::shared_ptr<PropertyBag> bag;
            PropertyBag::Unsubscribe off;
        };

        static std::string show(const std::optional<PatterValue>& v)
        {
            return v.has_value() ? v->toJsonString() : "<unset>";
        }

        static std::string prefixOf(const LogMount& m)
        {
            return m.pathPrefix.has_value() ? *m.pathPrefix : m.bag->pathPrefix();
        }

        void emit(const StateChange& c) const
        {
            sink_(label_ + c.path + ": " + show(c.from) + " -> " + show(c.to));
        }

        StateSnapshot full() const
        {
            StateSnapshot out;
            for (const LogMount& m : adapter_.mounts())
            {
                const std::string prefix = prefixOf(m);
                for (const auto& pair : m.bag->values()) out.set(prefix + pair.first, pair.second);
            }
            if (adapter_.extra)
            {
                for (const auto& pair : adapter_.extra()) out.set(pair.first, pair.second);
            }
            return out;
        }

        void hook(const std::string& prefix, const std::shared_ptr<PropertyBag>& bag)
        {
            PropertyBag::Unsubscribe off = bag->onAudit([this, prefix](const BagChange& change)
            {
                // The write logs as it lands, `from` straight off the audit event; the baseline
                // moves with it so capture() never re-reports what was already said.
                StateChange c;
                c.path = prefix + change.name;
                c.from = change.prev;
                c.to = change.next;
                emit(c);
                baseline_.set(c.path, change.next);
                pushed_.push_back(std::move(c));
            });
            mounted_.push_back({bag, std::move(off)});
        }

        void mount()
        {
            std::vector<LogMount> mounts = adapter_.mounts();
            bool same = mounted_.size() == mounts.size();
            if (same)
            {
                for (size_t i = 0; i < mounts.size(); ++i)
                {
                    if (mounted_[i].bag != mounts[i].bag) { same = false; break; }
                }
            }
            if (same) return;
            for (const Mounted& m : mounted_) m.off();
            mounted_.clear();
            for (const LogMount& m : mounts) hook(prefixOf(m), m.bag);
        }

        StateLoggerAdapter adapter_;
        std::function<void(const std::string&)> sink_;
        std::string label_;
        StateSnapshot baseline_;
        std::vector<StateChange> pushed_;
        std::vector<Mounted> mounted_;
    };
}
