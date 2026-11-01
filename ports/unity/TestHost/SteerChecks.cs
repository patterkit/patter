// Steering (patterkit design/proposals/patterplay-steering.md): a tool's steerer answers every gate and pick.
// RunSteers plays the corpus's steering cases (the reference's runSteerCase): a steerer answers each point from
// the case's answers in order, then with the point's default, and every point is recorded with its answer; the
// points, the transcript and (when the case expects one) the engine log are compared. RunSteerChecks is a port of
// packages/runtime/test/steer.test.ts, pinning what the corpus can't: an answer that isn't one, a steerer that
// left a method out, and a hot swap keeping the steerer. (A steerer of the wrong shape can't be built in C#:
// EngineOptions.Steer is an ISteerer, so there's no set-up problem to report.)

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;

namespace Patterkit.Patterplay.TestHost
{
    internal static partial class Program
    {
        /// <summary>A steerer that answers from a list in order, then with the default, recording every point.</summary>
        private sealed class ListSteerer : ISteerer
        {
            private readonly Queue<JsonElement> _answers;
            public readonly List<object> Points = new List<object>();
            public ListSteerer(IEnumerable<JsonElement> answers) { _answers = new Queue<JsonElement>(answers); }

            public bool Gate(GatePoint p)
            {
                bool answer = _answers.Count > 0 ? _answers.Dequeue().GetBoolean() : p.Default;
                Points.Add(new Dictionary<string, object>
                {
                    ["kind"] = "gate", ["flow"] = p.Flow, ["node"] = p.Node, ["where"] = p.Where,
                    ["source"] = p.Source, ["default"] = p.Default, ["answer"] = answer,
                });
                return answer;
            }

            public string Pick(PickPoint p)
            {
                string answer = _answers.Count > 0 ? _answers.Dequeue().GetString() : p.Default;
                Points.Add(new Dictionary<string, object>
                {
                    ["kind"] = "pick", ["flow"] = p.Flow, ["group"] = p.Group, ["selector"] = p.Selector,
                    ["children"] = p.Children.Select(c => (object)new Dictionary<string, object> { ["id"] = c.Id, ["eligible"] = c.Eligible }).ToList(),
                    ["default"] = p.Default, ["answer"] = answer,
                });
                return answer;
            }
        }

        private static int RunSteers(JsonElement arr)
        {
            int pass = 0;
            foreach (var c in arr.EnumerateArray())
            {
                string name = c.GetProperty("name").GetString();
                try
                {
                    var bundle = _loader(c.GetProperty("bundle"));
                    bool logged = c.TryGetProperty("expectedLog", out var expectedLog);
                    var steerer = new ListSteerer(c.GetProperty("answers").EnumerateArray());
                    var opts = new EngineOptions { Log = logged, OnError = _ => { }, Steer = steerer };
                    if (c.TryGetProperty("seed", out var seed)) opts.Seed = seed.GetDouble();
                    var engine = new Engine(bundle, opts);
                    var start = c.GetProperty("start");
                    var flow = engine.OpenFlow("main", start.GetProperty("scene").GetString(),
                        start.TryGetProperty("block", out var bl) ? bl.GetString() : null);
                    var scripted = c.TryGetProperty("choices", out var ch)
                        ? new Queue<string>(ch.EnumerateArray().Select(x => x.GetString())) : new Queue<string>();
                    var transcript = new List<object>();
                    for (int i = 0; i < 1000; i++)
                    {
                        var step = flow.Advance();
                        transcript.Add(Normalize(step, IsIdsOnly(bundle)));
                        if (step.Type == StepType.End) break;
                        if (step.Type == StepType.Choice)
                        {
                            string pick = scripted.Count > 0 ? scripted.Dequeue() : step.Options.FirstOrDefault(o => o.Eligible)?.Id;
                            if (pick == null) break;
                            flow.Choose(pick);
                        }
                    }
                    var log = logged ? engine.Log().Select(e => (object)LogEntryToObject(e)).ToList() : null;
                    if (!MatchArray(steerer.Points, c.GetProperty("expectedPoints")))
                        Fail("steers", name, $"points mismatch\n    expected {c.GetProperty("expectedPoints")}\n    got      {Dump(steerer.Points)}");
                    else if (!MatchArray(transcript, c.GetProperty("expectedTranscript")))
                        Fail("steers", name, $"transcript mismatch\n    expected {c.GetProperty("expectedTranscript")}\n    got      {Dump(transcript)}");
                    else if (logged && !MatchArray(log, expectedLog))
                        Fail("steers", name, $"log mismatch\n    expected {expectedLog}\n    got      {Dump(log)}");
                    else pass++;
                }
                catch (Exception ex) { Fail("steers", name, ex.Message); }
            }
            return pass;
        }

        // The steer.test.ts bundle: a conditioned snippet, a branch whose first child is conditioned, then END.
        private const string SteerBundleJson = @"{""schema"":""patter/bundle@0"",""locales"":{""default"":""en"",""included"":[""en""]},
            ""properties"":[{""name"":""met"",""type"":""boolean"",""default"":false}],
            ""scenes"":{""s"":{""id"":""s"",""type"":""scene"",""name"":""S"",""blocks"":[{""id"":""b"",""type"":""block"",""name"":""B"",""children"":[
              {""id"":""sn_a"",""type"":""snippet"",""condition"":{""src"":""@met"",""ast"":[""sv"",""patter"",""met""]},""beats"":[{""id"":""A"",""kind"":""text""}]},
              {""id"":""g"",""type"":""group"",""selector"":""branch"",""children"":[
                {""id"":""sn_yes"",""type"":""snippet"",""condition"":{""src"":""@met"",""ast"":[""sv"",""patter"",""met""]},""beats"":[{""id"":""YES"",""kind"":""text""}]},
                {""id"":""sn_no"",""type"":""snippet"",""beats"":[{""id"":""NO"",""kind"":""text""}]}]},
              {""id"":""sn_end"",""type"":""snippet"",""jump"":{""to"":""END""}}]}]}},
            ""strings"":{""en"":{""A"":""a"",""YES"":""yes"",""NO"":""no""}}}";

        /// <summary>Answers every gate with Answer, and leaves Pick out (the interface's default answers it).</summary>
        private sealed class GateOnly : ISteerer
        {
            public bool Answer;
            public bool Gate(GatePoint p) => Answer;
        }

        /// <summary>Answers every pick with Answer, and leaves Gate out.</summary>
        private sealed class PickOnly : ISteerer
        {
            public string Answer;
            public string Pick(PickPoint p) => Answer;
        }

        /// <summary>Answers both kinds.</summary>
        private sealed class BothSteerer : ISteerer
        {
            public bool GateAnswer;
            public string PickAnswer;
            public bool Gate(GatePoint p) => GateAnswer;
            public string Pick(PickPoint p) => PickAnswer;
        }

        private static void RunSteerChecks()
        {
            int before = _fails;
            Guarded("steer", SteerChecks);
            if (_fails == before) Console.WriteLine("  [steer] an unknown or null pick throws as Choose does, a method left out answers the default, a hot swap keeps the steerer");
        }

        private static void SteerChecks()
        {
            var bundle = PatterBundleLoader.Parse(SteerBundleJson);
            List<string> Texts(Engine engine)
            {
                var flow = engine.OpenFlow("main");
                var out_ = new List<string>();
                for (var r = flow.Advance(); r.Type != StepType.End; r = flow.Advance())
                    if (r.Type == StepType.Text) out_.Add(r.Text);
                return out_;
            }
            string Show(List<string> l) => "[" + string.Join(", ", l) + "]";
            Exception Thrown(Action act)
            {
                try { act(); return null; }
                catch (Exception ex) { return ex; }
            }

            {
                var ex = Thrown(() => Texts(new Engine(bundle, new EngineOptions { Steer = new PickOnly { Answer = "sn_nowhere" } })));
                Check("steer: a pick naming a child the group doesn't have throws",
                    ex != null && ex.Message.Contains("sn_nowhere") && ex.Message.Contains("isn't one of its children"), ex?.Message ?? "nothing thrown");
                // Choose with an unknown id throws the same kind of exception.
                var choose = Thrown(() =>
                {
                    var choice = PatterBundleLoader.Parse(DryHubBundleJson());
                    var f = new Engine(choice).OpenFlow("f", "s");
                    f.Advance();
                    f.Choose("nowhere");
                });
                Check("steer: it fails as Choose with an unknown id does", ex != null && choose != null && ex.GetType() == choose.GetType(),
                    $"{ex?.GetType().Name} vs {choose?.GetType().Name}");
            }
            {
                var ex = Thrown(() => Texts(new Engine(bundle, new EngineOptions { Steer = new PickOnly { Answer = null } })));
                Check("steer: a pick answered null throws", ex != null && ex.Message.Contains("pick for g answered null"), ex?.Message ?? "nothing thrown");
            }
            {
                var errors = new List<PlayError>();
                var t = Texts(new Engine(bundle, new EngineOptions { Steer = null, OnError = errors.Add }));
                Check("steer: unset, nothing changes and nothing is reported", t.SequenceEqual(new[] { "no" }) && errors.Count == 0, Show(t) + " " + ShowErrors(errors));
            }
            {
                var t = Texts(new Engine(bundle, new EngineOptions { Steer = new GateOnly { Answer = true } }));
                Check("steer: Pick left out answers the selector's pick", t.SequenceEqual(new[] { "a", "no" }), Show(t));
                t = Texts(new Engine(bundle, new EngineOptions { Steer = new PickOnly { Answer = "sn_yes" } }));
                Check("steer: Gate left out answers the condition's verdict", t.SequenceEqual(new[] { "yes" }), Show(t));
            }
            {
                var engine = new Engine(bundle, new EngineOptions { Steer = new BothSteerer { GateAnswer = true, PickAnswer = "sn_yes" } });
                var t = Texts(engine.HotSwap(bundle));
                Check("steer: a hot swap keeps the steerer", t.SequenceEqual(new[] { "a", "yes" }), Show(t));
            }
        }
    }
}
