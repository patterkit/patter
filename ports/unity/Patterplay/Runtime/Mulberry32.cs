// mulberry32 - the seeded PRNG behind random() / shuffle. Byte-identical to the JS
// runtime's (packages/runtime + conformance), and part of the parity contract: a port
// MUST reproduce it bit-for-bit. All arithmetic is unchecked 32-bit (uint), matching
// JavaScript's `| 0` / `>>> 0` / Math.imul.

namespace Patterkit.Patterplay
{
    public sealed class Mulberry32
    {
        private uint _a;

        public Mulberry32(long seed)
        {
            _a = unchecked((uint)seed); // seed >>> 0
        }

        /// <summary>Next float in [0, 1).</summary>
        public double Next()
        {
            unchecked
            {
                _a = _a + 0x6d2b79f5u;
                uint t = (_a ^ (_a >> 15)) * (1u | _a);          // Math.imul(a ^ (a >>> 15), 1 | a)
                t = (t + ((t ^ (t >> 7)) * (61u | t))) ^ t;       // (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
                return (t ^ (t >> 14)) / 4294967296.0;            // ((t ^ (t >>> 14)) >>> 0) / 2^32
            }
        }

        /// <summary>The current internal state (for save/load - the PRNG position is serialisable).</summary>
        public uint State { get => _a; set => _a = value; }
    }
}
