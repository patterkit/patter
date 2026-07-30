// ---------------------------------------------------------------------------
// State logger: a debug companion that watches the mutable runtime state -
// `@patter` globals, per-scene `@scene` props, and visit counts (shared +
// per-flow) - and reports what changed between captures. LogStep traces each
// played step, including the GameData payload (the host-event channel).
// Built on Engine.SaveGame(), so it sees exactly what a save persists.
//
// The port of play-helpers' logger.ts: the flattened path scheme (`@patter.x`,
// `@scene:scene.x`, `visit:nodeId`, `flowId/...`) and the line format
// (`tag path: from -> to`, `<unset>` for missing) are the cross-runtime
// contract; only the traversal of the native save shape differs. Lives in the
// pure runtime assembly (no UnityEngine, no Newtonsoft) so the dotnet TestHost
// can drive it; values are rendered with a minimal JSON formatter to match
// JSON.stringify on the JS side.
// ---------------------------------------------------------------------------

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace Patterkit.Patterplay
{
    public sealed class StateChange
    {
        public string Path;
        public PatterValue From;   // null = the path did not exist before
        public PatterValue To;     // null = the path no longer exists
    }

    public static class PatterStateLogger
    {
        /// <summary>Flatten the engine's whole-game state into a path -> value map (shared scopes + every live flow).</summary>
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

        /// <summary>The sorted set of paths that differ between two snapshots (added / removed / changed).</summary>
        public static List<StateChange> DiffState(Dictionary<string, PatterValue> prev, Dictionary<string, PatterValue> next)
        {
            var changes = new List<StateChange>();
            var keys = prev.Keys.Union(next.Keys).OrderBy(k => k, StringComparer.Ordinal);
            foreach (var path in keys)
            {
                prev.TryGetValue(path, out var from);
                next.TryGetValue(path, out var to);
                if (!ValueEquals(from, to)) changes.Add(new StateChange { Path = path, From = from, To = to });
            }
            return changes;
        }

        /// <summary>Create a state logger over an engine. Call Capture() after each Advance/Choose to log mutations.</summary>
        public static StateLogger CreateStateLogger(Engine engine, Action<string> sink = null, string label = null)
            => new StateLogger(engine, sink, label);

        internal static bool ValueEquals(PatterValue a, PatterValue b)
            => FormatValue(a) == FormatValue(b);

        /// <summary>JSON.stringify-compatible rendering (the logger line contract); null -> "&lt;unset&gt;".</summary>
        public static string FormatValue(PatterValue v)
        {
            if (v == null) return "<unset>";
            switch (v.Kind)
            {
                case PatterKind.Bool: return v.AsBool ? "true" : "false";
                case PatterKind.Number: return v.ToDisplayString(); // JsNumber = String(n) = JSON.stringify(n)
                case PatterKind.Str: return Quote(v.AsString);
                case PatterKind.Flags: return "[" + string.Join(",", v.AsFlags.Select(Quote)) + "]";
                default: return "<unset>";
            }
        }

        private static string Quote(string s)
        {
            var sb = new StringBuilder(s.Length + 2).Append('"');
            foreach (var c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
                        else sb.Append(c);
                        break;
                }
            }
            return sb.Append('"').ToString();
        }
    }

    public sealed class StateLogger
    {
        private readonly Engine _engine;
        private readonly Action<string> _sink;
        private readonly string _tag;
        private Dictionary<string, PatterValue> _baseline;

        internal StateLogger(Engine engine, Action<string> sink, string label)
        {
            _engine = engine;
            _sink = sink ?? (line => Console.WriteLine(line));
            _tag = string.IsNullOrEmpty(label) ? "" : $"[{label}] ";
            _baseline = PatterStateLogger.SnapshotState(engine);
        }

        /// <summary>The current flattened state (no logging).</summary>
        public Dictionary<string, PatterValue> Snapshot() => PatterStateLogger.SnapshotState(_engine);

        /// <summary>Diff since the last capture, log each change, and re-baseline. Returns the changes.</summary>
        public List<StateChange> Capture()
        {
            var next = PatterStateLogger.SnapshotState(_engine);
            var changes = PatterStateLogger.DiffState(_baseline, next);
            _baseline = next;
            foreach (var c in changes)
                _sink($"{_tag}{c.Path}: {PatterStateLogger.FormatValue(c.From)} -> {PatterStateLogger.FormatValue(c.To)}");
            return changes;
        }

        /// <summary>Trace one played step (line / text / game-event / choice / end), including any GameData.</summary>
        public void LogStep(StepResult step) => _sink(_tag + Describe(step));

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
