// The corpus's duration cases: how long a line with no recording lasts (Bundle.EstimateLineDuration), held to
// the JS reference's estimateLineDuration; and its speech cases (corpus 11): the units a line is spoken in
// (Bundle.SpeechUnits) and its syllable count (Bundle.CountSyllables), held to speechUnits and countSyllables.

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
                    string locale = c.TryGetProperty("locale", out var loc) ? loc.GetString() : "";
                    double got = c.TryGetProperty("syllablesPerSecond", out var rate)
                        ? Bundle.EstimateLineDuration(text, locale, rate.GetDouble())
                        : Bundle.EstimateLineDuration(text, locale);
                    if (Math.Abs(got - expected) <= 1e-9) pass++;
                    else Fail("durations", name, $"expected {expected}, got {got}");
                }
                catch (Exception ex) { Fail("durations", name, ex.Message); }
            }
            return pass;
        }

        private static int RunSpeech(JsonElement arr)
        {
            int pass = 0;
            foreach (var c in arr.EnumerateArray())
            {
                string name = c.GetProperty("name").GetString();
                try
                {
                    string text = c.GetProperty("text").GetString();
                    string locale = c.TryGetProperty("locale", out var loc) ? loc.GetString() : "";
                    var units = Bundle.SpeechUnits(text, locale);
                    var want = c.GetProperty("units");
                    string problem = null;
                    if (units.Count != want.GetArrayLength()) problem = $"expected {want.GetArrayLength()} units, got {units.Count}";
                    else
                    {
                        int j = 0;
                        foreach (var w in want.EnumerateArray())
                        {
                            var u = units[j];
                            string kind = u.Kind == SpeechUnitKind.Syllable ? "syllable" : u.Kind == SpeechUnitKind.Closed ? "closed" : "pause";
                            if (kind != w.GetProperty("kind").GetString() || u.Weight != w.GetProperty("weight").GetDouble()
                                || u.Start != w.GetProperty("start").GetInt32() || u.End != w.GetProperty("end").GetInt32())
                            {
                                problem = $"unit {j}: expected {w.GetRawText()}, got {{kind:{kind}, weight:{u.Weight}, start:{u.Start}, end:{u.End}}}";
                                break;
                            }
                            j++;
                        }
                    }
                    double syllables = Bundle.CountSyllables(text, locale);
                    double expected = c.GetProperty("syllables").GetDouble();
                    if (problem == null && Math.Abs(syllables - expected) > 1e-9) problem = $"expected {expected} syllables, got {syllables}";
                    if (problem == null) pass++;
                    else Fail("speech", name, problem);
                }
                catch (Exception ex) { Fail("speech", name, ex.Message); }
            }
            return pass;
        }
    }
}
