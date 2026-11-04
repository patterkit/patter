// Play in game - reading the editor's request (the C# parity of @patterkit/play-helpers' onPlay).
// Patterpad's Play in game asks the running game to start a block now: {t:"play", v:1, id, sceneId,
// blockId, takeOver, build?}. The game drains it on ITS OWN thread (PatterDebugLink.TryReceive, e.g.
// from Update()), starts the block however it plays conversations, and answers with ReplyPlay:
//
//   while (_link.TryReceive(out var raw))
//   {
//       if (PatterPlayInGame.TryParsePlay(raw, out var req))
//       {
//           var started = TryStart(req.SceneId, req.BlockId, req.TakeOver);   // your game's own
//           _link.ReplyPlay(req.Id, started ? new PatterPlayResult { Started = true }
//               : new PatterPlayResult { Started = false, Reason = "busy", Detail = "Mara is talking" });
//       }
//       else if (PatterLiveBundle.TryParsePush(raw, out var build, out var data)) { /* ... */ }
//   }
//
// A game that drains frames but doesn't handle play should still answer, with Reason = "unhandled",
// so the editor isn't left waiting. Lives in the Json assembly (needs Newtonsoft to parse the frame).

using Newtonsoft.Json.Linq;

namespace Patterkit.Patterplay
{
    public static class PatterPlayInGame
    {
        /// <summary>The Reason to answer with when the game doesn't handle Play in game.</summary>
        public const string Unhandled = "unhandled";

        /// <summary>Parse an editor frame. True only for a well-formed <c>{t:"play", id, sceneId,
        /// blockId}</c> message; anything else is not for us. A missing takeOver reads as false and a
        /// missing build as null.</summary>
        public static bool TryParsePlay(string rawMessage, out PatterPlayRequest request)
        {
            request = null;
            try
            {
                var msg = JObject.Parse(rawMessage);
                if ((string)msg["t"] != "play") return false;
                var id = msg["id"]?.Type == JTokenType.String ? (string)msg["id"] : null;
                var sceneId = msg["sceneId"]?.Type == JTokenType.String ? (string)msg["sceneId"] : null;
                var blockId = msg["blockId"]?.Type == JTokenType.String ? (string)msg["blockId"] : null;
                if (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(sceneId) || string.IsNullOrEmpty(blockId)) return false;
                var build = msg["build"]?.Type == JTokenType.String ? (string)msg["build"] : null;
                request = new PatterPlayRequest
                {
                    Id = id, SceneId = sceneId, BlockId = blockId,
                    TakeOver = msg["takeOver"]?.Type == JTokenType.Boolean && (bool)msg["takeOver"],
                    Build = string.IsNullOrEmpty(build) ? null : build,
                };
                return true;
            }
            catch { return false; }
        }
    }
}
