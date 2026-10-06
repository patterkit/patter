// Moving a flow drops everything waiting to be delivered. With ReplayPromptOnChoose, Choose leaves the
// chosen option's prompt waiting to be spoken back by the next Advance. A Reset (Start) between the two used
// to clear only the choice, so the abandoned run's prompt played as the restarted run's first beat. Goto and
// Close already cleared both; all now share one ClearPending, as on the other three runtimes.

using System.Text.Json;

namespace Patterkit.Patterplay.TestHost
{
    internal static partial class Program
    {
        private const string PendingBundleJson = @"{""schema"":""patter/bundle@0"",""locales"":{""default"":""en"",""included"":[""en""]},""scenes"":{""s"":{""id"":""s"",""type"":""scene"",""name"":""S"",""gameId"":""s"",""blocks"":[{""id"":""b"",""type"":""block"",""name"":""B"",""gameId"":""b"",""children"":[{""id"":""sn_open"",""type"":""snippet"",""beats"":[{""id"":""OPEN"",""kind"":""text""}]},{""id"":""g"",""type"":""group"",""selector"":""choice"",""children"":[{""id"":""o"",""type"":""group"",""prompt"":{""id"":""P"",""kind"":""line"",""character"":""PC""},""children"":[{""id"":""sn_ans"",""type"":""snippet"",""beats"":[{""id"":""ANS"",""kind"":""text""}],""jump"":{""to"":""END""}}]}]}]}]}},""strings"":{""en"":{""OPEN"":""opening"",""P"":""Ask"",""ANS"":""answer""}}}";

        private static void RunPendingClearedCheck()
        {
            Bundle bundle;
            using (var doc = JsonDocument.Parse(PendingBundleJson)) bundle = ParseBundle(doc.RootElement);
            Flow ToChosen()
            {
                var flow = new Engine(bundle, new EngineOptions { ReplayPromptOnChoose = true }).OpenFlow("f", "s");
                flow.Advance();
                flow.Advance();
                flow.Choose("o");
                return flow;
            }
            var replayed = ToChosen().Advance();
            Check("pending: a chosen prompt is spoken back by the next Advance", replayed.Id == "P", $"got {replayed.Id}");
            var reset = ToChosen();
            reset.Reset();
            var afterReset = reset.Advance();
            Check("pending: a Reset drops the waiting prompt", afterReset.Id == "OPEN", $"got {afterReset.Id}");
            var moved = ToChosen();
            moved.Goto("s");
            var afterGoto = moved.Advance();
            Check("pending: a Goto drops it too", afterGoto.Id == "OPEN", $"got {afterGoto.Id}");
        }
    }
}
