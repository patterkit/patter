// gameData read helpers - sparse overrides resolved against per-type field defaults
// (merge-at-read). Port of @patterkit/runtime's gamedata.ts.

using System.Collections.Generic;
using Wildwinter.Expr;

namespace Patterkit.Patterplay
{
    public static class GameDataHelpers
    {
        /// <summary>The author-defined gameData fields declared for a node TYPE (empty when none).</summary>
        public static List<GameDataField> GameDataFields(Bundle bundle, string kind)
        {
            if (bundle.GameDataFields != null && bundle.GameDataFields.TryGetValue(kind, out var fields)) return fields;
            return new List<GameDataField>();
        }

        /// <summary>A node's FULL effective gameData: every declared field resolved (override or default),
        /// plus override-only orphan keys, in declared-then-orphan order. Fields with no value are omitted.</summary>
        public static GameData EffectiveGameData(List<GameDataField> fields, GameData node)
        {
            var outData = new GameData();
            foreach (var f in fields)
            {
                ExprValue v = GameDataValue(fields, node, f.Name);
                if (v != null) outData[f.Name] = v;
            }
            if (node != null)
                foreach (var kv in node)
                    if (!outData.ContainsKey(kv.Key)) outData[kv.Key] = kv.Value;
            return outData;
        }

        /// <summary>One node's effective value for a field: its sparse OVERRIDE if present, else the field's
        /// declared default (null if neither is set). <paramref name="fields"/> is the schema for the node's type.</summary>
        public static ExprValue GameDataValue(List<GameDataField> fields, GameData node, string name)
        {
            if (node != null && node.TryGetValue(name, out var v)) return v;
            foreach (var f in fields) if (f.Name == name) return f.Default;
            return null;
        }

        [System.Obsolete("Use GameDataFields, the name every Patterplay runtime uses.")]
        public static List<GameDataField> FieldsFor(Bundle bundle, string kind) => GameDataFields(bundle, kind);

        [System.Obsolete("Use EffectiveGameData, the name every Patterplay runtime uses.")]
        public static GameData Effective(List<GameDataField> fields, GameData node) => EffectiveGameData(fields, node);
    }
}
