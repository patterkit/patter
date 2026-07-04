// Newtonsoft-based .patterc loader: parse a compiled bundle JSON string into the
// Runtime's Bundle model. Lives in a SEPARATE assembly (Patterplay.Runtime.Json) that
// depends on Newtonsoft, so the core engine stays parser-agnostic. Unity ships
// com.unity.nuget.newtonsoft-json; the dotnet TestHost references the same Newtonsoft.Json
// namespace, so this exact loader is corpus-verified too.

using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;

namespace Patterkit.Patterplay
{
    public static class PatterBundleLoader
    {
        public static Bundle Parse(string json) => FromJson(JObject.Parse(json));

        public static Bundle FromJson(JObject b)
        {
            var bundle = new Bundle
            {
                Voiced = (bool?)b["voiced"] ?? false,
            };
            if (b["localisation"] is JObject lz)
                bundle.Localisation = new Localisation { Mode = (string)lz["mode"] ?? "embedded", SourceDebug = (bool?)lz["sourceDebug"] ?? false };
            if (b["closedCaptions"] is JObject ccz)
                bundle.ClosedCaptions = new CaptionDelimiters { Open = (string)ccz["open"], Close = (string)ccz["close"], Character = (string)ccz["character"] };
            if (b["content"] is JObject ct)
            {
                bundle.ContentHash = (string)ct["hash"];
                bundle.StructureHash = (string)ct["structureHash"];
                bundle.ContentProject = (string)ct["project"];
            }

            var loc = (JObject)b["locales"];
            bundle.Locales.Default = (string)loc["default"];
            if (loc["included"] is JArray inc) foreach (var x in inc) bundle.Locales.Included.Add((string)x);

            if (b["cast"] is JArray cast)
                foreach (var c in cast)
                    bundle.Cast.Add(new Cast { Name = (string)c["name"], DisplayName = (string)c["displayName"] });

            if (b["properties"] is JArray props)
                foreach (var p in props) bundle.Properties.Add(PropDecl((JObject)p));

            if (b["strings"] is JObject strs) bundle.Strings = Strings(strs);

            if (b["gameDataFields"] is JObject gdf)
                foreach (var kind in gdf)
                {
                    var list = new List<GameDataField>();
                    foreach (var f in (JArray)kind.Value) list.Add(Field((JObject)f));
                    bundle.GameDataFields[kind.Key] = list;
                }

            foreach (var sc in (JObject)b["scenes"])
                bundle.Scenes[sc.Key] = ParseScene((JObject)sc.Value);

            return bundle;
        }

        private static Dictionary<string, Dictionary<string, string>> Strings(JObject e)
        {
            var outd = new Dictionary<string, Dictionary<string, string>>();
            foreach (var locale in e)
            {
                var table = new Dictionary<string, string>();
                foreach (var kv in (JObject)locale.Value) table[kv.Key] = (string)kv.Value;
                outd[locale.Key] = table;
            }
            return outd;
        }

        private static PatterValue ToValue(JToken t)
        {
            switch (t.Type)
            {
                case JTokenType.Boolean: return PatterValue.Bool((bool)t);
                case JTokenType.Integer:
                case JTokenType.Float: return PatterValue.Num((double)t);
                case JTokenType.String: return PatterValue.Str((string)t);
                case JTokenType.Array:
                {
                    var list = new List<string>();
                    foreach (var x in (JArray)t) list.Add((string)x);
                    return PatterValue.Flags(list);
                }
                default: throw new Exception($"unsupported value token: {t.Type}");
            }
        }

        private static GameData ParseGameData(JObject o)
        {
            var gd = new GameData();
            foreach (var p in o) gd[p.Key] = ToValue(p.Value);
            return gd;
        }

        private static PropertyDecl PropDecl(JObject p) => new PropertyDecl
        {
            Name = (string)p["name"],
            Type = (string)p["type"],
            Shared = (bool?)p["shared"],
            Temporary = (bool?)p["temporary"] ?? false,
            Default = p["default"] != null ? ToValue(p["default"]) : null,
            Values = p["values"] is JArray vs ? ToStringList(vs) : null,
        };

        private static GameDataField Field(JObject f) => new GameDataField
        {
            Name = (string)f["name"],
            Type = (string)f["type"],
            Default = f["default"] != null ? ToValue(f["default"]) : null,
            Values = f["values"] is JArray vs ? ToStringList(vs) : null,
        };

        private static List<string> ToStringList(JArray a)
        {
            var list = new List<string>();
            foreach (var x in a) list.Add((string)x);
            return list;
        }

        private static AstNode ParseAst(JArray e)
        {
            string tag = (string)e[0];
            switch (tag)
            {
                case "b": return new BoolNode { Value = (bool)e[1] };
                case "n": return new NumberNode { Value = (double)e[1] };
                case "s": return new StringNode { Value = (string)e[1] };
                case "sv": return new ScopedVar { Scope = (string)e[1], Name = (string)e[2] };
                case "u": return new Unary { Op = (string)e[1], Operand = ParseAst((JArray)e[2]) };
                case "bin": return new Binary { Op = (string)e[1], Left = ParseAst((JArray)e[2]), Right = ParseAst((JArray)e[3]) };
                case "fd": return new FlagDelta { Sign = (string)e[1], Name = (string)e[2] };
                case "call":
                {
                    var args = new List<AstNode>();
                    for (int i = 2; i < e.Count; i++) args.Add(ParseAst((JArray)e[i]));
                    return new Call { Name = (string)e[1], Args = args.ToArray() };
                }
                default: throw new Exception($"unknown ast tag: {tag}");
            }
        }

        private static Expression Expr(JToken e) => new Expression { Ast = ParseAst((JArray)e["ast"]) };

        private static List<Effect> Effects(JArray e)
        {
            var list = new List<Effect>();
            foreach (var x in e) list.Add(new Effect { Target = (string)x["target"], Value = Expr(x["value"]) });
            return list;
        }

        private static Scene ParseScene(JObject s)
        {
            var scene = new Scene { Id = (string)s["id"], Name = (string)s["name"] ?? "", GameId = (string)s["gameId"] };
            if (s["tags"] is JArray st) scene.Tags = ToStringList(st);
            if (s["sceneProps"] is JArray sp) foreach (var p in sp) scene.SceneProps.Add(PropDecl((JObject)p));
            if (s["onEntry"] is JArray oe) scene.OnEntry = Effects(oe);
            foreach (var blk in (JArray)s["blocks"]) scene.Blocks.Add(ParseBlock((JObject)blk));
            return scene;
        }

        private static Block ParseBlock(JObject b)
        {
            var block = new Block { Id = (string)b["id"], Name = (string)b["name"] ?? "", GameId = (string)b["gameId"] };
            if (b["tags"] is JArray bt) block.Tags = ToStringList(bt);
            if (b["children"] is JArray ch) foreach (var n in ch) block.Children.Add(ParseNode((JObject)n));
            return block;
        }

        private static Node ParseNode(JObject n)
        {
            var node = new Node { Id = (string)n["id"], Type = (string)n["type"] };
            if (n["condition"] != null) node.Condition = Expr(n["condition"]);
            if (n["onEnter"] is JArray oen) node.OnEnter = Effects(oen);
            if (n["onExit"] is JArray oex) node.OnExit = Effects(oex);
            if (n["gameData"] is JObject gd) node.GameData = ParseGameData(gd);
            if (n["tags"] is JArray nt) node.Tags = ToStringList(nt);

            if (node.IsGroup)
            {
                node.Selector = (string)n["selector"];
                node.Children = new List<Node>();
                if (n["children"] is JArray ch) foreach (var c in ch) node.Children.Add(ParseNode((JObject)c));
                if (n["prompt"] is JObject pr) node.Prompt = ParseBeat(pr);
                node.Sticky = (bool?)n["sticky"] ?? false;
                node.Fallback = (bool?)n["fallback"] ?? false;
                node.SecretUntilEligible = (bool?)n["secretUntilEligible"] ?? false;
                node.Shared = (bool?)n["shared"] ?? false;
                if (n["options"] is JObject op)
                    node.Options = new SelectorOptions { Order = (string)op["order"], Exhaust = (string)op["exhaust"] };
            }
            else
            {
                node.Beats = new List<Beat>();
                if (n["beats"] is JArray bts) foreach (var bt in bts) node.Beats.Add(ParseBeat((JObject)bt));
                if (n["jump"] is JObject jp) node.Jump = new Jump { To = (string)jp["to"], Mode = (string)jp["mode"] };
            }
            return node;
        }

        private static Beat ParseBeat(JObject b)
        {
            var beat = new Beat
            {
                Id = (string)b["id"],
                Kind = (string)b["kind"],
                Character = (string)b["character"],
                Direction = (string)b["direction"],
            };
            if (b["gameData"] is JObject gd) beat.GameData = ParseGameData(gd);
            if (b["tags"] is JArray bt) beat.Tags = ToStringList(bt);
            return beat;
        }
    }
}
