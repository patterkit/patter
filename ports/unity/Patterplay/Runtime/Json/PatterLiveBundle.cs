// Live bundle refresh - the game-side applier (the C# parity of @patterkit/play-helpers'
// applyLiveBundle). The editor pushes {t:"bundle", build, data} over the debug link; the game
// drains it on ITS OWN thread (PatterDebugLink.TryReceive, e.g. from Update()) and applies:
//   - same StructureHash  -> tier 1: engine.ReplaceStrings() - nothing restarts.
//   - changed structure   -> tier 2: engine.HotSwap() - the run carried over, content drift
//                            resolved by the save system (the shared corpus rules).
// Wire-up (in a MonoBehaviour's Update, behind your debug flag):
//
//   if (_link.TryReceive(out var raw) && PatterLiveBundle.TryParsePush(raw, out var build, out var data))
//   {
//       var r = PatterLiveBundle.Apply(_engine, _bundle, data);
//       _engine = r.Engine; _bundle = r.Bundle;
//       if (r.Kind == "structure") _flow = _engine.GetFlow("main"); // re-bind your flow handles
//       _link.SetBuild(build);
//   }
//
// Lives in the Json assembly (needs Newtonsoft to parse the envelope + bundle); pure, so it is
// corpus-compile-verified in the dotnet TestHost too.

using Newtonsoft.Json.Linq;

namespace Patterkit.Patterplay
{
    /// <summary>What applying a pushed bundle produced: the engine to keep using (the SAME instance
    /// for "text", a REPLACEMENT for "structure" - re-bind flow handles via GetFlow), the parsed
    /// bundle for the next comparison, and which tier applied.</summary>
    public sealed class PatterLiveBundleResult
    {
        public Engine Engine;
        public Bundle Bundle;
        /// <summary>"text" (strings-only, nothing restarted) or "structure" (full hot swap).</summary>
        public string Kind;
    }

    public static class PatterLiveBundle
    {
        /// <summary>Parse an editor push frame. True only for a well-formed
        /// <c>{t:"bundle", build, data}</c> message; anything else is not for us.</summary>
        public static bool TryParsePush(string rawMessage, out string build, out string data)
        {
            build = null; data = null;
            try
            {
                var msg = JObject.Parse(rawMessage);
                if ((string)msg["t"] != "bundle") return false;
                build = (string)msg["build"];
                data = (string)msg["data"];
                return build != null && data != null;
            }
            catch { return false; }
        }

        /// <summary>Apply a pushed bundle. <paramref name="current"/> is the bundle the engine is
        /// running (needed for the structure-hash comparison); <paramref name="data"/> is the pushed
        /// .patterc JSON. A missing StructureHash on either side (an older compiler) falls through to
        /// the full swap - safe, just less gentle than it could be.</summary>
        public static PatterLiveBundleResult Apply(Engine engine, Bundle current, string data)
        {
            var next = PatterBundleLoader.Parse(data);
            bool sameStructure = current?.StructureHash != null && current.StructureHash == next.StructureHash;
            if (sameStructure)
            {
                engine.ReplaceStrings(next);
                return new PatterLiveBundleResult { Engine = engine, Bundle = next, Kind = "text" };
            }
            return new PatterLiveBundleResult { Engine = engine.HotSwap(next), Bundle = next, Kind = "structure" };
        }
    }
}
