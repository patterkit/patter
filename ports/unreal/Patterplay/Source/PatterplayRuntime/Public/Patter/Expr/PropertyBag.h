// GENERATED - vendored from expr/ports/unreal/PropertyBag.h by scripts/vendor-ports.mjs.
// Do not edit here; edit the shared source and re-run the script.
// The state kernel's unit of state: a typed, declared property bag with
// defaults, the firing rule (engine writes notify subscribers; host writes are
// silent but always auditable), examiner rows, one sanctioned clone door, and
// bare-value save/load. Port of @wildwinter/scoperegistry's PropertyBag
// (expr/packages/scoperegistry/src/index.ts).
#pragma once

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "Patter/Expr/OrderedMap.h"
#include "Patter/PatterValue.h"

namespace patter
{
    /** The property type vocabulary (boolean / number / string / enum /
     *  flags). Kept as strings, exactly as the kernel and the bundle carry
     *  it; an enum value is a string at runtime. */
    namespace PropertyTypes
    {
        inline const char* const Boolean = "boolean";
        inline const char* const Number = "number";
        inline const char* const String = "string";
        inline const char* const Enum = "enum";
        inline const char* const Flags = "flags";
        inline const char* const Quality = "quality";
    }

    /** A property declaration. `defaultValue` seeds an owned bag (absent falls
     *  back to the type default); `writable` false makes it read-only. */
    struct ScopeDeclaration
    {
        std::string name;
        std::string type;
        std::optional<std::vector<std::string>> values;    // for enum / flags
        /** A quality's ordered ladder of stage names (quality.md). */
        std::optional<std::vector<std::string>> stages;
        std::optional<PatterValue> defaultValue;         // owned scopes: seed value
        std::optional<bool> writable;                      // default true

        /** The type default when no explicit default is declared (the kernel's
         *  defaultFor). */
        PatterValue defaultOrTypeDefault() const
        {
            if (defaultValue.has_value()) return *defaultValue;
            if (type == PropertyTypes::Boolean) return PatterValue::Bool(false);
            if (type == PropertyTypes::Number) return PatterValue::Num(0);
            if (type == PropertyTypes::String) return PatterValue::Str("");
            if (type == PropertyTypes::Enum)
            {
                return PatterValue::Str(values.has_value() && !values->empty() ? (*values)[0] : "");
            }
            if (type == PropertyTypes::Flags) return PatterValue::Flags({});
            // A quality starts at the first rung of its ladder (quality.md).
            if (type == PropertyTypes::Quality)
            {
                return PatterValue::Str(stages.has_value() && !stages->empty() ? (*stages)[0] : "");
            }
            return PatterValue::Bool(false);
        }
    };

    /** One property change. `silent` marks a host write (the firing rule: it
     *  reaches the audit hook but not subscribers); `reason` is the host's own
     *  note for its log. */
    struct BagChange
    {
        std::string name;
        std::optional<PatterValue> prev;     // absent when the property had no value
        PatterValue next;
        bool silent = false;
        std::string reason;
    };

    /** One examiner row: what a property examiner/editor needs to render and
     *  edit a declared property. */
    struct PropertyRow
    {
        std::string name;
        /** The address this property answers to - what getProperty/setProperty take.
         *  Composed by the bag from its pathPrefix and the name, so a row is
         *  self-describing. Both product families forked this row to add exactly this
         *  field, once per runtime. */
        std::string path;
        std::string type;
        PatterValue value;
        PatterValue defaultValue;
        std::optional<std::vector<std::string>> values;
        /** A quality's ladder, when this row is one. Present on the JS and
         *  Godot rows since the qualities work and absent here, so the same
         *  public listProperties() answered differently on two runtimes; added
         *  2026-08-29 so it does not. Nothing in the shipped examiners reads it
         *  yet: it is API surface for a host that wants to show a ladder. */
        std::optional<std::vector<std::string>> stages;
        bool writable = true;
    };

    inline std::string LowercaseName(const std::string& name)
    {
        std::string out = name;
        std::transform(out.begin(), out.end(), out.begin(),
            [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
        return out;
    }

    class PropertyBag
    {
    public:
        using Normalise = std::function<std::string(const std::string&)>;
        using Listener = std::function<void(const BagChange&)>;
        using Unsubscribe = std::function<void()>;

        /** Name normalisation policy: lowercase by default (the registry's
         *  long-standing contract); a product whose names are case-significant
         *  passes identity instead. */
        explicit PropertyBag(const std::vector<ScopeDeclaration>* declarations = nullptr, Normalise normalise = nullptr,
                             std::string pathPrefix = "")
            : pathPrefix_(std::move(pathPrefix)), norm_(normalise ? std::move(normalise) : Normalise(&LowercaseName))
        {
            seed(declarations);
        }

        /** The live values map (stable identity across reseed, so an eval
         *  context built over it stays valid). Read-path for evaluation; writes
         *  go through set() so the firing rule applies. */
        const OrderedMap<std::string, PatterValue>& values() const { return values_; }

        /** The address prefix this bag composes its rows' paths from, separator included. */
        const std::string& pathPrefix() const { return pathPrefix_; }

        std::optional<PatterValue> get(const std::string& name) const
        {
            const PatterValue* v = values_.get(norm_(name));
            return v ? std::optional<PatterValue>(*v) : std::nullopt;
        }

        /** Write a property. Engine writes (the default) notify subscribers;
         *  pass silent = true for a host write, which reaches only the audit
         *  hook. Throws on a read-only property. Returns the change. */
        BagChange set(const std::string& name, const PatterValue& value, bool silent = false, const std::string& reason = "")
        {
            std::string n = norm_(name);
            const ScopeDeclaration* decl = decls_.get(n);
            if (decl && decl->writable.has_value() && !*decl->writable)
            {
                throw EvalError("'" + name + "' is read-only");
            }
            BagChange change;
            change.name = n;
            const PatterValue* prev = values_.get(n);
            if (prev) change.prev = *prev;
            change.next = value;
            change.silent = silent;
            change.reason = reason;
            values_.set(n, value);
            for (const auto& audit : snapshot(auditors_)) audit(change);
            if (!change.silent)
            {
                for (const auto& fn : snapshot(subscribers_)) fn(change);
            }
            return change;
        }

        /** Notified of engine (non-silent) writes. Returns the unsubscribe. */
        Unsubscribe subscribe(Listener fn)
        {
            return add(subscribers_, std::move(fn));
        }

        /** Notified of EVERY write, silent or not. Returns the unsubscribe. */
        Unsubscribe onAudit(Listener fn)
        {
            return add(auditors_, std::move(fn));
        }

        /** Examiner rows: the declared surface only (stray values are storage,
         *  not surface). */
        std::vector<PropertyRow> rows() const
        {
            std::vector<PropertyRow> out;
            for (const auto& pair : decls_)
            {
                std::optional<PatterValue> value = get(pair.first);
                out.push_back(RowFor(pair.second,
                    value.has_value() ? *value : pair.second.defaultOrTypeDefault(),
                    std::nullopt, pair.first, pathPrefix_));
            }
            return out;
        }

        std::vector<ScopeDeclaration> declarations() const
        {
            std::vector<ScopeDeclaration> out;
            for (const auto& pair : decls_) out.push_back(pair.second);
            return out;
        }

        /** The one sanctioned copy door: values copied, declarations
         *  duplicated, the normalisation policy carried, subscriptions NOT
         *  carried. */
        PropertyBag clone() const
        {
            PropertyBag c(nullptr, norm_);
            for (const auto& pair : decls_) c.decls_.set(pair.first, pair.second);
            for (const auto& pair : values_) c.values_.set(pair.first, pair.second);
            return c;
        }

        /** Clear and re-seed from new declarations, in place (the values map
         *  keeps its identity, so contexts built over it stay valid). */
        void reseed(const std::vector<ScopeDeclaration>* declarations)
        {
            values_.clear();
            decls_.clear();
            seed(declarations);
        }

        /** Bare values, ready to embed in a product's save. */
        OrderedMap<std::string, PatterValue> save() const
        {
            OrderedMap<std::string, PatterValue> copy;
            for (const auto& pair : values_) copy.set(pair.first, pair.second);
            return copy;
        }

        /** Lay saved values over the current ones (call after a fresh seed:
         *  orphans land as strays, new declarations keep their defaults; the
         *  product decides whether to prune). Does not fire events. */
        void load(const OrderedMap<std::string, PatterValue>& values)
        {
            for (const auto& pair : values) values_.set(norm_(pair.first), pair.second);
        }

        static PropertyRow RowFor(
            const ScopeDeclaration& d,
            const PatterValue& value,
            std::optional<bool> writable,
            const std::string& name = "",
            const std::string& pathPrefix = "")
        {
            PropertyRow row;
            row.name = name.empty() ? LowercaseName(d.name) : name;
            row.path = pathPrefix + row.name;
            row.type = d.type;
            row.value = value;
            row.defaultValue = d.defaultOrTypeDefault();
            row.values = d.values;
            // The quality ladder, so an examiner can offer the stages instead of a
            // free-text box. Missing here (and in the TS and Godot bags, but not the
            // C# one) until 2026-09-02.
            row.stages = d.stages;
            row.writable = writable.has_value() ? *writable : d.writable.value_or(true);
            return row;
        }

    private:
        using Entry = std::pair<uint64_t, Listener>;

        void seed(const std::vector<ScopeDeclaration>* declarations)
        {
            if (!declarations) return;
            for (const auto& d : *declarations)
            {
                std::string name = norm_(d.name);
                decls_.set(name, d);
                // PatterValue is a value type, so seeding shares no mutable
                // default (the kernel structuredClones for the same reason).
                values_.set(name, d.defaultOrTypeDefault());
            }
        }

        Unsubscribe add(std::vector<Entry>& list, Listener fn)
        {
            uint64_t id = nextListenerId_++;
            list.push_back({id, std::move(fn)});
            std::vector<Entry>* target = &list;
            return [target, id]()
            {
                target->erase(
                    std::remove_if(target->begin(), target->end(),
                        [id](const Entry& e) { return e.first == id; }),
                    target->end());
            };
        }

        static std::vector<Listener> snapshot(const std::vector<Entry>& list)
        {
            std::vector<Listener> out;
            out.reserve(list.size());
            for (const auto& e : list) out.push_back(e.second);
            return out;
        }

        OrderedMap<std::string, PatterValue> values_;
        OrderedMap<std::string, ScopeDeclaration> decls_;
        std::vector<Entry> subscribers_;
        std::vector<Entry> auditors_;
        uint64_t nextListenerId_ = 1;
        /** The address prefix this bag's rows carry, SEPARATOR INCLUDED ("@patter.",
         *  "@scene.", "world.", "deck.<id>."). The prefix carries its own separator rather
         *  than the bag assuming a dot, because a prefix is not always a bare scope token. */
        std::string pathPrefix_;
        Normalise norm_;
    };
}
