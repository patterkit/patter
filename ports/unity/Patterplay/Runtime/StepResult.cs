// What Flow.Advance() surfaces at each stop - the normalised step the conformance
// transcript pins (line / text / gameEvent / choice / end), mirroring the JS StepResult
// + the runner's normaliseStep (fields present only when set).

using System.Collections.Generic;
using Wildwinter.Expr;

namespace Patterkit.Patterplay
{
    public enum StepType { Line, Text, GameEvent, Choice, End }

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
        public GameData GameData;
        /// <summary>Line, text and game event only: the beat's Patter extension values, by extension id, raw as
        /// the bundle carries them (any JSON as the neutral tree). Null when it has none.</summary>
        public OrderedMap<string, OrderedMap<string, object>> Extensions;
        public List<string> Tags;            // author tags (#215); null when none
        public List<ChoiceOption> Options;   // choice only
        public string GroupId;               // choice only

        public static StepResult End() => new StepResult { Type = StepType.End };
    }
}
