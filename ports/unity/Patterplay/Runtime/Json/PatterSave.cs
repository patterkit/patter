// Save / load the whole game as a JSON string (Newtonsoft): the editor "Save State…" button and any
// host that wants to persist a run. Mirrors @patterkit/play-helpers' serializeState/deserializeState:
// a tagged `patter/save@0` envelope around Engine.SaveGame().
//
// THE SHAPE IS THE FAMILY'S, NOT THIS PORT'S. `patter/save@0` is what the JS reference writes
// (@patterkit/model documents it; design/patter-schema.md 9), and every Patterplay runtime writes and
// reads exactly that, so a save crosses engines: a web build's save loads here, and this port's save
// loads in Godot. Every key below is a camelCase LITERAL and the envelope is built by hand rather than
// reflected off the DTOs. Reflection is how this port came to write PascalCase (`StageBags`, `Flows`)
// and a one-level `Shared` without anything noticing: a save written here loaded nowhere else, and a
// JS save loaded here threw on the first nested object (from-storylets/save-shape-across-engines,
// 2026-09-03).
//
// Version 3 (the one-registry model) holds no property values of the engine's own: those are the
// registry's. A standalone engine's save carries its registry's values under `registry`; a game that
// passed its own registry saves that once, beside this. Version 4 (Patterplay 1.0) keeps a pending choice's
// options' ids and not their text, names the next beat by id (`beatId`), and stamps a frame inside an option
// with its choice (`choiceId`).
//
// Reading accepts versions 3 and 4, each inside the envelope; a version 3 save's prompt text is discarded as
// it loads, and its `beatIndex` trusted. A bare snapshot with no envelope is refused, as the JS reference
// refuses it. Keys are read exactly as the family writes them.
//
// A flow state (Engine.CaptureFlow: one flow as a save writes it, with its own values) goes through the same
// code: SaveFlowState writes it, and ReadFlowState reads it as the flow part of a save is read.
//
// Pure (no UnityEngine), so it is corpus-verified in the dotnet TestHost too.

using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Wildwinter.Expr;

namespace Patterkit.Patterplay
{
    public static class PatterSave
    {
        public const string Schema = "patter/save@0";

        /// <summary>Serialise the whole game (visits, selectors, every live flow, and the registry's values when the
        /// engine made its own registry) to a tagged JSON string.</summary>
        public static string SerializeState(Engine engine) => SaveState(engine).ToString(Formatting.None);

        /// <summary>The whole game as the tagged envelope, a JObject: `{ schema, save }`, the save in the family's
        /// shape. <see cref="SerializeState"/> is this as a string.</summary>
        public static JObject SaveState(Engine engine) => EnvelopeOf(engine.SaveGame());

        /// <summary>Restore a <see cref="SaveState"/> envelope into an engine. Throws on anything but a
        /// `patter/save@0` envelope (a bare snapshot with no envelope included), and on a save the engine
        /// refuses; either way before the engine changes.</summary>
        public static void LoadState(Engine engine, JObject envelope)
        {
            var schema = envelope?["schema"];
            if (schema == null || schema.Type != JTokenType.String || (string)schema != Schema)
                throw new Exception($"PatterSave: not a {Schema} envelope");
            if (!(envelope["save"] is JObject save)) throw new Exception($"PatterSave: not a {Schema} envelope");
            engine.LoadGame(ReadSave(save));
        }

        private static JObject EnvelopeOf(SaveGame s) => new JObject { ["schema"] = Schema, ["save"] = SaveToken(s) };

        /// <summary>Restore a <see cref="SerializeState"/> string into an engine. Throws on anything but a
        /// `patter/save@0` envelope (a bare snapshot with no envelope included), and on a save the engine
        /// refuses; either way before the engine changes.</summary>
        public static void DeserializeState(Engine engine, string json) => LoadState(engine, JObject.Parse(json));

        /// <summary>A registry's values as JSON (registry key -> name -> value), for a game that made its own
        /// registry and saves it once beside each engine's part. The same shape a standalone engine's save
        /// carries under `registry`, and the same one `JSON.stringify(registry.save())` writes on the web.</summary>
        public static JObject SaveRegistry(ScopeRegistry registry) => SectionMap(registry.Save());

        /// <summary>Lay a <see cref="SaveRegistry"/> object over a registry. Values for a key nobody has
        /// registered yet wait in the registry and are handed over when it registers, so this can run
        /// before or after each engine's DeserializeState.</summary>
        public static void LoadRegistry(ScopeRegistry registry, JObject values)
        {
            registry.Load(ReadRegistry(values) ?? new OrderedMap<string, OrderedMap<string, ExprValue>>());
        }

        /// <summary>A <see cref="FlowState"/> (Engine.CaptureFlow) as JSON: a flow as a save writes it, with its
        /// `version` first and its own values after (`scopes.patter`, `sceneBags`). The same shape `JSON.stringify(engine.captureFlow(id))` writes on the web.</summary>
        public static JObject SaveFlowState(FlowState state)
        {
            var o = FlowToken(state);
            o.AddFirst(new JProperty("version", state.Version));
            o["scopes"] = state.Scopes != null ? new JObject { ["patter"] = ValueMap(state.Scopes) } : new JObject();
            o["sceneBags"] = SectionMap(state.SceneBags ?? new Dictionary<string, Dictionary<string, ExprValue>>());
            return o;
        }

        /// <summary>A <see cref="SaveFlowState"/> object back as a <see cref="FlowState"/>, for Engine.RestoreFlow,
        /// which refuses a version it can't read. Throws on anything but a JSON object, and on a state with no
        /// `cursor`: a flow state never had the flat shape this port's saves once did, so a missing cursor is
        /// refused here rather than read as an empty one, as every runtime's restore refuses it.</summary>
        public static FlowState ReadFlowState(JObject o)
        {
            if (o == null) throw new Exception("PatterSave: not a flow state");
            int version = ReadVersion(Get(o, "version"), "flow state");
            if (!(Get(o, "cursor") is JObject)) throw new Exception("malformed flow state: no cursor");
            var state = ReadFlow(o, new FlowState());
            state.Version = version;
            return state;
        }

        // -- writing: literal keys, in the JS reference's order -----------------------------------

        private static JObject SaveToken(SaveGame s)
        {
            var flows = new JObject();
            foreach (var kv in s.Flows ?? new Dictionary<string, FlowSnapshot>()) flows[kv.Key] = FlowToken(kv.Value);
            var save = new JObject { ["version"] = s.Version };
            // Registry key -> name -> value, present only when the engine made its own registry.
            if (s.Registry != null) save["registry"] = SectionMap(s.Registry);
            save["sharedVisits"] = IntMap(s.SharedVisits);
            save["sharedSelectors"] = SelectorMap(s.SharedSelectors);
            save["flows"] = flows;
            return save;
        }

        private static JObject FlowToken(FlowSnapshot f)
        {
            var stack = new JArray();
            foreach (var fr in f.Stack ?? new List<StackFrame>())
            {
                var frame = new JObject { ["sceneId"] = fr.SceneId, ["containerId"] = fr.ContainerId, ["index"] = fr.Index };
                if (fr.NextId != null) frame["nextId"] = fr.NextId;       // absent at a container's end, as the JS writes it
                if (fr.ChoiceId != null) frame["choiceId"] = fr.ChoiceId; // only on a frame inside a choice's option
                stack.Add(frame);
            }
            JToken pending = JValue.CreateNull();
            if (f.PendingOptions != null)
            {
                var options = new JArray();
                foreach (var o in f.PendingOptions) options.Add(OptionToken(o));
                pending = new JObject { ["groupId"] = f.PendingGroupId, ["options"] = options };
            }
            // The execution position sits under `cursor`; absent ids are null, not "".
            var cursor = new JObject
            {
                ["flowEnded"] = f.FlowEnded,
            };
            // Why it ended, when a choice running dry ended it: written only then.
            if (f.RanDry != null) cursor["ranDry"] = f.RanDry;
            cursor["currentSceneId"] = Str(f.CurrentSceneId);
            cursor["stack"] = stack;
            cursor["activeSnippetId"] = Str(f.ActiveSnippetId);
            // The next beat by id; absent when no snippet is active or every beat is delivered.
            if (f.BeatId != null) cursor["beatId"] = f.BeatId;
            cursor["pendingChoice"] = pending;
            cursor["pendingPromptOwnerId"] = Str(f.PendingPromptOwnerId);
            // The prompt still to replay, as the choice showed it: written only in the choose->advance window.
            if (f.PendingPrompt != null) cursor["pendingPrompt"] = PromptToken(f.PendingPrompt);
            cursor["selectors"] = SelectorMap(f.Selectors);
            return new JObject
            {
                ["rngState"] = f.RngState,
                ["visits"] = IntMap(f.Visits),
                ["cursor"] = cursor,
            };
        }

        private static JObject PromptToken(ChoicePrompt prompt)
        {
            // Optional prompt fields are absent, not empty, when the prompt has none (the JS shape).
            var p = new JObject { ["kind"] = prompt.Kind, ["text"] = prompt.Text ?? "" };
            if (prompt.Character != null) p["character"] = prompt.Character;
            if (prompt.CharacterName != null) p["characterName"] = prompt.CharacterName;
            if (prompt.Direction != null) p["direction"] = prompt.Direction;
            if (prompt.Qualifier != null) p["qualifier"] = prompt.Qualifier;
            if (prompt.QualifierName != null) p["qualifierName"] = prompt.QualifierName;
            if (prompt.SpeakerLabel != null) p["speakerLabel"] = prompt.SpeakerLabel;
            if (prompt.PadAfter != null) p["padAfter"] = prompt.PadAfter.Value; // line padding; absent in an older save
            return p;
        }

        private static ChoicePrompt ReadPrompt(JObject p) => new ChoicePrompt
        {
            Kind = StrOrNull(p, "kind"), Text = StrOrNull(p, "text"), Character = StrOrNull(p, "character"),
            CharacterName = StrOrNull(p, "characterName"), Direction = StrOrNull(p, "direction"),
            Qualifier = StrOrNull(p, "qualifier"), QualifierName = StrOrNull(p, "qualifierName"),
            SpeakerLabel = StrOrNull(p, "speakerLabel"), // absent in a save written before prompts carried it: re-resolved on load
            PadAfter = NumOrNull(p, "padAfter"), // absent in a save written before prompts carried it: re-resolved on load
        };

        // Which option, and whether it could be taken: never its text, which is built again on delivery.
        private static JObject OptionToken(SavedChoiceOption o)
        {
            var t = new JObject { ["id"] = o.Id };
            t["eligible"] = o.Eligible;
            if (o.GameData != null) t["gameData"] = ValueMap(o.GameData);
            return t;
        }

        private static JToken Str(string s) => s == null ? (JToken)JValue.CreateNull() : new JValue(s);

        private static JObject IntMap(Dictionary<string, int> m)
        {
            var o = new JObject();
            foreach (var kv in m ?? new Dictionary<string, int>()) o[kv.Key] = kv.Value;
            return o;
        }

        private static JObject ValueMap(IEnumerable<KeyValuePair<string, ExprValue>> m)
        {
            var o = new JObject();
            if (m != null) foreach (var kv in m) o[kv.Key] = ValueToken(kv.Value);
            return o;
        }

        /// <summary>Sections of values (key -> name -> value): a registry's, or a flow state's scene bags.</summary>
        private static JObject SectionMap<TValues>(IEnumerable<KeyValuePair<string, TValues>> m)
            where TValues : IEnumerable<KeyValuePair<string, ExprValue>>
        {
            var o = new JObject();
            foreach (var kv in m) o[kv.Key] = ValueMap(kv.Value);
            return o;
        }

        /// <summary>Selector cursors in the family's shape: every key optional, present once used - `seq`
        /// after the first sequential pick, `bag` once a shuffle has drawn, `last` once there is a
        /// no-repeat memory. Presence IS the "started" flag; nothing else is written.</summary>
        private static JObject SelectorMap(Dictionary<string, SelectorState> m)
        {
            var o = new JObject();
            foreach (var kv in m ?? new Dictionary<string, SelectorState>())
            {
                var s = new JObject();
                if (kv.Value.Seq.HasValue) s["seq"] = kv.Value.Seq.Value;
                if (kv.Value.Bag != null) s["bag"] = JArray.FromObject(kv.Value.Bag);
                if (kv.Value.Last != null) s["last"] = kv.Value.Last;
                o[kv.Key] = s;
            }
            return o;
        }

        public static JToken ValueToken(ExprValue v)
        {
            switch (v.Kind)
            {
                case ExprKind.Bool: return v.AsBool;
                case ExprKind.Number: return v.AsNumber;
                case ExprKind.Str: return v.AsString;
                case ExprKind.Flags: return JArray.FromObject(v.AsFlags ?? new List<string>());
                default: throw new JsonSerializationException($"unsupported ExprValue kind: {v.Kind}");
            }
        }

        // -- reading: the family's shape, versions 3 and 4 -----------------------------------------

        private static JToken Get(JObject o, string key) => o?.GetValue(key, StringComparison.Ordinal);
        private static JObject Obj(JObject o, string key) => Get(o, key) as JObject;

        private static string StrOrNull(JObject o, string key)
        {
            var t = Get(o, key);
            return t == null || t.Type == JTokenType.Null ? null : (string)t;
        }

        // A finite number, or null when the key is absent or holds anything else.
        private static double? NumOrNull(JObject o, string key)
        {
            var t = Get(o, key);
            if (t == null || (t.Type != JTokenType.Integer && t.Type != JTokenType.Float)) return null;
            double v = (double)t;
            return double.IsNaN(v) || double.IsInfinity(v) ? (double?)null : v;
        }

        private static SaveGame ReadSave(JObject o)
        {
            // Missing, or not an object: null, which the engine refuses as a malformed save before it changes.
            Dictionary<string, FlowSnapshot> flows = null;
            var fl = Obj(o, "flows");
            if (fl != null)
            {
                flows = new Dictionary<string, FlowSnapshot>();
                foreach (var p in fl.Properties()) flows[p.Name] = ReadFlow(p.Value as JObject ?? new JObject(), new FlowSnapshot());
            }
            var save = new SaveGame
            {
                Version = ReadVersion(Get(o, "version")),
                Registry = ReadRegistry(Obj(o, "registry")),
                SharedVisits = ReadIntMap(Obj(o, "sharedVisits")),
                SharedSelectors = ReadSelectorMap(Obj(o, "sharedSelectors")),
                Flows = flows,
            };
            return save;
        }

        /// <summary>The save's (or flow state's) version, which must be a whole number: a string or a fraction is
        /// refused here with the engine's own sentence, where a cast would have read "3" or 3.9 as a version it
        /// accepts. Absent reads as 0, which the engine refuses.</summary>
        private static int ReadVersion(JToken v, string what = "save")
        {
            if (v == null || v.Type == JTokenType.Null) return 0;
            if (v.Type == JTokenType.Integer || v.Type == JTokenType.Float)
            {
                double d = (double)v;
                if (d == Math.Floor(d) && d >= int.MinValue && d <= int.MaxValue) return (int)d;
            }
            string shown = v.Type == JTokenType.String ? (string)v
                : v.ToString(Formatting.None);
            throw new Exception($"unsupported {what} version: {shown}");
        }

        /// <summary>A save's `registry` section (registry key -> name -> value), in document
        /// order; null when absent (a game that passed its own registry saves it separately).</summary>
        private static OrderedMap<string, OrderedMap<string, ExprValue>> ReadRegistry(JObject o)
        {
            if (o == null) return null;
            var m = new OrderedMap<string, OrderedMap<string, ExprValue>>();
            foreach (var p in o.Properties())
            {
                var values = new OrderedMap<string, ExprValue>();
                if (p.Value is JObject section) foreach (var v in section.Properties()) values.Set(v.Name, ReadValue(v.Value));
                m.Set(p.Name, values);
            }
            return m;
        }

        /// <summary>A flow as a save writes it, read onto <paramref name="snapshot"/>: a FlowSnapshot, or the
        /// FlowState <see cref="ReadFlowState"/> reads (with its own values).</summary>
        private static T ReadFlow<T>(JObject f, T snapshot) where T : FlowSnapshot
        {
            var c = Obj(f, "cursor") ?? new JObject();
            var stack = new List<StackFrame>();
            if (Get(c, "stack") is JArray frames)
                foreach (var e in frames)
                    if (e is JObject fr)
                        stack.Add(new StackFrame
                        {
                            SceneId = StrOrNull(fr, "sceneId"), ContainerId = StrOrNull(fr, "containerId"),
                            Index = (int?)Get(fr, "index") ?? 0, NextId = StrOrNull(fr, "nextId"),
                            ChoiceId = StrOrNull(fr, "choiceId"),
                        });

            List<SavedChoiceOption> pendingOptions = null;
            string pendingGroupId = null;
            if (Get(c, "pendingChoice") is JObject choice)
            {
                pendingGroupId = StrOrNull(choice, "groupId");
                pendingOptions = ReadOptions(Get(choice, "options") as JArray);
            }

            // Through ToUint32: the JS runtime wrote this SIGNED until it was fixed.
            snapshot.RngState = Mulberry32.ToUint32((double?)Get(f, "rngState") ?? 0);
            snapshot.Visits = ReadIntMap(Obj(f, "visits"));
            snapshot.FlowEnded = (bool?)Get(c, "flowEnded") ?? false;
            snapshot.RanDry = Get(c, "ranDry") is JToken rd && rd.Type == JTokenType.String ? (string)rd : null;
            snapshot.CurrentSceneId = StrOrNull(c, "currentSceneId");
            snapshot.Stack = stack;
            snapshot.ActiveSnippetId = StrOrNull(c, "activeSnippetId");
            snapshot.BeatId = StrOrNull(c, "beatId");
            var beatIndex = Get(c, "beatIndex");   // version 3 only
            snapshot.BeatIndex = beatIndex != null && beatIndex.Type == JTokenType.Integer ? (int)beatIndex : (int?)null;
            snapshot.PendingOptions = pendingOptions;
            snapshot.PendingGroupId = pendingGroupId;
            snapshot.PendingPromptOwnerId = StrOrNull(c, "pendingPromptOwnerId");
            snapshot.PendingPrompt = Obj(c, "pendingPrompt") is JObject pp ? ReadPrompt(pp) : null;
            snapshot.Selectors = ReadSelectorMap(Obj(c, "selectors"));
            // A flow state's own values: `scopes.patter` and `sceneBags`.
            if (snapshot is FlowState state)
            {
                state.Scopes = ReadValueMap(Obj(Obj(f, "scopes"), "patter"));
                state.SceneBags = ReadBagMap(Obj(f, "sceneBags"));
            }
            return snapshot;
        }

        // A pending choice's options. A version 3 save's option also has its prompt text, which is discarded:
        // the prompt is built again, in the language in use, when the choice is delivered.
        private static List<SavedChoiceOption> ReadOptions(JArray arr)
        {
            var list = new List<SavedChoiceOption>();
            if (arr == null) return list;
            foreach (var e in arr)
            {
                if (!(e is JObject o)) continue;
                var opt = new SavedChoiceOption { Id = StrOrNull(o, "id"), Eligible = (bool?)Get(o, "eligible") ?? false };
                if (Obj(o, "gameData") is JObject gd)
                {
                    opt.GameData = new GameData();
                    foreach (var kv in ReadValueMap(gd)) opt.GameData[kv.Key] = kv.Value;
                }
                list.Add(opt);
            }
            return list;
        }

        private static Dictionary<string, ExprValue> ReadValueMap(JObject o)
        {
            var m = new Dictionary<string, ExprValue>();
            if (o != null) foreach (var p in o.Properties()) m[p.Name] = ReadValue(p.Value);
            return m;
        }

        private static Dictionary<string, int> ReadIntMap(JObject o)
        {
            var m = new Dictionary<string, int>();
            if (o != null) foreach (var p in o.Properties()) m[p.Name] = (int)p.Value;
            return m;
        }

        private static Dictionary<string, Dictionary<string, ExprValue>> ReadBagMap(JObject o)
        {
            var m = new Dictionary<string, Dictionary<string, ExprValue>>();
            if (o != null) foreach (var p in o.Properties()) m[p.Name] = ReadValueMap(p.Value as JObject);
            return m;
        }

        private static Dictionary<string, SelectorState> ReadSelectorMap(JObject o)
        {
            var m = new Dictionary<string, SelectorState>();
            if (o == null) return m;
            foreach (var p in o.Properties())
            {
                var s = p.Value as JObject ?? new JObject();
                var st = new SelectorState();
                var seq = Get(s, "seq");
                if (seq != null && seq.Type != JTokenType.Null) st.Seq = (int)seq;
                if (Get(s, "bag") is JArray bag) st.Bag = bag.Select(x => (string)x).ToList();
                st.Last = StrOrNull(s, "last");
                m[p.Name] = st;
            }
            return m;
        }

        public static ExprValue ReadValue(JToken tok)
        {
            switch (tok.Type)
            {
                case JTokenType.Boolean: return ExprValue.Bool((bool)tok);
                case JTokenType.Integer:
                case JTokenType.Float: return ExprValue.Num((double)tok);
                case JTokenType.String: return ExprValue.Str((string)tok);
                case JTokenType.Array:
                {
                    var list = new List<string>();
                    foreach (var x in (JArray)tok) list.Add((string)x);
                    return ExprValue.Flags(list);
                }
                default: throw new JsonSerializationException($"unsupported ExprValue token: {tok.Type}");
            }
        }
    }
}
