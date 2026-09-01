// GENERATED - vendored from expr/ports/unity/OrderedMap.cs by scripts/vendor-ports.mjs.
// Do not edit here; edit the shared source and re-run the script.
// An insertion-ordered map: the C#-side stand-in for JavaScript's Map and for
// plain-object key order, both of which the reference runtime leans on (bound
// tag order, @hand composition shadowing, store iteration, save shape).
// Setting an existing key updates the value and KEEPS its original position,
// exactly as a JS Map does. Deterministic ordering is a rebuild rule
// (design/engine-runtimes.md section 4), so every ordered structure in the
// port goes through this one type.

using System.Collections;
using System.Collections.Generic;

namespace Patterkit.Patterplay
{
    public sealed class OrderedMap<TKey, TValue> : IEnumerable<KeyValuePair<TKey, TValue>>
    {
        private readonly List<TKey> _order = new List<TKey>();
        private readonly Dictionary<TKey, TValue> _map = new Dictionary<TKey, TValue>();

        public int Count => _order.Count;

        /// <summary>Keys, in insertion order (live view; do not mutate while iterating).</summary>
        public IReadOnlyList<TKey> Keys => _order;

        public bool ContainsKey(TKey key) => _map.ContainsKey(key);

        public bool TryGetValue(TKey key, out TValue value) => _map.TryGetValue(key, out value);

        /// <summary>Get (throws on a missing key) / set (JS Map semantics: a new key
        /// appends, an existing key keeps its position).</summary>
        public TValue this[TKey key]
        {
            get => _map[key];
            set => Set(key, value);
        }

        public void Set(TKey key, TValue value)
        {
            if (!_map.ContainsKey(key)) _order.Add(key);
            _map[key] = value;
        }

        /// <summary>The `map.get(k)` read: default (null for reference types) when absent.</summary>
        public TValue GetOrDefault(TKey key)
        {
            return _map.TryGetValue(key, out var value) ? value : default;
        }

        public bool Remove(TKey key)
        {
            if (!_map.Remove(key)) return false;
            _order.Remove(key);
            return true;
        }

        public void Clear()
        {
            _order.Clear();
            _map.Clear();
        }

        public IEnumerator<KeyValuePair<TKey, TValue>> GetEnumerator()
        {
            foreach (var key in _order) yield return new KeyValuePair<TKey, TValue>(key, _map[key]);
        }

        IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
    }
}
