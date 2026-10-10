// The corpus's outline cases: what Engine.GetOutline and Engine.GetBeatSequence say about a bundle, held
// field for field to the reference's (the same names, and an absent optional field absent).

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;

namespace Patterkit.Patterplay.TestHost
{
    internal static partial class Program
    {
        private static int RunOutlines(JsonElement arr)
        {
            int pass = 0;
            foreach (var c in arr.EnumerateArray())
            {
                string name = c.GetProperty("name").GetString();
                try
                {
                    var engine = new Engine(_loader(c.GetProperty("bundle")));
                    var outline = engine.GetOutline().Select(OutlineSceneToObject).ToList();
                    var sequence = engine.GetBeatSequence().Select(FlatBeatToObject).ToList();
                    bool ok = true;
                    if (!MatchArray(outline, c.GetProperty("expectedOutline")))
                    {
                        ok = false;
                        Fail("outlines", name, $"outline mismatch\n    expected {c.GetProperty("expectedOutline")}\n    got      {Dump(outline)}");
                    }
                    if (!MatchArray(sequence, c.GetProperty("expectedBeatSequence")))
                    {
                        ok = false;
                        Fail("outlines", name, $"beat sequence mismatch\n    expected {c.GetProperty("expectedBeatSequence")}\n    got      {Dump(sequence)}");
                    }
                    if (ok) pass++;
                }
                catch (Exception ex) { Fail("outlines", name, ex.Message); }
            }
            return pass;
        }

        // The reference spreads an optional field in only when it has one (an empty gameId or selector
        // included), so each of these omits a null and, where the reference tests truthiness, an empty string.

        private static object OutlineSceneToObject(OutlineScene s)
        {
            var o = new Dictionary<string, object> { ["id"] = s.Id };
            if (!string.IsNullOrEmpty(s.GameId)) o["gameId"] = s.GameId;
            o["name"] = s.Name;
            if (s.GameData != null && s.GameData.Count > 0) o["gameData"] = GameDataToObject(s.GameData);
            if (s.Tags != null && s.Tags.Count > 0) o["tags"] = s.Tags.Cast<object>().ToList();
            o["blocks"] = s.Blocks.Select(OutlineBlockToObject).ToList();
            return o;
        }

        private static object OutlineBlockToObject(OutlineBlock b)
        {
            var o = new Dictionary<string, object> { ["id"] = b.Id };
            if (!string.IsNullOrEmpty(b.GameId)) o["gameId"] = b.GameId;
            o["name"] = b.Name;
            if (b.GameData != null && b.GameData.Count > 0) o["gameData"] = GameDataToObject(b.GameData);
            if (b.Tags != null && b.Tags.Count > 0) o["tags"] = b.Tags.Cast<object>().ToList();
            o["children"] = b.Children.Select(OutlineNodeToObject).ToList();
            return o;
        }

        private static object OutlineNodeToObject(OutlineNode n)
        {
            var o = new Dictionary<string, object> { ["type"] = n.Type, ["id"] = n.Id };
            if (n.Tags != null && n.Tags.Count > 0) o["tags"] = n.Tags.Cast<object>().ToList();
            if (n.Type == "group")
            {
                if (!string.IsNullOrEmpty(n.Selector)) o["selector"] = n.Selector;
                if (n.Prompt != null) o["prompt"] = BeatInfoToObject(n.Prompt);
                o["children"] = (n.Children ?? new List<OutlineNode>()).Select(OutlineNodeToObject).ToList();
                return o;
            }
            o["beats"] = (n.Beats ?? new List<BeatInfo>()).Select(BeatInfoToObject).ToList();
            if (n.JumpTo != null)
            {
                o["jumpTo"] = n.JumpTo;
                if (!string.IsNullOrEmpty(n.JumpMode)) o["jumpMode"] = n.JumpMode;
            }
            return o;
        }

        private static object BeatInfoToObject(BeatInfo b)
        {
            var o = new Dictionary<string, object> { ["id"] = b.Id, ["kind"] = b.Kind };
            if (b.Character != null) o["character"] = b.Character;
            if (b.CharacterName != null) o["characterName"] = b.CharacterName;
            if (b.Direction != null) o["direction"] = b.Direction;
            if (b.Qualifier != null) o["qualifier"] = b.Qualifier;
            if (b.QualifierName != null) o["qualifierName"] = b.QualifierName;
            if (b.Text != null) o["text"] = b.Text;
            if (b.GameData != null && b.GameData.Count > 0) o["gameData"] = GameDataToObject(b.GameData);
            if (b.Tags != null && b.Tags.Count > 0) o["tags"] = b.Tags.Cast<object>().ToList();
            return o;
        }

        private static object FlatBeatToObject(FlatBeat f) => new Dictionary<string, object>
        {
            ["sceneId"] = f.SceneId, ["blockId"] = f.BlockId, ["snippetId"] = f.SnippetId, ["beat"] = BeatInfoToObject(f.Beat),
        };
    }
}
