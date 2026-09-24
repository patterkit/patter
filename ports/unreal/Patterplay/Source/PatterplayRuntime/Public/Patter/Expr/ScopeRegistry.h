// GENERATED - vendored from expr/ports/unreal/ScopeRegistry.h by scripts/vendor-ports.mjs.
// Do not edit here; edit the shared source and re-run the script.
// ---------------------------------------------------------------------------
// The scope registry / runtime state container, for Unreal / std C++. THE
// SHARED SOURCE.
//
// Authored in expr/ports/unreal and VENDORED into each consuming plugin by
// expr/scripts/vendor-ports.mjs. Do not edit a vendored copy: CI regenerates
// it and fails on drift.
//
// Port of @wildwinter/scoperegistry's ScopeRegistry (0.7.0,
// expr/packages/scoperegistry/src/index.ts), and held to the same contract: the
// registry corpus (expr/packages/scoperegistry/corpus.json), which each
// family's TestHost runs through the shared runner in testing/RegistryCorpus.h.
//
// A game has ONE registry. Each named scope is either OWNED (a property bag
// this registry stores and saves) or FOREIGN (resolved by the game or another
// engine at runtime, never stored here). Values loaded for a key nobody has
// registered yet are PARKED and handed over when that key registers, so a game
// can load before its engines have reopened their flows or decks.
//
// Carries no family identity: it lands in the plugin's own namespace, and
// every name here is declared by this file or by the shared headers it
// includes. The family supplies its value type, EvalError and the error type
// it throws here (see port-sharing.md in expr/docs).
//
// Not ported, on purpose: the deprecated save fragment (saveFragment,
// loadFragment, OwnedStateFragment), whose versioning belongs to the save
// that embeds the values, and toSchema, which no native runtime validates
// against.
// ---------------------------------------------------------------------------
#pragma once

#include <cstddef>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

#include "Patter/PatterValue.h"
#include "Patter/Expr/OrderedMap.h"
#include "Patter/Expr/PropertyBag.h"
#include "Patter/Expr/Expr.h"

namespace patter
{
    /** A scope backed by a host resolver rather than a bag this registry
     *  stores: the basis of a foreign scope, whose values live in the game or
     *  in another engine. get returns nullopt when the scope does not have the
     *  property. */
    class IScopeResolver : public IScopeSource
    {
    public:
        /** Whether the resolver accepts writes at all (a TypeScript resolver
         *  without `set`). A resolver that cannot be written is refused for
         *  every writer, the host included. */
        virtual bool canSet() const = 0;
        virtual void set(const std::string& name, const PatterValue& value) = 0;
    };

    /** One scope in a scopeRegistrySpec: a token and (optional) declarations.
     *  Absent declarations mean an opaque scope (any name, unchecked). */
    struct ScopeSpec
    {
        std::string token;
        /** Scope-level read/write default for its declarations (default true). */
        std::optional<bool> writable;
        std::optional<std::vector<ScopeDeclaration>> declarations;
    };

    /** The interop format an owner (Storylet Studio, a host game) exports so
     *  another engine can validate references into its scopes. Carried under
     *  the well-known `scopeRegistrySpec` JSON key. */
    struct ScopeRegistrySpec
    {
        int version = 0;
        std::vector<ScopeSpec> scopes;
    };

    /** A PropertyRow with the scope it belongs to and, when one was given, the
     *  owner that registered that scope (the registry's listProperties row). */
    struct ScopePropertyRow : PropertyRow
    {
        std::string scope;
        /** Who registered the scope (an engine's name); absent when nobody said. */
        std::optional<std::string> owner;

        static ScopePropertyRow From(const std::string& scopeToken, const PropertyRow& row,
                                     const std::optional<std::string>& ownerLabel = std::nullopt)
        {
            ScopePropertyRow out;
            static_cast<PropertyRow&>(out) = row;
            out.scope = scopeToken;
            out.owner = ownerLabel;
            return out;
        }
    };

    /** Options for an owned scope the registry builds (defineOwned). */
    struct OwnedScopeOptions
    {
        /** The address prefix its examiner rows carry, separator included.
         *  Absent means `<token>.`; the address grammar is the product's. */
        std::optional<std::string> pathPrefix;
        /** Name normalisation: lower case when unset; a case-significant
         *  product passes identity. */
        PropertyBag::Normalise normalise;
        /** Who registered it. Named in a clash error and carried on rows. */
        std::optional<std::string> owner;
    };

    /** Options for a foreign scope (defineForeign). */
    struct ForeignScopeOptions
    {
        /** Scope-level read/write default for its declarations (absent: true). */
        std::optional<bool> writable;
        /** Normalisation of the names passed to the resolver, used for its
         *  declarations and ladders too: lower case when unset. */
        PropertyBag::Normalise normalise;
        /** Who registered it. See OwnedScopeOptions::owner. */
        std::optional<std::string> owner;
    };

    /** How the spec reader reads one JSON node. The default suits any type
     *  shaped like the neutral trees both families ship (a `type` with
     *  isObject/isArray/isString/isNumber/isBool, `find(key)` returning a
     *  pointer, and `arr`, `str`, `num`, `b`); specialise it for anything else,
     *  as Ast.h's AstJson is specialised. A template rather than one JSON type,
     *  because Patterplay's runtime has no JSON type of its own. */
    template <typename J>
    struct RegistrySpecJson
    {
        static bool isObject(const J& v) { return v.isObject(); }
        static bool isArray(const J& v) { return v.isArray(); }
        static bool isString(const J& v) { return v.isString(); }
        static bool isNumber(const J& v) { return v.isNumber(); }
        static bool isBool(const J& v) { return v.isBool(); }
        /** The member `key` of an object, or nullptr (also for a non-object). */
        static const J* find(const J& v, const std::string& key) { return v.find(key); }
        static std::size_t size(const J& v) { return v.arr.size(); }
        static const J& at(const J& v, std::size_t i) { return v.arr[i]; }
        static std::string str(const J& v) { return v.str; }
        static double num(const J& v) { return v.num; }
        static bool boolean(const J& v) { return v.b; }
    };

    namespace detail
    {
        /** An owned bag presented to the evaluator. It holds the bag, so a
         *  context outlives nothing it reads, and it reads the live values by
         *  the name as written, exactly as the TypeScript context reads
         *  `bag.values[name]`. */
        class OwnedBagSource : public IScopeSource
        {
        public:
            explicit OwnedBagSource(std::shared_ptr<PropertyBag> bag) : bag_(std::move(bag)) {}
            std::optional<PatterValue> get(const std::string& name) const override
            {
                const PatterValue* v = bag_->values().get(name);
                return v ? std::optional<PatterValue>(*v) : std::nullopt;
            }
        private:
            std::shared_ptr<PropertyBag> bag_;
        };
    }

    class ScopeRegistry
    {
    public:
        /** Saved values: each owned (or parked) scope's bare values, by key. */
        using SaveBlob = OrderedMap<std::string, OrderedMap<std::string, PatterValue>>;
        /** Expression token to registered key, for one context. */
        using Aliases = OrderedMap<std::string, std::string>;

        /** The scopeRegistrySpec version this build understands. */
        static constexpr int SUPPORTED_SPEC_VERSION = 1;

        /** A counter that moves whenever a scope is registered or removed, and
         *  at no other time: 0 when made, +1 per registration or removal.
         *  Values changing does not move it. A caller caching a context from
         *  toEvalContext() rebuilds it when this moves, because a context's set
         *  of scopes is fixed when it is built while its values stay live. */
        int revision() const { return rev_; }

        // -- owned scopes ---------------------------------------------------

        /** Register a scope this registry OWNS and stores. Its bag is seeded
         *  from each declaration's default (or a type default); rows address
         *  themselves as `<token>.<name>` unless the options say otherwise.
         *  Claims any values parked for the token. */
        ScopeRegistry& defineOwned(const std::string& token, const std::vector<ScopeDeclaration>& declarations,
                                   const OwnedScopeOptions& options = OwnedScopeOptions())
        {
            auto bag = std::make_shared<PropertyBag>(&declarations, options.normalise,
                options.pathPrefix.has_value() ? *options.pathPrefix : token + ".");
            return mountOwned(token, std::move(bag), options.owner);
        }

        /** The path-prefix-only form, as the TypeScript package's pre-0.7 third
         *  argument. */
        ScopeRegistry& defineOwned(const std::string& token, const std::vector<ScopeDeclaration>& declarations,
                                   const std::string& pathPrefix)
        {
            OwnedScopeOptions options;
            options.pathPrefix = pathPrefix;
            return defineOwned(token, declarations, options);
        }

        /** Attach an EXISTING bag as an owned scope: an engine (or a host)
         *  holds the bag, and this registry reads, writes, lists and saves it
         *  like its own. The bag keeps the path prefix its holder gave it.
         *
         *  If values were loaded for this key before anyone registered it, the
         *  bag claims them now, laid over its seeded defaults by the bag's own
         *  load rule. */
        ScopeRegistry& mountOwned(const std::string& token, std::shared_ptr<PropertyBag> bag,
                                  const std::optional<std::string>& owner = std::nullopt)
        {
            assertFree(token, owner);
            Entry e;
            e.kind = Entry::Owned;
            e.bag = bag;
            e.owner = owner;
            scopes_.set(token, std::move(e));
            rev_++;
            if (const auto* waiting = parked_.get(token))
            {
                bag->load(*waiting);
                parked_.remove(token);
            }
            return *this;
        }

        /** Unregister a scope. With keep, an owned scope's values are parked and
         *  handed back when the same key is next registered, which is how a
         *  live reload hands an engine's state to its replacement; keep does
         *  nothing for a foreign scope, whose values were never the registry's.
         *  Throws on an unknown key. */
        ScopeRegistry& remove(const std::string& token, bool keep = false)
        {
            const Entry* e = scopes_.get(token);
            if (!e) throw EvalError("unknown scope '@" + token + "'");
            if (keep && e->kind == Entry::Owned) parked_.set(token, e->bag->save());
            scopes_.remove(token);
            rev_++;
            return *this;
        }

        /** Drop parked values nobody claimed. Parked values are kept in the
         *  next save by default, so nothing loaded is lost to a flow or deck
         *  that has not reopened yet; a game that knows they are dead drops
         *  them here. With a prefix, only keys starting with it are dropped: an
         *  engine resetting itself drops its own instance keys and leaves every
         *  other engine's alone. */
        ScopeRegistry& discardParked(const std::optional<std::string>& prefix = std::nullopt)
        {
            if (!prefix.has_value())
            {
                parked_.clear();
                return *this;
            }
            for (const std::string& key : parked_.keys())
            {
                if (key.compare(0, prefix->size(), *prefix) == 0) parked_.remove(key);
            }
            return *this;
        }

        /** An owned scope's bag (subscribe, audit, rows live there). */
        const std::shared_ptr<PropertyBag>& ownedBag(const std::string& token) const
        {
            const Entry* e = scopes_.get(token);
            if (!e || e->kind != Entry::Owned) throw EvalError("'@" + token + "' is not an owned scope");
            return e->bag;
        }

        /** Re-initialise an existing owned scope's bag from new declarations,
         *  clearing its current values, for scope-local state that resets on a
         *  context change. Mutates the bag in place, so a context already
         *  built from this registry stays valid. */
        ScopeRegistry& reseedOwned(const std::string& token, const std::vector<ScopeDeclaration>& declarations)
        {
            ownedBag(token)->reseed(&declarations);
            return *this;
        }

        // -- foreign scopes -------------------------------------------------

        /** Register a FOREIGN scope backed by a host resolver. The values live
         *  in the game or another engine and are never stored or saved here.
         *  Declarations (optional, e.g. from a scopeRegistrySpec) serve listing
         *  and the writable rule; omit them for an opaque scope. */
        ScopeRegistry& defineForeign(const std::string& token, std::shared_ptr<IScopeResolver> resolver,
                                     const std::vector<ScopeDeclaration>* declarations,
                                     const ForeignScopeOptions& options)
        {
            assertFree(token, options.owner);
            Entry e;
            e.kind = Entry::Foreign;
            e.resolver = std::move(resolver);
            e.scopeWritable = options.writable.value_or(true);
            e.norm = options.normalise ? options.normalise : PropertyBag::Normalise(&LowercaseName);
            e.owner = options.owner;
            if (declarations)
            {
                for (const auto& d : *declarations) e.decls.set(e.norm(d.name), d);
            }
            scopes_.set(token, std::move(e));
            rev_++;
            return *this;
        }

        /** The pre-0.7 form: the scope-level writable default alone. */
        ScopeRegistry& defineForeign(const std::string& token, std::shared_ptr<IScopeResolver> resolver,
                                     const std::vector<ScopeDeclaration>* declarations = nullptr,
                                     bool scopeWritable = true)
        {
            ForeignScopeOptions options;
            options.writable = scopeWritable;
            return defineForeign(token, std::move(resolver), declarations, options);
        }

        // -- reads and writes -----------------------------------------------

        bool has(const std::string& token) const { return scopes_.contains(token); }

        /** Read a property; nullopt if the scope or property is not present. */
        std::optional<PatterValue> get(const std::string& scope, const std::string& name) const
        {
            const Entry* e = scopes_.get(scope);
            if (!e) return std::nullopt;
            if (e->kind == Entry::Owned) return e->bag->get(name);
            return e->resolver->get(e->norm(name));
        }

        /** Write a property (an ENGINE write: the bag's subscribers fire; use
         *  the bag directly for silent host writes). Throws on an unknown scope.
         *
         *  `writable: false` is the STORY's promise, so a story write is refused
         *  and a HOST write is not: pass host = true from a host's own surface
         *  (its setProperty, its tooling, a coverage driver) and never from the
         *  path an outcome or effect takes. A foreign scope whose resolver
         *  cannot be written is refused for everyone, host included: that is not
         *  a rule to bypass, it is a game that gave no way to write. */
        void set(const std::string& scope, const std::string& name, const PatterValue& value, bool host = false)
        {
            Entry* e = scopes_.get(scope);
            if (!e) throw EvalError("unknown scope '@" + scope + "'");
            if (e->kind == Entry::Owned)
            {
                try
                {
                    e->bag->set(name, value, /*silent=*/false, "", host);
                }
                catch (const std::exception&)
                {
                    throw EvalError("'@" + scope + "." + name + "' is read-only");
                }
                return;
            }
            const std::string n = e->norm(name);
            if (!e->resolver->canSet()) throw EvalError("'@" + scope + "." + name + "' is read-only");
            if (!host && !foreignWritable(*e, n)) throw EvalError("'@" + scope + "." + name + "' is read-only");
            e->resolver->set(n, value);
        }

        /** Examiner rows across every scope with a declared surface, in
         *  registration order: an owned scope's bag rows, a declared foreign
         *  scope's declarations (values read through, writability reflecting
         *  the resolver, paths `<token>.<name>`). Opaque foreign scopes are not
         *  listed. A foreign value the resolver does not have reads as the
         *  declaration's default, since a row always carries a value here. */
        std::vector<ScopePropertyRow> listProperties() const
        {
            std::vector<ScopePropertyRow> out;
            for (const auto& pair : scopes_)
            {
                const Entry& e = pair.second;
                if (e.kind == Entry::Owned)
                {
                    for (const auto& row : e.bag->rows()) out.push_back(ScopePropertyRow::From(pair.first, row, e.owner));
                    continue;
                }
                for (const auto& decl : e.decls)
                {
                    std::optional<PatterValue> value = e.resolver->get(decl.first);
                    PropertyRow row = PropertyBag::RowFor(decl.second,
                        value.has_value() ? *value : decl.second.defaultOrTypeDefault(),
                        foreignWritable(e, decl.first), decl.first, pair.first + ".");
                    out.push_back(ScopePropertyRow::From(pair.first, row, e.owner));
                }
            }
            return out;
        }

        // -- evaluation -----------------------------------------------------

        /** Build the context the evaluator consumes: owned scopes as their
         *  bags, foreign scopes as their resolvers. `host` carries dialect
         *  callbacks and is passed through untouched.
         *
         *  `aliases` maps an expression token to a registered key for this
         *  context only (`here` to `e/1/here/inn`), applied to scopes and
         *  quality ladders alike; an alias shadows a key of the same name. The
         *  registry learns nothing about what a token means. An alias to a key
         *  that is not registered throws: a condition evaluated against a scope
         *  that is not there is an engine bug, not a graceful false. */
        EvalContext toEvalContext(const void* host = nullptr, const Aliases& aliases = Aliases()) const
        {
            OrderedMap<std::string, const Entry*> view;
            for (const auto& pair : scopes_) view.set(pair.first, &pair.second);
            for (const auto& alias : aliases)
            {
                const Entry* target = scopes_.get(alias.second);
                if (!target)
                {
                    throw EvalError("alias '@" + alias.first + "' names '" + alias.second + "', which is not registered");
                }
                view.set(alias.first, target);
            }

            EvalContext ctx;
            ctx.host = host;
            for (const auto& pair : view)
            {
                const Entry& e = *pair.second;
                if (e.kind == Entry::Owned) ctx.scopes[pair.first] = std::make_shared<detail::OwnedBagSource>(e.bag);
                else ctx.scopes[pair.first] = e.resolver;
            }

            // The quality channel (quality.md): declared here once, so a host
            // that registers a quality gets ordering comparisons and advance()
            // with no further wiring. Only wired when a quality exists, so
            // contexts stay identical for products that declare none.
            auto ladders = std::make_shared<std::unordered_map<std::string, Ladders>>(qualityLadders(view));
            if (!ladders->empty())
            {
                ctx.qualities = [ladders](const std::string& scopeToken, const std::string& propertyName)
                    -> const std::vector<std::string>*
                {
                    auto found = ladders->find(scopeToken);
                    return found == ladders->end() ? nullptr : found->second.lookup(propertyName);
                };
            }
            return ctx;
        }

        // -- save and load --------------------------------------------------

        /** Serialise OWNED scopes (foreign scopes are the game's, and the game
         *  saves them) as bare bags keyed by token, then any values still
         *  parked, so a save taken before every engine has re-registered loses
         *  nothing. The registry knows nothing about game saves: a game embeds
         *  this in its own. */
        SaveBlob save() const
        {
            SaveBlob out;
            for (const auto& pair : scopes_)
            {
                if (pair.second.kind == Entry::Owned) out.set(pair.first, pair.second.bag->save());
            }
            for (const auto& pair : parked_) out.set(pair.first, pair.second);
            return out;
        }

        /** Restore from a save blob. An owned scope lays its section over its
         *  current values (the bag's load rule). A section for a key nobody
         *  has registered yet is PARKED and handed over when that key
         *  registers. A section for a foreign scope is ignored: those values
         *  are the game's.
         *
         *  A load replaces whatever was parked before it, being a whole
         *  restore; pass keepParked to keep it instead, adding this blob's
         *  unclaimed sections (a section for the same key replaces the parked
         *  one), for an engine moving an older save's values into a registry
         *  the game has already loaded. */
        void load(const SaveBlob& blob, bool keepParked = false)
        {
            if (!keepParked) parked_.clear();
            for (const auto& pair : blob)
            {
                const Entry* e = scopes_.get(pair.first);
                if (e && e->kind == Entry::Owned) e->bag->load(pair.second);
                else if (!e) parked_.set(pair.first, pair.second);
            }
        }

        // -- the scopeRegistrySpec reader -----------------------------------

        /** Extract and validate a scopeRegistrySpec from any JSON node (a
         *  parsed .storyworld bundle, or a plain `{ scopeRegistrySpec: ... }`
         *  manifest), through RegistrySpecJson<J>. Returns nullopt when the key
         *  is absent, so callers can probe arbitrary files; throws on a
         *  malformed or unsupported-version spec. Declarations are read
         *  leniently: the reference validates only version, scopes and token. */
        template <typename J>
        static std::optional<ScopeRegistrySpec> readScopeRegistrySpec(const J& source)
        {
            using A = RegistrySpecJson<J>;
            if (!A::isObject(source)) return std::nullopt;
            const J* raw = A::find(source, "scopeRegistrySpec");
            if (!raw) return std::nullopt;
            // A JSON array is an object to the TypeScript reference, so it falls
            // through to the version check there; it does here too.
            if (!A::isObject(*raw) && !A::isArray(*raw)) throw EvalError("scopeRegistrySpec must be an object");
            const J* version = A::isObject(*raw) ? A::find(*raw, "version") : nullptr;
            if (!version || !A::isNumber(*version)) throw EvalError("scopeRegistrySpec.version must be a number");
            if (A::num(*version) != static_cast<double>(SUPPORTED_SPEC_VERSION))
            {
                throw EvalError("unsupported scopeRegistrySpec version "
                    + PatterValue::JsNumber(A::num(*version))
                    + " (supported: " + std::to_string(SUPPORTED_SPEC_VERSION) + ")");
            }
            const J* scopes = A::find(*raw, "scopes");
            if (!scopes || !A::isArray(*scopes)) throw EvalError("scopeRegistrySpec.scopes must be an array");
            ScopeRegistrySpec spec;
            spec.version = static_cast<int>(A::num(*version));
            for (std::size_t i = 0; i < A::size(*scopes); ++i)
            {
                const J& s = A::at(*scopes, i);
                const J* token = A::isObject(s) ? A::find(s, "token") : nullptr;
                if (!token || !A::isString(*token)) throw EvalError("each scopeRegistrySpec scope needs a string token");
                ScopeSpec scope;
                scope.token = A::str(*token);
                const J* writable = A::find(s, "writable");
                if (writable && A::isBool(*writable)) scope.writable = A::boolean(*writable);
                const J* decls = A::find(s, "declarations");
                if (decls && A::isArray(*decls))
                {
                    scope.declarations.emplace();
                    for (std::size_t j = 0; j < A::size(*decls); ++j)
                    {
                        const J& d = A::at(*decls, j);
                        if (A::isObject(d)) scope.declarations->push_back(ReadSpecDeclaration<J>(d));
                    }
                }
                spec.scopes.push_back(std::move(scope));
            }
            return spec;
        }

        /** One declaration as a spec (or a corpus) carries it: name, type,
         *  values, stages, default and writable, each optional. */
        template <typename J>
        static ScopeDeclaration ReadSpecDeclaration(const J& d)
        {
            using A = RegistrySpecJson<J>;
            ScopeDeclaration decl;
            if (const J* v = A::find(d, "name")) { if (A::isString(*v)) decl.name = A::str(*v); }
            if (const J* v = A::find(d, "type")) { if (A::isString(*v)) decl.type = A::str(*v); }
            if (const J* v = A::find(d, "values")) { if (A::isArray(*v)) decl.values = StringList<J>(*v); }
            if (const J* v = A::find(d, "stages")) { if (A::isArray(*v)) decl.stages = StringList<J>(*v); }
            if (const J* v = A::find(d, "default")) decl.defaultValue = ReadSpecValue<J>(*v);
            if (const J* v = A::find(d, "writable")) { if (A::isBool(*v)) decl.writable = A::boolean(*v); }
            return decl;
        }

        /** A JSON scalar (boolean, number, string, list of strings) as a
         *  runtime value; nullopt for null, an object, or anything else. */
        template <typename J>
        static std::optional<PatterValue> ReadSpecValue(const J& v)
        {
            using A = RegistrySpecJson<J>;
            if (A::isBool(v)) return PatterValue::Bool(A::boolean(v));
            if (A::isNumber(v)) return PatterValue::Num(A::num(v));
            if (A::isString(v)) return PatterValue::Str(A::str(v));
            if (A::isArray(v)) return PatterValue::Flags(StringList<J>(v));
            return std::nullopt;
        }

    private:
        struct Entry
        {
            enum Kind { Owned, Foreign };
            Kind kind = Owned;
            std::shared_ptr<PropertyBag> bag;                     // owned scopes
            std::shared_ptr<IScopeResolver> resolver;             // foreign scopes
            OrderedMap<std::string, ScopeDeclaration> decls;      // foreign: keyed by norm(name)
            bool scopeWritable = true;                            // foreign scopes
            PropertyBag::Normalise norm;                          // foreign scopes
            std::optional<std::string> owner;
        };

        /** One scope's quality ladders, keyed by that scope's own normalised
         *  names, and the normalisation a looked-up name goes through: a foreign
         *  scope's own option, or an owned bag's own policy. */
        struct Ladders
        {
            OrderedMap<std::string, std::vector<std::string>> byName;
            PropertyBag::Normalise norm;

            const std::vector<std::string>* lookup(const std::string& name) const
            {
                return byName.get(norm(name));
            }
        };

        /** Every quality declaration's ladder in the view, keyed by token. */
        static std::unordered_map<std::string, Ladders> qualityLadders(const OrderedMap<std::string, const Entry*>& view)
        {
            std::unordered_map<std::string, Ladders> out;
            for (const auto& pair : view)
            {
                const Entry& e = *pair.second;
                Ladders ladders;
                if (e.kind == Entry::Foreign)
                {
                    for (const auto& decl : e.decls)
                    {
                        if (decl.second.type == PropertyTypes::Quality && decl.second.stages.has_value())
                        {
                            ladders.byName.set(decl.first, *decl.second.stages);
                        }
                    }
                    ladders.norm = e.norm;
                }
                else
                {
                    for (const auto& d : e.bag->declarations())
                    {
                        if (d.type == PropertyTypes::Quality && d.stages.has_value()) ladders.byName.set(e.bag->normalise(d.name), *d.stages);
                    }
                    // Holds the bag, so the context outlives nothing it reads.
                    std::shared_ptr<const PropertyBag> bag = e.bag;
                    ladders.norm = [bag](const std::string& name) { return bag->normalise(name); };
                }
                if (!ladders.byName.empty()) out.emplace(pair.first, std::move(ladders));
            }
            return out;
        }

        template <typename J>
        static std::vector<std::string> StringList(const J& v)
        {
            using A = RegistrySpecJson<J>;
            std::vector<std::string> list;
            for (std::size_t i = 0; i < A::size(v); ++i)
            {
                if (A::isString(A::at(v, i))) list.push_back(A::str(A::at(v, i)));
            }
            return list;
        }

        static bool foreignWritable(const Entry& e, const std::string& name)
        {
            if (!e.resolver->canSet()) return false;              // no setter: a read-only scope
            const ScopeDeclaration* decl = e.decls.get(name);
            if (decl && decl->writable.has_value()) return *decl->writable;
            return e.scopeWritable;
        }

        /** A token is taken once. There is no reserved-token list: a clash
         *  surfaces here, the moment a game combines its engines, which is the
         *  only moment anyone knows which engines are present. With owners
         *  recorded, the error says whose token it already is. */
        void assertFree(const std::string& token, const std::optional<std::string>& owner) const
        {
            const Entry* e = scopes_.get(token);
            if (!e) return;
            const std::string by = e->owner.has_value() ? " by " + *e->owner : "";
            const std::string wants = owner.has_value() ? " (wanted by " + *owner + ")" : "";
            throw EvalError("scope '@" + token + "' is already registered" + by + wants);
        }

        OrderedMap<std::string, Entry> scopes_;
        /** Values loaded for keys nobody has registered yet, waiting to be claimed. */
        SaveBlob parked_;
        int rev_ = 0;
    };
}
