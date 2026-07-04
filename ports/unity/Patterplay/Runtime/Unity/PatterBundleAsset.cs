// A compiled .patterc imported into Unity as an asset (produced by the ScriptedImporter).
// Holds the bundle JSON and lazily parses it; call CreateEngine() to play. Separate from
// the pure engine (this references UnityEngine), so the core runtime stays engine-free.

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
    }
}
