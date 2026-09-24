// One registry per game (patterkit design/one-registry-handover.md), from the GAME's side.
//
// Ports of the JS reference's packages/runtime/test/one-registry.test.ts and combined-game.test.ts,
// plus the two hand-written version 2 cases in save-envelope-shape.test.ts. The engine registers every
// property bag it has in the game's ScopeRegistry: @patter under `patter`, and its per-flow and
// per-scene bags under keys that start `patter/`. SaveGame keeps only what is not a property, unless
// the engine made its own registry (a standalone game), when the registry's values ride along. These
// checks hold this runtime to that: what is in the registry, what the game saves, and that loading
// works in either order. Not corpus cases: the corpus script grammar has no registry of the game's.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;

namespace Patterkit.Patterplay.TestHost
{
    internal static partial class Program
    {
        private static int _registryChecks;

        private static void RegistryCheck(string what, bool ok, string detail = "")
        {
            _registryChecks++;
            if (!ok) Fail("one-registry", what, detail);
        }

        /// <summary>One group of checks. A throw is a failure of that group, reported, and the next group
        /// still runs: an engine that throws where it should not must not hide what else is wrong.</summary>
        private static void Case(string what, Action body)
        {
            try { body(); }
            catch (Exception ex) { RegistryCheck(what, false, $"threw {ex.GetType().Name}: {ex.Message}"); }
        }

        private static List<object> A(params object[] parts) => parts.ToList();
        private static Expression Ex(List<object> ast) => new Expression { Ast = Ast.DeserialiseAst(ast) };
        private static Effect Add(string target, string scope, string name, double by) => new Effect
        {
            Target = target,
            Value = Ex(A("bin", "+", A("sv", scope, name), A("n", by))),
        };

        private static readonly List<ScopeDeclaration> WorldDecls = new List<ScopeDeclaration>
        {
            new ScopeDeclaration { Name = "gold", Type = "number", Default = PatterValue.Num(0) },
        };

        /// <summary>The JS test's bundle: shared `fame` and per-flow `mood`; a scene with per-flow `count`
        /// and shared `tally`; @world declared with `gold`. One snippet whose exit bumps all five.</summary>
        private static Bundle OneRegistryBundle()
        {
            var b = new Bundle { Schema = "patter/bundle@0" };
            b.Locales.Default = "en";
            b.Locales.Included.Add("en");
            b.Strings["en"] = new Dictionary<string, string> { ["L"] = "gold {@world.gold}" };
            b.Properties.Add(new PropertyDecl { Name = "fame", Type = "number", Default = PatterValue.Num(0), Shared = true });
            b.Properties.Add(new PropertyDecl { Name = "mood", Type = "number", Default = PatterValue.Num(0), Shared = false });
            b.ScopeRegistry = new HostScopeRegistry();
            b.ScopeRegistry.Scopes.Add(new HostScopeSpec { Token = "world", Declarations = new List<HostScopeDecl>
            {
                new HostScopeDecl { Name = "gold", Type = "number", Default = PatterValue.Num(0) },
            } });
            var scene = new Scene { Id = "s", GameId = "s", Name = "S" };
            scene.SceneProps.Add(new PropertyDecl { Name = "count", Type = "number", Default = PatterValue.Num(0) });
            scene.SceneProps.Add(new PropertyDecl { Name = "tally", Type = "number", Default = PatterValue.Num(0), Shared = true });
            scene.Blocks.Add(new Block { Id = "b", GameId = "b", Name = "B", Children = new List<Node>
            {
                new Node { Id = "sn", Type = "snippet",
                    Beats = new List<Beat> { new Beat { Id = "L", Kind = "text" } },
                    OnExit = new List<Effect>
                    {
                        Add("@fame", "patter", "fame", 1),
                        Add("@mood", "patter", "mood", 2),
                        Add("@scene.count", "scene", "count", 1),
                        Add("@scene.tally", "scene", "tally", 1),
                        Add("@world.gold", "world", "gold", 5),
                    },
                    Jump = new Jump { To = "END" } },
            } });
            b.Scenes["s"] = scene;
            return b;
        }

        private static void PlayOut(Flow flow)
        {
            for (int i = 0; i < 10 && flow.Advance().Type != StepType.End; i++) { }
        }

        /// <summary>A game that owns its registry and registers @world itself, as a property the registry stores.</summary>
        private static (ScopeRegistry registry, Engine patter) Game(Bundle bundle)
        {
            var registry = new ScopeRegistry().DefineOwned("world", WorldDecls, new OwnedScopeOptions { Owner = "Game" });
            return (registry, new Engine(bundle, new EngineOptions { Registry = registry, Seed = 1 }));
        }

        /// <summary>A registry save as sorted text: `key{name=value,...}` per section, keys and names sorted.</summary>
        private static string Dump(OrderedMap<string, OrderedMap<string, PatterValue>> blob)
        {
            if (blob == null) return "null";
            return string.Join(" ", blob.OrderBy(kv => kv.Key, StringComparer.Ordinal).Select(kv =>
                kv.Key + "{" + string.Join(",", kv.Value.OrderBy(v => v.Key, StringComparer.Ordinal)
                    .Select(v => v.Key + "=" + v.Value.ToJsonString())) + "}"));
        }

        private static double Num(PatterValue v) => v != null && v.IsNumber ? v.AsNumber : double.NaN;

        private static string Throws(Action act)
        {
            try { act(); return null; } catch (Exception ex) { return ex.Message; }
        }

        /// <summary>A save through this package's own JSON boundary, as a game stores it.</summary>
        private static string Stored(Engine engine) => PatterSave.SerializeState(engine);

        private static void RunOneRegistryChecks()
        {
            var bundle = OneRegistryBundle();

            Case("Registers every bag in the game's registry, under Patter's keys and owner label", () =>
            {
                var (registry, patter) = Game(bundle);
                PlayOut(patter.OpenFlow("f", "s"));
                RegistryCheck("keys", Dump(registry.Save()) ==
                    "patter{fame=1} patter/flow/f/patter{mood=2} patter/flow/f/scene/s{count=1} patter/scene/s{tally=1} world{gold=5}",
                    Dump(registry.Save()));
                // Examiner rows keep the story's addresses; the scope column says which bag, the owner whose.
                var rows = registry.ListProperties().Where(r => r.Owner == "Patter")
                    .Select(r => $"{r.Scope}|{r.Path}|{r.Value.ToJsonString()}").ToList();
                RegistryCheck("owner label and rows", rows.SequenceEqual(new[]
                {
                    "patter|@patter.fame|1", "patter/flow/f/patter|@patter.mood|2",
                    "patter/flow/f/scene/s|@scene.count|1", "patter/scene/s|@scene.tally|1",
                }), string.Join("; ", rows));
            });

            Case("Leaves the values out of SaveGame when the game passed the registry", () =>
            {
                var (_, patter) = Game(bundle);
                PlayOut(patter.OpenFlow("f", "s"));
                RegistryCheck("no registry in a game's engine save", patter.SaveGame().Registry == null);
                using var doc = JsonDocument.Parse(Stored(patter));
                var save = doc.RootElement.GetProperty("save");
                var flowKeys = save.GetProperty("flows").GetProperty("f").EnumerateObject().Select(p => p.Name).OrderBy(k => k, StringComparer.Ordinal);
                RegistryCheck("a flow's save holds no properties", !save.TryGetProperty("registry", out _)
                    && flowKeys.SequenceEqual(new[] { "cursor", "rngState", "visits" }), save.ToString());
            });

            Case("Uses a @world the game registered, and self-backs nothing", () =>
            {
                var (registry, patter) = Game(bundle);
                RegistryCheck("the game's @world is the game's", registry.ListProperties().First(r => r.Scope == "world").Owner == "Game");
                PlayOut(patter.OpenFlow("f", "s"));
                RegistryCheck("the story writes the game's @world", Num(registry.Get("world", "gold")) == 5);
            });

            Case("Does not self-back a declared host scope in the game's registry: that token is the game's", () =>
            {
                var registry = new ScopeRegistry();
                new Engine(bundle, new EngineOptions { Registry = registry });
                RegistryCheck("given a registry, nothing is self-backed", registry.Has("patter") && !registry.Has("world"));
            });

            Case("A standalone engine self-backs @world as a stored property, and saves it", () =>
            {
                var patter = new Engine(bundle, new EngineOptions { Seed = 1 });
                PlayOut(patter.OpenFlow("f", "s"));
                var stored = Stored(patter);
                using (var doc = JsonDocument.Parse(stored))
                {
                    var world = doc.RootElement.GetProperty("save").GetProperty("registry").GetProperty("world");
                    RegistryCheck("a standalone save carries @world", world.GetProperty("gold").GetDouble() == 5, stored);
                }
                var restored = new Engine(bundle, new EngineOptions { Seed = 1 });
                PatterSave.DeserializeState(restored, stored);
                RegistryCheck("a standalone load restores @world", Num(restored.GetProperty("@world.gold")) == 5);
            });

            // One save for the game, loaded in either order.
            // One save for the game, through this package's own JSON helpers, as a game stores it: the
            // registry's values once, and the engine's part.
            (string registry, string patter) Session1()
            {
                var g = Game(bundle);
                PlayOut(g.patter.OpenFlow("f", "s"));
                g.patter.OpenFlow("g", "s"); // a second flow, still at its first beat
                return (PatterSave.SaveRegistry(g.registry).ToString(), Stored(g.patter));
            }
            void CheckResumed(string order, (ScopeRegistry registry, Engine patter) g)
            {
                bool ok = Num(g.patter.GetProperty("@fame")) == 1
                    && Num(g.patter.GetProperty("@world.gold")) == 5
                    && Num(g.patter.GetFlow("f").GetProperty("@mood")) == 2
                    && Num(g.patter.GetFlow("f").GetProperty("@scene.count")) == 1
                    && Num(g.patter.GetFlow("g").GetProperty("@scene.count")) == 0
                    && Num(g.patter.GetFlow("g").GetProperty("@scene.tally")) == 1;
                RegistryCheck($"{order}: the saved values are back", ok, Dump(g.registry.Save()));
                // Play on: g's exit lands on the restored shared values.
                PlayOut(g.patter.GetFlow("g"));
                RegistryCheck($"{order}: play continues on them",
                    Num(g.patter.GetProperty("@fame")) == 2 && Num(g.registry.Get("patter/scene/s", "tally")) == 2, Dump(g.registry.Save()));
            }
            Case("one save, registry first", () =>
            {
                var save = Session1();
                var g = Game(bundle);
                PatterSave.LoadRegistry(g.registry, Newtonsoft.Json.Linq.JObject.Parse(save.registry));
                PatterSave.DeserializeState(g.patter, save.patter);
                CheckResumed("registry first", g);
            });
            Case("one save, engine first", () =>
            {
                var save = Session1();
                var g = Game(bundle);
                PatterSave.DeserializeState(g.patter, save.patter);
                PatterSave.LoadRegistry(g.registry, Newtonsoft.Json.Linq.JObject.Parse(save.registry));
                CheckResumed("engine first", g);
            });
            Case("one save, into a game already playing", () =>
            {
                var save = Session1();
                var g = Game(bundle);
                PlayOut(g.patter.OpenFlow("f", "s"));
                PlayOut(g.patter.OpenFlow("stray", "s")); // not in the save: its bags must not survive
                PatterSave.LoadRegistry(g.registry, Newtonsoft.Json.Linq.JObject.Parse(save.registry));
                PatterSave.DeserializeState(g.patter, save.patter);
                CheckResumed("into a game already playing", g);
                RegistryCheck("a flow the save does not have leaves nothing behind",
                    !g.registry.Save().Keys.Any(k => k.Contains("stray")), Dump(g.registry.Save()));
            });

            Case("The Unity guide's registry example (website play/unity.md), as written", () =>
            {
                var registry = new ScopeRegistry().DefineOwned("world", new[]
                {
                    new ScopeDeclaration { Name = "gold", Type = "number", Default = PatterValue.Num(0) },
                }, new OwnedScopeOptions { Owner = "Game" });                      // @world, stored and saved
                var patter = new Engine(bundle, new EngineOptions { Registry = registry });
                PlayOut(patter.OpenFlow("f", "s"));

                var save = new Newtonsoft.Json.Linq.JObject
                {
                    ["registry"] = PatterSave.SaveRegistry(registry),
                    ["patter"] = PatterSave.Envelope(patter.SaveGame()),
                };
                var text = save.ToString();

                var registry2 = new ScopeRegistry().DefineOwned("world", new[]
                {
                    new ScopeDeclaration { Name = "gold", Type = "number", Default = PatterValue.Num(0) },
                }, new OwnedScopeOptions { Owner = "Game" });
                var patter2 = new Engine(bundle, new EngineOptions { Registry = registry2 });
                var loaded = Newtonsoft.Json.Linq.JObject.Parse(text);
                PatterSave.LoadRegistry(registry2, (Newtonsoft.Json.Linq.JObject)loaded["registry"]);
                PatterSave.DeserializeState(patter2, loaded["patter"].ToString());
                RegistryCheck("guide example: the game's one save restores both parts",
                    Num(patter2.GetProperty("@world.gold")) == 5 && Num(patter2.GetProperty("@fame")) == 1
                    && Num(patter2.GetFlow("f").GetProperty("@scene.count")) == 1, text);
            });

            Case("Reads a scope another engine registered after the flow opened", () =>
            {
                var withStory = OneRegistryBundle();
                withStory.ScopeRegistry = new HostScopeRegistry();
                withStory.ScopeRegistry.Scopes.Add(new HostScopeSpec { Token = "story", Declarations = new List<HostScopeDecl>
                {
                    new HostScopeDecl { Name = "act", Type = "number" },
                } });
                withStory.Strings["en"] = new Dictionary<string, string> { ["I"] = "intro", ["L"] = "act two" };
                withStory.Scenes["s"].Blocks[0].Children = new List<Node>
                {
                    // Evaluated first, so the flow has built its evaluation context before @story exists.
                    new Node { Id = "intro", Type = "snippet", Condition = Ex(A("bin", ">=", A("sv", "patter", "fame"), A("n", 0.0))),
                        Beats = new List<Beat> { new Beat { Id = "I", Kind = "text" } } },
                    new Node { Id = "yes", Type = "snippet", Condition = Ex(A("bin", ">=", A("sv", "story", "act"), A("n", 2.0))),
                        Beats = new List<Beat> { new Beat { Id = "L", Kind = "text" } }, Jump = new Jump { To = "END" } },
                };
                var registry = new ScopeRegistry();
                var patter = new Engine(withStory, new EngineOptions { Registry = registry });
                var flow = patter.OpenFlow("f", "s");
                var first = flow.Advance();
                RegistryCheck("late scope: intro", first.Type == StepType.Text && first.Text == "intro", first.Text);
                registry.DefineOwned("story", new[] { new ScopeDeclaration { Name = "act", Type = "number", Default = PatterValue.Num(2) } },
                    new OwnedScopeOptions { Owner = "Other engine" });
                var second = flow.Advance();
                RegistryCheck("late scope: a scope registered after the flow opened is read", second.Type == StepType.Text && second.Text == "act two",
                    $"{second.Type} {second.Text}");
            });

            Case("Refuses a token another engine holds, naming it, and leaves the registry as it was", () =>
            {
                var registry = new ScopeRegistry();
                new Engine(bundle, new EngineOptions { Registry = registry });
                var msg = Throws(() => new Engine(bundle, new EngineOptions { Registry = registry }));
                RegistryCheck("clash names the holder", msg != null && msg.Contains("scope '@patter' is already registered by Patter"), msg ?? "no error");

                var withWorld = new ScopeRegistry().DefineOwned("world", new List<ScopeDeclaration>(), new OwnedScopeOptions { Owner = "Game" });
                msg = Throws(() => new Engine(bundle, new EngineOptions
                {
                    Registry = withWorld,
                    HostScopes = new Dictionary<string, IHostScope> { ["world"] = new RecordingScope() },
                }));
                RegistryCheck("a binding clashing with the game's @world names the game",
                    msg != null && msg.Contains("scope '@world' is already registered by Game"), msg ?? "no error");
                RegistryCheck("the half-built engine took nothing with it", !withWorld.Has("patter"));
            });

            Case("Escapes a flow id in its keys, so no two flows' keys can meet", () =>
            {
                var (registry, patter) = Game(bundle);
                patter.OpenFlow("npc/bob", "s");
                patter.OpenFlow("npc%2Fbob", "s");
                var keys = registry.Save().Keys.Where(k => k.StartsWith("patter/flow/", StringComparison.Ordinal)).OrderBy(k => k, StringComparer.Ordinal);
                RegistryCheck("escaped flow ids", keys.SequenceEqual(new[]
                {
                    "patter/flow/npc%252Fbob/patter", "patter/flow/npc%252Fbob/scene/s",
                    "patter/flow/npc%2Fbob/patter", "patter/flow/npc%2Fbob/scene/s",
                }), string.Join(", ", keys));
            });

            Case("Removes a flow's bags when it closes, and reopening a name starts it fresh", () =>
            {
                var (registry, patter) = Game(bundle);
                PlayOut(patter.OpenFlow("f", "s"));
                patter.CloseFlow("f");
                RegistryCheck("a closed flow's bags go", !registry.Save().Keys.Any(k => k.StartsWith("patter/flow/f/", StringComparison.Ordinal)),
                    Dump(registry.Save()));
                // Values a load left waiting for "f" belong to the saved flow, not to a new one of the same name.
                var blob = registry.Save();
                blob.Set("patter/flow/f/scene/s", new OrderedMap<string, PatterValue>());
                blob["patter/flow/f/scene/s"].Set("count", PatterValue.Num(9));
                registry.Load(blob);
                var fresh = patter.OpenFlow("f", "s");
                RegistryCheck("a fresh flow does not claim a loaded flow's values", Num(fresh.GetProperty("@scene.count")) == 0,
                    fresh.GetProperty("@scene.count")?.ToJsonString());
            });

            Case("Reset drops Patter's waiting values and no other engine's", () =>
            {
                var (registry, patter) = Game(bundle);
                var blob = registry.Save();
                var elsewhere = new OrderedMap<string, PatterValue>(); elsewhere.Set("tally", PatterValue.Num(3));
                var inn = new OrderedMap<string, PatterValue>(); inn.Set("drawn", PatterValue.Num(1));
                blob.Set("patter/scene/elsewhere", elsewhere);
                blob.Set("other/deck/inn", inn);
                registry.Load(blob);
                patter.Reset();
                var saved = registry.Save();
                RegistryCheck("reset drops Patter's waiting values", !saved.ContainsKey("patter/scene/elsewhere"), Dump(saved));
                RegistryCheck("reset keeps another engine's", saved.ContainsKey("other/deck/inn") && Num(saved["other/deck/inn"].GetOrDefault("drawn")) == 1, Dump(saved));
            });

            Case("HotSwap hands every bag to the replacement on the same registry", () =>
            {
                var (registry, patter) = Game(bundle);
                var flow = patter.OpenFlow("f", "s");
                PlayOut(flow);
                var next = patter.HotSwap(bundle);
                RegistryCheck("hotSwap: the old engine is spent", flow.IsClosed);
                RegistryCheck("hotSwap: the bags are handed over",
                    Num(next.GetProperty("@fame")) == 1
                    && Num(next.GetFlow("f").GetProperty("@mood")) == 2
                    && Num(next.GetFlow("f").GetProperty("@scene.tally")) == 1, Dump(registry.Save()));
                RegistryCheck("hotSwap: one @patter in the registry", registry.ListProperties().Count(r => r.Scope == "patter") == 1);
                RegistryCheck("hotSwap: still the game's registry to save", next.SaveGame().Registry == null);
            });

            Case("A standalone engine's hotSwap keeps its self-backed @world and keeps saving it", () =>
            {
                var patter = new Engine(bundle, new EngineOptions { Seed = 1 });
                PlayOut(patter.OpenFlow("f", "s"));
                var next = patter.HotSwap(bundle);
                RegistryCheck("standalone hotSwap keeps @world", Num(next.GetProperty("@world.gold")) == 5);
                var reg = next.SaveGame().Registry;
                RegistryCheck("standalone hotSwap keeps saving @world", reg != null && reg.ContainsKey("world") && Num(reg["world"].GetOrDefault("gold")) == 5, Dump(reg));
            });

            RunOldShapeChecks();
            RunCombinedGameChecks();
            Console.WriteLine($"  [one-registry] the game's registry, from the game's side: {_registryChecks} checks");
        }

        /// <summary>The save-envelope cases the corpus cannot write: a version 3 save and a version 2 save,
        /// each written out BY HAND (so a change that alters the writer and the reader together cannot
        /// satisfy them), and a version 2 save moved into a registry the game supplied.</summary>
        private static void RunOldShapeChecks()
        {
            var b = new Bundle { Schema = "patter/bundle@0" };
            b.Locales.Default = "en";
            b.Locales.Included.Add("en");
            b.Strings["en"] = new Dictionary<string, string> { ["T"] = "hi" };
            b.Properties.Add(new PropertyDecl { Name = "gold", Type = "number", Default = PatterValue.Num(0) });
            var scene = new Scene { Id = "s", GameId = "s", Name = "S" };
            scene.SceneProps.Add(new PropertyDecl { Name = "count", Type = "number", Default = PatterValue.Num(0) });
            scene.SceneProps.Add(new PropertyDecl { Name = "tally", Type = "number", Default = PatterValue.Num(0), Shared = true });
            scene.Blocks.Add(new Block { Id = "b", GameId = "b", Name = "B", Children = new List<Node>
            {
                new Node { Id = "sn", Type = "snippet", Beats = new List<Beat> { new Beat { Id = "T", Kind = "text" } }, Jump = new Jump { To = "END" } },
            } });
            b.Scenes["s"] = scene;

            const string cursor = "\"cursor\":{\"flowEnded\":true,\"currentSceneId\":\"s\",\"stack\":[],\"activeSnippetId\":null,"
                + "\"beatIndex\":0,\"pendingChoice\":null,\"pendingPromptOwnerId\":null,\"selectors\":{}}";
            const string expectedRegistry = "patter{gold=7} patter/flow/f/patter{} patter/flow/f/scene/s{count=1} patter/scene/s{tally=2}";

            Case("Today's format (version 3), written by hand", () =>
            {
                string onDisk = "{\"schema\":\"patter/save@0\",\"save\":{\"version\":3,\"registry\":{\"patter\":{\"gold\":7},"
                    + "\"patter/flow/f/patter\":{},\"patter/flow/f/scene/s\":{\"count\":1},\"patter/scene/s\":{\"tally\":2}},"
                    + "\"sharedVisits\":{\"s\":1,\"b\":1,\"sn\":1},\"sharedSelectors\":{},"
                    + "\"flows\":{\"f\":{\"rngState\":0,\"visits\":{\"s\":1,\"b\":1,\"sn\":1}," + cursor + "}}}}";
                var engine = new Engine(b, new EngineOptions { Seed = 0 });
                PatterSave.DeserializeState(engine, onDisk);
                // Before anything reads a property: the scene the cursor stands in is registered by the load
                // itself, so a state inspector sees it straight away.
                var shown = PatterStateLogger.SnapshotState(engine);
                RegistryCheck("v3 by hand: the standing scene's bags are claimed at load",
                    shown.TryGetValue("f/@scene:s.count", out var c) && Num(c) == 1
                    && shown.TryGetValue("@scene:s.tally", out var t) && Num(t) == 2, string.Join(", ", shown.Keys));
                RegistryCheck("v3 by hand: values", Num(engine.GetProperty("@gold")) == 7
                    && Num(engine.GetFlow("f").GetProperty("@scene.count")) == 1
                    && Num(engine.GetFlow("f").GetProperty("@scene.tally")) == 2);
                RegistryCheck("v3 by hand: written back the same", JsonEqual(onDisk, Stored(engine)), Stored(engine));
            });

            // Version 2, written by hand: the shape every runtime wrote before the registry held the
            // properties. Players have these on disk; they must keep loading, their values moving into the
            // registry.
            string v2 = "{\"schema\":\"patter/save@0\",\"save\":{\"version\":2,\"shared\":{\"patter\":{\"gold\":7}},"
                + "\"sharedVisits\":{\"s\":1,\"b\":1,\"sn\":1},\"sharedSelectors\":{},\"stageBags\":{\"s\":{\"tally\":2}},"
                + "\"flows\":{\"f\":{\"scopes\":{\"patter\":{}},\"sceneBags\":{\"s\":{\"count\":1}},\"rngState\":0,"
                + "\"visits\":{\"s\":1,\"b\":1,\"sn\":1}," + cursor + "}}}}";
            Case("A version 2 save, written by hand", () =>
            {
                var engine = new Engine(b, new EngineOptions { Seed = 0 });
                var msg = Throws(() => PatterSave.DeserializeState(engine, v2));
                RegistryCheck("v2 by hand: loads", msg == null, msg);
                if (msg == null)
                {
                    RegistryCheck("v2 by hand: values", Num(engine.GetProperty("@gold")) == 7
                        && Num(engine.GetFlow("f").GetProperty("@scene.count")) == 1);
                    var back = engine.SaveGame();
                    RegistryCheck("v2 by hand: saved back as version 3, values in the registry",
                        back.Version == 3 && Dump(back.Registry) == expectedRegistry, Dump(back.Registry));
                }
            });

            Case("A version 2 save moved into a registry the game supplied, beside values the game already loaded", () =>
            {
                var registry = new ScopeRegistry();
                var waiting = new OrderedMap<string, OrderedMap<string, PatterValue>>();
                var deck = new OrderedMap<string, PatterValue>(); deck.Set("drawn", PatterValue.Num(3));
                waiting.Set("another-engine/deck/inn", deck);
                registry.Load(waiting); // the game's own load, waiting for its engine
                var engine = new Engine(b, new EngineOptions { Seed = 0, Registry = registry });
                PatterSave.DeserializeState(engine, v2);
                RegistryCheck("v2 into the game's registry: values", Num(engine.GetFlow("f").GetProperty("@scene.count")) == 1);
                RegistryCheck("v2 into the game's registry: beside the game's own waiting values",
                    Dump(registry.Save()) == "another-engine/deck/inn{drawn=3} " + expectedRegistry, Dump(registry.Save()));
            });

            Case("Anything but versions 2 and 3 is refused, by number", () =>
            {
                var engine = new Engine(b, new EngineOptions { Seed = 0 });
                var msg = Throws(() => engine.LoadGame(new SaveGame { Version = 4, Flows = new Dictionary<string, FlowSnapshot>() }));
                RegistryCheck("unsupported version", msg == "unsupported save version: 4", msg ?? "no error");
            });
        }

        /// <summary>The combined-game reference harness (combined-game.test.ts): ONE registry for the whole
        /// game, and one save. The storylet side is a stand-in that registers its own game-wide scope
        /// (`@story`) the way an engine does; the real Storylet Engine is proven beside Patter in the
        /// storylets repo.</summary>
        private static void RunCombinedGameChecks()
        {
            var b = new Bundle { Schema = "patter/bundle@0" };
            b.Locales.Default = "en";
            b.Locales.Included.Add("en");
            b.Strings["en"] = new Dictionary<string, string> { ["L"] = "A fine blade." };
            b.Cast.Add(new Cast { Name = "MERCHANT" });
            b.Properties.Add(new PropertyDecl { Name = "visits", Type = "number", Default = PatterValue.Num(0), Shared = true });
            // The storylet's published bundle declares the scopes Patter may read; Patter compiles against it.
            b.ScopeRegistry = new HostScopeRegistry();
            b.ScopeRegistry.Scopes.Add(new HostScopeSpec { Token = "world", Declarations = new List<HostScopeDecl>
            {
                new HostScopeDecl { Name = "gold", Type = "number" }, new HostScopeDecl { Name = "reputation", Type = "number" },
            } });
            b.ScopeRegistry.Scopes.Add(new HostScopeSpec { Token = "story", Declarations = new List<HostScopeDecl>
            {
                new HostScopeDecl { Name = "act", Type = "number" },
            } });
            var shop = new Scene { Id = "shop", GameId = "shop", Name = "Shop" };
            shop.Blocks.Add(new Block { Id = "b", GameId = "b", Name = "B", Children = new List<Node>
            {
                new Node { Id = "buy", Type = "snippet",
                    // @world.gold >= 10 and @story.act >= 2
                    Condition = Ex(A("bin", "and",
                        A("bin", ">=", A("sv", "world", "gold"), A("n", 10.0)),
                        A("bin", ">=", A("sv", "story", "act"), A("n", 2.0)))),
                    OnExit = new List<Effect> { Add("@world.gold", "world", "gold", -10), Add("@visits", "patter", "visits", 1) },
                    Beats = new List<Beat> { new Beat { Id = "L", Kind = "line", Character = "MERCHANT" } },
                    Jump = new Jump { To = "END" } },
            } });
            b.Scenes["shop"] = shop;

            var worldDecls = new List<ScopeDeclaration>
            {
                new ScopeDeclaration { Name = "gold", Type = "number" }, new ScopeDeclaration { Name = "reputation", Type = "number" },
            };
            void StoryStandIn(ScopeRegistry r) => r.DefineOwned("story",
                new[] { new ScopeDeclaration { Name = "act", Type = "number", Default = PatterValue.Num(1) } },
                new OwnedScopeOptions { Normalise = n => n, Owner = "Storylet Engine" });
            // The game: one registry, @world registered by the game, then each engine.
            (ScopeRegistry registry, Engine patter) Combined()
            {
                var registry = new ScopeRegistry().DefineOwned("world", worldDecls, new OwnedScopeOptions { Owner = "Game" });
                StoryStandIn(registry);
                return (registry, new Engine(b, new EngineOptions { Registry = registry }));
            }

            Case("Both sides read and write one registry live, and each reads the other's scope", () =>
            {
                var (registry, patter) = Combined();
                registry.Set("world", "gold", PatterValue.Num(25), host: true);
                registry.Set("story", "act", PatterValue.Num(2));
                var flow = patter.OpenFlow("main", "shop");
                RegistryCheck("combined: Patter reads @story", Num(patter.GetProperty("@story.act")) == 2);
                var line = flow.Advance();
                RegistryCheck("combined: the gate opens on both scopes", line.Type == StepType.Line && line.Id == "L" && line.Character == "MERCHANT");
                RegistryCheck("combined: the exit lands", flow.Advance().Type == StepType.End
                    && Num(registry.Get("world", "gold")) == 15 && Num(registry.Get("patter", "visits")) == 1, Dump(registry.Save()));
            });

            Case("Saves the registry once, with every engine's properties, and Patter's save holds none", () =>
            {
                var (registry, patter) = Combined();
                registry.Set("world", "gold", PatterValue.Num(25), host: true);
                registry.Set("world", "reputation", PatterValue.Num(3), host: true);
                registry.Set("story", "act", PatterValue.Num(2));
                var f = patter.OpenFlow("main", "shop");
                f.Advance(); f.Advance();
                var saved = Dump(registry.Save());
                RegistryCheck("combined: one registry save holds every engine's properties",
                    saved.Contains("world{gold=15,reputation=3}") && saved.Contains("story{act=2}") && saved.Contains("patter{visits=1}"), saved);
                var stored = Stored(patter);
                RegistryCheck("combined: Patter's save holds none", !stored.Contains("\"registry\"") && !stored.Contains("reputation"), stored);
            });

            Case("Resumes both sides from the one save, loading the registry first or last", () =>
            {
                var g1 = Combined();
                g1.registry.Set("world", "gold", PatterValue.Num(25), host: true);
                g1.registry.Set("story", "act", PatterValue.Num(2));
                var f1 = g1.patter.OpenFlow("main", "shop");
                f1.Advance(); f1.Advance();
                g1.patter.OpenFlow("main", "shop"); // a fresh run at the gate, saved mid-flow
                var savedRegistry = g1.registry.Save();
                var savedPatter = Stored(g1.patter);
                foreach (var registryFirst in new[] { true, false })
                {
                    var label = registryFirst ? "registry first" : "registry last";
                    var g2 = Combined();
                    if (registryFirst) g2.registry.Load(savedRegistry);
                    PatterSave.DeserializeState(g2.patter, savedPatter);
                    if (!registryFirst) g2.registry.Load(savedRegistry);
                    RegistryCheck($"combined {label}: restored", Num(g2.patter.GetProperty("@world.gold")) == 15
                        && Num(g2.patter.GetProperty("@story.act")) == 2 && Num(g2.patter.GetProperty("@visits")) == 1, Dump(g2.registry.Save()));
                    // gold(15) >= 10 and act 2: a second purchase proceeds on the restored state.
                    var f2 = g2.patter.GetFlow("main");
                    var line = f2.Advance();
                    RegistryCheck($"combined {label}: plays on", line.Type == StepType.Line && line.Id == "L"
                        && f2.Advance().Type == StepType.End
                        && Num(g2.registry.Get("world", "gold")) == 5 && Num(g2.registry.Get("patter", "visits")) == 2, Dump(g2.registry.Save()));
                }
            });

            Case("Loads a save forward across content drift (lenient by design)", () =>
            {
                OrderedMap<string, PatterValue> Section(params (string, double)[] values)
                {
                    var m = new OrderedMap<string, PatterValue>();
                    foreach (var (k, v) in values) m.Set(k, PatterValue.Num(v));
                    return m;
                }
                var stale = new OrderedMap<string, OrderedMap<string, PatterValue>>();
                stale.Set("world", Section(("gold", 7), ("retired_flag", 1)));
                stale.Set("patter", Section(("visits", 9)));
                stale.Set("story", Section(("act", 3)));
                stale.Set("retired_engine", Section(("x", 1)));
                var (registry, patter) = Combined();
                registry.Load(stale);
                RegistryCheck("drift: known restored, newer defaulted, vanished kept as a stray",
                    Num(registry.Get("world", "gold")) == 7 && Num(registry.Get("world", "reputation")) == 0
                    && Num(registry.Get("world", "retired_flag")) == 1 && Num(patter.GetProperty("@visits")) == 9);
                RegistryCheck("drift: an engine nobody runs is kept until discarded", registry.Save().ContainsKey("retired_engine"));
                registry.DiscardParked();
                RegistryCheck("drift: discarded", !registry.Save().ContainsKey("retired_engine"));
            });

            Case("A clash between engines fails as the game combines them, naming who holds the token", () =>
            {
                var registry = new ScopeRegistry();
                StoryStandIn(registry);
                var msg = Throws(() => StoryStandIn(registry));
                RegistryCheck("combined: a clash names the holder", msg != null && msg.Contains("scope '@story' is already registered by Storylet Engine"), msg ?? "no error");
            });
        }
    }
}
