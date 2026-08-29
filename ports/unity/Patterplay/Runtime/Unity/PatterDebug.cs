// A tiny registry so the editor "Runtime State" window can watch live engines during
// play. In your game, after creating an Engine, call PatterDebug.Register(engine).
//
// The references are WEAK, and that is the point: a debug registry is an OBSERVER, and an observer
// must not decide what stays alive. Held strongly, an engine the game replaced - a Restart button, a
// scene change, a live bundle swap - stayed alive with its whole compiled story for the life of the
// process, and nothing looked wrong: the window simply went on listing a run that had ended. A
// registry that only behaves when every host remembers to Unregister is one that fails quietly on the
// day somebody forgets. (from-storylets/weak-debug-registries; Unreal's FPatterDebug already did
// this, which is the inconsistency that prompted the note.)

using System;
using System.Collections.Generic;

namespace Patterkit.Patterplay
{
    public static class PatterDebug
    {
        private static readonly List<WeakReference<Engine>> Refs = new List<WeakReference<Engine>>();

        /// <summary>Live registered engines, collected ones pruned. A fresh list each read, so a
        /// caller iterating it cannot be surprised by a collection mid-loop.</summary>
        public static List<Engine> Engines
        {
            get
            {
                var live = new List<Engine>();
                Refs.RemoveAll(r => !r.TryGetTarget(out var e) || e == null);
                foreach (var r in Refs) if (r.TryGetTarget(out var e) && e != null) live.Add(e);
                return live;
            }
        }

        public static void Register(Engine e)
        {
            if (e == null) return;
            Refs.RemoveAll(r => !r.TryGetTarget(out var t) || t == null || ReferenceEquals(t, e));
            Refs.Add(new WeakReference<Engine>(e));
        }

        public static void Unregister(Engine e)
        {
            Refs.RemoveAll(r => !r.TryGetTarget(out var t) || t == null || ReferenceEquals(t, e));
        }

        // -- the live debug link ---------------------------------------------------
        // A registered link lets the Runtime State window say whether the editor is actually
        // listening. From inside a running game, "the editor is not listening" and "I never attached"
        // look identical, and that is the first question a link's user asks.

        private static readonly List<WeakReference<PatterDebugLink>> LinkRefs = new List<WeakReference<PatterDebugLink>>();

        /// <summary>Live registered links, collected ones pruned.</summary>
        public static List<PatterDebugLink> Links
        {
            get
            {
                var live = new List<PatterDebugLink>();
                LinkRefs.RemoveAll(r => !r.TryGetTarget(out var l) || l == null);
                foreach (var r in LinkRefs) if (r.TryGetTarget(out var l) && l != null) live.Add(l);
                return live;
            }
        }

        public static void RegisterLink(PatterDebugLink link)
        {
            if (link == null) return;
            LinkRefs.RemoveAll(r => !r.TryGetTarget(out var t) || t == null || ReferenceEquals(t, link));
            LinkRefs.Add(new WeakReference<PatterDebugLink>(link));
        }

        public static void UnregisterLink(PatterDebugLink link)
        {
            LinkRefs.RemoveAll(r => !r.TryGetTarget(out var t) || t == null || ReferenceEquals(t, link));
        }
    }
}
