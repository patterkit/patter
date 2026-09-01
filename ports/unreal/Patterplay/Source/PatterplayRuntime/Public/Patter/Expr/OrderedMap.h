// GENERATED - vendored from expr/ports/unreal/OrderedMap.h by scripts/vendor-ports.mjs.
// Do not edit here; edit the shared source and re-run the script.
// An insertion-ordered map: the C++-side stand-in for JavaScript's Map and for
// plain-object key order, both of which the reference runtime leans on (bound
// tag order, @hand composition shadowing, store iteration, save shape).
// Setting an existing key updates the value and KEEPS its original position,
// exactly as a JS Map does; erase + re-add moves the key to the end.
// Deterministic ordering is a rebuild rule (design/engine-runtimes.md section
// 4), so every ordered structure in the port goes through this one type.
// (std::map is SORTED and std::unordered_map is unordered; neither carries JS
// Map semantics, hence this type.)
#pragma once

#include <cstddef>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

#include "Patter/PatterValue.h"

namespace patter
{
    template <typename K, typename V>
    class OrderedMap
    {
    public:
        using Entry = std::pair<K, V>;
        using const_iterator = typename std::vector<Entry>::const_iterator;

        size_t size() const { return entries_.size(); }
        bool empty() const { return entries_.empty(); }

        bool contains(const K& key) const { return index_.find(key) != index_.end(); }

        /** The `map.get(k)` read: nullptr when absent. */
        const V* get(const K& key) const
        {
            auto it = index_.find(key);
            return it == index_.end() ? nullptr : &entries_[it->second].second;
        }

        V* get(const K& key)
        {
            auto it = index_.find(key);
            return it == index_.end() ? nullptr : &entries_[it->second].second;
        }

        /** The read with a fallback (the C# GetOrDefault for value types). */
        V getOr(const K& key, V fallback) const
        {
            const V* v = get(key);
            return v ? *v : fallback;
        }

        /** Get; throws on a missing key. */
        const V& at(const K& key) const
        {
            const V* v = get(key);
            if (!v) throw EvalError("OrderedMap: missing key");
            return *v;
        }

        V& at(const K& key)
        {
            V* v = get(key);
            if (!v) throw EvalError("OrderedMap: missing key");
            return *v;
        }

        /** JS Map semantics: a new key appends, an existing key keeps its position. */
        void set(const K& key, V value)
        {
            auto it = index_.find(key);
            if (it != index_.end())
            {
                entries_[it->second].second = std::move(value);
                return;
            }
            index_.emplace(key, entries_.size());
            entries_.emplace_back(key, std::move(value));
        }

        bool remove(const K& key)
        {
            auto it = index_.find(key);
            if (it == index_.end()) return false;
            size_t pos = it->second;
            index_.erase(it);
            entries_.erase(entries_.begin() + static_cast<ptrdiff_t>(pos));
            for (auto& kv : index_)
            {
                if (kv.second > pos) --kv.second;
            }
            return true;
        }

        void clear()
        {
            entries_.clear();
            index_.clear();
        }

        /** Keys, in insertion order (a copy). */
        std::vector<K> keys() const
        {
            std::vector<K> out;
            out.reserve(entries_.size());
            for (const auto& e : entries_) out.push_back(e.first);
            return out;
        }

        /** Iteration is insertion-ordered and read-only (mutate through set()). */
        const_iterator begin() const { return entries_.begin(); }
        const_iterator end() const { return entries_.end(); }

    private:
        std::vector<Entry> entries_;
        std::unordered_map<K, size_t> index_;
    };
}
