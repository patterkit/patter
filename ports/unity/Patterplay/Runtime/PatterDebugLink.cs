// PatterDebugLink - the game-side client for Patterpad's live debug link. Streams a running game's
// story position to the editor over a loopback WebSocket, so Patterpad follows the live cursor like a
// debugger. OBSERVE-ONLY: the game stays in control; the editor is a passive mirror. The C# parity of
// the JS @patterkit/play-helpers createDebugLink, same `patterplay/debug@1` wire protocol.
//
// It never throws into your game loop, and if the editor isn't listening every call is a silent no-op
// (a shipped game on a player's machine has nothing on 127.0.0.1:4471, so it stays inert). Even so it
// is a DEBUG tool: wire it behind `#if UNITY_EDITOR || DEVELOPMENT_BUILD` so it is stripped from a
// release player build.
//
// It reconnects: while the game has it open, a socket that closes (or never opens) is tried again after
// 1 s, doubling to at most 10 s, and sends its hello again when the editor is back. It logs one
// "[Patterplay]" line on standard error when an established link is lost and one when it's back, nothing
// per attempt. A link the editor replaced with another game (close code 4000) closes for good.
//
// Report position after each Advance()/Choose():
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
using System.IO;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace Patterkit.Patterplay
{
    /// <summary>Play in game: the editor asked the running game to start a block now. Ids are the
    /// bundle's. Parse one from a <c>TryReceive</c> frame with <c>PatterPlayInGame.TryParsePlay</c>.</summary>
    public sealed class PatterPlayRequest
    {
        /// <summary>Echo it in <c>ReplyPlay</c> so the editor can match the answer to its request.</summary>
        public string Id;
        public string SceneId;
        public string BlockId;
        /// <summary>Stop what the speakers are doing first, rather than turn the request down as busy.</summary>
        public bool TakeOver;
        /// <summary>The editor's bundle hash, or null: a game on another build can answer "staleBuild".</summary>
        public string Build;
    }

    /// <summary>The game's answer to a <c>PatterPlayRequest</c>.</summary>
    public sealed class PatterPlayResult
    {
        public bool Started;
        /// <summary>Why it didn't start, as a short code: "busy", "unknownBlock", "staleBuild", or the game's own.</summary>
        public string Reason;
        /// <summary>More, in plain words (which speaker is busy, which block was missing).</summary>
        public string Detail;
    }

    public sealed class PatterDebugLink : IDisposable
    {
        private const string DefaultUrl = "ws://127.0.0.1:4471";
        // The editor's server closes a client it replaced (another game connected) with this code. A
        // replaced link stays closed: retrying would only take the editor back from the game that took over.
        private const int CloseReplaced = 4000;

        private volatile string _build; // mutable: SetBuild() after a live bundle refresh lands (the worker reads it for a re-hello)
        private readonly string _project;
        private readonly string _url;
        private readonly HashSet<string> _flows = new HashSet<string>();
        private readonly ConcurrentQueue<string> _queue = new ConcurrentQueue<string>();
        // Editor -> game messages (live bundle refresh). Filled by the receive loop on a worker
        // thread; the game DRAINS it from its own loop via TryReceive, so the swap happens on the
        // main thread (Unity objects must not be touched from the socket thread).
        private readonly ConcurrentQueue<string> _inbox = new ConcurrentQueue<string>();
        private readonly CancellationTokenSource _cts = new CancellationTokenSource();
        private readonly int _retryFirstMs;
        private readonly int _retryMaxMs;
        private volatile ClientWebSocket _ws;
        private volatile bool _closed;      // Close() was called, or the editor replaced this link
        private volatile bool _connected;
        // Frames queue only while the FIRST socket connects. Once any attempt fails or closes, a frame
        // with no open socket has nowhere to go, so it is dropped rather than kept for the rest of a game.
        private volatile bool _startup = true;

        /// <summary>Test hook: told each wait before a retry, in milliseconds. Null outside the TestHost.</summary>
        internal Action<int> RetryScheduled;
        /// <summary>Test hook: frames waiting to be sent.</summary>
        internal int QueuedCount => _queue.Count;

        /// <summary>What the link is doing, for the editor's Runtime State window. "the editor is not
        /// listening" and "I never attached" look identical from inside a running game, and that is the
        /// first question a link's user asks (from-storylets/weak-debug-registries).</summary>
        public string State => _closed ? "closed" : _connected ? "connected" : "connecting";

        /// <summary>The build identity this link handshook with (moves on SetBuild after a live refresh).</summary>
        public string Build => _build;

        /// <summary>The editor address this link dials.</summary>
        public string Url => _url;

        public PatterDebugLink(string build, string project = null, string url = DefaultUrl)
            : this(build, project, url, 1000, 10000, null)
        {
        }

        /// <summary>The TestHost's: shorter retry waits, and the retry hook in place before the first dial.</summary>
        internal PatterDebugLink(string build, string project, string url, int retryFirstMs, int retryMaxMs, Action<int> retryScheduled)
        {
            _build = build ?? "";
            _project = project;
            _url = string.IsNullOrEmpty(url) ? DefaultUrl : url;
            _retryFirstMs = retryFirstMs;
            _retryMaxMs = retryMaxMs;
            RetryScheduled = retryScheduled;
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
            // A flow reports itself: FlowOpened is the host's job and nothing could check it, so a game
            // that forgot it left the editor's list short - and the omission survived a reconnect,
            // because the hello sends this set. Announce a flow we have not seen, then the frame.
            bool announce;
            lock (_flows) announce = _flows.Add(flowId);
            if (announce) Post("{\"t\":\"flowOpen\",\"flow\":" + Esc(flowId) + "}");

            var sb = new StringBuilder();
            sb.Append("{\"t\":\"frame\",\"flow\":").Append(Esc(flowId));
            sb.Append(",\"sceneId\":").Append(Esc(sceneId));
            sb.Append(",\"beatId\":").Append(string.IsNullOrEmpty(beatId) ? "null" : Esc(beatId));
            sb.Append(",\"type\":").Append(Esc(type));
            if (!string.IsNullOrEmpty(choiceId)) sb.Append(",\"choiceId\":").Append(Esc(choiceId));
            sb.Append("}");
            Post(sb.ToString());
        }

        /// <summary>Drain the next editor message (a raw JSON frame), if one arrived. Call from your
        /// Update() so what it asks for runs on the main thread. A live bundle refresh: hand the frame to
        /// <c>PatterLiveBundle.TryParsePush</c> + <c>ApplyLiveBundle</c> and report back via SetBuild.
        /// Play in game: <c>PatterPlayInGame.TryParsePlay</c>, then answer with ReplyPlay.</summary>
        public bool TryReceive(out string message) => _inbox.TryDequeue(out message);

        /// <summary>Play in game: answer the editor's request to start a block (parse it from a
        /// <c>TryReceive</c> frame with <c>PatterPlayInGame.TryParsePlay</c>). Call it from the game
        /// thread, at once or a frame or more later; an answer after the editor stopped waiting is
        /// ignored.</summary>
        public void ReplyPlay(string id, PatterPlayResult result)
        {
            if (string.IsNullOrEmpty(id) || result == null) return;
            var sb = new StringBuilder();
            sb.Append("{\"t\":\"played\",\"id\":").Append(Esc(id));
            sb.Append(",\"started\":").Append(result.Started ? "true" : "false");
            if (result.Reason != null) sb.Append(",\"reason\":").Append(Esc(result.Reason));
            if (result.Detail != null) sb.Append(",\"detail\":").Append(Esc(result.Detail));
            sb.Append("}");
            Post(sb.ToString());
        }

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
            if (!_closed && (_connected || _startup)) _queue.Enqueue(json);
        }

        // The socket's worker: dial, and while the game has the link open, dial again after a close or a
        // failed attempt. Everything here runs off the main thread, so it touches no Unity API: the hello
        // is built from strings and the _flows set (under its lock), nothing else.
        private async Task RunAsync(CancellationToken ct)
        {
            Uri uri;
            try { uri = new Uri(_url); }
            catch { _closed = true; return; } // an address that can't parse is never going to answer

            int waitMs = _retryFirstMs;
            bool everOpened = false;
            bool lost = false;            // an established link went away and we said so
            byte[] buffer = null;         // the receive buffers, made on the first open and kept
            MemoryStream frame = null;
            try
            {
                while (!ct.IsCancellationRequested)
                {
                    var ws = new ClientWebSocket();
                    _ws = ws;
                    bool opened = false;
                    try
                    {
                        await ws.ConnectAsync(uri, ct).ConfigureAwait(false);
                        opened = true;
                        // A Post racing the last close may have queued after the drop; it's stale.
                        if (everOpened) while (_queue.TryDequeue(out _)) { }
                        everOpened = true;
                        _connected = true;
                        // Handshake first, so the editor can verify the build + seed the flow list before
                        // frames. On a reconnect it's the same hello, with the build and the flows open now.
                        await SendRaw(ws, HelloJson(), ct).ConfigureAwait(false);
                        waitMs = _retryFirstMs;
                        if (lost)
                        {
                            lost = false;
                            Console.Error.WriteLine("[Patterplay] Live Link is back (" + _url + ").");
                        }
                        if (buffer == null) { buffer = new byte[64 * 1024]; frame = new MemoryStream(); }
                        // Send + receive run concurrently: outgoing frames drain from _queue, incoming editor
                        // messages (live bundle refresh) land in _inbox for the game to drain on its own thread.
                        await Task.WhenAll(SendLoop(ws, ct), ReceiveLoop(ws, buffer, frame, ct)).ConfigureAwait(false);
                    }
                    catch
                    {
                        // Editor not listening / link dropped - try again below (never throw into the game).
                    }
                    _connected = false;
                    _startup = false;
                    while (_queue.TryDequeue(out _)) { }
                    // CloseStatus is set once the editor's Close message arrived (ReceiveLoop returns on it).
                    bool replaced = ws.CloseStatus.HasValue && (int)ws.CloseStatus.Value == CloseReplaced;
                    ws.Dispose();
                    if (replaced)
                    {
                        Console.Error.WriteLine("[Patterplay] Live Link: another game took the editor's link (" + _url + ").");
                        return;
                    }
                    if (ct.IsCancellationRequested) return;
                    if (opened && !lost)
                    {
                        lost = true;
                        Console.Error.WriteLine("[Patterplay] Live Link lost (" + _url + "); retrying.");
                    }
                    RetryScheduled?.Invoke(waitMs);
                    await Task.Delay(waitMs, ct).ConfigureAwait(false);
                    waitMs = Math.Min(waitMs * 2, _retryMaxMs);
                }
            }
            catch
            {
                // Close() cancelled the wait - stop.
            }
            finally
            {
                _closed = true;
                _connected = false;
                frame?.Dispose();
                while (_queue.TryDequeue(out _)) { }
            }
        }

        private async Task SendLoop(ClientWebSocket ws, CancellationToken ct)
        {
            try
            {
                while (!ct.IsCancellationRequested && ws.State == WebSocketState.Open)
                {
                    if (_queue.TryDequeue(out var msg)) await SendRaw(ws, msg, ct).ConfigureAwait(false);
                    else await Task.Delay(15, ct).ConfigureAwait(false);
                }
            }
            catch
            {
                // A failed send leaves the receive waiting on a socket that's gone: drop it, so the
                // receive ends too and the worker can dial again.
                try { ws.Abort(); } catch { /* already gone */ }
                throw;
            }
        }

        private async Task ReceiveLoop(ClientWebSocket ws, byte[] buffer, MemoryStream frame, CancellationToken ct)
        {
            // Accumulate BYTES and decode once at the end of the message, never chunk by chunk: a
            // multi-byte character straddling a 64 KB boundary would decode as two replacement
            // characters, one at the tail of one chunk and one at the head of the next. The message that
            // spans chunks is a pushed bundle, so any non-ASCII character in the story that lands on a
            // boundary would corrupt the JSON the game is about to apply.
            frame.SetLength(0);
            while (!ct.IsCancellationRequested && ws.State == WebSocketState.Open)
            {
                var result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), ct).ConfigureAwait(false);
                if (result.MessageType == WebSocketMessageType.Close) return;
                if (result.MessageType != WebSocketMessageType.Text) continue;
                frame.Write(buffer, 0, result.Count);
                if (!result.EndOfMessage) continue; // a pushed bundle spans many chunks
                _inbox.Enqueue(Encoding.UTF8.GetString(frame.GetBuffer(), 0, (int)frame.Length));
                frame.SetLength(0);
            }
        }

        private static async Task SendRaw(ClientWebSocket ws, string json, CancellationToken ct)
        {
            var bytes = Encoding.UTF8.GetBytes(json);
            await ws.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, ct).ConfigureAwait(false);
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
