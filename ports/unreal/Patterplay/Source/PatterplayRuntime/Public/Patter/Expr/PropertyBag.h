// GENERATED - vendored from expr/ports/unreal/PropertyBag.h by scripts/vendor-ports.mjs.
// Do not edit here; edit the shared source and re-run the script.
// The state kernel's unit of state: a typed, declared property bag with
// defaults, the firing rule (engine writes notify subscribers; host writes are
// silent but always auditable), examiner rows, one sanctioned clone door, and
// bare-value save/load. Port of @wildwinter/scoperegistry's PropertyBag
// (expr/packages/scoperegistry/src/index.ts).
//
// Part of the shared kernel, vendored from expr/ports/unreal: see Errors.h. A
// refused write is a RegistryError.
#include "Errors.h"   // the kernel id tripwire, WILDWINTER_EXPR_VISIBLE, ExprError, RegistryError
// Compiled once per translation unit, and never beside a different kernel: Errors.h stops
// that build with an #error, and this copy then stays out of the way of the first.
#if !defined(WILDWINTER_EXPR_k1a333a0e_PROPERTYBAG_H) && WILDWINTER_EXPR_KERNEL == 0x1a333a0e
#define WILDWINTER_EXPR_k1a333a0e_PROPERTYBAG_H

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "OrderedMap.h"
#include "Value.h"

namespace wildwinter { namespace expr { inline namespace k1a333a0e
{
    /** The property type vocabulary (boolean / number / string / enum /
     *  flags). Kept as strings, exactly as the kernel and the bundle carry
     *  it; an enum value is a string at runtime. Constants, not state: each
     *  module may hold its own copy, and every comparison is by content. */
    namespace PropertyTypes
    {
        inline const char* const Boolean = "boolean";
        inline const char* const Number = "number";
        inline const char* const String = "string";
        inline const char* const Enum = "enum";
        inline const char* const Flags = "flags";
        inline const char* const Quality = "quality";
        /** A field's text types (the family's field types), plain strings at runtime. */
        inline const char* const Text = "text";
        inline const char* const Multiline = "multiline";
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
        std::optional<ExprValue> defaultValue;         // owned scopes: seed value
        std::optional<bool> writable;                      // default true

        /** The type default when no explicit default is declared (the kernel's
         *  defaultFor). */
        ExprValue defaultOrTypeDefault() const
        {
            if (defaultValue.has_value()) return *defaultValue;
            if (type == PropertyTypes::Boolean) return ExprValue::Bool(false);
            if (type == PropertyTypes::Number) return ExprValue::Num(0);
            if (type == PropertyTypes::String || type == PropertyTypes::Text || type == PropertyTypes::Multiline)
            {
                return ExprValue::Str("");
            }
            if (type == PropertyTypes::Enum)
            {
                return ExprValue::Str(values.has_value() && !values->empty() ? (*values)[0] : "");
            }
            if (type == PropertyTypes::Flags) return ExprValue::Flags({});
            // A quality starts at the first rung of its ladder (quality.md).
            if (type == PropertyTypes::Quality)
            {
                return ExprValue::Str(stages.has_value() && !stages->empty() ? (*stages)[0] : "");
            }
            return ExprValue::Bool(false);
        }
    };

    // --- a quality's ladder outside an expression -------------------------------
    //
    // The order the evaluator uses, for a host holding a field value, a game-data
    // value or a property it read (patterkit design/proposals/patter-qualities.md
    // section 3). Each takes a bare ladder or the declaration carrying one, so a
    // host writes CompareStages(fieldDecl, card.fields.get("act"), current). The
    // TypeScript kernel's stageIndex, compareStages and nextStage, word for word.

    /** The position of a stage, or -1 when the value is not one. */
    inline int StageIndex(const std::vector<std::string>& ladder, const ExprValue& value)
    {
        if (!value.isString()) return -1;
        for (size_t i = 0; i < ladder.size(); i++) if (ladder[i] == value.asString()) return (int)i;
        return -1;
    }

    namespace stagesdetail
    {
        inline int PositionOf(const std::vector<std::string>& ladder, const ExprValue& value)
        {
            if (!value.isString())
            {
                const char* word = value.isBool() ? "boolean" : value.isNumber() ? "number" : value.isFlags() ? "flags" : "nothing";
                throw ExprError(std::string("a stage is a name, got ") + word);
            }
            const int i = StageIndex(ladder, value);
            if (i < 0)
            {
                std::string all;
                for (size_t k = 0; k < ladder.size(); k++) all += (k ? ", " : "") + ladder[k];
                throw ExprError("\"" + value.asString() + "\" is not a stage of this quality (stages: " + all + ")");
            }
            return i;
        }

        inline const std::vector<std::string>& LadderOf(const ScopeDeclaration& decl)
        {
            static const std::vector<std::string> none;
            return decl.stages.has_value() ? *decl.stages : none;
        }
    }

    /** -1, 0 or 1 as `a` is below, at or above `b` on the ladder. Throws
     *  ExprError when either is not a stage. */
    inline int CompareStages(const std::vector<std::string>& ladder, const ExprValue& a, const ExprValue& b)
    {
        const int d = stagesdetail::PositionOf(ladder, a) - stagesdetail::PositionOf(ladder, b);
        return d < 0 ? -1 : d > 0 ? 1 : 0;
    }

    /** One rung up, staying on the top rung, as advance() does. Throws
     *  ExprError when the value is not a stage (a drifted save, a deleted stage). */
    inline std::string NextStage(const std::vector<std::string>& ladder, const ExprValue& value)
    {
        const int i = stagesdetail::PositionOf(ladder, value);
        return ladder[std::min(i + 1, (int)ladder.size() - 1)];
    }

    inline int StageIndex(const ScopeDeclaration& decl, const ExprValue& value) { return StageIndex(stagesdetail::LadderOf(decl), value); }
    inline int CompareStages(const ScopeDeclaration& decl, const ExprValue& a, const ExprValue& b) { return CompareStages(stagesdetail::LadderOf(decl), a, b); }
    inline std::string NextStage(const ScopeDeclaration& decl, const ExprValue& value) { return NextStage(stagesdetail::LadderOf(decl), value); }

    /** Does a value fit its declaration? The TypeScript kernel's valueFits, word
     *  for word: the type first, then the declaration's own vocabulary. A
     *  declaration listing none (values or stages absent) constrains nothing past
     *  the type, and a type this build does not know constrains nothing. An enum
     *  may hold "" (none chosen) only when asked. */
    inline bool ValueFits(
        const std::string& type,
        const std::optional<std::vector<std::string>>& values,
        const std::optional<std::vector<std::string>>& stages,
        const ExprValue& value,
        bool noneChosen = false)
    {
        auto listed = [](const std::vector<std::string>& list, const std::string& s)
        {
            return std::find(list.begin(), list.end(), s) != list.end();
        };
        if (type == PropertyTypes::Boolean) return value.isBool();
        if (type == PropertyTypes::Number) return value.isNumber();
        if (type == PropertyTypes::String || type == PropertyTypes::Text || type == PropertyTypes::Multiline)
        {
            return value.isString();
        }
        if (type == PropertyTypes::Enum)
        {
            if (!value.isString()) return false;
            if (value.asString().empty() && noneChosen) return true;
            return !values.has_value() || listed(*values, value.asString());
        }
        if (type == PropertyTypes::Flags)
        {
            if (!value.isFlags()) return false;
            if (!values.has_value()) return true;
            for (const std::string& f : value.asFlags()) if (!listed(*values, f)) return false;
            return true;
        }
        if (type == PropertyTypes::Quality)
        {
            return value.isString() && (!stages.has_value() || listed(*stages, value.asString()));
        }
        return true;
    }

    inline bool ValueFits(const ScopeDeclaration& decl, const ExprValue& value, bool noneChosen = false)
    {
        return ValueFits(decl.type, decl.values, decl.stages, value, noneChosen);
    }

    /** A saved value a refitting load put back to its declaration's default:
     *  the property's name, and what the save held. */
    struct BagMisfit
    {
        std::string name;
        ExprValue value;
    };

    /** One property change. `silent` marks a host write (the firing rule: it
     *  reaches the audit hook but not subscribers); `reason` is the host's own
     *  note for its log. */
    struct BagChange
    {
        std::string name;
        std::optional<ExprValue> prev;     // absent when the property had no value
        ExprValue next;
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
        ExprValue value;
        ExprValue defaultValue;
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
        const OrderedMap<std::string, ExprValue>& values() const { return values_; }

        /** The address prefix this bag composes its rows' paths from, separator included. */
        const std::string& pathPrefix() const { return pathPrefix_; }

        /** A name as this bag keys it: its normalisation policy applied. The registry
         *  keys quality ladders the bag's own way with it, so a case-significant
         *  (identity) bag is not folded to lower case one layer up. */
        std::string normalise(const std::string& name) const { return norm_(name); }

        std::optional<ExprValue> get(const std::string& name) const
        {
            const ExprValue* v = values_.get(norm_(name));
            return v ? std::optional<ExprValue>(*v) : std::nullopt;
        }

        /** Whether a STORY write to this property is allowed: false only for a
         *  declaration marked writable false. A host write is always allowed. The
         *  registry asks before writing, so it never has to read a refusal out of an
         *  exception that a listener might have thrown instead. */
        bool writable(const std::string& name) const
        {
            const ScopeDeclaration* decl = decls_.get(norm_(name));
            return !(decl && decl->writable.has_value() && !*decl->writable);
        }

        /** Write a property. Engine writes (the default) notify subscribers;
         *  pass silent = true for a host write, which reaches only the audit
         *  hook, and host = true when the caller IS the host: `writable: false`
         *  is the story's promise, so the game's own surface is never refused by
         *  it (ruled 2026-09-05). The two are separate: one says who hears the
         *  write, the other who may make it. Throws on a read-only property.
         *  Returns the change. */
        BagChange set(const std::string& name, const ExprValue& value, bool silent = false, const std::string& reason = "", bool host = false)
        {
            std::string n = norm_(name);
            const ScopeDeclaration* decl = decls_.get(n);
            if (!host && decl && decl->writable.has_value() && !*decl->writable)
            {
                throw RegistryError("'" + name + "' is read-only");
            }
            BagChange change;
            change.name = n;
            const ExprValue* prev = values_.get(n);
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
                std::optional<ExprValue> value = get(pair.first);
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
        OrderedMap<std::string, ExprValue> save() const
        {
            OrderedMap<std::string, ExprValue> copy;
            for (const auto& pair : values_) copy.set(pair.first, pair.second);
            return copy;
        }

        /** Lay saved values over the current ones (call after a fresh seed:
         *  orphans land as strays, new declarations keep their defaults; the
         *  product decides whether to prune). Does not fire events.
         *
         *  With `refit`, a saved value that no longer fits its declaration (a
         *  stage, an enum value or a flag the build has since deleted, or a value
         *  of another type) goes back to the declaration's default instead, and
         *  is returned with what the save held, in declaration order. Without it
         *  the list is empty and every value lands as saved. */
        std::vector<BagMisfit> load(const OrderedMap<std::string, ExprValue>& values, bool refit = false)
        {
            OrderedMap<std::string, ExprValue> saved;
            for (const auto& pair : values)
            {
                const std::string n = norm_(pair.first);
                values_.set(n, pair.second);
                saved.set(n, pair.second);
            }
            std::vector<BagMisfit> misfits;
            if (!refit) return misfits;
            for (const auto& pair : decls_)
            {
                const ExprValue* value = saved.get(pair.first);
                if (!value || ValueFits(pair.second, *value)) continue;
                misfits.push_back(BagMisfit{pair.first, *value});
                values_.set(pair.first, pair.second.defaultOrTypeDefault());
            }
            return misfits;
        }

        static PropertyRow RowFor(
            const ScopeDeclaration& d,
            const ExprValue& value,
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
                // ExprValue is a value type, so seeding shares no mutable
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

        OrderedMap<std::string, ExprValue> values_;
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
}}} // namespace wildwinter::expr

#endif
