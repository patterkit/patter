// GENERATED - vendored from expr/ports/unity/PropertyBag.cs by scripts/vendor-ports.mjs.
// Do not edit here; edit the shared source and re-run the script.
// The state kernel's unit of state: a typed, declared property bag with
// defaults, the firing rule (engine writes notify subscribers; host writes are
// silent but always auditable), examiner rows, one sanctioned clone door, and
// bare-value save/load. Port of @wildwinter/scoperegistry's PropertyBag
// (expr/packages/scoperegistry/src/index.ts).

using System;
using System.Collections.Generic;

namespace Wildwinter.Expr
{
    /// <summary>The property type vocabulary (boolean / number / string / enum /
    /// flags). Kept as strings, exactly as the kernel and the bundle carry it;
    /// an enum value is a string at runtime.</summary>
    public static class PropertyTypes
    {
        public const string Boolean = "boolean";
        public const string Number = "number";
        public const string String = "string";
        public const string Enum = "enum";
        public const string Flags = "flags";
        public const string Quality = "quality";
    }

    /// <summary>A property declaration. `Default` seeds an owned bag (null falls
    /// back to the type default); `Writable` false makes it read-only.</summary>
    public class ScopeDeclaration
    {
        public string Name;
        public string Type;
        public List<string> Values;         // for enum / flags
        /// <summary>A quality's ordered ladder of stage names (quality.md).</summary>
        public List<string> Stages;
        public ExprValue Default;       // owned scopes: seed value
        public bool? Writable;              // default true

        /// <summary>The type default when no explicit default is declared
        /// (the kernel's defaultFor).</summary>
        public ExprValue DefaultOrTypeDefault()
        {
            if (Default != null) return Default;
            switch (Type)
            {
                case PropertyTypes.Boolean: return ExprValue.False;
                case PropertyTypes.Number: return ExprValue.Num(0);
                case PropertyTypes.String: return ExprValue.Str("");
                case PropertyTypes.Enum: return ExprValue.Str(Values != null && Values.Count > 0 ? Values[0] : "");
                case PropertyTypes.Flags: return ExprValue.Flags(null);
                // A quality starts at the first rung of its ladder (quality.md).
                case PropertyTypes.Quality: return ExprValue.Str(Stages != null && Stages.Count > 0 ? Stages[0] : "");
                default: return ExprValue.False;
            }
        }
    }

    /// <summary>One property change. `Silent` marks a host write (the firing rule:
    /// it reaches the audit hook but not subscribers); `Reason` is the host's own
    /// note for its log.</summary>
    public sealed class BagChange
    {
        public string Name;
        public ExprValue Prev;          // null when the property had no value
        public ExprValue Next;
        public bool Silent;
        public string Reason;
    }

    /// <summary>One examiner row: what a property examiner/editor needs to render
    /// and edit a declared property.</summary>
    public class PropertyRow
    {
        public string Name;
        /// <summary>The address this property answers to - what GetProperty/SetProperty
        /// take. Composed by the bag from its PathPrefix and the name, so a row is
        /// self-describing. Both product families forked this row to add exactly this
        /// field, once per runtime.</summary>
        public string Path;
        public string Type;
        public ExprValue Value;
        public ExprValue Default;
        public List<string> Values;
        /// <summary>A quality's ladder, when this row is one, so an examiner can offer
        /// the stages instead of a free-text box.
        ///
        /// This said the JS and Godot rows had carried it "since the qualities work".
        /// They did not: the field was on all four ROW types, and only this runtime's
        /// RowFor ever populated it, so a quality row came out ladderless on three of
        /// four. Fixed 2026-09-02, and the claim corrected with it - a comment asserting
        /// parity is worth exactly as much as the check behind it.</summary>
        public List<string> Stages;
        public bool Writable;
    }

    public sealed class PropertyBag
    {
        /// <summary>The live values map (stable identity across Reseed, so an eval
        /// context built over it stays valid). Read-path for evaluation; writes go
        /// through Set so the firing rule applies.</summary>
        public OrderedMap<string, ExprValue> Values { get; } = new OrderedMap<string, ExprValue>();

        private OrderedMap<string, ScopeDeclaration> _decls = new OrderedMap<string, ScopeDeclaration>();
        // Copy-on-write: subscribing and unsubscribing REPLACE an array, never edit one, so a
        // write iterates the listeners as they stood when it began (the registry corpus's
        // contract) with no copy of its own. Two copies per write until October 2026.
        private Action<BagChange>[] _subscribers = Array.Empty<Action<BagChange>>();
        private Action<BagChange>[] _auditors = Array.Empty<Action<BagChange>>();

        /// <summary>Name normalisation policy: lowercase by default (the registry's
        /// long-standing contract); a product whose names are case-significant
        /// passes identity (storylets does).</summary>
        private readonly Func<string, string> _norm;

        /// <summary>The address prefix this bag's rows carry, SEPARATOR INCLUDED
        /// ("@patter.", "@scene.", "world.", "deck.&lt;id&gt;."). The prefix carries its own
        /// separator rather than the bag assuming a dot, because a prefix is not always a
        /// bare scope token. Empty means a row's path is its name.</summary>
        public string PathPrefix { get; private set; } = "";

        public PropertyBag(IEnumerable<ScopeDeclaration> declarations = null, Func<string, string> normalise = null,
                           string pathPrefix = "")
        {
            _norm = normalise ?? (n => n.ToLowerInvariant());
            PathPrefix = pathPrefix ?? "";
            Seed(declarations);
        }

        private void Seed(IEnumerable<ScopeDeclaration> declarations)
        {
            if (declarations == null) return;
            foreach (var d in declarations)
            {
                var name = _norm(d.Name);
                _decls.Set(name, d);
                // ExprValue is immutable, so seeding shares no mutable default
                // (the kernel structuredClones for the same reason).
                Values.Set(name, d.DefaultOrTypeDefault());
            }
        }

        /// <summary>A name as this bag keys it: its normalisation policy applied. The
        /// registry keys quality ladders the bag's own way with it, so a case-significant
        /// (identity) bag is not folded to lower case one layer up.</summary>
        public string Normalise(string name) => _norm(name);

        public ExprValue Get(string name)
        {
            return Values.GetOrDefault(_norm(name));
        }

        /// <summary>Write a property. Engine writes (the default) notify
        /// subscribers; pass silent: true for a host write, which reaches only the
        /// audit hook, and host: true when the caller IS the host: `writable: false`
        /// is the story's promise, so the game's own surface is never refused by it
        /// (ruled 2026-09-05). The two are separate: one says who hears the write,
        /// the other who may make it. Throws on a read-only property. Returns the
        /// change.</summary>
        public BagChange Set(string name, ExprValue value, bool silent = false, string reason = null, bool host = false)
        {
            var n = _norm(name);
            var decl = _decls.GetOrDefault(n);
            if (!host && decl != null && decl.Writable == false) throw new RegistryError($"'{name}' is read-only");
            var change = new BagChange
            {
                Name = n,
                Prev = Values.GetOrDefault(n),
                Next = value,
                Silent = silent,
                Reason = reason,
            };
            Values.Set(n, value);
            foreach (var audit in _auditors) audit(change);
            if (!change.Silent) foreach (var fn in _subscribers) fn(change);
            return change;
        }

        /// <summary>Notified of engine (non-silent) writes. Returns the unsubscribe.</summary>
        public Action Subscribe(Action<BagChange> fn)
        {
            _subscribers = With(_subscribers, fn);
            return () => _subscribers = Without(_subscribers, fn);
        }

        /// <summary>Notified of EVERY write, silent or not. Returns the unsubscribe.</summary>
        public Action OnAudit(Action<BagChange> fn)
        {
            _auditors = With(_auditors, fn);
            return () => _auditors = Without(_auditors, fn);
        }

        /// <summary>Whether a STORY write to this property is allowed: false only for a
        /// declaration marked Writable = false. A host write is always allowed. The registry
        /// asks before writing, so it never has to read a refusal out of an exception that a
        /// listener might have thrown instead.</summary>
        public bool IsWritable(string name)
        {
            var decl = _decls.GetOrDefault(_norm(name));
            return decl == null || decl.Writable != false;
        }

        private static Action<BagChange>[] With(Action<BagChange>[] list, Action<BagChange> fn)
        {
            var next = new Action<BagChange>[list.Length + 1];
            Array.Copy(list, next, list.Length);
            next[list.Length] = fn;
            return next;
        }

        /// <summary>The list without fn's first occurrence (List.Remove's rule, so a listener
        /// added twice is removed once per unsubscribe).</summary>
        private static Action<BagChange>[] Without(Action<BagChange>[] list, Action<BagChange> fn)
        {
            var at = Array.IndexOf(list, fn);
            if (at < 0) return list;
            var next = new Action<BagChange>[list.Length - 1];
            Array.Copy(list, 0, next, 0, at);
            Array.Copy(list, at + 1, next, at, list.Length - at - 1);
            return next;
        }

        /// <summary>Examiner rows: the declared surface only (stray values are
        /// storage, not surface).</summary>
        public List<PropertyRow> Rows()
        {
            var rows = new List<PropertyRow>();
            foreach (var pair in _decls) rows.Add(RowFor(pair.Value, Get(pair.Key), null, pair.Key, PathPrefix));
            return rows;
        }

        public List<ScopeDeclaration> Declarations()
        {
            var list = new List<ScopeDeclaration>();
            foreach (var pair in _decls) list.Add(pair.Value);
            return list;
        }

        /// <summary>The one sanctioned copy door: values copied, declarations
        /// duplicated, the normalisation policy carried, subscriptions NOT carried.</summary>
        public PropertyBag Clone()
        {
            var c = new PropertyBag(null, _norm, PathPrefix);
            foreach (var pair in _decls) c._decls.Set(pair.Key, pair.Value);
            foreach (var pair in Values) c.Values.Set(pair.Key, pair.Value);
            return c;
        }

        /// <summary>Clear and re-seed from new declarations, in place (the values
        /// map keeps its identity, so contexts built over it stay valid).</summary>
        public void Reseed(IEnumerable<ScopeDeclaration> declarations)
        {
            Values.Clear();
            _decls.Clear();
            Seed(declarations);
        }

        /// <summary>Bare values, ready to embed in a product's save.</summary>
        public OrderedMap<string, ExprValue> Save()
        {
            var copy = new OrderedMap<string, ExprValue>();
            foreach (var pair in Values) copy.Set(pair.Key, pair.Value);
            return copy;
        }

        /// <summary>Lay saved values over the current ones (call after a fresh
        /// seed: orphans land as strays, new declarations keep their defaults; the
        /// product decides whether to prune). Does not fire events.</summary>
        public void Load(OrderedMap<string, ExprValue> values)
        {
            foreach (var pair in values) Values.Set(_norm(pair.Key), pair.Value);
        }

        internal static PropertyRow RowFor(ScopeDeclaration d, ExprValue value, bool? writable, string name = null,
                                           string pathPrefix = "")
        {
            string rowName = name ?? d.Name.ToLowerInvariant();
            return new PropertyRow
            {
                Name = rowName,
                Path = pathPrefix + rowName,
                Type = d.Type,
                Value = value,
                Default = d.DefaultOrTypeDefault(),
                Values = d.Values,
                Stages = d.Stages,
                Writable = writable ?? d.Writable ?? true,
            };
        }
    }
}
