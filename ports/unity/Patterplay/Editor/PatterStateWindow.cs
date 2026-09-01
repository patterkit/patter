// Window ▸ Patterplay ▸ Runtime State - watch AND edit a live engine's properties during
// play, and save / load the whole run to a JSON file. Register engines from your game with
// PatterDebug.Register(engine).

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEngine;

namespace Patterkit.Patterplay.Editor
{
    public sealed class PatterStateWindow : EditorWindow
    {
        private Vector2 _scroll;
        private readonly Dictionary<string, string> _flagEdits = new Dictionary<string, string>();

        [MenuItem("Window/Patterplay/Runtime State")]
        public static void Open()
        {
            // Dock it on first open rather than letting it float: a floating EditorWindow slides
            // behind the main window the moment you click the Game view, which is exactly when you
            // want to be watching it. (A utility window would stay on top but could never be
            // docked - the worse trade for a panel you keep beside a running game.)
            var w = GetWindow<PatterStateWindow>("Patter State", DockNextTo());
            w.minSize = new Vector2(360, 280);
            w.Show();
            w.Focus();
        }

        /// <summary>The windows we would like to dock beside, best first. The Inspector is internal,
        /// so it is looked up by name and quietly skipped if a future Unity renames it; SceneView is
        /// the public fallback. A docking preference must never be the thing that breaks the window.</summary>
        private static Type[] DockNextTo()
        {
            var wanted = new List<Type>();
            var inspector = Type.GetType("UnityEditor.InspectorWindow,UnityEditor");
            if (inspector != null) wanted.Add(inspector);
            wanted.Add(typeof(SceneView));
            return wanted.ToArray();
        }

        private void OnInspectorUpdate() => Repaint(); // live-refresh while playing

        private void OnGUI()
        {
            if (!Application.isPlaying)
            {
                EditorGUILayout.HelpBox("Enter Play mode and register an engine with PatterDebug.Register(engine) to watch and edit its state.", MessageType.Info);
                return;
            }
            DrawLink();
            if (PatterDebug.Engines.Count == 0)
            {
                EditorGUILayout.HelpBox("No engines registered. Call PatterDebug.Register(engine) after creating your Engine.", MessageType.Info);
                return;
            }

            _scroll = EditorGUILayout.BeginScrollView(_scroll);
            int idx = 0;
            foreach (var engine in PatterDebug.Engines)
            {
                EditorGUILayout.LabelField($"Engine #{idx++}", EditorStyles.boldLabel);
                DrawSaveLoad(engine);
                EditorGUILayout.Space();
                DrawProperties(engine);
                EditorGUILayout.Space();
                DrawReadOnlyState(engine);
                EditorGUILayout.Space();
                DrawLog(engine);
                EditorGUILayout.Space();
            }
            EditorGUILayout.EndScrollView();
        }

        // -- The decision log ---------------------------------------------------

        /// <summary>The engine's per-kind log filters. The vocabulary is this engine's: `select`
        /// is a group choosing among its children, `chose` is the player answering a choice,
        /// `dry` is a choice that fell through with nothing takeable.</summary>
        private static readonly string[] LogKinds = { "select", "choice", "chose", "dry", "jump", "write" };
        private static readonly string[] LogKindLabels = { "Select", "Choice", "Chose", "Dry", "Jump", "Write" };
        private readonly Dictionary<string, bool> _logKindOn = new Dictionary<string, bool>();
        private Vector2 _logScroll;

        /// <summary>The run's decisions: what the engine CHOSE, not what it produced. A step says
        /// which line played; this says why THAT line and not its siblings. Mirrors the Storylet
        /// Engine's log panel, in this engine's vocabulary.</summary>
        private void DrawLog(Engine engine)
        {
            EditorGUILayout.LabelField("Log (decisions)", EditorStyles.boldLabel);
            var entries = engine.Log();
            if (entries.Count == 0)
            {
                EditorGUILayout.LabelField("  (empty - build the Engine with EngineOptions { Log = true })");
                return;
            }

            EditorGUILayout.BeginHorizontal();
            for (int i = 0; i < LogKinds.Length; i++)
            {
                if (!_logKindOn.ContainsKey(LogKinds[i])) _logKindOn[LogKinds[i]] = true;
                _logKindOn[LogKinds[i]] = GUILayout.Toggle(_logKindOn[LogKinds[i]], LogKindLabels[i], GUILayout.Width(64));
            }
            EditorGUILayout.EndHorizontal();

            EditorGUILayout.BeginHorizontal();
            if (GUILayout.Button("Copy", GUILayout.Width(60)))
                EditorGUIUtility.systemCopyBuffer = string.Join("\n", VisibleLogLines(engine));
            if (GUILayout.Button("Clear", GUILayout.Width(60))) engine.ClearLog();
            EditorGUILayout.EndHorizontal();

            _logScroll = EditorGUILayout.BeginScrollView(_logScroll, GUILayout.Height(150));
            foreach (var line in VisibleLogLines(engine)) EditorGUILayout.LabelField(line);
            EditorGUILayout.EndScrollView();
        }

        private List<string> VisibleLogLines(Engine engine)
        {
            var lines = new List<string>();
            foreach (var e in engine.Log())
                if (!_logKindOn.TryGetValue(e.Type, out var on) || on) lines.Add(FormatLogEntry(e));
            return lines;
        }

        private static string ShowLogValue(PatterValue v) => v == null ? "<unset>" : v.ToDisplayString();

        /// <summary>One line per entry. A `select` names the children it walked AND their verdicts,
        /// because that is the whole point: "why is my line missing" is unanswerable from the
        /// winner alone.</summary>
        private static string FormatLogEntry(LogEntry e)
        {
            string stamp = $"[{e.Seq}] ";
            if (!string.IsNullOrEmpty(e.Flow)) stamp += e.Flow + " ";
            switch (e.Type)
            {
                case "select":
                {
                    var parts = e.Considered == null ? new List<string>()
                        : e.Considered.Select(c => c.Eligible ? c.Id : c.Id + " (x)").ToList();
                    return $"{stamp}select {e.Subject} [{e.Selector}]: {string.Join(", ", parts)} -> {e.Picked ?? "(nothing)"}";
                }
                case "choice":
                {
                    var opts = e.Considered == null ? new List<string>()
                        : e.Considered.Select(o => o.Eligible ? o.Id : o.Id + " (greyed)").ToList();
                    return $"{stamp}choice {e.Subject}: {string.Join(", ", opts)}";
                }
                case "chose":  return $"{stamp}chose {e.Subject} -> {e.Picked}";
                case "dry":    return $"{stamp}dry {e.Subject} (nothing takeable, no eligible fallback)";
                case "jump":   return $"{stamp}jump {e.Subject} ({e.Detail})";
                case "write":  return $"{stamp}write {e.Subject}: {ShowLogValue(e.Prev)} -> {ShowLogValue(e.Value)}";
            }
            return stamp + "(unknown)";
        }

        // -- Save / Load --------------------------------------------------------

        /// <summary>The Live Link's state, so this window answers the question a link's user asks first.
        /// From inside a running game "the editor is not listening" and "I never attached" look
        /// identical; only the game knows which (from-storylets/weak-debug-registries).</summary>
        private void DrawLink()
        {
            var links = PatterDebug.Links;
            if (links.Count == 0)
            {
                EditorGUILayout.LabelField("Live Link", "not attached (PatterDebug.RegisterLink(link))");
                EditorGUILayout.Space();
                return;
            }
            foreach (var link in links)
            {
                EditorGUILayout.LabelField("Live Link", $"{link.State} - {link.Url} - build {link.Build}");
            }
            EditorGUILayout.Space();
        }

        private void DrawSaveLoad(Engine engine)
        {
            EditorGUILayout.BeginHorizontal();
            if (GUILayout.Button("Save State…", GUILayout.Width(110)))
            {
                string path = EditorUtility.SaveFilePanel("Save Patter state", "", "save.patterstate", "patterstate");
                if (!string.IsNullOrEmpty(path))
                {
                    try { File.WriteAllText(path, PatterSave.SerializeState(engine)); }
                    catch (Exception e) { EditorUtility.DisplayDialog("Save failed", e.Message, "OK"); }
                }
            }
            if (GUILayout.Button("Load State…", GUILayout.Width(110)))
            {
                string path = EditorUtility.OpenFilePanel("Load Patter state", "", "patterstate");
                if (!string.IsNullOrEmpty(path))
                {
                    try { PatterSave.DeserializeState(engine, File.ReadAllText(path)); }
                    catch (Exception e) { EditorUtility.DisplayDialog("Load failed", e.Message, "OK"); }
                }
            }
            EditorGUILayout.EndHorizontal();
        }

        // -- Editable properties ------------------------------------------------

        private void DrawProperties(Engine engine)
        {
            EditorGUILayout.LabelField("@patter properties", EditorStyles.miniBoldLabel);
            var rows = engine.ListProperties();
            if (rows.Count == 0) { EditorGUILayout.LabelField("  (none)"); return; }

            foreach (var row in rows)
            {
                EditorGUILayout.BeginHorizontal();
                EditorGUILayout.LabelField(row.Path, GUILayout.Width(140));

                PatterValue edited = DrawValueField(engine, row);
                if (edited != null && !edited.ValueEquals(row.Value)) engine.SetProperty(row.Path, edited);

                // Reset-to-default arrow.
                using (new EditorGUI.DisabledScope(row.Value.ValueEquals(row.Default)))
                {
                    if (GUILayout.Button("↺", GUILayout.Width(24))) engine.SetProperty(row.Path, row.Default);
                }
                EditorGUILayout.EndHorizontal();
            }
        }

        private PatterValue DrawValueField(Engine engine, PropertyView row)
        {
            switch (row.Type)
            {
                case "boolean":
                    return PatterValue.Bool(EditorGUILayout.Toggle(row.Value.IsBool && row.Value.AsBool));
                case "number":
                    return PatterValue.Num(EditorGUILayout.DoubleField(row.Value.IsNumber ? row.Value.AsNumber : 0));
                case "string":
                    return PatterValue.Str(EditorGUILayout.TextField(row.Value.IsString ? row.Value.AsString : ""));
                case "enum":
                case "quality": // a stage edits as a dropdown of its LADDER - closed, like an enum's values
                {
                    var opts = (row.Type == "quality" ? row.Stages : row.Values) ?? new List<string>();
                    int cur = row.Value.IsString ? Mathf.Max(0, opts.IndexOf(row.Value.AsString)) : 0;
                    int next = EditorGUILayout.Popup(cur, opts.ToArray());
                    return opts.Count > 0 ? PatterValue.Str(opts[Mathf.Clamp(next, 0, opts.Count - 1)]) : row.Value;
                }
                case "flags":
                {
                    string key = row.Path;
                    string shown = _flagEdits.TryGetValue(key, out var buf) ? buf
                        : (row.Value.IsFlags ? string.Join(", ", row.Value.AsFlags) : "");
                    EditorGUI.BeginChangeCheck();
                    string next = EditorGUILayout.TextField(shown);
                    if (EditorGUI.EndChangeCheck())
                    {
                        _flagEdits[key] = next;
                        var list = next.Split(',').Select(s => s.Trim()).Where(s => s.Length > 0).ToList();
                        return PatterValue.Flags(list);
                    }
                    return null;
                }
                default:
                    EditorGUILayout.LabelField(row.Value.ToString());
                    return null;
            }
        }

        // -- Read-only state ----------------------------------------------------

        private void DrawReadOnlyState(Engine engine)
        {
            var save = engine.SaveGame();
            if (save.SharedVisits.Count > 0)
            {
                EditorGUILayout.LabelField("Visits (world)", EditorStyles.miniBoldLabel);
                foreach (var kv in save.SharedVisits) EditorGUILayout.LabelField("  " + kv.Key, kv.Value.ToString());
            }
            EditorGUILayout.LabelField("Flows", EditorStyles.miniBoldLabel);
            foreach (var kv in save.Flows) EditorGUILayout.LabelField("  " + kv.Key, kv.Value.CurrentSceneId ?? "-");
        }
    }
}
