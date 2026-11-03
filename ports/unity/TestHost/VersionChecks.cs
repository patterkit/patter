// The corpus's version cases (corpus 14): PatterplayVersion.InRange, held to the JS reference's versionInRange, the
// check an extension makes at start-up against the Patterplay it finds.

using System;
using System.Text.Json;

namespace Patterkit.Patterplay.TestHost
{
    internal static partial class Program
    {
        private static int RunVersions(JsonElement arr)
        {
            int pass = 0;
            foreach (var c in arr.EnumerateArray())
            {
                string name = c.GetProperty("name").GetString();
                try
                {
                    string version = c.GetProperty("version").GetString();
                    string min = c.GetProperty("min").GetString();
                    string maxExclusive = c.GetProperty("maxExclusive").GetString();
                    bool expected = c.GetProperty("expected").GetBoolean();
                    bool got = PatterplayVersion.InRange(version, min, maxExclusive);
                    if (got == expected) pass++;
                    else Fail("versions", name, $"InRange(\"{version}\", \"{min}\", \"{maxExclusive}\"): expected {expected}, got {got}");
                }
                catch (Exception ex) { Fail("versions", name, ex.Message); }
            }
            return pass;
        }
    }
}
