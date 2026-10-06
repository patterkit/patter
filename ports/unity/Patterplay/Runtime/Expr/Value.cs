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
// spelling; since 2026-09-24 there is one, ExprValue, shared by every family, so
// one registry can hold every engine's values. Part of the kernel assembly: see
// Errors.cs for how the kernel is packaged.
// ---------------------------------------------------------------------------

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Wildwinter.Expr
{
    public enum ExprKind { Bool, Number, Str, Flags }

    public sealed class ExprValue
    {
        public ExprKind Kind { get; }
        private readonly bool _b;
        private readonly double _n;
        private readonly string _s;
        private readonly IReadOnlyList<string> _f;

        private ExprValue(ExprKind kind, bool b = false, double n = 0, string s = null, IReadOnlyList<string> f = null)
        {
            Kind = kind; _b = b; _n = n; _s = s; _f = f;
        }

        public static ExprValue Bool(bool v) => v ? True : False;
        public static ExprValue Num(double v) => new ExprValue(ExprKind.Number, n: v);
        public static ExprValue Str(string v) => new ExprValue(ExprKind.Str, s: v ?? "");
        /// <summary>Flags list. The list is copied, so a ExprValue is immutable.</summary>
        public static ExprValue Flags(IEnumerable<string> v)
        {
            var list = v != null ? new List<string>(v) : new List<string>();
            return new ExprValue(ExprKind.Flags, f: list);
        }

        public static readonly ExprValue False = new ExprValue(ExprKind.Bool, b: false);
        public static readonly ExprValue True = new ExprValue(ExprKind.Bool, b: true);

        public bool IsBool => Kind == ExprKind.Bool;
        public bool IsNumber => Kind == ExprKind.Number;
        public bool IsString => Kind == ExprKind.Str;
        public bool IsFlags => Kind == ExprKind.Flags;

        public bool AsBool => _b;
        public double AsNumber => _n;
        public string AsString => _s;
        public IReadOnlyList<string> AsFlags => _f;

        /// <summary>`==` / `!=` semantics: primitives by value; flags element-wise,
        /// in order; mixed kinds unequal (the evaluator's valueEquals).</summary>
        public bool ValueEquals(ExprValue other)
        {
            if (other == null) return false;
            if (Kind == ExprKind.Flags || other.Kind == ExprKind.Flags)
            {
                if (Kind != ExprKind.Flags || other.Kind != ExprKind.Flags) return false;
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
                case ExprKind.Bool: return _b == other._b;
                case ExprKind.Number: return _n == other._n;
                case ExprKind.Str: return _s == other._s;
                default: return false;
            }
        }

        /// <summary>The JSON.stringify-stable rendering the JS runner compares with
        /// (and the failure reports print).</summary>
        public string ToJsonString()
        {
            switch (Kind)
            {
                case ExprKind.Bool: return _b ? "true" : "false";
                case ExprKind.Number: return JsNumber(_n);
                case ExprKind.Str: return JsonQuote(_s);
                case ExprKind.Flags:
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
        /// cross-runtime number-rendering contract): the shortest digits that
        /// round-trip, laid out by ECMAScript's Number::toString rules. Plain
        /// digits from 1e-7 up to (not including) 1e21; outside that, an
        /// exponent with a lower-case "e" and its sign ("1.5e-7", "1e+21");
        /// and -0 as "0". "R" alone printed "5E-05" and "-0".</summary>
        public static string JsNumber(double n)
        {
            if (double.IsNaN(n)) return "NaN";
            if (double.IsPositiveInfinity(n)) return "Infinity";
            if (double.IsNegativeInfinity(n)) return "-Infinity";
            if (n == 0) return "0"; // -0 included
            // A whole number below 2^53 prints exactly, and fast. Above that JS prints
            // the shortest digits padded with zeros (12345678901234567000, not the
            // exact ...568), which the general path below does.
            if (n == Math.Floor(n) && Math.Abs(n) < 9007199254740992.0)
                return n.ToString("F0", CultureInfo.InvariantCulture);
            double a = Math.Abs(n);
            string digits = null;
            int exp10 = 0;
            for (int p = 1; p <= 17 && digits == null; p++)
            {
                string e = a.ToString("E" + (p - 1), CultureInfo.InvariantCulture); // "1.50E-007"
                if (p < 17 && double.Parse(e, NumberStyles.Float, CultureInfo.InvariantCulture) != a) continue;
                int at = e.IndexOf('E');
                digits = e.Substring(0, at).Replace(".", "").TrimEnd('0');
                exp10 = int.Parse(e.Substring(at + 1), NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture);
            }
            if (digits.Length == 0) digits = "0";
            return (n < 0 ? "-" : "") + JsLayout(digits, exp10 + 1);
        }

        /// <summary>ECMAScript's layout for digits d1..dk with the decimal point
        /// `point` places from the left (the value is 0.d1..dk x 10^point).</summary>
        private static string JsLayout(string d, int point)
        {
            int k = d.Length;
            if (k <= point && point <= 21) return d + new string('0', point - k);
            if (0 < point && point <= 21) return d.Substring(0, point) + "." + d.Substring(point);
            if (-6 < point && point <= 0) return "0." + new string('0', -point) + d;
            int e = point - 1;
            string exp = (e < 0 ? "-" : "+") + Math.Abs(e).ToString(CultureInfo.InvariantCulture);
            return (k == 1 ? d : d.Substring(0, 1) + "." + d.Substring(1)) + "e" + exp;
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
                case ExprKind.Bool: return _b ? "true" : "false";
                case ExprKind.Number: return JsNumber(_n);
                case ExprKind.Str: return _s;
                case ExprKind.Flags: return string.Join(",", _f);
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
                    case ExprKind.Bool: return _b;
                    case ExprKind.Number: return _n != 0;
                    case ExprKind.Str: return _s.Length > 0;
                    case ExprKind.Flags: return _f.Count > 0;
                    default: return false;
                }
            }
        }

        public override string ToString() => ToJsonString();
    }
}
