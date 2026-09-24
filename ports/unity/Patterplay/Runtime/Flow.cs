// Flow - one playable flow: its execution cursor (a continuation stack of block /
// run-group positions), the not-shared half of @patter / @scene, a serialisable PRNG,
// per-flow visit + selector state. Port of engine.ts's Flow class.

using System;
using System.Collections.Generic;
using System.Linq;

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
        private Beat _pendingPromptBeat;
        // The chosen option owning _pendingPromptBeat, so a save taken between Choose() and the next
        // Advance() can re-derive the prompt on load (the beat isn't otherwise reachable by id).
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
            var key = name == null ? null : name.ToLowerInvariant();
            List<string> FromDecls(List<PropertyDecl> decls)
            {
                if (decls == null) return null;
                foreach (var d in decls)
                {
                    if (d.Type == "quality" && d.Name != null && d.Name.ToLowerInvariant() == key) return d.Stages;
                }
                return null;
            }
            if (scope == "patter") return FromDecls(_host.PatterSharedDecls) ?? FromDecls(_host.PatterLocalDecls);
            if (scope == "scene")
            {
                if (_currentSceneId == null || !_host.Bundle.Scenes.TryGetValue(_currentSceneId, out var scene)) return null;
                return FromDecls(scene.SceneProps);
            }
            // Any other scope's ladder is the registry's (another engine's `@story`, the game's `@world`), with
            // the bundle's own host-scope declarations behind it for a game that registered `@world` undeclared.
            var fromRegistry = _registryQualities?.Invoke(scope, name);
            if (fromRegistry != null) return fromRegistry;
            var spec = _host.Bundle.ScopeRegistry?.Scopes?.Find(s => s != null && s.Token == scope);
            if (spec?.Declarations == null) return null;
            foreach (var d in spec.Declarations)
            {
                if (d.Type == "quality" && d.Name != null && d.Name.ToLowerInvariant() == key) return d.Stages;
            }
            return null;
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
            if (scene == "END")
            {
                _started = true; _pendingChoice = null; _pendingPromptBeat = null; _pendingPromptOwnerId = null;
                _activeSnippet = null; _beatIndex = 0;
                _flowEnded = true; _stack = new List<StackFrame>();
                return true;
            }
            // Resolve BOTH addresses before touching state, so a bad one is a no-op rather than a half-move.
            string sceneId = _host.SceneGameIdToId.TryGetValue(scene, out var sid) ? sid
                : (_host.Bundle.Scenes.ContainsKey(scene) ? scene : null);
            if (sceneId == null) return false;
            string blockId = null;
            if (block != null)
            {
                if (_host.BlockGameIdToId.TryGetValue(sceneId, out var addrs) && addrs.TryGetValue(block, out var bid)) blockId = bid;
                else if (_host.BlockToScene.TryGetValue(block, out var owner) && owner == sceneId) blockId = block;
                if (blockId == null) return false; // a block address is scene-scoped: unknown HERE is unknown
            }
            if (!_started) { Start(sceneId, blockId); return true; }

            _pendingChoice = null; _pendingPromptBeat = null; _pendingPromptOwnerId = null;
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
            _pendingChoice = null;
            _pendingPromptBeat = null;
            _pendingPromptOwnerId = null;
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

        private PatterValue PatterGet(string n)
        {
            if (_host.PatterSharedNames.Contains(n)) return _host.SharedPatter.Get(n);
            return _local.Get(n);
        }
        private void PatterSet(string n, PatterValue v)
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
        private PatterValue SceneGet(string n)
        {
            var bag = SceneBagFor(n);
            return bag?.Get(n);
        }
        private void SceneSet(string n, PatterValue v)
        {
            var bag = SceneBagFor(n);
            // Not silent: an engine write notifies subscribers and is audited, where a host write
            // (an inspector poking a value) is silent but still audited. This is the engine's own.
            if (bag != null) bag.Set(n, v);
        }

        // -- host API -----------------------------------------------------------

        public void Start(string sceneId, string blockId)
        {
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
            _pendingChoice = null;
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

        public void Reset(string sceneId = null, string blockId = null) => Start(sceneId, blockId);

        public StepResult Advance()
        {
            if (_closed) return new StepResult { Type = StepType.End }; // a stale reference drives nothing
            if (!_started) throw new Exception("flow has not been started");
            if (_pendingPromptBeat != null) { var b = _pendingPromptBeat; _pendingPromptBeat = null; _pendingPromptOwnerId = null; return BeatResult(b); }
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
            if (!_host.LogEnabled) return;
            e.Scene = _currentSceneId;
            e.Seq = _seq++;
            _log.Add(e);
            _host.EngineLog.Add(new LogEntry {
                Type = e.Type, Scene = e.Scene, Flow = Id, Seq = _host.EngineLog.Count,
                Subject = e.Subject, Considered = e.Considered, Picked = e.Picked,
                Selector = e.Selector, Value = e.Value, Prev = e.Prev, Detail = e.Detail,
            });
        }

        public void Choose(string id)
        {
            var choice = _pendingChoice;
            if (choice == null) throw new Exception("no choice is pending");
            var option = choice.Options.FirstOrDefault(o => o.Id == id);
            if (option == null) throw new Exception($"unknown choice option: {id}");
            if (!option.Eligible) throw new Exception($"choice option is not eligible: {id}");
            var node = choice.ById[id];
            Emit(new LogEntry { Type = "chose", Subject = choice.GroupId, Picked = id });
            _pendingChoice = null;
            _pendingPromptBeat = _host.ReplayPromptOnChoose ? PromptBeatOf(node) : null;
            _pendingPromptOwnerId = _pendingPromptBeat != null ? node.Id : null;
            EnterChild(node);
        }

        /// <summary>Read a property by ref: @patter / @scene (each routed by its `shared` flag), or any
        /// other scope the registry holds (a host scope, another engine's).</summary>
        public PatterValue GetProperty(string refStr)
        {
            var (scope, name) = Engine.SplitRef(refStr, _host.IsScopeToken);
            if (scope == "patter") return PatterGet(name);
            if (scope == "scene") return SceneGet(name);
            return _host.Registry.Get(scope, name); // host scopes, other engines' scopes
        }

        /// <summary>Write a property by ref. The GAME's surface, so a host declaration's `writable: false`
        /// binds the story, not the game that owns the value. Effects use WriteProperty(.., host: false).</summary>
        public void SetProperty(string refStr, PatterValue value) => WriteProperty(refStr, value, true);

        /// <summary>The write itself. `host` says WHO is writing, which is all `writable: false` cares
        /// about: the story is refused, the game is not.</summary>
        private void WriteProperty(string refStr, PatterValue value, bool host)
        {
            var (scope, name) = Engine.SplitRef(refStr, _host.IsScopeToken);
            if (scope == "patter") PatterSet(name, value);
            else if (scope == "scene")
            {
                // The resolver stays graceful for expression evaluation, but a host write with nowhere to
                // land must error, not silently vanish.
                if (_currentSceneId == null) throw new Exception($"'{refStr}': the flow has not entered a scene yet");
                SceneSet(name, value);
            }
            else
            {
                // Host scopes and other engines' scopes. The registry refuses a STORY write to a
                // `writable: false` declaration, bound or self-backed, and never the game's.
                _host.Registry.Set(scope, name, value, host);
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
                    RunEffects(_activeSnippet.OnExit);
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
                if (_host.LogEnabled && frame.Index != from)
                {
                    var seen = new List<(string, bool)>();
                    for (int i = from; i <= frame.Index && i < children.Count; i++)
                        seen.Add((children[i].Id, i == frame.Index));
                    Emit(new LogEntry { Type = "select", Subject = frame.ContainerId, Selector = "run",
                        Considered = seen,
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
            RunEffects(scene.OnEntry);
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
            RunEffects(snippet.OnEnter);
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
            if (options.Count > 0)
            {
                // Including the options a condition left ineligible: "why is that greyed out"
                // is a question about the moment the choice was built.
                Emit(new LogEntry { Type = "choice", Subject = group.Id,
                    Considered = options.Select(o => (o.Id, o.Eligible)).ToList() });
                _pendingChoice = new ChoiceStateInternal { GroupId = group.Id, Options = options, ById = byId };
                return;
            }
            var fallback = fallbacks.FirstOrDefault(Eligible);
            if (fallback != null) { EnterChild(fallback); return; }
            // Nothing takeable and no eligible fallback: the choice runs dry and the flow walks
            // past it. The behaviour is unchanged; this makes the silent fall-through observable.
            Emit(new LogEntry { Type = "dry", Subject = group.Id });
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
            Emit(new LogEntry { Type = "jump", Subject = to, Detail = mode });
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
            var considered = group.Children.Select(c => (c.Id, Eligible(c))).ToList();
            var eligible = group.Children.Where(Eligible).ToList();
            string sel = group.Selector ?? "default";
            // The reasoning goes in the entry: every child looked at, with its verdict.
            Node Trace(Node picked)
            {
                Emit(new LogEntry { Type = "select", Subject = group.Id, Selector = sel,
                    Considered = considered, Picked = picked?.Id });
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

            if (st.Bag == null) st.Bag = fill();
            if (st.Bag.Count == 0)
            {
                if (exhaust == "once") return null;
                if (stick) { var last = eligible[len - 1]; st.Last = last.Id; return last; }
                st.Bag = fill();
            }

            // Draw without replacement, never repeating the immediately-previous pick - allocation-free:
            // find Last's slot and draw into the reduced span skipping it, then erase the pick in place.
            var pool = st.Bag;
            int p = st.Last != null && pool.Count > 1 ? pool.IndexOf(st.Last) : -1;
            int i = (int)Math.Floor(Rng() * (p >= 0 ? pool.Count - 1 : pool.Count));
            if (p >= 0 && i >= p) i++;
            string pick = pool[i];
            pool.RemoveAt(i); // draw without replacement, in place
            st.Last = pick;
            return eligible.First(c => c.Id == pick);
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
            return node.Condition != null ? MatchedSpec(node.Condition.Ast, Context(), true) : 0;
        }

        // Matched-constraint specificity is the SHARED scorer (Expr/Specificity.cs,
        // vendored from expr/ports/unity). Until 2026-09-01 it was inline here and the
        // Storylet Engine had its own module: one scorer, six hand transliterations. It
        // takes truthiness as a callback, so it never needed to know a value type, a
        // dialect or a scope, which makes it the purest thing in the family to share.
        internal static int MatchedSpec(ExprNode node, EvalContext ctx, bool want)
        {
            return Specificity.MatchedSpecificity(node, n =>
            {
                try { return Truthy(Expr.Evaluate(n, ctx, PatterDialect.Instance)); }
                catch (EvalError) { return false; }   // an eval error scores as false
            }, want);
        }

        private SelectorState SelectorStateFor(Node group)
        {
            var map = group.Shared ? _host.SharedSelectors : _selectors;
            if (!map.TryGetValue(group.Id, out var st)) { st = new SelectorState(); map[group.Id] = st; }
            return st;
        }

        // -- effects / expressions ----------------------------------------------

        private void RunEffects(List<Effect> effects)
        {
            foreach (var e in effects ?? new List<Effect>())
            {
                var value = EvalExpr(e.Value);
                // Prev read before the write, so a reader can say "0 -> 7" in one pass. Only
                // paid for when the run asked for a log.
                var prev = _host.LogEnabled ? GetProperty(e.Target) : null;
                WriteProperty(e.Target, value, false);   // the STORY writes: a read-only host property refuses it
                Emit(new LogEntry { Type = "write", Subject = e.Target, Value = value, Prev = prev });
            }
        }

        private bool Eligible(Node node)
        {
            if (node.Condition == null) return true;
            return Truthy(EvalExpr(node.Condition));
        }

        private PatterValue EvalExpr(Expression expr) => Expr.Evaluate(expr.Ast, Context(), PatterDialect.Instance);

        private void Enter(string id)
        {
            _visitCounts[id] = (_visitCounts.TryGetValue(id, out var v) ? v : 0) + 1;
            _host.SharedVisits[id] = (_host.SharedVisits.TryGetValue(id, out var sv) ? sv : 0) + 1;
        }

        private double Rng()
        {
            if (_host.CustomRng != null) return _host.CustomRng();
            // The shared Mulberry32, not a copy of the mixing inline here. This
            // file carried its own until 2026-09-01, so Patterplay shipped the
            // algorithm twice in C# alone. _rngState is still the serialisable
            // position, so saves are unaffected.
            var prng = new Mulberry32(_rngState);
            double draw = prng.Next();
            _rngState = prng.State;
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
                if (bag != null) bag.Set(name, Engine.PropDefault(decl));
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
            if (!_sceneBags.ContainsKey(s))
            {
                var bag = new PropertyBag(Engine.DeclsFor(scene.SceneProps, shared, false), null, "@scene.");
                var key = PatterKeys.FlowScene(Id, s);
                _host.Registry.MountOwned(key, bag, PatterKeys.Owner);
                _registered.Add(key);
                _sceneBags[s] = bag;
            }
            if (!_host.StageBags.ContainsKey(s))
            {
                var bag = new PropertyBag(Engine.DeclsFor(scene.SceneProps, shared, true), null, "@scene.");
                _host.Registry.MountOwned(PatterKeys.Stage(s), bag, PatterKeys.Owner);
                _host.StageBags[s] = bag;
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
            _host.Registry.MountOwned(key, _local, PatterKeys.Owner);
            _registered.Add(key);
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
        internal FlowSnapshot Snapshot()
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
                Selectors = Engine.CloneSelectors(_selectors),
            };
        }

        internal void Restore(FlowSnapshot snap)
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

            // Register this flow's bags: each claims the values the registry holds for it (loaded by the
            // game, by LoadGame from the save, or handed back by the engine this one replaces), laid over
            // fresh defaults. The scenes the cursor stands in are registered now; any other scene's bag is
            // claimed on entry.
            ReleaseBags(false);
            MountLocal();
            var standing = new List<string>();
            if (_currentSceneId != null) standing.Add(_currentSceneId);
            foreach (var f in _stack) if (f.SceneId != null && !standing.Contains(f.SceneId)) standing.Add(f.SceneId);
            foreach (var s in standing) EnsureSceneBags(s);

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

            // A save taken between Choose() and the next Advance() left a prompt still to be replayed;
            // re-derive it from the chosen option (dropped if that option drifted out of the bundle).
            _pendingPromptBeat = null;
            _pendingPromptOwnerId = snap.PendingPromptOwnerId;
            if (_pendingPromptOwnerId != null && _host.NodeIndex.TryGetValue(_pendingPromptOwnerId, out var owner))
                _pendingPromptBeat = PromptBeatOf(owner);
            if (_pendingPromptBeat == null) _pendingPromptOwnerId = null;
        }

        private static ChoiceOption CloneOption(ChoiceOption o)
            => new ChoiceOption { Id = o.Id, Prompt = o.Prompt, Eligible = o.Eligible, GameData = o.GameData };

        // -- helpers ------------------------------------------------------------

        /// <summary>Truthiness for a bare condition. One line, because the rule is
        /// on the SHARED value type.</summary>
        internal static bool Truthy(PatterValue v) => v.Truthy;
    }
}
