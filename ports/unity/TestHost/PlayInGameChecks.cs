// Play in game: PatterPlayInGame.TryParsePlay reads the editor's request as play-helpers' createDebugLink does (a
// well-formed play message only; takeOver false and build null when missing).

using System;

namespace Patterkit.Patterplay.TestHost
{
    internal static partial class Program
    {
        private static int RunPlayInGameChecks()
        {
            int pass = 0;
            void Check(string name, bool ok, string detail) { if (ok) pass++; else Fail("playInGame", name, detail); }

            Check("a full request",
                PatterPlayInGame.TryParsePlay("{\"t\":\"play\",\"v\":1,\"id\":\"p1\",\"sceneId\":\"s1\",\"blockId\":\"b1\",\"takeOver\":true,\"build\":\"h2\"}", out var r)
                && r.Id == "p1" && r.SceneId == "s1" && r.BlockId == "b1" && r.TakeOver && r.Build == "h2",
                "expected p1/s1/b1, takeOver, build h2");
            Check("takeOver and build missing",
                PatterPlayInGame.TryParsePlay("{\"t\":\"play\",\"id\":\"p2\",\"sceneId\":\"s1\",\"blockId\":\"b1\"}", out var r2)
                && !r2.TakeOver && r2.Build == null,
                "expected takeOver false and build null");
            Check("no block id", !PatterPlayInGame.TryParsePlay("{\"t\":\"play\",\"id\":\"p3\",\"sceneId\":\"s1\"}", out _), "accepted a request with no block");
            Check("an empty id", !PatterPlayInGame.TryParsePlay("{\"t\":\"play\",\"id\":\"\",\"sceneId\":\"s1\",\"blockId\":\"b1\"}", out _), "accepted an empty id");
            Check("a bundle push", !PatterPlayInGame.TryParsePlay("{\"t\":\"bundle\",\"build\":\"h\",\"data\":\"{}\"}", out _), "read a bundle push as play");
            Check("not JSON", !PatterPlayInGame.TryParsePlay("nope", out _), "read garbage as play");
            Console.WriteLine($"playInGame: {pass}/6");
            return pass;
        }
    }
}
