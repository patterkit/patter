// The compiled-bundle model (a parsed .patterc). Plain data classes so any JSON
// library can populate them (the Unity package uses Newtonsoft; the dotnet TestHost
// uses System.Text.Json) - the Runtime stays parser-agnostic. Mirrors @patterkit/model's
// Bundle / Scene / Block / node / Beat / Jump / Expression / Effect shapes.

using System.Collections.Generic;

namespace Patterkit.Patterplay
{
    public sealed class Bundle
    {
        public bool Voiced;
        /// <summary>content.hash - the build identity (live-link stale-build check). Null if absent.</summary>
        public string ContentHash;
        /// <summary>content.structureHash - the same fingerprint minus the strings: equal + a different
        /// ContentHash = a text-only edit (live refresh tier 1). Null if absent (an older compiler).</summary>
        public string StructureHash;
        /// <summary>content.project - optional project name.</summary>
        public string ContentProject;
        public Locales Locales = new Locales();
        public List<Cast> Cast = new List<Cast>();
        public List<PropertyDecl> Properties = new List<PropertyDecl>();
        public Dictionary<string, Scene> Scenes = new Dictionary<string, Scene>();
        /// <summary>locale -> (string id -> text). Empty for an IDs-only build (the engine emits beat IDs).</summary>
        public Dictionary<string, Dictionary<string, string>> Strings = new Dictionary<string, Dictionary<string, string>>();
        /// <summary>How strings ship + resolve (spec §11). Null = "embedded" (the default).</summary>
        public Localisation Localisation;
        /// <summary>node kind -> declared gameData fields.</summary>
        public Dictionary<string, List<GameDataField>> GameDataFields = new Dictionary<string, List<GameDataField>>();
        /// <summary>Closed-caption delimiters (#214). Null = the default ( / ).</summary>
        public CaptionDelimiters ClosedCaptions;
    }

    /// <summary>Closed-caption config (#214): the open/close cue delimiters, plus a `Character` whose whole
    /// lines are pure captions (omitted when captions are off, delimiters or not).</summary>
    public sealed class CaptionDelimiters
    {
        public string Open = "[";
        public string Close = "]";
        public string Character;   // null => the default "SFX"
    }

    /// <summary>"embedded" (resolve strings per locale) or "ids" (emit beat IDs); sourceDebug embeds the
    /// source language for debug playback only.</summary>
    public sealed class Localisation
    {
        public string Mode = "embedded";
        public bool SourceDebug;
    }

    public sealed class Locales
    {
        public string Default = "en";
        public List<string> Included = new List<string>();
    }

    public sealed class Cast
    {
        public string Name;
        public string DisplayName;
    }

    public sealed class PropertyDecl
    {
        public string Name;
        public string Type;          // bool | number | string | flags | enum
        public bool? Shared;
        public bool Temporary;
        public PatterValue Default;  // null => the type default
        public List<string> Values;  // enum
    }

    public sealed class Scene
    {
        public string Id;
        public string Name;
        public string GameId;
        public List<Block> Blocks = new List<Block>();
        public List<PropertyDecl> SceneProps = new List<PropertyDecl>();
        public List<Effect> OnEntry = new List<Effect>();
        public List<string> Tags;    // author tags (#215)
    }

    public sealed class Block
    {
        public string Id;
        public string Name;
        public string GameId;
        public List<Node> Children = new List<Node>();
        public List<string> Tags;    // author tags (#215)
    }

    /// <summary>A group (a run / choice / selector container) or a snippet (a run of beats).</summary>
    public sealed class Node
    {
        public string Id;
        public string Type;          // "group" | "snippet"

        // common
        public Expression Condition;
        public List<Effect> OnEnter;
        public List<Effect> OnExit;
        public GameData GameData;
        public List<string> Tags;    // author tags (#215)

        // group
        public string Selector;      // run (default) | choice | branch | sequence
        public List<Node> Children;
        public Beat Prompt;
        public bool Sticky;
        public bool Fallback;
        public bool SecretUntilEligible;
        public SelectorOptions Options;
        public bool Shared;          // selector cursor shared across flows

        // snippet
        public List<Beat> Beats;
        public Jump Jump;

        public bool IsSnippet => Type == "snippet";
        public bool IsGroup => Type == "group";
    }

    public sealed class Beat
    {
        public string Id;
        public string Kind;          // line | text | gameEvent
        public string Character;
        public string Direction;
        public GameData GameData;
        public List<string> Tags;    // author tags (#215)
    }

    public sealed class Jump
    {
        public string To;
        public string Mode;          // "call" => push return frame; else absolute jump
    }

    public sealed class Expression
    {
        public AstNode Ast;
    }

    public sealed class Effect
    {
        public string Target;        // a property ref
        public Expression Value;
    }

    public sealed class SelectorOptions
    {
        public string Order;         // sequential (default) | shuffle
        public string Exhaust;       // once (default) | repeat | stick
    }

    public sealed class GameDataField
    {
        public string Name;
        public string Type;
        public PatterValue Default;
        public List<string> Values;
    }

    /// <summary>A node's sparse gameData overrides (name -> value).</summary>
    public sealed class GameData : Dictionary<string, PatterValue> { }
}
