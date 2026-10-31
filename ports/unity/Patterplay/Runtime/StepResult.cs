// What Flow.Advance() surfaces at each stop - the normalised step the conformance
// transcript pins (line / text / gameEvent / choice / end), mirroring the JS StepResult
// + the runner's normaliseStep (fields present only when set).

using System.Collections.Generic;
using Wildwinter.Expr;

namespace Patterkit.Patterplay
{
    public enum StepType { Line, Text, GameEvent, Choice, End }

    /// <summary>Why a flow ended (an End step's <see cref="StepResult.Reason"/>): the JS runtime's FlowEndReason,
    /// "ended" | "ran-dry".</summary>
    public enum FlowEndReason
    {
        /// <summary>Falling off the end of a block, an `END`, or the host's Goto("END").</summary>
        Ended,
        /// <summary>A choice ran dry (no option left to take, and no fallback) with nothing delivered after it,
        /// so the flow ended there. Reported through EngineOptions.OnError too (a "dry-choice" problem).</summary>
        RanDry,
    }

    public sealed class ChoicePrompt
    {
        public string Kind;            // line | text
        public string Text;
        public string Character;       // line only
        public string CharacterName;   // line only
        public string Direction;       // line only
        public string Qualifier;       // line only: the speaker qualifier's gameId (`vo`)
        public string QualifierName;   // line only: its resolved shown name (`V.O.`)
        /// <summary>Line only: the name to show for the speaker (locale-aware), as on a line step: `You (V.O.)`,
        /// a pair's own label, or with no qualifier the shown name. Null with no speaker and in IDs-only mode.</summary>
        public string SpeakerLabel;
        /// <summary>The prompt's resolved pause, in seconds (line padding): when it is spoken (by
        /// `ReplayPromptOnChoose`, or by a game that voices it), the wait before the reply, negative to cut in on
        /// the question. Always set on a prompt the engine shows.</summary>
        public double? PadAfter;
    }

    public sealed class ChoiceOption
    {
        public string Id;
        public ChoicePrompt Prompt;    // null when the option has no prompt at all
        public bool Eligible;
        public GameData GameData;
        /// <summary>The option's Patter extension values, by extension id, exactly as the bundle carries them:
        /// raw and sparse, any JSON as the neutral tree, never read by the engine. Null when it has none. Fill in
        /// defaults with <c>GameDataHelpers.EffectiveGameData(GameDataHelpers.ExtensionDecls(bundle, id, "option"), ...)</c>.</summary>
        public OrderedMap<string, OrderedMap<string, object>> Extensions;
    }

    /// <summary>The result of AdvanceToStop: every beat played on the way to a stop, plus the terminal
    /// choice / end that stopped it.</summary>
    public sealed class AdvanceToStopResult
    {
        public List<StepResult> Played = new List<StepResult>();
        public StepResult Stop;
    }

    public sealed class StepResult
    {
        public StepType Type;
        public string Id;
        public string Text;
        public string Character;
        public string CharacterName;
        public string Direction;
        public string Qualifier;             // line only: the speaker qualifier's gameId (`vo`); null when none
        public string QualifierName;         // line only: its resolved shown name (`V.O.`); null in IDs-only mode
        /// <summary>Line only: the name to show for the speaker, in the current locale. With a qualifier, the
        /// character's own label for that pair when the project gives one, else the speaker pattern filled in
        /// (`You (V.O.)`); with none, the shown name (else the token). Null with no speaker, on a line silenced by
        /// closed captions, and in IDs-only mode (the game maps the tokens itself).</summary>
        public string SpeakerLabel;
        /// <summary>Line and text only (always set there; null on the others): the pause after this step, in
        /// seconds, resolved from the beat's own value and the defaults above it (line padding). Negative = the
        /// next line cuts in that long before this one ends; never negative on a snippet's last line.</summary>
        public double? PadAfter;
        /// <summary>Text only: this step is action, a direction for whoever stages the scene, never shown to the
        /// player (a dialogue scene's text, unless the project localises it). Its text is the source in every
        /// locale. False = shown text, and always false on a replayed prompt.</summary>
        public bool Action;
        /// <summary>Line and text only: the beat's string in the project's main language (the bundle's default
        /// locale), whatever language is being shown, for timing a line with no recording and moving a mouth:
        /// <c>Bundle.EstimateLineDuration(step.SpokenText, step.SpokenLocale, step.EstimateRate.Value)</c>, or
        /// <c>Bundle.SpeechUnits(step.SpokenText, step.SpokenLocale)</c>. Interpolated as the shown text is (a voiced
        /// project's lines aren't), with closed-caption cues left out whether captions are on or not, and empty for
        /// the caption character's lines. Null in an IDs-only bundle (the game passes its own text), and when the main
        /// language has no string for the beat.</summary>
        public string SpokenText;
        /// <summary>Line and text only: the language <see cref="SpokenText"/> is in (the bundle's default locale).
        /// Set exactly when SpokenText is.</summary>
        public string SpokenLocale;
        /// <summary>Line and text only (always set there; null on the others): the project's syllables a second for
        /// a line with no recording (its `estimateSyllablesPerSecond`, else
        /// <see cref="Bundle.DefaultEstimateSyllablesPerSecond"/>). A line with a recording lasts as long as the
        /// recording.</summary>
        public double? EstimateRate;
        public GameData GameData;
        /// <summary>Line, text and game event only: the beat's Patter extension values, by extension id, raw as
        /// the bundle carries them (any JSON as the neutral tree). Null when it has none.</summary>
        public OrderedMap<string, OrderedMap<string, object>> Extensions;
        public List<string> Tags;            // author tags (#215); null when none
        public List<ChoiceOption> Options;   // choice only
        public string GroupId;               // choice only
        /// <summary>End only: why the flow ended. <see cref="FlowEndReason.RanDry"/> when a choice ran dry with nothing
        /// delivered after it (a hub that ran out), else <see cref="FlowEndReason.Ended"/>.</summary>
        public FlowEndReason Reason;

        public static StepResult End(FlowEndReason reason = FlowEndReason.Ended) => new StepResult { Type = StepType.End, Reason = reason };
    }
}
