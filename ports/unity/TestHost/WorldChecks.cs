// Binding @world without code: the engine-free half of the Patter World component and
// PatterBundleAsset.CreateEngineWithWorld(world) (Runtime/WorldBinding.cs), which the Unity side only wraps. The store
// (case-insensitive names, the game's read-only names refusing a story write), an engine made with a world (a
// condition sees the game's value, an effect writes back), no world still self-backing, the caller's options
// left alone, the clash with HostScopes, DeclaresWorld, and the warning's sentence.

using System;
using System.Collections.Generic;
using System.Linq;
using Wildwinter.Expr;

namespace Patterkit.Patterplay.TestHost
{
    internal static partial class Program
    {
        // A snippet that plays only when @world.haskey holds, and turns @world.doorsopen up as it plays; then one
        // that always plays.
        private static Bundle WorldBundle(bool declaresWorld = true, string token = "world")
        {
            var b = new Bundle { Schema = "patter/bundle@0" };
            b.Locales.Default = "en";
            b.Locales.Included.Add("en");
            b.Strings["en"] = new Dictionary<string, string> { ["K"] = "unlocked", ["N"] = "next" };
            if (declaresWorld)
            {
                b.ScopeRegistry = new HostScopeRegistry();
                b.ScopeRegistry.Scopes.Add(new HostScopeSpec { Token = token, Declarations = new List<HostScopeDecl>
                {
                    new HostScopeDecl { Name = "haskey", Type = "boolean", Default = ExprValue.False },
                    new HostScopeDecl { Name = "doorsopen", Type = "number", Default = ExprValue.Num(0) },
                } });
            }
            var scene = new Scene { Id = "s", GameId = "s" };
            scene.Blocks.Add(new Block { Id = "b", GameId = "b", Children = new List<Node>
            {
                new Node { Id = "sk", Type = "snippet",
                    Condition = new Expression { Ast = Ast.DeserialiseAst(new List<object> { "sv", token, "haskey" }) },
                    Beats = new List<Beat> { new Beat { Id = "K", Kind = "text" } },
                    OnEnter = new List<Effect>
                    {
                        new Effect { Target = "@" + token + ".doorsopen", Value = new Expression { Ast = Ast.DeserialiseAst(
                            new List<object> { "bin", "+", new List<object> { "sv", token, "doorsopen" }, new List<object> { "n", 1.0 } }) } },
                    } },
                new Node { Id = "sn", Type = "snippet",
                    Beats = new List<Beat> { new Beat { Id = "N", Kind = "text" } },
                    Jump = new Jump { To = "END" } },
            } });
            b.Scenes["s"] = scene;
            return b;
        }

        private static void RunWorldChecks()
        {
            int before = _fails;
            void Ok(string what, bool ok, string detail = "") => Check("world: " + what, ok, detail);

            // The store: case-insensitive names, first-written spelling, host writes never refused, the game's
            // read-only names refusing a story write, and Changed telling the two apart.
            {
                var w = new WorldValues();
                var heard = new List<string>();
                w.Changed = (n, v, story) => heard.Add($"{n}={v.ToJsonString()}:{(story ? "story" : "host")}");
                w.HostSet("hasKey", ExprValue.True);
                Ok("a name reads back in another case", w.Get("haskey")?.AsBool == true);
                Ok("Has matches case-insensitively", w.Has("HASKEY"));
                w.Set("haskey", ExprValue.False);
                Ok("the story's write lands on the same name", w.Get("hasKey")?.AsBool == false);
                Ok("Names keeps the first spelling, once", string.Join(",", w.Names()) == "hasKey", string.Join(",", w.Names()));
                Ok("an unset name reads null", w.Get("gold") == null && !w.Has("gold"));

                w.SetReadOnly("Clock", true);
                Ok("IsReadOnly matches case-insensitively", w.IsReadOnly("clock"));
                w.HostSet("clock", ExprValue.Str("day"));
                Ok("the host's write to a read-only name lands", w.Get("clock")?.AsString == "day");
                string message = null;
                try { w.Set("clock", ExprValue.Str("night")); } catch (EvalError e) { message = e.Message; }
                Ok("a story write to a read-only name is refused", message == "@world.clock is the game's alone: a story tried to set it", message ?? "no error");
                Ok("the refused write didn't land", w.Get("clock")?.AsString == "day");
                w.SetReadOnly("clock", false);
                w.Set("clock", ExprValue.Str("night"));
                Ok("a name made writable again takes the story's write", w.Get("clock")?.AsString == "night");
                Ok("Changed told host writes from story writes",
                    string.Join(" ", heard) == "hasKey=true:host haskey=false:story clock=\"day\":host clock=\"night\":story", string.Join(" ", heard));
            }

            // An engine made with a world: a condition on @world sees the game's value, and an effect writes back
            // into the game's store (as the story's write). A read-only name refuses the effect, reported, and the
            // story plays on.
            {
                var bundle = WorldBundle();
                foreach (var readOnly in new[] { false, true })
                {
                    var w = new WorldValues();
                    w.HostSet("hasKey", ExprValue.True);
                    w.HostSet("doorsOpen", ExprValue.Num(2));
                    if (readOnly) w.SetReadOnly("doorsOpen", true);
                    var errors = new List<PlayError>();
                    var engine = new Engine(bundle, WorldBinding.WithWorld(new EngineOptions { OnError = errors.Add }, w));
                    var step = engine.OpenFlow("main", "s", "b").Advance();
                    var label = readOnly ? " (read-only)" : "";
                    Ok("a condition on @world sees the game's value" + label, step.Type == StepType.Text && step.Text == "unlocked", step.Text);
                    if (!readOnly)
                    {
                        Ok("an effect wrote back into the game's world", w.Get("doorsopen")?.AsNumber == 3, $"{w.Get("doorsopen")}");
                        Ok("nothing was reported", errors.Count == 0, string.Join(" | ", errors));
                    }
                    else
                    {
                        Ok("the refused effect didn't land", w.Get("doorsopen")?.AsNumber == 2, $"{w.Get("doorsopen")}");
                        Ok("the refused effect was reported once", errors.Count == 1 && errors[0].Kind == "effect"
                            && errors[0].Message.Contains("is the game's alone"), string.Join(" | ", errors));
                    }
                    Ok("the engine reads @world through the game's world" + label, engine.GetProperty("@world.haskey")?.AsBool == true);
                    w.HostSet("hasKey", ExprValue.False);
                    Ok("the game's later write is what the engine reads" + label, engine.GetProperty("@world.haskey")?.AsBool == false);
                }
            }

            // No world binds nothing: the caller's options come back as they were, and the engine self-backs
            // @world from the declared defaults (so the condition fails and the snippet is skipped).
            {
                var bundle = WorldBundle();
                var options = new EngineOptions();
                Ok("no world gives back the caller's options", ReferenceEquals(WorldBinding.WithWorld(options, null), options));
                Ok("no world and no options stays null", WorldBinding.WithWorld(null, null) == null);
                var engine = new Engine(bundle, WorldBinding.WithWorld(null, null));
                var step = engine.OpenFlow("main", "s", "b").Advance();
                Ok("with no world, @world plays its declared defaults", step.Text == "next", step.Text);
                Ok("with no world, @world is self-backed", engine.GetProperty("@world.doorsopen")?.AsNumber == 0);
            }

            // The caller's options are copied, never changed, and their other bindings come along.
            {
                var other = new RecordingScope();
                var scopes = new Dictionary<string, IHostScope> { ["weather"] = other };
                var options = new EngineOptions { HostScopes = scopes, Locale = "en", Log = true };
                var w = new WorldValues();
                var made = WorldBinding.WithWorld(options, w);
                Ok("the options are a copy", !ReferenceEquals(made, options) && !ReferenceEquals(made.HostScopes, scopes));
                Ok("the caller's HostScopes are unchanged", scopes.Count == 1 && !scopes.ContainsKey("world"));
                Ok("the copy binds the world beside the others", made.HostScopes.Count == 2
                    && ReferenceEquals(made.HostScopes["world"], w) && ReferenceEquals(made.HostScopes["weather"], other));
                Ok("the copy keeps the other options", made.Locale == "en" && made.Log);
                var none = WorldBinding.WithWorld(null, w);
                Ok("no options and a world binds just the world", none.HostScopes.Count == 1 && ReferenceEquals(none.HostScopes["world"], w));
            }

            // A world given twice is refused, not quietly picked; a differently spelt token isn't "world", so it isn't a clash.
            {
                var w = new WorldValues();
                string message = null;
                try { WorldBinding.WithWorld(new EngineOptions { HostScopes = new Dictionary<string, IHostScope> { ["world"] = new RecordingScope() } }, w); }
                catch (ArgumentException e) { message = e.Message; }
                Ok("a world given beside a HostScopes \"world\" throws", message != null && message.Contains("already binds \"world\""), message ?? "no error");
                var cased = WorldBinding.WithWorld(new EngineOptions { HostScopes = new Dictionary<string, IHostScope> { ["World"] = new RecordingScope() } }, w);
                Ok("a \"World\" binding is another token, so no clash", cased.HostScopes.Count == 2);
                var nulled = WorldBinding.WithWorld(new EngineOptions { HostScopes = new Dictionary<string, IHostScope> { ["world"] = null } }, w);
                Ok("a null \"world\" binding binds nothing, so no clash", ReferenceEquals(nulled.HostScopes["world"], w));
            }

            // DeclaresWorld: the bundle's scope registry declares the token "world", case-sensitively.
            Ok("a bundle declaring @world declares it", WorldBinding.Declares(WorldBundle()));
            Ok("a bundle with no scope registry doesn't", !WorldBinding.Declares(WorldBundle(declaresWorld: false)));
            Ok("a bundle declaring @World doesn't", !WorldBinding.Declares(WorldBundle(token: "World")));
            Ok("no bundle doesn't", !WorldBinding.Declares(null));

            // The warning, the same sentence on every engine.
            Ok("the warning's sentence", WorldBinding.UnboundWarning("Patter Runner 'Bar'") ==
                "Patter Runner 'Bar': the story reads @world, but no World is set, so @world plays from its declared defaults and won't see your game. Set World to your game's Patter World.");

            if (_fails == before) Console.WriteLine("  [world] the World store, an engine made with a world, no world self-backs, options copied, the clash, DeclaresWorld, the warning");
        }
    }
}
