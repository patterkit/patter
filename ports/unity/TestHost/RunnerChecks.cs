// The thin runner (PatterRunner): the flow API turned from pull to push. Each delivered beat waits for Next(),
// a choice for Choose(), and the end raises Ended with its reason (RanDry when a choice ran dry); handlers that call Next() themselves don't deepen the stack;
// Stop() drops what was asked for and leaves the flow where it is; a later Begin(scene) moves the same flow,
// keeping the playthrough; Rebind() plays on after a hot swap. Mirrors the JS play-helpers' runner.test.ts,
// on the same fixture (its bundle, exported by the JS compiler).

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;

namespace Patterkit.Patterplay.TestHost
{
    internal static partial class Program
    {
        private const string RunnerBundleJson = @"{""schema"":""patter/bundle@0"",""content"":{""project"":""run"",""hash"":""1mn9ico"",""structureHash"":""1bg0cg5""},""voiced"":false,""locales"":{""default"":""en"",""included"":[""en""]},""cast"":[{""name"":""NPC""}],""scenes"":{""talk"":{""id"":""talk"",""type"":""scene"",""name"":""Talk"",""blocks"":[{""id"":""b1"",""type"":""block"",""name"":""B1"",""children"":[{""id"":""sn1"",""type"":""snippet"",""beats"":[{""id"":""L1"",""kind"":""line"",""character"":""NPC""},{""id"":""T1"",""kind"":""text"",""action"":true},{""id"":""E1"",""kind"":""gameEvent""}]},{""id"":""grp"",""type"":""group"",""selector"":""choice"",""children"":[{""id"":""opt_a"",""type"":""group"",""children"":[{""id"":""sn_a"",""type"":""snippet"",""beats"":[{""id"":""L_a"",""kind"":""line"",""character"":""NPC""}],""jump"":{""to"":""END""}}],""prompt"":{""id"":""C_a"",""kind"":""text""}},{""id"":""opt_b"",""type"":""group"",""children"":[{""id"":""sn_b"",""type"":""snippet"",""beats"":[{""id"":""L_b"",""kind"":""line"",""character"":""NPC""}],""jump"":{""to"":""END""}}],""prompt"":{""id"":""C_b"",""kind"":""text""}}]}]}]},""shop"":{""id"":""shop"",""type"":""scene"",""name"":""Shop"",""blocks"":[{""id"":""b2"",""type"":""block"",""name"":""B2"",""children"":[{""id"":""sn_s"",""type"":""snippet"",""beats"":[{""id"":""L_s"",""kind"":""line"",""character"":""NPC""}],""jump"":{""to"":""END""}}]}]}},""strings"":{""en"":{""L1"":""Hello."",""T1"":""A door creaks."",""C_a"":""Ask."",""C_b"":""Leave."",""L_a"":""Asked."",""L_b"":""Bye."",""L_s"":""Welcome.""}}}";

        private static void RunRunnerChecks()
        {
            int before = _fails;
            Bundle bundle;
            using (var doc = JsonDocument.Parse(RunnerBundleJson)) bundle = ParseBundle(doc.RootElement);
            string Refusal(Action call) { try { call(); return null; } catch (Exception e) { return e.Message; } }
            string Last(List<string> seen) => seen.Count == 0 ? "" : seen[seen.Count - 1];
            string All(List<string> seen) => string.Join(" ", seen);

            // A runner whose every event is written down as kind:id.
            (PatterRunner runner, List<string> seen, Engine engine) Recorded(Engine on = null)
            {
                var engine = on ?? new Engine(bundle);
                var runner = new PatterRunner(engine);
                var seen = new List<string>();
                runner.Line += s => seen.Add($"line:{s.Id}");
                runner.Text += s => seen.Add($"text:{s.Id}");
                runner.GameEvent += s => seen.Add($"gameEvent:{s.Id}");
                runner.Choice += (_, options) => seen.Add($"choice:{string.Join(",", options.Select(o => o.Id))}");
                runner.Ended += reason => seen.Add(reason == EndReason.RanDry ? "ended:ran-dry" : "ended");
                return (runner, seen, engine);
            }

            {
                var (runner, seen, _) = Recorded();
                runner.Begin("talk");
                Check("runner: Start delivers the first beat", All(seen) == "line:L1", All(seen));
                runner.Next();
                runner.Next();
                Check("runner: one beat per Next(), a game event included", All(seen) == "line:L1 text:T1 gameEvent:E1", All(seen));
                runner.Next();
                Check("runner: then the choice", Last(seen) == "choice:opt_a,opt_b", Last(seen));
                runner.Choose("opt_b");
                Check("runner: Choose delivers what it leads to", Last(seen) == "line:L_b", Last(seen));
                runner.Next();
                Check("runner: then the end", Last(seen) == "ended", Last(seen));
            }
            {
                var runner = new PatterRunner(new Engine(bundle));
                string text = "";
                runner.Line += s => text = $"{s.SpeakerLabel}: {s.Text}";
                runner.Begin("talk");
                Check("runner: each event is handed the step itself", text == "NPC: Hello.", text);
            }
            {
                var (runner, seen, _) = Recorded();
                runner.Begin();
                Check("runner: starts at the first scene with no address", All(seen) == "line:L1", All(seen));
            }
            {
                var runner = new PatterRunner(new Engine(bundle));
                var seen = new List<string>();
                int depth = 0, deepest = 0;
                void Step(string id) { depth++; deepest = Math.Max(deepest, depth); seen.Add(id); runner.Next(); depth--; }
                runner.Line += s => Step(s.Id);
                runner.Text += s => Step(s.Id);
                runner.GameEvent += s => Step(s.Id);
                runner.Choice += (_, __) => runner.Choose("opt_a");
                runner.Ended += _ => seen.Add("ended");
                runner.Begin("talk");
                Check("runner: handlers calling Next() themselves play a whole run", All(seen) == "L1 T1 E1 L_a ended", All(seen));
                Check("runner: without deepening the stack", deepest == 1, $"deepest {deepest}");
            }
            {
                var runner = new PatterRunner(new Engine(bundle));
                var seen = new List<string>();
                runner.Line += s => { seen.Add(s.Id); runner.Next(); runner.Stop(); };
                runner.Text += s => seen.Add(s.Id);
                runner.Ended += _ => seen.Add("ended");
                runner.Begin("talk");
                Check("runner: Stop() drops a Next() a handler asked for", All(seen) == "L1", All(seen));
                Check("runner: Stop() leaves the flow unended", !runner.Flow.IsEnded(), "flow ended");
                runner.Next();
                Check("runner: Next() carries on after Stop()", All(seen) == "L1 T1", All(seen));
            }
            {
                var (runner, seen, engine) = Recorded();
                runner.Begin("talk");
                var flow = engine.GetFlow("main");
                runner.Begin("shop");
                Check("runner: a later Begin(scene) moves the same flow", ReferenceEquals(engine.GetFlow("main"), flow), "a new flow");
                Check("runner: and delivers there", Last(seen) == "line:L_s", Last(seen));
                Check("runner: keeping its visit counts",
                    flow.GetVisitCounts().TryGetValue("talk", out var visits) && visits == 1, $"talk visits {visits}");
            }
            {
                var (runner, seen, _) = Recorded();
                runner.Begin("shop");
                runner.Begin();
                Check("runner: Begin() on an open flow begins the story again", All(seen) == "line:L_s line:L1", All(seen));
            }
            {
                var (runner, seen, _) = Recorded();
                runner.Begin("talk");
                string refused = Refusal(() => runner.Begin("nowhere"));
                Check("runner: refuses an address that doesn't resolve", refused != null && refused.Contains("address not found"), refused ?? "no throw");
                runner.Next();
                Check("runner: and leaves the flow as it was", All(seen) == "line:L1 text:T1", All(seen));
                string blockOnly = Refusal(() => runner.Begin(null, "b1"));
                Check("runner: refuses a block without its scene", blockOnly != null && blockOnly.Contains("a block needs its scene"), blockOnly ?? "no throw");
            }
            {
                var runner = new PatterRunner(new Engine(bundle));
                string next = Refusal(runner.Next);
                string choose = Refusal(() => runner.Choose("opt_a"));
                Check("runner: refuses Next() before Begin()", next != null && next.Contains("Begin() first"), next ?? "no throw");
                Check("runner: refuses Choose() before Begin()", choose != null && choose.Contains("Begin() first"), choose ?? "no throw");
            }
            {
                var (runner, seen, engine) = Recorded();
                runner.Begin("talk");
                runner.Next();
                var save = engine.SaveGame();
                runner.Next();
                engine.LoadGame(save);
                runner.Next();
                Check("runner: carries on after a load with Next()", Last(seen) == "gameEvent:E1", Last(seen));
                var swapped = engine.HotSwap(bundle);
                runner.Rebind(swapped);
                runner.Next();
                Check("runner: carries on after a hot swap once rebound", Last(seen) == "choice:opt_a,opt_b", Last(seen));
            }
            {
                // A hub whose one option comes back to it: once used, the choice runs dry and nothing follows.
                const string hubJson = @"{""schema"":""patter/bundle@0"",""locales"":{""default"":""en"",""included"":[""en""]},""cast"":[{""name"":""NPC""}],
                    ""scenes"":{""hub"":{""id"":""hub"",""type"":""scene"",""name"":""Hub"",""blocks"":[{""id"":""bh"",""type"":""block"",""name"":""BH"",""children"":[
                      {""id"":""g"",""type"":""group"",""selector"":""choice"",""children"":[
                        {""id"":""o"",""type"":""group"",""prompt"":{""id"":""C_a"",""kind"":""text""},""children"":[
                          {""id"":""sn_o"",""type"":""snippet"",""beats"":[{""id"":""L_a"",""kind"":""line"",""character"":""NPC""}],""jump"":{""to"":""hub""}}]}]}]}]}},
                    ""strings"":{""en"":{""C_a"":""Ask."",""L_a"":""Asked.""}}}";
                var hub = new Engine(PatterBundleLoader.Parse(hubJson), new EngineOptions { OnError = _ => { } });
                var (runner, seen, _) = Recorded(hub);
                runner.Begin("hub");
                runner.Choose("o");
                runner.Next(); // back at the hub, its only option used: it runs dry, and nothing follows
                Check("runner: hands Ended the reason, RanDry when a choice had nothing left and nothing came after it",
                    All(seen) == "choice:o line:L_a ended:ran-dry", All(seen));
            }
            {
                var runner = new PatterRunner(new Engine(bundle));
                var seen = new List<string>();
                Action<StepResult> handler = s => seen.Add(s.Id);
                runner.Line += handler;
                runner.Line -= handler;
                runner.Begin("talk");
                Check("runner: stops listening when asked", seen.Count == 0, All(seen));
            }
            if (_fails == before) Console.WriteLine("  [runner] the thin runner: beats on Next(), choices on Choose(), the end and its reason, Stop, Start again, load and hot swap");
        }
    }
}
