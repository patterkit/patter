// The engine-free half of binding a game's `@world` without code: the value store behind the PatterWorld
// component, and what PatterBundleAsset.CreateEngineWithWorld(world) and PatterRunnerBehaviour do with a World. It lives
// here, beside the engine, so the dotnet TestHost checks it (Runtime/Unity references UnityEngine and isn't
// compiled there); the Unity assembly reaches it through InternalsVisibleTo. Not public API: games use
// PatterWorld and CreateEngineWithWorld(world).
//
// The World is fed through the EXISTING host-scopes path, under the token "world": a World set in the editor
// is exactly an EngineOptions.HostScopes binding, with the same rules (a foreign scope, never saved by
// Patterplay, case-sensitive token, the declaration's writable rules).

using System;
using System.Collections.Generic;
using System.Linq;
using Wildwinter.Expr;

namespace Patterkit.Patterplay
{
    internal static class WorldBinding
    {
        /// <summary>The token a World binds. Case-sensitive, as every token is.</summary>
        internal const string Token = "world";

        /// <summary>Whether the bundle's scope registry declares `@world`.</summary>
        internal static bool Declares(Bundle bundle) =>
            bundle?.ScopeRegistry?.Scopes != null && bundle.ScopeRegistry.Scopes.Any(s => s != null && s.Token == Token);

        /// <summary>The options an engine is made with when a World is given: a copy of the caller's (never the
        /// caller's own, which they may reuse), with the world bound as "world" beside their other bindings.
        /// No world gives back the caller's options unchanged: no binding, as CreateEngine(options). Binding
        /// "world" in both places throws, rather than quietly picking one.</summary>
        internal static EngineOptions WithWorld(EngineOptions options, IHostScope world)
        {
            if (world == null) return options;
            if (options?.HostScopes != null && options.HostScopes.TryGetValue(Token, out var bound) && bound != null)
                throw new ArgumentException(
                    "CreateEngine was given a World, and its options' HostScopes already binds \"world\": bind @world in one place, not both",
                    nameof(world));
            var copy = options == null ? new EngineOptions() : options.Copy();
            copy.HostScopes = options?.HostScopes == null
                ? new Dictionary<string, IHostScope>()
                : new Dictionary<string, IHostScope>(options.HostScopes);
            copy.HostScopes[Token] = world;
            return copy;
        }

        /// <summary>The warning for an engine made from the editor with nothing bound, the same sentence on every
        /// engine. `who` names the component ("Patter Runner 'Bar'").</summary>
        internal static string UnboundWarning(string who) =>
            $"{who}: the story reads @world, but no World is set, so @world plays from its declared defaults and won't see your game. Set World to your game's Patter World.";
    }

    /// <summary>The values behind a PatterWorld: the game's `@world`, kept by the game. Names match
    /// case-insensitively (the registry hands the store names folded to lower case, where the game may write
    /// "hasKey"), and each keeps the spelling it was first written with for <see cref="Names"/>. Mirrors
    /// Unreal's UPatterWorld.
    ///
    /// Two read-only ideas meet here and stay distinct, as on Unreal. A `writable: false` DECLARATION is the
    /// story's promise, refused by the engine whether or not a world is bound. <see cref="SetReadOnly"/> is the
    /// GAME's policy: a name the story may read but this game won't let it write. <see cref="Set"/> (the
    /// engine's write) refuses it by throwing, which the engine reports as a failed effect and plays on past.
    /// The host's own <see cref="HostSet"/> is bound by neither.</summary>
    internal sealed class WorldValues : IHostScope
    {
        private readonly Dictionary<string, ExprValue> _values = new Dictionary<string, ExprValue>(StringComparer.OrdinalIgnoreCase);
        private readonly List<string> _order = new List<string>();   // names as first written, in first-set order
        private readonly HashSet<string> _readOnly = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        /// <summary>Every change: the name as written, the new value, and whether the story wrote it.</summary>
        internal Action<string, ExprValue, bool> Changed;

        /// <summary>The host's write (never refused).</summary>
        internal void HostSet(string name, ExprValue value)
        {
            Put(name, value);
            Changed?.Invoke(name, value, false);
        }

        /// <summary>The engine's write (the story's effects, and Engine.SetProperty on `@world`): refused, by
        /// throwing, for a name the game made read-only.</summary>
        public void Set(string name, ExprValue value)
        {
            if (IsReadOnly(name))
                throw new EvalError($"@world.{name} is the game's alone: a story tried to set it");
            Put(name, value);
            Changed?.Invoke(name, value, true);
        }

        /// <summary>The current value, or null when unset.</summary>
        public ExprValue Get(string name) => name != null && _values.TryGetValue(name, out var v) ? v : null;

        internal bool Has(string name) => name != null && _values.ContainsKey(name);

        internal List<string> Names() => new List<string>(_order);

        internal void SetReadOnly(string name, bool readOnly)
        {
            if (name == null) throw new ArgumentNullException(nameof(name));
            if (readOnly) _readOnly.Add(name); else _readOnly.Remove(name);
        }

        internal bool IsReadOnly(string name) => name != null && _readOnly.Contains(name);

        private void Put(string name, ExprValue value)
        {
            if (name == null) throw new ArgumentNullException(nameof(name));
            if (value == null) throw new ArgumentNullException(nameof(value));
            if (!_values.ContainsKey(name)) _order.Add(name);
            _values[name] = value;
        }
    }
}
