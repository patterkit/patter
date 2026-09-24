// The Patterplay runtime - a faithful C# port of @patterkit/runtime's engine.ts.
// Engine = the world + flow manager (shared @patter / @scene state, visit counts,
// whole-game save/load); Flow = one playable cursor (its own callstack, PRNG, and the
// not-shared half of the scopes). Verified against the conformance corpus.
//
// Every property bag lives in ONE ScopeRegistry per game (the one-registry model,
// patterkit design/one-registry-handover.md): the game hands the engine its registry
// (EngineOptions.Registry) or the engine makes its own and acts as its own game. @patter
// is registered under `patter`; the per-flow and per-scene bags under keys starting
// `patter/` (see PatterKeys), which no expression can name. SaveGame / LoadGame snapshot
// and restore what is NOT a property: cursors, PRNGs, visits, and selectors. The
// registry's values ride in SaveGame only when the engine made the registry itself;
// otherwise the game saves the registry once.

using System;
using System.Collections.Generic;
using System.Linq;
using Wildwinter.Expr;

namespace Patterkit.Patterplay
{
    /// <summary>A host scope the story reads and writes (`@world`): the GAME owns the value. Bind one per
    /// token through <see cref="EngineOptions.HostScopes"/>; the engine registers it in the game's registry
    /// as a foreign scope, so its values stay the game's and are never saved by Patterplay. A standalone
    /// engine self-backs a declared scope with no binding from its declaration defaults (a property its
    /// registry stores and saves), so a standalone build plays the same story a bound one does.</summary>
    public interface IHostScope
    {
        /// <summary>The current value, or null when this scope has no such property (reads graceful-false).</summary>
        ExprValue Get(string name);
        void Set(string name, ExprValue value);
    }

    /// <summary>An <see cref="IHostScope"/> as the registry takes a foreign scope. The registry hands it
    /// names folded to lower case, as the compiler emits every reference.</summary>
    internal sealed class HostScopeResolver : IScopeResolver
    {
        private readonly IHostScope _scope;
        public HostScopeResolver(IHostScope scope) { _scope = scope; }
        public bool CanSet => true;
        public ExprValue Get(string name) => _scope.Get(name);
        public void Set(string name, ExprValue value) => _scope.Set(name, value);
    }

    /// <summary>The registry keys this engine stores its instance bags under. An id is escaped (`%` and
    /// `/`) so a flow named `npc/bob` cannot collide with another flow's scene. Every runtime writes the
    /// same keys: they are in the save.</summary>
    internal static class PatterKeys
    {
        /// <summary>The owner label on everything this engine registers: named in a clash error and
        /// carried on the registry's examiner rows, so one inspector can group a combined game by engine.</summary>
        public const string Owner = "Patter";

        private static string Esc(string id) => id.Replace("%", "%25").Replace("/", "%2F");
        /// <summary>A scene's SHARED @scene props (one bag per scene, every flow's).</summary>
        public static string Stage(string sceneId) => "patter/scene/" + Esc(sceneId);
        /// <summary>Everything one flow registers starts with this.</summary>
        public static string Flow(string flowId) => "patter/flow/" + Esc(flowId) + "/";
        /// <summary>A flow's NOT-shared @patter globals.</summary>
        public static string FlowGlobals(string flowId) => Flow(flowId) + "patter";
        /// <summary>A flow's NOT-shared @scene props for one scene.</summary>
        public static string FlowScene(string flowId, string sceneId) => Flow(flowId) + "scene/" + Esc(sceneId);
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
        /// <summary>Live game state per host-scope token (`"world"` -> your resolver). Each binding is
        /// registered in the registry as a foreign scope: the game keeps the values, and nothing saves them
        /// but the game. A standalone engine self-backs every token the bundle declares and you do not bind,
        /// from its defaults, as a property its registry stores and saves. Given <see cref="Registry"/>, the
        /// engine self-backs nothing: an unbound token is the game's to register (owned if the registry
        /// should store it, foreign if the game keeps it), or another engine's. Leave null for the
        /// standalone case.</summary>
        public Dictionary<string, IHostScope> HostScopes;
        /// <summary>The game's registry: ONE per game, holding every engine's properties except those the
        /// game keeps itself, saved once. Given one, the engine registers its own scopes in it (@patter under
        /// `patter`, its per-flow and per-scene bags under keys starting `patter/`, and each HostScopes
        /// binding), reads every other scope from it, and SaveGame leaves the property values to the game.
        /// Leave null and the engine makes its own registry and acts as its own game: it self-backs `@world`,
        /// and SaveGame carries the registry's values too.</summary>
        public ScopeRegistry Registry;

        /// <summary>Internal: set on a HotSwap replacement of a standalone engine, which shares its
        /// predecessor's registry but is still its own game (it self-backs host scopes and saves the
        /// registry's values). Not public API.</summary>
        internal bool OwnsRegistry;

        /// <summary>A copy on another registry, for a HotSwap replacement.</summary>
        internal EngineOptions OnRegistry(ScopeRegistry registry, bool ownsRegistry)
        {
            var copy = (EngineOptions)MemberwiseClone();
            copy.Registry = registry;
            copy.OwnsRegistry = ownsRegistry;
            return copy;
        }
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
        public ExprValue Value;
        public ExprValue Prev;
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
        /// <summary>The game's one registry: @patter (the SHARED globals), host scopes, every instance bag.</summary>
        public ScopeRegistry Registry;
        /// <summary>True when the engine made the registry (a standalone game): SaveGame then carries its values.</summary>
        public bool OwnsRegistry;
        /// <summary>The SHARED @patter globals' bag, registered under `patter`. A bag, not a map: it is
        /// what carries the audit hook a state logger pushes from, and the clone guard on a mutable
        /// default. "@patter." is the address a row reports, and here also the log path.</summary>
        public PropertyBag SharedPatter;
        /// <summary>Host scopes this engine self-backed and registered (the game bound none, nobody else had).</summary>
        public List<string> SelfBackedTokens = new List<string>();
        /// <summary>Host scopes this engine registered from EngineOptions.HostScopes bindings.</summary>
        public List<string> BoundTokens = new List<string>();
        public List<PropertyDecl> PatterSharedDecls;
        public List<PropertyDecl> PatterLocalDecls;
        public HashSet<string> PatterSharedNames;
        public Dictionary<string, HashSet<string>> SceneSharedNames;
        public Dictionary<string, int> SharedVisits = new Dictionary<string, int>();
        public Dictionary<string, SelectorState> SharedSelectors = new Dictionary<string, SelectorState>();
        /// <summary>Per-scene SHARED scene props, each registered under PatterKeys.Stage(sceneId). Made the
        /// first time any flow needs the scene, so a bag loaded before then waits in the registry and is
        /// claimed here.</summary>
        public Dictionary<string, PropertyBag> StageBags = new Dictionary<string, PropertyBag>();
        public Func<double> CustomRng;
        public bool ReplayPromptOnChoose;
        // Closed captions (#214): CaptionsOn shows caption cues in dialogue lines (default true); when
        // false the engine strips CaptionOpen..CaptionClose spans from line text. Mutable via SetClosedCaptions.
        public bool CaptionsOn;
        public string CaptionOpen;
        public string CaptionClose;
        public string CaptionCharacter; // a cast member whose whole lines are captions (silent when off)

        /// <summary>Whether `t` names a scope when splitting a ref: `@scene` (always Patter's) or any
        /// token the registry holds, so `@world.gold` and another engine's `@story.act` are not read as a
        /// @patter property literally named "world.gold".</summary>
        public bool IsScopeToken(string t) => t == "scene" || Registry.Has(t);
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

            // "@patter." so a row addresses itself the way GetProperty takes it.
            var registry = options.Registry ?? new ScopeRegistry();
            bool ownsRegistry = options.Registry == null || options.OwnsRegistry;
            var sharedPatter = new PropertyBag(sharedDecls.Select(ToScopeDecl), null, "@patter.");
            var selfBacked = new List<string>();
            var bound = new List<string>();
            var registered = new List<string>();
            try
            {
                registry.MountOwned("patter", sharedPatter, PatterKeys.Owner); // claims values the game loaded first
                registered.Add("patter");
                // Each host-scope binding is an external scope: the game keeps the values, the registry never
                // saves them. Its declarations (types, read-only) come from the compiled bundle.
                if (options.HostScopes != null)
                    foreach (var kv in options.HostScopes)
                    {
                        if (kv.Value == null || string.IsNullOrEmpty(kv.Key)) continue;
                        var spec = bundle.ScopeRegistry?.Scopes?.Find(s => s != null && s.Token == kv.Key);
                        var decls = (spec?.Declarations ?? new List<HostScopeDecl>())
                            .Where(d => d != null && d.Name != null).Select(ToForeignDecl).ToList();
                        registry.DefineForeign(kv.Key, new HostScopeResolver(kv.Value), decls,
                            new ForeignScopeOptions { Writable = spec?.Writable ?? true, Owner = PatterKeys.Owner });
                        registered.Add(kv.Key);
                        bound.Add(kv.Key);
                    }
                // A declared host scope nobody bound. A standalone engine is its own game, so it self-backs the
                // scope: a property bag seeded from the declarations, stored and SAVED by the registry like any
                // other, since only a resolver the game binds is external. Given the GAME's registry, the engine
                // registers nothing here: those tokens are the game's to register, or another engine's (a bundle
                // compiled against the Storylet Engine's spec declares `@story`), and self-backing one would
                // clash with its real owner depending only on which engine was built first.
                if (ownsRegistry && bundle.ScopeRegistry?.Scopes != null)
                    foreach (var spec in bundle.ScopeRegistry.Scopes)
                    {
                        if (spec == null || string.IsNullOrEmpty(spec.Token)) continue;
                        if (bound.Contains(spec.Token) || registry.Has(spec.Token)) continue;
                        var decls = (spec.Declarations ?? new List<HostScopeDecl>())
                            .Where(d => d != null && d.Name != null).Select(d => SelfBackedDecl(d, spec.Writable)).ToList();
                        registry.DefineOwned(spec.Token, decls, new OwnedScopeOptions { Owner = PatterKeys.Owner });
                        registered.Add(spec.Token);
                        selfBacked.Add(spec.Token);
                    }
            }
            catch (Exception e)
            {
                // A clash leaves the game's registry as it was.
                foreach (var k in registered) registry.Remove(k, keep: true);
                if (KernelErrors.Is(e)) throw KernelErrors.As(e);
                throw;
            }

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
                Registry = registry, OwnsRegistry = ownsRegistry, SelfBackedTokens = selfBacked, BoundTokens = bound,
                SharedPatter = sharedPatter, PatterSharedDecls = sharedDecls, PatterLocalDecls = localDecls,
                PatterSharedNames = sharedNames, SceneSharedNames = sceneSharedNames,
                CustomRng = options.Rng, ReplayPromptOnChoose = options.ReplayPromptOnChoose,
                CaptionsOn = options.ClosedCaptions, // captions shown by default (full text)
                CaptionOpen = bundle.ClosedCaptions?.Open ?? "[",   // default: square brackets (#214)
                CaptionClose = bundle.ClosedCaptions?.Close ?? "]",
                CaptionCharacter = string.IsNullOrEmpty(bundle.ClosedCaptions?.Character) ? "SFX" : bundle.ClosedCaptions.Character, // absent/empty -> SFX
            };
            // A declaration's `writable: false` is the STORY's promise, and the registry refuses the story's
            // write whether the scope is bound (a foreign scope's declarations) or self-backed (each owned
            // declaration carries its scope's default). The game's own SetProperty writes with host authority,
            // which that promise never binds (ruled across the family 2026-09-05).
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
        /// next child by id, drifted options drop, a vanished snippet is skipped.
        ///
        /// Returns the REPLACEMENT engine, on the same registry. This one hands its bags over (each is
        /// removed from the registry with its values kept, and the replacement claims them as it
        /// registers), its flows are closed, and it should be discarded; re-bind flow handles via
        /// <c>next.GetFlow(id)</c>. If the restore throws (defensive: §9.8 makes this unreachable for
        /// ordinary edits), the swap falls back to a fresh engine with each saved flow restarted from the
        /// top of the scene it was in; the shared properties carry over.
        /// </summary>
        public Engine HotSwap(Bundle bundle)
        {
            var snapshot = SaveGame();
            Engine CarryOver(Engine next)
            {
                next.SetLocale(_currentLocale);
                next.SetClosedCaptions(_host.CaptionsOn);
                return next;
            }
            // The replacement registers on the SAME registry, and a standalone engine's replacement is still
            // its own game (so its SaveGame keeps carrying the registry's values).
            var options = _creationOptions.OnRegistry(_host.Registry, _host.OwnsRegistry);
            Release(true);
            var replacement = new Engine(bundle, options);
            try
            {
                replacement.LoadGame(snapshot);
                return CarryOver(replacement);
            }
            catch (Exception)
            {
                // A partial load may have mutated the replacement: hand its bags back, fall back on a THIRD
                // engine and restart each flow at the top of the scene it was in (dropped when that scene is
                // gone too).
                replacement.Release(true);
                var fresh = new Engine(bundle, options);
                foreach (var kv in snapshot.Flows)
                {
                    try { fresh.OpenFlow(kv.Key, kv.Value.CurrentSceneId); }
                    catch (Exception) { /* scene deleted: drop the flow */ }
                }
                return CarryOver(fresh);
            }
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

        /// <summary>Every currently-open flow. Parity with the JS runtime's flows() and the
        /// Godot / C++ ports: a state logger mounts each flow's own bags, so it has to be able
        /// to ask an engine for them.</summary>
        public List<Flow> Flows() => new List<Flow>(_flows.Values);

        /// <summary>The SHARED kernel bags with the path each answers to in a log: the @patter
        /// globals, and one per scene for the shared @scene props. Parity with the Storylet
        /// Engine's ListBags - it is what a state logger mounts.
        ///
        /// A stage bag's LOG path is "@scene:&lt;sceneId&gt;." where its address is "@scene.": a
        /// property is addressed relative to a flow's current scene, but a log spans scenes and
        /// has to say which one. LoadGame replaces every bag, so re-enumerate after a load.</summary>
        public List<LogMount> ListBags()
        {
            var mounts = new List<LogMount> { new LogMount { Bag = _host.SharedPatter } };
            foreach (var pair in _host.StageBags)
                mounts.Add(new LogMount { Bag = pair.Value, PathPrefix = $"@scene:{pair.Key}." });
            return mounts;
        }
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

        /// <summary>Reset the whole game to its initial state: drop every flow, re-seed the shared @patter
        /// globals to their declared defaults, and clear all shared state (shared @scene bags, world visit
        /// counts). Host scopes are untouched. After a reset, open fresh flows with OpenFlow.</summary>
        public void Reset()
        {
            foreach (var f in _flows.Values) f.Close(); // finish them, don't just forget them
            _flows.Clear();
            _host.SharedPatter.Reseed(_host.PatterSharedDecls.Select(ToScopeDecl));
            _host.SharedVisits.Clear();
            _host.SharedSelectors.Clear();
            foreach (var s in _host.StageBags.Keys) _host.Registry.Remove(PatterKeys.Stage(s));
            _host.StageBags.Clear();
            // Values loaded for bags nobody has claimed yet are the old game's too: a flow opened after the
            // reset must not pick them up. Other engines' parked values are theirs, and stay.
            _host.Registry.DiscardParked("patter/");
        }

        /// <summary>Remove every bag this engine registered, keeping the values parked when `keep` (a live
        /// reload handing its state to a replacement), and close its flows. The engine is inert afterwards.</summary>
        private void Release(bool keep)
        {
            foreach (var f in _flows.Values) { f.ReleaseBags(keep); f.Close(); }
            _flows.Clear();
            var reg = _host.Registry;
            foreach (var s in _host.StageBags.Keys) reg.Remove(PatterKeys.Stage(s), keep);
            _host.StageBags.Clear();
            foreach (var t in new[] { "patter" }.Concat(_host.SelfBackedTokens))
                if (reg.Has(t)) reg.Remove(t, keep);
            foreach (var t in _host.BoundTokens)
                if (reg.Has(t)) reg.Remove(t);
        }

        // Any registered token resolves through the registry ("@world.x", another engine's "@story.x"), as it
        // does on a Flow and in every other runtime's engine-level accessor. Until 2026-09-03 this pair knew
        // only `scene` and `patter`, so "@world.x" split as a @patter name and landed in the shared bag as a
        // stray (from-storylets/unreal-wrapper-host-scopes).
        private (string scope, string name) SplitShared(string refStr)
        {
            var split = SplitRef(refStr, _host.IsScopeToken);
            if (split.scope == "scene") throw new Exception($"'{refStr}': @scene properties are scene-scoped - read/write them on a Flow, not the Engine");
            return split;
        }

        /// <summary>Read a shared (@patter / host / another engine's) property by ref. @scene refs are
        /// rejected: they are flow-level.</summary>
        public ExprValue GetProperty(string refStr)
        {
            var (scope, name) = SplitShared(refStr);
            return _host.Registry.Get(scope, name);
        }

        /// <summary>Write a shared property by ref. The GAME's surface, so a host declaration's
        /// `writable: false` does not refuse it: that is the story's promise about the story's writes
        /// (from-storylets/host-writes-to-read-only-world). Effects write through Flow instead.</summary>
        public void SetProperty(string refStr, ExprValue value)
        {
            var (scope, name) = SplitShared(refStr);
            try { _host.Registry.Set(scope, name, value, host: true); }
            catch (Exception e) when (KernelErrors.Is(e)) { throw KernelErrors.As(e); }
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
                    Value = _host.SharedPatter.Get(name) ?? PropDefault(d),
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

        /// <summary>Snapshot the whole game's NON-property state: visit counts, shared selector cursors, and
        /// every live flow's cursor and PRNG. The property values are the registry's: a standalone engine
        /// (one that made its own registry) carries them here under Registry; a game that passed a registry
        /// saves it once itself, beside each engine's SaveGame.</summary>
        public SaveGame SaveGame()
        {
            var flows = new Dictionary<string, FlowSnapshot>();
            foreach (var kv in _flows) flows[kv.Key] = kv.Value.Snapshot();
            return new SaveGame
            {
                Version = SaveVersion,
                Registry = _host.OwnsRegistry ? _host.Registry.Save() : null,
                SharedVisits = new Dictionary<string, int>(_host.SharedVisits),
                SharedSelectors = CloneSelectors(_host.SharedSelectors),
                Flows = flows,
            };
        }

        /// <summary>The save version SaveGame writes. Version 2 saves (which carried the property values
        /// in the engine's own sections) still load.</summary>
        public const int SaveVersion = 3;

        /// <summary>Restore a SaveGame: visit counts, shared selector cursors, and every flow. Property
        /// values come from the registry. A save that carries them (a standalone engine's, or a version 2
        /// save from before the registry held them) has them moved into the registry here; otherwise the
        /// game loads its registry itself, before or after this call. Either order works: this engine's bags
        /// are handed back to the registry (values kept) and the restored flows claim them as they register.</summary>
        public void LoadGame(SaveGame save)
        {
            if (save.Version != 2 && save.Version != SaveVersion) throw new Exception($"unsupported save version: {save.Version}");
            var reg = _host.Registry;
            var saved = save.Flows ?? new Dictionary<string, FlowSnapshot>();
            // Flows the save does not have are over: their bags go. The rest are handed back with their
            // values, which is what a game that loaded its registry first has just laid the save's values over.
            foreach (var kv in _flows) { kv.Value.ReleaseBags(saved.ContainsKey(kv.Key)); kv.Value.Close(); }
            _flows.Clear();
            foreach (var s in _host.StageBags.Keys) reg.Remove(PatterKeys.Stage(s), keep: true);
            _host.StageBags.Clear();

            var values = save.Version == 2 ? SectionsFromV2(save) : save.Registry;
            if (values != null)
            {
                // The engine's own registry takes the save wholesale. A game's registry may hold values the
                // game loaded for other engines, still waiting to be claimed: add to those, never replace them.
                if (_host.OwnsRegistry) reg.Load(values);
                else reg.Load(values, keepParked: true);
            }
            _host.SharedVisits.Clear();
            foreach (var kv in save.SharedVisits ?? new Dictionary<string, int>()) _host.SharedVisits[kv.Key] = kv.Value;
            _host.SharedSelectors.Clear();
            foreach (var kv in save.SharedSelectors ?? new Dictionary<string, SelectorState>()) _host.SharedSelectors[kv.Key] = kv.Value.Clone();
            foreach (var kv in saved)
            {
                var flow = new Flow(kv.Key, _host, _defaultSeed);
                flow.Restore(kv.Value);
                _flows[kv.Key] = flow;
            }
        }

        /// <summary>A version 2 save's property values, as registry sections under this engine's keys.</summary>
        private static OrderedMap<string, OrderedMap<string, ExprValue>> SectionsFromV2(SaveGame save)
        {
#pragma warning disable CS0618 // the version 2 fields are read here, and only here
            var out_ = new OrderedMap<string, OrderedMap<string, ExprValue>>();
            if (save.Shared != null) out_.Set("patter", OrderedOf(save.Shared));
            foreach (var kv in save.StageBags ?? new Dictionary<string, Dictionary<string, ExprValue>>())
                out_.Set(PatterKeys.Stage(kv.Key), OrderedOf(kv.Value));
            foreach (var f in save.Flows ?? new Dictionary<string, FlowSnapshot>())
            {
                if (f.Value.Scopes != null) out_.Set(PatterKeys.FlowGlobals(f.Key), OrderedOf(f.Value.Scopes));
                foreach (var kv in f.Value.SceneBags ?? new Dictionary<string, Dictionary<string, ExprValue>>())
                    out_.Set(PatterKeys.FlowScene(f.Key, kv.Key), OrderedOf(kv.Value));
            }
#pragma warning restore CS0618
            return out_;
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

        /// <summary>A host-scope declaration (`@world.x`) as a registry declaration.</summary>
        internal static ScopeDeclaration ToForeignDecl(HostScopeDecl d) => new ScopeDeclaration
        {
            Name = d.Name, Type = d.Type, Values = d.Values, Stages = d.Stages, Default = d.Default, Writable = d.Writable,
        };

        /// <summary>A self-backed host scope's declaration (the standalone `@world`): the scope's own
        /// `writable` default folded in, since an owned bag reads writability per declaration. Names fold to
        /// lower case in the bag, as the compiler emits every reference (`isNight` is read as `isnight`): the
        /// JS runtime once seeded them verbatim, so a capitalised name read as absent (fixed 2026-08-18).</summary>
        internal static ScopeDeclaration SelfBackedDecl(HostScopeDecl d, bool? scopeWritable)
        {
            var decl = ToForeignDecl(d);
            decl.Writable = d.Writable ?? scopeWritable;
            return decl;
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

        /// <summary>A flat name/value map as PropertyBag.Load and the registry take it.</summary>
        internal static OrderedMap<string, ExprValue> OrderedOf(Dictionary<string, ExprValue> flat)
        {
            var values = new OrderedMap<string, ExprValue>();
            foreach (var e in flat ?? new Dictionary<string, ExprValue>()) values.Set(e.Key, e.Value);
            return values;
        }

        internal static ExprValue PropDefault(PropertyDecl d)
        {
            if (d.Default != null) return d.Default;
            switch (d.Type)
            {
                case "boolean": return ExprValue.False;
                case "number": return ExprValue.Num(0);
                case "string": return ExprValue.Str("");
                case "flags": return ExprValue.Flags(new List<string>());
                case "enum": return ExprValue.Str(d.Values != null && d.Values.Count > 0 ? d.Values[0] : "");
                case "quality": return ExprValue.Str(d.Stages != null && d.Stages.Count > 0 ? d.Stages[0] : ""); // the ladder's start
                default: return ExprValue.False;
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

    /// <summary>A full resumable save (version 3): everything that is not a property, plus the registry's
    /// values when the engine made its own registry. The shape is the family's (`patter/save@0`, written
    /// by PatterSave): every runtime writes the same key paths.</summary>
    public sealed class SaveGame
    {
        public int Version;
        /// <summary>The engine's own registry's values, keyed by registry key (`patter`,
        /// `patter/flow/&lt;flow&gt;/scene/&lt;scene&gt;`, `world`, and so on): present only when the engine made
        /// the registry itself (a standalone game). A game that passed a registry saves it once, beside this.</summary>
        public OrderedMap<string, OrderedMap<string, ExprValue>> Registry;
        /// <summary>World-wide per-node entry counts (node id -> times entered by any flow).</summary>
        public Dictionary<string, int> SharedVisits;
        /// <summary>Shared selector cursors (node id -> state) for `shared` memoried selectors.</summary>
        public Dictionary<string, SelectorState> SharedSelectors;
        /// <summary>Each live flow's snapshot, keyed by flow id.</summary>
        public Dictionary<string, FlowSnapshot> Flows;

        /// <summary>Version 2 only: the shared @patter globals. Read from an older save, never written.</summary>
        [Obsolete("Version 2 saves only. Property values are the registry's now: see Registry.")]
        public Dictionary<string, ExprValue> Shared;
        /// <summary>Version 2 only: the shared @scene bags (scene id -> name -> value). Read, never written.</summary>
        [Obsolete("Version 2 saves only. Property values are the registry's now: see Registry.")]
        public Dictionary<string, Dictionary<string, ExprValue>> StageBags;
    }

    /// <summary>The serialised cursor, PRNG, and visits of one flow. Its properties are the registry's.</summary>
    public sealed class FlowSnapshot
    {
        /// <summary>Version 2 only: the flow's not-shared @patter globals. Read, never written.</summary>
        [Obsolete("Version 2 saves only. Property values are the registry's now: see SaveGame.Registry.")]
        public Dictionary<string, ExprValue> Scopes;
        /// <summary>Version 2 only: the flow's per-scene @scene bags. Read, never written.</summary>
        [Obsolete("Version 2 saves only. Property values are the registry's now: see SaveGame.Registry.")]
        public Dictionary<string, Dictionary<string, ExprValue>> SceneBags;
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
