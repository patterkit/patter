// GENERATED - vendored from expr/ports/unity/StateLogger.cs by scripts/vendor-ports.mjs.
// Do not edit here; edit the shared source and re-run the script.
// The state logger's product-agnostic core, shared by both product families.
//
// Property logging is PUSH-based on the PropertyBag audit hook: every write, engine or host,
// arrives with its previous value and logs the moment it lands. A diff is kept for what has
// no hook - a product's non-property state (turns, cooldowns, visit counts) arrives through
// the adapter's Extra provider and is compared on Capture(), as do bag values replaced
// wholesale by a load, which fires no events.
//
// A diff alone is strictly weaker, which is why this shape won: it can only report the NET
// change between two captures, so a value that changed and changed back is invisible to it,
// and every write is reported late.
//
// Line format: `${label}${path}: ${from} -> ${to}`, `<unset>` for null.
// Port of @wildwinter/scoperegistry's state logger (expr/packages/scoperegistry/src/state-logger.ts).

using System;
using System.Collections.Generic;

namespace Patterkit.Patterplay
{
    /// <summary>One flattened state transition. Null = unset.</summary>
    public sealed class StateChange
    {
        public string Path;
        public PatterValue From;
        public PatterValue To;
    }

    /// <summary>
    /// One bag on the logger's path space.
    ///
    /// Named for the LOG, not the bag: a product may already have its own type for
    /// enumerating bags (the Storylet Engine's BagMount labels a mount "story" for its own
    /// purposes), and here both land in one namespace.
    ///
    /// <c>PathPrefix</c> is used VERBATIM, separator included, exactly as the bag's own is.
    /// Leave it null and the bag's own PathPrefix is used, which is what a product wants
    /// whenever its log paths and its property addresses agree. They do not always: Patterplay
    /// addresses a scene property <c>@scene.mood</c> relative to a flow's current scene, but
    /// has to LOG it as <c>@scene:kitchen.mood</c>, because a log spans scenes.
    /// </summary>
    public sealed class LogMount
    {
        public PropertyBag Bag;
        public string PathPrefix;
    }

    /// <summary>What a product supplies: its kernel bags (re-read on every capture, so a
    /// product that replaces its bags on load re-mounts) and its non-property state as
    /// flattened paths.</summary>
    public sealed class StateLoggerAdapter
    {
        public Func<List<LogMount>> Mounts;
        public Func<OrderedMap<string, PatterValue>> Extra;
    }

    public sealed class StateLogger : IDisposable
    {
        private sealed class Mounted
        {
            public PropertyBag Bag;
            public Action Off;
        }

        private readonly StateLoggerAdapter _adapter;
        private readonly Action<string> _sink;
        private readonly string _label;
        private OrderedMap<string, PatterValue> _baseline;
        private List<StateChange> _pushed = new List<StateChange>();
        private List<Mounted> _mounted = new List<Mounted>();

        /// <summary>Sink defaults to Console.WriteLine.</summary>
        public StateLogger(StateLoggerAdapter adapter, Action<string> sink = null, string label = null)
        {
            _adapter = adapter;
            _sink = sink ?? (line => Console.WriteLine(line));
            _label = label ?? "";
            _baseline = Full();
            Mount();
        }

        private static string Show(PatterValue v) => v == null ? "<unset>" : v.ToJsonString();

        private static string PrefixOf(LogMount m) => m.PathPrefix ?? m.Bag.PathPrefix;

        private void Emit(StateChange c) => _sink($"{_label}{c.Path}: {Show(c.From)} -> {Show(c.To)}");

        /// <summary>The full flattened snapshot: every mounted bag's values under its prefix,
        /// plus the adapter's non-property paths.</summary>
        public OrderedMap<string, PatterValue> Snapshot() => Full();

        private OrderedMap<string, PatterValue> Full()
        {
            var snapshot = new OrderedMap<string, PatterValue>();
            foreach (var mount in _adapter.Mounts())
            {
                string prefix = PrefixOf(mount);
                foreach (var pair in mount.Bag.Values) snapshot.Set(prefix + pair.Key, pair.Value);
            }
            if (_adapter.Extra != null)
            {
                foreach (var pair in _adapter.Extra()) snapshot.Set(pair.Key, pair.Value);
            }
            return snapshot;
        }

        private void Hook(string prefix, PropertyBag bag)
        {
            var off = bag.OnAudit(change =>
            {
                // The write logs as it lands, From straight off the audit event; the baseline
                // moves with it so Capture() never re-reports what was already said.
                var c = new StateChange { Path = prefix + change.Name, From = change.Prev, To = change.Next };
                Emit(c);
                _pushed.Add(c);
                _baseline.Set(c.Path, change.Next);
            });
            _mounted.Add(new Mounted { Bag = bag, Off = off });
        }

        private void Mount()
        {
            var mounts = _adapter.Mounts();
            var same = _mounted.Count == mounts.Count;
            if (same)
            {
                for (int i = 0; i < mounts.Count; i++)
                {
                    if (!ReferenceEquals(_mounted[i].Bag, mounts[i].Bag)) { same = false; break; }
                }
            }
            if (same) return;
            foreach (var m in _mounted) m.Off();
            _mounted = new List<Mounted>();
            foreach (var mount in mounts) Hook(PrefixOf(mount), mount.Bag);
        }

        /// <summary>Everything since the last capture: the audited writes already logged as they
        /// landed, plus anything that changed WITHOUT an audit event, diffed, logged and
        /// re-baselined.</summary>
        public List<StateChange> Capture()
        {
            var next = Full();
            var diffed = DiffState(_baseline, next);
            foreach (var c in diffed) Emit(c);
            var changes = new List<StateChange>(_pushed);
            changes.AddRange(diffed);
            _pushed = new List<StateChange>();
            _baseline = next;
            Mount();   // a load replaces a product's bags; re-hook them
            return changes;
        }

        /// <summary>Unhook the bag auditors. The logger is inert afterwards.</summary>
        public void Dispose()
        {
            foreach (var m in _mounted) m.Off();
            _mounted = new List<Mounted>();
            _pushed = new List<StateChange>();
        }

        /// <summary>The changed paths between two snapshots, sorted; null = unset.</summary>
        public static List<StateChange> DiffState(
            OrderedMap<string, PatterValue> prev, OrderedMap<string, PatterValue> next)
        {
            var paths = new List<string>();
            var seen = new HashSet<string>();
            foreach (var pair in prev) if (seen.Add(pair.Key)) paths.Add(pair.Key);
            foreach (var pair in next) if (seen.Add(pair.Key)) paths.Add(pair.Key);
            paths.Sort(StringComparer.Ordinal);

            var changes = new List<StateChange>();
            foreach (var path in paths)
            {
                var from = prev.GetOrDefault(path);
                var to = next.GetOrDefault(path);
                bool equal = from == null ? to == null : (to != null && from.ValueEquals(to));
                if (!equal) changes.Add(new StateChange { Path = path, From = from, To = to });
            }
            return changes;
        }
    }
}
