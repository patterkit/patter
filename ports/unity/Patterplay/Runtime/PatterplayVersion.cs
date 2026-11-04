// The Patterplay version, and the one check against it. A port of @patterkit/runtime's version.ts.
//
// An extension (Patterstage, Pattershot) ships apart from Patterplay and never bundles it, so it checks at start-up
// that the Patterplay it finds is one it was built for. Unity's and npm's packages can declare a version range, but
// Unreal's .uplugin and Godot's plugin.cfg can't, so the check that works on every engine runs in code: Current says
// what this runtime is, and InRange tests it.

using System.Text.RegularExpressions;

namespace Patterkit.Patterplay
{
    public static class PatterplayVersion
    {
        /// <summary>This runtime's version, as in its package manifest. Written by <c>npm run bump:play</c>; never
        /// edit it by hand.</summary>
        public const string Current = "0.44.0";

        // The JS reference's pattern, with [0-9] for \d (.NET's \d takes any Unicode digit) and \z for $ (.NET's $
        // also matches before a final newline).
        private static readonly Regex Semver = new Regex(
            @"^([0-9]+)\.([0-9]+)\.([0-9]+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?\z",
            RegexOptions.CultureInvariant);

        private sealed class Parsed
        {
            public string[] Core;
            public string[] Pre;
        }

        private static Parsed Parse(string v)
        {
            if (v == null) return null;
            var m = Semver.Match(v);
            if (!m.Success) return null;
            return new Parsed
            {
                Core = new[] { m.Groups[1].Value, m.Groups[2].Value, m.Groups[3].Value },
                Pre = m.Groups[4].Success ? m.Groups[4].Value.Split('.') : new string[0],
            };
        }

        // Two digit runs compared as numbers of any length: leading zeros dropped, then the longer is larger, then
        // ordinal comparison, so a run too long for a long never overflows.
        private static int CompareNumeric(string a, string b)
        {
            a = a.TrimStart('0');
            b = b.TrimStart('0');
            if (a.Length != b.Length) return a.Length < b.Length ? -1 : 1;
            int c = string.CompareOrdinal(a, b);
            return c < 0 ? -1 : c > 0 ? 1 : 0;
        }

        private static bool IsNumeric(string s)
        {
            foreach (char ch in s) if (ch < '0' || ch > '9') return false;
            return s.Length > 0;
        }

        // Semantic-version precedence: negative when a comes first, positive when b does, 0 when they're equal.
        private static int Compare(Parsed a, Parsed b)
        {
            for (int i = 0; i < 3; i++)
            {
                int c = CompareNumeric(a.Core[i], b.Core[i]);
                if (c != 0) return c;
            }
            // A prerelease comes before its release.
            if (a.Pre.Length == 0 || b.Pre.Length == 0) return b.Pre.Length - a.Pre.Length;
            for (int i = 0; i < System.Math.Min(a.Pre.Length, b.Pre.Length); i++)
            {
                string x = a.Pre[i], y = b.Pre[i];
                if (x == y) continue;
                bool xn = IsNumeric(x), yn = IsNumeric(y);
                if (xn && yn)
                {
                    int c = CompareNumeric(x, y);
                    if (c != 0) return c;
                    continue; // 07 and 7 are the same number
                }
                if (xn != yn) return xn ? -1 : 1; // a numeric identifier comes before a word
                return string.CompareOrdinal(x, y) < 0 ? -1 : 1;
            }
            return a.Pre.Length - b.Pre.Length;
        }

        /// <summary>Whether <paramref name="version"/> is at least <paramref name="min"/> and below
        /// <paramref name="maxExclusive"/>, by semantic-version precedence (build metadata after <c>+</c> is ignored,
        /// and a prerelease comes before its release). False, never a throw, when any of the three isn't a version.
        /// An extension built for Patterplay 0.41 checks
        /// <c>PatterplayVersion.InRange(PatterplayVersion.Current, "0.41.0", "0.42.0")</c>.</summary>
        public static bool InRange(string version, string min, string maxExclusive)
        {
            Parsed v = Parse(version), lo = Parse(min), hi = Parse(maxExclusive);
            if (v == null || lo == null || hi == null) return false;
            return Compare(v, lo) >= 0 && Compare(v, hi) < 0;
        }
    }
}
