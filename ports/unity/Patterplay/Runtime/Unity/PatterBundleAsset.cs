// A compiled .patterc imported into Unity as an asset (produced by the ScriptedImporter).
// Holds the bundle JSON and lazily parses it; call CreateEngine() to play, or CreateEngineWithWorld(world) to bind the
// game's @world too. Separate from the pure engine (this references UnityEngine), so the core runtime stays
// engine-free.

using UnityEngine;

namespace Patterkit.Patterplay
{
    public sealed class PatterBundleAsset : ScriptableObject
    {
        [SerializeField, HideInInspector] private string json;

        [System.NonSerialized] private Bundle _bundle;

        /// <summary>The raw compiled bundle JSON (the .patterc contents).</summary>
        public string Json
        {
            get => json;
            set { json = value; _bundle = null; }
        }

        /// <summary>The parsed bundle (cached). Throws if the JSON is malformed.</summary>
        public Bundle Bundle => _bundle ?? (_bundle = PatterBundleLoader.Parse(json));

        /// <summary>Construct a play-ready Engine on this bundle.</summary>
        public Engine CreateEngine(EngineOptions options = null) => new Engine(Bundle, options);

        /// <summary>Construct a play-ready Engine on this bundle with the game's `@world` bound: a
        /// <see cref="PatterWorld"/>, or any component of the game's implementing <see cref="IHostScope"/>.
        /// It's bound as <see cref="EngineOptions.HostScopes"/> binds one, under "world", beside any other
        /// bindings in <paramref name="options"/>, which are copied, never changed. A null world binds nothing,
        /// as CreateEngine(options). Throws ArgumentException when the options already bind "world".</summary>
        public Engine CreateEngineWithWorld(IHostScope world, EngineOptions options = null) =>
            new Engine(Bundle, WorldBinding.WithWorld(options, world));

        /// <summary>Whether the story declares `@world`, so an engine made with no World plays it from the
        /// declared defaults.</summary>
        public bool DeclaresWorld => WorldBinding.Declares(Bundle);
    }
}
