// gameData read helpers - sparse overrides resolved against per-type field defaults
// (merge-at-read). Port of @patterkit/runtime's gamedata.ts.
//
// Patter extension values follow the same rule (patterkit design/proposals/patter-storylet-extensions.md,
// "At runtime"): raw on the node, declarations with every default resolved in the bundle's Extensions section,
// and the same two helpers fill them in, given ExtensionDecls. Values are the neutral JSON tree (OrderedMap /
// List / bool / double / string / null), so a JSON null is a real value: a field set to null stays null, as a
// null default does. ExtensionsOf reads any node's values off the bundle, by the address a game already uses.

using System.Collections.Generic;
using Wildwinter.Expr;

namespace Patterkit.Patterplay
{
    public static class GameDataHelpers
    {
        /// <summary>The author-defined gameData fields declared for a node TYPE (empty when none).</summary>
        public static List<GameDataField> GameDataFields(Bundle bundle, string kind)
        {
            if (bundle.GameDataFields != null && bundle.GameDataFields.TryGetValue(kind, out var fields)) return fields;
            return new List<GameDataField>();
        }

        /// <summary>A node's FULL effective gameData: every declared field resolved (override or default),
        /// plus override-only orphan keys, in declared-then-orphan order. Fields with no value are omitted.</summary>
        public static GameData EffectiveGameData(List<GameDataField> fields, GameData node)
        {
            var outData = new GameData();
            foreach (var f in fields)
            {
                ExprValue v = GameDataValue(fields, node, f.Name);
                if (v != null) outData[f.Name] = v;
            }
            if (node != null)
                foreach (var kv in node)
                    if (!outData.ContainsKey(kv.Key)) outData[kv.Key] = kv.Value;
            return outData;
        }

        /// <summary>One node's effective value for a field: its sparse OVERRIDE if present, else the field's
        /// declared default (null if neither is set). <paramref name="fields"/> is the schema for the node's type.</summary>
        public static ExprValue GameDataValue(List<GameDataField> fields, GameData node, string name)
        {
            if (node != null && node.TryGetValue(name, out var v)) return v;
            foreach (var f in fields) if (f.Name == name) return f.Default;
            return null;
        }

        // -- Patter extension values ---------------------------------------------

        /// <summary>One node's effective value for an extension field: its own value if it sets one, else the
        /// field's declared default (a structured default whole); null if neither is set. <paramref name="decls"/>
        /// is one extension's declarations for the node's kind (<see cref="ExtensionDecls"/>).</summary>
        public static object GameDataValue(List<ExtensionFieldDecl> decls, OrderedMap<string, object> node, string name)
            => TryExtensionValue(decls, node, name, out var value) ? value : null;

        /// <summary>One extension's FULL effective values for a node: every declared field resolved (the node's
        /// own, else the default; a structured default arrives whole), in declaration order, then any key the node
        /// sets with no declaration, kept verbatim. Fields left with no value are omitted.</summary>
        public static OrderedMap<string, object> EffectiveGameData(List<ExtensionFieldDecl> decls, OrderedMap<string, object> node)
        {
            var outData = new OrderedMap<string, object>();
            foreach (var f in decls)
                if (f.Name != null && !outData.ContainsKey(f.Name) && TryExtensionValue(decls, node, f.Name, out var v)) outData.Set(f.Name, v);
            if (node != null)
                foreach (var kv in node)
                    if (!outData.ContainsKey(kv.Key)) outData.Set(kv.Key, kv.Value);
            return outData;
        }

        private static bool TryExtensionValue(List<ExtensionFieldDecl> decls, OrderedMap<string, object> node, string name, out object value)
        {
            if (node != null && node.TryGetValue(name, out value)) return true;
            foreach (var f in decls)
            {
                if (f.Name != name) continue;
                value = f.Default;
                return f.HasDefault;
            }
            value = null;
            return false;
        }

        /// <summary>One extension's declarations for a node kind (project, scene, block, snippet, line, text,
        /// gameEvent, option), every default resolved. Empty when the bundle has no such extension or it declares
        /// nothing for the kind.</summary>
        public static List<ExtensionFieldDecl> ExtensionDecls(Bundle bundle, string extension, string kind)
        {
            if (bundle.Extensions == null || extension == null || !bundle.Extensions.TryGetValue(extension, out var ext)) return new List<ExtensionFieldDecl>();
            return kind != null && ext.Fields.TryGetValue(kind, out var decls) && decls != null ? decls : new List<ExtensionFieldDecl>();
        }

        /// <summary>
        /// A node's Patter extension values, by extension id, raw; empty when it has none or the address names
        /// nothing. By the names a game already holds: project (no address); scene by id or gameId; block as
        /// "scene/block", each by id or gameId; snippet, line, text, gameEvent and option (a group directly inside
        /// a choice) by node id. A node of another kind than the one asked for reads as none. A fresh map each
        /// call; the values in it are the bundle's own.
        /// </summary>
        public static OrderedMap<string, OrderedMap<string, object>> ExtensionsOf(Bundle bundle, string kind, string address = "")
        {
            address = address ?? "";
            switch (kind)
            {
                case "project":
                {
                    var output = new OrderedMap<string, OrderedMap<string, object>>();
                    if (bundle.Extensions != null)
                        foreach (var pair in bundle.Extensions)
                            if (pair.Value.Project != null) output.Set(pair.Key, pair.Value.Project);
                    return output;
                }
                case "scene": return CopyExtensions(SceneOf(bundle, address)?.Extensions);
                case "block":
                {
                    int slash = address.IndexOf('/');
                    if (slash < 0) return CopyExtensions(null);
                    var blocks = SceneOf(bundle, address.Substring(0, slash))?.Blocks ?? new List<Block>();
                    var blockRef = address.Substring(slash + 1);
                    var block = blocks.Find(b => b.Id == blockRef) ?? blocks.Find(b => Engine.EffectiveGameId(b.GameId, b.Name) == blockRef);
                    return CopyExtensions(block?.Extensions);
                }
                case "snippet": case "option": case "line": case "text": case "gameEvent":
                {
                    OrderedMap<string, OrderedMap<string, object>> found = null;
                    bool done = false;
                    void Walk(List<Node> children, bool inChoice)
                    {
                        foreach (var node in children ?? new List<Node>())
                        {
                            if (done) return;
                            if (node.IsGroup)
                            {
                                if (inChoice && node.Id == address && kind == "option") { found = node.Extensions; done = true; return; }
                                if (inChoice && node.Prompt != null && node.Prompt.Id == address && node.Prompt.Kind == kind) { found = node.Prompt.Extensions; done = true; return; }
                                Walk(node.Children, node.Selector == "choice");
                                continue;
                            }
                            if (node.Id == address && kind == "snippet") { found = node.Extensions; done = true; return; }
                            var beat = (node.Beats ?? new List<Beat>()).Find(b => b.Id == address);
                            if (beat != null) { if (beat.Kind == kind) { found = beat.Extensions; done = true; } return; }
                        }
                    }
                    foreach (var scene in bundle.Scenes.Values)
                        foreach (var block in scene.Blocks)
                            if (!done) Walk(block.Children, false);
                    return CopyExtensions(found);
                }
                default: return CopyExtensions(null);
            }
        }

        /// <summary>A scene by its internal id, else by its gameId.</summary>
        private static Scene SceneOf(Bundle bundle, string sceneRef)
        {
            if (bundle.Scenes.TryGetValue(sceneRef, out var byId)) return byId;
            foreach (var scene in bundle.Scenes.Values)
                if (Engine.EffectiveGameId(scene.GameId, scene.Name) == sceneRef) return scene;
            return null;
        }

        /// <summary>A fresh map of a node's values by extension id (empty for none); the values are shared.</summary>
        internal static OrderedMap<string, OrderedMap<string, object>> CopyExtensions(OrderedMap<string, OrderedMap<string, object>> values)
        {
            var output = new OrderedMap<string, OrderedMap<string, object>>();
            if (values != null) foreach (var pair in values) output.Set(pair.Key, pair.Value);
            return output;
        }

        [System.Obsolete("Use GameDataFields, the name every Patterplay runtime uses.")]
        public static List<GameDataField> FieldsFor(Bundle bundle, string kind) => GameDataFields(bundle, kind);

        [System.Obsolete("Use EffectiveGameData, the name every Patterplay runtime uses.")]
        public static GameData Effective(List<GameDataField> fields, GameData node) => EffectiveGameData(fields, node);
    }
}
