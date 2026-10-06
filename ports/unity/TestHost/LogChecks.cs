// The corpus's decision-log cases. Each is played as a runtime case is, with the log on, and the live tap
// is held to it: OnTrace must hand over exactly the decisions the log keeps, in order, with the log on and
// with it off, and none once unsubscribed.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Wildwinter.Expr;

namespace Patterkit.Patterplay.TestHost
{
    internal static partial class Program
    {
        private static int RunLogs(JsonElement arr)
        {
            int pass = 0;
            foreach (var c in arr.EnumerateArray())
            {
                string name = c.GetProperty("name").GetString();
                try
                {
                    var on = PlayLogCase(c, true);
                    var off = PlayLogCase(c, false);
                    var logged = on.Log.Select(TraceKey).ToList();
                    var shaped = on.Log.Select(e => (object)LogEntryToObject(e)).ToList();
                    if (!MatchArray(shaped, c.GetProperty("expectedLog")))
                        Fail("logs", name, $"log mismatch\n    expected {c.GetProperty("expectedLog")}\n    got      {Dump(shaped)}");
                    else if (!on.Traced.SequenceEqual(logged))
                        Fail("logs", name, $"OnTrace with the log on handed over {on.Traced.Count} decisions, the log kept {logged.Count}, or they differ");
                    else if (!off.Traced.SequenceEqual(logged))
                        Fail("logs", name, $"OnTrace with the log off handed over {off.Traced.Count} decisions, the log kept {logged.Count}, or they differ");
                    else if (on.AfterStop != 0)
                        Fail("logs", name, "a handler was called after its unsubscribe");
                    else pass++;
                }
                catch (Exception ex) { Fail("logs", name, ex.Message); }
            }
            return pass;
        }

        private sealed class LogRun
        {
            public List<LogEntry> Log;
            public List<string> Traced;
            public int AfterStop;
        }

        private static LogRun PlayLogCase(JsonElement c, bool log)
        {
            var opts = new EngineOptions { Log = log };
            if (c.TryGetProperty("seed", out var seed)) opts.Rng = new Mulberry32(seed.GetInt64()).Next;
            var engine = new Engine(_loader(c.GetProperty("bundle")), opts);
            var traced = new List<string>();
            var stop = engine.OnTrace((id, e) => traced.Add(id == e.Flow ? TraceKey(e) : $"handed over as {id}, entry says {e.Flow}"));
            var start = c.GetProperty("start");
            var flow = engine.OpenFlow("main", start.GetProperty("scene").GetString(),
                start.TryGetProperty("block", out var bl) ? bl.GetString() : null);
            var scripted = c.TryGetProperty("choices", out var ch)
                ? new Queue<string>(ch.EnumerateArray().Select(x => x.GetString())) : new Queue<string>();
            for (int i = 0; i < 200; i++)
            {
                var step = flow.Advance();
                if (step.Type == StepType.End) break;
                if (step.Type == StepType.Choice)
                {
                    string pick = scripted.Count > 0 ? scripted.Dequeue() : step.Options.FirstOrDefault(o => o.Eligible)?.Id;
                    if (pick == null) break;
                    flow.Choose(pick);
                }
            }
            stop();
            int before = traced.Count;
            engine.OpenFlow("later", start.GetProperty("scene").GetString()).Advance();
            return new LogRun { Log = engine.Log().Where(e => e.Flow == "main").ToList(), Traced = traced, AfterStop = traced.Count - before };
        }

        /// <summary>One decision as a comparable string: every field but Seq, which only a retained entry has.</summary>
        private static string TraceKey(LogEntry e)
        {
            var o = LogEntryToObject(e);
            o.Remove("seq");
            return Dump(o);
        }

        /// <summary>An entry as the reference writes it: its type's fields under the JS names, an absent field
        /// absent, and a select's Picked present even when null.</summary>
        private static Dictionary<string, object> LogEntryToObject(LogEntry e)
        {
            var o = new Dictionary<string, object> { ["type"] = e.Type };
            if (e.Flow != null) o["flow"] = e.Flow;
            o["seq"] = (double)e.Seq;
            if (e.Scene != null) o["scene"] = e.Scene;
            List<object> Verdicts(List<(string Id, bool Eligible)> list) =>
                list.Select(x => (object)new Dictionary<string, object> { ["id"] = x.Id, ["eligible"] = x.Eligible }).ToList();
            switch (e.Type)
            {
                case "select":
                    o["group"] = e.Group; o["selector"] = e.Selector;
                    if (e.Order != null) o["order"] = e.Order;
                    if (e.Exhaust != null) o["exhaust"] = e.Exhaust;
                    o["children"] = Verdicts(e.Children); o["picked"] = e.Picked;
                    break;
                case "choice": o["group"] = e.Group; o["options"] = Verdicts(e.Options); break;
                case "chose": o["group"] = e.Group; o["option"] = e.Option; break;
                case "dry": o["group"] = e.Group; break;
                case "jump": o["to"] = e.To; o["mode"] = e.Mode; break;
                case "write":
                    o["target"] = e.Target; o["value"] = ValueToObject(e.Value);
                    if (e.Prev != null) o["prev"] = ValueToObject(e.Prev);
                    break;
                case "diagnostic":
                    o["kind"] = e.Kind; o["node"] = e.Node;
                    if (e.Source != null) o["source"] = e.Source;
                    o["message"] = e.Message;
                    break;
            }
            return o;
        }
    }
}
