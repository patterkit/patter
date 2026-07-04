// The Inspector for an imported .patterc: a quick structural read-out (scenes, locales,
// cast, properties) so you can confirm what you imported without leaving Unity.

using System;
using System.Linq;
using UnityEditor;
using UnityEngine;

namespace Patterkit.Patterplay.Editor
{
    [CustomEditor(typeof(PatterBundleAsset))]
    public sealed class PatterBundleAssetEditor : UnityEditor.Editor
    {
        public override void OnInspectorGUI()
        {
            var asset = (PatterBundleAsset)target;
            Bundle b;
            try { b = asset.Bundle; }
            catch (Exception e) { EditorGUILayout.HelpBox(e.Message, MessageType.Error); return; }

            EditorGUILayout.LabelField("Patter bundle", EditorStyles.boldLabel);
            EditorGUILayout.LabelField("Scenes", b.Scenes.Count.ToString());
            EditorGUILayout.LabelField("Default locale", b.Locales.Default);
            EditorGUILayout.LabelField("Locales", b.Locales.Included.Count > 0 ? string.Join(", ", b.Locales.Included) : "-");
            EditorGUILayout.LabelField("Cast", b.Cast.Count.ToString());
            EditorGUILayout.LabelField("Global properties", b.Properties.Count.ToString());
            EditorGUILayout.LabelField("Localisation", b.Localisation?.Mode == "ids" ? "IDs-only" : "embedded");

            EditorGUILayout.Space();
            EditorGUILayout.LabelField("Scenes", EditorStyles.boldLabel);
            foreach (var sc in b.Scenes.Values)
                EditorGUILayout.LabelField("  " + (string.IsNullOrEmpty(sc.Name) ? sc.Id : sc.Name), $"{sc.Blocks.Count} block(s)");
        }
    }
}
