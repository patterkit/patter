// A Patter World: the game's `@world`, as a component you add in the editor. Put one on a GameObject, set its
// values from your game (SetBool, SetNumber, SetString, SetFlags), and set it as a Patter Runner's World (or pass
// it to PatterBundleAsset.CreateEngineWithWorld(world)). The story then reads and writes your game's values, not the
// declared defaults (a name you haven't set still reads its declared default; the engine never writes it here).
//
// It's bound through the same host-scopes path as EngineOptions.HostScopes, under the token "world": an
// external scope the game keeps, never saved by Patterplay (save it with your game). Same shape as Unreal's
// UPatterWorld (typed Set*/Get*, Names, SetReadOnly, a Changed event that tells host writes from story writes).
//
// A game that already keeps its state somewhere else can subclass this and override Get and Set to read and
// write its own, or put its own component implementing IHostScope in the World field instead.

using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Events;
using Wildwinter.Expr;

namespace Patterkit.Patterplay
{
    /// <summary>A change to a Patter World: the name, and whether the story wrote it (false for the game's own
    /// writes). Read the value with the World's Get* calls.</summary>
    [Serializable] public sealed class PatterWorldChangedEvent : UnityEvent<string, bool> { }

    [AddComponentMenu("Patterplay/Patter World")]
    public class PatterWorld : MonoBehaviour, IHostScope
    {
        // Made on first use rather than in a constructor, which Unity calls at times of its own choosing.
        private WorldValues _store;
        private WorldValues Store => _store ?? (_store = new WorldValues { Changed = RaiseChanged });

        /// <summary>Every change: the name as written, the new value, and whether the story wrote it.</summary>
        public event Action<string, ExprValue, bool> Changed;

        [Tooltip("Raised on every change: the name, and whether the story wrote it (false for the game's own writes).")]
        public PatterWorldChangedEvent OnChanged = new PatterWorldChangedEvent();

        // --- the host's writes (never refused) ---------------------------------------

        public void SetBool(string name, bool value) => Store.HostSet(name, ExprValue.Bool(value));
        public void SetNumber(string name, double value) => Store.HostSet(name, ExprValue.Num(value));
        public void SetString(string name, string value) => Store.HostSet(name, ExprValue.Str(value));
        public void SetFlags(string name, IEnumerable<string> values) => Store.HostSet(name, ExprValue.Flags(values ?? Array.Empty<string>()));

        // --- reads (the type's default when the name is unset) ----------------------

        /// <summary>Whether the name has a value (names match case-insensitively).</summary>
        public bool Has(string name) => Store.Has(name);
        public bool GetBool(string name) { var v = Get(name); return v != null && v.IsBool && v.AsBool; }
        public double GetNumber(string name) { var v = Get(name); return v != null && v.IsNumber ? v.AsNumber : 0; }
        /// <summary>The value as text (any type), or "" when unset.</summary>
        public string GetString(string name) => Get(name)?.ToDisplayString() ?? "";
        /// <summary>A copy of the flags, or an empty list when unset or not flags.</summary>
        public List<string> GetFlags(string name) { var v = Get(name); return v != null && v.IsFlags ? new List<string>(v.AsFlags) : new List<string>(); }
        /// <summary>Every name with a value, in first-set order, as first written.</summary>
        public List<string> Names() => Store.Names();

        // --- the game's policy ---------------------------------------------------------

        /// <summary>Refuse story writes to this name (the game's alone: a clock, a flag the story only reads).
        /// The game's own Set* calls still land. A refused write is reported through the engine's OnError and
        /// the story plays on.</summary>
        public void SetReadOnly(string name, bool readOnly) => Store.SetReadOnly(name, readOnly);
        public bool IsReadOnly(string name) => Store.IsReadOnly(name);

        // --- what the engine calls (IHostScope) -----------------------------------------

        /// <summary>The engine's read: the current value, or null when unset (the story then reads the name's
        /// declared default, as it would with no World set; nothing is written here). The engine hands names
        /// folded to lower case. Override to read your game's own state.</summary>
        public virtual ExprValue Get(string name) => Store.Get(name);

        /// <summary>The engine's write (the story's effects, and Engine.SetProperty on `@world`): refused, by
        /// throwing, for a name made read-only with SetReadOnly. Override to write your game's own state.</summary>
        public virtual void Set(string name, ExprValue value) => Store.Set(name, value);

        private void RaiseChanged(string name, ExprValue value, bool fromStory)
        {
            Changed?.Invoke(name, value, fromStory);
            OnChanged?.Invoke(name, fromStory);
        }
    }
}
