// GENERATED - vendored from expr/ports/unity/ScopeRegistry.cs by scripts/vendor-ports.mjs.
// Do not edit here; edit the shared source and re-run the script.
// ---------------------------------------------------------------------------
// The scope registry, for Unity / C#. THE SHARED SOURCE.
//
// Authored in expr/ports/unity and VENDORED into each consuming package by
// expr/scripts/vendor-ports.mjs. Do not edit a vendored copy: CI regenerates
// it and fails on `git diff --exit-code`.
//
// Port of @wildwinter/scoperegistry's ScopeRegistry
// (expr/packages/scoperegistry/src/index.ts, 0.7). A game has ONE registry: it
// holds every property from every engine in the game as a set of named scopes,
// each either OWNED (a property bag this registry stores and saves) or FOREIGN
// (values the game keeps and lends through a resolver, never stored here). It
// is held to packages/scoperegistry/corpus.json, which every copy of the
// registry runs.
//
// It needs only the rest of the kernel: ExprValue, RegistryError (Errors.cs),
// PropertyBag, OrderedMap, Expr and Ast. Everything else the registry needs (the
// resolver interface, the spec types, the row type, the options) is declared
// here, so no family carries a copy. Because the kernel is ONE type in a game,
// every engine in the game can be handed the same registry object.
//
// Not ported, on purpose: the deprecated owned-state fragment
// (saveFragment / loadFragment / OwnedStateFragment / SAVE_FRAGMENT_VERSION),
// which no engine called and which the TypeScript package removes at its next
// breaking release, and toSchema, which no native runtime validates with.
// ---------------------------------------------------------------------------

using System;
using System.Collections.Generic;

namespace Wildwinter.Expr
{
    /// <summary>A scope backed by a host resolver rather than a static bag: the
    /// basis for foreign scopes whose values live in the game or another
    /// engine. Get returns null when the scope does not have the
    /// property.</summary>
    public interface IScopeResolver : IScopeSource
    {
        /// <summary>Whether the resolver accepts writes at all (a TypeScript
        /// resolver without `set` is read-only, for everyone).</summary>
        bool CanSet { get; }
        void Set(string name, ExprValue value);
    }

    /// <summary>One scope in a scopeRegistrySpec: a token and (optional)
    /// declarations. Null declarations mean an opaque scope (any name,
    /// unchecked).</summary>
    public sealed class ScopeSpec
    {
        public string Token;
        /// <summary>Scope-level read/write default for its declarations
        /// (default true).</summary>
        public bool? Writable;
        public List<ScopeDeclaration> Declarations;
    }

    /// <summary>The interop format an owner (Storylet Studio, a host game)
    /// exports so another engine can validate references into its scopes.
    /// Carried under the well-known `scopeRegistrySpec` JSON key (inside a
    /// .storyworld, or a standalone file).</summary>
    public sealed class ScopeRegistrySpec
    {
        public int Version;
        public List<ScopeSpec> Scopes;
    }

    /// <summary>Options for an owned scope the registry builds
    /// (<see cref="ScopeRegistry.DefineOwned(string, IEnumerable{ScopeDeclaration}, OwnedScopeOptions)"/>).</summary>
    public sealed class OwnedScopeOptions
    {
        /// <summary>The address prefix its examiner rows carry, separator
        /// included. Null means `&lt;token&gt;.`; the address grammar is the
        /// product's, not the registry's.</summary>
        public string PathPrefix;
        /// <summary>Name normalisation: lower case when null; a case-significant
        /// product passes identity.</summary>
        public Func<string, string> Normalise;
        /// <summary>Who registered it (an engine's name). Named in a clash error
        /// and carried on examiner rows, so one examiner can group a combined
        /// game by engine.</summary>
        public string Owner;
    }

    /// <summary>Options for a foreign scope
    /// (<see cref="ScopeRegistry.DefineForeign(string, IScopeResolver, IEnumerable{ScopeDeclaration}, ForeignScopeOptions)"/>).</summary>
    public sealed class ForeignScopeOptions
    {
        /// <summary>Scope-level read/write default for its declarations (true
        /// when null).</summary>
        public bool? Writable;
        /// <summary>Name normalisation for the names passed to the resolver:
        /// lower case when null; a case-significant product passes
        /// identity.</summary>
        public Func<string, string> Normalise;
        /// <summary>Who registered it. See <see cref="OwnedScopeOptions.Owner"/>.</summary>
        public string Owner;
    }

    /// <summary>A PropertyRow with the scope it belongs to and who registered
    /// that scope (the registry's listProperties row).</summary>
    public sealed class ScopePropertyRow : PropertyRow
    {
        public string Scope;
        /// <summary>The owner label the scope was registered with; null when none
        /// was given.</summary>
        public string Owner;

        internal static ScopePropertyRow From(string scope, string owner, PropertyRow row)
        {
            return new ScopePropertyRow
            {
                Scope = scope,
                Owner = owner,
                Name = row.Name,
                Path = row.Path,
                Type = row.Type,
                Value = row.Value,
                Default = row.Default,
                Values = row.Values,
                Stages = row.Stages,
                Writable = row.Writable,
            };
        }
    }

    public sealed class ScopeRegistry
    {
        /// <summary>The scopeRegistrySpec versions this build understands.</summary>
        public static readonly int[] SUPPORTED_SPEC_VERSIONS = { 1 };

        // -- the spec reader ------------------------------------------------------

        /// <summary>Extract and validate a `scopeRegistrySpec` from a parsed JSON
        /// value as the core's neutral tree (objects as
        /// OrderedMap&lt;string, object&gt; in document order, arrays as
        /// IReadOnlyList&lt;object&gt;, scalars as bool / double / string, JSON
        /// null as null: the same host-built shape the AST path consumes).
        /// Returns null when the key is absent (so callers can probe arbitrary
        /// files); throws on a malformed or unsupported-version spec.</summary>
        public static ScopeRegistrySpec ReadScopeRegistrySpec(object source)
        {
            var root = source as OrderedMap<string, object>;
            if (root == null || !root.ContainsKey("scopeRegistrySpec")) return null;
            var node = root.GetOrDefault("scopeRegistrySpec");
            // A JSON array is an object to the reference reader, so it gets past
            // this check and fails on its missing version instead.
            var raw = node as OrderedMap<string, object>;
            if (raw == null && !(node is IReadOnlyList<object>))
            {
                throw new RegistryError("scopeRegistrySpec must be an object");
            }
            if (raw == null || !(raw.GetOrDefault("version") is double version))
            {
                throw new RegistryError("scopeRegistrySpec.version must be a number");
            }
            bool supported = false;
            foreach (var v in SUPPORTED_SPEC_VERSIONS) supported = supported || version == v;
            if (!supported)
            {
                throw new RegistryError(
                    $"unsupported scopeRegistrySpec version {ExprValue.JsNumber(version)} "
                    + $"(supported: {string.Join(", ", SUPPORTED_SPEC_VERSIONS)})");
            }
            if (!(raw.GetOrDefault("scopes") is IReadOnlyList<object> scopes))
            {
                throw new RegistryError("scopeRegistrySpec.scopes must be an array");
            }
            var spec = new ScopeRegistrySpec { Version = (int)version, Scopes = new List<ScopeSpec>() };
            foreach (var s in scopes)
            {
                var entry = s as OrderedMap<string, object>;
                if (entry == null || !(entry.GetOrDefault("token") is string token))
                {
                    throw new RegistryError("each scopeRegistrySpec scope needs a string token");
                }
                var scope = new ScopeSpec { Token = token };
                if (entry.GetOrDefault("writable") is bool writable) scope.Writable = writable;
                if (entry.GetOrDefault("declarations") is IReadOnlyList<object> decls)
                {
                    scope.Declarations = new List<ScopeDeclaration>();
                    foreach (var d in decls)
                    {
                        if (d is OrderedMap<string, object> decl) scope.Declarations.Add(ReadSpecDeclaration(decl));
                    }
                }
                spec.Scopes.Add(scope);
            }
            return spec;
        }

        /// <summary>One spec declaration, read leniently (the reference reader
        /// validates only version, scopes and token; the rest passes
        /// through).</summary>
        private static ScopeDeclaration ReadSpecDeclaration(OrderedMap<string, object> d)
        {
            var decl = new ScopeDeclaration
            {
                Name = d.GetOrDefault("name") as string ?? "",
                Type = d.GetOrDefault("type") as string ?? "",
            };
            decl.Values = SpecStrings(d.GetOrDefault("values"));
            decl.Stages = SpecStrings(d.GetOrDefault("stages"));
            if (d.ContainsKey("default")) decl.Default = SpecScalar(d.GetOrDefault("default"));
            if (d.GetOrDefault("writable") is bool writable) decl.Writable = writable;
            return decl;
        }

        /// <summary>A spec string list (values, stages); null when absent or not
        /// a list.</summary>
        private static List<string> SpecStrings(object node)
        {
            if (!(node is IReadOnlyList<object> items)) return null;
            var list = new List<string>();
            foreach (var item in items)
            {
                if (item is string s) list.Add(s);
            }
            return list;
        }

        /// <summary>A spec scalar (bool / number / string / string[]) as a
        /// runtime value; null for JSON null or an unsupported kind.</summary>
        private static ExprValue SpecScalar(object node)
        {
            switch (node)
            {
                case bool b: return ExprValue.Bool(b);
                case double n: return ExprValue.Num(n);
                case string s: return ExprValue.Str(s);
                case IReadOnlyList<object> _: return ExprValue.Flags(SpecStrings(node));
                default: return null;
            }
        }

        // -- the registry ---------------------------------------------------------

        private abstract class Entry
        {
            public string Owner;
        }

        private sealed class OwnedScope : Entry
        {
            public PropertyBag Bag;
        }

        private sealed class ForeignScope : Entry
        {
            public IScopeResolver Resolver;
            public OrderedMap<string, ScopeDeclaration> Decls;
            public bool ScopeWritable;
            public Func<string, string> Norm;
        }

        /// <summary>An owned bag as the evaluator reads it: its live values map,
        /// read by the name the expression carries, exactly as the reference hands
        /// the evaluator `bag.values`. Private, so the registry depends on no
        /// family's own bag adapter.</summary>
        private sealed class OwnedSource : IScopeSource
        {
            private readonly OrderedMap<string, ExprValue> _values;
            public OwnedSource(OrderedMap<string, ExprValue> values) { _values = values; }
            public ExprValue Get(string name) => _values.GetOrDefault(name);
        }

        private static readonly Func<string, string> LowerCase = n => n.ToLowerInvariant();

        private readonly OrderedMap<string, Entry> _scopes = new OrderedMap<string, Entry>();
        /// <summary>Values loaded for keys nobody has registered yet, waiting to be
        /// claimed.</summary>
        private readonly OrderedMap<string, OrderedMap<string, ExprValue>> _parked =
            new OrderedMap<string, OrderedMap<string, ExprValue>>();

        /// <summary>A counter that moves whenever a scope is registered or removed,
        /// and at no other time: it starts at 0 and each registration or removal
        /// adds 1. Values changing does not move it. A caller that caches a
        /// context built by ToEvalContext rebuilds it when this moves, because the
        /// context's set of scopes is fixed when it is built while the values it
        /// reads stay live.</summary>
        public int Revision { get; private set; }

        /// <summary>Register a scope this registry OWNS and stores. Its bag is
        /// seeded from each declaration's default (or a type default), its rows
        /// address themselves as `&lt;token&gt;.name` unless the options say
        /// otherwise, and it is saved by Save and restored by Load.</summary>
        public ScopeRegistry DefineOwned(string token, IEnumerable<ScopeDeclaration> declarations,
                                         OwnedScopeOptions options = null)
        {
            var o = options ?? new OwnedScopeOptions();
            // The scope knows its own token, so its rows can address themselves:
            // `world.hp`. The ADDRESS GRAMMAR is the product's, though, not the
            // registry's, so a caller may say how its addresses look. A bag
            // MOUNTED here keeps whatever prefix its holder gave it.
            var norm = o.Normalise ?? LowerCase;
            var bag = new PropertyBag(declarations, norm, o.PathPrefix ?? token + ".");
            return MountOwned(token, bag, o.Owner);
        }

        /// <summary>The pre-0.7 form: the path prefix alone.</summary>
        public ScopeRegistry DefineOwned(string token, IEnumerable<ScopeDeclaration> declarations, string pathPrefix)
        {
            return DefineOwned(token, declarations, new OwnedScopeOptions { PathPrefix = pathPrefix });
        }

        /// <summary>Attach an EXISTING bag as an owned scope: an engine (or a host)
        /// holds the bag and this registry reads, writes, lists and saves it like
        /// its own.
        ///
        /// If values were loaded for this key before anyone registered it, the bag
        /// claims them now: laid over its seeded defaults by the bag's own Load
        /// rule.</summary>
        public ScopeRegistry MountOwned(string token, PropertyBag bag, string owner = null)
        {
            AssertFree(token, owner);
            _scopes.Set(token, new OwnedScope { Bag = bag, Owner = owner });
            Revision++;
            var waiting = _parked.GetOrDefault(token);
            if (waiting != null)
            {
                bag.Load(waiting);
                _parked.Remove(token);
            }
            return this;
        }

        /// <summary>Unregister a scope. With keep, an owned scope's values are
        /// parked and handed back when the same key is next registered, which is
        /// how a live reload hands an engine's state to its replacement (keep has
        /// no effect on a foreign scope, whose values were never the registry's).
        /// Throws on an unknown key.</summary>
        public ScopeRegistry Remove(string token, bool keep = false)
        {
            var e = _scopes.GetOrDefault(token);
            if (e == null) throw new RegistryError($"unknown scope '@{token}'");
            if (keep && e is OwnedScope owned) _parked.Set(token, owned.Bag.Save());
            _scopes.Remove(token);
            Revision++;
            return this;
        }

        /// <summary>Drop parked values nobody claimed. Parked values are kept in
        /// the next save by default, so nothing loaded is lost to a flow or deck
        /// that simply has not reopened yet; a game that knows they are dead drops
        /// them here.
        ///
        /// With a prefix, only keys starting with it are dropped: an engine
        /// resetting itself drops its own instance keys (`my-engine/`) and leaves
        /// every other engine's alone.</summary>
        public ScopeRegistry DiscardParked(string prefix = null)
        {
            if (prefix == null)
            {
                _parked.Clear();
                return this;
            }
            var doomed = new List<string>();
            foreach (var key in _parked.Keys)
            {
                if (key.StartsWith(prefix, StringComparison.Ordinal)) doomed.Add(key);
            }
            foreach (var key in doomed) _parked.Remove(key);
            return this;
        }

        /// <summary>An owned scope's bag (subscribe, audit, rows live there).</summary>
        public PropertyBag OwnedBag(string token)
        {
            var e = _scopes.GetOrDefault(token) as OwnedScope;
            if (e == null) throw new RegistryError($"'@{token}' is not an owned scope");
            return e.Bag;
        }

        /// <summary>Re-initialise an existing OWNED scope's bag from new
        /// declarations, clearing its current values. For scope-local state that
        /// resets on a context change without disturbing other scopes. Mutates the
        /// bag in place, so an eval context already built from this registry stays
        /// valid.</summary>
        public ScopeRegistry ReseedOwned(string token, IEnumerable<ScopeDeclaration> declarations)
        {
            OwnedBag(token).Reseed(declarations);
            return this;
        }

        /// <summary>Register a FOREIGN scope backed by a host resolver. The values
        /// live in the game or another engine and are never stored or saved here.
        /// Declarations (optional, for example imported from a scopeRegistrySpec)
        /// are used only for listing and the writable rules; omit them for an
        /// opaque scope.</summary>
        public ScopeRegistry DefineForeign(string token, IScopeResolver resolver,
                                           IEnumerable<ScopeDeclaration> declarations = null,
                                           ForeignScopeOptions options = null)
        {
            var o = options ?? new ForeignScopeOptions();
            AssertFree(token, o.Owner);
            var norm = o.Normalise ?? LowerCase;
            var decls = new OrderedMap<string, ScopeDeclaration>();
            if (declarations != null)
            {
                foreach (var d in declarations) decls.Set(norm(d.Name), d);
            }
            _scopes.Set(token, new ForeignScope
            {
                Resolver = resolver,
                Decls = decls,
                ScopeWritable = o.Writable ?? true,
                Norm = norm,
                Owner = o.Owner,
            });
            Revision++;
            return this;
        }

        /// <summary>The pre-0.7 form: the scope-level writable default alone.</summary>
        public ScopeRegistry DefineForeign(string token, IScopeResolver resolver,
                                           IEnumerable<ScopeDeclaration> declarations, bool scopeWritable)
        {
            return DefineForeign(token, resolver, declarations, new ForeignScopeOptions { Writable = scopeWritable });
        }

        public bool Has(string token) => _scopes.ContainsKey(token);

        /// <summary>Read a property; null if the scope or property is not
        /// present.</summary>
        public ExprValue Get(string scope, string name)
        {
            var e = _scopes.GetOrDefault(scope);
            if (e == null) return null;
            if (e is OwnedScope owned) return owned.Bag.Get(name);
            var foreign = (ForeignScope)e;
            return foreign.Resolver.Get(foreign.Norm(name));
        }

        /// <summary>Write a property (an ENGINE write: the bag's subscribers fire;
        /// use the bag directly for silent host writes). Throws on an unknown
        /// scope.
        ///
        /// Writable == false is the STORY's promise, so a story write is refused
        /// and a HOST write is not: pass host: true from a host's own surface (its
        /// SetProperty, its tooling, a coverage driver) and never from the path an
        /// outcome or effect takes. A foreign scope whose resolver cannot be
        /// written is refused for everyone, host included: that is not a rule to
        /// bypass, it is a game that gave no way to write.</summary>
        public void Set(string scope, string name, ExprValue value, bool host = false)
        {
            var e = _scopes.GetOrDefault(scope);
            if (e == null) throw new RegistryError($"unknown scope '@{scope}'");
            if (e is OwnedScope owned)
            {
                try
                {
                    owned.Bag.Set(name, value, host: host);
                }
                catch (Exception)
                {
                    throw new RegistryError($"'@{scope}.{name}' is read-only");
                }
                return;
            }
            var foreign = (ForeignScope)e;
            var n = foreign.Norm(name);
            if (!foreign.Resolver.CanSet) throw new RegistryError($"'@{scope}.{name}' is read-only");
            if (!host && !ForeignWritable(foreign, n)) throw new RegistryError($"'@{scope}.{name}' is read-only");
            foreign.Resolver.Set(n, value);
        }

        private static bool ForeignWritable(ForeignScope e, string name)
        {
            if (!e.Resolver.CanSet) return false;              // no setter: a read-only scope
            var decl = e.Decls.GetOrDefault(name);
            return decl?.Writable ?? e.ScopeWritable;
        }

        /// <summary>Examiner rows across every scope with a declared surface, in
        /// registration order: an owned scope's rows come from its bag, a
        /// declared foreign scope's are read through its resolver with writability
        /// reflecting the resolver. Opaque foreign scopes are not listed. Each row
        /// carries its scope and its scope's owner (null when none was
        /// given).</summary>
        public List<ScopePropertyRow> ListProperties()
        {
            var rows = new List<ScopePropertyRow>();
            foreach (var pair in _scopes)
            {
                if (pair.Value is OwnedScope owned)
                {
                    foreach (var row in owned.Bag.Rows()) rows.Add(ScopePropertyRow.From(pair.Key, owned.Owner, row));
                }
                else
                {
                    var foreign = (ForeignScope)pair.Value;
                    foreach (var decl in foreign.Decls)
                    {
                        var row = PropertyBag.RowFor(decl.Value, foreign.Resolver.Get(decl.Key),
                            ForeignWritable(foreign, decl.Key), decl.Key, pair.Key + ".");
                        rows.Add(ScopePropertyRow.From(pair.Key, foreign.Owner, row));
                    }
                }
            }
            return rows;
        }

        /// <summary>Build the eval context the evaluator consumes: owned scopes as
        /// their live bags, foreign scopes as their resolvers. `host` carries
        /// dialect callbacks and is passed through untouched.
        ///
        /// `aliases` maps an expression token to a registered key: `scene` to
        /// `my-engine/flow-2/scene/tavern` makes `@scene` read that instance bag,
        /// for this context only, and applies to quality ladders too. The registry
        /// learns nothing about what the token means. An alias to a key that is not
        /// registered throws: a condition evaluated against a scope that is not
        /// there is an engine bug, not a graceful false.</summary>
        public EvalContext ToEvalContext(object host = null, IEnumerable<KeyValuePair<string, string>> aliases = null)
        {
            var view = View(aliases);
            var ctx = new EvalContext { Host = host };
            foreach (var pair in view)
            {
                if (pair.Value is OwnedScope owned) ctx.Scopes[pair.Key] = new OwnedSource(owned.Bag.Values);
                else ctx.Scopes[pair.Key] = ((ForeignScope)pair.Value).Resolver;
            }
            // The quality channel (quality.md): declared here once, so a host that
            // registers a quality gets ordering comparisons and advance() with no
            // further wiring. Only wired when a quality exists, so contexts stay
            // identical for products that declare none.
            var ladders = QualityLadders(view);
            if (ladders.Count > 0)
            {
                ctx.Qualities = (scope, name) =>
                {
                    var e = view.GetOrDefault(scope);
                    if (e == null || !ladders.TryGetValue(scope, out var m)) return null;
                    return m.TryGetValue(NormOf(e)(name), out var stages) ? stages : null;
                };
            }
            return ctx;
        }

        /// <summary>The scopes an expression sees: every registered key under its
        /// own token, then each alias token pointing at its key's entry (an alias
        /// shadows a key of the same name). Keys an engine uses for instance bags
        /// are not valid expression tokens, so they are present but
        /// unreachable.</summary>
        private OrderedMap<string, Entry> View(IEnumerable<KeyValuePair<string, string>> aliases)
        {
            var view = new OrderedMap<string, Entry>();
            foreach (var pair in _scopes) view.Set(pair.Key, pair.Value);
            if (aliases == null) return view;
            foreach (var alias in aliases)
            {
                var e = _scopes.GetOrDefault(alias.Value);
                if (e == null) throw new RegistryError($"alias '@{alias.Key}' names '{alias.Value}', which is not registered");
                view.Set(alias.Key, e);
            }
            return view;
        }

        /// <summary>Every quality declaration's ladder, keyed scope token then name
        /// (the scope's own normalisation).</summary>
        private static Dictionary<string, Dictionary<string, List<string>>> QualityLadders(OrderedMap<string, Entry> view)
        {
            var out_ = new Dictionary<string, Dictionary<string, List<string>>>();
            foreach (var pair in view)
            {
                foreach (var decl in DeclsOf(pair.Value))
                {
                    if (decl.Value.Type != PropertyTypes.Quality || decl.Value.Stages == null) continue;
                    if (!out_.TryGetValue(pair.Key, out var m))
                    {
                        m = new Dictionary<string, List<string>>();
                        out_[pair.Key] = m;
                    }
                    m[decl.Key] = decl.Value.Stages;
                }
            }
            return out_;
        }

        /// <summary>A scope entry's declarations, keyed by its own
        /// normalisation. An owned bag's rows are keyed that way already.</summary>
        private static List<KeyValuePair<string, ScopeDeclaration>> DeclsOf(Entry e)
        {
            var list = new List<KeyValuePair<string, ScopeDeclaration>>();
            if (e is ForeignScope foreign)
            {
                foreach (var pair in foreign.Decls) list.Add(pair);
                return list;
            }
            var bag = ((OwnedScope)e).Bag;
            var decls = bag.Declarations();
            var rows = bag.Rows();
            for (int i = 0; i < rows.Count; i++) list.Add(new KeyValuePair<string, ScopeDeclaration>(rows[i].Name, decls[i]));
            return list;
        }

        /// <summary>A scope entry's name normalisation: a foreign scope's own policy,
        /// or an owned bag's, which the bag applies itself.</summary>
        private static Func<string, string> NormOf(Entry e)
        {
            if (e is ForeignScope foreign) return foreign.Norm;
            return ((OwnedScope)e).Bag.Normalise;
        }

        /// <summary>Serialise OWNED scopes (foreign scopes are the game's, and the
        /// game saves them), as bare bags keyed by token, plus any values still
        /// parked, so a save taken before every engine has re-registered loses
        /// nothing. The registry knows nothing about game saves: a game embeds this
        /// in its own.</summary>
        public OrderedMap<string, OrderedMap<string, ExprValue>> Save()
        {
            var blob = new OrderedMap<string, OrderedMap<string, ExprValue>>();
            foreach (var pair in _scopes)
            {
                if (pair.Value is OwnedScope owned) blob.Set(pair.Key, owned.Bag.Save());
            }
            foreach (var pair in _parked) blob.Set(pair.Key, Copy(pair.Value));
            return blob;
        }

        /// <summary>Restore from a Save blob. An owned scope lays its section over
        /// its current values (the bag's Load rule). A section for a key nobody has
        /// registered yet is PARKED and handed over when that key registers, so a
        /// game can load its registry before its engines have reopened their flows
        /// or decks. A section for a foreign scope is ignored: those values are the
        /// game's.
        ///
        /// A load replaces whatever was parked before it: it is a whole restore,
        /// and residue from an earlier load must not leak into this one. With
        /// keepParked, what earlier loads parked is kept and this blob's unclaimed
        /// sections are added to it (a section for the same key replaces the parked
        /// one): for an engine moving an older save's values into a registry the
        /// game has already loaded.</summary>
        public void Load(OrderedMap<string, OrderedMap<string, ExprValue>> blob, bool keepParked = false)
        {
            if (!keepParked) _parked.Clear();
            foreach (var pair in blob)
            {
                var e = _scopes.GetOrDefault(pair.Key);
                if (e is OwnedScope owned) owned.Bag.Load(pair.Value);
                else if (e == null) _parked.Set(pair.Key, Copy(pair.Value));
            }
        }

        /// <summary>A section's own copy. Values are immutable, so copying the map
        /// is the whole of the reference's structuredClone.</summary>
        private static OrderedMap<string, ExprValue> Copy(OrderedMap<string, ExprValue> values)
        {
            var copy = new OrderedMap<string, ExprValue>();
            foreach (var pair in values) copy.Set(pair.Key, pair.Value);
            return copy;
        }

        /// <summary>A token is taken once. There is no reserved-token list: a clash
        /// surfaces here, the moment a game combines its engines, which is the only
        /// moment anyone knows which engines are present. With owners recorded the
        /// error says whose token it already is.</summary>
        private void AssertFree(string token, string owner)
        {
            var e = _scopes.GetOrDefault(token);
            if (e == null) return;
            var by = e.Owner != null ? $" by {e.Owner}" : "";
            var wants = owner != null ? $" (wanted by {owner})" : "";
            throw new RegistryError($"scope '@{token}' is already registered{by}{wants}");
        }
    }
}
