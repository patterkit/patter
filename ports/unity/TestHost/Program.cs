// The corpus TestHost: load corpus.json and replay every section through the C#
// Patterplay runtime, asserting the same results the JS reference produces - the port's
// half of the parity contract.
//
//   dotnet run --project ports/unity/TestHost -- <path-to-corpus.json>
//
// Sections: expressions (evaluator + dialect), runtime (full playthroughs), scripted
// (save/load, multi-flow, reset), gameData (merge-at-read).

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Patterkit.Patterplay;

namespace Patterkit.Patterplay.TestHost
{
    internal static class Program
    {
        private static int _fails;
        // The bundle parser under test. Run once with System.Text.Json, once with the Unity
        // Newtonsoft loader, so both paths are corpus-verified.
        private static Func<JsonElement, Bundle> _loader = ParseBundle;
        // When true, scripted `saveLoad` ops round-trip through PatterSave's JSON string (the Unity
        // "Save State" path) instead of the in-memory blob - verifies the save/load JSON converter.
        private static bool _jsonSaveLoad;

        private static int Main(string[] args)
        {
            string path = args.Length > 0 ? args[0] : "corpus.json";
            if (!File.Exists(path)) { Console.Error.WriteLine($"corpus not found: {path}"); return 2; }

            using var doc = JsonDocument.Parse(File.ReadAllText(path));
            var root = doc.RootElement;

            int e = RunExpressions(root.GetProperty("expressions"));
            int sp = root.TryGetProperty("specificity", out var specArr) ? RunSpecificity(specArr) : 0;

            int r = 0, s = 0, g = 0;
            foreach (var (label, loader) in new (string, Func<JsonElement, Bundle>)[]
                     {
                         ("System.Text.Json", ParseBundle),
                         ("Newtonsoft (Unity)", je => PatterBundleLoader.Parse(je.GetRawText())),
                     })
            {
                _loader = loader;
                int rr = RunRuntime(root.GetProperty("runtime"));
                int ss = RunScripted(root.GetProperty("scripted"));
                int gg = RunGameData(root.GetProperty("gameData"));
                Console.WriteLine($"  [{label}] runtime: {rr}  scripted: {ss}  gameData: {gg}");
                r = rr; s = ss; g = gg;
            }

            // Verify the Unity JSON save/load: replay the scripted cases routing saveLoad through
            // PatterSave's JSON string round-trip.
            _loader = ParseBundle;
            _jsonSaveLoad = true;
            int sj = RunScripted(root.GetProperty("scripted"));
            _jsonSaveLoad = false;
            Console.WriteLine($"  [PatterSave JSON] scripted save/load: {sj}");

            Console.WriteLine($"expressions: {e}  specificity: {sp}  runtime: {r}  scripted: {s}  gameData: {g}");
            Console.WriteLine(_fails == 0 ? "ALL PASS" : $"{_fails} FAILED");
            return _fails == 0 ? 0 : 1;
        }

        private static void Fail(string section, string name, string detail)
        {
            _fails++;
            Console.Error.WriteLine($"  FAIL [{section}] {name}: {detail}");
        }

        // -- expressions --------------------------------------------------------

        private static int RunExpressions(JsonElement arr)
        {
            int pass = 0;
            foreach (var c in arr.EnumerateArray())
            {
                string name = c.GetProperty("name").GetString();
                try
                {
                    var node = ParseAst(c.GetProperty("ast"));
                    var ctx = new EvalContext();
                    foreach (var scope in c.GetProperty("scopes").EnumerateObject())
                    {
                        var bag = new Dictionary<string, PatterValue>();
                        foreach (var p in scope.Value.EnumerateObject()) bag[p.Name] = ToValue(p.Value);
                        ctx.Scopes[scope.Name] = new BagScope(bag);
                    }
                    if (c.TryGetProperty("seed", out var seed)) ctx.NextRandom = new Mulberry32(seed.GetInt64()).Next;
                    var actual = Expr.Evaluate(node, ctx);
                    var expected = ToValue(c.GetProperty("expected"));
                    if (actual.ValueEquals(expected)) pass++;
                    else Fail("expr", name, $"expected {expected}, got {actual}");
                }
                catch (Exception ex) { Fail("expr", name, ex.Message); }
            }
            return pass;
        }

        // -- specificity --------------------------------------------------------

        private static int RunSpecificity(JsonElement arr)
        {
            int pass = 0;
            foreach (var c in arr.EnumerateArray())
            {
                string name = c.GetProperty("name").GetString();
                try
                {
                    var node = ParseAst(c.GetProperty("ast"));
                    var ctx = new EvalContext();
                    foreach (var scope in c.GetProperty("scopes").EnumerateObject())
                    {
                        var bag = new Dictionary<string, PatterValue>();
                        foreach (var p in scope.Value.EnumerateObject()) bag[p.Name] = ToValue(p.Value);
                        ctx.Scopes[scope.Name] = new BagScope(bag);
                    }
                    int actual = Flow.MatchedSpec(node, ctx, true);
                    int expected = c.GetProperty("expected").GetInt32();
                    if (actual == expected) pass++;
                    else Fail("spec", name, $"expected {expected}, got {actual}");
                }
                catch (Exception ex) { Fail("spec", name, ex.Message); }
            }
            return pass;
        }

        // -- runtime ------------------------------------------------------------

        private static int RunRuntime(JsonElement arr)
        {
            int pass = 0;
            foreach (var c in arr.EnumerateArray())
            {
                string name = c.GetProperty("name").GetString();
                try
                {
                    var bundle = _loader(c.GetProperty("bundle"));
                    var opts = new EngineOptions();
                    if (c.TryGetProperty("seed", out var seed)) opts.Rng = new Mulberry32(seed.GetInt64()).Next;
                    if (c.TryGetProperty("locale", out var loc)) opts.Locale = loc.GetString();

                    var engine = new Engine(bundle, opts);
                    string startScene = null, startBlock = null;
                    if (c.TryGetProperty("start", out var start))
                    {
                        if (start.TryGetProperty("scene", out var sc)) startScene = sc.GetString();
                        if (start.TryGetProperty("block", out var bl)) startBlock = bl.GetString();
                    }
                    var flow = engine.OpenFlow("main", startScene, startBlock);
                    var scripted = c.TryGetProperty("choices", out var ch)
                        ? new Queue<string>(ch.EnumerateArray().Select(x => x.GetString())) : new Queue<string>();

                    var transcript = new List<object>();
                    for (int i = 0; i < 1000; i++)
                    {
                        var step = flow.Advance();
                        transcript.Add(Normalize(step));
                        if (step.Type == StepType.End) break;
                        if (step.Type == StepType.Choice)
                        {
                            string pick = scripted.Count > 0 ? scripted.Dequeue() : step.Options.FirstOrDefault(o => o.Eligible)?.Id;
                            if (pick == null) break;
                            flow.Choose(pick);
                        }
                    }

                    if (MatchArray(transcript, c.GetProperty("expectedTranscript"))) pass++;
                    else Fail("runtime", name, $"transcript mismatch\n    expected {c.GetProperty("expectedTranscript")}\n    got      {Dump(transcript)}");
                }
                catch (Exception ex) { Fail("runtime", name, ex.Message); }
            }
            return pass;
        }

        // -- scripted -----------------------------------------------------------

        private static int RunScripted(JsonElement arr)
        {
            int pass = 0;
            foreach (var c in arr.EnumerateArray())
            {
                string name = c.GetProperty("name").GetString();
                try
                {
                    var bundle = _loader(c.GetProperty("bundle"));
                    // The EDITED bundle a hotSwap op switches to (cross-bundle drift cases, §9.8).
                    var bundleB = c.TryGetProperty("bundleB", out var bb) ? _loader(bb) : null;
                    long? seed = c.TryGetProperty("seed", out var sd) ? sd.GetInt64() : (long?)null;
                    var opts = new EngineOptions { Seed = seed };
                    var engine = new Engine(bundle, opts);
                    string current = "";
                    bool ok = true;

                    foreach (var op in c.GetProperty("script").EnumerateArray())
                    {
                        var chunk = new List<object>();
                        string kind = op.GetProperty("op").GetString();
                        switch (kind)
                        {
                            case "openFlow":
                                engine.OpenFlow(op.GetProperty("flow").GetString(),
                                    op.TryGetProperty("scene", out var os) ? os.GetString() : null,
                                    op.TryGetProperty("block", out var ob) ? ob.GetString() : null,
                                    op.TryGetProperty("seed", out var osd) ? osd.GetInt64() : (long?)null);
                                current = op.GetProperty("flow").GetString();
                                break;
                            case "useFlow":
                                current = op.GetProperty("flow").GetString();
                                break;
                            case "advance":
                                chunk.Add(Normalize(engine.GetFlow(current).Advance()));
                                break;
                            case "choose":
                                engine.GetFlow(current).Choose(op.GetProperty("id").GetString());
                                break;
                            case "saveLoad":
                            {
                                if (_jsonSaveLoad)
                                {
                                    // Round-trip through the Unity save helper (Newtonsoft JSON string).
                                    string json = PatterSave.SerializeState(engine);
                                    engine = new Engine(bundle, opts);
                                    PatterSave.DeserializeState(engine, json);
                                }
                                else
                                {
                                    var blob = engine.SaveGame();
                                    engine = new Engine(bundle, opts);
                                    engine.LoadGame(blob);
                                }
                                break;
                            }
                            case "hotSwap":
                            {
                                // Live bundle refresh (§9.8): serialise the whole game, fresh engine on
                                // the EDITED bundle, restore - drift resolves identically on every port.
                                if (_jsonSaveLoad)
                                {
                                    string json = PatterSave.SerializeState(engine);
                                    engine = new Engine(bundleB, opts);
                                    PatterSave.DeserializeState(engine, json);
                                }
                                else
                                {
                                    var blob = engine.SaveGame();
                                    engine = new Engine(bundleB, opts);
                                    engine.LoadGame(blob);
                                }
                                break;
                            }
                            case "setLocale":
                                engine.SetLocale(op.GetProperty("locale").GetString());
                                break;
                            case "setClosedCaptions":
                                engine.SetClosedCaptions(op.GetProperty("on").GetBoolean());
                                break;
                            case "reset":
                                engine.Reset();
                                current = "";
                                break;
                        }
                        var expectChunk = op.TryGetProperty("expect", out var ex) ? ex : default;
                        var expected = expectChunk.ValueKind == JsonValueKind.Array ? expectChunk : (JsonElement?)null;
                        if (!MatchChunk(chunk, expected)) { ok = false; Fail("scripted", name, $"op {kind}: mismatch (got {Dump(chunk)})"); break; }
                    }
                    if (ok) pass++;
                }
                catch (Exception ex) { Fail("scripted", name, ex.Message); }
            }
            return pass;
        }

        // -- gameData -----------------------------------------------------------

        private static int RunGameData(JsonElement arr)
        {
            int pass = 0;
            foreach (var c in arr.EnumerateArray())
            {
                string name = c.GetProperty("name").GetString();
                try
                {
                    var bundle = _loader(c.GetProperty("bundle"));
                    string kind = c.GetProperty("kind").GetString();
                    GameData node = c.TryGetProperty("node", out var n) ? ParseGameData(n) : null;
                    var effective = GameDataHelpers.Effective(GameDataHelpers.FieldsFor(bundle, kind), node);
                    if (MatchObject(GameDataToObject(effective), c.GetProperty("expected"))) pass++;
                    else Fail("gameData", name, $"expected {c.GetProperty("expected")}, got {Dump(GameDataToObject(effective))}");
                }
                catch (Exception ex) { Fail("gameData", name, ex.Message); }
            }
            return pass;
        }

        // -- transcript normalisation (mirror runner.ts normaliseStep) -----------

        private static object Normalize(StepResult s)
        {
            var o = new Dictionary<string, object>();
            switch (s.Type)
            {
                case StepType.Line:
                    o["type"] = "line"; o["id"] = s.Id; o["text"] = s.Text;
                    if (s.Character != null) o["character"] = s.Character;
                    if (s.CharacterName != null) o["characterName"] = s.CharacterName;
                    if (s.Direction != null) o["direction"] = s.Direction;
                    if (s.GameData != null) o["gameData"] = GameDataToObject(s.GameData);
                    if (s.Tags != null) o["tags"] = s.Tags.Cast<object>().ToList();
                    break;
                case StepType.Text:
                    o["type"] = "text"; o["id"] = s.Id; o["text"] = s.Text;
                    if (s.GameData != null) o["gameData"] = GameDataToObject(s.GameData);
                    if (s.Tags != null) o["tags"] = s.Tags.Cast<object>().ToList();
                    break;
                case StepType.GameEvent:
                    o["type"] = "gameEvent"; o["id"] = s.Id;
                    if (s.GameData != null) o["gameData"] = GameDataToObject(s.GameData);
                    if (s.Tags != null) o["tags"] = s.Tags.Cast<object>().ToList();
                    break;
                case StepType.Choice:
                    o["type"] = "choice";
                    o["options"] = s.Options.Select(opt =>
                    {
                        var od = new Dictionary<string, object> { ["id"] = opt.Id, ["eligible"] = opt.Eligible };
                        if (opt.Prompt != null) od["text"] = opt.Prompt.Text;
                        if (opt.GameData != null) od["gameData"] = GameDataToObject(opt.GameData);
                        return (object)od;
                    }).ToList();
                    // runner keeps option key order { id, text, eligible, gameData } - reorder to match.
                    o["options"] = ((List<object>)o["options"]).Select(ReorderOption).ToList();
                    break;
                case StepType.End:
                    o["type"] = "end";
                    break;
            }
            return o;
        }

        private static object ReorderOption(object opt)
        {
            var d = (Dictionary<string, object>)opt;
            var ordered = new Dictionary<string, object> { ["id"] = d["id"] };
            if (d.ContainsKey("text")) ordered["text"] = d["text"];
            ordered["eligible"] = d["eligible"];
            if (d.ContainsKey("gameData")) ordered["gameData"] = d["gameData"];
            return ordered;
        }

        private static Dictionary<string, object> GameDataToObject(GameData gd)
        {
            var o = new Dictionary<string, object>();
            foreach (var kv in gd) o[kv.Key] = ValueToObject(kv.Value);
            return o;
        }

        private static object ValueToObject(PatterValue v)
        {
            switch (v.Kind)
            {
                case PatterKind.Bool: return v.AsBool;
                case PatterKind.Number: return v.AsNumber;
                case PatterKind.Str: return v.AsString;
                case PatterKind.Flags: return v.AsFlags.ToList();
                default: return null;
            }
        }

        // -- structural matching (produced object tree vs expected JsonElement) --

        private static bool MatchArray(List<object> produced, JsonElement expected)
        {
            if (expected.ValueKind != JsonValueKind.Array) return false;
            var exp = expected.EnumerateArray().ToList();
            if (produced.Count != exp.Count) return false;
            for (int i = 0; i < exp.Count; i++) if (!Match(produced[i], exp[i])) return false;
            return true;
        }

        private static bool MatchChunk(List<object> produced, JsonElement? expected)
        {
            // An op with no `expect` must produce no output; otherwise match the array.
            if (expected == null) return produced.Count == 0;
            return MatchArray(produced, expected.Value);
        }

        private static bool MatchObject(Dictionary<string, object> produced, JsonElement expected)
        {
            if (expected.ValueKind != JsonValueKind.Object) return false;
            var keys = expected.EnumerateObject().Select(p => p.Name).ToHashSet();
            if (!keys.SetEquals(produced.Keys)) return false;
            foreach (var p in expected.EnumerateObject())
                if (!Match(produced[p.Name], p.Value)) return false;
            return true;
        }

        private static bool Match(object produced, JsonElement expected)
        {
            switch (expected.ValueKind)
            {
                case JsonValueKind.Object:
                    return produced is Dictionary<string, object> d && MatchObject(d, expected);
                case JsonValueKind.Array:
                    return produced is List<object> l && MatchArray(l, expected);
                case JsonValueKind.String:
                    return produced is string ps && ps == expected.GetString();
                case JsonValueKind.Number:
                    return produced is double pn && pn == expected.GetDouble();
                case JsonValueKind.True: return produced is bool tb && tb;
                case JsonValueKind.False: return produced is bool fb && !fb;
                default: return false;
            }
        }

        private static string Dump(object o)
        {
            switch (o)
            {
                case Dictionary<string, object> d:
                    return "{" + string.Join(",", d.Select(kv => $"\"{kv.Key}\":{Dump(kv.Value)}")) + "}";
                case List<object> l:
                    return "[" + string.Join(",", l.Select(Dump)) + "]";
                case string s: return $"\"{s}\"";
                case bool b: return b ? "true" : "false";
                case double n: return PatterValue.JsNumber(n);
                default: return "null";
            }
        }

        // -- JSON -> model ------------------------------------------------------

        private static PatterValue ToValue(JsonElement e)
        {
            switch (e.ValueKind)
            {
                case JsonValueKind.True: return PatterValue.True;
                case JsonValueKind.False: return PatterValue.False;
                case JsonValueKind.Number: return PatterValue.Num(e.GetDouble());
                case JsonValueKind.String: return PatterValue.Str(e.GetString());
                case JsonValueKind.Array: return PatterValue.Flags(e.EnumerateArray().Select(x => x.GetString()).ToList());
                default: throw new Exception($"unsupported value kind: {e.ValueKind}");
            }
        }

        private static GameData ParseGameData(JsonElement e)
        {
            var gd = new GameData();
            foreach (var p in e.EnumerateObject()) gd[p.Name] = ToValue(p.Value);
            return gd;
        }

        private static Dictionary<string, Dictionary<string, string>> ParseStrings(JsonElement e)
        {
            var outd = new Dictionary<string, Dictionary<string, string>>();
            foreach (var loc in e.EnumerateObject())
            {
                var table = new Dictionary<string, string>();
                foreach (var kv in loc.Value.EnumerateObject()) table[kv.Name] = kv.Value.GetString();
                outd[loc.Name] = table;
            }
            return outd;
        }

        private static AstNode ParseAst(JsonElement e)
        {
            string tag = e[0].GetString();
            switch (tag)
            {
                case "b": return new BoolNode { Value = e[1].GetBoolean() };
                case "n": return new NumberNode { Value = e[1].GetDouble() };
                case "s": return new StringNode { Value = e[1].GetString() };
                case "sv": return new ScopedVar { Scope = e[1].GetString(), Name = e[2].GetString() };
                case "u": return new Unary { Op = e[1].GetString(), Operand = ParseAst(e[2]) };
                case "bin": return new Binary { Op = e[1].GetString(), Left = ParseAst(e[2]), Right = ParseAst(e[3]) };
                case "fd": return new FlagDelta { Sign = e[1].GetString(), Name = e[2].GetString() };
                case "call":
                    var args = new List<AstNode>();
                    for (int i = 2; i < e.GetArrayLength(); i++) args.Add(ParseAst(e[i]));
                    return new Call { Name = e[1].GetString(), Args = args.ToArray() };
                default: throw new Exception($"unknown ast tag: {tag}");
            }
        }

        private static Expression ParseExpr(JsonElement e)
            => new Expression { Ast = ParseAst(e.GetProperty("ast")) };

        private static List<Effect> ParseEffects(JsonElement e)
            => e.EnumerateArray().Select(x => new Effect { Target = x.GetProperty("target").GetString(), Value = ParseExpr(x.GetProperty("value")) }).ToList();

        private static Bundle ParseBundle(JsonElement b)
        {
            var bundle = new Bundle();
            if (b.TryGetProperty("voiced", out var v)) bundle.Voiced = v.GetBoolean();
            if (b.TryGetProperty("content", out var ct))
            {
                if (ct.TryGetProperty("hash", out var ch)) bundle.ContentHash = ch.GetString();
                if (ct.TryGetProperty("structureHash", out var csh)) bundle.StructureHash = csh.GetString();
                if (ct.TryGetProperty("project", out var cp)) bundle.ContentProject = cp.GetString();
            }
            var loc = b.GetProperty("locales");
            bundle.Locales.Default = loc.GetProperty("default").GetString();
            if (loc.TryGetProperty("included", out var inc)) bundle.Locales.Included = inc.EnumerateArray().Select(x => x.GetString()).ToList();
            if (b.TryGetProperty("localisation", out var lz))
                bundle.Localisation = new Localisation {
                    Mode = lz.TryGetProperty("mode", out var lm) ? lm.GetString() : "embedded",
                    SourceDebug = lz.TryGetProperty("sourceDebug", out var sd) && sd.GetBoolean(),
                };

            if (b.TryGetProperty("closedCaptions", out var ccz))
                bundle.ClosedCaptions = new CaptionDelimiters {
                    Open = ccz.GetProperty("open").GetString(),
                    Close = ccz.GetProperty("close").GetString(),
                    Character = ccz.TryGetProperty("character", out var ccc) ? ccc.GetString() : null,
                };

            if (b.TryGetProperty("cast", out var cast))
                foreach (var c in cast.EnumerateArray())
                    bundle.Cast.Add(new Cast { Name = c.GetProperty("name").GetString(), DisplayName = c.TryGetProperty("displayName", out var dn) ? dn.GetString() : null });

            if (b.TryGetProperty("properties", out var props))
                foreach (var p in props.EnumerateArray()) bundle.Properties.Add(ParsePropDecl(p));

            if (b.TryGetProperty("strings", out var strs)) bundle.Strings = ParseStrings(strs);

            if (b.TryGetProperty("gameDataFields", out var gdf))
                foreach (var kind in gdf.EnumerateObject())
                    bundle.GameDataFields[kind.Name] = kind.Value.EnumerateArray().Select(ParseGameDataField).ToList();

            foreach (var sc in b.GetProperty("scenes").EnumerateObject())
                bundle.Scenes[sc.Name] = ParseScene(sc.Value);

            return bundle;
        }

        private static PropertyDecl ParsePropDecl(JsonElement p) => new PropertyDecl
        {
            Name = p.GetProperty("name").GetString(),
            Type = p.GetProperty("type").GetString(),
            Shared = p.TryGetProperty("shared", out var sh) ? sh.GetBoolean() : (bool?)null,
            Temporary = p.TryGetProperty("temporary", out var tp) && tp.GetBoolean(),
            Default = p.TryGetProperty("default", out var df) ? ToValue(df) : null,
            Values = p.TryGetProperty("values", out var vs) ? vs.EnumerateArray().Select(x => x.GetString()).ToList() : null,
        };

        private static GameDataField ParseGameDataField(JsonElement f) => new GameDataField
        {
            Name = f.GetProperty("name").GetString(),
            Type = f.TryGetProperty("type", out var t) ? t.GetString() : null,
            Default = f.TryGetProperty("default", out var df) ? ToValue(df) : null,
            Values = f.TryGetProperty("values", out var vs) ? vs.EnumerateArray().Select(x => x.GetString()).ToList() : null,
        };

        private static Scene ParseScene(JsonElement s)
        {
            var scene = new Scene
            {
                Id = s.GetProperty("id").GetString(),
                Name = s.TryGetProperty("name", out var nm) ? nm.GetString() : "",
                GameId = s.TryGetProperty("gameId", out var gi) ? gi.GetString() : null,
            };
            if (s.TryGetProperty("tags", out var st)) scene.Tags = TagList(st);
            if (s.TryGetProperty("sceneProps", out var sp)) scene.SceneProps = sp.EnumerateArray().Select(ParsePropDecl).ToList();
            if (s.TryGetProperty("onEntry", out var oe)) scene.OnEntry = ParseEffects(oe);
            foreach (var blk in s.GetProperty("blocks").EnumerateArray()) scene.Blocks.Add(ParseBlock(blk));
            return scene;
        }

        private static Block ParseBlock(JsonElement b)
        {
            var block = new Block
            {
                Id = b.GetProperty("id").GetString(),
                Name = b.TryGetProperty("name", out var nm) ? nm.GetString() : "",
                GameId = b.TryGetProperty("gameId", out var gi) ? gi.GetString() : null,
            };
            if (b.TryGetProperty("tags", out var bt)) block.Tags = TagList(bt);
            if (b.TryGetProperty("children", out var ch)) foreach (var n in ch.EnumerateArray()) block.Children.Add(ParseNode(n));
            return block;
        }

        private static Node ParseNode(JsonElement n)
        {
            var node = new Node { Id = n.GetProperty("id").GetString(), Type = n.GetProperty("type").GetString() };
            if (n.TryGetProperty("condition", out var cond)) node.Condition = ParseExpr(cond);
            if (n.TryGetProperty("onEnter", out var oen)) node.OnEnter = ParseEffects(oen);
            if (n.TryGetProperty("onExit", out var oex)) node.OnExit = ParseEffects(oex);
            if (n.TryGetProperty("gameData", out var gd)) node.GameData = ParseGameData(gd);
            if (n.TryGetProperty("tags", out var nt)) node.Tags = TagList(nt);

            if (node.IsGroup)
            {
                if (n.TryGetProperty("selector", out var sel)) node.Selector = sel.GetString();
                node.Children = new List<Node>();
                if (n.TryGetProperty("children", out var ch)) foreach (var c in ch.EnumerateArray()) node.Children.Add(ParseNode(c));
                if (n.TryGetProperty("prompt", out var pr)) node.Prompt = ParseBeat(pr);
                if (n.TryGetProperty("sticky", out var st)) node.Sticky = st.GetBoolean();
                if (n.TryGetProperty("fallback", out var fb)) node.Fallback = fb.GetBoolean();
                if (n.TryGetProperty("secretUntilEligible", out var su)) node.SecretUntilEligible = su.GetBoolean();
                if (n.TryGetProperty("shared", out var sh)) node.Shared = sh.GetBoolean();
                if (n.TryGetProperty("options", out var op))
                    node.Options = new SelectorOptions
                    {
                        Order = op.TryGetProperty("order", out var or) ? or.GetString() : null,
                        Exhaust = op.TryGetProperty("exhaust", out var ex) ? ex.GetString() : null,
                    };
            }
            else
            {
                node.Beats = new List<Beat>();
                if (n.TryGetProperty("beats", out var bts)) foreach (var bt in bts.EnumerateArray()) node.Beats.Add(ParseBeat(bt));
                if (n.TryGetProperty("jump", out var jp))
                    node.Jump = new Jump { To = jp.GetProperty("to").GetString(), Mode = jp.TryGetProperty("mode", out var md) ? md.GetString() : null };
            }
            return node;
        }

        private static Beat ParseBeat(JsonElement b)
        {
            var beat = new Beat
            {
                Id = b.GetProperty("id").GetString(),
                Kind = b.GetProperty("kind").GetString(),
                Character = b.TryGetProperty("character", out var c) ? c.GetString() : null,
                Direction = b.TryGetProperty("direction", out var d) ? d.GetString() : null,
            };
            if (b.TryGetProperty("gameData", out var gd)) beat.GameData = ParseGameData(gd);
            if (b.TryGetProperty("tags", out var bt)) beat.Tags = TagList(bt);
            return beat;
        }

        private static List<string> TagList(JsonElement a) => a.EnumerateArray().Select(x => x.GetString()).ToList();
    }
}
