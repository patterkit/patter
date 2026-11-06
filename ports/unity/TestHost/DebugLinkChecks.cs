// The live debug link reconnects, against a real loopback WebSocket server: a close (or an attempt that
// fails) is tried again after a wait that doubles to a cap, a hello puts the wait back to the first, the
// hello on a reconnect carries the current build and the flows open now, nothing is queued while the
// editor is away, a link the editor replaced (close code 4000) stays closed, and Close() stops retries.
//
// Not a corpus case: this is transport. The link is built with short waits (100 ms doubling to 400 ms,
// where a game gets 1 s doubling to 10 s) so the check takes a second or two, not a minute.

using System;
using System.Collections.Concurrent;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace Patterkit.Patterplay.TestHost
{
    internal static partial class Program
    {
        private static void RunDebugLinkReconnectCheck()
        {
            const string S = "debugLink";
            var probe = new TcpListener(IPAddress.Loopback, 0);
            probe.Start();
            int port = ((IPEndPoint)probe.LocalEndpoint).Port;
            probe.Stop();
            string url = $"ws://127.0.0.1:{port}";

            var listener = Listen(port);
            var waits = new ConcurrentQueue<int>();
            var link = new PatterDebugLink("h1", "proj", url, 100, 400, ms => waits.Enqueue(ms));
            try
            {
                // First connection: the hello, then a flow opened while connected.
                var ws = AcceptLink(listener);
                if (ws == null) { Fail(S, "reconnect", "the link never connected"); return; }
                var hello = ReceiveJson(ws);
                Check("debug link: says hello", hello.HasValue && Str(hello, "t") == "hello" && Str(hello, "build") == "h1"
                    && hello.Value.GetProperty("flows").GetArrayLength() == 0, hello?.ToString());
                link.FlowOpened("main");
                var open = ReceiveJson(ws);
                Check("debug link: a flow it opens is announced", Str(open, "t") == "flowOpen" && Str(open, "flow") == "main", open?.ToString());

                // The editor closes, and is then away: retried after 100 ms, then each failed attempt doubles to 400.
                listener.Stop();
                CloseFromServer(ws, WebSocketCloseStatus.NormalClosure, "bye");
                Check("debug link: a closed link retries", WaitFor(() => waits.Count >= 1), $"waits {waits.Count}");
                Check("debug link: and reads as connecting, not closed", link.State == "connecting", link.State);
                link.Observe("side", "s1", "b1", "line");
                Check("debug link: nothing is queued while there's no open socket", link.QueuedCount == 0, $"{link.QueuedCount} queued");
                link.SetBuild("h2");
                Check("debug link: not even the new build's hello", link.QueuedCount == 0, $"{link.QueuedCount} queued");
                Check("debug link: failed attempts keep retrying", WaitFor(() => waits.Count >= 4), $"waits {waits.Count}");
                string seen = string.Join(",", waits.Take(4));
                Check("debug link: the waits double to the cap", seen == "100,200,400,400", seen);

                // The editor is back: the same hello, with the current build and open flows.
                listener = Listen(port);
                ws = AcceptLink(listener);
                if (ws == null) { Fail(S, "reconnect", "the link never reconnected"); return; }
                int waitsAtReconnect = waits.Count;
                var again = ReceiveJson(ws);
                var flows = again.HasValue ? again.Value.GetProperty("flows").EnumerateArray().Select(f => f.GetString()).OrderBy(f => f).ToArray() : new string[0];
                Check("debug link: says hello again with the new build", Str(again, "t") == "hello" && Str(again, "build") == "h2" && Str(again, "project") == "proj", again?.ToString());
                Check("debug link: and the flows open now", string.Join(",", flows) == "main,side", string.Join(",", flows));
                Check("debug link: and reads as connected", WaitFor(() => link.State == "connected"), link.State);
                link.Observe("main", "s1", "b2", "line");
                var frame = ReceiveJson(ws);
                Check("debug link: frames flow again", Str(frame, "t") == "frame" && Str(frame, "beatId") == "b2", frame?.ToString());

                // Closed after a hello: the wait is back to the first.
                CloseFromServer(ws, WebSocketCloseStatus.EndpointUnavailable, "restart");
                Check("debug link: a second close retries", WaitFor(() => waits.Count > waitsAtReconnect), $"waits {waits.Count}");
                Check("debug link: after the first wait again, since the hello reset it", waits.Skip(waitsAtReconnect).FirstOrDefault() == 100,
                    string.Join(",", waits.Skip(waitsAtReconnect)));
                ws = AcceptLink(listener);
                if (ws == null) { Fail(S, "reconnect", "the link never reconnected a second time"); return; }
                ReceiveJson(ws);

                // Replaced by another game: closed for good, no retry.
                int waitsAtReplace = waits.Count;
                CloseFromServer(ws, (WebSocketCloseStatus)4000, "replaced");
                Check("debug link: a replaced link reads as closed", WaitFor(() => link.State == "closed"), link.State);
                Thread.Sleep(400);
                Check("debug link: and schedules no retry", waits.Count == waitsAtReplace, $"waits {waits.Count}, was {waitsAtReplace}");
                Check("debug link: and doesn't dial again", !listener.Pending(), "a connection is pending");
            }
            finally
            {
                link.Close();
                listener.Stop();
            }

            // Switched off while retrying: Close() stops it.
            var offWaits = new ConcurrentQueue<int>();
            var off = new PatterDebugLink("h1", "proj", url, 100, 400, ms => offWaits.Enqueue(ms));
            Check("debug link: a link with nothing to reach retries", WaitFor(() => offWaits.Count >= 1), $"waits {offWaits.Count}");
            Check("debug link: and reads as connecting", off.State == "connecting", off.State);
            off.Close();
            int offAtClose = offWaits.Count;
            Thread.Sleep(400);
            Check("debug link: Close() stops the retries", off.State == "closed" && offWaits.Count == offAtClose, $"{off.State}, waits {offWaits.Count} (was {offAtClose})");
        }

        private static TcpListener Listen(int port)
        {
            var l = new TcpListener(IPAddress.Loopback, port);
            l.Server.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, true);
            l.Start();
            return l;
        }

        /// <summary>Accept the link's next connection and finish the WebSocket handshake (2 s at most).</summary>
        private static WebSocket AcceptLink(TcpListener listener)
        {
            var accept = listener.AcceptTcpClientAsync();
            if (!accept.Wait(TimeSpan.FromSeconds(2))) return null;
            var stream = accept.Result.GetStream();
            string key = ReadHandshakeKey(stream).GetAwaiter().GetResult();
            byte[] reply = Encoding.ASCII.GetBytes(
                "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
                "Sec-WebSocket-Accept: " + AcceptKey(key) + "\r\n\r\n");
            stream.Write(reply, 0, reply.Length);
            return WebSocket.CreateFromStream(stream, isServer: true, subProtocol: null, keepAliveInterval: TimeSpan.FromSeconds(30));
        }

        /// <summary>The next text message the server receives, parsed, or null (2 s at most).</summary>
        private static JsonElement? ReceiveJson(WebSocket ws)
        {
            var buffer = new byte[16 * 1024];
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(2));
            try
            {
                var result = ws.ReceiveAsync(new ArraySegment<byte>(buffer), cts.Token).GetAwaiter().GetResult();
                if (result.MessageType != WebSocketMessageType.Text) return null;
                return JsonDocument.Parse(Encoding.UTF8.GetString(buffer, 0, result.Count)).RootElement.Clone();
            }
            catch { return null; }
        }

        private static void CloseFromServer(WebSocket ws, WebSocketCloseStatus status, string reason)
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(2));
            try { ws.CloseOutputAsync(status, reason, cts.Token).GetAwaiter().GetResult(); } catch { /* the link may have gone first */ }
            Thread.Sleep(50); // let the close frame reach the link before the stream goes
            ws.Dispose();
        }

        private static bool WaitFor(Func<bool> cond)
        {
            for (int i = 0; i < 200; i++)
            {
                if (cond()) return true;
                Thread.Sleep(10);
            }
            return cond();
        }

        private static string Str(JsonElement? obj, string name) =>
            obj.HasValue && obj.Value.ValueKind == JsonValueKind.Object && obj.Value.TryGetProperty(name, out var v)
                && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
    }
}
