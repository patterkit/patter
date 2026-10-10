// What Flow.Advance() surfaces at each stop - the normalised step the conformance
// transcript pins (line / text / gameEvent / choice / end), mirroring the JS StepResult
// + the runner's normaliseStep (fields present only when set).

using System.Collections.Generic;

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
    }

    public sealed class ChoiceOption
    {
        public string Id;
        public ChoicePrompt Prompt;    // null when the option has no prompt at all
        public bool Eligible;
        public GameData GameData;
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
        /// <summary>Line and text only (always set there; null on the others): the pause after this step, in
        /// seconds, resolved from the beat's own value and the defaults above it (line padding). Negative = the
        /// next line cuts in that long before this one ends; never negative on a snippet's last line.</summary>
        public double? PadAfter;
        public GameData GameData;
        public List<string> Tags;            // author tags (#215); null when none
        public List<ChoiceOption> Options;   // choice only
        public string GroupId;               // choice only

        public static StepResult End() => new StepResult { Type = StepType.End };
    }
}
