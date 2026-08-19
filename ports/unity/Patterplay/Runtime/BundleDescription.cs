// The bundle inspector's runtime half: describe a compiled bundle without running it. Port of the
// JS reference (packages/runtime/src/describe.ts); read that header for the argument, which is not
// repeated here.
//
// A BUNDLE-level function, deliberately NOT an Engine method. It answers the integrator's question
// from the imported asset alone, with no engine, no state and nothing running:
//
//     I dropped a .patterc into my project. What may my game code call, and is this the bundle I
//     think it is?
//
// That is a different question from the one PatterStateWindow answers: the examiner watches and
// edits a LIVE game, this is static, read off the asset before anything runs.
//
// Everything is in BUNDLE ORDER, never sorted: two runtimes must render the same rows in the same
// sequence, and bundle order is the only order all four ports agree on without a collation rule.
// Cheap by construction: one walk, no expression parsing, no string tables.

using System.Collections.Generic;

namespace Patterkit.Patterplay
{
    /// <summary>Which bundle this is: identity, staleness fingerprints, and how it ships.</summary>
    public sealed class BundleIdentity
    {
        public string Schema;            // "patter/bundle@0"
        public string Project;           // a save must agree with this
        public string Version;           // null when the project stamps none
        public string Hash;              // fingerprint over the WHOLE bundle
        /// <summary>The same fingerprint with the string tables left out. Equal StructureHash plus a
        /// different Hash means a TEXT-ONLY edit, which is what makes a live hot-swap safe; showing
        /// both lets an integrator tell those apart at sight.</summary>
        public string StructureHash;
        public bool Voiced;
        public string DefaultLocale;
        public List<string> Locales = new List<string>();
        public string Localisation = "embedded";   // "embedded" | "ids"
        /// <summary>True when the source locale was embedded purely for debug playback. Such a build
        /// is NOT shippable, which is worth saying loudly in an inspector.</summary>
        public bool SourceDebug;
    }

    public sealed class BlockAddress
    {
        public string GameId;
        public string Name;
    }

    /// <summary>One scene, and the addresses game code may aim at inside it.</summary>
    public sealed class AddressSummary
    {
        public string GameId;    // what RunFlow / Goto take
        public string Name;
        /// <summary>Block addresses within this scene. A block address is SCENE-SCOPED: the pair is
        /// the address, which is why these are nested rather than flattened.</summary>
        public List<BlockAddress> Blocks = new List<BlockAddress>();
    }

    /// <summary>One declared property. HasDefault rather than the value alone: an inspector wants to
    /// know whether the host MUST supply something.</summary>
    public sealed class PropertySummary
    {
        public string Name;
        public string Type;
        public bool HasDefault;
        public PatterValue Default;
        /// <summary>Shared across all flows, or kept per-flow. The defaults differ by scope
        /// (@patter shared, @scene per-flow), so it is resolved here rather than left to the reader.</summary>
        public bool Shared;
    }

    /// <summary>A host scope (@world and friends): what the GAME must supply. The highest-value
    /// section of the description - today an integrator discovers a missing world property when a
    /// condition silently reads a self-backed default and a branch never fires.</summary>
    public sealed class HostScopeSummary
    {
        public string Token;
        public bool Writable = true;
        /// <summary>An OPAQUE scope declares no names: any name is accepted, unchecked. The host
        /// contract is then "anything", which is worth showing as such rather than as an empty list.</summary>
        public bool Opaque;
        public List<PropertySummary> Properties = new List<PropertySummary>();
    }

    public sealed class ScenePropertySummary
    {
        public string GameId;
        public List<PropertySummary> Properties = new List<PropertySummary>();
    }

    /// <summary>Story-owned declarations, for orientation rather than for calling.</summary>
    public sealed class OwnedProperties
    {
        public List<PropertySummary> Patter = new List<PropertySummary>();
        public List<ScenePropertySummary> Scene = new List<ScenePropertySummary>();
    }

    public sealed class GameDataFieldSummary
    {
        public string Name;
        public string Type;
        public bool HasDefault;
        public List<string> Values;   // enum options: the set host code switches on
    }

    public sealed class GameDataSummary
    {
        public string Kind;
        public List<GameDataFieldSummary> Fields = new List<GameDataFieldSummary>();
    }

    /// <summary>"Is this the right build?" at a glance.</summary>
    public sealed class BundleCounts
    {
        public int Scenes, Blocks, Groups, Snippets;
        /// <summary>Snippet beats: the SAME population GetBeatSequence walks, deliberately, so a tool
        /// that lists beats and an inspector that counts them never disagree. Choice prompts are not
        /// in it - see Prompts.</summary>
        public int Beats;
        /// <summary>Choice-option prompts: beats that live on a group rather than in a snippet. A
        /// separate row rather than folded in (which would make Beats disagree with GetBeatSequence)
        /// or dropped (which would make a branching script look like the wrong build).</summary>
        public int Prompts;
        public int GameEvents;
        public int Cast;
    }

    public sealed class BundleDescription
    {
        public BundleIdentity Identity = new BundleIdentity();
        public List<AddressSummary> Addresses = new List<AddressSummary>();
        public List<HostScopeSummary> HostScopes = new List<HostScopeSummary>();
        public OwnedProperties Properties = new OwnedProperties();
        public List<GameDataSummary> GameData = new List<GameDataSummary>();
        public BundleCounts Counts = new BundleCounts();
    }

    /// <summary>Describe a compiled bundle: what it is, and what a game may call on it. Pure and
    /// allocation-light; safe from an editor inspector, though a custom editor should still build its
    /// rows once rather than per repaint.</summary>
    public static class BundleInfo
    {
        public static BundleDescription Describe(Bundle bundle)
        {
            var d = new BundleDescription();
            d.Counts.Cast = bundle.Cast != null ? bundle.Cast.Count : 0;

            foreach (var kv in bundle.Scenes)
            {
                var scene = kv.Value;
                d.Counts.Scenes++;
                var addr = new AddressSummary { GameId = Engine.EffectiveGameId(scene.GameId, scene.Name), Name = scene.Name };
                foreach (var b in scene.Blocks)
                    addr.Blocks.Add(new BlockAddress { GameId = Engine.EffectiveGameId(b.GameId, b.Name), Name = b.Name });
                d.Addresses.Add(addr);
                foreach (var b in scene.Blocks) CountBlock(b, d.Counts);
                // Scene-local declarations default to PER-FLOW, unlike project-level ones.
                if (scene.SceneProps != null && scene.SceneProps.Count > 0)
                {
                    var sp = new ScenePropertySummary { GameId = addr.GameId };
                    foreach (var decl in scene.SceneProps) sp.Properties.Add(SummariseProperty(decl, false));
                    d.Properties.Scene.Add(sp);
                }
            }

            if (bundle.ScopeRegistry != null)
                foreach (var spec in bundle.ScopeRegistry.Scopes)
                {
                    var hs = new HostScopeSummary
                    {
                        Token = spec.Token,
                        Writable = spec.Writable ?? true,
                        Opaque = spec.Declarations == null,
                    };
                    if (spec.Declarations != null)
                        foreach (var decl in spec.Declarations) hs.Properties.Add(SummariseHostProperty(decl));
                    d.HostScopes.Add(hs);
                }

            if (bundle.Properties != null)
                foreach (var decl in bundle.Properties) d.Properties.Patter.Add(SummariseProperty(decl, true));

            if (bundle.GameDataFields != null)
                foreach (var kv in bundle.GameDataFields)
                {
                    if (kv.Value == null || kv.Value.Count == 0) continue;
                    var gd = new GameDataSummary { Kind = kv.Key };
                    foreach (var f in kv.Value)
                        gd.Fields.Add(new GameDataFieldSummary
                        {
                            Name = f.Name, Type = f.Type, HasDefault = f.Default != null,
                            Values = f.Values != null ? new List<string>(f.Values) : null,
                        });
                    d.GameData.Add(gd);
                }

            d.Identity.Schema = bundle.Schema;
            d.Identity.Project = bundle.ContentProject;
            d.Identity.Version = bundle.ContentVersion;
            d.Identity.Hash = bundle.ContentHash;
            d.Identity.StructureHash = bundle.StructureHash;
            d.Identity.Voiced = bundle.Voiced;
            d.Identity.DefaultLocale = bundle.Locales.Default;
            d.Identity.Locales = new List<string>(bundle.Locales.Included);
            // Absent means "embedded": the back-compat default a bundle written before the field
            // existed relies on.
            d.Identity.Localisation = bundle.Localisation != null && !string.IsNullOrEmpty(bundle.Localisation.Mode)
                ? bundle.Localisation.Mode : "embedded";
            d.Identity.SourceDebug = bundle.Localisation != null && bundle.Localisation.SourceDebug;
            return d;
        }

        private static PropertySummary SummariseProperty(PropertyDecl decl, bool scopeDefault) => new PropertySummary
        {
            Name = decl.Name,
            Type = decl.Type,
            HasDefault = decl.Default != null,
            Default = decl.Default,
            Shared = decl.Shared ?? scopeDefault,
        };

        /// <summary>A host scope's values live outside the story, so "shared" is not a choice its
        /// declarations make: they are world-wide by nature.</summary>
        private static PropertySummary SummariseHostProperty(HostScopeDecl decl) => new PropertySummary
        {
            Name = decl.Name,
            Type = decl.Type,
            HasDefault = decl.Default != null,
            Default = decl.Default,
            Shared = true,
        };

        /// <summary>One pass over a block's tree. Iterative rather than recursive: a deeply nested
        /// choice tree should not put an inspector's stack at risk, and traversal order does not
        /// matter to a count.</summary>
        private static void CountBlock(Block block, BundleCounts counts)
        {
            counts.Blocks++;
            var stack = new Stack<Node>();
            foreach (var child in block.Children) stack.Push(child);
            while (stack.Count > 0)
            {
                var node = stack.Pop();
                if (node.Type == "group")
                {
                    counts.Groups++;
                    if (node.Prompt != null) counts.Prompts++;
                    foreach (var child in node.Children) stack.Push(child);
                    continue;
                }
                counts.Snippets++;
                if (node.Beats == null) continue;
                foreach (var beat in node.Beats)
                {
                    counts.Beats++;
                    if (beat.Kind == "gameEvent") counts.GameEvents++;
                }
            }
        }
    }
}
