// Shuffle: the bag is filled from the children eligible on the first visit, so a later draw can land on
// one whose condition has since gone false. JS, Unreal and Godot play nothing for that draw; Unity used
// to throw InvalidOperationException out of Advance(), crashing the game's dialogue.

using System;
using System.Text.Json;

namespace Patterkit.Patterplay.TestHost
{
    internal static partial class Program
    {
        // A shuffled loop of A, B (only while @met is false) and C, then a snippet that sets @met and loops
        // back. B is in the first bag; once @met is set it is no longer eligible but can still be drawn.
        private const string StaleShuffleBundleJson = @"{""schema"":""patter/bundle@0"",""locales"":{""default"":""en"",""included"":[""en""]},""properties"":[{""name"":""met"",""type"":""boolean"",""default"":false}],""scenes"":{""s"":{""id"":""s"",""type"":""scene"",""name"":""S"",""gameId"":""s"",""blocks"":[{""id"":""b"",""type"":""block"",""name"":""B"",""gameId"":""b"",""children"":[{""id"":""g"",""type"":""group"",""selector"":""sequence"",""options"":{""order"":""shuffle"",""exhaust"":""repeat""},""children"":[{""id"":""a"",""type"":""snippet"",""beats"":[{""id"":""TA"",""kind"":""text""}]},{""id"":""bb"",""type"":""snippet"",""condition"":{""src"":""@met == false"",""ast"":[""bin"",""=="",[""sv"",""patter"",""met""],[""b"",false]]},""beats"":[{""id"":""TB"",""kind"":""text""}]},{""id"":""c"",""type"":""snippet"",""beats"":[{""id"":""TC"",""kind"":""text""}]}]},{""id"":""set"",""type"":""snippet"",""onEnter"":[{""kind"":""set"",""target"":""@met"",""value"":{""src"":""true"",""ast"":[""b"",true]}}],""beats"":[{""id"":""TS"",""kind"":""text""}],""jump"":{""to"":""b""}}]}]}},""strings"":{""en"":{""TA"":""a"",""TB"":""b"",""TC"":""c"",""TS"":""set""}}}";

        private static void RunStaleShuffleCheck()
        {
            Bundle bundle;
            using (var doc = JsonDocument.Parse(StaleShuffleBundleJson)) bundle = ParseBundle(doc.RootElement);
            int bAfterMet = 0;
            for (int seed = 1; seed <= 40; seed++)
            {
                var flow = new Engine(bundle, new EngineOptions { Seed = seed }).OpenFlow("main", "s");
                bool met = false;
                try
                {
                    for (int step = 0; step < 12; step++)
                    {
                        var r = flow.Advance();
                        if (r.Id == "TS") met = true;
                        else if (r.Id == "TB" && met) bAfterMet++;
                    }
                }
                catch (Exception e)
                {
                    Check($"shuffle: a stale bag draw does not throw (seed {seed})", false, e.Message);
                }
            }
            Check("shuffle: a child whose condition has gone false never plays", bAfterMet == 0, $"played {bAfterMet} times");
        }
    }
}
