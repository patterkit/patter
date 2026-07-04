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
        private Dictionary<string, PatterValue> _local;                       // not-shared @patter
        private Dictionary<string, Dictionary<string, PatterValue>> _sceneBags = new Dictionary<string, Dictionary<string, PatterValue>>();
        private uint _rngState;

        private bool _started;
        private bool _flowEnded;
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

        private readonly EvalContext _evalCtx;

        internal Flow(string id, FlowHost host, long seed)
        {
            Id = id;
            _host = host;
            _rngState = unchecked((uint)seed);
            _local = FreshLocal();

            _evalCtx = new EvalContext
            {
                NextRandom = Rng,
                Visits = id2 => _visitCounts.TryGetValue(id2, out var v) ? v : 0,
                PatterVisits = id2 => _host.SharedVisits.TryGetValue(id2, out var v) ? v : 0,
            };
            _evalCtx.Scopes["patter"] = new ResolverScope(PatterGet);
            _evalCtx.Scopes["scene"] = new ResolverScope(SceneGet);
        }

        public string CurrentScene => _currentSceneId;
        public bool IsEnded() => _flowEnded;

        // -- scope resolvers ----------------------------------------------------

        private PatterValue PatterGet(string n)
        {
            if (_host.PatterSharedNames.Contains(n)) return _host.SharedPatter.TryGetValue(n, out var v) ? v : null;
            return _local.TryGetValue(n, out var lv) ? lv : null;
        }
        private void PatterSet(string n, PatterValue v)
        {
            if (_host.PatterSharedNames.Contains(n)) _host.SharedPatter[n] = v; else _local[n] = v;
        }
        private Dictionary<string, PatterValue> SceneBagFor(string n)
        {
            if (_currentSceneId == null) return null;
            bool shared = _host.SceneSharedNames.TryGetValue(_currentSceneId, out var names) && names.Contains(n);
            if (shared) return _host.StageBags.TryGetValue(_currentSceneId, out var sb) ? sb : null;
            return _sceneBags.TryGetValue(_currentSceneId, out var fb) ? fb : null;
        }
        private PatterValue SceneGet(string n)
        {
            var bag = SceneBagFor(n);
            return bag != null && bag.TryGetValue(n, out var v) ? v : null;
        }
        private void SceneSet(string n, PatterValue v)
        {
            var bag = SceneBagFor(n);
            if (bag != null) bag[n] = v;
        }

        // -- host API -----------------------------------------------------------

        public void Start(string sceneId, string blockId)
        {
            _sceneBags.Clear();
            _local = FreshLocal();
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
            if (!_started) throw new Exception("flow has not been started");
            if (_pendingPromptBeat != null) { var b = _pendingPromptBeat; _pendingPromptBeat = null; _pendingPromptOwnerId = null; return BeatResult(b); }
            Settle();
            if (_flowEnded) return StepResult.End();
            if (_pendingChoice != null) return new StepResult { Type = StepType.Choice, GroupId = _pendingChoice.GroupId, Options = _pendingChoice.Options };
            if (_activeSnippet == null) { _flowEnded = true; return StepResult.End(); }
            return BeatResult(_activeSnippet.Beats[_beatIndex++]);
        }

        public List<ChoiceOption> GetChoices() => _pendingChoice?.Options ?? new List<ChoiceOption>();

        public void Choose(string id)
        {
            var choice = _pendingChoice;
            if (choice == null) throw new Exception("no choice is pending");
            var option = choice.Options.FirstOrDefault(o => o.Id == id);
            if (option == null) throw new Exception($"unknown choice option: {id}");
            if (!option.Eligible) throw new Exception($"choice option is not eligible: {id}");
            var node = choice.ById[id];
            _pendingChoice = null;
            _pendingPromptBeat = _host.ReplayPromptOnChoose ? PromptBeatOf(node) : null;
            _pendingPromptOwnerId = _pendingPromptBeat != null ? node.Id : null;
            EnterChild(node);
        }

        public PatterValue GetProperty(string refStr)
        {
            var (scope, name) = Engine.SplitRef(refStr, t => t == "scene" || t == "patter");
            if (scope == "patter") return PatterGet(name);
            if (scope == "scene") return SceneGet(name);
            return null;
        }

        public void SetProperty(string refStr, PatterValue value)
        {
            var (scope, name) = Engine.SplitRef(refStr, t => t == "scene" || t == "patter");
            if (scope == "patter") PatterSet(name, value);
            else if (scope == "scene")
            {
                if (_currentSceneId == null) throw new Exception($"'{refStr}': the flow has not entered a scene yet");
                SceneSet(name, value);
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
                while (frame.Index < children.Count && !Eligible(children[frame.Index])) frame.Index++;
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
            if (options.Count > 0) { _pendingChoice = new ChoiceStateInternal { GroupId = group.Id, Options = options, ById = byId }; return; }
            var fallback = fallbacks.FirstOrDefault(Eligible);
            if (fallback != null) EnterChild(fallback);
        }

        // -- jumps --------------------------------------------------------------

        private void ResolveJump(Jump jump)
        {
            if (jump == null) return;
            EnterTarget(jump.To, jump.Mode == "call" ? "call" : "jump");
        }

        private void EnterTarget(string to, string mode)
        {
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
            var eligible = group.Children.Where(Eligible).ToList();
            if (eligible.Count == 0) return null;
            var st = SelectorStateFor(group);
            switch (group.Selector)
            {
                case "branch": return eligible[0];
                case "sequence":
                {
                    string order = group.Options?.Order ?? "sequential";
                    string exhaust = group.Options?.Exhaust ?? "once";
                    return order == "shuffle" ? PickShuffle(eligible, exhaust, st) : PickSequential(eligible, exhaust, st);
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
                SetProperty(e.Target, EvalExpr(e.Value));
        }

        private bool Eligible(Node node)
        {
            if (node.Condition == null) return true;
            return Truthy(EvalExpr(node.Condition));
        }

        private PatterValue EvalExpr(Expression expr) => Expr.Evaluate(expr.Ast, _evalCtx);

        private void Enter(string id)
        {
            _visitCounts[id] = (_visitCounts.TryGetValue(id, out var v) ? v : 0) + 1;
            _host.SharedVisits[id] = (_host.SharedVisits.TryGetValue(id, out var sv) ? sv : 0) + 1;
        }

        private double Rng()
        {
            if (_host.CustomRng != null) return _host.CustomRng();
            unchecked
            {
                _rngState = _rngState + 0x6d2b79f5u;
                uint t = (_rngState ^ (_rngState >> 15)) * (1u | _rngState);
                t = (t + ((t ^ (t >> 7)) * (61u | t))) ^ t;
                return (t ^ (t >> 14)) / 4294967296.0;
            }
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
            if (!_sceneBags.ContainsKey(scene.Id))
            {
                var bag = new Dictionary<string, PatterValue>();
                foreach (var decl in scene.SceneProps ?? new List<PropertyDecl>())
                {
                    string name = decl.Name.ToLowerInvariant();
                    if (!shared.Contains(name)) bag[name] = Engine.PropDefault(decl);
                }
                _sceneBags[scene.Id] = bag;
            }
            if (!_host.StageBags.ContainsKey(scene.Id))
            {
                var bag = new Dictionary<string, PatterValue>();
                foreach (var decl in scene.SceneProps ?? new List<PropertyDecl>())
                {
                    string name = decl.Name.ToLowerInvariant();
                    if (shared.Contains(name)) bag[name] = Engine.PropDefault(decl);
                }
                _host.StageBags[scene.Id] = bag;
            }
            foreach (var decl in scene.SceneProps ?? new List<PropertyDecl>())
            {
                if (!decl.Temporary) continue;
                string name = decl.Name.ToLowerInvariant();
                var bag = shared.Contains(name) ? (_host.StageBags.TryGetValue(scene.Id, out var sb) ? sb : null)
                                                : (_sceneBags.TryGetValue(scene.Id, out var fb) ? fb : null);
                if (bag != null) bag[name] = Engine.PropDefault(decl);
            }
        }

        private Dictionary<string, PatterValue> FreshLocal()
        {
            var d = new Dictionary<string, PatterValue>();
            foreach (var decl in _host.PatterLocalDecls) d[decl.Name.ToLowerInvariant()] = Engine.PropDefault(decl);
            return d;
        }

        // -- save / restore -----------------------------------------------------

        internal FlowSnapshot Snapshot()
        {
            return new FlowSnapshot
            {
                Scopes = Engine.CloneBag(_local),
                SceneBags = _sceneBags.ToDictionary(k => k.Key, k => Engine.CloneBag(k.Value)),
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

            _sceneBags = (snap.SceneBags ?? new Dictionary<string, Dictionary<string, PatterValue>>())
                .ToDictionary(k => k.Key, k => Engine.CloneBag(k.Value));
            _local = FreshLocal();
            foreach (var kv in snap.Scopes ?? new Dictionary<string, PatterValue>()) _local[kv.Key] = kv.Value;

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

        internal static bool Truthy(PatterValue v)
        {
            switch (v.Kind)
            {
                case PatterKind.Bool: return v.AsBool;
                case PatterKind.Number: return v.AsNumber != 0;
                case PatterKind.Str: return v.AsString != "";
                case PatterKind.Flags: return v.AsFlags.Count > 0;
                default: return false;
            }
        }
    }
}
