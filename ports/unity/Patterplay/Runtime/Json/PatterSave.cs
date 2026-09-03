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
// Reading accepts three shapes. The canonical one; the shape this port wrote before 0.11.0 (PascalCase
// keys, flat `Shared` and `Scopes`, cursor fields flat on the flow, `PendingOptions` + `PendingGroupId`),
// so a player's save on disk still loads; and a bare version-2 snapshot with no envelope, as before.
// Lookups are case-insensitive, so the first two share one reader.
//
// Pure (no UnityEngine), so it is corpus-verified in the dotnet TestHost too.

using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Patterkit.Patterplay
{
    /// <summary>PatterValue as JSON: bool / number / string / flags (a string array). A save value is a
    /// bare scalar, never an object - the two-level scope maps are handled by the save reader itself.</summary>
    public sealed class PatterValueConverter : JsonConverter<PatterValue>
    {
        public override void WriteJson(JsonWriter w, PatterValue v, JsonSerializer s) => PatterSave.ValueToken(v).WriteTo(w);

        public override PatterValue ReadJson(JsonReader r, Type t, PatterValue existing, bool hasExisting, JsonSerializer s)
            => PatterSave.ReadValue(JToken.Load(r));
    }

    /// <summary>
    /// Reads a persisted uint that may have been written SIGNED. The JS runtime accumulated
    /// its rngState with `| 0` until this was fixed, so saves in the wild carry a negative
    /// number where the schema says uint32; Newtonsoft's default binding throws an
    /// OverflowException on those. Coerce with the same ToUint32 every other runtime uses,
    /// so an old save loads and lands on the identical PRNG position.
    /// </summary>
    public sealed class Uint32Converter : JsonConverter<uint>
    {
        public override void WriteJson(JsonWriter w, uint v, JsonSerializer s) => w.WriteValue(v);

        public override uint ReadJson(JsonReader r, Type t, uint existing, bool hasExisting, JsonSerializer s)
        {
            var tok = JToken.Load(r);
            return Mulberry32.ToUint32((double)tok);
        }
    }

    public static class PatterSave
    {
        public const string Schema = "patter/save@0";

        /// <summary>Serialise the whole game (shared state, visits, every live flow) to a tagged JSON string.</summary>
        public static string SerializeState(Engine engine) => Envelope(engine.SaveGame()).ToString(Formatting.None);

        /// <summary>The tagged envelope as a JObject: `{ schema, save }`, the save in the family's shape.</summary>
        public static JObject Envelope(SaveGame s) => new JObject { ["schema"] = Schema, ["save"] = SaveToken(s) };

        /// <summary>Restore a {@link SerializeState} string into an engine. Throws on a foreign envelope.</summary>
        public static void DeserializeState(Engine engine, string json)
        {
            var root = JObject.Parse(json);
            JObject save;
            var schema = root["schema"];
            if (schema != null)
            {
                if ((string)schema != Schema) throw new Exception($"PatterSave: not a {Schema} envelope");
                save = root["save"] as JObject;
                if (save == null) throw new Exception($"PatterSave: not a {Schema} envelope");
            }
            else if (Get(root, "version") != null) save = root; // bare snapshot (a file from before the envelope)
            else throw new Exception($"PatterSave: not a {Schema} envelope");
            engine.LoadGame(ReadSave(save));
        }

        // -- writing: literal keys, in the JS reference's order -----------------------------------

        private static JObject SaveToken(SaveGame s)
        {
            var flows = new JObject();
            foreach (var kv in s.Flows ?? new Dictionary<string, FlowSnapshot>()) flows[kv.Key] = FlowToken(kv.Value);
            return new JObject
            {
                ["version"] = s.Version,
                ["shared"] = new JObject { ["patter"] = ValueMap(s.Shared) },   // owned scope -> name -> value
                ["sharedVisits"] = IntMap(s.SharedVisits),
                ["sharedSelectors"] = SelectorMap(s.SharedSelectors),
                ["stageBags"] = BagMap(s.StageBags),
                ["flows"] = flows,
            };
        }

        private static JObject FlowToken(FlowSnapshot f)
        {
            var stack = new JArray();
            foreach (var fr in f.Stack ?? new List<StackFrame>())
            {
                var frame = new JObject { ["sceneId"] = fr.SceneId, ["containerId"] = fr.ContainerId, ["index"] = fr.Index };
                if (fr.NextId != null) frame["nextId"] = fr.NextId;   // absent at a container's end, as the JS writes it
                stack.Add(frame);
            }
            JToken pending = JValue.CreateNull();
            if (f.PendingOptions != null)
            {
                var options = new JArray();
                foreach (var o in f.PendingOptions) options.Add(OptionToken(o));
                pending = new JObject { ["groupId"] = f.PendingGroupId, ["options"] = options };
            }
            return new JObject
            {
                ["scopes"] = new JObject { ["patter"] = ValueMap(f.Scopes) },
                ["sceneBags"] = BagMap(f.SceneBags),
                ["rngState"] = f.RngState,
                ["visits"] = IntMap(f.Visits),
                // The execution position sits under `cursor`; absent ids are null, not "".
                ["cursor"] = new JObject
                {
                    ["flowEnded"] = f.FlowEnded,
                    ["currentSceneId"] = Str(f.CurrentSceneId),
                    ["stack"] = stack,
                    ["activeSnippetId"] = Str(f.ActiveSnippetId),
                    ["beatIndex"] = f.BeatIndex,
                    ["pendingChoice"] = pending,
                    ["pendingPromptOwnerId"] = Str(f.PendingPromptOwnerId),
                    ["selectors"] = SelectorMap(f.Selectors),
                },
            };
        }

        private static JObject OptionToken(ChoiceOption o)
        {
            var t = new JObject { ["id"] = o.Id };
            if (o.Prompt != null)
            {
                // Optional prompt fields are absent, not empty, when the option has none (the JS shape).
                var p = new JObject { ["kind"] = o.Prompt.Kind, ["text"] = o.Prompt.Text ?? "" };
                if (o.Prompt.Character != null) p["character"] = o.Prompt.Character;
                if (o.Prompt.CharacterName != null) p["characterName"] = o.Prompt.CharacterName;
                if (o.Prompt.Direction != null) p["direction"] = o.Prompt.Direction;
                t["prompt"] = p;
            }
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

        private static JObject ValueMap(IEnumerable<KeyValuePair<string, PatterValue>> m)
        {
            var o = new JObject();
            if (m != null) foreach (var kv in m) o[kv.Key] = ValueToken(kv.Value);
            return o;
        }

        private static JObject BagMap(Dictionary<string, Dictionary<string, PatterValue>> m)
        {
            var o = new JObject();
            foreach (var kv in m ?? new Dictionary<string, Dictionary<string, PatterValue>>()) o[kv.Key] = ValueMap(kv.Value);
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

        public static JToken ValueToken(PatterValue v)
        {
            switch (v.Kind)
            {
                case PatterKind.Bool: return v.AsBool;
                case PatterKind.Number: return v.AsNumber;
                case PatterKind.Str: return v.AsString;
                case PatterKind.Flags: return JArray.FromObject(v.AsFlags ?? new List<string>());
                default: throw new JsonSerializationException($"unsupported PatterValue kind: {v.Kind}");
            }
        }

        // -- reading: the family's shape, this port's pre-0.11.0 shape, or a bare snapshot ----------

        private static JToken Get(JObject o, string key) => o?.GetValue(key, StringComparison.OrdinalIgnoreCase);
        private static JObject Obj(JObject o, string key) => Get(o, key) as JObject;

        private static string StrOrNull(JObject o, string key)
        {
            var t = Get(o, key);
            return t == null || t.Type == JTokenType.Null ? null : (string)t;
        }

        private static SaveGame ReadSave(JObject o)
        {
            var flows = new Dictionary<string, FlowSnapshot>();
            var fl = Obj(o, "flows");
            if (fl != null) foreach (var p in fl.Properties()) flows[p.Name] = ReadFlow(p.Value as JObject ?? new JObject());
            return new SaveGame
            {
                Version = (int?)Get(o, "version") ?? 0,
                Shared = ReadScope(Obj(o, "shared")),
                SharedVisits = ReadIntMap(Obj(o, "sharedVisits")),
                SharedSelectors = ReadSelectorMap(Obj(o, "sharedSelectors")),
                StageBags = ReadBagMap(Obj(o, "stageBags")),
                Flows = flows,
            };
        }

        /// <summary>`{ patter: { name: value } }` (the family's two-level shape), or the bare
        /// `{ name: value }` this port wrote before 0.11.0. A flat map's values are scalars and arrays,
        /// never objects, which is what tells the two apart.</summary>
        private static Dictionary<string, PatterValue> ReadScope(JObject o)
        {
            if (o == null || o.Count == 0) return new Dictionary<string, PatterValue>();
            bool twoLevel = o.Properties().All(p => p.Value.Type == JTokenType.Object);
            return ReadValueMap(twoLevel ? Obj(o, "patter") : o);
        }

        private static FlowSnapshot ReadFlow(JObject f)
        {
            var c = Obj(f, "cursor") ?? f;   // the family nests the cursor; this port's old shape kept it flat
            var stack = new List<StackFrame>();
            if (Get(c, "stack") is JArray frames)
                foreach (var e in frames)
                    if (e is JObject fr)
                        stack.Add(new StackFrame
                        {
                            SceneId = StrOrNull(fr, "sceneId"), ContainerId = StrOrNull(fr, "containerId"),
                            Index = (int?)Get(fr, "index") ?? 0, NextId = StrOrNull(fr, "nextId"),
                        });

            List<ChoiceOption> pendingOptions = null;
            string pendingGroupId = null;
            if (Get(c, "pendingChoice") is JObject choice)
            {
                pendingGroupId = StrOrNull(choice, "groupId");
                pendingOptions = ReadOptions(Get(choice, "options") as JArray);
            }
            else if (Get(c, "pendingOptions") is JArray legacyOptions)   // pre-0.11.0: flat beside the group id
            {
                pendingOptions = ReadOptions(legacyOptions);
                pendingGroupId = StrOrNull(c, "pendingGroupId");
            }

            return new FlowSnapshot
            {
                Scopes = ReadScope(Obj(f, "scopes")),
                SceneBags = ReadBagMap(Obj(f, "sceneBags")),
                // Through ToUint32: the JS runtime wrote this SIGNED until it was fixed.
                RngState = Mulberry32.ToUint32((double?)Get(f, "rngState") ?? 0),
                Visits = ReadIntMap(Obj(f, "visits")),
                FlowEnded = (bool?)Get(c, "flowEnded") ?? false,
                CurrentSceneId = StrOrNull(c, "currentSceneId"),
                Stack = stack,
                ActiveSnippetId = StrOrNull(c, "activeSnippetId"),
                BeatIndex = (int?)Get(c, "beatIndex") ?? 0,
                PendingOptions = pendingOptions,
                PendingGroupId = pendingGroupId,
                PendingPromptOwnerId = StrOrNull(c, "pendingPromptOwnerId"),
                Selectors = ReadSelectorMap(Obj(c, "selectors")),
            };
        }

        private static List<ChoiceOption> ReadOptions(JArray arr)
        {
            var list = new List<ChoiceOption>();
            if (arr == null) return list;
            foreach (var e in arr)
            {
                if (!(e is JObject o)) continue;
                var opt = new ChoiceOption { Id = StrOrNull(o, "id"), Eligible = (bool?)Get(o, "eligible") ?? false };
                if (Obj(o, "prompt") is JObject p)
                    opt.Prompt = new ChoicePrompt
                    {
                        Kind = StrOrNull(p, "kind"), Text = StrOrNull(p, "text"), Character = StrOrNull(p, "character"),
                        CharacterName = StrOrNull(p, "characterName"), Direction = StrOrNull(p, "direction"),
                    };
                if (Obj(o, "gameData") is JObject gd)
                {
                    opt.GameData = new GameData();
                    foreach (var kv in ReadValueMap(gd)) opt.GameData[kv.Key] = kv.Value;
                }
                list.Add(opt);
            }
            return list;
        }

        private static Dictionary<string, PatterValue> ReadValueMap(JObject o)
        {
            var m = new Dictionary<string, PatterValue>();
            if (o != null) foreach (var p in o.Properties()) m[p.Name] = ReadValue(p.Value);
            return m;
        }

        private static Dictionary<string, int> ReadIntMap(JObject o)
        {
            var m = new Dictionary<string, int>();
            if (o != null) foreach (var p in o.Properties()) m[p.Name] = (int)p.Value;
            return m;
        }

        private static Dictionary<string, Dictionary<string, PatterValue>> ReadBagMap(JObject o)
        {
            var m = new Dictionary<string, Dictionary<string, PatterValue>>();
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

        public static PatterValue ReadValue(JToken tok)
        {
            switch (tok.Type)
            {
                case JTokenType.Boolean: return PatterValue.Bool((bool)tok);
                case JTokenType.Integer:
                case JTokenType.Float: return PatterValue.Num((double)tok);
                case JTokenType.String: return PatterValue.Str((string)tok);
                case JTokenType.Array:
                {
                    var list = new List<string>();
                    foreach (var x in (JArray)tok) list.Add((string)x);
                    return PatterValue.Flags(list);
                }
                default: throw new JsonSerializationException($"unsupported PatterValue token: {tok.Type}");
            }
        }
    }
}
