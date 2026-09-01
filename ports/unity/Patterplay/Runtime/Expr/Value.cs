// GENERATED - vendored from expr/ports/unity/Value.cs by scripts/vendor-ports.mjs.
// Do not edit here; edit the shared source and re-run the script.
// ---------------------------------------------------------------------------
// The scalar value type, for Unity / C#. THE SHARED SOURCE.
//
// Authored in expr/ports/unity and VENDORED into each consuming package by
// expr/scripts/vendor-ports.mjs. Do not edit a vendored copy.
//
// The four kinds the expression language has. Both families had their own, 68%
// alike and with character-identical ValueEquals, so most of the difference was
// spelling. Lands in the package's own namespace, inside its Runtime asmdef.
// The family supplies its own EvalError before this is used.
// ---------------------------------------------------------------------------

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Patterkit.Patterplay
{
    public enum PatterKind { Bool, Number, Str, Flags }

    public sealed class PatterValue
    {
        public PatterKind Kind { get; }
        private readonly bool _b;
        private readonly double _n;
        private readonly string _s;
        private readonly IReadOnlyList<string> _f;

        private PatterValue(PatterKind kind, bool b = false, double n = 0, string s = null, IReadOnlyList<string> f = null)
        {
            Kind = kind; _b = b; _n = n; _s = s; _f = f;
        }

        public static PatterValue Bool(bool v) => v ? True : False;
        public static PatterValue Num(double v) => new PatterValue(PatterKind.Number, n: v);
        public static PatterValue Str(string v) => new PatterValue(PatterKind.Str, s: v ?? "");
        /// <summary>Flags list. The list is copied, so a PatterValue is immutable.</summary>
        public static PatterValue Flags(IEnumerable<string> v)
        {
            var list = v != null ? new List<string>(v) : new List<string>();
            return new PatterValue(PatterKind.Flags, f: list);
        }

        public static readonly PatterValue False = new PatterValue(PatterKind.Bool, b: false);
        public static readonly PatterValue True = new PatterValue(PatterKind.Bool, b: true);

        public bool IsBool => Kind == PatterKind.Bool;
        public bool IsNumber => Kind == PatterKind.Number;
        public bool IsString => Kind == PatterKind.Str;
        public bool IsFlags => Kind == PatterKind.Flags;

        public bool AsBool => _b;
        public double AsNumber => _n;
        public string AsString => _s;
        public IReadOnlyList<string> AsFlags => _f;

        /// <summary>`==` / `!=` semantics: primitives by value; flags element-wise,
        /// in order; mixed kinds unequal (the evaluator's valueEquals).</summary>
        public bool ValueEquals(PatterValue other)
        {
            if (other == null) return false;
            if (Kind == PatterKind.Flags || other.Kind == PatterKind.Flags)
            {
                if (Kind != PatterKind.Flags || other.Kind != PatterKind.Flags) return false;
                if (_f.Count != other._f.Count) return false;
                // Compared as a SET: order is an artefact of the order somebody
                // happened to add things in, and was significant until
                // 2026-09-01, which was a bug. Sorted copies, so a duplicate
                // still counts.
                var x = new List<string>(_f); x.Sort(StringComparer.Ordinal);
                var y = new List<string>(other._f); y.Sort(StringComparer.Ordinal);
                for (int i = 0; i < x.Count; i++) if (x[i] != y[i]) return false;
                return true;
            }
            if (Kind != other.Kind) return false;
            switch (Kind)
            {
                case PatterKind.Bool: return _b == other._b;
                case PatterKind.Number: return _n == other._n;
                case PatterKind.Str: return _s == other._s;
                default: return false;
            }
        }

        /// <summary>The JSON.stringify-stable rendering the JS runner compares with
        /// (and the failure reports print).</summary>
        public string ToJsonString()
        {
            switch (Kind)
            {
                case PatterKind.Bool: return _b ? "true" : "false";
                case PatterKind.Number: return JsNumber(_n);
                case PatterKind.Str: return JsonQuote(_s);
                case PatterKind.Flags:
                {
                    var sb = new StringBuilder("[");
                    for (int i = 0; i < _f.Count; i++)
                    {
                        if (i > 0) sb.Append(",");
                        sb.Append(JsonQuote(_f[i]));
                    }
                    return sb.Append("]").ToString();
                }
                default: return "null";
            }
        }

        /// <summary>Format a double the way JavaScript's String(n) does (the
        /// cross-runtime number-rendering contract).</summary>
        public static string JsNumber(double n)
        {
            if (double.IsNaN(n)) return "NaN";
            if (double.IsPositiveInfinity(n)) return "Infinity";
            if (double.IsNegativeInfinity(n)) return "-Infinity";
            // Integral values below 1e21 print with no decimal point and no
            // exponent, which is what JS does. NOT via (long): that overflows
            // above 2^63, and both families printed 1e20 as
            // "9223372036854775807" until 2026-09-01.
            if (n == Math.Floor(n) && Math.Abs(n) < 1e21)
                return n.ToString("F0", CultureInfo.InvariantCulture);
            // Otherwise the shortest representation that round-trips, which is
            // what JS picks. "R" is exactly that.
            return n.ToString("R", CultureInfo.InvariantCulture);
        }

        public static string JsonQuote(string s)
        {
            var sb = new StringBuilder("\"");
            foreach (char c in s ?? "")
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        else sb.Append(c);
                        break;
                }
            }
            return sb.Append("\"").ToString();
        }

        /// <summary>The string a JS host would interpolate or display: a bare
        /// string, a comma-joined flag list. Distinct from ToJsonString, which
        /// quotes.</summary>
        public string ToDisplayString()
        {
            switch (Kind)
            {
                case PatterKind.Bool: return _b ? "true" : "false";
                case PatterKind.Number: return JsNumber(_n);
                case PatterKind.Str: return _s;
                case PatterKind.Flags: return string.Join(",", _f);
                default: return "";
            }
        }

        /// <summary>Truthiness for a bare condition: booleans and numbers as you
        /// would expect, a string when non-empty, a flag list when non-empty.
        /// The two families disagreed about this until 2026-09-01, which
        /// mattered because they share a property registry.</summary>
        public bool Truthy
        {
            get
            {
                switch (Kind)
                {
                    case PatterKind.Bool: return _b;
                    case PatterKind.Number: return _n != 0;
                    case PatterKind.Str: return _s.Length > 0;
                    case PatterKind.Flags: return _f.Count > 0;
                    default: return false;
                }
            }
        }

        public override string ToString() => ToJsonString();
    }
}
