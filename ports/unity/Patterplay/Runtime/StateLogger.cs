// The Patterplay state logger: the ADAPTER half, plus LogStep, which is this product's own.
//
// The core - push-based property logging on the PropertyBag audit hook, the diff for what has
// no hook, the re-mount that survives a load - is the shared kernel's, vendored beside this
// file as Expr/StateLogger.cs and shared with the Storylet Engine.
//
// This used to diff whole SaveGame() snapshots, so it reported the NET change between captures:
// a value that changed and changed back was invisible, and every write was late. It also
// carried its own StateChange, its own DiffState and its own FormatValue; all three are the
// kernel's now, and its value rendering goes through PatterValue.ToJsonString, which is the
// same rule the JS runtime's JSON.stringify applies.
//
// Paths, unchanged:
//   @patter.x            the shared globals
//   @scene:<sceneId>.x   the shared scene props
//   visit:<nodeId>       shared visit counts
//   <flowId>/...         the same three, per flow (its not-shared halves)

using System;
using System.Collections.Generic;
using System.Linq;

namespace Patterkit.Patterplay
{
    public static class PatterStateLogger
    {
        /// <summary>Flatten the engine's whole-game state into a path -> value map (shared scopes
        /// + every live flow), off SaveGame(). The logger no longer diffs this - it mounts the
        /// bags directly - but it stays as the public "what is the state right now" call, and as
        /// the definition of the path space the mounts compose.</summary>
        public static Dictionary<string, PatterValue> SnapshotState(Engine engine)
        {
            var save = engine.SaveGame();
            var outMap = new Dictionary<string, PatterValue>();
            foreach (var kv in save.Shared) outMap[$"@patter.{kv.Key}"] = kv.Value;
            foreach (var scene in save.StageBags)
                foreach (var kv in scene.Value) outMap[$"@scene:{scene.Key}.{kv.Key}"] = kv.Value;
            foreach (var kv in save.SharedVisits) outMap[$"visit:{kv.Key}"] = PatterValue.Num(kv.Value);
            foreach (var flow in save.Flows)
            {
                foreach (var kv in flow.Value.Scopes) outMap[$"{flow.Key}/@patter.{kv.Key}"] = kv.Value;
                foreach (var scene in flow.Value.SceneBags)
                    foreach (var kv in scene.Value) outMap[$"{flow.Key}/@scene:{scene.Key}.{kv.Key}"] = kv.Value;
                foreach (var kv in flow.Value.Visits) outMap[$"{flow.Key}/visit:{kv.Key}"] = PatterValue.Num(kv.Value);
            }
            return outMap;
        }

        /// <summary>The visit counts, which live in no bag and so have no audit hook: the kernel
        /// diffs these on Capture, which is all this logger used to do for everything.</summary>
        internal static OrderedMap<string, PatterValue> VisitState(Engine engine)
        {
            var save = engine.SaveGame();
            var outMap = new OrderedMap<string, PatterValue>();
            foreach (var kv in save.SharedVisits) outMap.Set($"visit:{kv.Key}", PatterValue.Num(kv.Value));
            foreach (var flow in save.Flows)
                foreach (var kv in flow.Value.Visits) outMap.Set($"{flow.Key}/visit:{kv.Key}", PatterValue.Num(kv.Value));
            return outMap;
        }

        /// <summary>JSON.stringify-compatible rendering; null -> "&lt;unset&gt;". The kernel renders
        /// state lines with exactly this rule (PatterValue.ToJsonString); it stays public because
        /// step tracing renders text and gameData, which are not bag values.</summary>
        public static string FormatValue(PatterValue v) => v == null ? "<unset>" : v.ToJsonString();

        /// <summary>The sorted set of paths that differ between two snapshots. Delegates to the
        /// kernel, so there is one diff rule rather than two.</summary>
        public static List<StateChange> DiffState(Dictionary<string, PatterValue> prev, Dictionary<string, PatterValue> next)
        {
            return StateLogger.DiffState(Engine.OrderedOf(prev), Engine.OrderedOf(next));
        }

        /// <summary>Create a state logger over an engine. Property writes log as they land; call
        /// Capture() after each Advance/Choose to pick up the visit counts and re-baseline.</summary>
        public static PatterStateLog CreateStateLogger(Engine engine, Action<string> sink = null, string label = null)
        {
            return new PatterStateLog(engine, sink, label);
        }
    }

    /// <summary>Patterplay's state logger: the kernel logger plus LogStep.
    ///
    /// Named PatterStateLog rather than StateLogger because the kernel's class - vendored into
    /// this namespace - is the StateLogger now. Hosts almost always hold this with `var`.</summary>
    public sealed class PatterStateLog : IDisposable
    {
        private readonly Engine _engine;
        private readonly Action<string> _sink;
        private readonly string _tag;
        private readonly StateLogger _kernel;

        internal PatterStateLog(Engine engine, Action<string> sink, string label)
        {
            _engine = engine;
            _sink = sink ?? (line => Console.WriteLine(line));
            _tag = string.IsNullOrEmpty(label) ? "" : $"[{label}] ";
            var adapter = new StateLoggerAdapter
            {
                // Re-read on every capture: OpenFlow and LoadGame both replace bags, and the
                // kernel re-mounts whatever it is handed.
                Mounts = () =>
                {
                    var mounts = engine.ListBags();
                    foreach (var f in engine.Flows()) mounts.AddRange(f.ListBags());
                    return mounts;
                },
                Extra = () => PatterStateLogger.VisitState(engine),
            };
            _kernel = new StateLogger(adapter, _sink, _tag);
        }

        /// <summary>The current flattened state (no logging): the whole game, off the envelope.</summary>
        public Dictionary<string, PatterValue> Snapshot() => PatterStateLogger.SnapshotState(_engine);

        /// <summary>Everything since the last capture: the property writes already logged as they
        /// landed, plus the visit counts, diffed and re-baselined.</summary>
        public List<StateChange> Capture() => _kernel.Capture();

        /// <summary>Trace one played step (line / text / game-event / choice / end), including any GameData.</summary>
        public void LogStep(StepResult step) => _sink(_tag + Describe(step));

        /// <summary>Unhook the bag auditors. The logger is inert afterwards.</summary>
        public void Dispose() => _kernel.Dispose();

        private static string Describe(StepResult step)
        {
            switch (step.Type)
            {
                case StepType.Line: return $"line {step.Character ?? "?"}: {PatterStateLogger.FormatValue(PatterValue.Str(step.Text ?? ""))}{Gd(step)}";
                case StepType.Text: return $"text: {PatterStateLogger.FormatValue(PatterValue.Str(step.Text ?? ""))}{Gd(step)}";
                case StepType.GameEvent: return $"game event {step.Id}{Gd(step)}";
                case StepType.Choice: return $"choice ({step.Options.Count} option{(step.Options.Count == 1 ? "" : "s")})";
                case StepType.End: return "end";
                default: return step.Type.ToString();
            }
        }

        private static string Gd(StepResult step)
        {
            if (step.GameData == null || step.GameData.Count == 0) return "";
            var parts = step.GameData.OrderBy(kv => kv.Key, StringComparer.Ordinal)
                .Select(kv => $"{PatterStateLogger.FormatValue(PatterValue.Str(kv.Key))}:{PatterStateLogger.FormatValue(kv.Value)}");
            return " gameData={" + string.Join(",", parts) + "}";
        }
    }
}
