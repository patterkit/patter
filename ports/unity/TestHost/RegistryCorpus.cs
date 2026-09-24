// GENERATED - vendored from expr/ports/unity/testing/RegistryCorpus.cs by scripts/vendor-ports.mjs.
// Do not edit here; edit the shared source and re-run the script.
// ---------------------------------------------------------------------------
// The registry corpus runner, for C#. THE SHARED SOURCE. Test code: vendored into
// each family's dotnet TestHost, never into a shipped package.
//
// Authored in expr/ports/unity/testing and VENDORED by expr/scripts/vendor-ports.mjs.
// Do not edit a vendored copy.
//
// Runs packages/scoperegistry/corpus.json (each family carries it as
// packages/conformance/registry-corpus.json) through the shared ScopeRegistry. It is
// a port of the NORMATIVE interpreter, expr/packages/scoperegistry/test/corpus/runner.ts:
// each step means here exactly what it means there, including the corpus dialect,
// the substring rule for expected errors, the foreign scopes' backing maps, and
// value equality (flags compared in order, objects by key set, unset distinct from
// JSON null). If this does something the reference runner does not, it is testing
// something else.
//
// One deliberate strictness the reference does not need: a step whose op this runner
// does not know is a failure, because a corpus newer than its runner is a check that
// cannot fail here. So is a missing or unreadable corpus file.
//
//   var result = RegistryCorpus.Run(path);   // Passed, Total, Failures
// ---------------------------------------------------------------------------

using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.Json;

namespace Patterkit.Patterplay.TestHost
{
    /// <summary>What a run of the registry corpus found: cases passed, cases run, and
    /// every failure (each names its case and step).</summary>
    public sealed class RegistryCorpusResult
    {
        public int Passed;
        public int Total;
        public readonly List<string> Failures = new List<string>();
    }

    public static class RegistryCorpus
    {
        /// <summary>The dialect the corpus is compiled with and the reference evaluates
        /// with. No functions: a case exercises the registry's scope resolution and
        /// quality ladders, both of which the evaluator's core handles alone.</summary>
        public static Dialect CorpusDialect()
        {
            var d = new Dialect { DefaultScope = "game" };
            foreach (var token in new[] { "game", "world", "here", "a", "b" }) d.Scopes.Add(new ScopeDef { Token = token });
            return d;
        }

        /// <summary>Run every case in the corpus at `path`. A missing or unreadable
        /// file is a failure, not a skip.</summary>
        public static RegistryCorpusResult Run(string path)
        {
            var result = new RegistryCorpusResult();
            if (path == null || !File.Exists(path))
            {
                result.Failures.Add($"registry corpus not found: {path ?? "<no path>"}");
                return result;
            }
            object root;
            try
            {
                using (var doc = JsonDocument.Parse(File.ReadAllText(path))) root = Tree(doc.RootElement);
            }
            catch (Exception ex)
            {
                result.Failures.Add($"registry corpus unreadable: {path}: {ex.Message}");
                return result;
            }
            if (!(root is OrderedMap<string, object> corpus) || !(corpus.GetOrDefault("cases") is List<object> cases))
            {
                result.Failures.Add($"registry corpus has no cases: {path}");
                return result;
            }
            foreach (var c in cases)
            {
                result.Total++;
                List<string> fails;
                try
                {
                    fails = RunCase((OrderedMap<string, object>)c);
                }
                catch (Exception ex)
                {
                    fails = new List<string> { $"{NameOf(c)}: the runner itself failed: {ex.Message}" };
                }
                if (fails.Count == 0) result.Passed++;
                else result.Failures.AddRange(fails);
            }
            if (result.Total == 0) result.Failures.Add($"registry corpus has no cases: {path}");
            return result;
        }

        private static string NameOf(object c) =>
            (c as OrderedMap<string, object>)?.GetOrDefault("name") as string ?? "<unnamed case>";

        /// <summary>One case: a fresh registry, then its steps in order. Returns every
        /// failure (empty means pass), so one run reports every divergence in a case
        /// rather than stopping at the first.</summary>
        public static List<string> RunCase(OrderedMap<string, object> c)
        {
            var fails = new List<string>();
            var r = new ScopeRegistry();
            var stores = new Dictionary<string, OrderedMap<string, PatterValue>>();
            string caseName = NameOf(c);
            var steps = (List<object>)c.GetOrDefault("steps");

            // Run `fn`. With `want`, it must throw a message containing `want`; without,
            // it must not throw. Returns true when it ran without throwing.
            bool Attempt(string at, string want, Action fn)
            {
                try
                {
                    fn();
                }
                catch (Exception e)
                {
                    if (want == null) fails.Add($"{at}: unexpected error: {e.Message}");
                    else if (!e.Message.Contains(want)) fails.Add($"{at}: error \"{e.Message}\" does not say \"{want}\"");
                    return false;
                }
                if (want != null) fails.Add($"{at}: expected an error saying \"{want}\", none was raised");
                return true;
            }

            for (int i = 0; i < steps.Count; i++)
            {
                var step = (OrderedMap<string, object>)steps[i];
                string op = Str(step, "op");
                string at = $"{caseName} [step {i + 1}: {op}]";
                string expectError = Str(step, "expectError");
                switch (op)
                {
                    case "owned":
                    {
                        var options = new OwnedScopeOptions
                        {
                            PathPrefix = Str(step, "pathPrefix"),
                            Normalise = Str(step, "normalise") == "identity" ? Identity : null,
                            Owner = Str(step, "owner"),
                        };
                        Attempt(at, expectError, () => r.DefineOwned(Str(step, "token"), Decls(step), options));
                        break;
                    }

                    case "mount":
                    {
                        // The RUNNER builds the bag (prefix default ""), as an engine mounts
                        // an instance bag it holds.
                        var bag = new PropertyBag(Decls(step), Str(step, "normalise") == "identity" ? Identity : null,
                            Str(step, "pathPrefix") ?? "");
                        Attempt(at, expectError, () => r.MountOwned(Str(step, "token"), bag, Str(step, "owner")));
                        break;
                    }

                    case "foreign":
                    {
                        var store = new OrderedMap<string, PatterValue>();
                        if (step.GetOrDefault("store") is OrderedMap<string, object> seed)
                        {
                            foreach (var pair in seed) store.Set(pair.Key, ToValue(pair.Value));
                        }
                        var resolver = new MapResolver(store, !(step.GetOrDefault("settable") is bool settable) || settable);
                        var options = new ForeignScopeOptions
                        {
                            Writable = step.GetOrDefault("writable") as bool?,
                            Normalise = Str(step, "normalise") == "identity" ? Identity : null,
                            Owner = Str(step, "owner"),
                        };
                        string token = Str(step, "token");
                        bool ok = Attempt(at, expectError, () => r.DefineForeign(token, resolver, Decls(step), options));
                        if (ok) stores[token] = store;
                        break;
                    }

                    case "set":
                    {
                        var value = ToValue(step.GetOrDefault("value"));
                        bool host = step.GetOrDefault("host") is bool h && h;
                        Attempt(at, expectError, () => r.Set(Str(step, "scope"), Str(step, "name"), value, host));
                        break;
                    }

                    case "get":
                    {
                        var got = Neutral(r.Get(Str(step, "scope"), Str(step, "name")));
                        if (step.GetOrDefault("expectUnset") is bool unset && unset)
                        {
                            if (got != Unset) fails.Add($"{at}: expected unset, got {Show(got)}");
                        }
                        else
                        {
                            var want = Expected(step, "expect");
                            if (!Same(got, want)) fails.Add($"{at}: got {Show(got)}, expected {Show(want)}");
                        }
                        break;
                    }

                    case "has":
                    {
                        bool want = (bool)step.GetOrDefault("expect");
                        string token = Str(step, "token");
                        if (r.Has(token) != want) fails.Add($"{at}: has('{token}') is {Js(!want)}, expected {Js(want)}");
                        break;
                    }

                    case "remove":
                    {
                        bool keep = step.GetOrDefault("keep") is bool k && k;
                        Attempt(at, expectError, () => r.Remove(Str(step, "token"), keep));
                        break;
                    }

                    case "save":
                    {
                        var got = NeutralBlob(r.Save());
                        var want = Expected(step, "expect");
                        if (!Same(got, want)) fails.Add($"{at}: saved {Show(got)}, expected {Show(want)}");
                        break;
                    }

                    case "load":
                    {
                        var blob = ToBlob(step.GetOrDefault("blob"));
                        bool keepParked = step.GetOrDefault("keepParked") is bool kp && kp;
                        Attempt(at, null, () => r.Load(blob, keepParked));
                        break;
                    }

                    case "discardParked":
                        r.DiscardParked(Str(step, "prefix"));
                        break;

                    case "revision":
                    {
                        double want = (double)step.GetOrDefault("expect");
                        if (r.Revision != want) fails.Add($"{at}: revision is {r.Revision}, expected {Show(want)}");
                        break;
                    }

                    case "store":
                    {
                        object got = stores.TryGetValue(Str(step, "scope"), out var store) ? NeutralMap(store) : Unset;
                        var want = Expected(step, "expect");
                        if (!Same(got, want)) fails.Add($"{at}: the game's store holds {Show(got)}, expected {Show(want)}");
                        break;
                    }

                    case "rows":
                    {
                        var got = new List<object>();
                        foreach (var row in r.ListProperties())
                        {
                            var m = new OrderedMap<string, object>();
                            m.Set("scope", row.Scope);
                            if (row.Owner != null) m.Set("owner", row.Owner);
                            m.Set("name", row.Name);
                            m.Set("path", row.Path);
                            m.Set("value", Neutral(row.Value));
                            m.Set("writable", row.Writable);
                            got.Add(m);
                        }
                        var want = Expected(step, "expect");
                        if (!Same(got, want)) fails.Add($"{at}: rows {Show(got)}, expected {Show(want)}");
                        break;
                    }

                    case "eval":
                    {
                        if (!(step.GetOrDefault("ast") is List<object> ast))
                        {
                            fails.Add($"{at}: no compiled ast (the corpus was not built)");
                            break;
                        }
                        List<KeyValuePair<string, string>> aliases = null;
                        if (step.GetOrDefault("aliases") is OrderedMap<string, object> aliasMap)
                        {
                            aliases = new List<KeyValuePair<string, string>>();
                            foreach (var pair in aliasMap) aliases.Add(new KeyValuePair<string, string>(pair.Key, (string)pair.Value));
                        }
                        object got = Unset;
                        bool ok = Attempt(at, expectError, () =>
                        {
                            var ctx = r.ToEvalContext(null, aliases);
                            got = Neutral(Expr.Evaluate(Ast.DeserialiseAst(ast), ctx, CorpusDialect()));
                        });
                        if (ok && expectError == null)
                        {
                            var want = Expected(step, "expect");
                            if (!Same(got, want)) fails.Add($"{at}: {Str(step, "src")} is {Show(got)}, expected {Show(want)}");
                        }
                        break;
                    }

                    case "spec":
                    {
                        ScopeRegistrySpec spec = null;
                        bool ok = Attempt(at, expectError, () => { spec = ScopeRegistry.ReadScopeRegistrySpec(step.GetOrDefault("source")); });
                        if (!ok || expectError != null) break;
                        if (step.GetOrDefault("expectAbsent") is bool absent && absent)
                        {
                            if (spec != null) fails.Add($"{at}: expected no spec, got one");
                        }
                        else if (spec == null)
                        {
                            fails.Add($"{at}: expected a spec, got none");
                        }
                        else
                        {
                            var summary = new OrderedMap<string, object>();
                            summary.Set("version", (double)spec.Version);
                            var tokens = new List<object>();
                            foreach (var s in spec.Scopes) tokens.Add(s.Token);
                            summary.Set("tokens", tokens);
                            var want = Expected(step, "expect");
                            if (!Same(summary, want)) fails.Add($"{at}: read {Show(summary)}, expected {Show(want)}");
                        }
                        break;
                    }

                    default:
                        fails.Add($"{at}: unknown step op '{op}' (a corpus newer than this runner)");
                        break;
                }
            }
            return fails;
        }

        // -- the corpus's own values ------------------------------------------------

        /// <summary>The reference's `undefined`: a scope or property that is not there.
        /// Distinct from JSON null, exactly as `undefined !== null` in the
        /// reference.</summary>
        private static readonly object Unset = new object();

        private static readonly Func<string, string> Identity = n => n;

        /// <summary>A foreign scope over a plain map the runner keeps. Without a setter
        /// (`settable: false`) it refuses every write, for everyone.</summary>
        private sealed class MapResolver : IScopeResolver
        {
            private readonly OrderedMap<string, PatterValue> _store;
            public MapResolver(OrderedMap<string, PatterValue> store, bool canSet) { _store = store; CanSet = canSet; }
            public bool CanSet { get; }
            public PatterValue Get(string name) => _store.GetOrDefault(name);
            public void Set(string name, PatterValue value)
            {
                if (!CanSet) throw new InvalidOperationException("this resolver has no set");
                _store.Set(name, value);
            }
        }

        private static string Str(OrderedMap<string, object> m, string key) => m.GetOrDefault(key) as string;

        /// <summary>A step's expectation, or Unset when the step carries none.</summary>
        private static object Expected(OrderedMap<string, object> step, string key) =>
            step.ContainsKey(key) ? step.GetOrDefault(key) : Unset;

        /// <summary>A step's declarations, fresh for each registration.</summary>
        private static List<ScopeDeclaration> Decls(OrderedMap<string, object> step)
        {
            var list = new List<ScopeDeclaration>();
            if (!(step.GetOrDefault("declarations") is List<object> ds)) return list;
            foreach (OrderedMap<string, object> d in ds)
            {
                list.Add(new ScopeDeclaration
                {
                    Name = Str(d, "name"),
                    Type = Str(d, "type"),
                    Default = d.ContainsKey("default") ? ToValue(d.GetOrDefault("default")) : null,
                    Values = Strings(d.GetOrDefault("values")),
                    Stages = Strings(d.GetOrDefault("stages")),
                    Writable = d.GetOrDefault("writable") as bool?,
                });
            }
            return list;
        }

        private static List<string> Strings(object node)
        {
            if (!(node is List<object> items)) return null;
            var list = new List<string>();
            foreach (var item in items) list.Add((string)item);
            return list;
        }

        /// <summary>A corpus scalar as a runtime value. The corpus carries only the
        /// four kinds, so anything else is a malformed corpus and says so.</summary>
        private static PatterValue ToValue(object node)
        {
            switch (node)
            {
                case bool b: return PatterValue.Bool(b);
                case double n: return PatterValue.Num(n);
                case string s: return PatterValue.Str(s);
                case List<object> items: return PatterValue.Flags(Strings(items));
                default: throw new InvalidOperationException($"not a corpus value: {Show(node)}");
            }
        }

        private static OrderedMap<string, OrderedMap<string, PatterValue>> ToBlob(object node)
        {
            var blob = new OrderedMap<string, OrderedMap<string, PatterValue>>();
            foreach (var section in (OrderedMap<string, object>)node)
            {
                var values = new OrderedMap<string, PatterValue>();
                foreach (var pair in (OrderedMap<string, object>)section.Value) values.Set(pair.Key, ToValue(pair.Value));
                blob.Set(section.Key, values);
            }
            return blob;
        }

        /// <summary>A runtime value in the corpus's own terms: null (the registry's
        /// "not there") becomes Unset.</summary>
        private static object Neutral(PatterValue v)
        {
            if (v == null) return Unset;
            if (v.IsBool) return v.AsBool;
            if (v.IsNumber) return v.AsNumber;
            if (v.IsString) return v.AsString;
            var list = new List<object>();
            foreach (var f in v.AsFlags) list.Add(f);
            return list;
        }

        private static OrderedMap<string, object> NeutralMap(OrderedMap<string, PatterValue> values)
        {
            var m = new OrderedMap<string, object>();
            foreach (var pair in values) m.Set(pair.Key, Neutral(pair.Value));
            return m;
        }

        private static OrderedMap<string, object> NeutralBlob(OrderedMap<string, OrderedMap<string, PatterValue>> blob)
        {
            var m = new OrderedMap<string, object>();
            foreach (var pair in blob) m.Set(pair.Key, NeutralMap(pair.Value));
            return m;
        }

        /// <summary>A JSON element as the neutral tree the shared Ast deserialiser and
        /// ReadScopeRegistrySpec take: objects as OrderedMap&lt;string, object&gt; in
        /// document order, arrays as List&lt;object&gt;, numbers as double.</summary>
        public static object Tree(JsonElement e)
        {
            switch (e.ValueKind)
            {
                case JsonValueKind.Object:
                {
                    var m = new OrderedMap<string, object>();
                    foreach (var p in e.EnumerateObject()) m.Set(p.Name, Tree(p.Value));
                    return m;
                }
                case JsonValueKind.Array:
                {
                    var list = new List<object>();
                    foreach (var item in e.EnumerateArray()) list.Add(Tree(item));
                    return list;
                }
                case JsonValueKind.String: return e.GetString();
                case JsonValueKind.Number: return e.GetDouble();
                case JsonValueKind.True: return true;
                case JsonValueKind.False: return false;
                default: return null;
            }
        }

        /// <summary>The reference's `same`: lists element-wise IN ORDER (a saved flag
        /// list must come back as it went), objects by key set, everything else by
        /// strict equality, with Unset equal only to itself.</summary>
        public static bool Same(object a, object b)
        {
            if (a is List<object> || b is List<object>)
            {
                if (!(a is List<object> la) || !(b is List<object> lb) || la.Count != lb.Count) return false;
                for (int i = 0; i < la.Count; i++) if (!Same(la[i], lb[i])) return false;
                return true;
            }
            if (a is OrderedMap<string, object> ma && b is OrderedMap<string, object> mb)
            {
                if (ma.Count != mb.Count) return false;
                foreach (var pair in ma)
                {
                    if (!mb.ContainsKey(pair.Key) || !Same(pair.Value, mb.GetOrDefault(pair.Key))) return false;
                }
                return true;
            }
            if (a == null || b == null) return a == null && b == null;
            if (a == Unset || b == Unset) return a == b;
            if (a is double da && b is double db) return da == db;
            if (a is string sa && b is string sb) return sa == sb;
            if (a is bool ba && b is bool bb) return ba == bb;
            return false;
        }

        private static string Js(bool b) => b ? "true" : "false";

        /// <summary>The reference's `show`: `&lt;unset&gt;` for Unset, else JSON.</summary>
        public static string Show(object v)
        {
            if (v == Unset) return "<unset>";
            var sb = new StringBuilder();
            Write(sb, v);
            return sb.ToString();
        }

        private static void Write(StringBuilder sb, object v)
        {
            switch (v)
            {
                case null: sb.Append("null"); return;
                case bool b: sb.Append(Js(b)); return;
                case double n: sb.Append(PatterValue.JsNumber(n)); return;
                case string s: sb.Append(PatterValue.JsonQuote(s)); return;
                case List<object> list:
                    sb.Append('[');
                    for (int i = 0; i < list.Count; i++)
                    {
                        if (i > 0) sb.Append(',');
                        Write(sb, list[i]);
                    }
                    sb.Append(']');
                    return;
                case OrderedMap<string, object> map:
                {
                    sb.Append('{');
                    bool first = true;
                    foreach (var pair in map)
                    {
                        // JSON.stringify drops an undefined member, and so does this.
                        if (pair.Value == Unset) continue;
                        if (!first) sb.Append(',');
                        first = false;
                        sb.Append(PatterValue.JsonQuote(pair.Key)).Append(':');
                        Write(sb, pair.Value);
                    }
                    sb.Append('}');
                    return;
                }
                default:
                    if (v == Unset) { sb.Append("null"); return; }
                    sb.Append(Convert.ToString(v, CultureInfo.InvariantCulture));
                    return;
            }
        }
    }
}
