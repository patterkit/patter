// The runtime foundations before 1.0 (the hands-on review, 2026-10), where this port has more to say than the
// conformance corpus can carry: how a set-up report reaches the game and the decision log, a host write's exact
// message and an @scene write on a flow, a refusal inside a checkpoint, and the copies the static reads hand out
// (gameData, tags, the bundle's locales). Mirrors the JS runtime's runtime-foundations.test.ts; the corpus pins
// the rest on every runtime.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Wildwinter.Expr;

namespace Patterkit.Patterplay.TestHost
{
    internal static partial class Program
    {
        private const string FoundationsBundleJson = @"{""schema"":""patter/bundle@0"",""voiced"":false,
""locales"":{""default"":""en"",""included"":[""en""]},
""scopeRegistry"":{""version"":1,""scopes"":[{""token"":""world"",""declarations"":[{""name"":""alarm"",""type"":""boolean"",""default"":false}]}]},
""scenes"":{""s"":{""id"":""s"",""type"":""scene"",""name"":""S"",""gameId"":""s"",""gameData"":{""music"":""jig"",""moods"":[""calm""]},
""sceneProps"":[{""name"":""knocks"",""type"":""number"",""default"":0}],
""tags"":[""night""],
""blocks"":[{""id"":""b"",""type"":""block"",""name"":""B"",""gameId"":""b"",""children"":[
{""id"":""g"",""type"":""group"",""selector"":""choice"",""children"":[
{""id"":""o"",""type"":""group"",""gameData"":{""tags"":[""a""]},""prompt"":{""id"":""P"",""kind"":""text""},""children"":[
{""id"":""n"",""type"":""snippet"",""beats"":[{""id"":""T"",""kind"":""text"",""gameData"":{""cam"":""wide"",""marks"":[""x""]}}],""jump"":{""to"":""END""}}]}]}]}]}},
""strings"":{""en"":{""P"":""Knock"",""T"":""knocks {@scene.knocks}""}}}";

        private sealed class NoScope : IHostScope
        {
            public ExprValue Get(string name) => null;
            public void Set(string name, ExprValue value) { }
        }

        private static void RunFoundationsChecks()
        {
            void Ok(string what, bool ok) => Check(what, ok, "");
            int before = _fails;
            Bundle bundle;
            using (var doc = JsonDocument.Parse(FoundationsBundleJson)) bundle = ParseBundle(doc.RootElement);
            string Refusal(Action call) { try { call(); return null; } catch (Exception e) { return e.Message; } }
            // Careless code reaching through the read-only flags list a value hands out.
            void Deface(ExprValue v) { if (v != null && v.AsFlags is List<string> l) l.Add("scribbled"); }
            string Flags(ExprValue v) => v == null ? "null" : string.Join(",", v.AsFlags);

            // Set-up reports reach OnError as the constructor ends, in the order found, and the log with flow "".
            {
                var errors = new List<PlayError>();
                var engine = new Engine(bundle, new EngineOptions
                {
                    Locale = "EN", HostScopes = new Dictionary<string, IHostScope> { ["World"] = new NoScope() },
                    Log = true, OnError = errors.Add,
                });
                Check("foundations: set-up reports in order",
                    string.Join(" ", errors.Select(e => $"{e.Kind}/{e.Node}/{e.Flow}")) == "setup/EN/ setup/World/",
                    string.Join(" ", errors.Select(e => $"{e.Kind}/{e.Node}/{e.Flow}")));
                Check("foundations: a case-only near miss names the declared token",
                    errors.Count == 2 && errors[1].Message.Contains("it declares \"world\""), errors.Count == 2 ? errors[1].Message : "");
                Check("foundations: set-up reports in the decision log, with flow \"\"",
                    string.Join(" ", engine.Log().Select(e => $"{e.Type}/{e.Flow}/{e.Node}")) == "diagnostic//EN diagnostic//World",
                    string.Join(" ", engine.Log().Select(e => $"{e.Type}/{e.Flow}/{e.Node}")));
            }
            {
                var errors = new List<PlayError>();
                new Engine(bundle, new EngineOptions { HostScopes = new Dictionary<string, IHostScope> { ["weather"] = new NoScope() }, OnError = errors.Add });
                Check("foundations: an undeclared token is named plainly",
                    errors.Count == 1 && errors[0].Message == "HostScopes binds \"weather\", which this bundle doesn't declare",
                    errors.Count == 1 ? errors[0].Message : $"{errors.Count} reports");
            }
            {
                var nodes = new List<string>();
                var engine = new Engine(bundle, new EngineOptions { Locale = "en-GB", OnError = e => nodes.Add(e.Node) });
                engine.HotSwap(bundle);
                Check("foundations: a hot swap reports the locale again", string.Join(" ", nodes) == "en-GB en-GB", string.Join(" ", nodes));
            }
            // Made once by a hot swap whose load is refused, not again by the engine it falls back on. The new
            // bundle names another engine's scope that nothing registered, so the replacement's load is refused.
            {
                Bundle refusing;
                using (var doc = JsonDocument.Parse(FoundationsBundleJson)) refusing = ParseBundle(doc.RootElement);
                refusing.ExternalScopes = new List<string> { "quest" };
                var nodes = new List<string>();
                var engine = new Engine(bundle, new EngineOptions { Locale = "en-GB", OnError = e => { if (e.Kind == "setup") nodes.Add(e.Node); } });
                engine.OpenFlow("f", "s");
                var fallback = engine.HotSwap(refusing);
                Check("foundations: a refused-load hot swap reports the locale once", string.Join(" ", nodes) == "en-GB en-GB", string.Join(" ", nodes));
                nodes.Clear();
                fallback.HotSwap(bundle);
                Check("foundations: the fallback's own hot swap reports again", string.Join(" ", nodes) == "en-GB", string.Join(" ", nodes));
            }

            // A start the bundle doesn't have (a hand-edited bundle) is passed over.
            {
                Bundle Starting(string scene, string block)
                {
                    Bundle b;
                    using (var doc = JsonDocument.Parse(FoundationsBundleJson)) b = ParseBundle(doc.RootElement);
                    b.Start = new BundleStart { Scene = scene, Block = block };
                    return b;
                }
                string Opens(Bundle b)
                {
                    try
                    {
                        var flow = new Engine(b).OpenFlow("f");
                        flow.Advance();
                        return flow.GetChoices().Count == 1 ? "choice" : "no choice";
                    }
                    catch (Exception e) { return e.Message; }
                }
                string gone = Opens(Starting("gone", null));
                Check("foundations: a start scene the bundle doesn't have starts at the first scene", gone == "choice", gone);
                string blockGone = Opens(Starting("s", "gone"));
                Check("foundations: a start block the scene doesn't have starts at its first block", blockGone == "choice", blockGone);
            }

            // A host write on a flow is held to the @scene declaration of the scene the flow is in.
            {
                var flow = new Engine(bundle).OpenFlow("f", "s");
                Check("foundations: @scene write of the wrong type",
                    Refusal(() => flow.SetProperty("@scene.knocks", ExprValue.Str("two"))) == "\"@scene.knocks\" takes a number; \"two\" doesn't fit",
                    Refusal(() => flow.SetProperty("@scene.knocks", ExprValue.Str("two"))) ?? "not refused");
                Check("foundations: @scene write of an undeclared name",
                    Refusal(() => flow.SetProperty("@scene.door", ExprValue.Num(1))) == "no property at \"@scene.door\": the content declares no @scene.door",
                    Refusal(() => flow.SetProperty("@scene.door", ExprValue.Num(1))) ?? "not refused");
                Check("foundations: @world write of the wrong type",
                    Refusal(() => flow.SetProperty("@world.alarm", ExprValue.Str("yes"))) == "\"@world.alarm\" takes true or false; \"yes\" doesn't fit",
                    Refusal(() => flow.SetProperty("@world.alarm", ExprValue.Str("yes"))) ?? "not refused");
                flow.SetProperty("@scene.knocks", ExprValue.Num(2));
                Ok("foundations: a fitting @scene write lands", flow.GetProperty("@scene.knocks")?.AsNumber == 2);
            }
            // Refused before a checkpoint records anything, so a rollback has nothing of it to undo.
            {
                var engine = new Engine(bundle);
                engine.OpenFlow("f", "s");
                var cp = engine.Checkpoint();
                Ok("foundations: a refusal inside a checkpoint", Refusal(() => engine.SetProperty("@world.alarm", ExprValue.Num(1))) != null);
                engine.SetProperty("@world.alarm", ExprValue.True);
                engine.Rollback(cp);
                Ok("foundations: the rollback puts the write back", engine.GetProperty("@world.alarm")?.AsBool == false);
            }

            // gameData handed out is the game's own copy: the outline, the beat sequence, a scene's, flags included.
            {
                var engine = new Engine(bundle);
                var outline = engine.GetOutline();
                Deface(outline[0].GameData["moods"]);
                outline[0].GameData["music"] = ExprValue.Str("scribbled");
                var flat = engine.GetBeatSequence().First(f => f.Beat.Id == "T");
                Deface(flat.Beat.GameData["marks"]);
                var sceneData = engine.GameDataForScene("s");
                Deface(sceneData["moods"]);
                Ok("foundations: a scene's gameData is a copy", Flags(engine.GameDataForScene("s")["moods"]) == "calm"
                    && engine.GameDataForScene("s")["music"].AsString == "jig");
                Ok("foundations: the beat sequence's gameData is a copy",
                    Flags(engine.GetBeatSequence().First(f => f.Beat.Id == "T").Beat.GameData["marks"]) == "x");
                Ok("foundations: the outline's gameData is a copy", Flags(new Engine(bundle).GetOutline()[0].GameData["moods"]) == "calm"
                    && new Engine(bundle).GetOutline()[0].GameData["music"].AsString == "jig");
                // And so is a saved pending choice's.
                engine.OpenFlow("f", "s").Advance();
                var saved = engine.SaveGame().Flows["f"].PendingOptions[0].GameData;
                Deface(saved["tags"]);
                saved["tags"] = ExprValue.Str("scribbled");
                Ok("foundations: a saved pending choice's gameData is a copy",
                    Flags(engine.GetFlow("f").GetChoices()[0].GameData["tags"]) == "a");
                // Tags and the bundle's locales too.
                engine.TagsForBeat("T").Add("scribbled");
                engine.TagsForScene("s").Add("scribbled");
                Check("foundations: tags are copies", string.Join(",", engine.TagsForBeat("T")) == "night"
                    && string.Join(",", engine.TagsForScene("s")) == "night", string.Join(",", engine.TagsForBeat("T")));
                engine.Locales.Included.Add("xx");
                Ok("foundations: the bundle's locales are a copy", string.Join(",", engine.Locales.Included) == "en"
                    && engine.Locales.Default == "en" && engine.Locale == "en");
            }

            if (_fails == before) Console.WriteLine("  [foundations] set-up reports, host-write refusals, and the copies handed out");
        }
    }
}
