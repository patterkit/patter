// Flow - one playable flow: its execution cursor (a continuation stack of block /
// run-group positions), the not-shared half of @patter / @scene, a serialisable PRNG,
// per-flow visit + selector state. Port of engine.ts's Flow class.

using System;
using System.Collections.Generic;
using System.Linq;
using Wildwinter.Expr;

namespace Patterkit.Patterplay
{
    public sealed class Flow
    {
        public string Id { get; }
        private readonly FlowHost _host;
        private readonly List<LogEntry> _log = new List<LogEntry>();
        /// <summary>Monotonic across the flow's life; survives ClearLog so order is stable.</summary>
        private int _seq;
        // The per-flow halves of the two scopes. The NOT-shared @patter globals live in `_local`; the
        // NOT-shared @scene props live in `_sceneBags` (namespaced per scene; they PERSIST across
        // re-entries, spec §7). The SHARED halves live on the host (SharedPatter / StageBags). All of
        // them are registered in the game's registry. Each resolver presents one merged scope, routing
        // each property to its half by the declared `shared` flag: that split is why @patter and @scene
        // are composed here rather than aliased to a single registry key.
        private PropertyBag _local;                                           // PatterKeys.FlowGlobals
        private readonly Dictionary<string, PropertyBag> _sceneBags = new Dictionary<string, PropertyBag>();
        /// <summary>The registry keys this flow has registered (its globals and each scene bag).</summary>
        private readonly List<string> _registered = new List<string>();
        private uint _rngState;
        private readonly Mulberry32 _prng = new Mulberry32(0u);

        private bool _started;
        private bool _flowEnded;
        // Closed by the engine (see Close()). Terminal, and distinct from _flowEnded: an ENDED flow is
        // merely out of content and Goto revives it; a CLOSED one is finished for good.
        private bool _closed;
        private string _currentSceneId;
        private List<StackFrame> _stack = new List<StackFrame>();
        private Node _activeSnippet;
        private int _beatIndex;
        private ChoiceStateInternal _pendingChoice;
        // When ReplayPromptOnChoose: the chosen option's AUTHORED prompt beat (id, gameData, tags), delivered
        // before its content, and the prompt exactly as the choice showed it (text and speaker fields).
        // _pendingPromptShown is null only after loading a save written before saves carried it: the beat
        // is then resolved when it is delivered, as it always was.
        private Beat _pendingPromptBeat;
        private ChoicePrompt _pendingPromptShown;
        // The chosen option owning _pendingPromptBeat, so a save taken between Choose() and the next
        // Advance() can find the prompt beat again on load (it isn't otherwise reachable by id).
        private string _pendingPromptOwnerId;
        private Dictionary<string, SelectorState> _selectors = new Dictionary<string, SelectorState>();
        private Dictionary<string, int> _visitCounts = new Dictionary<string, int>();

        // The eval context is built once and REFRESHED only when the registry's set of scopes moves
        // (its Revision): every constituent resolves live state at call time (bags mutate in place;
        // patter and scene route through this flow's resolvers, which read the current bags and scene),
        // but another engine registering `@story` after this flow opened must still be readable.
        private readonly EvalContext _evalCtx;
        private readonly PatterHost _evalHost;
        private readonly IScopeSource _patterScope;
        private readonly IScopeSource _sceneScope;
        private int _ctxRevision = -1;
        private Func<string, string, List<string>> _registryQualities;

        internal Flow(string id, FlowHost host, double seed)
        {
            Id = id;
            _host = host;
            _rngState = Mulberry32.ToUint32(seed);
            _local = FreshLocal(); // registered by Start / Restore

            // The dialect's host hooks. The shared EvalContext carries them as an
            // opaque object; PatterDialect casts it back to PatterHost.
            _evalHost = new PatterHost
            {
                NextRandom = Rng,
                Visits = id2 => _visitCounts.TryGetValue(id2, out var v) ? v : 0,
                PatterVisits = id2 => _host.SharedVisits.TryGetValue(id2, out var v) ? v : 0,
            };
            _evalCtx = new EvalContext
            {
                Host = _evalHost,
                // The quality channel: a property's stage ladder, from wherever the declaration lives -
                // @patter decls, the CURRENT scene's decls (they move with the flow), or the registry.
                Qualities = StagesFor,
            };
            _patterScope = new ResolverScope(PatterGet);
            _sceneScope = new ResolverScope(SceneGet);
        }

        /// <summary>The eval context, its scopes refreshed if the registry's set of scopes has moved since.</summary>
        private EvalContext Context()
        {
            var reg = _host.Registry;
            if (reg.Revision != _ctxRevision)
            {
                var basis = reg.ToEvalContext();
                _evalCtx.Scopes.Clear();
                foreach (var kv in basis.Scopes) _evalCtx.Scopes[kv.Key] = kv.Value; // every registered scope: other engines' too
                _evalCtx.Scopes["patter"] = _patterScope; // the merged shared + per-flow views
                _evalCtx.Scopes["scene"] = _sceneScope;
                _registryQualities = basis.Qualities;
                _ctxRevision = reg.Revision;
            }
            return _evalCtx;
        }

        public string CurrentScene => _currentSceneId;

        /// <summary>The stage ladder of `@scope.name` when it is a declared quality, else null. Names
        /// compare lowercase, as the compiler emits references (the self-backed scope lesson). Mirrors the
        /// JS Flow.stagesFor.</summary>
        private List<string> StagesFor(string scope, string name)
        {
            if (name == null) return null;
            var key = name.ToLowerInvariant();
            if (scope == "patter")
                return Ladders("patter", () => _host.PatterSharedDecls.Concat(_host.PatterLocalDecls).Select(d => (d.Name, d.Type, d.Stages)), key);
            if (scope == "scene")
            {
                if (_currentSceneId == null || !_host.Bundle.Scenes.TryGetValue(_currentSceneId, out var scene)) return null;
                return Ladders("scene/" + _currentSceneId, () => scene.SceneProps.Select(d => (d.Name, d.Type, d.Stages)), key);
            }
            // Any other scope's ladder is the registry's (another engine's `@story`, the game's `@world`), with
            // the bundle's own host-scope declarations behind it for a game that registered `@world` undeclared.
            var fromRegistry = _registryQualities?.Invoke(scope, name);
            if (fromRegistry != null) return fromRegistry;
            return Ladders("host/" + scope, () =>
            {
                var spec = _host.Bundle.ScopeRegistry?.Scopes?.Find(s => s != null && s.Token == scope);
                return (spec?.Declarations ?? new List<HostScopeDecl>()).Select(d => (d.Name, d.Type, d.Stages));
            }, key);
        }

        /// <summary>The stage ladder of each declared quality in one set of declarations, by lowercased name (the
        /// first declaration of a name wins). Built once per set and kept on the host: a comparison asks for a
        /// ladder every time it runs, and scanning the declarations each time cost a pass and a lowercasing
        /// per declaration per comparison.</summary>
        private List<string> Ladders(string cacheKey, Func<IEnumerable<(string Name, string Type, List<string> Stages)>> decls, string key)
        {
            if (!_host.QualityLadders.TryGetValue(cacheKey, out var found))
            {
                found = new Dictionary<string, List<string>>();
                foreach (var d in decls())
                {
                    if (d.Type != "quality" || d.Name == null || d.Stages == null) continue;
                    var k = d.Name.ToLowerInvariant();
                    if (!found.ContainsKey(k)) found[k] = d.Stages;
                }
                _host.QualityLadders[cacheKey] = found;
            }
            return found.TryGetValue(key, out var stages) ? stages : null;
        }

        /// <summary>Advance repeatedly, collecting every played beat, until a choice or the end - the
        /// "play to the next stop" a host's play UI / tooling wants. The terminal choice / end is returned
        /// as Stop; Played holds the line / text / game-event results walked on the way to it. Termination
        /// is guaranteed (each Advance makes progress, or Settle throws on a contentless jump cycle).</summary>
        public AdvanceToStopResult AdvanceToStop()
        {
            var res = new AdvanceToStopResult();
            while (true)
            {
                var r = Advance();
                if (r.Type == StepType.Choice || r.Type == StepType.End) { res.Stop = r; return res; }
                res.Played.Add(r);
            }
        }

        /// <summary>Send this flow's cursor to an ADDRESS, exactly as an authored `go` jump would: the target
        /// scene's onEntry runs, entering counts as a visit, and the callstack is REPLACED (pending call-returns
        /// discarded). `scene`/`block` are host-facing gameIds (spec §6) or internal ids; `block` is scene-scoped.
        /// "END" ends the flow. HOST navigation, so it lands IMMEDIATELY: the rest of the snippet being delivered
        /// is abandoned and a pending choice dropped. An unstarted flow starts here; an ended one resumes.
        /// Returns false - cursor untouched - if the address does not resolve. MOVES, never resets.</summary>
        public bool Goto(string scene, string block = null)
        {
            if (_closed) return false; // closed is terminal: unlike "ended", a goto cannot revive it
            Touch();
            if (scene == "END")
            {
                _started = true; ClearPending();
                _activeSnippet = null; _beatIndex = 0;
                _flowEnded = true; _stack = new List<StackFrame>();
                return true;
            }
            // Resolve BOTH addresses before touching state, so a bad one is a no-op rather than a half-move.
            string sceneId = Engine.ResolveScene(_host, scene);
            if (sceneId == null) return false;
            string blockId = null;
            if (block != null)
            {
                blockId = Engine.ResolveBlock(_host, sceneId, block);
                if (blockId == null) return false; // a block address is scene-scoped: unknown HERE is unknown
            }
            if (!_started) { Begin(sceneId, blockId); return true; }

            ClearPending();
            _activeSnippet = null; _beatIndex = 0; // abandon the rest of the snippet being delivered
            _flowEnded = false;                    // an ended flow resumes at the target
            EnterTarget(blockId ?? sceneId, "jump"); // "jump" = replace the stack, exactly like an authored goto
            Settle();
            return true;
        }

        /// <summary>Finish this flow for good. Engine-managed (CloseFlow, Reset, and the OpenFlow replace path).
        /// A dropped flow used to stay fully live, so a host still holding it could keep advancing it and move
        /// shared state. Closing makes that stale reference inert. Terminal: never revived.</summary>
        public void Close()
        {
            ReleaseBags(false);
            _closed = true;
            _flowEnded = true;
            _stack = new List<StackFrame>();
            _activeSnippet = null;
            _beatIndex = 0;
            ClearPending();
        }

        /// <summary>Drop everything waiting to be delivered: an open choice, and a chosen option's prompt still
        /// to be replayed. Every move that abandons the flow's place (Start and Reset, Goto, Close) does this, so
        /// none leaves a stale prompt behind. Start cleared only the choice, so a Reset between Choose and the
        /// next Advance replayed the abandoned run's prompt as the new run's first beat.</summary>
        private void ClearPending()
        {
            _pendingChoice = null;
            _pendingPromptBeat = null;
            _pendingPromptShown = null;
            _pendingPromptOwnerId = null;
        }

        /// <summary>Inside a checkpoint, the first change to this flow records its cursor and PRNG, so a
        /// rollback can put them back: a handful of fields and a copy of the call stack (a few frames), never
        /// its history. Its visits, selector cursors, and property values are recorded change by change as
        /// they happen.</summary>
        private void Touch()
        {
            var journal = _host.Journal;
            if (journal == null || journal.Flows.Contains(this)) return;
            journal.Flows.Add(this);
            var rngState = _rngState; var started = _started; var flowEnded = _flowEnded;
            var currentSceneId = _currentSceneId; var activeSnippet = _activeSnippet; var beatIndex = _beatIndex;
            var pendingChoice = _pendingChoice; var pendingPromptBeat = _pendingPromptBeat; var pendingPromptShown = _pendingPromptShown; var pendingPromptOwnerId = _pendingPromptOwnerId;
            var stack = _stack.Select(f => f.Clone()).ToList(); // frames advance in place, so copy them
            journal.Undo.Add(() =>
            {
                _rngState = rngState; _started = started; _flowEnded = flowEnded;
                _currentSceneId = currentSceneId; _activeSnippet = activeSnippet; _beatIndex = beatIndex;
                _pendingChoice = pendingChoice; _pendingPromptBeat = pendingPromptBeat; _pendingPromptShown = pendingPromptShown; _pendingPromptOwnerId = pendingPromptOwnerId;
                _stack = stack;
            });
        }

        /// <summary>True once the engine has closed this flow.</summary>
        public bool IsClosed => _closed;
        /// <summary>THIS flow's own kernel bags: its not-shared @patter half and its per-scene
        /// @scene props, each prefixed with the flow id so one path space holds every flow. The
        /// shared halves are the Engine's ListBags.</summary>
        public List<LogMount> ListBags()
        {
            var mounts = new List<LogMount> { new LogMount { Bag = _local, PathPrefix = $"{Id}/@patter." } };
            foreach (var pair in _sceneBags)
                mounts.Add(new LogMount { Bag = pair.Value, PathPrefix = $"{Id}/@scene:{pair.Key}." });
            return mounts;
        }

        public bool IsEnded() => _flowEnded;

        // -- scope resolvers ----------------------------------------------------

        private ExprValue PatterGet(string n)
        {
            if (_host.PatterSharedNames.Contains(n)) return _host.SharedPatter.Get(n);
            return _local.Get(n);
        }
        private void PatterSet(string n, ExprValue v)
        {
            if (_host.PatterSharedNames.Contains(n)) _host.Registry.Set("patter", n, v); else _local.Set(n, v);
        }
        /// <summary>The bag a @scene property of the current scene lives in (stage or this flow's), made
        /// and registered if missing.</summary>
        private PropertyBag SceneBagFor(string n)
        {
            var s = _currentSceneId;
            if (s == null || !_host.Bundle.Scenes.ContainsKey(s)) return null;
            EnsureSceneBags(s);
            bool shared = _host.SceneSharedNames.TryGetValue(s, out var names) && names.Contains(n.ToLowerInvariant());
            if (shared) return _host.StageBags.TryGetValue(s, out var sb) ? sb : null;
            return _sceneBags.TryGetValue(s, out var fb) ? fb : null;
        }
        private ExprValue SceneGet(string n)
        {
            var bag = SceneBagFor(n);
            return bag?.Get(n);
        }
        private void SceneSet(string n, ExprValue v)
        {
            var bag = SceneBagFor(n);
            // Not silent: an engine write notifies subscribers and is audited, where a host write
            // (an inspector poking a value) is silent but still audited. This is the engine's own.
            if (bag != null) bag.Set(n, v);
        }

        // -- host API -----------------------------------------------------------

        /// <summary>Begin this flow at a scene (null: the first authored scene), and optionally a block within
        /// it. The engine's own entry point: OpenFlow and a Goto on an unstarted flow begin a flow here. A
        /// game calls <see cref="Reset"/>.</summary>
        internal void Begin(string sceneId, string blockId)
        {
            // Starting resets this flow's property bags, which a rollback can't put back: only a flow opened
            // inside the checkpoint may start in one.
            if (_host.Journal != null && !_host.Journal.Opened.Contains(this))
                throw new Exception("a flow can't be started or reset while a checkpoint is open");
            // A start is a reset: this flow's bags go, and so does anything a load left waiting for them.
            ReleaseBags(false);
            _host.Registry.DiscardParked(PatterKeys.Flow(Id));
            MountLocal();
            _selectors.Clear();
            _visitCounts.Clear();
            _stack = new List<StackFrame>();
            _currentSceneId = null;
            _flowEnded = false;
            _activeSnippet = null;
            _beatIndex = 0;
            ClearPending();
            _started = true;

            if (blockId != null)
            {
                if (!_host.BlockToScene.TryGetValue(blockId, out var sid)) throw new Exception($"unknown block: {blockId}");
                EnterSceneSetup(sid);
                _stack = new List<StackFrame> { new StackFrame { SceneId = sid, ContainerId = blockId, Index = 0 } };
                Enter(blockId);
            }
            else
            {
                string id = sceneId ?? _host.Bundle.Scenes.Keys.FirstOrDefault();
                if (id == null || !_host.Bundle.Scenes.TryGetValue(id, out var scene))
                    throw new Exception(id != null ? $"unknown scene: {id}" : "no scenes in bundle");
                EnterSceneSetup(id);
                var first = scene.Blocks.FirstOrDefault();
                if (first != null) { _stack = new List<StackFrame> { new StackFrame { SceneId = id, ContainerId = first.Id, Index = 0 } }; Enter(first.Id); }
            }
            Settle();
        }

        /// <summary>Forget everything in this flow and begin again: its per-flow state (not-shared @patter
        /// globals and @scene props), cursor, call stack, selector cursors, visit counts, and anything waiting to
        /// be delivered. Shared state is untouched. The one public way to begin a flow again (OpenFlow begins a
        /// new one), on every runtime.</summary>
        public void Reset(string sceneId = null, string blockId = null) => Begin(sceneId, blockId);

        /// <summary>Use <see cref="Reset"/>, the one public name for beginning a flow again on every runtime.
        /// Start was the same call under a second name, and goes in a later release.</summary>
        [Obsolete("Use Reset, the same call under the name every Patterplay runtime uses.")]
        public void Start(string sceneId, string blockId) => Reset(sceneId, blockId);

        public StepResult Advance()
        {
            if (_closed) return new StepResult { Type = StepType.End }; // a stale reference drives nothing
            if (!_started) throw new Exception("flow has not been started");
            Touch();
            if (_pendingPromptBeat != null)
            {
                var b = _pendingPromptBeat; var shown = _pendingPromptShown;
                _pendingPromptBeat = null; _pendingPromptShown = null; _pendingPromptOwnerId = null;
                return shown != null ? PromptResult(b, shown) : BeatResult(b);
            }
            Settle();
            if (_flowEnded) return StepResult.End();
            if (_pendingChoice != null) return new StepResult { Type = StepType.Choice, GroupId = _pendingChoice.GroupId, Options = _pendingChoice.Options };
            if (_activeSnippet == null) { _flowEnded = true; return StepResult.End(); }
            return BeatResult(_activeSnippet.Beats[_beatIndex++]);
        }

        public List<ChoiceOption> GetChoices() => _pendingChoice?.Options ?? new List<ChoiceOption>();

        /// <summary>This flow's decisions, in order. Empty unless the run was opened with
        /// Log = true. The engine's log carries the same events tagged with the flow; this one
        /// is what a single conversation reads as.</summary>
        public IReadOnlyList<LogEntry> Log() => _log;

        /// <summary>Drop the retained entries. Seq keeps counting, so order survives a clear.</summary>
        public void ClearLog() => _log.Clear();

        /// <summary>Record one decision, on this flow's log and the engine's. Cheap with logging
        /// off: the entry is never built. The engine's list is appended to by reference - a
        /// callback would have to capture the engine, and that cycle is what Godot's weak debug
        /// registry refused.</summary>
        private void Emit(LogEntry e)
        {
            if (!_host.Tracing) return;
            e.Scene = _currentSceneId;
            var wide = e.Copy();
            wide.Flow = Id;
            if (_host.LogEnabled)
            {
                e.Seq = _seq++;
                _log.Add(e);
                wide.Seq = _host.EngineLogSeq++;
                _host.EngineLog.Add(wide);
            }
            if (_host.TraceHandlers.Count > 0)
                foreach (var h in _host.TraceHandlers.ToArray()) h(Id, wide);
        }

        /// <summary>How many times this flow has entered each node, by node id.</summary>
        public IReadOnlyDictionary<string, int> GetVisitCounts() => _visitCounts;

        public void Choose(string id)
        {
            var choice = _pendingChoice;
            if (choice == null) throw new Exception("no choice is pending");
            var option = choice.Options.FirstOrDefault(o => o.Id == id);
            if (option == null) throw new Exception($"unknown choice option: {id}");
            if (!option.Eligible) throw new Exception($"choice option is not eligible: {id}");
            Touch();
            var node = choice.ById[id];
            if (_host.Tracing) Emit(new LogEntry { Type = "chose", Group = choice.GroupId, Option = id });
            _pendingChoice = null;
            // Speak the chosen option's prompt back as its first beat (spec 5): only an AUTHORED prompt, and
            // exactly as the choice showed it. A prompt borrowed from the option's own first content line is
            // not replayed, since that line is about to play as content anyway.
            var authored = _host.ReplayPromptOnChoose ? AuthoredPromptOf(node) : null;
            _pendingPromptBeat = authored != null && option.Prompt != null ? authored : null;
            _pendingPromptShown = _pendingPromptBeat != null ? ClonePrompt(option.Prompt) : null;
            _pendingPromptOwnerId = _pendingPromptBeat != null ? node.Id : null;
            EnterChild(node);
        }

        /// <summary>Read a property by ref: @patter / @scene (each routed by its `shared` flag), or any
        /// other scope the registry holds (a host scope, another engine's).</summary>
        public ExprValue GetProperty(string refStr)
        {
            var (scope, name) = Engine.SplitRef(refStr, _host.IsScopeToken);
            if (scope == "patter") return PatterGet(name);
            if (scope == "scene") return SceneGet(name);
            return _host.Registry.Get(scope, name); // host scopes, other engines' scopes
        }

        /// <summary>Write a property by ref. The GAME's surface, so a host declaration's `writable: false`
        /// binds the story, not the game that owns the value. Effects use WriteProperty(.., host: false).</summary>
        public void SetProperty(string refStr, ExprValue value) => WriteProperty(refStr, value, true);

        /// <summary>The write itself. `host` says WHO is writing, which is all `writable: false` cares
        /// about: the story is refused, the game is not.</summary>
        private void WriteProperty(string refStr, ExprValue value, bool host)
        {
            try { WritePropertyTo(refStr, value, host); }
            catch (Exception e) when (KernelErrors.Is(e)) { throw KernelErrors.As(e); }
        }

        private void WritePropertyTo(string refStr, ExprValue value, bool host)
        {
            var (scope, name) = Engine.SplitRef(refStr, _host.IsScopeToken);
            var journal = _host.Journal;
            if (scope == "patter")
            {
                // Inside a checkpoint, each write records how to put the old value back, against the bag it
                // actually landed in (a @scene write's bag depends on the scene the flow is in at the time).
                if (journal != null)
                {
                    bool shared = _host.PatterSharedNames.Contains(name);
                    var prev = shared ? _host.SharedPatter.Get(name) : _local.Get(name);
                    var bag = _local;
                    if (prev != null)
                        journal.Undo.Add(shared ? (Action)(() => _host.Registry.Set("patter", name, prev)) : () => bag.Set(name, prev));
                }
                PatterSet(name, value);
            }
            else if (scope == "scene")
            {
                // The resolver stays graceful for expression evaluation, but a host write with nowhere to
                // land must error, not silently vanish.
                if (_currentSceneId == null) throw new Exception($"'{refStr}': the flow has not entered a scene yet");
                if (journal != null)
                {
                    var bag = SceneBagFor(name);
                    var prev = bag?.Get(name);
                    if (bag != null && prev != null) journal.Undo.Add(() => bag.Set(name, prev));
                }
                SceneSet(name, value);
            }
            else
            {
                // Host scopes and other engines' scopes. The registry refuses a STORY write to a
                // `writable: false` declaration, bound or self-backed, and never the game's.
                var prev = journal != null ? _host.Registry.Get(scope, name) : null;
                _host.Registry.Set(scope, name, value, host);
                // Recorded after the write: one a read-only host scope refused never happened, so has nothing to undo.
                if (journal != null && prev != null) journal.Undo.Add(() => _host.Registry.Set(scope, name, prev, host: true));
            }
        }

        // -- settle / entry -----------------------------------------------------

        private void Settle()
        {
            int transitions = 0;
            for (;;)
            {
                if (++transitions > 10000) throw new Exception("flow did not settle after 10000 transitions - likely a jump cycle with no deliverable content");
                if (_flowEnded || _pendingChoice != null) return;

                if (_activeSnippet != null)
                {
                    if (_beatIndex < (_activeSnippet.Beats?.Count ?? 0)) return; // a beat is ready
                    RunEffects(_activeSnippet.OnExit, _activeSnippet.Id);
                    var jump = _activeSnippet.Jump;
                    _activeSnippet = null;
                    _beatIndex = 0;
                    ResolveJump(jump);
                    continue;
                }

                if (_stack.Count == 0) { _flowEnded = true; return; }
                var frame = _stack[_stack.Count - 1];
                if (frame.SceneId != _currentSceneId) _currentSceneId = frame.SceneId;
                var children = ChildrenOf(frame.ContainerId);
                if (children == null) { _stack.RemoveAt(_stack.Count - 1); continue; }
                // A `run` container walks its children in order, skipping the ones whose
                // condition does not hold. That skip IS the decision an author asks about,
                // so the trace records the ones walked past, not only the one entered.
                int from = frame.Index;
                while (frame.Index < children.Count && !Eligible(children[frame.Index])) frame.Index++;
                if (_host.Tracing && frame.Index != from)
                {
                    var seen = new List<(string, bool)>();
                    for (int i = from; i <= frame.Index && i < children.Count; i++)
                        seen.Add((children[i].Id, i == frame.Index));
                    Emit(new LogEntry { Type = "select", Group = frame.ContainerId, Selector = "run",
                        Children = seen,
                        Picked = frame.Index < children.Count ? children[frame.Index].Id : null });
                }
                if (frame.Index >= children.Count) { _stack.RemoveAt(_stack.Count - 1); continue; }
                EnterChild(children[frame.Index++]);
            }
        }

        private void EnterSceneSetup(string sceneId)
        {
            if (!_host.Bundle.Scenes.TryGetValue(sceneId, out var scene)) throw new Exception($"unknown scene: {sceneId}");
            _currentSceneId = sceneId;
            Enter(sceneId);
            SeedScene(scene);
            RunEffects(scene.OnEntry, scene.Id);
        }

        private void EnterChild(Node node)
        {
            Enter(node.Id);
            if (node.IsSnippet) { BeginSnippet(node); return; }
            string selector = node.Selector ?? "run";
            if (selector == "run") { _stack.Add(new StackFrame { SceneId = _currentSceneId, ContainerId = node.Id, Index = 0 }); return; }
            if (selector == "choice") { SetupChoice(node); return; }
            var pick = SelectChild(node);
            if (pick != null) EnterChild(pick);
        }

        private List<Node> ChildrenOf(string containerId)
        {
            if (_host.BlockById.TryGetValue(containerId, out var block)) return block.Children;
            if (_host.NodeIndex.TryGetValue(containerId, out var node) && node.IsGroup) return node.Children;
            return null;
        }

        private void BeginSnippet(Node snippet)
        {
            RunEffects(snippet.OnEnter, snippet.Id);
            _activeSnippet = snippet;
            _beatIndex = 0;
        }

        private void SetupChoice(Node group)
        {
            var options = new List<ChoiceOption>();
            var byId = new Dictionary<string, Node>();
            var fallbacks = new List<Node>();
            foreach (var child in group.Children)
            {
                if (child.Fallback) { fallbacks.Add(child); continue; }
                if (!child.Sticky && (_visitCounts.TryGetValue(child.Id, out var vc) ? vc : 0) >= 1) continue;
                bool eligible = Eligible(child);
                bool hidden = child.SecretUntilEligible;
                if (!eligible && hidden) continue;
                options.Add(new ChoiceOption { Id = child.Id, Prompt = PromptFor(child), Eligible = eligible, GameData = child.GameData });
                byId[child.Id] = child;
            }
            // A choice is offered only when the player can take something. One whose every remaining option is
            // greyed out left the player stuck in front of it, so it runs dry instead, as a choice with no
            // options does: the fallback follows if there is one, otherwise the flow moves on.
            if (options.Any(o => o.Eligible))
            {
                // Including the options a condition left ineligible: "why is that greyed out"
                // is a question about the moment the choice was built.
                if (_host.Tracing) Emit(new LogEntry { Type = "choice", Group = group.Id,
                    Options = options.Select(o => (o.Id, o.Eligible)).ToList() });
                _pendingChoice = new ChoiceStateInternal { GroupId = group.Id, Options = options, ById = byId };
                return;
            }
            // No normal option can be taken. Auto-follow the fallback if it is eligible (its own condition
            // still applies).
            var fallback = fallbacks.FirstOrDefault(Eligible);
            if (fallback != null) { EnterChild(fallback); return; }
            // Nothing takeable and no eligible fallback: the choice runs dry and the flow walks
            // past it. The behaviour is unchanged; this makes the silent fall-through observable.
            if (_host.Tracing) Emit(new LogEntry { Type = "dry", Group = group.Id });
            _host.OnDryChoice?.Invoke(group.Id);
        }

        // -- jumps --------------------------------------------------------------

        private void ResolveJump(Jump jump)
        {
            if (jump == null) return;
            EnterTarget(jump.To, jump.Mode == "call" ? "call" : "jump");
        }

        private void EnterTarget(string to, string mode)
        {
            if (_host.Tracing) Emit(new LogEntry { Type = "jump", To = to, Mode = mode });
            if (to == "END") { _flowEnded = true; _stack = new List<StackFrame>(); return; }

            string sceneId, containerId;
            if (_host.Bundle.Scenes.TryGetValue(to, out var scene))
            {
                EnterSceneSetup(to);
                var first = scene.Blocks.FirstOrDefault();
                if (first == null) { if (mode == "jump") _stack = new List<StackFrame>(); return; }
                sceneId = to; containerId = first.Id;
            }
            else
            {
                if (!_host.BlockToScene.TryGetValue(to, out var sid)) throw new Exception($"jump target not found: {to}");
                if (sid != _currentSceneId) EnterSceneSetup(sid);
                sceneId = sid; containerId = to;
            }

            Enter(containerId);
            var frame = new StackFrame { SceneId = sceneId, ContainerId = containerId, Index = 0 };
            if (mode == "call") _stack.Add(frame); else _stack = new List<StackFrame> { frame };
        }

        // -- selectors ----------------------------------------------------------

        private Node SelectChild(Node group)
        {
            // Each condition is evaluated ONCE: the verdicts and the eligible list come from the same pass.
            // Twice cost double, and a condition calling random() drew twice, so its verdict and the pick
            // could disagree.
            var considered = group.Children.Select(c => (c.Id, Eligible(c))).ToList();
            var eligible = new List<Node>();
            for (int k = 0; k < considered.Count; k++) if (considered[k].Item2) eligible.Add(group.Children[k]);
            string sel = group.Selector ?? "default";
            // The reasoning goes in the entry: every child looked at, with its verdict.
            Node Trace(Node picked)
            {
                bool sequence = group.Selector == "sequence";
                if (_host.Tracing) Emit(new LogEntry { Type = "select", Group = group.Id, Selector = sel,
                    Order = sequence ? group.Options?.Order ?? "sequential" : null,
                    Exhaust = sequence ? group.Options?.Exhaust ?? "once" : null,
                    Children = considered, Picked = picked?.Id });
                return picked;
            }
            if (eligible.Count == 0) return Trace(null);
            var st = SelectorStateFor(group);
            switch (group.Selector)
            {
                case "branch": return Trace(eligible[0]);
                case "sequence":
                {
                    string order = group.Options?.Order ?? "sequential";
                    string exhaust = group.Options?.Exhaust ?? "once";
                    return Trace(order == "shuffle" ? PickShuffle(eligible, exhaust, st)
                        : order == "specificity" ? PickSpecificity(eligible, exhaust, st)
                        : PickSequential(eligible, exhaust, st));
                }
                default: return null;
            }
        }

        private Node PickSequential(List<Node> eligible, string exhaust, SelectorState st)
        {
            int len = eligible.Count;
            int n = st.Seq ?? 0;
            st.Seq = n + 1;
            if (exhaust == "repeat") return eligible[n % len];
            if (n < len) return eligible[n];
            if (exhaust == "stick") return eligible[len - 1];
            return null;
        }

        private Node PickShuffle(List<Node> eligible, string exhaust, SelectorState st)
        {
            int len = eligible.Count;
            bool stick = exhaust == "stick";
            Func<List<string>> fill = () => (stick ? eligible.Take(len - 1) : eligible).Select(c => c.Id).ToList();

            var eligibleIds = new HashSet<string>(eligible.Select(c => c.Id));

            if (st.Bag == null) st.Bag = fill();
            // The bag was filled from the children eligible THEN. Draw only from those still eligible now, so a
            // child whose condition has since gone false is never drawn (it used to be drawn, and the group
            // then played nothing). If none of the bag is drawable, the pass is over, exactly as when the bag
            // is empty.
            if (!st.Bag.Any(eligibleIds.Contains))
            {
                if (exhaust == "once") return null;
                if (stick) { var last = eligible[len - 1]; st.Last = last.Id; return last; }
                st.Bag = fill(); // repeat: reshuffle
                if (st.Bag.Count == 0) return null;
            }

            // Draw without replacement, never repeating the immediately-previous pick when another is
            // drawable. The pool keeps the bag's order, so with every member still eligible the draw consumes
            // the PRNG exactly as it always did.
            var pool = st.Bag.Where(eligibleIds.Contains).ToList();
            int p = st.Last != null && pool.Count > 1 ? pool.IndexOf(st.Last) : -1;
            int i = (int)Math.Floor(Rng() * (p >= 0 ? pool.Count - 1 : pool.Count));
            if (p >= 0 && i >= p) i++;
            string pick = pool[i];
            st.Bag.Remove(pick); // draw without replacement, in place
            st.Last = pick;
            return eligible.Find(c => c.Id == pick);
        }

        // order == "specificity" (Best match): keep the top matched-specificity tier, tie-break by the
        // seeded PRNG (no immediate repeat); a no-condition child scores 0 (the filler). Composes with
        // exhaust like shuffle: repeat re-scores every draw; once/stick draw without replacement.
        private Node PickSpecificity(List<Node> eligible, string exhaust, SelectorState st)
        {
            bool repeat = exhaust == "repeat";
            List<Node> pool;
            if (repeat) { pool = eligible; }
            else
            {
                if (st.Bag == null) st.Bag = eligible.Select(c => c.Id).ToList();
                pool = eligible.Where(c => st.Bag.Contains(c.Id)).ToList();
                if (pool.Count == 0)
                    return exhaust == "stick" && st.Last != null ? eligible.FirstOrDefault(c => c.Id == st.Last) : null;
            }

            // Top specificity tier among the drawable pool.
            int best = -1;
            var scores = new int[pool.Count];
            for (int k = 0; k < pool.Count; k++) { scores[k] = SpecScore(pool[k]); if (scores[k] > best) best = scores[k]; }
            var tier = new List<Node>();
            for (int k = 0; k < pool.Count; k++) if (scores[k] == best) tier.Add(pool[k]);

            // A lone top-tier child is returned WITHOUT drawing, so a clear winner consumes no randomness.
            Node pick;
            if (tier.Count == 1) { pick = tier[0]; }
            else
            {
                int p = st.Last != null ? tier.FindIndex(c => c.Id == st.Last) : -1;
                int span = p >= 0 ? tier.Count - 1 : tier.Count;
                int i = (int)Math.Floor(Rng() * span);
                if (p >= 0 && i >= p) i++;
                pick = tier[i];
            }

            if (!repeat) st.Bag.Remove(pick.Id);
            st.Last = pick.Id;
            return pick;
        }

        // A child's Best-match score: 0 with no condition (the filler tier), else its (passing) condition's specificity.
        private int SpecScore(Node node)
        {
            if (node.Condition == null) return 0;
            // The scorer walks every part, including an `or` branch eligibility never evaluated, so a part can
            // fail here that did not fail there: it scores as false (see PlayError), and is reported.
            return MatchedSpec(node.Condition.Ast, Context(), true,
                e => ReportError("best-match", node.Id, node.Condition, e));
        }

        // Matched-constraint specificity is the SHARED scorer (Expr/Specificity.cs,
        // vendored from expr/ports/unity). Until 2026-09-01 it was inline here and the
        // Storylet Engine had its own module: one scorer, six hand transliterations. It
        // takes truthiness as a callback, so it never needed to know a value type, a
        // dialect or a scope, which makes it the purest thing in the family to share.
        internal static int MatchedSpec(ExprNode node, EvalContext ctx, bool want, Action<Exception> onFail = null)
        {
            return Specificity.MatchedSpecificity(node, n =>
            {
                try { return Truthy(Expr.Evaluate(n, ctx, PatterDialect.Instance)); }
                catch (Exception e) { onFail?.Invoke(e); return false; }   // a part that fails scores as false
            }, want);
        }

        private SelectorState SelectorStateFor(Node group)
        {
            var map = group.Shared ? _host.SharedSelectors : _selectors;
            // A cursor is copied the first time a checkpoint sees it (shared ones once for every flow).
            var journal = _host.Journal;
            HashSet<string> seen = null;
            if (journal != null)
            {
                if (group.Shared) seen = journal.Selectors;
                else if (!journal.FlowSelectors.TryGetValue(this, out seen)) { seen = new HashSet<string>(); journal.FlowSelectors[this] = seen; }
            }
            if (seen != null && seen.Add(group.Id))
            {
                var copy = map.TryGetValue(group.Id, out var was) ? was.Clone() : null;
                journal.Undo.Add(() => { if (copy != null) map[group.Id] = copy; else map.Remove(group.Id); });
            }
            if (!map.TryGetValue(group.Id, out var st)) { st = new SelectorState(); map[group.Id] = st; }
            return st;
        }

        // -- effects / expressions ----------------------------------------------

        /// <summary>Run an effect list. `owner` is the snippet or scene it belongs to, for an error report.</summary>
        private void RunEffects(List<Effect> effects, string owner)
        {
            if (effects == null) return;
            foreach (var e in effects)
            {
                try
                {
                    var value = EvalExpr(e.Value);
                    // Prev read before the write, so a reader can say "0 -> 7" in one pass. Only
                    // paid for when the run asked for a log.
                    var prev = _host.Tracing ? GetProperty(e.Target) : null;
                    WriteProperty(e.Target, value, false);   // the STORY writes: a read-only host property refuses it
                    if (_host.Tracing) Emit(new LogEntry { Type = "write", Target = e.Target, Value = value, Prev = prev });
                }
                catch (Exception err)
                {
                    // Skipped, reported, and the rest of the list still runs (see PlayError).
                    ReportError("effect", owner, e.Value, err);
                }
            }
        }

        /// <summary>Whether a node's condition holds. A condition that fails to evaluate counts as false (see
        /// PlayError).</summary>
        private bool Eligible(Node node)
        {
            if (node.Condition == null) return true;
            try { return Truthy(EvalExpr(node.Condition)); }
            catch (Exception err) { ReportError("condition", node.Id, node.Condition, err); return false; }
        }

        /// <summary>Report a content error the engine is playing through: to the game's OnError (or
        /// Engine.DefaultOnError), and to the decision log.</summary>
        private void ReportError(string kind, string node, Expression expr, Exception err)
        {
            string source = string.IsNullOrEmpty(expr?.Src) ? null : expr.Src;
            var error = new PlayError { Flow = Id, Kind = kind, Node = node, Source = source, Message = err.Message };
            (_host.OnError ?? Engine.DefaultOnError)?.Invoke(error);
            if (_host.Tracing) Emit(new LogEntry { Type = "diagnostic", Kind = kind, Node = node, Source = source, Message = err.Message });
        }

        private ExprValue EvalExpr(Expression expr)
        {
            try { return Expr.Evaluate(expr.Ast, Context(), PatterDialect.Instance); }
            catch (Exception e) when (KernelErrors.Is(e)) { throw KernelErrors.As(e); }
        }

        private void Enter(string id)
        {
            var own = _visitCounts;
            bool ownHad = own.TryGetValue(id, out var ownBefore);
            own[id] = ownBefore + 1;
            var shared = _host.SharedVisits;
            bool had = shared.TryGetValue(id, out var before);
            shared[id] = before + 1;
            if (_host.Journal != null)
                _host.Journal.Undo.Add(() =>
                {
                    if (ownHad) own[id] = ownBefore; else own.Remove(id);
                    if (had) shared[id] = before; else shared.Remove(id);
                });
        }

        private double Rng()
        {
            if (_host.CustomRng != null) return _host.CustomRng();
            // The shared Mulberry32, not a copy of the mixing inline here. This
            // file carried its own until 2026-09-01, so Patterplay shipped the
            // algorithm twice in C# alone. _rngState is still the serialisable
            // position, so saves are unaffected.
            // One generator per flow, re-pointed at the state each draw, rather than a new one per draw.
            _prng.State = _rngState;
            double draw = _prng.Next();
            _rngState = _prng.State;
            return draw;
        }

        // -- strings / beats ----------------------------------------------------

        private StepResult BeatResult(Beat beat)
        {
            // Accumulated author tags (#215): null when none, so the step omits them (parity with GameData).
            var tags = _host.TagIndex.TryGetValue(beat.Id, out var t) && t.Count > 0 ? t : null;
            switch (beat.Kind)
            {
                case "gameEvent":
                    return new StepResult { Type = StepType.GameEvent, Id = beat.Id, GameData = beat.GameData, Tags = tags };
                case "text":
                    return new StepResult { Type = StepType.Text, Id = beat.Id, Text = Interpolate(ResolveString(beat.Id)), GameData = beat.GameData, Tags = tags };
                case "line":
                {
                    string raw = ResolveString(beat.Id);
                    // Closed captions (#214) apply to DIALOGUE lines only. Two ways a line goes SILENT (off
                    // only): the caption CHARACTER speaks it (whole line is a caption, delimiters or not), or
                    // stripping cues leaves it empty. A silent line still FIRES (audio plays) but carries no
                    // text + no speaker, so no caption shows.
                    bool off = !_host.CaptionsOn;
                    bool captionChar = off && !string.IsNullOrEmpty(_host.CaptionCharacter) && beat.Character == _host.CaptionCharacter;
                    string text = captionChar ? "" : CaptionLine(_host.Bundle.Voiced ? raw : Interpolate(raw));
                    bool silent = off && text.Length == 0;
                    return new StepResult
                    {
                        Type = StepType.Line,
                        Id = beat.Id,
                        Text = text,
                        Character = silent ? null : beat.Character,
                        CharacterName = silent ? null : ResolveCharacterName(beat.Character),
                        Direction = silent ? null : beat.Direction,
                        GameData = beat.GameData,
                        Tags = tags,
                    };
                }
                default: throw new Exception($"unknown beat kind: {beat.Kind}");
            }
        }

        /// <summary>
        /// Expand inline {@ref} slots against this flow's CURRENT property state. Public so an IDs-only game
        /// can apply property replacement to a string it looked up in its own loc system for the beat ID the
        /// engine emitted.
        /// </summary>
        public string Interpolate(string raw) => Interp.Expand(raw, GetProperty);

        /// <summary>Apply the project's caption rule to a string UNCONDITIONALLY (#214). Public so an IDs-only
        /// game can match the embedded runtime: StripCaptions(Interpolate(text)) when its captions are off.</summary>
        public string StripCaptions(string raw) => Interp.StripCaptions(raw, _host.CaptionOpen, _host.CaptionClose);

        /// <summary>Caption-strip a dialogue line ONLY when captions are off; otherwise pass it through.</summary>
        private string CaptionLine(string text) => _host.CaptionsOn ? text : StripCaptions(text);

        private ChoicePrompt PromptFor(Node node)
        {
            var beat = PromptBeatOf(node);
            if (beat == null) return null;
            string text = Interpolate(ResolveString(beat.Id));
            // A line-kind prompt is dialogue, so captions apply; a text-kind prompt is left as-is.
            return beat.Kind == "line"
                ? new ChoicePrompt { Kind = "line", Text = CaptionLine(text), Character = beat.Character, CharacterName = ResolveCharacterName(beat.Character), Direction = beat.Direction }
                : new ChoicePrompt { Kind = "text", Text = text };
        }

        /// <summary>An option's AUTHORED prompt beat: an Option group's own prompt. The only prompt a replay speaks.</summary>
        private static Beat AuthoredPromptOf(Node node) => node.IsGroup ? node.Prompt : null;

        /// <summary>A replayed prompt as a step: the beat's id, gameData, and tags, and the text and speaker
        /// fields the choice showed.</summary>
        private StepResult PromptResult(Beat beat, ChoicePrompt shown)
        {
            var tags = _host.TagIndex.TryGetValue(beat.Id, out var t) && t.Count > 0 ? t : null;
            if (shown.Kind == "text")
                return new StepResult { Type = StepType.Text, Id = beat.Id, Text = shown.Text, GameData = beat.GameData, Tags = tags };
            return new StepResult
            {
                Type = StepType.Line, Id = beat.Id, Text = shown.Text,
                Character = shown.Character, CharacterName = shown.CharacterName, Direction = shown.Direction,
                GameData = beat.GameData, Tags = tags,
            };
        }

        private Beat PromptBeatOf(Node node)
        {
            if (node.IsGroup && node.Prompt != null) return node.Prompt;
            Node snippet = node.IsSnippet ? node : FirstTextSnippetIn(node.Children);
            return (snippet?.Beats ?? new List<Beat>()).FirstOrDefault(b => b.Kind == "line" || b.Kind == "text");
        }

        private Node FirstTextSnippetIn(List<Node> children)
        {
            Node found = null;
            Engine.WalkNodes(children, n =>
            {
                if (found == null && n.IsSnippet && (n.Beats ?? new List<Beat>()).Any(b => b.Kind == "line" || b.Kind == "text"))
                    found = n;
            });
            return found;
        }

        private string ResolveString(string id)
        {
            if (_host.EmitIds) return id; // IDs-only build: the game resolves text from this id itself
            if (_host.Strings.TryGetValue(id, out var active)) return active;
            if (_host.DefaultStrings.TryGetValue(id, out var source)) return $"<Untranslated: {id}> {source}";
            return id;
        }

        private string ResolveCharacterName(string character)
        {
            if (character == null) return null;
            if (_host.EmitIds) return null; // IDs-only: omit the display name; the game maps the `character` token
            string key = "cast:" + character;
            if (_host.Strings.TryGetValue(key, out var a)) return a;
            if (_host.DefaultStrings.TryGetValue(key, out var d)) return d;
            return _host.CastDisplay.TryGetValue(character, out var disp) ? disp : null;
        }

        // -- scene seeding ------------------------------------------------------

        private void SeedScene(Scene scene)
        {
            var shared = _host.SceneSharedNames.TryGetValue(scene.Id, out var names) ? names : new HashSet<string>();
            EnsureSceneBags(scene.Id);
            // `temporary` props are reseeded to their default on EVERY entry ("fresh each playthrough"),
            // rather than persisting across re-entries like the rest.
            foreach (var decl in scene.SceneProps ?? new List<PropertyDecl>())
            {
                if (!decl.Temporary) continue;
                string name = decl.Name.ToLowerInvariant();
                var bag = shared.Contains(name) ? (_host.StageBags.TryGetValue(scene.Id, out var sb) ? sb : null)
                                                : (_sceneBags.TryGetValue(scene.Id, out var fb) ? fb : null);
                // Through Set, so the reset is audited: a temporary snapping back to its default is
                // a state change, and a log that omits it is wrong.
                if (bag == null) continue;
                var prev = _host.Journal != null ? bag.Get(name) : null;
                if (prev != null) _host.Journal.Undo.Add(() => bag.Set(name, prev));
                bag.Set(name, Engine.PropDefault(decl));
            }
        }

        /// <summary>Make (and register) scene `s`'s stage bag and this flow's bag for it, if not made yet.
        /// A bag made here claims whatever values the registry holds for its key: that is how a loaded save
        /// reaches it. The bag's constructor seeds each declared default (the type's when none) and
        /// normalises the name.</summary>
        private void EnsureSceneBags(string s)
        {
            if (!_host.Bundle.Scenes.TryGetValue(s, out var scene)) return;
            var shared = _host.SceneSharedNames.TryGetValue(s, out var names) ? names : new HashSet<string>();
            var journal = _host.Journal;
            if (!_sceneBags.ContainsKey(s))
            {
                var bag = new PropertyBag(Engine.DeclsFor(scene.SceneProps, shared, false), null, "@scene.");
                var key = PatterKeys.FlowScene(Id, s);
                bool claimed = MountClaims(key, bag, journal != null);
                _registered.Add(key);
                _sceneBags[s] = bag;
                // Made inside a checkpoint: a rollback unmakes it, so the scene seeds afresh on its next real
                // entry, unless the mount claimed values a load had parked, which go back to the registry.
                if (journal != null) journal.Undo.Add(() =>
                {
                    if (!_sceneBags.TryGetValue(s, out var now) || now != bag) return; // already released with the flow
                    _host.Registry.Remove(key, keep: claimed);
                    _registered.Remove(key);
                    _sceneBags.Remove(s);
                });
            }
            if (!_host.StageBags.ContainsKey(s))
            {
                var bag = new PropertyBag(Engine.DeclsFor(scene.SceneProps, shared, true), null, "@scene.");
                var key = PatterKeys.Stage(s);
                bool claimed = MountClaims(key, bag, journal != null);
                _host.StageBags[s] = bag;
                if (journal != null) journal.Undo.Add(() =>
                {
                    if (!_host.StageBags.TryGetValue(s, out var now) || now != bag) return;
                    _host.Registry.Remove(key, keep: claimed);
                    _host.StageBags.Remove(s);
                });
            }
        }

        /// <summary>A fresh, unregistered bag for this flow's NOT-shared @patter half (the shared
        /// globals live on the host).</summary>
        private PropertyBag FreshLocal()
        {
            return new PropertyBag(_host.PatterLocalDecls.Select(Engine.ToScopeDecl), null, "@patter.");
        }

        /// <summary>Register a fresh globals bag under this flow's key; it claims any values waiting there.</summary>
        private void MountLocal()
        {
            _local = FreshLocal();
            var key = PatterKeys.FlowGlobals(Id);
            Mount(key, _local);
            _registered.Add(key);
        }

        /// <summary>Register one of this engine's bags; a clash is Patterplay's EvalError.</summary>
        private void Mount(string key, PropertyBag bag)
        {
            try { _host.Registry.MountOwned(key, bag, PatterKeys.Owner); }
            catch (Exception e) when (KernelErrors.Is(e)) { throw KernelErrors.As(e); }
        }

        /// <summary>Mount, and say whether the mount CLAIMED values a load had parked at `key`. Only asked
        /// while a checkpoint is open (`ask`), since only a rollback needs to know: it must hand claimed
        /// values back to the registry, or a scene first entered inside the checkpoint loses its saved
        /// values. A fresh bag holds only its defaults, so a change across the mount is a claim. Parked
        /// values equal to the defaults are not told apart, and need not be: dropping them changes nothing
        /// a story can read.</summary>
        private bool MountClaims(string key, PropertyBag bag, bool ask)
        {
            string before = ask ? BagValues(bag) : null;
            Mount(key, bag);
            return ask && BagValues(bag) != before;
        }

        private static string BagValues(PropertyBag bag)
        {
            var sb = new System.Text.StringBuilder();
            foreach (var kv in bag.Save()) sb.Append(kv.Key).Append('=').Append(kv.Value.ToJsonString()).Append(';');
            return sb.ToString();
        }

        /// <summary>Remove every bag this flow registered; with `keep`, their values wait in the registry
        /// for the flow that replaces this one. Engine-driven (Close, LoadGame, HotSwap).</summary>
        internal void ReleaseBags(bool keep)
        {
            foreach (var key in _registered) _host.Registry.Remove(key, keep);
            _registered.Clear();
            _sceneBags.Clear();
        }

        // -- save / restore -----------------------------------------------------

        /// <summary>Snapshot this flow's cursor, PRNG, and visits. Its properties are the registry's.</summary>
        public FlowSnapshot Snapshot()
        {
            return new FlowSnapshot
            {
                RngState = _rngState,
                Visits = new Dictionary<string, int>(_visitCounts),
                FlowEnded = _flowEnded,
                CurrentSceneId = _currentSceneId,
                // Stamp each frame with the id of the child it would run next, so a restore against an
                // EDITED bundle re-finds the position by id instead of trusting the raw index (§9.8).
                Stack = _stack.Select(f =>
                {
                    var clone = f.Clone();
                    var children = ChildrenOf(f.ContainerId);
                    if (children != null && f.Index < children.Count) clone.NextId = children[f.Index].Id;
                    return clone;
                }).ToList(),
                ActiveSnippetId = _activeSnippet?.Id,
                BeatIndex = _beatIndex,
                PendingOptions = _pendingChoice?.Options.Select(CloneOption).ToList(),
                PendingGroupId = _pendingChoice?.GroupId,
                PendingPromptOwnerId = _pendingPromptOwnerId,
                PendingPrompt = ClonePrompt(_pendingPromptShown),
                Selectors = Engine.CloneSelectors(_selectors),
            };
        }

        /// <summary>Restore this flow from a snapshot: its cursor, PRNG, visits, and selector cursors. Its
        /// property values are the registry's and stay as they are (a load puts the saved ones there first).</summary>
        public void Restore(FlowSnapshot snap)
        {
            if (_host.Journal != null) throw new Exception("a flow can't be restored while a checkpoint is open");
            RestoreCursor(snap);
            // Register this flow's bags: each claims the values the registry holds for it (loaded by the
            // game, by LoadGame from the save, or handed back by the engine this one replaces), laid over
            // fresh defaults. Released KEEPING their values, so a live flow restored in place keeps its
            // property values (a fresh one, made by a load, is claiming the loaded values either way). The
            // scenes the cursor stands in are registered now; any other scene's bag is claimed on entry.
            ReleaseBags(true);
            MountLocal();
            var standing = new List<string>();
            if (_currentSceneId != null) standing.Add(_currentSceneId);
            foreach (var f in _stack) if (f.SceneId != null && !standing.Contains(f.SceneId)) standing.Add(f.SceneId);
            foreach (var s in standing) EnsureSceneBags(s);
        }

        /// <summary>The cursor half of Restore, without touching the bags (a rollback has already put those back).</summary>
        private void RestoreCursor(FlowSnapshot snap)
        {
            _rngState = snap.RngState;
            _visitCounts = new Dictionary<string, int>(snap.Visits ?? new Dictionary<string, int>());
            _started = true;
            _flowEnded = snap.FlowEnded;
            _beatIndex = snap.BeatIndex;
            _currentSceneId = snap.CurrentSceneId;
            // Re-bind each frame to the CURRENT bundle: prefer the saved next-child id (survives
            // siblings inserted / removed / reordered before the cursor); fall back to the raw index
            // when absent or its node drifted out of the bundle (§9.8 best-effort).
            _stack = (snap.Stack ?? new List<StackFrame>()).Select(f =>
            {
                var frame = f.Clone();
                frame.NextId = null; // live frames never carry it
                if (f.NextId != null)
                {
                    var children = ChildrenOf(f.ContainerId);
                    int at = children?.FindIndex(ch => ch.Id == f.NextId) ?? -1;
                    if (at >= 0) frame.Index = at;
                }
                return frame;
            }).ToList();

            _activeSnippet = null;
            if (snap.ActiveSnippetId != null && _host.NodeIndex.TryGetValue(snap.ActiveSnippetId, out var node) && node.IsSnippet)
                _activeSnippet = node;

            _selectors = (snap.Selectors ?? new Dictionary<string, SelectorState>())
                .ToDictionary(k => k.Key, k => k.Value.Clone());

            _pendingChoice = null;
            if (snap.PendingOptions != null)
            {
                var byId = new Dictionary<string, Node>();
                var options = new List<ChoiceOption>();
                foreach (var o in snap.PendingOptions)
                {
                    if (!_host.NodeIndex.TryGetValue(o.Id, out var n)) continue;
                    byId[o.Id] = n;
                    options.Add(CloneOption(o));
                }
                if (options.Count > 0) _pendingChoice = new ChoiceStateInternal { GroupId = snap.PendingGroupId, Options = options, ById = byId };
            }

            // A save taken between Choose() and the next Advance() left a prompt still to be replayed: the
            // chosen option's authored prompt beat, found again by its owner, and the prompt as the choice
            // showed it, carried by the save. A save from before PendingPrompt existed has only the owner, and
            // its beat is resolved when delivered, as it was then. Dropped if the option drifted out of the
            // bundle or has no authored prompt (spec 9.8): the live Choose() would replay nothing.
            _pendingPromptBeat = null;
            _pendingPromptShown = null;
            _pendingPromptOwnerId = snap.PendingPromptOwnerId;
            if (_pendingPromptOwnerId != null && _host.NodeIndex.TryGetValue(_pendingPromptOwnerId, out var owner))
                _pendingPromptBeat = AuthoredPromptOf(owner);
            if (_pendingPromptBeat == null) _pendingPromptOwnerId = null;
            else _pendingPromptShown = ClonePrompt(snap.PendingPrompt);
        }

        private static ChoicePrompt ClonePrompt(ChoicePrompt p) => p == null ? null : new ChoicePrompt
        {
            Kind = p.Kind, Text = p.Text, Character = p.Character, CharacterName = p.CharacterName, Direction = p.Direction,
        };

        private static ChoiceOption CloneOption(ChoiceOption o)
            => new ChoiceOption { Id = o.Id, Prompt = o.Prompt, Eligible = o.Eligible, GameData = o.GameData };

        // -- helpers ------------------------------------------------------------

        /// <summary>Truthiness for a bare condition. One line, because the rule is
        /// on the SHARED value type.</summary>
        internal static bool Truthy(ExprValue v) => v.Truthy;
    }
}
