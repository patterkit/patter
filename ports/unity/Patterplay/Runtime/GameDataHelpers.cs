// gameData read helpers - sparse overrides resolved against per-type field defaults
// (merge-at-read). Port of @patterkit/runtime's gamedata.ts.

using System.Collections.Generic;

namespace Patterkit.Patterplay
{
    public static class GameDataHelpers
    {
        /// <summary>The author-defined gameData fields declared for a node TYPE (empty when none).</summary>
        public static List<GameDataField> FieldsFor(Bundle bundle, string kind)
        {
            if (bundle.GameDataFields != null && bundle.GameDataFields.TryGetValue(kind, out var fields)) return fields;
            return new List<GameDataField>();
        }

        /// <summary>A node's FULL effective gameData: every declared field resolved (override or default),
        /// plus override-only orphan keys, in declared-then-orphan order. Fields with no value are omitted.</summary>
        public static GameData Effective(List<GameDataField> fields, GameData node)
        {
            var outData = new GameData();
            foreach (var f in fields)
            {
                PatterValue v = (node != null && node.ContainsKey(f.Name)) ? node[f.Name] : f.Default;
                if (v != null) outData[f.Name] = v;
            }
            if (node != null)
                foreach (var kv in node)
                    if (!outData.ContainsKey(kv.Key)) outData[kv.Key] = kv.Value;
            return outData;
        }
    }
}
