// The corpus's audio cases: the path PatterAudioResolver gives for each beat of a patteraudio.json
// manifest under a base, held to the reference's createAudioResolver (null when the beat has no take).

using System;
using System.Text.Json;

namespace Patterkit.Patterplay.TestHost
{
    internal static partial class Program
    {
        private static int RunAudio(JsonElement arr)
        {
            int pass = 0;
            foreach (var c in arr.EnumerateArray())
            {
                string name = c.GetProperty("name").GetString();
                try
                {
                    string manifest = c.GetProperty("manifest").GetString();
                    bool ok = true;
                    foreach (var l in c.GetProperty("lookups").EnumerateArray())
                    {
                        string basePath = l.GetProperty("base").GetString();
                        string beatId = l.GetProperty("beatId").GetString();
                        var want = l.GetProperty("expected");
                        string expected = want.ValueKind == JsonValueKind.Null ? null : want.GetString();
                        string got = new PatterAudioResolver(manifest, basePath).Resolve(beatId);
                        if (got == expected) continue;
                        ok = false;
                        Fail("audio", name, $"base \"{basePath}\", beat {beatId}: expected {Show(expected)}, got {Show(got)}");
                    }
                    if (ok) pass++;
                }
                catch (Exception ex) { Fail("audio", name, ex.Message); }
            }
            return pass;

            static string Show(string s) => s == null ? "null" : $"\"{s}\"";
        }
    }
}
