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
    }

    public sealed class ChoiceOption
    {
        public string Id;
        public ChoicePrompt Prompt;    // null when the option has no prompt at all
        public bool Eligible;
        public GameData GameData;
    }

    public sealed class StepResult
    {
        public StepType Type;
        public string Id;
        public string Text;
        public string Character;
        public string CharacterName;
        public string Direction;
        public GameData GameData;
        public List<string> Tags;            // author tags (#215); null when none
        public List<ChoiceOption> Options;   // choice only
        public string GroupId;               // choice only

        public static StepResult End() => new StepResult { Type = StepType.End };
    }
}
