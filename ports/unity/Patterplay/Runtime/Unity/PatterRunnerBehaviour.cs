// The thin runner as a component, for straightforward games: PatterRunner's events as UnityEvents, so a
// designer wires each beat to the game's own UI in the Inspector, and buttons call Next, Choose and Stop.
// It dictates no UI and no audio, and it never advances on its own: a line carries its beat id, and the
// game shows it, plays its recording, and calls Next() when it's ready.
//
// Give it a Bundle and it makes its own engine as it wakes; or hand it one with Attach(engine). Begin
// starts the conversation.
//
// A fuller dialogue manager for more complex games, Patterstage, is coming.

using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Events;

namespace Patterkit.Patterplay
{
    /// <summary>A beat the runner delivers: the step itself (a line, a text or a game event).</summary>
    [Serializable] public sealed class PatterStepEvent : UnityEvent<StepResult> { }

    /// <summary>A choice the runner delivers: its group id and options.</summary>
    [Serializable] public sealed class PatterChoiceEvent : UnityEvent<string, List<ChoiceOption>> { }

    public sealed class PatterRunnerBehaviour : MonoBehaviour
    {
        [Tooltip("Optional: a compiled .patterc. Set, the component makes its own engine as it wakes; empty, hand it one with Attach(engine).")]
        public PatterBundleAsset Bundle;

        [Tooltip("The flow the runner plays.")]
        public string FlowId = "main";

        public PatterStepEvent OnLine = new PatterStepEvent();
        public PatterStepEvent OnText = new PatterStepEvent();
        public PatterStepEvent OnGameEvent = new PatterStepEvent();
        public PatterChoiceEvent OnChoice = new PatterChoiceEvent();
        public UnityEvent OnEnded = new UnityEvent();

        /// <summary>The engine the runner plays on, for saves and everything else the runner leaves alone.</summary>
        public Engine Engine { get; private set; }

        /// <summary>The runner itself, null until attached.</summary>
        public PatterRunner Runner { get; private set; }

        private void Awake()
        {
            if (Bundle != null && Runner == null) Attach(Bundle.CreateEngine(), FlowId);
        }

        private void OnDestroy() => Detach();

        /// <summary>Play a flow of this engine, raising this component's events. Replaces any runner it had.</summary>
        public PatterRunner Attach(Engine engine, string flowId = "main")
        {
            Detach();
            Engine = engine;
            FlowId = flowId;
            Runner = new PatterRunner(engine, flowId);
            Runner.Line += RaiseLine;
            Runner.Text += RaiseText;
            Runner.GameEvent += RaiseGameEvent;
            Runner.Choice += RaiseChoice;
            Runner.Ended += RaiseEnded;
            return Runner;
        }

        /// <summary>Start the story from the beginning, at the project's start scene.</summary>
        public void Begin() => Need().Begin();

        /// <summary>Start a conversation at a scene (empty = the project's start scene).</summary>
        public void Begin(string scene) => Need().Begin(string.IsNullOrEmpty(scene) ? null : scene);

        /// <summary>Start a conversation at a scene and block.</summary>
        public void Begin(string scene, string block) => Need().Begin(scene, block);

        public void Next() => Need().Next();

        public void Choose(string id) => Need().Choose(id);

        public void Stop() => Need().Stop();

        /// <summary>Play on a replacement engine (what <c>engine.HotSwap()</c> returns).</summary>
        public void Rebind(Engine engine)
        {
            Need().Rebind(engine);
            Engine = engine;
        }

        private PatterRunner Need() =>
            Runner ?? throw new Exception("PatterRunnerBehaviour: no engine yet; set Bundle, or call Attach(engine) first");

        private void Detach()
        {
            if (Runner == null) return;
            Runner.Line -= RaiseLine;
            Runner.Text -= RaiseText;
            Runner.GameEvent -= RaiseGameEvent;
            Runner.Choice -= RaiseChoice;
            Runner.Ended -= RaiseEnded;
            Runner = null;
        }

        private void RaiseLine(StepResult step) => OnLine.Invoke(step);
        private void RaiseText(StepResult step) => OnText.Invoke(step);
        private void RaiseGameEvent(StepResult step) => OnGameEvent.Invoke(step);
        private void RaiseChoice(string groupId, List<ChoiceOption> options) => OnChoice.Invoke(groupId, options);
        private void RaiseEnded() => OnEnded.Invoke();
    }
}
