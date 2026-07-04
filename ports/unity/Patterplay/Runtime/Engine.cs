// The Patterplay runtime - a faithful C# port of @patterkit/runtime's engine.ts.
// Engine = the world + flow manager (shared @patter / @scene state, visit counts,
// whole-game save/load); Flow = one playable cursor (its own callstack, PRNG, and the
// not-shared half of the scopes). Verified against the conformance corpus.

using System;
using System.Collections.Generic;
using System.Linq;

namespace Patterkit.Patterplay
{
    public sealed class EngineOptions
    {
        /// <summary>Custom float-in-[0,1) source, shared by all flows (NOT captured by save). Runtime
        /// corpus cases inject a seeded one here; scripted cases use the per-flow Seed instead.</summary>
        public Func<double> Rng;
        /// <summary>Default seed for each flow's built-in serialisable PRNG.</summary>
        public long? Seed;
        public string Locale;
        public bool ReplayPromptOnChoose;
        /// <summary>Closed captions (#214): show caption cues in dialogue lines. Default true (full text);
        /// false strips the cues. Toggle live with Engine.SetClosedCaptions.</summary>
        public bool ClosedCaptions = true;
    }

    public sealed class StackFrame
    {
        public string SceneId;
        public string ContainerId;
        public int Index;
        // SNAPSHOT-ONLY (never set on a live frame): the id of the child at Index when the save was
        // taken. Restore re-finds the child by this id, so a save survives siblings inserted / removed
        // / reordered before the cursor (live bundle refresh / patched-game saves); absent falls back
        // to the raw Index. Mirrors the JS runtime's StackFrame.nextId.
        public string NextId;
        public StackFrame Clone() => new StackFrame { SceneId = SceneId, ContainerId = ContainerId, Index = Index, NextId = NextId };
    }

    public sealed class SelectorState
    {
        public int? Seq;
        public List<string> Bag;     // null = not started
        public string Last;
        public SelectorState Clone() => new SelectorState { Seq = Seq, Bag = Bag == null ? null : new List<string>(Bag), Last = Last };
    }

    internal sealed class ChoiceStateInternal
    {
        public string GroupId;
        public List<ChoiceOption> Options;
        public Dictionary<string, Node> ById;
    }

    internal sealed class FlowHost
    {
        public Bundle Bundle;
        public bool EmitIds; // IDs-only build: emit beat IDs + omit character names (the game localises)
        public Dictionary<string, string> Strings;
        public Dictionary<string, string> DefaultStrings;
        public Dictionary<string, string> CastDisplay;
        public Dictionary<string, Node> NodeIndex;
        public Dictionary<string, string> BlockToScene;   // block id -> scene id
        public Dictionary<string, Block> BlockById;
        public Dictionary<string, List<string>> TagIndex; // author tags (#215): node id -> accumulated tags
        public Dictionary<string, PatterValue> SharedPatter;
        public List<PropertyDecl> PatterSharedDecls;
        public List<PropertyDecl> PatterLocalDecls;
        public HashSet<string> PatterSharedNames;
        public Dictionary<string, HashSet<string>> SceneSharedNames;
        public Dictionary<string, int> SharedVisits = new Dictionary<string, int>();
        public Dictionary<string, SelectorState> SharedSelectors = new Dictionary<string, SelectorState>();
        public Dictionary<string, Dictionary<string, PatterValue>> StageBags = new Dictionary<string, Dictionary<string, PatterValue>>();
        public Func<double> CustomRng;
        public bool ReplayPromptOnChoose;
        // Closed captions (#214): CaptionsOn shows caption cues in dialogue lines (default true); when
        // false the engine strips CaptionOpen..CaptionClose spans from line text. Mutable via SetClosedCaptions.
        public bool CaptionsOn;
        public string CaptionOpen;
        public string CaptionClose;
        public string CaptionCharacter; // a cast member whose whole lines are captions (silent when off)
    }

    public sealed class Engine
    {
        private readonly FlowHost _host;
        private readonly long _defaultSeed;
        private readonly Dictionary<string, Flow> _flows = new Dictionary<string, Flow>();
        private readonly Dictionary<string, string> _sceneGameIdToId = new Dictionary<string, string>();
        private readonly Dictionary<string, Dictionary<string, string>> _blockGameIdToId = new Dictionary<string, Dictionary<string, string>>();
        // Every locale's table, kept so SetLocale can re-point the active one live (no engine rebuild).
        // Reassigned wholesale by ReplaceStrings (live bundle refresh, tier 1), hence not readonly.
        private Dictionary<string, Dictionary<string, string>> _allStrings;
        private string _currentLocale;
        // The options this engine was built with - reused verbatim by HotSwap so the replacement
        // engine keeps the same seed source and settings.
        private readonly EngineOptions _creationOptions;
        private readonly bool _sourceDebug; // source-only DEBUG build: strings are the source language, not shippable

        public Engine(Bundle bundle, EngineOptions options = null)
        {
            options = options ?? new EngineOptions();
            _creationOptions = options;
            string locale = options.Locale ?? bundle.Locales.Default;
            var allStrings = bundle.Strings;
            _allStrings = allStrings;
            _currentLocale = locale;
            // Localisation mode (spec §11): "ids" + no source-debug -> emit beat IDs + omit character names.
            var loc = bundle.Localisation;
            bool emitIds = loc != null && loc.Mode == "ids" && !loc.SourceDebug;
            _sourceDebug = loc != null && loc.Mode == "ids" && loc.SourceDebug;
            if (_sourceDebug) System.Console.Error.WriteLine("[Patterplay] source-only DEBUG build: strings are the source language for debugging, not a shippable localised build.");
            var strings = allStrings != null && allStrings.TryGetValue(locale, out var s) ? s : new Dictionary<string, string>();
            var defaultStrings = allStrings != null && allStrings.TryGetValue(bundle.Locales.Default, out var ds) ? ds : new Dictionary<string, string>();

            var castDisplay = new Dictionary<string, string>();
            foreach (var c in bundle.Cast ?? new List<Cast>())
                if (!string.IsNullOrEmpty(c.DisplayName)) castDisplay[c.Name] = c.DisplayName;

            _defaultSeed = unchecked((uint)(options.Seed ?? 0x9e3779b9));

            var nodeIndex = new Dictionary<string, Node>();
            var blockToScene = new Dictionary<string, string>();
            var blockById = new Dictionary<string, Block>();
            var tagIndex = new Dictionary<string, List<string>>();
            foreach (var kv in bundle.Scenes)
            {
                string sceneId = kv.Key; var scene = kv.Value;
                _sceneGameIdToId[EffectiveGameId(scene.GameId, scene.Name)] = sceneId;
                var blockAddrs = new Dictionary<string, string>();
                // Author tags (#215): accumulate scene -> block -> node (own + ancestors), deduped, outermost-first.
                var sceneTags = DedupeTags(scene.Tags, null);
                tagIndex[sceneId] = sceneTags;
                foreach (var block in scene.Blocks)
                {
                    blockToScene[block.Id] = sceneId;
                    blockById[block.Id] = block;
                    blockAddrs[EffectiveGameId(block.GameId, block.Name)] = block.Id;
                    var blockTags = DedupeTags(block.Tags, sceneTags);
                    tagIndex[block.Id] = blockTags;
                    WalkNodes(block.Children, n => nodeIndex[n.Id] = n);
                    IndexTags(block.Children, blockTags, tagIndex);
                }
                _blockGameIdToId[sceneId] = blockAddrs;
            }

            var props = bundle.Properties ?? new List<PropertyDecl>();
            var sharedDecls = props.Where(p => p.Shared ?? true).ToList();
            var localDecls = props.Where(p => !(p.Shared ?? true)).ToList();
            var sharedNames = new HashSet<string>(sharedDecls.Select(d => d.Name.ToLowerInvariant()));

            var sharedPatter = new Dictionary<string, PatterValue>();
            foreach (var d in sharedDecls) sharedPatter[d.Name.ToLowerInvariant()] = PropDefault(d);

            var sceneSharedNames = new Dictionary<string, HashSet<string>>();
            foreach (var kv in bundle.Scenes)
            {
                var names = new HashSet<string>((kv.Value.SceneProps ?? new List<PropertyDecl>())
                    .Where(p => p.Shared ?? false).Select(p => p.Name.ToLowerInvariant()));
                sceneSharedNames[kv.Key] = names;
            }

            _host = new FlowHost
            {
                Bundle = bundle, EmitIds = emitIds, Strings = strings, DefaultStrings = defaultStrings, CastDisplay = castDisplay,
                NodeIndex = nodeIndex, BlockToScene = blockToScene, BlockById = blockById, TagIndex = tagIndex,
                SharedPatter = sharedPatter, PatterSharedDecls = sharedDecls, PatterLocalDecls = localDecls,
                PatterSharedNames = sharedNames, SceneSharedNames = sceneSharedNames,
                CustomRng = options.Rng, ReplayPromptOnChoose = options.ReplayPromptOnChoose,
                CaptionsOn = options.ClosedCaptions, // captions shown by default (full text)
                CaptionOpen = bundle.ClosedCaptions?.Open ?? "[",   // default: square brackets (#214)
                CaptionClose = bundle.ClosedCaptions?.Close ?? "]",
                CaptionCharacter = string.IsNullOrEmpty(bundle.ClosedCaptions?.Character) ? "SFX" : bundle.ClosedCaptions.Character, // absent/empty -> SFX
            };
        }

        /// <summary>The active locale (string + character-name lookups resolve in it).</summary>
        public string Locale => _currentLocale;

        /// <summary>True for a source-only DEBUG build: the embedded strings are the source language (for
        /// debugging), not a shippable localised build. An IDs-only ship build is false.</summary>
        public bool IsSourceDebug => _sourceDebug;

        /// <summary>
        /// Switch the active locale LIVE - a game's "language" setting can change mid-session. Subsequent
        /// string lookups (new beats, re-resolved character names, {@ref} interpolation) render in the new
        /// locale; flow position / state / visits / PRNG are untouched. All open flows share the engine's
        /// string table, so the swap reaches them at once. A locale with no table degrades to the source via
        /// the &lt;Untranslated&gt; fallback.
        /// </summary>
        public void SetLocale(string locale)
        {
            _currentLocale = locale;
            _host.Strings = _allStrings != null && _allStrings.TryGetValue(locale, out var t)
                ? t : new Dictionary<string, string>();
        }

        /// <summary>
        /// Live bundle refresh, tier 1 (strings only): swap every locale's string table in place from a
        /// freshly compiled bundle whose STRUCTURE is unchanged (same content.structureHash). Like
        /// SetLocale, nothing restarts and no flow is touched: the next delivered beat reads the new text.
        /// Structural edits need <see cref="HotSwap"/> instead (a structure change here simply won't show).
        /// </summary>
        public void ReplaceStrings(Bundle bundle)
        {
            _allStrings = bundle.Strings;
            _host.Strings = _allStrings != null && _allStrings.TryGetValue(_currentLocale, out var t) ? t : new Dictionary<string, string>();
            _host.DefaultStrings = _allStrings != null && _allStrings.TryGetValue(_host.Bundle.Locales.Default, out var d) ? d : new Dictionary<string, string>();
        }

        /// <summary>
        /// Live bundle refresh, tier 2 (full swap): rebuild on an edited bundle with the whole run carried
        /// over (SaveGame -> fresh engine -> LoadGame) plus the presentation state that isn't save state
        /// (active locale, captions toggle). Content drift resolves per §9.8: stack frames re-find their
        /// next child by id, drifted options drop, a vanished snippet is skipped. Returns the REPLACEMENT
        /// engine; this one should be discarded, and flow handles re-bound via <c>next.GetFlow(id)</c>.
        /// </summary>
        public Engine HotSwap(Bundle bundle)
        {
            var snapshot = SaveGame();
            var next = new Engine(bundle, _creationOptions);
            next.LoadGame(snapshot);
            next.SetLocale(_currentLocale);
            next.SetClosedCaptions(_host.CaptionsOn);
            return next;
        }

        /// <summary>The compiled bundle's build hash (content.hash). Pass it to PatterDebugLink so Patterpad's
        /// live debug link can tell whether the running game matches the open project (in-sync vs stale).</summary>
        public string BuildId => _host.Bundle?.ContentHash;

        /// <summary>Whether closed captions are currently shown (full dialogue text).</summary>
        public bool ClosedCaptions => _host.CaptionsOn;

        /// <summary>
        /// Turn closed captions on/off LIVE (#214). When OFF, subsequent dialogue lines have their caption
        /// cues (between the project's delimiters) + the surrounding whitespace stripped; narration, choice
        /// prompts, and everything else are untouched. Like SetLocale this is a presentation toggle - it
        /// reaches every open flow at once and isn't part of save state.
        /// </summary>
        public void SetClosedCaptions(bool on) => _host.CaptionsOn = on;

        public Flow OpenFlow(string id, string scene = null, string block = null, long? seed = null)
        {
            string sceneId = ResolveSceneRef(scene);
            string blockId = ResolveBlockRef(sceneId, block);
            var flow = new Flow(id, _host, seed ?? _defaultSeed);
            _flows[id] = flow;
            flow.Start(sceneId, blockId);
            return flow;
        }

        public Flow GetFlow(string id) => _flows.TryGetValue(id, out var f) ? f : null;
        public void CloseFlow(string id) => _flows.Remove(id);

        // -- author tags (#215) -------------------------------------------------

        /// <summary>A beat's accumulated tags (own + every ancestor's), the same value its step carries.
        /// Empty list for an unknown id or a beat with no tags anywhere up the chain.</summary>
        public List<string> TagsForBeat(string beatId)
            => _host.TagIndex.TryGetValue(beatId, out var t) ? t : new List<string>();

        /// <summary>A scene's own tags, by internal id or gameId address.</summary>
        public List<string> TagsForScene(string sceneRef)
        {
            var id = ResolveSceneRef(sceneRef);
            return id != null && _host.TagIndex.TryGetValue(id, out var t) ? t : new List<string>();
        }

        /// <summary>A block's accumulated tags (scene + block), by scene + block ref (id or gameId).</summary>
        public List<string> TagsForBlock(string sceneRef, string blockRef)
        {
            var id = ResolveBlockRef(ResolveSceneRef(sceneRef), blockRef);
            return id != null && _host.TagIndex.TryGetValue(id, out var t) ? t : new List<string>();
        }

        // --- Static structure introspection (editor / dev tooling) -----------------

        /// <summary>The authored structure as a nested tree: scenes -> blocks -> children (groups + snippets,
        /// groups preserved) -> a snippet's beats. Static (no flow); per-beat data is read at the source
        /// locale. For dev tooling that builds against the writer's structure (see also GetBeatSequence).</summary>
        public List<OutlineScene> GetOutline()
        {
            var outline = new List<OutlineScene>();
            foreach (var scene in _host.Bundle.Scenes.Values)
            {
                var os = new OutlineScene
                {
                    Id = scene.Id,
                    GameId = EffectiveGameId(scene.GameId, scene.Name),
                    Name = scene.Name,
                    Tags = TagsOrNull(scene.Id),
                };
                foreach (var block in scene.Blocks)
                {
                    var ob = new OutlineBlock
                    {
                        Id = block.Id,
                        GameId = EffectiveGameId(block.GameId, block.Name),
                        Name = block.Name,
                        Tags = TagsOrNull(block.Id),
                    };
                    foreach (var n in block.Children) ob.Children.Add(OutlineNodeFor(n));
                    os.Blocks.Add(ob);
                }
                outline.Add(os);
            }
            return outline;
        }

        /// <summary>Every beat in document order, flattened (through groups), each with the scene / block /
        /// snippet it belongs to and its static data. The linear view of GetOutline - hand it to a tool
        /// that lays one item per beat (e.g. a Sequencer of subsequences).</summary>
        public List<FlatBeat> GetBeatSequence()
        {
            var seq = new List<FlatBeat>();
            foreach (var scene in _host.Bundle.Scenes.Values)
                foreach (var block in scene.Blocks)
                    CollectBeats(block.Children, scene.Id, block.Id, seq);
            return seq;
        }

        private void CollectBeats(List<Node> nodes, string sceneId, string blockId, List<FlatBeat> into)
        {
            if (nodes == null) return;
            foreach (var n in nodes)
            {
                if (n.IsGroup) { CollectBeats(n.Children, sceneId, blockId, into); continue; }
                if (n.Beats == null) continue;
                foreach (var beat in n.Beats)
                    into.Add(new FlatBeat { SceneId = sceneId, BlockId = blockId, SnippetId = n.Id, Beat = BeatInfoFor(beat) });
            }
        }

        private OutlineNode OutlineNodeFor(Node n)
        {
            if (n.IsGroup)
            {
                var g = new OutlineNode
                {
                    Type = "group",
                    Id = n.Id,
                    Tags = TagsOrNull(n.Id),
                    Selector = n.Selector,
                    Prompt = n.Prompt != null ? BeatInfoFor(n.Prompt) : null,
                    Children = new List<OutlineNode>(),
                };
                if (n.Children != null) foreach (var c in n.Children) g.Children.Add(OutlineNodeFor(c));
                return g;
            }
            var s = new OutlineNode
            {
                Type = "snippet",
                Id = n.Id,
                Tags = TagsOrNull(n.Id),
                Beats = new List<BeatInfo>(),
            };
            if (n.Beats != null) foreach (var b in n.Beats) s.Beats.Add(BeatInfoFor(b));
            if (n.Jump != null) { s.JumpTo = n.Jump.To; s.JumpMode = n.Jump.Mode; }
            return s;
        }

        private BeatInfo BeatInfoFor(Beat beat)
        {
            var info = new BeatInfo { Id = beat.Id, Kind = beat.Kind };
            if (beat.Kind == "line")
            {
                if (beat.Character != null)
                {
                    info.Character = beat.Character;
                    if (_host.DefaultStrings.TryGetValue("cast:" + beat.Character, out var nm)) info.CharacterName = nm;
                    else if (_host.CastDisplay.TryGetValue(beat.Character, out var disp)) info.CharacterName = disp;
                }
                info.Direction = beat.Direction;
            }
            if (beat.Kind == "line" || beat.Kind == "text")
                if (_host.DefaultStrings.TryGetValue(beat.Id, out var src)) info.Text = src; // source, un-interpolated
            if (beat.GameData != null && beat.GameData.Count > 0) info.GameData = beat.GameData;
            info.Tags = TagsOrNull(beat.Id);
            return info;
        }

        private List<string> TagsOrNull(string id)
            => _host.TagIndex.TryGetValue(id, out var t) && t.Count > 0 ? t : null;

        public void Reset()
        {
            _flows.Clear();
            foreach (var d in _host.PatterSharedDecls) _host.SharedPatter[d.Name.ToLowerInvariant()] = PropDefault(d);
            _host.SharedVisits.Clear();
            _host.SharedSelectors.Clear();
            _host.StageBags.Clear();
        }

        public PatterValue GetProperty(string refStr)
        {
            var (scope, name) = SplitRef(refStr, t => t == "scene" || t == "patter");
            if (scope == "scene") throw new Exception($"'{refStr}': @scene properties are scene-scoped - read/write them on a Flow, not the Engine");
            return _host.SharedPatter.TryGetValue(name, out var v) ? v : null;
        }

        public void SetProperty(string refStr, PatterValue value)
        {
            var (scope, name) = SplitRef(refStr, t => t == "scene" || t == "patter");
            if (scope == "scene") throw new Exception($"'{refStr}': @scene properties are scene-scoped - read/write them on a Flow, not the Engine");
            _host.SharedPatter[name] = value;
        }

        /// <summary>The shared `@patter` global properties with their declared type, current value, and
        /// default - for a debug inspector that lists + edits live state. (Per-flow `@patter` / `@scene`
        /// props live on a Flow.)</summary>
        public List<PropertyRow> ListProperties()
        {
            var rows = new List<PropertyRow>();
            foreach (var d in _host.PatterSharedDecls)
            {
                string name = d.Name.ToLowerInvariant();
                rows.Add(new PropertyRow
                {
                    Ref = "@" + d.Name,
                    Name = d.Name,
                    Type = d.Type,
                    Values = d.Values,
                    Value = _host.SharedPatter.TryGetValue(name, out var v) ? v : PropDefault(d),
                    Default = PropDefault(d),
                });
            }
            return rows;
        }

        // -- save / load --------------------------------------------------------

        public SaveGame SaveGame()
        {
            var flows = new Dictionary<string, FlowSnapshot>();
            foreach (var kv in _flows) flows[kv.Key] = kv.Value.Snapshot();
            return new SaveGame
            {
                Version = 2,
                Shared = CloneBag(_host.SharedPatter),
                SharedVisits = new Dictionary<string, int>(_host.SharedVisits),
                SharedSelectors = CloneSelectors(_host.SharedSelectors),
                StageBags = _host.StageBags.ToDictionary(k => k.Key, k => CloneBag(k.Value)),
                Flows = flows,
            };
        }

        public void LoadGame(SaveGame save)
        {
            if (save.Version != 2) throw new Exception($"unsupported save version: {save.Version}");
            _host.SharedPatter.Clear();
            foreach (var kv in save.Shared) _host.SharedPatter[kv.Key] = kv.Value;
            _host.SharedVisits.Clear();
            foreach (var kv in save.SharedVisits) _host.SharedVisits[kv.Key] = kv.Value;
            _host.SharedSelectors.Clear();
            foreach (var kv in save.SharedSelectors) _host.SharedSelectors[kv.Key] = kv.Value.Clone();
            _host.StageBags.Clear();
            foreach (var kv in save.StageBags) _host.StageBags[kv.Key] = CloneBag(kv.Value);
            _flows.Clear();
            foreach (var kv in save.Flows)
            {
                var flow = new Flow(kv.Key, _host, _defaultSeed);
                flow.Restore(kv.Value);
                _flows[kv.Key] = flow;
            }
        }

        // -- ref resolution -----------------------------------------------------

        private string ResolveSceneRef(string r)
        {
            if (r == null) return null;
            if (_host.Bundle.Scenes.ContainsKey(r)) return r;
            return _sceneGameIdToId.TryGetValue(r, out var id) ? id : r;
        }

        private string ResolveBlockRef(string sceneId, string r)
        {
            if (r == null) return null;
            if (_host.BlockById.ContainsKey(r)) return r;
            if (sceneId != null && _blockGameIdToId.TryGetValue(sceneId, out var m) && m.TryGetValue(r, out var id)) return id;
            return r;
        }

        // -- helpers ------------------------------------------------------------

        internal static Dictionary<string, PatterValue> CloneBag(Dictionary<string, PatterValue> bag)
            => bag.ToDictionary(k => k.Key, k => k.Value);

        internal static Dictionary<string, SelectorState> CloneSelectors(Dictionary<string, SelectorState> m)
            => m.ToDictionary(k => k.Key, k => k.Value.Clone());

        internal static void WalkNodes(List<Node> nodes, Action<Node> visit)
        {
            foreach (var n in nodes ?? new List<Node>())
            {
                visit(n);
                if (n.IsGroup && n.Children != null) WalkNodes(n.Children, visit);
            }
        }

        // Author tags (#215): walk groups/snippets carrying the parent's accumulated tags; record each
        // node's and (for snippets) each beat's accumulated tags.
        private static void IndexTags(List<Node> nodes, List<string> inherited, Dictionary<string, List<string>> index)
        {
            foreach (var n in nodes ?? new List<Node>())
            {
                var acc = DedupeTags(n.Tags, inherited);
                index[n.Id] = acc;
                if (n.IsGroup) IndexTags(n.Children, acc, index);
                else foreach (var beat in n.Beats ?? new List<Beat>()) index[beat.Id] = DedupeTags(beat.Tags, acc);
            }
        }

        // Combine inherited + own tags, deduped, preserving first-seen order.
        private static List<string> DedupeTags(List<string> own, List<string> inherited)
        {
            var seen = new HashSet<string>();
            var outList = new List<string>();
            if (inherited != null) foreach (var t in inherited) if (seen.Add(t)) outList.Add(t);
            if (own != null) foreach (var t in own) if (seen.Add(t)) outList.Add(t);
            return outList;
        }

        internal static string EffectiveGameId(string gameId, string name)
        {
            var g = gameId?.Trim();
            return !string.IsNullOrEmpty(g) ? g : GameIdify(name);
        }

        internal static string GameIdify(string text)
        {
            string s = (text ?? "").ToLowerInvariant();
            var sb = new System.Text.StringBuilder();
            foreach (char c in s)
            {
                if (c == '\'' || c == '’') continue;                 // drop apostrophes
                sb.Append((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' ? c : '-');
            }
            var parts = sb.ToString().Split(new[] { '-' }, StringSplitOptions.RemoveEmptyEntries);
            return string.Join("-", parts);
        }

        internal static PatterValue PropDefault(PropertyDecl d)
        {
            if (d.Default != null) return d.Default;
            switch (d.Type)
            {
                case "boolean": return PatterValue.False;
                case "number": return PatterValue.Num(0);
                case "string": return PatterValue.Str("");
                case "flags": return PatterValue.Flags(new List<string>());
                case "enum": return PatterValue.Str(d.Values != null && d.Values.Count > 0 ? d.Values[0] : "");
                default: return PatterValue.False;
            }
        }

        /// <summary>Split a ref ("@name" / "@scope.name") into (scope, lowercased name).</summary>
        internal static (string scope, string name) SplitRef(string refStr, Func<string, bool> isScope)
        {
            var body = refStr.StartsWith("@") ? refStr.Substring(1) : refStr;
            var parts = body.Split('.');
            if (parts.Length == 2 && isScope(parts[0])) return (parts[0], parts[1].ToLowerInvariant());
            return ("patter", string.Join(".", parts).ToLowerInvariant());
        }
    }

    /// <summary>A global property's declared shape + live value, for a debug inspector.</summary>
    public sealed class PropertyRow
    {
        public string Ref;          // "@hp"
        public string Name;
        public string Type;         // bool | number | string | flags | enum
        public List<string> Values; // enum options
        public PatterValue Value;
        public PatterValue Default;
    }

    // -- save-game records ------------------------------------------------------

    public sealed class SaveGame
    {
        public int Version;
        public Dictionary<string, PatterValue> Shared;
        public Dictionary<string, int> SharedVisits;
        public Dictionary<string, SelectorState> SharedSelectors;
        public Dictionary<string, Dictionary<string, PatterValue>> StageBags;
        public Dictionary<string, FlowSnapshot> Flows;
    }

    public sealed class FlowSnapshot
    {
        public Dictionary<string, PatterValue> Scopes;            // not-shared @patter
        public Dictionary<string, Dictionary<string, PatterValue>> SceneBags;
        public uint RngState;
        public Dictionary<string, int> Visits;
        public bool FlowEnded;
        public string CurrentSceneId;
        public List<StackFrame> Stack;
        public string ActiveSnippetId;
        public int BeatIndex;
        public List<ChoiceOption> PendingOptions;  // null = no pending choice
        public string PendingGroupId;
        public string PendingPromptOwnerId;        // chosen option owning a prompt still to replay (save in the choose->advance window)
        public Dictionary<string, SelectorState> Selectors;
    }
}
