// A tiny registry so the editor "Runtime State" window can watch live engines during
// play. In your game, after creating an Engine, call PatterDebug.Register(engine).

using System.Collections.Generic;

namespace Patterkit.Patterplay
{
    public static class PatterDebug
    {
        public static readonly List<Engine> Engines = new List<Engine>();
        public static void Register(Engine e) { if (e != null && !Engines.Contains(e)) Engines.Add(e); }
        public static void Unregister(Engine e) { Engines.Remove(e); }
    }
}
