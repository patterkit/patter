// The Inspector for an imported .patterc: the bundle inspector's Unity view.
//
// It answers the integrator's question from the imported asset alone, with nothing running:
// what may my game code call, and is this the bundle I think it is? The data comes from
// BundleInfo.Describe (Runtime/BundleDescription.cs), which is the same description the JS,
// Unreal and Godot views render - so two people on two engines reading the same asset see the
// same rows in the same order.
//
// Contrast PatterStateWindow, which is the LIVE property examiner: it needs a running game and
// edits what it shows. This needs neither and edits nothing.
//
// Sections are foldouts kept in SessionState, so a chosen shape survives a domain reload rather
// than snapping shut every time a script compiles. Identity and Addresses start open: they are
// what an integrator opens the asset for. The raw JSON is demoted to a foldout at the bottom.

using System;
using System.Collections.Generic;
using System.Linq;
using UnityEditor;
using UnityEngine;

namespace Patterkit.Patterplay.Editor
{
    [CustomEditor(typeof(PatterBundleAsset))]
    public sealed class PatterBundleAssetEditor : UnityEditor.Editor
    {
        private const string KeyPrefix = "Patterplay.BundleInspector.";

        private static bool Foldout(string key, string label, int count, bool defaultOpen)
        {
            string stateKey = KeyPrefix + key;
            bool open = SessionState.GetBool(stateKey, defaultOpen);
            string title = count >= 0 ? $"{label}  ({count})" : label;
            bool next = EditorGUILayout.Foldout(open, title, true, EditorStyles.foldoutHeader);
            if (next != open) SessionState.SetBool(stateKey, next);
            return next;
        }

        public override void OnInspectorGUI()
        {
            var asset = (PatterBundleAsset)target;
            Bundle b;
            try { b = asset.Bundle; }
            catch (Exception e) { EditorGUILayout.HelpBox(e.Message, MessageType.Error); return; }

            var d = BundleInfo.Describe(b);

            // --- identity --------------------------------------------------------------
            EditorGUILayout.LabelField(
                string.IsNullOrEmpty(d.Identity.Project) ? "(unnamed project)" : d.Identity.Project,
                EditorStyles.largeLabel);
            // A source-debug build embeds the source language purely so it can be played. Shipping
            // one is a mistake that is otherwise visible only as "Localisation: IDs-only".
            if (d.Identity.SourceDebug)
                EditorGUILayout.HelpBox("SOURCE DEBUG build: the strings are the source language, for debugging. Not shippable.", MessageType.Warning);

            if (Foldout("identity", "Identity", -1, true))
            {
                using (new EditorGUI.IndentLevelScope())
                {
                    if (!string.IsNullOrEmpty(d.Identity.Version)) Row("Version", d.Identity.Version);
                    Row("Schema", d.Identity.Schema);
                    Row("Default locale", d.Identity.DefaultLocale);
                    Row("Locales", d.Identity.Locales.Count > 0 ? string.Join(", ", d.Identity.Locales) : "-");
                    Row("Strings", d.Identity.Localisation == "ids" ? "IDs-only (the game localises)" : "embedded");
                    if (d.Identity.Voiced) Row("Voiced", "yes");
                    if (!string.IsNullOrEmpty(d.Identity.Hash)) Row("Hash", d.Identity.Hash);
                    // Equal Structure + a different Hash means a TEXT-ONLY edit, which is what makes a
                    // live hot-swap safe. Both are shown so those can be told apart at sight.
                    if (!string.IsNullOrEmpty(d.Identity.StructureHash)) Row("Structure", d.Identity.StructureHash);
                }
            }

            // --- addresses -------------------------------------------------------------
            if (Foldout("addresses", "Addresses", d.Addresses.Count, true))
            {
                using (new EditorGUI.IndentLevelScope())
                {
                    if (d.Addresses.Count == 0) EditorGUILayout.LabelField("no scenes");
                    foreach (var a in d.Addresses)
                    {
                        Row(a.GameId, a.Name);
                        // Nested, because a block address is SCENE-SCOPED: the pair is the address, and
                        // flattening the list would invite calling one alone.
                        using (new EditorGUI.IndentLevelScope())
                            foreach (var blk in a.Blocks) Row(blk.GameId, blk.Name);
                    }
                }
            }

            // --- host scopes -----------------------------------------------------------
            int hostCount = d.HostScopes.Sum(s => s.Properties.Count);
            if (Foldout("host", "Host properties", hostCount, true))
            {
                using (new EditorGUI.IndentLevelScope())
                {
                    if (d.HostScopes.Count == 0) EditorGUILayout.LabelField("the game supplies nothing");
                    foreach (var s in d.HostScopes)
                    {
                        Row("@" + s.Token, s.Opaque ? "any name, unchecked" : $"{s.Properties.Count} declared"
                            + (s.Writable ? "" : "  (read-only)"));
                        using (new EditorGUI.IndentLevelScope())
                            foreach (var p in s.Properties) PropertyRow(p);
                    }
                }
            }

            // --- story-owned -----------------------------------------------------------
            int ownedCount = d.Properties.Patter.Count + d.Properties.Scene.Sum(s => s.Properties.Count);
            if (Foldout("owned", "Story properties", ownedCount, false))
            {
                using (new EditorGUI.IndentLevelScope())
                {
                    if (ownedCount == 0) EditorGUILayout.LabelField("none declared");
                    foreach (var p in d.Properties.Patter) PropertyRow(p);
                    foreach (var s in d.Properties.Scene)
                    {
                        Row("@scene", s.GameId);
                        using (new EditorGUI.IndentLevelScope())
                            foreach (var p in s.Properties) PropertyRow(p);
                    }
                }
            }

            // --- gameData --------------------------------------------------------------
            if (d.GameData.Count > 0 && Foldout("gamedata", "Game data", d.GameData.Sum(g => g.Fields.Count), false))
            {
                using (new EditorGUI.IndentLevelScope())
                    foreach (var g in d.GameData)
                    {
                        EditorGUILayout.LabelField("on " + g.Kind, EditorStyles.miniBoldLabel);
                        using (new EditorGUI.IndentLevelScope())
                            foreach (var f in g.Fields) Row(f.Name, f.Type);
                    }
            }

            // --- counts ----------------------------------------------------------------
            if (Foldout("counts", "Counts", -1, false))
            {
                using (new EditorGUI.IndentLevelScope())
                {
                    var c = d.Counts;
                    Row("Scenes", c.Scenes.ToString());
                    Row("Blocks", c.Blocks.ToString());
                    Row("Groups", c.Groups.ToString());
                    Row("Snippets", c.Snippets.ToString());
                    // Beats is the population GetBeatSequence walks; a choice prompt hangs off its group
                    // and is counted separately rather than folded in or dropped.
                    Row("Beats", c.Beats.ToString());
                    Row("Choice prompts", c.Prompts.ToString());
                    Row("Game events", c.GameEvents.ToString());
                    Row("Cast", c.Cast.ToString());
                }
            }

            // --- the raw asset, demoted ------------------------------------------------
            if (Foldout("json", "Raw JSON", -1, false))
            {
                using (new EditorGUI.IndentLevelScope())
                {
                    if (GUILayout.Button("Copy to clipboard")) EditorGUIUtility.systemCopyBuffer = asset.Json ?? "";
                    EditorGUILayout.SelectableLabel(Preview(asset.Json), EditorStyles.textArea, GUILayout.Height(120));
                }
            }
        }

        private static void Row(string label, string value) => EditorGUILayout.LabelField(label, value);

        /// <summary>A declaration line. "no default" is the part an integrator is scanning for: it is
        /// the value the host must supply, or a condition reads the type default and a branch never
        /// fires.</summary>
        private static void PropertyRow(PropertySummary p)
            => EditorGUILayout.LabelField(p.Name, p.HasDefault ? p.Type : p.Type + "   (no default)");

        /// <summary>A compiled bundle can be megabytes; the Inspector should not try to lay all of it
        /// out. The button copies the whole thing.</summary>
        private static string Preview(string json)
        {
            if (string.IsNullOrEmpty(json)) return "";
            const int max = 4000;
            return json.Length <= max ? json : json.Substring(0, max) + "\n... (" + json.Length + " chars; use Copy)";
        }
    }
}
