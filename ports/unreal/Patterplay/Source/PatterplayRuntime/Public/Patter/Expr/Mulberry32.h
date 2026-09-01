// GENERATED - vendored from expr/ports/unreal/Mulberry32.h by scripts/vendor-ports.mjs.
// Do not edit here; edit the shared source and re-run the script.
// ---------------------------------------------------------------------------
// mulberry32 - the contractual PRNG, for Unreal / std C++. THE SHARED SOURCE.
//
// Authored in expr/ports/unreal and VENDORED into each consuming plugin by
// expr/scripts/vendor-ports.mjs. Do not edit a vendored copy.
//
// A fixed, published algorithm that both product families need and neither
// owns. Port of @wildwinter/expr's prng.ts. All arithmetic is unsigned 32-bit,
// matching JavaScript's `>>> 0` and Math.imul; the state is a plain uint32,
// persisted in the save envelope.
//
// The seed is a DOUBLE and is coerced exactly as JavaScript's `seed >>> 0`
// coerces it (ECMA-262 7.1.6 ToUint32). The JS API's seed is a `number`, so
// anything narrower moves the coercion to the caller and loses the very seeds
// that need it. Casting a double straight to an integer type is undefined
// behaviour once it leaves that type's range, and gave two wrong answers
// (seed 1e19 and Infinity) before the parity corpus pinned them.
// ---------------------------------------------------------------------------
#pragma once

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <utility>
#include <vector>

namespace patter
{
    class Mulberry32
    {
    public:
        /** makePrng(seed): the seed is coerced like JS `seed >>> 0`. */
        explicit Mulberry32(double seed) : s_(ToUint32(seed)) {}

        /** Restore from a persisted state. */
        explicit Mulberry32(uint32_t state) : s_(state) {}

        /** One draw in [0, 1); advances the state. */
        double next()
        {
            s_ += 0x6d2b79f5u;
            uint32_t t = (s_ ^ (s_ >> 15)) * (1u | s_);           // Math.imul(s ^ (s >>> 15), 1 | s)
            t = (t + ((t ^ (t >> 7)) * (61u | t))) ^ t;           // (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
            return (t ^ (t >> 14)) / 4294967296.0;                // ((t ^ (t >>> 14)) >>> 0) / 0x100000000
        }

        /** The persisted state (a uint32; feed back into the constructor to
         *  restore - the TS `state()`). */
        uint32_t state() const { return s_; }
        void setState(uint32_t state) { s_ = state; }

        /** JS ToUint32, for a numeric seed or a persisted state read back as a
         *  double. Non-finite goes to +0, never to uint32 max; a negative wraps
         *  modulo 2^32, never clamps. */
        static uint32_t ToUint32(double seed)
        {
            if (std::isnan(seed) || std::isinf(seed)) return 0;
            double modded = std::fmod(std::trunc(seed), 4294967296.0);
            if (modded < 0) modded += 4294967296.0;
            return static_cast<uint32_t>(modded);
        }

    private:
        uint32_t s_ = 0;
    };

    /** The contractual shuffle: Fisher-Yates, descending. Runs of one element
     *  consume no draws (the loop never executes for size < 2). */
    template <typename T>
    void ShuffleInPlace(std::vector<T>& arr, Mulberry32& prng)
    {
        if (arr.empty()) return;
        for (size_t i = arr.size() - 1; i > 0; --i)
        {
            size_t j = static_cast<size_t>(std::floor(prng.next() * static_cast<double>(i + 1)));
            std::swap(arr[i], arr[j]);
        }
    }
}
