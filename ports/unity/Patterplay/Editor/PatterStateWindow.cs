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
            }
            EditorGUILayout.EndScrollView();
        }

        // -- Save / Load --------------------------------------------------------

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
                EditorGUILayout.LabelField(row.Ref, GUILayout.Width(140));

                PatterValue edited = DrawValueField(engine, row);
                if (edited != null && !edited.ValueEquals(row.Value)) engine.SetProperty(row.Ref, edited);

                // Reset-to-default arrow.
                using (new EditorGUI.DisabledScope(row.Value.ValueEquals(row.Default)))
                {
                    if (GUILayout.Button("↺", GUILayout.Width(24))) engine.SetProperty(row.Ref, row.Default);
                }
                EditorGUILayout.EndHorizontal();
            }
        }

        private PatterValue DrawValueField(Engine engine, PropertyRow row)
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
                    string key = row.Ref;
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
