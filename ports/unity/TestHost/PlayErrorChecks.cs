// Content errors play through (the family's rule 1, 2026-10-06), and old saves (rule 9): what the corpus
// cannot see. The corpus pins that the story plays on past a failing condition or effect; here, that each
// one is REPORTED, to EngineOptions.OnError (or Engine.DefaultOnError when the game set none) and as a
// `diagnostic` entry in the decision log, and that a skipped effect leaves no `write` entry behind. Then
// the save rules: PatterSave refuses a bare snapshot with no envelope, and a save with no flows is refused
// before the engine changes.

using System;
using System.Collections.Generic;
using System.Linq;
using Wildwinter.Expr;

namespace Patterkit.Patterplay.TestHost
{
    internal static partial class Program
    {
        // Scene `s`: its onEntry divides by zero; sn_set's second effect divides by zero between two that
        // land; sn_bad's condition divides by zero. Scene `bm`: Best match, where sn_x is eligible by the left
        // side of its `or` and the right side, which only scoring evaluates, divides by zero.
        private const string PlayErrorBundleJson = @"{""schema"":""patter/bundle@0"",""locales"":{""default"":""en"",""included"":[""en""]},
            ""properties"":[{""name"":""zero"",""type"":""number"",""default"":0},{""name"":""a"",""type"":""number"",""default"":0},
                {""name"":""c"",""type"":""number"",""default"":0},{""name"":""d"",""type"":""number"",""default"":0}],
            ""scenes"":{
              ""s"":{""id"":""s"",""type"":""scene"",""name"":""s"",
                ""onEntry"":[{""kind"":""set"",""target"":""@c"",""value"":{""src"":""10 / @zero"",""ast"":[""bin"",""/"",[""n"",10],[""sv"",""patter"",""zero""]]}}],
                ""blocks"":[{""id"":""b_s"",""type"":""block"",""name"":""B"",""children"":[
                  {""id"":""sn_set"",""type"":""snippet"",""beats"":[{""id"":""T_vals"",""kind"":""text""}],""onEnter"":[
                    {""kind"":""set"",""target"":""@a"",""value"":{""src"":""1"",""ast"":[""n"",1]}},
                    {""kind"":""set"",""target"":""@c"",""value"":{""src"":""10 / @zero"",""ast"":[""bin"",""/"",[""n"",10],[""sv"",""patter"",""zero""]]}},
                    {""kind"":""set"",""target"":""@d"",""value"":{""src"":""1"",""ast"":[""n"",1]}}]},
                  {""id"":""g_br"",""type"":""group"",""selector"":""branch"",""children"":[
                    {""id"":""sn_bad"",""type"":""snippet"",""condition"":{""src"":""10 / @zero > 1"",""ast"":[""bin"","">"",[""bin"",""/"",[""n"",10],[""sv"",""patter"",""zero""]],[""n"",1]]},""beats"":[{""id"":""T_bad"",""kind"":""text""}]},
                    {""id"":""sn_ok"",""type"":""snippet"",""beats"":[{""id"":""T_ok"",""kind"":""text""}]}]},
                  {""id"":""sn_end"",""type"":""snippet"",""jump"":{""to"":""END""}}]}]},
              ""bm"":{""id"":""bm"",""type"":""scene"",""name"":""bm"",""blocks"":[{""id"":""b_bm"",""type"":""block"",""name"":""B"",""children"":[
                  {""id"":""g_bm"",""type"":""group"",""selector"":""sequence"",""options"":{""order"":""specificity"",""exhaust"":""repeat""},""children"":[
                    {""id"":""sn_x"",""type"":""snippet"",""condition"":{""src"":""@zero == 0 or 10 / @zero > 2"",""ast"":[""bin"",""or"",[""bin"",""=="",[""sv"",""patter"",""zero""],[""n"",0]],[""bin"","">"",[""bin"",""/"",[""n"",10],[""sv"",""patter"",""zero""]],[""n"",2]]]},""beats"":[{""id"":""X"",""kind"":""text""}]},
                    {""id"":""sn_y"",""type"":""snippet"",""beats"":[{""id"":""Y"",""kind"":""text""}]}]},
                  {""id"":""sn_bm_end"",""type"":""snippet"",""jump"":{""to"":""END""}}]}]}},
            ""strings"":{""en"":{""T_vals"":""a={@a} c={@c} d={@d}"",""T_bad"":""bad"",""T_ok"":""ok"",""X"":""x"",""Y"":""y""}}}";

        private static string ShowErrors(IEnumerable<PlayError> errors)
            => string.Join(" | ", errors.Select(e => $"{e.Flow}/{e.Kind}/{e.Node}/{e.Source ?? "<no source>"}/{e.Message}"));

        private static bool IsError(PlayError e, string kind, string node, string source)
            => e.Flow == "main" && e.Kind == kind && e.Node == node && e.Source == source && e.Message == "division by zero";

        /// <summary>Run a group of checks; one that throws fails the group rather than stopping the harness.</summary>
        private static void Guarded(string group, Action checks)
        {
            try { checks(); }
            catch (Exception e) { Check($"{group}: the checks ran without throwing", false, $"{e.GetType().Name}: {e.Message}"); }
        }

        private static void RunPlayErrorChecks()
        {
            int before = _fails;
            Guarded("play-error", PlayErrorChecks);
            if (_fails == before) Console.WriteLine("  [play-error] each content error reported once, to OnError (or the default) and the log, no write for a skipped effect");
        }

        private static void RunOldSaveRuleChecks()
        {
            int before = _fails;
            Guarded("old-save", OldSaveRuleChecks);
            if (_fails == before) Console.WriteLine("  [old-save] a bare snapshot is refused; a save with no flows or a fractional version is refused before anything changes");
        }

        private static void PlayErrorChecks()
        {
            var bundle = PatterBundleLoader.Parse(PlayErrorBundleJson);

            // OnError: one report per failure, in the order they happened, each naming its node and source.
            var errors = new List<PlayError>();
            var engine = new Engine(bundle, new EngineOptions { OnError = errors.Add, Log = true });
            var played = new List<string>();
            string thrown = null;
            try
            {
                var flow = engine.OpenFlow("main", "s");
                foreach (var step in flow.AdvanceToStop().Played) played.Add(step.Text);
            }
            catch (Exception e) { thrown = e.Message; }
            Check("play-error: the story plays through", thrown == null && string.Join(",", played) == "a=1 c=0 d=1,ok",
                thrown ?? string.Join(",", played));
            Check("play-error: OnError hears each failure once, in order", errors.Count == 3, ShowErrors(errors));
            if (errors.Count == 3)
            {
                Check("play-error: a failing onEntry effect names its scene", IsError(errors[0], "effect", "s", "10 / @zero"), ShowErrors(errors));
                Check("play-error: a failing effect names its snippet and source", IsError(errors[1], "effect", "sn_set", "10 / @zero"), ShowErrors(errors));
                Check("play-error: a failing condition names its snippet and source", IsError(errors[2], "condition", "sn_bad", "10 / @zero > 1"), ShowErrors(errors));
            }

            // The decision log: a diagnostic entry for each, on the flow's log and the engine's, and no
            // `write` entry for a skipped effect.
            var flowLog = engine.GetFlow("main").Log();
            var diags = flowLog.Where(e => e.Type == "diagnostic").ToList();
            string ShowDiags(IEnumerable<LogEntry> es) => string.Join(" | ", es.Select(e => $"{e.Kind}/{e.Node}/{e.Source}/{e.Message}"));
            Check("play-error: a diagnostic log entry per failure", diags.Count == 3
                && diags[0].Kind == "effect" && diags[0].Node == "s"
                && diags[1].Kind == "effect" && diags[1].Node == "sn_set" && diags[1].Source == "10 / @zero" && diags[1].Message == "division by zero"
                && diags[2].Kind == "condition" && diags[2].Node == "sn_bad" && diags[2].Source == "10 / @zero > 1",
                ShowDiags(diags));
            var engineDiags = engine.Log().Where(e => e.Type == "diagnostic").ToList();
            Check("play-error: the engine's log carries them too, with the flow", engineDiags.Count == 3
                && engineDiags.All(e => e.Flow == "main") && engineDiags[2].Kind == "condition" && engineDiags[2].Source == "10 / @zero > 1",
                ShowDiags(engineDiags));
            var writes = flowLog.Where(e => e.Type == "write").Select(e => e.Target).ToList();
            Check("play-error: no write entry for a skipped effect", string.Join(",", writes) == "@a,@d", string.Join(",", writes));
            // The branch's select entry records the failed condition as ineligible.
            var select = flowLog.FirstOrDefault(e => e.Type == "select" && e.Group == "g_br");
            Check("play-error: the failed condition is ineligible in the select entry",
                select != null && select.Children.SequenceEqual(new[] { ("sn_bad", false), ("sn_ok", true) }) && select.Picked == "sn_ok",
                select == null ? "no select entry" : string.Join(",", select.Children));

            // With the log off, nothing is logged, and OnError still hears it.
            var quietErrors = new List<PlayError>();
            var quiet = new Engine(bundle, new EngineOptions { OnError = quietErrors.Add });
            var qf = quiet.OpenFlow("main", "s");
            qf.AdvanceToStop();
            Check("play-error: log off, nothing logged, OnError still told", qf.Log().Count == 0 && quiet.Log().Count == 0 && quietErrors.Count == 3,
                $"flow log {qf.Log().Count}, engine log {quiet.Log().Count}, errors {quietErrors.Count}");

            // Best match: a part that fails while being scored scores as false, and is reported as such.
            var bmErrors = new List<PlayError>();
            var bmFlow = new Engine(bundle, new EngineOptions { OnError = bmErrors.Add }).OpenFlow("main", "bm");
            var bmStep = bmFlow.Advance();
            Check("play-error: a Best-match part that fails is reported as best-match",
                bmStep.Id == "X" && bmErrors.Count >= 1 && bmErrors.All(e => IsError(e, "best-match", "sn_x", "@zero == 0 or 10 / @zero > 2")),
                $"played {bmStep.Id}; {ShowErrors(bmErrors)}");

            // No OnError: the engine's default hears it, so a content bug is never silent. (The Unity layer
            // points that default at Debug.LogWarning.)
            var heard = new List<PlayError>();
            var wasDefault = Engine.DefaultOnError;
            try
            {
                Engine.DefaultOnError = heard.Add;
                new Engine(bundle).OpenFlow("main", "s").AdvanceToStop();
            }
            finally { Engine.DefaultOnError = wasDefault; }
            Check("play-error: with no OnError, the default hears each failure", heard.Count == 3 && heard[2].Kind == "condition",
                ShowErrors(heard));
            Check("play-error: the default's line names what failed, where, and why",
                heard.Count > 0 && heard[0].ToString() == "effect on s in flow 'main' failed, played through: division by zero",
                heard.Count > 0 ? heard[0].ToString() : "nothing heard");
        }

        /// <summary>Rule 9: PatterSave reads only the `patter/save@0` envelope (a bare snapshot is refused, as
        /// the JS reference refuses it), and a save the engine cannot load is refused BEFORE anything changes:
        /// a save with no flows used to close every flow and load the registry, then fail half-loaded.</summary>
        private static void OldSaveRuleChecks()
        {
            var bundle = PatterBundleLoader.Parse(PlayErrorBundleJson);

            string Refusal(Engine engine, string json)
            {
                try { PatterSave.DeserializeState(engine, json); return null; }
                catch (Exception e) { return e.Message; }
            }

            // An engine part-way through: a flow open, values written, one step taken.
            Engine Playing(out Flow flow)
            {
                var engine = new Engine(bundle, new EngineOptions { OnError = _ => { } });
                flow = engine.OpenFlow("main", "s");
                flow.Advance();
                return engine;
            }

            var source = Playing(out _);
            string envelope = PatterSave.SerializeState(source);
            var root = Newtonsoft.Json.Linq.JObject.Parse(envelope);
            string bare = root["save"].ToString(Newtonsoft.Json.Formatting.None);

            // A bare snapshot, refused, and the engine left as it was.
            {
                var engine = Playing(out var flow);
                engine.SetProperty("@a", ExprValue.Num(42));
                string was = PatterSave.SerializeState(engine);
                string msg = Refusal(engine, bare);
                Check("old-save: a bare snapshot with no envelope is refused", msg == "PatterSave: not a patter/save@0 envelope", msg ?? "loaded");
                Check("old-save: the refused bare snapshot left the engine as it was",
                    PatterSave.SerializeState(engine) == was && engine.GetFlow("main") == flow && !flow.IsClosed, PatterSave.SerializeState(engine));
            }

            // The same save in its envelope still loads.
            {
                var engine = Playing(out _);
                string msg = Refusal(engine, envelope);
                Check("old-save: the same save in its envelope loads", msg == null && PatterSave.SerializeState(engine) == envelope, msg ?? PatterSave.SerializeState(engine));
            }

            // A save with no flows (or flows that are not an object): refused before anything changes.
            foreach (var (label, flows) in new (string, Newtonsoft.Json.Linq.JToken)[]
                     {
                         ("missing", null),
                         ("an array", new Newtonsoft.Json.Linq.JArray()),
                         ("a string", new Newtonsoft.Json.Linq.JValue("main")),
                     })
            {
                var engine = Playing(out var flow);
                engine.SetProperty("@a", ExprValue.Num(42));
                string was = PatterSave.SerializeState(engine);
                var malformed = (Newtonsoft.Json.Linq.JObject)root.DeepClone();
                var save = (Newtonsoft.Json.Linq.JObject)malformed["save"];
                // The registry the save carries would overwrite @a: proof that nothing was loaded.
                if (flows == null) save.Remove("flows"); else save["flows"] = flows;
                string msg = Refusal(engine, malformed.ToString(Newtonsoft.Json.Formatting.None));
                Check($"old-save: a save whose flows are {label} is refused", msg == "malformed save: no flows", msg ?? "loaded");
                Check($"old-save: a save whose flows are {label} left the engine as it was",
                    PatterSave.SerializeState(engine) == was && engine.GetFlow("main") == flow && !flow.IsClosed
                    && engine.GetProperty("@a")?.AsNumber == 42, PatterSave.SerializeState(engine));
            }

            // The same through the engine's own door.
            {
                var engine = Playing(out var flow);
                string was = PatterSave.SerializeState(engine);
                string msg = null;
                try { engine.LoadGame(new SaveGame { Version = Engine.SaveVersion, Registry = source.SaveGame().Registry }); }
                catch (Exception e) { msg = e.Message; }
                Check("old-save: LoadGame refuses a SaveGame with no Flows", msg == "malformed save: no flows", msg ?? "loaded");
                Check("old-save: and the engine is as it was", PatterSave.SerializeState(engine) == was && engine.GetFlow("main") == flow && !flow.IsClosed,
                    PatterSave.SerializeState(engine));
            }

            // A version that is not a whole number 2 or 3 is refused, never rounded or parsed into one.
            foreach (var (label, version, want) in new (string, Newtonsoft.Json.Linq.JToken, string)[]
                     {
                         ("3.9", new Newtonsoft.Json.Linq.JValue(3.9), "unsupported save version: 3.9"),
                         ("2.5", new Newtonsoft.Json.Linq.JValue(2.5), "unsupported save version: 2.5"),
                         ("the string \"3\"", new Newtonsoft.Json.Linq.JValue("3"), "unsupported save version: 3"),
                     })
            {
                var engine = Playing(out var flow);
                string was = PatterSave.SerializeState(engine);
                var bad = (Newtonsoft.Json.Linq.JObject)root.DeepClone();
                bad["save"]["version"] = version;
                string msg = Refusal(engine, bad.ToString(Newtonsoft.Json.Formatting.None));
                Check($"old-save: version {label} is refused", msg == want, msg ?? "loaded");
                Check($"old-save: version {label} left the engine as it was", PatterSave.SerializeState(engine) == was && engine.GetFlow("main") == flow,
                    PatterSave.SerializeState(engine));
            }
        }
    }
}
