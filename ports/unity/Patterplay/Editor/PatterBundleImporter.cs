// A ScriptedImporter: drop a compiled .patterc into a Unity project and it imports as a
// PatterBundleAsset (validated at import time; parse errors surface in the console).

using System;
using System.IO;
using UnityEditor.AssetImporters;
using UnityEngine;

namespace Patterkit.Patterplay.Editor
{
    [ScriptedImporter(1, "patterc")]
    public sealed class PatterBundleImporter : ScriptedImporter
    {
        public override void OnImportAsset(AssetImportContext ctx)
        {
            var asset = ScriptableObject.CreateInstance<PatterBundleAsset>();
            asset.Json = File.ReadAllText(ctx.assetPath);
            try { var _ = asset.Bundle; }                 // validate by parsing
            catch (Exception e) { ctx.LogImportError($"Patterplay: invalid .patterc - {e.Message}"); }
            ctx.AddObjectToAsset("PatterBundle", asset);
            ctx.SetMainObject(asset);
        }
    }
}
