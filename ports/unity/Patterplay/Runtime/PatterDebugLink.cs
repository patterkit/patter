// PatterDebugLink - the game-side client for Patterpad's live debug link. Streams a running game's
// story position to the editor over a loopback WebSocket, so Patterpad follows the live cursor like a
// debugger. OBSERVE-ONLY: the game stays in control; the editor is a passive mirror. The C# parity of
// the JS @patterkit/play-helpers createDebugLink, same `patterplay/debug@1` wire protocol.
//
// It never throws into your game loop, and if the editor isn't listening every call is a silent no-op
// (a shipped game on a player's machine has nothing on 127.0.0.1:4471, so it stays inert). Even so it
// is a DEBUG tool: wire it behind `#if UNITY_EDITOR || DEVELOPMENT_BUILD` so it is stripped from a
// release player build. Report position after each Advance()/Choose():
//
//   var link = new PatterDebugLink(engine.BuildId, "My Game");
//   link.FlowOpened("main");
//   // ...after each step:
//   link.Observe("main", flow.CurrentScene, step.Id, PatterDebugLink.TypeName(step.Type));
//   // ...and when the flow ends:
//   link.FlowClosed("main");

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace Patterkit.Patterplay
{
    public sealed class PatterDebugLink : IDisposable
    {
        private string _build; // mutable: SetBuild() after a live bundle refresh lands
        private readonly string _project;
        private readonly string _url;
        private readonly HashSet<string> _flows = new HashSet<string>();
        private readonly ConcurrentQueue<string> _queue = new ConcurrentQueue<string>();
        // Editor -> game messages (live bundle refresh). Filled by the receive loop on a worker
        // thread; the game DRAINS it from its own loop via TryReceive, so the swap happens on the
        // main thread (Unity objects must not be touched from the socket thread).
        private readonly ConcurrentQueue<string> _inbox = new ConcurrentQueue<string>();
        private readonly CancellationTokenSource _cts = new CancellationTokenSource();
        private ClientWebSocket _ws;
        private volatile bool _closed;

        public PatterDebugLink(string build, string project = null, string url = "ws://127.0.0.1:4471")
        {
            _build = build ?? "";
            _project = project;
            _url = string.IsNullOrEmpty(url) ? "ws://127.0.0.1:4471" : url;
            _ = RunAsync(_cts.Token);
        }

        /// <summary>The wire `type` string for a StepResult.Type (line / text / gameEvent / choice / end).</summary>
        public static string TypeName(StepType type)
        {
            switch (type)
            {
                case StepType.Line: return "line";
                case StepType.Text: return "text";
                case StepType.GameEvent: return "gameEvent";
                case StepType.Choice: return "choice";
                default: return "end";
            }
        }

        /// <summary>Tell the editor a flow opened (so it can list it in the follow selector).</summary>
        public void FlowOpened(string flowId)
        {
            lock (_flows) _flows.Add(flowId);
            Post("{\"t\":\"flowOpen\",\"flow\":" + Esc(flowId) + "}");
        }

        /// <summary>Tell the editor a flow closed.</summary>
        public void FlowClosed(string flowId)
        {
            lock (_flows) _flows.Remove(flowId);
            Post("{\"t\":\"flowClose\",\"flow\":" + Esc(flowId) + "}");
        }

        /// <summary>Report a flow's current position - call after each Advance()/Choose(). A null/empty
        /// beatId is sent as null, matching the JS client.</summary>
        public void Observe(string flowId, string sceneId, string beatId, string type, string choiceId = null)
        {
            var sb = new StringBuilder();
            sb.Append("{\"t\":\"frame\",\"flow\":").Append(Esc(flowId));
            sb.Append(",\"sceneId\":").Append(Esc(sceneId));
            sb.Append(",\"beatId\":").Append(string.IsNullOrEmpty(beatId) ? "null" : Esc(beatId));
            sb.Append(",\"type\":").Append(Esc(type));
            if (!string.IsNullOrEmpty(choiceId)) sb.Append(",\"choiceId\":").Append(Esc(choiceId));
            sb.Append("}");
            Post(sb.ToString());
        }

        /// <summary>Live bundle refresh: drain the next editor message (a raw JSON frame), if one
        /// arrived. Call from your Update() so the swap runs on the main thread, then hand the frame
        /// to <c>PatterLiveBundle.TryParsePush</c> + <c>Apply</c> and report back via SetBuild.</summary>
        public bool TryReceive(out string message) => _inbox.TryDequeue(out message);

        /// <summary>After applying a pushed bundle: report the build now running (re-hellos, so the
        /// editor's match/stale pill updates and it stops re-pushing the same bundle).</summary>
        public void SetBuild(string build)
        {
            if (build == null || build == _build) return;
            _build = build;
            Post(HelloJson()); // re-handshake: the editor re-reads the build
        }

        /// <summary>Close the link.</summary>
        public void Close()
        {
            _closed = true;
            try { _cts.Cancel(); } catch { /* already disposed */ }
            try { _ws?.Abort(); } catch { /* already gone */ }
        }

        public void Dispose() => Close();

        // -- internals -------------------------------------------------------------

        private void Post(string json)
        {
            if (!_closed) _queue.Enqueue(json);
        }

        private async Task RunAsync(CancellationToken ct)
        {
            try
            {
                _ws = new ClientWebSocket();
                await _ws.ConnectAsync(new Uri(_url), ct).ConfigureAwait(false);
                // Handshake first, so the editor can verify the build + seed the flow list before frames.
                await SendRaw(HelloJson(), ct).ConfigureAwait(false);
                // Send + receive run concurrently: outgoing frames drain from _queue, incoming editor
                // messages (live bundle refresh) land in _inbox for the game to drain on its own thread.
                await Task.WhenAll(SendLoop(ct), ReceiveLoop(ct)).ConfigureAwait(false);
            }
            catch
            {
                // Editor not listening / link closed - go quiet and stop queuing (never throw into the game).
            }
            finally
            {
                _closed = true;
                while (_queue.TryDequeue(out _)) { }
            }
        }

        private async Task SendLoop(CancellationToken ct)
        {
            while (!ct.IsCancellationRequested && _ws.State == WebSocketState.Open)
            {
                if (_queue.TryDequeue(out var msg)) await SendRaw(msg, ct).ConfigureAwait(false);
                else await Task.Delay(15, ct).ConfigureAwait(false);
            }
        }

        private async Task ReceiveLoop(CancellationToken ct)
        {
            var buffer = new byte[64 * 1024];
            var frame = new StringBuilder();
            while (!ct.IsCancellationRequested && _ws.State == WebSocketState.Open)
            {
                var result = await _ws.ReceiveAsync(new ArraySegment<byte>(buffer), ct).ConfigureAwait(false);
                if (result.MessageType == WebSocketMessageType.Close) return;
                if (result.MessageType != WebSocketMessageType.Text) continue;
                frame.Append(Encoding.UTF8.GetString(buffer, 0, result.Count));
                if (!result.EndOfMessage) continue; // a pushed bundle spans many chunks
                _inbox.Enqueue(frame.ToString());
                frame.Clear();
            }
        }

        private async Task SendRaw(string json, CancellationToken ct)
        {
            var bytes = Encoding.UTF8.GetBytes(json);
            await _ws.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, ct).ConfigureAwait(false);
        }

        private string HelloJson()
        {
            var sb = new StringBuilder();
            sb.Append("{\"t\":\"hello\",\"v\":1,\"build\":").Append(Esc(_build));
            sb.Append(",\"project\":").Append(Esc(_project));
            sb.Append(",\"flows\":[");
            lock (_flows)
            {
                bool first = true;
                foreach (var f in _flows)
                {
                    if (!first) sb.Append(",");
                    sb.Append(Esc(f));
                    first = false;
                }
            }
            sb.Append("]}");
            return sb.ToString();
        }

        // Minimal JSON string escaper (the Runtime asmdef carries no JSON dependency). null -> literal null.
        private static string Esc(string s)
        {
            if (s == null) return "null";
            var sb = new StringBuilder(s.Length + 2);
            sb.Append('"');
            foreach (char c in s)
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
            sb.Append('"');
            return sb.ToString();
        }
    }
}
