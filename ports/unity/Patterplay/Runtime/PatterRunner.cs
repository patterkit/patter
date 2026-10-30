// The thin runner: the flow API turned from pull to push, for straightforward games. Start a
// conversation, and the runner hands each beat to the game as an event; the game shows it however it
// likes and calls Next() when it's ready. A choice waits for Choose(id). Nothing else: no timing, no
// auto-advance, no UI, no audio. A line carries its beat id, so a game plays its recording with the
// audio resolver, or its own. The same runner in every Patterplay runtime.
//
//   var runner = new PatterRunner(engine);
//   runner.Line += step => Show(step.SpeakerLabel, step.Text);
//   runner.Choice += (groupId, options) => Offer(options);   // then runner.Choose(id)
//   runner.Ended += reason => Close();   // FlowEndReason.Ended, or RanDry: a choice had nothing left
//   runner.Begin();            // the project's start scene; Next() on each click
//
// A plain class, so it plays anywhere; PatterRunnerBehaviour wraps it in UnityEvents for the Inspector.
// A fuller dialogue manager for more complex games, Patterstage, is coming.

using System;
using System.Collections.Generic;

namespace Patterkit.Patterplay
{
    /// <summary>
    /// Plays one flow, a beat at a time, as events. Every delivered beat (a line, a text or a game event)
    /// waits for <see cref="Next"/>; a choice waits for <see cref="Choose"/>. Handlers may call Next() or
    /// Choose() themselves: the runner finishes the event it is delivering first, so a long run never deepens
    /// the stack.
    ///
    /// The runner keeps no state a save needs: <c>engine.SaveGame()</c> and <c>LoadGame()</c> stay the one way
    /// to save. After a load, call Next() to carry on (re-show the last line with <c>Flow.StepFor(id)</c> if you
    /// like). After <c>engine.HotSwap()</c>, hand the new engine to <see cref="Rebind"/>.
    /// </summary>
    public sealed class PatterRunner
    {
        private Engine _engine;
        /// <summary>Next() calls asked for while an event was being delivered, played once it returns.</summary>
        private int _queued;
        private bool _delivering;

        /// <summary>A line: the step itself, with its beat id, speaker label and text.</summary>
        public event Action<StepResult> Line;
        /// <summary>A text beat: the step itself.</summary>
        public event Action<StepResult> Text;
        /// <summary>A game event: the step itself, with its game data.</summary>
        public event Action<StepResult> GameEvent;
        /// <summary>A choice: its group id and options. Answer with <see cref="Choose"/>.</summary>
        public event Action<string, List<ChoiceOption>> Choice;
        /// <summary>The flow has ended, and why, as its End step says: <see cref="FlowEndReason.RanDry"/> when a
        /// choice had nothing left to offer and nothing came after it, otherwise <see cref="FlowEndReason.Ended"/>.</summary>
        public event Action<FlowEndReason> Ended;

        public PatterRunner(Engine engine, string flowId = "main")
        {
            _engine = engine;
            FlowId = flowId;
        }

        /// <summary>The id of the flow the runner plays.</summary>
        public string FlowId { get; }

        /// <summary>The flow the runner plays, looked up by id each time: a load or a hot swap replaces it.</summary>
        public Flow Flow => _engine.GetFlow(FlowId);

        /// <summary>
        /// Start a conversation at a scene (and block), and deliver its first beat. The first start opens the
        /// flow. A later one moves the same flow there, as an authored jump does, so visit counts, variations
        /// and the flow's own properties carry on through the playthrough.
        ///
        /// With no scene, the story starts from the beginning, at the project's start scene: the first time
        /// opens the flow there, and a later time resets it (<c>Flow.Reset()</c>), forgetting the flow's own
        /// state, as a new game does. Throws on an address that doesn't resolve, before anything changes.
        /// </summary>
        public void Begin(string scene = null, string block = null)
        {
            var flow = Flow;
            if (flow == null || flow.IsClosed)
                _engine.OpenFlow(FlowId, scene, block);
            else if (scene == null)
            {
                if (block != null) throw new Exception("PatterRunner.Begin: a block needs its scene");
                flow.Reset();
            }
            else if (!flow.Goto(scene, block))
                throw new Exception($"PatterRunner.Begin: address not found: {scene}{(block == null ? "" : $" / {block}")}");
            _queued = 0;
            Next();
        }

        /// <summary>Deliver the next beat, the pending choice, or the end.</summary>
        public void Next()
        {
            if (Flow == null) throw new Exception($"PatterRunner.Next: flow '{FlowId}' isn't open; call Begin() first");
            _queued++;
            if (_delivering) return;
            _delivering = true;
            try
            {
                while (_queued > 0)
                {
                    _queued--;
                    Deliver(Flow.Advance());
                }
            }
            finally
            {
                _delivering = false;
                _queued = 0;
            }
        }

        /// <summary>Pick an option of the pending choice, then deliver what it leads to. Throws as
        /// <c>Flow.Choose</c> does (no choice pending, an unknown option, or one that isn't eligible).</summary>
        public void Choose(string id)
        {
            var flow = Flow;
            if (flow == null) throw new Exception($"PatterRunner.Choose: flow '{FlowId}' isn't open; call Begin() first");
            flow.Choose(id);
            Next();
        }

        /// <summary>
        /// Stop delivering: any Next() a handler asked for is dropped, and nothing more is delivered until the
        /// game asks. The flow stays where it is, open and saveable, and Ended is not raised; Next() carries on
        /// from there and Begin() begins elsewhere.
        /// </summary>
        public void Stop() => _queued = 0;

        /// <summary>Play on a replacement engine (what <c>engine.HotSwap()</c> returns).</summary>
        public void Rebind(Engine engine) => _engine = engine;

        private void Deliver(StepResult step)
        {
            switch (step.Type)
            {
                case StepType.Line: Line?.Invoke(step); break;
                case StepType.Text: Text?.Invoke(step); break;
                case StepType.GameEvent: GameEvent?.Invoke(step); break;
                case StepType.Choice: Choice?.Invoke(step.GroupId, step.Options); break;
                case StepType.End: Ended?.Invoke(step.Reason); break;
            }
        }
    }
}
