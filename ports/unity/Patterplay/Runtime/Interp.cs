// Inline {@ref} interpolation (spec §16) - port of @patterkit/dialect's tokenise +
// interpolate + renderSlotValue. A `{ ... }` whose trimmed body starts with `@` is a
// slot; `{{` / `}}` unescape to literal braces; a malformed slot is kept verbatim.

using System;
using System.Text;
using System.Text.RegularExpressions;

namespace Patterkit.Patterplay
{
    internal static class Interp
    {
        private static readonly Regex BareRef = new Regex("^@[A-Za-z0-9_.]+$");

        public static string Expand(string text, Func<string, PatterValue> resolve)
        {
            if (string.IsNullOrEmpty(text)) return text;
            if (text.IndexOf('{') < 0) return text; // fast path: no slot opener -> nothing to interpolate (the common case)
            var outSb = new StringBuilder();
            var buf = new StringBuilder();
            int i = 0;
            while (i < text.Length)
            {
                char c = text[i];
                if (c == '{' && i + 1 < text.Length && text[i + 1] == '{') { buf.Append('{'); i += 2; continue; }
                if (c == '}' && i + 1 < text.Length && text[i + 1] == '}') { buf.Append('}'); i += 2; continue; }
                if (c == '{')
                {
                    int close = text.IndexOf('}', i + 1);
                    if (close != -1)
                    {
                        string raw = text.Substring(i, close - i + 1);
                        string inner = text.Substring(i + 1, close - (i + 1)).Trim();
                        if (inner.StartsWith("@"))
                        {
                            if (buf.Length > 0) { outSb.Append(buf); buf.Clear(); }
                            if (BareRef.IsMatch(inner))
                            {
                                var v = resolve(inner);
                                outSb.Append(v == null ? "" : RenderSlot(v));
                            }
                            else { outSb.Append(raw); } // malformed slot -> verbatim
                            i = close + 1;
                            continue;
                        }
                        buf.Append(raw); i = close + 1; continue; // not a slot -> literal braces
                    }
                }
                buf.Append(c); i += 1;
            }
            if (buf.Length > 0) outSb.Append(buf);
            return outSb.ToString();
        }

        // Closed-caption stripping (#214): mirror of @patterkit/dialect's stripCaptions. With captions
        // off, remove every open..close cue span (delimiters included) and collapse the surrounding
        // whitespace; a string with NO cue is returned unchanged. open/close may be the same token; an
        // unclosed open keeps the remainder verbatim. Byte-identical to every other runtime.
        public static string StripCaptions(string text, string open, string close)
        {
            if (string.IsNullOrEmpty(open) || string.IsNullOrEmpty(text) || text.IndexOf(open, StringComparison.Ordinal) < 0)
                return text;
            var outSb = new StringBuilder();
            int i = 0;
            bool removed = false;
            while (i < text.Length)
            {
                if (i + open.Length <= text.Length && string.CompareOrdinal(text, i, open, 0, open.Length) == 0)
                {
                    int end = text.IndexOf(close, i + open.Length, StringComparison.Ordinal);
                    if (end >= 0) { i = end + close.Length; removed = true; continue; }
                    outSb.Append(text.Substring(i)); // unclosed cue -> keep the rest literally
                    break;
                }
                outSb.Append(text[i]);
                i += 1;
            }
            return removed ? CollapseWs(outSb.ToString()) : text;
        }

        // ASCII whitespace (space, tab, newline, CR, form-feed, vtab) collapsed to a single space + trimmed,
        // manually (no regex) so the result matches the JS/C++/GDScript runtimes byte-for-byte.
        private static bool IsCaptionWs(char c) => c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f' || c == '\v';

        private static string CollapseWs(string s)
        {
            var outSb = new StringBuilder();
            bool pendingSpace = false;
            foreach (char c in s)
            {
                if (IsCaptionWs(c)) { pendingSpace = true; continue; }
                if (pendingSpace && outSb.Length > 0) outSb.Append(' ');
                pendingSpace = false;
                outSb.Append(c);
            }
            return outSb.ToString();
        }

        private static string RenderSlot(PatterValue v)
        {
            switch (v.Kind)
            {
                case PatterKind.Flags: return string.Join(", ", v.AsFlags);
                case PatterKind.Bool: return v.AsBool ? "true" : "false";
                case PatterKind.Number: return PatterValue.JsNumber(v.AsNumber);
                default: return v.AsString;
            }
        }
    }
}
