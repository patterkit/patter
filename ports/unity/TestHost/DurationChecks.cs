// The corpus's duration cases: how long a line with no recording lasts (Bundle.EstimateLineDuration), held to
// the JS reference's estimateLineDuration.

using System;
using System.Text.Json;

namespace Patterkit.Patterplay.TestHost
{
    internal static partial class Program
    {
        private static int RunDurations(JsonElement arr)
        {
            int pass = 0;
            foreach (var c in arr.EnumerateArray())
            {
                string name = c.GetProperty("name").GetString();
                try
                {
                    string text = c.GetProperty("text").GetString();
                    double expected = c.GetProperty("expected").GetDouble();
                    double got = c.TryGetProperty("locale", out var loc)
                        ? Bundle.EstimateLineDuration(text, loc.GetString())
                        : Bundle.EstimateLineDuration(text);
                    if (Math.Abs(got - expected) <= 1e-9) pass++;
                    else Fail("durations", name, $"expected {expected}, got {got}");
                }
                catch (Exception ex) { Fail("durations", name, ex.Message); }
            }
            return pass;
        }
    }
}
