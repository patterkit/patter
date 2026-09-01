// The Patterplay runtime - a faithful C# port of @patterkit/runtime's engine.ts.
// Engine = the world + flow manager (shared @patter / @scene state, visit counts,
// whole-game save/load); Flow = one playable cursor (its own callstack, PRNG, and the
// not-shared half of the scopes). Verified against the conformance corpus.

using System;
using System.Collections.Generic;
using System.Linq;

namespace Patterkit.Patterplay
{
    /// <summary>A host scope the story reads and writes (`@world`): the GAME owns the value. Bind one per
    /// token through <see cref="EngineOptions.HostScopes"/>; a declared scope with no binding is self-backed
    /// from its declaration defaults, so a standalone build plays the same story a bound one does.</summary>
    public interface IHostScope
    {
        /// <summary>The current value, or null when this scope has no such property (reads graceful-false).</summary>
        PatterValue Get(string name);
        void Set(string name, PatterValue value);
    }

    /// <summary>The fallback for a scope the bundle DECLARES and the embedder does not bind: a live in-memory
    /// bag seeded from the declarations' defaults.
    ///
    /// Keyed LOWER CASE, which is load-bearing rather than tidy: the compiler folds every property reference,
    /// so an AST reads `isnight` where the declaration says `isNight`. Seeding verbatim means any declared
    /// name carrying a capital is never found, reads as absent, and silently takes the falsy branch - the JS
    /// runtime shipped exactly that bug (fixed 2026-08-18) and this port must not repeat it. Declaring such a
    /// name is refused at compile time now, but a hand-written bundle can still carry one.</summary>
    internal sealed class SelfBackedScope : IHostScope
    {
        private readonly Dictionary<string, PatterValue> _bag = new Dictionary<string, PatterValue>();

        public SelfBackedScope(List<HostScopeDecl> decls)
        {
            if (decls == null) return;   // opaque scope: starts empty, accepts any name
            foreach (var d in decls) if (d != null && d.Name != null) _bag[Key(d.Name)] = Engine.HostScopeDefault(d);
        }

        private static string Key(string name) => name == null ? null : name.ToLowerInvariant();
        public PatterValue Get(string name) => _bag.TryGetValue(Key(name), out var v) ? v : null;
        public void Set(string name, PatterValue value) { _bag[Key(name)] = value; }
    }

    public sealed class EngineOptions
    {
        /// <summary>Custom float-in-[0,1) source, shared by all flows (NOT captured by save). Runtime
        /// corpus cases inject a seeded one here; scripted cases use the per-flow Seed instead.</summary>
        public Func<double> Rng;
        /// <summary>Default seed for each flow's built-in serialisable PRNG.</summary>
        public double? Seed;
        public string Locale;
        public bool ReplayPromptOnChoose;
        /// <summary>Closed captions (#214): show caption cues in dialogue lines. Default true (full text);
        /// false strips the cues. Toggle live with Engine.SetClosedCaptions.</summary>
        public bool ClosedCaptions = true;
        /// <summary>Retain a trace of the engine's DECISIONS, readable through Engine.Log() and
        /// Flow.Log(). Off by default: a shipped game pays nothing for a debugging surface it
        /// never reads.</summary>
        public bool Log;
        /// <summary>Diagnostics hook (opt-in, dev tooling): fired with the choice's group id
        /// whenever a choice runs dry. Unaffected by Log and useful with it off - it is live
        /// feedback, not an audit read afterwards.</summary>
        public Action<string> OnDryChoice;
        /// <summary>Live game state per host-scope token (`"world"` -> your resolver). A binding WINS over
        /// the self-backed bag for that token; tokens the bundle declares and you do not bind are self-backed
        /// from their defaults. Leave null for the standalone case.</summary>
        public Dictionary<string, IHostScope> HostScopes;
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

    /// <summary>One retained decision: what the engine chose and why, not what it produced.
    /// `Type` is select | choice | chose | dry | jump | write | diagnostic; `Seq` is monotonic
    /// across the flow and survives ClearLog. Parity with the JS runtime's LogEntry.</summary>
    public sealed class LogEntry
    {
        public string Type;
        public int Seq;
        public string Scene;
        /// <summary>The flow this happened in. Set on the ENGINE's stream, where a run is
        /// several flows in one order; null on a flow's own log, which already says whose it is.</summary>
        public string Flow;
        /// <summary>Group / target / jump destination, whichever the type names.</summary>
        public string Subject;
        /// <summary>Every child or option considered, with its verdict: the REASONING, not
        /// just the outcome. "Why is my line missing" is only answerable from this.</summary>
        public List<(string Id, bool Eligible)> Considered;
        public string Picked;
        public string Selector;
        public PatterValue Value;
        public PatterValue Prev;
        public string Detail;
    }

    internal sealed class FlowHost
    {
        /// <summary>True when the run asked for a log; flows skip building entries otherwise.</summary>
        public bool LogEnabled;
        /// <summary>The engine's ordered stream, shared by reference so a flow appends to it
        /// without holding the engine (which would be a cycle).</summary>
        public List<LogEntry> EngineLog;
        /// <summary>Called with the group id when a choice runs dry - no takeable option and no
        /// eligible fallback - so the silent fall-through is observable. Parity with the JS
        /// runtime's onDryChoice, which the three ports never had. Live feedback, distinct from
        /// the log's `dry` entry: a shipped game runs with the log off and this still wired.</summary>
        public Action<string> OnDryChoice;
        public Bundle Bundle;
        public bool EmitIds; // IDs-only build: emit beat IDs + omit character names (the game localises)
        public Dictionary<string, string> Strings;
        public Dictionary<string, string> DefaultStrings;
        public Dictionary<string, string> CastDisplay;
        public Dictionary<string, Node> NodeIndex;
        public Dictionary<string, string> BlockToScene;   // block id -> scene id
        public Dictionary<string, Block> BlockById;
        // Host-facing addresses (spec §6), shared with the engine: scene gameId -> internal id,
        // and per-scene block gameId -> internal id. A flow needs them to resolve Goto by address.
        public Dictionary<string, string> SceneGameIdToId;
        public Dictionary<string, Dictionary<string, string>> BlockGameIdToId;
        public Dictionary<string, List<string>> TagIndex; // author tags (#215): node id -> accumulated tags
        public Dictionary<string, PatterValue> SharedPatter;
        /// <summary>Host scopes by token, already resolved: an embedder's binding where one was given,
        /// a self-backed bag for every other token the bundle declares. Empty for a bundle with none.</summary>
        public Dictionary<string, IHostScope> HostScopes = new Dictionary<string, IHostScope>();
        public List<PropertyDecl> PatterSharedDecls;
        public List<PropertyDecl> PatterLocalDecls;
        public HashSet<string> PatterSharedNames;
        public Dictionary<string, HashSet<string>> SceneSharedNames;
        public Dictionary<string, int> SharedVisits = new Dictionary<string, int>();
        public Dictionary<string, SelectorState> SharedSelectors = new Dictionary<string, SelectorState>();
        public Dictionary<string, PropertyBag> StageBags = new Dictionary<string, PropertyBag>();
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
        private readonly double _defaultSeed;
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

        /// <summary>The run's ordered decision stream; see Log().</summary>
        private readonly List<LogEntry> _engineLog = new List<LogEntry>();

        /// <summary>The run's decisions, in order, each naming the flow it happened in. Empty
        /// unless the run was opened with Log = true. A flow's own log stays flow-local; this is
        /// the only place a story spanning several flows reads as one sequence.</summary>
        public IReadOnlyList<LogEntry> Log() => _engineLog;

        /// <summary>Drop the retained entries. Seq does NOT restart, so two reads either side of
        /// a clear still agree about what came first.</summary>
        public void ClearLog() => _engineLog.Clear();

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

            _defaultSeed = Mulberry32.ToUint32(options.Seed ?? 0x9e3779b9);

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
                LogEnabled = options.Log,
                EngineLog = _engineLog,
                OnDryChoice = options.OnDryChoice,
                Bundle = bundle, EmitIds = emitIds, Strings = strings, DefaultStrings = defaultStrings, CastDisplay = castDisplay,
                NodeIndex = nodeIndex, BlockToScene = blockToScene, BlockById = blockById, TagIndex = tagIndex,
                SceneGameIdToId = _sceneGameIdToId, BlockGameIdToId = _blockGameIdToId,
                SharedPatter = sharedPatter, PatterSharedDecls = sharedDecls, PatterLocalDecls = localDecls,
                PatterSharedNames = sharedNames, SceneSharedNames = sceneSharedNames,
                CustomRng = options.Rng, ReplayPromptOnChoose = options.ReplayPromptOnChoose,
                CaptionsOn = options.ClosedCaptions, // captions shown by default (full text)
                CaptionOpen = bundle.ClosedCaptions?.Open ?? "[",   // default: square brackets (#214)
                CaptionClose = bundle.ClosedCaptions?.Close ?? "]",
                CaptionCharacter = string.IsNullOrEmpty(bundle.ClosedCaptions?.Character) ? "SFX" : bundle.ClosedCaptions.Character, // absent/empty -> SFX
            };

            // Host scopes (design/scope-registry.md §6). An embedder's binding wins for its token; every
            // OTHER token the bundle declares gets a self-backed bag seeded from its declaration defaults,
            // so a standalone build plays the same story a bound one does. Without this the reference reads
            // as a graceful false and a @world-gated branch is silently skipped.
            if (options.HostScopes != null)
                foreach (var kv in options.HostScopes)
                    if (kv.Value != null) _host.HostScopes[kv.Key] = kv.Value;
            if (bundle.ScopeRegistry != null)
                foreach (var spec in bundle.ScopeRegistry.Scopes)
                {
                    if (spec == null || string.IsNullOrEmpty(spec.Token)) continue;
                    if (_host.HostScopes.ContainsKey(spec.Token)) continue;   // the embedder's binding wins
                    _host.HostScopes[spec.Token] = new SelfBackedScope(spec.Declarations);
                }
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

        public Flow OpenFlow(string id, string scene = null, string block = null, double? seed = null)
        {
            string sceneId = ResolveSceneRef(scene);
            string blockId = ResolveBlockRef(sceneId, block);
            // Re-opening a name REPLACES it: finish the old flow so a host still holding it cannot keep
            // driving the shared world. Replacing is a reset - contrast RunFlow, which reuses.
            if (_flows.TryGetValue(id, out var previous)) previous.Close();
            var flow = new Flow(id, _host, seed ?? _defaultSeed);
            _flows[id] = flow;
            flow.Start(sceneId, blockId);
            return flow;
        }

        public Flow GetFlow(string id) => _flows.TryGetValue(id, out var f) ? f : null;
        /// <summary>Close (remove) a flow. The flow object is FINISHED, not merely unregistered, so a
        /// host still holding it cannot keep advancing it into the shared world.</summary>
        public void CloseFlow(string id)
        {
            if (_flows.TryGetValue(id, out var f)) f.Close();
            _flows.Remove(id);
        }

        /// <summary>"Play this address and give me everything it produced" - the one-call bark form.
        /// The NAMED flow is reused if it exists (moved with Goto) and opened at the address if not, then
        /// run to its next stop. Reuse is the point: a flow owns its selector cursors, so a shuffle keeps
        /// its bag and an "once each" list keeps its place across calls. Empty list = nothing left to play.
        /// Throws if the address does not resolve.</summary>
        public List<StepResult> RunFlow(string flow, string scene, string block = null)
        {
            Flow f;
            if (_flows.TryGetValue(flow, out var existing))
            {
                if (!existing.Goto(scene, block))
                    throw new Exception($"runFlow: address not found: {scene}{(block == null ? "" : " / " + block)}");
                f = existing;
            }
            else f = OpenFlow(flow, scene, block);

            return f.AdvanceToStop().Played;
        }

        /// <summary>The host-facing address (Game ID) of a scene by internal id, or null if unknown. The
        /// inverse of the address resolution OpenFlow / Goto do - for a host that wants to display, log, or
        /// pass back the address of where it currently is.</summary>
        public string SceneAddress(string sceneId)
            => _host.Bundle.Scenes.TryGetValue(sceneId, out var scene) ? EffectiveGameId(scene.GameId, scene.Name) : null;

        /// <summary>The host-facing address (Game ID) of a block by internal id, or null if unknown.</summary>
        public string BlockAddress(string blockId)
            => _host.BlockById.TryGetValue(blockId, out var block) ? EffectiveGameId(block.GameId, block.Name) : null;

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

        // --- cast ------------------------------------------------------------

        /// <summary>Every cast member the PROJECT declares, in authored order - the same list
        /// BundleInfo.Describe counts. A superset of any scene's cast: a beat's character must be a
        /// declared member, so CastForScene / CastForBlock only ever return names from here.</summary>
        public List<string> GetCast()
        {
            // Cast is absent from a bundle whose project declares none, and a nameless member is junk
            // from a hand-edited bundle: both give an empty answer, not a throw.
            var names = new List<string>();
            if (_host.Bundle.Cast != null)
                foreach (var c in _host.Bundle.Cast)
                    if (c != null && !string.IsNullOrEmpty(c.Name)) names.Add(c.Name);
            return names;
        }

        /// <summary>A scene's cast: the character token of every speaker with a line anywhere in it,
        /// deduped, in first-appearance order. Static, like GetOutline: it walks the authored structure,
        /// so a speaker behind a condition, inside any group, or voicing a choice prompt counts - this is
        /// who CAN speak in the scene, not who a given playthrough heard. Empty for an unknown ref or a
        /// scene with no dialogue. Tokens, not display names: read those off a delivered step.</summary>
        public List<string> CastForScene(string sceneRef)
        {
            var id = ResolveSceneRef(sceneRef);
            var cast = new List<string>();
            if (id == null || !_host.Bundle.Scenes.TryGetValue(id, out var scene)) return cast;
            var seen = new HashSet<string>();
            foreach (var block in scene.Blocks) CollectCast(block.Children, seen, cast);
            return cast;
        }

        /// <summary>One block's cast, by scene + block ref (id or gameId). CastForScene, block-scoped.</summary>
        public List<string> CastForBlock(string sceneRef, string blockRef)
        {
            var id = ResolveBlockRef(ResolveSceneRef(sceneRef), blockRef);
            var cast = new List<string>();
            if (id == null || !_host.BlockById.TryGetValue(id, out var block)) return cast;
            CollectCast(block.Children, new HashSet<string>(), cast);
            return cast;
        }

        /// <summary>Collect speakers under a run of nodes in document order. A group contributes its
        /// option prompt's speaker (a prompt is a line | text beat) before its children.</summary>
        private static void CollectCast(List<Node> nodes, HashSet<string> seen, List<string> into)
        {
            if (nodes == null) return;
            foreach (var n in nodes)
            {
                if (n.IsGroup)
                {
                    if (n.Prompt != null && n.Prompt.Kind == "line" && !string.IsNullOrEmpty(n.Prompt.Character) && seen.Add(n.Prompt.Character))
                        into.Add(n.Prompt.Character);
                    CollectCast(n.Children, seen, into);
                    continue;
                }
                if (n.Beats == null) continue;
                foreach (var beat in n.Beats)
                    if (beat.Kind == "line" && !string.IsNullOrEmpty(beat.Character) && seen.Add(beat.Character))
                        into.Add(beat.Character);
            }
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
            foreach (var f in _flows.Values) f.Close(); // finish them, don't just forget them
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
                    // The QUALIFIED address, matching what the shared bag composes for every other
                    // scope. `@gold` still resolves on input - splitRef defaults an unqualified name to
                    // the patter scope - but it is the shorthand, not the address a row reports.
                    Path = "@patter." + d.Name,
                    Name = d.Name,
                    Type = d.Type,
                    Values = d.Values,
                    Stages = d.Stages,
                    Value = _host.SharedPatter.TryGetValue(name, out var v) ? v : PropDefault(d),
                    Default = PropDefault(d),
                    // Always true: a shared @patter property has no read-only form here,
                    // exactly as in the JS runtime. Carried because it is part of the
                    // shared row shape, and read by the Storylet Engine, which does.
                    Writable = true,
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
                StageBags = SaveBags(_host.StageBags),
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
            foreach (var kv in LoadBags(_host, save.StageBags, true)) _host.StageBags[kv.Key] = kv.Value;
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

        /// <summary>The seed value for a self-backed host property: its `default`, else the type default.
        /// Mirrors the JS runtime's hostScopeDefault.</summary>
        internal static PatterValue HostScopeDefault(HostScopeDecl d)
        {
            if (d.Default != null) return d.Default;
            switch (d.Type)
            {
                case "boolean": return PatterValue.False;
                case "number": return PatterValue.Num(0);
                case "string": return PatterValue.Str("");
                case "flags": return PatterValue.Flags(new List<string>());
                case "enum": return PatterValue.Str(d.Values != null && d.Values.Count > 0 ? d.Values[0] : "");
                case "quality": return PatterValue.Str(d.Stages != null && d.Stages.Count > 0 ? d.Stages[0] : ""); // the ladder's start
                default: return PatterValue.False;
            }
        }

        /// <summary>A bundle PropertyDecl as the shared bag's ScopeDeclaration. The two describe the
        /// same thing in the two vocabularies: patter's decl is a bundle record, ScopeDeclaration is
        /// what the shared kernel seeds and lists from. Nothing is lost - `Temporary` and `Shared` are
        /// the engine's business, not the bag's.</summary>
        internal static ScopeDeclaration ToScopeDecl(PropertyDecl d) => new ScopeDeclaration
        {
            Name = d.Name, Type = d.Type, Values = d.Values, Stages = d.Stages, Default = d.Default,
        };

        /// <summary>One half of a scene's props: the shared ones (stage bag) or the rest (scene bag).</summary>
        internal static List<ScopeDeclaration> DeclsFor(List<PropertyDecl> props, HashSet<string> shared, bool wantShared)
        {
            var out_ = new List<ScopeDeclaration>();
            foreach (var d in props ?? new List<PropertyDecl>())
                if (shared.Contains(d.Name.ToLowerInvariant()) == wantShared) out_.Add(ToScopeDecl(d));
            return out_;
        }

        /// <summary>Bags -> the flat name/value maps the save format has always carried. The bag is a
        /// runtime detail; the envelope is a contract with every save already on disk.</summary>
        internal static Dictionary<string, Dictionary<string, PatterValue>> SaveBags(Dictionary<string, PropertyBag> bags)
        {
            var out_ = new Dictionary<string, Dictionary<string, PatterValue>>();
            foreach (var kv in bags)
            {
                var flat = new Dictionary<string, PatterValue>();
                foreach (var e in kv.Value.Save()) flat[e.Key] = e.Value;
                out_[kv.Key] = flat;
            }
            return out_;
        }

        /// <summary>The reverse: seed each bag from the BUNDLE's declarations, then lay the saved
        /// values over. A property the save predates keeps its declared default rather than
        /// vanishing, and one the bundle has since dropped lands as a stray.</summary>
        internal static Dictionary<string, PropertyBag> LoadBags(
            FlowHost host, Dictionary<string, Dictionary<string, PatterValue>> saved, bool wantShared)
        {
            var out_ = new Dictionary<string, PropertyBag>();
            foreach (var kv in saved ?? new Dictionary<string, Dictionary<string, PatterValue>>())
            {
                var shared = host.SceneSharedNames.TryGetValue(kv.Key, out var names) ? names : new HashSet<string>();
                var props = host.Bundle.Scenes.TryGetValue(kv.Key, out var sc) ? sc.SceneProps : null;
                var bag = new PropertyBag(DeclsFor(props, shared, wantShared));
                var values = new OrderedMap<string, PatterValue>();
                foreach (var e in kv.Value) values.Set(e.Key, e.Value);
                bag.Load(values);
                out_[kv.Key] = bag;
            }
            return out_;
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
                case "quality": return PatterValue.Str(d.Stages != null && d.Stages.Count > 0 ? d.Stages[0] : ""); // the ladder's start
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

    // PropertyView is gone. It was PropertyRow plus a `Path`, and the Storylet Engine had
    // forked the same row for the same reason in its own runtimes; `Path` moved onto the
    // shared PropertyRow on 2026-09-02, so there was nothing left to hold. ListProperties
    // returns the shared row itself - C# has no type alias to keep the old name alive with
    // (the TS and C++ runtimes do, and use one), and an empty subclass would be a type a
    // bag's own row could never satisfy.

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
