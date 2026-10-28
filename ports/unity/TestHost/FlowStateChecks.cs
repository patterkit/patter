// CaptureFlow / RestoreFlow: the host-surface half of the contract the conformance corpus pins (a restored flow
// carries on with its own values, on all four runtimes). Here: what restore refuses and that a refusal leaves
// nothing behind, a state that outlives a save and load, ids that need escaping, and the scene bags of scenes
// the flow has left (or hasn't yet re-entered after a load). A port of the JS runtime's flow-state.test.ts.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Wildwinter.Expr;

namespace Patterkit.Patterplay.TestHost
{
    internal static partial class Program
    {
        // The JS test's fixture, as its compiler exports it: scene s sets the flow's own @scene.mine and @gold on
        // entry and jumps to t, whose two lines jump back to s.
        private const string FlowStateBundleJson = @"{""schema"":""patter/bundle@0"",""content"":{""project"":""p"",""hash"":""0eutawq"",""structureHash"":""13o8xbf""},""voiced"":false,""locales"":{""default"":""en"",""included"":[""en""]},""properties"":[{""name"":""gold"",""type"":""number"",""default"":0,""shared"":false}],""scenes"":{""s"":{""id"":""s"",""type"":""scene"",""name"":""S"",""gameId"":""s"",""sceneProps"":[{""name"":""mine"",""type"":""number"",""default"":0,""shared"":false}],""blocks"":[{""id"":""b"",""type"":""block"",""name"":""B"",""children"":[{""id"":""sn"",""type"":""snippet"",""beats"":[{""id"":""T"",""kind"":""text""}],""onEnter"":[{""kind"":""set"",""target"":""@scene.mine"",""value"":{""src"":""7"",""ast"":[""n"",7]}},{""kind"":""set"",""target"":""@gold"",""value"":{""src"":""3"",""ast"":[""n"",3]}}],""jump"":{""to"":""t""}}]}]},""t"":{""id"":""t"",""type"":""scene"",""name"":""T"",""gameId"":""t"",""blocks"":[{""id"":""b2"",""type"":""block"",""name"":""B2"",""children"":[{""id"":""sn2"",""type"":""snippet"",""beats"":[{""id"":""U"",""kind"":""text""},{""id"":""U2"",""kind"":""text""}],""jump"":{""to"":""s""}}]}]}},""strings"":{""en"":{""T"":""mine {@scene.mine}, gold {@gold}"",""U"":""u"",""U2"":""u2""}}}";

        private static void RunFlowStateChecks()
        {
            int before = _fails;
            Bundle bundle;
            using (var doc = JsonDocument.Parse(FlowStateBundleJson)) bundle = ParseBundle(doc.RootElement);

            // Throws, with a message containing `want`.
            void Refused(string what, Action act, string want)
            {
                string message = null;
                try { act(); } catch (Exception e) { message = e.Message; }
                Check($"flow state: {what}", message != null && message.Contains(want), message ?? "no error");
            }
            // A state, and a whole game, through their JSON, as a game would keep them.
            FlowState ViaJson(FlowState state) => PatterSave.ReadFlowState(JObject.Parse(PatterSave.SaveFlowState(state).ToString(Formatting.None)));
            string Json(FlowState state) => PatterSave.SaveFlowState(state).ToString(Formatting.None);
            Engine Loaded(Engine from)
            {
                var engine = new Engine(bundle);
                PatterSave.DeserializeState(engine, PatterSave.SerializeState(from));
                return engine;
            }
            // A flow that has been through s (setting its values) and is part-way through t.
            void InT(Engine engine, string id = "f")
            {
                var flow = engine.OpenFlow(id, "s");
                flow.Advance();
                flow.Advance();
            }
            bool Says(StepResult step, string id, string text = null)
                => step != null && step.Type == StepType.Text && step.Id == id && (text == null || step.Text == text);
            string Shown(StepResult step) => step == null ? "null" : $"{step.Type} {step.Id} '{step.Text}'";
            double Num(ExprValue v) => v == null ? double.NaN : v.AsNumber;

            // Capture the flow's own values without its id, including a scene it has left.
            {
                var engine = new Engine(bundle);
                InT(engine, "npc/bob");
                var state = engine.CaptureFlow("npc/bob");
                Check("flow state: version", state.Version == Engine.SaveVersion, $"{state.Version}");
                Check("flow state: its @patter values", state.Scopes != null && state.Scopes.Count == 1 && Num(state.Scopes.GetValueOrDefault("gold")) == 3,
                    Json(state));
                Check("flow state: the bag of a scene it has left",
                    state.SceneBags.TryGetValue("s", out var bag) && bag.Count == 1 && Num(bag.GetValueOrDefault("mine")) == 7, Json(state));
                Check("flow state: without its id", !Json(state).Contains("npc"), Json(state));
            }

            // Restore under another id, escaped or not, and carry on with the flow's own values.
            foreach (var id in new[] { "g", "npc/alice", "100%" })
            {
                var engine = new Engine(bundle);
                InT(engine, "npc/bob");
                var state = ViaJson(engine.CaptureFlow("npc/bob"));
                engine.CloseFlow("npc/bob");
                var flow = engine.RestoreFlow(id, state);
                Check($"flow state: restored open under '{id}'", engine.GetFlow(id) == flow, "not open");
                var step = flow.Advance();
                Check($"flow state: '{id}' carries on", Says(step, "U2"), Shown(step));
                step = flow.Advance();
                Check($"flow state: '{id}' kept its own values", Says(step, "T", "mine 7, gold 3"), Shown(step));
            }

            // Outlive a save and load, including values parked for a scene the flow hasn't re-entered.
            {
                var first = new Engine(bundle);
                InT(first);
                var loaded = Loaded(first);
                var state = ViaJson(loaded.CaptureFlow("f"));       // s's bag is still parked here
                Check("flow state: a parked bag is captured",
                    state.SceneBags.TryGetValue("s", out var bag) && Num(bag.GetValueOrDefault("mine")) == 7, Json(state));
                loaded.CloseFlow("f");
                var later = Loaded(loaded);                         // a save with no flow in it
                var flow = later.RestoreFlow("f", state);
                flow.Advance();
                var step = flow.Advance();
                Check("flow state: restored after a save and load", Says(step, "T", "mine 7, gold 3"), Shown(step));
            }

            // Drop what a load left waiting under the id, as a fresh start does.
            {
                var first = new Engine(bundle);
                InT(first);
                var loaded = Loaded(first);                         // f's bag for s is parked, waiting for it to re-enter
                loaded.CloseFlow("f");
                var elsewhere = new Engine(bundle);
                elsewhere.OpenFlow("g", "t");                       // never been in s
                var state = ViaJson(elsewhere.CaptureFlow("g"));
                loaded.RestoreFlow("f", state);
                var after = loaded.CaptureFlow("f");
                Check("flow state: a restore drops what a load left under the id", !after.SceneBags.ContainsKey("s"), Json(after));
            }

            // Leave nothing behind when a state won't restore.
            {
                var engine = new Engine(bundle);
                InT(engine);
                var state = ViaJson(engine.CaptureFlow("f"));
                engine.CloseFlow("f");
                string saved = PatterSave.SerializeState(engine);
                var broken = ViaJson(state);
                broken.Stack = new List<StackFrame> { null };       // a cursor no flow can take
                Refused("a state that won't restore", () => engine.RestoreFlow("f", broken), "");
                Check("flow state: a failed restore opened nothing", engine.GetFlow("f") == null, "a flow 'f' opened");
                Check("flow state: a failed restore left nothing behind", PatterSave.SerializeState(engine) == saved,
                    $"\n    before {saved}\n    after  {PatterSave.SerializeState(engine)}");
                var step = engine.RestoreFlow("f", state).Advance();
                Check("flow state: the good state still restores", Says(step, "U2"), Shown(step));
            }

            // Refuse a state with no cursor, missing or null, leaving nothing behind: a flow state never had the
            // flat shape an old save did, so it isn't read as an empty cursor.
            foreach (var (label, cursor) in new (string, JToken)[] { ("missing", null), ("null", JValue.CreateNull()) })
            {
                var engine = new Engine(bundle);
                InT(engine);
                var json = PatterSave.SaveFlowState(engine.CaptureFlow("f"));
                engine.CloseFlow("f");
                string saved = PatterSave.SerializeState(engine);
                if (cursor == null) json.Remove("cursor"); else json["cursor"] = cursor;
                Refused($"a state whose cursor is {label}", () => engine.RestoreFlow("f", PatterSave.ReadFlowState(json)),
                    "malformed flow state: no cursor");
                Check($"flow state: a {label} cursor opened nothing", engine.GetFlow("f") == null, "a flow 'f' opened");
                Check($"flow state: a {label} cursor left nothing behind", PatterSave.SerializeState(engine) == saved,
                    $"\n    before {saved}\n    after  {PatterSave.SerializeState(engine)}");
            }

            // Refuse an unknown capture, an open id, a checkpoint, and an unknown version, leaving nothing behind. A
            // capture only reads, so it is allowed inside a checkpoint.
            {
                var engine = new Engine(bundle);
                Refused("CaptureFlow of no open flow", () => engine.CaptureFlow("nope"), "no open flow 'nope'");
                InT(engine);
                var state = ViaJson(engine.CaptureFlow("f"));
                string saved = PatterSave.SerializeState(engine);
                Refused("RestoreFlow over an open id", () => engine.RestoreFlow("f", state), "already open");
                var cp = engine.Checkpoint();
                Refused("RestoreFlow inside a checkpoint", () => engine.RestoreFlow("g", state), "checkpoint");
                Check("flow state: a refused restore kept the checkpoint open", engine.InCheckpoint, "closed");
                FlowState inside = null;
                try { inside = engine.CaptureFlow("f"); } catch (Exception e) { Check("flow state: CaptureFlow inside a checkpoint", false, e.Message); }
                Check("flow state: CaptureFlow inside a checkpoint", inside != null && Json(inside) == Json(state), inside == null ? "no state" : Json(inside));
                engine.Commit(cp);
                var unknown = ViaJson(state);
                unknown.Version = 99;
                Refused("RestoreFlow of an unknown version", () => engine.RestoreFlow("g", unknown), "unsupported flow state version: 99");
                Check("flow state: the refusals left nothing behind", PatterSave.SerializeState(engine) == saved,
                    $"\n    before {saved}\n    after  {PatterSave.SerializeState(engine)}");
                Check("flow state: the refusals opened nothing", engine.GetFlow("g") == null, "a flow 'g' opened");
            }

            // A checkpoint refusal comes before anything changes: no values go into the game's registry for the id.
            {
                var registry = new ScopeRegistry();
                var engine = new Engine(bundle, new EngineOptions { Registry = registry });
                InT(engine);
                var state = engine.CaptureFlow("f");
                var cp = engine.Checkpoint();
                Refused("RestoreFlow inside a checkpoint, with the game's registry", () => engine.RestoreFlow("g", state), "checkpoint");
                Check("flow state: the refused restore put no values in the registry",
                    !registry.Save().Keys.Any(k => k.StartsWith("patter/flow/g/", StringComparison.Ordinal)), "values under 'g'");
                engine.Commit(cp);
            }

            if (_fails == before) Console.WriteLine("  [flow state] capture without the id, restore under another (escaped too), after a save and load, "
                + "parked values dropped, a failed restore leaves nothing, no cursor refused, refusals leave nothing");
        }
    }
}
