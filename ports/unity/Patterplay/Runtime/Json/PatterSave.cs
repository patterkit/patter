// Save / load the whole game as a JSON string (Newtonsoft) - the Unity editor "Save
// State…" button and any host that wants to persist a run. Mirrors @patterkit/play-helpers'
// serializeState/deserializeState: a tagged `patter/save@0` envelope around Engine.SaveGame().
// A custom converter handles PatterValue (bool / number / string / flags). Pure (no UnityEngine),
// so it is corpus-verified in the dotnet TestHost too.

using System;
using System.Collections.Generic;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Patterkit.Patterplay
{
    public sealed class PatterValueConverter : JsonConverter<PatterValue>
    {
        public override void WriteJson(JsonWriter w, PatterValue v, JsonSerializer s)
        {
            switch (v.Kind)
            {
                case PatterKind.Bool: w.WriteValue(v.AsBool); break;
                case PatterKind.Number: w.WriteValue(v.AsNumber); break;
                case PatterKind.Str: w.WriteValue(v.AsString); break;
                case PatterKind.Flags:
                    w.WriteStartArray();
                    foreach (var f in v.AsFlags) w.WriteValue(f);
                    w.WriteEndArray();
                    break;
            }
        }

        public override PatterValue ReadJson(JsonReader r, Type t, PatterValue existing, bool hasExisting, JsonSerializer s)
        {
            var tok = JToken.Load(r);
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

    public static class PatterSave
    {
        public const string Schema = "patter/save@0";

        private static readonly JsonSerializer Serializer =
            JsonSerializer.Create(new JsonSerializerSettings { Converters = { new PatterValueConverter() } });

        /// <summary>Serialise the whole game (shared state, visits, every live flow) to a tagged JSON string.</summary>
        public static string SerializeState(Engine engine)
        {
            var env = new JObject
            {
                ["schema"] = Schema,
                ["save"] = JToken.FromObject(engine.SaveGame(), Serializer),
            };
            return env.ToString(Formatting.None);
        }

        /// <summary>Restore a {@link SerializeState} string into an engine. Throws on a foreign envelope.</summary>
        public static void DeserializeState(Engine engine, string json)
        {
            var env = JObject.Parse(json);
            if ((string)env["schema"] != Schema)
                throw new Exception($"PatterSave: not a {Schema} envelope");
            var save = env["save"].ToObject<SaveGame>(Serializer);
            engine.LoadGame(save);
        }
    }
}
