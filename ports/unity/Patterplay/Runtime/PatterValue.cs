// A Patter scalar value: boolean, number, string, or a flags array (string[]).
// Mirrors @wildwinter/expr's ScalarValue + the value-equality the JS runtime uses
// (primitives by value; flags element-wise, in order; mixed kinds are unequal).

using System;
using System.Collections.Generic;
using System.Globalization;

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

        public static PatterValue Bool(bool v) => new PatterValue(PatterKind.Bool, b: v);
        public static PatterValue Num(double v) => new PatterValue(PatterKind.Number, n: v);
        public static PatterValue Str(string v) => new PatterValue(PatterKind.Str, s: v);
        public static PatterValue Flags(IReadOnlyList<string> v) => new PatterValue(PatterKind.Flags, f: v ?? new List<string>());

        public static readonly PatterValue False = Bool(false);
        public static readonly PatterValue True = Bool(true);

        public bool IsBool => Kind == PatterKind.Bool;
        public bool IsNumber => Kind == PatterKind.Number;
        public bool IsString => Kind == PatterKind.Str;
        public bool IsFlags => Kind == PatterKind.Flags;

        public bool AsBool => _b;
        public double AsNumber => _n;
        public string AsString => _s;
        public IReadOnlyList<string> AsFlags => _f;

        /// <summary>`==` / `!=` semantics: primitives by value; flags element-wise; mixed kinds unequal.</summary>
        public bool ValueEquals(PatterValue other)
        {
            if (other == null) return false;
            if (Kind == PatterKind.Flags || other.Kind == PatterKind.Flags)
            {
                if (Kind != PatterKind.Flags || other.Kind != PatterKind.Flags) return false;
                if (_f.Count != other._f.Count) return false;
                for (int i = 0; i < _f.Count; i++) if (_f[i] != other._f[i]) return false;
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

        /// <summary>The string a JS host would interpolate / display (number with no trailing `.0`).</summary>
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

        /// <summary>Format a double the way JavaScript's String(n) does (the interpolation contract).</summary>
        public static string JsNumber(double n)
        {
            if (double.IsNaN(n)) return "NaN";
            if (double.IsPositiveInfinity(n)) return "Infinity";
            if (double.IsNegativeInfinity(n)) return "-Infinity";
            // "R" round-trips; integral doubles print without a decimal point (matches JS).
            if (n == Math.Floor(n) && !double.IsInfinity(n) && Math.Abs(n) < 1e21)
                return ((long)n).ToString(CultureInfo.InvariantCulture);
            return n.ToString("R", CultureInfo.InvariantCulture);
        }

        public override string ToString() => ToDisplayString();
    }
}
