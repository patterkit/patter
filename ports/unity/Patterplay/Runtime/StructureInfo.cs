// Static structure introspection (editor / dev tooling): a read-only view of the AUTHORED tree
// (scenes -> blocks -> groups/snippets -> beats), for tools that build against the writer's structure
// (e.g. an Unreal-style Sequencer of subsequences per beat). Mirrors @patterkit/runtime's
// BeatInfo / OutlineNode / OutlineScene / FlatBeat. Static: no flow, no play state.

using System.Collections.Generic;

namespace Patterkit.Patterplay
{
    /// <summary>One beat's static data - the same shape a delivered step carries, at the source locale.</summary>
    public sealed class BeatInfo
    {
        public string Id;
        public string Kind;            // line | text | gameEvent
        public string Character;       // line only
        public string CharacterName;   // resolved display name (source locale), if the cast declares one
        public string Direction;       // line only
        public string Text;            // source text, un-interpolated (line/text); null for gameEvent / IDs-only
        public GameData GameData;      // author overrides (raw); null when empty
        public List<string> Tags;      // accumulated author tags; null when empty
    }

    /// <summary>A node in the outline tree: a group (selector + children) or a snippet (beats + jump).</summary>
    public sealed class OutlineNode
    {
        public string Type;            // "group" | "snippet"
        public string Id;
        public List<string> Tags;
        // group only
        public string Selector;
        public BeatInfo Prompt;
        public List<OutlineNode> Children;
        // snippet only
        public List<BeatInfo> Beats;
        public string JumpTo;
        public string JumpMode;        // "jump" | "call"
    }

    public sealed class OutlineBlock
    {
        public string Id;
        public string GameId;
        public string Name;
        public List<string> Tags;
        public List<OutlineNode> Children = new List<OutlineNode>();
    }

    public sealed class OutlineScene
    {
        public string Id;
        public string GameId;
        public string Name;
        public List<string> Tags;
        public List<OutlineBlock> Blocks = new List<OutlineBlock>();
    }

    /// <summary>One beat in document order, with the scene/block/snippet it lives in (the flat view).</summary>
    public sealed class FlatBeat
    {
        public string SceneId;
        public string BlockId;
        public string SnippetId;
        public BeatInfo Beat;
    }
}
