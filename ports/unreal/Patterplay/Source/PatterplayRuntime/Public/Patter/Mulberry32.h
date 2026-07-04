// mulberry32 - the seeded PRNG behind random() / shuffle. Byte-identical to the JS
// runtime's, part of the parity contract. All arithmetic is unsigned 32-bit (uint32_t),
// matching JavaScript's `| 0` / `>>> 0` / Math.imul.
#pragma once

#include <cstdint>

namespace patter
{
    struct Mulberry32
    {
        uint32_t a;
        explicit Mulberry32(int64_t seed) : a(static_cast<uint32_t>(seed)) {}

        double next()
        {
            a = a + 0x6d2b79f5u;
            uint32_t t = (a ^ (a >> 15)) * (1u | a);
            t = (t + ((t ^ (t >> 7)) * (61u | t))) ^ t;
            return (t ^ (t >> 14)) / 4294967296.0;
        }
    };
}
