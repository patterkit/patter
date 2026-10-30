// A choice that runs dry and ENDS the flow (Ian's rulings, 2026-10-30): a port of the JS tests in
// packages/runtime/test/sticky-fallback.test.ts ("a choice that runs dry and ends the flow"), plus what a
// checkpoint's rollback must put back. It's reported through OnError once ("dry-choice", the group), and the End
// step's Reason says RanDry; an END straight after still counts; play that carries on past it is silent; the
// reason survives a save and load unreported; the host's Goto("END") is a plain end.

using System;
using System.Collections.Generic;
using System.Linq;

namespace Patterkit.Patterplay.TestHost
{
    internal static partial class Program
    {
        /// <summary>The hub: one once-only option that comes back to it. `after` is JSON for whatever follows the
        /// choice in the hub block (with a leading comma), and `strings` any strings it needs.</summary>
        private static string DryHubBundleJson(string after = "", string strings = "")
            => @"{""schema"":""patter/bundle@0"",""locales"":{""default"":""en"",""included"":[""en""]},""properties"":[],
            ""scenes"":{""s"":{""id"":""s"",""type"":""scene"",""name"":""S"",""blocks"":[{""id"":""hub"",""type"":""block"",""name"":""Hub"",""children"":[
              {""id"":""g"",""type"":""group"",""selector"":""choice"",""children"":[
                {""id"":""ask"",""type"":""group"",""prompt"":{""id"":""C_ask"",""kind"":""text""},""children"":[
                  {""id"":""ask_c"",""type"":""snippet"",""beats"":[{""id"":""T_ask"",""kind"":""text""}],""jump"":{""to"":""hub""}}]}]}" + after + @"]}]}},
            ""strings"":{""en"":{""C_ask"":""ask"",""T_ask"":""played ask""" + strings + @"}}}";

        private static void RunDryChoiceChecks()
        {
            int before = _fails;
            Guarded("dry-choice", DryChoiceChecks);
            if (_fails == before) Console.WriteLine("  [dry-choice] a dry choice that ends the flow is reported once and ends ran-dry, through a save, a rollback, and the host's END");
        }

        private static void DryChoiceChecks()
        {
            // Played ask, back at the hub, the option used: the next Advance finds the choice dry.
            (Bundle bundle, Engine engine, Flow flow, List<PlayError> errors) Play(string after = "", string strings = "")
            {
                var bundle = PatterBundleLoader.Parse(DryHubBundleJson(after, strings));
                var errors = new List<PlayError>();
                var engine = new Engine(bundle, new EngineOptions { OnError = errors.Add });
                var flow = engine.OpenFlow("f", "s");
                flow.Advance(); flow.Choose("ask"); flow.Advance();
                return (bundle, engine, flow, errors);
            }
            bool RanDry(StepResult r) => r.Type == StepType.End && r.Reason == FlowEndReason.RanDry;
            bool Ended(StepResult r) => r.Type == StepType.End && r.Reason == FlowEndReason.Ended;
            string Show(StepResult r) => $"{r.Type}/{r.Reason}";

            {
                var (_, _, flow, errors) = Play();
                var r = flow.Advance();
                Check("dry-choice: ends with reason RanDry", RanDry(r), Show(r));
                Check("dry-choice: reported once, naming the group and flow",
                    errors.Count == 1 && errors[0].Kind == "dry-choice" && errors[0].Node == "g" && errors[0].Flow == "f", ShowErrors(errors));
                Check("dry-choice: the report's message", errors.Count == 1 && errors[0].Message
                    == "choice 'g' ran dry (no option left to take, and no fallback) with nothing after it, so the flow ended there", ShowErrors(errors));
                r = flow.Advance();
                Check("dry-choice: asked again, the same end", RanDry(r), Show(r));
                Check("dry-choice: asked again, not reported again", errors.Count == 1, ShowErrors(errors));
            }
            {
                var (_, _, flow, errors) = Play(@",{""id"":""fin"",""type"":""snippet"",""jump"":{""to"":""END""}}");
                var r = flow.Advance();
                Check("dry-choice: an END straight after still ends ran-dry", RanDry(r), Show(r));
                Check("dry-choice: an END straight after is reported", errors.Select(e => e.Kind).SequenceEqual(new[] { "dry-choice" }), ShowErrors(errors));
            }
            {
                var (_, _, flow, errors) = Play(@",{""id"":""on"",""type"":""snippet"",""beats"":[{""id"":""T_on"",""kind"":""text""}]}", @",""T_on"":""carried on""");
                var r = flow.Advance();
                Check("dry-choice: play carries on past it", r.Type == StepType.Text && r.Text == "carried on", Show(r));
                r = flow.Advance();
                Check("dry-choice: then a plain end", Ended(r), Show(r));
                Check("dry-choice: carried on past is silent", errors.Count == 0, ShowErrors(errors));
            }
            {
                // Through a save and load, both in memory and through PatterSave's JSON: the same end, unreported.
                var (bundle, engine, flow, _) = Play();
                flow.Advance();
                var errors = new List<PlayError>();
                var again = new Engine(bundle, new EngineOptions { OnError = errors.Add });
                again.LoadGame(engine.SaveGame());
                var r = again.GetFlow("f").Advance();
                Check("dry-choice: kept across a save and load", RanDry(r), Show(r));
                string json = PatterSave.SerializeState(engine);
                Check("dry-choice: the save's cursor carries ranDry", json.Contains("\"ranDry\":\"g\""), json);
                var viaJson = new Engine(bundle, new EngineOptions { OnError = errors.Add });
                PatterSave.DeserializeState(viaJson, json);
                r = viaJson.GetFlow("f").Advance();
                Check("dry-choice: kept across a PatterSave JSON round trip", RanDry(r), Show(r));
                Check("dry-choice: a load doesn't report it again", errors.Count == 0, ShowErrors(errors));
                // Written only when set.
                var (_, plain, _, _) = Play();
                Check("dry-choice: no ranDry in a save that didn't run dry", !PatterSave.SerializeState(plain).Contains("ranDry"), PatterSave.SerializeState(plain));
            }
            {
                var (_, _, flow, _) = Play();
                flow.Advance();
                flow.Goto("END");
                var r = flow.Advance();
                Check("dry-choice: the host's Goto(\"END\") is a plain end", Ended(r), Show(r));
                var (_, _, b, errors) = Play();
                b.Advance();
                b.Goto("s"); // an ended flow resumes; the choice is dry again, so it ends the same way, reported again
                r = b.Advance();
                Check("dry-choice: revived by Goto, it ends ran-dry again", RanDry(r), Show(r));
                Check("dry-choice: revived by Goto, reported again", errors.Select(e => e.Kind).SequenceEqual(new[] { "dry-choice", "dry-choice" }), ShowErrors(errors));
                b.Reset("s");
                Check("dry-choice: Reset clears it (back at the choice)", b.Advance().Type == StepType.Choice, "not a choice");
            }
            {
                // A rollback puts back the pending dry choice and the reason with the rest of the cursor.
                var (_, engine, flow, errors) = Play();
                var cp = engine.Checkpoint();
                var r = flow.Advance();
                Check("dry-choice: inside a checkpoint, ends ran-dry", RanDry(r), Show(r));
                engine.Rollback(cp);
                r = flow.Advance();
                Check("dry-choice: after a rollback, ends ran-dry again", RanDry(r), Show(r));
                Check("dry-choice: after a rollback, reported again", errors.Count == 2, ShowErrors(errors));
                cp = engine.Checkpoint();
                flow.Goto("END");
                Check("dry-choice: Goto(\"END\") in a checkpoint is a plain end", Ended(flow.Advance()), "not ended");
                engine.Rollback(cp);
                r = flow.Advance();
                Check("dry-choice: the rollback puts the ran-dry reason back", RanDry(r), Show(r));
                Check("dry-choice: and doesn't report it again", errors.Count == 2, ShowErrors(errors));
            }
        }
    }
}
