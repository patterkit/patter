// The Unity tour demo: play the interactive Patter tour. Mirrors the web / Unreal / Godot tour
// demos: step the flow, offer the choices, and (optionally) play each line's WINNING take via the
// patteraudio.json resolver (PatterAudioResolver) - whatever rung the audio folder holds; no rung
// is hard-coded here.
//
// Setup: none. Import this sample, open the Tour scene beside this file, press Play - the scene
// already carries a wired-up TourDemo. (Or drop TourDemo on any GameObject and assign the
// imported tour.patterc to its Bundle field; the whole UI is immediate-mode OnGUI, so no other
// scene wiring is needed.) Audio files are NOT bundled with the sample (playback is your
// platform call); point Audio Root at any Patter audio folder to hear it.

using System.Collections;
using System.Collections.Generic;
using System.IO;
using UnityEngine;
using UnityEngine.Networking;

namespace Patterkit.Patterplay.Samples
{
    public sealed class TourDemo : MonoBehaviour
    {
        [Tooltip("The imported tour.patterc (a PatterBundleAsset).")]
        public PatterBundleAsset Bundle;

        [Tooltip("Optional: a Patter audio folder (holds patteraudio.json + takes). Absolute, or relative to the project folder. Empty = play silently; audio files are not bundled with the sample.")]
        public string AudioRoot = "";

        [Tooltip("Play each line's winning take as it steps.")]
        public bool PlayAudio = true;

        private Engine _engine;
        private Flow _flow;
        private PatterAudioResolver _audio;
        private AudioSource _source;
        private readonly List<string> _transcript = new List<string>();
        private StepResult _pending; // the step whose controls are on screen (choice), or null
        private bool _ended;
        private Vector2 _scroll;

        private void Start()
        {
            if (Bundle == null)
            {
                Debug.LogWarning("TourDemo: assign the imported tour.patterc to the Bundle field.");
                enabled = false;
                return;
            }
            _engine = Bundle.CreateEngine();
            PatterDebug.Register(_engine); // Window ▸ Patterplay ▸ Runtime State can watch the run
            _source = gameObject.AddComponent<AudioSource>();

            // The manifest is optional: without it the tour plays silently.
            string root = ResolveAudioRoot();
            if (root != null)
            {
                string manifestPath = Path.Combine(root, "patteraudio.json");
                if (File.Exists(manifestPath))
                    _audio = new PatterAudioResolver(File.ReadAllText(manifestPath), root);
                else
                    Debug.LogWarning($"TourDemo: no patteraudio.json under '{root}' - playing silently.");
            }

            StartRun();
        }

        private string ResolveAudioRoot()
        {
            if (string.IsNullOrWhiteSpace(AudioRoot)) return null;
            // Relative paths resolve against the project folder (the parent of Assets/).
            return Path.IsPathRooted(AudioRoot)
                ? AudioRoot
                : Path.GetFullPath(Path.Combine(Application.dataPath, "..", AudioRoot));
        }

        private void StartRun()
        {
            _transcript.Clear();
            _ended = false;
            _flow = _engine.OpenFlow("main"); // the project's start scene
            Step();
        }

        private void Step()
        {
            var step = _flow.Advance();
            switch (step.Type)
            {
                case StepType.Line:
                    _transcript.Add($"<b>{(step.CharacterName ?? step.Character ?? "").ToUpperInvariant()}</b>  {Fmt(step.Text)}");
                    PlayClip(step.Id);
                    _pending = null;
                    break;
                case StepType.Text:
                    _transcript.Add(Fmt(step.Text));
                    PlayClip(step.Id);
                    _pending = null;
                    break;
                case StepType.GameEvent:
                    _transcript.Add($"⚙ game event {step.Id}");
                    _pending = null;
                    break;
                case StepType.Choice:
                    _pending = step;
                    break;
                case StepType.End:
                    _transcript.Add("· The End ·");
                    _ended = true;
                    _pending = null;
                    break;
            }
            _scroll.y = float.MaxValue;
        }

        /// <summary>Fire the beat's winning take, if the manifest resolves one for it.</summary>
        private void PlayClip(string beatId)
        {
            if (_audio == null || !PlayAudio) return;
            string path = _audio.Resolve(beatId);
            if (path == null || !File.Exists(path)) return;
            StartCoroutine(PlayFile(path));
        }

        private IEnumerator PlayFile(string path)
        {
            using (var req = UnityWebRequestMultimedia.GetAudioClip("file://" + path, AudioType.WAV))
            {
                yield return req.SendWebRequest();
                if (req.result != UnityWebRequest.Result.Success) yield break;
                var clip = DownloadHandlerAudioClip.GetContent(req);
                if (clip != null) { _source.Stop(); _source.clip = clip; _source.Play(); }
            }
        }

        private void OnGUI()
        {
            const int pad = 16;
            var area = new Rect(pad, pad, Mathf.Min(Screen.width - pad * 2, 720), Screen.height - pad * 2);
            GUILayout.BeginArea(area);

            GUILayout.BeginHorizontal();
            GUILayout.Label("<b>Patter · The Tour</b>", Rich(16));
            GUILayout.FlexibleSpace();
            PlayAudio = GUILayout.Toggle(PlayAudio, " audio");
            GUILayout.EndHorizontal();

            _scroll = GUILayout.BeginScrollView(_scroll, GUILayout.ExpandHeight(true));
            foreach (var line in _transcript) GUILayout.Label(line, Rich(14));
            GUILayout.EndScrollView();

            if (_ended)
            {
                if (GUILayout.Button("↺ Play again", GUILayout.Height(32))) StartRun();
            }
            else if (_pending != null)
            {
                foreach (var o in _pending.Options)
                {
                    GUI.enabled = o.Eligible;
                    if (GUILayout.Button(Plain(o.Prompt?.Text ?? "(choice)"), GUILayout.Height(32))) { _flow.Choose(o.Id); Step(); break; }
                    GUI.enabled = true;
                }
                GUI.enabled = true;
            }
            else if (GUILayout.Button("▸ Next", GUILayout.Height(32)))
            {
                Step();
            }

            GUILayout.EndArea();
        }

        private static GUIStyle Rich(int size) => new GUIStyle(GUI.skin.label) { richText = true, fontSize = size, wordWrap = true };

        // Patter's formatting markup is a fixed, flat vocabulary (<b>/<i>/<bi>) handed over
        // verbatim; mapping it is the host's job. IMGUI rich text already understands <b> and
        // <i>, so only <bi> needs translating.
        private static string Fmt(string s) => s.Replace("<bi>", "<b><i>").Replace("</bi>", "</i></b>");

        // Buttons render plain text, so there the tags just come off.
        private static string Plain(string s) =>
            s.Replace("<bi>", "").Replace("</bi>", "").Replace("<b>", "").Replace("</b>", "").Replace("<i>", "").Replace("</i>", "");
    }
}
