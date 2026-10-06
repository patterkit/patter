// The corpus's describe cases: what BundleInfo.DescribeBundle says about a bundle, held field for field to
// the reference's description (the same names, the same order, and an absent field absent).

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;

namespace Patterkit.Patterplay.TestHost
{
    internal static partial class Program
    {
        private static int RunDescribes(JsonElement arr)
        {
            int pass = 0;
            foreach (var c in arr.EnumerateArray())
            {
                string name = c.GetProperty("name").GetString();
                try
                {
                    var got = DescriptionToObject(BundleInfo.DescribeBundle(_loader(c.GetProperty("bundle"))));
                    if (MatchObject(got, c.GetProperty("expected"))) pass++;
                    else Fail("describes", name, $"description mismatch\n    expected {c.GetProperty("expected")}\n    got      {Dump(got)}");
                }
                catch (Exception ex) { Fail("describes", name, ex.Message); }
            }
            return pass;
        }

        private static Dictionary<string, object> DescriptionToObject(BundleDescription d)
        {
            var id = new Dictionary<string, object> { ["schema"] = d.Identity.Schema, ["project"] = d.Identity.Project };
            if (d.Identity.Version != null) id["version"] = d.Identity.Version;
            if (d.Identity.Hash != null) id["hash"] = d.Identity.Hash;
            if (d.Identity.StructureHash != null) id["structureHash"] = d.Identity.StructureHash;
            id["voiced"] = d.Identity.Voiced;
            id["defaultLocale"] = d.Identity.DefaultLocale;
            id["locales"] = d.Identity.Locales.Cast<object>().ToList();
            id["localisation"] = d.Identity.Localisation;
            id["sourceDebug"] = d.Identity.SourceDebug;
            object Prop(PropertySummary p)
            {
                var o = new Dictionary<string, object> { ["name"] = p.Name, ["type"] = p.Type, ["hasDefault"] = p.HasDefault };
                if (p.Default != null) o["default"] = ValueToObject(p.Default);
                o["shared"] = p.Shared;
                return o;
            }
            return new Dictionary<string, object>
            {
                ["identity"] = id,
                ["addresses"] = d.Addresses.Select(a => (object)new Dictionary<string, object>
                {
                    ["gameId"] = a.GameId, ["name"] = a.Name,
                    ["blocks"] = a.Blocks.Select(b => (object)new Dictionary<string, object> { ["gameId"] = b.GameId, ["name"] = b.Name }).ToList(),
                }).ToList(),
                ["hostScopes"] = d.HostScopes.Select(h => (object)new Dictionary<string, object>
                {
                    ["token"] = h.Token, ["writable"] = h.Writable, ["opaque"] = h.Opaque, ["properties"] = h.Properties.Select(Prop).ToList(),
                }).ToList(),
                ["properties"] = new Dictionary<string, object>
                {
                    ["patter"] = d.Properties.Patter.Select(Prop).ToList(),
                    ["scene"] = d.Properties.Scene.Select(s => (object)new Dictionary<string, object>
                    {
                        ["gameId"] = s.GameId, ["properties"] = s.Properties.Select(Prop).ToList(),
                    }).ToList(),
                },
                ["gameData"] = d.GameData.Select(g => (object)new Dictionary<string, object>
                {
                    ["kind"] = g.Kind,
                    ["fields"] = g.Fields.Select(f =>
                    {
                        var o = new Dictionary<string, object> { ["name"] = f.Name, ["type"] = f.Type, ["hasDefault"] = f.HasDefault };
                        if (f.Values != null) o["values"] = f.Values.Cast<object>().ToList();
                        if (f.Purpose != null) o["purpose"] = f.Purpose;
                        return (object)o;
                    }).ToList(),
                }).ToList(),
                ["counts"] = new Dictionary<string, object>
                {
                    ["scenes"] = (double)d.Counts.Scenes, ["blocks"] = (double)d.Counts.Blocks, ["groups"] = (double)d.Counts.Groups,
                    ["snippets"] = (double)d.Counts.Snippets, ["beats"] = (double)d.Counts.Beats, ["prompts"] = (double)d.Counts.Prompts,
                    ["gameEvents"] = (double)d.Counts.GameEvents, ["cast"] = (double)d.Counts.Cast,
                },
            };
        }
    }
}
