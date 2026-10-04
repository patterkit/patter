// Checkpoints: the host-surface half of the contract the conformance corpus pins (what a rollback puts
// back is there, on all four runtimes). Here: the calls refused while one is open, one at a time, a game's
// own `@world` store written back on rollback, a commit that keeps, and a live Flow.Restore that leaves the
// flow's property values alone. A port of the JS runtime's checkpoint.test.ts.

using System;
using System.Collections.Generic;
using System.Text.Json;
using Wildwinter.Expr;

namespace Patterkit.Patterplay.TestHost
{
    internal static partial class Program
    {
        // The JS test's fixture, as its compiler exports it: one snippet whose onEnter bumps a shared global
        // (@count), a per-flow one (@mine), and a host-scope one (@world.alarms).
        private const string CheckpointBundleJson = @"{""schema"":""patter/bundle@0"",""content"":{""project"":""p"",""hash"":""047m1yw"",""structureHash"":""0hk3ngd""},""voiced"":false,""locales"":{""default"":""en"",""included"":[""en""]},""properties"":[{""name"":""count"",""type"":""number"",""default"":0},{""name"":""mine"",""type"":""number"",""default"":0,""shared"":false}],""scopeRegistry"":{""version"":1,""scopes"":[{""token"":""world"",""declarations"":[{""name"":""alarms"",""type"":""number"",""default"":0}]}]},""scenes"":{""s"":{""id"":""s"",""type"":""scene"",""name"":""S"",""gameId"":""s"",""blocks"":[{""id"":""b"",""type"":""block"",""name"":""B"",""children"":[{""id"":""sn"",""type"":""snippet"",""beats"":[{""id"":""T"",""kind"":""text""}],""onEnter"":[{""kind"":""set"",""target"":""@count"",""value"":{""src"":""@count + 1"",""ast"":[""bin"",""+"",[""sv"",""patter"",""count""],[""n"",1]]}},{""kind"":""set"",""target"":""@mine"",""value"":{""src"":""@mine + 1"",""ast"":[""bin"",""+"",[""sv"",""patter"",""mine""],[""n"",1]]}},{""kind"":""set"",""target"":""@world.alarms"",""value"":{""src"":""@world.alarms + 1"",""ast"":[""bin"",""+"",[""sv"",""world"",""alarms""],[""n"",1]]}}]},{""id"":""sn2"",""type"":""snippet"",""beats"":[{""id"":""T2"",""kind"":""text""}],""jump"":{""to"":""END""}}]}]}},""strings"":{""en"":{""T"":""t"",""T2"":""t2""}}}";

        private static void RunCheckpointChecks()
        {
            int before = _fails;
            Bundle bundle;
            using (var doc = JsonDocument.Parse(CheckpointBundleJson)) bundle = ParseBundle(doc.RootElement);

            // Throws, with a message containing `want`.
            void Refused(string what, Action act, string want)
            {
                string message = null;
                try { act(); } catch (Exception e) { message = e.Message; }
                Check($"checkpoint: {what}", message != null && message.Contains(want), message ?? "no error");
            }
            double Num(ExprValue v) => v == null ? double.NaN : v.AsNumber;

            // One at a time, and only the open one can be closed.
            {
                var engine = new Engine(bundle);
                var cp = engine.Checkpoint();
                Check("checkpoint: InCheckpoint while open", engine.InCheckpoint, "false");
                Refused("a second checkpoint", () => engine.Checkpoint(), "already open");
                engine.Commit(cp);
                Check("checkpoint: InCheckpoint after commit", !engine.InCheckpoint, "true");
                Refused("a rollback of a closed checkpoint", () => engine.Rollback(cp), "not the open one");
            }

            // The calls a rollback couldn't undo are refused.
            {
                var engine = new Engine(bundle);
                var flow = engine.OpenFlow("f", "s");
                var snap = flow.Snapshot();
                var cp = engine.Checkpoint();
                Refused("Reset", () => engine.Reset(), "checkpoint");
                Refused("CloseFlow", () => engine.CloseFlow("f"), "checkpoint");
                Refused("LoadGame", () => engine.LoadGame(engine.SaveGame()), "checkpoint");
                Refused("HotSwap", () => engine.HotSwap(bundle), "checkpoint");
                Refused("OpenFlow over an open flow", () => engine.OpenFlow("f", "s"), "checkpoint");
                Refused("Flow.Reset", () => flow.Reset(), "checkpoint");
                Refused("Flow.Restore", () => flow.Restore(snap), "checkpoint");
                engine.Rollback(cp);
                Check("checkpoint: the refused calls left the flow in place", engine.GetFlow("f") == flow, "a different flow");
            }

            // A game's own @world store is written back on rollback; a commit keeps everything.
            {
                var store = new RecordingScope();
                store.Values["alarms"] = ExprValue.Num(0);
                var engine = new Engine(bundle, new EngineOptions { HostScopes = new Dictionary<string, IHostScope> { ["world"] = store } });
                var cp = engine.Checkpoint();
                engine.OpenFlow("f", "s").Advance();
                Check("checkpoint: the step wrote the game's store", Num(store.Values["alarms"]) == 1, $"{Num(store.Values["alarms"])}");
                engine.Rollback(cp);
                Check("checkpoint: rollback wrote the game's store back", Num(store.Values["alarms"]) == 0, $"{Num(store.Values["alarms"])}");
                Check("checkpoint: rollback put @count back", Num(engine.GetProperty("@count")) == 0, $"{Num(engine.GetProperty("@count"))}");
                Check("checkpoint: rollback closed the flow opened inside it", engine.GetFlow("f") == null, "still open");

                cp = engine.Checkpoint();
                engine.OpenFlow("f", "s").Advance();
                engine.Commit(cp);
                Check("checkpoint: commit kept the game's store", Num(store.Values["alarms"]) == 1, $"{Num(store.Values["alarms"])}");
                Check("checkpoint: commit kept @count", Num(engine.GetProperty("@count")) == 1, $"{Num(engine.GetProperty("@count"))}");
                Check("checkpoint: commit kept the flow's @mine", Num(engine.GetFlow("f")?.GetProperty("@mine")) == 1,
                    $"{Num(engine.GetFlow("f")?.GetProperty("@mine"))}");
            }

            // A live Flow.Restore keeps the flow's own property values: a snapshot holds the cursor, not the values.
            {
                var engine = new Engine(bundle);
                var flow = engine.OpenFlow("f", "s");
                var snap = flow.Snapshot();
                flow.Advance();
                Check("checkpoint: @mine moved", Num(flow.GetProperty("@mine")) == 1, $"{Num(flow.GetProperty("@mine"))}");
                flow.Restore(snap);
                Check("checkpoint: a live Restore kept @mine", Num(flow.GetProperty("@mine")) == 1, $"{Num(flow.GetProperty("@mine"))}");
            }

            if (_fails == before) Console.WriteLine("  [checkpoint] refusals, one at a time, @world written back, commit keeps, live Restore keeps values");
            RunCheckpointTiming();
        }

        /// <summary>Informational, never a gate: what a checkpoint costs a flow with a long history. A flow
        /// that has visited ~10,000 nodes barks 10,000 times (Goto + Advance), bare and then inside
        /// Checkpoint + Rollback. A checkpoint records changes as they happen, so the difference should not
        /// grow with the history.</summary>
        private static void RunCheckpointTiming()
        {
            const int history = 10000, runs = 10000;
            var b = new Bundle { Schema = "patter/bundle@0" };
            b.Locales.Default = "en";
            b.Locales.Included.Add("en");
            b.Strings["en"] = new Dictionary<string, string> { ["BARK"] = "bark" };
            var scene = new Scene { Id = "s", GameId = "s" };
            var longBlock = new Block { Id = "long", GameId = "long", Children = new List<Node>() };
            for (int i = 0; i < history; i++)
                longBlock.Children.Add(new Node { Id = "n" + i, Type = "snippet", Beats = new List<Beat> { new Beat { Id = "B" + i, Kind = "text" } } });
            scene.Blocks.Add(longBlock);
            scene.Blocks.Add(new Block { Id = "bark", GameId = "bark", Children = new List<Node>
            {
                new Node { Id = "sn_bark", Type = "snippet", Beats = new List<Beat> { new Beat { Id = "BARK", Kind = "text" } }, Jump = new Jump { To = "END" } },
            } });
            b.Scenes["s"] = scene;

            var engine = new Engine(b);
            var flow = engine.OpenFlow("f", "s", "long");
            for (int i = 0; i < history; i++) flow.Advance();
            int visited = flow.Snapshot().Visits.Count;

            double Time(bool checkpoint)
            {
                var sw = System.Diagnostics.Stopwatch.StartNew();
                for (int i = 0; i < runs; i++)
                {
                    var cp = checkpoint ? engine.Checkpoint() : null;
                    flow.Goto("s", "bark");
                    flow.Advance();
                    if (checkpoint) engine.Rollback(cp);
                }
                sw.Stop();
                return sw.Elapsed.TotalMilliseconds * 1000.0 / runs;
            }
            Time(false); Time(true); // warm up the JIT
            double bare = Time(false), withCp = Time(true);
            Console.WriteLine($"  [checkpoint timing] flow with {visited} visited nodes, {runs} barks: "
                + $"bare {bare:F2} us, with checkpoint + rollback {withCp:F2} us (+{withCp - bare:F2} us each; informational)");
        }
    }
}
